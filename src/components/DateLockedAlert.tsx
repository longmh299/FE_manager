// src/components/DateLockedAlert.tsx
// ✅ Hộp thông báo giữa màn hình khi ngày chứng từ đã bị khoá
//   - "closed": quản trị đã chốt sổ kế toán đến 1 ngày (chặn cả quản trị)
//   - "rolling": quá hạn chỉnh sửa (nhân viên, kế toán 7 ngày; quản trị 90 ngày)
//   Bật từ interceptor của api/client.ts (sự kiện "date-locked"), gắn 1 lần trong Layout.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type Detail = { message: string; kind: "closed" | "rolling" };

const DateLockedAlert: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [d, setD] = useState<Detail | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const on = (e: Event) => setD((e as CustomEvent<Detail>).detail);
    window.addEventListener("date-locked", on);
    return () => window.removeEventListener("date-locked", on);
  }, []);

  useEffect(() => {
    if (!d) return;
    setTimeout(() => okRef.current?.focus(), 30);
    const k = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Enter") && setD(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [d]);

  if (!d) return null;
  const closed = d.kind === "closed";
  // tách câu cho dễ đọc
  const lines = d.message.split(/(?<=\.)\s+/).filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-[100050] flex items-center justify-center bg-slate-900/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dl-title"
      onMouseDown={() => setD(null)}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${closed ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
            <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
            <path d="M8 10.5V7.5a4 4 0 018 0v3" strokeLinecap="round" />
          </svg>
        </div>
        <h2 id="dl-title" className="mt-3 text-lg font-semibold text-slate-900">
          {closed ? "Ngày này đã chốt sổ" : "Chứng từ đã quá hạn chỉnh sửa"}
        </h2>
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        <p className="mt-3 text-sm font-medium text-slate-800">
          {closed
            ? isAdmin
              ? "Chọn ngày sau mốc chốt, hoặc lùi mốc chốt sổ nếu thật sự cần sửa kỳ cũ."
              : "Chọn ngày sau mốc chốt, hoặc báo quản trị nếu thật sự cần sửa kỳ cũ."
            : isAdmin
              ? "Quản trị chỉ sửa được chứng từ trong 90 ngày gần nhất."
              : "Báo quản trị sửa giúp (quản trị sửa được trong 90 ngày)."}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          {closed && isAdmin && (
            <button
              type="button"
              onClick={() => {
                setD(null);
                navigate("/period-close");
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Mở trang Chốt sổ
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => setD(null)}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
};

export default DateLockedAlert;
