import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/index.js',
        assetFileNames: ({ name }) => {
          if (/\.(css|scss)$/.test(name ?? '')) {
            return 'assets/index.css';
          }
          return 'assets/[name].[ext]';
        },
      },
    },
  },
})
