// src/components/CommissionRatesSettings.tsx
// ✅ Admin chỉnh tỉ lệ hoa hồng (trang Tài khoản của tôi)
//  - Kỹ thuật: % tiền hàng của hoá đơn KHÔNG có phụ cấp (có phụ cấp thì chỉ ăn phụ cấp)
//  - Sale: % doanh số (0 = không tính hoa hồng, báo cáo chỉ hiện doanh số)
//  - Lưu theo "áp dụng từ tháng": đổi tỉ lệ không làm thay đổi số các tháng trước mốc
//  - Lưu / xoá mốc cần mật khẩu cấp 2
import React, { useEffect, useState } from "react";
import api from "../api/client";
import { PinActionDialog } from "./SecondPassword";

type Rate = { from: string; techPct: number; salePct: number; updatedBy?: string | null; updatedAt?: string };

const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
const monthLabel = (ym: string) => (ym === "2000-01" ? "Mặc định" : `Từ tháng ${Number(ym.slice(5))}/${ym.slice(0, 4)}`);
const pct = (v: number) => `${Number(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 3 })}%`;
const parsePct = (s: string) => Number(String(s).replace(",", ".").trim());

const CommissionRatesSettings: React.FC = () => {
  const [history, setHistory] = useState<Rate[]>([]);
  const [current, setCurrent] = useState<Rate | null>(null);
  const [from, setFrom] = useState(thisMonth());
  const [tech, setTech] = useState("");
  const [sale, setSale] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinFor, setPinFor] = useState<null | { kind: "save" } | { kind: "remove"; from: string }>(null);

  const load = () =>
    api
      .get("/settings/commission")
      .then((r) => {
        const d = r.data?.data || {};
        setHistory(Array.isArray(d.history) ? d.history : []);
        setCurrent(d.current || null);
        if (d.current) {
          setTech((t) => t || String(d.current.techPct));
          setSale((s) => s || String(d.current.salePct));
        }
      })
      .catch(() => setNote({ ok: false, text: "Không tải được tỉ lệ hoa hồng." }));

  useEffect(() => {
    void load();
  }, []);

  const techN = parsePct(tech);
  const saleN = parsePct(sale);
  const valid = /^\d{4}-\d{2}$/.test(from) && Number.isFinite(techN) && Number.isFinite(saleN) && techN >= 0 && techN <= 100 && saleN >= 0 && saleN <= 100;
  const isPast = from < thisMonth();

  const input =
    "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-4 focus:ring-slate-100";

  return (
    <div className="space-y-4">
      {current && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">
            Tháng này: kỹ thuật <b>{pct(current.techPct)}</b>
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
            sale <b>{current.salePct > 0 ? pct(current.salePct) : "không tính"}</b>
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="cr-from" className="mb-1.5 block text-sm font-medium text-slate-700">
            Áp dụng từ tháng
          </label>
          <input id="cr-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="cr-tech" className="mb-1.5 block text-sm font-medium text-slate-700">
            Kỹ thuật (% tiền hàng)
          </label>
          <input id="cr-tech" inputMode="decimal" value={tech} onChange={(e) => setTech(e.target.value)} placeholder="0,5" className={input} />
        </div>
        <div>
          <label htmlFor="cr-sale" className="mb-1.5 block text-sm font-medium text-slate-700">
            Sale (% doanh số)
          </label>
          <input id="cr-sale" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0 = không tính" className={input} />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Kỹ thuật chỉ ăn % ở hoá đơn không có phụ cấp. Sale để 0 thì báo cáo chỉ hiện doanh số. Các tháng trước mốc giữ tỉ lệ cũ.
        {isPast && <span className="font-medium text-amber-700"> Bạn đang chọn tháng đã qua: số các tháng từ đó tới nay sẽ tính lại theo tỉ lệ mới.</span>}
      </p>

      {note && (
        <div className={`rounded-xl px-3 py-2 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`} role="status">
          {note.text}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            setNote(null);
            setPinFor({ kind: "save" });
          }}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Lưu tỉ lệ
        </button>
      </div>

      {history.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Mốc</th>
                <th className="px-3 py-2 text-right font-medium">Kỹ thuật</th>
                <th className="px-3 py-2 text-right font-medium">Sale</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h.from} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {monthLabel(h.from)}
                    {h.updatedBy && <div className="text-xs text-slate-400">bởi {h.updatedBy}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(h.techPct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.salePct > 0 ? pct(h.salePct) : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {h.from !== "2000-01" && (
                      <button
                        type="button"
                        onClick={() => setPinFor({ kind: "remove", from: h.from })}
                        className="rounded-lg px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        Xoá
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PinActionDialog
        open={!!pinFor}
        title={pinFor?.kind === "remove" ? "Xoá mốc tỉ lệ hoa hồng" : "Lưu tỉ lệ hoa hồng"}
        tone={pinFor?.kind === "remove" ? "danger" : "default"}
        confirmLabel={pinFor?.kind === "remove" ? "Xoá" : "Lưu"}
        onClose={() => setPinFor(null)}
        onSubmit={async (pinCode) => {
          if (pinFor?.kind === "remove") {
            await api.delete(`/settings/commission/${pinFor.from}`, { data: { pin: pinCode } });
            setNote({ ok: true, text: `Đã xoá mốc ${monthLabel(pinFor.from).toLowerCase()}.` });
          } else {
            await api.put("/settings/commission", { from, techPct: techN, salePct: saleN, pin: pinCode });
            setNote({ ok: true, text: `Đã lưu: ${monthLabel(from).toLowerCase()}, kỹ thuật ${pct(techN)}, sale ${saleN > 0 ? pct(saleN) : "không tính"}.` });
          }
          setPinFor(null);
          await load();
        }}
      >
        {pinFor?.kind === "save" && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {monthLabel(from)}: kỹ thuật <b>{pct(techN)}</b>, sale <b>{saleN > 0 ? pct(saleN) : "không tính"}</b>
          </div>
        )}
      </PinActionDialog>
    </div>
  );
};

export default CommissionRatesSettings;