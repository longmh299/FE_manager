// src/components/UpdateBanner.tsx
// ✅ Deploy bản mới thì báo "Đã có bản mới — Cập nhật" thay vì phải Ctrl + Shift + R.
//  - Không tự tải lại trang (đang nhập dở hoá đơn sẽ mất) — người dùng bấm Cập nhật khi tiện.
//  - Tự kiểm tra bản mới: mỗi 5 phút + mỗi khi quay lại tab / mở lại app trên điện thoại.
import React, { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const CHECK_EVERY_MS = 5 * 60 * 1000;

const UpdateBanner: React.FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
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
    if (!needRefresh) return;
    document.title = document.title.startsWith("● ") ? document.title : `● ${document.title}`;
    return () => {
      document.title = document.title.replace(/^● /, "");
    };
  }, [needRefresh]);

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-[1000] mx-auto flex max-w-md items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl sm:inset-x-auto sm:right-4"
    >
      <span className="flex-1">Đã có bản mới của hệ thống.</span>
      <button type="button" onClick={() => setNeedRefresh(false)} className="rounded-lg px-2 py-1 text-slate-300 hover:text-white">
        Để sau
      </button>
      <button
        type="button"
        onClick={() => {
          void updateServiceWorker(true);
          // dự phòng: 3 giây sau trang chưa tự tải lại (tab mở từ trước khi có service worker) thì tải lại
          window.setTimeout(() => window.location.reload(), 3000);
        }}
        className="rounded-lg bg-blue-500 px-3 py-1.5 font-semibold hover:bg-blue-600"
      >
        Cập nhật
      </button>
    </div>
  );
};

export default UpdateBanner;