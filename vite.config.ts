import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // ✅ 'prompt': có bản mới thì hiện thanh "Cập nhật" (src/components/UpdateBanner.tsx), không bắt Ctrl + Shift + R.
      //    Không dùng autoUpdate tự tải lại: đang nhập dở hoá đơn sẽ mất.
      registerType: 'prompt',
      injectRegister: false, // đăng ký trong UpdateBanner
      includeAssets: ['logo-mcbrother.png'],
      manifest: {
        name: 'Quản Lý Kho - MCBROTHER',
        short_name: 'QL Kho',
        description: 'Hệ thống quản lý kho, hóa đơn, báo giá MCBROTHER',
        start_url: '/',
        scope: '/',
        display: 'standalone', // ✅ mở ra như app thật, không có thanh địa chỉ trình duyệt
        background_color: '#0f172a',
        theme_color: '#0f172a',
        // ✅ cho xoay ngang (kiểm kê / bảng nhiều cột xem ngang dễ hơn); trước để 'portrait' là khoá màn hình dọc
        orientation: 'any',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable', // ✅ để icon không bị bo tròn/cắt xấu trên Android
          },
        ],
      },
      workbox: {
        clientsClaim: true, // ✅ bản mới nhận quyền điều khiển trang ngay khi bấm Cập nhật -> trang tự tải lại
        // ✅ cache app shell để mở lại lần sau nhanh hơn; KHÔNG cache API calls
        // (dữ liệu tồn kho/hóa đơn luôn phải lấy mới, không được cache)
        navigateFallbackDenylist: [/^\/api\//],
        // ✅ bundle chính đã vượt 2MB mặc định của workbox (build fail nếu không nới),
        // nới lên 5MB để vẫn precache được file JS chính.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});