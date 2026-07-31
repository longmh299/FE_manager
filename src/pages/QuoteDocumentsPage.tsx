// src/pages/QuoteDocumentsPage.tsx
import React, { useEffect, useState } from "react";
import { saveAs } from "file-saver";
import api, { extractList } from "../api/client";
import { useAuth } from "../context/AuthContext";

type QuoteDoc = {
  id: string;
  title: string;
  machineCode?: string | null;
  category?: string | null;
  note?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  uploadedBy?: { id: string; username: string } | null;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const QuoteDocumentsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin"; // ✅ chỉ admin được xoá báo giá

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<QuoteDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // form upload
  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState("");
  const [machineCode, setMachineCode] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // ✅ form cập nhật (sửa thông tin và/hoặc thay file khi giá đổi)
  const [editingDoc, setEditingDoc] = useState<QuoteDoc | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMachineCode, setEditMachineCode] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/quote-documents", { params: { q, page, pageSize } });
      const data = res.data;
      setRows(extractList<QuoteDoc>(data));
      setTotal(data?.total ?? 0);
    } catch (err) {
      console.error("load quote documents error", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Chọn file báo giá (Word/PDF) trước đã.");
      return;
    }
    if (!title.trim()) {
      setError("Nhập tên báo giá / tên máy để sau này dễ tìm.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      if (machineCode.trim()) formData.append("machineCode", machineCode.trim());
      if (category.trim()) formData.append("category", category.trim());
      if (note.trim()) formData.append("note", note.trim());

      await api.post("/quote-documents", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setTitle("");
      setMachineCode("");
      setCategory("");
      setNote("");
      setFile(null);
      setShowUpload(false);
      setPage(1);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Tải file lên thất bại");
    } finally {
      setUploading(false);
    }
  }

  function openEdit(doc: QuoteDoc) {
    setEditingDoc(doc);
    setEditTitle(doc.title);
    setEditMachineCode(doc.machineCode || "");
    setEditCategory(doc.category || "");
    setEditNote(doc.note || "");
    setEditFile(null);
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDoc) return;
    if (!editTitle.trim()) {
      alert("Tên báo giá không được để trống.");
      return;
    }
    setSavingEdit(true);
    try {
      const formData = new FormData();
      formData.append("title", editTitle.trim());
      formData.append("machineCode", editMachineCode.trim());
      formData.append("category", editCategory.trim());
      formData.append("note", editNote.trim());
      if (editFile) formData.append("file", editFile); // ✅ chỉ gửi khi có chọn file mới (giá đổi)

      await api.put(`/quote-documents/${editingDoc.id}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setEditingDoc(null);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Cập nhật thất bại");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDownload(doc: QuoteDoc) {
    setDownloadingId(doc.id);
    try {
      const res = await api.get(`/quote-documents/${doc.id}/download`, { responseType: "blob" });
      saveAs(res.data, doc.fileName);
    } catch (err) {
      console.error("download error", err);
      alert("Tải file thất bại, thử lại sau.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function onDelete(doc: QuoteDoc) {
    if (!window.confirm(`Xoá file "${doc.title}"? Không thể hoàn tác.`)) return;
    try {
      await api.delete(`/quote-documents/${doc.id}`);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Xoá thất bại");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Kho báo giá (file Word/PDF)</h1>
        <button
          className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          onClick={() => setShowUpload((v) => !v)}
        >
          {showUpload ? "Đóng" : "+ Tải báo giá lên"}
        </button>
      </div>

      {showUpload && (
        <form onSubmit={onUpload} className="mb-5 rounded border p-4 space-y-3 bg-slate-50">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-red-700 text-sm">{error}</div>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-sm">
              Tên báo giá / tên máy <span className="text-red-500">*</span>
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                placeholder='vd "Máy đóng vỉ DPP-150E"'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Mã máy (để tìm nhanh)
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                placeholder='vd "DPP-150E"'
                value={machineCode}
                onChange={(e) => setMachineCode(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Nhóm máy (tuỳ chọn)
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                placeholder='vd "Máy đóng gói"'
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              File báo giá (.doc, .docx, .pdf...) <span className="text-red-500">*</span>
              <input
                type="file"
                className="mt-1 block w-full rounded border px-3 py-2 bg-white"
                accept=".doc,.docx,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
          <label className="block text-sm">
            Ghi chú (tuỳ chọn)
            <textarea
              className="mt-1 block w-full rounded border px-3 py-2"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={uploading}
            className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploading ? "Đang tải lên..." : "Lưu vào kho"}
          </button>
        </form>
      )}

      <form onSubmit={onSearch} className="mb-4 flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="Tìm theo tên máy, mã máy, tên file..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="rounded border px-4 py-2 hover:bg-slate-50">
          Tìm
        </button>
      </form>

      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Tên báo giá</th>
              <th className="px-3 py-2 text-left">Mã máy</th>
              <th className="px-3 py-2 text-left">File</th>
              <th className="px-3 py-2 text-left">Dung lượng</th>
              <th className="px-3 py-2 text-left">Người tải lên</th>
              <th className="px-3 py-2 text-left">Ngày tải lên</th>
              <th className="px-3 py-2 text-left">Cập nhật lần cuối</th>
              <th className="px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Đang tải...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Chưa có báo giá nào được tải lên
                </td>
              </tr>
            ) : (
              rows.map((doc) => (
                <tr key={doc.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{doc.title}</div>
                    {doc.note && <div className="text-xs text-slate-400">{doc.note}</div>}
                  </td>
                  <td className="px-3 py-2">{doc.machineCode || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{doc.fileName}</td>
                  <td className="px-3 py-2">{formatBytes(doc.fileSize)}</td>
                  <td className="px-3 py-2">{doc.uploadedBy?.username || "—"}</td>
                  <td className="px-3 py-2">{formatDate(doc.createdAt)}</td>
                  <td className="px-3 py-2">
                    {/* ✅ chỉ hiện badge "Đã cập nhật" nếu thực sự có sửa sau khi tạo (lệch > 1 phút) */}
                    {new Date(doc.updatedAt).getTime() - new Date(doc.createdAt).getTime() > 60_000 ? (
                      <span>
                        {formatDate(doc.updatedAt)}{" "}
                        <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Đã cập nhật
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      className="rounded border px-3 py-1 mr-2 hover:bg-slate-100"
                      onClick={() => openEdit(doc)}
                    >
                      Cập nhật
                    </button>
                    <button
                      className="rounded border px-3 py-1 mr-2 hover:bg-slate-100 disabled:opacity-50"
                      disabled={downloadingId === doc.id}
                      onClick={() => onDownload(doc)}
                    >
                      {downloadingId === doc.id ? "Đang tải..." : "Tải xuống"}
                    </button>
                    {isAdmin && (
                      <button
                        className="rounded border px-3 py-1 text-red-600 hover:bg-red-50"
                        onClick={() => onDelete(doc)}
                      >
                        Xoá
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span>Tổng: {total} báo giá</span>
        <div className="flex gap-2">
          <button
            className="rounded border px-3 py-1 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Trước
          </button>
          <span>
            Trang {page}/{totalPages}
          </span>
          <button
            className="rounded border px-3 py-1 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Sau
          </button>
        </div>
      </div>

      {/* ✅ Modal cập nhật báo giá (sửa thông tin và/hoặc thay file khi giá đổi) */}
      {editingDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEditingDoc(null)}
        >
          <form
            className="w-full max-w-lg rounded bg-white p-5 shadow-lg space-y-3"
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSaveEdit}
          >
            <h2 className="text-lg font-semibold">Cập nhật báo giá</h2>
            <p className="text-xs text-slate-500">
              File hiện tại: <span className="font-medium">{editingDoc.fileName}</span>
            </p>

            <label className="block text-sm">
              Tên báo giá / tên máy
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Mã máy
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                value={editMachineCode}
                onChange={(e) => setEditMachineCode(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Nhóm máy
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Ghi chú
              <textarea
                className="mt-1 block w-full rounded border px-3 py-2"
                rows={2}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              Thay file mới (chỉ chọn khi <b>giá đổi</b> hoặc nội dung báo giá thay đổi — bỏ trống nếu chỉ sửa thông tin bên trên)
              <input
                type="file"
                className="mt-1 block w-full rounded border px-3 py-2 bg-white"
                accept=".doc,.docx,.pdf"
                onChange={(e) => setEditFile(e.target.files?.[0] || null)}
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded border px-4 py-2 hover:bg-slate-50"
                onClick={() => setEditingDoc(null)}
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingEdit ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default QuoteDocumentsPage;