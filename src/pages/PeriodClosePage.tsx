// src/pages/PeriodClosePage.tsx
// ✅ Chốt sổ kế toán (khoá kỳ) — chỉ quản trị, cần mật khẩu cấp 2
//   Sau mốc chốt: không ai (kể cả quản trị) tạo / sửa / xoá / duyệt chứng từ có ngày trong kỳ đã chốt.
import React, { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import { PinActionDialog } from "../components/SecondPassword";
import { ToastHost, useToast } from "../components/Toast";

type Hist = { id: string; closedUntil: string | null; note: string | null; createdAt: string };
type Resp = { closedUntil: string | null; since: string | null; history: Hist[] };

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20";

const vnToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const viDate = (ymd?: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "");
const viDateTime = (iso: string) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** ngày cuối tháng trước (VN) */
function endOfPrevMonth() {
  const t = vnToday();
  const d = new Date(`${t.slice(0, 8)}01T12:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function nextDay(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function yesterday() {
  const d = new Date(`${vnToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const PeriodClosePage: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState(endOfPrevMonth());
  const [note, setNote] = useState("");
  const [dlg, setDlg] = useState<"close" | "open" | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get("/locks/period");
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Không tải được trạng thái chốt sổ.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const cur = data?.closedUntil || null;
  const backward = !!cur && date < cur;
  const maxDate = yesterday();
  const same = !!cur && date === cur; // trùng mốc đang chốt: chỉ mờ nút, không báo lỗi
  const dateErr = !date ? "Chọn ngày chốt." : date > maxDate ? "Chỉ chốt được tới hết hôm qua." : null;

  return (
    <div className="mx-auto max-w-[880px] space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Chốt sổ kế toán</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Chốt xong, không ai — kể cả quản trị — tạo, sửa, xoá hay duyệt hoá đơn, phiếu thu chi, phiếu kho có ngày trong kỳ đã chốt.
        </p>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {/* trạng thái */}
      <div className={`rounded-xl border p-4 sm:p-5 ${cur ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        {!data ? (
          <div className="text-sm text-slate-500">Đang tải…</div>
        ) : cur ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-emerald-800">Đang chốt sổ đến hết ngày</div>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-900">{viDate(cur)}</div>
              {data.since && <div className="mt-0.5 text-xs text-emerald-700">từ {viDateTime(data.since)}</div>}
            </div>
            <button
              type="button"
              onClick={() => setDlg("open")}
              className={`rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 ${focusRing}`}
            >
              Mở chốt hoàn toàn
            </button>
          </div>
        ) : (
          <div>
            <div className="text-base font-medium text-slate-900">Chưa chốt sổ</div>
            <div className="mt-0.5 text-sm text-slate-500">
              Hiện chỉ có luật tự động: chứng từ cũ hơn 7 ngày nhân viên, kế toán không sửa được; quản trị sửa được tới 90 ngày.
            </div>
          </div>
        )}
      </div>

      {/* chốt / lùi mốc */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-medium text-slate-900">{cur ? "Chốt tiếp / đổi mốc chốt" : "Chốt sổ"}</h2>
        <p className="mt-0.5 text-sm text-slate-500">Thường chốt đến ngày cuối tháng trước, sau khi đã đối soát quỹ, ngân hàng và tồn kho.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pc-date">
              Chốt đến hết ngày
            </label>
            <input id="pc-date" type="date" max={maxDate} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pc-note">
              Ghi chú <span className="font-normal text-slate-400">(tuỳ chọn)</span>
            </label>
            <input id="pc-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: đã đối soát sổ quỹ tháng 10" maxLength={300} />
          </div>
        </div>
        {backward && !dateErr && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Ngày này trước mốc đang chốt ({viDate(cur)}): các ngày từ {viDate(nextDay(date))} đến {viDate(cur)} sẽ được mở lại để sửa. Sửa xong nhớ chốt lại.
          </div>
        )}
        {dateErr && date && <div className="mt-2 text-sm text-rose-600">{dateErr}</div>}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={!!dateErr || same}
            title={same ? "Chọn ngày khác để chốt tiếp hoặc lùi mốc" : undefined}
            onClick={() => setDlg("close")}
            className={`rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            {backward ? `Lùi mốc về ${viDate(date)}` : `Chốt sổ đến hết ${viDate(date)}`}
          </button>
        </div>
      </div>

      {/* lịch sử */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 text-base font-medium text-slate-900 sm:px-5">Lịch sử chốt sổ</h2>
        {!data?.history.length ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">Chưa có lần chốt sổ nào.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0 text-slate-800">{h.note || (h.closedUntil ? `Chốt đến hết ${viDate(h.closedUntil)}` : "Mở chốt")}</span>
                <span className="whitespace-nowrap text-xs text-slate-500">{viDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PinActionDialog
        open={dlg === "close"}
        title={backward ? "Lùi mốc chốt sổ" : "Chốt sổ kế toán"}
        subtitle={<>Đến hết ngày <b>{viDate(date)}</b></>}
        confirmLabel={backward ? "Lùi mốc" : "Chốt sổ"}
        busyLabel="Đang lưu…"
        onClose={() => setDlg(null)}
        onSubmit={async (pin) => {
          await api.post("/locks/period", { closedUntil: date, note: note.trim() || undefined, pin });
          setDlg(null);
          setNote("");
          toast.push({ type: "success", title: "Đã lưu", message: `Đã chốt sổ đến hết ${viDate(date)}.` });
          load();
        }}
      >
        <p className="text-sm text-slate-600">
          Sau khi chốt, chứng từ có ngày từ {viDate(date)} trở về trước bị khoá với mọi người, kể cả quản trị.
        </p>
      </PinActionDialog>

      <PinActionDialog
        open={dlg === "open"}
        tone="danger"
        title="Mở chốt sổ hoàn toàn"
        subtitle={cur ? <>Đang chốt đến hết <b>{viDate(cur)}</b></> : null}
        confirmLabel="Mở chốt"
        busyLabel="Đang mở…"
        onClose={() => setDlg(null)}
        onSubmit={async (pin) => {
          await api.post("/locks/period/open", { pin });
          setDlg(null);
          toast.push({ type: "success", title: "Đã mở chốt", message: "Kỳ cũ đã mở lại. Sửa xong nhớ chốt lại." });
          load();
        }}
      >
        <p className="text-sm text-slate-600">Chỉ còn luật 7 / 90 ngày. Muốn mở một phần thì dùng ô “Chốt đến hết ngày” để lùi mốc thay vì mở hết.</p>
      </PinActionDialog>

      <ToastHost toasts={toast.toasts} onClose={toast.remove} />
    </div>
  );
};

export default PeriodClosePage;
