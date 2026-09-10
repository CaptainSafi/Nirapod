#!/usr/bin/env node
// inspect.js — look at what is actually in the database, from a terminal.
//
//   DATABASE_URL='postgres://nirapod_moderator:...' node server/inspect.js
//   DATABASE_URL='...' node server/inspect.js --accounts
//   DATABASE_URL='...' node server/inspect.js --delete <uuid>
//
// There is no moderation screen yet, and there will not be one for a while.
// This is the interim: enough to see the queue, read the accounts that are
// live, and take one down. It is a CLI on purpose. A web moderation panel is a
// second public surface to secure, and this needs none.
//
// Use the MODERATOR credential. The owner works too but there is no reason to
// use it for reading.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }

const args = process.argv.slice(2);
const client = new pg.Client({ connectionString: url });
await client.connect();

const del = args.indexOf('--delete');
if (del !== -1) {
  const id = args[del + 1];
  if (!id) { console.error('--delete needs a uuid'); process.exit(2); }
  const r = await client.query(`DELETE FROM reports WHERE id = $1 RETURNING id`, [id]);
  console.log(r.rowCount ? `deleted ${id}` : `no report with id ${id}`);
  await client.end();
  process.exit(0);
}

const counts = (await client.query(`
  SELECT status, count(*)::int n FROM reports GROUP BY status ORDER BY status`)).rows;
console.log('\nREPORTS BY STATUS');
if (!counts.length) console.log('  (none)');
for (const c of counts) console.log(`  ${String(c.n).padStart(5)}  ${c.status}`);

const acc = (await client.query(`
  SELECT account_state, count(*)::int n FROM reports
   WHERE account IS NOT NULL GROUP BY account_state ORDER BY account_state`)).rows;
console.log('\nWRITTEN ACCOUNTS BY STATE');
if (!acc.length) console.log('  (none)');
for (const a of acc) console.log(`  ${String(a.n).padStart(5)}  ${a.account_state}`);

// The newest rows, with the fields that matter for checking the pipeline: the
// day IS stored, the week is what publishes, and the account is whatever
// survived redaction. Nothing here is an identifier.
const rows = (await client.query(`
  SELECT r.id, r.status, r.category, r.subcategory, r.ward_id, w.name_en AS ward,
         r.occurred_week, r.occurred_on, r.occurred_time, r.time_band,
         r.account, r.account_state, r.account_flags, r.submitted_day
    FROM reports r JOIN wards w ON w.id = r.ward_id
   ORDER BY r.submitted_day DESC, r.id DESC
   LIMIT ${args.includes('--accounts') ? 20 : 5}`)).rows;

console.log('\nMOST RECENT');
for (const r of rows) {
  console.log(`\n  ${r.id}`);
  console.log(`    ${r.category}/${r.subcategory}  ward ${r.ward_id} (${r.ward})  [${r.status}]`);
  console.log(`    week ${r.occurred_week?.toISOString?.().slice(0,10) ?? r.occurred_week}` +
              `   day ${r.occurred_on?.toISOString?.().slice(0,10) ?? r.occurred_on ?? '(none)'}` +
              `   time ${r.occurred_time ?? '(none)'}   band ${r.time_band}`);
  if (r.account) {
    console.log(`    account [${r.account_state}, ${r.account_flags} flags]:`);
    console.log(`      ${r.account.replace(/\n/g, '\n      ')}`);
  }
}
console.log('');
await client.end();
