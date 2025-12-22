import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type UserRole = "staff" | "accountant" | "admin";
// type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";


type StaffUser = { id: string; name: string };

type SalesLedgerRow = {
  issueDate: string; // yyyy-mm-dd
  code: string;
  partnerName: string;

  itemName: string;
  itemSku?: string | null;

  qty: number;
  unitPrice: number;
  unitCost: number;
  costTotal: number;

  lineAmount: number;

  paid: number;
  debt: number;

  saleUserName: string;
  techUserName: string;
};

type SalesLedgerResponse = {
  rows: SalesLedgerRow[];
  totals: {
    totalRevenue: number;
    totalCost: number;
    totalPaid: number;
    totalDebt: number;
  };
};

function unwrap<T = any>(res: any): T {
  const body = res?.data;
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}

async function fetchMeRole(): Promise<UserRole | null> {
  try {
    const r = await api.get("/auth/me");
    return (r?.data?.role ?? r?.data?.user?.role ?? null) as any;
  } catch {
    return null;
  }
}

function formatMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #E5E7EB",
    background: "#fff",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  border: "1px solid #E5E7EB",
  borderRadius: 12,
};

const labelStyle: React.CSSProperties = { fontWeight: 800, marginBottom: 6 };

export default function SalesLedgerReportPage() {
  const nav = useNavigate();
  const toast = useToast();

  const [role, setRole] = useState<UserRole | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const [loading, setLoading] = useState(false);

  // filters
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState("");
  const [saleUserId, setSaleUserId] = useState("");
  const [techUserId, setTechUserId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<string>("");

  const [staffs, setStaffs] = useState<StaffUser[]>([]);

  const [data, setData] = useState<SalesLedgerResponse>(() => ({
    rows: [],
    totals: { totalRevenue: 0, totalCost: 0, totalPaid: 0, totalDebt: 0 },
  }));

  // hover row
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // ✅ pagination by INVOICE (20 invoices / page)
  const PAGE_SIZE_INVOICE = 20;
  const [page, setPage] = useState(1);

  // role gate
  useEffect(() => {
    (async () => {
      setLoadingRole(true);
      const r = await fetchMeRole();
      setRole(r);
      setLoadingRole(false);

      if (!r) return nav("/login", { replace: true });
      if (r === "staff") {
        toast.push({ type: "error", title: "Không có quyền", message: "Bạn không có quyền xem báo cáo." });
        return nav("/", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load staff list for filters
  useEffect(() => {
    if (!role || role === "staff") return;

    (async () => {
      try {
        const res = await api.get("/users", { params: { page: 1, pageSize: 3000 } });
        const body = (res as any).data || {};
        const itemsData = (body.items || body?.data?.items || []) as any[];

        const mapped: StaffUser[] = (Array.isArray(itemsData) ? itemsData : [])
          .filter((u) => u.role === "staff")
          .map((u) => ({ id: String(u.id), name: String(u.username || u.name || u.email || u.id) }));

        setStaffs(mapped);
      } catch {
        setStaffs([]);
      }
    })();
  }, [role]);

  async function fetchReport() {
    setLoading(true);
    try {
      const res = await api.get("/reports/sales-ledger", {
        params: {
          from: from || undefined,
          to: to || undefined,
          q: q?.trim() || undefined,
          saleUserId: saleUserId || undefined,
          techUserId: techUserId || undefined,
          paymentStatus: paymentStatus || undefined,
        },
      });

      const body = unwrap<any>(res);
      const payload = (body?.data ?? body) as SalesLedgerResponse;

      setData({
        rows: Array.isArray(payload?.rows) ? payload.rows : [],
        totals: payload?.totals || { totalRevenue: 0, totalCost: 0, totalPaid: 0, totalDebt: 0 },
      });

      // ✅ reset page whenever refetch
      setPage(1);
    } catch (e: any) {
      toast.push({
        type: "error",
        title: "Lỗi",
        message: e?.response?.data?.message || e?.message || "Không tải được bảng kê bán.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function exportExcel() {
    try {
      setLoading(true);

      const res = await api.get("/reports/sales-ledger.xlsx", {
        params: {
          from: from || undefined,
          to: to || undefined,
          q: q?.trim() || undefined,
          saleUserId: saleUserId || undefined,
          techUserId: techUserId || undefined,
          paymentStatus: paymentStatus || undefined,
        },
        responseType: "blob",
      });

      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const filename = `bang_ke_ban_${y}${m}${d}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.push({
        type: "error",
        title: "Lỗi",
        message: e?.response?.data?.message || e?.message || "Không export được Excel.",
      });
    } finally {
      setLoading(false);
    }
  }

  // auto load first time after role ok
  useEffect(() => {
    if (!role || role === "staff") return;
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const profit = useMemo(
    () => (data.totals.totalRevenue || 0) - (data.totals.totalCost || 0),
    [data.totals]
  );

  // ✅ build invoice keys (by code) in display order
  const invoiceKeys = useMemo(() => {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const r of data.rows || []) {
      const k = String(r.code || "");
      if (!k) continue;
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
    return keys;
  }, [data.rows]);

  const totalInvoices = invoiceKeys.length;
  const totalPages = Math.max(1, Math.ceil(totalInvoices / PAGE_SIZE_INVOICE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const visibleInvoiceKeySet = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE_INVOICE;
    const end = start + PAGE_SIZE_INVOICE;
    const keys = invoiceKeys.slice(start, end);
    return new Set(keys);
  }, [invoiceKeys, safePage]);

  const visibleRows = useMemo(() => {
    if (!data.rows?.length) return [];
    if (!visibleInvoiceKeySet.size) return [];
    return data.rows.filter((r) => visibleInvoiceKeySet.has(String(r.code || "")));
  }, [data.rows, visibleInvoiceKeySet]);

  // ✅ zebra + hover + highlight (loss/debt)
  function rowStyle(r: SalesLedgerRow, idx: number): React.CSSProperties {
    const lineProfit = Number(r.lineAmount || 0) - Number(r.costTotal || 0);
    const isDebt = Number(r.debt || 0) > 0;
    const isLoss = lineProfit < 0 || (Number(r.unitCost || 0) > 0 && Number(r.unitPrice || 0) > 0 && Number(r.unitCost) > Number(r.unitPrice));

    const zebra = idx % 2 === 0 ? "#FFFFFF" : "#FAFAFB";

    if (hoverIdx === idx) return { background: "#F1F5F9" };
    if (isLoss) return { background: "#FEF2F2" };
    if (isDebt) return { background: "#FFF7ED" };
    return { background: zebra };
  }

  // semantic styles
  const moneyMuted: React.CSSProperties = { color: "#374151", fontWeight: 700 };
  const moneyStrong: React.CSSProperties = { color: "#111827", fontWeight: 900 };
  const moneyPaid: React.CSSProperties = { color: "#15803D", fontWeight: 800 };
  const moneyDebt: React.CSSProperties = { color: "#DC2626", fontWeight: 900 };

  function Pagination() {
    const start = totalInvoices === 0 ? 0 : (safePage - 1) * PAGE_SIZE_INVOICE + 1;
    const end = Math.min(totalInvoices, safePage * PAGE_SIZE_INVOICE);

    const btnBase: React.CSSProperties = {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid #E5E7EB",
      background: "#fff",
      fontWeight: 800,
      cursor: "pointer",
    };

    const btnDisabled: React.CSSProperties = {
      ...btnBase,
      cursor: "not-allowed",
      opacity: 0.5,
    };

    const btnActive: React.CSSProperties = {
      ...btnBase,
      border: "1px solid #111827",
      background: "#111827",
      color: "#fff",
    };

    // show a small window of pages
    const windowSize = 7;
    const half = Math.floor(windowSize / 2);
    let pStart = Math.max(1, safePage - half);
    let pEnd = Math.min(totalPages, pStart + windowSize - 1);
    pStart = Math.max(1, pEnd - windowSize + 1);

    const pages: number[] = [];
    for (let p = pStart; p <= pEnd; p++) pages.push(p);

    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 12, borderTop: "1px solid #E5E7EB" }}>
        <div style={{ color: "#6b7280", fontWeight: 700 }}>
          Hóa đơn: <b>{totalInvoices}</b> • Hiển thị <b>{start}-{end}</b> (20 hóa đơn/trang)
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            style={safePage <= 1 ? btnDisabled : btnBase}
            disabled={safePage <= 1}
            onClick={() => setPage(1)}
          >
            «
          </button>
          <button
            style={safePage <= 1 ? btnDisabled : btnBase}
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹
          </button>

          {pages.map((p) => (
            <button key={p} style={p === safePage ? btnActive : btnBase} onClick={() => setPage(p)}>
              {p}
            </button>
          ))}

          <button
            style={safePage >= totalPages ? btnDisabled : btnBase}
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            ›
          </button>
          <button
            style={safePage >= totalPages ? btnDisabled : btnBase}
            disabled={safePage >= totalPages}
            onClick={() => setPage(totalPages)}
          >
            »
          </button>
        </div>
      </div>
    );
  }

  if (loadingRole) return <div style={{ padding: 16 }}>Đang kiểm tra đăng nhập…</div>;
  if (!role || role === "staff") return null;

  return (
    <div style={{ padding: 16 }}>
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ margin: 0 }}>Bảng kê bán hàng</h2>
          <div style={{ color: "#6b7280" }}>
            Theo dòng hàng (chỉ lấy HĐ <b>SALES</b> đã <b>DUYỆT</b>), giá vốn lấy từ snapshot unitCost/costTotal.
          </div>
        </div>

        <button style={ghostBtnStyle()} onClick={() => nav("/")}>
          ← Trang chủ
        </button>
      </div>

      {/* Filter Card */}
      <div style={{ marginTop: 14, border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, background: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr 1fr 1fr", gap: 12 }}>
          <div>
            <div style={labelStyle}>Từ ngày</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <div style={labelStyle}>Đến ngày</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <div style={labelStyle}>Tìm kiếm</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={inputStyle}
              placeholder="Số chứng từ / khách / sản phẩm..."
            />
          </div>

          <div>
            <div style={labelStyle}>NV sale</div>
            <select value={saleUserId} onChange={(e) => setSaleUserId(e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
              <option value="">-- Tất cả --</option>
              {staffs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Kỹ thuật</div>
            <select value={techUserId} onChange={(e) => setTechUserId(e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
              <option value="">-- Tất cả --</option>
              {staffs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Thanh toán</div>
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
              <option value="">-- Tất cả --</option>
              <option value="UNPAID">Chưa thanh toán</option>
              <option value="PARTIAL">Thanh toán 1 phần</option>
              <option value="PAID">Đã thanh toán</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <button style={primaryBtnStyle()} onClick={fetchReport} disabled={loading}>
              Lọc
            </button>
            <button style={ghostBtnStyle()} onClick={exportExcel} disabled={loading}>
              Export Excel
            </button>
          </div>

          <div style={{ gridColumn: "1 / -1", color: "#6b7280", fontSize: 12 }}>
            Highlight: <b>đỏ nhạt</b> = bán lỗ, <b>cam nhạt</b> = còn nợ. Phân trang: <b>20 hóa đơn/trang</b> (mỗi hóa đơn có thể nhiều dòng).
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        {[
          { k: "Doanh thu", v: formatMoney(data.totals.totalRevenue) },
          { k: "Giá vốn", v: formatMoney(data.totals.totalCost) },
          { k: "Lợi nhuận", v: formatMoney(profit) },
          { k: "Đã thu", v: formatMoney(data.totals.totalPaid) },
          { k: "Còn nợ", v: formatMoney(data.totals.totalDebt) },
        ].map((x) => (
          <div key={x.k} style={{ border: "1px solid #E5E7EB", borderRadius: 14, padding: 12, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 800 }}>{x.k}</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 4 }}>{x.v}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ marginTop: 12, border: "1px solid #E5E7EB", borderRadius: 14, background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900 }}>Danh sách</div>
          <div style={{ color: "#6b7280", fontWeight: 700 }}>
            {loading ? "Đang tải…" : `${visibleRows.length} dòng • ${totalInvoices} hóa đơn`}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1420 }}>
            <thead style={{ background: "#F9FAFB" }}>
              <tr>
                {[
                  "Ngày",
                  "Số chứng từ",
                  "Tên khách hàng",
                  "Tên sản phẩm",
                  "Đơn giá",
                  "Đơn giá vốn",
                  "Tiền vốn",
                  "Thành tiền",
                  "Lợi nhuận",
                  "Đã thanh toán",
                  "Còn nợ",
                  "NV sale",
                  "Kĩ thuật",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: ["Đơn giá", "Đơn giá vốn", "Tiền vốn", "Thành tiền", "Lợi nhuận", "Đã thanh toán", "Còn nợ"].includes(h)
                        ? "right"
                        : "left",
                      padding: 12,
                      borderBottom: "1px solid #E5E7EB",
                      whiteSpace: "nowrap",
                      fontSize: 13,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ padding: 16, color: "#6b7280" }}>
                    Không có dữ liệu.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r, i) => {
                  const lineProfit = Number(r.lineAmount || 0) - Number(r.costTotal || 0);
                  const profitStyle: React.CSSProperties =
                    lineProfit >= 0 ? { color: "#15803D", fontWeight: 900 } : { color: "#DC2626", fontWeight: 900 };

                  return (
                    <tr
                      key={`${r.code}-${i}`}
                      style={rowStyle(r, i)}
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                    >
                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                        {r.issueDate.split("-").reverse().join("/")}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap", fontWeight: 900 }}>
                        {r.code}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9" }}>{r.partnerName}</td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9" }}>
                        <div style={{ fontWeight: 900 }}>{r.itemName}</div>
                        {r.itemSku ? <div style={{ fontSize: 12, color: "#6b7280" }}>SKU: {r.itemSku}</div> : null}
                        <div style={{ fontSize: 12, color: "#6b7280" }}>SL: {formatMoney(r.qty)}</div>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        {formatMoney(r.unitPrice)}
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={moneyMuted}>{formatMoney(r.unitCost)}</span>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={moneyMuted}>{formatMoney(r.costTotal)}</span>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={moneyStrong}>{formatMoney(r.lineAmount)}</span>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={profitStyle}>{formatMoney(lineProfit)}</span>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={moneyPaid}>{formatMoney(r.paid)}</span>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={Number(r.debt || 0) > 0 ? moneyDebt : { color: "#111827", fontWeight: 800 }}>
                          {formatMoney(r.debt)}
                        </span>
                      </td>

                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9" }}>{r.saleUserName}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9" }}>{r.techUserName}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ✅ Pagination by invoice */}
        <Pagination />
      </div>
    </div>
  );
}
