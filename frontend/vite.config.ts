/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { generateJSON } from '@intlify/bundle-utils';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { resolve, dirname } from 'node:path';

const i18nLocaleDir = resolve(dirname(fileURLToPath(import.meta.url)), 'src/i18n');
const virtualPrefix = '\0i18n-compiled:';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    {
      name: 'vue-i18n-locale-precompiler',
      enforce: 'pre',
      resolveId(id, importer) {
        if (!id.endsWith('.json') || !importer) return;
        const resolved = resolve(dirname(importer), id);
        if (resolved.startsWith(i18nLocaleDir)) {
          return virtualPrefix + resolved.slice(0, -5); // strip .json
        }
      },
      load(id) {
        if (!id.startsWith(virtualPrefix)) return;
        const filePath = id.slice(virtualPrefix.length) + '.json';
        const src = readFileSync(filePath, 'utf8');
        const { code, map } = generateJSON(src, {
          type: 'plain',
          sourceMap: true,
          jit: false,
          env: 'production',
          strictMessage: false,
        });
        return { code, map };
      },
    },
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
    alias: {
      'vue-i18n': 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js',
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
});
