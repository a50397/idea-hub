import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import sk from './locales/sk.json';

export type MessageSchema = typeof en;

const i18n = createI18n<[MessageSchema], 'en' | 'sk'>({
  legacy: false,
  locale: localStorage.getItem('language') || 'en',
  fallbackLocale: 'en',
  messages: {
    en,
    sk,
  },
});

export default i18n;
