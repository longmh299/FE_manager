// src/components/Toast.tsx
import React, { useEffect, useState } from "react";

type ToastType = "success" | "error" | "info" | "warning";

export type ToastItem = {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  ttl?: number; // ms
};

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function push(t: Omit<ToastItem, "id">) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item: ToastItem = { id, ttl: 3500, ...t };
    setToasts((cur) => [...cur, item]);
    return id;
  }

  function remove(id: string) {
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }

  return { toasts, push, remove };
}

function toneStyle(type: ToastType): React.CSSProperties {
  const base: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#fff",
  };
  if (type === "success") return { ...base, borderColor: "#86efac", background: "#f0fdf4" };
  if (type === "error") return { ...base, borderColor: "#fecaca", background: "#fef2f2" };
  if (type === "warning") return { ...base, borderColor: "#fed7aa", background: "#fff7ed" };
  if (type === "info") return { ...base, borderColor: "#bfdbfe", background: "#eff6ff" };
  return base;
}

export function ToastHost(props: { toasts: ToastItem[]; onClose: (id: string) => void }) {
  const { toasts, onClose } = props;

  return (
    <div
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: 360,
        maxWidth: "calc(100vw - 28px)",
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const ttl = toast.ttl ?? 3500;
  const [pct, setPct] = useState(100);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const p = Math.max(0, 100 - (elapsed / ttl) * 100);
      setPct(p);
      if (elapsed >= ttl) {
        clearInterval(timer);
        onClose();
      }
    }, 50);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        ...toneStyle(toast.type),
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          {toast.title ? <div style={{ fontWeight: 700, marginBottom: 4 }}>{toast.title}</div> : null}
          <div style={{ color: "#111827" }}>{toast.message}</div>
        </div>
        <button
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: "18px",
            padding: 2,
            color: "#6b7280",
          }}
          aria-label="Đóng"
          title="Đóng"
        >
          ×
        </button>
      </div>

      <div style={{ height: 3, background: "rgba(0,0,0,0.06)", marginTop: 10, borderRadius: 999 }}>
        <div style={{ height: 3, width: `${pct}%`, background: "rgba(0,0,0,0.18)" }} />
      </div>
    </div>
  );
}
