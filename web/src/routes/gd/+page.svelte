<script>
  import { ui } from '$lib/state.svelte.js';
  import PageHead from '$lib/PageHead.svelte';
  import { strings } from '$lib/i18n.js';
  const bn = $derived(ui.lang === 'bn');
  const t = $derived(strings[ui.lang]);
</script>

<PageHead title={t.nav_help} description={t.meta_gd} />

<!-- Practical utility. Most visitors have not been mugged; they arrived
     because they are worried. A site that only collects reports serves the
     minority. This page serves everyone who lands here. -->
<h1>{bn ? 'জিডি কীভাবে করবেন' : 'How to file a GD'}</h1>

<ol>
  <li>{bn
    ? 'ঘটনাস্থল যে থানার এলাকায়, সেই থানায় যান। যেকোনো থানা সাধারণ ডায়েরি নিতে বাধ্য।'
    : 'Go to the thana whose area covers where it happened. Any thana is obliged to record a General Diary.'}</li>
  <li>{bn
    ? 'দুই কপি লিখুন: কী, কোথায়, কখন, কারা। সঙ্গে জাতীয় পরিচয়পত্রের কপি রাখুন।'
    : 'Write two copies: what, where, when, who. Bring a copy of your NID.'}</li>
  <li>{bn
    ? 'ডিউটি অফিসারের স্বাক্ষর ও জিডি নম্বরসহ একটি কপি অবশ্যই ফেরত নিন। এটিই আপনার প্রমাণ।'
    : 'Insist on getting one copy back, signed, with the GD number on it. That copy is your proof.'}</li>
  <li>{bn ? 'অনলাইনেও করা যায়: ' : 'It can also be done online: '}
    <a href="https://gd.police.gov.bd/">gd.police.gov.bd</a></li>
</ol>

<h2>{bn ? 'যদি জিডি নিতে অস্বীকার করে' : 'If they refuse to take it'}</h2>
<ol>
  <li>{bn ? 'অস্বীকার করার কারণ জিজ্ঞাসা করুন এবং কর্মকর্তার নাম ও পদ লিখে রাখুন।'
          : 'Ask for the reason, and write down the officer’s name and rank.'}</li>
  <li>{bn ? 'ওসি বরাবর লিখিত অভিযোগ দিন; তারপর সংশ্লিষ্ট ডিসি অফিসে।'
          : 'Submit a written complaint to the OC, then to the DC’s office.'}</li>
  <li>{bn ? 'জাতীয় মানবাধিকার কমিশনে অভিযোগ করা যায়: ' : 'You can complain to the National Human Rights Commission: '}
    <a href="http://www.nhrc.org.bd/">nhrc.org.bd</a></li>
  <li>{bn ? 'আইনগত সহায়তা (সরকারি, বিনামূল্যে): জাতীয় আইনগত সহায়তা সংস্থা: ১৬৪৩০'
          : 'Free legal aid: National Legal Aid Services Organisation: call 16430.'}</li>
</ol>

<h2>{bn ? 'জরুরি নম্বর' : 'Emergency numbers'}</h2>
<!-- tel: links, because most people reading this are on a phone and the point
     of the number is to be dialled, not read. -->
<ul class="nums">
  <li><a class="call" href="tel:999"><b>999</b></a>
      {bn ? 'জাতীয় জরুরি সেবা' : 'National emergency'}</li>
  <li><a class="call" href="tel:16430"><b>16430</b></a>
      {bn ? 'আইনগত সহায়তা (বিনামূল্যে)' : 'Legal aid (free)'}</li>
  <li><a class="call" href="tel:109"><b>109</b></a>
      {bn ? 'নারী ও শিশু নির্যাতন প্রতিরোধ' : 'Violence against women and children'}</li>
</ul>

<p class="note">{bn
  ? 'এই সাইটে রিপোর্ট করা জিডি করার বিকল্প নয়। আমরা কোনো কর্তৃপক্ষকে কিছু জানাই না। জানানোর মতো তথ্যও আমাদের কাছে নেই।'
  : 'Reporting here is not a substitute for filing a GD. We do not forward anything to any authority, and we hold nothing that could be forwarded.'}</p>

<style>
  h2 { margin-top: 1.8rem; }
  li { color: var(--ink); margin: .35rem 0; }
  a { color: var(--accent); }
  .nums { list-style: none; padding: 0; }
  .nums li { display: flex; align-items: baseline; gap: .7rem; margin: .5rem 0; }
  .call {
    display: inline-block; text-decoration: none; color: var(--accent);
    border: 1px solid var(--line); border-radius: 999px;
    padding: .3rem .9rem; min-width: 5.5rem; text-align: center;
  }
  .call:hover { border-color: var(--accent); }
  .nums b { font-size: 1.05rem; }
  .note { color: var(--dim); font-size: .88rem; border-left: 2px solid var(--line); padding-left: .8rem; margin-top: 1.5rem; }
</style>
