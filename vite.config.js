import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'renderer/dist'),
    emptyOutDir: true,
    // Mantém nomes legíveis no stack de erro do React (evita só "at main")
    minify: false,
    sourcemap: true,
    // Nome FIXO — nunca mais index-HASH.js fantasma (ex.: 7F4QwPd2) preso em cache
    rollupOptions: {
      output: {
        entryFileNames: 'assets/sigma-app.js',
        chunkFileNames: 'assets/sigma-[name].js',
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith('.css')) return 'assets/sigma-app.css';
          return 'assets/[name][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer/src'),
    },
  },
});
