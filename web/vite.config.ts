import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the same build works at ace-coderr.github.io/gavelock/, at a site root, and from an
// on-chain container. Routing is hash-based for the same reason, so no server rewrites are needed.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Fonts and other assets are emitted as files next to the bundle; nothing is fetched from a CDN.
    assetsInlineLimit: 0,
  },
});
