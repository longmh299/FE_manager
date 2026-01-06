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

// ================= print auto A4/A5 =================
type PrintMode = "A4_PORTRAIT" | "A5_LANDSCAPE";

const A5_MAX_LINES = 6;

// A4 dọc
const A4_PAGE = { w: 210, h: 297 };
const A4_MARGIN = { top: 10, right: 12, bottom: 18, left: 12 };

// A5 ngang
const A5_PAGE = { w: 210, h: 148 };
const A5_MARGIN = { top: 12, right: 12, bottom: 12, left: 12 };

function ensurePrintStyleTag() {
  let el = document.getElementById("print-page-style") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "print-page-style";
    document.head.appendChild(el);
  }
  return el;
}

/**
 * ✅ Viền luôn là viền tờ giấy (page frame), full A4/A5
 * - Screen: frame absolute theo .print-root (min-height = khổ giấy) => nhìn đẹp, không “ăn nửa trang”
 * - Print : frame fixed => tự lặp trên từng trang khi paginate
 */
function applyPrintMode(mode: PrintMode) {
  const styleEl = ensurePrintStyleTag();

  const page = mode === "A5_LANDSCAPE" ? A5_PAGE : A4_PAGE;
  // const m = mode === "A5_LANDSCAPE" ? A5_PAGE : A4_PAGE; // just to keep ref, not used
  const margin = mode === "A5_LANDSCAPE" ? A5_MARGIN : A4_MARGIN;

  const pageSizeCss = mode === "A5_LANDSCAPE" ? `${page.w}mm ${page.h}mm` : `A4 portrait`;
  const pageMarginCss = `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`;

  styleEl.textContent = `
@page { size: ${pageSizeCss}; margin: ${pageMarginCss}; }

body {
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ================= SCREEN ================= */
@media screen {
  .print-root{
    width: ${page.w}mm;
    min-height: ${page.h}mm;
    height: auto;
    margin: 16px auto;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 30px rgba(0,0,0,.08);
    position: relative;
    box-sizing: border-box;
    overflow: visible;
  }

  /* ✅ viền full trang (theo khổ giấy) */
  .page-frame{
    display: block;
    position: absolute;
    inset: 0;
    border: 0px solid #000;
    pointer-events: none;
    z-index: 0;
    background: transparent;
  }

  /* nội dung nằm trên frame */
  .border-box{
    position: relative;
    z-index: 1;
    border: none !important;
    min-height: ${page.h}mm;
    box-shadow: none !important;
  }
}

/* ================= PRINT ================= */
@media print {
  html, body { margin: 0; padding: 0; }

  .print-root{
    width: 100%;
    height: auto;
    background: transparent;
    position: relative;
    overflow: visible !important;
  }

  /* ✅ viền full từng trang */
  .page-frame{
    display: block !important;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    border: 1px solid #000;
    pointer-events: none;
    z-index: 0;
    background: transparent;
  }

  .border-box{
    position: relative;
    z-index: 1;
    border: none !important;
    box-shadow: none !important;
    min-height: 0 !important;
  }

  table.invoice-table thead { display: table-header-group; }
  table.invoice-table tr { page-break-inside: avoid; break-inside: avoid; }
  .signatures-wrapper { page-break-inside: avoid; break-inside: avoid; }
}
`;
}

function preferA5ByLines(lineCount: number) {
  return lineCount <= A5_MAX_LINES;
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
    flex: 1,
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

  invoiceMeta: {
    textAlign: "center",
    fontSize: 12,
    marginBottom: 6,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
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

  signaturesWrapper: { marginTop: "18mm", marginBottom: "20mm" },
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
  const [printMode, setPrintMode] = useState<PrintMode>("A4_PORTRAIT");

  const printRootRef = useRef<HTMLDivElement>(null);
  const borderBoxRef = useRef<HTMLDivElement>(null);

  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => {
    applyPrintMode(printMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ✅ Auto A5 nếu ngắn, tràn thì lên A4
  useLayoutEffect(() => {
    if (!invoice) return;

    const tryA5 = preferA5ByLines(lines.length);
    if (!tryA5) {
      setPrintMode("A4_PORTRAIT");
      applyPrintMode("A4_PORTRAIT");
      return;
    }

    setPrintMode("A5_LANDSCAPE");
    applyPrintMode("A5_LANDSCAPE");

    const check = () => {
      const root = printRootRef.current;
      const box = borderBoxRef.current;
      if (!root || !box) return;

      // nếu nội dung vượt quá 1 trang A5 -> chuyển A4
      const r = root.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const overflowPx = b.bottom - r.bottom;
      if (overflowPx > 1) {
        setPrintMode("A4_PORTRAIT");
        applyPrintMode("A4_PORTRAIT");
      }
    };

    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(check);
      (check as any)._raf2 = raf2;
    });

    const t = window.setTimeout(check, 80);

    return () => {
      cancelAnimationFrame(raf1);
      const raf2 = (check as any)._raf2 as number | undefined;
      if (raf2) cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, lines.length, layoutTick]);

  useEffect(() => {
    const onBeforePrint = () => applyPrintMode(printMode);
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [printMode]);

  const computedSubtotal = useMemo(() => lines.reduce((sum, l) => sum + toNum(l.amount), 0), [lines]);

  if (loading || !invoice) return <div style={{ padding: 20 }}>Đang tải hóa đơn...</div>;

  const subtotalRaw = invoice.subtotal != null ? toNum(invoice.subtotal) : computedSubtotal;
  const taxRaw = invoice.tax != null ? toNum(invoice.tax) : 0;
  const totalRaw = invoice.total != null ? toNum(invoice.total) : toNum(subtotalRaw) + toNum(taxRaw);

  const subtotal = subtotalRaw;
  const tax = taxRaw;
  const total = totalRaw;

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

  const isA5 = printMode === "A5_LANDSCAPE";

  const borderBoxStyle: React.CSSProperties = {
    ...styles.borderBox,
    padding: isA5 ? "6mm 8mm 7mm" : "8mm 10mm 10mm",
    fontSize: isA5 ? 12.5 : 13,
  };

  const logoImgStyle: React.CSSProperties = {
    ...styles.logoImg,
    width: isA5 ? 70 : 85,
    height: isA5 ? 70 : 85,
  };

  const invoiceTitleStyle: React.CSSProperties = {
    ...styles.invoiceTitle,
    fontSize: isA5 ? 16 : 18,
    margin: isA5 ? "2mm 0 1mm" : "3mm 0 1.5mm",
  };

  const tableStyle: React.CSSProperties = {
    ...styles.table,
    fontSize: isA5 ? 12 : 12.5,
  };

  // ✅ A4: đẩy chữ ký xuống đáy trang (đẹp, không lộ “mảng trắng dưới khung”)
  const signaturesWrapperStyle: React.CSSProperties = isA5
    ? { ...styles.signaturesWrapper, marginTop: "7mm", marginBottom: "7mm" }
    : { ...styles.signaturesWrapper, marginTop: "auto", marginBottom: "10mm" };

  return (
    <div className="print-root" ref={printRootRef}>
      <div className="page-frame" aria-hidden="true" />

      <div style={borderBoxStyle} ref={borderBoxRef} className="border-box">
        <div style={styles.topSection}>
          <div style={styles.headerRow}>
            <div style={styles.logoBox}>
              <img
                src="/logo-mcbrother.png"
                alt="MCBROTHER logo"
                style={logoImgStyle}
                onLoad={() => setLayoutTick((t) => t + 1)}
                onError={() => setLayoutTick((t) => t + 1)}
              />
              <div style={styles.companyInfo}>
                <div style={styles.companyName}>CÔNG TY CỔ PHẦN THIẾT BỊ MCBROTHER</div>
                <div>Địa chỉ: 33 Đường số 5, Khu dân cư Vĩnh Lộc, Phường Bình Tân, TP. Hồ Chí Minh</div>
                <div>
                  Điện thoại: 028.6273.2018 &nbsp;–&nbsp; Mã số thuế: 0312229437
                </div>
                <div>Email: mcbrother2013@gmail.com</div>
              </div>
            </div>
          </div>

          <div style={invoiceTitleStyle}>{title}</div>

          <div style={styles.invoiceMeta}>
            <div>
              Số: <span style={styles.bold}>{invoice.code}</span>
            </div>
            <div>
              Ngày lập: <span style={styles.bold}>{issueDate}</span>
            </div>
          </div>

          <div style={styles.customerBox}>
            <div style={styles.customerRow}>
              <div style={styles.customerLabel}>Khách hàng:</div>
              <div style={styles.customerValue}>{customerName}</div>
            </div>
            <div style={styles.customerRow}>
              <div style={styles.customerLabel}>Địa chỉ:</div>
              <div style={styles.customerValue}>{customerAddr}</div>
            </div>
            <div style={styles.customerRow}>
              <div style={styles.customerLabel}>Điện thoại:</div>
              <div style={styles.customerValue}>{customerPhone}</div>
            </div>
            <div style={styles.customerRow}>
              <div style={styles.customerLabel}>Mã số thuế:</div>
              <div style={styles.customerValue}>{customerTax || ""}</div>
            </div>
          </div>

          <table style={tableStyle} className="invoice-table">
            <thead>
              <tr>
                <th style={{ ...styles.th, width: "6%" }}>STT</th>
                <th style={{ ...styles.th, width: "40%" }}>Tên hàng hóa</th>
                <th style={{ ...styles.th, width: "8%" }}>ĐVT</th>
                <th style={{ ...styles.th, width: "8%" }}>Số lượng</th>
                <th style={{ ...styles.th, width: "15%" }}>Đơn giá</th>
                <th style={{ ...styles.th, width: "15%" }}>Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.id}>
                  <td style={{ ...styles.td, ...styles.tdCenter }}>{idx + 1}</td>
                  <td style={styles.td}>{l.name}</td>
                  <td style={{ ...styles.td, ...styles.tdCenter }}>{l.unit}</td>
                  <td style={{ ...styles.td, ...styles.tdCenter }}>{l.qty}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>{formatMoney(l.price)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>{formatMoney(l.amount)}</td>
                </tr>
              ))}

              <tr>
                <td colSpan={5} style={styles.moneyRowLabel}>
                  Tạm tính
                </td>
                <td colSpan={1} style={styles.moneyRowValue}>
                  {formatMoney(subtotal)} đ
                </td>
              </tr>

              {hasTax && (
                <tr>
                  <td colSpan={5} style={styles.moneyRowLabel}>
                    Thuế GTGT ({taxPercentStr}%)
                  </td>
                  <td colSpan={1} style={styles.moneyRowValue}>
                    {formatMoney(tax)} đ
                  </td>
                </tr>
              )}

              <tr>
                <td colSpan={5} style={styles.moneyRowLabel}>
                  Tổng cộng
                </td>
                <td colSpan={1} style={styles.moneyRowValue}>
                  {formatMoney(total)} đ
                </td>
              </tr>
            </tbody>
          </table>

          <div style={styles.textAmountRow}>
            Số tiền bằng chữ: <span style={styles.bold}>{totalText}</span>
          </div>
        </div>

        <div style={signaturesWrapperStyle} className="signatures-wrapper">
          <div style={styles.signaturesRow}>
            <div style={styles.signatureCol}>
              <div style={styles.signatureLabel}>Người lập phiếu</div>
              <div style={styles.signatureNote}>(Ký, ghi rõ họ tên)</div>
            </div>
            <div style={styles.signatureCol}>
              <div style={styles.signatureLabel}>Người giao hàng</div>
              <div style={styles.signatureNote}>(Ký, ghi rõ họ tên)</div>
            </div>
            <div style={styles.signatureCol}>
              <div style={styles.signatureLabel}>Khách hàng</div>
              <div style={styles.signatureNote}>(Ký, ghi rõ họ tên)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePrintPage;
