import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import manifest from './manifest.json';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'index.html'),
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        providerSettings: resolve(__dirname, 'provider-settings.html'),
      },
    },
  },
});
