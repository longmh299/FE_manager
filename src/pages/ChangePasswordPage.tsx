// src/pages/ChangePasswordPage.tsx
// ✅ Tài khoản của tôi: thông tin liên hệ (chèn vào báo giá), đổi mật khẩu đăng nhập, mật khẩu cấp 2
// API giữ nguyên: PUT /auth/profile { email, phone }, POST /auth/change-password { oldPassword, newPassword }, GET /auth/pin
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PinSettingsDialog } from "../components/SecondPassword";

const ROLE_LABEL: Record<string, string> = { admin: "Quản trị", accountant: "Kế toán", staff: "Nhân viên bán hàng" };
const MIN_LEN = 6;

/** lỗi dễ hiểu + mã lỗi, để biết là sai thông tin hay server không trả lời */
function apiErr(err: any, fallback: string) {
  const st = err?.response?.status;
  const msg = err?.response?.data?.message;
  if (msg) return msg;
  if (!err?.response) return "Không kết nối được máy chủ (BE). Kiểm tra BE còn chạy không rồi thử lại.";
  return `${fallback} (mã lỗi ${st})`;
}

type Note = { type: "ok" | "err"; text: string } | null;

/* ---------- ô mật khẩu có nút hiện / ẩn ---------- */
const PasswordField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
  hint?: React.ReactNode;
  disabled?: boolean;
}> = ({ id, label, value, onChange, autoComplete, invalid, hint, disabled }) => {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border bg-white focus-within:ring-4 ${
          invalid ? "border-rose-300 focus-within:ring-rose-100" : "border-slate-300 focus-within:border-slate-500 focus-within:ring-slate-100"
        }`}
      >
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          className="w-full rounded-xl bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="mr-1 shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          tabIndex={-1}
        >
          {show ? "Ẩn" : "Hiện"}
        </button>
      </div>
      {hint && <div className="mt-1.5 text-xs">{hint}</div>}
    </div>
  );
};

/* ---------- độ mạnh mật khẩu (gợi ý, không chặn) ---------- */
function strengthOf(pw: string) {
  if (!pw) return { score: 0, label: "", color: "" };
  let s = 0;
  if (pw.length >= MIN_LEN) s++;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < MIN_LEN) return { score: 1, label: "Quá ngắn", color: "bg-rose-500" };
  if (s <= 2) return { score: 2, label: "Tạm được", color: "bg-amber-500" };
  if (s === 3) return { score: 3, label: "Khá", color: "bg-sky-500" };
  return { score: 4, label: "Mạnh", color: "bg-emerald-500" };
}

const Card: React.FC<{ title: string; desc?: React.ReactNode; icon: React.ReactNode; children: React.ReactNode }> = ({ title, desc, icon, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
      </div>
    </div>
    <div className="px-5 py-4">{children}</div>
  </section>
);

const Banner: React.FC<{ note: Note }> = ({ note }) =>
  note ? (
    <div
      role="status"
      className={`rounded-xl px-3 py-2 text-sm ${note.type === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}
    >
      {note.type === "ok" ? "✓ " : ""}
      {note.text}
    </div>
  ) : null;

const icons = {
  contact: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3z" />
      <path d="M9 12h.01M12 12h.01M15 12h.01" strokeWidth={2.6} />
    </svg>
  ),
};

const ChangePasswordPage: React.FC = () => {
  const { user, refreshMe } = useAuth();
  const role = String(user?.role || "");
  const usesPin = role === "admin"; // ✅ mật khẩu cấp 2 chỉ dành cho quản trị

  /* ===== thông tin liên hệ ===== */
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState<Note>(null);
  useEffect(() => {
    setEmail(user?.email || "");
    setPhone(user?.phone || "");
  }, [user?.email, user?.phone]);
  const profileDirty = (email || "") !== (user?.email || "") || (phone || "") !== (user?.phone || "");

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileNote(null);
    setSavingProfile(true);
    try {
      await api.put("/auth/profile", { email: email.trim(), phone: phone.trim() });
      await refreshMe(); // nạp lại user để chỗ khác (báo giá) dùng email / SĐT mới ngay
      setProfileNote({ type: "ok", text: "Đã lưu thông tin liên hệ." });
    } catch (err: any) {
      setProfileNote({ type: "err", text: apiErr(err, "Không lưu được thông tin.") });
    } finally {
      setSavingProfile(false);
    }
  };

  /* ===== đổi mật khẩu ===== */
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwNote, setPwNote] = useState<Note>(null);

  const checks = [
    { ok: newPassword.length >= MIN_LEN, text: `Từ ${MIN_LEN} ký tự trở lên` },
    { ok: !!newPassword && newPassword !== oldPassword, text: "Khác mật khẩu hiện tại" },
    { ok: !!confirm && confirm === newPassword, text: "Nhập lại khớp" },
  ];
  const canSubmitPw = !!oldPassword && checks.every((c) => c.ok) && !savingPw;
  const strength = useMemo(() => strengthOf(newPassword), [newPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitPw) return;
    setPwNote(null);
    setSavingPw(true);
    try {
      await api.post("/auth/change-password", { oldPassword, newPassword });
      setPwNote({ type: "ok", text: "Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới." });
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: any) {
      setPwNote({ type: "err", text: apiErr(err, "Không đổi được mật khẩu.") });
    } finally {
      setSavingPw(false);
    }
  };

  /* ===== mật khẩu cấp 2 ===== */
  const [pin, setPin] = useState<{ hasPin: boolean; pinLength: number | null; lockedUntil: string | null } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const loadPin = () =>
    api
      .get("/auth/pin")
      .then((r) => setPin(r.data))
      .catch(() => setPin(null));
  useEffect(() => {
    if (usesPin) loadPin();
  }, [usesPin]);
  const pinLocked = pin?.lockedUntil && new Date(pin.lockedUntil) > new Date();

  const displayName = user?.fullName || user?.username || "";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* đầu trang */}
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-900 text-lg font-semibold uppercase text-white">
          {displayName.slice(0, 1) || "?"}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900">{displayName}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            {user?.fullName && <span>@{user?.username}</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{ROLE_LABEL[role] || role}</span>
          </div>
        </div>
      </div>

      {/* thông tin liên hệ */}
      <Card title="Thông tin liên hệ" icon={icons.contact} desc="Tự động chèn vào file báo giá (.docx) mỗi khi bạn tải xuống, không phải sửa tay từng file.">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pf-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="pf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sale.nguyen@mcbrother.com.vn"
                autoComplete="email"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>
            <div>
              <label htmlFor="pf-phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                Số điện thoại
              </label>
              <input
                id="pf-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0909 123 456"
                autoComplete="tel"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
              />
            </div>
          </div>
          <Banner note={profileNote} />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile || !profileDirty}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {savingProfile ? "Đang lưu…" : "Lưu thông tin"}
            </button>
          </div>
        </form>
      </Card>

      {/* đổi mật khẩu */}
      <Card title="Đổi mật khẩu đăng nhập" icon={icons.lock} desc="Dùng mật khẩu riêng, không dùng chung với tài khoản khác.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField
            id="pw-old"
            label="Mật khẩu hiện tại"
            value={oldPassword}
            onChange={(v) => {
              setOldPassword(v);
              setPwNote(null);
            }}
            autoComplete="current-password"
            disabled={savingPw}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField
              id="pw-new"
              label="Mật khẩu mới"
              value={newPassword}
              onChange={(v) => {
                setNewPassword(v);
                setPwNote(null);
              }}
              autoComplete="new-password"
              disabled={savingPw}
              hint={
                newPassword ? (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 gap-1" aria-hidden="true">
                      {[1, 2, 3, 4].map((i) => (
                        <span key={i} className={`h-1 flex-1 rounded-full ${i <= strength.score ? strength.color : "bg-slate-200"}`} />
                      ))}
                    </div>
                    <span className="w-16 text-right text-slate-500">{strength.label}</span>
                  </div>
                ) : null
              }
            />
            <PasswordField
              id="pw-confirm"
              label="Nhập lại mật khẩu mới"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                setPwNote(null);
              }}
              autoComplete="new-password"
              disabled={savingPw}
              invalid={!!confirm && confirm !== newPassword}
              hint={!!confirm && confirm !== newPassword ? <span className="text-rose-600">Chưa khớp với mật khẩu mới.</span> : null}
            />
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {checks.map((c) => (
              <li key={c.text} className={`flex items-center gap-1.5 ${c.ok ? "text-emerald-700" : "text-slate-500"}`}>
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${c.ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}
                >
                  {c.ok ? "✓" : "•"}
                </span>
                {c.text}
              </li>
            ))}
          </ul>

          <Banner note={pwNote} />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmitPw}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {savingPw ? "Đang đổi…" : "Đổi mật khẩu"}
            </button>
          </div>
        </form>
      </Card>

      {/* mật khẩu cấp 2 */}
      {usesPin && (
        <Card
          title="Mật khẩu cấp 2"
          icon={icons.pin}
          desc="Dãy 4 hoặc 6 số, hỏi lại khi huỷ phiếu thu chi, tạo hoặc ghi sổ phiếu điều chỉnh."
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              {!pin ? (
                <span className="text-sm text-slate-500">Đang tải…</span>
              ) : pinLocked ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-800">
                  Tạm khoá tới{" "}
                  {new Date(pin.lockedUntil as string).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} do nhập sai nhiều lần
                </span>
              ) : pin.hasPin ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800">
                  ✓ Đã đặt ({pin.pinLength} số)
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-700">Chưa đặt</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPinOpen(true)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {pin?.hasPin ? "Đổi mật khẩu cấp 2" : "Đặt mật khẩu cấp 2"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Quên mật khẩu cấp 2? Bấm Đổi mật khẩu cấp 2 rồi chọn “Dùng mã khôi phục” (mã cài trên server).</p>
        </Card>
      )}

      <PinSettingsDialog
        open={pinOpen}
        startEditing
        onClose={() => {
          setPinOpen(false);
          loadPin();
        }}
        onSaved={loadPin}
      />
    </div>
  );
};

export default ChangePasswordPage;
