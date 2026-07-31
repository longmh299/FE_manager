// src/pages/SalesLedgerReportPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import { saveAs } from "file-saver";

type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "";

type StaffUser = {
  id: string;
  username?: string | null;
  fullName?: string | null;
  name?: string | null;
  role?: string | null;
};

type SalesLedgerRow = {
  invoiceId: string;

  issueDate: string; // yyyy-mm-dd
  code: string;
  partnerName: string;

  itemName: string;
  itemSku?: string | null;

  qty: number;
  unitPrice: number;
  unitCost: number;

  // ✅ NEW (BE trả unitCostMonthAvg/costTotalMonthAvg)
  unitCostMonthAvg: number;
  costTotalMonthAvg: number;

  // (giữ tương thích nếu BE cũ trả unitCostPeriodAvg)
  unitCostPeriodAvg?: number;

  costTotal: number;
  lineAmount: number;

  paid: number;
  debt: number;

  saleUserName: string;
  techUserName: string;
};

type Totals = {
  totalRevenue: number;
  totalCost: number;
  totalPaid: number;
  totalDebt: number;
};

type ReportData = {
  rows: SalesLedgerRow[];
  totals: Totals;
};

type InvoiceDetail = {
  id: string;
  code?: string | null;
  issueDate?: string | null;

  partnerName?: string | null;
  partnerPhone?: string | null;

  saleUserName?: string | null;
  techUserName?: string | null;
  saleUser?: any;
  techUser?: any;

  status?: string | null;
  paymentStatus?: string | null;

  subtotal?: any;
  tax?: any;
  total?: any;

  netSubtotal?: any;
  netTax?: any;
  netTotal?: any;

  paidAmount?: any;

  note?: string | null;

  lines?: any[];
};

type ReturnAggByItem = { qty: number; amount: number };
type ReturnAgg = {
  byItemId: Record<string, ReturnAggByItem>;
  totalQty: number;
  totalAmount: number;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function safeNum(v: any) {
  const n = typeof v === "number" ? v : Number(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtMoney(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " đ";
}
function fmtQty(n: number) {
  if (!Number.isFinite(n)) return "0";
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? String(Math.round(n)) : n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}
function fmtDateDMY(dateStr?: string | null) {
  if (!dateStr) return "";
  const s = String(dateStr).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function pickName(u: any) {
  return u?.fullName || u?.name || u?.username || u?.email || u?.id || "";
}

function viInvoiceStatus(s?: string | null) {
  const v = (s || "").toUpperCase();
  if (v === "DRAFT") return "Nháp";
  if (v === "SUBMITTED") return "Chờ duyệt";
  if (v === "APPROVED") return "Đã duyệt";
  if (v === "REJECTED") return "Từ chối";
  return s || "-";
}
function viPaymentStatus(s?: string | null) {
  const v = (s || "").toUpperCase();
  if (v === "UNPAID") return "Chưa thanh toán";
  if (v === "PARTIAL") return "Thanh toán một phần";
  if (v === "PAID") return "Đã thanh toán";
  return s || "-";
}

const PAGE_SIZE = 20;

type LoadOpts = { silent?: boolean };

// ===== helpers for staff list / fallback filtering =====
function isNameId(v: string) {
  return typeof v === "string" && v.startsWith("name:");
}
function nameFromId(v: string) {
  return isNameId(v) ? v.slice("name:".length) : "";
}
function normName(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function computeTotalsFromRows(rr: SalesLedgerRow[]): Totals {
  let totalRevenue = 0;
  let totalCost = 0;
  let totalPaid = 0;
  let totalDebt = 0;
  for (const r of rr) {
    totalRevenue += safeNum(r.lineAmount);
    totalCost += safeNum(r.costTotal);
    totalPaid += safeNum(r.paid);
    totalDebt += safeNum(r.debt);
  }
  return { totalRevenue, totalCost, totalPaid, totalDebt };
}

function extractUserList(payload: any): StaffUser[] {
  // payload đã là res.data.data ?? res.data
  const candidates = [
    payload,
    payload?.rows,
    payload?.users,
    payload?.items,
    payload?.data,
    payload?.data?.rows,
    payload?.data?.users,
    payload?.data?.items,
    payload?.data?.data,
    payload?.result,
    payload?.result?.rows,
    payload?.result?.users,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c as StaffUser[];
  }
  return [];
}

const SalesLedgerReportPage: React.FC = () => {
  const { toasts, push, remove } = useToast();

  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  }, [push]);

  const [from, setFrom] = useState(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return toDateInputValue(first);
  });
  const [to, setTo] = useState(() => toDateInputValue(new Date()));
  const [q, setQ] = useState("");

  const [saleUserId, setSaleUserId] = useState<string>("");
  const [techUserId, setTechUserId] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("");

  const [staffs, setStaffs] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData>({
    rows: [],
    totals: { totalRevenue: 0, totalCost: 0, totalPaid: 0, totalDebt: 0 },
  });

  const [page, setPage] = useState(1);

  // ===== Invoice detail modal =====
  const [openInv, setOpenInv] = useState(false);
  const [invId, setInvId] = useState<string>("");
  const [invLoading, setInvLoading] = useState(false);
  const [inv, setInv] = useState<InvoiceDetail | null>(null);

  // ✅ returns info
  const [retLoading, setRetLoading] = useState(false);
  const [retAgg, setRetAgg] = useState<ReturnAgg | null>(null);

  // ✅ load staffs robustly (nhiều dự án /users trả shape khác nhau hoặc paginate)
  useEffect(() => {
    (async () => {
      const urls = ["/users", "/users?take=200", "/users?limit=200", "/users/all", "/users/list"];

      for (const url of urls) {
        try {
          const res = await api.get(url);
          const payload = res?.data?.data ?? res?.data;

          const list = extractUserList(payload);
          if (!Array.isArray(list) || list.length === 0) continue;

          // normalize + dedupe by id
          const map = new Map<string, StaffUser>();
          for (const u of list) {
            const id = String((u as any)?.id ?? "").trim();
            if (!id) continue;
            map.set(id, { ...(u as any), id });
          }
          const arr = Array.from(map.values());

          if (arr.length > 0) {
            setStaffs(arr);
            return;
          }
        } catch {
          // next url
        }
      }

      // nếu fail thì vẫn dùng fallback từ rows (staffOptions bên dưới)
      // nhưng báo nhẹ để user biết vì sao dropdown có thể không đủ nhân sự
      pushRef.current({
        type: "warning",
        title: "Không tải được danh sách NV",
        message: "Không lấy được danh sách nhân sự từ API /users. Dropdown sẽ lấy tạm theo dữ liệu đang hiển thị.",
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = data.rows || [];

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), [rows.length]);
  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  useEffect(() => setPage(1), [from, to, q, saleUserId, techUserId, paymentStatus]);

  async function load(opts?: LoadOpts) {
    try {
      setLoading(true);

      const saleNameFilter = nameFromId(saleUserId);
      const techNameFilter = nameFromId(techUserId);

      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q.trim()) params.set("q", q.trim());

      // ✅ nếu chọn theo id thật => gửi saleUserId/techUserId
      // ✅ nếu fallback theo tên (name:xxx) => gửi saleUserName/techUserName (nếu BE có hỗ trợ)
      if (saleUserId && !saleNameFilter) params.set("saleUserId", saleUserId);
      if (techUserId && !techNameFilter) params.set("techUserId", techUserId);
      if (saleNameFilter) params.set("saleUserName", saleNameFilter);
      if (techNameFilter) params.set("techUserName", techNameFilter);

      if (paymentStatus) params.set("paymentStatus", paymentStatus);

      const res = await api.get(`/reports/sales-ledger?${params.toString()}`);
      const payload = res?.data?.data ?? res?.data;

      const rawRows = payload?.rows ?? payload?.data?.rows ?? [];
      const rawTotals = payload?.totals ?? payload?.data?.totals ?? {};

      const normalizedRowsAll: SalesLedgerRow[] = (rawRows as any[]).map((r: any) => {
        // ✅ lấy field mới từ BE, fallback field cũ nếu có
        const unitCostMonthAvg = safeNum(
          r.unitCostMonthAvg ?? r.unitCostPeriodAvg ?? r.unitCostMonth ?? r.unitCostAvg ?? 0
        );
        const qty = safeNum(r.qty);
        const costTotalMonthAvg = safeNum(r.costTotalMonthAvg) || qty * unitCostMonthAvg;

        return {
          invoiceId: String(r.invoiceId ?? r.invoiceID ?? ""),
          issueDate: String(r.issueDate ?? "").slice(0, 10),
          code: String(r.code ?? ""),
          partnerName: String(r.partnerName ?? ""),

          itemName: String(r.itemName ?? ""),
          itemSku: r.itemSku ?? null,

          qty,
          unitPrice: safeNum(r.unitPrice),
          unitCost: safeNum(r.unitCost),

          unitCostMonthAvg,
          costTotalMonthAvg,

          // giữ tương thích
          unitCostPeriodAvg: safeNum(r.unitCostPeriodAvg),

          costTotal: safeNum(r.costTotal),
          lineAmount: safeNum(r.lineAmount),

          paid: safeNum(r.paid),
          debt: safeNum(r.debt),

          saleUserName: String(r.saleUserName ?? ""),
          techUserName: String(r.techUserName ?? ""),
        };
      });

      // ✅ fallback lọc theo tên ở FE (để trường hợp không tải được /users vẫn lọc được)
      const saleNeedFilter = !!saleNameFilter;
      const techNeedFilter = !!techNameFilter;
      let normalizedRows = normalizedRowsAll;

      if (saleNeedFilter) {
        const target = normName(saleNameFilter);
        normalizedRows = normalizedRows.filter((r) => normName(r.saleUserName) === target);
      }
      if (techNeedFilter) {
        const target = normName(techNameFilter);
        normalizedRows = normalizedRows.filter((r) => normName(r.techUserName) === target);
      }

      let normalizedTotals: Totals = {
        totalRevenue: safeNum(rawTotals.totalRevenue),
        totalCost: safeNum(rawTotals.totalCost),
        totalPaid: safeNum(rawTotals.totalPaid),
        totalDebt: safeNum(rawTotals.totalDebt),
      };

      // nếu BE không trả totals hoặc đang lọc client-side theo tên => tính lại cho đúng KPI
      const totalsLooksEmpty =
        normalizedTotals.totalRevenue === 0 &&
        normalizedTotals.totalCost === 0 &&
        normalizedTotals.totalPaid === 0 &&
        normalizedTotals.totalDebt === 0;

      if (totalsLooksEmpty || saleNeedFilter || techNeedFilter) {
        normalizedTotals = computeTotalsFromRows(normalizedRows);
      }

      setData({ rows: normalizedRows, totals: normalizedTotals });

      // ✅ tránh spam toast khi auto-load (và tránh StrictMode dev show 2 toast)
      if (!opts?.silent) {
        pushRef.current({ type: "success", title: "OK", message: `Đã tải ${normalizedRows.length} dòng.` });
      }
    } catch (e: any) {
      pushRef.current({
        type: "error",
        title: "Lỗi tải báo cáo",
        message: e?.response?.data?.message || e?.message || "Không tải được báo cáo",
      });
    } finally {
      setLoading(false);
    }
  }

  // ✅ chặn StrictMode dev gọi effect 2 lần
  const didInitialLoadRef = useRef(false);
  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;

    // auto-load: silent để khỏi hiện toast (và khỏi bị 2 toast khi reload dev)
    load({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportExcel() {
    try {
      const saleNameFilter = nameFromId(saleUserId);
      const techNameFilter = nameFromId(techUserId);

      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q.trim()) params.set("q", q.trim());

      if (saleUserId && !saleNameFilter) params.set("saleUserId", saleUserId);
      if (techUserId && !techNameFilter) params.set("techUserId", techUserId);
      if (saleNameFilter) params.set("saleUserName", saleNameFilter);
      if (techNameFilter) params.set("techUserName", techNameFilter);

      if (paymentStatus) params.set("paymentStatus", paymentStatus);

      const res = await api.get(`/reports/sales-ledger/excel?${params.toString()}`, {
        responseType: "blob",
      });

      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const now = new Date();
      const fileName = `bang_ke_ban_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.xlsx`;
      saveAs(blob, fileName);

      pushRef.current({ type: "success", title: "OK", message: "Đã export Excel." });
    } catch (e: any) {
      pushRef.current({ type: "error", title: "Lỗi export", message: e?.message || "Export thất bại" });
    }
  }

  function openInvoiceDetail(invoiceId?: string) {
    const id = String(invoiceId || "");
    if (!id) {
      pushRef.current({
        type: "warning",
        title: "Thiếu invoiceId",
        message: "Dòng này không có invoiceId để mở chi tiết.",
      });
      return;
    }
    setInvId(id);
    setInv(null);
    setRetAgg(null);
    setOpenInv(true);
  }

  // ====== load invoice detail ======
  const detailReqSeq = useRef(0);
  useEffect(() => {
    if (!openInv || !invId) return;

    const seq = ++detailReqSeq.current;
    let cancelled = false;

    (async () => {
      try {
        setInvLoading(true);

        const res = await api.get(`/invoices/${invId}`);
        if (cancelled || seq !== detailReqSeq.current) return;

        const payload = res?.data?.data ?? res?.data;
        const invObj: any = payload?.invoice || payload?.data?.invoice || payload?.data || payload;

        const detail: InvoiceDetail = {
          id: String(invObj?.id ?? invId),
          code: invObj?.code ?? null,
          issueDate: invObj?.issueDate ? String(invObj.issueDate).slice(0, 10) : null,

          partnerName: invObj?.partnerName ?? null,
          partnerPhone: invObj?.partnerPhone ?? null,

          saleUserName: invObj?.saleUserName ?? null,
          techUserName: invObj?.techUserName ?? null,
          saleUser: invObj?.saleUser ?? null,
          techUser: invObj?.techUser ?? null,

          status: invObj?.status ?? null,
          paymentStatus: invObj?.paymentStatus ?? null,

          subtotal: invObj?.subtotal,
          tax: invObj?.tax,
          total: invObj?.total,

          netSubtotal: invObj?.netSubtotal,
          netTax: invObj?.netTax,
          netTotal: invObj?.netTotal,

          paidAmount: invObj?.paidAmount,

          note: invObj?.note ?? null,
          lines: Array.isArray(invObj?.lines) ? invObj.lines : [],
        };

        setInv(detail);
      } catch (e: any) {
        if (cancelled || seq !== detailReqSeq.current) return;
        pushRef.current({
          type: "error",
          title: "Lỗi tải chi tiết hóa đơn",
          message: e?.response?.data?.message || e?.message || "Không tải được chi tiết hóa đơn",
        });
        setInv(null);
      } finally {
        if (!cancelled && seq === detailReqSeq.current) setInvLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openInv, invId]);

  // ====== Returns: FIX false positive ======
  function getTypeUpper(obj: any) {
    const t =
      obj?.type ??
      obj?.invoiceType ??
      obj?.data?.type ??
      obj?.invoice?.type ??
      obj?.invoice?.invoiceType ??
      "";
    return String(t || "").toUpperCase();
  }

  function getRefInvoiceId(obj: any) {
    const id =
      obj?.refInvoiceId ??
      obj?.refInvoice?.id ??
      obj?.refInvoice?.invoiceId ??
      obj?.data?.refInvoiceId ??
      "";
    return String(id || "");
  }

  async function tryFetchReturns(refInvoiceId: string): Promise<any[] | null> {
    const candidates = [
      `/invoices?type=SALES_RETURN&refInvoiceId=${encodeURIComponent(refInvoiceId)}&status=APPROVED`,
      `/invoices?refInvoiceId=${encodeURIComponent(refInvoiceId)}&type=SALES_RETURN`,
      `/invoices?type=SALES_RETURN&refInvoiceId=${encodeURIComponent(refInvoiceId)}`,
      `/invoices/returns?refInvoiceId=${encodeURIComponent(refInvoiceId)}`,
      `/invoices/return?refInvoiceId=${encodeURIComponent(refInvoiceId)}`,
    ];

    for (const url of candidates) {
      try {
        const res = await api.get(url);
        const payload = res?.data?.data ?? res?.data;

        const list =
          (Array.isArray(payload) ? payload : null) ||
          payload?.rows ||
          payload?.data?.rows ||
          payload?.invoices ||
          payload?.data?.invoices ||
          payload?.items ||
          payload?.data?.items ||
          null;

        if (!Array.isArray(list)) continue;

        // ✅ CHỈ nhận SALES_RETURN + refInvoiceId đúng
        const filtered = (list as any[]).filter((x) => {
          const t = getTypeUpper(x);
          const ref = getRefInvoiceId(x);
          return t === "SALES_RETURN" && ref === refInvoiceId;
        });

        const hasAnyTyped = (list as any[]).some((x) => !!getTypeUpper(x));
        const hasAnyRef = (list as any[]).some((x) => !!getRefInvoiceId(x));
        if (!hasAnyTyped || !hasAnyRef) continue;

        return filtered;
      } catch {
        // next
      }
    }
    return null;
  }

  const returnReqSeq = useRef(0);
  useEffect(() => {
    if (!openInv || !invId) return;

    const seq = ++returnReqSeq.current;
    let cancelled = false;

    (async () => {
      try {
        setRetLoading(true);
        setRetAgg(null);

        const returns = await tryFetchReturns(invId);
        if (cancelled || seq !== returnReqSeq.current) return;

        if (returns == null || returns.length === 0) {
          setRetAgg(null);
          return;
        }

        const byItemId: Record<string, ReturnAggByItem> = {};
        let totalQty = 0;
        let totalAmount = 0;

        for (const r of returns as any[]) {
          const lines: any[] = Array.isArray(r?.lines) ? r.lines : [];
          for (const l of lines) {
            const itemId = String(l?.itemId || l?.item?.id || "");
            if (!itemId) continue;

            const qtyRaw = safeNum(l?.qty);
            const qty = Math.max(0, Math.abs(qtyRaw));

            const amountRaw = safeNum(l?.amount);
            const price = safeNum(l?.price ?? l?.unitPrice ?? 0);
            const amount = Math.max(0, amountRaw || (qty > 0 ? price * qty : 0));

            const cur = byItemId[itemId] || { qty: 0, amount: 0 };
            cur.qty += qty;
            cur.amount += amount;
            byItemId[itemId] = cur;

            totalQty += qty;
            totalAmount += amount;
          }
        }

        if (totalQty <= 0.0001 && totalAmount <= 0.0001) {
          setRetAgg(null);
          return;
        }

        setRetAgg({
          byItemId,
          totalQty: Math.max(0, totalQty),
          totalAmount: Math.max(0, totalAmount),
        });
      } finally {
        if (!cancelled && seq === returnReqSeq.current) setRetLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openInv, invId]);

  // ✅ staffOptions:
  // - ưu tiên lấy từ /users (id thật)
  // - nếu /users fail/empty => fallback lấy từ rows (id dạng name:xxx) để vẫn lọc được
  const staffOptions = useMemo(() => {
    const arr = staffs || [];

    const fromUsers = arr
      .map((u) => ({
        id: String(u.id),
        label: (u.fullName || u.name || u.username || u.id || "").toString().trim(),
      }))
      .filter((x) => x.id && x.label);

    if (fromUsers.length > 0) {
      // sort theo label cho dễ chọn
      return fromUsers.sort((a, b) => a.label.localeCompare(b.label, "vi"));
    }

    // fallback từ rows
    const names = new Map<string, string>();
    for (const r of rows) {
      const s = String(r.saleUserName || "").trim();
      const t = String(r.techUserName || "").trim();
      if (s) names.set(normName(s), s);
      if (t) names.set(normName(t), t);
    }

    const fallback = Array.from(names.values())
      .filter(Boolean)
      .map((name) => ({ id: `name:${name}`, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));

    return fallback;
  }, [staffs, rows]);

  const kpi = useMemo(() => {
    const revenue = data.totals.totalRevenue || 0;
    const cost = data.totals.totalCost || 0;
    const paid = data.totals.totalPaid || 0;
    const debt = data.totals.totalDebt || 0;
    const qtySum = rows.reduce((s, r) => s + safeNum(r.qty), 0);
    return { revenue, cost, paid, debt, qtySum };
  }, [data.totals, rows]);

  const invSummary = useMemo(() => {
    if (!inv) return null;

    const subtotal = safeNum(inv.netSubtotal ?? inv.subtotal);
    const tax = safeNum(inv.netTax ?? inv.tax);
    const total = safeNum(inv.netTotal ?? inv.total);

    const paid = safeNum(inv.paidAmount);
    const debt = Math.max(0, total - paid);

    const saleName = inv.saleUserName || pickName(inv.saleUser) || "";
    const techName = inv.techUserName || pickName(inv.techUser) || "";

    return { subtotal, tax, total, paid, debt, saleName, techName };
  }, [inv]);

  return (
    <div className="space-y-4">
      <ToastHost toasts={toasts} onClose={remove} />

      {/* Filter */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-lg font-semibold text-slate-800">Bảng kê bán hàng</div>
        <div className="text-xs text-slate-500 mt-1">
          Theo dòng hàng (chỉ lấy HĐ SALES đã DUYỆT). Click vào dòng hoặc mã HĐ để xem chi tiết.
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-6 gap-3 items-end">
          <div>
            <div className="text-xs text-slate-500 mb-1">Từ ngày</div>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Đến ngày</div>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div className="lg:col-span-2">
            <div className="text-xs text-slate-500 mb-1">Tìm kiếm</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Số chứng từ / khách / sản phẩm..."
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">NV sale</div>
            <select
              value={saleUserId}
              onChange={(e) => setSaleUserId(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 bg-white"
            >
              <option value="">-- Tất cả --</option>
              {staffOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Kỹ thuật</div>
            <select
              value={techUserId}
              onChange={(e) => setTechUserId(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 bg-white"
            >
              <option value="">-- Tất cả --</option>
              {staffOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Thanh toán</div>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              className="w-full border border-slate-300 rounded px-3 py-2 bg-white"
            >
              <option value="">-- Tất cả --</option>
              <option value="UNPAID">Chưa thanh toán</option>
              <option value="PARTIAL">Thanh toán một phần</option>
              <option value="PAID">Đã thanh toán</option>
            </select>
          </div>

          <div className="flex gap-2 lg:col-span-6">
            <button
              onClick={() => load()} // ✅ tránh React truyền event vào load()
              disabled={loading}
              className={`px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-800 ${
                loading ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {loading ? "Đang tải..." : "Lọc"}
            </button>

            <button
              onClick={exportExcel}
              disabled={loading}
              className={`px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 ${
                loading ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              Export Excel
            </button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Doanh thu</div>
          <div className="text-lg font-semibold">{fmtMoney(kpi.revenue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Giá vốn</div>
          <div className="text-lg font-semibold">{fmtMoney(kpi.cost)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Số lượng máy bán</div>
          <div className="text-lg font-semibold">{fmtQty(kpi.qtySum)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Đã thu</div>
          <div className="text-lg font-semibold">{fmtMoney(kpi.paid)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Còn nợ</div>
          <div className="text-lg font-semibold">{fmtMoney(kpi.debt)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="font-semibold">Danh sách</div>
          <div className="text-sm text-slate-600">
            {rows.length} dòng • {new Set(rows.map((r) => r.invoiceId).filter(Boolean)).size} hóa đơn
          </div>
        </div>

        <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-[1320px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left">
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 whitespace-nowrap">Ngày</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 whitespace-nowrap">Số chứng từ</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200">Tên khách hàng</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200">Tên sản phẩm</th>

                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-center whitespace-nowrap">Số lượng bán</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Đơn giá</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Thành tiền</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Đơn giá vốn</th>

                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Thành tiền vốn</th>

                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Đã thanh toán</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Còn nợ</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 whitespace-nowrap">NV sale</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 whitespace-nowrap">Kỹ thuật</th>

                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 border-b border-slate-200 text-right whitespace-nowrap">Giá vốn TB tháng (tham khảo)</th>
              </tr>
            </thead>

            <tbody>
              {!loading && pagedRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={14}>
                    Chưa có dữ liệu.
                  </td>
                </tr>
              ) : null}

              {pagedRows.map((r, idx) => {
                const loss = r.lineAmount - r.costTotal;
                const isLoss = loss < -0.0001;
                const isDebt = r.debt > 0.0001;
                const rowBg = isLoss ? "bg-red-50" : isDebt ? "bg-amber-50" : "bg-white";

                return (
                  <tr
                    key={`${r.invoiceId}:${r.itemSku || r.itemName}:${idx}`}
                    className={`hover:bg-slate-50 cursor-pointer ${rowBg}`}
                    onClick={() => openInvoiceDetail(r.invoiceId)}
                    title="Click để xem chi tiết hóa đơn"
                  >
                    <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">{fmtDateDMY(r.issueDate)}</td>

                    <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                      <button
                        className="text-blue-700 hover:underline"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          openInvoiceDetail(r.invoiceId);
                        }}
                      >
                        {r.code}
                      </button>
                    </td>

                    <td className="px-4 py-3 border-b border-slate-100">{r.partnerName}</td>

                    <td className="px-4 py-3 border-b border-slate-100">
                      <div className="font-semibold">{r.itemName}</div>
                    </td>

                    <td className="px-4 py-3 border-b border-slate-100 text-center whitespace-nowrap">{fmtQty(r.qty)}</td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right whitespace-nowrap">{fmtMoney(r.unitPrice)}</td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right font-semibold whitespace-nowrap">
                      {fmtMoney(r.lineAmount)}
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right whitespace-nowrap">{fmtMoney(r.unitCost)}</td>

                    <td className="px-4 py-3 border-b border-slate-100 text-right whitespace-nowrap">{fmtMoney(r.costTotal)}</td>

                    <td className="px-4 py-3 border-b border-slate-100 text-right text-green-700 font-semibold whitespace-nowrap">
                      {fmtMoney(r.paid)}
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right text-red-700 font-semibold whitespace-nowrap">
                      {fmtMoney(r.debt)}
                    </td>

                    <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">{r.saleUserName}</td>
                    <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">{r.techUserName}</td>

                    {/* ✅ tách riêng khỏi nhóm giá vốn chính, chỉ mang tính tham khảo */}
                    <td className="px-4 py-3 border-b border-slate-100 text-right whitespace-nowrap text-slate-500">
                      {fmtMoney(safeNum(r.unitCostMonthAvg))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
          <div className="text-slate-600">
            Trang <b>{page}</b> / <b>{totalPages}</b> — {PAGE_SIZE} dòng / trang
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              «
            </button>
            <button
              className="px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              »
            </button>
          </div>
        </div>
      </div>

      {/* ===== Invoice Detail Modal ===== */}
      {openInv ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setOpenInv(false);
              setInvId("");
              setInv(null);
              setRetAgg(null);
            }}
          />
          <div
            className="relative w-[980px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-800">Chi tiết hóa đơn</div>
                <div className="text-xs text-slate-500">ID: {invId}</div>
              </div>
              <button
                className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50"
                onClick={() => {
                  setOpenInv(false);
                  setInvId("");
                  setInv(null);
                  setRetAgg(null);
                }}
              >
                Đóng
              </button>
            </div>

            <div className="p-5">
              {invLoading ? (
                <div className="py-8 text-slate-500">Đang tải chi tiết...</div>
              ) : !inv ? (
                <div className="py-8 text-slate-500">Không có dữ liệu hóa đơn.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="text-xs text-slate-500">Mã HĐ</div>
                      <div className="font-semibold">{inv.code || ""}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Ngày: <span className="text-slate-700 font-medium">{fmtDateDMY(inv.issueDate)}</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="text-xs text-slate-500">Khách</div>
                      <div className="font-semibold">{inv.partnerName || ""}</div>
                      {inv.partnerPhone ? (
                        <div className="text-xs text-slate-500 mt-1">
                          SĐT: <span className="text-slate-700 font-medium">{inv.partnerPhone}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                      <div className="text-xs text-slate-500">Trạng thái</div>
                      <div className="font-semibold">
                        {viInvoiceStatus(inv.status)} • {viPaymentStatus(inv.paymentStatus)}
                      </div>
                      {invSummary ? (
                        <div className="text-xs text-slate-500 mt-1">
                          Sale: <span className="text-slate-700 font-medium">{invSummary.saleName || "-"}</span> • K.Thuat:{" "}
                          <span className="text-slate-700 font-medium">{invSummary.techName || "-"}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {invSummary ? (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
                      <div className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs text-slate-500">Tạm tính</div>
                        <div className="font-semibold">{fmtMoney(invSummary.subtotal)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs text-slate-500">VAT</div>
                        <div className="font-semibold">{fmtMoney(invSummary.tax)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs text-slate-500">Tổng</div>
                        <div className="font-semibold">{fmtMoney(invSummary.total)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs text-slate-500">Đã thu</div>
                        <div className="font-semibold text-green-700">{fmtMoney(invSummary.paid)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs text-slate-500">Còn nợ</div>
                        <div className="font-semibold text-red-700">{fmtMoney(invSummary.debt)}</div>
                      </div>
                    </div>
                  ) : null}

                  {/* TRẢ HÀNG summary */}
                  <div className="mt-3">
                    {retLoading ? (
                      <div className="text-xs text-slate-500">Đang kiểm tra trả hàng...</div>
                    ) : retAgg && (retAgg.totalQty > 0.0001 || retAgg.totalAmount > 0.0001) ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                        <div className="font-semibold text-amber-900">
                          Hóa đơn có trả hàng: {fmtQty(retAgg.totalQty)} • Giá trị trả: {fmtMoney(retAgg.totalAmount)}
                        </div>
                        <div className="text-xs text-amber-900/70">
                          Dòng hàng bên dưới sẽ hiển thị “Đã trả / Còn lại / Thành tiền (sau trả)”.
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 font-semibold">Dòng hàng</div>
                    <div className="overflow-auto">
                      <table className="min-w-[920px] w-full text-sm">
                        <thead className="bg-white">
                          <tr className="text-left">
                            <th className="px-4 py-2 border-b border-slate-200">Sản phẩm</th>
                            <th className="px-4 py-2 border-b border-slate-200 text-center whitespace-nowrap">SL</th>
                            <th className="px-4 py-2 border-b border-slate-200 text-center whitespace-nowrap">Đã trả</th>
                            <th className="px-4 py-2 border-b border-slate-200 text-center whitespace-nowrap">Còn lại</th>
                            <th className="px-4 py-2 border-b border-slate-200 text-right whitespace-nowrap">Đơn giá</th>
                            <th className="px-4 py-2 border-b border-slate-200 text-right whitespace-nowrap">
                              Thành tiền (sau trả)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(inv.lines || []).map((l: any, i: number) => {
                            const qty = safeNum(l.qty);
                            const amount = safeNum(l.amount);

                            const unitPrice = safeNum(l.price ?? l.unitPrice ?? (qty > 0 ? amount / qty : 0));

                            const itemId = String(l?.itemId || l?.item?.id || "");
                            const ret = itemId && retAgg?.byItemId ? retAgg.byItemId[itemId] : undefined;
                            const retQty = Math.max(0, safeNum(ret?.qty));
                            const retAmt = Math.max(0, safeNum(ret?.amount));

                            const netQty = Math.max(0, qty - retQty);
                            const netAmt = Math.max(0, amount - retAmt);

                            const name = l.itemName || l.name || l.item?.name || "(Không rõ)";
                            const sku = l.itemSku || l.sku || l.item?.sku || "";

                            return (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-4 py-2 border-b border-slate-100">
                                  <div className="font-medium">{name}</div>
                                  {sku ? <div className="text-xs text-slate-500">{sku}</div> : null}
                                </td>
                                <td className="px-4 py-2 border-b border-slate-100 text-center">{fmtQty(qty)}</td>
                                <td className="px-4 py-2 border-b border-slate-100 text-center text-amber-700">
                                  {retQty > 0 ? fmtQty(retQty) : "0"}
                                </td>
                                <td className="px-4 py-2 border-b border-slate-100 text-center font-semibold">{fmtQty(netQty)}</td>
                                <td className="px-4 py-2 border-b border-slate-100 text-right whitespace-nowrap">{fmtMoney(unitPrice)}</td>
                                <td className="px-4 py-2 border-b border-slate-100 text-right font-semibold whitespace-nowrap">
                                  {fmtMoney(netAmt)}
                                </td>
                              </tr>
                            );
                          })}

                          {(inv.lines || []).length === 0 ? (
                            <tr>
                              <td className="px-4 py-6 text-slate-500" colSpan={6}>
                                Hóa đơn không có dòng hàng.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SalesLedgerReportPage;