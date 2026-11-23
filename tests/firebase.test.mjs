// Firebase phone login: the server opens a session only for a genuine, fresh Firebase ID token for the same number.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMemoryDb } from '../server/memory-db.mjs';

const PROJECT = 'pgbx-test';
Object.assign(process.env, { FIREBASE_WEB_CONFIG: JSON.stringify({ apiKey: 'AIza-test', authDomain: PROJECT + '.firebaseapp.com', projectId: PROJECT, appId: '1:1:web:1' }),
  PAYMENT_PROVIDER: 'sandbox', KYC_PROVIDER: 'sandbox', CRON_SECRET: 'cron-test' });
delete process.env.OTP_TEST_MODE;
const { handle } = await import('../server/api.mjs');
const { firebaseKeys, verifyFirebaseToken } = await import('../server/providers.mjs');

// A key pair and certificate standing in for Google's signing keys
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=test'], { stdio: 'ignore' });
const KEY = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8'), CERT = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
firebaseKeys.fetch = async () => ({ keys: { kid1: CERT }, maxAge: 3600 });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, { kid = 'kid1', key = KEY } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, auth_time: now - 5, iat: now - 5, exp: now + 3600, sub: 'uid-1',
    phone_number: '+923001234567', ...claims };
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64(body);
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
}

let db, server, base;
async function call(method, p, body, ip = '10.20.0.1') {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-real-ip': ip }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
before(async () => {
  db = await createMemoryDb();
  server = http.createServer((req, res) => handle(req, res, { db, fetchRates: async () => ({ ok: false }) }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a genuine token proves exactly its own number', async () => {
  assert.equal(await verifyFirebaseToken(token(), PROJECT), '3001234567');
  assert.equal(await verifyFirebaseToken(token({ aud: 'other-project' }), PROJECT), null);
  assert.equal(await verifyFirebaseToken(token({ iss: 'https://securetoken.google.com/other' }), PROJECT), null);
  assert.equal(await verifyFirebaseToken(token({ exp: Math.floor(Date.now() / 1000) - 1 }), PROJECT), null);
  assert.equal(await verifyFirebaseToken(token({ auth_time: Math.floor(Date.now() / 1000) - 3600 }), PROJECT), null);   // an old sign-in
  assert.equal(await verifyFirebaseToken(token({ phone_number: '+441234567890' }), PROJECT), null);
  assert.equal(await verifyFirebaseToken(token({ sub: '' }), PROJECT), null);
  assert.equal(await verifyFirebaseToken(token({}, { key: other }), PROJECT), null);                    // forged signature
  assert.equal(await verifyFirebaseToken(token({}, { kid: 'unknown' }), PROJECT), null);
  const t = token(); const [h, , s] = t.split('.');
  assert.equal(await verifyFirebaseToken(h + '.' + b64({ aud: PROJECT, phone_number: '+923009999999' }) + '.' + s, PROJECT), null);   // edited claims
  assert.equal(await verifyFirebaseToken('not-a-token', PROJECT), null);
});

test('login with Firebase: config, start and verify open a PGBX session', async () => {
  const cfg = await call('GET', '/api/v1/config');
  assert.equal(cfg.data.otp.mode, 'firebase');
  assert.equal(cfg.data.otp.firebase.projectId, PROJECT);
  const s = await call('POST', '/api/v1/auth/otp/start', { phone: '3001234567' });
  assert.equal(s.status, 200); assert.equal(s.data.firebase, true);
  const wrong = await call('POST', '/api/v1/auth/otp/verify', { phone: '3001234567', firebaseToken: token({ phone_number: '+923007654321' }), cookie: false });
  assert.equal(wrong.status, 400); assert.equal(wrong.data.error, 'WRONG_CODE');
  const none = await call('POST', '/api/v1/auth/otp/verify', { phone: '3001234567', code: '123456', cookie: false });
  assert.equal(none.status, 400);                                                // no test code in Firebase mode
  const ok = await call('POST', '/api/v1/auth/otp/verify', { phone: '3001234567', firebaseToken: token(), cookie: false, terms: '1.0' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.ok(ok.data.token); assert.equal(ok.data.customer.isNew, true);
  const c = await db.one(`select phone, terms_version from customers where id = $1`, [ok.data.customer.id]);
  assert.equal(c.phone, '3001234567'); assert.equal(c.terms_version, '1.0');
});
