import React, { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const ChangePasswordPage: React.FC = () => {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // ✅ Thông tin liên hệ — dùng để tự động chèn vào file báo giá (.docx) khi
  // tải xuống, thay cho email/SĐT cũ đang gắn cứng trong file mẫu.
  const { user, refreshMe } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirm) {
      setMessage("Mật khẩu mới và xác nhận không khớp.");
      return;
    }
    try {
      await api.post("/auth/change-password", {
        oldPassword,
        newPassword,
      });
      setMessage("Đổi mật khẩu thành công.");
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: any) {
      setMessage(
        err?.response?.data?.message || "Không đổi được mật khẩu. Thử lại."
      );
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setSavingProfile(true);
    try {
      await api.put("/auth/profile", { email, phone });
      await refreshMe(); // ✅ nạp lại user trong context để chỗ khác dùng email/phone mới ngay
      setProfileMessage("Đã lưu thông tin liên hệ.");
    } catch (err: any) {
      setProfileMessage(
        err?.response?.data?.message || "Không lưu được thông tin. Thử lại."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* ✅ Thông tin liên hệ — chèn tự động vào báo giá khi tải xuống */}
      <div>
        <h2 className="text-xl font-semibold mb-1">Thông tin liên hệ</h2>
        <p className="mb-4 text-sm text-slate-500">
          Email/SĐT này sẽ tự động được chèn thay thế trong file báo giá (.docx) mỗi khi bạn tải
          xuống, không cần sửa tay từng file.
        </p>
        <form onSubmit={handleSaveProfile} className="max-w-md space-y-3 text-sm">
          <div>
            <label className="block mb-1 text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vd: sale.nguyen@mcbrother.com.vn"
              className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-700">Số điện thoại</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="vd: 0909123456"
              className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
            />
          </div>

          {profileMessage && (
            <div className="text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 mt-1">
              {profileMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={savingProfile}
            className="mt-2 px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {savingProfile ? "Đang lưu..." : "Lưu thông tin liên hệ"}
          </button>
        </form>
      </div>

      {/* ===== Đổi mật khẩu (giữ nguyên như cũ) ===== */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Đổi mật khẩu</h2>
        <form onSubmit={handleSubmit} className="max-w-md space-y-3 text-sm">
          <div>
            <label className="block mb-1 text-lg text-red-500p">
              Mật khẩu mới phải từ 6 kí tự trở lên
            </label>

            <label className="block mb-1 text-slate-700">Mật khẩu hiện tại</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-700">Mật khẩu mới</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-700">
              Xác nhận mật khẩu mới
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
            />
          </div>

          {message && (
            <div className="text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 mt-1">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="mt-2 px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-800"
          >
            Đổi mật khẩu
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordPage;