import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/capacitor',
  plugins: [react()],
  build: {
    outDir: '../../dist-capacitor',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // Allow imports from src/renderer to work from the capacitor entry
      '../renderer': '../renderer',
    },
  },
});
