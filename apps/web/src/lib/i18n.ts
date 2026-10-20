import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LOCALES, type Locale } from '@peciatka/shared';
import sk from '../i18n/sk.json';
import en from '../i18n/en.json';
import uk from '../i18n/uk.json';

const STORAGE_KEY = 'locale';

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage недоступен (приватный режим) — не страшно
  }
  const nav = navigator.language.slice(0, 2);
  if (nav === 'uk' || nav === 'ru') return 'uk';
  if (nav === 'en') return 'en';
  return 'sk';
}

void i18n.use(initReactI18next).init({
  resources: { sk: { translation: sk }, en: { translation: en }, uk: { translation: uk } },
  lng: detectLocale(),
  fallbackLng: 'sk',
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

document.documentElement.lang = i18n.language;

/** Дата в часовом поясе салона (по умолчанию Bratislava). */
export function formatDate(iso: string, timeZone = 'Europe/Bratislava') {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone }).format(new Date(iso));
}

export default i18n;
