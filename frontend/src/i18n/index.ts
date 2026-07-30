import { createI18n } from 'vue-i18n';
import en from './en';
import sk from './sk';

const savedLocale = localStorage.getItem('locale') || 'sk';

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'sk',
  messages: { sk, en },
});

export default i18n;
