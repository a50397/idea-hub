// Shared mounting harness for component/store tests.
// NOTE: this file does not match the vitest `*.test.ts` include glob, so it is
// treated purely as a helper module and never executed as its own suite.
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { createI18n, type I18n } from 'vue-i18n';
import type { VueWrapper } from '@vue/test-utils';
import en from '../i18n/en';
import sk from '../i18n/sk';

// Fresh i18n per mount, using the real locale files (en + sk).
export function createTestI18n(locale = 'en'): I18n {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, sk },
  });
}

// Fresh Vuetify instance per mount with all components + directives registered.
export function createTestVuetify() {
  return createVuetify({ components, directives });
}

// Find the first element matching `selector` whose trimmed text equals `text`.
export function findByText(wrapper: VueWrapper, selector: string, text: string) {
  return wrapper.findAll(selector).find((w) => w.text().trim() === text);
}

// Click the first element matching `selector` whose trimmed text equals `text`.
export async function clickByText(wrapper: VueWrapper, selector: string, text: string) {
  const el = findByText(wrapper, selector, text);
  if (!el) throw new Error(`No "${selector}" element found with text "${text}"`);
  await el.trigger('click');
}
