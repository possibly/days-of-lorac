import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const GAME_SERVER = 'http://127.0.0.1:8096';

/**
 * GitHub Pages serves a project site under /<repo>/, so the offline build needs
 * a base. Set VITE_BASE at build time; the game server build keeps '/'.
 */
const base = process.env.VITE_BASE ?? '/';

/** `@shared/*` -> `src/shared/*`, kept in sync with tsconfig `paths`. */
const sharedAlias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
};

export default defineConfig({
  base,
  root: 'src/client',
  plugins: [react()],
  resolve: {
    alias: sharedAlias,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: GAME_SERVER, changeOrigin: true },
      '/ws': { target: GAME_SERVER, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
