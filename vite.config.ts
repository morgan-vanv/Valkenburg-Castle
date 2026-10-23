import { defineConfig } from 'vite';

// Relative base so the build works at any path:
// morgan-vanv.github.io/Valkenburg-Castle/ today, a subpath of morganvanv.com later.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
