import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: __dirname,
  envDir: '..',
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // In development the browser talks to the game server through Vite (same origin).
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/health': { target: `http://localhost:${serverPort}` },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/health': { target: `http://localhost:${serverPort}` },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
});
