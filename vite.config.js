import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, 'client'),
  // Only VITE_* variables are exposed to the browser; SMTP settings never are.
  envDir: root,
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.join(root, 'shared') },
  },
  server: {
    fs: { allow: [root] },
  },
  build: {
    outDir: path.join(root, 'dist', 'client'),
    emptyOutDir: true,
  },
});
