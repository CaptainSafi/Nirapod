<script>
  import { ui } from '$lib/state.svelte.js';
  import PageHead from '$lib/PageHead.svelte';
  import { strings } from '$lib/i18n.js';
  const bn = $derived(ui.lang === 'bn');
  const t = $derived(strings[ui.lang]);
</script>

<PageHead title={t.nav_method} description={t.meta_method} />

<h1>{bn ? 'পদ্ধতি ও তথ্যনীতি' : 'Methodology and data policy'}</h1>

<!-- Two sentences that have to survive being read alone, because a journalist
     or a sceptic will land here and read exactly this far. -->
<p class="standfirst">{t.not_authority}</p>
<p class="standfirst strong">{t.privacy_filter}</p>

<!-- The first thing on the page a reviewer opens, because everything below it
     describes how real data would be handled, and none of the numbers on this
     build are real. -->
<section class="demo-first">
  <h2>{bn ? 'এই সংস্করণের সব সংখ্যা কৃত্রিম' : 'Every number in this build is synthetic'}</h2>
  <p>{bn
    ? 'এটি একটি প্রদর্শনী সংস্করণ। মানচিত্রে যা দেখছেন তার কোনোটিই প্রকৃত ঘটনা নয়। ওয়ার্ড ও থানার নাম আসল, কিন্তু সংখ্যাগুলো কম্পিউটারে তৈরি করা। কোনো সংখ্যা উদ্ধৃত করবেন না, স্ক্রিনশট শেয়ার করলে সঙ্গে এই কথাটি বলুন।'
    : 'This is a demonstration build. Nothing on the map describes a real incident. The ward and thana names are real; the figures are generated. Do not cite any number from this site, and if you share a screenshot, say this alongside it.'}</p>
  <p>{bn
    ? 'সীমানার তথ্যসূত্র আসল (geoBoundaries), এবং নিচের নিয়মগুলোও আসল। প্রকৃত তথ্য এলে ঠিক এভাবেই প্রকাশ করা হবে।'
    : 'The boundaries are real (geoBoundaries), and so are the rules below. They are exactly how real data would be published.'}</p>
</section>

<h2>{bn ? 'আমরা কী সংগ্রহ করি' : 'What we collect'}</h2>
<p>{bn
  ? 'বিভাগ, ওয়ার্ড, সপ্তাহ, দিনের সময়ভাগ, পুলিশে জানানো হয়েছিল কি না, এবং না জানানোর কারণ। ব্যস।'
  : 'Category, ward, week, time of day, whether it was reported to the police, and if not, why. That is all.'}</p>

<h2>{bn ? 'আমরা যা দেখতে পাই না' : 'What we cannot see'}</h2>
<ul>
  <li>{bn ? 'আপনার আইপি ঠিকানা: কোথাও লেখা হয় না।' : 'Your IP address: never written to disk, at any layer.'}</li>
  <li>{bn ? 'আপনার অবস্থান: জিপিএস চাওয়া হয় না।' : 'Your location: the page never asks the browser for GPS.'}</li>
  <li>{bn ? 'নির্দিষ্ট তারিখ বা সময়: শুধু সপ্তাহ ও সময়ভাগ।' : 'An exact date or time: only the week and a broad time band.'}</li>
  <li>{bn ? 'কোনো লেখা বিবরণ: ফর্মে লেখার ঘরই নেই।' : 'Any written narrative: the form has no text box at all.'}</li>
  <li>{bn ? 'অ্যাকাউন্ট, ইমেইল, ফোন নম্বর: কিছুই নেই।' : 'An account, an email, a phone number: none exist.'}</li>
</ul>

<h2>{bn ? 'সীমা কীভাবে কাজ করে' : 'How the thresholds work'}</h2>
<p>{bn
  ? 'কোনো এলাকায় পাঁচটির কম রিপোর্ট থাকলে আমরা সংখ্যা দেখাই না, শূন্যও নয়, "পর্যাপ্ত তথ্য নেই" লেখা হয়। ছোট এলাকায় একটিমাত্র রিপোর্ট, শ্রেণি ও সময় জানা থাকলে যিনি ঘটনাটি ঘটিয়েছেন তিনি ভুক্তভোগীকে চিনে ফেলতে পারেন। পুলিশি অনিয়মের সীমা আরও বেশি।'
  : 'A cell with fewer than five reports shows "insufficient data", never a zero and never the count. In a small ward, one report with a category and a time window can identify the victim to the person who did it. The threshold for police misconduct is higher still.'}</p>
<p>{bn
  ? 'গুরুত্বপূর্ণ: চাপা দেওয়া সংখ্যাগুলো ব্রাউজারে পাঠানোই হয় না। সেগুলো ডেটাবেসেই আটকে যায়।'
  : 'Importantly, suppressed numbers are not sent to your browser and hidden there. They never leave the database.'}</p>

<h2>{bn ? 'দুই ধরনের সংখ্যা' : 'Two tiers, never merged'}</h2>
<p>{bn
  ? 'সংবাদমাধ্যমে প্রকাশিত ও আদালতের নথি থেকে নেওয়া রেকর্ড আলাদা করে দেখানো হয়, জনগণের পাঠানো রিপোর্ট আলাদা। দুটোর পার্থক্যটাই আসল তথ্য।'
  : 'Records seeded from published journalism and court listings are counted separately from what people tell us. The gap between the two is the actual finding, so they are never added into one number.'}</p>
<p class="warn">{bn
  ? 'জনগণের পাঠানো প্রতিটি রিপোর্ট অযাচাইকৃত। আমরা সেগুলো যাচাই করি না, করতেও পারি না।'
  : 'Every crowd report is unverified. We do not and cannot verify them individually.'}</p>

<h2>{bn ? 'পক্ষপাত' : 'Known bias'}</h2>
<p>{bn
  ? 'বীজ তথ্য সংবাদমাধ্যম থেকে আসে, আর সংবাদমাধ্যমের নজর ঢাকায় বেশি, গ্রামে কম। তাই কাঁচা সংখ্যার পাশাপাশি জনসংখ্যা-অনুপাতে হিসাবও দেখানো হয়।'
  : 'Seed data inherits media bias: Dhaka is over-covered, rural areas under-covered. We show per-capita figures alongside raw counts so the map does not simply say "Dhaka is dangerous" when it means "journalists and smartphones are in Dhaka".'}</p>

<h2>{bn ? 'বন্যা ঠেকানো' : 'How we resist flooding'}</h2>
<p>{bn
  ? 'প্রতিটি রিপোর্ট পাঠানোর আগে ব্রাউজারে কিছু হিসাব করতে হয়। একজন মানুষের জন্য এক সেকেন্ড, দশ হাজার ভুয়া রিপোর্টের জন্য অসম্ভব ব্যয়বহুল। কোনো ক্যাপচা নেই, কারণ ক্যাপচা মানে তৃতীয় একটি প্রতিষ্ঠান আপনাকে দেখছে।'
  : 'Every submission costs about a second of arithmetic in your browser: trivial for one honest person, prohibitive for ten thousand fake ones. There is no captcha, because a captcha means a third party watching this page. Rate-limit buckets are keyed on a salted hash whose salt is discarded weekly, so the linkage expires by design.'}</p>

<h2>{bn ? 'কিছুই সঙ্গে সঙ্গে প্রকাশ হয় না' : 'Nothing publishes instantly'}</h2>
<p>{bn
  ? 'রিপোর্ট প্রতি ৩০ মিনিটে একসঙ্গে প্রকাশ করা হয়, এবং সন্দেহজনক বা স্পর্শকাতর রিপোর্ট আগে মানুষ দেখে। সঙ্গে সঙ্গে প্রকাশ করলে কেউ রিপোর্ট পাঠিয়ে মানচিত্র দেখে বুঝে ফেলতে পারত কোন রিপোর্টটি কার।'
  : 'Reports publish in a batch every 30 minutes, and anything sensitive is screened by a person first. Instant publication would let someone submit a report, refresh the map, and see which cell moved.'}</p>

<h2>{bn ? 'সূত্র' : 'Sources'}</h2>
<p>{bn ? 'ওয়ার্ড ও থানার সীমানা: ' : 'Ward and thana boundaries: '}
  <a href="https://www.geoboundaries.org/">geoBoundaries</a> (gbOpen BGD ADM3/ADM4), CC-BY 4.0.</p>

<h2>{bn ? 'সংশোধনের অনুরোধ' : 'Corrections and disputes'}</h2>
<p>{bn
  ? 'এখানে নাম উল্লেখ করা যেকোনো প্রতিষ্ঠান কোনো সংখ্যা নিয়ে আপত্তি জানাতে পারে। আপত্তি ও তার নিষ্পত্তি প্রকাশ্যে রাখা হয়।'
  : 'Any institution named here can dispute a figure. Disputes and their resolutions are published.'}</p>

<style>
  .standfirst { color: var(--ink); max-width: 46rem; margin: .2rem 0 .6rem; }
  .standfirst.strong { font-weight: 700; border-left: 2px solid var(--accent);
                       padding-left: .8rem; color: var(--ink); }
  h2 { margin-top: 1.8rem; }
  .demo-first { border: 1px solid var(--warn); border-radius: 10px;
    padding: .2rem 1rem 1rem; margin: 1rem 0 2rem; }
  .demo-first h2 { color: var(--warn); margin-top: 1rem; }
  p, li { color: #cdd5dd; }
  .warn { color: var(--warn); }
  a { color: var(--accent); }
</style>
