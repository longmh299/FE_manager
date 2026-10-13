// src/components/translate/DocChat.tsx
// ✅ Hỏi AI về tài liệu vừa dịch: thông số, cách vận hành, xử lý lỗi, bảo trì...
// - AI trả lời dựa trên tài liệu, ghi nguồn "(Trang 12)" -> chạm vào để nhảy tới trang đó
// - Gửi kèm ảnh chụp (màn hình báo lỗi, linh kiện) để AI đối chiếu
// - Trả lời chạy dần từng chữ (stream) cho cảm giác nhanh trên điện thoại
// - Không lưu lịch sử chat lên hệ thống
import React, { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../api/client";
import { imageToBase64 } from "../../utils/translateDoc";

type Msg = {
  role: "user" | "assistant";
  content: string;
  image?: { data: string; mediaType: string; preview: string };
  error?: boolean;
};

type Props = {
  docText: string;
  docName: string;
  quality?: "fast" | "deep";
  onJumpToPage?: (page: number) => void;
  /** chi phí thật của câu trả lời (BE gửi kèm cuối stream) */
  onUsage?: (u: { cost: number; models: { model: string; calls: number; input: number; output: number; thinking: number; cost: number }[] }) => void;
};

const SUGGESTIONS = [
  "Tóm tắt các bước vận hành máy",
  "Thông số kỹ thuật chính của máy",
  "Các lỗi thường gặp và cách xử lý",
  "Lịch bảo trì, bảo dưỡng định kỳ",
  "Cách thay dây đai / linh kiện hao mòn",
  "Những cảnh báo an toàn cần nhớ",
];

// ---------------------------------------------------------------- hiển thị chữ AI (markdown đơn giản)
function Inline({ text, onJump }: { text: string; onJump?: (p: number) => void }) {
  // **đậm** và (Trang 12) / (Trang 3, 5)
  const parts = text.split(/(\*\*[^*]+\*\*|\(Trang [\d,\s–-]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>;
        const m = /^\(Trang ([\d,\s–-]+)\)$/.exec(p);
        if (m && onJump) {
          const first = Number(m[1].match(/\d+/)?.[0]);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJump(first)}
              className="mx-0.5 rounded bg-indigo-50 px-1 text-indigo-700 underline decoration-dotted active:bg-indigo-100"
            >
              Trang {m[1].trim()}
            </button>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

function RichText({ text, onJump }: { text: string; onJump?: (p: number) => void }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((raw, i) => {
        const line = raw.replace(/^#{1,4}\s+/, "");
        if (!line.trim()) return <div key={i} className="h-1" />;
        const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
        if (bullet)
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-slate-400">•</span>
              <span>
                <Inline text={bullet[1]} onJump={onJump} />
              </span>
            </div>
          );
        const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
        if (num)
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="min-w-[1.25rem] font-medium text-indigo-600">{num[1]}.</span>
              <span>
                <Inline text={num[2]} onJump={onJump} />
              </span>
            </div>
          );
        const isHead = /^#{1,4}\s+/.test(raw);
        return (
          <div key={i} className={isHead ? "pt-1 font-semibold" : ""}>
            <Inline text={line} onJump={onJump} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- component
const DocChat: React.FC<Props> = ({ docText, docName, quality, onJumpToPage, onUsage }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<Msg["image"] | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  // Ô nhập tự giãn theo nội dung (tối đa ~5 dòng)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  async function onPickImage(f?: File | null) {
    if (!f) return;
    const img = await imageToBase64(f, 1568);
    setImage({ ...img, preview: `data:${img.mediaType};base64,${img.data}` });
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if ((!q && !image) || busy) return;
    const userMsg: Msg = { role: "user", content: q || "Ảnh này là gì, liên quan gì tới tài liệu?", image: image ?? undefined };
    const history = [...msgs.filter((m) => !m.error), userMsg];
    setMsgs([...msgs, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setImage(null);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const setLast = (fn: (m: Msg) => Msg) => setMsgs((cur) => [...cur.slice(0, -1), fn(cur[cur.length - 1])]);

    try {
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/translate/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: ctrl.signal,
        body: JSON.stringify({
          doc: docText,
          docName,
          quality,
          messages: history.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.image ? { image: { data: m.image.data, mediaType: m.image.mediaType } } : {}),
          })),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message || `Lỗi ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        const text = raw.split("\u001e")[0]; // phần sau \u001e là chi phí, không hiện
        setLast((m) => ({ ...m, content: text }));
      }
      const tail = raw.split("\u001e")[1];
      if (tail) {
        try {
          onUsage?.(JSON.parse(tail));
        } catch {
          /* bỏ qua */
        }
      }
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") setLast((m) => ({ ...m, content: (m.content || "") + "\n\n_(đã dừng)_" }));
      else setLast(() => ({ role: "assistant", content: `⚠️ ${err?.message || "Không gửi được câu hỏi"}`, error: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60dvh] flex-col">
      {/* ---------- tin nhắn ---------- */}
      <div className="flex-1 space-y-3 pb-4">
        {!msgs.length && (
          <div className="rounded-xl border bg-white p-4">
            <div className="mb-1 font-medium text-slate-800">Hỏi AI về tài liệu này</div>
            <div className="mb-3 text-sm text-slate-500">
              AI đọc toàn bộ bản dịch để trả lời, có ghi trang nguồn. Có thể gửi kèm ảnh màn hình báo lỗi để AI đối chiếu.
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 active:bg-indigo-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-[15px] text-white">
                {m.image && <img src={m.image.preview} alt="" className="mb-1 max-h-48 rounded-lg" />}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div
                className={`max-w-[92%] rounded-2xl rounded-bl-sm border px-3 py-2 text-[15px] leading-relaxed ${
                  m.error ? "border-red-200 bg-red-50 text-red-700" : "bg-white text-slate-800"
                }`}
              >
                {m.content ? (
                  <RichText text={m.content} onJump={onJumpToPage} />
                ) : (
                  <span className="inline-flex gap-1 py-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:240ms]" />
                  </span>
                )}
              </div>
            </div>
          )
        )}
        {/* chừa chỗ cho ô nhập cố định ở đáy màn hình điện thoại */}
        <div className="h-32 md:h-0" />
        <div ref={endRef} />
      </div>

      {/* ---------- ô nhập (dính đáy màn hình trên điện thoại) ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 backdrop-blur md:sticky md:inset-auto md:rounded-xl md:border">
        {image && (
          <div className="mb-2 flex items-center gap-2">
            <img src={image.preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <button type="button" onClick={() => setImage(null)} className="text-sm text-slate-500 underline">
              Bỏ ảnh
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border text-xl active:bg-slate-100" title="Gửi ảnh">
            📷
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                onPickImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 768px)").matches) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Hỏi về thông số, cách chỉnh, lỗi máy…"
            className="min-h-[44px] flex-1 resize-none rounded-2xl border px-3 py-2.5 text-[16px] leading-5 outline-none focus:border-indigo-400"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="h-11 shrink-0 rounded-full border px-4 text-sm active:bg-slate-100"
            >
              Dừng
            </button>
          ) : (
            <button
              type="button"
              onClick={() => send()}
              disabled={!input.trim() && !image}
              className="h-11 shrink-0 rounded-full bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              Gửi
            </button>
          )}
        </div>
        <div className="mt-1 text-center text-[11px] text-slate-400">
          AI có thể nhầm — thông số quan trọng hãy đối chiếu lại tài liệu gốc.
        </div>
      </div>
    </div>
  );
};

export default DocChat;