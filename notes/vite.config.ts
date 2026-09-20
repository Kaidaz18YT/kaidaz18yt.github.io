import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// './' makes asset paths relative, so the build works at any GitHub Pages
// sub-path (https://user.github.io/repo/). Override with VITE_BASE if you
// ever move to a custom domain, e.g. VITE_BASE=/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
});
