// Customer walkthrough of the production app (/live) on a phone-sized screen, against the local dev server.
// Run: node tests/e2e/walkthrough.mjs [shotsDir]     (needs Playwright with Chromium; not part of npm test)
// The production build calls https://pgbx-app.vercel.app; those calls are sent to the local server instead.
// Two runs: login switched on (test code 123456) and login not switched on (no SMS provider), where the app must say
// so plainly instead of blaming the customer's connection.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.resolve(process.argv[2] || path.join(ROOT, 'tests/e2e/shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const pw = await import(process.env.PLAYWRIGHT || 'playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const { chromium } = pw.default || pw;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function server(port, env) {
  const p = spawn(process.execPath, ['dev/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100 && !out.includes('dev server'); i++) await wait(200);
  if (!out.includes('dev server')) throw new Error('dev server did not start:\n' + out);
  return p;
}

async function phone(browser, port) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/^https:\/\/pgbx-app\.vercel\.app\//, async route => {
    const u = new URL(route.request().url());
    const r = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` });
    await route.fulfill({ response: r });
  });
  return { ctx, page, errors };
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const text = page => page.evaluate(() => document.body.innerText);
async function tapText(page, t, opts = {}) { await page.getByText(t, { exact: false }).first().click(opts); await wait(500); }
async function pin(page, digits) { for (const d of digits) { await page.locator('.keypad .key', { hasText: new RegExp('^' + d) }).first().click(); await wait(120); } await wait(700); }

const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });

// ---------- 1. login switched on ----------
{
  const port = 8197;
  const srv = await server(port, {});
  const { ctx, page, errors } = await phone(browser, port);
  try {
    await page.goto(`http://127.0.0.1:${port}/live/`); await wait(2500);
    await shot(page, '01-first-screen');
    let t = await text(page);
    if (/Get started|Log in|Continue/i.test(t) && !(await page.locator('input[type=tel]').count())) {
      for (const label of ['Get started', 'Log in', 'Continue']) { if ((await page.getByText(label).count()) > 0) { await tapText(page, label); break; } }
    }
    await page.locator('input[type=tel]').first().fill('3001234567'); await wait(400);
    await shot(page, '02-phone-entered');
    await page.getByRole('button', { name: /Send code/ }).click(); await wait(1500);
    t = await text(page);
    check('login code is sent', /Enter the code/.test(t), t.match(/Can.t reach[^\n]*|isn.t available[^\n]*/)?.[0] || '');
    await shot(page, '03-code-screen');
    await page.locator('input[autocomplete=one-time-code]').fill('123456'); await wait(3000);
    t = await text(page);
    if (/I accept/.test(t)) { await tapText(page, 'I accept'); }
    await shot(page, '04-after-code');
    t = await text(page);
    const createPin = /Create|choose|PIN/i.test(t);
    check('code accepted, PIN step shown', createPin, t.slice(0, 80).replace(/\n/g, ' | '));
    await pin(page, '1357'); await pin(page, '1357'); await wait(2500);
    t = await text(page);
    if (/Not now/.test(t)) await tapText(page, 'Not now');
    await shot(page, '05-home');
    t = await text(page);
    check('home screen after login', /Gold|Silver|tola/i.test(t), t.slice(0, 80).replace(/\n/g, ' | '));

    for (const [tab, name] of [['Buy', '06-buy'], ['Wallet', '07-wallet'], ['Services', '08-services'], ['Account', '09-account']]) {
      const b = page.locator('.tabbar .tab', { hasText: tab });
      if (await b.count()) { await b.first().click(); await wait(1500); await shot(page, name); check(`${tab} tab opens`, true); }
      else check(`${tab} tab opens`, false, 'tab not found');
    }
    await page.locator('.tabbar .tab', { hasText: 'Buy' }).first().click(); await wait(1200);
    const firstProduct = page.locator('.row', { hasText: /gram|tola|mg/ }).first();
    if (await firstProduct.count()) {
      await firstProduct.click(); await wait(1500); await shot(page, '10-product');
      t = await text(page);
      check('product page shows a price or final-rate button', /Rs|final rate/i.test(t));
      const rate = page.getByRole('button', { name: /final rate/i });
      if (await rate.count()) {
        await rate.first().click(); await wait(1500);
        t = await text(page);
        if (/Continue|I understand|Got it/i.test(t) && !/Final rate/.test(t.slice(0, 40))) for (const l of ['I understand', 'Continue', 'Got it']) if ((await page.getByText(l).count()) > 0) { await tapText(page, l); break; }
        await wait(2000); await shot(page, '11-rate-chat');
        t = await text(page);
        check('rate chat opens', /Final rate|Message|support/i.test(t));
      }
    }
    check('no script errors (login on)', errors.length === 0, errors.slice(0, 3).join(' / '));
  } catch (e) { check('walkthrough (login on) ran to the end', false, e.message.split('\n')[0]); await shot(page, 'zz-failure'); }
  await ctx.close(); srv.kill();
}

// ---------- 2. login not switched on ----------
{
  const port = 8198;
  const srv = await server(port, { OTP_TEST_MODE: '' });
  const { ctx, page, errors } = await phone(browser, port);
  try {
    await page.goto(`http://127.0.0.1:${port}/live/`); await wait(2500);
    if (!(await page.locator('input[type=tel]').count())) for (const label of ['Get started', 'Log in', 'Continue']) if ((await page.getByText(label).count()) > 0) { await tapText(page, label); break; }
    await wait(1500);
    await shot(page, '20-login-not-ready');
    const t = await text(page);
    check('login not switched on: honest message', /isn.t available yet/.test(t), t.match(/Can.t reach[^\n]*|isn.t available[^\n]*/)?.[0] || 'no message');
    check('no script errors (login off)', errors.length === 0, errors.slice(0, 3).join(' / '));
  } catch (e) { check('walkthrough (login off) ran to the end', false, e.message.split('\n')[0]); }
  await ctx.close(); srv.kill();
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
