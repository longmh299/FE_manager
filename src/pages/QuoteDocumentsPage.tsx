// src/pages/QuoteDocumentsPage.tsx
import React, { useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";
import * as mammoth from "mammoth";
import DOMPurify from "dompurify";
import api, { extractList, API_BASE_URL } from "../api/client";
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

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

function fileKind(doc: QuoteDoc) {
  const name = doc.fileName.toLowerCase();
  if (doc.mimeType === "application/pdf" || name.endsWith(".pdf")) return { label: "PDF", className: "bg-rose-50 text-rose-700" };
  return { label: name.endsWith(".docx") || doc.mimeType === DOCX_MIME ? "Word" : "Word cũ", className: "bg-sky-50 text-sky-700" };
}

/** Ảnh trong thẻ: chỉ tải khi thẻ cuộn tới. File không có ảnh thì hiện loại file. */
const QuoteThumb: React.FC<{ doc: QuoteDoc; onOpen: () => void }> = ({ doc, onOpen }) => {
  const box = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const kind = fileKind(doc);
  const canHaveImage = kind.label === "Word";

  useEffect(() => {
    setUrl(null);
    setDone(false);
    if (!canHaveImage || !box.current) {
      setDone(true);
      return;
    }
    let dead = false;
    let made: string | null = null;
    const load = async () => {
      try {
        const res = await api.get(`/quote-documents/${doc.id}/thumbnail`, { params: { v: doc.updatedAt }, responseType: "blob" });
        if (dead) return;
        if (res.status === 200 && res.data?.size > 0) {
          made = URL.createObjectURL(res.data);
          setUrl(made);
        }
      } catch {
        // không có ảnh thì hiện ô loại file, thẻ vẫn dùng được
      } finally {
        if (!dead) setDone(true);
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(box.current);
    return () => {
      dead = true;
      io.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [doc.id, doc.updatedAt, canHaveImage]);

  return (
    <button
      ref={box}
      type="button"
      onClick={onOpen}
      aria-label={`Xem trước ${doc.title}`}
      data-testid="quote-thumb"
      className="flex h-40 w-full items-center justify-center overflow-hidden rounded-t-xl border-b border-slate-100 bg-white"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-contain p-2" />
      ) : !done ? (
        <span className="h-full w-full animate-pulse bg-slate-100" />
      ) : (
        <span className={`rounded-lg px-3 py-2 text-lg font-semibold ${kind.className}`}>{kind.label}</span>
      )}
    </button>
  );
};

const QuoteDocumentsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin"; // ✅ chỉ admin được xoá báo giá
  // ✅ staff chỉ sửa được báo giá do chính mình tải lên (server cũng chặn)
  const canEdit = (doc: QuoteDoc) => user?.role !== "staff" || doc.uploadedBy?.id === user?.id;

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<QuoteDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [share, setShare] = useState<{
    id: string;
    title: string;
    url: string;
    days: number;
    file: File | null; // có = máy gửi được file
    note: string;
    error?: boolean;
  } | null>(null);
  const canShareNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
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

  // ✅ Xem trước file ngay trong trang (không cần tải về máy)
  // - .pdf -> nhúng trực tiếp qua iframe (trình duyệt tự render)
  // - .docx -> convert sang HTML bằng mammoth để hiển thị (không phải 100% giống
  //   Word, bảng/ảnh phức tạp có thể lệch chút, nhưng đủ để xem nội dung/giá)
  // - .doc cũ -> KHÔNG xem trước được (định dạng nhị phân, trình duyệt không đọc
  //   nổi), báo rõ cho người dùng thay vì im lặng hoặc lỗi khó hiểu
  const [previewDoc, setPreviewDoc] = useState<QuoteDoc | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewKind, setPreviewKind] = useState<"pdf" | "docx" | "unsupported" | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  async function onPreview(doc: QuoteDoc) {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewKind(null);
    setPreviewHtml(null);
    setPreviewUrl(null);
    setPreviewError(null);
    try {
      // ✅ dùng chung endpoint /download — vừa xem trước đúng nội dung bạn sẽ nhận
      // khi tải xuống (kể cả email/SĐT đã được tự động chèn), vừa không cần thêm
      // route riêng ở backend. Vì đây là fetch qua JS (không phải điều hướng
      // trình duyệt), header "attachment" không gây tải file/mở tab lạ gì cả.
      const res = await api.get(`/quote-documents/${doc.id}/download`, { responseType: "blob" });
      const blob: Blob = res.data;
      const nameLower = doc.fileName.toLowerCase();
      const isPdf = doc.mimeType === "application/pdf" || nameLower.endsWith(".pdf");
      const isDocx = doc.mimeType === DOCX_MIME || nameLower.endsWith(".docx");

      if (isPdf) {
        setPreviewKind("pdf");
        setPreviewUrl(URL.createObjectURL(blob));
      } else if (isDocx) {
        const arrayBuffer = await blob.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setPreviewKind("docx");
        // ✅ mammoth không lọc link: file Word có link javascript: sẽ chạy được trong phiên người xem
        setPreviewHtml(DOMPurify.sanitize(result.value));
      } else {
        setPreviewKind("unsupported");
      }
    } catch (err) {
      console.error("preview error", err);
      setPreviewError("Không xem trước được file này, thử tải xuống thay thế.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl); // ✅ giải phóng bộ nhớ blob URL
    setPreviewDoc(null);
    setPreviewKind(null);
    setPreviewHtml(null);
    setPreviewUrl(null);
    setPreviewError(null);
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

  /**
   * ✅ Chia sẻ báo giá cho khách — file y như Tải xuống (docx đã chèn email / SĐT của người chia sẻ).
   * Bước 1 (bấm "Chia sẻ"): chuẩn bị link tải 30 ngày, và file nếu máy gửi được file.
   * Bước 2 (bấm "Gửi file" / "Gửi link" / "Chép link"): trình duyệt CHỈ cho mở bảng chia sẻ ngay sau một cú bấm,
   *   nên không gọi share() sau khi chờ tải file (chờ lâu sẽ bị chặn -> lỗi "Chia sẻ thất bại").
   */
  async function onShare(doc: QuoteDoc) {
    setSharingId(doc.id);
    setShare(null);
    try {
      const r = await api.post(`/quote-documents/${doc.id}/share`);
      const url = `${API_BASE_URL.replace(/\/$/, "")}/public/quote/${encodeURIComponent(r.data?.token)}`;
      const days = Number(r.data?.expiresInDays) || 30;
      // máy có gửi được loại file này không? (thử bằng file rỗng cùng tên / kiểu, khỏi tải file thật cho máy không gửi được)
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const type = doc.mimeType || "application/octet-stream";
      let file: File | null = null;
      if (typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [new File([""], doc.fileName, { type })] })) {
        const res = await api.get(`/quote-documents/${doc.id}/download`, { responseType: "blob" });
        file = new File([res.data as Blob], doc.fileName, { type: (res.data as Blob).type || type });
      }
      setShare({ id: doc.id, title: doc.title || doc.fileName, url, days, file, note: "" });
    } catch (err) {
      console.error("share error", err);
      const x = err as { response?: { status?: number; data?: { message?: string } } };
      const msg =
        x?.response?.status === 404 && !x?.response?.data?.message
          ? "Máy chủ chưa có chức năng chia sẻ (BE chưa cập nhật)."
          : x?.response?.data?.message || "Không tạo được link chia sẻ, thử lại sau.";
      setShare({ id: doc.id, title: "", url: "", days: 0, file: null, note: msg, error: true });
    } finally {
      setSharingId(null);
    }
  }

  async function shareFile() {
    if (!share?.file) return;
    try {
      await navigator.share({ files: [share.file], title: share.title });
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") setShare({ ...share, note: "Máy không gửi được file, hãy dùng Gửi link hoặc Chép link." });
    }
  }
  async function shareLink() {
    if (!share?.url) return;
    try {
      await navigator.share({ title: share.title, text: `Báo giá: ${share.title}`, url: share.url });
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") setShare({ ...share, note: "Không mở được bảng chia sẻ, hãy bấm Chép link." });
    }
  }
  async function copyLink() {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setShare({ ...share, note: "Đã chép link. Dán vào Zalo hoặc email gửi khách." });
    } catch {
      setShare({ ...share, note: "Không chép tự động được, bôi đen link bên dưới rồi chép." });
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
    <div className="mx-auto max-w-[1400px] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
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

      {/* ✅ Dạng thẻ cho cả máy tính và điện thoại, nút thao tác nằm dưới cùng mỗi thẻ */}
      {loading ? (
        <div className="rounded-xl border bg-white px-4 py-10 text-center text-slate-500">Đang tải...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-4 py-10 text-center text-slate-500">
          {q.trim() ? "Không tìm thấy báo giá nào khớp" : "Chưa có báo giá nào được tải lên"}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((doc) => {
            const wasUpdated = new Date(doc.updatedAt).getTime() - new Date(doc.createdAt).getTime() > 60_000;
            const kind = fileKind(doc);
            return (
              <li key={doc.id} data-testid="quote-card" className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
                <QuoteThumb doc={doc} onOpen={() => onPreview(doc)} />
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 break-words font-semibold leading-snug text-slate-900">{doc.title}</h2>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${kind.className}`}>{kind.label}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {doc.machineCode && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{doc.machineCode}</span>
                    )}
                    {doc.category && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{doc.category}</span>
                    )}
                    {wasUpdated && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Đã cập nhật</span>
                    )}
                  </div>
                  {doc.note && (
                    <p className="mt-2 line-clamp-2 break-words text-sm text-slate-600" title={doc.note}>
                      {doc.note}
                    </p>
                  )}
                  <dl className="mt-3 space-y-0.5 text-xs text-slate-500">
                    <div className="truncate" title={doc.fileName}>
                      {doc.fileName} · {formatBytes(doc.fileSize)}
                    </div>
                    <div>
                      {doc.uploadedBy?.username || "—"} · {formatDate(doc.createdAt)}
                    </div>
                    {wasUpdated && <div>Sửa lần cuối: {formatDate(doc.updatedAt)}</div>}
                  </dl>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50 p-3 sm:flex-nowrap">
                  <button
                    className="whitespace-nowrap rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    disabled={downloadingId === doc.id}
                    onClick={() => onDownload(doc)}
                  >
                    {downloadingId === doc.id ? "Đang tải..." : "Tải xuống"}
                  </button>
                  <button
                    className="whitespace-nowrap rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    disabled={sharingId === doc.id}
                    onClick={() => onShare(doc)}
                    title="Gửi báo giá cho khách (Zalo, email…), có sẵn email / SĐT của bạn"
                  >
                    {sharingId === doc.id ? "Đang chuẩn bị..." : "Chia sẻ"}
                  </button>
                  <button className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100" aria-label="Xem trước" title="Xem trước" onClick={() => onPreview(doc)}>
                    Xem
                  </button>
                  {canEdit(doc) && (
                    <button className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100" onClick={() => openEdit(doc)}>
                      Cập nhật
                    </button>
                  )}
                  {isAdmin && (
                    <button className="ml-auto whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-red-700 hover:bg-red-50" onClick={() => onDelete(doc)}>
                      Xoá
                    </button>
                  )}
                </div>
                {share?.id === doc.id && (
                  <div
                    className={`border-t px-3 py-2.5 text-xs ${share.error ? "border-rose-100 bg-rose-50 text-rose-800" : "border-indigo-100 bg-indigo-50 text-indigo-900"}`}
                    role="status"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{share.error ? share.note : `Gửi báo giá cho khách (link dùng được ${share.days} ngày)`}</span>
                      <button type="button" className="opacity-60 hover:opacity-100" aria-label="Đóng" onClick={() => setShare(null)}>
                        ✕
                      </button>
                    </div>
                    {!share.error && (
                      <>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {share.file && (
                            <button type="button" onClick={shareFile} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                              Gửi file
                            </button>
                          )}
                          {canShareNative && (
                            <button
                              type="button"
                              onClick={shareLink}
                              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${share.file ? "border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}
                            >
                              Gửi link
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={copyLink}
                            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${share.file || canShareNative ? "border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}
                          >
                            Chép link
                          </button>
                        </div>
                        <input
                          readOnly
                          value={share.url}
                          onFocus={(e) => e.currentTarget.select()}
                          className="mt-2 w-full rounded border border-indigo-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                          aria-label="Link báo giá"
                        />
                        {share.note && <div className="mt-1.5">{share.note}</div>}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
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

      {/* ✅ Modal xem trước file (pdf nhúng trực tiếp, docx convert qua HTML, .doc cũ báo không hỗ trợ) */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closePreview}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">{previewDoc.title}</h2>
              <button className="text-slate-500 hover:text-slate-800" onClick={closePreview}>
                ✕ Đóng
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {previewLoading ? (
                <div className="flex h-64 items-center justify-center text-slate-500">
                  Đang tải file...
                </div>
              ) : previewError ? (
                <div className="flex h-64 items-center justify-center text-center text-red-600">
                  {previewError}
                </div>
              ) : previewKind === "pdf" && previewUrl ? (
                <iframe src={previewUrl} title={previewDoc.title} className="h-[75vh] w-full rounded border" />
              ) : previewKind === "docx" && previewHtml ? (
                <div>
                  <p className="mb-3 text-xs text-slate-400">
                    Bản xem trước chuyển từ Word sang HTML — bảng/ảnh phức tạp hoặc phần header/footer (logo,
                    thông tin công ty) có thể không hiển thị y hệt bản gốc. Tải xuống để xem đúng 100%.
                  </p>
                  <div
                    className="docx-preview rounded border bg-white p-4"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              ) : previewKind === "unsupported" ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-slate-500">
                  <div>
                    File định dạng <b>.doc</b> cũ — trình duyệt không xem trước được (chỉ hỗ trợ .docx và .pdf).
                  </div>
                  <div className="text-sm">Tải xuống để mở bằng Word, hoặc lưu lại thành .docx rồi tải lên thay thế.</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ✅ Modal cập nhật báo giá (sửa thông tin và/hoặc thay file khi giá đổi) */}
      {editingDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEditingDoc(null)}
        >
          <form
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded bg-white p-5 shadow-lg space-y-3"
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