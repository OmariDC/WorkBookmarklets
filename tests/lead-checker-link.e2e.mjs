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

// ------------------------------------------------------------------
// 8. The small window. Work Tools, clicked on the Konnect Live tab SLA
//    Manager opened, moves the Lead Checker into a small window and hands
//    it the link. Playwright does not block pop-ups, so a blocked one is
//    played by window.open returning nothing.
// ------------------------------------------------------------------
const workTools = readFileSync(join(here, '..', 'Work-Tools.js'), 'utf8');
const SMALL_DONE = 'The Lead Checker is running in the small window.';
async function openForWorkTools(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://carbot.ai/konnectlive')) return route.fulfill({ contentType: 'text/html', body: livePage });
    if (url.startsWith('https://konnectonlineservices.co.uk')) return route.fulfill({ contentType: 'text/html', body: managerPage });
    if (/^https:\/\/raw\.githubusercontent\.com\/.*\/Konnect-Lead-Checker\.js/.test(url)) return route.fulfill({ contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: script });
    return route.abort();
  });
  // Every Konnect Live page notes its window.open calls, and starts on the
  // login page when the test asks for that.
  await context.addInitScript(() => {
    if (location.hostname !== 'carbot.ai') return;
    const open = window.open.bind(window);
    window.__opens = [];
    window.open = (...args) => { window.__opens.push(args); return localStorage.getItem('_testBlockPopups') ? null : open(...args); };
    if (localStorage.getItem('_testLoggedOut')) window.addEventListener('DOMContentLoaded', () => window.mock.logOut());
  });
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (e) => errors.push(e.message)));
  const manager = await context.newPage();
  await manager.goto('https://konnectonlineservices.co.uk/manager');
  // Notes which window each ready message came from, as SLA Manager does.
  await manager.evaluate(() => {
    window.readyFrom = [];
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'workTools:ready') return;
      window.lastSource = event.source;
      window.readyFrom.push(event.source === window.live || event.source === window.live2 ? 'tab' : 'other');
    });
  });
  const t = {
    context, manager, errors,
    openTab: async (name) => {
      const [tab] = await Promise.all([context.waitForEvent('page'), manager.evaluate((n) => { window[n] = window.open('https://carbot.ai/konnectlive/'); }, name || 'live')]);
      await tab.waitForLoadState();
      return tab;
    },
    // The bookmark: runs Work Tools on the page and does not wait for it.
    click: (page) => page.evaluate((code) => { Function(code)(); }, workTools),
    note: (page) => page.evaluate(() => { const n = document.getElementById('_workToolsSmallNote'); return n ? n.textContent : null; }),
    checker: (page) => page.evaluate(() => (window.__konnectLeadChecker ? (window.__konnectLeadChecker.getSession ? 'running' : 'login') : 'none')),
    running: (page, timeout = 20000) => page.waitForFunction(() => !!(window.__konnectLeadChecker && window.__konnectLeadChecker.getSession), null, { timeout }).then(() => true, () => false),
    msgs: (type) => manager.evaluate((x) => window.msgs.filter((m) => !x || m.type === `workTools:${x}`), type),
    waitFor: async (type, test, timeout = 30000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const hit = (await t.msgs(type)).find((m) => !test || test(m));
        if (hit) return hit;
        await manager.waitForTimeout(100);
      }
      return null;
    },
    close: () => context.close()
  };
  return t;
}

// The usual path, then a second click, then a small window that reloaded.
{
  const t = await openForWorkTools();
  const tab = await t.openTab();
  // The tab's own close is held back a moment, so it can be looked at first.
  await tab.evaluate(() => { const close = window.close.bind(window); window.close = () => { window.__closeAsked = true; setTimeout(close, 1500); }; });
  const [small] = await Promise.all([t.context.waitForEvent('page'), t.click(tab)]);
  check('the Lead Checker runs in the small window', await t.running(small), await t.checker(small).catch((e) => String(e)));
  const opens = await tab.evaluate(() => window.__opens);
  const features = (opens[0] || [])[2] || '';
  check('one small window is asked for, 520 by 420 at the bottom left', opens.length === 1 && opens[0][1] === 'workToolsLiveSmall' && /popup=yes/.test(features) && /width=520,height=420/.test(features) && /left=0,/.test(features) && /top=\d+$/.test(features), opens);
  check('the small window is on the same Konnect Live address and carries the name', /^https:\/\/carbot\.ai\/konnectlive\//.test(small.url()) && (await small.evaluate(() => window.name)) === 'workToolsLiveSmall', small.url());
  await tab.waitForFunction(() => window.__closeAsked, null, { timeout: 10000 }).catch(() => {});
  const left = await tab.evaluate(() => ({ asked: !!window.__closeAsked, checker: !!window.__konnectLeadChecker, panel: !!document.getElementById('_klcPanelHost'), badge: !!(document.getElementById('_klcNavItem') || document.getElementById('_klcBadge')), note: (document.getElementById('_workToolsSmallNote') || {}).textContent }));
  check('the tab does not run the Lead Checker and says where it is', left.asked && !left.checker && !left.panel && !left.badge && left.note === SMALL_DONE, left);
  if (!tab.isClosed()) await tab.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  check('the tab closes itself', tab.isClosed());
  const ready = await t.waitFor('ready');
  const from = await t.manager.evaluate(() => ({ list: window.readyFrom, tabClosed: window.live.closed, sourceOpen: !!window.lastSource && !window.lastSource.closed }));
  check('ready reaches SLA Manager from the small window, not the tab', ready && ready.state === 'idle' && from.list.length > 0 && from.list.every((x) => x === 'other') && from.tabClosed && from.sourceOpen, from);
  check('the small window shows the link', (await small.evaluate(() => document.getElementById('_klcPanelHost').shadowRoot.getElementById('linkLine').textContent)) === 'Konnect Live: linked, ready.');

  // A batch sent to the window that said ready, as SLA Manager sends it.
  await t.manager.evaluate((tsv) => window.lastSource.postMessage({ type: 'workTools:batch', id: 'sw1', kind: 'leads', tsv }, 'https://carbot.ai'), batch(3, 'sw'));
  const received = await t.waitFor('received');
  check('a batch sent to that window is received after the tab has gone', received && received.id === 'sw1' && received.rows === 3, received);
  const ended = await t.waitFor('ended', (m) => m.id === 'sw1', 60000);
  check('the batch runs to the end in the small window', ended && ended.reason === 'done' && (await small.evaluate(() => window.mock.searches.length)) === 3, ended);

  // The window's size and place are kept for next time.
  await small.evaluate(() => window.dispatchEvent(new Event('resize')));
  const kept = await small.evaluate(() => ({ box: JSON.parse(localStorage.getItem('_klcSmallWindowBox') || 'null'), width: window.innerWidth, height: window.innerHeight }));
  check('the small window keeps its size and place', kept.box && kept.box.width === kept.width && kept.box.height === kept.height && Number.isFinite(kept.box.left) && Number.isFinite(kept.box.top), kept);

  // A second click, on a new tab from SLA Manager, only shows the window.
  await small.evaluate(() => { window.__same = true; });
  const tab2 = await t.openTab('live2');
  const pagesBefore = t.context.pages().length;
  await t.click(tab2);
  await tab2.waitForFunction((text) => (document.getElementById('_workToolsSmallNote') || {}).textContent === text, SMALL_DONE, { timeout: 10000 }).catch(() => {});
  await tab2.waitForTimeout(1200);
  const second = { note: await t.note(tab2), pages: t.context.pages().length, same: await small.evaluate(() => window.__same === true && !!window.__konnectLeadChecker.getSession()), tabChecker: await t.checker(tab2), closed: tab2.isClosed() };
  check('a second click finds the window that is running and leaves it alone', second.note === SMALL_DONE && second.pages === pagesBefore && second.same && second.tabChecker === 'none' && !second.closed, second);

  // The small window reloaded and lost the Lead Checker: it is put in again.
  await small.reload();
  await small.waitForLoadState();
  await t.manager.evaluate(() => { window.msgs = []; window.readyFrom = []; });
  await t.click(tab2);
  check('after a reload the Lead Checker is put into the small window again', await t.running(small), await t.checker(small));
  const again = await t.waitFor('ready');
  if (!tab2.isClosed()) await tab2.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  check('it is linked again and the tab closes', !!again && (await t.manager.evaluate(() => window.readyFrom.every((x) => x === 'other'))) && tab2.isClosed() && t.context.pages().length === 2, t.context.pages().length);

  // The switch in the More menu.
  const host = small.locator('#_klcPanelHost');
  await small.evaluate(() => window.__konnectLeadChecker.focus());
  await host.locator('#moreBtn').click();
  check('More shows the small window as on', (await host.locator('#menuSmallWindow').textContent()).trim() === 'Small window: on');
  await host.locator('#menuSmallWindow').click();
  check('pressing it turns the small window off for the next click', (await host.locator('#menuSmallWindow').textContent()).trim() === 'Small window: off' && (await small.evaluate(() => localStorage.getItem('_klcSmallWindow'))) === 'off');
  await host.locator('#menuSmallWindow').click();
  check('and on again', (await small.evaluate(() => localStorage.getItem('_klcSmallWindow'))) === 'on' && (await host.locator('#menuSmallWindow').getAttribute('aria-checked')) === 'true');
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// Pop-up blocked: the tab runs the Lead Checker as before and says why.
{
  const t = await openForWorkTools();
  const tab = await t.openTab();
  await tab.evaluate(() => localStorage.setItem('_testBlockPopups', '1'));
  await t.click(tab);
  check('with the pop-up blocked the Lead Checker runs in the tab', await t.running(tab), await t.checker(tab));
  await tab.waitForFunction(() => !!document.getElementById('_workToolsSmallNote'), null, { timeout: 5000 }).catch(() => {});
  check('the tab says to allow pop-ups', /^Allow pop-ups for Konnect Live to use the small window/.test((await t.note(tab)) || ''), await t.note(tab));
  const ready = await t.waitFor('ready');
  check('the tab is linked as before', !!ready && (await t.manager.evaluate(() => window.readyFrom.every((x) => x === 'tab'))) && t.context.pages().length === 2 && !tab.isClosed(), t.context.pages().length);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// Switched off, and a Konnect Live tab opened by hand: both as before.
{
  const t = await openForWorkTools();
  const tab = await t.openTab();
  await tab.evaluate(() => localStorage.setItem('_klcSmallWindow', 'off'));
  await t.click(tab);
  check('switched off: the Lead Checker runs in the tab', await t.running(tab), await t.checker(tab));
  const off = { opens: await tab.evaluate(() => window.__opens.length), note: await t.note(tab), pages: t.context.pages().length, ready: !!(await t.waitFor('ready')) };
  check('switched off: no window is opened, nothing is said, the link is the tab', off.opens === 0 && off.note === null && off.pages === 2 && off.ready && (await t.manager.evaluate(() => window.readyFrom.every((x) => x === 'tab'))), off);
  const box = await tab.evaluate(() => [
    window.WorkTools.smallWindowBox(null, { availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875 }),
    window.WorkTools.smallWindowBox({ width: 5000, height: 50, left: -900, top: 99999 }, { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 800 }),
    window.WorkTools.smallWindowBox({ width: 600, height: 500, left: 300, top: 200 }, { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 800 })
  ]);
  check('the window is placed bottom left by default, and a kept size is held on the screen', JSON.stringify(box) === JSON.stringify([{ width: 520, height: 420, left: 0, top: 480 }, { width: 1280, height: 300, left: 0, top: 500 }, { width: 600, height: 500, left: 300, top: 200 }]), box);

  await tab.evaluate(() => localStorage.removeItem('_klcSmallWindow'));
  const own = await t.context.newPage();
  await own.goto('https://carbot.ai/konnectlive/');
  await t.click(own);
  check('opened by hand: the Lead Checker runs in that tab', await t.running(own), await t.checker(own));
  check('opened by hand: no window is opened and nothing is said', (await own.evaluate(() => window.__opens.length)) === 0 && (await t.note(own)) === null && t.context.pages().length === 3, t.context.pages().length);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// Konnect Live is on its login page: the tab stays until the small window
// is logged in and the Lead Checker has started there.
{
  const t = await openForWorkTools();
  const tab = await t.openTab();
  await tab.evaluate(() => localStorage.setItem('_testLoggedOut', '1'));
  const [small] = await Promise.all([t.context.waitForEvent('page'), t.click(tab)]);
  await small.waitForFunction(() => !!window.__konnectLeadChecker, null, { timeout: 20000 }).catch(() => {});
  await tab.waitForFunction(() => /Log in on the small window/.test((document.getElementById('_workToolsSmallNote') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const waiting = { small: await t.checker(small), tab: await t.checker(tab), note: await t.note(tab), closed: tab.isClosed(), ready: (await t.msgs('ready')).length };
  check('on the login page the small window waits for the login and the tab stays', waiting.small === 'login' && waiting.tab === 'none' && /^Log in on the small window/.test(waiting.note || '') && !waiting.closed && waiting.ready === 0, waiting);
  await small.evaluate(() => { localStorage.removeItem('_testLoggedOut'); window.mock.allowLogin = true; document.getElementById('loginBtn').click(); });
  check('after the login the Lead Checker starts in the small window', await t.running(small), await t.checker(small));
  if (!tab.isClosed()) await tab.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  const ready = await t.waitFor('ready');
  check('it is linked from the small window and the tab closes', !!ready && tab.isClosed() && (await t.manager.evaluate(() => window.readyFrom.every((x) => x === 'other'))), await t.manager.evaluate(() => window.readyFrom));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll Lead Checker link tests passed.' : `\n${failures} Lead Checker link test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
