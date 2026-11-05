// src/pages/PartnerMergePage.tsx
// ✅ Gộp khách trùng (chỉ quản trị). App chỉ gợi ý, người bấm mới gộp.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import { PinActionDialog } from "../components/SecondPassword";

type P = {
  id: string;
  code: string | null;
  name: string;
  taxCode: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  invoiceCount: number;
  paymentCount: number;
  debt: number;
  hasLocked: boolean;
};
type Group = { reason: "TAX" | "PHONE" | "NAME"; key: string; partners: P[] };

const REASON: Record<Group["reason"], string> = { TAX: "Cùng mã số thuế", PHONE: "Cùng số điện thoại", NAME: "Tên giống nhau" };
const money = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
const FIELDS: Array<{ k: "name" | "taxCode" | "phone" | "address" | "email"; label: string }> = [
  { k: "name", label: "Tên" },
  { k: "taxCode", label: "MST" },
  { k: "phone", label: "SĐT" },
  { k: "address", label: "Địa chỉ" },
  { k: "email", label: "Email" },
];

const PartnerMergePage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<any[]>([]);
  const [picked, setPicked] = useState<P[]>([]);
  const [keepId, setKeepId] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({}); // ô -> id khách lấy giá trị
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/partners/duplicates");
      setGroups(r.data?.data || []);
    } catch (e: any) {
      push({ type: "error", title: "Lỗi", message: e?.response?.data?.message || "Không tải được danh sách." });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (ids: string[]) => {
    const r = await api.post("/partners/merge-preview", { ids });
    const rows: P[] = (r.data?.data || []).filter((x: any) => !x.mergedIntoId);
    setPicked(rows);
    // mặc định giữ mã có nhiều hoá đơn nhất
    const best = [...rows].sort((a, b) => b.invoiceCount - a.invoiceCount)[0];
    setKeepId(best?.id || "");
    setFields({});
    setReason("");
  };

  useEffect(() => {
    const k = q.trim();
    if (k.length < 2) {
      setFound([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/partners", { params: { q: k, pageSize: 15 } });
        setFound(r.data?.data || []);
      } catch {
        setFound([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const valueOf = (k: string): string => {
    const src = picked.find((p) => p.id === (fields[k] || keepId));
    return String((src as any)?.[k] ?? "");
  };
  const keep = picked.find((p) => p.id === keepId);
  const others = picked.filter((p) => p.id !== keepId);
  const totals = useMemo(
    () => ({
      invoices: picked.reduce((t, p) => t + p.invoiceCount, 0),
      payments: picked.reduce((t, p) => t + p.paymentCount, 0),
      debt: picked.reduce((t, p) => t + p.debt, 0),
    }),
    [picked]
  );
  const lockedWarn = picked.some((p) => p.hasLocked);

  const doMerge = async (pin: string) => {
    const r = await api.post("/partners/merge", {
      keepId,
      mergeIds: others.map((p) => p.id),
      fields: Object.fromEntries(FIELDS.map((f) => [f.k, valueOf(f.k)])),
      reason: reason.trim(),
      pin,
    });
    const d = r.data?.data;
    setPinOpen(false);
    setPicked([]);
    setQ("");
    push({ type: "success", title: "Đã gộp", message: `Còn 1 mã, ${d?.invoiceCount ?? 0} hoá đơn, công nợ ${money(d?.debtAfter ?? 0)} đ.` });
    await load();
  };

  return (
    <div className="space-y-4 p-4">
      <ToastHost toasts={toasts} onClose={remove} />
      <div>
        <Link to="/partners" className="text-sm text-sky-700 hover:underline">← Khách hàng</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Gộp khách trùng</h1>
        <p className="mt-1 text-sm text-slate-600">Chọn các mã của cùng một khách, chọn mã giữ lại rồi gộp. App chỉ gợi ý, không tự gộp.</p>
      </div>

      {picked.length > 0 && (
        <section className="rounded-xl border border-sky-200 bg-white p-4" aria-label="So sánh trước khi gộp">
          <h2 className="font-semibold text-slate-900">So sánh trước khi gộp</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2">Giữ lại</th>
                  <th className="px-2 py-2">Mã, tên</th>
                  <th className="px-2 py-2">MST, SĐT</th>
                  <th className="px-2 py-2 text-right">Hoá đơn</th>
                  <th className="px-2 py-2 text-right">Phiếu</th>
                  <th className="px-2 py-2 text-right">Còn nợ</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {picked.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      <input type="radio" name="keep" aria-label={`Giữ lại ${p.name}`} checked={keepId === p.id} onChange={() => { setKeepId(p.id); setFields({}); }} />
                    </td>
                    <td className="px-2 py-2"><b>{p.code}</b> {p.name}</td>
                    <td className="px-2 py-2 text-slate-600">{[p.taxCode, p.phone].filter(Boolean).join(" · ") || "-"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{p.invoiceCount}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{p.paymentCount}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(p.debt)}</td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => setPicked((x) => x.filter((v) => v.id !== p.id))}>Bỏ</button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <td className="px-2 py-2" colSpan={3}>Sau khi gộp</td>
                  <td className="px-2 py-2 text-right tabular-nums">{totals.invoices}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{totals.payments}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(totals.debt)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="mt-4 text-sm font-semibold text-slate-800">Thông tin giữ lại trên mã {keep?.code}</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.k} className="text-sm text-slate-700">
                {f.label}
                <select
                  aria-label={`Lấy ${f.label} từ`}
                  value={fields[f.k] || keepId}
                  onChange={(e) => setFields((v) => ({ ...v, [f.k]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {picked.map((p) => (
                    <option key={p.id} value={p.id}>{String((p as any)[f.k] ?? "") || "(trống)"} · {p.code}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Hoá đơn và phiếu chuyển sang mã giữ lại. Số tiền, số phiếu và tên in trên hoá đơn cũ không đổi. Các mã kia được ẩn, không xoá.
          </div>
          {lockedWarn && (
            <div role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Có chứng từ trong kỳ đã khoá sổ. Tổng số không đổi, nhưng công nợ theo từng khách của kỳ cũ sẽ đổi. Báo kế toán nếu đã gửi đối chiếu công nợ theo mã cũ.
            </div>
          )}
          <input
            aria-label="Lý do gộp"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Lý do gộp, ví dụ: cùng một khách, kế toán tạo trùng"
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium" onClick={() => setPicked([])}>Huỷ</button>
            <button
              type="button"
              disabled={others.length === 0 || reason.trim().length < 3}
              onClick={() => setPinOpen(true)}
              className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Gộp {others.length} mã vào {keep?.code}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Tìm và chọn tay</h2>
        <input
          aria-label="Tìm khách để gộp"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Gõ tên (không dấu cũng được), mã, MST hoặc SĐT"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {found.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100">
            {found.map((p) => {
              const inList = picked.some((x) => x.id === p.id);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0"><b>{p.code}</b> {p.name} <span className="text-xs text-slate-500">{[p.taxCode, p.phone].filter(Boolean).join(" · ")}</span></span>
                  <button
                    type="button"
                    disabled={inList}
                    onClick={() => choose([...picked.map((x) => x.id), p.id])}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                  >
                    {inList ? "Đã chọn" : "Thêm vào gộp"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Nghi trùng ({groups.length} nhóm)</h2>
        {loading && <p className="mt-2 text-sm text-slate-500">Đang tải...</p>}
        {!loading && groups.length === 0 && <p className="mt-2 text-sm text-slate-500">Không thấy nhóm nào nghi trùng.</p>}
        <ul className="mt-2 space-y-2">
          {groups.map((g) => (
            <li key={`${g.reason}-${g.key}`} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{REASON[g.reason]}</span>
                <button type="button" onClick={() => choose(g.partners.map((p) => p.id))} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Xem và gộp</button>
              </div>
              <ul className="mt-2 text-sm text-slate-700">
                {g.partners.map((p) => (
                  <li key={p.id}><b>{p.code}</b> {p.name} <span className="text-xs text-slate-500">· {p.invoiceCount} hoá đơn · còn nợ {money(p.debt)} đ {[p.taxCode, p.phone].filter(Boolean).join(" · ")}</span></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <PinActionDialog
        open={pinOpen}
        tone="danger"
        title="Gộp khách hàng"
        subtitle="Không có nút hoàn tác. Kiểm tra kỹ mã giữ lại trước khi xác nhận."
        confirmLabel="Gộp"
        busyLabel="Đang gộp…"
        onClose={() => setPinOpen(false)}
        onSubmit={doMerge}
      />
    </div>
  );
};

export default PartnerMergePage;
