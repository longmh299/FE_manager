// src/pages/InvoicesPage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type InvoiceType = "SALES" | "PURCHASE";
type AnyInvoiceType = "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";

type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

type PaymentAccount = {
  id: string;
  code: string;
  name: string;
};

type InvoiceListItem = {
  id: string | number;
  code: string;
  date?: string;
  type: InvoiceType;

  partnerId?: string; // ✅ NEW (để tạo payment)
  partnerName: string;

  totalAmount: number;

  paymentStatus?: PaymentStatus;
  paidAmount?: number; // ✅ paid NORMAL (collectible)

  // ✅ warranty hold (để tính "còn lại được thu")
  hasWarrantyHold?: boolean;
  warrantyHoldAmount?: number;

  status?: InvoiceStatus;
};

// ------ helpers ------
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
  return body || [];
}

function unwrapUser(res: any): any {
  const body = res?.data;
  return body?.data ?? body;
}

// ✅ hiển thị tiền theo VN: 1.000.000
function formatMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function normalizeRole(me: any) {
  return String(me?.role ?? me?.user?.role ?? me?.data?.role ?? "");
}

/**
 * ✅ remaining NORMAL (collectible) when warranty hold is enabled:
 *   collectibleTotal = total - hold
 *   remaining = collectibleTotal - paidNormal
 */
function calcCollectibleRemaining(params: {
  total: number;
  paidNormal: number;
  hasHold?: boolean;
  holdAmount?: number;
}) {
  const total = Number(params.total || 0);
  const paidNormal = Number(params.paidNormal || 0);
  const hold = params.hasHold ? Number(params.holdAmount || 0) : 0;

  const collectibleTotal = Math.max(0, total - hold);
  const remainingNormal = Math.max(0, collectibleTotal - paidNormal);

  return { hold, collectibleTotal, remainingNormal };
}

// ✅ parse input tiền: nhận cả "." "," " " -> số
function parseMoneyInputToNumber(raw: string): number {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** ========================= UI: Modal (confirm / input) ========================= **/

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

/** ========================= Page ========================= **/

type InvoiceTypeFilter = "" | "SALES" | "PURCHASE"; // "" = tất cả (nhưng vẫn chỉ trong SALES/PURCHASE)

const LS_LAST_PAY_ACCOUNT = "lastPayAccountId";

const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<InvoiceTypeFilter>("");
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);

  // role from backend
  const [role, setRole] = useState<string>(""); // admin | accountant | staff
  const isStaff = role === "staff";
  const isAdmin = role === "admin";
  const canApprove = role === "admin" || role === "accountant";

  // modal confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Xác nhận");
  const [confirmMessage, setConfirmMessage] = useState<React.ReactNode>(null);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState<InvoiceListItem | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);

  // ✅ payment accounts
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // ✅ payment modal
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<InvoiceListItem | null>(null);
  const [payAccountId, setPayAccountId] = useState<string>("");
  const [payAmount, setPayAmount] = useState<number>(0); // số thực dùng submit
  const [payAmountText, setPayAmountText] = useState<string>("0"); // ✅ hiển thị có dấu . theo VN
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [paySubmitting, setPaySubmitting] = useState(false);

  // ✅ auto focus/select input tiền khi mở modal
  const payAmountInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ highlight dòng vừa thanh toán + scroll vào dòng
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

  /**
   * ✅ Load payment accounts (active)
   * ✅ nhớ lần chọn tài khoản
   */
  const loadAccounts = async () => {
    try {
      setAccountsLoading(true);
      const res = await api.get("/payment-accounts", { params: { active: 1 } });
      const arr: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.data) ? res.data.data : [];
      const mapped: PaymentAccount[] = arr
        .map((a: any) => ({
          id: String(a.id),
          code: String(a.code || ""),
          name: String(a.name || ""),
        }))
        .filter((a) => a.id && a.id !== "undefined" && a.id !== "null");

      setAccounts(mapped);

      // restore last selected account
      let last = "";
      try {
        last = String(localStorage.getItem(LS_LAST_PAY_ACCOUNT) || "");
      } catch {}
      const canUseLast = last && mapped.some((x) => x.id === last);

      if (canUseLast) {
        setPayAccountId(last);
      } else if (!payAccountId && mapped.length > 0) {
        setPayAccountId(mapped[0].id);
      }
    } catch (err) {
      console.error("load payment accounts error", err);
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  /**
   * ✅ FIX 304 cache: luôn thêm _ts
   */
  const fetchInvoices = async (q: string, fromVal: string, toVal: string, typeVal: InvoiceTypeFilter) => {
    try {
      setLoading(true);

      const res = await api.get("/invoices", {
        params: {
          q,
          page: 1,
          pageSize: 200,
          type: typeVal || "",
          saleUserId: "",
          techUserId: "",
          from: fromVal || undefined,
          to: toVal || undefined,
          _ts: Date.now(),
        },
      });

      const data: any[] = unwrapList(res);

      // ✅ lọc bỏ return types
      const filtered = (Array.isArray(data) ? data : []).filter((x: any) => {
        const t = String(x.type || "") as AnyInvoiceType;
        if (!(t === "SALES" || t === "PURCHASE")) return false;
        if (typeVal && t !== typeVal) return false;
        return true;
      });

      const mapped: InvoiceListItem[] = filtered.map((x: any) => {
        const total = typeof x.total === "number" ? x.total : Number(x.total ?? x.totalAmount ?? x.subtotal ?? 0);
        const rawDate = x.issueDate ?? x.date ?? x.createdAt ?? "";

        return {
          id: x.id,
          code: x.code ?? "",
          date: rawDate,
          type: (x.type === "PURCHASE" ? "PURCHASE" : "SALES") as InvoiceType,

          partnerId: x.partnerId ?? x.partner?.id ?? undefined,
          partnerName: x.partner?.name ?? x.partnerName ?? "",

          totalAmount: total,

          paidAmount: x.paidAmount != null ? Number(x.paidAmount) : 0,

          hasWarrantyHold: x.hasWarrantyHold === true,
          warrantyHoldAmount: x.warrantyHoldAmount != null ? Number(x.warrantyHoldAmount) : 0,

          paymentStatus: (x.paymentStatus as PaymentStatus) ?? "UNPAID",
          status: (x.status as InvoiceStatus) ?? "DRAFT",
        };
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

  useEffect(() => {
    fetchInvoices("", "", "", "");
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ khi mở modal thì focus + select ô tiền
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

  // ✅ sau khi refresh list, scroll tới dòng vừa thanh toán + highlight
  useEffect(() => {
    if (!highlightInvoiceId) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`inv-row-${highlightInvoiceId}`);
      if (el && "scrollIntoView" in el) {
        // @ts-ignore
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 80);
    return () => clearTimeout(t);
  }, [highlightInvoiceId, invoices.length]);

  const handleApplyFilter = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    fetchInvoices(search.trim(), from, to, typeFilter);
  };

  const handleClearFilter = () => {
    const emptyFrom = "";
    const emptyTo = "";
    setFrom(emptyFrom);
    setTo(emptyTo);
    setTypeFilter("");
    fetchInvoices(search.trim(), emptyFrom, emptyTo, "");
  };

  // ===== actions =====
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
        await fetchInvoices(search.trim(), from, to, typeFilter);
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
        await fetchInvoices(search.trim(), from, to, typeFilter);
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
        await fetchInvoices(search.trim(), from, to, typeFilter);
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
        await fetchInvoices(search.trim(), from, to, typeFilter);
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

  // ✅ mở popup thanh toán (admin-only)
  const openPayModal = (inv: InvoiceListItem) => {
    if (!isAdmin) {
      toast.push({ type: "warning", title: "Không có quyền", message: "Chỉ ADMIN mới được thao tác thanh toán." });
      return;
    }

    const total = Number(inv.totalAmount || 0);
    const paidNormal = Number(inv.paidAmount || 0);
    const { remainingNormal } = calcCollectibleRemaining({
      total,
      paidNormal,
      hasHold: inv.hasWarrantyHold === true,
      holdAmount: inv.warrantyHoldAmount,
    });

    if (!inv.partnerId) {
      toast.push({
        type: "warning",
        title: "Thiếu dữ liệu",
        message: "Hóa đơn chưa có partnerId (đối tác). Không thể tạo phiếu thu/chi.",
      });
      return;
    }

    setPayTarget(inv);
    setPayAmount(remainingNormal);
    setPayAmountText(formatMoney(remainingNormal)); // ✅ có dấu .
    if (!payAccountId && accounts.length > 0) setPayAccountId(accounts[0].id);
    setPayOpen(true);
  };

  // ✅ submit payment
  const submitPayment = async () => {
    if (paySubmitting) return;
    if (!payTarget) return;

    if (!isAdmin) {
      toast.push({ type: "warning", title: "Không có quyền", message: "Chỉ ADMIN mới được thao tác thanh toán." });
      return;
    }

    const total = Number(payTarget.totalAmount || 0);
    const paidNormal = Number(payTarget.paidAmount || 0);
    const { collectibleTotal, remainingNormal } = calcCollectibleRemaining({
      total,
      paidNormal,
      hasHold: payTarget.hasWarrantyHold === true,
      holdAmount: payTarget.warrantyHoldAmount,
    });

    const amount = Number(payAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.push({ type: "warning", title: "Không hợp lệ", message: "Số tiền thanh toán phải > 0." });
      return;
    }
    if (amount > remainingNormal) {
      toast.push({
        type: "warning",
        title: "Không hợp lệ",
        message: `Số tiền thanh toán (${formatMoney(amount)}) không được vượt quá còn lại (${formatMoney(
          remainingNormal
        )}).`,
      });
      return;
    }
    if (!payAccountId) {
      toast.push({ type: "warning", title: "Thiếu dữ liệu", message: "Vui lòng chọn tài khoản thanh toán." });
      return;
    }

    try {
      localStorage.setItem(LS_LAST_PAY_ACCOUNT, String(payAccountId));
    } catch {}

    try {
      setPaySubmitting(true);

      // ✅ optimistic UI
      const nextPaid = Math.max(0, paidNormal + amount);
      const nextStatus: PaymentStatus = nextPaid >= collectibleTotal ? "PAID" : "PARTIAL";
      setInvoices((prev) =>
        prev.map((x) => {
          if (String(x.id) !== String(payTarget.id)) return x;
          return { ...x, paidAmount: nextPaid, paymentStatus: nextStatus };
        })
      );

      await api.post("/payments", {
        date: payDate,
        partnerId: String(payTarget.partnerId),
        type: payTarget.type === "PURCHASE" ? "PAYMENT" : "RECEIPT",
        amount,
        accountId: payAccountId,
        note: `Thanh toán HĐ ${payTarget.code}`,
        allocations: [{ invoiceId: String(payTarget.id), amount, kind: "NORMAL" }],
      });

      toast.push({ type: "success", title: "Thành công", message: `Đã ghi nhận thanh toán cho ${payTarget.code}.` });

      setPayOpen(false);

      const paidId = String(payTarget.id);
      setPayTarget(null);

      // ✅ highlight + scroll
      setHighlightInvoiceId(paidId);
      setTimeout(() => setHighlightInvoiceId(""), 2800);

      await fetchInvoices(search.trim(), from, to, typeFilter);
    } catch (e: any) {
      await fetchInvoices(search.trim(), from, to, typeFilter);
      toast.push({
        type: "error",
        title: "Lỗi",
        message: e?.response?.data?.message || e?.message || "Tạo phiếu thanh toán thất bại.",
      });
    } finally {
      setPaySubmitting(false);
    }
  };

  // ------ render helpers ------
  const renderPaymentBadge = (status?: PaymentStatus) => {
    const st = status || "UNPAID";
    let label = "";
    let className =
      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ";

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

  const renderStatusBadge = (status?: InvoiceStatus) => {
    const st: InvoiceStatus = status || "DRAFT";
    let label = "";
    let cls = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ";

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

  const canDelete = (inv: InvoiceListItem) => (isStaff ? inv.status === "DRAFT" : inv.status !== "APPROVED");

  const showApprovalColumn = canApprove;
  const showStaffWorkflowColumns = isStaff;

  const colCount = 7 + (showApprovalColumn ? 1 : 0) + (showStaffWorkflowColumns ? 3 : 0);

  return (
    <div className="p-4 space-y-4">
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />

      <h1 className="text-xl font-semibold mb-2">Hóa đơn</h1>

      <div className="bg-white shadow-sm rounded-md p-4">
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
              className="inline-flex items-center justify-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
            >
              + Thêm hóa đơn
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div>
              <label className="block text-xs font-semibold mb-1">Từ ngày</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Đến ngày</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Loại</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as InvoiceTypeFilter)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Tất cả</option>
                <option value="SALES">Hóa đơn bán</option>
                <option value="PURCHASE">Hóa đơn nhập</option>
              </select>
            </div>

            <div className="flex gap-2">
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

          <div className="text-xs text-gray-500">
            * Trang này chỉ hiển thị <b>Hóa đơn Bán</b> và <b>Hóa đơn Nhập</b>. Phiếu trả hàng nằm ở menu riêng.
          </div>
        </form>

        <div className="mt-4 border border-gray-200 rounded-md overflow-hidden">
          <table className="min-w-full table-fixed text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">Số HĐ</th>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">Ngày</th>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">Khách hàng</th>
                <th className="px-3 py-2 text-right text-xs font-semibold border-b border-gray-200">Tổng tiền</th>
                <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">Thanh toán</th>
                <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">Trạng thái</th>

                {showStaffWorkflowColumns && (
                  <>
                    <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">Xem</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">Gửi duyệt</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">Hủy gửi</th>
                  </>
                )}

                {showApprovalColumn && (
                  <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">Duyệt</th>
                )}

                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">Thao tác</th>
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

              {!loading && invoices.length === 0 && (
                <tr>
                  <td className="px-3 py-2 text-sm text-gray-600 border-t border-gray-200" colSpan={colCount}>
                    Không tìm thấy hóa đơn.
                  </td>
                </tr>
              )}

              {!loading &&
                invoices.map((inv) => {
                  const showSubmitBtn = isStaff && inv.status === "DRAFT";
                  const showRecallBtn = isStaff && inv.status === "SUBMITTED";

                  const showApproveBtn = canApprove && inv.status === "SUBMITTED";
                  const showRejectBtn = canApprove && inv.status === "SUBMITTED";

                  const total = Number(inv.totalAmount || 0);
                  const paidNormal = Number(inv.paidAmount || 0);
                  const { remainingNormal } = calcCollectibleRemaining({
                    total,
                    paidNormal,
                    hasHold: inv.hasWarrantyHold === true,
                    holdAmount: inv.warrantyHoldAmount,
                  });

                  const canPayBase =
                    inv.status === "APPROVED" &&
                    (inv.paymentStatus === "UNPAID" || inv.paymentStatus === "PARTIAL") &&
                    remainingNormal > 0;

                  const canPay = isAdmin && canPayBase;

                  const isHighlighted = highlightInvoiceId && String(inv.id) === String(highlightInvoiceId);

                  return (
                    <tr
                      key={inv.id}
                      id={`inv-row-${String(inv.id)}`}
                      className={
                        "odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition-colors " +
                        (isHighlighted ? "ring-2 ring-indigo-500 bg-indigo-50" : "")
                      }
                    >
                      <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap truncate">{inv.code}</td>
                      <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">{formatDateDisplay(inv.date)}</td>
                      <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap truncate">{inv.partnerName}</td>
                      <td className="px-3 py-2 border-t border-gray-200 text-right whitespace-nowrap">
                        {formatMoney(inv.totalAmount)} đ
                      </td>
                      <td className="px-3 py-2 border-t border-gray-200 text-center">{renderPaymentBadge(inv.paymentStatus)}</td>
                      <td className="px-3 py-2 border-t border-gray-200 text-center">{renderStatusBadge(inv.status)}</td>

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
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              className="px-2 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs"
                              onClick={() => navigate(`/invoices/${inv.id}`)}
                            >
                              Xem
                            </button>

                            <button
                              type="button"
                              disabled={!showApproveBtn}
                              className={
                                "px-2 py-1 rounded-md text-xs font-medium " +
                                (showApproveBtn
                                  ? "bg-green-600 text-white hover:bg-green-700"
                                  : "bg-gray-200 text-gray-400 cursor-not-allowed")
                              }
                              onClick={() => handleApprove(inv)}
                            >
                              Duyệt
                            </button>

                            <button
                              type="button"
                              disabled={!showRejectBtn}
                              className={
                                "px-2 py-1 rounded-md text-xs font-medium " +
                                (showRejectBtn
                                  ? "bg-red-600 text-white hover:bg-red-700"
                                  : "bg-gray-200 text-gray-400 cursor-not-allowed")
                              }
                              onClick={() => handleReject(inv)}
                            >
                              Từ chối
                            </button>
                          </div>
                        </td>
                      )}

                      <td className="px-3 py-2 border-t border-gray-200">
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <button
                            type="button"
                            className={"hover:underline " + (inv.status === "DRAFT" ? "text-blue-600" : "text-gray-400 cursor-not-allowed")}
                            disabled={inv.status !== "DRAFT"}
                            onClick={() => navigate(`/invoices/${inv.id}`)}
                          >
                            Sửa
                          </button>

                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => window.open(`/invoices/${inv.id}/print`, "_blank", "noopener,noreferrer")}
                          >
                            In
                          </button>

                          {canPay && (
                            <button
                              type="button"
                              className="text-indigo-600 hover:underline"
                              onClick={() => openPayModal(inv)}
                              title="Thanh toán hóa đơn"
                            >
                              Thanh toán
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={!canDelete(inv)}
                            className={"hover:underline " + (canDelete(inv) ? "text-red-600" : "text-gray-400 cursor-not-allowed")}
                            onClick={() => handleDelete(inv)}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!role && (
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
        title="Từ chối hóa đơn"
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
                  toast.push({ type: "success", title: "Đã từ chối", message: `Hóa đơn ${rejectTarget.code} đã bị từ chối.` });
                  setRejectOpen(false);
                  await fetchInvoices(search.trim(), from, to, typeFilter);
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
            Nhập lý do từ chối (có thể để trống) cho hóa đơn <b>{rejectTarget?.code}</b>:
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

      {/* Payment modal */}
      <Modal
        open={payOpen}
        title="Thanh toán hóa đơn"
        onClose={() => {
          if (paySubmitting) return;
          setPayOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm"
              onClick={() => setPayOpen(false)}
              disabled={paySubmitting}
            >
              Hủy
            </button>
            <button
              type="button"
              className={
                "px-3 py-2 rounded-md text-sm font-semibold " +
                (paySubmitting ? "bg-gray-300 text-gray-600" : "bg-indigo-600 text-white hover:bg-indigo-700")
              }
              onClick={submitPayment}
              disabled={paySubmitting}
            >
              Xác nhận thanh toán
            </button>
          </div>
        }
      >
        {payTarget ? (
          (() => {
            const total = Number(payTarget.totalAmount || 0);
            const paidNormal = Number(payTarget.paidAmount || 0);
            const { hold, collectibleTotal, remainingNormal } = calcCollectibleRemaining({
              total,
              paidNormal,
              hasHold: payTarget.hasWarrantyHold === true,
              holdAmount: payTarget.warrantyHoldAmount,
            });

            return (
              <div className="space-y-3 text-sm text-gray-700">
                {!isAdmin ? (
                  <div className="p-3 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm">
                    Chỉ <b>ADMIN</b> mới được thao tác thanh toán.
                  </div>
                ) : null}

                {isAdmin && accounts.length === 0 && (
                  <div className="p-3 rounded-md border border-yellow-200 bg-yellow-50 text-yellow-800 text-sm">
                    Chưa có <b>tài khoản thanh toán</b>. Vui lòng tạo tài khoản trong mục Payment Accounts trước.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-gray-500">Số hóa đơn</div>
                    <div className="font-semibold">{payTarget.code}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Loại</div>
                    <div className="font-semibold">{payTarget.type === "PURCHASE" ? "Nhập hàng (chi)" : "Bán hàng (thu)"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-md border bg-gray-50">
                    <div className="text-xs text-gray-500">Tổng tiền</div>
                    <div className="font-semibold">{formatMoney(total)} đ</div>
                  </div>
                  <div className="p-2 rounded-md border bg-gray-50">
                    <div className="text-xs text-gray-500">Đã thanh toán</div>
                    <div className="font-semibold">{formatMoney(paidNormal)} đ</div>
                  </div>
                  <div className="p-2 rounded-md border bg-gray-50">
                    <div className="text-xs text-gray-500">Còn lại</div>
                    <div className="font-semibold text-indigo-700">{formatMoney(remainingNormal)} đ</div>
                  </div>
                </div>

                {payTarget.hasWarrantyHold && hold > 0 ? (
                  <div className="text-xs text-gray-600">
                    * Giữ lại bảo hành: <b>{formatMoney(hold)} đ</b>. Số được thu tối đa (NORMAL):{" "}
                    <b>{formatMoney(collectibleTotal)} đ</b>.
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Ngày thanh toán</label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                      disabled={!isAdmin || paySubmitting}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">Tài khoản thanh toán</label>
                    <select
                      value={payAccountId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPayAccountId(v);
                        try {
                          localStorage.setItem(LS_LAST_PAY_ACCOUNT, String(v));
                        } catch {}
                      }}
                      className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                      disabled={!isAdmin || accountsLoading || paySubmitting}
                    >
                      {accounts.length === 0 ? (
                        <option value="">Chưa có tài khoản</option>
                      ) : (
                        accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} - {a.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Số tiền thanh toán</label>
                  <input
                    ref={payAmountInputRef}
                    type="text"
                    inputMode="numeric"
                    value={payAmountText}
                    onChange={(e) => {
                      const raw = e.target.value || "";
                      const n = parseMoneyInputToNumber(raw);
                      setPayAmount(n);
                      setPayAmountText(formatMoney(n));
                    }}
                    className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                    disabled={!isAdmin || paySubmitting}
                    placeholder="0"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    * Mặc định = số tiền còn lại. Có thể nhập nhỏ hơn để tiếp tục “thanh toán một phần”.
                  </div>
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>
    </div>
  );
};

export default InvoicesPage;
