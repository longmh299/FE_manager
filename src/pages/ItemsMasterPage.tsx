// src/pages/ItemsMasterPage.tsx
import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Item } from "../types";
import { extractList } from "../utils/apiHelpers";
import { useAuth } from "../context/AuthContext";

const PAGE_SIZE = 50;

const ItemsMasterPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Item | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  if (!isAdmin) {
    return (
      <div className="text-sm text-red-600">
        Bạn không có quyền truy cập trang danh mục hàng.
      </div>
    );
  }

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (q) params.q = q;

      const res = await api.get("/items", { params });
      const list = extractList<Item>(res.data);
      setItems(list);
      setPage(1); // reset về trang 1 khi load mới / tìm kiếm
    } catch (err) {
      console.error("Error fetching items", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchItems();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    try {
      if (editing.id) {
        await api.put(`/items/${editing.id}`, editing);
      } else {
        const { id, ...payload } = editing;
        await api.post("/items", payload);
      }
      setEditing(null);
      fetchItems();
    } catch (err: any) {
      console.error("Save item error", err);
      alert(err?.response?.data?.message || "Không lưu được mặt hàng");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa mặt hàng này?")) return;
    try {
      await api.delete(`/items/${id}`);
      fetchItems();
    } catch (err: any) {
      console.error("Delete item error", err);
      alert(err?.response?.data?.message || "Không xóa được mặt hàng");
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      alert("Vui lòng chọn file Excel trước");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);

      await api.post("/items/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setImportFile(null);
      fetchItems();
      alert("Import danh mục hàng hóa thành công");
    } catch (err: any) {
      console.error("Import items error", err);
      alert(err?.response?.data?.message || "Import thất bại");
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    window.open(`${import.meta.env.VITE_API_BASE_URL}/items/export`, "_blank");
  };

  // ====== Phân trang client-side ======
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pagedItems = items.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">
        Danh mục mặt hàng (Admin)
      </h2>

      {/* Thanh filter + thêm mới + import */}
      <div className="flex flex-wrap gap-3 items-end mb-4 text-sm">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            placeholder="Tìm theo mã / tên..."
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
          onClick={() =>
            setEditing({
              id: "",
              sku: "",
              name: "",
              kind: "part",
              unit: "pcs",
              price: 0,
              note: "",
            })
          }
          className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500 ml-auto"
        >
          + Thêm hàng
        </button>

        <div className="flex flex-col gap-1 text-xs">
          <div className="font-semibold mb-1">Import danh mục hàng (Excel)</div>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3 py-1.5 rounded border"
            >
              Tải file mẫu / export hiện tại
            </button>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="text-xs"
            />
            <button
              type="button"
              disabled={importing}
              onClick={handleImport}
              className="px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-60"
            >
              {importing ? "Đang import..." : "Import Excel"}
            </button>
          </div>
        </div>
      </div>

      {/* Bảng items */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm text-sm overflow-auto">
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 border-b">Mã</th>
              <th className="text-left px-3 py-2 border-b">Tên</th>
              <th className="text-left px-3 py-2 border-b">Loại</th>
              <th className="text-right px-3 py-2 border-b">Giá bán</th>
              <th className="text-right px-3 py-2 border-b">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-center">
                  Đang tải...
                </td>
              </tr>
            )}

            {!loading && pagedItems.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-3 text-center text-slate-500"
                >
                  Chưa có mặt hàng
                </td>
              </tr>
            )}

            {!loading &&
              pagedItems.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b">{it.sku}</td>
                  <td className="px-3 py-2 border-b">{it.name}</td>
                  <td className="px-3 py-2 border-b">
                    {it.kind === "machine"
                      ? "Máy"
                      : it.kind === "part"
                      ? "Linh kiện"
                      : it.kind || "-"}
                  </td>
                  <td className="px-3 py-2 border-b text-right">
                    {typeof it.price === "number"
                      ? it.price.toLocaleString("vi-VN")
                      : "-"}
                  </td>
                  <td className="px-3 py-2 border-b text-right space-x-2">
                    <button
                      className="px-2 py-1 rounded border text-xs"
                      onClick={() => setEditing(it)}
                    >
                      Sửa
                    </button>
                    <button
                      className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                      onClick={() => handleDelete(it.id)}
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* Thanh phân trang */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 text-xs text-slate-600">
          <div>
            Trang {currentPage}/{totalPages} – Tổng: {items.length} mặt hàng
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2 py-1 rounded border disabled:opacity-40"
            >
              Trước
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`px-2 py-1 rounded border ${
                  n === currentPage
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white hover:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2 py-1 rounded border disabled:opacity-40"
            >
              Sau
            </button>
          </div>
        </div>
      </div>

      {/* Popup edit item */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg text-sm">
            <h3 className="font-semibold mb-4 text-slate-800">
              {editing.id ? "Sửa mặt hàng" : "Thêm mặt hàng"}
            </h3>

            <form className="space-y-3" onSubmit={handleSave}>
              <div>
                <label className="block mb-1 text-slate-700">SKU</label>
                <input
                  className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                  value={editing.sku}
                  onChange={(e) =>
                    setEditing({ ...editing, sku: e.target.value })
                  }
                />
              </div>
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
                  <label className="block mb-1 text-slate-700">Loại</label>
                  <select
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={editing.kind || "part"}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        kind: e.target.value as any,
                      })
                    }
                  >
                    <option value="part">Linh kiện</option>
                    <option value="machine">Máy</option>
                    <option value="">Khác</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-slate-700">Đơn vị</label>
                  <input
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={editing.unit}
                    onChange={(e) =>
                      setEditing({ ...editing, unit: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 text-slate-700">Giá bán</label>
                  <input
                    type="number"
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={editing.price ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        price: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-700">Ghi chú</label>
                  <input
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={editing.note ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, note: e.target.value })
                    }
                  />
                </div>
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

export default ItemsMasterPage;
