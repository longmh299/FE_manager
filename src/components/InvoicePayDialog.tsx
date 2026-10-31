// src/components/InvoicePayDialog.tsx
// ✅ Hộp thoại thu / trả tiền 1 hoá đơn (trang Hoá đơn)
// - Lời lẽ đời thường: "Còn phải thu", "Đã thu trước đó", "Nhận vào tài khoản"... (bỏ Gross / NORMAL / Collectible)
// - Chọn tài khoản bằng thẻ bấm, nhập số tiền có nút "Thu đủ", báo lỗi ngay tại chỗ thay vì toast
// - Điện thoại: hiện dạng tấm trượt từ dưới lên
import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

export type PayAccount = {
  id: string;
  code: string;
  name: string;
  type?: string; // CASH | BANK | EWALLET | OTHER
  bankName?: string | null;
  accountNo?: string | null;
};

type Props = {
  open: boolean;
  submitting: boolean;
  isPurchase: boolean;
  invoiceCode: string;
  partnerName?: string;
  invoiceDate?: string;

  total: number; // tổng tiền hoá đơn
  returned: number; // khách đã trả lại hàng
  hold: number; // giữ lại bảo hành
  paid: number; // đã thu / đã trả trước đó
  remaining: number; // còn phải thu / trả

  accounts: PayAccount[];
  accountsLoading: boolean;
  accountId: string;
  onAccountChange: (id: string) => void;

  date: string;
  onDateChange: (v: string) => void;

  note: string; // ghi chú / diễn giải (tuỳ chọn)
  onNoteChange: (v: string) => void;

  amount: number;
  amountText: string;
  onAmountText: (raw: string) => void;
  onSetAmount: (n: number) => void;
  amountInputRef?: React.RefObject<HTMLInputElement | null>;

  onClose: () => void;
  onSubmit: () => void;
};

const money = (n: number) => Number(n || 0).toLocaleString("vi-VN");

function viDate(raw?: string) {
  if (!raw) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("vi-VN");
}

function AccountIcon({ type }: { type?: string }) {
  if (type === "CASH") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M6 9.5v5M18 9.5v5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "EWALLET") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M10.5 18h3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M3 9.5 12 4l9 5.5" strokeLinejoin="round" />
      <path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" strokeLinecap="round" />
    </svg>
  );
}

function accountSub(a: PayAccount) {
  if (a.type === "CASH") return "Tiền mặt";
  const parts = [a.bankName, a.accountNo].filter(Boolean).join(" ");
  return parts || a.code;
}

const InvoicePayDialog: React.FC<Props> = (p) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Esc để đóng
  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !p.submitting) p.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.open, p.submitting, p.onClose]);

  if (!p.open) return null;

  const verb = p.isPurchase ? "Trả" : "Thu";
  const tone = p.isPurchase
    ? { text: "text-rose-700", bg: "bg-rose-50", ring: "ring-rose-600", btn: "bg-rose-600 hover:bg-rose-700", border: "border-rose-600" }
    : { text: "text-teal-700", bg: "bg-teal-50", ring: "ring-teal-600", btn: "bg-teal-600 hover:bg-teal-700", border: "border-teal-600" };

  const over = p.amount > p.remaining + 0.0001;
  const zero = !(p.amount > 0);
  const left = Math.max(0, p.remaining - p.amount);
  const noAccount = !p.accountId;
  const canSubmit = !p.submitting && !over && !zero && !noAccount && p.accounts.length > 0;

  const summary: Array<{ label: string; value: number; minus?: boolean }> = [
    { label: "Tổng tiền hoá đơn", value: p.total },
  ];
  if (p.returned > 0) summary.push({ label: "Khách đã trả lại hàng", value: p.returned, minus: true });
  if (p.hold > 0) summary.push({ label: "Giữ lại chờ bảo hành", value: p.hold, minus: true });
  if (p.paid > 0) summary.push({ label: p.isPurchase ? "Đã trả trước đó" : "Đã thu trước đó", value: p.paid, minus: true });

  return (
    <div className="fixed inset-0 z-[100000] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div className="absolute inset-0 bg-slate-900/45" onClick={() => !p.submitting && p.onClose()} />

      <form
        ref={panelRef as any}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) p.onSubmit();
        }}
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-[480px] sm:rounded-2xl"
      >
        {/* đầu */}
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">
              {p.isPurchase ? "Hoá đơn nhập" : "Hoá đơn bán"} {p.invoiceCode}
              {p.invoiceDate ? `, ngày ${viDate(p.invoiceDate)}` : ""}
            </div>
            <h2 id="pay-title" className="mt-0.5 text-lg font-semibold text-slate-900">
              {p.isPurchase ? "Trả tiền nhà cung cấp" : "Thu tiền khách"}
            </h2>
            {p.partnerName ? <div className="truncate text-sm text-slate-600">{p.partnerName}</div> : null}
          </div>
          <button
            type="button"
            onClick={p.onClose}
            disabled={p.submitting}
            aria-label="Đóng"
            className="-mr-2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* tóm tắt công nợ */}
          <div className="rounded-xl border border-slate-200">
            {summary.length > 1 && (
              <dl className="space-y-1.5 px-4 pb-2 pt-3 text-sm">
                {summary.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">{s.label}</dt>
                    <dd className="tabular-nums text-slate-800">
                      {s.minus ? "−" : ""}
                      {money(s.value)} đ
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <div className={`flex items-baseline justify-between gap-3 rounded-xl px-4 py-3 ${tone.bg} ${summary.length > 1 ? "rounded-t-none border-t border-slate-200" : ""}`}>
              <span className="text-sm font-medium text-slate-700">{p.isPurchase ? "Còn phải trả" : "Còn phải thu"}</span>
              <span className={`text-xl font-semibold tabular-nums ${tone.text}`}>{money(p.remaining)} đ</span>
            </div>
          </div>

          {/* số tiền */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="pay-amount" className="text-sm font-medium text-slate-800">
                Số tiền {verb.toLowerCase()} lần này
              </label>
              {Math.abs(p.amount - p.remaining) > 0.0001 && (
                <button
                  type="button"
                  onClick={() => p.onSetAmount(p.remaining)}
                  className={`!min-h-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.bg} ${tone.text} hover:brightness-95`}
                >
                  {verb} đủ {money(p.remaining)}
                </button>
              )}
            </div>
            <div
              className={`flex items-center rounded-xl border bg-white px-3 focus-within:ring-2 ${
                over ? "border-rose-400 focus-within:ring-rose-200" : "border-slate-300 focus-within:border-slate-400 focus-within:ring-slate-200"
              }`}
            >
              <input
                id="pay-amount"
                ref={p.amountInputRef as any}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={p.amountText}
                onChange={(e) => p.onAmountText(e.target.value || "")}
                disabled={p.submitting}
                placeholder="0"
                className="w-full bg-transparent py-2.5 text-right text-lg font-semibold tabular-nums text-slate-900 outline-none"
              />
              <span className="pl-2 text-slate-400">đ</span>
            </div>
            <div className="mt-1.5 min-h-[20px] text-sm">
              {over ? (
                <span className="text-rose-700">Nhiều hơn số còn phải {verb.toLowerCase()} ({money(p.remaining)} đ).</span>
              ) : zero ? (
                <span className="text-slate-500">Nhập số tiền {p.isPurchase ? "trả" : "khách đưa"}.</span>
              ) : left > 0.0001 ? (
                <span className="text-amber-700">
                  {p.isPurchase ? "Còn nợ nhà cung cấp" : "Khách còn nợ lại"} <b className="tabular-nums">{money(left)} đ</b>.
                </span>
              ) : (
                <span className="text-emerald-700">✓ {p.isPurchase ? "Trả hết, hoá đơn sẽ hết nợ." : "Thu đủ, hoá đơn sẽ hết nợ."}</span>
              )}
            </div>
          </div>

          {/* tài khoản */}
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">{p.isPurchase ? "Trả từ" : "Nhận vào"}</legend>
            {p.accountsLoading && p.accounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">Đang tải tài khoản…</div>
            ) : p.accounts.length === 0 ? (
              <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900">
                Chưa có tài khoản nào.{" "}
                <Link to="/payment-accounts" className="font-medium underline underline-offset-2">
                  Thêm tài khoản
                </Link>{" "}
                rồi quay lại.
              </div>
            ) : (
              <div className="grid max-h-[210px] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2" role="radiogroup">
                {p.accounts.map((a) => {
                  const on = a.id === p.accountId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={p.submitting}
                      onClick={() => p.onAccountChange(a.id)}
                      title={`${a.name || a.code}${accountSub(a) ? " · " + accountSub(a) : ""}`}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        on ? `${tone.border} ${tone.bg} ring-1 ${tone.ring}` : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${a.type === "CASH" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                        <AccountIcon type={a.type} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{a.name || a.code}</span>
                        <span className="block truncate text-xs text-slate-500">{accountSub(a)}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? `${tone.border} ${tone.btn.split(" ")[0]}` : "border-slate-300"}`}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* ngày */}
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="pay-date" className="text-sm font-medium text-slate-800">
              Ngày {verb.toLowerCase()} tiền
            </label>
            <input
              id="pay-date"
              type="date"
              value={p.date}
              onChange={(e) => p.onDateChange(e.target.value)}
              disabled={p.submitting}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {/* ghi chú */}
          <div>
            <label htmlFor="pay-note" className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-slate-800">
              <span>
                Ghi chú <span className="font-normal text-slate-400">(không bắt buộc)</span>
              </span>
              {p.note.length > 200 && <span className="text-xs font-normal text-slate-400">{p.note.length}/255</span>}
            </label>
            <textarea
              id="pay-note"
              rows={2}
              maxLength={255}
              value={p.note}
              onChange={(e) => p.onNoteChange(e.target.value)}
              onKeyDown={(e) => {
                // Enter = lưu, Shift+Enter = xuống dòng
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                }
              }}
              disabled={p.submitting}
              placeholder={p.isPurchase ? "VD: Chuyển khoản đợt 1, NCC xác nhận qua Zalo" : "VD: Khách chuyển khoản, anh Tiến nhận tiền mặt tại kho"}
              className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <div className="mt-1 text-xs text-slate-500">
              Hiện ở sổ thu chi:{" "}
              <span className="text-slate-700">
                {p.note.trim() ? `HĐ ${p.invoiceCode}: ${p.note.trim()}` : `Thanh toán HĐ ${p.invoiceCode}`}
              </span>
            </div>
          </div>
        </div>

        {/* chân */}
        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={p.onClose}
            disabled={p.submitting}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Huỷ
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`ml-auto inline-flex min-w-[170px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors ${
              canSubmit ? tone.btn : "cursor-not-allowed bg-slate-300"
            }`}
          >
            {p.submitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                Đang lưu…
              </>
            ) : noAccount && p.accounts.length > 0 && !zero && !over ? (
              "Chọn tài khoản"
            ) : (
              <>
                {verb} {zero ? "" : `${money(p.amount)} đ`}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default InvoicePayDialog;
