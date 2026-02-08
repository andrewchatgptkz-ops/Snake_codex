import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'esnext',
  },
});
