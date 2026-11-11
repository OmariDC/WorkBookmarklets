#!/usr/bin/env node
// The whole link with the real scripts on their real addresses: SLA Manager
// on a Konnect Manager stand-in, Lead Re setup on the mock agent desktop
// (same site, second tab) and the Lead Checker on the mock Konnect Live
// page that SLA Manager opens. The other suites test each side against the
// agreed messages; this one checks the sides agree with each other.
// Needs Playwright with Chromium. Run from the repo root:
//
//   node tests/link-all.e2e.mjs
//
// The mock Konnect Live page ends every lead as "customer not found" or "no
// sales leads", so this covers the hand-offs, not classification.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, ...parts), 'utf8');
const slaScript = read('..', 'SLA-Manager.js');
const deskScript = read('..', 'Lead-Reset.js');
const liveScript = read('..', 'Konnect-Lead-Checker.js');
const livePage = read('konnect-live-mock', 'live.html');
const deskPage = read('agent-desktop-mock', 'desk.html');
const managerPage = '<!doctype html><html><head><meta charset="utf-8"><title>Konnect Manager (mock)</title></head><body><h1>Konnect Manager stand-in</h1></body></html>';

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

const MANAGER = 'https://konnectonlineservices.co.uk';
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
const until = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const shadowText = (page, sel) => page.evaluate((s) => {
  const host = document.querySelector('#_leadResetPanel');
  const el = host && host.shadowRoot.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

const browser = await chromium.launch();
const started = Date.now();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://carbot.ai/konnectlive')) return route.fulfill({ contentType: 'text/html', body: livePage });
    if (url.startsWith(`${MANAGER}/desk`)) return route.fulfill({ contentType: 'text/html', body: deskPage });
    if (url.startsWith(MANAGER)) return route.fulfill({ contentType: 'text/html', body: managerPage });
    return route.abort();
  });
  const errors = [];
  const watch = (page, name) => {
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('dialog', (d) => { errors.push(`${name} dialog: ${d.message()}`); d.dismiss(); });
  };

  // Both tabs are already open, as at the start of the day.
  const desk = await context.newPage();
  watch(desk, 'desk');
  await desk.goto(`${MANAGER}/desk/agent-desktop/index.html#!/idle`);
  await desk.evaluate(() => window.mock.setup({
    status: 'Shift Start',
    customers: ['jo', 'al'].map((id, i) => ({
      id, name: `${id === 'jo' ? 'Jo' : 'Al'} Example`, email: `${id}.example@example.com`, phone: `07700 90010${i + 1}`, parked: true,
      leads: [{ ID: `${id}-2`, CampaignName: 'Vauxhall - Post Closure', OutcomeFullHierarchy: 'None', SourceName: 'Post Closure Processing', notes: '', pcNotes: '' }]
    }))
  }));
  await desk.addScriptTag({ content: deskScript });
  await desk.waitForSelector('#_leadResetPanel [data-action=view]', { timeout: 5000 });

  const manager = await context.newPage();
  watch(manager, 'manager');
  await manager.goto(`${MANAGER}/manager`);
  await manager.addScriptTag({ content: slaScript });

  console.log('\nBefore Konnect Live is open');
  check('desk says Konnect Live is not open', await until(desk, () => /Konnect Live: not/i.test(document.querySelector('#_leadResetPanel').shadowRoot.textContent), null, 20000), await shadowText(desk, '.link'));

  console.log('\nSLA Manager sends a batch; Konnect Live opens and the Lead Checker runs it');
  const batch = ['Name\tPhone\tEmail\tSource\tCampaign\tCreated',
    '\t\tnone1@example.com\tCustomer First\tEnquiry - New\tTue, 10 Nov 2026 09:05',
    'Sam Example\t\tsam1@example.com\tCustomer First\tEnquiry - New\tTue, 10 Nov 2026 09:06',
    '\t\tnone2@example.com\tCustomer First\tEnquiry - New\tTue, 10 Nov 2026 09:07'].join('\n');
  const [live] = await Promise.all([
    context.waitForEvent('page'),
    manager.evaluate((tsv) => window._sendBatchToLeadChecker('leads', tsv), batch)
  ]);
  watch(live, 'live');
  await live.waitForLoadState();
  await live.addScriptTag({ content: liveScript });
  check('the Lead Checker takes the batch without another click', await until(live, () => { const s = window.__konnectLeadChecker && window.__konnectLeadChecker.getSession && window.__konnectLeadChecker.getSession(); return !!(s && s.rows && s.rows.length === 3); }, null, 30000));
  check('SLA Manager gets the results when the run ends', await until(manager, () => { const s = JSON.parse(localStorage.getItem('_slaLeadCheckerImportState') || 'null'); return !!(s && s.results && s.results.length === 3); }, null, 120000), await stored(manager, '_slaLeadCheckerImportState'));
  check('link state goes back to ready after the run', await until(manager, () => { const s = JSON.parse(localStorage.getItem('_workToolsLinkState') || 'null'); return !!(s && s.state === 'idle'); }, null, 30000), await stored(manager, '_workToolsLinkState'));
  check('desk shows Konnect Live linked and ready', await until(desk, () => /Konnect Live: linked, ready/i.test(document.querySelector('#_leadResetPanel').shadowRoot.textContent), null, 30000), await shadowText(desk, '.link'));

  console.log('\nThe desk asks for its Parked Calls to be checked');
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('SLA Manager passes it on and the Lead Checker finishes it', await until(desk, () => { const s = JSON.parse(localStorage.getItem('_workToolsLiveStatus') || 'null'); return !!(s && ['done', 'ended'].includes(s.state)); }, null, 120000), await stored(desk, '_workToolsLiveStatus'));
  const session = await live.evaluate(() => { const s = window.__konnectLeadChecker.getSession(); return s ? { mode: s.mode, rows: s.rows.length, done: !!s.done } : null; });
  check('the Lead Checker ran the Parked Calls as a Post Closure list', session && session.mode === 'postClosureList' && session.rows === 2 && session.done, session);
  check('SLA Manager\'s own lead card results are still its three', ((await stored(manager, '_slaLeadCheckerImportState')) || { results: [] }).results.length === 3);
  check('desk panel shows the request finished', /done|checked|finished|ended/i.test((await shadowText(desk, '.hub-status')) || ''), await shadowText(desk, '.hub-status'));

  console.log('\nSLA Manager refreshed: it links back to the open Live tab');
  await manager.reload();
  await manager.addScriptTag({ content: slaScript });
  check('linked again without opening another tab', await until(manager, () => { const s = JSON.parse(localStorage.getItem('_workToolsLinkState') || 'null'); return !!(s && s.state === 'idle' && Date.now() - new Date(s.at).getTime() < 15000); }, null, 30000) && context.pages().length === 3, context.pages().length);

  check('no page errors', errors.length === 0, errors);
  await context.close();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
}
console.log(`\n${failures ? `${failures} failed` : 'All passed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
