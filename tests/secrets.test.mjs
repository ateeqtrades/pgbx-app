// The database connection string can come from Google Secret Manager instead of a Vercel setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT = JSON.stringify({ client_email: 'sa@pgbx-test.iam.gserviceaccount.com', project_id: 'pgbx-test',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const { readSecret, http } = await import('../server/secrets.mjs');

test('reads the latest secret version with a service-account token', async () => {
  const calls = [];
  http.fetch = async (url, opts = {}) => {
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = new URLSearchParams(opts.body).get('assertion');
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
      assert.equal(claims.iss, 'sa@pgbx-test.iam.gserviceaccount.com');
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/cloud-platform');
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    }
    assert.equal(url, 'https://secretmanager.googleapis.com/v1/projects/pgbx-test/secrets/pgbx-database-url/versions/latest:access');
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    return new Response(JSON.stringify({ payload: { data: Buffer.from('postgres://u:p@10.0.0.1:5432/pgbx\n').toString('base64') } }));
  };
  assert.equal(await readSecret('pgbx-database-url'), 'postgres://u:p@10.0.0.1:5432/pgbx');
  assert.equal(await readSecret('pgbx-database-url'), 'postgres://u:p@10.0.0.1:5432/pgbx');
  assert.equal(calls.filter(u => u.includes('oauth2')).length, 1);           // the token is reused
});

test('a missing secret or a bad name is reported, never guessed', async () => {
  http.fetch = async url => (url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'tok' })) : new Response('{}', { status: 404 }));
  await assert.rejects(readSecret('pgbx-database-url'), /can't be read \(404\)/);
  assert.equal(await readSecret('../etc'), null);
});
