// Secrets kept in Google Secret Manager (project of the Google service account), read by the server at start-up, so
// nobody has to copy a password into Vercel. DATABASE_URL_SECRET names the secret holding the database connection
// string; the service account in GOOGLE_SERVICE_ACCOUNT (or FCM_SERVICE_ACCOUNT, the same Firebase key) needs the
// Secret Manager Secret Accessor role on it. scripts/cloudshell-setup.sh sets this up.
import crypto from 'node:crypto';

const env = k => process.env[k] || '';
export const http = { fetch: (...a) => fetch(...a) };     // replaceable in tests
const tokens = new Map();

function serviceAccount() {
  try { const sa = JSON.parse(env('GOOGLE_SERVICE_ACCOUNT') || env('FCM_SERVICE_ACCOUNT') || 'null'); return sa && sa.client_email && sa.private_key && sa.project_id ? sa : null; }
  catch (e) { return null; }
}

async function accessToken(sa, scope) {
  const hit = tokens.get(scope);
  if (hit && hit.exp > Date.now() + 60000) return hit.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const r = await http.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(8000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Google sign-in for the service account failed');
  tokens.set(scope, { value: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

// The latest version of a secret, or null when it isn't set up
export async function readSecret(name) {
  const sa = serviceAccount();
  if (!sa || !/^[A-Za-z0-9_-]{1,255}$/.test(name || '')) return null;
  const token = await accessToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const r = await http.fetch(`https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/secrets/${name}/versions/latest:access`,
    { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.payload || !d.payload.data) throw new Error(`Secret ${name} can't be read (${r.status})`);
  return Buffer.from(d.payload.data, 'base64').toString('utf8').trim();
}
