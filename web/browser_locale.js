// Flutter 3.47 parses navigator.languages with Intl.Locale before app startup.
// POSIX tags such as en-US@posix (some Linux browsers) otherwise blank the app.
(() => {
  const original = Array.from(navigator.languages || []);
  const languages = [];
  let changed = original.length === 0;
  for (const tag of original) {
    try {
      new Intl.Locale(tag);
      languages.push(tag);
    } catch (_) {
      changed = true;
      // Recover the language/region, dropping only POSIX encoding/modifiers.
      const candidate = String(tag).split(/[.@]/, 1)[0].replace(/_/g, '-');
      try {
        languages.push(new Intl.Locale(candidate).toString());
      } catch (_) {
        // Ignore invalid preferences; other valid choices keep their order.
      }
    }
  }
  if (!changed) return;
  const normalized = Object.freeze(languages.length ? languages : ['en-US']);
  try {
    // Scope the compatibility fix to this page, preserving the browser's
    // prototype and valid preferences. No language or identity is transmitted.
    Object.defineProperty(navigator, 'languages', {
      configurable: true, get: () => normalized,
    });
  } catch (_) {
    // Some embedders may prohibit property overrides; leave their APIs intact.
  }
})();
