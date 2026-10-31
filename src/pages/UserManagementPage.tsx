// src/pages/UserManagementPage.tsx
import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

type UserRole = "staff" | "accountant" | "admin";

interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  hasPin?: boolean; // ✅ đã đặt mật khẩu cấp 2 chưa
}

const roleLabels: Record<UserRole, string> = {
  staff: "Staff",
  accountant: "Accountant",
  admin: "Admin",
};

const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  // ===== Create user modal =====
  const [openCreate, setOpenCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const { user: me } = useAuth(); // ✅ không cho tự xoá mật khẩu cấp 2 của chính mình
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("staff");

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.get<User[]>("/auth/users");
      setUsers(res.data);
    } catch (err: any) {
      setMessageKind("error");
      setMessage(err?.response?.data?.message || "Không load được danh sách user.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleChangeRole = async (userId: string, role: UserRole) => {
    try {
      setMessage(null);
      await api.patch(`/auth/users/${userId}/role`, { role });

      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      setMessageKind("success");
      setMessage("Cập nhật quyền thành công.");
    } catch (err: any) {
      setMessageKind("error");
      setMessage(err?.response?.data?.message || "Không cập nhật được quyền user.");
    }
  };

  // ✅ admin xoá mật khẩu cấp 2 khi người dùng quên; người đó tự đặt lại lần huỷ phiếu kế tiếp
  const handleResetPin = async (u: User) => {
    if (!window.confirm(`Xoá mật khẩu cấp 2 của ${u.username}? Người này phải đặt lại trước khi làm các thao tác cần mật khẩu cấp 2.`)) return;
    try {
      setMessage(null);
      await api.delete(`/auth/users/${u.id}/pin`);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, hasPin: false } : x)));
      setMessageKind("success");
      setMessage(`Đã xoá mật khẩu cấp 2 của ${u.username}.`);
    } catch (err: any) {
      setMessageKind("error");
      setMessage(err?.response?.data?.message || "Không xoá được mật khẩu cấp 2.");
    }
  };

  const resetCreateForm = () => {
    setNewUsername("");
    setNewPassword("");
    setNewRole("staff");
  };

  const closeCreateModal = () => {
    setOpenCreate(false);
    setCreateLoading(false);
    resetCreateForm();
  };

  const handleCreateUser = async () => {
    const username = newUsername.trim();
    const password = newPassword;

    if (!username || !password) {
      setMessageKind("error");
      setMessage("Vui lòng nhập Username và Password.");
      return;
    }

    try {
      setCreateLoading(true);
      setMessage(null);

      // ✅ endpoint theo ảnh: POST /api/auth/register
      await api.post("/auth/register", {
        username,
        password,
        role: newRole,
      });

      setMessageKind("success");
      setMessage("Tạo tài khoản thành công.");
      closeCreateModal();
      await fetchUsers();
    } catch (err: any) {
      setMessageKind("error");
      setMessage(err?.response?.data?.message || "Không tạo được tài khoản.");
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-xl font-semibold">Quản lý người dùng</h2>

        <button
          onClick={() => {
            setMessage(null);
            setMessageKind("success");
            setOpenCreate(true);
          }}
          className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
        >
          + Tạo tài khoản
        </button>
      </div>

      {message && (
        <div
          className={`mb-3 text-xs rounded px-3 py-2 border ${
            messageKind === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Đang tải...</div>
      ) : (
        <>
        {/* ✅ ĐIỆN THOẠI: mỗi người 1 thẻ */}
        <div className="space-y-2 md:hidden">
          {users.length === 0 && <div className="py-4 text-center text-xs text-slate-500">Chưa có user nào.</div>}
          {users.map((u) => (
            <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-900">{u.username}</div>
                  <div className="text-xs text-slate-500">Tạo {new Date(u.createdAt).toLocaleDateString("vi-VN")}</div>
                </div>
                <select
                  value={u.role}
                  onChange={(e) => handleChangeRole(u.id, e.target.value as UserRole)}
                  className="rounded-lg border px-2 text-sm"
                  aria-label={`Quyền của ${u.username}`}
                >
                  <option value="staff">Nhân viên</option>
                  <option value="accountant">Kế toán</option>
                  <option value="admin">Quản trị</option>
                </select>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  Mật khẩu cấp 2: {u.hasPin ? <span className="text-teal-700">Đã đặt</span> : <span className="text-slate-400">Chưa đặt</span>}
                </span>
                {u.hasPin && String(u.id) !== String((me as any)?.id) && (
                  <button type="button" onClick={() => handleResetPin(u)} className="rounded-lg border border-slate-200 px-3 text-slate-600">
                    Xoá mật khẩu cấp 2
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-sm border border-slate-200 bg-white rounded">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left border-b border-slate-200">Username</th>
                <th className="px-3 py-2 text-left border-b border-slate-200">Role</th>
                <th className="px-3 py-2 text-left border-b border-slate-200">Ngày tạo</th>
                <th className="px-3 py-2 text-left border-b border-slate-200">Mật khẩu cấp 2</th>
                <th className="px-3 py-2 text-left border-b border-slate-200">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b border-slate-100">{u.username}</td>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                      {roleLabels[u.role]}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-xs">
                    {u.hasPin ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-teal-700">Đã đặt</span>
                        {String(u.id) !== String((me as any)?.id) && (
                        <button
                          type="button"
                          onClick={() => handleResetPin(u)}
                          className="rounded border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
                        >
                          Xoá
                        </button>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">Chưa đặt</span>
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeRole(u.id, e.target.value as UserRole)}
                      className="border rounded px-2 py-1 text-xs outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    >
                      <option value="staff">Staff</option>
                      <option value="accountant">Accountant</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}

              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-500">
                    Chưa có user nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* ===== Create User Modal ===== */}
      {openCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => {
            // click backdrop to close
            if (e.target === e.currentTarget) closeCreateModal();
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-lg border border-slate-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="font-semibold">Tạo tài khoản</div>
              <button
                onClick={closeCreateModal}
                className="rounded px-2 py-1 text-sm hover:bg-slate-100"
                title="Đóng"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs text-slate-600 mb-1">Username</div>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="vd: linh, admin2..."
                  className="w-full border rounded px-3 py-2 text-sm outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                />
              </div>

              <div>
                <div className="text-xs text-slate-600 mb-1">Password</div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  className="w-full border rounded px-3 py-2 text-sm outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                />
              </div>

              <div>
                <div className="text-xs text-slate-600 mb-1">Role</div>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full border rounded px-3 py-2 text-sm outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                >
                  <option value="staff">Staff</option>
                  <option value="accountant">Accountant</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button
                onClick={closeCreateModal}
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                disabled={createLoading}
              >
                Hủy
              </button>
              <button
                onClick={handleCreateUser}
                className="rounded bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={createLoading}
              >
                {createLoading ? "Đang tạo..." : "Tạo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagementPage;
