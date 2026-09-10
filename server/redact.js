// redact.js — what happens to a written account before it is stored.
//
// This runs on the SERVER, before the INSERT. The browser warns as you type,
// which is the kind thing to do, but a warning in a page is advice: anyone can
// post straight at the endpoint. So the browser's job is to help an honest
// reporter, and this file's job is to be the actual rule.
//
// ONLY THE REDACTED TEXT IS STORED. The original is not kept alongside it, not
// in a column, not in a log. The whole point of removing a phone number is that
// it should not exist to be seized later, and a "raw" copy for moderators to
// check against would defeat that entirely.
//
// WHAT THIS IS NOT. It is a format filter. It reliably catches things with a
// shape: numbers, addresses, links. It cannot catch "the SI at the outpost near
// my shop", which is the sentence that actually identifies people, and no
// regular expression ever will. That is what the moderation state is for, and
// why an account is not published the moment it arrives.

const MAX = 600;
const MARK = '[সরানো হয়েছে]';

// Built fresh per call. A /g regex carries lastIndex between uses, and a shared
// one silently skips matches on the second string it sees.
function rules() {
  // ORDER MATTERS, and getting it wrong is not obvious from the output.
  // Links and emails first, because both contain digit runs that the number
  // rule would otherwise chew a hole in. Then unbroken digit runs, because a
  // 13-digit NID starts with something the phone rule happily matches ten
  // digits of, leaving the last three sitting in the text. Separated phone
  // numbers last, since by then nothing else can claim them.
  return [
    { name: 'link', re: /\b(?:https?:\/\/|www\.)\S+/gi },
    { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
    // NID (10, 13 or 17 digits), an unseparated mobile number, an account
    // number. Deliberately blunt: a long digit run in a crime report is rarely
    // innocent, and a false positive costs a reader nothing.
    { name: 'number', re: /\b\d{9,18}\b/g },
    // What is left: a mobile number written with spaces, dashes or a country
    // code. [\s-]* rather than [\s-]? after the country code, because people
    // write "+880 1712" and the single-character version left the +880 behind.
    { name: 'phone', re: /(?:\+?88[\s-]*)?0?[\s-]*1[3-9](?:[\s-]?\d){8}/g },
  ];
}

// Zero-width, soft hyphen and bidi controls, as escapes so this file has no
// invisible characters of its own. One of these placed between two digits walks
// a phone number straight past every rule above, so they come out first.
const INVISIBLE = new RegExp('[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u00AD\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u2064\uFEFF]', 'g');

/**
 * Returns { text, removed, changed }.
 * `removed` names the KINDS that were taken out, so the reporter can be told
 * what happened to their words. Never the values themselves.
 */
export function redact(input) {
  if (typeof input !== 'string') return { text: null, removed: [], changed: false };

  // Normalise first, so the rules see the string a reader would see. Full-width
  // and compatibility digits are a trivial way past a naive pattern.
  let text = input.normalize('NFKC').replace(INVISIBLE, '');

  // Bangla digits are digits. Fold them so the number rules see both scripts.
  const BN = '০১২৩৪৫৬৭৮৯';
  text = text.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

  const removed = [];
  for (const rule of rules()) {
    if (rule.re.test(text)) {
      removed.push(rule.name);
      rule.re.lastIndex = 0;
      text = text.replace(rule.re, MARK);
    }
  }

  // Collapse the whitespace someone used to shape a paragraph, and any run of
  // markers left where one number was written three different ways.
  const esc = MARK.replace(/[[\]]/g, '\\$&');
  text = text.replace(new RegExp(esc + '(\\s*' + esc + ')+', 'g'), MARK)
             .replace(/[ \t]+/g, ' ')
             .replace(/\n{3,}/g, '\n\n')
             .trim();

  if (text.length > MAX) text = text.slice(0, MAX).trim();

  return {
    text: text.length ? text : null,
    removed,
    changed: text !== input.trim(),
  };
}

export const ACCOUNT_MAX = MAX;
