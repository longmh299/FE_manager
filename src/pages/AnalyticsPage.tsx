// src/pages/AnalyticsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { fetchAnalyticsOverview, type AnalyticsOverview } from "../api/analytics";
import { ToastHost, useToast } from "../components/Toast";

/* ======================= Helpers ======================= */

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function daysAgoYmd(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function fmtInt(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function fmtPct(n: number) {
  return `${Number(n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

function fmtDuration(sec: number) {
  const s = Math.round(Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}p ${String(r).padStart(2, "0")}s`;
}

function fmtDateShort(ymd: string) {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

const CHANNEL_LABEL: Record<string, string> = {
  "Direct": "Truy cập trực tiếp",
  "Organic Search": "Tìm kiếm tự nhiên",
  "Paid Search": "Quảng cáo tìm kiếm",
  "Organic Social": "Mạng xã hội (tự nhiên)",
  "Paid Social": "Quảng cáo mạng xã hội",
  "Referral": "Từ trang khác (referral)",
  "Email": "Email",
  "Display": "Quảng cáo hiển thị",
  "Unassigned": "Không xác định",
};

const DEVICE_LABEL: Record<string, string> = {
  desktop: "Máy tính",
  mobile: "Điện thoại",
  tablet: "Máy tính bảng",
};

type Preset = "7" | "28" | "90" | "custom";

/* ======================= Small UI bits ======================= */

function KpiCard({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: number | null;
}) {
  const hasChange = typeof change === "number" && Number.isFinite(change);
  const positive = hasChange && (change as number) >= 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {hasChange && (
        <div
          className={`mt-1 text-xs font-semibold ${
            positive ? "text-emerald-600" : "text-red-500"
          }`}
        >
          {positive ? "▲" : "▼"} {fmtPct(Math.abs(change as number))} so với kỳ trước
        </div>
      )}
    </div>
  );
}

/* ======================= Page ======================= */

const AnalyticsPage: React.FC = () => {
  const { toasts, push, remove } = useToast();

  const [preset, setPreset] = useState<Preset>("28");
  const [from, setFrom] = useState(daysAgoYmd(27));
  const [to, setTo] = useState(todayYmd());

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyticsOverview | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === "7") {
      setFrom(daysAgoYmd(6));
      setTo(todayYmd());
    } else if (p === "28") {
      setFrom(daysAgoYmd(27));
      setTo(todayYmd());
    } else if (p === "90") {
      setFrom(daysAgoYmd(89));
      setTo(todayYmd());
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetchAnalyticsOverview({ from, to, compare: true });
      setData(res);
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Không tải được dữ liệu Google Analytics.";
      push({ type: "error", title: "Lỗi", message: msg, ttl: 6000 });
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = data?.totals;
  const changes = data?.changes;

  const chartData = useMemo(
    () =>
      (data?.timeseries || []).map((p) => ({
        ...p,
        label: fmtDateShort(p.date),
      })),
    [data]
  );

  const maxTopViews = useMemo(
    () => Math.max(1, ...(data?.topPages || []).map((p) => p.views)),
    [data]
  );

  return (
    <div className="space-y-4">
      <ToastHost toasts={toasts} onClose={remove} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Lượt truy cập Website</h1>
          <p className="text-sm text-slate-500">
            Dữ liệu thật lấy từ Google Analytics 4 (GA4) của domain đã gắn.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {(
              [
                ["7", "7 ngày"],
                ["28", "28 ngày"],
                ["90", "90 ngày"],
              ] as [Preset, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={`rounded border px-3 py-2 text-sm font-medium ${
                  preset === key
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Từ ngày</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Đến ngày</label>
            <input
              type="date"
              value={to}
              min={from}
              max={todayYmd()}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Đang tải..." : "Xem thống kê"}
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Đang tải dữ liệu Google Analytics...
        </div>
      )}

      {!loading && !data && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Chưa có dữ liệu. Kiểm tra lại cấu hình GA4 (Property ID, Service Account) ở
          backend hoặc bấm "Xem thống kê" để thử lại.
        </div>
      )}

      {data && totals && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              label="Người dùng"
              value={fmtInt(totals.activeUsers)}
              change={changes?.activeUsers ?? null}
            />
            <KpiCard label="Người dùng mới" value={fmtInt(totals.newUsers)} />
            <KpiCard
              label="Phiên truy cập"
              value={fmtInt(totals.sessions)}
              change={changes?.sessions ?? null}
            />
            <KpiCard
              label="Lượt xem trang"
              value={fmtInt(totals.screenPageViews)}
              change={changes?.screenPageViews ?? null}
            />
            <KpiCard
              label="Tỉ lệ tương tác"
              value={fmtPct(totals.engagementRate * 100)}
              change={changes?.engagementRate ?? null}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Thời gian trung bình / phiên
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-800">
                {fmtDuration(totals.avgSessionDurationSec)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Khoảng thời gian
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-800">
                {data.range.from} → {data.range.to}
              </div>
            </div>
          </div>

          {/* Trend chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">
              Xu hướng truy cập theo ngày
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 0, right: 10, top: 10 }}>
                  <defs>
                    <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gViews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value: any, name: any) => [fmtInt(Number(value)), name]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date || ""
                    }
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="activeUsers"
                    name="Người dùng"
                    stroke="#2563eb"
                    fill="url(#gUsers)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="screenPageViews"
                    name="Lượt xem trang"
                    stroke="#16a34a"
                    fill="url(#gViews)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Top pages */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">
                Trang được xem nhiều nhất
              </div>
              <div className="space-y-2">
                {(data.topPages || []).length === 0 && (
                  <div className="text-sm text-slate-400">Không có dữ liệu.</div>
                )}
                {(data.topPages || []).map((p, idx) => (
                  <div key={p.path + idx} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-slate-700"
                        title={p.title || p.path}
                      >
                        {p.title || p.path}
                        <span className="ml-1 text-xs text-slate-400">{p.path}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-slate-800">
                        {fmtInt(p.views)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-blue-500"
                        style={{ width: `${(p.views / maxTopViews) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Traffic sources */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">
                Nguồn truy cập
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(data.sources || []).map((s) => ({
                      name: CHANNEL_LABEL[s.channel] || s.channel,
                      sessions: s.sessions,
                    }))}
                    layout="vertical"
                    margin={{ left: 10, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip formatter={(v: any) => fmtInt(Number(v))} />
                    <Bar dataKey="sessions" name="Phiên" fill="#2563eb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Devices */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">Thiết bị</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(data.devices || []).map((d) => (
                <div
                  key={d.device}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center"
                >
                  <div className="text-xs uppercase text-slate-500">
                    {DEVICE_LABEL[d.device] || d.device}
                  </div>
                  <div className="mt-1 text-xl font-bold text-slate-800">
                    {fmtInt(d.users)}
                  </div>
                </div>
              ))}
              {(data.devices || []).length === 0 && (
                <div className="text-sm text-slate-400">Không có dữ liệu.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AnalyticsPage;