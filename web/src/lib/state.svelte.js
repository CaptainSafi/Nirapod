// Shared UI state.
//
// LANGUAGE PERSISTENCE, AND WHY IT IS sessionStorage.
// The original rule here was that nothing about the visitor is stored: no key
// that would survive the session and mark this browser as one that reads a site
// about police misconduct and extortion. That rule is right, and it is kept.
//
// But it also meant an English reader was thrown back to Bangla on every
// reload, which is a real cost paid by every visit. sessionStorage settles it:
// the choice survives reloads and moving between pages, and it is gone when the
// tab closes. Nothing persists on the device afterwards.
//
// If you ever decide the convenience is worth a durable trace, this is the one
// line to change — and it belongs in the threat model first, not in a commit.
const KEY = 'lang';

export const ui = $state({ lang: 'bn', period: 'all' });

/** Read the remembered choice. Called on mount: SSR has no sessionStorage. */
export function restoreLang() {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === 'en' || v === 'bn') ui.lang = v;
  } catch { /* private mode or storage blocked: stay with the default */ }
}

export function setLang(lang) {
  ui.lang = lang;
  try { sessionStorage.setItem(KEY, lang); } catch { /* nothing to do */ }
}
