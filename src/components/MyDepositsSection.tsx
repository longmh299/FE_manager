// src/components/MyDepositsSection.tsx
// ✅ Trang "Công nợ của tôi": tiền cọc của khách mình (phiếu cọc đã duyệt), còn bao nhiêu, đã trừ vào HĐ nào
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

type Dep = {
  id: string;
  code: string | null;
  date: string;
  amount: number;
  applied: number;
  refunded: number;
  remaining: number;
  note: string | null;
  partner: { id: string; name: string } | null;
  allocations: Array<{ invoiceId: string; invoiceCode: string | null; amount: number }>;
};
const money = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("vi-VN")}đ`;
const viDate = (s: string) => new Date(s).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

const MyDepositsSection: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [rows, setRows] = useState<Dep[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    api
      .get("/deposits", { params: { type: "RECEIPT", all: all ? 1 : undefined } })
      .then((r) => setRows(Array.isArray(r.data?.items) ? r.data.items : []))
      .catch(() => setRows([]));
  }, [all, refreshKey]);

  const total = rows.reduce((s, d) => s + Number(d.remaining || 0), 0);
  if (!all && rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-amber-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">Tiền cọc của khách</h2>
        <span className="text-sm text-slate-500">
          còn chưa trừ: <b className="text-amber-700">{money(total)}</b>
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Hiện cả cọc đã trừ hết
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-400">Chưa có tiền cọc.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-medium text-slate-900">{d.partner?.name || "Khách"}</span>
              <span className="text-xs text-slate-500">
                {d.code} · {viDate(d.date)}
                {d.note ? ` · ${d.note}` : ""}
              </span>
              <span className="ml-auto text-right">
                cọc {money(d.amount)}
                {d.applied > 0 && <span className="text-slate-500"> · đã trừ {money(d.applied)}</span>}
                {d.refunded > 0 && <span className="text-slate-500"> · đã hoàn {money(d.refunded)}</span>}
                {" · "}
                <b className={d.remaining > 0 ? "text-amber-700" : "text-slate-400"}>còn {money(d.remaining)}</b>
              </span>
              {d.allocations.length > 0 && (
                <span className="w-full text-xs text-slate-500">
                  Đã trừ vào:{" "}
                  {d.allocations.map((a) => (
                    <Link key={a.invoiceId} to={`/invoices/${a.invoiceId}`} className="mr-1.5 text-sky-700 hover:underline">
                      HĐ {a.invoiceCode} ({money(a.amount)})
                    </Link>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MyDepositsSection;
