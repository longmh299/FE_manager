// src/pages/ReorderPage.tsx
// ✅ Gợi ý nhập hàng (kế toán / quản trị)
//  - cùng cách tính với chuông cảnh báo tồn + email báo cáo: linh kiện xét 30 ngày bán, máy xét 60 ngày
//  - thêm cho việc đặt hàng: giá nhập lần cuối, nhà cung cấp lần cuối, ước tính tiền; sửa được "Nên nhập" để tính lại tiền
//  - lọc Linh kiện / Máy, chỉ hết hàng, tìm kiếm; xuất Excel
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type Row = {
  itemId: string | null;
  sku: string;
  name: string;
  kind: "PART" | "MACHINE";
  unit: string;
  qty: number;
  sold: number;
  soldDays: number;
  stale?: boolean; // kỳ gần không bán được (đã hết hàng) — gợi ý dựa trên 90 / 120 ngày
  daysCover: number | null;
  suggestQty: number;
  severity: "CRITICAL" | "LOW";
  note: string;
  lastPrice: number | null;
  lastSupplier: string;
  lastDate: string;
  estCost: number | null;
};

const num = (v: number) => Number(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const money = (v: number) => `${Math.round(Number(v || 0)).toLocaleString("vi-VN")} đ`;
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

const ReorderPage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"" | "PART" | "MACHINE">("");
  const [onlyOut, setOnlyOut] = useState(false);
  const [hideStale, setHideStale] = useState(false); // ẩn mã gần đây không bán (có thể đã ngừng kinh doanh)
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Record<string, string>>({}); // "Nên nhập" người dùng sửa (chỉ để tính tiền trên trang)
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/reports/reorder");
      setRows(Array.isArray(r.data?.data?.rows) ? r.data.data.rows : []);
    } catch (e) {
      const x = e as { response?: { data?: { message?: string } } };
      push({ type: "error", title: "Lỗi", message: x?.response?.data?.message || "Không tải được gợi ý nhập hàng." });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const keyOf = (r: Row) => r.itemId || `${r.kind}:${r.name}`;
  const qtyOf = useCallback(
    (r: Row) => {
      const v = edit[keyOf(r)];
      if (v === undefined || v === "") return r.suggestQty;
      const x = Number(v.replace(/[^\d]/g, ""));
      return Number.isFinite(x) ? x : r.suggestQty;
    },
    [edit]
  );

  const shown = useMemo(() => {
    const t = plain(q.trim());
    return rows.filter(
      (r) => (!kind || r.kind === kind) && (!onlyOut || r.severity === "CRITICAL") && (!hideStale || !r.stale) && (!t || plain(`${r.sku} ${r.name} ${r.lastSupplier}`).includes(t))
    );
  }, [rows, kind, onlyOut, hideStale, q]);

  const sum = useMemo(
    () => ({
      count: shown.length,
      critical: shown.filter((r) => r.severity === "CRITICAL").length,
      est: shown.reduce((t, r) => t + (r.lastPrice != null ? qtyOf(r) * r.lastPrice : 0), 0),
      noPrice: shown.filter((r) => r.lastPrice == null).length,
    }),
    [shown, qtyOf]
  );

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const r = await api.get("/reports/reorder/excel", { params: { kind: kind || undefined }, responseType: "blob" });
      saveAs(new Blob([r.data]), `goi-y-nhap-hang${kind === "PART" ? "-linh-kien" : kind === "MACHINE" ? "-may" : ""}.xlsx`);
    } catch {
      push({ type: "error", title: "Lỗi", message: "Không xuất được file Excel." });
    } finally {
      setExporting(false);
    }
  };

  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm font-medium ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;

  return (
    <div className="p-4">
      <ToastHost toasts={toasts} onClose={remove} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-slate-900">Gợi ý nhập hàng</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Hàng đã hết hoặc sắp hết so với tốc độ bán (linh kiện xét 30 ngày, máy xét 60 ngày), cùng danh sách với chuông cảnh báo tồn. Giá
            nhập là giá lần nhập gần nhất, chưa VAT.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
          Tải lại
        </button>
        <button
          type="button"
          onClick={exportXlsx}
          disabled={exporting || loading}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {exporting ? "Đang xuất…" : "Xuất Excel"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 sm:text-sm">Mã cần nhập</div>
          <div className="text-lg font-semibold text-slate-900 sm:text-xl">{sum.count}</div>
        </div>
        <div className={`rounded-xl border bg-white p-4 ${sum.critical ? "border-rose-300" : "border-slate-200"}`}>
          <div className="text-xs text-slate-500 sm:text-sm">Đã hết hàng</div>
          <div className={`text-lg font-semibold sm:text-xl ${sum.critical ? "text-rose-600" : "text-slate-900"}`}>{sum.critical}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 sm:text-sm">Ước tính tiền nhập</div>
          <div className="text-lg font-semibold text-slate-900 sm:text-xl">{money(sum.est)}</div>
          {sum.noPrice > 0 && <div className="mt-1 text-xs text-slate-500">Chưa gồm {sum.noPrice} mã chưa từng nhập</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 sm:text-sm">Đang xem</div>
          <div className="text-lg font-semibold text-slate-900 sm:text-xl">{kind === "PART" ? "Linh kiện" : kind === "MACHINE" ? "Máy" : "Tất cả"}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={chip(kind === "")} onClick={() => setKind("")}>
          Tất cả
        </button>
        <button type="button" className={chip(kind === "PART")} onClick={() => setKind("PART")}>
          Linh kiện
        </button>
        <button type="button" className={chip(kind === "MACHINE")} onClick={() => setKind("MACHINE")}>
          Máy
        </button>
        <label className="ml-2 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} />
          Chỉ mã đã hết hàng
        </label>
        <label className="ml-2 flex items-center gap-2 text-sm text-slate-700" title="Mã hết hàng, kỳ gần đây không có đơn bán; đang gợi ý dựa trên 90 ngày (linh kiện) / 120 ngày (máy)">
          <input type="checkbox" checked={hideStale} onChange={(e) => setHideStale(e.target.checked)} />
          Ẩn mã gần đây không bán
        </label>
        <input
          aria-label="Tìm mã, tên, nhà cung cấp"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã, tên, nhà cung cấp…"
          className="ml-auto w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:w-72"
        />
      </div>

      <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Hàng</th>
              <th className="px-3 py-2 text-right">Tồn</th>
              <th className="px-3 py-2 text-right">Đã bán</th>
              <th className="px-3 py-2 text-right">Còn đủ</th>
              <th className="px-3 py-2 text-right">Nên nhập</th>
              <th className="px-3 py-2 text-right">Giá nhập cuối</th>
              <th className="px-3 py-2 text-right">Ước tính tiền</th>
              <th className="px-3 py-2">Nhà cung cấp lần cuối</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  {rows.length ? "Không có mã nào khớp bộ lọc." : "Chưa có mã nào cần nhập thêm."}
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((r) => {
                const k = keyOf(r);
                const qty = qtyOf(r);
                return (
                  <tr key={k} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-slate-900">{r.sku}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            r.severity === "CRITICAL" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {r.severity === "CRITICAL" ? "Hết hàng" : "Sắp hết"}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{r.kind === "MACHINE" ? "Máy" : "Linh kiện"}</span>
                        {r.stale && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">Gần đây không bán</span>}
                      </div>
                      <div className="text-slate-700">{r.name}</div>
                      {r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${r.qty <= 0 ? "font-semibold text-rose-600" : ""}`}>
                      {num(r.qty)} <span className="text-xs text-slate-400">{r.unit}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {num(r.sold)}
                      <div className="text-xs text-slate-400">/ {r.soldDays} ngày</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.daysCover == null ? "—" : `${num(r.daysCover)} ngày`}</td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        aria-label={`Nên nhập ${r.sku}`}
                        inputMode="numeric"
                        value={edit[k] ?? String(r.suggestQty)}
                        onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value.replace(/[^\d]/g, "") }))}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm font-semibold tabular-nums outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.lastPrice == null ? <span className="text-slate-400">Chưa nhập</span> : money(r.lastPrice)}
                      {r.lastDate && <div className="text-xs text-slate-400">{r.lastDate}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{r.lastPrice == null ? "—" : money(qty * r.lastPrice)}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.lastSupplier || "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Sửa ô "Nên nhập" chỉ để tính lại tiền trên trang này, không lưu và không tạo hoá đơn nhập. File Excel xuất theo số gợi ý gốc.
      </p>
    </div>
  );
};

export default ReorderPage;