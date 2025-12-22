// src/pages/PaymentAccountsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

type AccountType = "CASH" | "BANK";

type PaymentAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  bankName?: string | null;
  accountNo?: string | null;
  holder?: string | null;
  isActive: boolean;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function pickList(resData: any): PaymentAccount[] {
  // support cả 2 kiểu: array hoặc {ok,data}
  if (Array.isArray(resData)) return resData;
  if (resData?.data && Array.isArray(resData.data)) return resData.data;
  return [];
}

// function pickOne(resData: any): PaymentAccount | null {
//   if (resData?.data && typeof resData.data === "object") return resData.data;
//   if (resData && typeof resData === "object" && resData.id) return resData;
//   return null;
// }

const PaymentAccountsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeOnly, setActiveOnly] = useState(false); // mặc định show cả inactive để admin quản
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PaymentAccount[]>([]);
  const [q, setQ] = useState("");

  const [editing, setEditing] = useState<PaymentAccount | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    type: "BANK" as AccountType,
    bankName: "",
    accountNo: "",
    holder: "",
    note: "",
    isActive: true,
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      code: "",
      name: "",
      type: "BANK",
      bankName: "",
      accountNo: "",
      holder: "",
      note: "",
      isActive: true,
    });
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get("/payment-accounts", {
        params: { active: activeOnly ? 1 : 0 },
      });
      setRows(pickList(res.data));
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const blob = [
        r.code,
        r.name,
        r.type,
        r.bankName ?? "",
        r.accountNo ?? "",
        r.holder ?? "",
        r.note ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(s);
    });
  }, [rows, q]);

  const openEdit = (r: PaymentAccount) => {
    setEditing(r);
    setForm({
      code: r.code ?? "",
      name: r.name ?? "",
      type: (r.type ?? "BANK") as AccountType,
      bankName: r.bankName ?? "",
      accountNo: r.accountNo ?? "",
      holder: r.holder ?? "",
      note: r.note ?? "",
      isActive: !!r.isActive,
    });
  };

  const save = async () => {
    if (!isAdmin) return;

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      bankName: form.bankName.trim() || null,
      accountNo: form.accountNo.trim() || null,
      holder: form.holder.trim() || null,
      note: form.note.trim() || null,
      isActive: !!form.isActive,
    };

    if (!payload.code || !payload.name) {
      alert("Thiếu code hoặc tên tài khoản.");
      return;
    }

    try {
      if (editing) {
        await api.patch(`/payment-accounts/${editing.id}`, payload);
      } else {
        await api.post(`/payment-accounts`, payload);
      }
      resetForm();
      await fetchData();
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.message || e?.response?.data?.error || "Lưu thất bại.");
    }
  };

  const deactivate = async (r: PaymentAccount) => {
    if (!isAdmin) return;
    if (!window.confirm(`Khoá tài khoản "${r.code} - ${r.name}"?`)) return;

    try {
      await api.delete(`/payment-accounts/${r.id}`);
      await fetchData();
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.message || "Không khoá được tài khoản.");
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tài khoản nhận tiền</h1>
        <button
          onClick={fetchData}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm"
        >
          Làm mới
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Tìm kiếm</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="code / tên / ngân hàng / số TK / chủ TK..."
            className="border rounded px-3 py-2 w-full"
          />
        </div>

        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            Chỉ hiện tài khoản đang hoạt động
          </label>
        </div>

        <div className="flex items-end">
          <div className="text-sm text-slate-500">
            {loading ? "Đang tải..." : `${filtered.length} tài khoản`}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="border rounded bg-white shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">
            {editing ? `Sửa: ${editing.code}` : "Tạo tài khoản mới"}
          </div>
          {editing && (
            <button onClick={resetForm} className="text-sm text-slate-600 hover:underline">
              Huỷ sửa
            </button>
          )}
        </div>

        {!isAdmin && (
          <div className="text-sm text-slate-500 mb-2">
            Bạn chỉ có quyền xem. (admin mới được tạo/sửa/khoá)
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Code</label>
            <input
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tên</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Loại</label>
            <select
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as AccountType }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            >
              <option value="BANK">Ngân hàng</option>
              <option value="CASH">Tiền mặt</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Ngân hàng</label>
            <input
              value={form.bankName}
              onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Số TK</label>
            <input
              value={form.accountNo}
              onChange={(e) => setForm((p) => ({ ...p, accountNo: e.target.value }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Chủ TK</label>
            <input
              value={form.holder}
              onChange={(e) => setForm((p) => ({ ...p, holder: e.target.value }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Ghi chú</label>
            <input
              value={form.note}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
              className="border rounded px-2 py-2 w-full"
              disabled={!isAdmin}
            />
          </div>

          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                disabled={!isAdmin}
              />
              Đang hoạt động
            </label>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={save}
            disabled={!isAdmin}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-4 py-2 rounded text-sm"
          >
            {editing ? "Lưu thay đổi" : "Tạo tài khoản"}
          </button>
          <button
            onClick={resetForm}
            className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2 rounded text-sm"
          >
            Nhập lại
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto border rounded bg-white shadow-sm">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr className="text-slate-700">
              <th className="border px-2 py-2 text-left">Code</th>
              <th className="border px-2 py-2 text-left">Tên</th>
              <th className="border px-2 py-2 text-left">Loại</th>
              <th className="border px-2 py-2 text-left">Ngân hàng</th>
              <th className="border px-2 py-2 text-left">Số TK</th>
              <th className="border px-2 py-2 text-left">Chủ TK</th>
              <th className="border px-2 py-2 text-center">Active</th>
              <th className="border px-2 py-2 text-left">Ghi chú</th>
              <th className="border px-2 py-2 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={r.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                <td className="border px-2 py-2">{r.code}</td>
                <td className="border px-2 py-2">{r.name}</td>
                <td className="border px-2 py-2">{r.type}</td>
                <td className="border px-2 py-2">{r.bankName || ""}</td>
                <td className="border px-2 py-2">{r.accountNo || ""}</td>
                <td className="border px-2 py-2">{r.holder || ""}</td>
                <td className="border px-2 py-2 text-center">
                  {r.isActive ? "✅" : "⛔"}
                </td>
                <td className="border px-2 py-2">{r.note || ""}</td>
                <td className="border px-2 py-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => openEdit(r)}
                      className="text-blue-600 hover:underline"
                    >
                      Sửa
                    </button>
                    {isAdmin && r.isActive && (
                      <button
                        onClick={() => deactivate(r)}
                        className="text-red-600 hover:underline"
                      >
                        Khoá
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="border px-2 py-4 text-center text-slate-500">
                  Không có dữ liệu
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PaymentAccountsPage;
