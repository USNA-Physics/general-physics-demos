import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@courses': path.resolve(__dirname, 'src/courses'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          plotly: ['plotly.js-basic-dist-min', 'react-plotly.js'],
          katex: ['katex', 'react-katex'],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
