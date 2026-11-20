// src/components/DepositRequestDialog.tsx
// ✅ Nhân viên sale báo khách đã đặt cọc (chưa có hoá đơn) -> chờ admin / kế toán duyệt
import React, { useEffect, useState } from "react";
import api, { postOnce } from "../api/client";
import { DialogShell } from "./SecondPassword";
import { vnToday, type PRAccount } from "./PaymentRequestBits";

type P = { id: string; name: string; code?: string | null; phone?: string | null };
const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";
const errOf = (e: unknown, d: string) => {
  const x = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return x?.response?.data?.message || x?.response?.data?.error || x?.message || d;
};

const DepositRequestDialog: React.FC<{ open: boolean; accounts: PRAccount[]; onClose: () => void; onSent: (amount: number) => void }> = ({
  open,
  accounts,
  onClose,
  onSent,
}) => {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<P[]>([]);
  const [partner, setPartner] = useState<P | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<"BANK" | "CASH">("BANK");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(vnToday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || partner || q.trim().length < 2) return setOpts([]);
    const t = setTimeout(() => {
      api
        .get("/partners", { params: { q: q.trim(), page: 1, pageSize: 10 } })
        .then((r) => {
          const b = r.data;
          setOpts(Array.isArray(b?.data) ? b.data : Array.isArray(b?.items) ? b.items : Array.isArray(b) ? b : []);
        })
        .catch(() => setOpts([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, partner, open]);

  if (!open) return null;
  const accs = accounts.filter((a) => (method === "CASH" ? a.type === "CASH" : a.type !== "CASH"));

  const submit = async () => {
    setErr(null);
    if (!partner) return setErr("Chọn khách đặt cọc.");
    if (!(amount > 0)) return setErr("Nhập số tiền cọc.");
    if (method === "BANK" && !accountId) return setErr("Chọn tài khoản khách đã chuyển vào.");
    setBusy(true);
    try {
      await postOnce("/payment-requests/deposit", {
        partnerId: partner.id,
        amount,
        method,
        accountId: accountId || null,
        paidDate: date,
        note: note.trim() || undefined,
      });
      onSent(amount);
      setPartner(null);
      setQ("");
      setAmount(0);
      setNote("");
    } catch (e) {
      setErr(errOf(e, "Không gửi được."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open
      title="Báo khách đặt cọc"
      subtitle="Khách cọc khi chưa có hoá đơn. Quản trị duyệt xong, lúc lập hoá đơn sẽ trừ tiền cọc vào."
      onClose={() => !busy && onClose()}
      width="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700">
            Để sau
          </button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {busy ? "Đang gửi…" : "Gửi duyệt"}
          </button>
        </>
      }
    >
      <div className="relative">
        <label className={labelCls}>Khách</label>
        <input
          className={inputCls}
          placeholder="Gõ tên, mã hoặc số điện thoại khách…"
          value={partner ? partner.name : q}
          onChange={(e) => {
            setPartner(null);
            setQ(e.target.value);
          }}
        />
        {!partner && opts.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
            {opts.map((p) => (
              <button key={p.id} type="button" onClick={() => setPartner(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-sky-50">
                {p.name}
                {p.phone ? <span className="ml-2 text-xs text-slate-400">{p.phone}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className={labelCls}>Số tiền cọc</label>
        <input
          inputMode="numeric"
          className={`${inputCls} text-right font-semibold`}
          value={amount ? amount.toLocaleString("vi-VN") : ""}
          onChange={(e) => setAmount(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Ngày khách cọc</label>
          <input type="date" max={vnToday()} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Khách trả bằng</label>
          <select
            className={inputCls}
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as "BANK" | "CASH");
              setAccountId("");
            }}
          >
            <option value="BANK">Chuyển khoản</option>
            <option value="CASH">Tiền mặt</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>{method === "BANK" ? "Khách chuyển vào tài khoản" : "Nộp vào quỹ (tuỳ chọn)"}</label>
        <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">-- Chọn --</option>
          {accs.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.accountNo ? ` · ${a.accountNo}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Ghi chú (máy, hợp đồng…)</label>
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </DialogShell>
  );
};

export default DepositRequestDialog;
