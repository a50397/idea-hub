import { createI18n } from 'vue-i18n';
import en from './en';
import sk from './sk';

const savedLocale = localStorage.getItem('locale') || 'en';

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, sk },
});

export default i18n;
