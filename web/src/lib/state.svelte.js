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
// Theme follows the same rule for the same reason. A durable key saying this
// browser prefers dark on this domain is still a mark that this browser came
// here, so it lives and dies with the tab like the language does.
const THEME_KEY = 'theme';

export const ui = $state({ lang: 'bn', period: 'all', theme: 'system' });

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

/**
 * 'system' follows the operating system, and is the default because most people
 * have already made this choice once and do not want to make it again.
 */
export function restoreTheme() {
  try {
    const v = sessionStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') ui.theme = v;
  } catch { /* storage blocked: stay on system */ }
}

export function setTheme(theme) {
  ui.theme = theme;
  try { sessionStorage.setItem(THEME_KEY, theme); } catch { /* nothing to do */ }
}

/** What the toggle should switch to, resolving 'system' against the OS first. */
export function nextTheme() {
  const dark = ui.theme === 'dark'
    || (ui.theme === 'system' && typeof matchMedia !== 'undefined'
        && matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? 'light' : 'dark';
}
