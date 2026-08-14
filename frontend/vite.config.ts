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
  // Pre-bundle every Vuetify component the app uses. The dep scanner cannot see
  // through the vuetify autoImport transform, so on a cold cache (CI always)
  // each first browser visit to a page triggers "new dependencies optimized →
  // reloading" mid-session, which reverts in-flight UI state — and with two
  // Playwright workers a discovery in one worker reloads the other worker's
  // page mid-interaction (this failed idea-lifecycle on CI both ways: a reload
  // swallowed the detail-page navigation, and a VTooltip discovery from the
  // parallel rbac test wiped the submit form). List sourced from the CI vite
  // dep-discovery log; add an entry whenever a page introduces a new component.
  optimizeDeps: {
    include: [
      'vuetify/components/VAlert',
      'vuetify/components/VApp',
      'vuetify/components/VAppBar',
      'vuetify/components/VBtn',
      'vuetify/components/VBtnToggle',
      'vuetify/components/VCard',
      'vuetify/components/VCheckbox',
      'vuetify/components/VChip',
      'vuetify/components/VCombobox',
      'vuetify/components/VDataTable',
      'vuetify/components/VDialog',
      'vuetify/components/VDivider',
      'vuetify/components/VForm',
      'vuetify/components/VGrid',
      'vuetify/components/VIcon',
      'vuetify/components/VList',
      'vuetify/components/VMain',
      'vuetify/components/VNavigationDrawer',
      'vuetify/components/VProgressCircular',
      'vuetify/components/VSelect',
      'vuetify/components/VSnackbar',
      'vuetify/components/VSwitch',
      'vuetify/components/VTextField',
      'vuetify/components/VTextarea',
      'vuetify/components/VTimeline',
      'vuetify/components/VToolbar',
      'vuetify/components/VTooltip',
    ],
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
