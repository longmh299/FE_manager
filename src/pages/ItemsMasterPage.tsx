// src/pages/ItemsMasterPage.tsx
import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Item } from "../types";
import { extractList } from "../utils/apiHelpers";
import { useAuth } from "../context/AuthContext";
import DeleteItemDialog, { type DeleteItemTarget } from "../components/DeleteItemDialog";
import { appAlert } from "../components/AppDialog";

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
  const [excelOpen, setExcelOpen] = useState(false);

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
      appAlert(err?.response?.data?.message || "Không lưu được mặt hàng.", { title: "Chưa lưu được", tone: "danger" });
    }
  };

  // ✅ xoá: kiểm tra đã phát sinh chứng từ chưa + mật khẩu cấp 2 (hộp DeleteItemDialog)
  const [deleteTarget, setDeleteTarget] = useState<DeleteItemTarget | null>(null);
  const handleDelete = (it: any) => setDeleteTarget({ itemId: String(it.id), sku: it.sku, name: it.name });

  const handleImport = async () => {
    if (!importFile) {
      appAlert("Chọn file Excel trước đã.", { tone: "warning" });
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
      setExcelOpen(false);
      fetchItems();
      appAlert("Danh mục mặt hàng đã cập nhật theo file Excel.", { title: "Nhập xong", tone: "success" });
    } catch (err: any) {
      console.error("Import items error", err);
      appAlert(err?.response?.data?.message || "Không nhập được file. Kiểm tra lại file theo mẫu.", { title: "Nhập file lỗi", tone: "danger" });
    } finally {
      setImporting(false);
    }
  };

  // ✅ tải qua api (có gửi kèm đăng nhập). Trước đây mở thẳng link nên server từ chối (chưa đăng nhập) -> không tải được
  const downloadBlob = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Download error", err);
      appAlert(err?.response?.status === 403 ? "Bạn không có quyền tải file này." : "Không tải được file. Thử lại sau.", { tone: "danger" });
    }
  };

  const handleDownloadTemplate = () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    void downloadBlob("/items/export", `danh-muc-hang_${ymd}.xlsx`);
  };

  // ====== Phân trang client-side ======
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pagedItems = items.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Danh mục mặt hàng</h1>
          <p className="mt-0.5 text-sm text-slate-500">Mã hàng, tên, loại và giá bán dùng khi lập hoá đơn.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExcelOpen((v) => !v)}
            aria-expanded={excelOpen}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium ${
              excelOpen ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" strokeLinejoin="round" />
              <path d="M14 3v5h5M9 13l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Nhập / xuất Excel
          </button>
          <button
            type="button"
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Thêm mặt hàng
          </button>
        </div>
      </div>

      {excelOpen && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="text-sm font-medium text-slate-900">1. Tải file mẫu</div>
              <p className="mt-0.5 text-xs text-slate-500">File chứa toàn bộ mặt hàng hiện có, sửa / thêm dòng ngay trong đó.</p>
              <button type="button" onClick={handleDownloadTemplate} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Tải file Excel
              </button>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-900">2. Chọn file đã sửa</div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50">
                <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                  <path d="M12 16V4M7 9l5-5 5 5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate">{importFile ? importFile.name : "Bấm để chọn file .xlsx"}</span>
              </label>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-900">3. Nhập vào hệ thống</div>
              <p className="mt-0.5 text-xs text-slate-500">Mã trùng thì cập nhật, mã mới thì thêm.</p>
              <button
                type="button"
                disabled={importing || !importFile}
                onClick={handleImport}
                className="mt-2 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {importing ? "Đang nhập…" : "Nhập file"}
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="mb-3 flex gap-2 text-sm">
        <input
          placeholder="Tìm theo mã hoặc tên hàng…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
          Tìm
        </button>
      </form>

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
                    {String(it.kind || "").toLowerCase() === "machine"
                      ? "Máy"
                      : String(it.kind || "").toLowerCase() === "part"
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
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => setEditing(it)}
                    >
                      Sửa
                    </button>
                    <button
                      className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      onClick={() => handleDelete(it)}
                    >
                      Xoá
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
      <DeleteItemDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          fetchItems();
        }}
      />
    </div>
  );
};

export default ItemsMasterPage;
