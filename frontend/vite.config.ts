import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shared core package (Item Protocol types, deterministic SVG renderer) is the backend's own
// package, consumed here like an SDK so that what the validator solved is what the user sees
// (Doc 01 §4.6). Its single runtime dependency (zod) resolves from this project's node_modules.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cognimetric/core': path.resolve(__dirname, '../backend/core/src/index.ts'),
      zod: path.resolve(__dirname, 'node_modules/zod'),
    },
  },
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/v2': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } } },
});
