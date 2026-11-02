// src/components/AppDialog.tsx
// ✅ Hộp thông báo / xác nhận dùng chung, thay cho alert() / confirm() xám của trình duyệt.
//   await appAlert("Đã lưu phiếu.", { title: "Xong", tone: "success" });
//   if (!(await appConfirm("Xoá phiếu này?", { tone: "danger", confirmLabel: "Xoá" }))) return;
// <AppDialogHost /> gắn 1 lần trong Layout.
import React, { useEffect, useRef, useState } from "react";

type Tone = "info" | "success" | "warning" | "danger";
type Req = {
  id: number;
  kind: "alert" | "confirm";
  title?: string;
  message: React.ReactNode;
  tone: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (v: boolean) => void;
};

let seq = 0;
const listeners = new Set<(r: Req) => void>();
function push(r: Omit<Req, "id">) {
  // chưa có host (trang ngoài Layout) -> dùng hộp mặc định của trình duyệt
  if (listeners.size === 0) {
    const text = typeof r.message === "string" ? r.message : String(r.title || "");
    if (r.kind === "confirm") r.resolve(window.confirm(text));
    else {
      window.alert(text);
      r.resolve(true);
    }
    return;
  }
  const req = { ...r, id: ++seq };
  listeners.forEach((l) => l(req));
}

export function appAlert(message: React.ReactNode, opts: { title?: string; tone?: Tone } = {}): Promise<void> {
  return new Promise((res) => push({ kind: "alert", message, title: opts.title, tone: opts.tone || "info", resolve: () => res() }));
}

export function appConfirm(
  message: React.ReactNode,
  opts: { title?: string; tone?: Tone; confirmLabel?: string; cancelLabel?: string } = {}
): Promise<boolean> {
  return new Promise((res) =>
    push({
      kind: "confirm",
      message,
      title: opts.title,
      tone: opts.tone || "info",
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      resolve: res,
    })
  );
}

const TONE: Record<Tone, { ring: string; icon: React.ReactNode; btn: string }> = {
  info: {
    ring: "bg-sky-100 text-sky-700",
    btn: "bg-slate-900 hover:bg-slate-800",
    icon: <path d="M12 8h.01M11 12h1v5h1" strokeLinecap="round" strokeLinejoin="round" />,
  },
  success: {
    ring: "bg-emerald-100 text-emerald-700",
    btn: "bg-emerald-600 hover:bg-emerald-700",
    icon: <path d="M7 12.5l3.2 3.2L17 9" strokeLinecap="round" strokeLinejoin="round" />,
  },
  warning: {
    ring: "bg-amber-100 text-amber-700",
    btn: "bg-slate-900 hover:bg-slate-800",
    icon: <path d="M12 8v5M12 16.5h.01" strokeLinecap="round" />,
  },
  danger: {
    ring: "bg-rose-100 text-rose-700",
    btn: "bg-rose-600 hover:bg-rose-700",
    icon: <path d="M12 8v5M12 16.5h.01" strokeLinecap="round" />,
  },
};

export const AppDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<Req[]>([]);
  const okRef = useRef<HTMLButtonElement | null>(null);
  const cur = queue[0];

  useEffect(() => {
    const on = (r: Req) => setQueue((q) => [...q, r]);
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);

  const close = (v: boolean) => {
    if (!cur) return;
    cur.resolve(v);
    setQueue((q) => q.slice(1));
  };

  useEffect(() => {
    if (!cur) return;
    setTimeout(() => okRef.current?.focus(), 30);
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id]);

  if (!cur) return null;
  const t = TONE[cur.tone];
  return (
    <div
      className="fixed inset-0 z-[100060] flex items-center justify-center bg-slate-900/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="appdlg-title"
      onMouseDown={() => close(false)}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${t.ring}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="12" cy="12" r="9" strokeWidth={1.6} />
            {t.icon}
          </svg>
        </div>
        {cur.title && (
          <h2 id="appdlg-title" className="mt-3 text-lg font-semibold text-slate-900">
            {cur.title}
          </h2>
        )}
        <div className={`${cur.title ? "mt-2" : "mt-3"} whitespace-pre-line text-sm text-slate-600`}>{cur.message}</div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          {cur.kind === "confirm" && (
            <button
              type="button"
              onClick={() => close(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              {cur.cancelLabel || "Huỷ"}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => close(true)}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${t.btn}`}
          >
            {cur.kind === "confirm" ? cur.confirmLabel || "Đồng ý" : "Đã hiểu"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppDialogHost;
