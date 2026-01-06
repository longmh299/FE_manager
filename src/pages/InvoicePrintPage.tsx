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
type PrintMode = "A4_FULL" | "A5_SLOT_ON_A4";

const A5_PREFER_MAX_LINES = 2;

// A4 portrait thật sự
const A4_PAGE = { w: 210, h: 297 };

// ✅ A5 slot NGANG trên A4 (an toàn hơn A5 chuẩn 210x148)
const A5_SLOT = { w: 200, h: 140 }; // mm
const A5_SLOT_POS = {
  top: 10,
  left: (A4_PAGE.w - A5_SLOT.w) / 2, // căn giữa
};

// Viền khung
const FRAME_INSET_A4 = 8;
const FRAME_INSET_SLOT = 5;

// Padding nội dung
const CONTENT_PAD_A4 = { top: 14, right: 16, bottom: 14, left: 16 };
const CONTENT_PAD_SLOT = { top: 9, right: 12, bottom: 9, left: 12 };

const SAFE_PX = 2;

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
  const isSlot = mode === "A5_SLOT_ON_A4";

  styleEl.textContent = `
/* print-mode: ${mode} */
@page { size: A4 portrait; margin: 0; }

html, body {
  margin: 0;
  padding: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.mm-ruler{
  position: fixed;
  left: -1000mm;
  top: 0;
  width: 1mm;
  height: 1mm;
  pointer-events: none;
  opacity: 0;
}

@media screen {
  .print-root{
    width: ${A4_PAGE.w}mm;
    min-height: ${A4_PAGE.h}mm;
    margin: 16px auto;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 30px rgba(0,0,0,.08);
    position: relative;
    box-sizing: border-box;
    overflow: visible;
  }
}

@media print {
  .print-root{
    width: ${A4_PAGE.w}mm;
    height: ${A4_PAGE.h}mm;
    background: transparent;
    position: relative;
    overflow: visible !important;
  }
}

table.invoice-table thead { display: table-header-group; }
table.invoice-table tr { page-break-inside: avoid; break-inside: avoid; }
.signatures-wrapper { page-break-inside: avoid; break-inside: avoid; }

/* ====== Frame A4 full ====== */
.a4-frame{
  position: absolute;
  inset: ${FRAME_INSET_A4}mm;
  border: 1px solid #000;
  pointer-events: none;
  z-index: 0;
  display: ${isSlot ? "none" : "block"};
}

.border-box{
  position: relative;
  z-index: 1;
  border: none !important;
  box-shadow: none !important;
}

/* ====== Slot A5 ngang trên A4 ====== */
.a5-slot{
  position: absolute;
  top: ${A5_SLOT_POS.top}mm;
  left: ${A5_SLOT_POS.left}mm;
  width: ${A5_SLOT.w}mm;
  height: ${A5_SLOT.h}mm;
  box-sizing: border-box;
  display: ${isSlot ? "block" : "none"};
}
.a5-frame{
  position: absolute;
  inset: ${FRAME_INSET_SLOT}mm;
  border: 1px solid #000;
  pointer-events: none;
  z-index: 0;
}

/* border-box chỉ nằm TRONG slot */
.a5-slot .border-box{
  position: absolute;
  inset: ${FRAME_INSET_SLOT}mm;
  z-index: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
`;
}

function preferSlotByLines(lineCount: number) {
  return lineCount <= A5_PREFER_MAX_LINES;
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
  lines: ApiInvoiceLine[];
};

type Line = {
  id: string;
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

  const [unitByItemId, setUnitByItemId] = useState<Record<string, string>>({});
  const [printMode, setPrintMode] = useState<PrintMode>("A4_FULL");

  const printModeRef = useRef<PrintMode>("A4_FULL");
  useEffect(() => {
    printModeRef.current = printMode;
  }, [printMode]);

  const borderBoxRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<HTMLDivElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);

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

      return {
        id: l.id,
        name: stripBracketPart(l.item?.name ?? l.itemName ?? ""),
        unit: unitFromInvoice || unitFromItem || "",
        qty,
        price,
        amount,
      };
    });
  }, [invoice, unitByItemId]);

  const linesKey = useMemo(() => lines.map((x) => `${x.id}|${x.qty}|${x.price}|${x.amount}`).join("||"), [lines]);

  // ✅ Auto: ít dòng => thử slot A5 ngang; nếu tràn => A4 full
  useLayoutEffect(() => {
    if (!invoice) return;

    const preferSlot = preferSlotByLines(lines.length);
    const first: PrintMode = preferSlot ? "A5_SLOT_ON_A4" : "A4_FULL";

    if (printModeRef.current !== first) setPrintMode(first);
    applyPrintMode(first);

    if (!preferSlot) return;

    let cancelled = false;

    const checkOverflow = () => {
      if (cancelled) return;
      const box = borderBoxRef.current;
      if (!box) return;

      if (box.scrollHeight > box.clientHeight + SAFE_PX) {
        if (printModeRef.current !== "A4_FULL") setPrintMode("A4_FULL");
        applyPrintMode("A4_FULL");
      }
    };

    const raf1 = requestAnimationFrame(() => requestAnimationFrame(checkOverflow));
    const t = window.setTimeout(checkOverflow, 160);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      window.clearTimeout(t);
    };
  }, [invoice?.id, linesKey, layoutTick, lines.length]);

  useEffect(() => {
    const onBeforePrint = () => applyPrintMode(printModeRef.current);
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  const computedSubtotal = useMemo(() => lines.reduce((sum, l) => sum + toNum(l.amount), 0), [lines]);

  if (loading || !invoice) return <div style={{ padding: 20 }}>Đang tải hóa đơn...</div>;

  const subtotal = invoice.subtotal != null ? toNum(invoice.subtotal) : computedSubtotal;
  const tax = invoice.tax != null ? toNum(invoice.tax) : 0;
  const total = invoice.total != null ? toNum(invoice.total) : subtotal + tax;

  const hasTax = tax > 0.0001;
  const taxPercent = subtotal > 0 ? (tax / subtotal) * 100 : 0;
  const taxPercentStr = hasTax ? taxPercent.toFixed(0) : "";
  const totalText = numberToVietnamese(total);

  const customerName = partner?.name ?? invoice.partnerName ?? "";
  const customerAddr = partner?.address ?? partner?.addr ?? invoice.partnerAddr ?? "";
  const customerPhone = partner?.phone ?? invoice.partnerPhone ?? "";
  const customerTax = partner?.taxCode ?? partner?.mst ?? partner?.tax ?? invoice.partnerTax ?? "";

  const title = (() => {
    if (invoice.type === "PURCHASE") return "HÓA ĐƠN NHẬP HÀNG";
    if (invoice.type === "SALES") return "HÓA ĐƠN BÁN HÀNG";
    if (invoice.type === "SALES_RETURN") return "PHIẾU TRẢ HÀNG (BÁN)";
    if (invoice.type === "PURCHASE_RETURN") return "PHIẾU TRẢ HÀNG (NHẬP)";
    return "HÓA ĐƠN";
  })();

  const isSlot = printMode === "A5_SLOT_ON_A4";
  const pad = isSlot ? CONTENT_PAD_SLOT : CONTENT_PAD_A4;

  const borderBoxStyle: React.CSSProperties = {
    ...styles.borderBox,
    padding: `${pad.top}mm ${pad.right}mm ${pad.bottom}mm ${pad.left}mm`,
    fontSize: isSlot ? 12.5 : 13,
  };

  const logoImgStyle: React.CSSProperties = {
    ...styles.logoImg,
    width: isSlot ? 70 : 85,
    height: isSlot ? 70 : 85,
  };

  const companyInfoStyle: React.CSSProperties = {
    ...styles.companyInfo,
    fontSize: isSlot ? 11.2 : 12,
    lineHeight: isSlot ? 1.25 : 1.4,
  };

  const companyNameStyle: React.CSSProperties = {
    ...styles.companyName,
    fontSize: isSlot ? 12.8 : 14,
  };

  const invoiceTitleStyle: React.CSSProperties = {
    ...styles.invoiceTitle,
    fontSize: isSlot ? 16.5 : 18,
    margin: isSlot ? "2mm 0 1mm" : "3mm 0 1.5mm",
  };

  const customerBoxStyle: React.CSSProperties = {
    ...styles.customerBox,
    padding: isSlot ? "2px 0" : styles.customerBox.padding,
    marginBottom: isSlot ? 4 : 6,
    fontSize: isSlot ? 12.3 : 13,
  };

  const customerLabelStyle: React.CSSProperties = {
    ...styles.customerLabel,
    width: isSlot ? 78 : 85,
  };

  const customerRowStyle: React.CSSProperties = {
    ...styles.customerRow,
    marginBottom: isSlot ? 2 : 3,
  };

  const tableStyle: React.CSSProperties = {
    ...styles.table,
    marginTop: isSlot ? 4 : 6,
    fontSize: isSlot ? 11.7 : 12.5,
  };

  const thStyle: React.CSSProperties = { ...styles.th, padding: isSlot ? "2px 3px" : styles.th.padding };
  const tdStyle: React.CSSProperties = { ...styles.td, padding: isSlot ? "2px 3px" : styles.td.padding };

  const moneyRowLabelStyle: React.CSSProperties = {
    ...styles.moneyRowLabel,
    padding: isSlot ? "2px 5px" : styles.moneyRowLabel.padding,
  };
  const moneyRowValueStyle: React.CSSProperties = {
    ...styles.moneyRowValue,
    padding: isSlot ? "2px 5px" : styles.moneyRowValue.padding,
  };

  const signaturesWrapperStyle: React.CSSProperties = isSlot
    ? { ...styles.signaturesWrapper, marginTop: "auto", marginBottom: "2mm" }
    : { ...styles.signaturesWrapper, marginTop: "auto", marginBottom: "10mm" };

  const signaturesRowStyle: React.CSSProperties = {
    ...styles.signaturesRow,
    fontSize: isSlot ? 11 : 12,
  };

  const signatureNoteStyle: React.CSSProperties = {
    ...styles.signatureNote,
    fontSize: isSlot ? 10 : 11,
  };

  const InvoiceContent = (
    <>
      <div style={styles.topSection}>
        <div style={{ ...styles.headerRow, marginBottom: isSlot ? 4 : 6 }}>
          <div style={{ ...styles.logoBox, gap: isSlot ? 8 : 10 }}>
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

        <div style={{ ...styles.invoiceMeta, marginBottom: isSlot ? 4 : 6 }}>
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
          <div style={{ ...customerRowStyle, marginBottom: 0 }}>
            <div style={customerLabelStyle}>Mã số thuế:</div>
            <div style={styles.customerValue}>{customerTax || ""}</div>
          </div>
        </div>

        <table style={tableStyle} className="invoice-table">
          <thead>
            <tr>
              <th style={{ ...thStyle, width: "6%" }}>STT</th>
              <th style={{ ...thStyle, width: "40%" }}>Tên hàng hóa</th>
              <th style={{ ...thStyle, width: "8%" }}>ĐVT</th>
              <th style={{ ...thStyle, width: "8%" }}>Số lượng</th>
              <th style={{ ...thStyle, width: "15%" }}>Đơn giá</th>
              <th style={{ ...thStyle, width: "15%" }}>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.id}>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{idx + 1}</td>
                <td style={tdStyle}>{l.name}</td>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{l.unit}</td>
                <td style={{ ...tdStyle, ...styles.tdCenter }}>{l.qty}</td>
                <td style={{ ...tdStyle, ...styles.tdRight }}>{formatMoney(l.price)}</td>
                <td style={{ ...tdStyle, ...styles.tdRight }}>{formatMoney(l.amount)}</td>
              </tr>
            ))}

            <tr>
              <td colSpan={5} style={moneyRowLabelStyle}>
                Tạm tính
              </td>
              <td colSpan={1} style={moneyRowValueStyle}>
                {formatMoney(subtotal)} đ
              </td>
            </tr>

            {hasTax && (
              <tr>
                <td colSpan={5} style={moneyRowLabelStyle}>
                  Thuế GTGT ({taxPercentStr}%)
                </td>
                <td colSpan={1} style={moneyRowValueStyle}>
                  {formatMoney(tax)} đ
                </td>
              </tr>
            )}

            <tr>
              <td colSpan={5} style={moneyRowLabelStyle}>
                Tổng cộng
              </td>
              <td colSpan={1} style={moneyRowValueStyle}>
                {formatMoney(total)} đ
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ ...styles.textAmountRow, marginTop: isSlot ? 4 : 6, fontSize: isSlot ? 11.7 : 12.5 }}>
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

  return (
    <div className="print-root" data-mode={printMode}>
      <div ref={mmRef} className="mm-ruler" />

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
          <div style={borderBoxStyle} ref={borderBoxRef} className="border-box">
            {InvoiceContent}
          </div>
        </>
      )}
    </div>
  );
};

export default InvoicePrintPage;
