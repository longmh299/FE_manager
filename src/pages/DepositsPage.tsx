// src/pages/DepositsPage.tsx
// ✅ Tiền đặt cọc: thu cọc khách / trả cọc nhà cung cấp khi chưa có hoá đơn, hoàn cọc.
// Trừ cọc vào hoá đơn làm ở trang hoá đơn.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { postOnce } from "../api/client";

type Kind = "RECEIPT" | "PAYMENT";
type Account = { id: string; name: string; type?: string; isActive?: boolean };
type Partner = { id: string; name: string; code?: string | null; phone?: string | null };
type Deposit = {
  id: string;
  code: string | null;
  date: string;
  type: Kind;
  amount: number;
  applied: number;
  refunded: number;
  remaining: number;
  note: string | null;
  partner: { id: string; name: string; code?: string | null } | null;
  account: { id: string; name: string } | null;
  allocations: Array<{ invoiceId: string; invoiceCode: string | null; amount: number }>;
};

const money = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("vi-VN")} đ`;
const today = () => {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};
const viDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
};
const errMsg = (e: unknown) => {
  const x = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return x?.response?.data?.message || x?.response?.data?.error || x?.message || "Có lỗi xảy ra.";
};
const parseMoney = (s: string) => Number(String(s || "").replace(/[^\d]/g, "")) || 0;
const fmtInput = (s: string) => {
  const n = parseMoney(s);
  return n ? n.toLocaleString("vi-VN") : "";
};

async function fetchPartners(): Promise<Partner[]> {
  const out: Partner[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = (await api.get("/partners", { params: { q: "", page, pageSize: 500 } })).data;
    const arr: Partner[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    out.push(...arr);
    if (arr.length < 500) break;
  }
  return out;
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none";

const DepositsPage: React.FC = () => {
  const [kind, setKind] = useState<Kind>("RECEIPT");
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<Deposit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);

  // form lập phiếu cọc
  const [openForm, setOpenForm] = useState(false);
  const [pq, setPq] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // hoàn cọc
  const [refund, setRefund] = useState<{ dep: Deposit; amount: string; date: string; accountId: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await api.get("/deposits", { params: { type: kind, all: showAll ? 1 : undefined } })).data;
      setRows(r.items || []);
      setTotal(Number(r.totalRemaining || 0));
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setLoading(false);
    }
  }, [kind, showAll]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get("/payment-accounts", { params: { active: 1 } })
      .then((r) => setAccounts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAccounts([]));
    fetchPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
  }, []);

  const partnerMatches = useMemo(() => {
    const kw = pq.trim().toLowerCase();
    if (!kw || partners.some((p) => p.id === partnerId && p.name === pq)) return [];
    return partners
      .filter((p) => `${p.name} ${p.code || ""} ${p.phone || ""}`.toLowerCase().includes(kw))
      .slice(0, 8);
  }, [pq, partners, partnerId]);

  const isRec = kind === "RECEIPT";

  async function submit() {
    setMsg(null);
    if (!partnerId) return setMsg({ ok: false, text: isRec ? "Chọn khách đặt cọc." : "Chọn nhà cung cấp." });
    if (!parseMoney(amount)) return setMsg({ ok: false, text: "Nhập số tiền cọc." });
    if (!accountId) return setMsg({ ok: false, text: isRec ? "Chọn tài khoản nhận tiền." : "Chọn tài khoản chi tiền." });
    setSaving(true);
    try {
      await postOnce("/deposits", { type: kind, partnerId, amount: parseMoney(amount), date, accountId, note: note.trim() || undefined });
      setMsg({ ok: true, text: isRec ? "Đã ghi phiếu thu cọc." : "Đã ghi phiếu trả cọc." });
      setOpenForm(false);
      setPq("");
      setPartnerId("");
      setAmount("");
      setNote("");
      load();
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }

  async function submitRefund() {
    if (!refund) return;
    setMsg(null);
    if (!parseMoney(refund.amount)) return setMsg({ ok: false, text: "Nhập số tiền hoàn cọc." });
    if (!refund.accountId) return setMsg({ ok: false, text: "Chọn tài khoản." });
    setSaving(true);
    try {
      await postOnce(`/deposits/${refund.dep.id}/refund`, {
        amount: parseMoney(refund.amount),
        date: refund.date,
        accountId: refund.accountId,
        note: refund.note.trim() || undefined,
      });
      setMsg({ ok: true, text: "Đã ghi phiếu hoàn cọc." });
      setRefund(null);
      load();
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }

  const accSelect = (value: string, onChange: (v: string) => void) => (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-- Chọn tài khoản --</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-800">Tiền đặt cọc</h1>
        <Link to="/cashbook" className="text-sm text-sky-700 hover:underline">
          ← Sổ quỹ
        </Link>
        <button
          type="button"
          onClick={() => {
            setOpenForm((v) => !v);
            setMsg(null);
          }}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + {isRec ? "Thu cọc khách" : "Trả cọc nhà cung cấp"}
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Tiền khách cọc (hoặc công ty cọc nhà cung cấp) khi <b>chưa có hoá đơn</b>. Tiền vào sổ quỹ ngay, không tính doanh số. Khi có hoá đơn, vào hoá
        đơn bấm <b>Trừ tiền cọc</b>.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(["RECEIPT", "PAYMENT"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setOpenForm(false);
              setRefund(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${kind === k ? "bg-sky-100 text-sky-800" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {k === "RECEIPT" ? "Khách cọc (bán)" : "Cọc nhà cung cấp (mua)"}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Hiện cả phiếu đã trừ hết
        </label>
        <span className="ml-auto text-sm text-slate-600">
          Cọc còn lại: <b className="text-slate-900">{money(total)}</b>
        </span>
      </div>

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>
      )}

      {openForm && (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <div className="relative md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500">{isRec ? "Khách đặt cọc" : "Nhà cung cấp"}</label>
            <input
              className={inputCls}
              value={pq}
              placeholder="Gõ tên, mã hoặc số điện thoại…"
              onChange={(e) => {
                setPq(e.target.value);
                setPartnerId("");
              }}
            />
            {partnerMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                {partnerMatches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPartnerId(p.id);
                      setPq(p.name);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-sky-50"
                  >
                    {p.name}
                    {p.code ? <span className="ml-2 text-xs text-slate-400">{p.code}</span> : null}
                    {p.phone ? <span className="ml-2 text-xs text-slate-400">{p.phone}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Số tiền cọc</label>
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(fmtInput(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">{isRec ? "Ngày khách chuyển / nộp" : "Ngày chuyển cọc"}</label>
            <input type="date" className={inputCls} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">{isRec ? "Tiền vào tài khoản" : "Chi từ tài khoản"}</label>
            {accSelect(accountId, setAccountId)}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Ghi chú (số hợp đồng, báo giá, máy…)</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex gap-2 md:col-span-2">
            <button
              type="button"
              disabled={saving}
              onClick={submit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Đang lưu…" : "Lưu phiếu cọc"}
            </button>
            <button type="button" onClick={() => setOpenForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Huỷ
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-3 py-2">Số phiếu</th>
              <th className="px-3 py-2">Ngày</th>
              <th className="px-3 py-2">{isRec ? "Khách" : "Nhà cung cấp"}</th>
              <th className="px-3 py-2 text-right">Tiền cọc</th>
              <th className="px-3 py-2 text-right">Đã trừ HĐ</th>
              <th className="px-3 py-2 text-right">Đã hoàn</th>
              <th className="px-3 py-2 text-right">Còn lại</th>
              <th className="px-3 py-2">Tài khoản / ghi chú</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Đang tải…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Không có tiền cọc {showAll ? "" : "còn lại"}.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((d) => (
                <React.Fragment key={d.id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-medium">{d.code || "—"}</td>
                    <td className="px-3 py-2">{viDate(d.date)}</td>
                    <td className="px-3 py-2">
                      {d.partner ? (
                        <Link to={`/partners/${d.partner.id}`} className="text-sky-700 hover:underline">
                          {d.partner.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{money(d.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      {d.applied ? money(d.applied) : "—"}
                      {d.allocations.length > 0 && (
                        <div className="text-xs text-slate-400">
                          {d.allocations.map((a) => (
                            <Link key={a.invoiceId} to={`/invoices/${a.invoiceId}`} className="mr-1 hover:underline">
                              {a.invoiceCode || "HĐ"}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{d.refunded ? money(d.refunded) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{money(d.remaining)}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {d.account?.name || ""}
                      {d.note ? <div className="text-xs">{d.note}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {d.remaining > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setRefund({ dep: d, amount: Math.round(d.remaining).toLocaleString("vi-VN"), date: today(), accountId: d.account?.id || "", note: "" })
                          }
                          className="rounded-lg px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                        >
                          Hoàn cọc
                        </button>
                      )}
                    </td>
                  </tr>
                  {refund?.dep.id === d.id && (
                    <tr className="bg-amber-50/50">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="grid gap-2 md:grid-cols-5">
                          <div className="text-sm text-slate-700 md:col-span-5">
                            {isRec ? "Trả lại tiền cọc cho khách" : "Nhà cung cấp trả lại tiền cọc"} — tối đa <b>{money(d.remaining)}</b>
                          </div>
                          <input
                            className={inputCls}
                            inputMode="numeric"
                            value={refund.amount}
                            onChange={(e) => setRefund({ ...refund, amount: fmtInput(e.target.value) })}
                          />
                          <input
                            type="date"
                            className={inputCls}
                            value={refund.date}
                            max={today()}
                            onChange={(e) => setRefund({ ...refund, date: e.target.value })}
                          />
                          {accSelect(refund.accountId, (v) => setRefund({ ...refund, accountId: v }))}
                          <input
                            className={inputCls}
                            placeholder="Lý do"
                            value={refund.note}
                            onChange={(e) => setRefund({ ...refund, note: e.target.value })}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={submitRefund}
                              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                            >
                              Ghi hoàn cọc
                            </button>
                            <button type="button" onClick={() => setRefund(null)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                              Huỷ
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DepositsPage;
