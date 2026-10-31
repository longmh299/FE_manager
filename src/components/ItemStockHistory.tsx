// src/components/ItemStockHistory.tsx
// ✅ Lịch sử nhập / xuất của 1 mặt hàng — xổ xuống ngay dưới dòng tồn (trang Tồn máy, Tồn linh kiện)
// - Tồn đầu kỳ / nhập / xuất / tồn cuối kỳ + tồn sau từng phiếu
// - Đối soát: tồn hệ thống so với tổng các phiếu (phần chênh thường là tồn khởi tạo bằng file)
// API: GET /stocks/item-history?itemId=&from=&to=
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

type HistRow = {
  id: string;
  date: string;
  kind: string;
  kindLabel: string;
  refCode: string | null;
  invoiceId: string | null;
  partnerName: string | null;
  note: string | null;
  qty: number;
  balanceAfter: number;
};
type Hist = {
  item: { id: string; sku: string; name: string; unit: string };
  currentQty: number;
  ledgerNetAll: number;
  unexplained: number;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  count: number;
  truncated: boolean;
  firstMovementDate: string | null;
  rows: HistRow[];
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const q = (n: number) => nf.format(n || 0);
const signed = (n: number) => (n > 0 ? `+${q(n)}` : n < 0 ? `−${q(-n)}` : "0");
const viDate = (ymd?: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "");
const vnToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
function daysAgo(n: number) {
  const d = new Date(`${vnToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// màu nhãn theo chiều hàng: vào = teal, ra = rose, kiểm kê/điều chỉnh = amber, chuyển kho = slate
function kindTone(kind: string, qty: number) {
  if (kind === "TRANSFER") return "bg-slate-100 text-slate-700";
  if (kind === "STOCK_COUNT" || kind === "ADJUST") return "bg-amber-50 text-amber-800";
  return qty >= 0 ? "bg-teal-50 text-teal-800" : "bg-rose-50 text-rose-800";
}

const PERIODS: Array<{ key: string; label: string; from: () => string | null }> = [
  { key: "30", label: "30 ngày", from: () => daysAgo(29) },
  { key: "90", label: "90 ngày", from: () => daysAgo(89) },
  { key: "year", label: "Năm nay", from: () => vnToday().slice(0, 4) + "-01-01" },
  { key: "all", label: "Tất cả", from: () => null },
];

const ItemStockHistory: React.FC<{ itemId: string; unitLabel?: string }> = ({ itemId, unitLabel }) => {
  const [period, setPeriod] = useState("90");
  const [dir, setDir] = useState<"" | "in" | "out">("");
  const [data, setData] = useState<Hist | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const from = PERIODS.find((p) => p.key === period)?.from() ?? null;
    setLoading(true);
    setErr(null);
    api
      .get("/stocks/item-history", { params: { itemId, ...(from ? { from } : {}) } })
      .then((r) => alive && setData(r.data?.data ?? null))
      .catch((e) => alive && setErr(e?.response?.data?.message || e?.message || "Không tải được lịch sử."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [itemId, period]);

  const unit = unitLabel || data?.item.unit || "";
  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    if (dir === "in") return list.filter((r) => r.qty > 0);
    if (dir === "out") return list.filter((r) => r.qty < 0);
    return list;
  }, [data, dir]);

  return (
    <div className="border-y border-slate-200 bg-slate-50/80 px-3 py-3 sm:px-4" onClick={(e) => e.stopPropagation()}>
      {/* điều khiển */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto hidden text-sm font-semibold text-slate-800 md:inline">Lịch sử nhập xuất</span>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Khoảng thời gian">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-2 py-1 text-xs sm:text-sm ${period === p.key ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Lọc nhập xuất">
          {(
            [
              ["", "Tất cả"],
              ["in", "Nhập"],
              ["out", "Xuất"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setDir(v)}
              className={`rounded-md px-2 py-1 text-xs sm:text-sm ${dir === v ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {/* số tổng */}
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4">
        {[
          { l: "Tồn đầu kỳ", v: data ? q(data.opening) : "…", c: "text-slate-900" },
          { l: "Nhập", v: data ? `+${q(data.totalIn)}` : "…", c: "text-teal-700" },
          { l: "Xuất", v: data ? `−${q(data.totalOut)}` : "…", c: "text-rose-700" },
          { l: "Tồn cuối kỳ", v: data ? q(data.closing) : "…", c: "text-slate-900 font-semibold" },
        ].map((s) => (
          <div key={s.l} className="bg-white px-3 py-2">
            <div className="text-xs text-slate-500">{s.l}</div>
            <div className={`text-base tabular-nums ${s.c}`}>
              {s.v} <span className="text-xs font-normal text-slate-400">{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* đối soát */}
      {data && (
        <div
          className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            Math.abs(data.unexplained) < 0.0005 ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
          }`}
        >
          <span aria-hidden="true" className="mt-0.5">
            {Math.abs(data.unexplained) < 0.0005 ? "✓" : "!"}
          </span>
          {Math.abs(data.unexplained) < 0.0005 ? (
            <span>
              Khớp: tồn hiện tại {q(data.currentQty)} {unit} bằng tổng các phiếu nhập xuất.
            </span>
          ) : (
            <span>
              Tồn hiện tại {q(data.currentQty)} {unit}, tổng các phiếu nhập xuất {signed(data.ledgerNetAll)} {unit}. Chênh{" "}
              <b className="tabular-nums">{signed(data.unexplained)}</b> {unit} không có phiếu, thường là tồn khởi tạo bằng file
              {data.firstMovementDate ? ` trước phiếu đầu tiên (${viDate(data.firstMovementDate)})` : ""}. Tồn sau từng phiếu bên dưới đã tính phần này.
            </span>
          )}
        </div>
      )}

      {/* danh sách phiếu */}
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[92px_128px_minmax(0,1fr)_96px_96px] gap-3 border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-500 md:grid">
          <span>Ngày</span>
          <span>Nghiệp vụ</span>
          <span>Chứng từ</span>
          <span className="text-right">Nhập / xuất</span>
          <span className="text-right">Tồn sau</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {loading && !data ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">Đang tải lịch sử…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              {data?.count ? "Không có phiếu nào khớp bộ lọc." : "Chưa có phiếu nhập xuất nào trong khoảng này."}
            </div>
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-slate-100 px-3 py-2.5 last:border-b-0 md:grid-cols-[92px_128px_minmax(0,1fr)_96px_96px] md:items-center"
              >
                {/* mobile: dòng 1 */}
                <div className="flex flex-wrap items-center gap-2 md:contents">
                  <span className="text-sm tabular-nums text-slate-700">{viDate(r.date)}</span>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${kindTone(r.kind, r.qty)}`}>{r.kindLabel}</span>
                </div>
                <div className="row-span-2 text-right md:hidden">
                  <div className={`text-sm font-semibold tabular-nums ${r.qty > 0 ? "text-teal-700" : r.qty < 0 ? "text-rose-700" : "text-slate-500"}`}>{signed(r.qty)}</div>
                  <div className="text-xs tabular-nums text-slate-500">tồn {q(r.balanceAfter)}</div>
                </div>
                <div className="min-w-0 text-sm">
                  {r.refCode &&
                    (r.invoiceId ? (
                      <Link to={`/invoices/${r.invoiceId}`} className="font-medium text-sky-700 underline-offset-2 hover:underline">
                        {r.refCode.startsWith("MV-") || r.refCode.startsWith("ADJ-") ? r.refCode : `HĐ ${r.refCode}`}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-700">{r.refCode}</span>
                    ))}
                  {r.partnerName && <span className="text-slate-600">, {r.partnerName}</span>}
                  {r.note && <div className="truncate text-xs text-slate-500" title={r.note}>{r.note}</div>}
                </div>
                <span className={`hidden text-right text-sm font-semibold tabular-nums md:block ${r.qty > 0 ? "text-teal-700" : r.qty < 0 ? "text-rose-700" : "text-slate-500"}`}>
                  {signed(r.qty)}
                </span>
                <span className="hidden text-right text-sm tabular-nums text-slate-800 md:block">{q(r.balanceAfter)}</span>
              </div>
            ))
          )}
        </div>
        {data && (data.truncated || data.count > 0) && (
          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            {data.count} phiếu trong kỳ{data.truncated ? `, đang hiện ${data.rows.length} phiếu gần nhất` : ""}.
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemStockHistory;
