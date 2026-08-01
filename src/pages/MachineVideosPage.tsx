// src/pages/MachineVideosPage.tsx
import React, { useEffect, useState } from "react";
import api, { extractList } from "../api/client";
import { useAuth } from "../context/AuthContext";

type VideoDoc = {
  id: string;
  title: string;
  machineCode?: string | null;
  category?: string | null;
  note?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  updatedAt: string;
  uploadedBy?: { id: string; username: string } | null;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const MachineVideosPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<VideoDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState("");
  const [machineCode, setMachineCode] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ✅ Xem trước video ngay trong trang (không cần tải về máy)
  const [previewDoc, setPreviewDoc] = useState<VideoDoc | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ✅ Cập nhật thông tin (tên/mã máy/nhóm/ghi chú) — không đổi file gốc.
  // Nếu quay lại video khác hẳn thì nên xoá + upload mới cho rõ ràng, đỡ nhầm lẫn.
  const [editingDoc, setEditingDoc] = useState<VideoDoc | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMachineCode, setEditMachineCode] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/machine-videos", { params: { q, page, pageSize } });
      const data = res.data;
      setRows(extractList<VideoDoc>(data));
      setTotal(data?.total ?? 0);
    } catch (err) {
      console.error("load machine videos error", err);
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

  // ✅ Upload trực tiếp lên R2 bằng XMLHttpRequest (không qua backend) để:
  //    - không giới hạn bởi RAM/timeout của Render
  //    - có % tiến trình cho video nặng (fetch không hỗ trợ tốt việc này)
  function putToR2(uploadUrl: string, f: File, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", f.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload lên storage thất bại (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload lên storage thất bại (mất kết nối mạng)"));
      xhr.send(f);
    });
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Chọn file video trước đã.");
      return;
    }
    if (!title.trim()) {
      setError("Nhập tên video / tên máy để sau này dễ tìm.");
      return;
    }

    setUploading(true);
    setUploadPct(0);
    try {
      // Bước 1: xin URL upload trực tiếp
      const initRes = await api.post("/machine-videos/init", {
        title: title.trim(),
        machineCode: machineCode.trim() || undefined,
        category: category.trim() || undefined,
        note: note.trim() || undefined,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
      });
      const { id, uploadUrl } = initRes.data;

      // Bước 2: PUT file thẳng lên R2, giữ nguyên chất lượng gốc (không nén/convert)
      await putToR2(uploadUrl, file, setUploadPct);

      // Bước 3: báo backend xác nhận đã upload xong
      await api.post(`/machine-videos/${id}/complete`);

      setTitle("");
      setMachineCode("");
      setCategory("");
      setNote("");
      setFile(null);
      setShowUpload(false);
      setPage(1);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Tải video lên thất bại");
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  function openEdit(doc: VideoDoc) {
    setEditingDoc(doc);
    setEditTitle(doc.title);
    setEditMachineCode(doc.machineCode || "");
    setEditCategory(doc.category || "");
    setEditNote(doc.note || "");
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDoc) return;
    if (!editTitle.trim()) {
      alert("Tên video không được để trống.");
      return;
    }
    setSavingEdit(true);
    try {
      await api.put(`/machine-videos/${editingDoc.id}`, {
        title: editTitle.trim(),
        machineCode: editMachineCode.trim(),
        category: editCategory.trim(),
        note: editNote.trim(),
      });
      setEditingDoc(null);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Cập nhật thất bại");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onPreview(doc: VideoDoc) {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const res = await api.get(`/machine-videos/${doc.id}/preview-url`);
      setPreviewUrl(res.data.url);
    } catch (err) {
      console.error("preview error", err);
      alert("Không xem trước được video này, thử tải xuống thay thế.");
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewDoc(null);
    setPreviewUrl(null);
  }

  async function onDownload(doc: VideoDoc) {
    try {
      const res = await api.get(`/machine-videos/${doc.id}/download-url`);
      const { url } = res.data;
      // ✅ điều hướng trình duyệt tải thẳng từ R2 — không tải blob qua JS
      // (tránh chiếm RAM trình duyệt với file video vài GB)
      window.location.href = url;
    } catch (err) {
      console.error("download error", err);
      alert("Tải video thất bại, thử lại sau.");
    }
  }

  async function onDelete(doc: VideoDoc) {
    if (!window.confirm(`Xoá video "${doc.title}"? Không thể hoàn tác.`)) return;
    try {
      await api.delete(`/machine-videos/${doc.id}`);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Xoá thất bại");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Kho video vận hành máy</h1>
        <button
          className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          onClick={() => setShowUpload((v) => !v)}
        >
          {showUpload ? "Đóng" : "+ Tải video lên"}
        </button>
      </div>

      {showUpload && (
        <form onSubmit={onUpload} className="mb-5 rounded border p-4 space-y-3 bg-slate-50">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-red-700 text-sm">{error}</div>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-sm">
              Tên video / tên máy <span className="text-red-500">*</span>
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                placeholder='vd "Vận hành máy đóng vỉ DPP-150E"'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={uploading}
              />
            </label>
            <label className="block text-sm">
              Mã máy (để tìm nhanh)
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                placeholder='vd "DPP-150E"'
                value={machineCode}
                onChange={(e) => setMachineCode(e.target.value)}
                disabled={uploading}
              />
            </label>
            <label className="block text-sm">
              Nhóm máy (tuỳ chọn)
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={uploading}
              />
            </label>
            <label className="block text-sm">
              File video <span className="text-red-500">*</span>
              <input
                type="file"
                accept="video/*"
                className="mt-1 block w-full rounded border px-3 py-2 bg-white"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={uploading}
              />
              {file && (
                <span className="mt-1 block text-xs text-slate-500">{formatBytes(file.size)}</span>
              )}
            </label>
          </div>
          <label className="block text-sm">
            Ghi chú (tuỳ chọn)
            <textarea
              className="mt-1 block w-full rounded border px-3 py-2"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={uploading}
            />
          </label>

          {uploading && (
            <div>
              <div className="h-2 w-full rounded bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Đang tải lên... {uploadPct}% — video nặng có thể mất vài phút, đừng tắt trang.
              </div>
            </div>
          )}

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

      {/* ===== Desktop: bảng đầy đủ (giữ nguyên như cũ) ===== */}
      <div className="hidden md:block overflow-x-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Tên video</th>
              <th className="px-3 py-2 text-left">Mã máy</th>
              <th className="px-3 py-2 text-left">File</th>
              <th className="px-3 py-2 text-left">Dung lượng</th>
              <th className="px-3 py-2 text-left">Người tải lên</th>
              <th className="px-3 py-2 text-left">Ngày tải lên</th>
              <th className="px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Đang tải...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Chưa có video nào được tải lên
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
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      className="rounded border px-3 py-1 mr-2 hover:bg-slate-100"
                      onClick={() => openEdit(doc)}
                    >
                      Cập nhật
                    </button>
                    <button
                      className="rounded border px-3 py-1 mr-2 hover:bg-slate-100"
                      onClick={() => onPreview(doc)}
                    >
                      Xem trước
                    </button>
                    <button
                      className="rounded border px-3 py-1 mr-2 hover:bg-slate-100"
                      onClick={() => onDownload(doc)}
                    >
                      Tải xuống
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

      {/* ===== Mobile: dạng thẻ xếp dọc, KHÔNG hiện cột "File" (tên file thô không cần
          thiết với người dùng cuối) — chỉ giữ thông tin thật sự cần: tên, mã máy, dung
          lượng, người/ngày tải lên, và các nút thao tác xếp thành lưới cho dễ bấm. ===== */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="rounded border bg-white px-4 py-6 text-center text-slate-500">Đang tải...</div>
        ) : rows.length === 0 ? (
          <div className="rounded border bg-white px-4 py-6 text-center text-slate-500">
            Chưa có video nào được tải lên
          </div>
        ) : (
          rows.map((doc) => (
            <div key={doc.id} className="rounded border bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">{doc.title}</div>
                  {doc.machineCode && (
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      Mã máy: {doc.machineCode}
                    </span>
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">{formatBytes(doc.fileSize)}</span>
              </div>

              {doc.note && <div className="mt-1 text-xs text-slate-400 break-words">{doc.note}</div>}

              <div className="mt-2 text-xs text-slate-400">
                {doc.uploadedBy?.username || "—"} · {formatDate(doc.createdAt)}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="rounded border px-2 py-2 text-sm hover:bg-slate-100"
                  onClick={() => openEdit(doc)}
                >
                  Cập nhật
                </button>
                <button
                  className="rounded border px-2 py-2 text-sm hover:bg-slate-100"
                  onClick={() => onPreview(doc)}
                >
                  Xem trước
                </button>
                <button
                  className={`rounded border px-2 py-2 text-sm hover:bg-slate-100 ${!isAdmin ? "col-span-2" : ""}`}
                  onClick={() => onDownload(doc)}
                >
                  Tải xuống
                </button>
                {isAdmin && (
                  <button
                    className="rounded border px-2 py-2 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => onDelete(doc)}
                  >
                    Xoá
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span>Tổng: {total} video</span>
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

      {/* ✅ Modal cập nhật thông tin video (không đổi file gốc) */}
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
            <h2 className="text-lg font-semibold">Cập nhật thông tin video</h2>
            <p className="text-xs text-slate-500">
              File hiện tại: <span className="font-medium">{editingDoc.fileName}</span>{" "}
              (nếu cần đổi hẳn sang video khác, xoá video này rồi tải video mới lên sẽ rõ ràng hơn)
            </p>

            <label className="block text-sm">
              Tên video / tên máy
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

      {/* ✅ Modal xem trước video */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closePreview}
        >
          <div
            className="w-full max-w-3xl rounded bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{previewDoc.title}</h2>
              <button className="text-slate-500 hover:text-slate-800" onClick={closePreview}>
                ✕ Đóng
              </button>
            </div>
            {previewLoading ? (
              <div className="flex h-64 items-center justify-center text-slate-500">
                Đang tải video...
              </div>
            ) : previewUrl ? (
              <video
                src={previewUrl}
                controls
                autoPlay
                className="w-full rounded bg-black"
                style={{ maxHeight: "70vh" }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default MachineVideosPage;