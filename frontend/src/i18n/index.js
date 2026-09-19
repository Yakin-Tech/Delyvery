import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ta from './locales/ta.json';
import ml from './locales/ml.json';
import kn from './locales/kn.json';
import te from './locales/te.json';
import hi from './locales/hi.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
];

// A user's language lives on their account, but the sign-in screen appears before
// anyone is signed in — so the last language used is also remembered on this device.
const STORAGE_KEY = 'delyver.language';

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.some((l) => l.code === stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

i18next
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ta: { translation: ta },
      ml: { translation: ml },
      kn: { translation: kn },
      te: { translation: te },
      hi: { translation: hi },
    },
    lng: readStoredLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

// Screen readers and browser translation tools read the page language from <html lang>.
function onLanguageChanged(lng) {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Storage can be unavailable (private browsing); the language still applies this session.
  }
}
onLanguageChanged(i18next.language);
i18next.on('languageChanged', onLanguageChanged);

export default i18next;
