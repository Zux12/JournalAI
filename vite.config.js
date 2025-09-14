import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    // Don't prebundle these into a separate graph that could pull a second React
    exclude: ['docx', '@citation-js/core', '@citation-js/plugin-csl'],
    include: ['react', 'react-dom']
  },
  build: {
    outDir: 'dist'
  }
});
