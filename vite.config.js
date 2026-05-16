import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 開発環境（ローカルホスト）かどうかを判定
  const isDev = mode === 'development';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true
        },
        manifest: {
          // 開発環境の場合は「Dev」をつけて区別する
          name: isDev ? 'FocusFlow Dev' : 'FocusFlow',
          short_name: isDev ? 'Focus Dev' : 'FocusFlow',
          description: 'シンプルで使いやすいポモドーロタイマー',
          theme_color: '#2b2b2b',
          background_color: '#2b2b2b',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
  }
})