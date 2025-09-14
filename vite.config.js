import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  resolve: {
    // Ensure one React runtime; no manual aliasing
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    // keep heavy libs out of prebundle graph
    exclude: ['docx', '@citation-js/core', '@citation-js/plugin-csl'],
  },
  build: { outDir: 'dist' }
});
