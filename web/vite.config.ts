/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src')
    }
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      // PX4 telemetry, drone POV feed, and vision events all proxy through
      // the FastAPI backend, which in turn multiplexes from the VM.
      '/ws/px4': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true
      },
      '/ws/pov': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true
      },
      '/ws/vision': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true
      },
      '/ws/live': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8765',
        ws: true
      }
    }
  },
});