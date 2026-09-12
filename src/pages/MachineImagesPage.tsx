// src/pages/MachineImagesPage.tsx
import React, { useEffect, useState } from "react";
import api, { extractList } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast, ToastHost } from "../components/Toast";

type ImageDoc = {
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
  // ✅ backend trả sẵn link xem trực tiếp cho từng ảnh trong danh sách (để hiện
  // thumbnail ngay trên lưới) — khác với video (chỉ xin link khi bấm "Xem trước",
  // vì ảnh nhẹ hơn nhiều nên load thẳng cả list không tốn kém như video).
  previewUrl?: string;
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

// ✅ Phát hiện iOS (Safari/Chrome trên iPhone, iPad — kể cả iPad "giả desktop"
// từ iPadOS 13+ trở đi, nhận diện qua Macintosh + có cảm ứng).
function isIOSDevice() {
  const ua = navigator.userAgent || "";
  const isAppleTouch = /iPad|iPhone|iPod/.test(ua);
  const isIPadOSDesktopMode = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
  return isAppleTouch || isIPadOSDesktopMode;
}

const MachineImagesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ImageDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(24); // bội số của 2/3/4 cột cho lưới đẹp
  const [loading, setLoading] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState("");
  const [machineCode, setMachineCode] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]); // ✅ ảnh cho phép chọn nhiều file 1 lần
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ✅ Xem phóng to ảnh ngay trong trang
  const [previewDoc, setPreviewDoc] = useState<ImageDoc | null>(null);

  // ✅ Cập nhật thông tin (tên/mã máy/nhóm/ghi chú) — không đổi file gốc
  const [editingDoc, setEditingDoc] = useState<ImageDoc | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMachineCode, setEditMachineCode] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { toasts, push: pushToast, remove: removeToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/machine-images", { params: { q, page, pageSize } });
      const data = res.data;
      setRows(extractList<ImageDoc>(data));
      setTotal(data?.total ?? 0);
    } catch (err) {
      console.error("load machine images error", err);
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

  // ✅ Upload trực tiếp lên R2 bằng XMLHttpRequest (không qua backend), giống video —
  //    tránh giới hạn RAM/timeout backend và có % tiến trình.
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
    if (files.length === 0) {
      setError("Chọn ít nhất 1 ảnh trước đã.");
      return;
    }
    if (!title.trim()) {
      setError("Nhập tên ảnh / tên máy để sau này dễ tìm.");
      return;
    }

    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadIndex(i + 1);
        setUploadPct(0);

        // Bước 1: xin URL upload trực tiếp
        const initRes = await api.post("/machine-images/init", {
          // ✅ nhiều ảnh cùng lúc thì đánh số cho khỏi trùng tên hiển thị
          title: files.length > 1 ? `${title.trim()} (${i + 1})` : title.trim(),
          machineCode: machineCode.trim() || undefined,
          category: category.trim() || undefined,
          note: note.trim() || undefined,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        });
        const { id, uploadUrl } = initRes.data;

        // Bước 2: PUT file thẳng lên R2, giữ nguyên chất lượng gốc
        await putToR2(uploadUrl, file, setUploadPct);

        // Bước 3: báo backend xác nhận đã upload xong
        await api.post(`/machine-images/${id}/complete`);
      }

      pushToast({
        type: "success",
        title: "Đã lưu vào kho",
        message: files.length > 1 ? `Đã tải lên ${files.length} ảnh.` : "Đã tải lên 1 ảnh.",
      });

      setTitle("");
      setMachineCode("");
      setCategory("");
      setNote("");
      setFiles([]);
      setShowUpload(false);
      setPage(1);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Tải ảnh lên thất bại");
    } finally {
      setUploading(false);
      setUploadPct(0);
      setUploadIndex(0);
    }
  }

  function openEdit(doc: ImageDoc) {
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
      alert("Tên ảnh không được để trống.");
      return;
    }
    setSavingEdit(true);
    try {
      await api.put(`/machine-images/${editingDoc.id}`, {
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

  // ✅ Tải ảnh về máy — chia 2 nhánh rõ ràng theo thiết bị:
  //  - iOS (iPhone/iPad): dùng Web Share API để mở Share Sheet, có sẵn nút
  //    "Lưu vào Ảnh" — vì Safari/iOS tải file qua thẻ <a download> hay điều
  //    hướng link thường sẽ luôn bị đẩy vào app Files, rất khó tìm.
  //  - Android & Desktop: tải file THẬT SỰ bằng cách fetch về blob rồi tạo
  //    link tải tạm thời với thuộc tính "download". Không dùng
  //    window.location.href = url nữa vì với ảnh, trình duyệt thường chỉ MỞ
  //    ảnh ra xem (do thiếu header Content-Disposition: attachment từ R2) chứ
  //    không tải xuống — đây chính là nguyên nhân "bấm tải mà không thấy gì".
  //    Trên Android, file .jpg/.png tải bằng cách này vẫn được hệ thống quét
  //    và gộp vào thư viện ảnh như bình thường.
  async function onDownload(doc: ImageDoc) {
    setDownloadingId(doc.id);
    try {
      const res = await api.get(`/machine-images/${doc.id}/download-url`);
      const { url } = res.data;

      if (isIOSDevice() && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
        try {
          const fileRes = await fetch(url);
          const blob = await fileRes.blob();
          const file = new File([blob], doc.fileName, {
            type: doc.mimeType || blob.type || "image/jpeg",
          });

          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: doc.title });
            pushToast({
              type: "success",
              title: "Đã gửi đi lưu",
              message: 'Chọn "Lưu vào Ảnh" (hoặc tương tự) trong bảng vừa hiện ra để lưu vào thư viện ảnh.',
              ttl: 5000,
            });
            return; // ✅ xong — người dùng tự chọn lưu trong Share Sheet
          }
        } catch (shareErr: any) {
          // Người dùng bấm Huỷ trong Share Sheet -> không phải lỗi, im lặng thoát
          if (shareErr?.name === "AbortError") return;
          console.warn("share file thất bại trên iOS, chuyển sang tải file thường", shareErr);
          // rơi xuống nhánh tải file thường bên dưới
        }
      }

      // Android & Desktop: fetch về blob rồi ép trình duyệt tải xuống thật sự
      const fileRes = await fetch(url);
      if (!fileRes.ok) throw new Error(`Tải file thất bại (HTTP ${fileRes.status})`);
      const blob = await fileRes.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = doc.fileName || doc.title || "anh.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // giải phóng bộ nhớ sau khi trình duyệt đã kịp bắt đầu tải
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch (err) {
      console.error("download error", err);
      alert("Tải ảnh thất bại, thử lại sau.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function onDelete(doc: ImageDoc) {
    if (!window.confirm(`Xoá ảnh "${doc.title}"? Không thể hoàn tác.`)) return;
    try {
      await api.delete(`/machine-images/${doc.id}`);
      if (previewDoc?.id === doc.id) setPreviewDoc(null);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Xoá thất bại");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-4">
      <ToastHost toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Kho ảnh máy móc</h1>
        <button
          className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          onClick={() => setShowUpload((v) => !v)}
        >
          {showUpload ? "Đóng" : "+ Tải ảnh lên"}
        </button>
      </div>

      {showUpload && (
        <form onSubmit={onUpload} className="mb-5 rounded border p-4 space-y-3 bg-slate-50">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-red-700 text-sm">{error}</div>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-sm">
              Tên ảnh / tên máy <span className="text-red-500">*</span>
              <input
                className="mt-1 block w-full rounded border px-3 py-2"
                placeholder='vd "Máy đóng vỉ DPP-150E"'
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
              File ảnh <span className="text-red-500">*</span> (chọn được nhiều ảnh)
              <input
                type="file"
                accept="image/*"
                multiple
                className="mt-1 block w-full rounded border px-3 py-2 bg-white"
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                disabled={uploading}
              />
              {files.length > 0 && (
                <span className="mt-1 block text-xs text-slate-500">
                  Đã chọn {files.length} ảnh · tổng {formatBytes(files.reduce((s, f) => s + f.size, 0))}
                </span>
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
                Đang tải ảnh {uploadIndex}/{files.length}... {uploadPct}%
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

      {/* ===== Lưới ảnh, dùng chung cho cả desktop và mobile — số cột tự co giãn ===== */}
      {loading ? (
        <div className="rounded border bg-white px-4 py-10 text-center text-slate-500">Đang tải...</div>
      ) : rows.length === 0 ? (
        <div className="rounded border bg-white px-4 py-10 text-center text-slate-500">
          Chưa có ảnh nào được tải lên
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rows.map((doc) => (
            <div key={doc.id} className="overflow-hidden rounded border bg-white shadow-sm">
              <button
                type="button"
                className="block aspect-square w-full bg-slate-100"
                onClick={() => setPreviewDoc(doc)}
                aria-label={`Xem ảnh ${doc.title}`}
              >
                {doc.previewUrl ? (
                  <img
                    src={doc.previewUrl}
                    alt={doc.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                    Không có ảnh
                  </div>
                )}
              </button>

              <div className="p-2">
                <div className="truncate text-sm font-medium" title={doc.title}>
                  {doc.title}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-slate-400">
                  <span className="truncate">{doc.machineCode || "—"}</span>
                  <span className="shrink-0">{formatBytes(doc.fileSize)}</span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button
                    className="rounded border px-2 py-1 text-xs hover:bg-slate-100"
                    onClick={() => openEdit(doc)}
                  >
                    Cập nhật
                  </button>
                  <button
                    className="rounded border px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                    onClick={() => onDownload(doc)}
                    disabled={downloadingId === doc.id}
                  >
                    {downloadingId === doc.id ? "Đang tải..." : "Tải xuống"}
                  </button>
                  {isAdmin && (
                    <button
                      className="col-span-2 rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => onDelete(doc)}
                    >
                      Xoá
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <span>Tổng: {total} ảnh</span>
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

      {/* ✅ Modal cập nhật thông tin ảnh (không đổi file gốc) */}
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
            <h2 className="text-lg font-semibold">Cập nhật thông tin ảnh</h2>
            <p className="text-xs text-slate-500">
              File hiện tại: <span className="font-medium">{editingDoc.fileName}</span>{" "}
              (nếu cần đổi hẳn sang ảnh khác, xoá ảnh này rồi tải ảnh mới lên sẽ rõ ràng hơn)
            </p>

            <label className="block text-sm">
              Tên ảnh / tên máy
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

      {/* ✅ Modal xem phóng to ảnh */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="w-full max-w-3xl rounded bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{previewDoc.title}</h2>
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setPreviewDoc(null)}>
                ✕ Đóng
              </button>
            </div>
            {previewDoc.previewUrl ? (
              <img
                src={previewDoc.previewUrl}
                alt={previewDoc.title}
                className="w-full rounded bg-black"
                style={{ maxHeight: "70vh", objectFit: "contain" }}
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-slate-500">Không có ảnh</div>
            )}
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>
                {previewDoc.machineCode ? `Mã máy: ${previewDoc.machineCode} · ` : ""}
                {formatBytes(previewDoc.fileSize)} · {formatDate(previewDoc.createdAt)}
              </span>
              <button
                className="rounded border px-3 py-1 text-slate-700 hover:bg-slate-100"
                onClick={() => onDownload(previewDoc)}
                disabled={downloadingId === previewDoc.id}
              >
                {downloadingId === previewDoc.id ? "Đang tải..." : "Tải xuống"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MachineImagesPage;