// Language and time-of-day live in the URL-free client state. Nothing about
// the visitor is stored: no localStorage key that would survive the session and
// mark this browser as one that reads this site.
export const ui = $state({ lang: 'bn', period: 'all' });
export const t = (k) => strings[ui.lang][k] ?? k;
import { strings } from './i18n.js';
