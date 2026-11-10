#!/usr/bin/env node
// Browser tests for Lead Re setup against the mock agent desktop pages in
// tests/agent-desktop-mock. Needs Playwright with Chromium, so it is kept out
// of the fast run-self-tests.mjs. Run from the repo root:
//
//   node tests/lead-reset.e2e.mjs
//
// GitHub calls are stubbed, so no network is needed. Exit 1 on any failure.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const mockRoot = join(here, 'agent-desktop-mock');
const script = readFileSync(join(here, '..', 'Lead-Reset.js'), 'utf8');

// Playwright is installed globally, which ESM import does not search.
async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return createRequire(join(globalRoot, 'noop.js'))('playwright');
}
const { chromium } = await loadPlaywright();

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`pass  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ''}`); }
}

const server = http.createServer((req, res) => {
  const p = normalize(join(mockRoot, decodeURIComponent(req.url.split(/[?#]/)[0])));
  if (p.startsWith(mockRoot) && existsSync(p) && statSync(p).isFile()) {
    res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(readFileSync(p));
  } else { res.statusCode = 404; res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const NATIONAL_HEADERS = ['NationalResult', 'Customer', 'ActivityID', 'LeadID', 'Verdict', 'Reason', 'Attempts', 'FinalOutcome', 'EnquiryMaxDealer', 'FollowUpNotes', 'ResetCampaign', 'Reg'];
const row = (vals) => Object.fromEntries(NATIONAL_HEADERS.map((h, i) => [h, vals[i] || '']));
const PUBLISHED = '2026-01-02T03:04:00Z';

const browser = await chromium.launch();

async function openPage(file, hash) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ commit: { committer: { date: PUBLISHED } } }]) }));
  await context.route('**/raw.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: script }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/${file}${hash}`);
  // The hidden date-picker Close has no handler in the mock; record any press.
  await page.evaluate(() => document.getElementById('dpClose').addEventListener('click', () => window.events.push('DATEPICKER-CLOSE')));
  return { context, page, errors };
}
const inject = (page) => page.addScriptTag({ content: script });
const shadowText = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector('#_leadResetPanel').shadowRoot.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

async function batchRun() {
  console.log('\nBatch run');
  const { context, page, errors } = await openPage('index.html', '#!/idle');
  await page.evaluate((results) => localStorage.setItem('_slaNationalCheckResults', JSON.stringify({ savedAt: new Date().toISOString(), results })), [
    row(['national', 'Mr. Sam Buyer', '70000002', '1400002', 'Re setup', 'x', '2', 'Email Only Lead', '', '', 'Vauxhall - Offer Request - Used', 'AB12 CDE']),
    row(['national', 'Alex Sample', '70000001', '1400001', 'OK']),
  ]);
  await inject(page);
  await page.waitForFunction(() => /Version of/.test(document.querySelector('#_leadResetPanel').shadowRoot.textContent), null, { timeout: 5000 }).catch(() => {});
  const expected = await page.evaluate((iso) => {
    const d = new Date(iso); const pad = (n) => String(n).padStart(2, '0');
    return `Version of ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, PUBLISHED);
  const panelText = await page.evaluate(() => document.querySelector('#_leadResetPanel').shadowRoot.textContent);
  check('version line comes from the stubbed GitHub date', panelText.includes(expected), expected);

  await page.click('#_leadResetPanel [data-action=start]');
  await page.waitForSelector('#_leadResetPanel [data-action=carry]', { timeout: 30000 });
  const atPause = await page.evaluate(() => ({
    events: [...window.events],
    leadNotes: (document.querySelector('.leadCallNotes') || {}).value,
  }));
  check('pauses for review before parking', !atPause.events.includes('park'), atPause.events);
  check('Call Notes empty at the review pause', atPause.leadNotes === '', atPause.leadNotes);

  await page.click('#_leadResetPanel [data-action=carry]');
  await page.waitForFunction(() => !window._leadResetState.running && window.events.includes('park'), null, { timeout: 15000 }).catch(() => {});
  const out = await page.evaluate(() => ({
    events: window.events,
    log: window._leadResetState.log,
    progress: JSON.parse(localStorage.getItem('_leadResetProgress') || 'null'),
    notesAfter: window.afterClose ? window.afterClose() : undefined,
    hash: location.hash,
  }));
  const ev = out.events;
  const idx = (pred) => ev.findIndex(typeof pred === 'string' ? (e) => e === pred : pred);

  check('status set to Shift Start first', ev[0] === 'status:Shift Start', ev);
  check('searched by customer name', ev.includes('search:Sam Buyer'), ev);
  check('picked the customer with activity 70000002', ev.includes('confirm:70000011SALES, 70000002SALES') && !ev.some((e) => /^confirm:(?!70000011SALES, 70000002SALES$)/.test(e)), ev);
  check('log says found by name and activity ID', out.log.some((l) => /Found the customer by name and activity ID/.test(l)), out.log);
  const upd = idx('outcome:Update Outcomes (No Call Made)');
  const back = ev.findIndex((e, i) => i > upd && e === 'outcome:(Select a Call Outcome)');
  check('outcome Update Outcomes chosen then set back to (Select a Call Outcome)', upd >= 0 && back > upd, ev);
  check('campaign chosen', ev.includes('campaign:Vauxhall - Offer Request - Used'), ev);
  check('new lead added', ev.includes('newLead'), ev);
  check('Call Notes hold the closed lead notes exactly when the diary opens', ev.includes('diary with notes:"From the page\\nline two" internal:""'), ev.filter((e) => e.startsWith('diary')));
  check('diary closed with the real Close', ev.includes('diaryClosed') && !ev.includes('DATEPICKER-CLOSE'), ev);
  check('diary closed after it opened', idx('diaryClosed') > idx((e) => e.startsWith('diary with notes')), ev);
  check('Call Notes empty afterwards', out.notesAfter === '', out.notesAfter);
  check('next status Shift Start before parking', idx('next:Shift Start') >= 0 && idx('next:Shift Start') < idx('park'), ev);
  check('call parked', ev.includes('park') && out.hash === '#!/idle', { ev, hash: out.hash });
  check('Finished never pressed', !ev.includes('FINISHED-PRESSED'), ev);
  check('progress saved as Done', out.progress && out.progress.byActivity && out.progress.byActivity['70000002'] === 'Done', out.progress);
  check('only the Re setup row was worked', out.progress && Object.keys(out.progress.byActivity).length === 1, out.progress);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function thisCustomer() {
  console.log('\nThis customer');
  const { context, page, errors } = await openPage('here.html', '#!/call/inbound/customer/1/customerIntervention/1/queue/1');
  await inject(page);
  const ticked = () => page.evaluate(() => {
    const r = document.querySelector('#_leadResetPanel').shadowRoot.querySelector('input[name=hereLead]:checked');
    return r ? r.value : null;
  });
  await page.waitForSelector('#_leadResetPanel input[name=hereLead]', { timeout: 5000 });
  check('panel opens in This customer mode', /This customer/.test(await shadowText(page, '.card') || ''));
  check('the lead in view is ticked', await ticked() === '77000001', await ticked());

  await page.evaluate(() => window.showOther());
  await page.waitForFunction(() => {
    const r = document.querySelector('#_leadResetPanel').shadowRoot.querySelector('input[name=hereLead]:checked');
    return r && r.value === '77000002';
  }, null, { timeout: 5000 }).catch(() => {});
  check('switching the visible tab moves the tick', await ticked() === '77000002', await ticked());

  await page.click('#_leadResetPanel input[value="77000001"]');
  // Give the follow-the-view check time to run; a manual pick must win.
  await page.waitForTimeout(2500);
  check('a manual tick holds', await ticked() === '77000001', await ticked());

  await page.click('#_leadResetPanel [data-action=here]');
  await page.waitForFunction(() => window._leadResetState && !window._leadResetState.running && window._leadResetState.log.some((l) => /You are in the new lead|stopped|failed/i.test(l)), null, { timeout: 30000 }).catch(() => {});
  const out = await page.evaluate(() => ({
    events: window.events,
    log: window._leadResetState.log,
    hash: location.hash,
    notesAfter: window.afterClose ? window.afterClose() : undefined,
  }));
  const ev = out.events;
  check('used No Booking on the inbound outcome list', ev[0] === 'outcome:No Booking', ev);
  check('campaign of the ticked lead chosen', ev.includes('campaign:Vauxhall - Offer Request - Used'), ev);
  check('copied the ticked lead Initial Notes box text exactly', ev.includes('diary with notes:"Box notes\\nsecond line" internal:""'), ev.filter((e) => e.startsWith('diary')));
  check('did not copy the other lead notes', !ev.some((e) => /Other lead notes/.test(e)), ev);
  check('diary closed with the real Close', ev.includes('diaryClosed') && !ev.includes('DATEPICKER-CLOSE'), ev);
  check('Call Notes empty afterwards', out.notesAfter === '', out.notesAfter);
  check('ends with You are in the new lead', /You are in the new lead/.test(out.log[out.log.length - 1] || ''), out.log);
  check('no park and no Finished', !ev.includes('park') && !ev.includes('FINISHED-PRESSED'), ev);
  check('still on the inbound call', out.hash === '#!/call/inbound/customer/1/customerIntervention/1/queue/1', out.hash);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function clearAndStop() {
  console.log('\nClear & Stop');
  const { context, page, errors } = await openPage('index.html', '#!/idle');
  await page.evaluate((r) => localStorage.setItem('_leadResetPastedResults', JSON.stringify({ savedAt: new Date().toISOString(), results: [r] })),
    row(['national', 'Mr. Sam Buyer', '70000002', '1', 'Re setup', '', '', '', '', '', 'Vauxhall - Offer Request - Used', 'AB12CDE']));
  await inject(page);
  await page.click('#_leadResetPanel [data-action=start]');
  await page.waitForFunction(() => window.events.length > 1, null, { timeout: 5000 }).catch(() => {});
  check('run had started before Clear & Stop', await page.evaluate(() => window._leadResetState && window._leadResetState.running === true));
  await page.click('#_leadResetPanel [data-action=clearStop]');
  await page.waitForFunction(() => !document.getElementById('_leadResetPanel') && window._leadResetState === null, null, { timeout: 5000 }).catch(() => {});
  // Let any step still in flight finish so a late save would show up.
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    panel: !!document.getElementById('_leadResetPanel'),
    pasted: localStorage.getItem('_leadResetPastedResults'),
    progress: localStorage.getItem('_leadResetProgress'),
    state: window._leadResetState,
  }));
  check('panel removed', after.panel === false);
  check('_leadResetProgress gone', after.progress === null, after.progress);
  check('_leadResetPastedResults gone', after.pasted === null, after.pasted);
  check('window._leadResetState is null', after.state === null, after.state);

  await inject(page);
  await page.waitForSelector('#_leadResetPanel', { timeout: 5000 }).catch(() => {});
  const body = await page.evaluate(() => {
    const p = document.getElementById('_leadResetPanel');
    const b = p && p.shadowRoot && p.shadowRoot.querySelector('.body');
    return b ? b.textContent.trim() : null;
  });
  check('reopening shows a panel', !!body, body);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

const started = Date.now();
try {
  await batchRun();
  await thisCustomer();
  await clearAndStop();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failures ? `${failures} failed` : 'All passed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
