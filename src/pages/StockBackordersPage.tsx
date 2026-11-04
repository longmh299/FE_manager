// src/pages/StockBackordersPage.tsx
// ✅ Hàng chờ bù: linh kiện đã xuất âm, hàng về thì báo để quản lý kho không quên
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type Row = {
  id: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  qty: number;
  covered: number;
  remaining: number;
  arrived: boolean;
  stockQty: number | null;
  unitCost: number;
  note: string | null;
  days: number;
  late: boolean;
  createdAt: string;
  closedAt: string | null;
  closeNote: string | null;
  item: { id: string; sku: string; name: string };
  invoice: { id: string; code: string; customerName: string };
};

const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");
const TABS: Array<{ k: Row["status"]; label: string }> = [
  { k: "OPEN", label: "Đang chờ bù" },
  { k: "DONE", label: "Đã bù" },
  { k: "CANCELLED", label: "Đã huỷ" },
];

const StockBackordersPage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const [tab, setTab] = useState<Row["status"]>("OPEN");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/stock-backorders", { params: { status: tab } });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      push({ type: "error", title: "Lỗi", message: e?.response?.data?.message || "Không tải được danh sách." });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const close = async (r: Row) => {
    setBusy(r.id);
    try {
      await api.post(`/stock-backorders/${r.id}/close`, {});
      push({ type: "success", title: "Đã bù xong", message: `${r.item.sku || r.item.name} của HĐ ${r.invoice.code}.` });
      window.dispatchEvent(new Event("backorder:changed"));
      await load();
    } catch (e: any) {
      push({ type: "error", title: "Chưa đóng được", message: e?.response?.data?.message || "Thử lại sau." });
    } finally {
      setBusy("");
    }
  };

  const term = q.trim().toLowerCase();
  const shown = term
    ? rows.filter((r) => [r.item.sku, r.item.name, r.invoice.code, r.invoice.customerName, r.note].some((v) => String(v || "").toLowerCase().includes(term)))
    : rows;
  const arrivedCount = rows.filter((r) => r.arrived).length;

  return (
    <div className="p-4">
      <ToastHost toasts={toasts} onClose={remove} />
      <h1 className="text-xl font-semibold text-slate-900">Hàng chờ bù</h1>
      <p className="mt-1 text-sm text-slate-600">
        Linh kiện đã xuất âm khi bán. Hàng về thì dòng tự báo, bù xong bấm "Đã bù xong" để đóng.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === t.k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
        <input
          aria-label="Tìm hàng chờ bù"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã, tên, hoá đơn, ghi chú..."
          className="ml-auto w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:w-72"
        />
      </div>

      {tab === "OPEN" && arrivedCount > 0 && (
        <div role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Có <b>{arrivedCount}</b> dòng hàng đã về đủ, cần lắp lại hoặc bù rồi bấm "Đã bù xong".
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Linh kiện</th>
              <th className="px-3 py-2 text-right">Xuất âm</th>
              <th className="px-3 py-2 text-right">Đã về</th>
              <th className="px-3 py-2">Hoá đơn</th>
              <th className="px-3 py-2">Ghi chú</th>
              <th className="px-3 py-2">Ngày xuất</th>
              <th className="px-3 py-2">Tình trạng</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">Đang tải...</td>
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">Không có dòng nào.</td>
              </tr>
            )}
            {!loading &&
              shown.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2.5">
                    <b>{r.item.sku}</b> {r.item.name}
                    {r.stockQty != null && <div className="text-xs text-slate-500">Tồn hiện tại: {nf.format(r.stockQty)}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(r.qty)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(r.covered)}</td>
                  <td className="px-3 py-2.5">
                    <Link className="font-medium text-sky-700 hover:underline" to={`/invoices/${r.invoice.id}`}>
                      HĐ {r.invoice.code}
                    </Link>
                    <div className="text-xs text-slate-500">{r.invoice.customerName}</div>
                  </td>
                  <td className="max-w-[240px] px-3 py-2.5 text-slate-700">{r.note || "-"}</td>
                  <td className="px-3 py-2.5">
                    {fmtDate(r.createdAt)}
                    {r.status === "OPEN" && (
                      <div className={`text-xs ${r.late ? "font-medium text-rose-700" : "text-slate-500"}`}>
                        {r.late ? `Quá hạn, đã ${r.days} ngày` : r.days === 0 ? "Hôm nay" : `${r.days} ngày trước`}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.status === "OPEN" ? (
                      r.arrived ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Hàng đã về</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Còn thiếu {nf.format(r.remaining)}</span>
                      )
                    ) : r.status === "DONE" ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Đã bù {fmtDate(r.closedAt)}</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700" title={r.closeNote || ""}>{r.closeNote || "Đã huỷ"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.status === "OPEN" && (
                      <button
                        type="button"
                        disabled={!r.arrived || busy === r.id}
                        title={r.arrived ? undefined : "Hàng về đủ mới đóng được"}
                        onClick={() => close(r)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        Đã bù xong
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StockBackordersPage;
