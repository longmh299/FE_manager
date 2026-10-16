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
  kind?: string; // ✅ MỚI: MACHINE | PART — để chặn máy trùng mã khi tạo nhanh
};

type InvoiceLine = {
  id?: string;
  itemId?: string;
  itemName: string;
  unit?: string;
  qty: number;
  price: number;
  _imp?: ImpMeta; // ✅ MỚI: dòng đến từ "Nhập từ file" (chỉ dùng trên giao diện, payload KHÔNG gửi trường này)
};

// ✅ MỚI: nhập hoá đơn từ file
type ImpCand = { itemId: string; sku: string; name: string; kind: string; unit: string; price: number; stockQty: number; score: number };
type ImpMeta = {
  status: "ok" | "check" | "new";
  row: number;
  code: string;
  name: string;
  unit: string;
  reason: string;
  flags: string[];
  candidates: ImpCand[];
  rawKey: string;
  autoItemId: string | null;
};
type ImportInfo = {
  fileName: string;
  fileHash: string;
  invoiceKey: string;
  invoiceNo: string;
  source: string;
  fileTotal: number | null;
  critical: string[];
  warnings: string[];
  partner: { data?: { name?: string; taxCode?: string }; match?: Partner | null } | null;
  ack: boolean;
  confirmed: boolean;
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
          height: 36,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          overflow: "hidden",
          background: disabled ? "#f8fafc" : "#fff",
          boxSizing: "border-box",
        }}
      >
        <input
          style={{
            padding: "0 10px",
            fontSize: 13.5,
            boxShadow: "none",
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
            borderLeft: "1px solid #e2e8f0",
            background: "#f1f5f9",
            color: "#334155",
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
          height: 36,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          overflow: "hidden",
          background: disabled ? "#f8fafc" : "#fff",
          boxSizing: "border-box",
        }}
      >
        <input
          style={{
            padding: "0 10px",
            fontSize: 13.5,
            boxShadow: "none",
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
            borderLeft: "1px solid #e2e8f0",
            background: "#f1f5f9",
            color: "#334155",
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
/** ✅ FIX: tải HẾT danh sách (trước đây chỉ lấy 1 trang: 1000 hàng / 100 khách → thiếu dữ liệu khi tìm) */
async function fetchAllPages(url: string, pageSize = 500): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const res = await api.get(url, { params: { q: "", page, pageSize } });
    const body = res?.data;
    const arr: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    for (const x of arr) {
      const id = String(x?.id ?? "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(x);
    }
    const total = Number(body?.total ?? 0);
    if (arr.length < pageSize || (total > 0 && out.length >= total)) break;
  }
  return out;
}

/** ✅ FIX: dạng "liền" để gõ cke020 / dz600 / sh100 vẫn ra CK-E020 / DZ-600 / SH-100 */
function compactKey(s: string): string {
  return normalizeVN(s).replace(/[^a-z0-9]/g, "");
}

/** chuỗi tìm kiếm cho đối tác: tên + mã + MST + SĐT, không dấu */
function partnerHay(p: { name?: string; code?: string; taxCode?: string; phone?: string }) {
  return normalizeVN([p.name, p.code, p.taxCode, p.phone].filter(Boolean).join(" "));
}

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
// ✅ UI mới: tông slate (khớp sidebar/Layout), thẻ bo góc, bảng dòng hàng gọn, thanh hành động dính đáy.
//    Chỉ đổi giao diện — không đổi trường dữ liệu / logic.
const C = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  borderInput: "#cbd5e1",
  text: "#0f172a",
  muted: "#64748b",
  soft: "#f1f5f9",
  primary: "#0f172a",
  blue: "#2563eb",
  green: "#16a34a",
  red: "#dc2626",
};

// CSS phụ (focus, hover, responsive) — inline style không làm được :focus / @media
const INV_CSS = `
.inv-ui input:focus, .inv-ui select:focus, .inv-ui textarea:focus {
  outline: none; border-color: #0f172a !important; box-shadow: 0 0 0 3px rgba(15,23,42,.08);
}
.inv-ui input:disabled, .inv-ui select:disabled, .inv-ui textarea:disabled { background: #f8fafc !important; color: #475569; cursor: not-allowed; }
.inv-ui .inv-suggest-item:hover { background: #f1f5f9; }
.inv-ui .inv-line:hover { background: #f8fafc; }
.inv-ui .inv-del:hover:not(:disabled) { background: #fee2e2; color: #b91c1c; }
.inv-ui .inv-add:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.inv-ui .inv-btn:hover:not(:disabled) { filter: brightness(0.96); }
.inv-ui .inv-grid-2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; align-items: start; }
.inv-ui .inv-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.inv-ui .inv-line-grid { display: grid; grid-template-columns: 32px minmax(0,1fr) 84px 150px 150px 36px; column-gap: 10px; align-items: center; }
.inv-ui .inv-pay-table th, .inv-ui .inv-pay-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
@media (max-width: 960px) {
  .inv-ui .inv-grid-2 { grid-template-columns: minmax(0,1fr); }
}
@media (max-width: 640px) {
  .inv-ui .inv-inline { flex-direction: column !important; gap: 0 !important; }
  .inv-ui .inv-line-grid { grid-template-columns: 72px minmax(0,1fr) 32px; row-gap: 6px; }
  .inv-ui .inv-col-prod { grid-column: 1 / -1; }
  .inv-ui .inv-line-head, .inv-ui .inv-col-stt, .inv-ui .inv-col-total { display: none !important; }
  .inv-ui .inv-sum-row { flex-wrap: wrap !important; row-gap: 6px; }
  .inv-ui .inv-sum-label { width: 120px !important; }
  .inv-ui .inv-hold-note { padding-left: 0 !important; }
  .inv-ui .inv-hide-sm { display: none !important; }
  .inv-ui .inv-actions { flex-direction: column-reverse; align-items: stretch !important; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: C.bg, color: C.text },
  header: {
    padding: "14px 20px",
    borderBottom: `1px solid ${C.border}`,
    background: C.card,
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: -0.2 },
  body: {
    flex: 1,
    minHeight: 0,
    padding: "20px 20px 0",
    display: "flex",
    justifyContent: "center",
    overflowY: "auto",
  },
  content: { width: "100%", maxWidth: 1180 },
  backBtn: {
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    cursor: "pointer",
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
  },
  form: { display: "flex", flexDirection: "column", gap: 16, fontSize: 14 },
  sectionBox: {
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: "16px 18px",
    background: C.card,
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    minWidth: 0,
  },
  sectionTitle: {
    fontWeight: 700,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: C.muted,
    marginBottom: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  formRow: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  rowInline: { display: "flex", gap: 12 },
  flex1: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  label: { fontWeight: 600, fontSize: 12.5, color: "#334155" },
  input: {
    height: 38,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${C.borderInput}`,
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
    background: "#fff",
    color: C.text,
  },
  select: {
    height: 38,
    padding: "0 10px",
    borderRadius: 8,
    border: `1px solid ${C.borderInput}`,
    fontSize: 14,
    background: "#fff",
    width: "100%",
    boxSizing: "border-box",
    color: C.text,
  },
  autoWrapper: { position: "relative", minWidth: 0 },
  suggestBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    maxHeight: 300,
    overflowY: "auto",
    zIndex: 30,
    marginTop: 4,
    boxShadow: "0 12px 28px rgba(15,23,42,0.14)",
    padding: 4,
  },
  suggestItem: { padding: "8px 10px", fontSize: 13, cursor: "pointer", borderRadius: 6 },
  suggestItemMuted: { padding: "8px 10px", fontSize: 12.5, color: "#94a3b8" },

  gridHeader: {
    fontSize: 11.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    color: C.muted,
    padding: "8px 8px",
    background: C.soft,
    borderRadius: 8,
    marginBottom: 4,
  },
  gridRow: {
    padding: "8px 8px",
    borderBottom: `1px solid ${C.soft}`,
    borderRadius: 6,
  },
  smallInput: {
    width: "100%",
    height: 36,
    padding: "0 10px",
    borderRadius: 8,
    border: `1px solid ${C.borderInput}`,
    fontSize: 13.5,
    boxSizing: "border-box",
    background: "#fff",
    color: C.text,
  },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  },
  addLineBtn: {
    marginTop: 10,
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px dashed ${C.borderInput}`,
    background: "#fff",
    color: C.text,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    width: "100%",
    textAlign: "center",
  },
  totalBox: {
    width: "100%",
    fontSize: 14,
    fontWeight: 600,
    boxSizing: "border-box",
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },

  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "7px 0",
    fontSize: 13.5,
    flexWrap: "nowrap",
  },
  summaryLabel: { fontWeight: 500, color: "#475569", width: 150, flexShrink: 0 },
  summaryValue: {
    marginLeft: "auto",
    textAlign: "right",
    fontWeight: 600,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  totalRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    margin: "8px -18px",
    padding: "12px 18px",
    background: C.primary,
    color: "#fff",
    fontSize: 15,
  },

  formActions: {
    position: "sticky",
    bottom: 0,
    zIndex: 20,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    margin: "4px -20px 0",
    padding: "12px 20px",
    background: "rgba(255,255,255,0.96)",
    backdropFilter: "blur(6px)",
    borderTop: `1px solid ${C.border}`,
  },
  primaryBtn: {
    height: 40,
    padding: "0 20px",
    borderRadius: 8,
    border: "none",
    background: C.primary,
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
  secondaryBtn: {
    height: 40,
    padding: "0 16px",
    borderRadius: 8,
    border: `1px solid ${C.borderInput}`,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: C.text,
  },
  secondarySmallBtn: {
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${C.borderInput}`,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: C.text,
  },

  postStatusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  notice: { padding: "10px 14px", borderRadius: 10, fontSize: 13.5, lineHeight: 1.5 },
  noticeSuccess: { background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" },
  noticeError: { background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" },
};

/** Nhãn trạng thái dạng "viên thuốc" */
function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color,
    whiteSpace: "nowrap",
    textTransform: "none",
    letterSpacing: 0,
  };
}

function dangerBtn(disabled?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 8,
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
    borderRadius: 8,
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

// =====================================================================
// ✅ MỚI: Tạo nhanh mã hàng ngay trong hoá đơn (chỉ kế toán / admin)
// - gọi đúng API POST /items như trang Tồn máy / Tồn linh kiện (không sửa BE)
// - chặn: trùng tên; máy trùng mã; máy thiếu mã
// - hiện mã gần giống để chọn lại mã cũ thay vì tạo trùng
// =====================================================================
type UnitOpt = { id: string; code: string; name: string };

const QuickCreateItemModal: React.FC<{
  open: boolean;
  initialText: string;
  initialSku?: string; // ✅ từ file nhập: điền sẵn đúng mã / tên / loại
  initialName?: string;
  initialKind?: "PART" | "MACHINE";
  items: Item[];
  onClose: () => void;
  onCreated: (it: Item) => void;
  onPickExisting: (it: Item) => void;
}> = ({ open, initialText, initialSku, initialName, initialKind, items, onClose, onCreated, onPickExisting }) => {
  const [kind, setKind] = useState<"PART" | "MACHINE">("PART");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // điền sẵn từ chữ đã gõ: dạng mã (không khoảng trắng, có số) -> ô Mã, còn lại -> ô Tên
  useEffect(() => {
    if (!open) return;
    const t = (initialText || "").trim();
    const looksLikeCode = !/\s/.test(t) && /\d/.test(t) && t.length <= 30;
    if (initialSku !== undefined || initialName !== undefined) {
      setSku((initialSku || "").trim());
      setName((initialName || "").trim());
    } else {
      setSku(looksLikeCode ? t.toUpperCase() : "");
      setName(looksLikeCode ? "" : t);
    }
    setKind(initialKind || "PART");
    setSellPrice("");
    setErr(null);
    setBusy(false);
  }, [open, initialText, initialSku, initialName, initialKind]);

  // sửa ô nào thì xoá thông báo lỗi cũ
  useEffect(() => {
    setErr(null);
  }, [kind, sku, name]);

  useEffect(() => {
    if (!open || units.length) return;
    (async () => {
      try {
        const res = await api.get("/items/units");
        const list: UnitOpt[] = res?.data?.data || res?.data || [];
        setUnits(Array.isArray(list) ? list : []);
        const pcs = (Array.isArray(list) ? list : []).find((u) => u.code === "pcs");
        setUnitId((cur) => cur || pcs?.id || list[0]?.id || "");
      } catch {
        setErr("Không tải được danh sách ĐVT.");
      }
    })();
  }, [open, units.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const nName = normalizeVN(name);
  const cSku = compactKey(sku);
  const sameName = nName ? items.find((x) => normalizeVN(x.name) === nName) : undefined;
  const sameMachineSku =
    kind === "MACHINE" && cSku ? items.find((x) => x.kind === "MACHINE" && compactKey(x.sku || "") === cSku) : undefined;

  // mã gần giống: trùng mã (dạng liền) hoặc tên chứa đủ các từ đã gõ
  const similar = useMemo(() => {
    if (!open) return [];
    const toks = nName.split(" ").filter((t) => t.length >= 2);
    const cName = compactKey(name);
    // từ dạng mã (có cả chữ và số, VD dz400, 6050s) -> so dạng liền với mã/tên đang có
    const codeToks = `${name} ${sku}`
      .split(/\s+/)
      .map((t) => compactKey(t))
      .filter((t) => t.length >= 4 && /\d/.test(t) && /[a-z]/.test(t));
    return items
      .map((x) => {
        const xs = compactKey(x.sku || "");
        const xn = normalizeVN(x.name);
        let s = 0;
        if (cSku && xs === cSku) s = 3;
        else if (cSku.length >= 3 && (xs.includes(cSku) || compactKey(x.name).includes(cSku))) s = 2;
        else if (codeToks.some((t) => compactKey(`${x.sku || ""} ${x.name}`).includes(t))) s = 2;
        else if (toks.length && toks.filter((t) => xn.includes(t)).length / toks.length >= 0.6) s = 1;
        else if (cName.length >= 4 && compactKey(`${x.sku || ""}${x.name}`).includes(cName)) s = 1;
        return { x, s };
      })
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((r) => r.x);
  }, [open, items, nName, cSku, name]);

  if (!open) return null;

  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#334155", marginBottom: 4, display: "block" };
  const input: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setErr(null);
    const n = name.trim();
    const s = sku.trim();
    if (!n) return setErr("Vui lòng nhập TÊN hàng.");
    if (kind === "MACHINE" && !s) return setErr("Máy bắt buộc phải có MÃ (mỗi máy 1 mã riêng).");
    if (sameName) return setErr(`Tên này đã có trong danh mục: [${sameName.sku || "—"}] ${sameName.name}. Hãy chọn mã đó thay vì tạo mới.`);
    if (sameMachineSku) return setErr(`Mã máy "${s}" đã được dùng cho: ${sameMachineSku.name}. Mỗi máy phải 1 mã riêng.`);
    if (!unitId) return setErr("Vui lòng chọn ĐVT.");
    const sp = sellPrice.trim() === "" ? undefined : Number(sellPrice.replace(/[.,\s]/g, ""));
    if (sp !== undefined && (Number.isNaN(sp) || sp < 0)) return setErr("Giá bán không hợp lệ.");

    try {
      setBusy(true);
      const res = await api.post("/items", { sku: s || undefined, name: n, unitId, kind, sellPrice: sp });
      const c: any = res?.data?.data ?? res?.data;
      if (!c?.id) throw new Error("Không nhận được mã vừa tạo.");
      onCreated({
        id: String(c.id),
        sku: c.sku,
        name: c.name,
        unit: c.unit,
        price: Number(c.sellPrice ?? c.price ?? 0),
        stockQty: 0,
        kind: c.kind,
      });
    } catch (ex: any) {
      const status = ex?.response?.status;
      setErr(
        status === 403
          ? "Bạn không có quyền tạo mã hàng (chỉ kế toán / admin)."
          : ex?.response?.data?.message || ex?.response?.data?.error || ex?.message || "Tạo mã hàng thất bại."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlay} onMouseDown={() => !busy && onClose()}>
      <form
        style={{ ...modalCard, maxWidth: 560, width: "calc(100vw - 32px)" }}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div style={modalHeader}>
          <div>
            <div style={modalTitle}>Tạo mã hàng mới</div>
            <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>
              Tạo xong sẽ tự chọn vào dòng hoá đơn. Giá vốn lấy theo phiếu nhập khi duyệt.
            </div>
          </div>
          <button type="button" style={modalCloseBtn} onClick={onClose} disabled={busy} title="Đóng (ESC)">
            ✕
          </button>
        </div>

        <div style={{ ...modalBody, display: "grid", gap: 12, padding: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["PART", "MACHINE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: kind === k ? "1.5px solid #0f172a" : "1px solid #cbd5e1",
                  background: kind === k ? "#0f172a" : "#fff",
                  color: kind === k ? "#fff" : "#334155",
                }}
              >
                {k === "PART" ? "Linh kiện" : "Máy"}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)", gap: 10 }}>
            <div>
              <label style={label}>Mã {kind === "MACHINE" ? <span style={{ color: "#dc2626" }}>*</span> : <span style={{ color: "#94a3b8", fontWeight: 400 }}>(trống = tự sinh)</span>}</label>
              <input style={{ ...input, ...(sameMachineSku ? { borderColor: "#ef4444" } : {}) }} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VD: FXA-6050S" autoFocus={!!sku === false && !name} />
            </div>
            <div>
              <label style={label}>Tên <span style={{ color: "#dc2626" }}>*</span></label>
              <input style={{ ...input, ...(sameName ? { borderColor: "#ef4444" } : {}) }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên đầy đủ, có thông số" autoFocus={!!sku} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
            <div>
              <label style={label}>ĐVT <span style={{ color: "#dc2626" }}>*</span></label>
              <select style={input} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Giá bán <span style={{ color: "#94a3b8", fontWeight: 400 }}>(không bắt buộc)</span></label>
              <input
                style={{ ...input, textAlign: "right" }}
                inputMode="numeric"
                value={sellPrice}
                onChange={(e) => {
                  const d = e.target.value.replace(/[^\d]/g, "");
                  setSellPrice(d ? Number(d).toLocaleString("vi-VN") : "");
                }}
                placeholder="0"
              />
            </div>
          </div>

          {similar.length > 0 && (
            <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
                Đã có mã gần giống — kiểm tra trước khi tạo mới để tránh trùng:
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {similar.map((x) => (
                  <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    {x.sku ? (
                      <span style={{ background: "#fef3c7", borderRadius: 6, padding: "1px 6px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{x.sku}</span>
                    ) : null}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.name}>
                      {x.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPickExisting(x)}
                      style={{ border: "1px solid #d97706", color: "#92400e", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      Dùng mã này
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err && (
            <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>{err}</div>
          )}
        </div>

        <div style={modalFooter}>
          <button type="button" style={styles.secondarySmallBtn} onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="submit" style={primarySmallBtn(busy)} disabled={busy}>
            {busy ? "Đang tạo..." : "Tạo mã & chọn vào dòng"}
          </button>
        </div>
      </form>
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
  // ✅ MỚI: quyền tạo nhanh mã hàng trong hoá đơn (khớp BE: POST /items chỉ accountant|admin)
  const canCreateItem = ["admin", "accountant"].includes(String(me.role || "").trim().toLowerCase());
  const [quickCreate, setQuickCreate] = useState<{
    lineIdx: number;
    text: string;
    sku?: string;
    name?: string;
    kind?: "PART" | "MACHINE";
  } | null>(null);

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
        compact: compactKey(`${it.sku || ""} ${it.name || ""}`), // ✅ FIX: gõ liền không gạch
        compactSku: compactKey(it.sku || ""),
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

  // =====================================================================
  // ✅ MỚI: NHẬP TỪ FILE — chỉ đổ dòng vào bảng sản phẩm, lưu vẫn bằng handleSave cũ
  // =====================================================================
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  async function handleImportFile(file: File) {
    if (!invoice) return;
    if (invoice.lines.some((l) => l._imp)) {
      toastError("Phiếu đang có dòng từ 1 file khác. Bấm “Bỏ các dòng từ file” trước khi nhập file mới.", "Đã có dòng từ file");
      return;
    }
    try {
      setImportBusy(true);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", String(invoice.type));
      if (invoice.partnerId) fd.append("partnerId", String(invoice.partnerId));
      const res = await api.post("/invoice-import/analyze", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const d: any = res?.data?.data;
      if (!d || !Array.isArray(d.lines)) throw new Error("Phản hồi không hợp lệ");

      const byId = new Map(items.map((i) => [i.id, i]));
      const newLines: InvoiceLine[] = d.lines
        .filter((l: any) => l.status !== "skip")
        .map((l: any) => {
          const meta: ImpMeta = {
            status: l.status,
            row: l.row,
            code: l.code || "",
            name: l.name || "",
            unit: l.unit || "",
            reason: l.reason || "",
            flags: l.flags || [],
            candidates: l.candidates || [],
            rawKey: l.rawKey,
            autoItemId: l.status === "ok" ? l.itemId : null,
          };
          if (l.status === "ok" && l.itemId) {
            const it = byId.get(String(l.itemId));
            const c = meta.candidates.find((x) => x.itemId === l.itemId);
            return { itemId: String(l.itemId), itemName: it?.name || c?.name || l.name, unit: it?.unit ?? c?.unit, qty: l.qty, price: l.price, _imp: meta };
          }
          // 🟡 / 🔵: để TRỐNG itemId -> bắt buộc người dùng chọn / tạo mã (khoá lưu đã có sẵn)
          return { itemId: undefined, itemName: l.name, unit: l.unit || "", qty: l.qty, price: l.price, _imp: meta };
        });

      markDirty();
      setInvoice((prev) => {
        if (!prev) return prev;
        const keep = prev.lines.filter((l) => l.itemId || (l.itemName || "").trim() || Number(l.price || 0) > 0);
        return recomputeInvoiceCore(prev, { lines: [...keep, ...newLines] });
      });
      setImportInfo({
        fileName: d.fileName,
        fileHash: d.fileHash,
        invoiceKey: d.invoiceKey || "",
        invoiceNo: d.invoiceNo || "",
        source: d.source,
        fileTotal: d.totals?.fileTotal ?? null,
        critical: d.critical || [],
        warnings: d.warnings || [],
        partner: d.partner || null,
        ack: false,
        confirmed: false,
      });
      const c = d.count || {};
      toastSuccess(`Đã đưa ${newLines.length} dòng vào phiếu: ${c.ok || 0} tự khớp · ${c.check || 0} cần chọn · ${c.new || 0} chưa có mã.`, "Nhập từ file");
    } catch (err: any) {
      toastError(err?.response?.data?.message || err?.message || "Không đọc được file.", "Nhập từ file thất bại");
    } finally {
      setImportBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  function clearImportedLines() {
    markDirty();
    setInvoice((prev) => (prev ? recomputeInvoiceCore(prev, { lines: prev.lines.filter((l) => !l._imp) }) : prev));
    setImportInfo(null);
  }

  async function downloadImportTemplate() {
    try {
      const res = await api.get("/invoice-import/template", { params: { kind: "ALL" }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mau-nhap-hang.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err: any) {
      toastError(err?.message || "Không tải được file mẫu.");
    }
  }

  // Sau khi LƯU thành công (handleSave cũ đặt dirty=false) -> ghi nhật ký chống trùng + ghi nhớ lựa chọn
  useEffect(() => {
    if (!importInfo || importInfo.confirmed || dirtySinceLastSave || !invoice?.id) return;
    const picks = invoice.lines
      .filter((l) => l._imp && l.itemId && (l._imp.status !== "ok" || String(l.itemId) !== String(l._imp.autoItemId)))
      .map((l) => ({ rawKey: l._imp!.rawKey, rawText: `${l._imp!.code} ${l._imp!.name}`.trim(), itemId: String(l.itemId) }));
    setImportInfo((p) => (p ? { ...p, confirmed: true } : p));
    api
      .post("/invoice-import/confirm", {
        invoiceId: String(invoice.id),
        fileHash: importInfo.fileHash,
        invoiceKey: importInfo.invoiceKey,
        fileName: importInfo.fileName,
        type: invoice.type,
        partnerId: invoice.partnerId ? String(invoice.partnerId) : "",
        picks,
      })
      .catch((e) => console.warn("invoice-import confirm failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importInfo, dirtySinceLastSave, invoice?.id]);

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

  // ✅ FIX: danh sách cũ quá 60s thì tải lại khi quay lại tab hoặc bấm vào ô tìm
  const lastLoadRef = useRef<{ items: number; partners: number }>({ items: 0, partners: 0 });
  const STALE_MS = 60_000;
  function refreshListsIfStale(which: "items" | "partners" | "both" = "both") {
    const now = Date.now();
    if ((which === "items" || which === "both") && now - lastLoadRef.current.items > STALE_MS) {
      lastLoadRef.current.items = now;
      loadItems();
    }
    if ((which === "partners" || which === "both") && now - lastLoadRef.current.partners > STALE_MS) {
      lastLoadRef.current.partners = now;
      loadPartners();
    }
  }
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshListsIfStale("both");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPartners() {
    try {
      const arr: any[] = await fetchAllPages("/partners"); // ✅ FIX: hết danh sách, không còn giới hạn 100
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
      lastLoadRef.current.partners = Date.now();
    } catch (err) {
      console.error("loadPartners error", err);
    }
  }

  async function loadItems() {
    try {
      const arr: any[] = await fetchAllPages("/items"); // ✅ FIX: hết danh mục, không còn giới hạn 1000
      const mapped: Item[] = arr.map((i: any) => ({
        id: String(i.id),
        sku: i.sku || i.code,
        name: i.name,
        unit: i.unit,
        // ✅ non-admin API chỉ trả sellPrice (không có price) — fallback để không bị mất giá
        price: Number(i.sellPrice ?? i.price ?? 0),
        stockQty: Number(i.stockQty ?? 0),
        kind: i.kind,
      }));
      setItems(mapped);
      lastLoadRef.current.items = Date.now();
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

    // ✅ FIX: dòng đã gõ tên / giá nhưng CHƯA chọn sản phẩm từ danh sách -> trước đây BE lặng lẽ bỏ dòng đó
    const badLines = invoice.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !l.itemId && ((l.itemName || "").trim() !== "" || Number(l.price || 0) > 0));
    if (badLines.length) {
      toastError(
        `Dòng ${badLines.map((x) => x.i + 1).join(", ")} chưa chọn sản phẩm từ danh sách gợi ý. Hãy chọn sản phẩm (hoặc xoá dòng) rồi lưu lại.`,
        "Chưa chọn sản phẩm"
      );
      setOpenItemSuggestIndex(badLines[0].i);
      return;
    }

    // ✅ MỚI: file nhập có cảnh báo quan trọng (nhập trùng / lệch tổng / HĐ điều chỉnh) -> phải tick "đã kiểm tra"
    if (importInfo && !importInfo.confirmed && importInfo.critical.length && !importInfo.ack) {
      toastError("File vừa nhập có cảnh báo quan trọng (khung đỏ phía trên bảng sản phẩm). Đọc kỹ rồi tick “Tôi đã kiểm tra” trước khi lưu.", "Chưa xác nhận cảnh báo");
      return;
    }

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
      <div style={styles.page} className="inv-ui">
        <style>{INV_CSS}</style>
        <div style={styles.header}>
          <h1 style={styles.headerTitle}>Hóa đơn</h1>
        </div>
        <div style={styles.body}>
          <div style={{ ...styles.content, color: C.muted, padding: 24 }}>Đang tải...</div>
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

  // ✅ FIX: tìm không dấu, theo tên + mã + MST + SĐT (trước: phải gõ đúng dấu, chỉ theo tên)
  const partnerSuggestions = (() => {
    const q = normalizeVN(invoice.partnerName || "");
    if (!q) return [];
    const tokens = q.split(" ").filter(Boolean);
    const qc = compactKey(q);
    return partners
      .map((p) => ({ p, hay: partnerHay(p) }))
      .filter(({ p, hay }) => tokens.every((t) => hay.includes(t)) || (qc.length >= 4 && (compactKey(p.taxCode || "") + " " + compactKey(p.phone || "")).includes(qc)))
      .sort((a, b) => {
        const sc = (x: { p: Partner; hay: string }) =>
          compactKey(x.p.taxCode || "") === qc || compactKey(x.p.phone || "") === qc ? 0 : normalizeVN(x.p.name).startsWith(q) ? 1 : 2;
        return sc(a) - sc(b);
      })
      .slice(0, 20)
      .map((x) => x.p);
  })();

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

  // ---- nhãn hiển thị (chỉ UI)
  const statusPill =
    status === "APPROVED"
      ? pill("#dcfce7", "#166534")
      : status === "SUBMITTED"
        ? pill("#fef3c7", "#92400e")
        : status === "REJECTED"
          ? pill("#fee2e2", "#991b1b")
          : pill("#e2e8f0", "#334155");
  const partnerWord = isPurchase ? "Nhà cung cấp" : "Khách hàng";
  const filledLines = invoice.lines.filter((l) => l.itemId).length;

  return (
    <div style={styles.page} className="inv-ui">
      <style>{INV_CSS}</style>

      <div style={styles.header}>
        <button type="button" style={styles.backBtn} onClick={goBackToInvoices} className="inv-btn">
          ← Danh sách
        </button>
        <h1 style={styles.headerTitle}>{title}</h1>
        <span style={isPurchase ? pill("#e0f2fe", "#075985") : pill("#ede9fe", "#5b21b6")}>
          {isPurchase ? "Nhập hàng" : "Bán hàng"}
        </span>
        <span style={statusPill}>● {statusText}</span>
        {invoice.code ? (
          <span style={{ marginLeft: "auto", fontSize: 13, color: C.muted }}>
            Số HĐ: <b style={{ color: C.text }}>{invoice.code}</b>
          </span>
        ) : null}
      </div>

      <div style={styles.body}>
        <div style={styles.content}>
          {/* APPROVED notice */}
          {status === "APPROVED" && !canEditApprovedAdjust && (
            <div style={{ ...styles.notice, marginBottom: 16, background: "#eef2ff", border: "1px solid #c7d2fe", color: "#3730a3" }}>
              Hóa đơn đã <b>DUYỆT</b>. Không thể sửa trực tiếp hóa đơn gốc.
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
            <div style={{ ...styles.notice, marginBottom: 16, background: "#ecfeff", border: "1px solid #67e8f9", color: "#155e75" }}>
              Bạn đang ở chế độ <b>ĐIỀU CHỈNH</b> (admin). Bấm <b>{saveLabel}</b> sẽ tự rollback movement cũ, lưu lại nội dung
              mới và post tồn kho lại (auto <b>APPROVED</b>).
              <div style={{ marginTop: 6, fontSize: 12.5, color: "#0e7490" }}>
                (Link: <code>?adjust=1</code>)
              </div>
            </div>
          )}

          {(status === "SUBMITTED" || status === "REJECTED") && (
            <div style={{ ...styles.notice, ...styles.noticeError, marginBottom: 16 }}>
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
            <div className="inv-grid-2">
              <div className="inv-col">
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
                      placeholder={canEditInvoiceCode ? "Để trống thì hệ thống tự nhảy số" : "số tự nhảy"}
                      onChange={(e) => {
                        if (!canEditInvoiceCode) return;
                        markDirty();
                        updateInvoice({ code: e.target.value });
                      }}
                    />
                  </div>

                  <div style={styles.rowInline} className="inv-inline">
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
                        <div style={{ fontSize: 12, color: C.muted }}>* Hóa đơn đã phát sinh nghiệp vụ nên không đổi loại.</div>
                      )}
                    </div>
                  </div>

                  {invoice.type === "SALES" && (
                    <div style={{ fontSize: 13, color: returnColor }}>
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

                {/* Nhân viên phụ trách */}
                {invoice.type !== "PURCHASE" && (
                  <div style={styles.sectionBox}>
                    <div style={styles.sectionTitle}>Nhân viên phụ trách</div>

                    <div style={styles.rowInline} className="inv-inline">
                      <div style={{ ...styles.flex1, marginBottom: 0 }}>
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

                      <div style={{ ...styles.flex1, marginBottom: 0 }}>
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
              </div>

              {/* Khách hàng / Nhà cung cấp */}
              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>
                  <span>{partnerWord}</span>
                  {status === "DRAFT" &&
                    (partnerOk ? (
                      <span style={pill("#dcfce7", "#166534")}>✓ Đã có trong danh sách</span>
                    ) : (
                      <span style={pill("#fee2e2", "#991b1b")}>Chưa chọn / chưa lưu</span>
                    ))}
                </div>

                <div
                  style={{ ...styles.formRow, ...styles.autoWrapper }}
                  onBlur={() => setTimeout(() => setShowPartnerSuggest(false), 150)}
                >
                  <label style={styles.label}>Tên {partnerWord.toLowerCase()} (gõ để tìm)</label>
                  <input
                    ref={partnerInputRef}
                    style={{
                      ...styles.input,
                      ...(status === "DRAFT" && !locked && !partnerOk ? { borderColor: "#fca5a5" } : {}),
                    }}
                    value={invoice.partnerName}
                    disabled={locked || status !== "DRAFT"} // policy: approved adjust-mode không cho đổi khách ở đây (đỡ rủi ro)
                    onChange={(e) => handlePartnerNameChange(e.target.value)}
                    onFocus={() => {
                      setShowPartnerSuggest(true);
                      refreshListsIfStale("partners");
                    }}
                    placeholder={`Nhập tên ${partnerWord.toLowerCase()}...`}
                  />

                  {/* ✅ warning inline để nhân viên khỏi quên bấm lưu khách */}
                  {status === "DRAFT" && !locked && !partnerOk && (
                    <div style={{ fontSize: 12.5, color: "#b91c1c" }}>
                      Chọn từ danh sách gợi ý, hoặc bấm “Lưu vào danh sách đối tác” bên dưới trước khi lưu hóa đơn.
                    </div>
                  )}

                  {showPartnerSuggest && !locked && status === "DRAFT" && partnerSuggestions.length > 0 && (
                    <div style={styles.suggestBox}>
                      {partnerSuggestions.map((p) => (
                        <div
                          key={p.id}
                          className="inv-suggest-item"
                          style={styles.suggestItem}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectPartner(p);
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: C.muted }}>
                            {[p.code, p.taxCode ? `MST ${p.taxCode}` : "", p.phone].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {status !== "DRAFT" && (
                    <div style={{ fontSize: 12, color: C.muted }}>* Hóa đơn đã phát sinh nghiệp vụ: không đổi {partnerWord.toLowerCase()} tại đây.</div>
                  )}
                </div>

                <div style={styles.rowInline} className="inv-inline">
                  <div style={styles.flex1}>
                    <label style={styles.label}>Mã {partnerWord.toLowerCase()}</label>
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

                <div style={styles.rowInline} className="inv-inline">
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
                </div>

                <button
                  type="button"
                  className="inv-btn"
                  style={styles.secondarySmallBtn}
                  disabled={locked || status !== "DRAFT"}
                  onClick={handleSavePartner}
                >
                  + Lưu vào danh sách đối tác
                </button>
              </div>
            </div>

            {/* Dòng sản phẩm */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>
                <span>Dòng sản phẩm</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {/* ✅ MỚI: nhập từ file */}
                  {!locked && (invoice.type === "PURCHASE" || invoice.type === "SALES") && (
                    <>
                      <button
                        type="button"
                        style={{ ...styles.secondarySmallBtn, textTransform: "none", letterSpacing: 0 }}
                        onClick={downloadImportTemplate}
                        title="File Excel có sẵn toàn bộ mã hàng + cột ID ẩn: chỉ điền Số lượng, Đơn giá"
                      >
                        Tải file mẫu
                      </button>
                      <button
                        type="button"
                        style={{ ...primarySmallBtn(importBusy), textTransform: "none", letterSpacing: 0 }}
                        disabled={importBusy}
                        onClick={() => importFileRef.current?.click()}
                        title="Excel container / file mẫu / hoá đơn điện tử .xml"
                      >
                        {importBusy ? "Đang đọc file..." : "Nhập từ file"}
                      </button>
                      <input
                        ref={importFileRef}
                        type="file"
                        accept=".xlsx,.xls,.xlsm,.csv,.xml"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImportFile(f);
                        }}
                      />
                    </>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
                    {filledLines} / {invoice.lines.length} dòng đã chọn sản phẩm
                  </span>
                </span>
              </div>

              {importInfo && !importInfo.confirmed && (() => {
                const imp = invoice.lines.filter((l) => l._imp);
                const auto = imp.filter((l) => l.itemId && l._imp!.status === "ok" && String(l.itemId) === String(l._imp!.autoItemId)).length;
                const picked = imp.filter((l) => l.itemId).length;
                const left = imp.length - picked;
                const sum = imp.reduce((t, l) => t + Number(l.qty || 0) * Number(l.price || 0), 0);
                const ft = importInfo.fileTotal;
                const diff = ft == null ? null : Math.round(sum - ft);
                const pm = importInfo.partner?.match;
                return (
                  <div style={{ border: `1px solid ${C.border}`, background: "#f8fafc", borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 13, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ wordBreak: "break-all" }}>📄 {importInfo.fileName}</b>
                      {importInfo.invoiceNo && <span style={{ color: C.muted }}>HĐ {importInfo.invoiceNo}</span>}
                      <span style={{ ...pill("#dcfce7", "#166534") }}>🟢 Tự khớp {auto}</span>
                      <span style={{ ...pill("#e0f2fe", "#075985") }}>✓ Đã chọn {picked - auto}</span>
                      <span style={{ ...pill(left ? "#fef3c7" : "#f1f5f9", left ? "#92400e" : "#475569") }}>Còn phải chọn / tạo mã: {left}</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" style={{ ...styles.secondarySmallBtn, textTransform: "none" }} disabled={locked} onClick={clearImportedLines}>
                        Bỏ các dòng từ file
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <span>
                        Tổng các dòng từ file: <b>{formatMoney(sum)} đ</b>
                      </span>
                      {ft != null && (
                        <span style={{ color: diff ? "#b91c1c" : "#166534", fontWeight: 600 }}>
                          Tổng ghi trong file: {formatMoney(ft)} đ {diff ? `· lệch ${formatMoney(diff)} đ` : "· khớp ✓"}
                        </span>
                      )}
                    </div>
                    {importInfo.partner?.data?.name && (
                      <div>
                        {invoice.type === "PURCHASE" ? "Nhà cung cấp" : "Khách hàng"} trong file: <b>{importInfo.partner.data.name}</b>
                        {importInfo.partner.data.taxCode ? ` · MST ${importInfo.partner.data.taxCode}` : ""}
                        {pm ? (
                          String(invoice.partnerId || "") === String(pm.id) ? (
                            <span style={{ color: "#166534", marginLeft: 8 }}>✓ đã chọn đúng</span>
                          ) : (
                            <button type="button" style={{ ...styles.secondarySmallBtn, marginLeft: 8, textTransform: "none" }} disabled={locked} onClick={() => selectPartner(pm as Partner)}>
                              Chọn “{pm.name}” trong CRM
                            </button>
                          )
                        ) : (
                          <span style={{ color: "#92400e", marginLeft: 8 }}>chưa có trong CRM — nhập ở khung đối tác phía trên</span>
                        )}
                      </div>
                    )}
                    {importInfo.critical.length > 0 && (
                      <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 8, padding: "8px 10px", display: "grid", gap: 4 }}>
                        {importInfo.critical.map((t, i) => (
                          <div key={i}>⛔ {t}</div>
                        ))}
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600, marginTop: 4, cursor: "pointer" }}>
                          <input type="checkbox" checked={importInfo.ack} onChange={(e) => setImportInfo((p) => (p ? { ...p, ack: e.target.checked } : p))} />
                          Tôi đã kiểm tra các cảnh báo trên
                        </label>
                      </div>
                    )}
                    {importInfo.warnings.length > 0 && (
                      <details>
                        <summary style={{ cursor: "pointer", color: "#92400e" }}>{importInfo.warnings.length} lưu ý khi đọc file</summary>
                        <div style={{ display: "grid", gap: 2, marginTop: 4, color: "#78350f" }}>
                          {importInfo.warnings.map((t, i) => (
                            <div key={i}>• {t}</div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}

              <div style={styles.gridHeader} className="inv-line-grid inv-line-head">
                <div className="inv-col-stt" style={{ textAlign: "center" }}>#</div>
                <div style={{ textAlign: "left" }}>Sản phẩm</div>
                <div style={{ textAlign: "center" }}>SL</div>
                <div style={{ textAlign: "right" }}>Đơn giá</div>
                <div className="inv-col-total" style={{ textAlign: "right" }}>Thành tiền</div>
                <div />
              </div>

              {invoice.lines.length === 0 && (
                <div style={{ fontSize: 13, color: C.muted, padding: "18px 8px", textAlign: "center" }}>
                  Chưa có dòng sản phẩm, bấm “+ Thêm dòng sản phẩm”.
                </div>
              )}

              {invoice.lines.map((line, idx) => {
                // ✅ FIX: search cũ dùng .toLowerCase().includes() nên gõ không dấu
                // (vd "may ep") sẽ KHÔNG khớp được với tên có dấu ("Máy ép") — đây
                // chính là lý do trước giờ phải đổi tên/mã sản phẩm mới tìm ra được.
                const qRaw = (line.itemName || "").trim();
                const qNorm = normalizeVN(qRaw);
                const qTokens = qNorm.split(" ").filter(Boolean);
                const qCompact = compactKey(qRaw);
                // ✅ FIX: dòng đã chọn hàng -> hiện dạng "thẻ" khoá, muốn đổi phải bấm ✕ (tránh chọn A rồi sửa chữ thành B)
                const picked = !!line.itemId;
                const missingItem = !line.itemId && ((line.itemName || "").trim() !== "" || Number(line.price || 0) > 0);

                const itemSuggestions =
                  qTokens.length > 0
                    ? itemsSearchIndex
                        .filter(({ normName, normSku, compact }) => {
                          const hay = `${normName} ${normSku}`;
                          // mỗi từ gõ vào phải xuất hiện đâu đó trong tên/mã
                          // (không cần đúng thứ tự, không cần dấu, không phân biệt hoa/thường)
                          if (qTokens.every((t) => hay.includes(t))) return true;
                          // ✅ FIX: gõ liền không gạch/khoảng trắng (cke020, dz600, sh100)
                          return qCompact.length >= 3 && compact.includes(qCompact);
                        })
                        // ✅ ưu tiên: khớp đúng mã SKU > tên bắt đầu bằng từ khoá > còn lại
                        .sort((a, b) => {
                          const score = (x: typeof a) => {
                            if (x.normSku === qNorm || (qCompact && x.compactSku === qCompact)) return 0;
                            if (x.normSku.startsWith(qNorm) || (qCompact.length >= 3 && x.compactSku.startsWith(qCompact))) return 1;
                            if (x.normName.startsWith(qNorm)) return 2;
                            return 3;
                          };
                          return score(a) - score(b);
                        })
                        .slice(0, 50)
                        .map(({ item }) => item)
                    : [];

                return (
                  <div key={line.id ?? `line-${idx}`} style={styles.gridRow} className="inv-line-grid inv-line">
                    <div className="inv-col-stt" style={{ textAlign: "center", fontSize: 12.5, color: "#94a3b8", fontWeight: 600 }}>
                      {idx + 1}
                    </div>

                    <div style={styles.autoWrapper} className="inv-col-prod">
                      {picked ? (
                        <div
                          style={{
                            ...styles.smallInput,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: locked ? "#f8fafc" : "#f8fafc",
                            border: "1px solid #cbd5e1",
                            overflow: "hidden",
                          }}
                          title={line.itemName}
                        >
                          {(() => {
                            const it = items.find((x) => x.id === String(line.itemId));
                            return it?.sku ? (
                              <span style={{ background: C.soft, borderRadius: 6, padding: "1px 6px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {it.sku}
                              </span>
                            ) : null;
                          })()}
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.itemName}</span>
                          {!locked && (
                            <button
                              type="button"
                              className="inv-del"
                              style={{ ...styles.smallBtn, width: 24, height: 24, fontSize: 13 }}
                              title="Bỏ chọn để chọn sản phẩm khác"
                              aria-label="Bỏ chọn sản phẩm"
                              onClick={() => {
                                markDirty();
                                setInvoice((prev) => {
                                  if (!prev) return prev;
                                  const lines = prev.lines.map((l, i2) => (i2 === idx ? { ...l, itemId: undefined, itemName: "" } : l));
                                  return recomputeInvoiceCore(prev, { lines });
                                });
                                setOpenItemSuggestIndex(idx);
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ) : (
                      <input
                        style={{
                          ...styles.smallInput,
                          ...(missingItem ? { border: "1px solid #ef4444", background: "#fef2f2" } : {}),
                        }}
                        value={line.itemName}
                        disabled={locked}
                        autoFocus={openItemSuggestIndex === idx && !line.itemName}
                        onChange={(e) => handleLineChange(idx, "itemName", e.target.value)}
                        onFocus={() => {
                          setOpenItemSuggestIndex(idx);
                          refreshListsIfStale("items");
                        }}
                        onBlur={() => setTimeout(() => setOpenItemSuggestIndex((cur) => (cur === idx ? null : cur)), 150)}
                        placeholder="Gõ mã hoặc tên sản phẩm (không dấu cũng được)..."
                      />
                      )}
                      {missingItem && !line._imp && (
                        <div style={{ fontSize: 11.5, color: "#dc2626", marginTop: 3 }}>Chưa chọn sản phẩm từ danh sách — dòng này sẽ không được lưu</div>
                      )}

                      {/* ✅ MỚI: dòng từ file nhập */}
                      {line._imp && (() => {
                        const m = line._imp;
                        const isAuto = !!line.itemId && m.status === "ok" && String(line.itemId) === String(m.autoItemId);
                        const tag = line.itemId
                          ? isAuto
                            ? { t: "🟢 Tự khớp", bg: "#dcfce7", fg: "#166534" }
                            : { t: "✓ Đã chọn", bg: "#e0f2fe", fg: "#075985" }
                          : m.status === "new"
                            ? { t: "🔵 Chưa có mã", bg: "#dbeafe", fg: "#1e40af" }
                            : { t: "🟡 Cần chọn", bg: "#fef3c7", fg: "#92400e" };
                        const cur = line.itemId ? items.find((x) => x.id === String(line.itemId)) : undefined;
                        const pickCand = (c: ImpCand) => {
                          const it: Item = items.find((x) => x.id === c.itemId) || {
                            id: c.itemId,
                            sku: c.sku,
                            name: c.name,
                            unit: c.unit,
                            price: c.price,
                            stockQty: c.stockQty,
                            kind: c.kind,
                          };
                          selectItemForLine(idx, it);
                        };
                        return (
                          <div style={{ marginTop: 4, display: "grid", gap: 4, fontSize: 12 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", color: C.muted }}>
                              <span style={pill(tag.bg, tag.fg)}>{tag.t}</span>
                              <span>
                                File dòng {m.row}: {m.code ? <b>[{m.code}] </b> : null}
                                {m.name}
                                {m.unit ? ` · ${m.unit}` : ""}
                              </span>
                              {!isAuto && <span style={{ fontStyle: "italic" }}>— {m.reason}</span>}
                              {cur && invoice.type === "PURCHASE" && (
                                <span>
                                  · Tồn: {cur.stockQty ?? 0} → <b>{Number(cur.stockQty ?? 0) + Number(line.qty || 0)}</b>
                                </span>
                              )}
                            </div>
                            {m.flags.map((f, i) => (
                              <div key={i} style={{ color: "#b45309" }}>
                                ⚠ {f}
                              </div>
                            ))}
                            {!line.itemId && !locked && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {m.candidates.map((c) => (
                                  <button
                                    key={c.itemId}
                                    type="button"
                                    onClick={() => pickCand(c)}
                                    title={`${c.name} · tồn ${c.stockQty}`}
                                    style={{
                                      border: "1px solid #cbd5e1",
                                      background: "#fff",
                                      borderRadius: 8,
                                      padding: "3px 8px",
                                      fontSize: 12,
                                      cursor: "pointer",
                                      maxWidth: 340,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      textAlign: "left",
                                    }}
                                  >
                                    <b>{c.sku}</b> · {c.name} <span style={{ color: C.muted }}>· tồn {c.stockQty}</span>
                                  </button>
                                ))}
                                {canCreateItem ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setQuickCreate({
                                        lineIdx: idx,
                                        text: m.name,
                                        sku: m.code,
                                        name: m.name,
                                        kind: /^may\b/.test(normalizeVN(m.name)) ? "MACHINE" : "PART",
                                      })
                                    }
                                    style={{ border: "1px dashed #2563eb", color: "#1d4ed8", background: "#eff6ff", borderRadius: 8, padding: "3px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                                  >
                                    + Tạo mã mới
                                  </button>
                                ) : (
                                  m.status === "new" && <span style={{ color: C.muted }}>Chưa có mã — nhờ kế toán / admin tạo.</span>
                                )}
                                <span style={{ color: C.muted, alignSelf: "center" }}>hoặc gõ tìm ở ô trên</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {!picked && openItemSuggestIndex === idx && !locked && line.itemName.length > 0 && (
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
                                  className="inv-suggest-item"
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
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                    <span style={{ minWidth: 0 }}>
                                      {it.sku ? (
                                        <span
                                          style={{
                                            display: "inline-block",
                                            marginRight: 8,
                                            padding: "1px 6px",
                                            borderRadius: 6,
                                            background: C.soft,
                                            fontSize: 12,
                                            fontWeight: 700,
                                          }}
                                        >
                                          {highlightMatches(it.sku, qTokens)}
                                        </span>
                                      ) : null}
                                      {highlightMatches(it.name, qTokens)}
                                    </span>
                                    <span
                                      style={{
                                        whiteSpace: "nowrap",
                                        fontSize: 12,
                                        color: outOfStock ? "#dc2626" : C.muted,
                                        fontWeight: outOfStock ? 700 : 500,
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
                          {/* ✅ MỚI: tạo nhanh mã hàng (không đổi logic chọn hàng cũ) */}
                          {!itemSuggestions.some((it) => normalizeVN(it.name) === qNorm || (!!qCompact && compactKey(it.sku || "") === qCompact)) &&
                            (canCreateItem ? (
                              <div
                                className="inv-suggest-item"
                                style={{ ...styles.suggestItem, borderTop: "1px dashed #cbd5e1", color: "#0f172a", fontWeight: 600 }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setOpenItemSuggestIndex(null);
                                  setQuickCreate({ lineIdx: idx, text: qRaw });
                                }}
                              >
                                + Tạo mã mới: <span style={{ fontWeight: 700 }}>“{qRaw}”</span>
                              </div>
                            ) : (
                              <div style={{ ...styles.suggestItemMuted, borderTop: "1px dashed #cbd5e1" }}>
                                Không có mã cần tìm? Nhờ kế toán / admin tạo mã mới.
                              </div>
                            ))}
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

                    <div className="inv-col-total">
                      <div style={styles.totalBox}>{fmtMoneyInput(line.qty * line.price)}</div>
                    </div>

                    <div style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="inv-del"
                        style={styles.smallBtn}
                        disabled={locked}
                        onClick={() => removeLine(idx)}
                        title="Xóa dòng"
                        aria-label="Xóa dòng"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}

              <button type="button" className="inv-add" style={styles.addLineBtn} disabled={locked} onClick={addLine}>
                + Thêm dòng sản phẩm
              </button>
            </div>

            {/* Ghi chú + Thanh toán */}
            <div className="inv-grid-2">
              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>Ghi chú</div>
                <textarea
                  style={{ ...styles.input, height: "auto", minHeight: 140, padding: "10px 12px", resize: "vertical", lineHeight: 1.5 }}
                  value={invoice.note ?? ""}
                  disabled={locked}
                  placeholder="Ghi chú thêm cho hóa đơn (tùy chọn)..."
                  onChange={(e) => {
                    markDirty();
                    updateInvoice({ note: e.target.value });
                  }}
                />
              </div>

              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>Thanh toán</div>

                {isPurchase && (
                  <div style={styles.totalRow}>
                    <span style={{ fontWeight: 600 }}>Tổng tiền hàng</span>
                    <span style={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(invoice.subtotal ?? 0)} đ
                    </span>
                  </div>
                )}

                {!isPurchase && (
                  <>
                    <div className="inv-sum-row" style={styles.summaryRow}>
                      <span className="inv-sum-label" style={styles.summaryLabel}>Tạm tính</span>
                      <span style={styles.summaryValue}>{formatMoney(invoice.subtotal ?? 0)} đ</span>
                    </div>

                    <div className="inv-sum-row" style={styles.summaryRow}>
                      <span className="inv-sum-label" style={styles.summaryLabel}>Thuế VAT</span>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "stretch",
                          width: 110,
                          height: 36,
                          border: `1px solid ${C.borderInput}`,
                          borderRadius: 8,
                          overflow: "hidden",
                          background: locked ? "#f8fafc" : "#fff",
                          boxSizing: "border-box",
                          flexShrink: 0,
                        }}
                      >
                        <input
                          style={{
                            padding: "0 8px",
                            fontSize: 13.5,
                            boxSizing: "border-box",
                            flex: 1,
                            minWidth: 0,
                            width: "100%",
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            textAlign: "right",
                            boxShadow: "none",
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
                            borderLeft: `1px solid ${C.border}`,
                            background: C.soft,
                            color: "#334155",
                            fontSize: 13,
                          }}
                        >
                          %
                        </span>
                      </div>

                      <span style={styles.summaryValue}>{formatMoney(vatAmount)} đ</span>
                    </div>

                    {/* Bảo hành */}
                    <div className="inv-sum-row" style={styles.summaryRow}>
                      <span className="inv-sum-label" style={styles.summaryLabel}>Bảo hành</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: locked ? "default" : "pointer" }}>
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
                      <div className="inv-sum-row" style={{ ...styles.summaryRow, flexWrap: "wrap" }}>
                        <span className="inv-sum-label" style={styles.summaryLabel}>Tiền treo bảo hành</span>

                        <div style={{ flex: 1, minWidth: 160 }}>
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
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", paddingLeft: 162 }} className="inv-hold-note">
                          <span style={{ color: C.muted, fontSize: 12 }}>(≈ {derivedHoldPct}% của tạm tính)</span>
                          <button
                            type="button"
                            className="inv-btn"
                            style={{ ...styles.secondarySmallBtn, height: 28, fontSize: 12 }}
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
                      <div className="inv-sum-row" style={styles.summaryRow}>
                        <span className="inv-sum-label" style={styles.summaryLabel}>Đã trả hàng</span>
                        <span style={{ ...styles.summaryValue, color: "#7c3aed" }}>{formatMoney(returnedTotal)} đ</span>
                      </div>
                    )}

                    <div style={styles.totalRow}>
                      <span style={{ fontWeight: 600 }}>Tổng cộng</span>
                      <span style={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>
                        {formatMoney(invoice.totalAmount)} đ
                      </span>
                    </div>
                  </>
                )}

                <div className="inv-sum-row" style={styles.summaryRow}>
                  <span className="inv-sum-label" style={styles.summaryLabel}>Trạng thái thanh toán</span>
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

                {!isPurchase && (
                  <>
                    <div className="inv-sum-row" style={styles.summaryRow}>
                      <span className="inv-sum-label" style={styles.summaryLabel}>Số tiền đã thu</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
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
                    </div>

                    <div className="inv-sum-row" style={styles.summaryRow}>
                      <span className="inv-sum-label" style={styles.summaryLabel}>Tài khoản nhận tiền</span>
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

                    {accountLoadError && <div style={{ ...styles.notice, ...styles.noticeError, marginTop: 6 }}>{accountLoadError}</div>}

                    <div style={{ borderTop: `1px dashed ${C.border}`, marginTop: 8, paddingTop: 4 }}>
                      <div className="inv-sum-row" style={styles.summaryRow}>
                        <span className="inv-sum-label" style={styles.summaryLabel}>Đã thu</span>
                        <span style={{ ...styles.summaryValue, color: C.green }}>{formatMoney(paidNormal)} đ</span>
                      </div>

                      <div className="inv-sum-row" style={styles.summaryRow}>
                        <span className="inv-sum-label" style={{ ...styles.summaryLabel, fontWeight: 700, color: C.text }}>Còn phải thu</span>
                        <span
                          style={{
                            ...styles.summaryValue,
                            fontSize: 16,
                            color: isReturnedFull(invoice) ? "#6b7280" : debtNow > 0 ? C.red : C.text,
                          }}
                        >
                          {formatMoney(debtNow)} đ
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {message && (
              <div style={{ ...styles.notice, ...(message.type === "success" ? styles.noticeSuccess : styles.noticeError) }}>
                {message.text}
              </div>
            )}

            {/* Lịch sử thanh toán */}
            {!isCreate && invoice.id && (
              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>
                  <span>Lịch sử thanh toán</span>
                  <button
                    type="button"
                    className="inv-btn"
                    style={{ ...styles.secondarySmallBtn, height: 30 }}
                    onClick={loadPaymentHistoryForInvoice}
                    disabled={paymentHistoryLoading}
                  >
                    {paymentHistoryLoading ? "Đang tải..." : "↻ Tải lại"}
                  </button>
                </div>

                <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                  Tổng phân bổ vào HĐ: <b style={{ color: C.text }}>{formatMoney(paidTotal)} đ</b>
                  <span style={{ marginLeft: 10 }}>
                    (Thường: <b style={{ color: C.text }}>{formatMoney(paidNormal)} đ</b> • Bảo hành:{" "}
                    <b style={{ color: C.text }}>{formatMoney(paidWarranty)} đ</b>)
                  </span>
                </div>

                {paymentHistoryError && <div style={{ ...styles.notice, ...styles.noticeError, marginBottom: 10 }}>{paymentHistoryError}</div>}

                <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <table className="inv-pay-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: C.soft, color: C.muted, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.3 }}>
                        <th style={{ textAlign: "left" }}>Ngày</th>
                        <th style={{ textAlign: "left" }}>Tài khoản</th>
                        <th style={{ textAlign: "right" }}>Số tiền áp vào HĐ</th>
                        <th style={{ textAlign: "right" }}>Tổng phiếu</th>
                        <th style={{ textAlign: "left" }}>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentHistoryLoading && (
                        <tr>
                          <td colSpan={5} style={{ color: C.muted }}>
                            Đang tải lịch sử...
                          </td>
                        </tr>
                      )}

                      {!paymentHistoryLoading && paymentHistoryRows.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ color: C.muted, textAlign: "center", padding: 18 }}>
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
                              <td style={{ whiteSpace: "nowrap" }}>{timeStr}</td>
                              <td>{accText || "-"}</td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>
                                {formatMoney((p as any).allocatedAmount || 0)} đ
                              </td>
                              <td style={{ textAlign: "right" }}>{formatMoney(Number(p.amount || 0))} đ</td>
                              <td>{note}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Thanh hành động — dính đáy màn hình */}
            <div style={styles.formActions} className="inv-actions">
              <div style={styles.postStatusRow}>
                <span style={statusPill}>● {statusText}</span>
                <span className="inv-hide-sm" style={{ fontSize: 13, color: C.muted }}>
                  {isPurchase ? "Tổng tiền hàng" : "Tổng cộng"}:{" "}
                  <b style={{ color: C.text, fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(isPurchase ? invoice.subtotal ?? 0 : invoice.totalAmount)} đ
                  </b>
                </span>

                {/* staff: giữ nút gửi duyệt */}
                {!isAdmin && status === "DRAFT" && (
                  <button
                    type="button"
                    className="inv-btn"
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
                    <button
                      type="button"
                      className="inv-btn"
                      style={{ ...styles.secondarySmallBtn, background: C.green, borderColor: C.green, color: "#fff" }}
                      onClick={handleApprove}
                    >
                      ✓ Duyệt
                    </button>
                    <button
                      type="button"
                      className="inv-btn"
                      style={{ ...styles.secondarySmallBtn, color: C.red, borderColor: "#fecaca" }}
                      onClick={handleReject}
                    >
                      Từ chối
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="inv-btn" style={styles.secondaryBtn} onClick={() => navigate("/invoices")} disabled={saving}>
                  Hủy
                </button>

                {canEdit ? (
                  <button
                    type="submit"
                    className="inv-btn"
                    style={{
                      ...styles.primaryBtn,
                      background: status === "DRAFT" && !partnerOk ? "rgba(15, 23, 42, 0.35)" : styles.primaryBtn.background,
                      cursor: status === "DRAFT" && !partnerOk ? "not-allowed" : "pointer",
                    }}
                    disabled={saving || locked || (status === "DRAFT" && !partnerOk)}
                    title={status === "DRAFT" && !partnerOk ? "Bạn cần chọn/lưu khách hàng trước khi lưu hóa đơn." : ""}
                  >
                    {saveLabel}
                  </button>
                ) : (
                  <button type="button" style={{ ...styles.primaryBtn, background: "#94a3b8", cursor: "not-allowed" }} disabled>
                    Không thể lưu
                  </button>
                )}
              </div>
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

      <QuickCreateItemModal
        open={!!quickCreate}
        initialText={quickCreate?.text || ""}
        initialSku={quickCreate?.sku}
        initialName={quickCreate?.name}
        initialKind={quickCreate?.kind}
        items={items}
        onClose={() => setQuickCreate(null)}
        onPickExisting={(it) => {
          const qc = quickCreate;
          setQuickCreate(null);
          if (qc) selectItemForLine(qc.lineIdx, it);
        }}
        onCreated={(it) => {
          const qc = quickCreate;
          setQuickCreate(null);
          setItems((prev) => [it, ...prev.filter((x) => x.id !== it.id)]);
          if (qc) selectItemForLine(qc.lineIdx, it);
          toastSuccess(`Đã tạo mã mới: ${it.sku ? `[${it.sku}] ` : ""}${it.name}`);
        }}
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