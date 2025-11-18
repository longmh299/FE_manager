import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Partner } from "../types";

const emptyPartner: Partner = {
  id: "",
  name: "",
  taxCode: "",
  phone: "",
  address: "",
};

const PartnersPage: React.FC = () => {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [q, setQ] = useState("");

  const extractPartnerList = (raw: any): Partner[] => {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.items)) return raw.items;
    if (Array.isArray(raw?.results)) return raw.results;
    return [];
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get("/partners", {
        params: q ? { q } : {},
      });
      const list = extractPartnerList(res.data);
      setPartners(list);
    } catch (err) {
      console.error("Error fetching partners", err);
      setPartners([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      if (editing.id) {
        await api.put(`/partners/${editing.id}`, editing);
      } else {
        await api.post("/partners", editing);
      }
      setEditing(null);
      fetchData();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Không lưu được khách hàng");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa khách hàng này?")) return;
    try {
      await api.delete(`/partners/${id}`);
      fetchData();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Không xóa được khách hàng");
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Quản lý khách hàng</h2>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchData();
          }}
          className="flex items-center gap-2"
        >
          <input
            placeholder="Tìm theo tên, mã số thuế..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-800"
          >
            Tìm
          </button>
        </form>

        <button
          onClick={() => setEditing({ ...emptyPartner })}
          className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500 ml-auto"
        >
          + Thêm khách hàng
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-auto text-sm">
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 border-b">Tên khách hàng</th>
              <th className="text-left px-3 py-2 border-b">Mã số thuế</th>
              <th className="text-left px-3 py-2 border-b">Điện thoại</th>
              <th className="text-left px-3 py-2 border-b">Địa chỉ</th>
              <th className="text-right px-3 py-2 border-b">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-3 text-center" colSpan={5}>
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && partners.length === 0 && (
              <tr>
                <td
                  className="px-3 py-3 text-center text-slate-500"
                  colSpan={5}
                >
                  Không có khách hàng
                </td>
              </tr>
            )}
            {!loading &&
              partners.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b">{p.name}</td>
                  <td className="px-3 py-2 border-b">{p.taxCode || "-"}</td>
                  <td className="px-3 py-2 border-b">{p.phone || "-"}</td>
                  <td className="px-3 py-2 border-b">{p.address || "-"}</td>
                  <td className="px-3 py-2 border-b text-right space-x-2">
                    <button
                      className="px-2 py-1 rounded border text-xs"
                      onClick={() => setEditing(p)}
                    >
                      Sửa
                    </button>
                    <button
                      className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                      onClick={() => handleDelete(p.id)}
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg text-sm">
            <h3 className="font-semibold mb-4 text-slate-800">
              {editing.id ? "Sửa khách hàng" : "Thêm khách hàng"}
            </h3>
            <form className="space-y-3" onSubmit={handleSave}>
              <div>
                <label className="block mb-1 text-slate-700">Tên</label>
                <input
                  className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 text-slate-700">
                    Mã số thuế
                  </label>
                  <input
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={editing.taxCode || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, taxCode: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-700">
                    Điện thoại
                  </label>
                  <input
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={editing.phone || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, phone: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block mb-1 text-slate-700">Địa chỉ</label>
                <textarea
                  className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                  value={editing.address || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, address: e.target.value })
                  }
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-3 py-1 rounded border text-xs"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded bg-slate-900 text-white text-xs"
                >
                  Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnersPage;
