import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev, proxy /api to the API container so the frontend never needs to
    // know a host. In production Traefik does the same job.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split vendor code so a change to app code doesn't bust the whole
        // bundle in users' caches — matters on slow connections.
        manualChunks: { vendor: ['react', 'react-dom'] },
      },
    },
  },
});
