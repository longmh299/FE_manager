// src/pages/RevenuePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { exportRevenueExcel } from "../utils/revenueExcel";

type StaffTab = "SALE" | "TECH";
type GroupBy = "day" | "week" | "month";

type Me = { id: string; username?: string; role?: string };

type StaffRow = {
  userId: string;
  name: string;
  revenue: number; // NET
  collectedNormal?: number;
  collectedGross?: number;
  bonusWarranty?: number; // backend có thể trả, FE bỏ hiển thị
  cogs: number;
  profit: number;
  marginPct: number;
};

type StaffInvoiceRow = {
  invoiceId: string;
  code: string;
  issueDate: string;
  partnerName: string;

  net: number;
  vat: number;
  gross: number;

  need: number;
  collectedNormal: number;

  dsDate: string | null;
  dsNet: number;
};

type RevenueResp = {
  kpis: {
    netRevenue: number;
    grossProfit: number;
    marginPct: number;
    orderCount: number;

    // backend cũ
    netVat?: number;
    netTotal?: number;
    netCollected?: number;
    netCogs?: number;

    // ✅ hỗ trợ backend trả "đã thu" theo gross (không quy đổi)
    grossCollected?: number;
    collectedGross?: number;
    collectedTotal?: number;
    paidTotal?: number;
    paidGross?: number;
    totalCollected?: number;

    // ✅ backend mới (đã tách SALES vs RETURN)
    salesNet?: number;
    salesVat?: number;
    salesGross?: number;
    salesCollectedNet?: number;

    returnNet?: number;
    returnVat?: number;
    returnGross?: number;
    returnCollectedNet?: number;
  };
  byProduct: Array<{
    itemId: string;
    name: string;
    qty: number;
    revenue: number;
    cogs: number;
    profit: number;
    marginPct: number;
  }>;
  byStaff?: {
    sale: StaffRow[];
    tech: StaffRow[];
  };
  staffInvoices?: any[]; // backend có thể trả key khác nhau => mình normalize
};

type AccountOpt = { id: string; code: string; name: string };

function num(x: any): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function fmtVnd(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return Math.round(x).toLocaleString("vi-VN") + " đ";
}

function fmtQty(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  const isInt = Math.abs(x - Math.round(x)) < 1e-9;
  return (isInt ? Math.round(x) : Math.round(x * 1000) / 1000).toLocaleString("vi-VN");
}

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isUnknownStaffRow(r: StaffRow) {
  const uid = String(r?.userId || "");
  const name = String(r?.name || "").trim().toLowerCase();
  if (!uid) return true;
  if (uid.startsWith("__NAME__:")) return true;
  if (name === "unknown") return true;
  return false;
}

function hasOwn(o: any, k: string) {
  return !!o && Object.prototype.hasOwnProperty.call(o, k);
}

/**
 * ✅ Lấy "đã thu" theo tiền THỰC THU (GROSS) nếu backend có trả.
 * Nếu backend chưa trả grossCollected => fallback netCollected.
 */
function pickCollectedGross(kpis: any): { value: number; usedFallbackNet: boolean; usedKey: string | null } {
  if (!kpis) return { value: 0, usedFallbackNet: false, usedKey: null };

  const grossKeys = ["grossCollected", "collectedGross", "collectedTotal", "paidTotal", "paidGross", "totalCollected"];

  for (const k of grossKeys) {
    if (hasOwn(kpis, k)) {
      return { value: num(kpis[k]), usedFallbackNet: false, usedKey: k };
    }
  }

  if (hasOwn(kpis, "netCollected")) {
    return { value: num(kpis.netCollected), usedFallbackNet: true, usedKey: "netCollected" };
  }

  return { value: 0, usedFallbackNet: false, usedKey: null };
}

/**
 * ✅ Tiền hàng hoàn (NET, chưa VAT) - ưu tiên backend mới trả returnNet.
 * Fallback: suy ra từ salesNet & netRevenue.
 */
function pickReturnNet(kpis: any): { value: number; usedFallback: boolean; usedKey: string | null } {
  if (!kpis) return { value: 0, usedFallback: false, usedKey: null };

  if (hasOwn(kpis, "returnNet")) {
    return { value: num(kpis.returnNet), usedFallback: false, usedKey: "returnNet" };
  }

  // returnNet ≈ salesNet - netRevenue (vì netRevenue = salesNet - returnNet)
  if (hasOwn(kpis, "salesNet") && hasOwn(kpis, "netRevenue")) {
    const v = num(kpis.salesNet) - num(kpis.netRevenue);
    return { value: Math.max(0, v), usedFallback: true, usedKey: "salesNet-netRevenue" };
  }

  return { value: 0, usedFallback: false, usedKey: null };
}

// normalize staffInvoices row để tránh lỗi field mismatch (vd collected_normal, paidAmount...)
function normalizeStaffInvoiceRow(x: any): StaffInvoiceRow {
  const invoiceId = String(x?.invoiceId ?? x?.id ?? "");
  const code = String(x?.code ?? x?.invoiceCode ?? x?.invCode ?? "");
  const issueDate = String(x?.issueDate ?? x?.issue_date ?? x?.approvedDate ?? x?.approved_at ?? "");
  const partnerName = String(x?.partnerName ?? x?.customerName ?? x?.partner ?? "");

  const net = num(x?.net ?? x?.subtotalNet ?? x?.subtotal_net ?? x?.subtotal ?? x?.netTotal ?? x?.net_total);
  const vat = num(x?.vat ?? x?.tax ?? x?.tax_raw ?? x?.vatAmount ?? x?.vat_amount);
  const gross = num(x?.gross ?? x?.total ?? x?.grossTotal ?? x?.gross_total);

  const need = num(x?.need ?? x?.needGross ?? x?.need_gross);

  const collectedNormal = num(
    x?.collectedNormal ??
      x?.collected_normal ??
      x?.paidNormal ??
      x?.paid_normal ??
      x?.paidAmount ??
      x?.paid_amount ??
      x?.normalGross ??
      x?.normal_gross
  );

  const dsDate = (x?.dsDate ?? x?.ds_date ?? x?.hitDate ?? x?.hit_date ?? null) as string | null;
  const dsNet = num(x?.dsNet ?? x?.ds_net ?? x?.personalNet ?? x?.personal_net ?? x?.revenueNet ?? x?.revenue_net);

  return {
    invoiceId,
    code,
    issueDate,
    partnerName,
    net,
    vat,
    gross,
    need,
    collectedNormal,
    dsDate: dsDate ? String(dsDate) : null,
    dsNet,
  };
}

const segBtn = (active: boolean): React.CSSProperties => ({
  padding: "7px 12px",
  borderRadius: 999,
  border: active ? "1px solid #2563eb" : "1px solid #e2e8f0",
  background: active ? "#eff6ff" : "#fff",
  color: active ? "#1d4ed8" : "#0f172a",
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
});

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 16, background: "#f5f7fb", minHeight: "100vh" },
  container: { maxWidth: 1200, margin: "0 auto" },

  filterBar: {
    display: "grid",
    gridTemplateColumns: "1.3fr 1.2fr 140px 140px",
    gap: 12,
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  filterBlock: { display: "flex", gap: 10, alignItems: "center" },
  label: { fontSize: 12, color: "#64748b", minWidth: 88 },
  input: {
    height: 36,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    padding: "0 10px",
    background: "#fff",
    width: "100%",
    outline: "none",
  },
  select: {
    height: 36,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    padding: "0 10px",
    background: "#fff",
    width: "100%",
    outline: "none",
  },
  btn: {
    height: 36,
    borderRadius: 10,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnLight: {
    height: 36,
    borderRadius: 10,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 900,
    cursor: "pointer",
  },

  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 12,
    marginTop: 12,
  },
  card: {
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 12,
    padding: 14,
  },
  cardTitle: { fontSize: 13, color: "#0f172a", fontWeight: 800 },
  cardValue: { fontSize: 22, fontWeight: 900, marginTop: 6 },

  panel: {
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  panelTitle: { fontSize: 14, fontWeight: 900, color: "#0f172a" },

  muted: { color: "#64748b" },
  right: { textAlign: "right" },

  table: { width: "100%", borderCollapse: "collapse", marginTop: 10 },
  th: {
    textAlign: "left",
    fontSize: 12,
    color: "#64748b",
    borderBottom: "1px solid #e6eaf2",
    padding: "10px 8px",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    padding: "10px 8px",
    fontSize: 13,
    color: "#0f172a",
    verticalAlign: "top",
  },

  ghostBtn: {
    height: 34,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#0f172a",
    fontWeight: 900,
    cursor: "pointer",
    padding: "0 12px",
  },

  pillPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  stickyHeaderWrap: {
    border: "1px solid #eef2f7",
    borderRadius: 12,
    overflow: "hidden",
  },
  stickyHeaderTableWrap: {
    overflow: "auto",
    maxHeight: 420,
  },
  stickyTh: {
    position: "sticky",
    top: 0,
    background: "#fff",
    zIndex: 1,
  },

  // Modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "min(1100px, 96vw)",
    maxHeight: "85vh",
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #e6eaf2",
    boxShadow: "0 20px 60px rgba(2,6,23,0.25)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  modalHead: {
    padding: "12px 14px",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  modalTitle: { fontSize: 14, fontWeight: 900, color: "#0f172a" },
  modalBody: { padding: 14, overflow: "auto" },
  modalFoot: {
    padding: 12,
    borderTop: "1px solid #eef2f7",
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  iconBtn: {
    marginLeft: "auto",
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
};

export default function RevenuePage() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [me, setMe] = useState<Me | null>(null);

  const [from, setFrom] = useState<string>(toYmd(first));
  const [to, setTo] = useState<string>(toYmd(last));
  const [receiveAccountId, setReceiveAccountId] = useState<string>("");

  // chart bỏ rồi, nhưng backend đang nhận param -> giữ day để khỏi động
  const groupBy: GroupBy = "day";

  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [data, setData] = useState<RevenueResp | null>(null);
  const [loading, setLoading] = useState(false);

  const roleNorm = String(me?.role || "").toLowerCase();
  const isStaff = roleNorm === "staff";

  const [staffTab, setStaffTab] = useState<StaffTab>("SALE");

  // Modal LS hoá đơn NV
  const [openStaffModal, setOpenStaffModal] = useState(false);
  const [staffModalName, setStaffModalName] = useState<string>("");
  const [staffModalUserId, setStaffModalUserId] = useState<string>("");
  const [staffModalRole, setStaffModalRole] = useState<StaffTab>("SALE");
  const [staffInvoices, setStaffInvoices] = useState<StaffInvoiceRow[]>([]);
  const [staffInvLoading, setStaffInvLoading] = useState(false);
  const [staffInvErr, setStaffInvErr] = useState<string>("");

  async function loadMe() {
    try {
      const res = await api.get("/auth/me", { params: { t: Date.now() } });
      const u = (res as any)?.data;
      const next: Me = {
        id: String(u?.id || ""),
        username: u?.username,
        role: u?.role,
      };
      if (next.id) setMe(next);
    } catch (e) {
      console.error("loadMe error", e);
      setMe(null);
    }
  }

  async function loadAccounts() {
    try {
      const res = await api.get("/payment-accounts", { params: { active: 1 } });
      const body = (res as any)?.data;
      const raw = body?.data?.items ?? body?.items ?? body?.data ?? body;
      const rows = Array.isArray(raw) ? raw : [];
      setAccounts(
        rows
          .map((r: any) => ({ id: String(r.id), code: String(r.code || ""), name: String(r.name || "") }))
          .filter((x: any) => x.id && x.code)
      );
    } catch (e) {
      console.error("loadAccounts error", e);
      setAccounts([]);
    }
  }

  async function loadDashboard() {
    setLoading(true);
    try {
      const res = await api.get("/revenue/dashboard", {
        params: {
          from,
          to,
          groupBy,
          receiveAccountId: receiveAccountId || undefined,
        },
      });
      setData((res as any).data);
    } finally {
      setLoading(false);
    }
  }

  function buildAccountLabel() {
    if (!receiveAccountId) return "Tất cả";
    const found = accounts.find((a) => a.id === receiveAccountId);
    if (found) return `${found.code} - ${found.name}`;
    return receiveAccountId;
  }

  // ✅ Popup: gọi dashboard includeStaffInvoices=1 (đúng route hiện tại)
  async function loadStaffInvoices(params: { staffRole: StaffTab; staffUserId: string }) {
    setStaffInvLoading(true);
    setStaffInvErr("");
    setStaffInvoices([]);
    try {
      const res = await api.get("/revenue/dashboard", {
        params: {
          from,
          to,
          groupBy,
          receiveAccountId: receiveAccountId || undefined,
          staffRole: params.staffRole,
          staffUserId: params.staffUserId,
          includeStaffInvoices: 1,
        },
      });

      const body: RevenueResp = (res as any)?.data;
      const rows = (body as any)?.staffInvoices;

      if (!Array.isArray(rows)) {
        setStaffInvErr("Backend chưa trả staffInvoices (includeStaffInvoices=1). Kiểm tra revenue.service.ts.");
        setStaffInvoices([]);
        return;
      }

      const normalized = rows.map(normalizeStaffInvoiceRow);
      setStaffInvoices(normalized);
    } catch (e: any) {
      console.error("loadStaffInvoices error", e);
      setStaffInvErr(e?.response?.data?.message || e?.message || "Không tải được lịch sử hoá đơn.");
      setStaffInvoices([]);
    } finally {
      setStaffInvLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMe();
      await loadAccounts();
      await loadDashboard();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const staffRows = useMemo(() => {
    const sale = data?.byStaff?.sale ?? [];
    const tech = data?.byStaff?.tech ?? [];
    const rows = staffTab === "SALE" ? sale : tech;

    // ✅ ẩn Unknown/__NAME__:
    return rows.filter((r) => !isUnknownStaffRow(r));
  }, [data, staffTab]);

  const staffSummary = useMemo(() => {
    const rows = staffRows || [];
    const count = rows.length;
    const total = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
    const normal = rows.reduce((s, r) => s + (Number(r.collectedNormal) || 0), 0);
    return { count, total, normal };
  }, [staffRows]);

  const topProducts = useMemo(() => {
    const rows = data?.byProduct ?? [];
    return rows.slice(0, 10).map((r) => {
      const qty = Number(r.qty || 0) || 0;
      const revenue = Number(r.revenue || 0) || 0;
      const cogs = Number(r.cogs || 0) || 0;
      return {
        ...r,
        qty,
        avgSell: qty > 0 ? revenue / qty : 0,
        avgCost: qty > 0 ? cogs / qty : 0,
      };
    });
  }, [data]);

  const staffName = me?.username || "Tôi";

  const collected = useMemo(() => pickCollectedGross(data?.kpis), [data]);
  const returnsNet = useMemo(() => pickReturnNet(data?.kpis), [data]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* FILTER BAR */}
        <div style={styles.filterBar}>
          <div style={styles.filterBlock}>
            <div style={styles.label}>Khoảng ngày</div>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <input style={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input style={styles.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div style={styles.filterBlock}>
            <div style={styles.label}>Tài khoản</div>
            <select style={styles.select} value={receiveAccountId} onChange={(e) => setReceiveAccountId(e.target.value)}>
              <option value="">Tất cả</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </select>
          </div>

          <button style={styles.btn} onClick={loadDashboard} disabled={loading}>
            {loading ? "Đang tải..." : "Áp dụng"}
          </button>

          <button
            style={styles.btnLight}
            disabled={loading || !data}
            title={!data ? "Chưa có dữ liệu để xuất" : ""}
            onClick={() => {
              if (!data) return;
              exportRevenueExcel({
                data,
                from,
                to,
                accountLabel: buildAccountLabel(),
              });
            }}
          >
            Xuất Excel
          </button>
        </div>

        {isStaff && (
          <div style={{ ...styles.panel, marginTop: 10, padding: 12 }}>
            <div style={{ ...styles.muted, fontSize: 13 }}>
              Bạn đang đăng nhập <b>STAFF</b> nên chỉ xem được dữ liệu của <b>{staffName}</b>.
            </div>
          </div>
        )}

        {/* KPI CARDS */}
        <div style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>Đã thu</div>
            <div style={{ ...styles.cardValue, color: "#2563eb" }}>{fmtVnd(collected.value)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Doanh thu thuần (chưa VAT)</div>
            <div style={{ ...styles.cardValue, color: "#16a34a" }}>{fmtVnd(data?.kpis?.netRevenue ?? 0)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Tiền hàng hoàn</div>
            <div style={{ ...styles.cardValue, color: "#dc2626" }}>{fmtVnd(returnsNet.value)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>VAT</div>
            <div style={{ ...styles.cardValue, color: "#0f172a" }}>{fmtVnd(data?.kpis?.netVat ?? 0)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Số hoá đơn</div>
            <div style={{ ...styles.cardValue, color: "#0f172a" }}>
              {(data?.kpis?.orderCount ?? 0).toLocaleString("vi-VN")}
            </div>
          </div>
        </div>

        {/* STAFF TABLE */}
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Doanh số theo nhân viên </div>

          {/* <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            Quy tắc: NV chỉ tính <b>NET (không VAT)</b>. Nếu hoá đơn có hold bảo hành thì chỉ cần thu đủ phần có thể thu (
            <b>need = gross - hold</b>) là được tính doanh số. (Ẩn toàn bộ breakdown “bonus”.)
          </div> */}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={segBtn(staffTab === "SALE")} onClick={() => setStaffTab("SALE")}>
                NV sale
              </div>
              <div style={segBtn(staffTab === "TECH")} onClick={() => setStaffTab("TECH")}>
                NV kỹ thuật
              </div>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={styles.pillPrimary}>
                Số NV: <b>{staffSummary.count}</b>
              </span>
              {/* <span style={styles.pillPrimary}>
                Tổng doanh số (NET): <b>{fmtVnd(staffSummary.total)}</b>
              </span>
              <span style={styles.pillPrimary}>
                NORMAL (NET): <b>{fmtVnd(staffSummary.normal)}</b>
              </span> */}

              <button style={styles.ghostBtn} onClick={loadDashboard} disabled={loading}>
                Làm mới
              </button>
            </div>
          </div>

          <div style={{ ...styles.stickyHeaderWrap, marginTop: 10 }}>
            <div style={styles.stickyHeaderTableWrap}>
              <table style={{ ...styles.table, marginTop: 0 }}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, ...styles.stickyTh }}>Nhân viên</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Doanh số (NET)</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh, width: 120 }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((r) => (
                    <tr key={r.userId}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 900 }}>{r.name}</div>
                      </td>
                      <td style={{ ...styles.td, ...styles.right, fontWeight: 900 }}>{fmtVnd(Number(r.revenue || 0))}</td>
                      <td style={{ ...styles.td, ...styles.right }}>
                        <button
                          style={{
                            height: 32,
                            padding: "0 12px",
                            borderRadius: 10,
                            border: "1px solid #bfdbfe",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            cursor: "pointer",
                            fontWeight: 900,
                          }}
                          onClick={async () => {
                            setStaffModalName(r.name);
                            setStaffModalUserId(r.userId);
                            setStaffModalRole(staffTab);
                            setOpenStaffModal(true);
                            await loadStaffInvoices({ staffRole: staffTab, staffUserId: r.userId });
                          }}
                        >
                          Xem HĐ
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!loading && staffRows.length === 0 && (
                    <tr>
                      <td style={styles.td} colSpan={3}>
                        <span style={styles.muted}>Không có dữ liệu trong khoảng thời gian này.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* TOP PRODUCTS */}
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Top sản phẩm bán chạy</div>
          {/* <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
            Hiển thị theo doanh thu (NET theo InvoiceLine.amount). <b>Giá bán</b> = doanh thu/qty, giá vốn TB = giá vốn/qty
            (nếu có qty).
          </div> */}

          <div style={{ ...styles.stickyHeaderWrap, marginTop: 10 }}>
            <div style={styles.stickyHeaderTableWrap}>
              <table style={{ ...styles.table, marginTop: 0 }}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, ...styles.stickyTh }}>Sản phẩm</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Số lượng</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Giá bán</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Đơn giá vốn TB</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Doanh thu</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Giá vốn</th>
                    {/* <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Lợi nhuận gộp</th>
                    <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>% LN</th> */}
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((r) => (
                    <tr key={r.itemId}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 900 }}>{r.name}</div>
                      </td>
                      <td style={{ ...styles.td, ...styles.right }}>{fmtQty(r.qty)}</td>
                      <td style={{ ...styles.td, ...styles.right }}>{fmtVnd((r as any).avgSell || 0)}</td>
                      <td style={{ ...styles.td, ...styles.right }}>{fmtVnd((r as any).avgCost || 0)}</td>
                      <td style={{ ...styles.td, ...styles.right, fontWeight: 900 }}>{fmtVnd(r.revenue)}</td>
                      <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.cogs)}</td>
                      {/* <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.profit)}</td>
                      <td
                        style={{
                          ...styles.td,
                          ...styles.right,
                          fontWeight: 900,
                          color: r.marginPct >= 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {Number(r.marginPct || 0).toFixed(1)}%
                      </td> */}
                    </tr>
                  ))}

                  {!loading && topProducts.length === 0 && (
                    <tr>
                      <td style={styles.td} colSpan={8}>
                        <span style={styles.muted}>Không có dữ liệu trong khoảng thời gian này.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* MODAL: staff invoices */}
        {openStaffModal && (
          <div
            style={styles.modalOverlay}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpenStaffModal(false);
            }}
          >
            <div style={styles.modalCard}>
              <div style={styles.modalHead}>
                <div>
                  <div style={styles.modalTitle}>Lịch sử hoá đơn — NV {staffModalRole === "SALE" ? "sale" : "kỹ thuật"}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    <b>{staffModalName}</b> • {from} → {to}
                  </div>
                </div>

                <button style={styles.iconBtn} onClick={() => setOpenStaffModal(false)} title="Đóng">
                  ✕
                </button>
              </div>

              <div style={styles.modalBody}>
                {/* <div style={{ ...styles.pillPrimary, marginBottom: 10 }}>
                  Đã ẩn breakdown <b>bonus/hold</b> theo yêu cầu. Cột <b>Need</b> = phần cần thu để được tính doanh số.
                </div> */}

                {staffInvErr && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #fecaca",
                      background: "#fef2f2",
                      color: "#991b1b",
                      fontSize: 13,
                      fontWeight: 900,
                      marginBottom: 10,
                    }}
                  >
                    {staffInvErr}
                  </div>
                )}

                <div style={styles.stickyHeaderWrap}>
                  <div style={styles.stickyHeaderTableWrap}>
                    <table style={{ ...styles.table, marginTop: 0, minWidth: 980 }}>
                      <thead>
                        <tr>
                          <th style={{ ...styles.th, ...styles.stickyTh }}>Mã HĐ</th>
                          <th style={{ ...styles.th, ...styles.stickyTh }}>Ngày</th>
                          <th style={{ ...styles.th, ...styles.stickyTh }}>Khách</th>
                          <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Tiền hàng</th>
                          <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Thuế</th>
                          <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Tổng hóa đơn</th>
                          {/* <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Còn phải thu</th> */}
                          <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Đã thu</th>
                          <th style={{ ...styles.th, ...styles.stickyTh }}>Ngày tính DS</th>
                          <th style={{ ...styles.th, ...styles.right, ...styles.stickyTh }}>Doanh số</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffInvLoading ? (
                          <tr>
                            <td style={styles.td} colSpan={10}>
                              <span style={styles.muted}>Đang tải...</span>
                            </td>
                          </tr>
                        ) : (
                          <>
                            {staffInvoices.map((r, idx) => (
                              <tr key={(r.invoiceId || r.code || "") + ":" + idx}>
                                <td style={{ ...styles.td, fontWeight: 900 }}>{r.code || "-"}</td>
                                <td style={styles.td}>{r.issueDate || "-"}</td>
                                <td style={styles.td}>{r.partnerName || "-"}</td>
                                <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.net || 0)}</td>
                                <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.vat || 0)}</td>
                                <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.gross || 0)}</td>
                                {/* <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.need || 0)}</td> */}
                                <td style={{ ...styles.td, ...styles.right, fontWeight: 900 }}>{fmtVnd(r.collectedNormal || 0)}</td>
                                <td style={styles.td}>{r.dsDate ? String(r.dsDate) : "-"}</td>
                                <td style={{ ...styles.td, ...styles.right, fontWeight: 900 }}>{fmtVnd(r.dsNet || 0)}</td>
                              </tr>
                            ))}

                            {!staffInvLoading && staffInvoices.length === 0 && (
                              <tr>
                                <td style={styles.td} colSpan={10}>
                                  <span style={styles.muted}>Không có hoá đơn trong khoảng lọc.</span>
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div style={styles.modalFoot}>
                <button style={styles.ghostBtn} onClick={() => setOpenStaffModal(false)}>
                  Đóng
                </button>
                <button
                  style={{ ...styles.btn, width: 120 }}
                  onClick={() => loadStaffInvoices({ staffRole: staffModalRole, staffUserId: staffModalUserId })}
                  disabled={staffInvLoading}
                >
                  Làm mới
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
