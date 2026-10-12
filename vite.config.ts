import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build        → dist/：正式網站（PWA，可加入主畫面、離線使用）
// npm run build:single → dist-single/index.html：單一檔案預覽版（不含離線功能）
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    publicDir: single ? false : 'public',
    plugins: [
      react(),
      single
        ? viteSingleFile()
        : VitePWA({
            registerType: 'autoUpdate',
            injectRegister: false,
            includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
            manifest: {
              name: '半時格 — 高中生時間管理',
              short_name: '半時格',
              description: '每 30 分鐘一格，安排讀書、作業與作息。',
              lang: 'zh-Hant',
              start_url: './',
              scope: './',
              display: 'standalone',
              orientation: 'portrait',
              background_color: '#f2f2f7',
              theme_color: '#2563eb',
              icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
              globIgnores: ['ocr/**'],
              maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
              runtimeCaching: [
                {
                  // 文字辨識程式與語言模型：第一次下載後快取，之後可離線辨識
                  urlPattern: ({ url }) => url.pathname.includes('/ocr/') || url.hostname === 'cdn.jsdelivr.net',
                  handler: 'CacheFirst',
                  options: { cacheName: 'ocr-assets', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 180 } },
                },
              ],
            },
          }),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
    },
    test: {
      environment: 'node',
    },
  };
});
