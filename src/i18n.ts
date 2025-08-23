// Liste des langues supportées (classées par notoriété mondiale)
export const SUPPORTED_LANGUAGES = [
  // Langues les plus parlées et internationales
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  
  // Langues européennes importantes
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  
  // Autres langues asiatiques et régionales
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' }
];

let currentLang = 'en';
let translations: Record<string, any> = {};

// Système d'événements pour notifier les changements de langue
type LanguageChangeListener = (newLang: string) => void;
const languageChangeListeners: LanguageChangeListener[] = [];

export function onLanguageChange(listener: LanguageChangeListener): () => void {
  languageChangeListeners.push(listener);
  // Retourne une fonction de nettoyage
  return () => {
    const index = languageChangeListeners.indexOf(listener);
    if (index > -1) {
      languageChangeListeners.splice(index, 1);
    }
  };
}

function notifyLanguageChange(newLang: string) {
  languageChangeListeners.forEach(listener => listener(newLang));
}

// Détecte la langue préférée du navigateur
export function detectBrowserLanguage(): string {
  const savedLang = localStorage.getItem('preferredLanguage');
  if (savedLang && SUPPORTED_LANGUAGES.some(lang => lang.code === savedLang)) {
    return savedLang;
  }

  // Détection basée sur navigator.language et navigator.languages
  const browserLangs = [navigator.language, ...(navigator.languages || [])];
  
  for (const browserLang of browserLangs) {
    // Correspondance exacte
    const exactMatch = SUPPORTED_LANGUAGES.find(lang => lang.code === browserLang);
    if (exactMatch) return exactMatch.code;
    
    // Correspondance par code de langue principal (ex: 'fr-FR' -> 'fr')
    const langCode = browserLang.split('-')[0];
    const langMatch = SUPPORTED_LANGUAGES.find(lang => lang.code === langCode);
    if (langMatch) return langMatch.code;
  }
  
  // Fallback vers l'anglais
  return 'en';
}

export async function initI18n(lang?: string) {
  const targetLang = lang || detectBrowserLanguage();
  currentLang = targetLang;
  
  try {
    const res = await fetch(`/locales/${targetLang}/translation.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load translations: ${res.status}`);
    translations = await res.json();
    
    // Sauvegarde la langue choisie
    localStorage.setItem('preferredLanguage', targetLang);
  } catch (e) {
    console.warn('i18n: unable to load translations, falling back to keys.', e);
    translations = {};
  }
}

export async function setLanguage(lang: string) {
  localStorage.setItem('preferredLanguage', lang);
  await initI18n(lang);
  notifyLanguageChange(lang);
}

function getByPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

export function getCurrentLanguage(): string {
  return currentLang;
}

export function t(key: string, vars?: Record<string, any>): string {
  const raw = getByPath(translations, key);
  const str = typeof raw === 'string' ? raw : key; // fallback to key
  if (!vars) return str;
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}