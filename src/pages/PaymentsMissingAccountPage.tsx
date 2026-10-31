// src/pages/PaymentsMissingAccountPage.tsx
// ✅ Phiếu thu/chi CHƯA gán tài khoản (quỹ tiền mặt / ngân hàng)
// - Dữ liệu cũ: phiếu tạo trước khi hệ thống bắt buộc chọn tài khoản
// - Gán từng phiếu hoặc gán hàng loạt; BE kiểm tra khoá kỳ + ghi nhật ký
// API: GET /payments?missingAccount=1, GET /payment-accounts?active=1, PATCH /payments/:id/account
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type Account = { id: string; code: string; name: string; type?: string };
type Row = {
  id: string;
  date: string;
  type: "RECEIPT" | "PAYMENT";
  amount: number;
  note?: string | null;
  partnerName?: string;
  invoices: Array<{ id: string; code: string }>;
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money = (n: number) => nf.format(Math.round(n || 0));
const viDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("vi-VN");
};
function pickArr(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

const PaymentsMissingAccountPage: React.FC = () => {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [pick, setPick] = useState<Record<string, string>>({}); // paymentId -> accountId
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkAcc, setBulkAcc] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setLoading(true);
    setLoadErr(null);
    try {
      const [pRes, aRes] = await Promise.all([
        api.get("/payments", { params: { missingAccount: 1 } }),
        api.get("/payment-accounts", { params: { active: 1 } }),
      ]);
      const list: Row[] = pickArr(pRes.data).map((p: any) => {
        const invs = new Map<string, string>();
        for (const a of p.allocations || []) {
          if (a?.invoice?.id) invs.set(String(a.invoice.id), String(a.invoice.code || a.invoice.id));
        }
        return {
          id: String(p.id),
          date: p.date,
          type: p.type === "PAYMENT" ? "PAYMENT" : "RECEIPT",
          amount: Number(p.amount || 0),
          note: p.note,
          partnerName: p.partner?.name || "",
          invoices: Array.from(invs, ([id, code]) => ({ id, code })),
        };
      });
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setRows(list);
      setAccounts(
        pickArr(aRes.data).map((a: any) => ({ id: String(a.id), code: String(a.code || ""), name: String(a.name || ""), type: a.type }))
      );
      setChecked(new Set());
      setRowErr({});
    } catch (e: any) {
      setLoadErr(e?.response?.data?.message || e?.message || "Không tải được danh sách phiếu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    let thu = 0;
    let chi = 0;
    for (const r of rows) {
      if (r.type === "PAYMENT") chi += r.amount;
      else thu += r.amount;
    }
    return { thu, chi };
  }, [rows]);

  async function assign(id: string, accountId: string) {
    await api.patch(`/payments/${id}/account`, { accountId });
  }

  async function assignOne(r: Row) {
    const accountId = pick[r.id];
    if (!accountId) {
      setRowErr((m) => ({ ...m, [r.id]: "Chọn tài khoản trước." }));
      return;
    }
    setBusyId(r.id);
    try {
      await assign(r.id, accountId);
      setRows((list) => list.filter((x) => x.id !== r.id));
      setChecked((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
      toast.push({ type: "success", title: "Đã gán", message: `Phiếu ${r.type === "PAYMENT" ? "chi" : "thu"} ${money(r.amount)} đ.` });
    } catch (e: any) {
      setRowErr((m) => ({ ...m, [r.id]: e?.response?.data?.message || "Gán thất bại." }));
    } finally {
      setBusyId(null);
    }
  }

  async function assignBulk() {
    if (!bulkAcc || checked.size === 0) return;
    setBulkBusy(true);
    const ids = rows.filter((r) => checked.has(r.id)).map((r) => r.id);
    let okCount = 0;
    const errs: Record<string, string> = {};
    for (const id of ids) {
      try {
        await assign(id, bulkAcc);
        okCount++;
      } catch (e: any) {
        errs[id] = e?.response?.data?.message || "Gán thất bại.";
      }
    }
    setRows((list) => list.filter((r) => !ids.includes(r.id) || errs[r.id]));
    setChecked(new Set(Object.keys(errs)));
    setRowErr((m) => ({ ...m, ...errs }));
    setBulkBusy(false);
    const failCount = Object.keys(errs).length;
    toast.push({
      type: failCount ? "warning" : "success",
      title: "Gán hàng loạt",
      message: `Đã gán ${okCount} phiếu${failCount ? `, ${failCount} phiếu lỗi (xem dòng tô đỏ)` : ""}.`,
    });
  }

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const accLabel = (a: Account) => `${a.code} - ${a.name}`;

  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Phiếu thu/chi chưa gán tài khoản</h1>
          <p className="text-xs text-slate-500">
            Phiếu tạo trước khi hệ thống bắt buộc chọn quỹ / tài khoản. Gán xong thì số dư từng tài khoản mới tính đúng.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Đang tải…" : "↻ Tải lại"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Số phiếu chưa gán</div>
          <div className="text-xl font-bold text-slate-900">{rows.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Tiền thu chưa gán</div>
          <div className="text-xl font-bold text-emerald-700 tabular-nums">{money(totals.thu)} đ</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Tiền chi chưa gán</div>
          <div className="text-xl font-bold text-rose-700 tabular-nums">{money(totals.chi)} đ</div>
        </div>
      </div>

      {loadErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadErr}</div>}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <span className="font-semibold text-slate-700">Gán hàng loạt {checked.size ? `(${checked.size} phiếu)` : ""}:</span>
          <select
            value={bulkAcc}
            onChange={(e) => setBulkAcc(e.target.value)}
            className="min-w-[220px] rounded-lg border border-slate-300 px-2.5 py-1.5"
          >
            <option value="">-- Chọn quỹ / tài khoản --</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accLabel(a)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assignBulk}
            disabled={!bulkAcc || checked.size === 0 || bulkBusy}
            className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {bulkBusy ? "Đang gán…" : "Gán cho phiếu đã chọn"}
          </button>
          <span className="text-xs text-slate-400">Chỉ gán được phiếu chưa bị khoá kỳ (kế toán 7 ngày, admin 90 ngày).</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading && rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Đang tải…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">✓ Không còn phiếu nào thiếu tài khoản.</div>
        ) : (
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2">Ngày</th>
                <th className="px-3 py-2">Loại</th>
                <th className="px-3 py-2">Đối tác</th>
                <th className="px-3 py-2 text-right">Số tiền</th>
                <th className="px-3 py-2">Hoá đơn</th>
                <th className="px-3 py-2">Ghi chú</th>
                <th className="w-64 px-3 py-2">Tài khoản</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={rowErr[r.id] ? "bg-rose-50/60" : ""}>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={(e) =>
                        setChecked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{viDate(r.date)}</td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        r.type === "PAYMENT" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {r.type === "PAYMENT" ? "Chi" : "Thu"}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">{r.partnerName || "—"}</td>
                  <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{money(r.amount)}</td>
                  <td className="px-3 py-2 align-top">
                    {r.invoices.length === 0 ? (
                      <span className="text-xs text-amber-600">chưa phân bổ</span>
                    ) : (
                      r.invoices.map((i) => (
                        <Link key={i.id} to={`/invoices/${i.id}`} className="mr-2 font-mono text-xs text-sky-700 hover:underline">
                          {i.code}
                        </Link>
                      ))
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 align-top text-slate-600" title={r.note || ""}>
                    {r.note || "—"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex gap-1.5">
                      <select
                        value={pick[r.id] || ""}
                        onChange={(e) => {
                          setPick((m) => ({ ...m, [r.id]: e.target.value }));
                          setRowErr((m) => {
                            const n = { ...m };
                            delete n[r.id];
                            return n;
                          });
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">-- Chọn --</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {accLabel(a)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => assignOne(r)}
                        disabled={busyId === r.id || !pick[r.id]}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        {busyId === r.id ? "…" : "Gán"}
                      </button>
                    </div>
                    {rowErr[r.id] && <div className="mt-1 text-xs text-rose-600">{rowErr[r.id]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ToastHost toasts={toast.toasts} onClose={toast.remove} />
    </div>
  );
};

export default PaymentsMissingAccountPage;
