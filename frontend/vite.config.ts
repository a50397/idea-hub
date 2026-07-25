/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    // Precompile the locale catalogs so the runtime-only vue-i18n build (kept
    // for CSP: no unsafe-eval) can resolve them. Skipped in vitest, where the
    // i18n tests import the raw TS message objects and use the full build.
    ...(mode === 'test'
      ? []
      : [
          VueI18nPlugin({
            include: [
              fileURLToPath(new URL('./src/i18n/en.ts', import.meta.url)),
              fileURLToPath(new URL('./src/i18n/sk.ts', import.meta.url)),
            ],
          }),
        ]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'vue-i18n': 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js',
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    // Inline Vuetify so its component `.css` side-effect imports are transformed
    // by Vite instead of hitting Node's native (CSS-unaware) module loader.
    server: {
      deps: {
        inline: ['vuetify'],
      },
    },
    alias: {
      'vue-i18n': 'vue-i18n/dist/vue-i18n.esm-bundler.js',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}));
