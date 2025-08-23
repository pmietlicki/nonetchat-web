let currentLang = 'en';
let translations: Record<string, any> = {};

export async function initI18n(lang: string = 'en') {
  currentLang = lang;
  try {
    const res = await fetch(`/locales/${lang}/translation.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load translations: ${res.status}`);
    translations = await res.json();
  } catch (e) {
    console.warn('i18n: unable to load translations, falling back to keys.', e);
    translations = {};
  }
}

export function setLanguage(lang: string) {
  return initI18n(lang);
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