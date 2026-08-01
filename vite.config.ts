import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        orientation: 'portrait',
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
        // ✅ cache app shell để mở lại lần sau nhanh hơn; KHÔNG cache API calls
        // (dữ liệu tồn kho/hóa đơn luôn phải lấy mới, không được cache)
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});