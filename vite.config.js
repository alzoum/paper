import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built app works at any address, including
  // GitHub Pages' https://alzoum.github.io/paper/.
  base: './',
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  server: { host: true },
});
