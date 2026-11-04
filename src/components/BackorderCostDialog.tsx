// src/components/BackorderCostDialog.tsx
// ✅ Duyệt hoá đơn xuất âm mà linh kiện chưa từng nhập: kế toán nhập giá vốn tạm ngay tại đây
import React, { useEffect, useState } from "react";

export type BackorderCostItem = { itemId: string; name: string; qty: number };
export const NEED_BACKORDER_COST = "NEED_BACKORDER_COST";

const fmt = (t: string) => {
  const n = Number(t.replace(/[^\d]/g, "")) || 0;
  return n ? new Intl.NumberFormat("vi-VN").format(n) : "";
};

const BackorderCostDialog: React.FC<{
  items: BackorderCostItem[] | null;
  onClose: () => void;
  /** lỗi thì throw để hộp hiện thông báo */
  onSubmit: (costs: Record<string, number>) => Promise<void>;
}> = ({ items, onClose, onSubmit }) => {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setVals({});
    setErr("");
  }, [items]);

  if (!items) return null;
  const num = (id: string) => Number((vals[id] || "").replace(/[^\d]/g, "")) || 0;
  const ok = items.every((i) => num(i.itemId) > 0);

  return (
    <div role="dialog" aria-modal="true" aria-label="Nhập giá vốn tạm" className="fixed inset-0 z-[100000] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-slate-900">Nhập giá vốn tạm để duyệt</h2>
        <p className="mt-1 text-sm text-slate-600">
          Linh kiện dưới đây chưa từng nhập kho nên chưa có giá vốn. Giá này dùng cho đơn đang duyệt và được đánh dấu trong "Hàng chờ bù".
        </p>
        <div className="mt-3 space-y-3">
          {items.map((i) => (
            <label key={i.itemId} className="block text-sm font-medium text-slate-800">
              {i.name} <span className="font-normal text-slate-500">· số lượng {i.qty}</span>
              <input
                aria-label={`Giá vốn tạm ${i.name}`}
                inputMode="numeric"
                autoComplete="off"
                value={vals[i.itemId] || ""}
                placeholder="Giá vốn 1 cái, đồng"
                onChange={(e) => setVals((v) => ({ ...v, [i.itemId]: fmt(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm tabular-nums"
              />
            </label>
          ))}
        </div>
        {err && (
          <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {err}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            Huỷ
          </button>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onSubmit(Object.fromEntries(items.map((i) => [i.itemId, num(i.itemId)])));
              } catch (e: any) {
                setErr(e?.response?.data?.message || "Duyệt thất bại.");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? "Đang duyệt..." : "Duyệt hoá đơn"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackorderCostDialog;
