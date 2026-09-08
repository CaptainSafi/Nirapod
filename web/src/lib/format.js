// Bangla numerals are not decoration. A site that says "৫ রিপোর্ট" in Bangla
// and "5 reports" in English is one site; a site that shows Western digits
// inside Bangla text reads as a translation of something foreign.
const BN = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];

export function num(n, lang) {
  if (n === null || n === undefined) return lang === 'bn' ? 'নেই' : 'none';
  const s = String(n);
  return lang === 'bn' ? s.replace(/[0-9]/g, d => BN[+d]) : s;
}

export function pct(x, lang) {
  if (x === null || x === undefined) return lang === 'bn' ? 'নেই' : 'none';
  return num(Math.round(x * 100), lang) + '%';
}

/** Monday of the week containing d, as YYYY-MM-DD. */
export function mondayOf(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export function recentWeeks(n = 8) {
  const out = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - 7 * i);
    out.push(mondayOf(d));
  }
  return out;
}

export function weekLabel(iso, lang) {
  const d = new Date(iso + 'T00:00:00Z');
  const months = lang === 'bn'
    ? ['জানু','ফেব্রু','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্ট','অক্টো','নভে','ডিসে']
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${num(d.getUTCDate(), lang)} ${months[d.getUTCMonth()]}`;
}
