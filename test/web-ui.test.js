// Rendered web app in real Chrome (puppeteer-core), fully offline: the local server serves the app and every request to
// Google's suggest endpoint is intercepted and answered with SYNTHETIC data; any other external request is aborted.
// Skipped when puppeteer-core or a Chrome/Chromium binary is not available (same policy as the SERP browser test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../lib/google-serp.js';

const root = fileURLToPath(new URL('..', import.meta.url));

async function startServer(t) {
  const srv = spawn(process.execPath, ['server/server.js', '--port', '0'], { cwd: root });
  t.after(() => srv.kill());
  let out = '';
  const port = await new Promise((res, rej) => {
    // Ephemeral port chosen by the OS (no collisions between parallel test files).
    srv.stdout.on('data', (d) => { out += d; const m = /App:\s+http:\/\/[^:/]+:(\d+)\//.exec(out); if (m) res(Number(m[1])); });
    srv.on('exit', rej);
    setTimeout(() => rej(new Error('server did not start')), 5000);
  });
  return `http://127.0.0.1:${port}`;
}

/** Synthetic Google suggest answers, keyed by the query sent. */
const SYNTHETIC = {
  'abrir pdf xyzzy': ['abrir pdf xyzzy'],
  outra: ['outra xyzzy'],
  comum: ['comum plain'],
};
/** Answers only given while batch B runs (the same seed "comum" yields a visible question only in batch B). */
const SYNTHETIC_B = { 'como comum': ['como usar comum'] };
let batch = 'A';

test('web UI: literal {s}, family checkbox controls custom terms, each batch classified with its own terms', async (t) => {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { t.skip('puppeteer-core not installed — run `npm install`'); return; }
  const chrome = findChrome(process.env.CHROME_PATH);
  if (!chrome) { t.skip('no Chrome/Chromium found'); return; }
  const base = await startServer(t);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: process.env.AFKRT_CHROME_NO_SANDBOX ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const sent = [];
  const external = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin === base) return req.continue();
    if (u.host === 'suggestqueries.google.com') {
      const q = u.searchParams.get('q');
      sent.push(q);
      const cb = u.searchParams.get('callback');
      const answer = (batch === 'B' && SYNTHETIC_B[q.trim()]) || SYNTHETIC[q.trim()] || [];
      return req.respond({ status: 200, contentType: 'text/javascript', body: `${cb}(${JSON.stringify([q, answer])})` });
    }
    external.push(u.host);
    return req.abort();
  });
  await page.goto(`${base}/`, { waitUntil: 'load' });

  // 1. Literal "{s}" stays visible in placeholders and help (it is part of the syntax being explained).
  assert.match(await page.$eval('#termsQuestions', (el) => el.placeholder), /\{s\}/);
  assert.match(await page.$eval('.family-terms .hint', (el) => el.textContent), /\{s\}/);

  const setup = async ({ seed, questions, terms }) => page.evaluate(({ seed: s, questions: q, terms: tq }) => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    for (const box of document.querySelectorAll('[data-exp]')) {
      const want = box.dataset.exp === 'seed' || (box.dataset.exp === 'questions' && q);
      if (box.checked !== want) box.click();
    }
    set('delay', '100');
    set('termsQuestions', tq);
    set('seeds', s);
  }, { seed, questions, terms });
  const run = async () => {
    await page.click('#startBtn');
    await page.waitForFunction(() => !document.getElementById('startBtn').disabled && document.getElementById('stopBtn').disabled, { timeout: 30000 });
  };

  // 2. Family unticked: its extra terms are NOT sent, even when typed.
  await setup({ seed: 'abrir pdf', questions: false, terms: '{s} xyzzy' });
  await run();
  assert.ok(sent.includes('abrir pdf'), 'the seed itself was sent');
  assert.ok(!sent.some((q) => q.includes('xyzzy')), `custom question term sent with the family unticked: ${sent.join(' | ')}`);

  // 3. Batch A (family ticked, term "{s} xyzzy") and batch B (no terms): each phrase is classified with its own batch's terms.
  await setup({ seed: 'abrir pdf\ncomum', questions: true, terms: '{s} xyzzy' });
  await run();
  assert.ok(sent.includes('abrir pdf xyzzy'));
  batch = 'B';
  await setup({ seed: 'outra\ncomum', questions: true, terms: '' });
  await run();
  assert.ok(sent.includes('outra'), 'batch B was really collected');
  await new Promise((r) => setTimeout(r, 400)); // render throttle
  const all = await page.$$eval('#tbody tr', (rows) => rows.map((tr) => tr.children[1].innerText.split('\n')[0].trim()));
  assert.ok(all.includes('abrir pdf xyzzy') && all.includes('outra xyzzy'), `both batches rendered before filtering: ${all}`);
  await page.evaluate(() => { const b = document.getElementById('onlyQuestions'); if (!b.checked) b.click(); });
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr').length >= 1, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400)); // render throttle
  const shown = await page.$$eval('#tbody tr', (rows) => rows.map((tr) => tr.children[1].innerText.split('\n')[0].trim()));
  assert.ok(shown.includes('abrir pdf xyzzy'), `batch A phrase should be a question with batch A terms: ${shown}`);
  assert.ok(!shown.includes('outra xyzzy'), 'batch B phrase must not use batch A terms');

  // 4. "Export filtered results only": the JSON metadata (seeds, batches, terms) and the file name describe ONLY the
  //    exported records — batch B ("outra") is filtered out and must not appear.
  const exported = await page.evaluate(async () => {
    const box = document.getElementById('exportFiltered');
    if (!box.checked) box.click();
    let blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b; return orig.call(URL, b); };
    let name = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { name = this.download; };
    document.querySelector('[data-export="json"]').click();
    HTMLAnchorElement.prototype.click = origClick;
    URL.createObjectURL = orig;
    return { name, text: blob ? await blob.text() : '' };
  });
  const json = JSON.parse(exported.text);
  assert.deepEqual(json.keywords.map((k) => k.keyword).sort(), ['abrir pdf xyzzy', 'como usar comum']);
  assert.deepEqual(json.seeds.sort(), ['abrir pdf', 'comum']);
  assert.ok(!JSON.stringify(json).includes('outra'), 'nothing from the filtered-out seed "outra"');
  // "comum" ran in both batches but only produced a visible (exported) phrase in batch B.
  const [a, b] = json.batches;
  assert.deepEqual(a.seeds, ['abrir pdf']);
  assert.deepEqual(b.seeds, ['comum']);
  assert.match(exported.name, /^coleta-(abrir-pdf|comum)-/);
  assert.deepEqual(external, [], 'no request left the machine');
});
