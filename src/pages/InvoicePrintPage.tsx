// src/pages/InvoicePrintPage.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";

// ================= helpers =================
function unwrap<T = any>(res: any): T {
  if (res && typeof res === "object" && "data" in res) {
    const body = (res as any).data;
    if (body && typeof body === "object" && "data" in body) return body.data as T;
    return body as T;
  }
  return res as T;
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("vi-VN");
}

function stripBracketPart(name: string): string {
  if (!name) return "";
  return name.replace(/\s*\[[^\]]*]/g, "");
}

// ✅ NEW: lấy mã trong [...] (lấy cái [] đầu tiên)
function extractBracketCode(name: string): string {
  if (!name) return "";
  const m = name.match(/\[([^\]]+)\]/);
  return m ? String(m[1]).trim() : "";
}

function numberToVietnamese(amount: number): string {
  if (isNaN(amount as any)) return "";
  const n = Math.round(amount);
  if (n === 0) return "Không đồng";

  const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const units = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"];

  function read3(num: number, full: boolean): string {
    const hundred = Math.floor(num / 100);
    const ten = Math.floor((num % 100) / 10);
    const one = num % 10;
    const parts: string[] = [];

    if (hundred > 0) parts.push(digits[hundred], "trăm");
    else if (full && (ten > 0 || one > 0)) parts.push("không", "trăm");

    if (ten > 1) {
      parts.push(digits[ten], "mươi");
      if (one === 1) parts.push("mốt");
      else if (one === 5) parts.push("lăm");
      else if (one > 0) parts.push(digits[one]);
    } else if (ten === 1) {
      parts.push("mười");
      if (one === 1) parts.push("một");
      else if (one === 5) parts.push("lăm");
      else if (one > 0) parts.push(digits[one]);
    } else if (ten === 0 && one > 0) {
      if (parts.length) parts.push("lẻ");
      parts.push(digits[one]);
    }

    return parts.join(" ");
  }

  let value = n;
  const groups: number[] = [];
  while (value > 0) {
    groups.push(value % 1000);
    value = Math.floor(value / 1000);
  }

  const chunks: string[] = [];
  let hadNonZero = false;

  for (let idx = groups.length - 1; idx >= 0; idx--) {
    const g = groups[idx];
    if (g !== 0) {
      const prefix = read3(g, hadNonZero);
      const unit = units[idx] || "";
      chunks.push(prefix + unit);
      hadNonZero = true;
    }
  }

  let result = chunks.join(" ").replace(/\s+/g, " ").trim();
  result = result.charAt(0).toUpperCase() + result.slice(1) + " đồng";
  return result;
}

function pickUnitLabel(item: any): string {
  if (!item) return "";
  const u =
    item?.unit?.name ??
    item?.unit?.code ??
    item?.unit?.symbol ??
    item?.unitName ??
    item?.unitLabel ??
    item?.uom ??
    item?.unit ??
    "";
  return u ? String(u) : "";
}

function extractArray(body: any): any[] {
  const b = body;
  if (!b) return [];
  if (Array.isArray(b)) return b;
  if (Array.isArray(b.items)) return b.items;
  if (Array.isArray(b.data)) return b.data;
  if (b.data && Array.isArray(b.data.items)) return b.data.items;
  return [];
}

async function fetchItemLoose(itemId: string): Promise<any | null> {
  if (!itemId) return null;

  try {
    const r1 = await api.get(`/items/${itemId}`);
    const b1 = unwrap<any>(r1);
    if (b1 && (b1.id || b1.data?.id)) return b1.id ? b1 : b1.data;
  } catch {}

  try {
    const r2 = await api.get(`/items`, { params: { ids: itemId } });
    const b2 = unwrap<any>(r2);
    const arr = extractArray(b2);
    const found = arr.find((x: any) => String(x?.id || "") === String(itemId));
    if (found) return found;
  } catch {}

  try {
    const r3 = await api.get(`/items`, { params: { id: itemId } });
    const b3 = unwrap<any>(r3);
    const arr = extractArray(b3);
    const found = arr.find((x: any) => String(x?.id || "") === String(itemId));
    if (found) return found;
  } catch {}

  return null;
}

// ================= print modes =================
// ✅ 4 khổ in, người in tự chọn (nhớ lựa chọn lần trước):
//   A4      : giấy A4 dọc 210×297
//   A5L     : giấy A5 THẬT, khổ ngang 210×148 (hoá đơn bán lẻ thường dùng)
//   A5P     : giấy A5 THẬT, khổ dọc 148×210
//   HALF_A4 : in khung A5 lên NỬA TRÊN tờ A4 (máy in chỉ có giấy A4, in xong cắt đôi)
type PrintMode = "A4" | "A5L" | "A5P" | "HALF_A4";

type PaperCfg = {
  label: string;
  hint: string;
  page: string; // @page size
  w: number; // mm
  h: number; // mm
  inset: number; // khung viền cách mép giấy (mm)
  pad: { top: number; right: number; bottom: number; left: number };
  compact: boolean;
};

const PAPERS: Record<PrintMode, PaperCfg> = {
  A4: { label: "A4", hint: "Giấy A4 dọc", page: "A4 portrait", w: 210, h: 297, inset: 8, pad: { top: 14, right: 16, bottom: 14, left: 16 }, compact: false },
  A5L: { label: "A5 ngang", hint: "Giấy A5 khổ ngang 210×148mm", page: "A5 landscape", w: 210, h: 148, inset: 5, pad: { top: 7, right: 10, bottom: 6, left: 10 }, compact: true },
  A5P: { label: "A5 dọc", hint: "Giấy A5 khổ dọc 148×210mm", page: "A5 portrait", w: 148, h: 210, inset: 5, pad: { top: 7, right: 7, bottom: 6, left: 7 }, compact: true },
  HALF_A4: { label: "Nửa tờ A4", hint: "In khổ A5 lên nửa trên tờ A4 rồi cắt đôi", page: "A4 portrait", w: 210, h: 297, inset: 5, pad: { top: 7, right: 10, bottom: 6, left: 10 }, compact: true },
};
const MODES: PrintMode[] = ["A4", "A5L", "A5P", "HALF_A4"];
const LS_PAPER = "invoice_print_paper_v1";

const A5_PREFER_MAX_LINES = 2;

// khung A5 ngang đặt trên nửa trên tờ A4 (chế độ Nửa tờ A4)
const A5_SLOT = { w: 200, h: 140 }; // mm
const A5_SLOT_POS = { top: 10, left: (210 - A5_SLOT.w) / 2 };

const SAFE_PX = 3;

function ensurePrintStyleTag() {
  let el = document.getElementById("print-page-style") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "print-page-style";
    document.head.appendChild(el);
  }
  return el;
}

function applyPrintMode(mode: PrintMode) {
  const styleEl = ensurePrintStyleTag();
  const cfg = PAPERS[mode];
  const isSlot = mode === "HALF_A4";

  styleEl.textContent = `
/* print-mode: ${mode} */
@page { size: ${cfg.page}; margin: 8mm 0; }
@page :first { margin: 0; } /* trang 1 có khung viền sát mép; trang 2 trở đi chừa lề trên / dưới */

html, body {
  margin: 0;
  padding: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.mm-ruler{ position: fixed; left: -1000mm; top: 0; width: 1mm; height: 1mm; pointer-events: none; opacity: 0; }

@media screen {
  body { background: #e2e8f0; }
  .print-root{
    width: ${cfg.w}mm;
    min-height: ${cfg.h}mm;
    margin: 16px auto 32px;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 30px rgba(0,0,0,.08);
    position: relative;
    box-sizing: border-box;
    overflow: visible;
  }
  /* vạch báo hết trang 1 (chỉ hiện trên màn hình) */
  .page-end{
    position: absolute; left: 0; right: 0; top: ${isSlot ? A5_SLOT_POS.top + A5_SLOT.h : cfg.h}mm;
    border-top: 1px dashed #ef4444; pointer-events: none; z-index: 5;
  }
  .page-end span{
    position: absolute; right: 4px; top: 2px; font: 11px Arial, sans-serif; color: #ef4444; background: #fff; padding: 0 4px;
  }
}

@media print {
  /* CSS chung của app đặt chiều cao tối thiểu = cả màn hình -> dư 1 trang trắng khi in */
  html, body, #root { height: auto !important; min-height: 0 !important; background: #fff !important; }
  .no-print, .page-end { display: none !important; }
  /* ✅ co theo VÙNG IN THẬT của tờ giấy (100% / 100vh = khổ giấy trừ lề máy in / lề trình duyệt),
     không cố định đúng ${cfg.w}x${cfg.h}mm nữa: trước đây máy in có lề, hoặc hộp in để Lề = Mặc định,
     thì trang rộng hơn vùng in -> trình duyệt thu nhỏ cả trang (không đầy tờ) hoặc cắt mất cột bên phải. */
  .print-root{
    width: 100%;
    max-width: ${cfg.w}mm;
    height: min(${cfg.h}mm, 100vh);
    margin: 0 auto;
    background: transparent;
    position: relative;
    overflow: visible !important;
  }
  .page-box{ min-height: calc(min(${cfg.h}mm, 100vh) - ${2 * cfg.inset}mm) !important; }
  .page-box > .border-box{ min-height: calc(min(${cfg.h}mm, 100vh) - ${2 * cfg.inset}mm) !important; }
  /* căn giữa bằng left/right + margin auto; KHÔNG dùng transform (Chrome in ra bị thu nhỏ cả khung) */
  .a5-slot{ width: min(${A5_SLOT.w}mm, calc(100% - 10mm)) !important; left: 0 !important; right: 0 !important; margin: 0 auto; }
}

/* ✅ CSS chung của app cho điện thoại (index.css, @media max-width 767px) ép mọi bảng rộng tối thiểu 640px
   và cho khung bọc bảng cuộn ngang. Khi in, vùng in hẹp (A5 dọc, in từ điện thoại, lề lớn) cũng bị tính là
   "màn hình nhỏ" -> bảng hoá đơn tràn rồi bị khung cắt mất các cột bên phải. Trang in không dùng các rule đó. */
.print-root table.invoice-table{ min-width: 0 !important; width: 100% !important; table-layout: fixed; }
.print-root div:has(> table.invoice-table){ overflow: visible !important; max-width: none !important; }

table.invoice-table thead { display: table-header-group; }
table.invoice-table tr { page-break-inside: avoid; break-inside: avoid; }
.signatures-wrapper { page-break-inside: avoid; break-inside: avoid; }

/* ====== khung viền cả trang (A4 / A5 thật) ====== */
.a4-frame{
  position: absolute;
  inset: ${cfg.inset}mm;
  border: 1px solid #000;
  pointer-events: none;
  z-index: 0;
  display: ${isSlot ? "none" : "block"};
}
.print-root{ display: flow-root; } /* chặn lề của khung con "dồn" ra ngoài làm tụt cả trang 19px -> dư trang 2 */
.page-box{
  position: relative;
  z-index: 1;
  margin: ${cfg.inset}mm;
  min-height: ${cfg.h - 2 * cfg.inset}mm;
}
.border-box{ border: none !important; box-shadow: none !important; }

/* ====== Nửa tờ A4 ====== */
.a5-slot{
  position: absolute;
  top: ${A5_SLOT_POS.top}mm;
  left: ${A5_SLOT_POS.left}mm;
  width: ${A5_SLOT.w}mm;
  height: ${A5_SLOT.h}mm;
  box-sizing: border-box;
  display: ${isSlot ? "block" : "none"};
}
.a5-frame{ position: absolute; inset: ${cfg.inset}mm; border: 1px solid #000; pointer-events: none; z-index: 0; }
.a5-slot .border-box{
  position: absolute;
  inset: ${cfg.inset}mm;
  z-index: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
`;
}


// ================= types =================
type ApiPartner = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  addr?: string | null;
  taxCode?: string | null;
  tax?: string | null;
  mst?: string | null;
};

type ApiInvoiceLine = {
  id: string;
  itemId: string;
  itemName?: string | null;
  itemSku?: string | null;
  unit?: string | null;
  qty: any;
  price: any;
  amount: any;
  item?: { name: string; sku?: string | null; unit?: string | null } | null;
};

type ApiInvoice = {
  id: string;
  code: string;
  issueDate: string;
  type: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";
  partnerId?: string | null;
  partner?: ApiPartner | null;
  partnerName?: string | null;
  partnerPhone?: string | null;
  partnerAddr?: string | null;
  partnerTax?: string | null;
  subtotal?: any;
  tax?: any;
  total?: any;
  shipFee?: any;
  shipTax?: any;
  laborFee?: any;
  lines: ApiInvoiceLine[];
};

type Line = {
  id: string;
  code?: string; // ✅ NEW
  name: string;
  unit?: string;
  qty: number;
  price: number;
  amount: number;
};

// ================= styles =================
const styles: Record<string, React.CSSProperties> = {
  borderBox: {
    boxSizing: "border-box",
    padding: "8mm 10mm 10mm",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    fontFamily: "'Times New Roman', Arial, sans-serif",
    fontSize: 13,
    color: "#000",
    background: "transparent",
  },
  topSection: { flexShrink: 0 },

  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  logoBox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    width: "auto",
    maxWidth: "100%",
  },
  logoImg: { width: 85, height: 85, objectFit: "contain" },
  companyInfo: { fontSize: 12, lineHeight: 1.4, textAlign: "left" },
  companyName: { fontWeight: 700, fontSize: 14, textTransform: "uppercase" },

  invoiceTitle: { textAlign: "center", fontWeight: 700, fontSize: 18, margin: "3mm 0 1.5mm" },

  // ✅ meta luôn căn giữa và nằm đúng dưới title
  invoiceMeta: {
    width: "100%",
    textAlign: "center",
    fontSize: 12,
    marginBottom: 6,
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    lineHeight: 1.2,
  },

  customerBox: {
    borderTop: "1px solid #000",
    borderBottom: "1px solid #000",
    padding: "4px 0",
    marginBottom: 6,
    fontSize: 13,
  },
  customerRow: { display: "flex", gap: 12, marginBottom: 3 },
  customerLabel: { width: 85, fontWeight: 600 },
  customerValue: {
    flex: 1,
    borderBottom: "1px dotted #000",
    wordBreak: "break-word",
    whiteSpace: "normal",
  },

  table: { width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 12.5 },
  th: { border: "1px solid #000", padding: "3px 4px", textAlign: "center", fontWeight: 600 },
  td: {
    border: "1px solid #000",
    padding: "3px 4px",
    verticalAlign: "top",
    wordBreak: "break-word",
    whiteSpace: "normal",
  },
  tdCenter: { textAlign: "center" },
  tdRight: { textAlign: "right" },

  moneyRowLabel: { padding: "3px 6px", border: "1px solid #000" },
  moneyRowValue: { padding: "3px 6px", border: "1px solid #000", textAlign: "right" },

  textAmountRow: { fontSize: 12.5, marginTop: 6 },
  bold: { fontWeight: 600 },

  signaturesWrapper: { marginTop: "auto", marginBottom: "10mm" },
  signaturesRow: { display: "flex", justifyContent: "space-between", fontSize: 12 },
  signatureCol: { textAlign: "center", width: "33%" },
  signatureLabel: { fontWeight: 600, marginBottom: 2 },
  signatureNote: { fontStyle: "italic", fontSize: 11 },
};

// ================= component =================
const InvoicePrintPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<ApiInvoice | null>(null);
  const [partner, setPartner] = useState<ApiPartner | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [unitByItemId, setUnitByItemId] = useState<Record<string, string>>({});
  // ✅ khổ in: lấy lựa chọn lần trước; chưa chọn bao giờ thì tự đoán theo số dòng (như cũ)
  const savedPaper = (() => {
    try {
      const v = localStorage.getItem(LS_PAPER) as PrintMode | null;
      return v && MODES.includes(v) ? v : null;
    } catch {
      return null;
    }
  })();
  const [printMode, setPrintMode] = useState<PrintMode>(savedPaper || "A4");
  const userPicked = useRef<boolean>(!!savedPaper);
  const [overflow, setOverflow] = useState(false);

  const printModeRef = useRef<PrintMode>(printMode);
  useEffect(() => {
    printModeRef.current = printMode;
  }, [printMode]);

  const borderBoxRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<HTMLDivElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const pickPaper = (m: PrintMode) => {
    userPicked.current = true;
    setPrintMode(m);
    try {
      localStorage.setItem(LS_PAPER, m);
    } catch {}
  };

  useEffect(() => {
    applyPrintMode(printMode);
  }, [printMode]);

  useEffect(() => {
    if (!id) return;
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setUnitByItemId({});

        const res = await api.get(`/invoices/${id}`);
        const inv = unwrap<ApiInvoice>(res);
        if (!alive) return;

        setInvoice(inv);

        let p: ApiPartner | null = inv.partner ?? null;
        if (!p && inv.partnerId) {
          try {
            const pres = await api.get(`/partners/${inv.partnerId}`);
            p = unwrap<ApiPartner>(pres);
          } catch (e) {
            console.warn("load partner for print failed, fallback invoice snapshot", e);
          }
        }
        if (alive) setPartner(p);

        const invLines = Array.isArray(inv?.lines) ? inv.lines : [];
        const itemIds = Array.from(new Set(invLines.map((l) => String(l?.itemId || "").trim()).filter(Boolean)));

        const needFetch = itemIds.filter((itemId) => {
          const l = invLines.find((x) => String(x?.itemId || "") === itemId);
          const u = String(l?.item?.unit ?? l?.unit ?? "").trim();
          return !u;
        });

        if (needFetch.length > 0) {
          let unitIdToLabel: Record<string, string> = {};
          try {
            const ures = await api.get(`/items/units`);
            const ub = unwrap<any>(ures);
            const arr = extractArray(ub);
            unitIdToLabel = (arr || []).reduce((m: any, u: any) => {
              const uid = String(u?.id || "");
              const label = String(u?.name || u?.code || "").trim();
              if (uid && label) m[uid] = label;
              return m;
            }, {});
          } catch (e) {
            console.warn("load units failed (print)", e);
          }

          const map: Record<string, string> = {};
          await Promise.all(
            needFetch.map(async (itemId) => {
              try {
                const item = await fetchItemLoose(itemId);
                if (!item) return;

                let label = String(pickUnitLabel(item) || "").trim();
                if (!label) {
                  const unitId = String(item?.unitId ?? item?.unit?.id ?? "").trim();
                  if (unitId && unitIdToLabel[unitId]) label = unitIdToLabel[unitId];
                }
                if (label) map[itemId] = label;
              } catch (e) {
                console.warn("load item for unit failed", itemId, e);
              }
            })
          );

          if (alive) setUnitByItemId(map);
        }
      } catch (err) {
        console.error("load invoice print error", err);
        if (alive) {
          const st = (err as any)?.response?.status;
          setLoadError(st === 403 ? "Bạn không có quyền xem phiếu này." : st === 404 ? "Không tìm thấy phiếu." : "Không tải được phiếu. Vui lòng thử lại.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  const issueDate = useMemo(() => formatDate(invoice?.issueDate), [invoice?.issueDate]);

  const lines: Line[] = useMemo(() => {
    if (!invoice?.lines) return [];
    return invoice.lines.map((l) => {
      const qty = toNum(l.qty);
      const price = toNum(l.price);
      const amount = l.amount != null ? toNum(l.amount) : qty * price;

      const unitFromInvoice = String(l.item?.unit ?? l.unit ?? "").trim();
      const unitFromItem = String(unitByItemId[String(l.itemId || "")] ?? "").trim();

      const rawName = String(l.item?.name ?? l.itemName ?? "");
      const code = extractBracketCode(rawName);
      const cleanName = stripBracketPart(rawName);

      return {
        id: l.id,
        code,
        name: cleanName,
        unit: unitFromInvoice || unitFromItem || "",
        qty,
        price,
        amount,
      };
    });
  }, [invoice, unitByItemId]);

  const linesKey = useMemo(() => lines.map((x) => `${x.id}|${x.qty}|${x.price}|${x.amount}|${x.code}`).join("||"), [lines]);

  // ✅ chưa chọn khổ bao giờ: ít dòng thì nửa tờ A4 (giống trước), nhiều dòng thì A4
  useEffect(() => {
    if (!invoice || userPicked.current) return;
    setPrintMode(lines.length <= A5_PREFER_MAX_LINES ? "HALF_A4" : "A4");
  }, [invoice?.id, lines.length]);

  // ✅ đo xem nội dung có dài quá 1 trang của khổ đang chọn không -> cảnh báo (không tự đổi khổ)
  useLayoutEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const box = borderBoxRef.current;
      const mm = 96 / 25.4; // 1mm = 3.7795px (CSS chuẩn); đo bằng thước bị làm tròn nên lệch
      if (!box) return;
      const cfg = PAPERS[printModeRef.current];
      const over =
        printModeRef.current === "HALF_A4"
          ? box.scrollHeight > box.clientHeight + SAFE_PX
          : box.offsetHeight > (cfg.h - 2 * cfg.inset) * mm + SAFE_PX;
      setOverflow(over);
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(check));
    const t = window.setTimeout(check, 200);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [invoice?.id, linesKey, layoutTick, printMode]);

  useEffect(() => {
    const onBeforePrint = () => applyPrintMode(printModeRef.current);
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  const computedSubtotal = useMemo(() => lines.reduce((sum, l) => sum + toNum(l.amount), 0), [lines]);

  if (loadError) return <div style={{ padding: 20, color: "#b91c1c" }}>{loadError}</div>;
  if (loading || !invoice) return <div style={{ padding: 20 }}>Đang tải hóa đơn...</div>;

  const subtotal = invoice.subtotal != null ? toNum(invoice.subtotal) : computedSubtotal;
  const tax = invoice.tax != null ? toNum(invoice.tax) : 0;
  const total = invoice.total != null ? toNum(invoice.total) : subtotal + tax;
  const shipFee = toNum(invoice.shipFee);
  const shipTax = toNum(invoice.shipTax);
  const laborFee = toNum(invoice.laborFee);

  const hasTax = tax > 0.0001;
  const taxPercent = subtotal > 0 ? (tax / subtotal) * 100 : 0;
  const taxPercentStr = hasTax ? taxPercent.toFixed(0) : "";
  const totalText = numberToVietnamese(total);

  const customerName = partner?.name ?? invoice.partnerName ?? "";
  const customerAddr = partner?.address ?? partner?.addr ?? invoice.partnerAddr ?? "";
  const customerPhone = partner?.phone ?? invoice.partnerPhone ?? "";
  const customerTax = partner?.taxCode ?? partner?.mst ?? partner?.tax ?? invoice.partnerTax ?? "";

  const title = (() => {
    // ✅ phiếu in nội bộ, không phải hoá đơn điện tử (VAT) -> gọi là "Phiếu" để khỏi nhầm
    if (invoice.type === "PURCHASE") return "PHIẾU NHẬP HÀNG";
    if (invoice.type === "SALES") return "PHIẾU BÁN HÀNG";
    if (invoice.type === "SALES_RETURN") return "PHIẾU TRẢ HÀNG (BÁN)";
    if (invoice.type === "PURCHASE_RETURN") return "PHIẾU TRẢ HÀNG (NHẬP)";
    return "HÓA ĐƠN";
  })();

  const cfg = PAPERS[printMode];
  const isSlot = printMode === "HALF_A4";
  // compact = mọi khổ A5 (chữ nhỏ, khoảng cách hẹp); A5 dọc còn hẹp hơn nữa
  const narrow = printMode === "A5P";
  const pad = cfg.pad;

  const borderBoxStyle: React.CSSProperties = {
    ...styles.borderBox,
    padding: `${pad.top}mm ${pad.right}mm ${pad.bottom}mm ${pad.left}mm`,
    fontSize: narrow ? 11.5 : cfg.compact ? 12.5 : 13,
    ...(isSlot ? {} : { minHeight: `${cfg.h - 2 * cfg.inset}mm` }),
  };

  const logoImgStyle: React.CSSProperties = {
    ...styles.logoImg,
    width: narrow ? 52 : cfg.compact ? 64 : 85,
    height: narrow ? 52 : cfg.compact ? 64 : 85,
  };

  const companyInfoStyle: React.CSSProperties = {
    ...styles.companyInfo,
    fontSize: narrow ? 9.6 : cfg.compact ? 11 : 12,
    lineHeight: cfg.compact ? 1.25 : 1.4,
  };

  const companyNameStyle: React.CSSProperties = {
    ...styles.companyName,
    fontSize: narrow ? 11 : cfg.compact ? 12.5 : 14,
  };

  const invoiceTitleStyle: React.CSSProperties = {
    ...styles.invoiceTitle,
    fontSize: cfg.compact ? 16.5 : 18,
    margin: cfg.compact ? "2mm 0 1mm" : "3mm 0 1.5mm",
  };

  const customerBoxStyle: React.CSSProperties = {
    ...styles.customerBox,
    padding: cfg.compact ? "2px 0" : styles.customerBox.padding,
    marginBottom: cfg.compact ? 4 : 6,
    fontSize: cfg.compact ? 12.3 : 13,
  };

  const customerLabelStyle: React.CSSProperties = {
    ...styles.customerLabel,
    width: cfg.compact ? 78 : 85,
  };

  const customerRowStyle: React.CSSProperties = {
    ...styles.customerRow,
    marginBottom: cfg.compact ? 2 : 3,
  };

  const tableStyle: React.CSSProperties = {
    ...styles.table,
    marginTop: cfg.compact ? 4 : 6,
    fontSize: narrow ? 10.2 : cfg.compact ? 11.5 : 12.5,
  };

  const thStyle: React.CSSProperties = { ...styles.th, padding: cfg.compact ? "2px 3px" : styles.th.padding };
  const tdStyle: React.CSSProperties = { ...styles.td, padding: cfg.compact ? "2px 3px" : styles.td.padding };

  const moneyRowLabelStyle: React.CSSProperties = {
    ...styles.moneyRowLabel,
    padding: cfg.compact ? "2px 5px" : styles.moneyRowLabel.padding,
  };
  const moneyRowValueStyle: React.CSSProperties = {
    ...styles.moneyRowValue,
    padding: cfg.compact ? "2px 5px" : styles.moneyRowValue.padding,
  };

  const signaturesWrapperStyle: React.CSSProperties = cfg.compact
    ? { ...styles.signaturesWrapper, marginTop: "auto", marginBottom: "2mm" }
    : { ...styles.signaturesWrapper, marginTop: "auto", marginBottom: "10mm" };

  const signaturesRowStyle: React.CSSProperties = {
    ...styles.signaturesRow,
    fontSize: cfg.compact ? 11 : 12,
  };

  const signatureNoteStyle: React.CSSProperties = {
    ...styles.signatureNote,
    fontSize: cfg.compact ? 10 : 11,
  };

  const InvoiceContent = (
    <>
      <div style={styles.topSection}>
        <div style={{ ...styles.headerRow, marginBottom: cfg.compact ? 4 : 6 }}>
          <div style={{ ...styles.logoBox, gap: cfg.compact ? 8 : 10 }}>
            <img
              src="/logo-mcbrother.png"
              alt="MCBROTHER logo"
              style={logoImgStyle}
              onLoad={() => setLayoutTick((t) => t + 1)}
              onError={() => setLayoutTick((t) => t + 1)}
            />
            <div style={companyInfoStyle}>
              <div style={companyNameStyle}>CÔNG TY CỔ PHẦN THIẾT BỊ MCBROTHER</div>
              <div>Địa chỉ: 33 Đường số 5, Khu dân cư Vĩnh Lộc, Phường Bình Tân, TP. Hồ Chí Minh</div>
              <div>
                Điện thoại: 028.6273.2018 &nbsp;–&nbsp; Mã số thuế: 0312229437
              </div>
              <div>Email: mcbrother2013@gmail.com</div>
            </div>
          </div>
        </div>

        <div style={invoiceTitleStyle}>{title}</div>

        <div style={{ ...styles.invoiceMeta, marginBottom: cfg.compact ? 4 : 6 }}>
          <div>
            Số: <span style={styles.bold}>{invoice.code}</span>
          </div>
          <div>
            Ngày lập: <span style={styles.bold}>{issueDate}</span>
          </div>
        </div>

        <div style={customerBoxStyle}>
          <div style={customerRowStyle}>
            <div style={customerLabelStyle}>Khách hàng:</div>
            <div style={styles.customerValue}>{customerName}</div>
          </div>
          <div style={customerRowStyle}>
            <div style={customerLabelStyle}>Địa chỉ:</div>
            <div style={styles.customerValue}>{customerAddr}</div>
          </div>
          <div style={customerRowStyle}>
            <div style={customerLabelStyle}>Điện thoại:</div>
            <div style={styles.customerValue}>{customerPhone}</div>
          </div>
          {/* ✅ khách không có mã số thuế (khách lẻ) thì ẩn dòng này cho gọn */}
          {String(customerTax || "").trim() && (
            <div style={customerRowStyle}>
              <div style={customerLabelStyle}>Mã số thuế:</div>
              <div style={styles.customerValue}>{customerTax}</div>
            </div>
          )}
        </div>

        <table style={tableStyle} className="invoice-table">
          <thead>
            <tr>
              <th style={{ ...thStyle, width: "6%" }}>STT</th>
              <th style={{ ...thStyle, width: "14%" }}>Mã hàng</th>
              <th style={{ ...thStyle, width: "32%" }}>Tên hàng hóa</th>
              <th style={{ ...thStyle, width: "8%" }}>ĐVT</th>
              <th style={{ ...thStyle, width: "8%" }}>Số lượng</th>
              <th style={{ ...thStyle, width: "16%" }}>Đơn giá</th>
              <th style={{ ...thStyle, width: "16%" }}>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.id}>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{idx + 1}</td>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{l.code || "-"}</td>
                <td style={tdStyle}>{l.name}</td>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{l.unit}</td>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{l.qty}</td>
                <td style={{ ...tdStyle, ...styles.tdRight }}>{formatMoney(l.price)}</td>
                <td style={{ ...tdStyle, ...styles.tdRight }}>{formatMoney(l.amount)}</td>
              </tr>
            ))}

            <tr>
              <td colSpan={6} style={moneyRowLabelStyle}>
                Tạm tính
              </td>
              <td colSpan={1} style={moneyRowValueStyle}>
                {formatMoney(subtotal)} đ
              </td>
            </tr>

            {shipFee > 0 && (
              <tr>
                <td colSpan={6} style={moneyRowLabelStyle}>
                  Phí vận chuyển
                </td>
                <td colSpan={1} style={moneyRowValueStyle}>
                  {formatMoney(shipFee)} đ
                </td>
              </tr>
            )}

            {hasTax && (
              <tr>
                <td colSpan={6} style={moneyRowLabelStyle}>
                  Thuế GTGT ({taxPercentStr}%)
                </td>
                <td colSpan={1} style={moneyRowValueStyle}>
                  {formatMoney(tax + shipTax)} đ
                </td>
              </tr>
            )}

            {laborFee > 0 && (
              <tr>
                <td colSpan={6} style={moneyRowLabelStyle}>
                  Phụ cấp kỹ thuật (không VAT)
                </td>
                <td colSpan={1} style={moneyRowValueStyle}>
                  {formatMoney(laborFee)} đ
                </td>
              </tr>
            )}

            <tr>
              <td colSpan={6} style={moneyRowLabelStyle}>
                Tổng cộng
              </td>
              <td colSpan={1} style={moneyRowValueStyle}>
                {formatMoney(total)} đ
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ ...styles.textAmountRow, marginTop: cfg.compact ? 4 : 6, fontSize: cfg.compact ? 11.7 : 12.5 }}>
          Số tiền bằng chữ: <span style={styles.bold}>{totalText}</span>
        </div>
      </div>

      <div style={signaturesWrapperStyle} className="signatures-wrapper">
        <div style={signaturesRowStyle}>
          <div style={styles.signatureCol}>
            <div style={styles.signatureLabel}>Người lập phiếu</div>
            <div style={signatureNoteStyle}>(Ký, ghi rõ họ tên)</div>
          </div>
          <div style={styles.signatureCol}>
            <div style={styles.signatureLabel}>Người giao hàng</div>
            <div style={signatureNoteStyle}>(Ký, ghi rõ họ tên)</div>
          </div>
          <div style={styles.signatureCol}>
            <div style={styles.signatureLabel}>Khách hàng</div>
            <div style={signatureNoteStyle}>(Ký, ghi rõ họ tên)</div>
          </div>
        </div>
      </div>
    </>
  );

  const toolbar = (
    <div className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="mr-auto min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            In {title.toLowerCase()} số {invoice.code}
          </div>
          <div className="text-xs text-slate-500">{cfg.hint}</div>
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="Khổ giấy">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={printMode === m}
              title={PAPERS[m].hint}
              onClick={() => pickPaper(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                printMode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {PAPERS[m].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
            <path d="M7 8V3h10v5M7 17H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinejoin="round" />
            <rect x="7" y="13" width="10" height="8" rx="1" />
          </svg>
          In (Ctrl+P)
        </button>
      </div>
      {overflow && (
        <div className="border-t border-amber-200 bg-amber-50">
          <div className="mx-auto max-w-[1100px] px-4 py-2 text-sm text-amber-900">
            {isSlot
              ? "Hoá đơn dài hơn nửa tờ A4 nên sẽ bị cắt mất phần dưới. Chọn A4 hoặc A5 để in đủ."
              : printMode === "A4"
                ? "Hoá đơn dài, có thể in sang trang 2 (đầu bảng tự lặp lại)."
                : `Hoá đơn dài, có thể in sang trang 2 khổ ${cfg.label}. Muốn chắc chắn gọn 1 tờ thì chọn A4.`}
          </div>
        </div>
      )}
      <div className="mx-auto max-w-[1100px] px-4 pb-2 text-xs text-slate-500">
        Trong hộp in của trình duyệt: chọn đúng khổ giấy {isSlot ? "A4" : cfg.label.split(" ")[0]}
        {printMode === "A5L" ? " ngang (Landscape)" : ""}, Lề = Không có (None), Tỷ lệ = 100%, tắt Đầu trang và chân trang.
      </div>
    </div>
  );

  return (
    <>
      {toolbar}
      <div className="print-root" data-mode={printMode}>
        <div ref={mmRef} className="mm-ruler" />
        {!isSlot && overflow && (
          <div className="page-end" aria-hidden="true">
            <span>hết trang 1</span>
          </div>
        )}

        {isSlot ? (
          <div className="a5-slot" aria-hidden={false}>
            <div className="a5-frame" aria-hidden="true" />
            <div style={borderBoxStyle} ref={borderBoxRef} className="border-box">
              {InvoiceContent}
            </div>
          </div>
        ) : (
          <>
            <div className="a4-frame" aria-hidden="true" />
            <div className="page-box">
              <div style={borderBoxStyle} ref={borderBoxRef} className="border-box">
                {InvoiceContent}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default InvoicePrintPage;