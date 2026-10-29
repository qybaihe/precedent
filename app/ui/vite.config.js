import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves Custom UI from its own CDN path, so every asset URL must be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../static/ui', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 800 },
});
