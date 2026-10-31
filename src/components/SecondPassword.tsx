// src/components/SecondPassword.tsx
// ✅ Mật khẩu cấp 2 (PIN 4 hoặc 6 số)
// - PinInput: ô nhập từng chữ số (dán được cả dãy), che số
// - PinSetupForm: đặt / đổi PIN (bắt buộc mật khẩu đăng nhập)
// - VoidPaymentDialog: huỷ phiếu thu/chi = lý do + PIN (server kiểm tra PIN, FE chỉ thu thập)
// - PinSettingsDialog: xem trạng thái / đổi PIN
// - PinTicketDialog: nhập PIN lấy vé xác nhận ngắn hạn (VD: tạo phiếu điều chỉnh)
// API: GET/PUT /auth/pin, POST /auth/pin/ticket, POST /payments/:id/void { reason, pin }
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";

type PinStatus = { hasPin: boolean; pinLength: number | null; lockedUntil: string | null; recoveryEnabled?: boolean };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money = (n: number) => nf.format(Math.round(n || 0));
const viDate = (ymd?: string | null) => (ymd ? ymd.slice(0, 10).split("-").reverse().join("/") : "");
const errOf = (e: any) => ({
  code: e?.response?.data?.code as string | undefined,
  message: (e?.response?.data?.message ||
    (!e?.response ? "Không kết nối được máy chủ (BE). Kiểm tra BE còn chạy không rồi thử lại." : `Thao tác thất bại (mã lỗi ${e.response.status}).`)) as string,
  attemptsLeft: e?.response?.data?.attemptsLeft as number | undefined,
});

/* ========================= shell ========================= */
export const DialogShell: React.FC<{
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  tone?: "default" | "danger";
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}> = ({ open, title, subtitle, tone = "default", onClose, children, footer, width = "max-w-md" }) => {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100000] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${width} max-h-[92vh] overflow-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`border-b px-5 pb-3 pt-4 ${tone === "danger" ? "border-rose-100" : "border-slate-100"}`}>
          <div className="flex items-start justify-between gap-3">
            <h2 className={`text-[17px] font-semibold ${tone === "danger" ? "text-rose-800" : "text-slate-900"}`}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
};

/* ========================= PIN input ========================= */
export const PinInput: React.FC<{
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}> = ({ length, value, onChange, onComplete, error, disabled, autoFocus, label = "Mật khẩu cấp 2" }) => {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // focus lại khi mở, khi đổi độ dài, và khi hết trạng thái chờ (sau khi nhập sai, các ô bị xoá)
  useEffect(() => {
    if (autoFocus && !disabled) setTimeout(() => refs.current[Math.min(value.length, length - 1)]?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, length, disabled]);

  function setAt(i: number, d: string) {
    const arr = value.padEnd(length, " ").split("");
    arr[i] = d;
    const next = arr.join("").replace(/\s+$/, "").replace(/\s/g, "");
    onChange(next.slice(0, length));
    return next;
  }

  return (
    <div className={`flex justify-center gap-2 ${error ? "animate-[pinshake_.35s_ease-in-out]" : ""}`} role="group" aria-label={label}>
      <style>{`@keyframes pinshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
@media (prefers-reduced-motion: reduce){.animate-\\[pinshake_\\.35s_ease-in-out\\]{animation:none!important}}`}</style>
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length;
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`${label}, số thứ ${i + 1}`}
            maxLength={1}
            disabled={disabled}
            value={value[i] ?? ""}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, "").slice(-1);
              if (!d) return;
              const next = setAt(i, d);
              if (i < length - 1) refs.current[i + 1]?.focus();
              if (next.length === length) onComplete?.(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault();
                if (value[i]) setAt(i, "");
                else if (i > 0) {
                  onChange(value.slice(0, i - 1));
                  refs.current[i - 1]?.focus();
                }
              } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
              else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
              else if (e.key === "Enter" && value.length === length) onComplete?.(value);
            }}
            onPaste={(e) => {
              const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
              if (!digits) return;
              e.preventDefault();
              onChange(digits);
              refs.current[Math.min(digits.length, length - 1)]?.focus();
              if (digits.length === length) onComplete?.(digits);
            }}
            onFocus={(e) => e.target.select()}
            className={`h-12 w-11 rounded-xl border text-center text-xl font-semibold tracking-widest outline-none transition-colors focus:ring-4 disabled:opacity-50 ${
              error
                ? "border-rose-400 bg-rose-50 text-rose-700 focus:ring-rose-100"
                : filled
                ? "border-slate-400 bg-white text-slate-900 focus:border-slate-700 focus:ring-slate-200"
                : "border-slate-300 bg-slate-50 focus:border-slate-700 focus:bg-white focus:ring-slate-200"
            }`}
          />
        );
      })}
    </div>
  );
};

/* ========================= đặt / đổi PIN ========================= */
export const PinSetupForm: React.FC<{
  mode: "set" | "change";
  onDone: (status: PinStatus) => void;
  onCancel?: () => void;
  currentLength?: number | null; // độ dài PIN đang dùng (khi đổi)
  recoveryEnabled?: boolean; // server có mã khôi phục -> cho đổi khi quên PIN cũ
}> = ({ mode, onDone, onCancel, currentLength, recoveryEnabled }) => {
  const [password, setPassword] = useState("");
  // ✅ đổi PIN phải nhập PIN cũ (mật khẩu đăng nhập admin có thể bị người khác biết)
  const [oldPin, setOldPin] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const oldLen = currentLength || 6;
  const [len, setLen] = useState<4 | 6>(6);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPin("");
    setPin2("");
  }, [len]);

  async function submit() {
    setErr(null);
    if (!password) return setErr("Nhập mật khẩu đăng nhập để xác nhận là bạn.");
    if (mode === "change" && !useRecovery && oldPin.length !== oldLen) return setErr(`Nhập đủ ${oldLen} số của mật khẩu cấp 2 hiện tại.`);
    if (mode === "change" && useRecovery && !recoveryCode.trim()) return setErr("Nhập mã khôi phục.");
    if (pin.length !== len) return setErr(`Nhập đủ ${len} số cho mật khẩu cấp 2.`);
    if (pin !== pin2) return setErr("Hai lần nhập mật khẩu cấp 2 không khớp.");
    setBusy(true);
    try {
      const r = await api.put("/auth/pin", {
        password,
        pin,
        ...(mode === "change" ? (useRecovery ? { recoveryCode: recoveryCode.trim() } : { oldPin }) : {}),
      });
      onDone(r.data);
    } catch (e: any) {
      setErr(errOf(e).message);
      if (errOf(e).code === "PIN_INVALID" || errOf(e).code === "PIN_LOCKED") setOldPin("");
      if (errOf(e).code === "PIN_WEAK") {
        setPin("");
        setPin2("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {mode === "set"
          ? "Mật khẩu cấp 2 dùng để xác nhận các thao tác khó hoàn tác như huỷ phiếu. Chỉ bạn biết, không gửi cho ai."
          : "Đặt mật khẩu cấp 2 mới. Mật khẩu cũ hết hiệu lực ngay."}
      </p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Mật khẩu đăng nhập</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200"
        />
      </label>
      {mode === "change" && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="block text-sm font-medium text-slate-700">{useRecovery ? "Mã khôi phục" : "Mật khẩu cấp 2 hiện tại"}</span>
            {recoveryEnabled && (
              <button
                type="button"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setErr(null);
                }}
                className="text-xs font-medium text-sky-700 hover:underline"
              >
                {useRecovery ? "Nhập mật khẩu cấp 2 cũ" : "Quên? Dùng mã khôi phục"}
              </button>
            )}
          </div>
          {useRecovery ? (
            <input
              type="password"
              autoComplete="off"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200"
            />
          ) : (
            <PinInput length={oldLen} value={oldPin} onChange={setOldPin} label="Mật khẩu cấp 2 hiện tại" />
          )}
          {!recoveryEnabled && <p className="text-xs text-slate-500">Quên mật khẩu cấp 2 cũ thì cần mã khôi phục cài trên server, liên hệ người quản lý hệ thống.</p>}
        </div>
      )}
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Độ dài</span>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {[4, 6].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setLen(n as 4 | 6)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${len === n ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              {n} số
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-slate-700">Mật khẩu cấp 2 mới</span>
        <PinInput length={len} value={pin} onChange={setPin} label="Mật khẩu cấp 2 mới" />
      </div>
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-slate-700">Nhập lại</span>
        <PinInput length={len} value={pin2} onChange={setPin2} onComplete={() => void 0} error={pin2.length === len && pin2 !== pin} label="Nhập lại mật khẩu cấp 2" />
      </div>
      <p className="text-xs text-slate-500">Không dùng dãy lặp (0000) hoặc liên tiếp (1234, 123456).</p>
      {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Để sau
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Đang lưu…" : mode === "set" ? "Đặt mật khẩu cấp 2" : "Đổi mật khẩu cấp 2"}
        </button>
      </div>
    </div>
  );
};

/* ========================= huỷ phiếu ========================= */
export type VoidTarget = {
  id: string;
  code?: string | null;
  type: "RECEIPT" | "PAYMENT" | string;
  amount: number;
  date?: string | null;
  accountLabel?: string | null;
  invoiceCodes?: string[];
  isTransfer?: boolean;
};

export const VoidPaymentDialog: React.FC<{
  target: VoidTarget | null;
  onClose: () => void;
  onVoided: (target: VoidTarget) => void;
}> = ({ target, onClose, onVoided }) => {
  const [step, setStep] = useState<"reason" | "pin" | "setup">("reason");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!target) return;
    setStep("reason");
    setReason("");
    setPin("");
    setErr(null);
    api
      .get("/auth/pin")
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));
  }, [target]);

  const kind = target?.type === "PAYMENT" ? "chi" : "thu";
  const pinLen = status?.pinLength || 6;

  function next() {
    setErr(null);
    if (reason.trim().length < 3) return setErr("Ghi lý do huỷ (ít nhất 3 ký tự) để sau này tra lại.");
    setStep(status && !status.hasPin ? "setup" : "pin");
  }

  async function submit(p = pin) {
    if (!target || busy) return;
    if (p.length !== pinLen) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/payments/${target.id}/void`, { reason: reason.trim(), pin: p });
      onVoided(target);
    } catch (e: any) {
      const x = errOf(e);
      if (x.code === "PIN_NOT_SET") setStep("setup");
      else if (x.code === "PIN_INVALID" || x.code === "PIN_LOCKED") {
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setPin("");
      }
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  const summary = target && (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-600">
          Phiếu {kind} <span className="font-medium text-slate-900">{target.code || ""}</span>
        </span>
        <span className={`text-lg font-semibold tabular-nums ${target.type === "PAYMENT" ? "text-rose-700" : "text-teal-700"}`}>
          {target.type === "PAYMENT" ? "−" : "+"}
          {money(target.amount)} đ
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {[target.date ? `Ngày ${viDate(target.date)}` : "", target.accountLabel || "", target.invoiceCodes?.length ? `HĐ ${target.invoiceCodes.join(", ")}` : ""]
          .filter(Boolean)
          .join(", ")}
      </div>
    </div>
  );

  return (
    <DialogShell
      open={!!target}
      tone="danger"
      title={step === "setup" ? "Đặt mật khẩu cấp 2" : `Huỷ phiếu ${kind}`}
      subtitle={
        step === "reason"
          ? "Phiếu được giữ lại ở trạng thái Đã huỷ và không còn tính vào sổ."
          : step === "pin"
          ? "Nhập mật khẩu cấp 2 để xác nhận huỷ."
          : "Bạn cần đặt mật khẩu cấp 2 trước khi huỷ phiếu."
      }
      onClose={onClose}
      footer={
        step === "reason" ? (
          <>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Giữ phiếu
            </button>
            <button type="button" onClick={next} className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800">
              Tiếp tục
            </button>
          </>
        ) : step === "pin" ? (
          <>
            <button type="button" onClick={() => setStep("reason")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Quay lại
            </button>
            <button
              type="button"
              disabled={busy || pin.length !== pinLen}
              onClick={() => submit()}
              className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
            >
              {busy ? "Đang huỷ…" : "Huỷ phiếu"}
            </button>
          </>
        ) : undefined
      }
    >
      {step !== "setup" && summary}

      {step === "reason" && (
        <>
          {(target?.invoiceCodes?.length || target?.isTransfer) && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              {!!target?.invoiceCodes?.length && <li>Hoá đơn quay về trạng thái {kind === "thu" ? "chưa thu" : "chưa trả"} tương ứng, hiện lại ở Công nợ.</li>}
              {target?.isTransfer && <li>Phiếu đối ứng của lần chuyển quỹ này cũng bị huỷ theo.</li>}
            </ul>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Lý do huỷ</span>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="Ví dụ: bấm nhầm hoá đơn, khách chưa chuyển khoản"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200"
            />
          </label>
        </>
      )}

      {step === "pin" && (
        <div className="space-y-3 py-1">
          <PinInput length={pinLen} value={pin} onChange={setPin} onComplete={(v) => submit(v)} error={shake} disabled={busy} autoFocus />
          <p className="text-center text-xs text-slate-500">Quên mật khẩu cấp 2? Vào Đổi mật khẩu, dùng mã khôi phục để đặt lại.</p>
        </div>
      )}

      {step === "setup" && (
        <PinSetupForm
          mode="set"
          onCancel={onClose}
          onDone={(st) => {
            setStatus(st);
            setErr(null);
            setPin("");
            setStep("pin");
          }}
        />
      )}

      {err && step !== "setup" && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
    </DialogShell>
  );
};

/* ========================= cài đặt PIN ========================= */
export const PinSettingsDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  startEditing?: boolean; // mở thẳng vào form đổi (bấm nút "Đổi mật khẩu cấp 2" ở trang Đổi mật khẩu)
}> = ({ open, onClose, onSaved, startEditing }) => {
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<null | { mode: "set" | "change"; at: Date }>(null); // ✅ báo thành công
  useEffect(() => {
    if (!open) return;
    setEditing(!!startEditing);
    setSaved(null);
    api
      .get("/auth/pin")
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));
  }, [open]);
  const mode = status?.hasPin ? "change" : "set";
  const lockedText = useMemo(() => {
    if (!status?.lockedUntil) return null;
    const d = new Date(status.lockedUntil);
    return `Đang tạm khoá tới ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} do nhập sai nhiều lần.`;
  }, [status]);

  return (
    <DialogShell open={open} title="Mật khẩu cấp 2" onClose={onClose}>
      {!status ? (
        <div className="py-6 text-center text-sm text-slate-500">Đang tải…</div>
      ) : editing || !status.hasPin ? (
        <PinSetupForm
          mode={mode}
          currentLength={status.pinLength}
          recoveryEnabled={status.recoveryEnabled}
          onCancel={status.hasPin && !startEditing ? () => setEditing(false) : onClose}
          onDone={(st) => {
            setSaved({ mode, at: new Date() });
            setStatus(st);
            setEditing(false);
            onSaved?.();
          }}
        />
      ) : saved ? (
        <div className="space-y-4">
          <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.4" aria-hidden="true" className="mt-0.5 shrink-0">
              <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="text-sm text-emerald-900">
              <div className="font-semibold">{saved.mode === "set" ? "Đã đặt mật khẩu cấp 2" : "Đã đổi mật khẩu cấp 2"}</div>
              <div>
                Mật khẩu cấp 2 mới ({status.pinLength} số) có hiệu lực ngay
                {saved.mode === "change" ? ", mật khẩu cũ không dùng được nữa" : ""}.
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Xong
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <div className="text-sm text-teal-900">Đã đặt mật khẩu cấp 2 ({status.pinLength} số). Dùng khi huỷ phiếu thu chi, tạo hoặc ghi sổ phiếu điều chỉnh.</div>
          </div>
          {lockedText && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{lockedText}</div>}
          <div className="flex justify-end">
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Đổi mật khẩu cấp 2
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
};

/* ========================= xác nhận bằng PIN -> vé ngắn hạn ========================= */
// Dùng cho thao tác mà lúc bấm nút và lúc lưu cách nhau (VD: Tạo phiếu điều chỉnh).
// Nhập PIN -> POST /auth/pin/ticket { pin, purpose } -> trả vé cho trang gửi kèm khi lưu.
export const PinTicketDialog: React.FC<{
  open: boolean;
  purpose: string; // VD: "MOVEMENT_CREATE"
  title: string;
  subtitle?: React.ReactNode;
  confirmLabel?: string;
  notice?: string | null; // VD: "Phiên xác nhận đã hết hạn"
  onClose: () => void;
  onConfirmed: (ticket: string, expiresAt: string | null) => void;
}> = ({ open, purpose, title, subtitle, confirmLabel = "Xác nhận", notice, onClose, onConfirmed }) => {
  const [step, setStep] = useState<"loading" | "pin" | "setup">("loading");
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setErr(null);
    setStep("loading");
    api
      .get("/auth/pin")
      .then((r) => {
        setStatus(r.data);
        setStep(r.data?.hasPin ? "pin" : "setup");
      })
      .catch(() => {
        setStatus(null);
        setStep("pin");
      });
  }, [open]);

  const pinLen = status?.pinLength || 6;

  async function submit(p = pin) {
    if (busy || p.length !== pinLen) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post("/auth/pin/ticket", { pin: p, purpose });
      onConfirmed(String(r.data?.ticket || ""), r.data?.expiresAt ?? null);
    } catch (e: any) {
      const x = errOf(e);
      if (x.code === "PIN_NOT_SET") setStep("setup");
      else {
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setPin("");
      }
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open={open}
      title={step === "setup" ? "Đặt mật khẩu cấp 2" : title}
      subtitle={step === "setup" ? "Bạn cần đặt mật khẩu cấp 2 trước khi làm thao tác này." : subtitle ?? "Nhập mật khẩu cấp 2 để tiếp tục."}
      onClose={onClose}
      footer={
        step === "pin" ? (
          <>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Huỷ
            </button>
            <button
              type="button"
              disabled={busy || pin.length !== pinLen}
              onClick={() => submit()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Đang kiểm tra…" : confirmLabel}
            </button>
          </>
        ) : undefined
      }
    >
      {notice && step === "pin" && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</div>}

      {step === "loading" && <div className="py-6 text-center text-sm text-slate-500">Đang tải…</div>}

      {step === "pin" && (
        <div className="space-y-3 py-1">
          <PinInput length={pinLen} value={pin} onChange={setPin} onComplete={(v) => submit(v)} error={shake} disabled={busy} autoFocus />
          <p className="text-center text-xs text-slate-500">Quên mật khẩu cấp 2? Vào Đổi mật khẩu, dùng mã khôi phục để đặt lại.</p>
        </div>
      )}

      {step === "setup" && (
        <PinSetupForm
          mode="set"
          onCancel={onClose}
          onDone={(st) => {
            setStatus(st);
            setErr(null);
            setPin("");
            setStep("pin");
          }}
        />
      )}

      {err && step !== "setup" && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
    </DialogShell>
  );
};

/* ========================= nhập PIN cho 1 thao tác (gửi PIN thẳng lên server) ========================= */
// Dùng cho thao tác 1 bước: mở lại hoá đơn đã duyệt, ghi sổ kiểm kê, đổi tài khoản của phiếu...
// onSubmit(pin) gọi API; lỗi PIN (sai / khoá / chưa đặt) được xử lý ngay trong hộp, lỗi khác hiện dưới ô nhập.
export const PinActionDialog: React.FC<{
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: "default" | "danger";
  children?: React.ReactNode; // tóm tắt thao tác
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void>;
}> = ({ open, title, subtitle, confirmLabel, busyLabel = "Đang xử lý…", tone = "default", children, onClose, onSubmit }) => {
  const [step, setStep] = useState<"loading" | "pin" | "setup">("loading");
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setErr(null);
    setStep("loading");
    api
      .get("/auth/pin")
      .then((r) => {
        setStatus(r.data);
        setStep(r.data?.hasPin ? "pin" : "setup");
      })
      .catch(() => {
        setStatus(null);
        setStep("pin");
      });
  }, [open]);

  const pinLen = status?.pinLength || 6;

  async function submit(p = pin) {
    if (busy || p.length !== pinLen) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(p);
    } catch (e: any) {
      const x = errOf(e);
      if (x.code === "PIN_NOT_SET") setStep("setup");
      else if (x.code === "PIN_INVALID" || x.code === "PIN_LOCKED" || x.code === "PIN_REQUIRED") {
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setPin("");
      }
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open={open}
      tone={tone}
      title={step === "setup" ? "Đặt mật khẩu cấp 2" : title}
      subtitle={step === "setup" ? "Bạn cần đặt mật khẩu cấp 2 trước khi làm thao tác này." : subtitle}
      onClose={() => !busy && onClose()}
      footer={
        step === "pin" ? (
          <>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Huỷ
            </button>
            <button
              type="button"
              disabled={busy || pin.length !== pinLen}
              onClick={() => submit()}
              className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                tone === "danger" ? "bg-rose-700 hover:bg-rose-800" : "bg-slate-900 hover:bg-slate-800"
              }`}
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </>
        ) : undefined
      }
    >
      {step !== "setup" && children}
      {step === "loading" && <div className="py-6 text-center text-sm text-slate-500">Đang tải…</div>}
      {step === "pin" && (
        <div className="space-y-3 py-1">
          <div className="text-center text-sm text-slate-600">Nhập mật khẩu cấp 2 để xác nhận</div>
          <PinInput length={pinLen} value={pin} onChange={setPin} onComplete={(v) => submit(v)} error={shake} disabled={busy} autoFocus />
        </div>
      )}
      {step === "setup" && (
        <PinSetupForm
          mode="set"
          onCancel={onClose}
          onDone={(st) => {
            setStatus(st);
            setErr(null);
            setPin("");
            setStep("pin");
          }}
        />
      )}
      {err && step !== "setup" && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
    </DialogShell>
  );
};
