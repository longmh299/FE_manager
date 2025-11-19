import React, { useState } from "react";
import { api } from "../api/client";

const ChangePasswordPage: React.FC = () => {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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

  return (
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
  );
};

export default ChangePasswordPage;
