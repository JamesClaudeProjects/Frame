import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on any GitHub Pages path
// (https://<user>.github.io/<repo>/) without configuration.
export default defineConfig({
  plugins: [react()],
  base: './',
});
