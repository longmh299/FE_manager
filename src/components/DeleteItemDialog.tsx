// src/components/DeleteItemDialog.tsx
// ✅ Xoá mặt hàng (chỉ quản trị):
//   1) hỏi server mặt hàng đã dùng ở đâu (GET /items/:id/usage)
//   2) đã phát sinh chứng từ / còn tồn -> nói rõ lý do, không cho xoá (giữ lịch sử kế toán)
//   3) chưa dùng -> nhập mật khẩu cấp 2 rồi xoá (DELETE /items/:id { pin })
import React, { useEffect, useState } from "react";
import api from "../api/client";
import { DialogShell, PinActionDialog } from "./SecondPassword";

export type DeleteItemTarget = { itemId: string; sku?: string | null; name?: string | null };

type Usage = { canDelete: boolean; reasons: string[] };

const DeleteItemDialog: React.FC<{
  target: DeleteItemTarget | null;
  onClose: () => void;
  onDeleted: (t: DeleteItemTarget) => void;
}> = ({ target, onClose, onDeleted }) => {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setUsage(null);
    setErr(null);
    api
      .get(`/items/${target.itemId}/usage`)
      .then((r) => setUsage(r.data?.data ?? null))
      .catch((e) => setErr(e?.response?.data?.message || "Không kiểm tra được mặt hàng. Thử lại."));
  }, [target]);

  if (!target) return null;
  const label = (
    <>
      <b>{target.sku}</b> {target.name}
    </>
  );

  // đang kiểm tra / lỗi / không xoá được
  if (!usage || !usage.canDelete) {
    return (
      <DialogShell
        open
        tone="danger"
        title="Xoá mặt hàng"
        subtitle={label}
        onClose={onClose}
        footer={
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Đóng
          </button>
        }
      >
        {err ? (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>
        ) : !usage ? (
          <div className="py-4 text-center text-sm text-slate-500">Đang kiểm tra mặt hàng…</div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              Không xoá được vì mặt hàng đã phát sinh dữ liệu. Xoá sẽ làm sai lịch sử hoá đơn, sổ kho và báo cáo.
            </div>
            <ul className="list-disc space-y-1 pl-5 text-slate-700">
              {usage.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Không bán nữa thì cứ để tồn 0, hoặc đổi tên thêm chữ "(ngừng bán)" cho dễ nhận ra.</p>
          </div>
        )}
      </DialogShell>
    );
  }

  return (
    <PinActionDialog
      open
      tone="danger"
      title="Xoá mặt hàng"
      subtitle={<>Mặt hàng chưa phát sinh chứng từ và tồn bằng 0. Xoá rồi không khôi phục được.</>}
      confirmLabel="Xoá mặt hàng"
      busyLabel="Đang xoá…"
      onClose={onClose}
      onSubmit={async (pin) => {
        await api.delete(`/items/${target.itemId}`, { data: { pin } });
        onDeleted(target);
      }}
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">{label}</div>
    </PinActionDialog>
  );
};

export default DeleteItemDialog;
