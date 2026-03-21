import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
