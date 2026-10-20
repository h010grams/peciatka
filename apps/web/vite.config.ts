import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: мастер ставит приложение на главный экран и открывает сканер в одно касание
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Pečiatka',
        short_name: 'Pečiatka',
        description: 'Vernostné karty pre salóny',
        lang: 'sk',
        start_url: '/',
        display: 'standalone',
        background_color: '#fafaf9',
        theme_color: '#1c1917',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'Skener', url: '/scan' }],
      },
      workbox: {
        // API и файлы Wallet никогда не кешируем — только оболочку приложения
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    host: true, // доступ с телефона в той же Wi-Fi сети
    port: 5174,
    strictPort: true,
    allowedHosts: true, // для туннелей cloudflared/ngrok
    proxy: {
      // API на том же origin → cookie работают без CORS, как в продакшене
      '/api': 'http://localhost:3001',
    },
  },
});
