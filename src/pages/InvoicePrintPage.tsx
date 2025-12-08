// src/pages/InvoicePrintPage.tsx
import React, { useEffect, useState } from "react";
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

// Bỏ phần [ ... ] trong tên sản phẩm khi in
function stripBracketPart(name: string): string {
  if (!name) return "";
  // Xoá khoảng trắng + đoạn [ ... ]
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

    // hàng trăm
    if (hundred > 0) {
      parts.push(digits[hundred], "trăm");
    } else if (full && (ten > 0 || one > 0)) {
      // chỉ thêm "không trăm" cho các nhóm ở giữa, không phải nhóm lớn nhất
      parts.push("không", "trăm");
    }

    // hàng chục + đơn vị
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

  // tách thành các nhóm 3 số
  let value = n;
  const groups: number[] = [];
  while (value > 0) {
    groups.push(value % 1000);
    value = Math.floor(value / 1000);
  }

  const chunks: string[] = [];
  let hadNonZero = false; // đã gặp nhóm khác 0 phía trước chưa

  // duyệt từ nhóm lớn nhất xuống
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

// ================= types =================
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
  type: "SALES" | "PURCHASE";
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
    justifyContent: "flex-start", // ❗ không kéo chữ ký sát mép
    fontFamily: "'Times New Roman', Arial, sans-serif",
    fontSize: 13,
    color: "#000",
  },
  topSection: {
    flexShrink: 0,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  logoBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  logoImg: {
    width: 78,
    height: 78,
    objectFit: "contain",
  },
  companyInfo: {
    fontSize: 12,
    lineHeight: 1.4,
  },
  companyName: {
    fontWeight: 700,
    fontSize: 14,
    textTransform: "uppercase",
  },
  invoiceTitle: {
    textAlign: "center",
    fontWeight: 700,
    fontSize: 18,
    margin: "4mm 0 3mm",
  },
  invoiceCodeDateRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    marginBottom: 8,
  },
  customerBox: {
    borderTop: "1px solid #000",
    borderBottom: "1px solid #000",
    padding: "4px 0",
    marginBottom: 6,
    fontSize: 13,
  },
  customerRow: {
    display: "flex",
    gap: 12,
    marginBottom: 3,
  },
  customerLabel: {
    width: 85,
    fontWeight: 600,
  },
  customerValue: {
    flex: 1,
    borderBottom: "1px dotted #000",
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
  },
  tdCenter: {
    textAlign: "center",
  },
  tdRight: {
    textAlign: "right",
  },
  moneyRowLabel: {
    padding: "3px 6px",
    border: "1px solid #000",
    width: "50%",
  },
  moneyRowValue: {
    padding: "3px 6px",
    border: "1px solid #000",
    textAlign: "right",
  },
  textAmountRow: {
    fontSize: 12.5,
    marginTop: 6,
  },
  bold: { fontWeight: 600 },
  signaturesWrapper: {
    marginTop: "18mm", // khoảng cách từ bảng tổng xuống hàng ký
    marginBottom: "20mm", // CHỪA TRỐNG 2cm phía dưới để ký thoải mái
  },
  signaturesRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
  },
  signatureCol: {
    textAlign: "center",
    width: "33%",
  },
  signatureLabel: {
    fontWeight: 600,
    marginBottom: 2,
  },
  signatureNote: {
    fontStyle: "italic",
    fontSize: 11,
  },
};

// ================= component =================
const InvoicePrintPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<ApiInvoice | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/invoices/${id}`);
        const data = unwrap<ApiInvoice>(res);
        setInvoice(data);
      } catch (err) {
        console.error("load invoice print error", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading || !invoice) {
    return <div style={{ padding: 20 }}>Đang tải hóa đơn...</div>;
  }

  const issueDate = formatDate(invoice.issueDate);
  const lines: Line[] =
    invoice.lines?.map((l) => ({
      id: l.id,
      // Bỏ phần [ ... ] trong tên hàng khi in
      name: stripBracketPart(l.item?.name ?? l.itemName ?? ""),
      unit: l.item?.unit ?? l.unit ?? "",
      qty: Number(l.qty ?? 0),
      price: Number(l.price ?? 0),
      amount: Number(l.amount ?? 0),
    })) ?? [];

  const subtotal =
    typeof invoice.subtotal === "number"
      ? invoice.subtotal
      : Number(invoice.subtotal ?? 0);
  const tax =
    typeof invoice.tax === "number" ? invoice.tax : Number(invoice.tax ?? 0);
  const total =
    typeof invoice.total === "number"
      ? invoice.total
      : Number(invoice.total ?? subtotal + tax);

  const hasTax = tax > 0.0001;
  const taxPercent = subtotal > 0 ? (tax / subtotal) * 100 : 0;
  const taxPercentStr = hasTax ? taxPercent.toFixed(0) : "";
  const totalText = numberToVietnamese(total);

  return (
    <>
      <style>
        {`
    @page {
      size: A4;
      /* top right bottom left
         đáy để lớn hơn 1 chút cho đỡ cảm giác lệch */
      margin: 10mm 12mm 18mm 12mm;
    }

    @media print {
      html, body {
        width: 210mm;
        height: 297mm;
      }
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
          {/* TOP: header + khách hàng + bảng hàng hóa */}
          <div style={styles.topSection}>
            <div style={styles.headerRow}>
              <div style={styles.logoBox}>
                <img
                  src="/logo-mcbrother.png"
                  alt="MCBROTHER logo"
                  style={styles.logoImg}
                />
                <div style={styles.companyInfo}>
                  <div style={styles.companyName}>
                    CÔNG TY CỔ PHẦN THIẾT BỊ MCBROTHER
                  </div>
                  <div>
                    Địa chỉ: 33 Đường số 5, Kdc Vĩnh Lộc, Phường Bình Tân,
                    TP. Hồ Chí Minh
                  </div>
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

            <div style={styles.invoiceTitle}>HÓA ĐƠN BÁN HÀNG</div>

            {/* Khách hàng */}
            <div style={styles.customerBox}>
              <div style={styles.customerRow}>
                <div style={styles.customerLabel}>Khách hàng:</div>
                <div style={styles.customerValue}>
                  {invoice.partnerName || ""}
                </div>
              </div>
              <div style={styles.customerRow}>
                <div style={styles.customerLabel}>Địa chỉ:</div>
                <div style={styles.customerValue}>
                  {invoice.partnerAddr || ""}
                </div>
              </div>
              <div style={styles.customerRow}>
                <div style={styles.customerLabel}>Điện thoại:</div>
                <div style={styles.customerValue}>
                  {invoice.partnerPhone || ""}
                </div>
              </div>
              {invoice.partnerTax && (
                <div style={styles.customerRow}>
                  <div style={styles.customerLabel}>Mã số thuế:</div>
                  <div style={styles.customerValue}>{invoice.partnerTax}</div>
                </div>
              )}
            </div>

            {/* Bảng hàng hóa */}
            <table style={styles.table}>
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
                    <td style={{ ...styles.td, ...styles.tdCenter }}>
                      {idx + 1}
                    </td>
                    <td style={styles.td}>{l.name}</td>
                    <td style={{ ...styles.td, ...styles.tdCenter }}>
                      {l.unit}
                    </td>
                    <td style={{ ...styles.td, ...styles.tdCenter }}>
                      {l.qty}
                    </td>
                    <td style={{ ...styles.td, ...styles.tdRight }}>
                      {l.price.toLocaleString()}
                    </td>
                    <td style={{ ...styles.td, ...styles.tdRight }}>
                      {l.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}

                {/* Tạm tính */}
                <tr>
                  <td colSpan={5} style={styles.moneyRowLabel}>
                    Tạm tính
                  </td>
                  <td colSpan={2} style={styles.moneyRowValue}>
                    {subtotal.toLocaleString()} đ
                  </td>
                </tr>

                {/* Thuế (nếu có) */}
                {hasTax && (
                  <tr>
                    <td colSpan={5} style={styles.moneyRowLabel}>
                      Thuế GTGT ({taxPercentStr}%)
                    </td>
                    <td colSpan={2} style={styles.moneyRowValue}>
                      {tax.toLocaleString()} đ
                    </td>
                  </tr>
                )}

                {/* Tổng cộng */}
                <tr>
                  <td colSpan={5} style={styles.moneyRowLabel}>
                    Tổng cộng
                  </td>
                  <td colSpan={2} style={styles.moneyRowValue}>
                    {total.toLocaleString()} đ
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Số tiền bằng chữ */}
            <div style={styles.textAmountRow}>
              Số tiền bằng chữ: <span style={styles.bold}>{totalText}</span>
            </div>
          </div>

          {/* BOTTOM: chữ ký – gói trong wrapper để chừa trống dưới */}
          <div style={styles.signaturesWrapper}>
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
