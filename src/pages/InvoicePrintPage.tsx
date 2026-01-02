// src/pages/InvoicePrintPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";

// ================= helpers =================
function unwrap<T = any>(res: any): T {
  if (res && typeof res === "object" && "data" in res) {
    const body = (res as any).data;
    if (body && typeof body === "object" && "data" in body) {
      return body.data as T;
    }
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

// Bỏ phần [ ... ] trong tên sản phẩm khi in
function stripBracketPart(name: string): string {
  if (!name) return "";
  return name.replace(/\s*\[[^\]]*]/g, "");
}

// Đọc số tiền VND thành chữ tiếng Việt
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

    if (hundred > 0) {
      parts.push(digits[hundred], "trăm");
    } else if (full && (ten > 0 || one > 0)) {
      parts.push("không", "trăm");
    }

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

// ✅ lấy label đơn vị từ item response (chịu nhiều shape)
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

// ✅ extract list items/units trong các kiểu wrapper thường gặp
function extractArray(body: any): any[] {
  const b = body;
  if (!b) return [];
  if (Array.isArray(b)) return b;

  // { items: [...] }
  if (Array.isArray(b.items)) return b.items;

  // { data: [...] } hoặc { data: { items: [...] } }
  if (Array.isArray(b.data)) return b.data;
  if (b.data && Array.isArray(b.data.items)) return b.data.items;

  // { ok:true, data:[...] }
  if (Array.isArray(b.data)) return b.data;

  return [];
}

async function fetchItemLoose(itemId: string): Promise<any | null> {
  if (!itemId) return null;

  // 1) /items/:id
  try {
    const r1 = await api.get(`/items/${itemId}`);
    const b1 = unwrap<any>(r1);
    if (b1 && (b1.id || b1.data?.id)) return b1.id ? b1 : b1.data;
  } catch (e) {
    // ignore
  }

  // 2) /items?ids=<id> (nhiều backend dùng kiểu này)
  try {
    const r2 = await api.get(`/items`, { params: { ids: itemId } });
    const b2 = unwrap<any>(r2);
    const arr = extractArray(b2);
    const found = arr.find((x: any) => String(x?.id || "") === String(itemId));
    if (found) return found;
  } catch (e) {
    // ignore
  }

  // 3) /items?id=<id>
  try {
    const r3 = await api.get(`/items`, { params: { id: itemId } });
    const b3 = unwrap<any>(r3);
    const arr = extractArray(b3);
    const found = arr.find((x: any) => String(x?.id || "") === String(itemId));
    if (found) return found;
  } catch (e) {
    // ignore
  }

  return null;
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
  item?: {
    name: string;
    sku?: string | null;
    unit?: string | null;
  } | null;
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
  root: {
    width: "210mm",
    minHeight: "297mm",
    margin: "0 auto",
    boxSizing: "border-box",
    background: "#ffffff",
    display: "flex",
    justifyContent: "center",
    alignItems: "stretch",
    padding: 0,
  },
  borderBox: {
    margin: "5mm",
    flex: 1,
    border: "1px solid #000",
    boxSizing: "border-box",
    padding: "8mm 10mm 10mm",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    fontFamily: "'Times New Roman', Arial, sans-serif",
    fontSize: 13,
    color: "#000",
  },
  topSection: { flexShrink: 0 },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  logoBox: { display: "flex", alignItems: "center", gap: 8 },
  logoImg: { width: 85, height: 85, objectFit: "contain" },
  companyInfo: { fontSize: 12, lineHeight: 1.4 },
  companyName: { fontWeight: 700, fontSize: 14, textTransform: "uppercase" },
  invoiceTitle: {
    textAlign: "center",
    fontWeight: 700,
    fontSize: 18,
    margin: "4mm 0 3mm",
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
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 6,
    fontSize: 12.5,
  },
  th: {
    border: "1px solid #000",
    padding: "3px 4px",
    textAlign: "center",
    fontWeight: 600,
  },
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
  signaturesWrapper: {
    marginTop: "18mm",
    marginBottom: "20mm",
  },
  signaturesRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
  },
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

  // ✅ map itemId -> unit label (fallback khi invoice không trả unit)
  const [unitByItemId, setUnitByItemId] = useState<Record<string, string>>({});

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

        // ✅ ƯU TIÊN LẤY THÔNG TIN KHÁCH TỪ PARTNER
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

        // ✅ FIX ĐƠN VỊ TÍNH:
        // - ưu tiên line.unit / line.item.unit
        // - nếu trống -> fetch item theo itemId + map unitId -> label từ /items/units
        const lines = Array.isArray(inv?.lines) ? inv.lines : [];
        const itemIds = Array.from(
          new Set(lines.map((l) => String(l?.itemId || "").trim()).filter(Boolean))
        );

        const needFetch = itemIds.filter((itemId) => {
          const l = lines.find((x) => String(x?.itemId || "") === itemId);
          const u = String(l?.item?.unit ?? l?.unit ?? "").trim();
          return !u;
        });

        if (needFetch.length > 0) {
          // load units map 1 lần
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

                // nếu item chỉ có unitId (không include relation)
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
      const amount = l.amount != null ? toNum(l.amount) : qty * price; // ✅ fallback

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

  const computedSubtotal = useMemo(() => {
    return lines.reduce((sum, l) => sum + toNum(l.amount), 0);
  }, [lines]);

  if (loading || !invoice) {
    return <div style={{ padding: 20 }}>Đang tải hóa đơn...</div>;
  }

  // ✅ fallback tổng tiền nếu backend thiếu/khác
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

  // ✅ Chọn thông tin khách: Partner > Snapshot trong Invoice
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

  return (
    <>
      <style>
        {`
@page {
  size: A4;
  margin: 10mm 12mm 18mm 12mm;
}

@media print {
  html, body {
    width: 210mm;
    height: 297mm;
  }

  /* ✅ Lặp header bảng khi sang trang */
  table.invoice-table thead { display: table-header-group; }

  /* ✅ Không cắt ngang dòng */
  table.invoice-table tr { page-break-inside: avoid; break-inside: avoid; }

  /* ✅ Không cắt khối chữ ký */
  .signatures-wrapper { page-break-inside: avoid; break-inside: avoid; }
}

body {
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
        `}
      </style>

      <div style={styles.root}>
        <div style={styles.borderBox}>
          <div style={styles.topSection}>
            <div style={styles.headerRow}>
              <div style={styles.logoBox}>
                <img src="/logo-mcbrother.png" alt="MCBROTHER logo" style={styles.logoImg} />
                <div style={styles.companyInfo}>
                  <div style={styles.companyName}>CÔNG TY CỔ PHẦN THIẾT BỊ MCBROTHER</div>
                  <div>Địa chỉ: 33 Đường số 5, Kdc Vĩnh Lộc, Phường Bình Tân, TP. Hồ Chí Minh</div>
                  <div>
                    Điện thoại: 0834.551.888 &nbsp;–&nbsp; Mã số thuế: 0312345678
                  </div>
                  <div>Email: mcbrother2013@gmail.com</div>
                </div>
              </div>

              <div style={{ textAlign: "right", fontSize: 12 }}>
                <div>
                  Số: <span style={styles.bold}>{invoice.code}</span>
                </div>
                <div>
                  Ngày lập: <span style={styles.bold}>{issueDate}</span>
                </div>
              </div>
            </div>

            <div style={styles.invoiceTitle}>{title}</div>

            {/* Khách hàng */}
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

              {/* ✅ LUÔN HIỂN THỊ, DÙ TRỐNG */}
              <div style={styles.customerRow}>
                <div style={styles.customerLabel}>Mã số thuế:</div>
                <div style={styles.customerValue}>{customerTax || ""}</div>
              </div>
            </div>

            {/* Bảng hàng hóa */}
            <table style={styles.table} className="invoice-table">
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

                {/* ✅ FIX colSpan: bảng có 6 cột => label span 5, value span 1 */}
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

          <div style={styles.signaturesWrapper} className="signatures-wrapper">
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
    </>
  );
};

export default InvoicePrintPage;
