// src/components/UpdateBanner.tsx
// ✅ Deploy bản mới thì báo "Đã có bản mới — Tải lại" thay vì phải Ctrl + Shift + R.
//  - Service worker để chế độ autoUpdate: bản mới tự cài và nhận quyền ngay (không còn cảnh "bản mới nằm chờ"
//    khiến trang cứ hiện giao diện cũ, hay bấm Cập nhật xong lại quay về bản cũ).
//  - KHÔNG tự tải lại trang (đang nhập dở hoá đơn sẽ mất): hiện hộp thông báo giữa màn hình, người dùng bấm "Tải lại" khi tiện.
//  - Tự kiểm tra bản mới: mỗi 5 phút + mỗi khi quay lại tab / mở lại app trên điện thoại.
import React, { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const CHECK_EVERY_MS = 5 * 60 * 1000;

const UpdateBanner: React.FC = () => {
  const [show, setShow] = useState(false);

  useRegisterSW({
    // bản mới đã cài xong và điều khiển trang -> chỉ báo, không tự reload
    onNeedReload() {
      setShow(true);
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (document.visibilityState === "visible" && navigator.onLine) reg.update().catch(() => undefined);
      };
      window.setInterval(check, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", check);
    },
  });

  // có bản mới mà người dùng chưa bấm: thêm dấu ● ở tiêu đề tab để nhắc
  useEffect(() => {
    if (!show) return;
    document.title = document.title.startsWith("● ") ? document.title : `● ${document.title}`;
    return () => {
      document.title = document.title.replace(/^● /, "");
    };
  }, [show]);

  // Esc = Để sau
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShow(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="upd-title"
        aria-describedby="upd-desc"
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
        </div>
        <h2 id="upd-title" className="mt-4 text-lg font-semibold text-slate-900">
          Đã có bản cập nhật mới
        </h2>
        <p id="upd-desc" className="mt-2 text-sm text-slate-600">
          Hệ thống vừa được cập nhật. Bấm <b>Tải lại</b> để dùng bản mới.
          <br />
          Nếu đang nhập dở, hãy lưu xong rồi tải lại.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setShow(false)}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Để sau
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => window.location.reload()}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white outline-none hover:bg-blue-700 focus-visible:ring-4 focus-visible:ring-blue-200"
          >
            Tải lại
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateBanner;