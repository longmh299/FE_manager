import React, { useEffect, useState } from "react";
import { api } from "../api/client";

type UserRole = "staff" | "accountant" | "admin";

interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
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

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.get<User[]>("/auth/users");
      setUsers(res.data);
    } catch (err: any) {
      setMessage(
        err?.response?.data?.message || "Không load được danh sách user."
      );
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

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role } : u))
      );
      setMessage("Cập nhật quyền thành công.");
    } catch (err: any) {
      setMessage(
        err?.response?.data?.message || "Không cập nhật được quyền user."
      );
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Quản lý người dùng</h2>

      {message && (
        <div className="mb-3 text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2">
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Đang tải...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-slate-200 bg-white rounded">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left border-b border-slate-200">
                  Username
                </th>
                <th className="px-3 py-2 text-left border-b border-slate-200">
                  Role
                </th>
                <th className="px-3 py-2 text-left border-b border-slate-200">
                  Ngày tạo
                </th>
                <th className="px-3 py-2 text-left border-b border-slate-200">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b border-slate-100">
                    {u.username}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                      {roleLabels[u.role]}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        handleChangeRole(u.id, e.target.value as UserRole)
                      }
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
                  <td
                    colSpan={4}
                    className="px-3 py-4 text-center text-xs text-slate-500"
                  >
                    Chưa có user nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UserManagementPage;
