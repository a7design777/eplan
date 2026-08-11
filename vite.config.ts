import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Worker роздає зібраний фронтенд через binding ASSETS, див. wrangler.jsonc.
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // У dev фронтенд ходить у Worker, піднятий `wrangler dev` на 8787.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
