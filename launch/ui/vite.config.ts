import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Served by createUiServer (src/ui/server.ts). Build order is
    // `vite build ui && tsc` — vite empties dist/ui first, tsc re-emits the
    // compiled server files alongside the SPA afterwards.
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Dev loop: `npm run dev:ui` against a running `launch ui` on 4400.
      '/api': 'http://127.0.0.1:4400',
    },
  },
});
