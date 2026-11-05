// src/components/PaymentRequestBits.tsx
// ✅ Phần dùng chung cho "Phiếu thu nợ": kiểu dữ liệu, nhãn trạng thái, xem ảnh chuyển khoản.
//   - Trang nhân viên: /me/debts (Công nợ của tôi)
//   - Trang Thu chi: tab "Chờ duyệt"
import React, { useEffect, useState } from "react";
import api from "../api/client";
import { DialogShell } from "./SecondPassword";

export type PRStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type PRAccount = { id: string; code: string; name: string; type?: string; bankName?: string | null; accountNo?: string | null };

export type PaymentRequestRow = {
  id: string;
  status: PRStatus;
  amount: number;
  type?: "RECEIPT" | "PAYMENT";
  kind?: string;
  source?: "STAFF" | "INVOICE" | "MANUAL" | string;
  canDecide?: boolean;
  method: "CASH" | "BANK" | string;
  paidDate: string;
  note: string | null;
  hasProof: boolean;
  proofName: string | null;
  createdAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
  account: PRAccount | null;
  requestedBy: { id: string; username: string };
  decidedBy: { id: string; username: string } | null;
  payment: { id: string; code: string | null; date: string; voided: boolean } | null;
  invoice: { id: string; code: string; issueDate: string; customerName: string; customerPhone: string | null; approved?: boolean; returned?: boolean; settled?: boolean };
  debt?: { remaining: number; otherPending: number };
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }); // giống cả app: 1,200,000
export const money = (n: number) => nf.format(Math.round(Number(n) || 0));

export function viDate(raw?: string | null) {
  if (!raw) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("vi-VN");
}

export function viDateTime(raw?: string | null) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.hour}:${p.minute} ${p.day}/${p.month}`; // VD: 14:17 01/11
}

export const vnToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

export const apiErr = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  if (m) return String(m);
  if (e?.response?.status) return `${fallback} (lỗi ${e.response.status})`;
  if (e?.request) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  return e?.message || fallback;
};

const STATUS: Record<PRStatus, { label: string; cls: string; dot: string }> = {
  PENDING: { label: "Chờ duyệt", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  APPROVED: { label: "Đã duyệt", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  REJECTED: { label: "Bị từ chối", cls: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500" },
  CANCELLED: { label: "Đã huỷ", cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
};

export const StatusChip: React.FC<{ status: PRStatus }> = ({ status }) => {
  const s = STATUS[status] || STATUS.CANCELLED;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
};

export const statusLabel = (s: PRStatus) => STATUS[s]?.label || s;

export const methodLabel = (r: Pick<PaymentRequestRow, "method" | "account" | "source">) =>
  r.method === "CASH"
    ? r.source && r.source !== "STAFF"
      ? `Tiền mặt${r.account ? ` — ${r.account.name}` : ""}`
      : "Tiền mặt — nhân viên cầm, nộp quỹ"
    : `Chuyển khoản${r.account ? ` vào ${r.account.name}` : ""}`;

export const Ico = {
  cash: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M3 10l9-6 9 6M5 10v8M19 10v8M9.5 10v8M14.5 10v8M3 20h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5-9 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" strokeLinejoin="round" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
      <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" strokeLinejoin="round" />
    </svg>
  ),
};

/** Xem ảnh chuyển khoản đính kèm (link tạm 10 phút từ máy chủ) */
export const ProofViewer: React.FC<{ requestId: string | null; onClose: () => void }> = ({ requestId, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!requestId) return;
    setUrl(null);
    setErr(null);
    api
      .get(`/payment-requests/${requestId}/proof`)
      .then((r) => setUrl(r.data?.url || null))
      .catch((e) => setErr(apiErr(e, "Không mở được ảnh")));
  }, [requestId]);
  return (
    <DialogShell open={!!requestId} title="Ảnh chuyển khoản" onClose={onClose} width="max-w-2xl">
      {err ? (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>
      ) : !url ? (
        <div className="py-10 text-center text-sm text-slate-500">Đang tải ảnh…</div>
      ) : (
        <div className="space-y-2">
          <img src={url} alt="Ảnh chuyển khoản" className="mx-auto max-h-[70vh] w-auto rounded-lg border border-slate-200" />
          <a href={url} target="_blank" rel="noreferrer" className="block text-center text-sm font-medium text-sky-700 underline underline-offset-2">
            Mở ảnh cỡ lớn
          </a>
        </div>
      )}
    </DialogShell>
  );
};
