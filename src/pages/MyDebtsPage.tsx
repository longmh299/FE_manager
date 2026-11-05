// src/pages/MyDebtsPage.tsx
// ✅ Công nợ của tôi (nhân viên bán hàng)
//   - Mọi hoá đơn MÌNH bán còn nợ (không giới hạn tháng), gom theo khách, nợ lâu nhất lên đầu
//   - "Báo đã thu": gửi phiếu thu nợ -> quản trị duyệt mới thành phiếu thu (chưa duyệt thì công nợ chưa đổi)
//   - Tab "Phiếu thu nợ đã gửi": theo dõi chờ duyệt / đã duyệt (số phiếu PT) / bị từ chối (lý do), tự huỷ khi báo nhầm
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { postOnce } from "../api/client";
import { DialogShell } from "../components/SecondPassword";
import { ToastHost, useToast } from "../components/Toast";
import {
  Ico,
  ProofViewer,
  StatusChip,
  apiErr,
  methodLabel,
  money,
  viDate,
  viDateTime,
  vnToday,
  type PRAccount,
  type PRStatus,
  type PaymentRequestRow,
} from "../components/PaymentRequestBits";

type DebtRow = {
  invoiceId: string;
  invoiceCode: string;
  issueDate: string;
  partnerId: string | null;
  customerName: string;
  customerPhone: string | null;
  total: number;
  collectible: number;
  paid: number;
  remaining: number;
  holdRemaining: number;
  warrantyDueDate: string | null;
  pendingAmount: number;
  pendingCount: number;
  canRequest: number;
};
type DebtResp = { summary: { invoiceCount: number; customerCount: number; remaining: number; pending: number }; rows: DebtRow[] };

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

function daysSince(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
const ageCls = (days: number) =>
  days > 60 ? "bg-rose-50 text-rose-700 ring-rose-200" : days > 30 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200";

/* ============================ Hộp thoại báo đã thu ============================ */

type ReportForm = { amount: number; amountText: string; date: string; method: "CASH" | "BANK"; accountId: string; note: string; file: File | null };

const ReportDialog: React.FC<{
  row: DebtRow | null;
  accounts: PRAccount[];
  onClose: () => void;
  onSent: (r: PaymentRequestRow) => void;
}> = ({ row, accounts, onClose, onSent }) => {
  const cashAccs = accounts.filter((a) => a.type === "CASH");
  const bankAccs = accounts.filter((a) => a.type !== "CASH");
  const [f, setF] = useState<ReportForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const amtRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!row) return;
    setF({ amount: 0, amountText: "", date: vnToday(), method: "BANK", accountId: bankAccs.length === 1 ? bankAccs[0].id : "", note: "", file: null });
    setErr(null);
    setBusy(null);
    setTimeout(() => amtRef.current?.focus(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  useEffect(() => {
    if (!f?.file) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(f.file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [f?.file]);

  if (!row || !f) return null;
  const max = row.canRequest;
  const set = (p: Partial<ReportForm>) => setF((cur) => (cur ? { ...cur, ...p } : cur));
  const setAmount = (n: number) => set({ amount: n, amountText: n ? money(n) : "" });
  const over = f.amount > max + 0.5;
  const accList = f.method === "CASH" ? cashAccs : bankAccs;

  const pickMethod = (m: "CASH" | "BANK") => {
    const list = m === "CASH" ? cashAccs : bankAccs;
    set({ method: m, accountId: list.length === 1 ? list[0].id : list.some((a) => a.id === f.accountId) ? f.accountId : "" });
  };

  const pickFile = (file: File | null) => {
    if (!file) return set({ file: null });
    if (!/^image\//.test(file.type)) return setErr("Chỉ chọn ảnh (chụp màn hình chuyển khoản).");
    if (file.size > 10 * 1024 * 1024) return setErr("Ảnh quá lớn, tối đa 10MB.");
    setErr(null);
    set({ file });
  };

  const submit = async () => {
    setErr(null);
    if (!(f.amount > 0)) return setErr("Nhập số tiền khách đã trả.");
    if (over) return setErr(`Tối đa ${money(max)}đ cho hoá đơn này.`);
    if (f.method === "BANK" && !f.accountId) return setErr("Chọn tài khoản khách đã chuyển vào.");
    try {
      let proof: { proofKey: string; proofName: string; proofMime: string } | null = null;
      if (f.file) {
        setBusy("Đang tải ảnh lên…");
        const init = await api.post("/payment-requests/proof-upload", { fileName: f.file.name, mimeType: f.file.type, fileSize: f.file.size });
        const put = await fetch(init.data.uploadUrl, { method: "PUT", headers: { "Content-Type": f.file.type }, body: f.file });
        if (!put.ok) throw new Error("Tải ảnh lên không được. Thử lại, hoặc bỏ ảnh rồi gửi.");
        proof = { proofKey: init.data.key, proofName: f.file.name, proofMime: f.file.type };
      }
      setBusy("Đang gửi…");
      const res = await postOnce("/payment-requests", {
        invoiceId: row.invoiceId,
        amount: f.amount,
        method: f.method,
        accountId: f.accountId || null,
        paidDate: f.date,
        note: f.note.trim() || undefined,
        ...(proof || {}),
      });
      onSent(res.data);
    } catch (e: any) {
      setErr(apiErr(e, "Không gửi được phiếu thu nợ"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <DialogShell
      open
      title="Báo khách đã trả tiền"
      subtitle={
        <>
          Hoá đơn <b className="text-slate-700">{row.invoiceCode}</b> · {row.customerName}
        </>
      }
      onClose={() => !busy && onClose()}
      width="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className={`rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${focusRing}`}
          >
            Để sau
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!!busy}
            className={`inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 ${focusRing}`}
          >
            {Ico.send}
            {busy || "Gửi duyệt"}
          </button>
        </>
      }
    >
      {/* tóm tắt hoá đơn */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Còn nợ</div>
          <div className="mt-0.5 font-semibold tabular-nums text-rose-700">{money(row.remaining)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Đang chờ duyệt</div>
          <div className="mt-0.5 font-semibold tabular-nums text-amber-700">{money(row.pendingAmount)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Báo thêm tối đa</div>
          <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(max)}</div>
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="rq-amt">
          Số tiền khách trả
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id="rq-amt"
              ref={amtRef}
              inputMode="numeric"
              className={`${inputCls} pr-8 text-right text-base font-semibold tabular-nums ${over ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/20" : ""}`}
              placeholder="0"
              value={f.amountText}
              onChange={(e) => setAmount(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">đ</span>
          </div>
          <button
            type="button"
            onClick={() => setAmount(max)}
            className={`whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 ${focusRing}`}
          >
            Trả đủ
          </button>
        </div>
        {over && <p className="mt-1 text-xs text-rose-600">Vượt số còn có thể báo ({money(max)}đ).</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div>
          <label className={labelCls} htmlFor="rq-date">
            Ngày khách trả
          </label>
          <input id="rq-date" type="date" max={vnToday()} className={inputCls} value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div>
          <span className={labelCls}>Khách trả bằng</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Hình thức">
            {(["BANK", "CASH"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={f.method === m}
                onClick={() => pickMethod(m)}
                className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium ${
                  f.method === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                } ${focusRing}`}
              >
                {m === "CASH" ? Ico.cash : Ico.bank}
                {m === "CASH" ? "Tiền mặt" : "Chuyển khoản"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <span className={labelCls}>{f.method === "CASH" ? "Nộp vào quỹ" : "Khách chuyển vào tài khoản"}</span>
        {accList.length === 0 ? (
          <p className="text-sm text-slate-500">{f.method === "CASH" ? "Chưa có quỹ tiền mặt, quản trị sẽ chọn khi duyệt." : "Chưa có tài khoản ngân hàng nào, báo quản trị."}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {accList.map((a) => {
              const on = f.accountId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => set({ accountId: on && f.method === "CASH" ? "" : a.id })}
                  aria-pressed={on}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                  } ${focusRing}`}
                >
                  <span className={on ? "text-white" : "text-slate-500"}>{a.type === "CASH" ? Ico.cash : Ico.bank}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    {a.accountNo && <span className={`block truncate text-xs ${on ? "text-slate-300" : "text-slate-500"}`}>{a.accountNo}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {f.method === "CASH" && <p className="mt-1.5 text-xs text-slate-500">Tiền mặt: nhớ nộp tiền cho quỹ, quản trị nhận đủ tiền mới duyệt.</p>}
      </div>

      <div>
        <label className={labelCls} htmlFor="rq-note">
          Ghi chú <span className="font-normal text-slate-400">(tuỳ chọn)</span>
        </label>
        <textarea
          id="rq-note"
          rows={2}
          className={inputCls}
          placeholder="VD: khách CK lúc 9h, nội dung ‘TT HD 1003’"
          value={f.note}
          onChange={(e) => set({ note: e.target.value })}
          maxLength={500}
        />
      </div>

      <div>
        <span className={labelCls}>
          Ảnh chuyển khoản <span className="font-normal text-slate-400">(tuỳ chọn)</span>
        </span>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
        {preview ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2">
            <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1 truncate text-sm text-slate-700">{f.file?.name}</div>
            <button
              type="button"
              onClick={() => {
                set({ file: null });
                if (fileRef.current) fileRef.current.value = "";
              }}
              className={`rounded-lg px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 ${focusRing}`}
            >
              Bỏ ảnh
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50 ${focusRing}`}
          >
            {Ico.image}
            Chọn / chụp ảnh
          </button>
        )}
      </div>

      {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{err}</div>}
      <p className="text-xs text-slate-500">Gửi xong, công nợ chưa đổi ngay. Quản trị duyệt thì hệ thống mới lập phiếu thu và trừ nợ.</p>
    </DialogShell>
  );
};

/* ============================ Trang ============================ */

const STATUS_TABS: Array<{ key: "" | PRStatus; label: string }> = [
  { key: "", label: "Tất cả" },
  { key: "PENDING", label: "Chờ duyệt" },
  { key: "APPROVED", label: "Đã duyệt" },
  { key: "REJECTED", label: "Bị từ chối" },
  { key: "CANCELLED", label: "Đã huỷ" },
];

const MyDebtsPage: React.FC = () => {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") === "requests" ? "requests" : "debts";
  const setView = (v: "debts" | "requests") => {
    const n = new URLSearchParams(sp);
    if (v === "debts") n.delete("view");
    else n.set("view", v);
    setSp(n, { replace: true });
  };

  const [debts, setDebts] = useState<DebtResp | null>(null);
  const [reqs, setReqs] = useState<PaymentRequestRow[] | null>(null);
  const [accounts, setAccounts] = useState<PRAccount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stFilter, setStFilter] = useState<"" | PRStatus>("");
  const [reportRow, setReportRow] = useState<DebtRow | null>(null);
  const [proofId, setProofId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PaymentRequestRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [d, r] = await Promise.all([api.get("/payment-requests/my-debts"), api.get("/payment-requests", { params: { mine: 1 } })]);
      setDebts(d.data);
      setReqs(r.data);
      window.dispatchEvent(new Event("payreq:changed"));
    } catch (e: any) {
      setErr(apiErr(e, "Không tải được công nợ"));
    }
  }, []);

  useEffect(() => {
    load();
    api
      .get("/payment-accounts", { params: { active: 1 } })
      .then((r) => setAccounts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAccounts([]));
  }, [load]);

  const groups = useMemo(() => {
    const rows = debts?.rows || [];
    const kw = q.trim().toLowerCase();
    const filtered = kw
      ? rows.filter((r) => `${r.customerName} ${r.invoiceCode} ${r.customerPhone || ""}`.toLowerCase().includes(kw))
      : rows;
    const m = new Map<string, { key: string; name: string; phone: string | null; remaining: number; pending: number; oldest: number; rows: DebtRow[] }>();
    for (const r of filtered) {
      const k = r.partnerId || r.customerName;
      const g = m.get(k) || { key: k, name: r.customerName, phone: r.customerPhone, remaining: 0, pending: 0, oldest: 0, rows: [] };
      g.remaining += r.remaining;
      g.pending += r.pendingAmount;
      g.oldest = Math.max(g.oldest, daysSince(r.issueDate));
      if (!g.phone && r.customerPhone) g.phone = r.customerPhone;
      g.rows.push(r);
      m.set(k, g);
    }
    return Array.from(m.values()).sort((a, b) => b.oldest - a.oldest || b.remaining - a.remaining);
  }, [debts, q]);

  const reqCounts = useMemo(() => {
    const c: Record<string, number> = { "": reqs?.length || 0 };
    for (const r of reqs || []) c[r.status] = (c[r.status] || 0) + 1;
    // ✅ chỉ đếm phiếu bị từ chối mà hoá đơn còn nợ: hoá đơn đã thu đủ thì không còn việc phải làm
    c.REJECTED_TODO = (reqs || []).filter((r) => r.status === "REJECTED" && !r.invoice?.settled).length;
    return c;
  }, [reqs]);
  const shownReqs = useMemo(() => (reqs || []).filter((r) => !stFilter || r.status === stFilter), [reqs, stFilter]);

  const sum = debts?.summary;
  const over60 = (debts?.rows || []).filter((r) => daysSince(r.issueDate) > 60).reduce((s, r) => s + r.remaining, 0);

  const doCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelErr(null);
    try {
      await api.post(`/payment-requests/${cancelTarget.id}/cancel`);
      toast.push({ type: "success", title: "Đã huỷ", message: `Đã huỷ phiếu thu nợ ${money(cancelTarget.amount)}đ của hoá đơn ${cancelTarget.invoice.code}.` });
      setCancelTarget(null);
      load();
    } catch (e: any) {
      setCancelErr(apiErr(e, "Không huỷ được"));
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Công nợ của tôi</h1>
          <p className="mt-0.5 text-sm text-slate-500">Khách nào còn nợ, trả tiền rồi thì bấm “Báo đã thu” để quản trị duyệt.</p>
        </div>
        <Link to="/me/sales" className="text-sm font-medium text-sky-700 hover:underline">
          ← Doanh số của tôi
        </Link>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="text-xs text-slate-500">Còn phải thu</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-rose-700 sm:text-2xl">{sum ? money(sum.remaining) : "…"}</div>
          <div className="mt-0.5 text-xs text-slate-500">{sum ? `${sum.invoiceCount} hoá đơn · ${sum.customerCount} khách` : ""}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="text-xs text-slate-500">Đã báo, chờ duyệt</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-amber-700 sm:text-2xl">{sum ? money(sum.pending) : "…"}</div>
          <div className="mt-0.5 text-xs text-slate-500">{reqCounts.PENDING || 0} phiếu thu nợ</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="text-xs text-slate-500">Nợ quá 60 ngày</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${over60 > 0 ? "text-rose-700" : "text-slate-900"}`}>{debts ? money(over60) : "…"}</div>
          <div className="mt-0.5 text-xs text-slate-500">ưu tiên gọi trước</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="text-xs text-slate-500">Bị từ chối</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${(reqCounts.REJECTED_TODO || 0) > 0 ? "text-rose-700" : "text-slate-900"}`}>{reqCounts.REJECTED_TODO || 0}</div>
          <button type="button" onClick={() => { setView("requests"); setStFilter("REJECTED"); }} className="mt-0.5 text-xs font-medium text-sky-700 hover:underline">
            Xem lý do
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {/* tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist">
          {(
            [
              ["debts", "Khách còn nợ", debts?.rows.length ?? 0],
              ["requests", "Phiếu thu nợ đã gửi", reqCounts.PENDING || 0],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              type="button"
              onClick={() => setView(k)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${view === k ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"} ${focusRing}`}
            >
              {label}
              {n > 0 && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${view === k ? "bg-white/20" : k === "requests" ? "bg-amber-100 text-amber-800" : "bg-slate-100"}`}>{n}</span>
              )}
            </button>
          ))}
        </div>
        {view === "debts" && (
          <input className={`${inputCls} sm:max-w-xs`} placeholder="Tìm khách, số hoá đơn, SĐT…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm" />
        )}
      </div>

      {/* ========== khách còn nợ ========== */}
      {view === "debts" &&
        (!debts ? (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">Đang tải…</div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
            <div className="text-base font-medium text-slate-800">{q ? "Không tìm thấy" : "Không còn khách nào nợ 🎉"}</div>
            <div className="mt-1 text-sm text-slate-500">{q ? "Thử từ khoá khác." : "Mọi hoá đơn bạn bán đã thu đủ."}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <section key={g.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{g.name}</div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                      <span>{g.rows.length} hoá đơn</span>
                      {g.phone && (
                        <a href={`tel:${g.phone}`} className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline">
                          {Ico.phone}
                          {g.phone}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums text-rose-700">{money(g.remaining)}</div>
                    {g.pending > 0 && <div className="text-xs tabular-nums text-amber-700">chờ duyệt {money(g.pending)}</div>}
                  </div>
                </header>
                <ul className="divide-y divide-slate-100">
                  {g.rows.map((r) => {
                    const days = daysSince(r.issueDate);
                    return (
                      <li key={r.invoiceId} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/invoices/${r.invoiceId}`} className="font-medium text-slate-900 hover:text-sky-700 hover:underline">
                              HĐ {r.invoiceCode}
                            </Link>
                            <span className="text-xs text-slate-500">{viDate(r.issueDate)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ageCls(days)}`}>{days} ngày</span>
                            {r.pendingAmount > 0 && <StatusChip status="PENDING" />}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                            <span>
                              Tổng <b className="font-medium tabular-nums text-slate-700">{money(r.total)}</b>
                            </span>
                            <span>
                              Đã thu <b className="font-medium tabular-nums text-slate-700">{money(r.paid)}</b>
                            </span>
                            <span>
                              Còn nợ <b className="font-semibold tabular-nums text-rose-700">{money(r.remaining)}</b>
                            </span>
                            {r.pendingAmount > 0 && (
                              <span>
                                Chờ duyệt <b className="font-medium tabular-nums text-amber-700">{money(r.pendingAmount)}</b>
                              </span>
                            )}
                            {r.holdRemaining > 0 && (
                              <span title="Phần giữ lại bảo hành, thu khi hết hạn bảo hành">
                                Giữ BH <b className="font-medium tabular-nums text-slate-700">{money(r.holdRemaining)}</b>
                                {r.warrantyDueDate ? ` (đến ${viDate(r.warrantyDueDate)})` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={r.canRequest <= 0}
                          onClick={() => setReportRow(r)}
                          title={r.canRequest <= 0 ? "Đã báo đủ số còn nợ, đang chờ duyệt" : undefined}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium sm:py-1.5 ${
                            r.canRequest > 0 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "cursor-not-allowed bg-slate-100 text-slate-400"
                          } ${focusRing}`}
                        >
                          {Ico.check}
                          {r.canRequest > 0 ? "Báo đã thu" : "Đã báo đủ"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ))}

      {/* ========== phiếu thu nợ đã gửi ========== */}
      {view === "requests" && (
        <div className="space-y-3">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key || "all"}
                type="button"
                onClick={() => setStFilter(t.key)}
                aria-pressed={stFilter === t.key}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${
                  stFilter === t.key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:text-slate-900"
                } ${focusRing}`}
              >
                {t.label}
                <span className="ml-1 tabular-nums opacity-70">{reqCounts[t.key] || 0}</span>
              </button>
            ))}
          </div>
          {!reqs ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">Đang tải…</div>
          ) : shownReqs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">Chưa có phiếu thu nợ nào.</div>
          ) : (
            <ul className="space-y-2">
              {shownReqs.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip status={r.status} />
                        <Link to={`/invoices/${r.invoice.id}`} className="font-medium text-slate-900 hover:text-sky-700 hover:underline">
                          HĐ {r.invoice.code}
                        </Link>
                        <span className="truncate text-sm text-slate-600">{r.invoice.customerName}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {methodLabel(r)} · khách trả ngày {viDate(r.paidDate)} · gửi lúc {viDateTime(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-right text-lg font-semibold tabular-nums text-slate-900">{money(r.amount)}</div>
                  </div>
                  {r.note && <div className="mt-2 text-sm text-slate-700">“{r.note}”</div>}
                  {r.status === "REJECTED" && (
                    <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${r.invoice?.settled ? "bg-slate-100 text-slate-700" : "bg-rose-50 text-rose-800"}`}>
                      {r.invoice?.settled && <div className="mb-0.5 font-medium">Hoá đơn đã thu đủ, không cần làm gì thêm.</div>}
                      <b>Lý do từ chối:</b> {r.rejectReason}
                      <span className={r.invoice?.settled ? "text-slate-500" : "text-rose-600"}> — {r.decidedBy?.username}, {viDateTime(r.decidedAt)}</span>
                    </div>
                  )}
                  {r.status === "APPROVED" && (
                    <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      Đã lập phiếu thu <b>{r.payment?.code || "…"}</b>, công nợ đã trừ. Duyệt bởi {r.decidedBy?.username}, {viDateTime(r.decidedAt)}.
                      {r.payment?.voided && <span className="font-medium text-rose-700"> Phiếu này sau đó đã bị huỷ.</span>}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.hasProof && (
                      <button type="button" onClick={() => setProofId(r.id)} className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 ${focusRing}`}>
                        {Ico.image}
                        Xem ảnh CK
                      </button>
                    )}
                    {r.status === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelErr(null);
                          setCancelTarget(r);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 ${focusRing}`}
                      >
                        {Ico.x}
                        Huỷ phiếu thu nợ
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ReportDialog
        row={reportRow}
        accounts={accounts}
        onClose={() => setReportRow(null)}
        onSent={(r) => {
          setReportRow(null);
          toast.push({ type: "success", title: "Đã gửi", message: `Đã báo thu ${money(r.amount)}đ cho hoá đơn ${r.invoice.code}. Chờ duyệt.` });
          load();
        }}
      />

      <DialogShell
        open={!!cancelTarget}
        tone="danger"
        title="Huỷ phiếu thu nợ này?"
        subtitle={cancelTarget ? <>HĐ {cancelTarget.invoice.code} · {money(cancelTarget.amount)}đ</> : null}
        onClose={() => !cancelBusy && setCancelTarget(null)}
        footer={
          <>
            <button type="button" onClick={() => setCancelTarget(null)} disabled={cancelBusy} className={`rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${focusRing}`}>
              Giữ lại
            </button>
            <button type="button" onClick={doCancel} disabled={cancelBusy} className={`rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60 ${focusRing}`}>
              {cancelBusy ? "Đang huỷ…" : "Huỷ phiếu thu nợ"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Dùng khi báo nhầm số tiền hoặc nhầm hoá đơn. Huỷ xong có thể báo lại.</p>
        {cancelErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{cancelErr}</div>}
      </DialogShell>

      <ProofViewer requestId={proofId} onClose={() => setProofId(null)} />
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />
    </div>
  );
};

export default MyDebtsPage;
