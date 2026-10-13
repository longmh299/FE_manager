// src/pages/TranslatePage.tsx
// ✅ Dịch tài liệu kỹ thuật Trung / Anh -> Việt — thiết kế ưu tiên ĐIỆN THOẠI (app WAP / PWA).
//   - Chụp từng trang tài liệu bằng camera, hoặc chọn file PDF / Word / Excel / ảnh
//   - Xem tiếng Việt (chạm đoạn bất kỳ để xem chữ gốc) hoặc song ngữ
//   - Tab "Hỏi AI": hỏi đáp về tài liệu vừa dịch (thông số, vận hành, xử lý lỗi...)
//   - Tải về Word song ngữ / Word tiếng Việt / Excel đã dịch
//   - LỊCH SỬ: dịch xong tự lưu (bản dịch + file gốc + nháp báo giá). Mở lại xem / hỏi AI / làm báo giá
//     không phải dịch lại. Người dịch chỉ thấy tài liệu của mình, admin thấy hết.
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";
import DocChat from "../components/translate/DocChat";
import QuotePanel, { type QuoteDraft } from "../components/translate/QuotePanel";
import {
  type Block,
  type DocPage,
  type SheetData,
  type SrcItem,
  batchItems,
  cellNeedsTranslate,
  docxToItems,
  downloadDocx,
  downloadTranslatedXlsx,
  imageToBase64,
  loadPdf,
  pagesToChatText,
  pagesToPlainVi,
  pdfSliceBase64,
  sheetsToChatText,
  xlsxToSheets,
} from "../utils/translateDoc";

type Kind = "pdf" | "images" | "docx" | "xlsx";
/** Chi phí AI thật do BE đếm token trả về */
export type UsageModel = { model: string; calls: number; input: number; output: number; thinking: number; cost: number };
export type UsageSummary = { cost: number; models: UsageModel[] };
type Status = "waiting" | "running" | "done" | "error";
type Section = { key: string; label: string; status: Status; pages: DocPage[]; error?: string };
type Task = { key: string; label: string; run: (signal: AbortSignal) => Promise<DocPage[]> };

const PDF_PAGES_PER_CALL = 2;
const CONCURRENCY = 2;
const LONG = { timeout: 10 * 60 * 1000 };

function errCode(e: unknown): string | undefined {
  const err = e as { response?: { data?: { data?: { code?: string } } } };
  return err?.response?.data?.data?.code;
}
function errMessage(e: unknown): string {
  const err = e as { code?: string; message?: string; response?: { data?: { message?: string } } };
  if (err?.code === "ERR_CANCELED") return "Đã dừng";
  return err?.response?.data?.message || err?.message || "Dịch thất bại";
}
/** PUT thẳng file gốc lên R2 bằng link ký sẵn (không qua backend) */
function putToR2(url: string, f: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", f.type || "application/octet-stream");
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Mất kết nối mạng"));
    xhr.send(f);
  });
}

type SaveState = "" | "saving" | "saved" | "error";
type HistoryItem = {
  id: string;
  title: string;
  kind: Kind;
  context: string | null;
  quality: "fast" | "deep";
  pageCount: number;
  cost: number;
  machineCode: string | null;
  createdAt: string;
  hasQuote: boolean;
  createdBy: string | null;
};

const isTooBig = (e: unknown) => ["TOO_LONG", "TOO_LARGE"].includes(errCode(e) || "");
const ext = (f: File) => f.name.toLowerCase().split(".").pop() || "";
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function detectKind(files: File[]): { kind: Kind | null; files: File[]; warn?: string } {
  const pdf = files.find((f) => ext(f) === "pdf");
  if (pdf) return { kind: "pdf", files: [pdf] };
  const docx = files.find((f) => ext(f) === "docx");
  if (docx) return { kind: "docx", files: [docx] };
  const xls = files.find((f) => ["xlsx", "xls"].includes(ext(f)));
  if (xls) return { kind: "xlsx", files: [xls] };
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  if (imgs.length) return { kind: "images", files: imgs };
  if (files.some((f) => ext(f) === "doc"))
    return { kind: null, files: [], warn: 'File .doc đời cũ chưa hỗ trợ — mở bằng Word rồi "Lưu thành" .docx.' };
  return { kind: null, files: [], warn: "Chỉ hỗ trợ PDF, ảnh, Word (.docx), Excel (.xlsx)." };
}

// Ảnh xem trước (giải phóng bộ nhớ khi đổi file)
function useObjectUrls(files: File[]) {
  const urls = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : "")), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

const TranslatePage: React.FC = () => {
  const [picked, setPicked] = useState<{ kind: Kind | null; files: File[]; warn?: string }>({ kind: null, files: [] });
  const [context, setContext] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState<"doc" | "chat" | "quote">("doc");
  // "Dịch chuyên sâu": dùng model mạnh hơn (Sonnet) cho tài liệu quan trọng / bản scan khó đọc
  const [deep, setDeep] = useState(false);
  const [quality, setQuality] = useState<"fast" | "deep">("fast");
  const [view, setView] = useState<"tieng-viet" | "song-ngu">("tieng-viet");
  const [prepError, setPrepError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [usage, setUsage] = useState<Record<string, UsageModel>>({});
  // ---- Lịch sử
  const [docId, setDocId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("");
  const [sources, setSources] = useState<{ uploaded: number; total: number; busy?: boolean } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0); // đổi tài liệu -> Hỏi AI / Báo giá làm lại từ đầu
  const sessionRef = useRef(0);
  const creatingRef = useRef(false);
  const lastSaved = useRef<{ content: string; usage: string; draft: string }>({ content: "", usage: "", draft: "" });

  // Cộng dồn chi phí AI của tài liệu này (dịch + vá + hỏi AI)
  function addUsage(u?: UsageSummary) {
    if (!u?.models?.length) return;
    setUsage((cur) => {
      const next = { ...cur };
      for (const m of u.models) {
        const c = next[m.model] ?? { model: m.model, calls: 0, input: 0, output: 0, thinking: 0, cost: 0 };
        next[m.model] = {
          ...c,
          calls: c.calls + m.calls,
          input: c.input + m.input,
          output: c.output + m.output,
          thinking: c.thinking + (m.thinking || 0),
          cost: c.cost + m.cost,
        };
      }
      return next;
    });
  }

  const abortRef = useRef<AbortController | null>(null);
  const tasksRef = useRef<Map<string, Task>>(new Map());
  const xlsDictRef = useRef<Map<string, string>>(new Map());
  const xlsSrcRef = useRef<SheetData[]>([]);
  const thumbs = useObjectUrls(picked.kind === "images" ? picked.files : []);

  // Rời trang khi đang dịch / đã có bản dịch -> hỏi lại (không lưu gì nên rời là mất)
  useEffect(() => {
    if (!running && !(started && !docId) && saveState !== "saving" && !sources?.busy) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running, started, docId, saveState, sources?.busy]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const patch = (key: string, p: Partial<Section>) =>
    setSections((cur) => cur.map((s) => (s.key === key ? { ...s, ...p } : s)));

  function rebuildSheets() {
    const dict = xlsDictRef.current;
    setSheets(
      xlsSrcRef.current.map((s) => ({
        ...s,
        vi: s.src.map((row) => row.map((c) => (cellNeedsTranslate(c) ? dict.get(c.trim()) ?? c : c))),
      }))
    );
  }

  async function runTask(t: Task, signal: AbortSignal) {
    patch(t.key, { status: "running", error: undefined });
    try {
      patch(t.key, { status: "done", pages: await t.run(signal) });
    } catch (e) {
      patch(t.key, { status: "error", error: errMessage(e) });
    }
  }

  async function runAll(tasks: Task[]) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    tasksRef.current = new Map(tasks.map((t) => [t.key, t]));
    setSections(tasks.map((t) => ({ key: t.key, label: t.label, status: "waiting", pages: [] })));
    setRunning(true);
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
        while (i < tasks.length && !ctrl.signal.aborted) await runTask(tasks[i++], ctrl.signal);
      })
    );
    setSections((cur) => cur.map((s) => (s.status === "waiting" ? { ...s, status: "error", error: "Đã dừng" } : s)));
    setRunning(false);
    if (picked.kind === "xlsx") rebuildSheets();
  }

  async function retry(key: string) {
    const t = tasksRef.current.get(key);
    if (!t) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    await runTask(t, ctrl.signal);
    setRunning(false);
    if (picked.kind === "xlsx") rebuildSheets();
  }

  // ------------------------------------------------------------ chia việc theo loại file
  async function buildTasks(): Promise<Task[]> {
    const ctx = context.trim() || undefined;
    const Q = deep ? "deep" : "fast";
    const { kind, files } = picked;

    if (kind === "pdf") {
      const pdf = await loadPdf(files[0]);
      const total = pdf.getPageCount();
      if (total > 150 && !window.confirm(`File có ${total} trang, dịch sẽ mất khá lâu. Tiếp tục?`)) return [];
      const pdfRun = async (start: number, count: number, signal: AbortSignal): Promise<DocPage[]> => {
        try {
          const data = await pdfSliceBase64(pdf, start, count);
          const r = await api.post("/translate/document", { kind: "pdf", data, pageOffset: start, context: ctx, quality: Q }, { signal, ...LONG });
          addUsage(r.data?.usage);
          return (r.data.pages || []).map((p: { page: number; blocks: Block[] }) => ({
            title: `Trang ${p.page}`,
            page: p.page,
            blocks: p.blocks,
          }));
        } catch (e) {
          if (isTooBig(e) && count > 1) {
            const out: DocPage[] = [];
            for (let k = 0; k < count; k++) out.push(...(await pdfRun(start + k, 1, signal)));
            return out;
          }
          throw e;
        }
      };
      const tasks: Task[] = [];
      for (let s = 0; s < total; s += PDF_PAGES_PER_CALL) {
        const n = Math.min(PDF_PAGES_PER_CALL, total - s);
        tasks.push({ key: `p${s}`, label: n > 1 ? `Trang ${s + 1}–${s + n}` : `Trang ${s + 1}`, run: (sig) => pdfRun(s, n, sig) });
      }
      return tasks;
    }

    if (kind === "images") {
      return files.map((f, idx) => ({
        key: `i${idx}`,
        label: `Trang ${idx + 1}`,
        run: async (signal) => {
          const img = await imageToBase64(f);
          const r = await api.post("/translate/document", { kind: "image", ...img, context: ctx, quality: Q }, { signal, ...LONG });
          addUsage(r.data?.usage);
          const blocks = (r.data.pages || []).flatMap((p: { blocks: Block[] }) => p.blocks);
          return [{ title: `Trang ${idx + 1}`, page: idx + 1, blocks }];
        },
      }));
    }

    if (kind === "docx") {
      const items = await docxToItems(files[0]);
      if (!items.length) throw new Error("Không tìm thấy chữ trong file Word.");
      const blocksRun = async (batch: SrcItem[], signal: AbortSignal): Promise<Block[]> => {
        try {
          const r = await api.post(
            "/translate/blocks",
            { items: batch.map(({ text, rows }) => ({ text, rows })), context: ctx, mode: "doc", quality: Q },
            { signal, ...LONG }
          );
          addUsage(r.data?.usage);
          return batch.map((it, k) => {
            const res = r.data.items?.[k] || {};
            return it.type === "table"
              ? { type: "table", srcRows: it.rows, viRows: res.viRows, untranslated: res.untranslated }
              : { type: it.type, src: it.text, vi: res.vi, untranslated: res.untranslated };
          });
        } catch (e) {
          if (isTooBig(e) && batch.length > 1) {
            const mid = Math.ceil(batch.length / 2);
            return [...(await blocksRun(batch.slice(0, mid), signal)), ...(await blocksRun(batch.slice(mid), signal))];
          }
          throw e;
        }
      };
      const batches = batchItems(items, (it) => it.text?.length ?? JSON.stringify(it.rows).length);
      return batches.map((b, k) => ({
        key: `d${k}`,
        label: `Phần ${k + 1}/${batches.length}`,
        run: async (sig) => [{ blocks: await blocksRun(b, sig) }],
      }));
    }

    if (kind === "xlsx") {
      const src = await xlsxToSheets(files[0]);
      xlsSrcRef.current = src;
      xlsDictRef.current = new Map();
      const uniq = Array.from(new Set(src.flatMap((s) => s.src.flat()).filter(cellNeedsTranslate).map((c) => c.trim())));
      rebuildSheets();
      if (!uniq.length) return [];
      const batches = batchItems(uniq, (s) => s.length + 8, 3500, 150);
      const strRun = async (batch: string[], signal: AbortSignal): Promise<void> => {
        try {
          const r = await api.post(
            "/translate/blocks",
            { items: batch.map((text) => ({ text })), context: ctx, mode: "cells", quality: Q },
            { signal, ...LONG }
          );
          addUsage(r.data?.usage);
          batch.forEach((s, k) => xlsDictRef.current.set(s, r.data.items?.[k]?.vi ?? s));
        } catch (e) {
          if (isTooBig(e) && batch.length > 1) {
            const mid = Math.ceil(batch.length / 2);
            await strRun(batch.slice(0, mid), signal);
            await strRun(batch.slice(mid), signal);
            return;
          }
          throw e;
        }
      };
      return batches.map((b, k) => ({
        key: `x${k}`,
        label: `Lô ${k + 1}/${batches.length}`,
        run: async (sig) => {
          await strRun(b, sig);
          return [];
        },
      }));
    }
    return [];
  }

  async function onStart() {
    setPrepError(null);
    setSections([]);
    setSheets([]);
    setTab("doc");
    setStarted(true);
    setUsage({});
    setQuality(deep ? "deep" : "fast");
    newSession();
    setDocTitle(picked.kind === "images" ? `${picked.files.length} trang ảnh chụp` : picked.files[0]?.name || "Tài liệu");
    try {
      const tasks = await buildTasks();
      if (!tasks.length) {
        if (picked.kind === "xlsx") rebuildSheets();
        else setStarted(false);
        return;
      }
      await runAll(tasks);
    } catch (e) {
      setPrepError(errMessage(e) || "Không đọc được file");
      setRunning(false);
      setStarted(false);
    }
  }

  function onPick(list: FileList | null, append = false) {
    const files = Array.from(list || []);
    if (!files.length) return;
    // Chụp ảnh: cộng dồn từng trang vào danh sách
    if (append && picked.kind === "images") {
      setPicked({ kind: "images", files: [...picked.files, ...files.filter((f) => f.type.startsWith("image/"))] });
    } else {
      setPicked(detectKind(files));
    }
    setPrepError(null);
  }

  function removePhoto(idx: number) {
    const files = picked.files.filter((_, i) => i !== idx);
    setPicked(files.length ? { kind: "images", files } : { kind: null, files: [] });
  }

  /** Bắt đầu phiên mới: quên tài liệu đang mở (bản đã lưu vẫn nằm trong Lịch sử) */
  function newSession() {
    sessionRef.current += 1;
    setSessionKey(sessionRef.current);
    creatingRef.current = false;
    lastSaved.current = { content: "", usage: "", draft: "" };
    setDocId(null);
    setQuoteDraft(null);
    setSaveState("");
    setSources(null);
  }

  /** Về màn chọn file + danh sách lịch sử. Trả về false nếu người dùng bấm Huỷ */
  function resetAll(): boolean {
    if ((running || (started && !docId)) && !window.confirm("Bản dịch này chưa được lưu. Bỏ để quay lại?")) return false;
    if (running) abortRef.current?.abort();
    newSession();
    setDocTitle("");
    setPicked({ kind: null, files: [] });
    setSections([]);
    setSheets([]);
    setStarted(false);
    setContext("");
    setTab("doc");
    setUsage({});
    window.scrollTo({ top: 0 });
    return true;
  }

  // Nút Back của điện thoại / trình duyệt: đang xem bản dịch -> quay về danh sách (không rời trang)
  const pushedRef = useRef(false);
  const backRef = useRef(resetAll);
  backRef.current = resetAll;
  useEffect(() => {
    if (started && !pushedRef.current) {
      window.history.pushState({ ...(window.history.state || {}), translateView: 1 }, "");
      pushedRef.current = true;
    }
  }, [started]);
  useEffect(() => {
    const onPop = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      if (!backRef.current()) {
        // bấm Huỷ -> ở lại trang bản dịch
        window.history.pushState({ ...(window.history.state || {}), translateView: 1 }, "");
        pushedRef.current = true;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function goBack() {
    if (pushedRef.current) window.history.back(); // đi qua popstate để lịch sử trình duyệt khớp
    else resetAll();
  }

  // ------------------------------------------------------------ kết quả
  const donePages = useMemo(() => sections.filter((s) => s.status === "done").flatMap((s) => s.pages), [sections]);
  const total = sections.length;
  const finished = sections.filter((s) => s.status === "done" || s.status === "error").length;
  const errors = sections.filter((s) => s.status === "error").length;
  const baseName = picked.kind === "images" ? "anh-chup" : (docTitle || "tai-lieu").replace(/\.[^.]+$/, "");
  const isXlsx = picked.kind === "xlsx";
  const hasResult = isXlsx ? !running && finished > 0 && sheets.length > 0 : donePages.length > 0;
  const missed = useMemo(() => donePages.flatMap((p) => p.blocks).filter((b) => b.untranslated), [donePages]);

  const chatText = useMemo(
    () => (isXlsx ? sheetsToChatText(sheets) : pagesToChatText(donePages)),
    [isXlsx, sheets, donePages]
  );

  // Dịch lại các đoạn AI còn sót (đang đánh dấu vàng)
  async function fixMissed() {
    if (!missed.length) return;
    setFixing(true);
    try {
      const r = await api.post(
        "/translate/blocks",
        {
          items: missed.map((b) => (b.type === "table" ? { rows: b.srcRows } : { text: b.src })),
          context: context.trim() || undefined,
          mode: "doc",
          quality,
        },
        LONG
      );
      addUsage(r.data?.usage);
      const m = new Map<Block, Partial<Block>>();
      missed.forEach((b, k) => {
        const res = r.data.items?.[k] || {};
        m.set(b, b.type === "table" ? { viRows: res.viRows, untranslated: res.untranslated } : { vi: res.vi, untranslated: res.untranslated });
      });
      setSections((cur) =>
        cur.map((s) => ({
          ...s,
          pages: s.pages.map((p) => ({ ...p, blocks: p.blocks.map((b) => (m.has(b) ? { ...b, ...m.get(b) } : b)) })),
        }))
      );
      setToast("Đã dịch lại các đoạn còn sót");
    } catch (e) {
      setToast(errMessage(e));
    } finally {
      setFixing(false);
    }
  }

  function jumpToPage(n: number) {
    setTab("doc");
    setTimeout(() => {
      const el = document.getElementById(`trang-${n}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-indigo-400");
        setTimeout(() => el.classList.remove("ring-2", "ring-indigo-400"), 1600);
      } else setToast(`Chưa có Trang ${n} trong bản dịch`);
    }, 60);
  }

  // ------------------------------------------------------------ LỊCH SỬ: tự lưu
  const usageSummary = useMemo(() => {
    const models = Object.values(usage);
    return { cost: models.reduce((s, m) => s + m.cost, 0), models };
  }, [usage]);
  const contentStr = useMemo(() => (isXlsx ? JSON.stringify({ sheets }) : JSON.stringify({ pages: donePages })), [isXlsx, sheets, donePages]);
  const usageStr = useMemo(() => JSON.stringify(usageSummary), [usageSummary]);
  const draftStr = useMemo(() => JSON.stringify(quoteDraft), [quoteDraft]);

  // Dịch xong (kể cả còn vài phần lỗi) -> tạo bản lưu + tải file gốc lên R2
  async function createHistory() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    const sess = sessionRef.current;
    const files = picked.files;
    const snap = { content: contentStr, usage: usageStr, draft: draftStr };
    setSaveState("saving");
    try {
      const r = await api.post(
        "/translate/history",
        {
          title: docTitle,
          kind: picked.kind,
          context: context.trim() || undefined,
          quality,
          ...(isXlsx ? { sheets } : { pages: donePages }),
          usage: usageSummary,
          files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        },
        LONG
      );
      if (sess !== sessionRef.current) return;
      const id: string = r.data.id;
      lastSaved.current = { ...snap, draft: "null" };
      setDocId(id);
      setSaveState("saved");
      // file gốc: tải lên chạy nền, lỗi file nào thì bỏ qua file đó
      const uploads: { index: number; url: string }[] = r.data.uploads || [];
      if (!uploads.length) return;
      setSources({ uploaded: 0, total: uploads.length, busy: true });
      const ok: number[] = [];
      for (const u of uploads) {
        try {
          await putToR2(u.url, files[u.index]);
          ok.push(u.index);
        } catch {
          /* bỏ qua file lỗi */
        }
        if (sess === sessionRef.current) setSources({ uploaded: ok.length, total: uploads.length, busy: true });
      }
      const m = ok.length ? await api.post(`/translate/history/${id}/uploaded`, { indexes: ok }) : null;
      if (sess === sessionRef.current) setSources({ uploaded: m?.data?.uploaded ?? 0, total: uploads.length });
    } catch {
      if (sess === sessionRef.current) {
        setSaveState("error");
        creatingRef.current = false;
      }
    }
  }

  useEffect(() => {
    if (started && !running && hasResult && !docId && saveState === "") createHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, running, hasResult, docId, saveState]);

  // Đã lưu rồi mà có thay đổi (dịch lại chỗ sót, hỏi AI, sửa báo giá) -> cập nhật sau ~1,5 giây
  useEffect(() => {
    if (!docId || running) return;
    const last = lastSaved.current;
    const body: Record<string, unknown> = {};
    if (contentStr !== last.content) Object.assign(body, JSON.parse(contentStr));
    if (usageStr !== last.usage) body.usage = usageSummary;
    if (draftStr !== last.draft) body.quoteDraft = quoteDraft;
    if (!Object.keys(body).length) return;
    const id = docId;
    const sess = sessionRef.current;
    const snap = { content: contentStr, usage: usageStr, draft: draftStr };
    const t = setTimeout(async () => {
      try {
        await api.patch(`/translate/history/${id}`, body, LONG);
        if (sess !== sessionRef.current) return;
        lastSaved.current = snap;
        setSaveState("saved");
      } catch {
        if (sess === sessionRef.current) setSaveState("error");
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, running, contentStr, usageStr, draftStr]);

  // Mở lại tài liệu đã lưu
  async function openHistory(id: string) {
    setOpening(id);
    try {
      const { data: d } = await api.get(`/translate/history/${id}`);
      newSession();
      const pages: DocPage[] = d.pages || [];
      const sh: SheetData[] = d.sheets || [];
      const models: UsageModel[] = d.usage?.models || [];
      const usageRec = Object.fromEntries(models.map((m) => [m.model, m]));
      tasksRef.current = new Map();
      setPicked({ kind: d.kind, files: [] });
      setDocTitle(d.title);
      setContext(d.context || "");
      setQuality(d.quality === "deep" ? "deep" : "fast");
      setDeep(d.quality === "deep");
      setSections([{ key: "saved", label: "Đã lưu", status: "done", pages }]);
      setSheets(sh);
      setUsage(usageRec);
      setQuoteDraft(d.quoteDraft || null);
      const srcs: { uploaded: boolean }[] = d.sources || [];
      setSources(srcs.length ? { uploaded: srcs.filter((s) => s.uploaded).length, total: srcs.length } : null);
      lastSaved.current = {
        content: d.kind === "xlsx" ? JSON.stringify({ sheets: sh }) : JSON.stringify({ pages }),
        usage: JSON.stringify({ cost: models.reduce((s, m) => s + m.cost, 0), models }),
        draft: JSON.stringify(d.quoteDraft || null),
      };
      creatingRef.current = true;
      setDocId(d.id);
      setSaveState("saved");
      setTab("doc");
      setStarted(true);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setToast(errMessage(e));
    } finally {
      setOpening(null);
    }
  }

  async function downloadSources() {
    if (!docId) return;
    setSheetOpen(false);
    try {
      const { data } = await api.get(`/translate/history/${docId}/sources`);
      const files: { name: string; url: string }[] = data.files || [];
      if (!files.length) return setToast("Không còn file gốc");
      files.forEach((f, i) =>
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = f.url;
          a.download = f.name;
          a.click();
        }, i * 400)
      );
    } catch (e) {
      setToast(errMessage(e));
    }
  }

  async function copyVi() {
    await navigator.clipboard.writeText(pagesToPlainVi(donePages));
    setSheetOpen(false);
    setToast("Đã copy bản dịch");
  }

  // ============================================================ giao diện
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-32 pt-3 md:px-4 md:pb-10">
      {/* ---------- tiêu đề ---------- */}
      <div className="mb-3 flex items-center gap-2">
        {started && (
          <button
            onClick={goBack}
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-700 active:bg-slate-200"
            aria-label="Quay lại danh sách"
            title="Quay lại danh sách"
          >
            ‹
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight md:text-xl">Dịch tài liệu</h1>
          <p className="text-xs text-slate-500">Trung / Anh → Việt · dịch xong tự lưu vào lịch sử</p>
        </div>
        {started && (
          <button onClick={goBack} className="shrink-0 rounded-full border bg-white px-3 py-1.5 text-sm active:bg-slate-100">
            + Tài liệu mới
          </button>
        )}
      </div>

      {/* ---------- BƯỚC 1: chọn tài liệu ---------- */}
      {!started && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50 py-6 text-indigo-700 active:bg-indigo-100">
              <span className="text-3xl">📷</span>
              <span className="text-sm font-medium">Chụp trang</span>
              <span className="text-[11px] text-indigo-500">chụp lần lượt từng trang</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPick(e.target.files, true); e.target.value = ""; }} />
            </label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-200 bg-white py-6 text-slate-700 active:bg-slate-50">
              <span className="text-3xl">📄</span>
              <span className="text-sm font-medium">Chọn file</span>
              <span className="text-[11px] text-slate-500">PDF · Word · Excel · ảnh</span>
              <input type="file" multiple accept=".pdf,.docx,.xlsx,.xls,image/*" className="hidden" onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
            </label>
          </div>

          {picked.warn && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{picked.warn}</div>}

          {/* Ảnh đã chụp: vuốt ngang, bấm × để bỏ */}
          {picked.kind === "images" && (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {picked.files.map((_f, i) => (
                <div key={i} className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl border bg-slate-100">
                  {thumbs[i] && <img src={thumbs[i]} alt="" className="h-full w-full object-cover" />}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">Trang {i + 1}</span>
                  <button onClick={() => removePhoto(i)} className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-sm leading-6 text-white" aria-label="Bỏ ảnh">
                    ×
                  </button>
                </div>
              ))}
              <label className="flex h-28 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-slate-400 active:bg-slate-50">
                <span className="text-2xl">+</span>
                <span className="text-[11px]">Chụp thêm</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPick(e.target.files, true); e.target.value = ""; }} />
              </label>
            </div>
          )}

          {picked.kind && picked.kind !== "images" && (
            <div className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5">
              <span className="text-2xl">{picked.kind === "pdf" ? "📕" : picked.kind === "docx" ? "📘" : "📗"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{picked.files[0].name}</div>
                <div className="text-xs text-slate-500">{fmtSize(picked.files[0].size)}</div>
              </div>
              <button onClick={() => setPicked({ kind: null, files: [] })} className="px-2 text-xl text-slate-400" aria-label="Bỏ file">
                ×
              </button>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-white px-3 py-3">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="mt-0.5 h-5 w-5 accent-indigo-600" />
            <span>
              <span className="block text-sm font-medium text-slate-800">Dịch chuyên sâu</span>
              <span className="block text-xs text-slate-500">
                Dùng AI mạnh hơn cho bản scan mờ, bảng phức tạp, tài liệu quan trọng. Chính xác hơn nhưng chi phí cao hơn ~20 lần.
              </span>
            </span>
          </label>

          <label className="block">
            <span className="text-sm text-slate-600">Tài liệu về máy gì? <span className="text-slate-400">(không bắt buộc)</span></span>
            <input
              className="mt-1 block w-full rounded-xl border px-3 py-2.5 text-[16px]"
              placeholder='vd "Máy hàn miệng túi liên tục FR-900"'
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </label>
          {prepError && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{prepError}</div>}

          <HistoryList onOpen={openHistory} opening={opening} onError={setToast} />
        </div>
      )}

      {/* ---------- BƯỚC 2: kết quả ---------- */}
      {started && (
        <>
          {/* tên tài liệu + tiến độ */}
          <div className="mb-3 rounded-xl border bg-white px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-medium">
                {docTitle}
              </div>
              {quality === "deep" && <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">Chuyên sâu</span>}
            </div>
            {total > 0 && (
              <>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-200">
                  <div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round((finished / total) * 100)}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {running ? "Đang dịch" : "Xong"} {finished}/{total} phần
                  {errors > 0 && <span className="text-red-600"> · {errors} phần lỗi</span>}
                  {running && " · giữ màn hình mở"}
                </div>
              </>
            )}
            {saveState && (
              <div className="mt-1 text-[11px]">
                {saveState === "saving" && <span className="text-slate-500">Đang lưu vào lịch sử…</span>}
                {saveState === "saved" && <span className="text-emerald-700">✓ Đã lưu vào lịch sử</span>}
                {saveState === "error" && (
                  <span className="text-red-600">
                    Chưa lưu được vào lịch sử ·{" "}
                    <button
                      className="underline"
                      onClick={() => {
                        if (docId) lastSaved.current = { content: "", usage: "", draft: "" }; // lưu lại toàn bộ
                        setSaveState("");
                      }}
                    >
                      Thử lại
                    </button>
                  </span>
                )}
                {sources && (
                  <span className="text-slate-500">
                    {" · "}
                    {sources.busy ? `đang tải file gốc lên ${sources.uploaded}/${sources.total}…` : `file gốc ${sources.uploaded}/${sources.total}`}
                  </span>
                )}
              </div>
            )}
            {Object.keys(usage).length > 0 && (
              <div className="mt-1.5 border-t pt-1.5 text-[11px] text-slate-500">
                Chi phí AI: <b className="text-slate-700">${Object.values(usage).reduce((s, m) => s + m.cost, 0).toFixed(4)}</b>
                {" · "}
                {Object.values(usage)
                  .map(
                    (m) =>
                      `${m.model.replace("claude-", "")} ${m.calls} lần, ${Math.round(m.input / 1000)}K vào / ${Math.round(m.output / 1000)}K ra${m.thinking ? ` (suy nghĩ ${Math.round(m.thinking / 1000)}K)` : ""}`
                  )
                  .join(" · ")}
              </div>
            )}
          </div>

          {/* tab Bản dịch / Hỏi AI — dính trên cùng khi cuộn */}
          <div className="sticky top-0 z-20 -mx-3 mb-3 border-b bg-white px-3 pt-1 md:mx-0">
            <div className="grid grid-cols-3">
              {(
                [
                  ["doc", "Bản dịch"],
                  ["chat", "💬 Hỏi AI"],
                  ["quote", "🧾 Báo giá"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  disabled={k !== "doc" && !hasResult}
                  className={`border-b-2 py-2.5 text-sm font-medium disabled:opacity-40 ${
                    tab === k ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "doc" && hasResult && (
              <div className="flex items-center justify-between gap-2 py-2">
                {!isXlsx ? (
                  <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-sm">
                    {(
                      [
                        ["tieng-viet", "Tiếng Việt"],
                        ["song-ngu", "Song ngữ"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`rounded-full px-3 py-1 ${view === v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span />
                )}
                <button onClick={() => setSheetOpen(true)} className="rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white active:bg-emerald-700">
                  ⬇ Tải về
                </button>
              </div>
            )}
          </div>

          {/* ---------- tab Bản dịch ---------- */}
          <div className={tab === "doc" ? "" : "hidden"}>
            {missed.length > 0 && !running && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <span>Còn {missed.length} đoạn chưa dịch được (viền vàng).</span>
                <button onClick={fixMissed} disabled={fixing} className="shrink-0 rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium disabled:opacity-50">
                  {fixing ? "Đang dịch…" : "Dịch lại"}
                </button>
              </div>
            )}
            {view === "tieng-viet" && !isXlsx && donePages.length > 0 && (
              <div className="mb-2 text-center text-xs text-slate-400">Chạm vào đoạn bất kỳ để xem chữ gốc</div>
            )}

            {isXlsx
              ? sheets.map((s) => <SheetView key={s.name} sheet={s} />)
              : sections.map((s) =>
                  s.status === "done" ? (
                    s.pages.map((p, k) => <PageView key={`${s.key}-${k}`} page={p} view={view} />)
                  ) : (
                    <div
                      key={s.key}
                      className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-3 text-sm ${
                        s.status === "error" ? "border-red-200 bg-red-50 text-red-700" : "bg-white text-slate-500"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {s.status === "running" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />}
                        {s.label} — {s.status === "error" ? s.error : s.status === "running" ? "đang dịch…" : "chờ"}
                      </span>
                      {s.status === "error" && !running && (
                        <button onClick={() => retry(s.key)} className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs">
                          Dịch lại
                        </button>
                      )}
                    </div>
                  )
                )}

            {isXlsx &&
              sections
                .filter((s) => s.status === "error")
                .map((s) => (
                  <div key={s.key} className="mb-2 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <span>
                      {s.label} — {s.error}
                    </span>
                    {!running && (
                      <button onClick={() => retry(s.key)} className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs">
                        Dịch lại
                      </button>
                    )}
                  </div>
                ))}
          </div>

          {/* ---------- tab Hỏi AI ---------- */}
          {hasResult && (
            <div className={tab === "chat" ? "" : "hidden"}>
              {running && (
                <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Tài liệu đang dịch dở — AI chỉ biết các phần đã dịch xong.
                </div>
              )}
              <DocChat
                key={sessionKey}
                docText={chatText}
                docName={docTitle || "Tài liệu"}
                quality={quality}
                onJumpToPage={jumpToPage}
                onUsage={addUsage}
              />
            </div>
          )}

          {/* ---------- tab Báo giá ---------- */}
          {hasResult && (
            <div className={tab === "quote" ? "" : "hidden"}>
              {running && (
                <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Tài liệu đang dịch dở — nên chờ dịch xong rồi mới soạn báo giá để AI đọc đủ thông số.
                </div>
              )}
              <QuotePanel
                key={sessionKey}
                docText={chatText}
                context={context.trim() || undefined}
                quality={quality}
                onUsage={addUsage}
                initial={quoteDraft}
                onChange={setQuoteDraft}
              />
            </div>
          )}
        </>
      )}

      {/* ---------- thanh nút dưới đáy (điện thoại) ---------- */}
      {/* chỉ hiện ở bước chọn file, hoặc nút "Dừng" khi đang ở tab Bản dịch (tab Hỏi AI / Báo giá có thanh nút riêng) */}
      {(!started || (running && tab === "doc")) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 md:static md:mt-4 md:border-0 md:p-0">
          <div className="mx-auto flex max-w-3xl gap-2">
            {running ? (
              <button onClick={() => abortRef.current?.abort()} className="h-12 flex-1 rounded-xl border text-base font-medium active:bg-slate-100">
                Dừng dịch
              </button>
            ) : (
              <button
                onClick={onStart}
                disabled={!picked.kind}
                className="h-12 flex-1 rounded-xl bg-indigo-600 text-base font-semibold text-white active:bg-indigo-700 disabled:opacity-40"
              >
                {picked.kind === "images" ? `Dịch ${picked.files.length} trang` : "Dịch"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------- bảng chọn tải về (trượt từ dưới lên) ---------- */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 md:items-center md:justify-center" onClick={() => setSheetOpen(false)}>
          <div
            className="w-full rounded-t-2xl bg-white p-2 pb-[max(env(safe-area-inset-bottom),12px)] md:max-w-sm md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded bg-slate-200 md:hidden" />
            {isXlsx ? (
              <SheetBtn icon="📗" title="Excel đã dịch" sub="Giữ nguyên các sheet" onClick={() => { downloadTranslatedXlsx(sheets, `${baseName}_dich.xlsx`); setSheetOpen(false); }} />
            ) : (
              <>
                <SheetBtn icon="📘" title="Word tiếng Việt" sub="Chỉ bản dịch, dễ in / gửi" onClick={() => { downloadDocx(donePages, `${baseName}_tieng-viet.docx`, "tieng-viet"); setSheetOpen(false); }} />
                <SheetBtn icon="📑" title="Word song ngữ" sub="Bảng 2 cột: gốc | tiếng Việt" onClick={() => { downloadDocx(donePages, `${baseName}_song-ngu.docx`, "song-ngu"); setSheetOpen(false); }} />
                <SheetBtn icon="📋" title="Copy bản dịch" sub="Dán vào Zalo, ghi chú…" onClick={copyVi} />
              </>
            )}
            {docId && sources && sources.uploaded > 0 && (
              <SheetBtn icon="📎" title="File gốc" sub={`Tải lại file đã đem dịch (${sources.uploaded} file)`} onClick={downloadSources} />
            )}
            {running && <div className="px-3 pt-1 text-xs text-slate-400">Đang dịch dở: file tải về chỉ gồm các phần đã xong.</div>}
            <button onClick={() => setSheetOpen(false)} className="mt-1 h-11 w-full rounded-xl text-sm text-slate-500 active:bg-slate-100">
              Đóng
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8">
          <div className="rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------ danh sách lịch sử
const KIND_ICON: Record<Kind, string> = { pdf: "📕", docx: "📘", xlsx: "📗", images: "📷" };
const fmtDate = (s: string) =>
  new Date(s).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

function HistoryList({ onOpen, opening, onError }: { onOpen: (id: string) => void; opening: string | null; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load(reset: boolean, query = q) {
    setLoading(true);
    try {
      const { data } = await api.get("/translate/history", { params: { q: query.trim() || undefined, cursor: reset ? undefined : cursor } });
      setItems((cur) => (reset ? data.items : [...cur, ...data.items]));
      setCursor(data.nextCursor);
      setLoaded(true);
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(true, q), q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function remove(it: HistoryItem) {
    if (!window.confirm(`Xoá "${it.title}" khỏi lịch sử? (xoá cả file gốc)`)) return;
    try {
      await api.delete(`/translate/history/${it.id}`);
      setItems((cur) => cur.filter((x) => x.id !== it.id));
    } catch (e) {
      onError(errMessage(e));
    }
  }

  const manyUsers = new Set(items.map((i) => i.createdBy)).size > 1;
  if (loaded && !items.length && !q) return null;

  return (
    <div className="pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Tài liệu đã dịch</h2>
        {loading && <span className="text-xs text-slate-400">đang tải…</span>}
      </div>
      <input
        className="mb-2 block w-full rounded-xl border px-3 py-2 text-[16px]"
        placeholder="Tìm theo tên file, tên máy, mã máy…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="divide-y overflow-hidden rounded-xl border bg-white">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 pr-1">
            <button onClick={() => onOpen(it.id)} disabled={!!opening} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left active:bg-slate-50 disabled:opacity-60">
              <span className="text-xl">{KIND_ICON[it.kind] ?? "📄"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{opening === it.id ? "Đang mở…" : it.title}</span>
                {(it.machineCode || it.context) && (
                  <span className="block truncate text-[12px] text-slate-600">{[it.machineCode, it.context].filter(Boolean).join(" · ")}</span>
                )}
                <span className="block truncate text-[11px] text-slate-400">
                  {[`${it.pageCount} ${it.kind === "xlsx" ? "sheet" : "trang"}`, fmtDate(it.createdAt), manyUsers ? it.createdBy : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                {it.quality === "deep" && <span className="rounded-full bg-indigo-50 px-1.5 text-[10px] font-medium text-indigo-700">Chuyên sâu</span>}
                {it.hasQuote && <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">🧾 Báo giá</span>}
              </span>
            </button>
            <button onClick={() => remove(it)} className="h-9 w-9 shrink-0 rounded-full text-slate-400 active:bg-slate-100" aria-label="Xoá">
              🗑
            </button>
          </div>
        ))}
        {loaded && !items.length && <div className="px-3 py-4 text-center text-sm text-slate-400">Không tìm thấy tài liệu nào</div>}
      </div>
      {cursor && (
        <button onClick={() => load(false)} disabled={loading} className="mt-2 w-full rounded-xl border bg-white py-2 text-sm active:bg-slate-50 disabled:opacity-50">
          Xem thêm
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------ các khối hiển thị
function SheetBtn({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-slate-100 md:hover:bg-slate-50">
      <span className="text-2xl">{icon}</span>
      <span>
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

function RowsTable({ rows, muted }: { rows?: string[][]; muted?: boolean }) {
  if (!rows?.length) return null;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className={`min-w-full border-collapse text-[13px] ${muted ? "text-slate-500" : ""}`}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i === 0 ? "bg-slate-50 font-medium" : ""}>
              {r.map((c, j) => (
                <td key={j} className="min-w-[90px] border px-2 py-1.5 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockText({ b, side }: { b: Block; side: "src" | "vi" }) {
  if (b.type === "table") return <RowsTable rows={side === "src" ? b.srcRows : b.viRows} muted={side === "src"} />;
  const text = side === "src" ? b.src : b.vi;
  const cls =
    b.type === "heading"
      ? "text-[16px] font-semibold"
      : b.type === "note"
        ? "rounded-lg bg-amber-50 px-2 py-1.5 font-medium text-amber-800"
        : "";
  return <div className={`whitespace-pre-line ${cls}`}>{text}</div>;
}

/** Tiếng Việt: chạm để xem chữ gốc ngay bên dưới */
function TapBlock({ b }: { b: Block }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen((v) => !v)}
      className={`cursor-pointer px-3 py-2.5 text-[15px] leading-relaxed active:bg-slate-50 ${b.untranslated ? "border-l-4 border-amber-400 bg-amber-50/40" : ""}`}
    >
      <BlockText b={b} side="vi" />
      {open && (
        <div className="mt-1.5 border-l-2 border-slate-200 pl-2 text-[13px] text-slate-500">
          <BlockText b={b} side="src" />
        </div>
      )}
    </div>
  );
}

function PageView({ page, view }: { page: DocPage; view: "song-ngu" | "tieng-viet" }) {
  return (
    <section id={page.page ? `trang-${page.page}` : undefined} className="mb-4 scroll-mt-28 overflow-hidden rounded-xl border bg-white transition-shadow">
      {page.title && <div className="border-b bg-slate-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{page.title}</div>}
      {!page.blocks.length && <div className="px-3 py-3 text-sm italic text-slate-400">Trang không có chữ (chỉ có hình)</div>}
      <div className="divide-y">
        {page.blocks.map((b, i) =>
          view === "tieng-viet" ? (
            <TapBlock key={i} b={b} />
          ) : (
            <div key={i} className={`grid gap-1 px-3 py-2.5 md:grid-cols-2 md:gap-x-6 ${b.untranslated ? "border-l-4 border-amber-400" : ""}`}>
              <div className="text-[13px] text-slate-500 md:text-sm">
                <BlockText b={b} side="src" />
              </div>
              <div className="text-[15px] text-slate-900 md:text-sm">
                <BlockText b={b} side="vi" />
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}

function SheetView({ sheet }: { sheet: SheetData }) {
  const rows = sheet.vi ?? sheet.src;
  return (
    <section className="mb-4 overflow-hidden rounded-xl border bg-white">
      <div className="border-b bg-slate-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Sheet: {sheet.name}</div>
      <div className="max-h-[70dvh] overflow-auto">
        <table className="min-w-full border-collapse text-[13px]">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => {
                  const orig = sheet.src[i]?.[j] ?? "";
                  return (
                    <td key={j} className="min-w-[90px] border px-2 py-1.5 align-top">
                      <div>{c}</div>
                      {orig && orig !== c && <div className="text-[11px] text-slate-400">{orig}</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default TranslatePage;