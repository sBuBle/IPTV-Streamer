import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: {
    // hls.js (~580 kB) is a single library loaded only when a stream plays;
    // every page is split into its own chunk.
    chunkSizeWarningLimit: 600,
  },
});
