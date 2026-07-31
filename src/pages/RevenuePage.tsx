// src/pages/RevenuePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { exportRevenueExcel } from "../utils/revenueExcel";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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

type TrendPoint = {
  date: string;
  revenue: number;
  cogs: number;
  profit: number;
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
  trend?: TrendPoint[];
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

function fmtVndShort(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(x);
  if (abs >= 1_000_000_000) return (x / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + " tỷ";
  if (abs >= 1_000_000) return (x / 1_000_000).toFixed(1).replace(/\.0$/, "") + " tr";
  if (abs >= 1_000) return (x / 1_000).toFixed(0) + " k";
  return String(Math.round(x));
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

/** ✅ Kỳ so sánh = trọn THÁNG TRƯỚC tháng chứa "from" (giống logic prevMonthRange bên BE reportMailer) */
function prevCalendarMonthRange(fromStr: string, toStr: string) {
  const f = new Date(fromStr + "T00:00:00");
  const anchor = new Date(f.getFullYear(), f.getMonth() - 1, 1);
  const prevFrom = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const prevTo = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { prevFrom: toYmd(prevFrom), prevTo: toYmd(prevTo) };
}

/** ✅ % thay đổi so với kỳ trước. null = không đủ dữ liệu để so sánh (kỳ trước = 0/không có) */
function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function fmtAxisDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
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

/* ================= Icons (nhỏ gọn, không phụ thuộc thư viện ngoài) ================= */

function IconBase({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}
function IconWallet({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V17a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-9Z" />
      <path d="M19 10h1.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5H19" />
      <circle cx="16.5" cy="12.5" r="0.75" fill="currentColor" stroke="none" />
    </IconBase>
  );
}
function IconTrendUp({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M4 16l5-5 4 4 7-8" />
      <path d="M15 7h5v5" />
    </IconBase>
  );
}
function IconUndo({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </IconBase>
  );
}
function IconPercent({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M5 19 19 5" />
      <circle cx="7" cy="7" r="2.3" />
      <circle cx="17" cy="17" r="2.3" />
    </IconBase>
  );
}
function IconReceipt({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </IconBase>
  );
}

/* ================= KPI card ================= */

type KpiTone = "blue" | "emerald" | "rose" | "violet" | "slate";

const TONE_CLASSES: Record<KpiTone, { bar: string; icon: string; iconBg: string; value: string }> = {
  blue: { bar: "bg-blue-500", icon: "text-blue-600", iconBg: "bg-blue-50", value: "text-blue-700" },
  emerald: { bar: "bg-emerald-500", icon: "text-emerald-600", iconBg: "bg-emerald-50", value: "text-emerald-700" },
  rose: { bar: "bg-rose-500", icon: "text-rose-600", iconBg: "bg-rose-50", value: "text-rose-700" },
  violet: { bar: "bg-violet-500", icon: "text-violet-600", iconBg: "bg-violet-50", value: "text-violet-700" },
  slate: { bar: "bg-slate-500", icon: "text-slate-600", iconBg: "bg-slate-100", value: "text-slate-800" },
};

/* ================= Delta badge (so với tháng trước) ================= */

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="mt-1 block text-[11px] text-slate-400">— so với tháng trước</span>;
  }
  const up = pct >= 0;
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${
        up ? "text-emerald-600" : "text-rose-600"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% so với tháng trước
    </span>
  );
}

function KpiCard({
  tone,
  label,
  value,
  icon,
  delta,
}: {
  tone: KpiTone;
  label: string;
  value: string;
  icon: React.ReactNode;
  delta?: React.ReactNode;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5">
      <span className={`absolute left-0 top-0 h-full w-1 ${t.bar}`} />
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.iconBg} ${t.icon}`}>
          {icon}
        </span>
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className={`mt-2 text-xl font-bold tabular-nums ${t.value}`}>{value}</div>
      {delta}
    </div>
  );
}

/* ================= Trend chart tooltip ================= */

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const rev = payload.find((p: any) => p.dataKey === "revenue")?.value ?? 0;
  const cogs = payload.find((p: any) => p.dataKey === "cogs")?.value ?? 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-slate-700">{fmtAxisDate(label)}</div>
      <div className="mt-1 flex items-center gap-1.5 text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" /> Doanh thu: <b>{fmtVnd(rev)}</b>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-slate-500">
        <span className="h-2 w-2 rounded-full bg-slate-400" /> Giá vốn: <b>{fmtVnd(cogs)}</b>
      </div>
    </div>
  );
}

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
  const [prevData, setPrevData] = useState<RevenueResp | null>(null);
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
      const { prevFrom, prevTo } = prevCalendarMonthRange(from, to);

      const [res, prevRes] = await Promise.all([
        api.get("/revenue/dashboard", {
          params: {
            from,
            to,
            groupBy,
            receiveAccountId: receiveAccountId || undefined,
          },
        }),
        api
          .get("/revenue/dashboard", {
            params: {
              from: prevFrom,
              to: prevTo,
              groupBy,
              receiveAccountId: receiveAccountId || undefined,
            },
          })
          .catch((e) => {
            console.error("loadPrevDashboard error", e);
            return null;
          }),
      ]);

      setData((res as any).data);
      setPrevData(prevRes ? (prevRes as any).data : null);
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

  const maxTopRevenue = useMemo(() => Math.max(1, ...topProducts.map((p) => p.revenue)), [topProducts]);

  const staffName = me?.username || "Tôi";

  const collected = useMemo(() => pickCollectedGross(data?.kpis), [data]);
  const returnsNet = useMemo(() => pickReturnNet(data?.kpis), [data]);
  const trend = data?.trend ?? [];

  // ✅ dữ liệu KPI kỳ trước (cùng cách trích xuất với kỳ hiện tại)
  const prevCollected = useMemo(() => pickCollectedGross(prevData?.kpis), [prevData]);
  const prevReturnsNet = useMemo(() => pickReturnNet(prevData?.kpis), [prevData]);

  const kpiDeltas = useMemo(() => {
    return {
      collected: prevData ? pctChange(collected.value, prevCollected.value) : null,
      netRevenue: prevData ? pctChange(data?.kpis?.netRevenue ?? 0, prevData?.kpis?.netRevenue ?? 0) : null,
      returnsNet: prevData ? pctChange(returnsNet.value, prevReturnsNet.value) : null,
      netVat: prevData ? pctChange(data?.kpis?.netVat ?? 0, prevData?.kpis?.netVat ?? 0) : null,
      orderCount: prevData ? pctChange(data?.kpis?.orderCount ?? 0, prevData?.kpis?.orderCount ?? 0) : null,
    };
  }, [data, prevData, collected, returnsNet, prevCollected, prevReturnsNet]);

  // ✅ map doanh số NV kỳ trước theo userId, để so % cho từng NV ở bảng bên dưới
  const prevStaffMap = useMemo(() => {
    const rows = staffTab === "SALE" ? prevData?.byStaff?.sale ?? [] : prevData?.byStaff?.tech ?? [];
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.userId, Number(r.revenue) || 0);
    return m;
  }, [prevData, staffTab]);

  return (
    <div className="min-h-screen bg-[#f5f7fb] p-4">
      <div className="mx-auto max-w-[1200px] space-y-4">
        {/* Filter */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-lg font-semibold text-slate-800">Doanh thu</div>
          <div className="mt-1 text-xs text-slate-500">
            Tổng quan doanh thu, giá vốn, đã thu và doanh số theo nhân viên trong khoảng thời gian đã chọn.
          </div>

          <div className="mt-3 grid grid-cols-1 items-end gap-3 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <div className="mb-1 text-xs text-slate-500">Khoảng ngày</div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2"
                />
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="mb-1 text-xs text-slate-500">Tài khoản nhận</div>
              <select
                value={receiveAccountId}
                onChange={(e) => setReceiveAccountId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Tất cả</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 lg:col-span-2">
              <button
                onClick={loadDashboard}
                disabled={loading}
                className={`w-full rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 ${
                  loading ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                {loading ? "Đang tải..." : "Áp dụng"}
              </button>

              <button
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
                className={`w-full rounded border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50 ${
                  loading || !data ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                Xuất Excel
              </button>
            </div>
          </div>
        </div>

        {isStaff && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Bạn đang đăng nhập <b>STAFF</b> nên chỉ xem được dữ liệu của <b>{staffName}</b>.
          </div>
        )}

        {/* KPI CARDS */}
        <div className="text-[11px] text-slate-400">
          % so sánh được tính với trọn tháng dương lịch liền trước tháng chứa "Từ ngày" đang chọn.
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            tone="blue"
            label="Đã thu"
            value={fmtVnd(collected.value)}
            icon={<IconWallet className="h-4 w-4" />}
            delta={<DeltaBadge pct={kpiDeltas.collected} />}
          />
          <KpiCard
            tone="emerald"
            label="Doanh thu thuần (chưa VAT)"
            value={fmtVnd(data?.kpis?.netRevenue ?? 0)}
            icon={<IconTrendUp className="h-4 w-4" />}
            delta={<DeltaBadge pct={kpiDeltas.netRevenue} />}
          />
          <KpiCard
            tone="rose"
            label="Tiền hàng hoàn"
            value={fmtVnd(returnsNet.value)}
            icon={<IconUndo className="h-4 w-4" />}
            delta={<DeltaBadge pct={kpiDeltas.returnsNet} />}
          />
          <KpiCard
            tone="slate"
            label="VAT"
            value={fmtVnd(data?.kpis?.netVat ?? 0)}
            icon={<IconPercent className="h-4 w-4" />}
            delta={<DeltaBadge pct={kpiDeltas.netVat} />}
          />
          <KpiCard
            tone="violet"
            label="Số hoá đơn"
            value={(data?.kpis?.orderCount ?? 0).toLocaleString("vi-VN")}
            icon={<IconReceipt className="h-4 w-4" />}
            delta={<DeltaBadge pct={kpiDeltas.orderCount} />}
          />
        </div>

        {/* TREND CHART */}
        {trend.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-800">Doanh thu &amp; giá vốn theo ngày</div>
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cogsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#eef2f7" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtAxisDate}
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtVndShort(Number(v))}
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Area type="monotone" dataKey="cogs" stroke="#94a3b8" strokeWidth={2} fill="url(#cogsFill)" />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#revFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Doanh thu
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400" /> Giá vốn
              </span>
            </div>
          </div>
        )}

        {/* STAFF TABLE */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-800">Doanh số theo nhân viên</div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                Số NV: {staffSummary.count}
              </span>
              <button
                onClick={loadDashboard}
                disabled={loading}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Làm mới
              </button>
            </div>
          </div>

          <div className="mt-1 text-[11px] text-slate-400">
            Tính theo ngày thu đủ tiền (ds_date), có thể lệch kỳ so với "Doanh thu thuần" ở trên (tính theo ngày hóa đơn).
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setStaffTab("SALE")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                staffTab === "SALE"
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              NV sale
            </button>
            <button
              onClick={() => setStaffTab("TECH")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                staffTab === "TECH"
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              NV kỹ thuật
            </button>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3">Nhân viên</th>
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                      Doanh số (NET)
                    </th>
                    <th className="sticky top-0 z-10 w-32 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((r) => {
                    const prevRevenue = prevStaffMap.get(r.userId);
                    const staffPct = prevData ? (prevRevenue !== undefined ? pctChange(Number(r.revenue) || 0, prevRevenue) : null) : null;
                    const isNewStaff = prevData && prevRevenue === undefined;
                    return (
                      <tr key={r.userId} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">{r.name}</td>
                        <td className="border-b border-slate-100 px-4 py-3 text-right">
                          <div className="font-semibold tabular-nums">{fmtVnd(Number(r.revenue || 0))}</div>
                          {isNewStaff ? (
                            <span className="text-[11px] text-slate-400">Chưa có DS tháng trước</span>
                          ) : (
                            <DeltaBadge pct={staffPct} />
                          )}
                        </td>
                        <td className="border-b border-slate-100 px-4 py-3 text-right">
                          <button
                            className="rounded border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
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
                    );
                  })}

                  {!loading && staffRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-slate-500" colSpan={3}>
                        Không có dữ liệu trong khoảng thời gian này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* TOP PRODUCTS */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-800">Top sản phẩm bán chạy</div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3">Sản phẩm</th>
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">Số lượng</th>
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">Giá bán</th>
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                      Đơn giá vốn TB
                    </th>
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">Doanh thu</th>
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">Giá vốn</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((r) => (
                    <tr key={r.itemId} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="font-semibold text-slate-800">{r.name}</div>
                        {/* thanh tỉ trọng doanh thu so với SP top đầu, chỉ mang tính trực quan */}
                        <div className="mt-1.5 h-1 w-32 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-400"
                            style={{ width: `${Math.max(4, (r.revenue / maxTopRevenue) * 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">{fmtQty(r.qty)}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                        {fmtVnd((r as any).avgSell || 0)}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                        {fmtVnd((r as any).avgCost || 0)}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold tabular-nums">
                        {fmtVnd(r.revenue)}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">{fmtVnd(r.cogs)}</td>
                    </tr>
                  ))}

                  {!loading && topProducts.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-slate-500" colSpan={6}>
                        Không có dữ liệu trong khoảng thời gian này.
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpenStaffModal(false);
            }}
          >
            <div className="absolute inset-0 bg-black/45" />
            <div className="relative flex max-h-[85vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <div className="text-base font-semibold text-slate-800">
                    Lịch sử hoá đơn — NV {staffModalRole === "SALE" ? "sale" : "kỹ thuật"}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    <b>{staffModalName}</b> • {from} → {to}
                  </div>
                </div>

                <button
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white font-bold hover:bg-slate-50"
                  onClick={() => setOpenStaffModal(false)}
                  title="Đóng"
                >
                  ✕
                </button>
              </div>

              <div className="overflow-auto p-4">
                {staffInvErr && (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
                    {staffInvErr}
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="max-h-[55vh] overflow-auto">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left">
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3">Mã HĐ</th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3">Ngày</th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3">Khách</th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                            Tiền hàng
                          </th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">Thuế</th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                            Tổng hóa đơn
                          </th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                            Đã thu
                          </th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3">Ngày tính DS</th>
                          <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-right">
                            Doanh số
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffInvLoading ? (
                          <tr>
                            <td className="px-4 py-8 text-slate-500" colSpan={9}>
                              Đang tải...
                            </td>
                          </tr>
                        ) : (
                          <>
                            {staffInvoices.map((r, idx) => (
                              <tr key={(r.invoiceId || r.code || "") + ":" + idx} className="hover:bg-slate-50">
                                <td className="border-b border-slate-100 px-4 py-3 font-semibold">{r.code || "-"}</td>
                                <td className="border-b border-slate-100 px-4 py-3">{r.issueDate || "-"}</td>
                                <td className="border-b border-slate-100 px-4 py-3">{r.partnerName || "-"}</td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                                  {fmtVnd(r.net || 0)}
                                </td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                                  {fmtVnd(r.vat || 0)}
                                </td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                                  {fmtVnd(r.gross || 0)}
                                </td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                                  {fmtVnd(r.collectedNormal || 0)}
                                </td>
                                <td className="border-b border-slate-100 px-4 py-3">
                                  {r.dsDate ? String(r.dsDate) : "-"}
                                </td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold tabular-nums">
                                  {fmtVnd(r.dsNet || 0)}
                                </td>
                              </tr>
                            ))}

                            {!staffInvLoading && staffInvoices.length === 0 && (
                              <tr>
                                <td className="px-4 py-8 text-slate-500" colSpan={9}>
                                  Không có hoá đơn trong khoảng lọc.
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

              <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
                <button
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setOpenStaffModal(false)}
                >
                  Đóng
                </button>
                <button
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
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