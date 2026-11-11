#!/usr/bin/env node
// Browser tests for opening a customer by hand from the Lead Checker: the
// initials button on a result and on a Needs review card, the same thing
// asked for by SLA Manager over the link, and review decisions going back
// over the link. Runs against the mock Konnect Live page in
// tests/konnect-live-mock/, where Morgan Reedwell and Jo Tavistock have
// timelines with leads that open a lead window. Needs Playwright with
// Chromium. Run from the repo root:
//
//   node tests/lead-checker-open.e2e.mjs
//
// Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '..', 'Konnect-Lead-Checker.js'), 'utf8');
const livePage = readFileSync(join(here, 'konnect-live-mock', 'live.html'), 'utf8');
const managerPage = readFileSync(join(here, 'konnect-live-mock', 'manager.html'), 'utf8');

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return createRequire(join(globalRoot, 'noop.js'))('playwright');
}
const { chromium } = await loadPlaywright();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log(`pass  ${name}`); }
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ''}`); }
}

const HEADER = 'Name\tPhone\tEmail\tSource\tCampaign\tCreated';
const ROWS = [
  ['Morgan Reedwell', '', 'morgan.reedwell@example.com', 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 09:05'],
  ['Morgan Reedwell', '', 'morgan.reedwell@example.com', 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 16:40'],
  ['Pat Noneson', '', 'pat.noneson@example.com', 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 09:05'],
  ['Jo Tavistock', '', 'jo.tavistock@example.com', 'Robins & Day Website', 'Peugeot - Enquiry - New', 'Sun, 8 Nov 2026 11:30'],
  ['Sam Example4', '', 'sam4@example.com', 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 09:05'],
  ['', '', 'none5@example.com', 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 09:05'],
  ['Sam Example6', '', 'sam6@example.com', 'Customer First', 'Enquiry - New', 'Tue, 10 Nov 2026 09:05']
];
const BATCH = [HEADER].concat(ROWS.map((r) => r.join('\t'))).join('\n');
const EXPECTED = ['CLASSIFIED', 'TARGET_CREATED_DATETIME_NOT_FOUND', 'SEARCH_NO_RESULTS', 'CLASSIFICATION_REVIEW_REQUIRED', 'NO_ELIGIBLE_LEAD_EVENTS', 'SEARCH_NO_RESULTS', 'NO_ELIGIBLE_LEAD_EVENTS'];

const browser = await chromium.launch();

async function openLinked() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://carbot.ai' });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://carbot.ai/konnectlive')) return route.fulfill({ contentType: 'text/html', body: livePage });
    if (url.startsWith('https://konnectonlineservices.co.uk')) return route.fulfill({ contentType: 'text/html', body: managerPage });
    return route.abort();
  });
  const manager = await context.newPage();
  await manager.goto('https://konnectonlineservices.co.uk/manager');
  const [live] = await Promise.all([context.waitForEvent('page'), manager.evaluate(() => { window.live = window.open('https://carbot.ai/konnectlive/'); })]);
  await live.waitForLoadState();
  await live.bringToFront();
  const errors = [];
  live.on('pageerror', (e) => errors.push(e.message));
  // Records whether the dark run overlay was ever put up.
  await live.evaluate(() => {
    window.__sawOverlay = false;
    new MutationObserver(() => { if (document.getElementById('_klcPageFlashOverlay')) window.__sawOverlay = true; }).observe(document.documentElement, { childList: true });
  });
  await live.addScriptTag({ content: script });
  await live.waitForTimeout(300);
  await live.evaluate(() => window.__konnectLeadChecker.focus());
  const t = {
    context, manager, live, errors,
    msgs: (type) => manager.evaluate((x) => window.msgs.filter((m) => !x || m.type === `workTools:${x}`), type),
    clearMsgs: () => manager.evaluate(() => { window.msgs = []; }),
    send: (message) => manager.evaluate((m) => window.send(m), message),
    waitFor: async (type, test, timeout = 30000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const hit = (await t.msgs(type)).find((m) => !test || test(m));
        if (hit) return hit;
        await live.waitForTimeout(100);
      }
      return null;
    },
    panel: (selector) => live.locator('#_klcPanelHost').locator(selector),
    state: () => live.evaluate(() => document.getElementById('_klcPanelHost').shadowRoot.getElementById('curState').textContent),
    waitState: (pattern, timeout = 30000) => live.waitForFunction((source) => new RegExp(source).test(document.getElementById('_klcPanelHost').shadowRoot.getElementById('curState').textContent), pattern.source, { timeout }).then(() => true, () => false),
    snapshot: () => live.evaluate(() => { const s = window.__konnectLeadChecker.getSession(); return s ? JSON.stringify({ results: s.results, groupIndex: s.groupIndex, rowInGroupIndex: s.rowInGroupIndex, paused: s.paused, done: s.done, cancelled: s.cancelled }) : null; }),
    outcomes: () => live.evaluate(() => { const s = window.__konnectLeadChecker.getSession(); return s.rows.map((r) => { const x = s.results[r.inputIndex]; return x ? (x.exception || x.status) : null; }); }),
    page: () => live.evaluate(() => { const m = document.querySelectorAll('.modal.in'); return { hash: location.hash, modals: m.length, lead: m[0] ? m[0].dataset.leadId : null, overlay: !!document.getElementById('_klcPageFlashOverlay'), sawOverlay: window.__sawOverlay, busy: window.__klcShared.stepBusy }; }),
    avatar: (key, review) => t.panel(`${review ? '#needsReviewSection' : '#resultsBody'} .avatar-btn[data-open-key="${key}"]`),
    runToEnd: async (id) => {
      await t.send({ type: 'workTools:batch', id, kind: 'leads', tsv: BATCH });
      return t.waitFor('ended', (m) => m.id === id, 90000);
    },
    close: () => context.close()
  };
  return t;
}
const OPEN_ROW = { name: 'Morgan Reedwell', phone: '', email: 'morgan.reedwell@example.com', source: 'Customer First', campaign: 'Enquiry - New', created: 'Tue, 10 Nov 2026 09:05' };

// ------------------------------------------------------------------
// 1. Asked for by SLA Manager with no batch loaded at all.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.send({ type: 'workTools:open', row: OPEN_ROW });
  const opened = await t.waitFor('opened');
  const page = await t.page();
  check('open over the link, no batch loaded: answered ok with the state line text', opened && opened.ok === true && opened.lead === true && opened.text === 'Morgan Reedwell is open: timeline and lead.', opened);
  check('the customer and that lead are open, no overlay, lock let go', /connectedCustomer\/700200/.test(page.hash) && page.modals === 1 && page.lead === '1386301' && !page.sawOverlay && !page.busy, page);
  check('the state line says the same', (await t.state()) === 'Morgan Reedwell is open: timeline and lead.', await t.state());
  check('no batch was made for it and the link still says idle', (await t.snapshot()) === null && (await t.msgs('ready')).every((m) => m.state === 'idle' && m.batchId === null), await t.msgs('ready'));

  await t.clearMsgs();
  await t.send({ type: 'workTools:open', id: 'o2', row: { name: 'Pat Noneson', email: 'pat.noneson@example.com', created: 'Tue, 10 Nov 2026 09:05' } });
  const none = await t.waitFor('opened');
  check('open over the link for someone not on Konnect: ok false, and the id is echoed', none && none.ok === false && none.id === 'o2' && none.text === 'No customer found for Pat Noneson.', none);
  check('the lead window from before was closed', (await t.page()).modals === 0, await t.page());

  await t.clearMsgs();
  await t.send({ type: 'workTools:open', row: Object.assign({}, OPEN_ROW, { created: 'Tue, 10 Nov 2026 16:40' }) });
  const timelineOnly = await t.waitFor('opened');
  check('open over the link, lead not on the timeline: ok, lead false', timelineOnly && timelineOnly.ok === true && timelineOnly.lead === false && timelineOnly.text === 'Morgan Reedwell is open, timeline only: the lead for 10 Nov 2026 16:40 was not found.', timelineOnly);
  await t.live.waitForTimeout(400);
  check('each request is answered once', (await t.msgs('opened')).length === 1, await t.msgs('opened'));

  await t.clearMsgs();
  await t.live.evaluate((row) => window.postMessage({ type: 'workTools:open', row }, '*'), OPEN_ROW);
  await t.live.waitForTimeout(800);
  check('an open request from another window is ignored', (await t.msgs('opened')).length === 0 && (await t.page()).modals === 0);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 2. A finished batch: the initials on results and on a Needs review card.
// ------------------------------------------------------------------
let finishedOutcomes = null;
{
  const t = await openLinked();
  const ended = await t.runToEnd('a1');
  finishedOutcomes = await t.outcomes();
  check('the batch runs on the mock: a lead is read and classified, one needs review', ended && ended.reason === 'done' && JSON.stringify(finishedOutcomes) === JSON.stringify(EXPECTED), finishedOutcomes);
  check('the run closed every lead window it opened', (await t.page()).modals === 0, await t.page());
  await t.live.evaluate(() => { window.__sawOverlay = false; });
  await t.clearMsgs();
  const before = await t.snapshot();

  const button = await t.avatar(0).evaluate((el) => ({ tag: el.tagName, type: el.type, title: el.title, label: el.getAttribute('aria-label'), text: el.textContent, tab: el.tabIndex }));
  check('the initials are a real button with a name', button.tag === 'BUTTON' && button.type === 'button' && button.title === 'Open Morgan Reedwell on Konnect Live' && button.label === button.title && button.text === 'MR' && button.tab === 0, button);

  await t.live.evaluate(() => { window.mock.searchDelay = 500; });
  await t.avatar(0).click();
  check('progress shows while it opens', (await t.state()) === 'Opening Morgan Reedwell...', await t.state());
  check('the button is marked busy', await t.avatar(0).evaluate((el) => el.classList.contains('opening') && el.getAttribute('aria-busy') === 'true'));
  check('customer and lead open', await t.waitState(/^Morgan Reedwell is open: timeline and lead\.$/), await t.state());
  let page = await t.page();
  check('the right customer and lead window are open and stay open', /connectedCustomer\/700200/.test(page.hash) && page.modals === 1 && page.lead === '1386301', page);
  check('no dark overlay was shown and the lock was let go', !page.sawOverlay && !page.overlay && !page.busy, page);
  check('the row was not folded open by the press', await t.panel('#resultsBody .customer[data-key="0"]').evaluate((el) => !el.classList.contains('open')));
  check('results and position are unchanged', (await t.snapshot()) === before);
  await t.live.evaluate(() => { window.mock.searchDelay = 120; });

  await t.panel('#resultsBody details.tier[data-key="7"] > summary').click();
  await t.avatar(1).click();
  check('lead not on the timeline: timeline only, said plainly', await t.waitState(/^Morgan Reedwell is open, timeline only: the lead for 10 Nov 2026 16:40 was not found\.$/), await t.state());
  page = await t.page();
  check('the timeline is open with no lead window (the earlier one was closed, none guessed)', /connectedCustomer\/700200/.test(page.hash) && page.modals === 0, page);

  await t.avatar(2).click();
  check('customer not found', await t.waitState(/^No customer found for Pat Noneson\.$/), await t.state());

  // Keyboard: focus the button, press Enter.
  await t.avatar(0).focus();
  await t.live.keyboard.press('Enter');
  check('Enter on the initials opens the customer', await t.waitState(/^Morgan Reedwell is open: timeline and lead\.$/), await t.state());
  const focus = await t.live.evaluate(() => { const a = document.getElementById('_klcPanelHost').shadowRoot.activeElement; return { key: a && a.dataset.openKey, ring: a ? getComputedStyle(a).outlineStyle : '', rowOpen: !!a && a.closest('.customer').classList.contains('open') }; });
  check('focus stays on the initials with a visible ring, and the row did not fold open', focus.key === '0' && focus.ring === 'solid' && !focus.rowOpen, focus);

  // Needs review card.
  await t.panel('details.review-section > summary').click();
  const reviewButton = await t.avatar(3, true).evaluate((el) => ({ tag: el.tagName, title: el.title }));
  check('a Needs review card has the same button', reviewButton.tag === 'BUTTON' && reviewButton.title === 'Open Jo Tavistock on Konnect Live', reviewButton);
  await t.panel('.review-row[data-key="3"] .review-reason').fill('warranty question first');
  await t.avatar(3, true).click();
  check('it opens that customer and lead', await t.waitState(/^Jo Tavistock is open: timeline and lead\.$/), await t.state());
  page = await t.page();
  check('Jo Tavistock and the lead are open, panel still usable', /connectedCustomer\/700300/.test(page.hash) && page.lead === '1386400' && !page.sawOverlay, page);
  check('the Needs review section stayed open and kept what was typed', await t.live.evaluate(() => { const root = document.getElementById('_klcPanelHost').shadowRoot; return root.querySelector('details.review-section').open && root.querySelector('.review-row[data-key="3"] .review-reason').value === 'warranty question first'; }));
  check('still nothing changed in the batch', (await t.snapshot()) === before);
  const quiet = await t.msgs();
  check('nothing was sent over the link by opening customers', quiet.every((m) => m.type === 'workTools:ready' && m.state === 'idle'), quiet.map((m) => [m.type, m.state]));

  // Review decisions go back by themselves.
  await t.panel('.review-row[data-key="3"] button.accept').click();
  const review = await t.waitFor('review');
  await t.panel('#btnCopyReviewDecisions').click();
  await t.live.waitForTimeout(200);
  const copied = await t.live.evaluate(() => navigator.clipboard.readText());
  const reviewLines = review ? review.tsv.split('\n') : [];
  check('Accept sends the review decisions to the opener: header plus the decision', reviewLines.length === 2 && /^InitialNotes\tTier\t/.test(reviewLines[0]) && /warranty question first/.test(reviewLines[1]), reviewLines);
  check('it is exactly what Copy review decisions copies', !!review && review.tsv === copied, copied);
  check('the lead window is still open after the decision', (await t.page()).lead === '1386400', await t.page());
  await t.clearMsgs();
  await t.panel('#resultsBody .customer[data-key="3"] .customer-summary').click();
  await t.panel('#resultsBody .undo-review').click();
  const undone = await t.waitFor('review');
  check('undo sends them again: now the header alone', undone && undone.tsv.split('\n').length === 1 && /^InitialNotes\t/.test(undone.tsv), undone);

  // Two quick presses: the second replaces the first, they never overlap.
  await t.live.evaluate(() => { window.mock.searchDelay = 700; window.mock.modalOpens = []; window.mock.searches = []; window.__maxBusyOwners = 0; });
  await t.avatar(0).click();
  await t.live.waitForTimeout(150);
  await t.avatar(3, true).click();
  check('the second press takes over the state line', (await t.state()) === 'Opening Jo Tavistock...', await t.state());
  check('and ends with the second customer open', await t.waitState(/^Jo Tavistock is open: timeline and lead\.$/), await t.state());
  await t.live.waitForTimeout(600);
  page = await t.page();
  const trail = await t.live.evaluate(() => ({ modalOpens: window.mock.modalOpens, searches: window.mock.searches }));
  check('only the second lead window was opened, after the first search was let finish', page.modals === 1 && page.lead === '1386400' && trail.modalOpens.join() === '1386400' && trail.searches.length === 2 && /reedwell/.test(trail.searches[0]) && /tavistock/.test(trail.searches[1]) && !page.busy, [page, trail]);
  check('the state line still says the second customer', (await t.state()) === 'Jo Tavistock is open: timeline and lead.', await t.state());
  await t.live.evaluate(() => { window.mock.searchDelay = 120; });

  // Asked for by SLA Manager with a finished batch loaded.
  await t.clearMsgs();
  const before2 = await t.snapshot();
  await t.send({ type: 'workTools:open', row: OPEN_ROW });
  const opened = await t.waitFor('opened');
  check('open over the link on a finished batch works and changes nothing', opened && opened.ok === true && opened.text === 'Morgan Reedwell is open: timeline and lead.' && (await t.snapshot()) === before2 && (await t.page()).lead === '1386301', opened);

  // Logged out.
  await t.live.evaluate(() => window.mock.logOut());
  await t.avatar(0).click();
  await t.live.waitForTimeout(300);
  check('logged out: said straight away, nothing is searched', /^Konnect Live is logged out\./.test(await t.state()) && !(await t.page()).busy, await t.state());
  await t.clearMsgs();
  await t.send({ type: 'workTools:open', row: OPEN_ROW });
  const out = await t.waitFor('opened', null, 5000);
  check('logged out over the link: ok false with the reason', out && out.ok === false && /^Konnect Live is logged out\./.test(out.text), out);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 3. During a run: refused. Paused: allowed, and Resume carries on right.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.live.evaluate(() => { window.mock.searchDelay = 900; });
  await t.send({ type: 'workTools:batch', id: 'r1', kind: 'leads', tsv: BATCH });
  await t.waitFor('ready', (m) => m.state === 'running');
  // Rows 0 and 1 done, the third customer's search in flight.
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return s && Object.keys(s.results).length === 2 && window.mock.searches.length === 2; }, null, { timeout: 30000 });
  let before = await t.snapshot();
  const searchesBefore = await t.live.evaluate(() => window.mock.searches.length);
  await t.avatar(0).click({ force: true });
  check('a press during a run is refused in the state line', (await t.state()) === 'The Lead Checker is checking a batch. Pause it or wait, then try again.', await t.state());
  await t.send({ type: 'workTools:open', row: OPEN_ROW });
  const refused = await t.waitFor('opened', null, 5000);
  check('an open request during a run is refused over the link', refused && refused.ok === false && refused.text === 'The Lead Checker is checking a batch. Pause it or wait, then try again.', refused);
  check('the run was not disturbed', (await t.live.evaluate(() => window.mock.searches.length)) === searchesBefore && (await t.snapshot()) === before && (await t.page()).busy === true);

  // Pause while the step is still in flight: still refused until it lands.
  await t.panel('#btnPauseResume').click();
  await t.avatar(0).click({ force: true });
  check('paused, but the lead in flight has not finished: refused', /still finishing/.test(await t.state()), await t.state());
  await t.live.waitForFunction(() => !window.__klcShared.stepBusy, null, { timeout: 30000 });
  await t.live.waitForTimeout(400);
  check('the overlay is down while paused', !(await t.page()).overlay);
  await t.live.evaluate(() => { window.__sawOverlay = false; window.mock.searchDelay = 120; });
  before = await t.snapshot();
  await t.clearMsgs();
  await t.avatar(0).click();
  check('paused: the customer and lead open', await t.waitState(/^Morgan Reedwell is open: timeline and lead\.$/), await t.state());
  let page = await t.page();
  check('lead window open, no overlay', page.lead === '1386301' && !page.sawOverlay && !page.busy, page);
  check('results, groupIndex and rowInGroupIndex are unchanged, still paused', (await t.snapshot()) === before, [before, await t.snapshot()]);
  const during = await t.msgs();
  check('the link state did not change', during.every((m) => m.type === 'workTools:ready' && m.state === 'paused'), during.map((m) => [m.type, m.state]));

  await t.live.evaluate(() => { window.mock.searches = []; });
  await t.panel('#btnPauseResume').click();
  const ended = await t.waitFor('ended', null, 60000);
  const outcomes = await t.outcomes();
  const searches = await t.live.evaluate(() => window.mock.searches.slice());
  check('Resume finishes the batch with the same results as an unbroken run', ended && ended.reason === 'done' && JSON.stringify(outcomes) === JSON.stringify(finishedOutcomes), outcomes);
  check('the run opened its own customers again: each remaining lead searched once, none for the one opened by hand', searches.length === 4 && !searches.some((s) => /reedwell/.test(s)), searches);
  check('the lead window left open by hand was closed by the run', (await t.page()).modals === 0, await t.page());
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 4. Half way through a customer (Check one lead), another customer is
//    opened by hand and Start is pressed while it is still opening: the
//    run takes over and opens its own customer again.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  await t.live.evaluate((text) => navigator.clipboard.writeText(text), BATCH);
  await t.panel('#autoStartToggle').uncheck();
  await t.panel('#btnPasteClipboard').click();
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return s && s.rows.length === 7; });
  await t.panel('#btnProcessNext').click();
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return Object.keys(s.results).length === 1 && !window.__klcShared.stepBusy; }, null, { timeout: 30000 });
  await t.live.waitForTimeout(300);
  const position = () => t.live.evaluate(() => { const s = window.__konnectLeadChecker.getSession(); return [s.groupIndex, s.rowInGroupIndex]; });
  check('after one lead the run is half way through the first customer', (await position()).join() === '0,1', await position());
  // Open someone else by hand over the link, so the page leaves that customer.
  await t.send({ type: 'workTools:open', row: { name: 'Jo Tavistock', email: 'jo.tavistock@example.com', source: 'Robins & Day Website', campaign: 'Peugeot - Enquiry - New', created: 'Sun, 8 Nov 2026 11:30' } });
  const opened = await t.waitFor('opened');
  check('another customer opened by hand', opened && opened.ok && (await t.page()).lead === '1386400', opened);
  check('the position did not move', (await position()).join() === '0,1', await position());
  // Now a press, and Start while it is still searching.
  await t.live.evaluate(() => { window.mock.searchDelay = 800; window.mock.searches = []; });
  await t.clearMsgs();
  await t.send({ type: 'workTools:open', id: 'late', row: OPEN_ROW });
  await t.live.waitForFunction(() => window.mock.searches.length === 1);
  await t.live.evaluate(() => { window.mock.searchDelay = 120; });
  await t.panel('#btnStart').click();
  const gaveWay = await t.waitFor('opened', (m) => m.id === 'late', 20000);
  check('the open gives way to the run and says so, once', gaveWay && gaveWay.ok === false && gaveWay.text === 'The Lead Checker is checking a batch. Pause it or wait, then try again.', gaveWay);
  await t.live.waitForFunction(() => window.__konnectLeadChecker.getSession().done, null, { timeout: 60000 });
  await t.live.waitForTimeout(300);
  const outcomes = await t.outcomes();
  const searches = await t.live.evaluate(() => window.mock.searches.slice());
  check('the run reopened its own customer and every result is right', JSON.stringify(outcomes) === JSON.stringify(finishedOutcomes) && searches.filter((s) => /reedwell/.test(s)).length === 2, [outcomes, searches]);
  check('one answer for the request that gave way', (await t.msgs('opened')).length === 1, await t.msgs('opened'));
  check('no lead window is left open and the overlay is gone', (await t.page()).modals === 0 && !(await t.page()).overlay, await t.page());
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 5. The other two kinds of batch: Post Closure list and National.
// ------------------------------------------------------------------
{
  const t = await openLinked();
  const pcList = ['Name\tMagic Num\tBest Number\tEmail\tCampaign\tDealer', 'Morgan Reedwell\t1\t\tmorgan.reedwell@example.com\tEnquiry - Used\tPreston', 'Jo Tavistock\t2\t\tjo.tavistock@example.com\tEnquiry - Used\tPreston'].join('\n');
  await t.send({ type: 'workTools:batch', id: 'pc1', kind: 'leads', tsv: pcList });
  await t.waitFor('ended', (m) => m.id === 'pc1', 60000);
  const pcOutcomes = await t.live.evaluate(() => { const s = window.__konnectLeadChecker.getSession(); return [s.mode].concat(s.rows.map((r) => { const x = s.results[r.inputIndex]; return x.exception || x.postClosureAction; })); });
  check('a Post Closure list runs on the mock', pcOutcomes.join('|') === 'postClosureList|check: needs contact?|POST_CLOSURE_LEAD_NOT_FOUND', pcOutcomes);
  await t.avatar(0).click();
  check('Post Closure list: the newest Post Closure lead is opened', await t.waitState(/^Morgan Reedwell is open: timeline and lead\.$/) && (await t.page()).lead === '1386302', [await t.state(), await t.page()]);
  await t.panel('#resultsBody details.tier[data-key="7"] > summary').click();
  await t.avatar(1).click();
  check('Post Closure list: no Post Closure lead, timeline only', await t.waitState(/^Jo Tavistock is open, timeline only: the newest Post Closure lead was not found\.$/) && (await t.page()).modals === 0, await t.state());
  const badge = await t.panel('#resultsBody .customer[data-key="0"] .category-badge').evaluate((el) => ({ title: el.title, text: el.textContent }));
  check('a Post Closure badge carries its full text in a title', badge.title === badge.text && badge.title.length > 0, badge);

  const NATIONAL = 'NationalCheck\tCustomer\tReg\tActivityID\tLeadCreated\tCampaign\tDealer\tLastContact\tState\tExportOutcome\tAttempts\tManualReschedules\tAutoReschedules\tExportHint';
  const national = [NATIONAL,
    ['national', 'Morgan Reedwell', 'AB12CDE', '70000001SALES', '10/11/2026 09:05', 'Enquiry - New', 'National', '10/11/2026 11:42', 'Closed', 'Email Only Lead', '1', '0', '0', ''].join('\t'),
    ['national', 'Morgan Reedwell', 'AB12CDE', '70000002SALES', '07/11/2026 08:00', 'Enquiry - New', 'National', '', 'Closed', 'Email Only Lead', '1', '0', '0', ''].join('\t')
  ].join('\n');
  await t.send({ type: 'workTools:batch', id: 'n1', kind: 'national', tsv: national });
  await t.waitFor('ended', (m) => m.id === 'n1', 60000);
  const verdicts = await t.live.evaluate(() => { const s = window.__konnectLeadChecker.getSession(); return [s.mode].concat(s.rows.map((r) => s.results[r.inputIndex].verdict)); });
  check('a National batch runs on the mock', verdicts.join('|') === 'national|Re setup|Not found', verdicts);
  await t.avatar(0).click();
  check('National: the lead created at that time is opened', await t.waitState(/^Morgan Reedwell is open: timeline and lead\.$/) && (await t.page()).lead === '1386301', [await t.state(), await t.page()]);
  await t.avatar(1).click();
  check('National: no lead at that time, timeline only', await t.waitState(/^Morgan Reedwell is open, timeline only: the lead for 07\/11\/2026 08:00 was not found\.$/) && (await t.page()).modals === 0, await t.state());
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

await browser.close();
console.log(failures === 0 ? `\nAll ${passes} Lead Checker open tests passed.` : `\n${failures} Lead Checker open test(s) FAILED (${passes} passed).`);
process.exit(failures === 0 ? 0 : 1);
