// src/pages/RevenuePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type StaffRole = "SALE" | "TECH";
type GroupBy = "day" | "week" | "month";
type StaffMoneyMode = "GROSS" | "NET";

type Me = { id: string; username?: string; role?: string };

type StaffRow = {
  userId: string;
  name: string;
  revenue: number;
  collectedNormal?: number;
  collectedGross?: number;
  bonusWarranty?: number;
  cogs: number;
  profit: number;
  marginPct: number;
};

type RevenueResp = {
  kpis: {
    netRevenue: number;
    grossProfit: number;
    marginPct: number;
    orderCount: number;
    netVat?: number;
    netTotal?: number;
    netCollected?: number;
    netCogs?: number;
  };
  trend: Array<{ date: string; revenue: number; cogs: number; profit: number }>;
  byProduct: Array<{
    itemId: string;
    name: string;
    qty: number; // ✅ NEW
    revenue: number;
    cogs: number;
    profit: number;
    marginPct: number;
  }>;
  byStaff?: {
    sale: StaffRow[];
    tech: StaffRow[];
  };
};

type AccountOpt = { id: string; code: string; name: string };

function fmtVnd(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return Math.round(x).toLocaleString("vi-VN") + " đ";
}
function fmtPct(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return x.toFixed(1) + "%";
}
function fmtQty(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  // hiển thị gọn: nếu gần như integer -> int, còn lại 3 số lẻ
  const isInt = Math.abs(x - Math.round(x)) < 1e-9;
  return (isInt ? Math.round(x) : Math.round(x * 1000) / 1000).toLocaleString("vi-VN");
}
function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function shortDateLabel(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

const COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#8b5cf6", "#06b6d4", "#ef4444", "#64748b"];

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 999,
    border: active ? "1px solid #2563eb" : "1px solid #e2e8f0",
    background: active ? "#2563eb" : "#fff",
    color: active ? "#fff" : "#0f172a",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 16, background: "#f5f7fb", minHeight: "100vh" },
  container: { maxWidth: 1200, margin: "0 auto" },

  filterBar: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr 1fr 150px",
    gap: 12,
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  filterBlock: { display: "flex", gap: 8, alignItems: "center" },
  label: { fontSize: 12, color: "#64748b", minWidth: 88 },
  input: {
    height: 36,
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    padding: "0 10px",
    background: "#fff",
    width: "100%",
    outline: "none",
  },
  select: {
    height: 36,
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    padding: "0 10px",
    background: "#fff",
    width: "100%",
    outline: "none",
  },
  btn: {
    height: 36,
    borderRadius: 8,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 600,
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
    borderRadius: 10,
    padding: 14,
  },
  cardTitle: { fontSize: 13, color: "#0f172a", fontWeight: 700 },
  cardValue: { fontSize: 22, fontWeight: 800, marginTop: 6 },
  cardSub: { fontSize: 12, color: "#64748b", marginTop: 6 },

  panel: {
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
  },
  panelTitle: { fontSize: 14, fontWeight: 800, color: "#0f172a" },
  toggleWrap: { display: "flex", gap: 10, marginTop: 10 },

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 },

  table: { width: "100%", borderCollapse: "collapse", marginTop: 10 },
  th: {
    textAlign: "left",
    fontSize: 12,
    color: "#64748b",
    borderBottom: "1px solid #e6eaf2",
    padding: "10px 8px",
  },
  td: { borderBottom: "1px solid #eef2f7", padding: "10px 8px", fontSize: 13, color: "#0f172a" },

  right: { textAlign: "right" },
  green: { color: "#16a34a", fontWeight: 800 },
  red: { color: "#dc2626", fontWeight: 800 },
  muted: { color: "#64748b" },
  notice: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    fontSize: 13,
    fontWeight: 600,
  },
};

export default function RevenuePage() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [me, setMe] = useState<Me | null>(null);

  const [from, setFrom] = useState<string>(toYmd(first));
  const [to, setTo] = useState<string>(toYmd(last));

  const [staffRole, setStaffRole] = useState<StaffRole>("SALE");
  const [staffUserId, setStaffUserId] = useState<string>("");

  const [receiveAccountId, setReceiveAccountId] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [metric, setMetric] = useState<"revenue" | "profit">("revenue");

  const [staffMoneyMode, setStaffMoneyMode] = useState<StaffMoneyMode>("NET");

  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [data, setData] = useState<RevenueResp | null>(null);
  const [loading, setLoading] = useState(false);

  const roleNorm = String(me?.role || "").toLowerCase();
  const isStaff = roleNorm === "staff";

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

  async function loadDashboard(override?: Partial<{ staffRole: StaffRole; staffUserId: string }>) {
    setLoading(true);
    try {
      const forcedStaffUserId = override?.staffUserId ?? staffUserId;
      const forcedStaffRole = override?.staffRole ?? staffRole;

      const finalStaffUserId = isStaff ? (me?.id || "") : forcedStaffUserId;
      const finalStaffRoleParam = finalStaffUserId ? forcedStaffRole : undefined;

      const res = await api.get("/revenue/dashboard", {
        params: {
          from,
          to,
          groupBy,
          staffRole: finalStaffRoleParam,
          staffUserId: finalStaffUserId || undefined,
          receiveAccountId: receiveAccountId || undefined,
        },
      });
      setData((res as any).data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMe();
      await loadAccounts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isStaff && me?.id) {
      setStaffUserId(me.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, isStaff]);

  useEffect(() => {
    if (isStaff && !me?.id) return;
    loadDashboard({ staffRole, staffUserId: isStaff ? (me?.id || "") : staffUserId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const staffOptions = useMemo(() => {
    const s = data?.byStaff?.sale ?? [];
    const t = data?.byStaff?.tech ?? [];
    return {
      SALE: s.map((x) => ({ id: x.userId, name: x.name })),
      TECH: t.map((x) => ({ id: x.userId, name: x.name })),
    };
  }, [data]);

  const lineData = useMemo(() => {
    return (data?.trend ?? []).map((p) => ({ ...p, label: shortDateLabel(p.date) }));
  }, [data]);

  const pieProduct = useMemo(() => {
    const rows = (data?.byProduct ?? []).slice(0, 6);
    const other = (data?.byProduct ?? []).slice(6);
    const otherSum = other.reduce((s, r) => s + (r.revenue || 0), 0);
    const out = rows.map((r) => ({ name: r.name, value: r.revenue }));
    if (otherSum > 0) out.push({ name: "Khác", value: otherSum });
    return out;
  }, [data]);

  function staffValueNet(r: StaffRow) {
    const v = r.revenue ?? r.collectedNormal ?? 0;
    return Number(v) || 0;
  }
  function staffValueGross(r: StaffRow) {
    return Number(r.collectedGross ?? 0) || 0;
  }
  function staffValue(r: StaffRow) {
    return staffMoneyMode === "GROSS" ? staffValueGross(r) : staffValueNet(r);
  }

  const pieStaff = useMemo(() => {
    const rows = staffRole === "SALE" ? data?.byStaff?.sale ?? [] : data?.byStaff?.tech ?? [];
    const top = rows.slice(0, 6);
    const other = rows.slice(6);
    const otherSum = other.reduce((s, r) => s + staffValue(r), 0);

    const out = top.map((r) => ({ name: r.name, value: staffValue(r) }));
    if (otherSum > 0) out.push({ name: "Khác", value: otherSum });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, staffRole, staffMoneyMode]);

  const staffName = me?.username || "Tôi";
  const staffPieTooltipLabel = staffMoneyMode === "GROSS" ? "Đã thu (gồm VAT)" : "Doanh thu (chưa VAT)";

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
            <div style={styles.label}>{staffRole === "SALE" ? "Bán hàng" : "Kỹ thuật"}</div>

            {isStaff ? (
              <div style={{ display: "flex", gap: 8, width: "100%" }}>
                <select
                  style={styles.select}
                  value={staffRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as StaffRole;
                    setStaffRole(nextRole);
                    if (me?.id) setStaffUserId(me.id);
                  }}
                >
                  <option value="SALE">Bán hàng</option>
                  <option value="TECH">Kỹ thuật</option>
                </select>

                <input style={{ ...styles.input }} value={staffName} readOnly />
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, width: "100%" }}>
                <select
                  style={styles.select}
                  value={staffRole}
                  onChange={(e) => {
                    setStaffRole(e.target.value as StaffRole);
                    setStaffUserId("");
                  }}
                >
                  <option value="SALE">Bán hàng</option>
                  <option value="TECH">Kỹ thuật</option>
                </select>

                <select style={styles.select} value={staffUserId} onChange={(e) => setStaffUserId(e.target.value)}>
                  <option value="">Tất cả</option>
                  {(staffRole === "SALE" ? staffOptions.SALE : staffOptions.TECH).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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

          <button
            style={styles.btn}
            onClick={() => loadDashboard({ staffRole, staffUserId: isStaff ? (me?.id || "") : staffUserId })}
            disabled={loading || (isStaff && !me?.id)}
            title={isStaff && !me?.id ? "Chưa tải được thông tin user" : ""}
          >
            {loading ? "Đang tải..." : "Áp dụng"}
          </button>
        </div>

        {isStaff && (
          <div style={styles.notice}>
            Bạn đang đăng nhập <b>STAFF</b> nên chỉ xem được doanh thu của <b>{staffName}</b>.
          </div>
        )}

        {/* KPI CARDS */}
        <div style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>Doanh thu thuần (chưa VAT)</div>
            <div style={{ ...styles.cardValue, color: "#16a34a" }}>{fmtVnd(data?.kpis?.netRevenue ?? 0)}</div>
            <div style={styles.cardSub}>SALES (+) • SALES_RETURN (-)</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Lợi nhuận gộp</div>
            <div style={{ ...styles.cardValue, color: "#dc2626" }}>{fmtVnd(data?.kpis?.grossProfit ?? 0)}</div>
            <div style={styles.cardSub}>Giá vốn theo xuất kho</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Biên lợi nhuận</div>
            <div style={{ ...styles.cardValue, color: "#16a34a" }}>{fmtPct(data?.kpis?.marginPct ?? 0)}</div>
            <div style={styles.cardSub}>Lợi nhuận gộp / Doanh thu thuần</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Số đơn hàng</div>
            <div style={{ ...styles.cardValue, color: "#0f172a" }}>
              {(data?.kpis?.orderCount ?? 0).toLocaleString("vi-VN")} đơn
            </div>
            <div style={styles.cardSub}>Đã duyệt (APPROVED)</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Thuế (VAT)</div>
            <div style={{ ...styles.cardValue, color: "#0f172a" }}>{fmtVnd(data?.kpis?.netVat ?? 0)}</div>
            <div style={styles.cardSub}>Không cộng vào doanh thu thuần</div>
          </div>
        </div>

        {/* LINE CHART */}
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Doanh thu &amp; Lợi nhuận</div>

          <div style={styles.toggleWrap}>
            <div style={pillStyle(metric === "revenue")} onClick={() => setMetric("revenue")}>
              ✓ Doanh thu
            </div>
            <div style={pillStyle(metric === "profit")} onClick={() => setMetric("profit")}>
              ✓ Lợi nhuận
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={styles.muted}>Nhóm</span>
              <select
                style={{ ...styles.select, width: 140 }}
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              >
                <option value="day">Ngày</option>
                <option value="week">Tuần</option>
                <option value="month">Tháng</option>
              </select>
              <button
                style={{ ...styles.btn, width: 110 }}
                onClick={() => loadDashboard({ staffRole, staffUserId: isStaff ? (me?.id || "") : staffUserId })}
                disabled={loading || (isStaff && !me?.id)}
              >
                Làm mới
              </button>
            </div>
          </div>

          <div style={{ height: 320, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <XAxis dataKey="label" />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1_000_000)}M`} />
                <Tooltip formatter={(value: any, name: any) => [fmtVnd(Number(value)), name]} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Doanh thu"
                  stroke={metric === "revenue" ? "#2563eb" : "#93c5fd"}
                  strokeWidth={metric === "revenue" ? 3 : 2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="Lợi nhuận"
                  stroke={metric === "profit" ? "#f97316" : "#fdba74"}
                  strokeWidth={metric === "profit" ? 3 : 2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* PIE CHARTS */}
        <div style={styles.grid2}>
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Doanh thu theo sản phẩm</div>
            <div style={{ height: 260, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieProduct} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {pieProduct.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmtVnd(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {!isStaff ? (
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Doanh thu theo nhân viên</div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div
                  style={pillStyle(staffRole === "SALE")}
                  onClick={() => {
                    setStaffRole("SALE");
                    setStaffUserId("");
                  }}
                >
                  Bán hàng
                </div>
                <div
                  style={pillStyle(staffRole === "TECH")}
                  onClick={() => {
                    setStaffRole("TECH");
                    setStaffUserId("");
                  }}
                >
                  Kỹ thuật
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={styles.muted}>Hiển thị</span>

                  <div style={pillStyle(staffMoneyMode === "NET")} onClick={() => setStaffMoneyMode("NET")}>
                    Doanh thu (chưa VAT)
                  </div>

                  <div style={pillStyle(staffMoneyMode === "GROSS")} onClick={() => setStaffMoneyMode("GROSS")}>
                    Đã thu (gồm VAT)
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                {staffMoneyMode === "NET"
                  ? "NET = tiền thu quy đổi về chưa VAT (vd VAT 8%: gross/1.08)."
                  : "GROSS = tiền thực thu (có VAT)."}
              </div>

              <div style={{ height: 260, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieStaff} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {pieStaff.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtVnd(Number(v))} labelFormatter={() => staffPieTooltipLabel} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Doanh thu của tôi</div>
              <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                Bạn chỉ xem được dữ liệu của <b>{staffName}</b>. (Admin/Accountant sẽ thấy theo nhiều nhân viên.)
              </div>
            </div>
          )}
        </div>

        {/* TABLE */}
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Top sản phẩm bán chạy</div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Sản phẩm</th>
                <th style={{ ...styles.th, ...styles.right }}>Số lượng</th>
                <th style={{ ...styles.th, ...styles.right }}>Doanh thu</th>
                <th style={{ ...styles.th, ...styles.right }}>Giá vốn</th>
                <th style={{ ...styles.th, ...styles.right }}>Lợi nhuận gộp</th>
                <th style={{ ...styles.th, ...styles.right }}>% Lợi nhuận</th>
              </tr>
            </thead>
            <tbody>
              {(data?.byProduct ?? []).slice(0, 10).map((r) => (
                <tr key={r.itemId}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                  </td>
                  <td style={{ ...styles.td, ...styles.right }}>{fmtQty(r.qty ?? 0)}</td>
                  <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.revenue)}</td>
                  <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.cogs)}</td>
                  <td style={{ ...styles.td, ...styles.right }}>{fmtVnd(r.profit)}</td>
                  <td style={{ ...styles.td, ...styles.right, ...(r.marginPct >= 0 ? styles.green : styles.red) }}>
                    {fmtPct(r.marginPct)}
                  </td>
                </tr>
              ))}

              {!loading && (data?.byProduct?.length ?? 0) === 0 && (
                <tr>
                  <td style={styles.td} colSpan={6}>
                    <span style={styles.muted}>Không có dữ liệu trong khoảng thời gian này.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
