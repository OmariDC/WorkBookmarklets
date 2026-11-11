#!/usr/bin/env node
// Browser tests for the Lead Checker's link to SLA Manager and its run
// controls, against the mock Konnect Live page in tests/konnect-live-mock/.
// Needs Playwright with Chromium. Run from the repo root:
//
//   node tests/lead-checker-link.e2e.mjs
//
// The mock page answers the real search and timeline steps. Every lead in
// these batches ends as "customer not found" or "no sales leads"; the
// customers with leads and a lead window are used by
// tests/lead-checker-open.e2e.mjs. GitHub calls are blocked, so no network
// is needed. Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '..', 'Konnect-Lead-Checker.js'), 'utf8');
const livePage = readFileSync(join(here, 'konnect-live-mock', 'live.html'), 'utf8');
const managerPage = readFileSync(join(here, 'konnect-live-mock', 'manager.html'), 'utf8');

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

const HEADER = 'Name\tPhone\tEmail\tSource\tCampaign\tCreated';
// Rows alternate between "not found" and "no sales leads", so the run
// never stops for three identical failures in a row.
function batch(rows, tag) {
  const lines = [HEADER];
  for (let i = 0; i < rows; i++) {
    const none = i % 2 === 0;
    lines.push([none ? '' : `Sam Example${i}`, '', `${none ? 'none' : 'sam'}${tag || ''}${i}@example.com`, 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 09:05'].join('\t'));
  }
  return lines.join('\n');
}

const browser = await chromium.launch();

// Opens the mock SLA Manager, which opens Konnect Live as its own tab, the
// way the real link is made.
async function openLinked(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://carbot.ai/konnectlive')) return route.fulfill({ contentType: 'text/html', body: livePage });
    if (url.startsWith('https://konnectonlineservices.co.uk')) return route.fulfill({ contentType: 'text/html', body: managerPage });
    return route.abort();
  });
  if (options.init) await context.addInitScript(options.init);
  const manager = await context.newPage();
  await manager.goto('https://konnectonlineservices.co.uk/manager');
  const [live] = await Promise.all([context.waitForEvent('page'), manager.evaluate(() => { window.live = window.open('https://carbot.ai/konnectlive/'); })]);
  await live.waitForLoadState();
  const errors = [];
  live.on('pageerror', (e) => errors.push(e.message));
  const api = {
    context, manager, live, errors,
    load: async () => { await live.addScriptTag({ content: script }); await live.waitForTimeout(300); },
    msgs: (type) => manager.evaluate((t) => window.msgs.filter((m) => !t || m.type === `workTools:${t}`), type),
    clearMsgs: () => manager.evaluate(() => { window.msgs = []; }),
    send: (message) => manager.evaluate((m) => window.send(m), message),
    waitFor: async (type, test, timeout = 30000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const hit = (await api.msgs(type)).find((m) => !test || test(m));
        if (hit) return hit;
        await live.waitForTimeout(100);
      }
      return null;
    },
    panel: (selector) => live.locator('#_klcPanelHost').locator(selector),
    // A control kept in the More menu: the menu is opened first.
    more: async (selector) => {
      if (await live.evaluate(() => document.getElementById('_klcPanelHost').shadowRoot.getElementById('moreMenu').classList.contains('hidden'))) await api.panel('#moreBtn').click();
      return api.panel(selector);
    },
    text: (id) => live.evaluate((i) => { const host = document.getElementById('_klcPanelHost'); const el = host && host.shadowRoot.getElementById(i); return el ? el.textContent : null; }, id),
    close: () => context.close()
  };
  if (!options.noLoad) await api.load();
  return api;
}

// ------------------------------------------------------------------
// 1. Heartbeat, a full batch, the per-batch partial counter, busy.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  const first = (await t.msgs('ready'))[0];
  check('ready is sent at start with state idle and no batch', first && first.state === 'idle' && first.batchId === null && first.done === 0 && first.total === 0 && /^https:\/\/carbot\.ai\/konnectlive/.test(first.url), first);
  check('the panel shows the shared link line', (await t.text('linkLine')) === 'Konnect Live: linked, ready.', await t.text('linkLine'));

  await t.send({ type: 'workTools:batch', id: 'b1', kind: 'leads', tsv: batch(12, 'a') });
  const received = await t.waitFor('received');
  check('received echoes the id and the row count', received && received.id === 'b1' && received.rows === 12, received);
  const running = await t.waitFor('ready', (m) => m.state === 'running');
  check('ready says running with the batch id straight away', running && running.batchId === 'b1' && running.total === 12, running);

  // A second batch while the first runs is refused.
  await t.send({ type: 'workTools:batch', id: 'b2', kind: 'leads', tsv: batch(2, 'x') });
  const busy = await t.waitFor('busy');
  check('busy names the refused batch and the running one', busy && busy.id === 'b2' && busy.runningId === 'b1', busy);
  // The same batch sent again is acknowledged, not run twice.
  await t.send({ type: 'workTools:batch', id: 'b1', kind: 'leads', tsv: batch(12, 'a') });
  await t.live.waitForTimeout(300);
  check('the same batch sent twice is received again, not restarted', (await t.msgs('received')).length === 2 && (await t.msgs('busy')).length === 1, await t.msgs('received'));

  const ended = await t.waitFor('ended', null, 60000);
  check('ended done for the batch', ended && ended.id === 'b1' && ended.reason === 'done', ended);
  let results = await t.msgs('results');
  const partials = results.filter((m) => m.partial);
  const finals = results.filter((m) => !m.partial);
  check('partial results every 5 leads, with the id', partials.length === 2 && partials.every((m) => m.id === 'b1' && m.kind === 'leads') && partials[0].done === 5 && partials[1].done === 10, partials.map((m) => [m.id, m.done, m.total]));
  check('one final result with every row, before ended', finals.length === 1 && finals[0].id === 'b1' && finals[0].done === 12 && finals[0].total === 12 && finals[0].tsv.split('\n').length === 13 && finals[0].at <= ended.at, finals.map((m) => [m.id, m.done]));
  check('exactly one ended', (await t.msgs('ended')).length === 1);
  const idleAgain = await t.waitFor('ready', (m) => m.state === 'idle' && m.at >= ended.at);
  check('ready goes back to idle with no batch after it ends', idleAgain && idleAgain.batchId === null, idleAgain);

  // Second batch: the partial counter starts again.
  await t.clearMsgs();
  await t.send({ type: 'workTools:batch', id: 'b3', kind: 'leads', tsv: batch(6, 'b') });
  const ended2 = await t.waitFor('ended', null, 60000);
  results = await t.msgs('results');
  check('the partial counter starts again for the next batch', ended2 && ended2.id === 'b3' && results.filter((m) => m.partial).map((m) => m.done).join() === '5' && results.every((m) => m.id === 'b3'), results.map((m) => [m.id, m.partial, m.done]));

  // A batch with no id is still accepted and echoed as null.
  await t.clearMsgs();
  await t.send({ type: 'workTools:batch', kind: 'leads', tsv: batch(2, 'c') });
  const ended3 = await t.waitFor('ended', null, 30000);
  const received3 = (await t.msgs('received'))[0];
  check('a batch with no id is accepted and echoed as null', ended3 && ended3.id === null && ended3.reason === 'done' && received3 && received3.id === null, [received3, ended3]);

  // Heartbeat: ready again within 10 seconds with nothing changing.
  await t.clearMsgs();
  await t.live.waitForTimeout(10500);
  const beats = await t.msgs('ready');
  check('ready is repeated every 10 seconds', beats.length >= 1 && beats.length <= 2 && beats[0].state === 'idle', beats.length);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 2. Cancel, empty and unreadable batches.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.send({ type: 'workTools:batch', id: 'c1', kind: 'leads', tsv: batch(10, 'a') });
  await t.waitFor('ready', (m) => m.state === 'running');
  await t.live.waitForTimeout(1500);
  await t.panel('#btnCancel').click();
  const ended = await t.waitFor('ended', null, 20000);
  check('cancel ends the batch as cancelled', ended && ended.id === 'c1' && ended.reason === 'cancelled', ended);
  check('no final result for a cancelled batch', (await t.msgs('results')).every((m) => m.partial), (await t.msgs('results')).map((m) => [m.partial, m.done]));
  const idle = await t.waitFor('ready', (m) => m.state === 'idle' && m.at >= ended.at);
  check('ready is idle after a cancel', !!idle && idle.batchId === null, idle);

  await t.clearMsgs();
  await t.send({ type: 'workTools:batch', id: 'e1', kind: 'leads', tsv: HEADER });
  const empty = await t.waitFor('ended');
  check('a batch with no rows is received then ended as empty', empty && empty.id === 'e1' && empty.reason === 'empty' && (await t.msgs('received'))[0].rows === 0, empty);

  await t.clearMsgs();
  await t.send({ type: 'workTools:batch', id: 'u1', kind: 'leads', tsv: 'Wrong\tHeader\nA\tB' });
  const unreadable = await t.waitFor('ended');
  check('a batch with a bad header is received then ended as unreadable', unreadable && unreadable.id === 'u1' && unreadable.reason === 'unreadable' && (await t.msgs('received')).length === 1, unreadable);
  check('nothing ran for them', (await t.msgs('results')).length === 0 && (await t.msgs('ended')).length === 1);

  // Messages from anywhere but the opener's origin are ignored.
  await t.clearMsgs();
  await t.live.evaluate((tsv) => window.postMessage({ type: 'workTools:batch', id: 'evil', kind: 'leads', tsv }, '*'), batch(2, 'z'));
  await t.live.waitForTimeout(500);
  check('a batch from another window is ignored', (await t.msgs('received')).length === 0);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 3. Clear & Stop, then the bookmark again: one copy answers.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.send({ type: 'workTools:batch', id: 'k1', kind: 'leads', tsv: batch(8, 'a') });
  await t.waitFor('ready', (m) => m.state === 'running');
  await t.live.waitForTimeout(800);
  await (await t.more('#btnClearStop')).click();
  const cleared = await t.waitFor('ended');
  check('Clear & Stop ends the running batch as cleared', cleared && cleared.id === 'k1' && cleared.reason === 'cleared', cleared);
  check('Clear & Stop removes the panel and the stored batch', await t.live.evaluate(() => !document.getElementById('_klcPanelHost') && !document.getElementById('_klcNavItem') && localStorage.getItem('konnectLeadChecker:session:v1') === null));
  await t.clearMsgs();
  await t.live.waitForTimeout(10500);
  check('a cleared tool sends no more ready messages', (await t.msgs('ready')).length === 0, await t.msgs());
  check('and does not put its button back', await t.live.evaluate(() => !document.getElementById('_klcNavItem') && !document.getElementById('_klcBadge')));

  await t.load();
  await t.clearMsgs();
  await t.send({ type: 'workTools:batch', id: 'k2', kind: 'leads', tsv: batch(4, 'b') });
  const ended = await t.waitFor('ended', null, 40000);
  await t.live.waitForTimeout(500);
  check('after a second load one copy answers: one received', (await t.msgs('received')).length === 1, await t.msgs('received'));
  check('one run: one final result and one ended', ended && ended.reason === 'done' && (await t.msgs('results')).filter((m) => !m.partial).length === 1 && (await t.msgs('ended')).length === 1, (await t.msgs()).map((m) => m.type));
  check('each lead searched once', (await t.live.evaluate(() => window.mock.searches.filter((s) => /b\d@example/.test(s)).length)) === 4, await t.live.evaluate(() => window.mock.searches));
  await t.clearMsgs();
  await t.live.waitForTimeout(10500);
  const beats = await t.msgs('ready');
  check('one heartbeat, not two', beats.length >= 1 && beats.length <= 2, beats.length);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 4. A reload in the middle of a linked batch: it carries on by itself.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.send({ type: 'workTools:batch', id: 'r1', kind: 'leads', tsv: batch(8, 'a') });
  await t.waitFor('ready', (m) => m.state === 'running' && m.batchId === 'r1');
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return s && Object.keys(s.results).length >= 3; }, null, { timeout: 30000 });
  await t.live.reload();
  await t.clearMsgs();
  await t.load();
  const ready = await t.waitFor('ready', (m) => m.state === 'running');
  check('after a reload the batch is reported running under the same id', ready && ready.batchId === 'r1' && ready.total === 8, ready);
  const ended = await t.waitFor('ended', null, 40000);
  const final = (await t.msgs('results')).find((m) => !m.partial);
  check('it finishes and sends every row under the same id', ended && ended.id === 'r1' && ended.reason === 'done' && final && final.id === 'r1' && final.done === 8, [ended, final && final.done]);
  check('it was not received a second time', (await t.msgs('received')).length === 0);

  // A finished batch is not run again by another reload.
  await t.live.reload();
  await t.clearMsgs();
  await t.load();
  await t.live.waitForTimeout(800);
  const after = await t.msgs();
  check('a finished batch stays finished after a reload', after.every((m) => m.type === 'workTools:ready' && m.state === 'idle' && m.batchId === null), after.map((m) => [m.type, m.state]));
  check('the restored batch says where it came from', /Restored after the page reloaded/.test(await t.text('hintLine')), await t.text('hintLine'));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 5. Hidden tab. document.hidden is overridden: headless Chromium does not
//    slow a hidden tab's timers the way a real browser does, so this shows
//    the run no longer waits for the tab, not that real throttling is beaten.
// ------------------------------------------------------------------
for (const workerOn of [true, false]) {
  const t = await openLinked({
    noLoad: true,
    init: `Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return !!window.__fakeHidden; } }); window.__fakeHidden = true; ${workerOn ? '' : 'window.__klcNoWorkerTimers = true;'}`
  });
  await t.load();
  const mode = await t.live.evaluate(() => window.__klcShared.timers.mode);
  check(`timers use the ${workerOn ? 'worker' : 'page'} when the worker is ${workerOn ? 'allowed' : 'blocked'}`, mode === (workerOn ? 'worker' : 'page'), mode);
  await t.send({ type: 'workTools:batch', id: 'h1', kind: 'leads', tsv: batch(4, 'a') });
  if (workerOn) {
    const ended = await t.waitFor('ended', null, 90000);
    check('hidden with the worker: the batch runs to the end', ended && ended.reason === 'done' && (await t.msgs('results')).some((m) => !m.partial && m.done === 4), ended);
    check('hidden with the worker: never reported paused', (await t.msgs('ready')).every((m) => m.state !== 'paused'), (await t.msgs('ready')).map((m) => m.state));
  } else {
    const paused = await t.waitFor('ready', (m) => m.state === 'paused', 10000);
    check('hidden without the worker: the run waits and says paused over the link', paused && paused.batchId === 'h1', paused);
    check('the panel says why', /in the background/.test(await t.text('curState')), await t.text('curState'));
    check('nothing was searched while waiting', (await t.live.evaluate(() => window.mock.searches.length)) === 0);
    await t.live.waitForTimeout(2200);
    check('the tab title flashes', (await t.live.evaluate(() => new Promise((resolve) => { const seen = new Set(); const i = setInterval(() => { seen.add(document.title); if (seen.size > 1) { clearInterval(i); resolve(true); } }, 100); setTimeout(() => { clearInterval(i); resolve(false); }, 3000); }))) === true);
    await t.live.evaluate(() => { window.__fakeHidden = false; });
    const ended = await t.waitFor('ended', null, 60000);
    check('it carries on by itself when the tab is shown', ended && ended.reason === 'done', ended);
    check('the title is put back', (await t.live.title()) === 'Konnect Live (mock)', await t.live.title());
  }
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 6. Run controls: Pause waits for the lead in flight, Retry and Check one
//    lead never double up, a paste over a running batch waits for it.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.live.evaluate(() => { window.mock.searchDelay = 900; });
  await t.send({ type: 'workTools:batch', id: 'p1', kind: 'leads', tsv: batch(6, 'a') });
  await t.waitFor('ready', (m) => m.state === 'running');
  await t.live.waitForFunction(() => window.mock.searches.length === 1);
  await t.panel('#btnPauseResume').click();
  check('Pause during a lead says it will pause after it', /Pausing after this lead/.test(await t.text('curState')), await t.text('curState'));
  const paused = await t.waitFor('ready', (m) => m.state === 'paused');
  check('ready says paused', paused && paused.batchId === 'p1', paused);
  check('the link line says paused', (await t.text('linkLine')) === 'Konnect Live: paused.', await t.text('linkLine'));
  // Check one lead pressed twice while the paused lead is still finishing.
  await (await t.more('#btnProcessNext')).click();
  // The menu has closed, so the second press is made straight on the item.
  await t.panel('#btnProcessNext').evaluate((el) => el.click());
  await t.live.waitForFunction(() => Object.keys(window.__konnectLeadChecker.getSession().results).length >= 2 && !window.__klcShared.stepBusy, null, { timeout: 30000 });
  await t.live.waitForTimeout(300);
  const afterManual = await t.live.evaluate(() => ({ done: Object.keys(window.__konnectLeadChecker.getSession().results).length, searches: window.mock.searches.slice() }));
  check('Check one lead waited for the lead in flight, then did exactly one', afterManual.done === 2 && afterManual.searches.length === 2 && new Set(afterManual.searches).size === 2, afterManual);
  await t.live.waitForTimeout(1500);
  check('nothing else ran while paused', (await t.live.evaluate(() => window.mock.searches.length)) === 2);
  await t.live.evaluate(() => { window.mock.searchDelay = 120; });
  await t.panel('#btnPauseResume').click();
  const ended = await t.waitFor('ended', null, 40000);
  const searches = await t.live.evaluate(() => window.mock.searches.slice());
  check('Resume finishes the batch with every lead searched once', ended && ended.reason === 'done' && searches.length === 6 && new Set(searches).size === 6, searches);

  // Retry failed leads on the finished batch: results go again, ended does not.
  await t.clearMsgs();
  await t.panel('#btnRetryExceptions').click();
  const again = await t.waitFor('results', (m) => !m.partial, 40000);
  await t.live.waitForTimeout(300);
  check('a retry on a finished linked batch sends the results again under its id', again && again.id === 'p1' && again.done === 6, again && [again.id, again.done]);
  check('and does not say ended a second time', (await t.msgs('ended')).length === 0, await t.msgs('ended'));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// A paste over a running batch: the old run stops first, then the new one starts.
{
  const t = await openLinked();
  await t.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://carbot.ai' });
  await t.live.evaluate(() => { window.mock.searchDelay = 700; });
  await t.send({ type: 'workTools:batch', id: 'q1', kind: 'leads', tsv: batch(6, 'old') });
  await t.waitFor('ready', (m) => m.state === 'running');
  await t.live.waitForFunction(() => window.mock.searches.length === 1);
  await t.live.bringToFront();
  await t.live.evaluate((text) => navigator.clipboard.writeText(text), batch(3, 'new'));
  await (await t.more('#btnClearPasteStart')).click();
  const cleared = await t.waitFor('ended');
  check('a hand paste over a linked batch ends it as cleared', cleared && cleared.id === 'q1' && cleared.reason === 'cleared', cleared);
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return s && s.done && s.rows.length === 3; }, null, { timeout: 40000 });
  const searches = await t.live.evaluate(() => window.mock.searches.slice());
  const firstNew = searches.findIndex((s) => /new/.test(s));
  check('the new batch ran, and only after the old run let go of the page', firstNew > 0 && searches.slice(firstNew).every((s) => /new/.test(s)) && searches.filter((s) => /new/.test(s)).length === 3, searches);
  const ready = (await t.msgs('ready')).pop();
  check('a hand batch is reported with no batch id', ready && ready.batchId === null, ready);
  check('no results are sent over the link for a hand batch', (await t.msgs('results')).every((m) => m.id === 'q1'), (await t.msgs('results')).map((m) => m.id));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 7. Logged out mid-run: the overlay is lifted off the Login button, the
//    link says loggedOut, and the lead is checked again after login.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.send({ type: 'workTools:batch', id: 'l1', kind: 'leads', tsv: batch(4, 'a') });
  await t.waitFor('ready', (m) => m.state === 'running');
  await t.live.waitForFunction(() => window.mock.searches.length >= 1);
  await t.live.evaluate(() => window.mock.logOut());
  const out = await t.waitFor('ready', (m) => m.state === 'loggedOut', 30000);
  check('ready says loggedOut', !!out, (await t.msgs('ready')).map((m) => m.state));
  await t.live.waitForFunction(() => /waiting for you to press Login/.test(document.getElementById('_klcPanelHost').shadowRoot.getElementById('curState').textContent), null, { timeout: 30000 });
  const under = await t.live.evaluate(() => {
    const b = document.getElementById('loginBtn').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const root = document.getElementById('_klcPanelHost').shadowRoot;
    return { id: el && el.id, overlay: !!document.getElementById('_klcPageFlashOverlay'), notices: root.querySelectorAll('.notice').length, state: root.getElementById('curState').textContent, line: root.getElementById('linkLine').textContent };
  });
  check('the Login button is not covered while waiting', under.id === 'loginBtn' && !under.overlay, under);
  check('the logged out message shows once', under.notices === 1 && !/Konnect Live logged out/.test(under.state), under);
  check('the link line says logged out', under.line === 'Konnect Live: logged out, logging back in.', under.line);
  await t.live.evaluate(() => { window.mock.allowLogin = true; document.getElementById('loginBtn').click(); });
  const ended = await t.waitFor('ended', null, 60000);
  const final = (await t.msgs('results')).find((m) => !m.partial);
  const rows = final ? final.tsv.split('\n').slice(1).map((line) => line.split('\t')[13]) : [];
  check('after login the batch finishes with the usual outcomes', ended && ended.reason === 'done' && rows.length === 4 && rows.every((r) => r === 'SEARCH_NO_RESULTS' || r === 'NO_ELIGIBLE_LEAD_EVENTS'), rows);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll Lead Checker link tests passed.' : `\n${failures} Lead Checker link test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
