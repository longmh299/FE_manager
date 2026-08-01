import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string };

function getErrMsg(e: any) {
  if (e?.response?.data?.message) return e.response.data.message;
  if (e?.response?.status) return `HTTP ${e.response.status}`;
  if (typeof e?.message === "string") return e.message;
  return "Lỗi không xác định";
}

// ---------- Markdown-lite renderer: **đậm** + danh sách "- " ----------
// Tô màu theo ngữ nghĩa: CRITICAL -> đỏ, LOW -> vàng cam, số liệu thường -> xanh đậm.

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      let cls = "bg-blue-50 text-blue-700 border border-blue-100";
      if (/critical/i.test(inner)) cls = "bg-red-50 text-red-700 border border-red-200";
      else if (/\blow\b/i.test(inner)) cls = "bg-amber-50 text-amber-700 border border-amber-200";

      return (
        <span
          key={`${keyPrefix}-b-${i}`}
          className={`font-semibold px-1.5 py-0.5 rounded-md text-[13px] ${cls}`}
        >
          {inner}
        </span>
      );
    }
    return <span key={`${keyPrefix}-t-${i}`}>{part}</span>;
  });
}

function renderContent(content: string) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="space-y-1.5 my-1.5">
        {listBuffer.map((item, idx) => (
          <li key={idx} className="flex gap-2 items-start">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
            <span className="leading-relaxed">
              {renderInline(item.replace(/^-\s*/, ""), `li-${key}-${idx}`)}
            </span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      listBuffer.push(trimmed);
    } else {
      flushList(`list-${idx}`);
      if (trimmed) {
        blocks.push(
          <p key={`p-${idx}`} className="leading-relaxed">
            {renderInline(trimmed, `p-${idx}`)}
          </p>
        );
      }
    }
  });
  flushList("list-end");

  return <div className="space-y-1">{blocks}</div>;
}

const WELCOME_TEXT =
  "Chào bạn! Mình có thể giúp:\n" +
  "**Tồn kho:**\n" +
  "- Tra cứu tồn kho sản phẩm (theo tên, SKU, hoặc kho)\n" +
  "- Kiểm tra sản phẩm sắp hết hàng hoặc hết hàng\n" +
  "- Phát hiện tồn kho âm (lỗi dữ liệu)\n" +
  "- Đánh giá tồn kho có đủ bán không, có cần nhập thêm\n" +
  "**Bán hàng & Doanh thu:**\n" +
  "- Tra cứu hóa đơn (theo mã, khách hàng, khoảng ngày)\n" +
  "- Tính doanh thu & số lượng bán của từng sản phẩm trong khoảng thời gian\n" +
  "**Khách hàng:**\n" +
  "- Xem lịch sử mua hàng của khách\n" +
  "- Kiểm tra công nợ, tổng đã mua\n\n" +
  'Hỏi mình bất kỳ câu nào về kho hàng, bán hàng hoặc khách hàng nhé 😊';

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const history = nextMessages.slice(-11, -1);

      const r = await api.post("/assistant/chat", {
        message: text,
        history,
      });

      const reply = r.data?.reply || "Không có câu trả lời.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Lỗi: ${getErrMsg(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          className="fixed right-4 bottom-20 w-[420px] h-[600px] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-[99999] flex flex-col"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-900">
            <div className="font-semibold text-white flex items-center gap-2">
              <span>💬</span> Trợ lý kho
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-lg hover:bg-white/10 text-white flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto px-4 py-3 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm bg-white text-slate-800 border border-slate-200 shadow-sm">
                {renderContent(WELCOME_TEXT)}
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-slate-900 text-white ml-auto"
                    : "bg-white text-slate-800 border border-slate-200 shadow-sm"
                }`}
              >
                {m.role === "assistant" ? (
                  renderContent(m.content)
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            ))}

            {loading && (
              <div className="text-xs text-slate-400 flex items-center gap-1.5 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
                Đang trả lời…
              </div>
            )}
          </div>

          <div className="p-3 border-t border-slate-200 flex items-end gap-2 bg-white">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Nhập câu hỏi..."
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="button"
              onClick={send}
              disabled={loading || !input.trim()}
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium disabled:opacity-40"
            >
              Gửi
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-4 z-[99999] w-12 h-12 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center text-xl hover:bg-slate-800 transition"
        title="Trợ lý kho"
      >
        💬
      </button>
      {panel}
    </>
  );
}