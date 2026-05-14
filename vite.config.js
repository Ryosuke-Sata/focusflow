import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true // 開発環境(localhost)でもインストールテストを可能にする
      },
      manifest: {
        name: 'FocusFlow',
        short_name: 'FocusFlow',
        description: 'FocusFlow - Pomodoro Timer',
        theme_color: '#1e1e1e',
        background_color: '#1e1e1e',
        display: 'standalone', // ブラウザのUIを隠してアプリ化する
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
})