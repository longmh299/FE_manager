// src/components/CustomerStatementDialog.tsx
// ✅ Xuất "Bảng kê công nợ" gửi khách (Excel) — mở từ trang Bảng kê bán hàng
//  - chọn khách, tính đến ngày, (tuỳ chọn) từ ngày, chỉ hoá đơn còn nợ, kèm chi tiết hàng
//  - BE không xuất giá vốn, lãi, NV sale / kỹ thuật, ghi chú nội bộ
import React, { useEffect, useState } from "react";
import { saveAs } from "file-saver";
import api from "../api/client";

type Partner = { id: string; code?: string | null; name: string; phone?: string | null; taxCode?: string | null };

const todayVN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

const CustomerStatementDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
  onDone: (msg: string) => void;
}> = ({ open, onClose, onError, onDone }) => {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Partner[]>([]);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [to, setTo] = useState(todayVN());
  const [from, setFrom] = useState("");
  const [onlyDebt, setOnlyDebt] = useState(true);
  const [withLines, setWithLines] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    const term = q.trim();
    if (!open || partner || term.length < 2) {
      setFound([]);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .get("/partners", { params: { q: term, pageSize: 10 } })
        .then((r) => setFound(Array.isArray(r.data?.data) ? r.data.data : []))
        .catch(() => setFound([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, open, partner]);

  if (!open) return null;

  const exportXlsx = async () => {
    if (!partner) return onError("Chọn khách hàng trước.");
    setBusy(true);
    try {
      const r = await api.get("/reports/customer-statement/excel", {
        params: { partnerId: partner.id, to, from: from || undefined, onlyDebt: onlyDebt ? 1 : 0, lines: withLines ? 1 : 0 },
        responseType: "blob",
      });
      saveAs(new Blob([r.data]), `cong-no-${partner.name}-${to}.xlsx`);
      onDone(`Đã xuất bảng kê công nợ của ${partner.name}.`);
      onClose();
    } catch (e) {
      // lỗi trả về dạng blob -> đọc ra chữ
      const x = e as { response?: { data?: Blob } };
      let msg = "Không xuất được bảng kê.";
      try {
        const t = await x.response?.data?.text?.();
        if (t) msg = JSON.parse(t)?.message || msg;
      } catch {
        /* giữ câu mặc định */
      }
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bảng kê công nợ gửi khách"
        className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bảng kê công nợ gửi khách</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              File Excel có tên công ty, các hoá đơn, đã trả, còn nợ, chỗ ký xác nhận. Không có giá vốn, lãi, tên nhân viên, ghi chú nội bộ.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Khách hàng *</span>
            {partner ? (
              <div className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <b>{partner.name}</b>
                  <div className="text-xs text-slate-500">{[partner.code, partner.phone, partner.taxCode && `MST ${partner.taxCode}`].filter(Boolean).join(" · ")}</div>
                </div>
                <button type="button" onClick={() => setPartner(null)} className="text-xs font-medium text-sky-700 hover:underline">
                  Đổi
                </button>
              </div>
            ) : (
              <>
                <input className={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gõ tên, mã, SĐT khách…" />
                {found.length > 0 && (
                  <div className="mt-1 max-h-56 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
                    {found.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPartner(p)}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <b>{p.name}</b>
                        <span className="ml-1 text-xs text-slate-500">{[p.code, p.phone].filter(Boolean).join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Tính đến ngày</span>
              <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value || todayVN())} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Hoá đơn từ ngày (tuỳ chọn)</span>
              <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} />
            Chỉ hoá đơn còn nợ
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={withLines} onChange={(e) => setWithLines(e.target.checked)} />
            Kèm chi tiết hàng (tên hàng, số lượng, đơn giá)
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Huỷ
          </button>
          <button
            type="button"
            onClick={exportXlsx}
            disabled={busy || !partner}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            {busy ? "Đang xuất…" : "Xuất Excel"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerStatementDialog;