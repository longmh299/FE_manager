// src/pages/SalesReturnsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import { CurrencyInput } from "../components/CurrencyInput";

type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type UserRole = "staff" | "accountant" | "admin";

type InvoiceListItem = {
  id: string;
  code: string;
  issueDate?: string;

  partnerName?: string | null;
  partnerId?: string | null;

  refInvoiceId?: string | null;
  refInvoiceCode?: string | null;

  total: number;
  status: InvoiceStatus;
};

type PartnerOpt = { id: string; name: string; code?: string };
type PaymentAccountOpt = { id: string; code: string; name: string };
type SalesInvoiceOpt = {
  id: string;
  code: string;
  issueDate?: string;
  total: number;
  partnerName?: string | null;
};

type AllocationRow = {
  id: string;
  amount: number;
  kind: "NORMAL" | "WARRANTY_HOLD" | string;
  createdAt?: string;
  payment?: {
    id: string;
    date?: string;
    type?: "RECEIPT" | "PAYMENT" | string;
    amount?: number;
    method?: string | null;
    refNo?: string | null;
    note?: string | null;
    account?: { code?: string; name?: string } | null;
  } | null;
};

type SalesInvoiceDetail = {
  id: string;
  code: string;
  issueDate?: string;
  total: number;
  paidAmount: number;

  // ✅ hold fields (để hiển thị/giới hạn)
  hasWarrantyHold?: boolean;
  warrantyHoldAmount?: number;
  warrantyHoldPct?: number;
  warrantyDueDate?: string | null;

  partnerName?: string | null;
  allocations?: AllocationRow[];
};

function formatDateDisplay(raw?: string) {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

async function fetchMeRole(): Promise<UserRole | null> {
  try {
    const r = await api.get("/auth/me");
    return (r?.data?.role ?? r?.data?.user?.role ?? null) as any;
  } catch {
    return null;
  }
}

function statusLabel(st: InvoiceStatus) {
  if (st === "DRAFT") return "NHÁP";
  if (st === "SUBMITTED") return "CHỜ DUYỆT";
  if (st === "APPROVED") return "ĐÃ DUYỆT";
  if (st === "REJECTED") return "TỪ CHỐI";
  return st;
}

function statusPillStyle(st: InvoiceStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2,
    border: "1px solid",
    whiteSpace: "nowrap",
  };
  if (st === "DRAFT") return { ...base, background: "#FFF7ED", borderColor: "#FDBA74", color: "#9A3412" };
  if (st === "SUBMITTED") return { ...base, background: "#EFF6FF", borderColor: "#93C5FD", color: "#1D4ED8" };
  if (st === "APPROVED") return { ...base, background: "#ECFDF5", borderColor: "#6EE7B7", color: "#065F46" };
  if (st === "REJECTED") return { ...base, background: "#FEF2F2", borderColor: "#FCA5A5", color: "#991B1B" };
  return { ...base, background: "#F9FAFB", borderColor: "#E5E7EB", color: "#111827" };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #E5E7EB",
    background: "#fff",
    color: "#111827",
    fontWeight: 700,
    cursor: "pointer",
  };
}

function dangerBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #FCA5A5",
    background: "#FEF2F2",
    color: "#991B1B",
    fontWeight: 800,
    cursor: "pointer",
  };
}

/** ===== Refund Modal styles ===== **/
function modalOverlayStyle(): React.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    zIndex: 9999,
    padding: 16,
    overflowY: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function modalCardStyle(): React.CSSProperties {
  return {
    width: 620,
    maxWidth: "100%",
    maxHeight: "92vh",
    background: "#fff",
    borderRadius: 16,
    border: "1px solid #E5E7EB",
    boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };
}

function modalHeaderStyle(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderBottom: "1px solid #E5E7EB",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flex: "0 0 auto",
    background: "#fff",
  };
}

function modalBodyStyle(): React.CSSProperties {
  return {
    padding: 14,
    overflowY: "auto",
    flex: "1 1 auto",
  };
}

function modalFooterStyle(): React.CSSProperties {
  return {
    padding: 14,
    borderTop: "1px solid #E5E7EB",
    background: "#fff",
    flex: "0 0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  };
}

/** ====== Input styles: rõ viền + hover + focus ring ====== */
const inputBaseBorder = "#CBD5E1";
const inputHoverBorder = "#94A3B8";
const inputFocusBorder = "#2563EB";
const inputFocusRing = "rgba(37, 99, 235, 0.18)";

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${inputBaseBorder}`,
    borderRadius: 12,
    outline: "none",
    background: "#fff",
    boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
    transition: "border-color .15s ease, box-shadow .15s ease, background-color .15s ease",
  };
}

function labelStyle(): React.CSSProperties {
  return { fontWeight: 800, marginBottom: 6 };
}

function rowStyle(): React.CSSProperties {
  return { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function unwrapList(res: any): any[] {
  const body = res?.data;
  const raw = body?.data?.items ?? body?.items ?? body?.data ?? body;
  return Array.isArray(raw) ? raw : [];
}

function toNum(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nearlyEqual(a: number, b: number, eps = 0.0001) {
  return Math.abs((a || 0) - (b || 0)) <= eps;
}

/** ===== Center Alert (overlay) ===== */
type CenterAlert = { type: "error" | "warning" | "success"; title: string; message: string } | null;

function centerAlertStyles(type: "error" | "warning" | "success") {
  const base = {
    borderRadius: 16,
    border: "1px solid",
    padding: 14,
    lineHeight: 1.45,
  } as React.CSSProperties;
  if (type === "error") return { ...base, background: "#FEF2F2", borderColor: "#FCA5A5", color: "#991B1B" };
  if (type === "warning") return { ...base, background: "#FFFBEB", borderColor: "#FDE68A", color: "#92400E" };
  return { ...base, background: "#ECFDF5", borderColor: "#6EE7B7", color: "#065F46" };
}

function applyFocusStyle(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.borderColor = inputFocusBorder;
  el.style.boxShadow = `0 0 0 4px ${inputFocusRing}, 0 1px 0 rgba(0,0,0,0.03)`;
}

function applyBlurStyle(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.borderColor = inputBaseBorder;
  el.style.boxShadow = "0 1px 0 rgba(0,0,0,0.03)";
}

function applyHoverStyle(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) {
  if (!el) return;
  if (document.activeElement === el) return;
  el.style.borderColor = inputHoverBorder;
}

function applyLeaveStyle(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) {
  if (!el) return;
  if (document.activeElement === el) return;
  el.style.borderColor = inputBaseBorder;
}

/**
 * FE display-only fallback cho invoice cũ:
 * - nếu hasWarrantyHold=true mà warrantyHoldAmount=0 và warrantyHoldPct>0 => derive hold = total * pct / 100
 */
function computeEffectiveHoldAmount(inv?: SalesInvoiceDetail | null) {
  if (!inv) return 0;
  if (!inv.hasWarrantyHold) return 0;

  const amt = Math.max(0, toNum(inv.warrantyHoldAmount));
  if (amt > 0) return amt;

  const pct = Math.max(0, toNum(inv.warrantyHoldPct));
  if (pct > 0) {
    return Math.round(((toNum(inv.total) * pct) / 100 + Number.EPSILON) * 100) / 100;
  }

  return 0;
}

export default function SalesReturnsPage() {
  const nav = useNavigate();
  const toast = useToast();

  const [role, setRole] = useState<UserRole | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | InvoiceStatus>("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<InvoiceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  // ===== Refund modal state =====
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundInv, setRefundInv] = useState<InvoiceListItem | null>(null);

  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundMethod, setRefundMethod] = useState<string>("");
  const [refundRefNo, setRefundRefNo] = useState<string>("");
  const [refundNote, setRefundNote] = useState<string>("");

  // partner select (search)
  const [refundPartnerId, setRefundPartnerId] = useState<string>("");
  const [partnerQuery, setPartnerQuery] = useState<string>("");
  const [partnerLoading, setPartnerLoading] = useState<boolean>(false);
  const [partnerOptions, setPartnerOptions] = useState<PartnerOpt[]>([]);
  const [partnerDropdownOpen, setPartnerDropdownOpen] = useState<boolean>(false);
  const partnerBoxRef = useRef<HTMLDivElement | null>(null);

  // payment accounts
  const [accounts, setAccounts] = useState<PaymentAccountOpt[]>([]);
  const [refundAccountId, setRefundAccountId] = useState<string>("");

  // sales invoice select
  const [salesInvId, setSalesInvId] = useState<string>("");
  const [salesInvLabel, setSalesInvLabel] = useState<string>("");
  const [salesInvQuery, setSalesInvQuery] = useState<string>("");
  const [salesInvLoading, setSalesInvLoading] = useState<boolean>(false);
  const [salesInvOptions, setSalesInvOptions] = useState<SalesInvoiceOpt[]>([]);
  const [salesInvDropdownOpen, setSalesInvDropdownOpen] = useState<boolean>(false);
  const salesInvBoxRef = useRef<HTMLDivElement | null>(null);

  // sales invoice detail
  const [salesInvDetailLoading, setSalesInvDetailLoading] = useState<boolean>(false);
  const [salesInvDetail, setSalesInvDetail] = useState<SalesInvoiceDetail | null>(null);

  // center alert overlay
  const [centerAlert, setCenterAlert] = useState<CenterAlert>(null);

  // track user edits refund amount to avoid auto overriding
  const userEditedRefundAmountRef = useRef(false);

  function showCenterAlert(type: "error" | "warning" | "success", title: string, message: string) {
    setCenterAlert({ type, title, message });
  }

  useEffect(() => {
    (async () => {
      setLoadingRole(true);
      const r = await fetchMeRole();
      setRole(r);
      setLoadingRole(false);

      if (!r) return nav("/login", { replace: true });
      if (r !== "admin") {
        toast.push({ type: "error", title: "Không có quyền", message: "Chức năng này chỉ dành cho ADMIN." });
        return nav("/", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params: any = {
        q: q || undefined,
        page,
        pageSize,
        type: "SALES_RETURN",
        status: status || undefined,
      };
      const res = await api.get("/invoices", { params });
      const data = res.data?.data ?? [];
      setRows(
        (Array.isArray(data) ? data : []).map((x: any) => ({
          id: String(x.id),
          code: String(x.code),
          issueDate: x.issueDate,
          partnerName: x.partnerName ?? "",
          partnerId: x.partnerId ?? null,
          refInvoiceId: x.refInvoiceId != null ? String(x.refInvoiceId) : null,
          refInvoiceCode:
            x.refInvoice?.code != null
              ? String(x.refInvoice.code)
              : x.refInvoiceCode != null
              ? String(x.refInvoiceCode)
              : null,
          total: Number(x.total ?? 0),
          status: x.status as InvoiceStatus,
        }))
      );
      setTotal(Number(res.data?.total ?? 0));
    } catch (e: any) {
      toast.push({ type: "error", title: "Lỗi", message: e?.response?.data?.message || e?.message || "Không tải được." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (role !== "admin") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, page, status]);

  // Load payment accounts
  useEffect(() => {
    if (role !== "admin") return;
    (async () => {
      try {
        const res = await api.get("/payment-accounts", { params: { active: 1 } });
        const list = unwrapList(res);
        setAccounts(
          list
            .map((a: any) => ({ id: String(a.id), code: String(a.code || ""), name: String(a.name || "") }))
            .filter((x: any) => x.id && x.code)
        );
      } catch {
        setAccounts([]);
      }
    })();
  }, [role]);

  async function actSubmit(id: string) {
    try {
      await api.post(`/invoices/${id}/submit`);
      toast.push({ type: "success", title: "Thành công", message: "Đã gửi duyệt." });
      await load();
    } catch (e: any) {
      showCenterAlert("error", "Lỗi", e?.response?.data?.message || e?.message || "Không gửi duyệt được.");
    }
  }

  async function actRecall(id: string) {
    try {
      await api.post(`/invoices/${id}/recall`);
      toast.push({ type: "success", title: "Thành công", message: "Đã hủy gửi duyệt." });
      await load();
    } catch (e: any) {
      showCenterAlert("error", "Lỗi", e?.response?.data?.message || e?.message || "Không hủy được.");
    }
  }

  async function actApprove(id: string) {
    try {
      await api.post(`/invoices/${id}/approve`, {});
      toast.push({ type: "success", title: "Đã duyệt", message: "Phiếu đã được duyệt và nhập kho." });
      await load();
    } catch (e: any) {
      showCenterAlert("error", "Lỗi", e?.response?.data?.message || e?.message || "Không duyệt được.");
    }
  }

  async function actReject(id: string) {
    try {
      await api.post(`/invoices/${id}/reject`, {});
      toast.push({ type: "warning", title: "Đã từ chối", message: "Phiếu đã bị từ chối." });
      await load();
    } catch (e: any) {
      showCenterAlert("error", "Lỗi", e?.response?.data?.message || e?.message || "Không từ chối được.");
    }
  }

  async function actDelete(id: string) {
    const ok = window.confirm("Bạn chắc chắn muốn xoá phiếu này?");
    if (!ok) return;

    try {
      await api.delete(`/invoices/${id}`);
      toast.push({ type: "success", title: "Đã xoá", message: "Phiếu đã được xoá." });
      await load();
    } catch (e: any) {
      showCenterAlert("error", "Lỗi", e?.response?.data?.message || e?.message || "Không xoá được.");
    }
  }

  function resetSalesInvoiceSelection() {
    setSalesInvId("");
    setSalesInvLabel("");
    setSalesInvQuery("");
    setSalesInvOptions([]);
    setSalesInvDropdownOpen(true);
    setSalesInvDetail(null);
  }

  function openRefund(inv: InvoiceListItem) {
    if (inv.status !== "APPROVED") {
      showCenterAlert("warning", "Chưa duyệt", "Chỉ hoàn tiền khi phiếu trả hàng đã ở trạng thái ĐÃ DUYỆT.");
      return;
    }

    userEditedRefundAmountRef.current = false;

    setRefundInv(inv);

    // default: hoàn đúng bằng tổng phiếu trả (sau khi load HĐ gốc sẽ tự clamp nếu vượt khả dụng)
    setRefundAmount(Number(inv.total || 0));
    setRefundMethod("");
    setRefundRefNo("");
    setRefundNote(`Hoàn tiền phiếu trả hàng ${inv.code} (cấn vào HĐ SALES gốc).`);

    setRefundPartnerId(inv.partnerId ? String(inv.partnerId) : "");
    setPartnerQuery(inv.partnerName ? String(inv.partnerName) : "");
    setPartnerOptions([]);
    setPartnerDropdownOpen(!inv.partnerId);

    setRefundAccountId("");

    // auto select SALES gốc theo refInvoiceId nếu có
    const rid = inv.refInvoiceId ? String(inv.refInvoiceId) : "";
    const rcode = inv.refInvoiceCode ? String(inv.refInvoiceCode) : "";
    if (rid) {
      setSalesInvId(rid);
      setSalesInvLabel(rcode ? `${rcode} (HĐ gốc)` : `${rid} (HĐ gốc)`);
      setSalesInvQuery("");
      setSalesInvOptions([]);
      setSalesInvDropdownOpen(false);
    } else {
      resetSalesInvoiceSelection();
    }

    setRefundOpen(true);
  }

  function closeRefund() {
    setRefundOpen(false);
    setRefundInv(null);
    setPartnerDropdownOpen(false);
    setSalesInvDropdownOpen(false);
    setSalesInvDetail(null);
  }

  /** ===== Partner search ===== **/
  async function searchPartners(keyword: string) {
    const k = (keyword || "").trim();
    if (!k) {
      setPartnerOptions([]);
      return;
    }
    setPartnerLoading(true);
    try {
      const res = await api.get("/partners", { params: { q: k, page: 1, pageSize: 20 } });
      const list = unwrapList(res);
      const mapped: PartnerOpt[] = list
        .map((p: any) => ({
          id: String(p.id),
          name: String(p.name ?? p.partnerName ?? p.fullName ?? p.code ?? p.id),
          code: p.code ? String(p.code) : undefined,
        }))
        .filter((x) => x.id && x.name);
      setPartnerOptions(mapped);
    } catch (e) {
      console.error("searchPartners error", e);
      setPartnerOptions([]);
    } finally {
      setPartnerLoading(false);
    }
  }

  const debouncedSearchPartners = useMemo(() => debounce(searchPartners, 300), []);

  useEffect(() => {
    if (!refundOpen) return;
    if (refundPartnerId) return;
    debouncedSearchPartners(partnerQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerQuery, refundOpen, refundPartnerId]);

  /** ===== Sales invoice search ===== **/
  async function searchSalesInvoices(keyword: string) {
    const inv = refundInv;
    if (!inv) return;

    const k = (keyword || "").trim();
    if (!k && !refundPartnerId) {
      setSalesInvOptions([]);
      return;
    }

    setSalesInvLoading(true);
    try {
      const params: any = {
        q: k || undefined,
        page: 1,
        pageSize: 20,
        type: "SALES",
        status: "APPROVED",
        partnerId: refundPartnerId || undefined,
      };

      const res = await api.get("/invoices", { params });
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped: SalesInvoiceOpt[] = list.map((x: any) => ({
        id: String(x.id),
        code: String(x.code),
        issueDate: x.issueDate,
        total: Number(x.total ?? 0),
        partnerName: x.partnerName ?? "",
      }));
      setSalesInvOptions(mapped);
    } catch (e) {
      console.error("searchSalesInvoices error", e);
      setSalesInvOptions([]);
    } finally {
      setSalesInvLoading(false);
    }
  }

  const debouncedSearchSalesInvoices = useMemo(() => debounce(searchSalesInvoices, 300), []);

  useEffect(() => {
    if (!refundOpen) return;
    if (salesInvId) return;
    if (!refundPartnerId) {
      setSalesInvOptions([]);
      return;
    }
    debouncedSearchSalesInvoices(salesInvQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundOpen, refundPartnerId, salesInvQuery, salesInvId]);

  // click outside đóng dropdown
  useEffect(() => {
    function onDocClick(e: any) {
      if (!refundOpen) return;

      if (partnerBoxRef.current && partnerBoxRef.current.contains(e.target)) return;
      if (salesInvBoxRef.current && salesInvBoxRef.current.contains(e.target)) return;

      setPartnerDropdownOpen(false);
      setSalesInvDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [refundOpen]);

  // load sales invoice detail when selected
  useEffect(() => {
    if (!refundOpen) return;
    if (!salesInvId) {
      setSalesInvDetail(null);
      return;
    }

    let alive = true;
    (async () => {
      setSalesInvDetailLoading(true);
      try {
        const res = await api.get(`/invoices/${salesInvId}`);
        const inv = res?.data?.data ?? res?.data;

        const detail: SalesInvoiceDetail = {
          id: String(inv.id),
          code: String(inv.code || salesInvId),
          issueDate: inv.issueDate,
          total: toNum(inv.total),
          paidAmount: toNum(inv.paidAmount),

          hasWarrantyHold: inv.hasWarrantyHold === true,
          warrantyHoldAmount: toNum(inv.warrantyHoldAmount),
          warrantyHoldPct: toNum(inv.warrantyHoldPct),
          warrantyDueDate: inv.warrantyDueDate ?? null,

          partnerName: inv.partnerName ?? null,
          allocations: Array.isArray(inv.allocations)
            ? inv.allocations.map((a: any) => ({
                id: String(a.id),
                amount: toNum(a.amount),
                kind: String(a.kind || ""),
                createdAt: a.createdAt,
                payment: a.payment
                  ? {
                      id: String(a.payment.id),
                      date: a.payment.date,
                      type: a.payment.type,
                      amount: toNum(a.payment.amount),
                      method: a.payment.method ?? null,
                      refNo: a.payment.refNo ?? null,
                      note: a.payment.note ?? null,
                      account: a.payment.account ? { code: a.payment.account.code, name: a.payment.account.name } : null,
                    }
                  : null,
              }))
            : [],
        };

        if (!alive) return;
        setSalesInvDetail(detail);
      } catch (e: any) {
        console.error("loadSalesInvoiceDetail error", e);
        if (!alive) return;
        setSalesInvDetail(null);
        showCenterAlert(
          "error",
          "Không tải được hoá đơn SALES gốc",
          e?.response?.data?.message || e?.message || "Vui lòng thử lại."
        );
      } finally {
        if (alive) setSalesInvDetailLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundOpen, salesInvId]);

  /** =========================
   * ✅ Option A (đã đồng bộ với BE mới):
   * - Refund = PAYMENT + allocations âm (NORMAL và/hoặc WARRANTY_HOLD)
   * - Hoàn "tất cả tiền" nhưng chỉ hoàn được phần nào khách đã trả thật (NORMAL/HOLD net >= 0)
   * - Nếu khách chưa trả HOLD thì HOLD net = 0 => không hoàn HOLD
   ========================= **/

  const normalNet = useMemo(() => {
    const allocs = salesInvDetail?.allocations || [];
    let sum = 0;
    for (const a of allocs) if (String(a.kind) === "NORMAL") sum += toNum(a.amount);
    return sum; // NET (đã trừ hoàn trước đó)
  }, [salesInvDetail]);

  const holdNet = useMemo(() => {
    const allocs = salesInvDetail?.allocations || [];
    let sum = 0;
    for (const a of allocs) if (String(a.kind) === "WARRANTY_HOLD") sum += toNum(a.amount);
    return sum; // NET (đã trừ hoàn trước đó)
  }, [salesInvDetail]);

  const refundedNormalBefore = useMemo(() => {
    const allocs = salesInvDetail?.allocations || [];
    let sum = 0;
    for (const a of allocs) {
      if (String(a.kind) !== "NORMAL") continue;
      if (toNum(a.amount) < 0) sum += Math.abs(toNum(a.amount));
    }
    return sum;
  }, [salesInvDetail]);

  const refundedHoldBefore = useMemo(() => {
    const allocs = salesInvDetail?.allocations || [];
    let sum = 0;
    for (const a of allocs) {
      if (String(a.kind) !== "WARRANTY_HOLD") continue;
      if (toNum(a.amount) < 0) sum += Math.abs(toNum(a.amount));
    }
    return sum;
  }, [salesInvDetail]);

  const refundableNormalNow = useMemo(() => Math.max(0, normalNet), [normalNet]);
  const refundableHoldNow = useMemo(() => Math.max(0, holdNet), [holdNet]);
  const refundableTotalNow = useMemo(
    () => Math.max(0, refundableNormalNow + refundableHoldNow),
    [refundableNormalNow, refundableHoldNow]
  );

  // auto clamp initial refund amount to refundableTotalNow when invoice detail arrives
  useEffect(() => {
    if (!refundOpen) return;
    if (!salesInvDetail) return;
    if (userEditedRefundAmountRef.current) return;

    const cur = toNum(refundAmount);
    if (cur <= 0) return;
    if (refundableTotalNow <= 0) return;

    if (cur > refundableTotalNow + 0.0001) {
      setRefundAmount(refundableTotalNow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundOpen, salesInvDetail, refundableTotalNow]);

  const overRefund = useMemo(() => {
    const amt = toNum(refundAmount);
    if (!salesInvId) return false;
    if (!salesInvDetail) return false;
    if (amt <= 0) return false;
    return amt > refundableTotalNow + 0.0001;
  }, [refundAmount, salesInvId, salesInvDetail, refundableTotalNow]);

  const confirmDisabled = useMemo(() => {
    if (!refundInv) return true;
    const amt = toNum(refundAmount);
    if (!Number.isFinite(amt) || amt <= 0) return true;
    if (!refundPartnerId) return true;
    if (!salesInvId) return true;
    if (salesInvDetailLoading) return true;
    if (!salesInvDetail) return true;
    if (overRefund) return true;
    return false;
  }, [refundInv, refundAmount, refundPartnerId, salesInvId, salesInvDetailLoading, salesInvDetail, overRefund]);

  function buildRefundAllocations(totalRefund: number) {
    // totalRefund: số dương user muốn hoàn
    const amt = Math.max(0, toNum(totalRefund));

    const normalAvail = Math.max(0, refundableNormalNow);
    const holdAvail = Math.max(0, refundableHoldNow);
    const totalAvail = Math.max(0, normalAvail + holdAvail);

    if (amt <= 0) {
      return { ok: false as const, message: "Số tiền hoàn phải > 0.", allocations: [] as any[] };
    }

    if (amt > totalAvail + 0.0001) {
      return {
        ok: false as const,
        message: `Số tiền hoàn vượt quá số khách đã thanh toán thực tế. Hiện chỉ còn có thể hoàn tối đa ${formatMoney(
          totalAvail
        )} (NORMAL: ${formatMoney(normalAvail)}, HOLD: ${formatMoney(holdAvail)}).`,
        allocations: [] as any[],
      };
    }

    // ✅ ưu tiên hoàn NORMAL trước, thiếu thì hoàn HOLD
    const normalPart = Math.min(amt, normalAvail);
    const holdPart = Math.max(0, amt - normalPart);

    const allocations: any[] = [];
    if (normalPart > 0) allocations.push({ invoiceId: salesInvId, amount: -normalPart, kind: "NORMAL" });
    if (holdPart > 0) allocations.push({ invoiceId: salesInvId, amount: -holdPart, kind: "WARRANTY_HOLD" });

    // ✅ sanity: abs sum must equal amt (match BE validation)
    const expected = allocations.reduce((s, a) => s + Math.abs(toNum(a.amount)), 0);
    if (!nearlyEqual(expected, amt)) {
      return {
        ok: false as const,
        message: "Lỗi tính phân bổ hoàn tiền (không khớp tổng). Vui lòng thử lại.",
        allocations: [] as any[],
      };
    }

    return { ok: true as const, message: "", allocations, split: { normalPart, holdPart } };
  }

  async function confirmRefund() {
    const inv = refundInv;
    if (!inv) return;

    const amt = Number(refundAmount || 0);
    if (!Number.isFinite(amt) || amt <= 0) {
      showCenterAlert("warning", "Thiếu dữ liệu", "Số tiền hoàn phải > 0.");
      return;
    }

    const pid = String(refundPartnerId || "").trim();
    if (!pid) {
      showCenterAlert("warning", "Thiếu dữ liệu", "Bạn cần chọn Khách hàng (partnerId) để tạo phiếu chi hoàn tiền.");
      return;
    }

    if (!salesInvId) {
      showCenterAlert("warning", "Thiếu dữ liệu", "Bạn cần chọn HÓA ĐƠN SALES GỐC để cấn hoàn tiền (Option A).");
      return;
    }

    if (!salesInvDetail) {
      showCenterAlert("warning", "Thiếu dữ liệu", "Chưa tải được thông tin hoá đơn SALES gốc. Vui lòng thử lại.");
      return;
    }

    if (amt > refundableTotalNow + 0.0001) {
      showCenterAlert(
        "warning",
        "Số tiền hoàn vượt quá mức cho phép",
        `Hoá đơn SALES gốc hiện chỉ còn có thể hoàn tối đa ${formatMoney(refundableTotalNow)} (NORMAL: ${formatMoney(
          refundableNormalNow
        )}, HOLD: ${formatMoney(refundableHoldNow)}).`
      );
      return;
    }

    const built = buildRefundAllocations(amt);
    if (!built.ok) {
      showCenterAlert("warning", "Không thể hoàn", built.message);
      return;
    }

    const splitText =
      built?.split && (built.split.normalPart > 0 || built.split.holdPart > 0)
        ? ` (tách: NORMAL ${formatMoney(built.split.normalPart)}${
            built.split.holdPart > 0 ? ` + HOLD ${formatMoney(built.split.holdPart)}` : ""
          })`
        : "";

    try {
      await api.post("/payments", {
        date: new Date().toISOString().slice(0, 10),
        partnerId: pid,
        type: "PAYMENT",
        amount: amt,
        accountId: refundAccountId || undefined,
        method: refundMethod || undefined,
        refNo: refundRefNo || undefined,
        note: refundNote || `Hoàn tiền phiếu trả hàng ${inv.code} (cấn vào HĐ SALES gốc, Option A)${splitText}.`,
        allocations: built.allocations,
      });

      toast.push({ type: "success", title: "Thành công", message: "Đã tạo phiếu chi hoàn tiền." });
      closeRefund();
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "Không tạo được phiếu chi hoàn tiền.";
      showCenterAlert("error", "Lỗi hoàn tiền", msg);
    }
  }

  if (loadingRole) return <div style={{ padding: 16 }}>Đang kiểm tra đăng nhập…</div>;
  if (role !== "admin") return null;

  const effectiveHoldAmount = computeEffectiveHoldAmount(salesInvDetail);

  return (
    <div style={{ padding: 16 }}>
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />

      {/* Center Alert */}
      {centerAlert ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            zIndex: 10050,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={() => setCenterAlert(null)}
        >
          <div
            style={{
              width: 560,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 18,
              border: `1px solid ${inputBaseBorder}`,
              boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
              overflow: "hidden",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom: `1px solid ${inputBaseBorder}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 900 }}>{centerAlert.title}</div>
              <button style={ghostBtnStyle()} onClick={() => setCenterAlert(null)}>
                ✕
              </button>
            </div>
            <div style={{ padding: 14 }}>
              <div style={centerAlertStyles(centerAlert.type)}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  {centerAlert.type === "error" ? "❌" : centerAlert.type === "warning" ? "⚠️" : "✅"} {centerAlert.title}
                </div>
                <div style={{ fontWeight: 700 }}>{centerAlert.message}</div>
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button style={primaryBtnStyle()} onClick={() => setCenterAlert(null)}>
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Khách trả hàng</h2>
          <div style={{ color: "#6b7280", marginTop: 6 }}>
            Phiếu hoàn trả từ khách → duyệt để nhập kho → hoàn tiền bằng phiếu chi (Option A, cấn vào HĐ SALES gốc)
          </div>
        </div>

        <button style={primaryBtnStyle()} onClick={() => nav("/sales-returns/new")}>
          + Tạo phiếu
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          padding: 12,
          borderRadius: 12,
          border: `1px solid ${inputBaseBorder}`,
          background: "#fff",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã / khách hàng..."
          style={{ ...inputStyle(), width: 340, maxWidth: "100%" }}
          onFocus={(e) => applyFocusStyle(e.currentTarget)}
          onBlur={(e) => applyBlurStyle(e.currentTarget)}
          onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
          onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
        />

        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as any);
          }}
          style={{ ...inputStyle(), width: 220 }}
          onFocus={(e) => applyFocusStyle(e.currentTarget)}
          onBlur={(e) => applyBlurStyle(e.currentTarget)}
          onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
          onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="DRAFT">NHÁP</option>
          <option value="SUBMITTED">CHỜ DUYỆT</option>
          <option value="APPROVED">ĐÃ DUYỆT</option>
          <option value="REJECTED">TỪ CHỐI</option>
        </select>

        <button
          style={ghostBtnStyle()}
          onClick={() => {
            setPage(1);
            load();
          }}
          disabled={loading}
        >
          Tìm
        </button>
      </div>

      {/* Table */}
      <div style={{ marginTop: 14, border: `1px solid ${inputBaseBorder}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#F9FAFB" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 14, borderBottom: `1px solid ${inputBaseBorder}` }}>Mã</th>
              <th style={{ textAlign: "left", padding: 14, borderBottom: `1px solid ${inputBaseBorder}` }}>Ngày</th>
              <th style={{ textAlign: "left", padding: 14, borderBottom: `1px solid ${inputBaseBorder}` }}>Khách hàng</th>
              <th style={{ textAlign: "left", padding: 14, borderBottom: `1px solid ${inputBaseBorder}` }}>HĐ gốc</th>
              <th style={{ textAlign: "right", padding: 14, borderBottom: `1px solid ${inputBaseBorder}` }}>Tổng</th>
              <th style={{ textAlign: "center", padding: 14, borderBottom: `1px solid ${inputBaseBorder}` }}>Trạng thái</th>
              <th style={{ textAlign: "right", padding: 14, borderBottom: `1px solid ${inputBaseBorder}`, width: 420 }}>Thao tác</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 16 }}>
                  Đang tải…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 16 }}>
                  Không có dữ liệu.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isLocked = r.status === "APPROVED" || r.status === "REJECTED";
                const refText = r.refInvoiceCode || (r.refInvoiceId ? String(r.refInvoiceId).slice(0, 8) + "…" : "");

                return (
                  <tr key={r.id}>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", fontWeight: 700 }}>{r.code}</td>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9" }}>{formatDateDisplay(r.issueDate)}</td>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9" }}>{r.partnerName || ""}</td>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", color: refText ? "#111827" : "#94a3b8", fontWeight: 800 }}>
                      {refText || "—"}
                    </td>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "right", fontWeight: 800 }}>{formatMoney(r.total)}</td>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "center" }}>
                      <span style={statusPillStyle(r.status)}>{statusLabel(r.status)}</span>
                    </td>

                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {isLocked ? (
                          <>
                            <button style={ghostBtnStyle()} onClick={() => nav(`/sales-returns/${r.id}`)}>
                              Xem
                            </button>

                            {r.status === "APPROVED" ? (
                              <button style={primaryBtnStyle()} onClick={() => openRefund(r)}>
                                Hoàn tiền
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <button style={ghostBtnStyle()} onClick={() => nav(`/sales-returns/${r.id}`)}>
                              Xem/Sửa
                            </button>

                            {r.status === "DRAFT" && (
                              <>
                                <button style={primaryBtnStyle()} onClick={() => actSubmit(r.id)}>
                                  Gửi duyệt
                                </button>
                                <button style={dangerBtnStyle()} onClick={() => actDelete(r.id)}>
                                  Xoá
                                </button>
                              </>
                            )}

                            {r.status === "SUBMITTED" && (
                              <>
                                <button style={primaryBtnStyle()} onClick={() => actApprove(r.id)}>
                                  Duyệt
                                </button>
                                <button style={dangerBtnStyle()} onClick={() => actReject(r.id)}>
                                  Từ chối
                                </button>
                                <button style={ghostBtnStyle()} onClick={() => actRecall(r.id)}>
                                  Hủy gửi
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#111827" }}>
          Trang {page}/{totalPages} — Tổng: {total}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={ghostBtnStyle()} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Trước
          </button>
          <button style={ghostBtnStyle()} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Sau →
          </button>
        </div>
      </div>

      {/* ===== Refund Modal ===== */}
      {refundOpen && refundInv ? (
        <div style={modalOverlayStyle()}>
          <div style={modalCardStyle()}>
            <div style={modalHeaderStyle()}>
              <div style={{ fontWeight: 900 }}>
                Tạo phiếu chi hoàn tiền — <span style={{ color: "#64748b" }}>{refundInv.code}</span>
              </div>
              <button style={ghostBtnStyle()} onClick={closeRefund}>
                ✕
              </button>
            </div>

            <div style={modalBodyStyle()}>
              <div style={{ marginBottom: 10, fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                <b>Option A:</b> Hoàn tiền tạo phiếu <b>PAYMENT</b> và phân bổ âm vào <b>HĐ SALES gốc</b>.
                <div style={{ marginTop: 6, color: "#0f172a", fontWeight: 900 }}>
                  ✅ Hạn mức hoàn = <b>số khách đã trả thật</b> trên HĐ gốc (NORMAL net + HOLD net).
                </div>
                <div style={{ marginTop: 6, color: "#b45309", fontWeight: 900 }}>
                  ⚠️ Nếu khách <b>chưa trả HOLD</b> thì HOLD net = 0 → <b>không hoàn HOLD</b>. Nếu khách đã trả HOLD trước đó → hoàn được cả HOLD.
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: `1px solid ${inputBaseBorder}`,
                  background: "#F9FAFB",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Tình trạng thu/hoàn của hoá đơn SALES gốc</div>

                {salesInvDetailLoading ? (
                  <div style={{ color: "#64748b", fontWeight: 800 }}>Đang tải thông tin hoá đơn gốc…</div>
                ) : salesInvId && salesInvDetail ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>HĐ gốc</div>
                        <div style={{ fontWeight: 900 }}>
                          {salesInvDetail.code}{" "}
                          <span style={{ color: "#64748b", fontWeight: 800 }}>• {formatDateDisplay(salesInvDetail.issueDate)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Tổng HĐ: {formatMoney(salesInvDetail.total)}</div>
                        {salesInvDetail?.hasWarrantyHold ? (
                          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                            HOLD: {formatMoney(effectiveHoldAmount)}
                            {salesInvDetail.warrantyDueDate ? ` • Hạn: ${formatDateDisplay(salesInvDetail.warrantyDueDate)}` : ""}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 800 }}>Không có HOLD</div>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Đã hoàn trước đó</div>
                        <div style={{ fontWeight: 900 }}>{formatMoney(refundedNormalBefore + refundedHoldBefore)}</div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                          (NORMAL: {formatMoney(refundedNormalBefore)} • HOLD: {formatMoney(refundedHoldBefore)})
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Còn có thể hoàn</div>
                        <div style={{ fontWeight: 900, color: refundableTotalNow > 0 ? "#065F46" : "#991B1B" }}>
                          {formatMoney(refundableTotalNow)}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                          (NORMAL: {formatMoney(refundableNormalNow)} • HOLD: {formatMoney(refundableHoldNow)})
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 12, color: "#334155", fontWeight: 800 }}>
                      Gợi ý: muốn “hoàn hết” thì nhập đúng số tiền cần hoàn. Hệ thống sẽ tự tách: <b>hoàn NORMAL trước</b>, thiếu thì <b>hoàn HOLD</b>.
                    </div>
                  </>
                ) : salesInvId ? (
                  <div style={{ color: "#991B1B", fontWeight: 900 }}>Không tải được hoá đơn SALES gốc.</div>
                ) : (
                  <div style={{ color: "#64748b", fontWeight: 800 }}>Chưa chọn hoá đơn SALES gốc.</div>
                )}

                {salesInvDetail && (salesInvDetail.allocations || []).length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, marginBottom: 6 }}>Lịch sử thu/hoàn gần đây (NORMAL/HOLD)</div>

                    <div
                      style={{
                        maxHeight: 160,
                        overflowY: "auto",
                        borderRadius: 12,
                        border: `1px solid ${inputBaseBorder}`,
                        background: "#fff",
                      }}
                    >
                      {(salesInvDetail.allocations || [])
                        .filter((a) => String(a.kind) === "NORMAL" || String(a.kind) === "WARRANTY_HOLD")
                        .slice(0, 14)
                        .map((a) => {
                          const isHold = String(a.kind) === "WARRANTY_HOLD";
                          const signLabel = a.amount >= 0 ? "THU" : "HOÀN";
                          const signColor = a.amount >= 0 ? "#065F46" : "#991B1B";
                          const kindBadge = isHold ? "HOLD" : "NORMAL";
                          const kindBg = isHold ? "#EEF2FF" : "#ECFDF5";
                          const kindBd = isHold ? "#C7D2FE" : "#6EE7B7";
                          const kindTx = isHold ? "#3730A3" : "#065F46";
                          const dt = a.payment?.date || a.createdAt || "";

                          return (
                            <div key={a.id} style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 900,
                                      padding: "3px 8px",
                                      borderRadius: 999,
                                      background: kindBg,
                                      border: `1px solid ${kindBd}`,
                                      color: kindTx,
                                    }}
                                  >
                                    {kindBadge}
                                  </span>

                                  <div style={{ fontWeight: 900, color: signColor }}>
                                    {signLabel} • {formatMoney(Math.abs(a.amount))}
                                  </div>
                                </div>

                                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{formatDateDisplay(dt)}</div>
                              </div>

                              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 4 }}>
                                {a.payment?.type ? `Phiếu: ${a.payment.type}` : ""}
                                {a.payment?.account?.code ? ` • TK: ${a.payment.account.code}` : ""}
                                {a.payment?.method ? ` • ${a.payment.method}` : ""}
                                {a.payment?.refNo ? ` • Ref: ${a.payment.refNo}` : ""}
                              </div>

                              {a.payment?.note ? (
                                <div style={{ fontSize: 12, color: "#334155", fontWeight: 700, marginTop: 4 }}>{a.payment.note}</div>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={rowStyle()}>
                <div>
                  <div style={labelStyle()}>Số tiền hoàn</div>

                  <CurrencyInput
                    value={refundAmount}
                    onValueChange={(val) => {
                      userEditedRefundAmountRef.current = true;
                      setRefundAmount(val);
                    }}
                    min={0}
                    allowNegative={false}
                    className={undefined}
                    inputClassName={undefined}
                    placeholder="Nhập số tiền hoàn..."
                  />

                  <div style={{ marginTop: 6 }} />

                  {overRefund ? (
                    <div style={{ marginTop: 6, color: "#991B1B", fontWeight: 900, fontSize: 12 }}>
                      Số tiền hoàn đang vượt mức cho phép. Tối đa bạn chỉ được hoàn: {formatMoney(refundableTotalNow)} (NORMAL:{" "}
                      {formatMoney(refundableNormalNow)} • HOLD: {formatMoney(refundableHoldNow)}).
                    </div>
                  ) : null}
                </div>

                <div>
                  <div style={labelStyle()}>Tài khoản chi (tuỳ chọn)</div>
                  <select
                    style={inputStyle()}
                    value={refundAccountId}
                    onChange={(e) => setRefundAccountId(e.target.value)}
                    onFocus={(e) => applyFocusStyle(e.currentTarget)}
                    onBlur={(e) => applyBlurStyle(e.currentTarget)}
                    onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
                    onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
                  >
                    <option value="">(Không chọn)</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Partner */}
              <div style={{ marginTop: 10 }} ref={partnerBoxRef}>
                <div style={labelStyle()}>Khách hàng (bắt buộc)</div>

                {refundPartnerId ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input style={{ ...inputStyle(), background: "#F9FAFB" }} value={partnerQuery || refundInv.partnerName || ""} readOnly />
                    <button
                      style={ghostBtnStyle()}
                      onClick={() => {
                        setRefundPartnerId("");
                        setPartnerDropdownOpen(true);
                        setPartnerOptions([]);
                        resetSalesInvoiceSelection();
                      }}
                    >
                      Đổi
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <input
                      style={inputStyle()}
                      value={partnerQuery}
                      onChange={(e) => {
                        setPartnerQuery(e.target.value);
                        setPartnerDropdownOpen(true);
                      }}
                      onFocus={(e) => {
                        applyFocusStyle(e.currentTarget);
                        setPartnerDropdownOpen(true);
                        if ((partnerQuery || "").trim()) searchPartners(partnerQuery);
                      }}
                      onBlur={(e) => applyBlurStyle(e.currentTarget)}
                      onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
                      onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
                      placeholder="Gõ để tìm khách hàng..."
                    />

                    {partnerDropdownOpen ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: 6,
                          background: "#fff",
                          border: `1px solid ${inputBaseBorder}`,
                          borderRadius: 12,
                          boxShadow: "0 10px 18px rgba(0,0,0,0.10)",
                          zIndex: 10000,
                          maxHeight: 220,
                          overflowY: "auto",
                        }}
                      >
                        {partnerLoading ? (
                          <div style={{ padding: 12, color: "#64748b", fontWeight: 700 }}>Đang tìm…</div>
                        ) : partnerOptions.length === 0 ? (
                          <div style={{ padding: 12, color: "#b45309", fontWeight: 800 }}>Không có kết quả. Hãy gõ rõ hơn (tên/sđt/mã nếu có).</div>
                        ) : (
                          partnerOptions.map((p) => (
                            <div
                              key={p.id}
                              style={{ padding: "10px 12px", cursor: "pointer" }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setRefundPartnerId(p.id);
                                setPartnerQuery(p.code ? `${p.code} - ${p.name}` : p.name);
                                setPartnerDropdownOpen(false);
                                resetSalesInvoiceSelection();
                              }}
                            >
                              <div style={{ fontWeight: 900 }}>{p.code ? `${p.code} - ${p.name}` : p.name}</div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>ID: {p.id}</div>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Sales invoice gốc */}
              <div style={{ marginTop: 10 }} ref={salesInvBoxRef}>
                <div style={labelStyle()}>Hóa đơn SALES gốc (bắt buộc)</div>

                {salesInvId ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input style={{ ...inputStyle(), background: "#F9FAFB" }} value={salesInvLabel || salesInvId} readOnly />
                    <button style={ghostBtnStyle()} onClick={() => resetSalesInvoiceSelection()}>
                      Đổi
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <input
                      style={inputStyle()}
                      value={salesInvQuery}
                      onChange={(e) => {
                        setSalesInvQuery(e.target.value);
                        setSalesInvDropdownOpen(true);
                      }}
                      onFocus={(e) => {
                        applyFocusStyle(e.currentTarget);
                        setSalesInvDropdownOpen(true);
                        if (refundPartnerId) searchSalesInvoices(salesInvQuery);
                      }}
                      onBlur={(e) => applyBlurStyle(e.currentTarget)}
                      onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
                      onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
                      placeholder={refundPartnerId ? "Gõ mã hóa đơn SALES để tìm..." : "Chọn khách hàng trước để lọc hóa đơn SALES..."}
                      disabled={!refundPartnerId}
                    />

                    {salesInvDropdownOpen ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: 6,
                          background: "#fff",
                          border: `1px solid ${inputBaseBorder}`,
                          borderRadius: 12,
                          boxShadow: "0 10px 18px rgba(0,0,0,0.10)",
                          zIndex: 10000,
                          maxHeight: 240,
                          overflowY: "auto",
                        }}
                      >
                        {!refundPartnerId ? (
                          <div style={{ padding: 12, color: "#b45309", fontWeight: 800 }}>Chọn khách hàng trước.</div>
                        ) : salesInvLoading ? (
                          <div style={{ padding: 12, color: "#64748b", fontWeight: 700 }}>Đang tìm…</div>
                        ) : salesInvOptions.length === 0 ? (
                          <div style={{ padding: 12, color: "#b45309", fontWeight: 800 }}>Không có hoá đơn SALES phù hợp. Thử gõ mã hoặc bỏ trống để xem gần đây.</div>
                        ) : (
                          salesInvOptions.map((x) => {
                            const label = `${x.code} • ${formatDateDisplay(x.issueDate)} • ${formatMoney(x.total)}`;
                            return (
                              <div
                                key={x.id}
                                style={{ padding: "10px 12px", cursor: "pointer" }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setSalesInvId(x.id);
                                  setSalesInvLabel(label);
                                  setSalesInvDropdownOpen(false);
                                }}
                              >
                                <div style={{ fontWeight: 900 }}>{x.code}</div>
                                <div style={{ fontSize: 12, color: "#64748b" }}>
                                  {formatDateDisplay(x.issueDate)} • Tổng: {formatMoney(x.total)} • ID: {x.id}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                  Gợi ý: chọn đúng HĐ gốc để hệ thống tự kiểm tra “khách đã trả NORMAL/HOLD bao nhiêu” và “còn được hoàn bao nhiêu”.
                </div>
              </div>

              <div style={rowStyle()}>
                <div style={{ marginTop: 10 }}>
                  <div style={labelStyle()}>Phương thức (tuỳ chọn)</div>
                  <input
                    style={inputStyle()}
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    placeholder="Tiền mặt / CK..."
                    onFocus={(e) => applyFocusStyle(e.currentTarget)}
                    onBlur={(e) => applyBlurStyle(e.currentTarget)}
                    onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
                    onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
                  />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={labelStyle()}>Mã tham chiếu (tuỳ chọn)</div>
                  <input
                    style={inputStyle()}
                    value={refundRefNo}
                    onChange={(e) => setRefundRefNo(e.target.value)}
                    placeholder="VD: UNC..., CK..."
                    onFocus={(e) => applyFocusStyle(e.currentTarget)}
                    onBlur={(e) => applyBlurStyle(e.currentTarget)}
                    onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
                    onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
                  />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={labelStyle()}>Ghi chú</div>
                <textarea
                  style={{ ...inputStyle(), minHeight: 90, resize: "vertical" }}
                  value={refundNote}
                  onChange={(e) => setRefundNote(e.target.value)}
                  onFocus={(e) => applyFocusStyle(e.currentTarget)}
                  onBlur={(e) => applyBlurStyle(e.currentTarget)}
                  onMouseEnter={(e) => applyHoverStyle(e.currentTarget)}
                  onMouseLeave={(e) => applyLeaveStyle(e.currentTarget)}
                />
              </div>
            </div>

            <div style={modalFooterStyle()}>
              <button style={ghostBtnStyle()} onClick={closeRefund}>
                Huỷ
              </button>

              <button
                style={{
                  ...primaryBtnStyle(),
                  opacity: confirmDisabled ? 0.55 : 1,
                  cursor: confirmDisabled ? "not-allowed" : "pointer",
                }}
                onClick={confirmRefund}
                disabled={confirmDisabled}
                title={confirmDisabled ? "Kiểm tra lại số tiền hoàn / hoá đơn gốc / khách hàng" : "Xác nhận hoàn"}
              >
                Xác nhận hoàn
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
