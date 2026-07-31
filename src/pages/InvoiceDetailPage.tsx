// src/pages/InvoiceDetailPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type InvoiceType = "SALES" | "PURCHASE";
type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

type ReturnMeta = {
  state: "NONE" | "PARTIAL" | "FULL";
  debtIgnore: boolean;
  returnedTotal: number;
  netTotal: number;
  holdAmount: number;
  collectible: number;
};

type Partner = {
  id: string;
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  taxCode?: string;
  email?: string;
};

type Item = {
  id: string;
  sku?: string;
  name: string;
  unit?: string;
  price?: number;
  stockQty?: number; // ✅ tổng tồn kho (tất cả kho) — hiện trong gợi ý + cảnh báo hết hàng
};

type InvoiceLine = {
  id?: string;
  itemId?: string;
  itemName: string;
  unit?: string;
  qty: number;
  price: number;
};

type StaffUser = {
  id: string;
  name: string;
};

type PaymentAccount = {
  id: string;
  code: string;
  name: string;
  type?: string;
  isActive?: boolean;
};

type Invoice = {
  id: string | number | null;
  code: string;
  date?: string;
  type: InvoiceType;

  partnerId?: string;
  partnerName: string;
  partnerCode?: string;
  partnerAddress?: string;
  partnerPhone?: string;
  partnerTaxCode?: string;
  partnerEmail?: string;

  saleUserId?: string | null;
  techUserId?: string | null;

  lines: InvoiceLine[];

  subtotal?: number;
  tax?: number;
  taxPercent?: number;
  totalAmount: number;

  paymentStatus?: PaymentStatus;
  paidAmount?: number;

  receiveAccountId?: string | null;
  note?: string;

  status?: InvoiceStatus;

  hasWarrantyHold?: boolean;
  warrantyHoldAmount?: number;
  warrantyDueDate?: string | null;

  returnMeta?: ReturnMeta;
};

/** ========================= Payment history types ========================= **/
type PaymentAllocation = {
  invoiceId: string;
  amount: number;
  invoice?: { id: string; code?: string };
};

type PaymentRow = {
  id: string;
  date?: string;
  createdAt?: string;
  type?: string;
  amount?: number;
  refNo?: string | null;
  method?: string | null;
  note?: string | null;
  account?: { id: string; code?: string; name?: string } | null;
  allocations?: PaymentAllocation[];
};

function validatePurchasePrice(inv: Invoice) {
  if (inv.type !== "PURCHASE") return { ok: true as const };

  const badIndex = inv.lines.findIndex((l) => {
    const qty = Number(l.qty || 0);
    const price = Number(l.price || 0);
    return qty > 0 && price <= 0;
  });

  if (badIndex >= 0) {
    return {
      ok: false as const,
      message: `Hóa đơn nhập: Dòng #${badIndex + 1} chưa nhập giá. 
Bắt buộc nhập giá để tránh sai giá vốn trung bình.`,
    };
  }

  return { ok: true as const };
}

/** ========================= Money input helpers ========================= **/
function fmtMoneyInput(v: number | string | null | undefined) {
  const n = Number(String(v ?? "").replace(/[^\d\-]/g, "")) || 0;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
function parseMoneyInput(s: string) {
  return Number(String(s ?? "").replace(/[^\d\-]/g, "")) || 0;
}

/** ========================= Component: Price input per line ========================= **/
const LinePriceInput: React.FC<{
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  styleInput?: React.CSSProperties;
}> = ({ value, disabled, onChange, styleInput }) => {
  const [text, setText] = useState(fmtMoneyInput(value));

  useEffect(() => setText(fmtMoneyInput(value)), [value]);

  return (
    <input
      style={styleInput}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const raw = parseMoneyInput(e.target.value);
        setText(fmtMoneyInput(raw));
        onChange(raw);
      }}
      onBlur={() => setText(fmtMoneyInput(value))}
      inputMode="numeric"
    />
  );
};

/** ========================= Paid amount input ========================= **/
const PaidAmountInput: React.FC<{
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  styleInput?: React.CSSProperties;
}> = ({ value, disabled, onChange, styleInput }) => {
  const [text, setText] = useState(fmtMoneyInput(value));
  useEffect(() => setText(fmtMoneyInput(value)), [value]);

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          width: "100%",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          overflow: "hidden",
          background: disabled ? "#f8fafc" : "#fff",
          boxSizing: "border-box",
        }}
      >
        <input
          style={{
            padding: "5px 8px",
            fontSize: 13,
            boxSizing: "border-box",
            flex: 1,
            minWidth: 0,
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            ...(styleInput || {}),
            borderColor: undefined,
          }}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const raw = parseMoneyInput(e.target.value);
            setText(fmtMoneyInput(raw));
            onChange(raw);
          }}
          onBlur={() => setText(fmtMoneyInput(value))}
          inputMode="numeric"
        />
        <span
          style={{
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
            borderLeft: "1px solid #e5e7eb",
            background: "#f9fafb",
            color: "#374151",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          đ
        </span>
      </div>
    </div>
  );
};

/** ========================= Warranty hold input ========================= **/
const WarrantyHoldInput: React.FC<{
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  styleInput?: React.CSSProperties;
}> = ({ value, disabled, onChange, styleInput }) => {
  const [text, setText] = useState(fmtMoneyInput(value));
  useEffect(() => setText(fmtMoneyInput(value)), [value]);

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          width: "100%",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          overflow: "hidden",
          background: disabled ? "#f8fafc" : "#fff",
          boxSizing: "border-box",
        }}
      >
        <input
          style={{
            padding: "5px 8px",
            fontSize: 13,
            boxSizing: "border-box",
            flex: 1,
            minWidth: 0,
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            ...(styleInput || {}),
            borderColor: undefined,
          }}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const raw = Math.max(0, parseMoneyInput(e.target.value));
            setText(fmtMoneyInput(raw));
            onChange(raw);
          }}
          onBlur={() => setText(fmtMoneyInput(value))}
          inputMode="numeric"
        />
        <span
          style={{
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
            borderLeft: "1px solid #e5e7eb",
            background: "#f9fafb",
            color: "#374151",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          đ
        </span>
      </div>
    </div>
  );
};

// unwrap { ok: true, data: ... } OR direct
function unwrap<T = any>(res: any): T {
  const body = res?.data;
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}

// ✅ Bỏ dấu tiếng Việt + chuẩn hoá khoảng trắng — dùng để tìm sản phẩm không phân biệt
// có/không dấu, hoa/thường, thừa khoảng trắng (fix lỗi gõ "may ep" không ra "Máy ép").
const VN_DIACRITIC_MAP: Record<string, string> = {
  à: "a", á: "a", ạ: "a", ả: "a", ã: "a", â: "a", ầ: "a", ấ: "a", ậ: "a", ẩ: "a", ẫ: "a",
  ă: "a", ằ: "a", ắ: "a", ặ: "a", ẳ: "a", ẵ: "a",
  è: "e", é: "e", ẹ: "e", ẻ: "e", ẽ: "e", ê: "e", ề: "e", ế: "e", ệ: "e", ể: "e", ễ: "e",
  ì: "i", í: "i", ị: "i", ỉ: "i", ĩ: "i",
  ò: "o", ó: "o", ọ: "o", ỏ: "o", õ: "o", ô: "o", ồ: "o", ố: "o", ộ: "o", ổ: "o", ỗ: "o",
  ơ: "o", ờ: "o", ớ: "o", ợ: "o", ở: "o", ỡ: "o",
  ù: "u", ú: "u", ụ: "u", ủ: "u", ũ: "u", ư: "u", ừ: "u", ứ: "u", ự: "u", ử: "u", ữ: "u",
  ỳ: "y", ý: "y", ỵ: "y", ỷ: "y", ỹ: "y",
  đ: "d",
};

function normalizeVN(raw: string): string {
  const lower = (raw || "").trim().toLowerCase();
  const noDiacritic = lower.replace(/[à-ỹđ]/g, (c) => VN_DIACRITIC_MAP[c] || c);
  return noDiacritic.replace(/\s+/g, " ").trim();
}

// ✅ Tô đậm phần khớp với từ khoá tìm kiếm, kể cả khi gõ không dấu.
// Nhờ removeDiacritics là ánh xạ 1-ký-tự-đổi-1-ký-tự (không đổi độ dài chuỗi),
// vị trí tìm được trên chuỗi ĐÃ bỏ dấu áp thẳng lại được lên chuỗi GỐC có dấu.
function highlightMatches(original: string, tokens: string[]): React.ReactNode {
  if (!original || tokens.length === 0) return original;
  const normalized = normalizeVN(original);

  const ranges: Array<[number, number]> = [];
  for (const t of tokens) {
    if (!t) continue;
    let from = 0;
    while (true) {
      const idx = normalized.indexOf(t, from);
      if (idx === -1) break;
      ranges.push([idx, idx + t.length]);
      from = idx + t.length;
    }
  }
  if (ranges.length === 0) return original;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) nodes.push(original.slice(cursor, start));
    nodes.push(<b key={i}>{original.slice(start, end)}</b>);
    cursor = end;
  });
  if (cursor < original.length) nodes.push(original.slice(cursor));
  return nodes;
}

function normalizeDateForInput(raw?: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split("/");
    return `${y}-${m}-${d}`;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTimeDisplay(raw?: string) {
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y} 00:00:00`;
  }

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;

  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();

  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function formatMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function toNum(v: any) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

function safeId(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

function getReturnState(inv: Invoice | null) {
  if (!inv || inv.type !== "SALES") return "NONE" as const;
  return inv.returnMeta?.state ?? ("NONE" as const);
}
function isReturnedFull(inv: Invoice | null) {
  return getReturnState(inv) === "FULL";
}

function calcCollectible(inv: Invoice) {
  if (inv.type === "SALES" && inv.returnMeta) return Math.max(0, toNum(inv.returnMeta.collectible));
  const total = Math.max(0, toNum(inv.totalAmount));
  const hold = inv.hasWarrantyHold ? Math.max(0, toNum(inv.warrantyHoldAmount)) : 0;
  return Math.max(0, total - hold);
}

// -------- styles ----------
const styles: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  header: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb" },
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 },
  body: {
    flex: 1,
    minHeight: 0,
    padding: "12px 16px",
    display: "flex",
    justifyContent: "center",
    overflowY: "auto",
  },
  content: { width: "100%", maxWidth: 900 },
  backBtn: {
    border: "none",
    background: "none",
    color: "#2563eb",
    cursor: "pointer",
    padding: 0,
    marginBottom: 12,
    fontSize: 14,
  },
  form: { display: "flex", flexDirection: "column", gap: 10, fontSize: 14 },
  sectionBox: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 12,
    background: "#ffffff",
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: 8,
    borderBottom: "1px solid #f3f4f6",
    paddingBottom: 4,
  },
  formRow: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 },
  rowInline: { display: "flex", gap: 12 },
  flex1: { flex: 1 },
  label: { fontWeight: 500, fontSize: 13 },
  input: {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  },
  select: {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 14,
    background: "#fff",
    width: "100%",
    boxSizing: "border-box",
  },
  autoWrapper: { position: "relative" },
  suggestBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    maxHeight: 160,
    overflowY: "auto",
    zIndex: 30,
    marginTop: 2,
    boxShadow: "0 4px 10px rgba(0,0,0,0.04)",
  },
  suggestItem: { padding: "4px 8px", fontSize: 13, cursor: "pointer" },
  suggestItemMuted: { padding: "4px 8px", fontSize: 12, color: "#9ca3af" },

  gridHeader: {
    display: "grid",
    gridTemplateColumns: "4fr 1fr 2fr 2fr 70px",
    columnGap: 8,
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    padding: "4px 6px",
    background: "#f9fafb",
    borderRadius: 4,
    alignItems: "center",
  },
  gridRow: {
    display: "grid",
    gridTemplateColumns: "4fr 1fr 2fr 2fr 70px",
    columnGap: 8,
    alignItems: "center",
    marginBottom: 6,
    padding: "4px 6px",
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
  },
  smallInput: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 13,
    boxSizing: "border-box",
  },
  smallBtn: {
    padding: "2px 6px",
    borderRadius: 4,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    cursor: "pointer",
    fontSize: 11,
    width: "100%",
    boxSizing: "border-box",
  },
  addLineBtn: {
    marginTop: 8,
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px dashed #2563eb",
    background: "#eff6ff",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 12,
    width: "100%",
    textAlign: "center",
  },
  totalBox: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    fontSize: 13,
    boxSizing: "border-box",
    background: "#f9fafb",
    textAlign: "right",
    whiteSpace: "nowrap",
  },

  summaryRow: {
    display: "grid",
    gridTemplateColumns: "220px minmax(260px, 360px) 1fr",
    columnGap: 12,
    alignItems: "center",
    marginTop: 6,
    fontSize: 13,
  },
  summaryLabel: { fontWeight: 500, textAlign: "left" },
  summaryValue: { width: "100%", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" },

  formActions: { display: "flex", justifyContent: "space-between", marginTop: 12, gap: 8 },
  primaryBtn: {
    padding: "6px 16px",
    borderRadius: 4,
    border: "none",
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  secondaryBtn: {
    padding: "6px 12px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  secondarySmallBtn: {
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },

  postStatusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },

  notice: { marginTop: 8, padding: "8px 10px", borderRadius: 4, fontSize: 13 },
  noticeSuccess: { background: "#ecfdf3", border: "1px solid #22c55e", color: "#166534" },
  noticeError: { background: "#fef2f2", border: "1px solid #f87171", color: "#b91c1c" },
};

function dangerBtn(disabled?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 4,
    border: "none",
    background: disabled ? "rgba(239, 68, 68, 0.35)" : "#ef4444",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
    fontWeight: 700,
  };
}
function primarySmallBtn(disabled?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 4,
    border: "none",
    background: disabled ? "rgba(37, 99, 235, 0.35)" : "#2563eb",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
    fontWeight: 700,
  };
}

/** ========================= Modals ========================= **/
const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 14,
  zIndex: 2000,
};
const modalCard: React.CSSProperties = {
  width: "min(560px, 96vw)",
  borderRadius: 10,
  background: "#fff",
  border: "1px solid #e5e7eb",
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  maxHeight: "86vh",
};
const modalHeader: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #f3f4f6",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 8,
};
const modalTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14 };
const modalCloseBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
  lineHeight: 1.1,
};
const modalBody: React.CSSProperties = { padding: 12, overflow: "auto" };
const modalFooter: React.CSSProperties = {
  padding: 12,
  borderTop: "1px solid #f3f4f6",
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  background: "#fff",
};

const ConfirmModal: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}> = ({ open, title, message, confirmText = "Xác nhận", cancelText = "Hủy", tone = "default", busy, onConfirm, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") {
        if (!busy) onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose, onConfirm]);

  if (!open) return null;

  return (
    <div style={modalOverlay} onMouseDown={onClose}>
      <div style={modalCard} onMouseDown={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div>
            <div style={modalTitle}>{title}</div>
            <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>{message}</div>
          </div>
          <button style={modalCloseBtn} onClick={onClose} disabled={!!busy} title="Đóng (ESC)">
            ✕
          </button>
        </div>

        <div style={modalBody} />

        <div style={modalFooter}>
          <button style={styles.secondarySmallBtn} onClick={onClose} disabled={!!busy}>
            {cancelText}
          </button>
          <button
            style={tone === "danger" ? dangerBtn(!!busy) : primarySmallBtn(!!busy)}
            onClick={onConfirm}
            disabled={!!busy}
          >
            {busy ? "Đang xử lý..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

const PromptModal: React.FC<{
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  busy?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}> = ({ open, title, message, placeholder = "", defaultValue = "", confirmText = "Xác nhận", cancelText = "Hủy", busy, onConfirm, onClose }) => {
  const [val, setVal] = useState(defaultValue);

  useEffect(() => {
    if (open) setVal(defaultValue || "");
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") {
        if (!busy) onConfirm(val);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose, onConfirm, val]);

  if (!open) return null;

  return (
    <div style={modalOverlay} onMouseDown={onClose}>
      <div style={modalCard} onMouseDown={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div>
            <div style={modalTitle}>{title}</div>
            {message ? <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>{message}</div> : null}
          </div>
          <button style={modalCloseBtn} onClick={onClose} disabled={!!busy} title="Đóng (ESC)">
            ✕
          </button>
        </div>

        <div style={modalBody}>
          <textarea
            style={{ ...styles.input, minHeight: 90, resize: "vertical" }}
            placeholder={placeholder}
            value={val}
            disabled={!!busy}
            onChange={(e) => setVal(e.target.value)}
            autoFocus
          />
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
            (Có thể để trống. Nhấn <b>Enter</b> để xác nhận, <b>ESC</b> để đóng.)
          </div>
        </div>

        <div style={modalFooter}>
          <button style={styles.secondarySmallBtn} onClick={onClose} disabled={!!busy}>
            {cancelText}
          </button>
          <button style={primarySmallBtn(!!busy)} onClick={() => onConfirm(val)} disabled={!!busy}>
            {busy ? "Đang xử lý..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

function calcTotal(lines: InvoiceLine[]) {
  return lines.reduce((s, l) => s + l.qty * l.price, 0);
}
function recalcTotals(lines: InvoiceLine[], taxPercent?: number) {
  const subtotal = calcTotal(lines);
  let tax = 0;
  if (taxPercent && taxPercent > 0) tax = Math.round((subtotal * taxPercent) / 100);
  const totalAmount = subtotal + tax;
  return { subtotal, tax, totalAmount };
}
function createEmptyInvoice(): Invoice {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: null,
    code: "",
    date: today,
    type: "SALES",
    partnerName: "",
    partnerCode: "",
    lines: [],
    subtotal: 0,
    tax: 0,
    taxPercent: 0,
    totalAmount: 0,
    paymentStatus: "UNPAID",
    paidAmount: 0,
    receiveAccountId: null,
    note: "",
    status: "DRAFT",
    hasWarrantyHold: false,
    warrantyHoldAmount: 0,
    warrantyDueDate: null,
    returnMeta: undefined,
  };
}

const DEFAULT_HOLD_PCT = 0.05;

const InvoiceDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id || id === "new";
  
  const { toasts, push, remove } = useToast();
  const toastSuccess = (message: string, title = "Thành công") => push({ type: "success", title, message });
  const toastError = (message: string, title = "Có lỗi") => push({ type: "error", title, message });
  const toastWarning = (message: string, title = "Lưu ý") => push({ type: "warning", title, message });

  // const gotoListSoon = () => setTimeout(() => navigate("/invoices"), 350);

  const gotoListSoon = (type: string) =>
  setTimeout(() => navigate(`/invoices?type=${type}`), 350);

  // ✅ detect adjust-mode by query (?adjust=1 | ?adjust=true | ?mode=adjust)
  const isAdjustMode = useMemo(() => {
    const sp = new URLSearchParams(location.search || "");
    const a = String(sp.get("adjust") || "").toLowerCase();
    const m = String(sp.get("mode") || "").toLowerCase();
    return a === "1" || a === "true" || m === "adjust" || m === "adjustment";
  }, [location.search]);

  // ✅ AUTH: lấy role từ BE (/me), fallback localStorage
  const [me, setMe] = useState<{ id?: string; role?: string }>({});
  const isAdmin = String(me.role || "").trim().toLowerCase() === "admin";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // ✅ ref tới ô Số lượng của từng dòng, để tự nhảy focus sau khi chọn sản phẩm
  const qtyInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // ✅ chỉ mục tìm kiếm đã chuẩn hoá (bỏ dấu) — tính 1 lần khi `items` đổi,
  // không tính lại mỗi lần gõ phím trong ô tìm sản phẩm.
  const itemsSearchIndex = useMemo(
    () =>
      items.map((it) => ({
        item: it,
        normName: normalizeVN(it.name || ""),
        normSku: normalizeVN(it.sku || ""),
      })),
    [items]
  );

  const [staffs, setStaffs] = useState<StaffUser[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);

  /** ========================= Early stock check (FE warning only) ========================= **/
  const [, setStockCheckLoading] = useState(false);
  const [, setStockCheckError] = useState<string | null>(null);
  const [, setStockQtyMap] = useState<Record<string, number>>({}); // itemId -> qty

  const partnerInputRef = useRef<HTMLInputElement | null>(null);

  function uniqStr(arr: (string | null | undefined)[]) {
    const s = new Set<string>();
    for (const x of arr) {
      const v = String(x ?? "").trim();
      if (v) s.add(v);
    }
    return Array.from(s);
  }

  async function fetchStockQtyMap(itemIds: string[], warehouseId?: string | null) {
    // FE warning only: try multiple endpoints; if all fail => throw
    const ids = uniqStr(itemIds);
    if (!ids.length) return {};

    const tryGet = async (url: string, params: any) => {
      const res = await api.get(url, { params });
      return unwrap<any>(res);
    };

    // 1) /stocks?warehouseId=&itemIds=1,2,3
    try {
      const data = await tryGet("/stocks", {
        warehouseId: warehouseId || undefined,
        itemIds: ids.join(","),
      });

      const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const map: Record<string, number> = {};
      for (const r of arr) {
        const id = String(r.itemId ?? r.item?.id ?? "");
        if (!id) continue;
        map[id] = toNum(r.qty);
      }
      if (Object.keys(map).length) return map;
    } catch { }

    // 2) /stock?locationId=&itemIds=...
    try {
      const data = await tryGet("/stock", {
        locationId: warehouseId || undefined,
        itemIds: ids.join(","),
      });
      const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const map: Record<string, number> = {};
      for (const r of arr) {
        const id = String(r.itemId ?? r.item?.id ?? "");
        if (!id) continue;
        map[id] = toNum(r.qty);
      }
      if (Object.keys(map).length) return map;
    } catch { }

    // 3) POST /stocks/check { warehouseId, itemIds }
    try {
      const res = await api.post("/stocks/check", {
        warehouseId: warehouseId || undefined,
        itemIds: ids,
      });
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const map: Record<string, number> = {};
      for (const r of arr) {
        const id = String(r.itemId ?? r.item?.id ?? "");
        if (!id) continue;
        map[id] = toNum(r.qty);
      }
      if (Object.keys(map).length) return map;
    } catch { }

    throw new Error("Không tìm thấy API tồn kho phù hợp (FE check warning).");
  }

  const [showPartnerSuggest, setShowPartnerSuggest] = useState(false);
  const [openItemSuggestIndex, setOpenItemSuggestIndex] = useState<number | null>(null);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [accountLoadError, setAccountLoadError] = useState<string | null>(null);
  const [dirtySinceLastSave, setDirtySinceLastSave] = useState(false);

  const [warrantyHoldManual, setWarrantyHoldManual] = useState(false);

  /** ========================= Payment history state ========================= **/
  const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(false);
  const [paymentHistoryError, setPaymentHistoryError] = useState<string | null>(null);
  const [paymentHistoryRows, setPaymentHistoryRows] = useState<
    Array<
      PaymentRow & {
        allocatedAmount: number;
      }
    >
  >([]);

  /** ========================= Confirm/Prompt modal state ========================= **/
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmCfg, setConfirmCfg] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptCfg, setPromptCfg] = useState<{
    title: string;
    message?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: (value: string) => Promise<void> | void;
  } | null>(null);

  function openConfirm(cfg: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  }) {
    setConfirmCfg(cfg);
    setConfirmBusy(false);
    setConfirmOpen(true);
  }
  function closeConfirm() {
    if (confirmBusy) return;
    setConfirmOpen(false);
    setConfirmCfg(null);
  }

  function openPrompt(cfg: {
    title: string;
    message?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: (value: string) => Promise<void> | void;
  }) {
    setPromptCfg(cfg);
    setPromptBusy(false);
    setPromptOpen(true);
  }
  function closePrompt() {
    if (promptBusy) return;
    setPromptOpen(false);
    setPromptCfg(null);
  }

  function markDirty() {
    setDirtySinceLastSave(true);
    setMessage(null);
  }

  function defaultHoldAmountFromSubtotal(subtotal: number) {
    return Math.round(Math.max(0, Number(subtotal || 0)) * DEFAULT_HOLD_PCT);
  }

  function recomputeInvoiceCore(prev: Invoice, nextPartial?: Partial<Invoice>) {
    const next: Invoice = { ...prev, ...(nextPartial || {}) };

    const { subtotal, tax, totalAmount } = recalcTotals(next.lines, next.taxPercent);
    next.subtotal = subtotal;
    next.tax = tax;
    next.totalAmount = totalAmount;

    if (next.hasWarrantyHold) {
      if (!warrantyHoldManual) {
        next.warrantyHoldAmount = defaultHoldAmountFromSubtotal(subtotal);
      } else {
        next.warrantyHoldAmount = Math.max(0, Number(next.warrantyHoldAmount || 0));
      }
    } else {
      next.warrantyHoldAmount = 0;
    }

    return next;
  }

  // ✅ load /me để lấy role (quan trọng)
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await api.get("auth/me");
        const u = unwrap<any>(res);
        const role = u?.role ?? u?.data?.role;
        const uid = u?.id ?? u?.data?.id;
        if (mounted) setMe({ id: uid ? String(uid) : undefined, role: role ? String(role) : undefined });
        return;
      } catch { }

      try {
        const res2 = await api.get("/auth/me");
        const u2 = unwrap<any>(res2);
        const role2 = u2?.role ?? u2?.data?.role;
        const uid2 = u2?.id ?? u2?.data?.id;
        if (mounted) setMe({ id: uid2 ? String(uid2) : undefined, role: role2 ? String(role2) : undefined });
        return;
      } catch { }

      // fallback localStorage
      try {
        const raw = localStorage.getItem("user") || localStorage.getItem("authUser");
        if (raw) {
          const u = JSON.parse(raw);
          if (mounted) setMe({ id: u?.id ? String(u.id) : undefined, role: u?.role ? String(u.role) : undefined });
        }
      } catch { }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        await Promise.all([loadPartners(), loadItems(), loadStaffs(), loadPaymentAccounts(), loadInvoiceIfNeeded()]);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!invoice) return;
    if ((invoice.status ?? "DRAFT") !== "DRAFT") {
      // không check khi đã submitted/approved để tránh hiểu nhầm
      setStockCheckError(null);
      setStockCheckLoading(false);
      return;
    }

    const itemIds = invoice.lines.map((l) => safeId(l.itemId)).filter(Boolean) as string[];
    if (!itemIds.length) {
      setStockQtyMap({});
      setStockCheckError(null);
      return;
    }

    // debounce 350ms
    let alive = true;
    const t = setTimeout(async () => {
      try {
        setStockCheckLoading(true);
        setStockCheckError(null);

        // nếu FE chưa có chọn kho, để undefined => BE sẽ dùng default warehouse
        const map = await fetchStockQtyMap(itemIds, (invoice as any).warehouseId ?? null);

        if (!alive) return;
        setStockQtyMap(map || {});
      } catch (e: any) {
        if (!alive) return;
        // warning-only: đừng làm app đỏ lòm, chỉ ghi nhẹ
        setStockQtyMap({});
        setStockCheckError(e?.message || "Không check được tồn kho.");
      } finally {
        if (alive) setStockCheckLoading(false);
      }
    }, 350);

    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.lines]);

  useEffect(() => {
    if (!invoice?.id || isCreate) {
      setPaymentHistoryRows([]);
      setPaymentHistoryError(null);
      setPaymentHistoryLoading(false);
      return;
    }
    loadPaymentHistoryForInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  async function loadPartners() {
    try {
      const res = await api.get("/partners", { params: { q: "", page: 1, pageSize: 100 } });
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const mapped: Partner[] = arr.map((p: any) => ({
        id: String(p.id),
        name: p.name,
        code: p.code,
        address: p.address,
        phone: p.phone,
        taxCode: p.taxCode,
        email: p.email,
      }));
      setPartners(mapped);
    } catch (err) {
      console.error("loadPartners error", err);
    }
  }

  async function loadItems() {
    try {
      const res = await api.get("/items", { params: { q: "", page: 1, pageSize: 1000 } });
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const mapped: Item[] = arr.map((i: any) => ({
        id: String(i.id),
        sku: i.sku || i.code,
        name: i.name,
        unit: i.unit,
        // ✅ non-admin API chỉ trả sellPrice (không có price) — fallback để không bị mất giá
        price: Number(i.sellPrice ?? i.price ?? 0),
        stockQty: Number(i.stockQty ?? 0),
      }));
      setItems(mapped);
    } catch (err) {
      console.error("loadItems error", err);
    }
  }

  const goBackToInvoices = () => {
    // ✅ Ưu tiên back thật (giữ filter/type/page đúng như lúc vào)
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    // ✅ Fallback: nếu user vào thẳng link detail (không có history)
    const s = (location.state as any)?.returnSearch || "";
    navigate(`/invoices${s}`);
  };

  async function loadStaffs() {
    try {
      const res = await api.get("/users", { params: { page: 1, pageSize: 200 } });
      const data = unwrap<any>(res);

      const arr: any[] =
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data?.data?.items) && data.data.items) ||
        (Array.isArray(data?.data) && data.data) ||
        (Array.isArray(data) && data) ||
        [];

      const mapped: StaffUser[] = arr
        .filter((u) => u && (u.role === "staff" || u.role === "accountant" || u.role === "admin"))
        .map((u) => ({ id: String(u.id), name: String(u.username || u.name || u.email || u.id) }))
        .filter((u) => safeId(u.id));

      setStaffs(mapped);
    } catch (err) {
      console.error("loadStaffs error", err);
      setStaffs([]);
    }
  }

  async function loadPaymentAccounts() {
    try {
      setAccountLoadError(null);

      const res = await api.get("/payment-accounts", { params: { active: 1 } });
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

      const mapped: PaymentAccount[] = arr
        .map((a: any) => ({
          id: String(a.id),
          code: String(a.code || ""),
          name: String(a.name || ""),
          type: a.type,
          isActive: a.isActive,
        }))
        .filter((a) => safeId(a.id));

      setAccounts(mapped);
    } catch (err: any) {
      console.error("loadPaymentAccounts error", err);
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Không tải được danh sách tài khoản nhận tiền.";
      setAccountLoadError(msg);
      setAccounts([]);
    }
  }

  async function loadInvoiceIfNeeded() {
    if (isCreate) {
      setInvoice(createEmptyInvoice());
      setDirtySinceLastSave(false);
      setWarrantyHoldManual(false);
      return;
    }
    if (!id) return;

    try {
      const res = await api.get(`/invoices/${id}`);
      const x = unwrap<any>(res);

      const lines: InvoiceLine[] =
        x.lines?.map((l: any) => ({
          id: l.id,
          itemId: l.itemId,
          itemName: l.item?.name ?? l.itemName ?? "",
          unit: l.item?.unit ?? l.unit,
          qty: Number(l.qty ?? 0),
          price: Number(l.unitPrice ?? l.price ?? 0),
        })) ?? [];

      const subtotalFromApi = x.subtotal != null ? Number(x.subtotal) : calcTotal(lines);
      const taxFromApi = x.tax != null ? Number(x.tax) : 0;
      const totalFromApi = x.total != null ? Number(x.total) : subtotalFromApi + taxFromApi;

      let taxPercent = 0;
      if (subtotalFromApi > 0 && taxFromApi > 0) taxPercent = +((taxFromApi * 100) / subtotalFromApi).toFixed(2);

      const rawDate = x.date ?? x.issueDate ?? x.createdAt ?? "";
      const normalizedDate = normalizeDateForInput(rawDate);

      const status: InvoiceStatus = (x.status as InvoiceStatus) ?? "DRAFT";

      const rm: ReturnMeta | undefined = x.returnMeta
        ? {
          state: String(x.returnMeta.state || "NONE") as any,
          debtIgnore: !!x.returnMeta.debtIgnore,
          returnedTotal: toNum(x.returnMeta.returnedTotal),
          netTotal: toNum(x.returnMeta.netTotal),
          holdAmount: toNum(x.returnMeta.holdAmount),
          collectible: toNum(x.returnMeta.collectible),
        }
        : undefined;

      const inv: Invoice = {
        id: x.id,
        code: x.code ?? "",
        date: normalizedDate,
        type: (x.type === "PURCHASE" ? "PURCHASE" : "SALES") as InvoiceType,

        partnerId: x.partnerId,
        partnerName: x.partner?.name ?? x.partnerName ?? "",
        partnerCode: x.partner?.code ?? x.partnerCode ?? "",
        partnerAddress: x.partner?.address ?? x.partnerAddr ?? x.partnerAddress,
        partnerPhone: x.partner?.phone ?? x.partnerPhone,
        partnerTaxCode: x.partner?.taxCode ?? x.partnerTax ?? x.partnerTaxCode,
        partnerEmail: x.partner?.email ?? x.partnerEmail,

        saleUserId: x.saleUserId ?? null,
        techUserId: x.techUserId ?? null,

        lines,
        subtotal: subtotalFromApi,
        tax: taxFromApi,
        taxPercent,
        totalAmount: totalFromApi,

        paymentStatus: (x.paymentStatus as PaymentStatus) ?? "UNPAID",
        paidAmount: x.paidAmount != null ? Number(x.paidAmount) : 0,

        receiveAccountId: x.receiveAccountId ?? null,
        note: x.note ?? "",

        status,

        hasWarrantyHold: x.hasWarrantyHold ?? false,
        warrantyHoldAmount: x.warrantyHoldAmount != null ? Number(x.warrantyHoldAmount) : 0,
        warrantyDueDate: x.warrantyDueDate ?? null,

        returnMeta: rm,
      };

      setInvoice(inv);
      setDirtySinceLastSave(false);
      setMessage(null);

      setWarrantyHoldManual(!!inv.hasWarrantyHold && Number(inv.warrantyHoldAmount || 0) > 0);
    } catch (err) {
      console.error("loadInvoice error", err);
      toastError("Không tải được hóa đơn.");
      navigate("/invoices");
    }
  }

  async function loadPaymentHistoryForInvoice() {
    if (!invoice?.id) return;

    setPaymentHistoryLoading(true);
    setPaymentHistoryError(null);

    try {
      const params: any = {};
      if (invoice.partnerId) params.partnerId = invoice.partnerId;

      const res = await api.get("/payments", { params });
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

      const invoiceIdStr = String(invoice.id);

      const mapped = (arr as any[]).map((p: any) => {
        const allocations: PaymentAllocation[] = Array.isArray(p.allocations)
          ? p.allocations.map((a: any) => ({
            invoiceId: String(a.invoiceId),
            amount: Number(a.amount ?? 0),
            invoice: a.invoice ? { id: String(a.invoice.id), code: a.invoice.code } : undefined,
          }))
          : [];

        const allocatedAmount = allocations
          .filter((a) => String(a.invoiceId) === invoiceIdStr)
          .reduce((s, a) => s + Number(a.amount || 0), 0);

        const row: PaymentRow & { allocatedAmount: number } = {
          id: String(p.id),
          date: p.date,
          createdAt: p.createdAt,
          type: p.type,
          amount: p.amount != null ? Number(p.amount) : undefined,
          refNo: p.refNo ?? null,
          method: p.method ?? null,
          note: p.note ?? null,
          account: p.account ? { id: String(p.account.id), code: p.account.code, name: p.account.name } : null,
          allocations,
          allocatedAmount,
        };
        return row;
      });

      const filtered = mapped
        .filter((r) => r.allocatedAmount > 0)
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : a.date ? new Date(a.date).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : b.date ? new Date(b.date).getTime() : 0;
          return tb - ta;
        });

      setPaymentHistoryRows(filtered);
    } catch (err: any) {
      console.error("loadPaymentHistoryForInvoice error", err);
      const msg = err?.response?.data?.message || err?.message || "Không tải được lịch sử thanh toán.";
      setPaymentHistoryError(msg);
      setPaymentHistoryRows([]);
    } finally {
      setPaymentHistoryLoading(false);
    }
  }

  function updateInvoice(partial: Partial<Invoice>) {
    setInvoice((prev) => {
      if (!prev) return prev;
      return recomputeInvoiceCore(prev, partial);
    });
  }

  function handlePartnerNameChange(value: string) {
    markDirty();
    updateInvoice({ partnerName: value, partnerId: undefined });
    setShowPartnerSuggest(true);
  }

  function selectPartner(p: Partner) {
    markDirty();
    updateInvoice({
      partnerId: p.id,
      partnerName: p.name,
      partnerCode: p.code,
      partnerAddress: p.address,
      partnerPhone: p.phone,
      partnerTaxCode: p.taxCode,
      partnerEmail: p.email,
    });
    setShowPartnerSuggest(false);
  }

  function handleLineChange(index: number, field: keyof InvoiceLine, value: any) {
    markDirty();
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, idx) => (idx === index ? { ...l, [field]: value } : l));
      return recomputeInvoiceCore(prev, { lines });
    });
  }

  function selectItemForLine(index: number, it: Item) {
    markDirty();
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, idx) =>
        idx === index ? { ...l, itemId: it.id, itemName: it.name, unit: it.unit, price: l.price || it.price || 0 } : l
      );
      return recomputeInvoiceCore(prev, { lines });
    });
    setOpenItemSuggestIndex(null);

    // ✅ tự nhảy sang ô Số lượng ngay sau khi chọn, đỡ phải bấm Tab/click thêm
    requestAnimationFrame(() => {
      const el = qtyInputRefs.current[index];
      if (el) {
        el.focus();
        el.select();
      }
    });
  }

  function addLine() {
    markDirty();
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = [...prev.lines, { itemName: "", qty: 1, price: 0, unit: "" } as InvoiceLine];
      return recomputeInvoiceCore(prev, { lines });
    });
  }

  function removeLine(index: number) {
    markDirty();
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.filter((_, idx) => idx !== index);
      return recomputeInvoiceCore(prev, { lines });
    });
  }

  async function handleSavePartner() {
    if (!invoice) return;

    if (invoice.partnerId) {
      toastError("Khách hàng này đã có trong danh sách đối tác.", "Không thể lưu");
      return;
    }
    if (!invoice.partnerName.trim()) {
      toastError("Vui lòng nhập tên khách hàng trước.", "Thiếu thông tin");
      return;
    }

    try {
      const payload = {
        code: invoice.partnerCode || undefined,
        name: invoice.partnerName,
        address: invoice.partnerAddress,
        phone: invoice.partnerPhone,
        taxCode: invoice.partnerTaxCode,
        email: invoice.partnerEmail,
      };

      const res = await api.post("/partners", payload);
      const body = (res as any).data || {};
      const partner = body.data ?? body;

      const p: Partner = {
        id: String(partner.id),
        name: partner.name,
        code: partner.code,
        address: partner.address,
        phone: partner.phone,
        taxCode: partner.taxCode,
        email: partner.email,
      };

      setPartners((prev) => [...prev, p]);
      markDirty();
      updateInvoice({ partnerId: p.id, partnerCode: p.code });
      toastSuccess("Đã lưu khách hàng vào danh sách đối tác.");
    } catch (err) {
      console.error("save partner error", err);
      toastError("Lưu khách hàng thất bại, kiểm tra log console.");
    }
  }

  function applyPaymentStatus(status: PaymentStatus, manualPaid?: number) {
    setInvoice((prev) => {
      if (!prev) return prev;

      const totalBase = calcCollectible(prev);

      let paidAmount = prev.paidAmount ?? 0;
      if (status === "UNPAID") paidAmount = 0;
      else if (status === "PAID") paidAmount = totalBase;
      else if (status === "PARTIAL") paidAmount = Math.max(0, manualPaid ?? paidAmount);

      return { ...prev, paymentStatus: status, paidAmount };
    });
  }

  function buildUpdatePayload(inv: Invoice) {
    const totalBase = calcCollectible(inv);
    let paidAmount = Number(inv.paidAmount ?? 0) || 0;
    const paymentStatus = (inv.paymentStatus ?? "UNPAID") as PaymentStatus;

    if (paymentStatus === "UNPAID") paidAmount = 0;
    if (paymentStatus === "PAID") paidAmount = totalBase;
    if (paymentStatus === "PARTIAL") {
      if (paidAmount > totalBase) paidAmount = totalBase;
      if (paidAmount < 0) paidAmount = 0;
    }

    const hasWarrantyHold = !!inv.hasWarrantyHold;
    const warrantyHoldAmount = hasWarrantyHold ? Math.max(0, Number(inv.warrantyHoldAmount || 0)) : 0;

    const payload = {
      code: inv.code,
      issueDate: inv.date,
      type: inv.type,

      partnerId: safeId(inv.partnerId),
      partnerName: inv.partnerName,
      partnerCode: inv.partnerCode || undefined,

      partnerPhone: inv.partnerPhone,
      partnerTax: inv.partnerTaxCode,
      partnerAddr: inv.partnerAddress,

      saleUserId: safeId(inv.saleUserId),
      techUserId: safeId(inv.techUserId),

      taxPercent: inv.taxPercent ?? 0,

      paymentStatus,
      paidAmount,

      receiveAccountId: safeId(inv.receiveAccountId),

      hasWarrantyHold,
      warrantyHoldAmount,

      note: inv.note ?? "",

      lines: inv.lines.map((l) => ({
        id: l.id,
        itemId: safeId(l.itemId),
        qty: l.qty,
        price: l.price,
        unitPrice: l.price,
        itemName: l.itemName,
      })),
    };

    return { payload, hasWarrantyHold, warrantyHoldAmount };
  }

  /** ✅ NEW: rule bắt buộc chọn/lưu khách hàng trước khi lưu hóa đơn */
  function isPartnerValid(inv: Invoice) {
    const pid = safeId(inv.partnerId);
    if (!pid) return false;
    return partners.some((p) => String(p.id) === String(pid));
  }
  function blockSaveIfPartnerMissing(): boolean {
    if (!invoice) return false;

    const st = (invoice.status ?? "DRAFT") as InvoiceStatus;
    // chỉ enforce ở trạng thái draft (đúng flow nhập liệu)
    if (st !== "DRAFT") return true;

    if (isPartnerValid(invoice)) return true;

    toastError(
      "Bạn chưa chọn / chưa lưu khách hàng vào danh sách đối tác. Vui lòng chọn từ dropdown hoặc bấm “Lưu khách hàng vào danh sách đối tác” trước khi lưu hóa đơn.",
      "Thiếu khách hàng"
    );
    setShowPartnerSuggest(true);
    setTimeout(() => partnerInputRef.current?.focus(), 0);
    return false;
  }

  async function handleSave() {
    if (!invoice) return;

    // ✅ chặn lưu hoá đơn nếu chưa có partnerId hợp lệ
    if (!blockSaveIfPartnerMissing()) return;

    const status = (invoice.status ?? "DRAFT") as InvoiceStatus;
    const vPrice = validatePurchasePrice(invoice);
    if (!vPrice.ok) {
      toastError(vPrice.message, "Thiếu giá nhập");
      return;
    }
    const allowAdjustApprovedEdit = isAdmin && isAdjustMode && status === "APPROVED" && !isCreate && !!invoice.id;

    // ✅ luật: bình thường chỉ DRAFT mới save; riêng admin adjust-mode cho phép save khi APPROVED
    if (!allowAdjustApprovedEdit && status !== "DRAFT") {
      toastError(
        "Hóa đơn không ở trạng thái NHÁP nên không thể lưu trực tiếp. Nếu đã duyệt hãy dùng 'Mở lại để sửa' hoặc mở bằng chế độ điều chỉnh (?adjust=1).",
        "Không thể lưu"
      );
      return;
    }

    const { payload, hasWarrantyHold, warrantyHoldAmount } = buildUpdatePayload(invoice);

    const sub = Number(invoice.subtotal || 0);
    if (hasWarrantyHold && warrantyHoldAmount > sub && sub > 0) {
      toastError(`Số tiền treo bảo hành không được vượt quá tạm tính (${formatMoney(sub)} đ).`);
      return;
    }

    try {
      setSaving(true);

      // ✅ CREATE
      if (!invoice.id) {
        const res = await api.post("/invoices", payload);
        const created = unwrap<any>(res);
        const newId = created?.id ?? created?.data?.id;
        if (newId != null) {
          setInvoice((prev) => (prev ? { ...prev, id: newId } : prev));
        }

        // ✅ admin: tạo xong -> auto submit luôn (hoá đơn thường)
        if (isAdmin && newId != null && !isAdjustMode) {
          await api.post(`/invoices/${newId}/submit`);
          toastSuccess("Đã lưu & gửi duyệt (auto).");
          setDirtySinceLastSave(false);
          setMessage(null);
          gotoListSoon(invoice.type);
          return;
        }

        toastSuccess("Đã tạo hóa đơn.");
        setDirtySinceLastSave(false);
        setMessage(null);
       gotoListSoon(invoice.type);
        return;
      }

      // ✅ UPDATE existing
      const invId = String(invoice.id);

      // ✅ CASE B: Admin + Adjust mode + APPROVED => admin-save-and-post (auto APPROVED)
      if (allowAdjustApprovedEdit) {
        await api.post(`/invoices/${invId}/admin-save-and-post`, payload);
        setDirtySinceLastSave(false);
        setMessage(null);
        toastSuccess("Đã điều chỉnh & post lại hóa đơn (auto APPROVED).");
        await loadInvoiceIfNeeded();
       gotoListSoon(invoice.type);
        return;
      }

      // ✅ normal: PUT
      await api.put(`/invoices/${invId}`, payload);

      // ✅ CASE A: Admin save => auto submit (DRAFT -> SUBMITTED)
      if (isAdmin && !isAdjustMode) {
        await api.post(`/invoices/${invId}/submit`);
        updateInvoice({ status: "SUBMITTED" });
        setDirtySinceLastSave(false);
        setMessage(null);
        toastSuccess("Đã lưu & gửi duyệt (auto).");
        gotoListSoon(invoice.type);
        return;
      }

      // ✅ staff: chỉ save
      setDirtySinceLastSave(false);
      setMessage(null);
      toastSuccess("Đã lưu hóa đơn.");
      gotoListSoon(invoice.type);
    } catch (err: any) {
      console.error("Save invoice error", err);
      toastError(err?.response?.data?.message || err?.response?.data?.error || err?.message || "Lưu hoá đơn thất bại.");
    } finally {
      setSaving(false);
    }
  }

  // ✅ NEW: REOPEN APPROVED -> DRAFT (route BE: POST /invoices/:id/reopen)
  async function handleReopenApproved() {
    if (!invoice?.id) return;
    if (!isAdmin) {
      toastError("Chỉ ADMIN mới được mở lại để sửa.");
      return;
    }
    if ((invoice.status ?? "") !== "APPROVED") {
      toastError("Chỉ hóa đơn ĐÃ DUYỆT mới mở lại để sửa.");
      return;
    }

    openConfirm({
      title: "Mở lại để sửa hóa đơn",
      message: "Hệ thống sẽ rollback tồn kho từ hóa đơn đã duyệt và đưa hóa đơn về NHÁP để sửa. Bạn chắc chắn chứ?",
      confirmText: "Mở lại",
      cancelText: "Hủy",
      tone: "danger",
      onConfirm: async () => {
        try {
          setConfirmBusy(true);
          setReopenBusy(true);

          await api.post(`/invoices/${invoice.id}/reopen`);

          toastSuccess("Đã mở lại hóa đơn về NHÁP để sửa.");
          setMessage({ type: "success", text: "Đã mở lại hóa đơn về NHÁP để sửa." });

          await loadInvoiceIfNeeded();
        } catch (err: any) {
          console.error("reopen error", err);
          const msg = err?.response?.data?.message || err?.message || "Mở lại thất bại.";
          toastError(msg);
          setMessage({ type: "error", text: msg });
        } finally {
          setReopenBusy(false);
          setConfirmBusy(false);
          closeConfirm();
        }
      },
    });
  }

  async function handleSubmit() {
    if (!invoice?.id) {
      toastError("Cần lưu hóa đơn trước khi gửi duyệt.");
      return;
    }
    if (dirtySinceLastSave) {
      // ❗️BẮT BUỘC GIÁ CHO HÓA ĐƠN NHẬP
      const vPrice = validatePurchasePrice(invoice);
      if (!vPrice.ok) {
        toastError(vPrice.message, "Thiếu giá nhập");
        return;
      }

      const text = "Bạn vừa sửa hóa đơn nhưng chưa lưu. Vui lòng bấm 'Lưu' trước khi 'Gửi duyệt'.";
      setMessage({ type: "error", text });
      toastError(text, "Chưa lưu thay đổi");
      return;
    }
    if ((invoice.status ?? "DRAFT") !== "DRAFT") {
      toastError("Chỉ hóa đơn NHÁP mới được gửi duyệt.");
      return;
    }

    openConfirm({
      title: "Gửi duyệt hóa đơn",
      message: "Gửi hóa đơn này để admin duyệt?",
      confirmText: "Gửi duyệt",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          setConfirmBusy(true);
          await api.post(`/invoices/${invoice.id}/submit`);
          updateInvoice({ status: "SUBMITTED" });
          setMessage({ type: "success", text: "Đã gửi duyệt." });
          toastSuccess("Đã gửi duyệt.");
          closeConfirm();
          gotoListSoon(invoice.type);
        } catch (err: any) {
          console.error("submit error", err);
          const msg = err?.response?.data?.message || "Gửi duyệt thất bại.";
          setMessage({ type: "error", text: msg });
          toastError(msg);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  }

  async function handleApprove() {
    if (!invoice?.id) return;

    if (dirtySinceLastSave) {
      const text = "Bạn vừa sửa hóa đơn nhưng chưa lưu. Vui lòng bấm 'Lưu' trước khi 'Duyệt'.";
      setMessage({ type: "error", text });
      toastError(text, "Chưa lưu thay đổi");
      return;
    }
    if ((invoice.status ?? "DRAFT") !== "SUBMITTED") {
      toastError("Chỉ hóa đơn CHỜ DUYỆT mới được duyệt.");
      return;
    }

    openConfirm({
      title: "Duyệt hóa đơn",
      message: "Duyệt hóa đơn? Tồn kho & giá vốn sẽ cập nhật.",
      confirmText: "Duyệt",
      cancelText: "Hủy",
      tone: "danger",
      onConfirm: async () => {
        try {
          setConfirmBusy(true);
          await api.post(`/invoices/${invoice.id}/approve`);
          updateInvoice({ status: "APPROVED" });
          setMessage({ type: "success", text: "Đã duyệt hóa đơn." });
          toastSuccess("Đã duyệt hóa đơn.");
          closeConfirm();
        } catch (err: any) {
          console.error("approve error", err);
          const msg = err?.response?.data?.message || "Duyệt thất bại.";
          setMessage({ type: "error", text: msg });
          toastError(msg);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  }

  async function handleReject() {
    if (!invoice?.id) return;

    if ((invoice.status ?? "DRAFT") !== "SUBMITTED") {
      toastError("Chỉ hóa đơn CHỜ DUYỆT mới được từ chối.");
      return;
    }

    openPrompt({
      title: "Từ chối hóa đơn",
      message: "Nhập lý do từ chối (tuỳ chọn).",
      placeholder: "VD: Sai thông tin khách / sai dòng hàng / sai giá...",
      defaultValue: "",
      confirmText: "Từ chối",
      cancelText: "Hủy",
      onConfirm: async (reason) => {
        try {
          setPromptBusy(true);
          await api.post(`/invoices/${invoice.id}/reject`, { reason: (reason || "").trim() });
          updateInvoice({ status: "REJECTED" });
          setMessage({ type: "success", text: "Đã từ chối hóa đơn." });
          toastSuccess("Đã từ chối hóa đơn.");
          closePrompt();
        } catch (err: any) {
          console.error("reject error", err);
          const msg = err?.response?.data?.message || "Từ chối thất bại.";
          setMessage({ type: "error", text: msg });
          toastError(msg);
        } finally {
          setPromptBusy(false);
        }
      },
    });
  }

  if (loading || !invoice) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.headerTitle}>Hóa đơn</h1>
        </div>
        <div style={styles.body}>
          <div style={styles.content}>Đang tải...</div>
        </div>

        <ToastHost toasts={toasts} onClose={remove} />
      </div>
    );
  }
  const isPurchase = invoice.type === "PURCHASE";
  const status = (invoice.status ?? "DRAFT") as InvoiceStatus;

  // ✅ editable rules:
  // - DRAFT: ai cũng sửa được (theo UI hiện tại)
  // - APPROVED: chỉ admin + adjust-mode mới sửa (điều chỉnh & post lại)
  const canEditApprovedAdjust = isAdmin && isAdjustMode && status === "APPROVED";
  const canEdit = status === "DRAFT" || canEditApprovedAdjust;

  const locked = !canEdit;

  const partnerSuggestions =
    invoice.partnerName
      ? partners.filter((p) => p.name.toLowerCase().includes(invoice.partnerName.toLowerCase())).slice(0, 20)
      : [];

  const showPaidInput = (invoice.paymentStatus ?? "UNPAID") === "PARTIAL";

  const statusText =
    status === "APPROVED"
      ? "Đã duyệt"
      : status === "SUBMITTED"
        ? "Chờ duyệt"
        : status === "REJECTED"
          ? "Bị từ chối"
          : "Nháp";

  const paidByPayments = paymentHistoryRows.reduce((s, r) => s + (r.allocatedAmount || 0), 0);

  const paidNormal = Math.max(0, toNum(invoice.paidAmount));
  const paidTotal = Math.max(0, paidByPayments);
  const paidWarranty = Math.max(0, paidTotal - paidNormal);

  const vatAmount = Math.max(0, toNum(invoice.tax));
  const returnedTotal =
    invoice.type === "SALES" && invoice.returnMeta ? Math.max(0, toNum(invoice.returnMeta.returnedTotal)) : 0;

  const hold =
    invoice.type === "SALES" && invoice.returnMeta
      ? Math.max(0, toNum(invoice.returnMeta.holdAmount))
      : invoice.hasWarrantyHold
        ? Math.max(0, toNum(invoice.warrantyHoldAmount))
        : 0;

  const collectible = calcCollectible(invoice);
  const debtNow = Math.max(0, collectible - Math.max(0, toNum(invoice.paidAmount)));

  const derivedHoldPct =
    invoice.hasWarrantyHold && Number(invoice.subtotal || 0) > 0
      ? ((hold * 100) / Number(invoice.subtotal || 0)).toFixed(2)
      : "0.00";

  const returnState = getReturnState(invoice);
  const returnColor = returnState === "FULL" ? "#7c3aed" : returnState === "PARTIAL" ? "#6d28d9" : "#6b7280";

  const canEditInvoiceCode = status === "DRAFT"; // giữ nguyên policy

  const title = isCreate ? "Tạo hóa đơn mới" : canEditApprovedAdjust ? "Điều chỉnh hóa đơn (Admin)" : "Chi tiết hóa đơn";

  // label nút save
  const saveLabel = (() => {
    if (saving) return "Đang lưu...";
    if (canEditApprovedAdjust) return "Điều chỉnh & Post lại";
    if (isAdmin && status === "DRAFT" && !isAdjustMode) return "Lưu & Gửi duyệt";
    return "Lưu hóa đơn";
  })();

  const partnerOk = status !== "DRAFT" ? true : isPartnerValid(invoice);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>{title}</h1>
      </div>

      <div style={styles.body}>
        <div style={styles.content}>
          <button type="button" style={styles.backBtn} onClick={goBackToInvoices}>
            ← Quay lại danh sách hóa đơn
          </button>

          {/* APPROVED notice */}
          {status === "APPROVED" && !canEditApprovedAdjust && (
            <div style={{ ...styles.notice, background: "#eef2ff", border: "1px solid #c7d2fe", color: "#3730a3" }}>
              Hóa đơn đã <b>DUYỆT</b>. Không thể sửa trực tiếp hóa đơn gốc.
              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12.5, color: "#4f46e5" }}>
                  Nếu cần sửa: bấm <b>Mở lại để sửa</b> (rollback tồn kho và đưa về NHÁP) hoặc mở bằng chế độ điều chỉnh{" "}
                  <b>?adjust=1</b>.
                </span>

                {isAdmin ? (
                  <button
                    type="button"
                    style={primarySmallBtn(reopenBusy || saving)}
                    disabled={reopenBusy || saving}
                    onClick={handleReopenApproved}
                  >
                    {reopenBusy ? "Đang mở lại..." : "Mở lại để sửa"}
                  </button>
                ) : (
                  <span style={{ fontSize: 12.5, color: "#b91c1c" }}>(Bạn không phải ADMIN nên không có quyền mở lại.)</span>
                )}
              </div>
            </div>
          )}

          {/* Adjust-mode notice */}
          {status === "APPROVED" && canEditApprovedAdjust && (
            <div style={{ ...styles.notice, background: "#ecfeff", border: "1px solid #67e8f9", color: "#155e75" }}>
              Bạn đang ở chế độ <b>ĐIỀU CHỈNH</b> (admin). Bấm <b>{saveLabel}</b> sẽ tự rollback movement cũ, lưu lại nội dung
              mới và post tồn kho lại (auto <b>APPROVED</b>).
              <div style={{ marginTop: 6, fontSize: 12.5, color: "#0e7490" }}>
                (Link: <code>?adjust=1</code>)
              </div>
            </div>
          )}

          {(status === "SUBMITTED" || status === "REJECTED") && (
            <div style={{ ...styles.notice, ...styles.noticeError }}>
              Hóa đơn đang ở trạng thái <b>{statusText}</b> nên không thể chỉnh sửa.
            </div>
          )}

          <form
            style={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (canEdit) handleSave();
              else toastError("Không có thao tác lưu hợp lệ cho trạng thái hiện tại.");
            }}
          >
            {/* Thông tin đơn hàng */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Thông tin đơn hàng</div>

              <div style={styles.formRow}>
                <label style={styles.label}>Số hóa đơn *</label>
                <input
                  style={{
                    ...styles.input,
                    background: canEditInvoiceCode ? "#fff" : "#f8fafc",
                    cursor: canEditInvoiceCode ? "text" : "not-allowed",
                  }}
                  value={invoice.code ?? ""}
                  disabled={!canEditInvoiceCode}
                  placeholder={canEditInvoiceCode ? "Nhập mã hóa đơn (để trống thì hệ thống tự nhảy)" : "số tự nhảy"}
                  onChange={(e) => {
                    if (!canEditInvoiceCode) return;
                    markDirty();
                    updateInvoice({ code: e.target.value });
                  }}
                />
              </div>

              <div style={{ ...styles.formRow, ...styles.rowInline }}>
                <div style={styles.flex1}>
                  <label style={styles.label}>Ngày hóa đơn</label>
                  <input
                    style={styles.input}
                    type="date"
                    value={invoice.date || ""}
                    disabled={locked}
                    onChange={(e) => {
                      markDirty();
                      updateInvoice({ date: e.target.value || undefined });
                    }}
                  />
                </div>
                <div style={styles.flex1}>
                  <label style={styles.label}>Loại hóa đơn</label>
                  <select
                    style={styles.select}
                    value={invoice.type}
                    disabled={locked || status !== "DRAFT"}
                    onChange={(e) => {
                      markDirty();
                      updateInvoice({ type: e.target.value as InvoiceType });
                    }}
                  >
                    <option value="SALES">Bán hàng</option>
                    <option value="PURCHASE">Nhập hàng</option>
                  </select>
                  {status !== "DRAFT" && (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      * Hóa đơn đã phát sinh nghiệp vụ nên không đổi loại.
                    </div>
                  )}
                </div>
              </div>

              {invoice.type === "SALES" && (
                <div style={{ marginTop: 6, fontSize: 13, color: returnColor }}>
                  {returnState === "FULL"
                    ? "Trả hàng: Toàn bộ"
                    : returnState === "PARTIAL"
                      ? "Trả hàng: Một phần"
                      : "Trả hàng: Không"}
                  {invoice.returnMeta?.debtIgnore ? (
                    <span style={{ marginLeft: 10, color: "#b91c1c" }}>(debtIgnore=true)</span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Khách hàng */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Khách hàng</div>

              <div
                style={{ ...styles.formRow, ...styles.autoWrapper }}
                onBlur={() => setTimeout(() => setShowPartnerSuggest(false), 150)}
              >
                <label style={styles.label}>Tên khách hàng (gõ để tìm)</label>
                <input
                  ref={partnerInputRef}
                  style={styles.input}
                  value={invoice.partnerName}
                  disabled={locked || status !== "DRAFT"} // policy: approved adjust-mode không cho đổi khách ở đây (đỡ rủi ro)
                  onChange={(e) => handlePartnerNameChange(e.target.value)}
                  onFocus={() => setShowPartnerSuggest(true)}
                  placeholder="Nhập tên khách hàng..."
                />

                {/* ✅ warning inline để nhân viên khỏi quên bấm lưu khách */}
                {status === "DRAFT" && !locked && !partnerOk && (
                  <div style={{ marginTop: 6, fontSize: 12.5, color: "#b91c1c" }}>
                    * Chưa chọn/chưa lưu khách hàng vào danh sách đối tác. Hãy chọn từ dropdown hoặc bấm “Lưu khách hàng vào
                    danh sách đối tác” trước khi lưu hóa đơn.
                  </div>
                )}

                {showPartnerSuggest && !locked && status === "DRAFT" && partnerSuggestions.length > 0 && (
                  <div style={styles.suggestBox}>
                    {partnerSuggestions.map((p) => (
                      <div
                        key={p.id}
                        style={styles.suggestItem}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectPartner(p);
                        }}
                      >
                        {p.name}
                        {p.code && <span style={{ color: "#6b7280", marginLeft: 4 }}>[{p.code}]</span>}
                        {p.taxCode && <span style={{ color: "#9ca3af", marginLeft: 4 }}>({p.taxCode})</span>}
                      </div>
                    ))}
                  </div>
                )}
                {status !== "DRAFT" && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    * Hóa đơn đã phát sinh nghiệp vụ: không đổi khách hàng tại đây.
                  </div>
                )}
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Mã khách hàng</label>
                <input
                  style={styles.input}
                  value={invoice.partnerCode || ""}
                  disabled={locked || status !== "DRAFT"}
                  onChange={(e) => {
                    markDirty();
                    updateInvoice({ partnerCode: e.target.value });
                  }}
                />
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Địa chỉ</label>
                <input
                  style={styles.input}
                  value={invoice.partnerAddress || ""}
                  disabled={locked || status !== "DRAFT"}
                  onChange={(e) => {
                    markDirty();
                    updateInvoice({ partnerAddress: e.target.value });
                  }}
                />
              </div>

              <div style={{ ...styles.formRow, ...styles.rowInline }}>
                <div style={styles.flex1}>
                  <label style={styles.label}>Số điện thoại</label>
                  <input
                    style={styles.input}
                    value={invoice.partnerPhone || ""}
                    disabled={locked || status !== "DRAFT"}
                    onChange={(e) => {
                      markDirty();
                      updateInvoice({ partnerPhone: e.target.value });
                    }}
                  />
                </div>
                <div style={styles.flex1}>
                  <label style={styles.label}>Mã số thuế</label>
                  <input
                    style={styles.input}
                    value={invoice.partnerTaxCode || ""}
                    disabled={locked || status !== "DRAFT"}
                    onChange={(e) => {
                      markDirty();
                      updateInvoice({ partnerTaxCode: e.target.value });
                    }}
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Email</label>
                <input
                  style={styles.input}
                  value={invoice.partnerEmail || ""}
                  disabled={locked || status !== "DRAFT"}
                  onChange={(e) => {
                    markDirty();
                    updateInvoice({ partnerEmail: e.target.value });
                  }}
                />
              </div>

              <div style={{ marginTop: 4 }}>
                <button
                  type="button"
                  style={styles.secondarySmallBtn}
                  disabled={locked || status !== "DRAFT"}
                  onClick={handleSavePartner}
                >
                  Lưu khách hàng vào danh sách đối tác
                </button>
              </div>
            </div>

            {/* Nhân viên phụ trách */}
            {invoice.type !== "PURCHASE" && (
              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>Nhân viên phụ trách</div>

                <div style={{ ...styles.formRow, ...styles.rowInline }}>
                  <div style={styles.flex1}>
                    <label style={styles.label}>NV Sale</label>
                    <select
                      style={styles.select}
                      value={invoice.saleUserId || ""}
                      disabled={locked}
                      onChange={(e) => {
                        markDirty();
                        updateInvoice({ saleUserId: safeId(e.target.value) });
                      }}
                    >
                      <option value="">-- Chọn NV sale --</option>
                      {staffs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.flex1}>
                    <label style={styles.label}>NV kỹ thuật</label>
                    <select
                      style={styles.select}
                      value={invoice.techUserId || ""}
                      disabled={locked}
                      onChange={(e) => {
                        markDirty();
                        updateInvoice({ techUserId: safeId(e.target.value) });
                      }}
                    >
                      <option value="">-- Chọn NV kỹ thuật --</option>
                      {staffs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Dòng sản phẩm */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Dòng sản phẩm</div>

              <div style={styles.gridHeader}>
                <div style={{ textAlign: "left" }}>Sản phẩm</div>
                <div style={{ textAlign: "center" }}>SL</div>
                <div style={{ textAlign: "right" }}>Đơn giá</div>
                <div style={{ textAlign: "right" }}>Thành tiền</div>
                <div />
              </div>

              {invoice.lines.length === 0 && (
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                  Chưa có dòng sản phẩm, bấm “Thêm dòng sản phẩm”.
                </div>
              )}

              {invoice.lines.map((line, idx) => {
                // ✅ FIX: search cũ dùng .toLowerCase().includes() nên gõ không dấu
                // (vd "may ep") sẽ KHÔNG khớp được với tên có dấu ("Máy ép") — đây
                // chính là lý do trước giờ phải đổi tên/mã sản phẩm mới tìm ra được.
                const qRaw = (line.itemName || "").trim();
                const qNorm = normalizeVN(qRaw);
                const qTokens = qNorm.split(" ").filter(Boolean);

                const itemSuggestions =
                  qTokens.length > 0
                    ? itemsSearchIndex
                        .filter(({ normName, normSku }) => {
                          const hay = `${normName} ${normSku}`;
                          // mỗi từ gõ vào phải xuất hiện đâu đó trong tên/mã
                          // (không cần đúng thứ tự, không cần dấu, không phân biệt hoa/thường)
                          return qTokens.every((t) => hay.includes(t));
                        })
                        // ✅ ưu tiên: khớp đúng mã SKU > tên bắt đầu bằng từ khoá > còn lại
                        .sort((a, b) => {
                          const score = (x: typeof a) => {
                            if (x.normSku === qNorm) return 0;
                            if (x.normSku.startsWith(qNorm)) return 1;
                            if (x.normName.startsWith(qNorm)) return 2;
                            return 3;
                          };
                          return score(a) - score(b);
                        })
                        .slice(0, 50)
                        .map(({ item }) => item)
                    : [];

                return (
                  <div key={line.id ?? `line-${idx}`} style={styles.gridRow}>
                    <div style={styles.autoWrapper}>
                      <input
                        style={styles.smallInput}
                        value={line.itemName}
                        disabled={locked}
                        onChange={(e) => handleLineChange(idx, "itemName", e.target.value)}
                        onFocus={() => setOpenItemSuggestIndex(idx)}
                        placeholder="Gõ mã hoặc tên sản phẩm..."
                      />

                      {openItemSuggestIndex === idx && !locked && line.itemName.length > 0 && (
                        <div style={styles.suggestBox}>
                          {itemSuggestions.length > 0 ? (
                            itemSuggestions.map((it) => {
                              // ✅ chỉ cảnh báo hết hàng khi hoá đơn là loại XUẤT (SALES) —
                              // hoá đơn PURCHASE (nhập hàng) thì tồn=0 là chuyện bình thường
                              const isOutInvoice = invoice.type === "SALES";
                              const outOfStock = isOutInvoice && Number(it.stockQty ?? 0) <= 0;

                              return (
                                <div
                                  key={it.id}
                                  style={{
                                    ...styles.suggestItem,
                                    ...(outOfStock ? { background: "#fef2f2" } : {}),
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    if (outOfStock) {
                                      toastWarning(
                                        `"${it.name}" đang hết hàng trong kho (tồn: 0). Vẫn có thể chọn, nhưng khi duyệt hoá đơn sẽ báo lỗi nếu chưa nhập thêm hàng.`
                                      );
                                    }
                                    selectItemForLine(idx, it);
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                    <span>
                                      {it.sku ? (
                                        <b style={{ marginRight: 6 }}>{highlightMatches(it.sku, qTokens)}</b>
                                      ) : null}
                                      {highlightMatches(it.name, qTokens)}
                                    </span>
                                    <span
                                      style={{
                                        whiteSpace: "nowrap",
                                        fontSize: 12,
                                        color: outOfStock ? "#dc2626" : "#6b7280",
                                        fontWeight: outOfStock ? 700 : 400,
                                      }}
                                    >
                                      {outOfStock ? "Hết hàng" : `Tồn: ${it.stockQty ?? 0}`}
                                      {it.price ? ` · ${it.price.toLocaleString("vi-VN")}đ` : ""}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div style={styles.suggestItemMuted}>Không tìm thấy sản phẩm</div>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <input
                        ref={(el) => {
                          qtyInputRefs.current[idx] = el;
                        }}
                        style={{ ...styles.smallInput, textAlign: "center" }}
                        type="number"
                        min={0}
                        value={line.qty}
                        disabled={locked}
                        onChange={(e) => handleLineChange(idx, "qty", Number(e.target.value) || 0)}
                      />
                    </div>

                    <div>
                      <LinePriceInput
                        value={Number(line.price || 0)}
                        disabled={locked}
                        styleInput={{ ...styles.smallInput, textAlign: "right" }}
                        onChange={(raw) => handleLineChange(idx, "price", raw)}
                      />
                    </div>

                    <div>
                      <div style={styles.totalBox}>{fmtMoneyInput(line.qty * line.price)}</div>
                    </div>

                    <div style={{ textAlign: "center" }}>
                      <button type="button" style={styles.smallBtn} disabled={locked} onClick={() => removeLine(idx)}>
                        Xóa
                      </button>
                    </div>
                  </div>
                );
              })}

              <button type="button" style={styles.addLineBtn} disabled={locked} onClick={addLine}>
                + Thêm dòng sản phẩm
              </button>

              {/* Summary */}
              <div style={{ marginTop: 8 }}>

                 {!isPurchase && (
                  <>
                    <div style={styles.summaryRow}>
                      <span style={styles.summaryLabel}>Tạm tính:</span>
                      <span style={styles.summaryValue}>{formatMoney(invoice.subtotal ?? 0)} đ</span>
                    </div>

                    <div style={styles.summaryRow}>
                      <span style={styles.summaryLabel}>VAT (thuế):</span>
                      <span style={styles.summaryValue}>{formatMoney(vatAmount)} đ</span>
                    </div>

                    <div style={styles.summaryRow}>
                      <span style={styles.summaryLabel}>Thuế (%)</span>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "stretch",
                          width: "100%",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          overflow: "hidden",
                          background: locked ? "#f8fafc" : "#fff",
                          boxSizing: "border-box",
                        }}
                      >
                        <input
                          style={{
                            padding: "5px 8px",
                            fontSize: 13,
                            boxSizing: "border-box",
                            flex: 1,
                            minWidth: 0,
                            width: "100%",
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            textAlign: "right",
                          }}
                          type="number"
                          min={0}
                          value={invoice.taxPercent ?? 0}
                          disabled={locked}
                          onChange={(e) => {
                            markDirty();
                            const num = Number(e.target.value || 0);
                            setInvoice((prev) => {
                              if (!prev) return prev;
                              const pct = isNaN(num) ? 0 : num;
                              return recomputeInvoiceCore(prev, { taxPercent: pct });
                            });
                          }}
                        />
                        <span
                          style={{
                            padding: "0 10px",
                            display: "flex",
                            alignItems: "center",
                            borderLeft: "1px solid #e5e7eb",
                            background: "#f9fafb",
                            color: "#374151",
                            fontSize: 13,
                            whiteSpace: "nowrap",
                          }}
                        >
                          %
                        </span>
                      </div>

                      <span style={{ whiteSpace: "nowrap" }}>= {formatMoney(invoice.tax ?? 0)} đ</span>
                    </div>

                    {/* Bảo hành */}
                    <div style={styles.summaryRow}>
                      <span style={styles.summaryLabel}>Bảo hành:</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={!!invoice.hasWarrantyHold}
                          onChange={(e) => {
                            markDirty();
                            const checked = e.target.checked;
                            setWarrantyHoldManual(false);
                            setInvoice((prev) => {
                              if (!prev) return prev;
                              const next = recomputeInvoiceCore(prev, { hasWarrantyHold: checked });
                              return next;
                            });
                          }}
                        />
                        <span>Có bảo hành (treo)</span>
                      </label>
                    </div>

                    {!!invoice.hasWarrantyHold && (
                      <div style={styles.summaryRow}>
                        <span style={styles.summaryLabel}>Số tiền treo bảo hành:</span>

                        <WarrantyHoldInput
                          value={Number(invoice.warrantyHoldAmount || 0)}
                          disabled={locked}
                          onChange={(raw) => {
                            markDirty();
                            setWarrantyHoldManual(true);
                            setInvoice((prev) => {
                              if (!prev) return prev;
                              const sub = Number(prev.subtotal || 0);
                              const v = Math.max(0, raw);
                              const clamped = sub > 0 ? Math.min(v, sub) : v;
                              return { ...prev, warrantyHoldAmount: clamped };
                            });
                          }}
                          styleInput={{ textAlign: "right" }}
                        />

                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ color: "#6b7280", fontSize: 12 }}>(≈ {derivedHoldPct}% của tạm tính)</span>
                          <button
                            type="button"
                            style={styles.secondarySmallBtn}
                            disabled={locked}
                            title="Đặt về mặc định 5% theo tạm tính"
                            onClick={() => {
                              markDirty();
                              setWarrantyHoldManual(false);
                              setInvoice((prev) => {
                                if (!prev) return prev;
                                const sub = Number(prev.subtotal || 0);
                                return { ...prev, warrantyHoldAmount: defaultHoldAmountFromSubtotal(sub) };
                              });
                            }}
                          >
                            Reset 5%
                          </button>
                        </div>
                      </div>
                    )}

                    {invoice.type === "SALES" && returnedTotal > 0 && (
                      <div style={styles.summaryRow}>
                        <span style={styles.summaryLabel}>Đã trả hàng:</span>
                        <span style={{ ...styles.summaryValue, color: "#7c3aed" }}>{formatMoney(returnedTotal)} đ</span>
                      </div>
                    )}

                    <div style={styles.summaryRow}>
                      <span style={styles.summaryLabel}>Nhập số tiền đã thu:</span>
                      <PaidAmountInput
                        value={invoice.paidAmount ?? 0}
                        disabled={!showPaidInput || locked}
                        onChange={(raw) => {
                          markDirty();
                          applyPaymentStatus("PARTIAL", raw);
                        }}
                        styleInput={{ textAlign: "right", opacity: showPaidInput ? 1 : 0.7 }}
                      />
                    </div>

                      <div style={styles.summaryRow}>
                        <span style={styles.summaryLabel}>Tài khoản nhận tiền:</span>
                        <select
                          style={styles.select}
                          value={invoice.receiveAccountId || ""}
                          disabled={locked}
                          onChange={(e) => {
                            markDirty();
                            updateInvoice({ receiveAccountId: safeId(e.target.value) });
                          }}
                        >
                          <option value="">-- Chưa chọn --</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} - {a.name}
                            </option>
                          ))}
                        </select>
                      </div>

                        {accountLoadError && <div style={{ ...styles.notice, ...styles.noticeError }}>{accountLoadError}</div>}

                        <div style={styles.summaryRow}>
                          <span style={styles.summaryLabel}>Tổng cộng:</span>
                          <span style={styles.summaryValue}>{formatMoney(invoice.totalAmount)} đ</span>
                        </div>

                        <div style={styles.summaryRow}>
                          <span style={styles.summaryLabel}>Đã thu:</span>
                          <span style={styles.summaryValue}>{formatMoney(paidNormal)} đ</span>
                        </div>

                        <div style={styles.summaryRow}>
                          <span style={styles.summaryLabel}>Còn phải thu:</span>
                          <span style={{ ...styles.summaryValue, color: isReturnedFull(invoice) ? "#6b7280" : "#111827" }}>
                            {formatMoney(debtNow)} đ
                          </span>
                        </div>
                        
                        </>
                        )}

                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Trạng thái thanh toán:</span>
                  <select
                    style={styles.select}
                    value={invoice.paymentStatus || "UNPAID"}
                    disabled={locked}
                    onChange={(e) => {
                      markDirty();
                      applyPaymentStatus(e.target.value as PaymentStatus);
                    }}
                  >
                    <option value="UNPAID">Chưa thanh toán</option>
                    <option value="PARTIAL">Thanh toán một phần</option>
                    <option value="PAID">Đã thanh toán đủ</option>
                  </select>
                </div>    
                <div style={{ ...styles.formRow, marginTop: 10 }}>
                  <label style={styles.label}>Ghi chú</label>
                  <textarea
                    style={{ ...styles.input, minHeight: 80, resize: "vertical" }}
                    value={invoice.note ?? ""}
                    disabled={locked}
                    onChange={(e) => {
                      markDirty();
                      updateInvoice({ note: e.target.value });
                    }}
                  />
                </div>
              </div>

              {message && (
                <div style={{ ...styles.notice, ...(message.type === "success" ? styles.noticeSuccess : styles.noticeError) }}>
                  {message.text}
                </div>
              )}

              <div style={styles.postStatusRow}>
                <span
                  style={{
                    fontSize: 13,
                    color: status === "APPROVED" ? "#16a34a" : status === "REJECTED" ? "#ef4444" : "#f97316",
                  }}
                >
                  Trạng thái: {statusText}
                </span>

                <div style={{ display: "flex", gap: 8 }}>
                  {/* staff: giữ nút gửi duyệt */}
                  {!isAdmin && status === "DRAFT" && (
                    <button
                      type="button"
                      style={styles.secondarySmallBtn}
                      disabled={!invoice.id || dirtySinceLastSave}
                      title={dirtySinceLastSave ? "Bạn đã sửa hoá đơn, hãy lưu trước khi gửi duyệt." : ""}
                      onClick={handleSubmit}
                    >
                      Gửi duyệt
                    </button>
                  )}

                  {/* admin: duyệt/từ chối khi SUBMITTED */}
                  {isAdmin && status === "SUBMITTED" && (
                    <>
                      <button type="button" style={styles.secondarySmallBtn} onClick={handleApprove}>
                        Duyệt
                      </button>
                      <button type="button" style={styles.secondarySmallBtn} onClick={handleReject}>
                        Từ chối
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Lịch sử thanh toán */}
            {!isCreate && invoice.id && (
              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>Lịch sử thanh toán</div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <button
                    type="button"
                    style={styles.secondarySmallBtn}
                    onClick={loadPaymentHistoryForInvoice}
                    disabled={paymentHistoryLoading}
                  >
                    {paymentHistoryLoading ? "Đang tải..." : "Tải lại"}
                  </button>

                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    Tổng allocations vào HĐ: <b>{formatMoney(paidTotal)} đ</b>
                    <span style={{ marginLeft: 10 }}>
                      (NORMAL: <b>{formatMoney(paidNormal)} đ</b> • BH: <b>{formatMoney(paidWarranty)} đ</b>)
                    </span>
                  </div>
                </div>

                {paymentHistoryError && <div style={{ ...styles.notice, ...styles.noticeError }}>{paymentHistoryError}</div>}

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        <th style={{ textAlign: "left", padding: "8px 8px", borderBottom: "1px solid #e5e7eb" }}>Ngày</th>
                        <th style={{ textAlign: "left", padding: "8px 8px", borderBottom: "1px solid #e5e7eb" }}>Tài khoản</th>
                        <th style={{ textAlign: "right", padding: "8px 8px", borderBottom: "1px solid #e5e7eb" }}>
                          Số tiền áp vào HĐ
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 8px", borderBottom: "1px solid #e5e7eb" }}>
                          Tổng phiếu
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 8px", borderBottom: "1px solid #e5e7eb" }}>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentHistoryLoading && (
                        <tr>
                          <td colSpan={5} style={{ padding: "10px 8px", color: "#6b7280" }}>
                            Đang tải lịch sử...
                          </td>
                        </tr>
                      )}

                      {!paymentHistoryLoading && paymentHistoryRows.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: "10px 8px", color: "#6b7280" }}>
                            Chưa có phiếu thanh toán nào được phân bổ cho hóa đơn này.
                          </td>
                        </tr>
                      )}

                      {!paymentHistoryLoading &&
                        paymentHistoryRows.map((p) => {
                          const accText = p.account
                            ? `${p.account.code || ""}${p.account.name ? " - " + p.account.name : ""}`
                            : "-";
                          const note = p.note || "";
                          const timeStr = formatDateTimeDisplay(p.createdAt || p.date);

                          return (
                            <tr key={p.id}>
                              <td
                                style={{
                                  padding: "8px 8px",
                                  borderBottom: "1px solid #f3f4f6",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {timeStr}
                              </td>
                              <td style={{ padding: "8px 8px", borderBottom: "1px solid #f3f4f6" }}>{accText || "-"}</td>
                              <td
                                style={{
                                  padding: "8px 8px",
                                  borderBottom: "1px solid #f3f4f6",
                                  textAlign: "right",
                                  fontWeight: 600,
                                }}
                              >
                                {formatMoney((p as any).allocatedAmount || 0)} đ
                              </td>
                              <td style={{ padding: "8px 8px", borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                                {formatMoney(Number(p.amount || 0))} đ
                              </td>
                              <td style={{ padding: "8px 8px", borderBottom: "1px solid #f3f4f6" }}>{note}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={styles.formActions}>
              <button type="button" style={styles.secondaryBtn} onClick={() => navigate("/invoices")} disabled={saving}>
                Hủy
              </button>

              {canEdit ? (
                <button
                  type="submit"
                  style={{
                    ...styles.primaryBtn,
                    background: status === "DRAFT" && !partnerOk ? "rgba(22, 163, 74, 0.45)" : styles.primaryBtn.background,
                    cursor: status === "DRAFT" && !partnerOk ? "not-allowed" : "pointer",
                  }}
                  disabled={saving || locked || (status === "DRAFT" && !partnerOk)}
                  title={status === "DRAFT" && !partnerOk ? "Bạn cần chọn/lưu khách hàng trước khi lưu hóa đơn." : ""}
                >
                  {saveLabel}
                </button>
              ) : (
                <button type="button" style={{ ...styles.primaryBtn, background: "#9ca3af", cursor: "not-allowed" }} disabled>
                  Không thể lưu
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <ToastHost toasts={toasts} onClose={remove} />

      <ConfirmModal
        open={confirmOpen && !!confirmCfg}
        title={confirmCfg?.title || ""}
        message={confirmCfg?.message || ""}
        confirmText={confirmCfg?.confirmText}
        cancelText={confirmCfg?.cancelText}
        tone={confirmCfg?.tone}
        busy={confirmBusy}
        onClose={closeConfirm}
        onConfirm={() => confirmCfg?.onConfirm?.()}
      />

      <PromptModal
        open={promptOpen && !!promptCfg}
        title={promptCfg?.title || ""}
        message={promptCfg?.message}
        placeholder={promptCfg?.placeholder}
        defaultValue={promptCfg?.defaultValue}
        confirmText={promptCfg?.confirmText}
        cancelText={promptCfg?.cancelText}
        busy={promptBusy}
        onClose={closePrompt}
        onConfirm={(v) => promptCfg?.onConfirm?.(v)}
      />
    </div>
  );
};

export default InvoiceDetailPage;