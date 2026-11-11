#!/usr/bin/env node
// Browser tests for Lead Re setup against the mock agent desktop pages in
// tests/agent-desktop-mock. Needs Playwright with Chromium, so it is kept out
// of the fast run-self-tests.mjs. Run from the repo root:
//
//   node tests/lead-reset.e2e.mjs             (all)
//   node tests/lead-reset.e2e.mjs slowLeads   (only the named tests)
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
const regCheckScript = readFileSync(join(here, '..', 'Reg-Check.js'), 'utf8');

// Playwright is installed globally, which ESM import does not search.
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

async function openPage(file, hash, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ commit: { committer: { date: PUBLISHED } } }]) }));
  await context.route('**/raw.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: script }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
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

const SAM = row(['national', 'Mr. Sam Buyer', '70000002', '1400002', 'Re setup', 'x', '2', 'Email Only Lead', '', '', 'Vauxhall - Offer Request - Used', 'AB12 CDE']);
const JO = row(['national', 'Jo Example', '70000005', '1400005', 'Re setup', 'x', '2', '', '', '', 'Peugeot - Enquiry', 'AB12CDF']);

// Opens the batch mock with Re setup leads waiting and the tool loaded.
async function openBatch(query, results, settings, viewport) {
  const opened = await openPage(`index.html${query || ''}`, '#!/idle', viewport);
  await opened.page.evaluate(([list, s]) => {
    localStorage.setItem('_slaNationalCheckResults', JSON.stringify({ savedAt: new Date().toISOString(), results: list }));
    if (s) localStorage.setItem('_leadResetSettings', JSON.stringify(s));
  }, [results || [SAM], settings || null]);
  await inject(opened.page);
  return opened;
}

// Waits until the run pauses or ends. Returns what the panel shows.
async function settle(page, timeout = 60000) {
  await page.waitForFunction(() => { const s = window._leadResetState; return s && (s.paused || !s.running); }, null, { timeout }).catch(() => {});
  return page.evaluate(() => {
    const s = window._leadResetState;
    const panel = document.querySelector('#_leadResetPanel').shadowRoot;
    return { running: s.running, paused: s.paused && s.paused.message, carryOnLabel: s.paused && s.paused.carryOnLabel, log: s.log.slice(), events: window.events.slice(),
      buttons: Array.from(panel.querySelectorAll('.needs-card [data-action]')).map((b) => b.getAttribute('data-action')), notice: (panel.querySelector('.notice') || {}).textContent || '' };
  });
}
const press = async (page, action) => { await page.click(`#_leadResetPanel [data-action=${action}]`); await page.waitForTimeout(300); };
const count = (list, item) => list.filter((e) => e === item).length;

async function slowLeads() {
  console.log('\nRe setup when the customer\'s leads are drawn late');
  const { context, page, errors } = await openBatch('?leads=3000');
  await press(page, 'start');
  const review = await settle(page);
  check('the late closed lead is waited for and checked', review.log.some((l) => /Closed Vauxhall - Offer Request - Used lead found on this customer/.test(l)), review.log);
  check('so its own notes are the ones copied', review.events.includes('diary with notes:"From the page\\nline two" internal:""'), review.events.filter((e) => e.startsWith('diary')));
  check('reaches the check before parking', /Check the new lead/.test(review.paused || ''), review.paused || review.log);
  check('no page errors', errors.length === 0, errors);
  await context.close();

  const never = await openBatch('?leads=600000');
  await press(never.page, 'start');
  const stuck = await settle(never.page);
  check('pauses when no leads show at all, so the checks are never passed over', /leads have not shown on the page/.test(stuck.paused || '') && stuck.buttons.join() === 'retry,skip,stop', stuck.paused || stuck.buttons);
  check('nothing was changed on the customer', !stuck.events.some((e) => /^(outcome|campaign|newLead)/.test(e)), stuck.events);
  await never.context.close();
}

async function slowSaveRetry() {
  console.log('\nRe setup: Try again on Add the new lead after a slow Save');
  const { context, page, errors } = await openBatch('?save=16500');
  await press(page, 'start');
  const stuck = await settle(page);
  check('pauses when the Create Activity window stays open', /Create Activity window did not close/.test(stuck.paused || ''), stuck.paused || stuck.log);
  await press(page, 'retry');
  const review = await settle(page);
  check('Try again does not add a second lead', count(review.events, 'save') === 1 && count(review.events, 'newLead') === 1 && count(review.events, 'campaign:Vauxhall - Offer Request - Used') === 1, review.events);
  check('and says so', review.log.some((l) => /A new lead has shown since the first try, so a second one was not added/.test(l)), review.log);
  check('then carries on to the check before parking', /Check the new lead/.test(review.paused || ''), review.paused || review.log);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function secondLoadSkipAndStop() {
  console.log('\nRe setup: a second load while paused, Skip lead, then Stop');
  const { context, page, errors } = await openBatch('', [SAM, JO], null, { width: 1024, height: 600 });
  await press(page, 'start');
  const review = await settle(page);
  check('the check before parking offers no Try again', review.buttons.join() === 'carry,skip,stop', review.buttons);
  const layout = await page.evaluate(() => {
    const rect = document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.panel').getBoundingClientRect();
    const hit = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && rect.left < b.right && b.left < rect.right && rect.top < b.bottom && b.top < rect.bottom; };
    return { width: Math.round(rect.width), height: Math.round(rect.height), covers: ['finished', 'park'].filter((id) => hit(document.getElementById(id))) };
  });
  check('paused at 1024x600: small, and clear of Finished and Park It', layout.width <= 300 && layout.height < 360 && layout.covers.length === 0, layout);
  await inject(page);
  await page.waitForTimeout(300);
  check('a second load keeps the one panel and the paused run', await page.evaluate(() => document.querySelectorAll('#_leadResetPanel').length === 1 && !!window._leadResetState.paused && !!document.querySelector('#_leadResetPanel').shadowRoot.querySelector('[data-action=carry]')));
  await press(page, 'skip');
  const skipped = await settle(page);
  check('the buttons still work after the second load: Skip lead skips', /^Lead skipped\./.test(skipped.paused || ''), skipped.paused || skipped.log);
  check('and says what was left changed', /Left as it is: the call is still open; the new lead was added; the next status is Available\./.test(skipped.paused || ''), skipped.paused);
  check('the skipped lead is not parked', !skipped.events.includes('park'), skipped.events);
  await press(page, 'stop');
  const stopped = await settle(page);
  check('Stop ends the run and says what was left', !stopped.running && /Stopped\. Left as it is: the call is still open/.test(stopped.notice) && stopped.log.some((l) => /Stopped\. Left as it is/.test(l)), { notice: stopped.notice, log: stopped.log });
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('_leadResetProgress') || 'null'));
  check('progress: the first lead skipped, the second untouched', progress && JSON.stringify(progress.byActivity) === JSON.stringify({ 70000002: 'Skipped' }), progress);
  check('nothing parked or Finished', !stopped.events.includes('park') && !stopped.events.includes('FINISHED-PRESSED'), stopped.events);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function parkingSafety() {
  console.log('\nRe setup: nothing is parked on a guess');
  const first = await openBatch();
  await press(first.page, 'start');
  await settle(first.page);
  await first.page.evaluate(() => document.querySelector('[ng-model="selected.NextAgentStatus"]').remove());
  await press(first.page, 'carry');
  const noNext = await settle(first.page);
  check('pauses, not parks, when the next status box is not found', /Set the next status \(by Park It\) to Shift Start and park the call yourself/.test(noNext.paused || '') && !noNext.events.includes('park'), noNext.paused || noNext.events);
  check('no page errors', first.errors.length === 0, first.errors);
  await first.context.close();

  // Stop before parking off, and a dropdown that cannot be matched.
  const { context, page, errors } = await openBatch('', [SAM], { reviewBeforePark: false });
  await page.evaluate(() => { document.getElementById('existing').__scope.theActivity.SalesLead.LeadDetails.LeadTypeID = 9; });
  await press(page, 'start');
  const missed = await settle(page);
  check('with Stop before parking off, a dropdown that was not filled still pauses', /These could not be filled: Lead type\. Set them on the new lead yourself/.test(missed.paused || '') && missed.carryOnLabel === 'Done, park it', missed.paused || missed.log);
  check('and the call is not parked meanwhile', !missed.events.includes('park'), missed.events);
  await press(page, 'carry');
  await page.waitForFunction(() => !window._leadResetState.running, null, { timeout: 20000 }).catch(() => {});
  check('carry on then parks it', await page.evaluate(() => window.events.includes('park')));
  check('no page errors', errors.length === 0, errors);
  await context.close();

  const clean = await openBatch('', [SAM], { reviewBeforePark: false });
  await press(clean.page, 'start');
  const done = await settle(clean.page);
  check('with Stop before parking off and everything filled, it parks without pausing', !done.running && !done.paused && done.events.includes('park'), done.paused || done.log);
  await clean.context.close();
}

async function panelPlaceAndFocus() {
  console.log('\nPanel: where it sits, focus, and redraws');
  const { context, page, errors } = await openPage('index.html', '#!/idle', { width: 1024, height: 600 });
  // Konnect Notes' own launcher, where Konnect Notes puts it.
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'kn-inbound-launcher'; b.textContent = 'Booking'; b.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147482999;padding:10px 16px;border:none;border-radius:999px;font-size:14px;font-weight:700'; document.body.appendChild(b); });
  await inject(page);
  const rects = () => page.evaluate(() => {
    const r = document.querySelector('#_leadResetPanel').shadowRoot;
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width }; };
    return { panel: box(r.querySelector('.panel')), launcher: box(r.querySelector('.launcher')), notes: box(document.getElementById('kn-inbound-launcher')) };
  });
  const apart = (a, b) => !a.width || !b.width || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const open = await rects();
  check('the panel does not sit on the Konnect Notes launcher', apart(open.panel, open.notes) && open.panel.width > 0, open);
  await press(page, 'close');
  const hidden = await rects();
  check('its launcher is stacked clear of the Konnect Notes launcher', apart(hidden.launcher, hidden.notes) && hidden.launcher.width > 0 && Math.abs(hidden.launcher.left - hidden.notes.left) < 2, hidden);
  await press(page, 'reopen');

  const root = () => page.evaluateHandle(() => document.querySelector('#_leadResetPanel').shadowRoot);
  await press(page, 'view][data-view=pc');
  check('keyboard focus stays on the same control across a redraw', await page.evaluate((r) => r.activeElement && r.activeElement.getAttribute('data-view') === 'pc', await root()));
  await page.keyboard.press('Tab');
  const ring = await page.evaluate((r) => { const s = getComputedStyle(r.activeElement); return { colour: s.outlineColor, style: s.outlineStyle, width: s.outlineWidth }; }, await root());
  check('the focus ring is dark on the light panel', ring.colour === 'rgb(28, 28, 30)' && ring.style === 'solid' && ring.width === '2px', ring);

  // A redraw asked for while the mouse is down waits for it to come up.
  const held = await page.evaluateHandle((r) => { const el = r.querySelector('[data-view=eo]'); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true })); return el; }, await root());
  await page.evaluate((r) => {
    localStorage.setItem('_slaNationalCheckResults', JSON.stringify({ savedAt: new Date().toISOString(), results: [r] }));
    localStorage.setItem('_workToolsDeskResults', JSON.stringify({ savedAt: new Date().toISOString(), results: [{ name: 'Jo Example', email: 'jo.example@example.com', postClosureAction: 'send back through', postClosureReason: 'Email only', checkedAt: new Date().toISOString() }] }));
    window.dispatchEvent(new StorageEvent('storage', { key: '_workToolsDeskResults' }));
  }, SAM);
  check('no redraw while the mouse is down', await page.evaluate((el) => el.isConnected, held) && !/to send back through/.test(await shadowText(page, '.body') || ''));
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.waitForTimeout(200);
  check('the redraw happens once the mouse is up', /1\s*to send back through/.test(await shadowText(page, '.body') || ''), await shadowText(page, '.body'));

  // Dragged somewhere: kept for the session, through Clear & Stop and a new load.
  const head = await page.evaluate((r) => { const b = r.querySelector('.head .title').getBoundingClientRect(); return { x: b.left + 40, y: b.top + 8 }; }, await root());
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(head.x + 300, head.y - 60, { steps: 4 });
  await page.mouse.up();
  const dragged = (await rects()).panel;
  check('the panel can be dragged', Math.abs(dragged.left - (open.panel.left + 300)) < 3, { before: open.panel, dragged });
  await press(page, 'clearStop');
  await inject(page);
  await page.waitForSelector('#_leadResetPanel', { timeout: 5000, state: 'attached' });
  const again = (await rects()).panel;
  check('the dragged place is kept for the session', Math.abs(again.left - dragged.left) < 2 && Math.abs(again.top - dragged.top) < 2, { dragged, again });
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function regCheck() {
  console.log('\nReg Check');
  const { context, page, errors } = await openPage('index.html', '#!/idle');
  await page.evaluate(() => { window.opened = []; window.open = (url) => { window.opened.push(url); return null; }; });
  await page.addScriptTag({ content: regCheckScript });
  const notice = () => page.evaluate(() => (document.getElementById('_regCheckNotice') || {}).textContent || '');
  check('loads with a notice, not a pop up', /Reg Check is on/.test(await notice()) && !errors.some((e) => /^dialog/.test(e)), { notice: await notice(), errors });
  const selectText = (text) => page.evaluate((t) => {
    let el = document.getElementById('regText');
    if (!el) { el = document.createElement('p'); el.id = 'regText'; document.body.appendChild(el); }
    el.textContent = t;
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }, text);
  await selectText('ab12 cde');
  await page.keyboard.press('Alt+r');
  check('a registration opens the checker, tidied', JSON.stringify(await page.evaluate(() => window.opened)) === JSON.stringify(['https://www.stellantisandyou.co.uk/used-vehicles/results?maxPayment=1900&registration=AB12CDE']), await page.evaluate(() => window.opened));
  for (const text of ['Sam Buyer wants a call', '07700 900123', 'jo@example.com']) {
    await selectText(text);
    await page.keyboard.press('Alt+r');
  }
  check('anything that is not a registration opens nothing', (await page.evaluate(() => window.opened.length)) === 1 && /does not look like a registration/.test(await notice()), await notice());
  for (const reg of ['A123 BCD', 'ABC 123D', 'AZ 1234', '1 AB']) { await selectText(reg); await page.keyboard.press('Alt+r'); }
  check('older and dateless plates are accepted', (await page.evaluate(() => window.opened.length)) === 5, await page.evaluate(() => window.opened));
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true })));
  await page.evaluate(() => { const e = new Event('keydown', { bubbles: true }); e.altKey = true; document.dispatchEvent(e); });
  check('a key event with no key does not throw', errors.length === 0, errors);
  await page.waitForFunction(() => !document.getElementById('_regCheckNotice'), null, { timeout: 6000 }).catch(() => {});
  check('the notice goes by itself', (await notice()) === '');
  await context.close();
}

const started = Date.now();
const tests = [batchRun, thisCustomer, clearAndStop, slowLeads, slowSaveRetry, secondLoadSkipAndStop, parkingSafety, panelPlaceAndFocus, regCheck];
const only = process.argv.slice(2);
for (const test of tests) {
  if (only.length && !only.includes(test.name)) continue;
  // One test crashing does not stop the rest.
  try { await test(); } catch (e) {
    failures++;
    console.log(`FAIL  ${test.name} crashed: ${e && e.stack || e}`);
  }
}
await browser.close();
server.close();
console.log(`\n${passes} passed, ${failures} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
