// src/pages/InvoicesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import InvoicePayDialog, { type PayAccount } from "../components/InvoicePayDialog";
import { PinActionDialog } from "../components/SecondPassword"; // ✅ mở lại HĐ đã duyệt cần mật khẩu cấp 2

type InvoiceType = "SALES" | "PURCHASE";
type AnyInvoiceType = "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";
type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

// ✅ đồng bộ với BE hiện tại (không có CANCELLED)
type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

type PaymentAccount = PayAccount;

type ReturnMetaLite = {
  state?: "NONE" | "PARTIAL" | "FULL";
  debtIgnore?: boolean;
  returnedTotal?: number;
  netTotal?: number; // after return, before hold
  holdAmount?: number;
  collectible?: number; // after return & hold
};

type InvoiceListItem = {
  id: string | number;
  code: string;
  date?: string;
  type: InvoiceType;

  partnerId?: string;
  partnerName: string;

  totalAmount: number; // ✅ Gross total (subtotal + tax)

  // ✅ (tuỳ BE) nếu có trả hàng
  netTotal?: number; // gross after return
  returnedTotal?: number; // gross returned

  // ✅ nếu BE trả returnMeta thì ưu tiên dùng
  returnMeta?: ReturnMetaLite;

  paymentStatus?: PaymentStatus;
  paidAmount?: number; // ✅ NORMAL collected net (đã sync từ allocations NORMAL)

  hasWarrantyHold?: boolean;
  warrantyHoldAmount?: number;

  status?: InvoiceStatus;
  rejectInfo?: { reason: string | null; at: string; by: string | null } | null; // ✅ nháp bị trả về
};

type InvoiceTypeFilter = "" | "SALES" | "PURCHASE";
type SourceFilter = "INVOICE" | "ADJUST"; // ✅ NEW: hóa đơn / chứng từ điều chỉnh (adjust move)

const LS_LAST_PAY_ACCOUNT = "lastPayAccountId";

/* ========================= helpers ========================= */

function formatDateDisplay(raw?: string) {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function unwrapList(res: any): any[] {
  const body = res?.data ?? {};
  if (body && typeof body === "object" && "data" in body) return body.data || [];
  return Array.isArray(body) ? body : [];
}

function unwrapUser(res: any): any {
  const body = res?.data;
  return body?.data ?? body;
}

// ngày hôm nay theo giờ VN (toISOString là giờ UTC, trước 7h sáng sẽ ra ngày hôm qua)
function vnTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

function formatMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function normalizeRole(me: any) {
  return String(me?.role ?? me?.user?.role ?? me?.data?.role ?? "");
}

function toNum(v: any) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

function clamp0(n: any) {
  return Math.max(0, toNum(n));
}

function parseMoneyInputToNumber(raw: string): number {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

function normalizePaymentStatus(v: any): PaymentStatus | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toUpperCase();
  if (s === "PAID" || s === "UNPAID" || s === "PARTIAL") return s as PaymentStatus;
  return undefined;
}

function getReturnState(inv: InvoiceListItem): "NONE" | "PARTIAL" | "FULL" {
  if (inv.type !== "SALES") return "NONE";
  const st = inv.returnMeta?.state;
  if (st === "FULL" || st === "PARTIAL" || st === "NONE") return st;
  return "NONE";
}

function getReturnedTotal(inv: InvoiceListItem) {
  if (inv.type !== "SALES") return 0;
  if (inv.returnMeta?.returnedTotal != null) return clamp0(inv.returnMeta.returnedTotal);
  if (inv.returnedTotal != null) return clamp0(inv.returnedTotal);
  return 0;
}

function calcSalesNetTotal(inv: InvoiceListItem) {
  const total = clamp0(inv.totalAmount);

  if (inv.type !== "SALES") return total;

  if (inv.returnMeta?.netTotal != null) return clamp0(inv.returnMeta.netTotal);
  if (inv.netTotal != null) return clamp0(inv.netTotal);

  const returned = getReturnedTotal(inv);
  if (returned > 0) return clamp0(total - returned);

  return total;
}

function getHoldAmount(inv: InvoiceListItem) {
  if (inv.type === "SALES" && inv.returnMeta?.holdAmount != null) return clamp0(inv.returnMeta.holdAmount);
  if (inv.hasWarrantyHold === true) return clamp0(inv.warrantyHoldAmount);
  return 0;
}

function getCollectibleTotal(inv: InvoiceListItem) {
  if (inv.type === "SALES" && inv.returnMeta?.collectible != null) return clamp0(inv.returnMeta.collectible);

  const baseNet = inv.type === "SALES" ? calcSalesNetTotal(inv) : clamp0(inv.totalAmount);
  const hold = getHoldAmount(inv);
  return Math.max(0, baseNet - hold);
}

function isFullyReturned(inv: InvoiceListItem) {
  if (inv.type !== "SALES") return false;

  const st = getReturnState(inv);
  if (st === "FULL") return true;

  const returned = getReturnedTotal(inv);
  const collectible = getCollectibleTotal(inv);
  if (returned > 0 && collectible <= 0.0001) return true;

  const total = clamp0(inv.totalAmount);
  if (returned > 0 && total > 0) return returned + 0.0001 >= total;

  return false;
}

function isPartialReturned(inv: InvoiceListItem) {
  if (inv.type !== "SALES") return false;
  const st = getReturnState(inv);
  if (st === "PARTIAL") return true;

  const returned = getReturnedTotal(inv);
  return returned > 0.0001 && !isFullyReturned(inv);
}

function calcCollectibleRemaining(params: { collectibleTotal: number; paidNormal: number }) {
  const collectibleTotal = clamp0(params.collectibleTotal);
  const paidNormal = clamp0(params.paidNormal);
  const remainingNormal = Math.max(0, collectibleTotal - paidNormal);
  return { collectibleTotal, remainingNormal };
}

function derivePaymentStatus(inv: InvoiceListItem): PaymentStatus {
  if (isFullyReturned(inv)) return "PAID";

  const collectibleTotal = getCollectibleTotal(inv);
  if (collectibleTotal <= 0.0001) return "PAID";

  const paid = clamp0(inv.paidAmount);

  if (paid <= 0.0001) return "UNPAID";
  if (paid + 0.0001 >= collectibleTotal) return "PAID";
  return "PARTIAL";
}

function resolvePaymentStatus(inv: InvoiceListItem): PaymentStatus {
  if (isFullyReturned(inv)) return "PAID";

  const collectibleTotal = getCollectibleTotal(inv);
  if (collectibleTotal <= 0.0001) return "PAID";

  const be = inv.paymentStatus;
  if (be === "PAID" || be === "UNPAID" || be === "PARTIAL") {
    const paid = clamp0(inv.paidAmount);
    if (be === "UNPAID" && paid > 0.0001) return "PARTIAL";
    if (be === "PARTIAL" && paid + 0.0001 >= collectibleTotal) return "PAID";
    return be;
  }

  return derivePaymentStatus(inv);
}

/** ✅ Sort key for invoice code: numeric trailing digits if possible */
function invoiceCodeToSortParts(code: string) {
  const s = String(code ?? "").trim();

  const m1 = s.match(/^(.*?)(\d+)\s*$/);
  if (m1) {
    const prefix = (m1[1] || "").trim();
    const num = Number(m1[2]);
    return { prefix, num: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY, raw: s };
  }

  const m2 = s.match(/(\d+)(?!.*\d)/);
  if (m2) {
    const num = Number(m2[1]);
    const idx = s.lastIndexOf(m2[1]);
    const prefix = idx >= 0 ? s.slice(0, idx).trim() : s;
    return { prefix, num: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY, raw: s };
  }

  return { prefix: s, num: Number.POSITIVE_INFINITY, raw: s };
}

/* ========================= map 1 dòng từ API ========================= */
function mapInvoiceRow(x: any): InvoiceListItem {
        const total = toNum(x.total ?? x.totalAmount ?? x.grandTotal ?? x.subtotal ?? 0);
        const rawDate = x.issueDate ?? x.date ?? x.createdAt ?? "";

        const rm: ReturnMetaLite | undefined = x.returnMeta
          ? {
              state: x.returnMeta.state,
              debtIgnore: !!x.returnMeta.debtIgnore,
              returnedTotal: x.returnMeta.returnedTotal != null ? toNum(x.returnMeta.returnedTotal) : undefined,
              netTotal: x.returnMeta.netTotal != null ? toNum(x.returnMeta.netTotal) : undefined,
              holdAmount: x.returnMeta.holdAmount != null ? toNum(x.returnMeta.holdAmount) : undefined,
              collectible: x.returnMeta.collectible != null ? toNum(x.returnMeta.collectible) : undefined,
            }
          : undefined;

        return {
          id: x.id,
          code: x.code ?? "",
          date: rawDate,
          type: (x.type === "PURCHASE" ? "PURCHASE" : "SALES") as InvoiceType,

          partnerId: x.partnerId ?? x.partner?.id ?? undefined,
          partnerName: x.partner?.name ?? x.partnerName ?? "",

          totalAmount: total,

          netTotal: x.netTotal != null ? toNum(x.netTotal) : undefined,
          returnedTotal: x.returnedTotal != null ? toNum(x.returnedTotal) : undefined,

          returnMeta: rm,

          paidAmount: x.paidAmount != null ? toNum(x.paidAmount) : 0,

          hasWarrantyHold: x.hasWarrantyHold === true,
          warrantyHoldAmount: x.warrantyHoldAmount != null ? toNum(x.warrantyHoldAmount) : 0,

          paymentStatus: normalizePaymentStatus(x.paymentStatus),
          status: (x.status as InvoiceStatus) ?? "DRAFT",
          rejectInfo: x.rejectInfo ?? null,
        };
      }

/** ✅ số ngày kể từ ngày hoá đơn (để nhắc thu nợ) */
function daysSince(raw?: string) {
  if (!raw) return 0;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date(`${vnTodayYmd()}T00:00:00`);
  const dd = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d)}T00:00:00`);
  return Math.max(0, Math.round((today.getTime() - dd.getTime()) / 86400000));
}

/* ========================= UI: Modal ========================= */

function Modal(props: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={props.onClose} />
      <div className="relative w-[560px] max-w-[92vw] bg-white rounded-xl shadow-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="text-base font-semibold">{props.title}</div>
          <button
            className="text-gray-500 hover:text-gray-800"
            onClick={props.onClose}
            aria-label="Đóng"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{props.children}</div>
        {props.footer ? <div className="px-5 py-4 border-t border-gray-200">{props.footer}</div> : null}
      </div>
    </div>
  );
}

// nút icon ở cột thao tác
const ACT_BTN =
  "grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 " +
  "disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent disabled:hover:text-slate-300";

/* ========================= Page ========================= */

const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  // ✅ sync filter to URL
  const [sp, setSp] = useSearchParams();

  const containerTopRef = useRef<HTMLDivElement | null>(null);

  const scrollToTop = (smooth = true) => {
    const el = containerTopRef.current;
    if (el && "scrollIntoView" in el) {
      el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      return;
    }
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  };

  const readQuery = () => {
    const q = sp.get("q") ?? "";
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    const type = (sp.get("type") ?? "SALES") as InvoiceTypeFilter;
    const src = (sp.get("src") ?? "INVOICE") as SourceFilter;

    const safeType: InvoiceTypeFilter = type === "PURCHASE" || type === "SALES" || type === "" ? type : "SALES";
    const safeSrc: SourceFilter = src === "ADJUST" ? "ADJUST" : "INVOICE";

    const view: "all" | "debt" = sp.get("view") === "debt" ? "debt" : "all";
    return { q, from, to, type: safeType, src: safeSrc, view };
  };

  const writeQuery = (next: { q: string; from: string; to: string; type: InvoiceTypeFilter; src: SourceFilter; view?: "all" | "debt" }) => {
    const params: any = {};
    if (next.q.trim()) params.q = next.q.trim();
    if (next.from) params.from = next.from;
    if (next.to) params.to = next.to;
    if (next.type) params.type = next.type;
    if (next.src && next.src !== "INVOICE") params.src = next.src; // mặc định INVOICE thì không cần ghi
    const v = next.view ?? viewRef.current;
    if (v === "debt") params.view = "debt";
    setSp(params, { replace: true });
  };

  const initial = useMemo(() => readQuery(), [location.key]); // key đổi khi back/forward

  const [search, setSearch] = useState(initial.q);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  // ✅ mặc định theo URL (nếu không có thì SALES)
  const [typeFilter, setTypeFilter] = useState<InvoiceTypeFilter>(initial.type || "SALES");

  // ✅ NEW: hóa đơn / điều chỉnh
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initial.src || "INVOICE");

  const [loading, setLoading] = useState(false);

  // ✅ tab "Chưa thu đủ": hoá đơn đã duyệt còn nợ (không theo khoảng ngày, cũ nhất lên đầu)
  const [view, setView] = useState<"all" | "debt">(initial.view);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [debtRows, setDebtRows] = useState<InvoiceListItem[]>([]);
  const [debtLoading, setDebtLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);

  const [role, setRole] = useState<string>("");
  const isStaff = role === "staff";
  const isAdmin = role === "admin";
  const isAccountant = role === "accountant";
  const canApprove = role === "admin" || role === "accountant";

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Xác nhận");
  const [confirmMessage, setConfirmMessage] = useState<React.ReactNode>(null);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState<InvoiceListItem | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<InvoiceListItem | null>(null);
  const [payAccountId, setPayAccountId] = useState<string>("");
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payAmountText, setPayAmountText] = useState<string>("0");
  const [payDate, setPayDate] = useState<string>(() => vnTodayYmd());
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payNote, setPayNote] = useState<string>("");
  const [reopenTarget, setReopenTarget] = useState<InvoiceListItem | null>(null);

  const payAmountInputRef = useRef<HTMLInputElement | null>(null);

  const [highlightInvoiceId, setHighlightInvoiceId] = useState<string>("");

  useEffect(() => {
    api
      .get("/auth/me", { params: { t: Date.now() } })
      .then((res) => {
        const u = unwrapUser(res);
        setRole(normalizeRole(u));
      })
      .catch((err) => {
        console.error("load auth/me error", err);
        setRole("");
      });
  }, []);

  const openConfirm = (opts: { title: string; message: React.ReactNode; action: () => Promise<void> }) => {
    setConfirmTitle(opts.title);
    setConfirmMessage(opts.message);
    setConfirmAction(() => opts.action);
    setConfirmOpen(true);
  };

  const loadAccounts = async () => {
    try {
      setAccountsLoading(true);

      const res = await api.get("/payment-accounts", {
        params: { active: 1, _ts: Date.now() },
      });

      const arr: any[] = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.data)
        ? res.data.data
        : [];

      const mapped: PaymentAccount[] = arr
        .map((a: any) => ({
          id: String(a.id),
          code: String(a.code || ""),
          name: String(a.name || ""),
          type: a.type ? String(a.type) : undefined,
          bankName: a.bankName ?? null,
          accountNo: a.accountNo ?? null,
        }))
        .filter((a) => a.id && a.id !== "undefined" && a.id !== "null");

      setAccounts(mapped);
    } catch (err) {
      console.error("load payment accounts error", err);
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchInvoices = async (q: string, fromVal: string, toVal: string, typeVal: InvoiceTypeFilter) => {
    try {
      setLoading(true);

      const res = await api.get("/invoices", {
        params: {
          q,
          page: 1,
          pageSize: 300,
          type: typeVal || "",
          from: fromVal || undefined,
          to: toVal || undefined,
          _ts: Date.now(),
        },
      });

      const data: any[] = unwrapList(res);

      const filtered = (Array.isArray(data) ? data : []).filter((x: any) => {
        const t = String(x.type || "") as AnyInvoiceType;
        if (!(t === "SALES" || t === "PURCHASE")) return false;
        if (typeVal && t !== typeVal) return false;
        return true;
      });

      const mapped: InvoiceListItem[] = filtered.map(mapInvoiceRow);

      mapped.sort((a, b) => {
        const pa = invoiceCodeToSortParts(a.code);
        const pb = invoiceCodeToSortParts(b.code);

        const pfx = pa.prefix.localeCompare(pb.prefix, "vi", { sensitivity: "base" });
        if (pfx !== 0) return pfx;

        if (pa.num !== pb.num) return pb.num - pa.num; // ✅ DESC

        return pb.raw.localeCompare(pa.raw, "vi", { numeric: true, sensitivity: "base" });
      });

      setInvoices(mapped);
    } catch (err: any) {
      console.error("load invoices error", err);
      toast.push({
        type: "error",
        title: "Lỗi",
        message: err?.response?.data?.message || err?.message || "Không tải được danh sách hóa đơn.",
      });
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: fetch adjustments (adjust move) — m gửi endpoint thật tao sẽ thay đúng
  const fetchAdjustments = async (q: string, fromVal: string, toVal: string) => {
    try {
      setLoading(true);

      // TODO: thay bằng endpoint adjust move thật của m
      // Ví dụ (placeholder): /movements?kind=ADJUST&page=1&pageSize=300&q=...
      const res = await api.get("/movements", {
        params: {
          page: 1,
          pageSize: 300,
          q: q || undefined,
          from: fromVal || undefined,
          to: toVal || undefined,
          // kind: "ADJUST",
          _ts: Date.now(),
        },
      });

      const data: any[] = unwrapList(res);

      // Map tạm sang InvoiceListItem để reuse UI (m gửi schema tao map đúng 100%)
      const mapped: InvoiceListItem[] = (Array.isArray(data) ? data : []).map((x: any) => {
        const total = toNum(x.total ?? x.totalAmount ?? x.amount ?? 0);
        const rawDate = x.issueDate ?? x.date ?? x.createdAt ?? "";

        return {
          id: x.id,
          code: x.code ?? x.refCode ?? x.movementCode ?? "(ADJ)",
          date: rawDate,
          type: "SALES", // chỉ để pass type, UI badge/logic sẽ hơi lệch nếu không map đúng => chờ endpoint thật
          partnerId: x.partnerId ?? undefined,
          partnerName: x.partnerName ?? x.note ?? "Điều chỉnh",
          totalAmount: total,
          paidAmount: 0,
          paymentStatus: "PAID",
          status: "APPROVED",
        };
      });

      setInvoices(mapped);
    } catch (err: any) {
      console.error("load adjustments error", err);
      toast.push({
        type: "error",
        title: "Lỗi",
        message: err?.response?.data?.message || err?.message || "Không tải được chứng từ điều chỉnh.",
      });
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDebts = async (q: string, typeVal: InvoiceTypeFilter) => {
    try {
      setDebtLoading(true);
      const res = await api.get("/invoices", {
        params: { q, page: 1, pageSize: 1000, type: typeVal || "", status: "APPROVED", paymentStatus: "UNPAID,PARTIAL", _ts: Date.now() },
      });
      const data: any[] = unwrapList(res);
      const rows = (Array.isArray(data) ? data : [])
        .filter((x: any) => x.type === "SALES" || x.type === "PURCHASE")
        .filter((x: any) => !typeVal || x.type === typeVal)
        .map(mapInvoiceRow)
        .filter((inv) => {
          if (inv.status !== "APPROVED" || isFullyReturned(inv)) return false;
          const { remainingNormal } = calcCollectibleRemaining({ collectibleTotal: getCollectibleTotal(inv), paidNormal: clamp0(inv.paidAmount) });
          return remainingNormal > 0.5;
        })
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))); // cũ nhất lên đầu
      setDebtRows(rows);
    } catch (err: any) {
      console.error("load debts error", err);
      setDebtRows([]);
    } finally {
      setDebtLoading(false);
    }
  };

  const runFetchBySource = async (opts: { q: string; from: string; to: string; type: InvoiceTypeFilter; src: SourceFilter }) => {
    if (opts.src === "ADJUST") {
      await fetchAdjustments(opts.q, opts.from, opts.to);
      return;
    }
    await Promise.all([fetchInvoices(opts.q, opts.from, opts.to, opts.type), fetchDebts(opts.q, opts.type)]);
  };

  const switchView = (v: "all" | "debt") => {
    setView(v);
    viewRef.current = v;
    writeQuery({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter, view: v });
  };

  const debtSummary = useMemo(() => {
    let total = 0, over30 = 0, over30Amt = 0;
    for (const inv of debtRows) {
      const { remainingNormal } = calcCollectibleRemaining({ collectibleTotal: getCollectibleTotal(inv), paidNormal: clamp0(inv.paidAmount) });
      total += remainingNormal;
      if (daysSince(inv.date) > 30) {
        over30++;
        over30Amt += remainingNormal;
      }
    }
    return { count: debtRows.length, total, over30, over30Amt };
  }, [debtRows]);
  const isDebtView = view === "debt" && sourceFilter === "INVOICE";
  const rowsShown = isDebtView ? debtRows : invoices;
  const debtWord = typeFilter === "PURCHASE" ? "trả" : typeFilter === "SALES" ? "thu" : "thu / trả";

  // ✅ initial load based on URL query (fix back button reset)
  useEffect(() => {
    const q0 = readQuery();

    // sync state -> query
    setSearch(q0.q);
    setFrom(q0.from);
    setTo(q0.to);
    setTypeFilter(q0.type || "SALES");
    setSourceFilter(q0.src || "INVOICE");
    setView(q0.view);

    runFetchBySource({ q: q0.q, from: q0.from, to: q0.to, type: q0.type || "SALES", src: q0.src || "INVOICE" });
    loadAccounts();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    if (!payOpen) return;
    const t = setTimeout(() => {
      const el = payAmountInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, 30);
    return () => clearTimeout(t);
  }, [payOpen]);

  useEffect(() => {
    if (!highlightInvoiceId) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`${window.innerWidth < 768 ? "inv-card" : "inv-row"}-${highlightInvoiceId}`);
      if (el && "scrollIntoView" in el) {
        // @ts-ignore
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 80);
    return () => clearTimeout(t);
  }, [highlightInvoiceId, invoices.length]);

  const handleApplyFilter = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const next = {
      q: search.trim(),
      from,
      to,
      type: typeFilter,
      src: sourceFilter,
    };

    writeQuery(next);
    await runFetchBySource(next);
    scrollToTop(true);
  };

  const handleClearFilter = async () => {
    const next = { q: search.trim(), from: "", to: "", type: "SALES" as InvoiceTypeFilter, src: "INVOICE" as SourceFilter };

    setFrom("");
    setTo("");
    setTypeFilter("SALES");
    setSourceFilter("INVOICE");

    writeQuery(next);
    await runFetchBySource(next);
    scrollToTop(true);
  };

  const handleDelete = async (inv: InvoiceListItem) => {
    if (!inv.id) return;

    if (isStaff && inv.status !== "DRAFT") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Chỉ được xóa hóa đơn ở trạng thái NHÁP." });
      return;
    }
    if (!isStaff && inv.status === "APPROVED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Hóa đơn đã duyệt, không thể xóa." });
      return;
    }

    openConfirm({
      title: "Xóa hóa đơn",
      message: (
        <div className="text-sm text-gray-700">
          Bạn có chắc muốn xóa hóa đơn <b>{inv.code}</b> không?
        </div>
      ),
      action: async () => {
        await api.delete(`/invoices/${inv.id}`);
        toast.push({ type: "success", title: "Thành công", message: "Đã xóa hóa đơn." });
        await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
      },
    });
  };

  const handleSubmit = async (inv: InvoiceListItem) => {
    if (!inv.id) return;
    if (inv.status !== "DRAFT") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Chỉ hóa đơn NHÁP mới gửi duyệt được." });
      return;
    }

    openConfirm({
      title: "Gửi duyệt",
      message: (
        <div className="text-sm text-gray-700">
          Gửi duyệt hóa đơn <b>{inv.code}</b>?
        </div>
      ),
      action: async () => {
        await api.post(`/invoices/${inv.id}/submit`);
        toast.push({ type: "success", title: "Thành công", message: "Đã gửi duyệt." });
        await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
      },
    });
  };

  const handleRecall = async (inv: InvoiceListItem) => {
    if (!inv.id) return;
    if (inv.status !== "SUBMITTED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Chỉ hóa đơn CHỜ DUYỆT mới hủy gửi duyệt được." });
      return;
    }

    openConfirm({
      title: "Hủy gửi duyệt",
      message: (
        <div className="text-sm text-gray-700">
          Hủy gửi duyệt hóa đơn <b>{inv.code}</b> (quay về NHÁP)?
        </div>
      ),
      action: async () => {
        await api.post(`/invoices/${inv.id}/recall`);
        toast.push({ type: "success", title: "Thành công", message: "Đã hủy gửi duyệt." });
        await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
      },
    });
  };

  const handleApprove = async (inv: InvoiceListItem) => {
    if (!inv.id) return;
    if (inv.status !== "SUBMITTED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Chỉ hóa đơn CHỜ DUYỆT mới duyệt được." });
      return;
    }

    openConfirm({
      title: "Duyệt hóa đơn",
      message: (
        <div className="text-sm text-gray-700">
          Duyệt hóa đơn <b>{inv.code}</b> và cập nhật tồn kho?
        </div>
      ),
      action: async () => {
        await api.post(`/invoices/${inv.id}/approve`, {});
        toast.push({ type: "success", title: "Đã duyệt", message: "Hóa đơn đã được duyệt." });
        await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
      },
    });
  };

  const handleReject = async (inv: InvoiceListItem) => {
    if (!inv.id) return;
    if (inv.status !== "SUBMITTED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Chỉ hóa đơn CHỜ DUYỆT mới từ chối được." });
      return;
    }
    setRejectTarget(inv);
    setRejectReason("");
    setRejectOpen(true);
  };

  const handleAdjustApproved = async (inv: InvoiceListItem) => {
    if (!inv?.id) return;

    if (!isAdmin) {
      toast.push({ type: "warning", title: "Không có quyền", message: "Chỉ quản trị được mở lại hoá đơn đã duyệt." });
      return;
    }
    if (inv.status !== "APPROVED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Chỉ hóa đơn ĐÃ DUYỆT mới cần điều chỉnh." });
      return;
    }
    setReopenTarget(inv); // -> hộp nhập mật khẩu cấp 2 (bên dưới)
  };

  const openPayModal = (inv: InvoiceListItem) => {
    if (!(isAdmin || isAccountant)) {
      toast.push({ type: "warning", title: "Không có quyền", message: "Chỉ quản trị / kế toán được thu / trả tiền hoá đơn." });
      return;
    }

    if (inv.status !== "APPROVED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Hoá đơn cần được duyệt trước khi thu / trả tiền." });
      return;
    }

    if (isFullyReturned(inv)) {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Khách đã trả lại toàn bộ hàng, hoá đơn không còn tiền phải thu." });
      return;
    }

    if (!inv.partnerId) {
      toast.push({
        type: "warning",
        title: "Thiếu dữ liệu",
        message: "Hoá đơn chưa gắn khách hàng / nhà cung cấp nên chưa thu, trả tiền được.",
      });
      return;
    }

    const collectibleTotal = getCollectibleTotal(inv);
    const paidNormal = clamp0(inv.paidAmount);

    const { remainingNormal } = calcCollectibleRemaining({ collectibleTotal, paidNormal });

    if (remainingNormal <= 0) {
      toast.push({ type: "info", title: "Không còn nợ", message: "Hoá đơn này đã hết nợ." });
      return;
    }

    setPayTarget(inv);
    setPayAmount(remainingNormal);
    setPayAmountText(formatMoney(remainingNormal));
    // nhớ tài khoản dùng lần trước (nếu vẫn còn hoạt động)
    let lastAcc = "";
    try {
      lastAcc = localStorage.getItem(LS_LAST_PAY_ACCOUNT) || "";
    } catch {}
    setPayAccountId(accounts.some((a) => a.id === lastAcc) ? lastAcc : accounts.length === 1 ? accounts[0].id : "");
    setPayDate(vnTodayYmd());
    setPayNote("");
    setPayOpen(true);
  };

  const submitPayment = async () => {
    if (paySubmitting) return;
    if (!payTarget) return;

    if (!(isAdmin || isAccountant)) {
      toast.push({ type: "warning", title: "Không có quyền", message: "Chỉ quản trị / kế toán được thu / trả tiền hoá đơn." });
      return;
    }

    if (payTarget.status !== "APPROVED") {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Hoá đơn cần được duyệt trước khi thu / trả tiền." });
      return;
    }

    if (isFullyReturned(payTarget)) {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Khách đã trả lại toàn bộ hàng, hoá đơn không còn tiền phải thu." });
      return;
    }

    const collectibleTotal = getCollectibleTotal(payTarget);
    const paidNormal = clamp0(payTarget.paidAmount);
    const { remainingNormal } = calcCollectibleRemaining({ collectibleTotal, paidNormal });

    const amount = clamp0(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Nhập số tiền lớn hơn 0." });
      return;
    }
    if (amount > remainingNormal) {
      toast.push({
        type: "warning",
        title: "Không hợp lệ",
        message: `Số tiền (${formatMoney(amount)} đ) nhiều hơn số còn nợ (${formatMoney(remainingNormal)} đ).`,
      });
      return;
    }
    if (!payAccountId) {
      toast.push({ type: "warning", title: "Thiếu dữ liệu", message: "Chọn tài khoản nhận / trả tiền." });
      return;
    }

    try {
      localStorage.setItem(LS_LAST_PAY_ACCOUNT, String(payAccountId));
    } catch {}

    try {
      setPaySubmitting(true);

      const nextPaid = Math.max(0, paidNormal + amount);
      const nextStatus: PaymentStatus = nextPaid + 0.0001 >= collectibleTotal ? "PAID" : "PARTIAL";

      setInvoices((prev) =>
        prev.map((x) => {
          if (String(x.id) !== String(payTarget.id)) return x;
          return { ...x, paidAmount: nextPaid, paymentStatus: nextStatus };
        })
      );
      setDebtRows((prev) =>
        nextStatus === "PAID"
          ? prev.filter((x) => String(x.id) !== String(payTarget.id))
          : prev.map((x) => (String(x.id) === String(payTarget.id) ? { ...x, paidAmount: nextPaid, paymentStatus: nextStatus } : x))
      );

      await api.post("/payments", {
        date: payDate,
        partnerId: String(payTarget.partnerId),
        type: payTarget.type === "PURCHASE" ? "PAYMENT" : "RECEIPT",
        amount,
        accountId: payAccountId,
        // diễn giải: luôn kèm số HĐ để tra ngược từ sổ thu chi
        note: payNote.trim() ? `HĐ ${payTarget.code}: ${payNote.trim()}` : `Thanh toán HĐ ${payTarget.code}`,
        allocations: [{ invoiceId: String(payTarget.id), amount, kind: "NORMAL" }],
      });

      toast.push({ type: "success", title: "Thành công", message: `Đã ${payTarget.type === "PURCHASE" ? "trả" : "thu"} ${formatMoney(amount)} đ cho hoá đơn ${payTarget.code}.` });

      setPayOpen(false);

      const paidId = String(payTarget.id);
      setPayTarget(null);

      setHighlightInvoiceId(paidId);
      setTimeout(() => setHighlightInvoiceId(""), 2800);

      await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
    } catch (e: any) {
      await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
      toast.push({
        type: "error",
        title: "Lỗi",
        message: e?.response?.data?.message || e?.message || "Không lưu được, thử lại.",
      });
    } finally {
      setPaySubmitting(false);
    }
  };

  const renderPaymentBadge = (inv: InvoiceListItem) => {
    if (isFullyReturned(inv)) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap bg-gray-100 text-gray-700 border-gray-200">
          Đã trả hàng (Toàn bộ)
        </span>
      );
    }

    const st = resolvePaymentStatus(inv);
    let label = "";
    let className = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ";

    if (st === "PAID") {
      label = "Đã thanh toán";
      className += "bg-green-100 text-green-700 border-green-200";
    } else if (st === "PARTIAL") {
      label = "Thanh toán một phần";
      className += "bg-yellow-100 text-yellow-800 border-yellow-200";
    } else {
      label = "Chưa thanh toán";
      className += "bg-red-100 text-red-700 border-red-200";
    }
    return <span className={className}>{label}</span>;
  };

  const renderStatusBadge = (status?: InvoiceStatus, inv?: InvoiceListItem) => {
    const st: InvoiceStatus = status || "DRAFT";
    let label = "";
    let cls = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ";

    // ✅ nháp bị kế toán / quản trị trả về -> nhân viên sửa rồi gửi lại
    if (st === "DRAFT" && inv?.rejectInfo) {
      const r = inv.rejectInfo;
      return (
        <span
          className={cls + "bg-red-50 text-red-700 border-red-200 cursor-help"}
          title={`Bị trả về${r.by ? ` bởi ${r.by}` : ""}${r.reason ? `: ${r.reason}` : ""}. Sửa rồi gửi duyệt lại.`}
        >
          Bị trả về
        </span>
      );
    }

    if (st === "DRAFT") {
      label = "Nháp";
      cls += "bg-gray-100 text-gray-700 border-gray-200";
    } else if (st === "SUBMITTED") {
      label = "Chờ duyệt";
      cls += "bg-orange-100 text-orange-700 border-orange-200";
    } else if (st === "APPROVED") {
      label = "Đã duyệt";
      cls += "bg-green-100 text-green-700 border-green-200";
    } else {
      label = "Từ chối";
      cls += "bg-red-100 text-red-700 border-red-200";
    }
    return <span className={cls}>{label}</span>;
  };

  const renderReturnBadge = (inv: InvoiceListItem) => {
    if (inv.type !== "SALES") return null;

    if (isFullyReturned(inv)) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap bg-purple-100 text-purple-700 border-purple-200">
          Trả hàng toàn bộ
        </span>
      );
    }

    if (isPartialReturned(inv)) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap bg-purple-50 text-purple-700 border-purple-200">
          Trả hàng 1 phần
        </span>
      );
    }

    return null;
  };

  // ✅ nhân viên / kế toán: chỉ xoá nháp (server kiểm tra thêm: kế toán chỉ xoá nháp do mình lập); quản trị: mọi HĐ chưa duyệt
  const canDelete = (inv: InvoiceListItem) => (isStaff || isAccountant ? inv.status === "DRAFT" : inv.status !== "APPROVED");

  // ✅ mobile: bộ lọc thu gọn + đổi nhanh loại hoá đơn
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = (from ? 1 : 0) + (to ? 1 : 0) + (sourceFilter === "ADJUST" ? 1 : 0);
  const applyType = async (t: InvoiceTypeFilter) => {
    setTypeFilter(t);
    const next = { q: search.trim(), from, to, type: t, src: sourceFilter };
    writeQuery(next);
    await runFetchBySource(next);
  };

  /** các cờ dùng chung cho dòng bảng (máy tính) và thẻ (điện thoại) */
  const rowInfo = (inv: InvoiceListItem) => {
    const collectibleTotal = getCollectibleTotal(inv);
    const { remainingNormal } = calcCollectibleRemaining({ collectibleTotal, paidNormal: clamp0(inv.paidAmount) });
    const paySt = resolvePaymentStatus(inv);
    const canPay =
      (isAdmin || isAccountant) &&
      inv.status === "APPROVED" &&
      !isFullyReturned(inv) &&
      (paySt === "UNPAID" || paySt === "PARTIAL") &&
      remainingNormal > 0;
    return {
      grossTotal: clamp0(inv.totalAmount),
      remainingNormal,
      canPay,
      canAdjust: isAdmin && inv.status === "APPROVED",
      showSubmitBtn: isStaff && inv.status === "DRAFT",
      showRecallBtn: isStaff && inv.status === "SUBMITTED",
      showApproveBtn: canApprove && inv.status === "SUBMITTED",
      showRejectBtn: canApprove && inv.status === "SUBMITTED",
    };
  };
  const showApprovalColumn = canApprove;
  const showStaffWorkflowColumns = isStaff;

  const colCount = 7 + (showApprovalColumn ? 1 : 0) + (showStaffWorkflowColumns ? 3 : 0);
  const showRoleWarning = useMemo(() => !role, [role]);

  return (
    <div className="p-4 space-y-4" ref={containerTopRef}>
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />

      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Hóa đơn</h1>
        <button
          type="button"
          onClick={() => navigate("/invoices/new")}
          className="md:hidden rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Thêm
        </button>
      </div>

      <div className="bg-white shadow-sm rounded-md p-3 md:p-4">
        <form onSubmit={handleApplyFilter} className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Tìm theo số HĐ / tên khách hàng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={() => navigate("/invoices/new")}
              className="hidden md:inline-flex items-center justify-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
            >
              + Thêm hóa đơn
            </button>
          </div>

          {/* ✅ mobile: đổi nhanh loại + mở bộ lọc */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="inline-flex flex-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Loại hoá đơn">
              {([["SALES", "Bán"], ["PURCHASE", "Nhập"], ["", "Tất cả"]] as Array<[InvoiceTypeFilter, string]>).map(([v, l]) => (
                <button
                  key={l}
                  type="button"
                  disabled={sourceFilter === "ADJUST"}
                  onClick={() => applyType(v)}
                  className={`!min-h-[36px] flex-1 rounded-md px-2 text-sm font-medium ${
                    typeFilter === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  } disabled:opacity-50`}
                >
                  {l}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className={`!min-h-[40px] shrink-0 rounded-lg border px-3 text-sm font-medium ${
                filtersOpen || activeFilterCount ? "border-slate-800 text-slate-900" : "border-slate-300 text-slate-600"
              }`}
            >
              Bộ lọc{activeFilterCount ? ` (${activeFilterCount})` : ""} {filtersOpen ? "▴" : "▾"}
            </button>
          </div>

          <div className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 items-end gap-3 text-sm md:flex md:flex-wrap`}>
            <div>
              <label className="block text-xs font-semibold mb-1">Từ ngày</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full md:w-auto border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Đến ngày</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full md:w-auto border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* ✅ NEW: nguồn dữ liệu */}
            <div>
              <label className="block text-xs font-semibold mb-1">Nguồn</label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
                className="w-full md:w-auto border border-gray-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="INVOICE">Hóa đơn</option>
                <option value="ADJUST">Chứng từ điều chỉnh</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Loại</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as InvoiceTypeFilter)}
                disabled={sourceFilter === "ADJUST"} // điều chỉnh không có sales/purchase
                className={
                  "w-full md:w-auto border border-gray-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 " +
                  (sourceFilter === "ADJUST" ? "opacity-60 cursor-not-allowed" : "")
                }
              >
                <option value="">Tất cả</option>
                <option value="SALES">Hóa đơn bán</option>
                <option value="PURCHASE">Hóa đơn nhập</option>
              </select>
            </div>

            <div className="col-span-2 flex gap-2">
              <button
                type="submit"
                className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-60"
                disabled={loading}
              >
                Áp dụng
              </button>
              <button
                type="button"
                onClick={handleClearFilter}
                className="px-3 py-1 rounded-md border border-gray-300 text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Xóa lọc
              </button>
            </div>

            {loading && <span className="text-xs text-gray-500">Đang tải dữ liệu...</span>}
          </div>
        </form>

        {/* ✅ Tab: tất cả / chưa thu đủ */}
        {sourceFilter === "INVOICE" && (
          <div className="mt-3 md:mt-4 flex flex-wrap items-end justify-between gap-2 md:gap-3">
            <div className="flex w-full md:inline-flex md:w-auto rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Xem hoá đơn">
              <button
                type="button"
                role="tab"
                aria-selected={!isDebtView}
                onClick={() => switchView("all")}
                className={`flex-1 md:flex-none rounded-md px-3 py-1.5 text-sm font-medium ${!isDebtView ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                Tất cả hoá đơn
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isDebtView}
                onClick={() => switchView("debt")}
                className={`flex-1 md:flex-none inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${isDebtView ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                Chưa {debtWord} đủ
                <span
                  className={`min-w-[22px] rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${
                    debtSummary.count ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {debtLoading && !debtRows.length ? "…" : debtSummary.count}
                </span>
              </button>
            </div>
            {isDebtView && (
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                <span className="text-slate-600">
                  Còn phải {debtWord}: <b className="tabular-nums text-rose-700">{formatMoney(debtSummary.total)} đ</b>
                </span>
                {debtSummary.over30 > 0 && (
                  <span className="text-slate-600">
                    Quá 30 ngày:{" "}
                    <b className="tabular-nums text-amber-700">
                      {debtSummary.over30} HĐ, {formatMoney(debtSummary.over30Amt)} đ
                    </b>
                  </span>
                )}
                <span className="hidden md:inline text-xs text-slate-400">Không theo khoảng ngày lọc, hoá đơn cũ nhất ở trên</span>
              </div>
            )}
          </div>
        )}

        {/* ✅ Sticky header + scroll container (mobile cũng mượt) */}
        {/* ✅ MOBILE: danh sách thẻ, bấm thẻ để mở hoá đơn */}
        <div className="mt-3 space-y-2 md:hidden">
          {loading && <div className="py-6 text-center text-sm text-slate-500">Đang tải…</div>}
          {!loading && rowsShown.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-500">
              {isDebtView ? `Không còn hoá đơn nào chưa ${debtWord} đủ.` : "Không tìm thấy hoá đơn."}
            </div>
          )}
          {!loading &&
            rowsShown.map((inv) => {
              const f = rowInfo(inv);
              const dd = daysSince(inv.date);
              const hi = highlightInvoiceId && String(inv.id) === String(highlightInvoiceId);
              const stop = (e: React.MouseEvent) => e.stopPropagation();
              return (
                <article
                  key={inv.id}
                  id={`inv-card-${String(inv.id)}`}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  className={`rounded-xl border bg-white p-3 active:bg-slate-50 ${hi ? "border-indigo-400 ring-2 ring-indigo-200" : "border-slate-200"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{inv.code}</span>
                        {renderReturnBadge(inv)}
                      </div>
                      <div className="truncate text-sm text-slate-700">{inv.partnerName || "—"}</div>
                    </div>
                    <div className="shrink-0">{renderStatusBadge(inv.status, inv)}</div>
                  </div>

                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      <div className="tabular-nums">{formatDateDisplay(inv.date)}</div>
                      {isDebtView && (
                        <div className={`tabular-nums ${dd > 60 ? "font-semibold text-rose-700" : dd > 30 ? "font-medium text-amber-700" : ""}`}>
                          {dd === 0 ? "hôm nay" : `${dd} ngày trước`}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular-nums text-slate-900">{formatMoney(f.grossTotal)} đ</div>
                      {(isDebtView || (f.canPay && f.remainingNormal < f.grossTotal)) && (
                        <div className="text-xs font-semibold tabular-nums text-rose-700">còn {formatMoney(f.remainingNormal)} đ</div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2" onClick={stop}>
                    <div className="mr-auto">{renderPaymentBadge(inv)}</div>
                    {f.canPay && (
                      <button
                        type="button"
                        onClick={() => openPayModal(inv)}
                        className={`!min-h-[36px] rounded-lg px-3 text-sm font-semibold ring-1 ${
                          inv.type === "PURCHASE" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-teal-50 text-teal-700 ring-teal-200"
                        }`}
                      >
                        {inv.type === "PURCHASE" ? "Trả tiền" : "Thu tiền"}
                      </button>
                    )}
                    {f.showApproveBtn && (
                      <button type="button" onClick={() => handleApprove(inv)} className="!min-h-[36px] rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white">
                        Duyệt
                      </button>
                    )}
                    {f.showRejectBtn && (
                      <button type="button" onClick={() => handleReject(inv)} className="!min-h-[36px] rounded-lg px-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200">
                        Từ chối
                      </button>
                    )}
                    {f.showSubmitBtn && (
                      <button type="button" onClick={() => handleSubmit(inv)} className="!min-h-[36px] rounded-lg bg-orange-600 px-3 text-sm font-semibold text-white">
                        Gửi duyệt
                      </button>
                    )}
                    {f.showRecallBtn && (
                      <button type="button" onClick={() => handleRecall(inv)} className="!min-h-[36px] rounded-lg px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300">
                        Rút lại
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => window.open(`/invoices/${inv.id}/print`, "_blank", "noopener,noreferrer")}
                      className={ACT_BTN + " !min-h-[36px] !h-9 !w-9"}
                      aria-label="In hoá đơn"
                    >
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                        <path d="M7 9V3.5h10V9" strokeLinejoin="round" />
                        <rect x="3" y="9" width="18" height="8" rx="2" />
                        <path d="M7 14h10v6.5H7z" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {f.canAdjust && (
                      <button type="button" onClick={() => handleAdjustApproved(inv)} className={ACT_BTN + " !min-h-[36px] !h-9 !w-9"} aria-label="Điều chỉnh hoá đơn">
                        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" strokeLinecap="round" />
                          <circle cx="15" cy="7" r="2" />
                          <circle cx="9" cy="17" r="2" />
                        </svg>
                      </button>
                    )}
                    {canDelete(inv) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(inv)}
                        className={ACT_BTN + " !min-h-[36px] !h-9 !w-9 enabled:hover:bg-rose-50 enabled:hover:text-rose-600"}
                        aria-label="Xoá hoá đơn"
                      >
                        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
        </div>

        <div className={`hidden md:block ${sourceFilter === "INVOICE" ? "mt-2" : "mt-4"} border border-gray-200 rounded-md overflow-hidden`}>
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full table-fixed text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[130px]">
                    Số HĐ
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[104px]">
                    Ngày
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100">
                    Khách hàng
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[124px]">
                    Tổng tiền
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[140px]">
                    Thanh toán
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[100px]">
                    Trạng thái
                  </th>

                  {showStaffWorkflowColumns && (
                    <>
                      <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100">
                        Xem
                      </th>
                      <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100">
                        Gửi duyệt
                      </th>
                      <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100">
                        Hủy gửi
                      </th>
                    </>
                  )}

                  {showApprovalColumn && (
                    <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[150px]">
                      Duyệt
                    </th>
                  )}

                  <th className="px-3 py-2 text-right text-xs font-semibold border-b border-gray-200 sticky top-0 z-10 bg-gray-100 w-[212px]">
                    Thao tác
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td className="px-3 py-2 text-sm text-gray-600 border-t border-gray-200" colSpan={colCount}>
                      Đang tải dữ liệu...
                    </td>
                  </tr>
                )}

                {!loading && rowsShown.length === 0 && (
                  <tr>
                    <td className="px-3 py-2 text-sm text-gray-600 border-t border-gray-200" colSpan={colCount}>
                      {isDebtView ? `Không còn hoá đơn nào chưa ${debtWord} đủ.` : "Không tìm thấy dữ liệu."}
                    </td>
                  </tr>
                )}

                {!loading &&
                  rowsShown.map((inv) => {
                    const showSubmitBtn = isStaff && inv.status === "DRAFT";
                    const showRecallBtn = isStaff && inv.status === "SUBMITTED";

                    const showApproveBtn = canApprove && inv.status === "SUBMITTED";
                    const showRejectBtn = canApprove && inv.status === "SUBMITTED";

                    const grossTotal = clamp0(inv.totalAmount);

                    const collectibleTotal = getCollectibleTotal(inv);
                    const paidNormal = clamp0(inv.paidAmount);
                    const { remainingNormal } = calcCollectibleRemaining({ collectibleTotal, paidNormal });

                    const paySt = resolvePaymentStatus(inv);

                    const canPayBase =
                      inv.status === "APPROVED" &&
                      !isFullyReturned(inv) &&
                      (paySt === "UNPAID" || paySt === "PARTIAL") &&
                      remainingNormal > 0;

                    const canPay = (isAdmin || isAccountant) && canPayBase; // ✅ kế toán được ghi tiền

                    const isHighlighted = highlightInvoiceId && String(inv.id) === String(highlightInvoiceId);
                    const returnedBadge = renderReturnBadge(inv);

                    const canAdjust = isAdmin && inv.status === "APPROVED"; // ✅ chỉ quản trị + mật khẩu cấp 2

                    return (
                      <tr
                        key={inv.id}
                        id={`inv-row-${String(inv.id)}`}
                        className={
                          "odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition-colors " +
                          (isHighlighted ? "ring-2 ring-indigo-500 bg-indigo-50" : "")
                        }
                      >
                        <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="truncate font-medium">{inv.code}</div>
                            {returnedBadge}
                          </div>
                        </td>

                        <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">
                          {formatDateDisplay(inv.date)}
                          {isDebtView && (() => {
                            const dd = daysSince(inv.date);
                            return (
                              <div
                                className={`text-xs tabular-nums ${dd > 60 ? "font-semibold text-rose-700" : dd > 30 ? "font-medium text-amber-700" : "text-slate-500"}`}
                              >
                                {dd === 0 ? "hôm nay" : `${dd} ngày trước`}
                              </div>
                            );
                          })()}
                        </td>

                        <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap truncate">{inv.partnerName}</td>

                        <td className="px-3 py-2 border-t border-gray-200 text-right whitespace-nowrap">
                          <div className="flex flex-col items-end leading-tight gap-0.5">
                            <div className="font-medium">{formatMoney(grossTotal)} đ</div>
                            {isDebtView && (
                              <div className="text-xs font-semibold tabular-nums text-rose-700">còn {formatMoney(remainingNormal)} đ</div>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2 border-t border-gray-200 text-center">{renderPaymentBadge(inv)}</td>
                        <td className="px-3 py-2 border-t border-gray-200 text-center">{renderStatusBadge(inv.status, inv)}</td>

                        {showStaffWorkflowColumns && (
                          <>
                            <td className="px-3 py-2 border-t border-gray-200 text-center">
                              <button
                                type="button"
                                className="px-2 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs"
                                onClick={() => navigate(`/invoices/${inv.id}`)}
                              >
                                Xem
                              </button>
                            </td>

                            <td className="px-3 py-2 border-t border-gray-200 text-center">
                              <button
                                type="button"
                                disabled={!showSubmitBtn}
                                className={
                                  "px-2 py-1 rounded-md text-xs font-medium " +
                                  (showSubmitBtn
                                    ? "bg-orange-600 text-white hover:bg-orange-700"
                                    : "bg-gray-200 text-gray-400 cursor-not-allowed")
                                }
                                onClick={() => handleSubmit(inv)}
                              >
                                Gửi
                              </button>
                            </td>

                            <td className="px-3 py-2 border-t border-gray-200 text-center">
                              <button
                                type="button"
                                disabled={!showRecallBtn}
                                className={
                                  "px-2 py-1 rounded-md text-xs font-medium " +
                                  (showRecallBtn
                                    ? "bg-gray-700 text-white hover:bg-gray-800"
                                    : "bg-gray-200 text-gray-400 cursor-not-allowed")
                                }
                                onClick={() => handleRecall(inv)}
                              >
                                Hủy
                              </button>
                            </td>
                          </>
                        )}

                        {showApprovalColumn && (
                          <td className="px-3 py-2 border-t border-gray-200 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
                                onClick={() => navigate(`/invoices/${inv.id}`)}
                              >
                                Xem
                              </button>
                              {showApproveBtn && (
                                <button
                                  type="button"
                                  className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                  onClick={() => handleApprove(inv)}
                                >
                                  Duyệt
                                </button>
                              )}
                              {showRejectBtn && (
                                <button
                                  type="button"
                                  className="rounded-lg px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
                                  onClick={() => handleReject(inv)}
                                >
                                  Từ chối
                                </button>
                              )}
                            </div>
                          </td>
                        )}

                        <td className="px-3 py-2 border-t border-gray-200">
                          <div className="flex items-center justify-end gap-0.5">
                            {/* thu / trả tiền: nút chính, cố định chỗ để các icon thẳng hàng */}
                            <div className="mr-1 flex w-[88px] justify-end">
                              {canPay ? (
                                <button
                                  type="button"
                                  onClick={() => openPayModal(inv)}
                                  title={`${inv.type === "PURCHASE" ? "Còn phải trả" : "Còn phải thu"}: ${formatMoney(remainingNormal)} đ`}
                                  className={
                                    "inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition-colors " +
                                    (inv.type === "PURCHASE"
                                      ? "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100"
                                      : "bg-teal-50 text-teal-700 ring-teal-200 hover:bg-teal-100")
                                  }
                                >
                                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                    <rect x="2.5" y="6" width="19" height="12" rx="2" />
                                    <circle cx="12" cy="12" r="2.4" />
                                  </svg>
                                  {inv.type === "PURCHASE" ? "Trả tiền" : "Thu tiền"}
                                </button>
                              ) : null}
                            </div>

                            <button
                              type="button"
                              className={ACT_BTN}
                              onClick={() => window.open(`/invoices/${inv.id}/print`, "_blank", "noopener,noreferrer")}
                              title="In hoá đơn"
                              aria-label="In hoá đơn"
                            >
                              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                                <path d="M7 9V3.5h10V9" strokeLinejoin="round" />
                                <rect x="3" y="9" width="18" height="8" rx="2" />
                                <path d="M7 14h10v6.5H7z" strokeLinejoin="round" />
                              </svg>
                            </button>

                            {inv.status === "DRAFT" ? (
                              <button
                                type="button"
                                className={ACT_BTN}
                                onClick={() => navigate(`/invoices/${inv.id}`)}
                                title="Sửa hoá đơn nháp"
                                aria-label="Sửa hoá đơn"
                              >
                                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                                  <path d="M4 20h4L19 9l-4-4L4 16v4z" strokeLinejoin="round" />
                                  <path d="M13.5 6.5l4 4" />
                                </svg>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={ACT_BTN}
                                disabled={!canAdjust}
                                onClick={() => handleAdjustApproved(inv)}
                                title={
                                  canAdjust
                                    ? "Điều chỉnh: mở lại hoá đơn đã duyệt để sửa"
                                    : !isAdmin
                                    ? "Chỉ quản trị được điều chỉnh hoá đơn đã duyệt"
                                    : "Chỉ điều chỉnh được hoá đơn đã duyệt"
                                }
                                aria-label="Điều chỉnh hoá đơn"
                              >
                                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                                  <path d="M4 7h9M17 7h3M4 17h3M11 17h9" strokeLinecap="round" />
                                  <circle cx="15" cy="7" r="2" />
                                  <circle cx="9" cy="17" r="2" />
                                </svg>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={!canDelete(inv)}
                              className={ACT_BTN + " enabled:hover:bg-rose-50 enabled:hover:text-rose-600"}
                              onClick={() => handleDelete(inv)}
                              title={canDelete(inv) ? "Xoá hoá đơn" : "Hoá đơn đã duyệt, không xoá được"}
                              aria-label="Xoá hoá đơn"
                            >
                              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {showRoleWarning && (
          <div className="mt-3 text-xs text-orange-600">
            Không đọc được role từ /auth/me. Kiểm tra response /api/auth/me có field role ở đâu (data.role hay role).
          </div>
        )}
      </div>

      {/* Confirm modal */}
      <Modal
        open={confirmOpen}
        title={confirmTitle}
        onClose={() => {
          if (confirmLoading) return;
          setConfirmOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm"
              onClick={() => setConfirmOpen(false)}
              disabled={confirmLoading}
            >
              Hủy
            </button>
            <button
              type="button"
              className={
                "px-3 py-2 rounded-md text-sm font-semibold " +
                (confirmLoading ? "bg-gray-300 text-gray-600" : "bg-blue-600 text-white hover:bg-blue-700")
              }
              onClick={async () => {
                if (!confirmAction) return;
                try {
                  setConfirmLoading(true);
                  await confirmAction();
                  setConfirmOpen(false);
                } catch (e: any) {
                  toast.push({
                    type: "error",
                    title: "Lỗi",
                    message: e?.response?.data?.message || e?.message || "Thao tác thất bại.",
                  });
                } finally {
                  setConfirmLoading(false);
                }
              }}
              disabled={confirmLoading}
            >
              Xác nhận
            </button>
          </div>
        }
      >
        {confirmMessage}
      </Modal>

      {/* Reject modal */}
      <Modal
        open={rejectOpen}
        title="Từ chối, trả về nháp"
        onClose={() => {
          if (rejectLoading) return;
          setRejectOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm"
              onClick={() => setRejectOpen(false)}
              disabled={rejectLoading}
            >
              Hủy
            </button>
            <button
              type="button"
              className={
                "px-3 py-2 rounded-md text-sm font-semibold " +
                (rejectLoading ? "bg-gray-300 text-gray-600" : "bg-red-600 text-white hover:bg-red-700")
              }
              onClick={async () => {
                if (!rejectTarget?.id) return;
                try {
                  setRejectLoading(true);
                  await api.post(`/invoices/${rejectTarget.id}/reject`, {
                    reason: rejectReason.trim() || undefined,
                  });
                  toast.push({
                    type: "success",
                    title: "Đã trả về",
                    message: `Hóa đơn ${rejectTarget.code} đã trả về nháp cho nhân viên sửa.`,
                  });
                  setRejectOpen(false);
                  await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
                } catch (e: any) {
                  toast.push({
                    type: "error",
                    title: "Lỗi",
                    message: e?.response?.data?.message || e?.message || "Từ chối thất bại.",
                  });
                } finally {
                  setRejectLoading(false);
                }
              }}
              disabled={rejectLoading}
            >
              Từ chối
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-gray-700">
            Hóa đơn <b>{rejectTarget?.code}</b> sẽ <b>trả về nháp</b> để nhân viên sửa rồi gửi duyệt lại. Ghi lý do để nhân viên biết cần sửa gì:
          </div>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            rows={3}
            placeholder="Ví dụ: Sai giá, sai số lượng..."
          />
        </div>
      </Modal>

      {/* Mở lại hoá đơn đã duyệt: chỉ quản trị + mật khẩu cấp 2 */}
      <PinActionDialog
        open={!!reopenTarget}
        tone="danger"
        title={`Điều chỉnh hoá đơn ${reopenTarget?.code ?? ""}`}
        subtitle="Hoá đơn về lại Nháp để sửa, tồn kho của hoá đơn được hoàn lại cho tới khi duyệt lại."
        confirmLabel="Mở lại để sửa"
        busyLabel="Đang mở lại…"
        onClose={() => setReopenTarget(null)}
        onSubmit={async (pin) => {
          const inv = reopenTarget!;
          await api.post(`/invoices/${inv.id}/reopen`, { pin });
          setReopenTarget(null);
          toast.push({ type: "success", title: "Đã mở lại", message: `Hóa đơn ${inv.code} đã mở lại để sửa.` });
          await runFetchBySource({ q: search.trim(), from, to, type: typeFilter, src: sourceFilter });
          navigate(`/invoices/${inv.id}`, { state: { adminEditApproved: true } });
        }}
      >
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div>
            Hoá đơn <b>{reopenTarget?.code}</b>, {reopenTarget?.partnerName}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Server tự kiểm tra khoá kỳ và giới hạn 90 ngày.</div>
        </div>
      </PinActionDialog>

      {/* Payment dialog */}
      {payTarget ? (
        <InvoicePayDialog
          open={payOpen}
          submitting={paySubmitting}
          isPurchase={payTarget.type === "PURCHASE"}
          invoiceCode={payTarget.code}
          partnerName={payTarget.partnerName}
          invoiceDate={payTarget.date}
          total={clamp0(payTarget.totalAmount)}
          returned={payTarget.type === "SALES" ? getReturnedTotal(payTarget) : 0}
          hold={getHoldAmount(payTarget)}
          paid={clamp0(payTarget.paidAmount)}
          remaining={
            calcCollectibleRemaining({
              collectibleTotal: getCollectibleTotal(payTarget),
              paidNormal: clamp0(payTarget.paidAmount),
            }).remainingNormal
          }
          accounts={accounts}
          accountsLoading={accountsLoading}
          accountId={payAccountId}
          onAccountChange={(v) => {
            setPayAccountId(v);
            try {
              localStorage.setItem(LS_LAST_PAY_ACCOUNT, String(v));
            } catch {}
          }}
          date={payDate}
          onDateChange={setPayDate}
          note={payNote}
          onNoteChange={setPayNote}
          amount={payAmount}
          amountText={payAmountText}
          onAmountText={(raw) => {
            const n = parseMoneyInputToNumber(raw);
            setPayAmount(n);
            setPayAmountText(raw.trim() === "" ? "" : formatMoney(n));
          }}
          onSetAmount={(n) => {
            setPayAmount(n);
            setPayAmountText(formatMoney(n));
          }}
          amountInputRef={payAmountInputRef}
          onClose={() => {
            if (paySubmitting) return;
            setPayOpen(false);
          }}
          onSubmit={submitPayment}
        />
      ) : null}
    </div>
  );
};

export default InvoicesPage;
