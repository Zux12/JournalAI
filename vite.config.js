import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  resolve: {
    // Ensure one React runtime in the bundle
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    // Keep React in a single pre-bundle; avoid pulling docx/CSL into the pre-bundle graph
    include: ['react', 'react-dom'],
    exclude: ['docx', '@citation-js/core', '@citation-js/plugin-csl'],
  },
  build: {
    outDir: 'dist',
  },
});
