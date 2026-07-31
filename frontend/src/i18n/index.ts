import { createI18n } from 'vue-i18n';
import en from './en';
import sk from './sk';

const storedLocale = localStorage.getItem('locale');
const savedLocale = storedLocale === 'en' || storedLocale === 'sk' ? storedLocale : 'sk';

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'sk',
  messages: { sk, en },
});

export default i18n;
