import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GitHub Pages serves a project site under /<repo>/, so the deployed build needs
 * a base. Set VITE_BASE at build time; local builds keep '/'.
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
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
