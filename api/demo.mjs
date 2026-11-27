// /api/demo/v1/*: a clickable demo of the admin panel and dealer app for presentations (/admin-demo, /dealer-demo).
// It runs the real API code on its own in-memory database filled with sample customers, chats and orders, with test
// providers, and never touches the production database, real customers or real sign-in cookies. Visitors pick a role
// instead of signing in (POST /api/demo/v1/demo/session). The data resets every few hours and when the server restarts.
//
// This function runs in its own process on Vercel, so the settings below apply to the demo only.
for (const k of ['DATABASE_URL', 'DATABASE_URL_SECRET', 'FIREBASE_WEB_CONFIG', 'FCM_SERVICE_ACCOUNT', 'GOOGLE_SERVICE_ACCOUNT', 'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID', 'TURNSTILE_SECRET', 'TURNSTILE_SITE_KEY', 'REVIEW_LOGIN']) delete process.env[k];
Object.assign(process.env, { OTP_TEST_MODE: '1', PAYMENT_PROVIDER: 'sandbox', KYC_PROVIDER: 'sandbox', ALLOW_SANDBOX: '1',
  PAYMENT_WEBHOOK_SECRET: 'demo', KYC_WEBHOOK_SECRET: 'demo', CRON_SECRET: 'demo-' + Math.random() });

import { Readable } from 'node:stream';
const { handle } = await import('../server/api.mjs');
const { createMemoryDb } = await import('../server/memory-db.mjs');
const { fetchLiveRates } = await import('../server/rates.mjs');
const sec = await import('../server/security.mjs');

const RESET_MS = 3 * 3600e3;
const fetchRates = async opts => {
  const live = await fetchLiveRates(opts).catch(() => null);
  if (live && live.ok) return live;
  const at = new Date().toISOString();
  return { ok: true, usdPkr: { rate: 280, updatedAt: at, source: 'sample' }, metals: { gold: { buyTola: 466560, sellTola: 460000, source: 'sample', sourceUpdatedAt: at }, silver: { buyTola: 6400, sellTola: 6240, sourceUpdatedAt: at } } };
};

// Calls the API in-process while filling the database
async function call(db, method, path, body, token, ip = '10.9.0.1') {
  const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const req = Readable.from(raw.length ? [raw] : []);
  Object.assign(req, { method, url: '/api/v1' + path, headers: { host: 'demo', 'x-real-ip': ip, ...(raw.length ? { 'content-type': 'application/json', 'content-length': String(raw.length) } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  let out = ''; const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; }, end(d) { out = d ? String(d) : ''; } };
  await handle(req, res, { db, fetchRates });
  const d = out ? JSON.parse(out) : {};
  if (res.statusCode >= 400) throw new Error(`${method} ${path}: ${res.statusCode} ${d.error || ''} ${d.message || ''}`);
  return d;
}

const STAFF = [
  { role: 'admin', name: 'Demo Admin', email: 'admin@demo.pgbx' },
  { role: 'ops', name: 'Demo Operations', email: 'ops@demo.pgbx' },
  { role: 'support', name: 'Demo Support', email: 'support@demo.pgbx' },
  { role: 'dealer', name: 'Demo Dealer', email: 'dealer@demo.pgbx', dealer: true },
];
async function staffSession(db, role) {
  const s = await db.one(`select id from staff where role = $1 and email like '%@demo.pgbx' limit 1`, [role]);
  const token = sec.newToken();
  await db.query(`insert into staff_sessions (token_hash, staff_id, mfa_passed, expires_at) values ($1, $2, true, now() + interval '8 hours')`, [sec.hashToken(token), s.id]);
  return token;
}

async function build() {
  const db = await createMemoryDb();                         // the sample dealers and their stock
  const dealer = (await db.one(`select id from dealers order by name limit 1`)).id;
  for (const s of STAFF) await db.query(`insert into staff (email, name, role, dealer_id, password_hash, totp_secret) values ($1, $2, $3, $4, $5, $6)`,
    [s.email, s.name, s.role, s.dealer ? dealer : null, sec.hashPassword(sec.newPassword()), sec.newTotpSecret()]);
  await call(db, 'GET', '/rates');
  const sup = await staffSession(db, 'support');
  const people = [
    ['3001112233', 'Ayesha Khan', 'buy', 2], ['3214455667', 'Bilal Ahmed', 'buy-paid', 1], ['3337788990', 'Sana Iqbal review', 'kyc'],
    ['3451239876', 'Usman Tariq', 'buy-paid', 3], ['3125557788', 'Hira Siddiqui', 'chat', 1], ['3009876543', 'Kamran Ali', 'support'],
  ];
  let n = 0;
  for (const [ph, name, story, units] of people) {
    const ip = '10.9.1.' + (++n);
    await call(db, 'POST', '/auth/otp/start', { phone: ph }, null, ip);
    const t = (await call(db, 'POST', '/auth/otp/verify', { phone: ph, code: '123456', cookie: false, terms: '1.0', device: 'Demo phone' }, null, ip)).token;
    await call(db, 'POST', '/auth/pin', { pin: '1357' }, t, ip);
    const k = await call(db, 'POST', '/kyc', {}, t, ip);
    await call(db, 'POST', `/kyc/${k.check.id}/submit`, { cnic: '42201' + ph.slice(-7) + '1', name, dob: '1991-04-12', expiry: '2031-08-30' }, t, ip);
    if (story === 'kyc') continue;
    if (story === 'support') { await call(db, 'POST', '/support', { topic: 'general', body: 'General\n\nWhen will the dealer near me have 5 gram bars in stock?' }, t, ip); continue; }
    const c = (await call(db, 'POST', '/chats', { kind: 'buy_bars', details: { lines: [{ product_id: 'g-1g', units }] } }, t, ip)).chat;
    await call(db, 'POST', `/chats/${c.id}/messages`, { body: 'Assalam-o-Alaikum, please confirm today’s rate.' }, t, ip);
    if (story === 'chat') continue;
    const view = await call(db, 'GET', `/support/chats/${c.id}`, undefined, sup);
    const r = (await call(db, 'POST', `/support/chats/${c.id}/confirm`, { prices: view.suggested.prices, minutes: 15, note: 'Confirmed by phone' }, sup)).confirmation;
    if (story === 'buy') continue;
    const o = (await call(db, 'POST', '/orders', { lockId: r.lock_id, lines: [{ productId: 'g-1g', units }], method: 'bank', idempotencyKey: 'demo-' + ph }, t, ip)).order;
    await call(db, 'POST', `/payments/sandbox/${o.id}`, { outcome: 'success' }, t, ip);
  }
  return db;
}

let current = null;
function demoDb() {
  if (!current || Date.now() - current.at > RESET_MS) {
    const old = current;
    current = { at: Date.now(), db: build().catch(e => { current = null; throw e; }) };
    if (old) old.db.then(d => setTimeout(() => d.close().catch(() => {}), 60000), () => {});
  }
  return current.db;
}

export default async function handler(req, res) {
  let db;
  try { db = await demoDb(); }
  catch (e) { console.error('demo build failed', e); res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'DEMO_UNAVAILABLE', message: 'The demo is starting. Try again in a moment.' })); }
  const url = new URL(req.url, 'http://x');
  const path = url.searchParams.get('path') || url.pathname.replace(/^\/api\/demo\/v1\/?/, '');
  // Choosing a role instead of signing in (demo only)
  if (path === 'demo/session' && req.method === 'POST') {
    let body = ''; for await (const ch of req) { body += ch; if (body.length > 1000) break; }
    let role = 'admin'; try { role = JSON.parse(body).role; } catch (e) { }
    if (!STAFF.some(s => s.role === role)) role = 'admin';
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ token: await staffSession(db, role), role }));
  }
  // The real API, on the demo database. The path is handed over as /api/v1/... (local) or ?path= (Vercel rewrite).
  if (!url.searchParams.has('path')) req.url = '/api/v1/' + path + url.search;
  return handle(req, res, { db, fetchRates });
}
