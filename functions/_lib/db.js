// db.js — one Neon connection per request, over HTTP.
//
// The Node server holds a pool. A Worker cannot: it may be created and
// destroyed between two requests from the same person. @neondatabase/serverless
// speaks to Neon's HTTP endpoint instead of holding a socket, which is what
// makes Postgres usable from the edge at all.
//
// USE THE POOLED CONNECTION STRING here (the host with -pooler in it). Direct
// connections from a Worker exhaust Postgres' connection slots quickly, because
// there is no long-lived process to reuse one.
import { neon } from '@neondatabase/serverless';

/**
 * Returns something with the same .query(text, params) -> { rows } shape the
 * rest of the codebase already speaks, so validate.js, rules.js and the SQL in
 * these handlers are identical to the Node server's.
 */
export function connect(env) {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured for this environment');
  const sql = neon(url);
  return {
    async query(text, params = []) {
      return { rows: await sql.query(text, params) };
    },
  };
}
