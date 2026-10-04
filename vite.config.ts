import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022', // top-level await in src/main.ts
  },
});
