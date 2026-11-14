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

async function openLinked(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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
    // A control kept in the More menu: the menu is opened first.
    more: async (selector) => {
      if (await live.evaluate(() => document.getElementById('_klcPanelHost').shadowRoot.getElementById('moreMenu').classList.contains('hidden'))) await t.panel('#moreBtn').click();
      return t.panel(selector);
    },
    closeMore: async () => {
      if (await live.evaluate(() => !document.getElementById('_klcPanelHost').shadowRoot.getElementById('moreMenu').classList.contains('hidden'))) await t.panel('#moreBtn').click();
    },
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

  // Older entries: a long timeline scrolled to its newest entry. Where the
  // page's own list matches what is drawn, nothing is scrolled or waited for.
  await t.live.evaluate(() => { window.mock.tall = true; });
  await t.clearMsgs();
  await t.send({ type: 'workTools:open', row: OPEN_ROW });
  await t.waitFor('opened');
  const older = async () => t.live.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    const before = window.scrollY;
    const started = performance.now();
    const result = await window.KonnectLeadChecker.loadOlderTimelineEntries();
    return { ms: Math.round(performance.now() - started), moved: window.scrollY !== before, before, drawn: window.KonnectLeadChecker.timelineFullyDrawn(), loaded: result.loadedNewEntries };
  });
  const whole = await older();
  check('a whole history already drawn is not scrolled or waited for', whole.before > 0 && whole.drawn === true && whole.moved === false && whole.ms < 150 && whole.loaded === false, whole);
  await t.live.evaluate(() => { window.mock.listShort = true; });
  const more = await older();
  check('a list holding more than is drawn is still scrolled for older entries', more.drawn === false && more.moved === true && more.ms >= 350, more);
  await t.live.evaluate(() => { window.mock.listShort = false; window.mock.noList = true; });
  const unknown = await older();
  check('and so is one the page cannot vouch for', unknown.drawn === false && unknown.moved === true, unknown);
  await t.live.evaluate(() => { window.mock.noList = false; window.mock.tall = false; document.querySelectorAll('.modal').forEach((m) => m.remove()); });

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

  check('Could not check is shown open, with the reason on the row', await t.panel('#resultsBody details.tier[data-key="7"]').evaluate((el) => el.open && /Couldn't find a lead at that time/.test(el.querySelector('.customer[data-key="1"] .customer-meta').textContent)));
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
  await t.panel('#btnReview').click();
  check('Review opens the Needs review cards in place of the results', await t.live.evaluate(() => { const root = document.getElementById('_klcPanelHost').shadowRoot; return !!root.querySelector('.review-row.open[data-key="3"]') && root.getElementById('resultsBody').classList.contains('hidden'); }));
  const reviewButton = await t.avatar(3, true).evaluate((el) => ({ tag: el.tagName, title: el.title }));
  check('a Needs review card has the same button', reviewButton.tag === 'BUTTON' && reviewButton.title === 'Open Jo Tavistock on Konnect Live', reviewButton);
  await t.panel('.review-row[data-key="3"] [data-show-tiers]').click();
  await t.panel('.review-row[data-key="3"] .review-subcategory').fill('Aftersales first');
  await t.avatar(3, true).click();
  check('it opens that customer and lead', await t.waitState(/^Jo Tavistock is open: timeline and lead\.$/), await t.state());
  page = await t.page();
  check('Jo Tavistock and the lead are open, panel still usable', /connectedCustomer\/700300/.test(page.hash) && page.lead === '1386400' && !page.sawOverlay, page);
  check('the Needs review section stayed open and kept what was typed', await t.live.evaluate(() => { const root = document.getElementById('_klcPanelHost').shadowRoot; return !!root.querySelector('.review-row.open[data-key="3"] .review-tiers') && root.querySelector('.review-row[data-key="3"] .review-subcategory').value === 'Aftersales first'; }));
  check('still nothing changed in the batch', (await t.snapshot()) === before);
  const quiet = await t.msgs();
  check('nothing was sent over the link by opening customers', quiet.every((m) => m.type === 'workTools:ready' && m.state === 'idle'), quiet.map((m) => [m.type, m.state]));

  // Review decisions go back by themselves.
  await t.panel('.review-row[data-key="3"] [data-hide-tiers]').click();
  await t.panel('.review-row[data-key="3"] button.accept').click();
  const first = await t.waitFor('review');
  check('Accept sends the decision straight away, and the card turns to Decided', !!first && first.tsv.split('\n').length === 2 && await t.panel('.review-row.decided[data-key="3"]').count() === 1, first);
  // The Why is asked for after the decision and goes back the same way.
  await t.clearMsgs();
  await t.panel('.review-row[data-key="3"] .review-reason').fill('warranty question first');
  await t.live.keyboard.press('Enter');
  const review = await t.waitFor('review');
  await (await t.more('#btnCopyReviewDecisions')).click();
  await t.live.waitForTimeout(200);
  const copied = await t.live.evaluate(() => navigator.clipboard.readText());
  const reviewLines = review ? review.tsv.split('\n') : [];
  check('Accept sends the review decisions to the opener: header plus the decision', reviewLines.length === 2 && /^InitialNotes\tTier\t/.test(reviewLines[0]) && /warranty question first/.test(reviewLines[1]), reviewLines);
  check('it is exactly what Copy review decisions copies', !!review && review.tsv === copied, copied);
  check('the lead window is still open after the decision', (await t.page()).lead === '1386400', await t.page());
  await t.clearMsgs();
  await t.closeMore();
  await t.panel('#btnBackToResults').click();
  await t.panel('#resultsBody .customer[data-key="3"] .customer-summary').click();
  await t.panel('#resultsBody .undo-review').click();
  const undone = await t.waitFor('review');
  check('undo sends them again: now the header alone', undone && undone.tsv.split('\n').length === 1 && /^InitialNotes\t/.test(undone.tsv), undone);

  // Two quick presses: the second replaces the first, they never overlap.
  await t.live.evaluate(() => { window.mock.searchDelay = 700; window.mock.modalOpens = []; window.mock.searches = []; window.__maxBusyOwners = 0; });
  await t.avatar(0).click();
  await t.panel('#btnReview').click();
  await t.avatar(3, true).click();
  check('the second press takes over the state line', (await t.state()) === 'Opening Jo Tavistock...', await t.state());
  check('and ends with the second customer open', await t.waitState(/^Jo Tavistock is open: timeline and lead\.$/), await t.state());
  await t.live.waitForTimeout(600);
  page = await t.page();
  const trail = await t.live.evaluate(() => ({ modalOpens: window.mock.modalOpens, searches: window.mock.searches }));
  check('only the second lead window was opened, after the first search was let finish', page.modals === 1 && page.lead === '1386400' && trail.modalOpens.join() === '1386400' && trail.searches.length === 2 && /reedwell/.test(trail.searches[0]) && /tavistock/.test(trail.searches[1]) && !page.busy, [page, trail]);
  check('the state line still says the second customer', (await t.state()) === 'Jo Tavistock is open: timeline and lead.', await t.state());
  await t.live.evaluate(() => { window.mock.searchDelay = 120; });
  await t.panel('#btnBackToResults').click();

  // Asked for by SLA Manager with a finished batch loaded.
  await t.clearMsgs();
  const before2 = await t.snapshot();
  await t.send({ type: 'workTools:open', row: OPEN_ROW });
  const opened = await t.waitFor('opened');
  check('open over the link on a finished batch works and changes nothing', opened && opened.ok === true && opened.text === 'Morgan Reedwell is open: timeline and lead.' && (await t.snapshot()) === before2 && (await t.page()).lead === '1386301', opened);

  // Logged out.
  // The wait for a log in is cut short for the test; the mock refuses the press.
  await t.live.evaluate(() => { window.__klcShared.loginForRequestMs = 1200; window.mock.logOut(); });
  await t.avatar(0).click();
  await t.live.waitForTimeout(300);
  check('logged out: said straight away while it tries to log in, nothing is searched', /^Konnect Live is logged out\. Logging in/.test(await t.state()) && !(await t.page()).busy, await t.state());
  await t.live.waitForTimeout(1800);
  check('still logged out after the wait: it says to log in', /^Konnect Live is logged out\. Log in, then try again\.$/.test(await t.state()), await t.state());
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
  await (await t.more('#autoStartToggle')).uncheck();
  await t.closeMore();
  check('the paste box is folded to one row until it is asked for', await t.panel('#topSection').evaluate((el) => !el.open));
  await t.panel('#topSection > summary').click();
  await t.panel('#btnPasteClipboard').click();
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return s && s.rows.length === 7; });
  await (await t.more('#btnProcessNext')).click();
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
  await t.avatar(1).click();
  check('Post Closure list: no Post Closure lead, timeline only', await t.waitState(/^Jo Tavistock is open, timeline only: the newest Post Closure lead was not found\.$/) && (await t.page()).modals === 0, await t.state());
  const badge = await t.panel('#resultsBody .customer[data-key="0"] .tag').evaluate((el) => ({ title: el.title, text: el.textContent }));
  check('a Post Closure tag is short and carries its full text in a title', /^(send back through|check: needs contact\?)/.test(badge.title) && /^(Send back|Check)/.test(badge.text), badge);

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
  // The customer's two leads are one row: the second lead's button is inside it.
  await t.panel('#resultsBody .customer[data-key="0"] .customer-summary').click();
  await t.avatar(1).click();
  check('National: no lead at that time, timeline only', await t.waitState(/^Morgan Reedwell is open, timeline only: the lead for 07\/11\/2026 08:00 was not found\.$/) && (await t.page()).modals === 0, await t.state());
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// ------------------------------------------------------------------
// 6. The booking check SLA Manager asks for: the timeline is read, the
//    lead window is never opened, and no batch or link state changes.
// ------------------------------------------------------------------
const VERIFY_ROW = { name: 'Casey Bookwell', phone: '07700 900323', email: 'casey.bookwell@example.com' };
// The mock's times are read as this machine's clock, as the page's are.
const at = (day, hour, minute) => new Date(2026, 10, day, hour, minute).toISOString();
const RUN_BUSY = 'The Lead Checker is checking a batch. Pause it or wait, then try again.';
{
  const t = await openLinked();
  await t.send({ type: 'workTools:verify', id: 'bk-1', row: VERIFY_ROW, since: at(13, 10, 0) });
  const all = await t.waitFor('verified');
  check('verify on an idle page: found, with all three results and the id', all && all.id === 'bk-1' && all.ok === true && all.found === true && all.appointment === true && all.outcome === true && all.sent === true && all.text === 'Casey Bookwell: in the diary, outcome set, sent to the dealership.', all);
  let page = await t.page();
  const opens = await t.live.evaluate(() => window.mock.modalOpens.length);
  check('the timeline was opened, never a lead window, no overlay, lock let go', /connectedCustomer\/700400/.test(page.hash) && page.modals === 0 && opens === 0 && !page.sawOverlay && !page.busy, [page, opens]);
  await t.live.waitForTimeout(500);
  check('it is answered once', (await t.msgs('verified')).length === 1, await t.msgs('verified'));
  check('no batch was made for it and the link still says idle', (await t.snapshot()) === null && (await t.msgs('ready')).every((m) => m.state === 'idle' && m.batchId === null), await t.msgs('ready'));
  check('nothing else was sent', (await t.msgs()).every((m) => m.type === 'workTools:ready' || m.type === 'workTools:verified'), (await t.msgs()).map((m) => m.type));

  await t.clearMsgs();
  await t.send({ type: 'workTools:verify', id: 'bk-2', row: VERIFY_ROW, since: at(13, 10, 30) });
  const notSent = await t.waitFor('verified');
  check('booked after the last send: the earlier sends do not count', notSent && notSent.ok === true && notSent.found === true && notSent.appointment === true && notSent.outcome === true && notSent.sent === false && notSent.text === 'Casey Bookwell: in the diary, outcome set, not sent to the dealership yet.', notSent);

  await t.clearMsgs();
  await t.send({ type: 'workTools:verify', id: 'bk-3', row: VERIFY_ROW, since: at(14, 9, 0) });
  const nextDay = await t.waitFor('verified');
  check('booked the day after: nothing from before that day counts', nextDay && nextDay.ok === true && nextDay.found === true && !nextDay.appointment && !nextDay.outcome && !nextDay.sent, nextDay);

  await t.clearMsgs();
  await t.send({ type: 'workTools:verify', id: 'bk-4', row: { name: 'Pat Noneson', phone: '', email: 'pat.noneson@example.com' }, since: at(13, 10, 0) });
  const none = await t.waitFor('verified');
  check('customer not found: ok false, found false, said plainly', none && none.id === 'bk-4' && none.ok === false && none.found === false && none.appointment === false && none.outcome === false && none.sent === false && none.text === 'No customer found for Pat Noneson.', none);

  await t.clearMsgs();
  await t.send({ type: 'workTools:verify', id: 'bk-5', row: {}, since: at(13, 10, 0) });
  await t.send({ type: 'workTools:verify', id: 'bk-6', row: VERIFY_ROW });
  const noRow = await t.waitFor('verified', (m) => m.id === 'bk-5', 5000);
  const noSince = await t.waitFor('verified', (m) => m.id === 'bk-6', 5000);
  check('a verify with no customer or no time is answered ok false', noRow && noRow.ok === false && noRow.text === 'No customer was given to check.' && noSince && noSince.ok === false && noSince.text === 'No booking time was given to check.', [noRow, noSince]);

  await t.clearMsgs();
  await t.live.evaluate(({ row, since }) => window.postMessage({ type: 'workTools:verify', id: 'x', row, since }, '*'), { row: VERIFY_ROW, since: at(13, 10, 0) });
  await t.live.waitForTimeout(800);
  check('a verify from another window is ignored', (await t.msgs('verified')).length === 0);

  // An open by hand is not interrupted by a verify, and takes over from one.
  await t.live.evaluate(() => { window.mock.searchDelay = 700; });
  await t.send({ type: 'workTools:open', id: 'o1', row: OPEN_ROW });
  await t.live.waitForFunction(() => window.mock.searches.some((s) => /reedwell/.test(s)));
  await t.send({ type: 'workTools:verify', id: 'bk-7', row: VERIFY_ROW, since: at(13, 10, 0) });
  const waited = await t.waitFor('verified', (m) => m.id === 'bk-7', 5000);
  const opened = await t.waitFor('opened', (m) => m.id === 'o1');
  check('a verify while a customer is being opened by hand is refused, and the open finishes', waited && waited.ok === false && /being opened/.test(waited.text) && opened && opened.ok === true && (await t.page()).lead === '1386301', [waited, opened]);
  await t.clearMsgs();
  await t.live.evaluate(() => { window.mock.searches = []; });
  await t.send({ type: 'workTools:verify', id: 'bk-8', row: VERIFY_ROW, since: at(13, 10, 0) });
  await t.live.waitForFunction(() => window.mock.searches.some((s) => /bookwell/.test(s)));
  await t.send({ type: 'workTools:open', id: 'o2', row: OPEN_ROW });
  const gaveWay = await t.waitFor('verified', (m) => m.id === 'bk-8');
  const second = await t.waitFor('opened', (m) => m.id === 'o2');
  await t.live.waitForTimeout(400);
  check('an open by hand takes over from a verify, which says so once', gaveWay && gaveWay.ok === false && gaveWay.found === false && /opened by hand/.test(gaveWay.text) && second && second.ok === true && (await t.msgs('verified')).length === 1 && !(await t.page()).busy, [gaveWay, second]);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// A finished batch, then a verify, then logged out.
{
  const t = await openLinked();
  await t.runToEnd('v1');
  await t.avatar(0).click();
  await t.waitState(/^Morgan Reedwell is open: timeline and lead\.$/);
  await t.clearMsgs();
  const before = await t.snapshot();
  const opensBefore = await t.live.evaluate(() => window.mock.modalOpens.length);
  await t.send({ type: 'workTools:verify', id: 'bk-9', row: VERIFY_ROW, since: at(13, 10, 0) });
  const done = await t.waitFor('verified');
  check('verify on a finished batch answers with the three results', done && done.ok === true && done.appointment && done.outcome && done.sent, done);
  check('the finished results and position are untouched', (await t.snapshot()) === before && JSON.stringify(await t.outcomes()) === JSON.stringify(EXPECTED), await t.outcomes());
  const page = await t.page();
  check('the lead window left open by hand was closed and none was opened', page.modals === 0 && (await t.live.evaluate(() => window.mock.modalOpens.length)) === opensBefore && !page.busy, page);
  const quiet = await t.msgs();
  check('the link state is untouched: nothing but the answer and idle', quiet.every((m) => (m.type === 'workTools:ready' && m.state === 'idle' && m.batchId === null) || m.type === 'workTools:verified') && quiet.filter((m) => m.type === 'workTools:verified').length === 1, quiet.map((m) => [m.type, m.state]));
  check('the state line says what was found', (await t.state()) === 'Casey Bookwell: in the diary, outcome set, sent to the dealership.', await t.state());

  await t.live.evaluate(() => { window.__klcShared.loginForRequestMs = 1200; window.mock.logOut(); window.mock.searches = []; });
  await t.clearMsgs();
  await t.send({ type: 'workTools:verify', id: 'bk-10', row: VERIFY_ROW, since: at(13, 10, 0) });
  const out = await t.waitFor('verified', null, 5000);
  check('logged out: ok false with the reason, nothing is searched', out && out.id === 'bk-10' && out.ok === false && out.found === false && out.text === 'Konnect Live is logged out. Log in, then try again.' && (await t.live.evaluate(() => window.mock.searches.length)) === 0 && !(await t.page()).busy, out);
  check('still the same results', (await t.snapshot()) === before);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// While a batch is running.
{
  const t = await openLinked();
  await t.live.evaluate(() => { window.mock.searchDelay = 900; });
  await t.send({ type: 'workTools:batch', id: 'v2', kind: 'leads', tsv: BATCH });
  await t.waitFor('ready', (m) => m.state === 'running');
  await t.live.waitForFunction(() => { const s = window.__konnectLeadChecker.getSession(); return s && Object.keys(s.results).length === 2 && window.mock.searches.length === 2; }, null, { timeout: 30000 });
  const before = await t.snapshot();
  const stateBefore = await t.state();
  await t.send({ type: 'workTools:verify', id: 'bk-11', row: VERIFY_ROW, since: at(13, 10, 0) });
  const refused = await t.waitFor('verified', null, 5000);
  check('verify while a batch is running: ok false with a plain reason', refused && refused.id === 'bk-11' && refused.ok === false && refused.found === false && refused.appointment === false && refused.outcome === false && refused.sent === false && refused.text === RUN_BUSY, refused);
  const searches = await t.live.evaluate(() => window.mock.searches.slice());
  check('the batch was not disturbed: nothing searched, nothing moved, the state line unchanged', searches.length === 2 && !searches.some((s) => /bookwell/.test(s)) && (await t.snapshot()) === before && (await t.state()) === stateBefore && (await t.page()).busy === true, [searches, await t.state()]);
  await t.live.evaluate(() => { window.mock.searchDelay = 120; });
  const ended = await t.waitFor('ended', (m) => m.id === 'v2', 60000);
  check('the batch finishes with the same results as an unbroken run', ended && ended.reason === 'done' && JSON.stringify(await t.outcomes()) === JSON.stringify(EXPECTED), await t.outcomes());
  check('the verify was answered once', (await t.msgs('verified')).length === 1, await t.msgs('verified'));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// A narrow window, as the small window Work Tools opens for Konnect Live:
// a customer is still found, and the button that opens the panel can still
// be reached. The mock carries Bootstrap's rule that hides the menu bar
// item between 768 and 991 pixels wide.
for (const width of [480, 800]) {
  const t = await openLinked({ width, height: 420 });
  const ended = await t.runToEnd(`n${width}`);
  check(`${width} wide: the batch finishes with the usual outcomes`, ended && ended.reason === 'done' && JSON.stringify(await t.outcomes()) === JSON.stringify(EXPECTED), await t.outcomes());
  check(`${width} wide: the customer was found and their lead read`, (await t.live.evaluate(() => window.mock.openedIds.length)) > 0 && (await t.outcomes())[0] === 'CLASSIFIED');
  const fits = await t.live.evaluate(() => { const r = document.getElementById('_klcPanelHost').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: window.innerWidth, height: window.innerHeight }; });
  check(`${width} wide: the panel fits in the window`, fits.left >= 0 && fits.right <= fits.width && fits.bottom <= fits.height, fits);
  await (await t.more('#minBtn')).click();
  // The button is looked for where a click would land.
  const button = () => t.live.evaluate(() => {
    const el = [document.querySelector('#_klcNavItem a'), document.getElementById('_klcBadge')].find((e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right <= window.innerWidth && r.top >= 0; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: el.id || 'navItem', clickable: !!top && (top === el || el.contains(top)), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await t.live.waitForFunction(() => !!document.getElementById('_klcBadge') || !!document.querySelector('#_klcNavItem a'), null, { timeout: 5000 }).catch(() => {});
  const found = await button();
  check(`${width} wide: with the panel hidden its button is in view`, found && found.clickable && (width !== 800 || found.id === '_klcBadge'), found);
  if (found) await t.live.mouse.click(found.x, found.y);
  check(`${width} wide: the button opens the panel again`, await t.live.evaluate(() => document.getElementById('_klcPanelHost').style.display === 'block'));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

// A wide window made narrow while the panel is hidden: the button moves out
// of the menu bar, and back when there is room again.
{
  const t = await openLinked();
  await (await t.more('#minBtn')).click();
  check('wide: the button is in the menu bar', await t.live.evaluate(() => !!document.querySelector('#_klcNavItem a') && !document.getElementById('_klcBadge')));
  await t.live.setViewportSize({ width: 800, height: 420 });
  check('made narrow: the floating button takes over', await t.live.waitForFunction(() => { const b = document.getElementById('_klcBadge'); return !!b && b.getBoundingClientRect().width > 0 && !document.getElementById('_klcNavItem'); }, null, { timeout: 8000 }).then(() => true, () => false));
  await t.live.setViewportSize({ width: 1280, height: 900 });
  check('made wide again: the button goes back into the menu bar', await t.live.waitForFunction(() => !!document.querySelector('#_klcNavItem a') && !document.getElementById('_klcBadge'), null, { timeout: 8000 }).then(() => true, () => false));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.close();
}

await browser.close();
console.log(failures === 0 ? `\nAll ${passes} Lead Checker open tests passed.` : `\n${failures} Lead Checker open test(s) FAILED (${passes} passed).`);
process.exit(failures === 0 ? 0 : 1);
