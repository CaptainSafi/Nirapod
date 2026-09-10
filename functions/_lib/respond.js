// respond.js — every response this API gives.
//
// No CORS headers anywhere on purpose: the form is served from this origin and
// nothing else has any business posting to it. Adding Access-Control-Allow-Origin
// would let any page on the internet submit reports through a visitor's browser.
export const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    // These endpoints must never be cached, by us or by anything in between.
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  },
});

export async function readJson(request) {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return null;
  try { return await request.json(); } catch { return null; }
}
