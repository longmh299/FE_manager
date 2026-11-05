// src/components/PaymentRequestsPanel.tsx
// ✅ Trang Thu chi > tab "Chờ duyệt thu chi"
//   - Phiếu từ hoá đơn, nút thu tiền, hoàn tiền, nhân viên báo thu nợ đều vào đây
//   - Kế toán và quản trị duyệt được cả tiền mặt lẫn chuyển khoản (server trả canDecide).
//   - Duyệt = lập phiếu PT/PC thật (vào sổ quỹ / tài khoản, đổi công nợ hoá đơn)
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { DialogShell } from "./SecondPassword";
import { ToastHost, useToast } from "./Toast";
import {
  Ico,
  ProofViewer,
  StatusChip,
  apiErr,
  methodLabel,
  money,
  viDate,
  viDateTime,
  type PRAccount,
  type PRStatus,
  type PaymentRequestRow,
} from "./PaymentRequestBits";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";
const btnGhost = `rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${focusRing}`;

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "PENDING", label: "Chờ duyệt" },
  { key: "APPROVED", label: "Đã duyệt" },
  { key: "REJECTED", label: "Bị từ chối" },
  { key: "CANCELLED", label: "Đã huỷ" },
  { key: "", label: "Tất cả" },
];

const typeWord = (r: PaymentRequestRow) => (r.type === "PAYMENT" ? "chi" : "thu");
const sourceLabel = (r: PaymentRequestRow) =>
  r.source === "SHIP_COST" ? "Tiền ship nhà xe" : r.source === "INVOICE" ? "Từ hoá đơn" : r.source === "MANUAL" ? (r.type === "PAYMENT" ? "Chi tiền" : "Thu tiền") : "NV báo thu nợ";
/** ngày theo giờ Việt Nam, dạng yyyy-mm-dd cho ô chọn ngày */
const vnYmdOf = (raw: string) => new Date(new Date(raw).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const QUICK_REASONS = ["Chưa thấy tiền về tài khoản", "Chưa nộp tiền mặt cho quỹ", "Sai số tiền", "Nhầm hoá đơn / nhầm khách"];

const PaymentRequestsPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const toast = useToast();

  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<PaymentRequestRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PRAccount[]>([]);
  const [q, setQ] = useState("");
  const [proofId, setProofId] = useState<string | null>(null);

  const [approve, setApprove] = useState<{ r: PaymentRequestRow; accountId: string; date: string; note: string } | null>(null);
  const [reject, setReject] = useState<{ r: PaymentRequestRow; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setRows(null);
    try {
      const res = await api.get("/payment-requests", { params: { status: status || undefined } });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setErr(apiErr(e, "Không tải được danh sách phiếu chờ duyệt"));
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get("/payment-accounts", { params: { active: 1 } })
      .then((r) => setAccounts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAccounts([]));
  }, []);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows || [];
    return (rows || []).filter((r) =>
      `${r.invoice.code} ${r.invoice.customerName} ${r.requestedBy.username} ${r.note || ""}`.toLowerCase().includes(kw)
    );
  }, [rows, q]);

  const pendingStats = useMemo(() => {
    const p = (rows || []).filter((r) => r.status === "PENDING");
    return {
      count: p.length,
      total: p.reduce((s, r) => s + r.amount, 0),
      cash: p.filter((r) => r.method === "CASH").reduce((s, r) => s + r.amount, 0),
      bank: p.filter((r) => r.method !== "CASH").reduce((s, r) => s + r.amount, 0),
    };
  }, [rows]);

  const openApprove = (r: PaymentRequestRow) => {
    setDlgErr(null);
    const cash = accounts.filter((a) => a.type === "CASH");
    const def = r.account?.id || (r.method === "CASH" && cash.length === 1 ? cash[0].id : "");
    setApprove({ r, accountId: def, date: vnYmdOf(r.paidDate), note: "" });
  };

  const doApprove = async () => {
    if (!approve) return;
    if (!approve.accountId) return setDlgErr("Chọn quỹ / tài khoản nhận tiền.");
    setBusy(true);
    setDlgErr(null);
    try {
      const res = await api.post(`/payment-requests/${approve.r.id}/approve`, {
        accountId: approve.accountId,
        date: approve.date,
        note: approve.note.trim() || undefined,
      });
      toast.push({
        type: "success",
        title: "Đã duyệt",
        message: `Đã lập phiếu ${res.data?.payment?.code || ""} — ${money(approve.r.amount)}đ, đã vào sổ thu chi.`,
      });
      setApprove(null);
      load();
      onChanged?.();
    } catch (e: any) {
      setDlgErr(apiErr(e, "Không duyệt được"));
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!reject) return;
    if (reject.reason.trim().length < 3) return setDlgErr("Ghi lý do để nhân viên biết mà sửa.");
    setBusy(true);
    setDlgErr(null);
    try {
      await api.post(`/payment-requests/${reject.r.id}/reject`, { reason: reject.reason.trim() });
      toast.push({ type: "info", title: "Đã từ chối", message: `Đã trả phiếu thu nợ HĐ ${reject.r.invoice.code} về cho ${reject.r.requestedBy.username}.` });
      setReject(null);
      load();
      onChanged?.();
    } catch (e: any) {
      setDlgErr(apiErr(e, "Không từ chối được"));
    } finally {
      setBusy(false);
    }
  };

  const accOf = (r: PaymentRequestRow) => (r.method === "CASH" ? accounts.filter((a) => a.type === "CASH") : accounts.filter((a) => a.type !== "CASH"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Chờ duyệt thu chi</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Phiếu thu, phiếu chi gắn hoá đơn. Duyệt rồi mới vào sổ thu chi và đổi công nợ.
          </p>
        </div>
        <input className={`${inputCls} sm:max-w-xs`} placeholder="Tìm HĐ, khách, nhân viên…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm phiếu thu nợ" />
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            type="button"
            onClick={() => setStatus(f.key)}
            aria-pressed={status === f.key}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${
              status === f.key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:text-slate-900"
            } ${focusRing}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {status === "PENDING" && rows && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">Đang chờ</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-amber-700">{pendingStats.count}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">Tổng tiền báo thu</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{money(pendingStats.total)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">{Ico.bank} Chuyển khoản</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{money(pendingStats.bank)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">{Ico.cash} Tiền mặt NV cầm</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{money(pendingStats.cash)}</div>
          </div>
        </div>
      )}

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {!rows ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">Đang tải…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
          <div className="text-base font-medium text-slate-800">{status === "PENDING" ? "Không có phiếu nào chờ duyệt" : "Không có phiếu thu nợ nào"}</div>
          {status === "PENDING" && <div className="mt-1 text-sm text-slate-500">Nhân viên báo đã thu ở trang “Công nợ của tôi”, phiếu thu nợ sẽ hiện ở đây.</div>}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => {
            const shortBy = r.debt && r.source !== "SHIP_COST" && r.amount > r.debt.remaining + 0.5;
            return (
              <li key={r.id} className={`rounded-xl border bg-white p-3 sm:p-4 ${shortBy ? "border-rose-200" : "border-slate-200"}`}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip status={r.status as PRStatus} />
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.type === "PAYMENT" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                        Phiếu {typeWord(r)}{r.kind === "WARRANTY_HOLD" ? " tiền giữ BH" : ""}
                      </span>
                      <span className="text-xs text-slate-500">{sourceLabel(r)}</span>
                      {r.status === "PENDING" && r.invoice.returned && (
                        <span
                          className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
                          title="Hoá đơn đã về nháp. Kiểm tra lại trước khi duyệt phiếu."
                        >
                          Hoá đơn bị trả về
                        </span>
                      )}
                      {r.status === "PENDING" && r.invoice.approved === false && !r.invoice.returned && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Hoá đơn chưa duyệt</span>
                      )}
                      <span className="text-sm font-medium text-slate-900">{r.requestedBy.username}</span>
                      <span className="text-xs text-slate-500">gửi {viDateTime(r.createdAt)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm">
                      <Link to={`/invoices/${r.invoice.id}`} className="font-medium text-sky-700 hover:underline">
                        HĐ {r.invoice.code}
                      </Link>
                      <span className="text-slate-400">·</span>
                      <span className="truncate text-slate-800">{r.invoice.customerName}</span>
                    </div>
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
                      <span className="mt-px shrink-0 text-slate-400">{r.method === "CASH" ? Ico.cash : Ico.bank}</span>
                      <span>
                        {methodLabel(r)} · ngày {viDate(r.paidDate)}
                      </span>
                    </div>
                    {r.note && <div className="mt-1.5 text-sm text-slate-700">“{r.note}”</div>}
                    {r.debt && r.source !== "SHIP_COST" && (
                      <div className={`mt-2 text-xs ${shortBy ? "font-medium text-rose-700" : "text-slate-500"}`}>
                        {shortBy
                          ? `⚠ Hoá đơn giờ chỉ còn nợ ${money(r.debt.remaining)}đ — ít hơn số báo. Nên từ chối.`
                          : `Hoá đơn còn nợ ${money(r.debt.remaining)}đ${r.debt.otherPending > 0 ? `, có thêm ${money(r.debt.otherPending)}đ phiếu thu nợ khác đang chờ` : ""}.`}
                      </div>
                    )}
                    {r.status === "REJECTED" && (
                      <div className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-sm text-rose-800">
                        Từ chối: {r.rejectReason} <span className="text-rose-600">— {r.decidedBy?.username}, {viDateTime(r.decidedAt)}</span>
                      </div>
                    )}
                    {r.status === "APPROVED" && (
                      <div className="mt-2 text-sm text-emerald-800">
                        Phiếu thu <b>{r.payment?.code}</b>
                        {r.payment?.voided ? <span className="text-rose-700"> (đã huỷ)</span> : null} · duyệt bởi {r.decidedBy?.username}, {viDateTime(r.decidedAt)}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-row items-center justify-between gap-2 md:flex-col md:items-end">
                    <div className="text-xl font-semibold tabular-nums text-slate-900">{money(r.amount)}</div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {r.hasProof && (
                        <button type="button" onClick={() => setProofId(r.id)} className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 ${focusRing}`}>
                          {Ico.image}
                          Ảnh CK
                        </button>
                      )}
                      {r.canDecide && r.status === "PENDING" && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setDlgErr(null);
                              setReject({ r, reason: "" });
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 ${focusRing}`}
                          >
                            {Ico.x}
                            Từ chối
                          </button>
                          <button
                            type="button"
                            onClick={() => openApprove(r)}
                            className={`inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 ${focusRing}`}
                          >
                            {Ico.check}
                            Duyệt
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ===== Duyệt ===== */}
      <DialogShell
        open={!!approve}
        title={approve?.r.type === "PAYMENT" ? "Duyệt & lập phiếu chi" : "Duyệt & lập phiếu thu"}
        subtitle={approve ? <>HĐ {approve.r.invoice.code} · {approve.r.invoice.customerName} · NV {approve.r.requestedBy.username}</> : null}
        onClose={() => !busy && setApprove(null)}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setApprove(null)} disabled={busy}>
              Để sau
            </button>
            <button
              type="button"
              onClick={doApprove}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 ${focusRing}`}
            >
              {Ico.check}
              {busy ? "Đang lập phiếu…" : `Duyệt ${approve ? money(approve.r.amount) : ""}đ`}
            </button>
          </>
        }
      >
        {approve && (
          <>
            <div className="flex items-baseline justify-between rounded-xl bg-emerald-50 px-4 py-3">
              <span className="text-sm text-emerald-900">Số tiền {approve.r.type === "PAYMENT" ? "chi" : "thu"}</span>
              <span className="text-2xl font-semibold tabular-nums text-emerald-900">{money(approve.r.amount)}</span>
            </div>
            {approve.r.method === "CASH" ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Tiền mặt nhân viên cầm: chỉ duyệt khi quỹ đã nhận đủ tiền.</div>
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">Kiểm tra sao kê / app ngân hàng thấy tiền về rồi mới duyệt.</div>
            )}
            <div>
              <span className={labelCls}>Ghi vào quỹ / tài khoản</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(accOf(approve.r).length ? accOf(approve.r) : accounts).map((a) => {
                  const on = approve.accountId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setApprove({ ...approve, accountId: a.id })}
                      aria-pressed={on}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left ${
                        on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                      } ${focusRing}`}
                    >
                      <span className={on ? "text-white" : "text-slate-500"}>{a.type === "CASH" ? Ico.cash : Ico.bank}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.name}</span>
                        <span className={`block truncate text-xs ${on ? "text-emerald-100" : "text-slate-500"}`}>
                          {a.id === approve.r.account?.id ? "đã chọn trên phiếu" : a.accountNo || a.code}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="ap-date">
                  Ngày ghi sổ
                </label>
                <input id="ap-date" type="date" className={inputCls} value={approve.date} onChange={(e) => setApprove({ ...approve, date: e.target.value })} />
                <p className="mt-1 text-xs text-slate-500">Mặc định là ngày trên phiếu.</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="ap-note">
                  Thêm ghi chú <span className="font-normal text-slate-400">(tuỳ chọn)</span>
                </label>
                <input id="ap-note" className={inputCls} value={approve.note} onChange={(e) => setApprove({ ...approve, note: e.target.value })} placeholder="VD: mã GD ngân hàng" />
              </div>
            </div>
            {dlgErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{dlgErr}</div>}
          </>
        )}
      </DialogShell>

      {/* ===== Từ chối ===== */}
      <DialogShell
        open={!!reject}
        tone="danger"
        title="Từ chối phiếu"
        subtitle={reject ? <>HĐ {reject.r.invoice.code} · {money(reject.r.amount)}đ · NV {reject.r.requestedBy.username}</> : null}
        onClose={() => !busy && setReject(null)}
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setReject(null)} disabled={busy}>
              Để sau
            </button>
            <button type="button" onClick={doReject} disabled={busy} className={`rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60 ${focusRing}`}>
              {busy ? "Đang gửi…" : "Từ chối"}
            </button>
          </>
        }
      >
        {reject && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setReject({ ...reject, reason: t })}
                  className={`rounded-full border px-2.5 py-1 text-xs ${reject.reason === t ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"} ${focusRing}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div>
              <label className={labelCls} htmlFor="rj-reason">
                Lý do (người tạo phiếu sẽ thấy)
              </label>
              <textarea id="rj-reason" rows={3} className={inputCls} value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })} maxLength={500} autoFocus />
            </div>
            <p className="text-xs text-slate-500">Từ chối không đụng tới công nợ. Nhân viên sửa lại rồi lập phiếu mới.</p>
            {dlgErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{dlgErr}</div>}
          </>
        )}
      </DialogShell>

      <ProofViewer requestId={proofId} onClose={() => setProofId(null)} />
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />
    </div>
  );
};

export default PaymentRequestsPanel;
