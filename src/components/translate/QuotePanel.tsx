// src/components/translate/QuotePanel.tsx
// ✅ Tạo BÁO GIÁ từ tài liệu vừa dịch — đúng mẫu báo giá MCBROTHER.
// 1. Bấm "AI soạn báo giá": AI đọc bản dịch -> tên máy, quy trình, đặc điểm, thông số.
//    Giá lấy từ giá bán trong CRM (nếu khớp mã máy) — AI không tự đặt giá.
// 2. Sửa nhanh trên điện thoại (mọi mục đều sửa được).
// 3. Xem trước đúng file Word sẽ tải về (tự cập nhật sau khi sửa) -> Tải Word hoặc Lưu vào Kho báo giá.
// 4. Nháp báo giá được lưu kèm tài liệu trong Lịch sử (initial / onChange) — mở lại không phải soạn lại.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/client";
import { imageToBase64 } from "../../utils/translateDoc";

type Spec = { ten: string; giaTri: string };
export type Quote = {
  tenMay: string;
  maHang: string;
  quyTrinh: string;
  dacDiem: string[];
  thongSo: Spec[];
  donGia: string;
  dieuKhoan: string[];
  thanhToan: string[];
};
export type Machine = { sku: string; name: string; code: string; sellPrice: number | null } | null;
/** Nháp báo giá lưu kèm tài liệu trong Lịch sử (ảnh tự chọn không lưu — file nặng) */
export type QuoteDraft = { q: Quote; machine: Machine };
type UsageSummary = { cost: number; models: { model: string; calls: number; input: number; output: number; thinking: number; cost: number }[] };

type Props = {
  docText: string;
  context?: string;
  quality: "fast" | "deep";
  onUsage?: (u: UsageSummary) => void;
  /** nháp đã lưu (mở lại từ Lịch sử) */
  initial?: QuoteDraft | null;
  /** báo ra ngoài mỗi khi nháp thay đổi -> TranslatePage lưu vào Lịch sử */
  onChange?: (d: QuoteDraft | null) => void;
};

const fmtMoney = (v: string) => {
  const d = v.replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("vi-VN") : "";
};

function errMsg(e: unknown) {
  const err = e as { message?: string; response?: { data?: { message?: string } } };
  return err?.response?.data?.message || err?.message || "Có lỗi xảy ra";
}

/** Lỗi trả về khi tải file (responseType blob) nằm trong blob -> đọc ra message */
async function blobErr(e: unknown) {
  const err = e as { response?: { data?: Blob } };
  if (err?.response?.data instanceof Blob) {
    try {
      return JSON.parse(await err.response.data.text())?.message || "Không tạo được file";
    } catch {
      /* bỏ qua */
    }
  }
  return errMsg(e);
}

const Label: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <div className="mb-1 flex items-baseline justify-between gap-2">
    <span className="text-sm font-medium text-slate-700">{children}</span>
    {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
  </div>
);

const boxCls = "block min-w-0 rounded-xl border px-3 py-2.5 text-[16px] outline-none focus:border-indigo-400";
const inputCls = `${boxCls} w-full`;

/** Tên file tải về: lấy từ header, BE không cho đọc header (CORS) thì tự đặt theo mã hàng */
function docxName(cd: string, maHang: string, tenMay: string) {
  const fallback = `Bao_gia_${(maHang || tenMay).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^A-Za-z0-9-]+/g, "_")}.docx`;
  return decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] || fallback);
}

/**
 * Khung xem trước file Word: vẽ đúng file .docx BE tạo ra (header, logo, bảng, ảnh)
 * rồi thu nhỏ trang A4 cho vừa bề ngang màn hình điện thoại.
 */
const DocxPreview: React.FC<{ blob: Blob | null }> = ({ blob }) => {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const el = inner.current;
    const box = outer.current;
    if (!blob || !el || !box) return;
    let alive = true;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview"); // tải thư viện khi cần, không làm nặng app
        if (!alive) return;
        el.innerHTML = "";
        await renderAsync(blob, el, undefined, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true });
        if (!alive) return;
        setErr(null);
        const fit = () => {
          const pageW = el.scrollWidth || 794;
          const s = Math.min(1, box.clientWidth / pageW);
          el.style.transform = `scale(${s})`;
          setH(el.scrollHeight * s);
        };
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(box);
      } catch (e) {
        if (alive) setErr(errMsg(e));
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [blob]);

  return (
    <div ref={outer} className="overflow-hidden rounded-lg bg-slate-200" style={{ height: h || undefined }}>
      {err && <div className="p-3 text-sm text-red-700">Không xem trước được: {err}</div>}
      {/* docx-preview hiểu nhầm "lrTb" (chữ ngang) thành chữ dọc -> ép ô bảng về chữ ngang */}
      <div
        ref={inner}
        className="docx-preview-box w-max origin-top-left [&_section.docx]:mb-3 [&_section.docx]:bg-white [&_section.docx]:shadow [&_td]:![writing-mode:horizontal-tb] [&_td]:!transform-none"
      />
    </div>
  );
};

const QuotePanel: React.FC<Props> = ({ docText, context, quality, onUsage, initial, onChange }) => {
  const nav = useNavigate();
  const [q, setQ] = useState<Quote | null>(initial?.q ?? null);
  const [machine, setMachine] = useState<Machine>(initial?.machine ?? null);
  const [image, setImage] = useState<{ data: string; mediaType: string; preview: string } | null>(null);
  const [busy, setBusy] = useState<"" | "draft" | "docx" | "save">("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const set = <K extends keyof Quote>(k: K, v: Quote[K]) => {
    setQ((cur) => (cur ? { ...cur, [k]: v } : cur));
    setSavedId(null); // sửa sau khi lưu -> cho lưu lại bản mới
  };
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  // Báo nháp ra ngoài để lưu vào Lịch sử
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current?.(q ? { q, machine } : null);
  }, [q, machine]);

  async function makeDraft() {
    setBusy("draft");
    setMsg(null);
    try {
      const r = await api.post("/translate/quote-draft", { doc: docText, context, quality }, { timeout: 5 * 60 * 1000 });
      onUsage?.(r.data.usage);
      setQ(r.data.draft);
      setMachine(r.data.machine);
      setSavedId(null);
    } catch (e) {
      setMsg({ type: "err", text: errMsg(e) });
    } finally {
      setBusy("");
    }
  }

  function payload() {
    if (!q) return null;
    return {
      ...q,
      tenMay: q.tenMay.trim(),
      thongSo: q.thongSo.filter((s) => s.ten.trim() || s.giaTri.trim()),
      image: image ? { data: image.data, mediaType: image.mediaType } : null,
    };
  }

  // ---------------- xem trước: file Word thật do BE tạo, tự cập nhật sau khi ngừng gõ ~1,5 giây
  const [preview, setPreview] = useState<{ key: string; blob: Blob; name: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const body = payload();
  const bodyKey = body ? JSON.stringify(body) : "";
  const stale = !!body && preview?.key !== bodyKey;
  const reqRef = useRef(0);

  async function fetchDocx(b: NonNullable<ReturnType<typeof payload>>) {
    const r = await api.post("/translate/quote-docx", b, { responseType: "blob", timeout: 2 * 60 * 1000 });
    return { blob: r.data as Blob, name: docxName(String(r.headers["content-disposition"] || ""), b.maHang, b.tenMay) };
  }

  async function refreshPreview() {
    if (!body?.tenMay) return;
    const id = ++reqRef.current;
    const key = bodyKey;
    const b = body;
    setPreviewBusy(true);
    try {
      const f = await fetchDocx(b);
      if (id === reqRef.current) {
        setPreview({ key, ...f });
        setPreviewErr(null);
      }
    } catch (e) {
      if (id === reqRef.current) setPreviewErr(await blobErr(e));
    } finally {
      if (id === reqRef.current) setPreviewBusy(false);
    }
  }

  useEffect(() => {
    if (!stale || !body?.tenMay) return;
    const t = setTimeout(refreshPreview, preview ? 1500 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  async function downloadDocx() {
    const body = payload();
    if (!body?.tenMay) return setMsg({ type: "err", text: "Nhập tên máy trước đã" });
    setBusy("docx");
    setMsg(null);
    try {
      // Bản xem trước đang đúng nội dung -> tải luôn file đó, khỏi tạo lại
      const f = preview && !stale ? preview : await fetchDocx(body);
      const name = f.name;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(f.blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg({ type: "ok", text: `Đã tải ${name}` });
    } catch (e) {
      setMsg({ type: "err", text: await blobErr(e) });
    } finally {
      setBusy("");
    }
  }

  async function saveToStore() {
    const body = payload();
    if (!body?.tenMay) return setMsg({ type: "err", text: "Nhập tên máy trước đã" });
    setBusy("save");
    setMsg(null);
    try {
      const r = await api.post("/translate/quote-save", body, { timeout: 2 * 60 * 1000 });
      setSavedId(r.data.id);
      setMsg({ type: "ok", text: `Đã lưu "${r.data.title}" vào Kho báo giá` });
    } catch (e) {
      setMsg({ type: "err", text: errMsg(e) });
    } finally {
      setBusy("");
    }
  }

  // ------------------------------------------------------------ chưa soạn
  if (!q) {
    return (
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium text-slate-800">🧾 Tạo báo giá cho máy này</div>
        <div className="mb-4 text-sm text-slate-500">
          AI đọc bản dịch để soạn tên máy, quy trình vận hành, đặc điểm và thông số kỹ thuật theo đúng mẫu báo giá công ty.
          Giá lấy từ <b>giá bán trong CRM</b> nếu khớp mã máy — AI không tự đặt giá. Soạn xong bạn sửa lại được hết.
        </div>
        <button
          onClick={makeDraft}
          disabled={busy === "draft"}
          className="h-12 w-full rounded-xl bg-indigo-600 text-base font-semibold text-white active:bg-indigo-700 disabled:opacity-60"
        >
          {busy === "draft" ? "AI đang soạn…" : "AI soạn báo giá"}
        </button>
        {msg && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{msg.text}</div>}
      </div>
    );
  }

  // ------------------------------------------------------------ form sửa
  return (
    <div className="space-y-4 pb-28 md:pb-4">
      <div className="rounded-xl border bg-white p-3">
        <Label>Tên máy (tiêu đề báo giá)</Label>
        <input className={`${inputCls} font-semibold uppercase`} value={q.tenMay} onChange={(e) => set("tenMay", e.target.value)} />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <Label>Mã hàng</Label>
            <input className={inputCls} value={q.maHang} onChange={(e) => set("maHang", e.target.value)} />
          </div>
          <div>
            <Label hint="VND">Đơn giá</Label>
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder="Liên hệ"
              value={fmtMoney(q.donGia)}
              onChange={(e) => set("donGia", e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
        </div>
        <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${machine ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {machine
            ? `Khớp CRM: ${machine.code} – ${machine.name}${machine.sellPrice ? ` · giá bán ${machine.sellPrice.toLocaleString("vi-VN")}đ` : " · CRM chưa có giá bán, nhập tay"}`
            : "Không tìm thấy máy này trong danh mục CRM — kiểm tra lại mã hàng và nhập giá tay (để trống = “Liên hệ”)."}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3">
        <Label hint="để trống: tự lấy ảnh trong Kho ảnh máy theo mã">Ảnh máy</Label>
        <div className="flex items-center gap-3">
          {image ? (
            <img src={image.preview} alt="" className="h-20 w-28 rounded-lg border object-cover" />
          ) : (
            <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed text-xs text-slate-400">Chưa chọn</div>
          )}
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer rounded-full border px-3 py-1.5 text-sm active:bg-slate-100">
              📷 Chụp / chọn ảnh
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const img = await imageToBase64(f, 1600);
                  setImage({ ...img, preview: `data:${img.mediaType};base64,${img.data}` });
                }}
              />
            </label>
            {image && (
              <button onClick={() => setImage(null)} className="text-left text-xs text-slate-500 underline">
                Bỏ ảnh
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3">
        <Label hint='các bước nối bằng "--->"'>Quy trình vận hành</Label>
        <textarea className={`${inputCls} min-h-[90px]`} value={q.quyTrinh} onChange={(e) => set("quyTrinh", e.target.value)} />
      </div>

      <div className="rounded-xl border bg-white p-3">
        <Label hint="mỗi dòng 1 ý">Đặc điểm</Label>
        <textarea
          className={`${inputCls} min-h-[130px]`}
          value={q.dacDiem.join("\n")}
          onChange={(e) => set("dacDiem", e.target.value.split("\n"))}
          onBlur={(e) => set("dacDiem", lines(e.target.value))}
        />
      </div>

      <div className="rounded-xl border bg-white p-3">
        <Label hint="Mã hàng & Đơn giá tự thêm vào bảng">Thông số kỹ thuật</Label>
        <div className="space-y-2">
          {q.thongSo.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={`${boxCls} basis-[45%] !text-[15px]`}
                placeholder="Tên"
                value={s.ten}
                onChange={(e) => set("thongSo", q.thongSo.map((x, k) => (k === i ? { ...x, ten: e.target.value } : x)))}
              />
              <input
                className={`${boxCls} flex-1 !text-[15px]`}
                placeholder="Giá trị"
                value={s.giaTri}
                onChange={(e) => set("thongSo", q.thongSo.map((x, k) => (k === i ? { ...x, giaTri: e.target.value } : x)))}
              />
              <button
                onClick={() => set("thongSo", q.thongSo.filter((_, k) => k !== i))}
                className="w-9 shrink-0 rounded-xl text-xl text-slate-400 active:bg-slate-100"
                aria-label="Xoá dòng"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => set("thongSo", [...q.thongSo, { ten: "", giaTri: "" }])} className="mt-2 text-sm font-medium text-indigo-600">
          + Thêm dòng
        </button>
      </div>

      <div className="rounded-xl border bg-white p-3">
        <Label hint="mỗi dòng 1 ý">Ghi chú dưới bảng</Label>
        <textarea
          className={`${inputCls} min-h-[100px]`}
          value={q.dieuKhoan.join("\n")}
          onChange={(e) => set("dieuKhoan", e.target.value.split("\n"))}
          onBlur={(e) => set("dieuKhoan", lines(e.target.value))}
        />
        <div className="mt-3" />
        <Label hint="mỗi dòng 1 ý">Thanh toán</Label>
        <textarea
          className={`${inputCls} min-h-[100px]`}
          value={q.thanhToan.join("\n")}
          onChange={(e) => set("thanhToan", e.target.value.split("\n"))}
          onBlur={(e) => set("thanhToan", lines(e.target.value))}
        />
      </div>

      {/* ---------- xem trước file Word ---------- */}
      <div className="rounded-xl border bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-700">
            Xem trước file Word
            {previewBusy ? (
              <span className="ml-2 text-xs font-normal text-slate-400">đang cập nhật…</span>
            ) : stale && preview ? (
              <span className="ml-2 text-xs font-normal text-amber-600">chưa có chỗ vừa sửa</span>
            ) : null}
          </span>
          <button
            onClick={refreshPreview}
            disabled={previewBusy || !body?.tenMay}
            className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium active:bg-slate-100 disabled:opacity-50"
          >
            ↻ Cập nhật
          </button>
        </div>
        {previewErr && <div className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{previewErr}</div>}
        {!body?.tenMay ? (
          <div className="py-6 text-center text-sm text-slate-400">Nhập tên máy để xem trước</div>
        ) : !preview && previewBusy ? (
          <div className="py-6 text-center text-sm text-slate-400">Đang dựng file Word…</div>
        ) : (
          <div className={previewBusy ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <DocxPreview blob={preview?.blob ?? null} />
          </div>
        )}
        <div className="mt-2 text-[11px] text-slate-400">Bản xem trên web có thể lệch font / ngắt trang chút ít so với mở bằng Word.</div>
      </div>

      <button onClick={makeDraft} disabled={!!busy} className="w-full text-center text-sm text-slate-500 underline disabled:opacity-50">
        {busy === "draft" ? "AI đang soạn lại…" : "↻ Cho AI soạn lại từ đầu"}
      </button>

      {msg && (
        <div className={`rounded-xl px-3 py-2 text-sm ${msg.type === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {msg.text}
          {savedId && msg.type === "ok" && (
            <button onClick={() => nav("/quote-documents")} className="ml-2 font-medium underline">
              Mở Kho báo giá
            </button>
          )}
        </div>
      )}

      {/* nút dính đáy màn hình trên điện thoại */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 md:static md:border-0 md:p-0">
        <div className="mx-auto flex max-w-3xl gap-2">
          <button
            onClick={downloadDocx}
            disabled={!!busy}
            className="h-12 flex-1 rounded-xl border text-[15px] font-medium active:bg-slate-100 disabled:opacity-50"
          >
            {busy === "docx" ? "Đang tạo…" : "⬇ Tải Word"}
          </button>
          <button
            onClick={saveToStore}
            disabled={!!busy || !!savedId}
            className="h-12 flex-1 rounded-xl bg-emerald-600 text-[15px] font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "save" ? "Đang lưu…" : savedId ? "✓ Đã lưu" : "💾 Lưu Kho báo giá"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuotePanel;