#!/usr/bin/env node
// Browser tests for the Post Closure send back and Email Only runs in
// Lead-Reset.js, against the mock agent desktop in
// tests/agent-desktop-mock/desk.html. Needs Playwright with Chromium. Run
// from the repo root:
//
//   node tests/desk-runs.e2e.mjs            (all)
//   node tests/desk-runs.e2e.mjs slowPage   (only the named tests)
//
// GitHub calls are stubbed, so no network is needed. Exit 1 on any failure.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const mockRoot = join(here, 'agent-desktop-mock');
const script = readFileSync(join(repo, 'Lead-Reset.js'), 'utf8');
const workToolsScript = readFileSync(join(repo, 'Work-Tools.js'), 'utf8');
const regCheckScript = readFileSync(join(repo, 'Reg-Check.js'), 'utf8');

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

// The mock pages, plus the real Konnect Notes files under /repo/ for the
// test that loads the real script.
const REPO_FILES = ['Konnect-Notes.js', 'Konnect-Booking-Engine.js', 'Konnect-Notes-Phrases.json'];
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split(/[?#]/)[0]);
  const repoFile = path.startsWith('/repo/') ? path.slice(6) : '';
  const p = repoFile ? (REPO_FILES.includes(repoFile) ? join(repo, repoFile) : '') : normalize(join(mockRoot, path));
  if (p && (repoFile || p.startsWith(mockRoot)) && existsSync(p) && statSync(p).isFile()) {
    res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(readFileSync(p));
  } else { res.statusCode = 404; res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();

const CAD = '**** Catch All Return Lead **** Lead has been **actioned by dealer**';
const CAH = '**** Catch All Return Lead **** **Customer Hub will not contact this lead type** - please contact and update Emax';

// The agent desktop's own address, answered from the mock pages, for the
// tests where the address matters (Work Tools picks its tools by it).
const DESK_SITE = 'https://konnectonlineservices.co.uk';

// options: query (added to the address), viewport, site (true opens the
// mock at the agent desktop's own address), noScript (do not load the tool).
async function openDesk(setup, storage, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ commit: { committer: { date: '2026-01-02T03:04:00Z' } } }]) }));
  const fetched = [];
  await context.route('**/raw.githubusercontent.com/**', (r) => {
    const file = r.request().url().split('/').pop().split('?')[0];
    fetched.push(file);
    // Work Tools fetches each tool; Konnect Notes is a stand-in that counts its loads.
    const body = file === 'Work-Tools.js' ? workToolsScript : file === 'Reg-Check.js' ? regCheckScript
      : file === 'Konnect-Notes.js' ? 'window.__notesLoads = (window.__notesLoads || 0) + 1; window.KonnectNotes = { version: "mock" };' : script;
    r.fulfill({ status: 200, contentType: 'text/plain', body });
  });
  await context.route(`${DESK_SITE}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(mockRoot, 'desk.html')) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto(`${options.site ? `${DESK_SITE}/(v9.9.9)/agent-desktop` : base}/desk.html${options.query || ''}#!/idle`);
  await page.evaluate(({ setup, storage }) => {
    window.mock.setup(setup);
    const now = new Date().toISOString();
    Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify({ savedAt: now, ...value })));
  }, { setup, storage });
  if (!options.noScript) {
    await page.addScriptTag({ content: script });
    await page.waitForSelector('#_leadResetPanel [data-action=view]', { timeout: 5000 });
  }
  return { context, page, errors, fetched };
}

const shadowText = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector('#_leadResetPanel').shadowRoot.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

// Waits until the run pauses or ends. Returns what the panel shows.
async function settle(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const s = window._leadResetState;
    return s && (s.paused || !s.running);
  }, null, { timeout }).catch(() => {});
  return page.evaluate(() => {
    const s = window._leadResetState;
    const panel = document.querySelector('#_leadResetPanel').shadowRoot;
    return { running: s.running, paused: s.paused && s.paused.message, carryOnLabel: s.paused && s.paused.carryOnLabel, log: s.log.slice(), events: window.events.slice(), snapshots: window.snapshots.slice(),
      buttons: Array.from(panel.querySelectorAll('.needs-card [data-action]')).map((b) => b.getAttribute('data-action')), notice: (panel.querySelector('.notice') || {}).textContent || '' };
  });
}
const press = async (page, action) => { await page.click(`#_leadResetPanel [data-action=${action}]`); await page.waitForTimeout(300); };
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);

async function carryOn(page) {
  await page.click('#_leadResetPanel [data-action=carry]');
  await page.waitForFunction(() => !window._leadResetState.paused, null, { timeout: 5000 }).catch(() => {});
}

const count = (list, item) => list.filter((e) => e === item).length;
const after = (list, first, then) => { const i = list.indexOf(first); return i >= 0 && list.indexOf(then, i + 1) > i; };

// Customers on the mock: a closed original lead, then the open one.
function postClosureCustomer(id, name, email, phone, pcNotes, parked = true) {
  return {
    id, name, email, phone, parked,
    leads: [
      { ID: `${id}-1`, CampaignName: 'Vauxhall - Enquiry - Used', OutcomeFullHierarchy: 'Sales -> Max Attempts Reached - Sent to Dealer', SourceName: 'AA Cars', notes: 'Original call notes, keep.' },
      { ID: `${id}-2`, CampaignName: 'Vauxhall - Post Closure', OutcomeFullHierarchy: 'None', SourceName: 'Post Closure Processing', notes: '', pcNotes }
    ]
  };
}
const sendBack = (name, email, phone, reason) => ({ name, email, phone, postClosureAction: 'send back through', postClosureReason: reason });

async function postClosureNoReview() {
  console.log('\nPost Closure, Stop before Finished off');
  const { context, page, errors } = await openDesk({
    status: 'Available',
    customers: [
      postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', ''),
      { id: 'pat', name: 'Pat Other', email: 'pat.other@example.com', phone: '07700 900199', parked: true, leads: [{ ID: 'pat-1', CampaignName: 'Peugeot - Enquiry - New', OutcomeFullHierarchy: 'None', SourceName: 'AA Cars' }] },
      postClosureCustomer('sam', 'Sam Buyer', 'sam.buyer@example.com', '07700 900102', '', false)
    ]
  }, {
    _workToolsDeskResults: { results: [
      sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership'),
      sendBack('Sam Buyer', 'sam.buyer@example.com', '', 'Email only'),
      { name: 'Pat Other', email: 'pat.other@example.com', phone: '', postClosureAction: 'check: needs contact?', postClosureReason: '' }
    ] }
  });
  await page.click('#_leadResetPanel [data-action=view][data-view=pc]');
  check('Post Closure tab counts the two send backs', /^2\s*to send back through/.test(await shadowText(page, '.big-count') || ''), await shadowText(page, '.big-count'));
  await page.click('#_leadResetPanel [data-action=reviewFinish]');
  check('Stop before Finished turned off', await page.evaluate(() => JSON.parse(localStorage.getItem('_leadResetSettings')).reviewBeforeFinish === false));
  await page.click('#_leadResetPanel [data-action=startPc]');
  const out = await settle(page);
  check('run ended without pausing', !out.running && !out.paused, out.paused || out.log);
  const ev = out.events;
  check('only Jo was opened from Parked Calls', ev.filter((e) => e.startsWith('open:')).join() === 'open:jo', ev);
  check('log says one was not in Parked Calls', out.log.some((l) => /1 not in your Parked Calls, left alone/.test(l)), out.log);
  check('Konnect Notes expanded cad', ev.includes('konnect-notes:cad'), ev);
  check('call outcome Update Outcomes', ev.includes('outcome:Update Outcomes (No Call Made)'), ev);
  check('lead outcome chosen level by level on the Post Closure lead',
    after(ev, 'level1:jo-2:Customer Hub Team', 'level2:jo-2:No Opportunity') && after(ev, 'level2:jo-2:No Opportunity', 'level3:jo-2:Catch All - Ongoing / Actioned by Dealer'), ev);
  check('next status Shift Start', ev.includes('next:Shift Start'), ev);
  check('Finished pressed once, and accepted', count(ev, 'FINISHED:jo') === 1 && !ev.some((e) => /^FINISH-REFUSED/.test(e)) && ev.filter((e) => /^FINISHED/.test(e)).length === 1, ev);
  const snap = out.snapshots[0] || { leads: [] };
  const pc = snap.leads.find((l) => l.ID === 'jo-2') || {};
  const original = snap.leads.find((l) => l.ID === 'jo-1') || {};
  check('Post Closure Notes hold the CAD note', pc.pcNotes === CAD, pc.pcNotes);
  check('Post Closure lead outcome at Finished', JSON.stringify(pc.levels) === JSON.stringify(['Customer Hub Team', 'No Opportunity', 'Catch All - Ongoing / Actioned by Dealer']), pc.levels);
  check('Post Closure lead Call Notes left empty', pc.callNotes === '', pc.callNotes);
  check('call outcome and next status at Finished', snap.callOutcome === 'Update Outcomes (No Call Made)' && snap.next === 'Shift Start', snap);
  check('original lead untouched', original.callNotes === 'Original call notes, keep.' && original.levels.join('') === '' && !ev.some((e) => e.startsWith('level') && e.includes(':jo-1:')), { original, ev });
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('_leadResetDeskProgress') || 'null'));
  check('progress saved for Jo only', progress && JSON.stringify(progress.pc) === JSON.stringify({ 'jo.example@example.com': 'Done' }), progress);
  check('Sam and Pat left alone', !ev.some((e) => /:(sam|pat)/.test(e)), ev);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function postClosureWithReview() {
  console.log('\nPost Closure, Stop before Finished on');
  const { context, page, errors } = await openDesk({
    status: 'Shift Start',
    customers: [
      postClosureCustomer('alex', 'Alex Sample', 'alex.sample@example.com', '07700 900103', 'Lead Checker: email only.'),
      postClosureCustomer('chris', 'Chris Test', 'chris.test@example.com', '07700900456', '')
    ]
  }, {
    _workToolsDeskResults: { results: [
      sendBack('Alex Sample', 'alex.sample@example.com', '', 'Email only'),
      // No email from the Lead Checker: found in Parked Calls by phone.
      sendBack('Chris Test', '', '07700 900456', "In market won't commit")
    ] }
  });
  check('Stop before Finished is on by default', await page.evaluate(() => {
    const p = document.querySelector('#_leadResetPanel').shadowRoot;
    p.querySelector('[data-view=pc]').click();
    return p.querySelector('[data-action=reviewFinish]').checked;
  }));
  await page.click('#_leadResetPanel [data-action=startPc]');
  for (const [id, outcome] of [['alex', 'Catch All - Email Only Lead'], ['chris', 'Catch All - In Market Would Not Commit to appoint']]) {
    const paused = await settle(page);
    check(`${id}: pauses before Finished`, /Carry on to press Finished/.test(paused.paused || '') && paused.carryOnLabel === 'Looks right, press Finished', paused.paused || paused.log);
    check(`${id}: Finished not pressed at the pause`, !paused.events.includes(`FINISHED:${id}`), paused.events);
    check(`${id}: outcome already set at the pause`, paused.events.includes(`level3:${id}-2:${outcome}`), paused.events);
    // A check by eye has nothing to try again: the main answer comes first, then Skip lead and one Stop.
    check(`${id}: the check offers carry on, Skip lead and Stop, and no Try again`, paused.buttons.join() === 'carry,skip,stop', paused.buttons);
    await carryOn(page);
    await page.waitForFunction((cid) => window.events.includes(`FINISHED:${cid}`), id, { timeout: 15000 }).catch(() => {});
    check(`${id}: Finished pressed after carry on`, await page.evaluate((cid) => window.events.filter((e) => e === `FINISHED:${cid}`).length === 1, id));
  }
  const out = await settle(page);
  check('run ended', !out.running && !out.paused, out.paused || out.log);
  check('both opened in turn from Parked Calls', out.events.filter((e) => e.startsWith('open:')).join() === 'open:alex,open:chris', out.events);
  const pcNotes = (id) => ((out.snapshots.find((s) => s.customer === id) || { leads: [] }).leads.find((l) => l.ID === `${id}-2`) || {}).pcNotes;
  check('CAH added on a new line after existing Post Closure Notes', pcNotes('alex') === `Lead Checker: email only.\n${CAH}`, pcNotes('alex'));
  check('CAH for in market', pcNotes('chris') === CAH, pcNotes('chris'));
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('_leadResetDeskProgress') || 'null'));
  check('progress saved for both', progress && Object.values(progress.pc).join() === 'Done,Done' && Object.keys(progress.pc).length === 2, progress);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function emailOnly() {
  console.log('\nEmail Only');
  const call = (forename, surname, email) => ({ CallID: 1, Customer: { Forename: forename, Surname: surname, EmailAddress: email }, Dealer: { Name: 'Preston', Email: 'dealer@example.com' } });
  const eoLead = (id) => ({ ID: `${id}-2`, CampaignName: 'Vauxhall - Email Only', OutcomeFullHierarchy: 'None', SourceName: 'AA Cars', notes: '' });
  const { context, page, errors } = await openDesk({
    status: 'Shift Start',
    queue: ['dan', 'uma', 'eve'],
    customers: [
      { id: 'dan', name: 'Dan Davis', email: 'dan.davis@example.com', call: call('Dan', 'Davis', 'dan.davis@example.com'),
        leads: [{ ID: 'dan-1', CampaignName: 'Vauxhall - Enquiry - New', OutcomeFullHierarchy: 'Sales -> Max Attempts Reached - Sent to Dealer', SourceName: 'AA Cars', notes: 'Older lead notes.' }, eoLead('dan')] },
      { id: 'uma', name: 'Uma Unassigned', email: 'uma.unassigned@example.com', call: call('Uma', 'Unassigned', 'uma.unassigned@example.com'), leads: [eoLead('uma')] },
      { id: 'eve', name: 'Eve Evans', email: 'eve.evans@example.com', call: call('Eve', 'Evans', 'eve.evans@example.com'), leads: [eoLead('eve')] }
    ]
  }, {
    _workToolsEmailOnlyAssigned: { leads: [
      { name: 'Dan Davis', email: 'dan.davis@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' },
      { name: 'Eve Evans', email: 'eve.evans@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' },
      { name: 'Fay Field', email: 'fay.field@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent Two' }
    ] }
  });
  await page.click('#_leadResetPanel [data-action=view][data-view=eo]');
  check('Email Only tab counts Agent One\'s two leads', /^2\s*Email Only leads to do/.test(await shadowText(page, '.big-count') || ''), await shadowText(page, '.big-count'));
  await page.click('#_leadResetPanel [data-action=reviewFinish]');
  await page.click('#_leadResetPanel [data-action=startEo]');

  const atUma = await settle(page);
  check('pauses when a lead that is not assigned presents', /not one of the Email Only leads you assigned/.test(atUma.paused || ''), atUma.paused || atUma.log);
  check('log says it was rejected and left to the agent', atUma.log.some((l) => /not one of your Email Only leads presented; rejected so it does not dial, and left to you/.test(l)), atUma.log);
  const ev1 = atUma.events;
  check('status set to Available first', ev1[0] === 'status:Available', ev1);
  check('Dan rejected, not accepted', ev1.includes('reject:dan') && !ev1.includes('ACCEPT:dan'), ev1);
  const danCall = ev1.slice(ev1.indexOf('reject:dan'), ev1.indexOf('FINISHED:dan') + 1);
  check('Dan: call outcome reset, then Update Outcomes', after(danCall, 'outcome:(Select a Call Outcome)', 'outcome:Update Outcomes (No Call Made)'), danCall);
  check('Dan: EO typed and expanded', danCall.includes('konnect-notes:eo'), danCall);
  check('Dan: lead outcome Customer Hub Team > Ongoing > Email Only Lead',
    after(danCall, 'level1:dan-2:Customer Hub Team', 'level2:dan-2:Ongoing') && after(danCall, 'level2:dan-2:Ongoing', 'level3:dan-2:Email Only Lead'), danCall);
  check('Dan: next status Available, more to come', danCall.includes('next:Available') && !danCall.includes('next:Shift Start'), danCall);
  check('Dan: Finished once', count(ev1, 'FINISHED:dan') === 1 && !ev1.some((e) => /^FINISH-REFUSED/.test(e)), ev1);
  const dan = atUma.snapshots.find((s) => s.customer === 'dan') || { leads: [] };
  const danEo = dan.leads.find((l) => l.ID === 'dan-2') || {};
  const danOld = dan.leads.find((l) => l.ID === 'dan-1') || {};
  check('Dan: EO note with the email in Call Notes', danEo.callNotes === 'EMAIL ONLY LEAD: dan.davis@example.com', danEo.callNotes);
  check('Dan: outcome at Finished', danEo.levels && danEo.levels.join(' > ') === 'Customer Hub Team > Ongoing > Email Only Lead' && dan.next === 'Available' && dan.callOutcome === 'Update Outcomes (No Call Made)', dan);
  check('Dan: the older closed lead untouched', danOld.callNotes === 'Older lead notes.' && danOld.levels.join('') === '', danOld);
  const umaCall = ev1.slice(ev1.indexOf('presented:uma'));
  check('Uma rejected so it cannot dial, then the call outcome reset', after(umaCall, 'reject:uma', 'outcome:(Select a Call Outcome)'), umaCall);
  check('Uma otherwise untouched: not accepted, no notes, outcomes or Finished', !umaCall.some((e) => /ACCEPT:uma|FINISHED:uma|:uma-|konnect-notes|level\d|next:|Update Outcomes/.test(e)), umaCall);

  // The agent deals with Uma by hand, then carries on.
  await page.evaluate(() => window.mock.agentHandlesPresented());
  await carryOn(page);
  const out = await settle(page);
  check('run ended after the last assigned lead', !out.running && !out.paused, out.paused || out.log);
  const ev = out.events;
  const eveCall = ev.slice(ev.indexOf('reject:eve'), ev.indexOf('FINISHED:eve') + 1);
  check('Eve rejected', ev.includes('reject:eve') && !ev.includes('ACCEPT:eve'), ev);
  check('Eve: call outcome reset, then Update Outcomes', after(eveCall, 'outcome:(Select a Call Outcome)', 'outcome:Update Outcomes (No Call Made)'), eveCall);
  check('Eve: next status Shift Start, the last one', eveCall.includes('next:Shift Start'), eveCall);
  const eve = out.snapshots.find((s) => s.customer === 'eve') || { leads: [] };
  const eveEo = eve.leads[0] || {};
  check('Eve: EO note with the email in Call Notes', eveEo.callNotes === 'EMAIL ONLY LEAD: eve.evans@example.com', eveEo.callNotes);
  check('Eve: outcome at Finished', eveEo.levels && eveEo.levels.join(' > ') === 'Customer Hub Team > Ongoing > Email Only Lead' && eve.next === 'Shift Start', eve);
  check('Finished pressed once each for Dan and Eve only', ev.filter((e) => /^FINISHED/.test(e)).join() === 'FINISHED:dan,FINISHED:eve', ev);
  check('status ends on Shift Start', await page.evaluate(() => document.getElementById('statusBtn').textContent) === 'Shift Start');
  check('log says all done', out.log.some((l) => /All your Email Only leads are done/.test(l)), out.log);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('_leadResetDeskProgress') || 'null'));
  check('progress saved for Dan and Eve only', progress && JSON.stringify(progress.eo) === JSON.stringify({ 'dan.davis@example.com': 'Done', 'eve.evans@example.com': 'Done' }), progress);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// A customer found by phone whose email differs: "This is them" must still
// find the Post Closure lead, so the outcome never lands on another lead.
async function postClosureOtherEmail() {
  console.log('\nPost Closure, customer found by phone with another email');
  const { context, page, errors } = await openDesk({
    status: 'Shift Start',
    customers: [postClosureCustomer('jo', 'Jo Example', 'jo.new@example.com', '07700 900101', '')]
  }, { _workToolsDeskResults: { results: [sendBack('Jo Example', 'jo.old@example.com', '07700 900101', 'Actioned by dealership')] } });
  await page.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await page.click('#_leadResetPanel [data-action=startPc]');
  const asked = await settle(page);
  check('asks whether this is the right customer', /may be the wrong Jo Example/.test(asked.paused || '') && asked.carryOnLabel === 'This is them, carry on', asked.paused || asked.log);
  check('nothing changed on any lead yet', !asked.events.some((e) => /^(level\d|outcome|next|FINISHED)/.test(e)), asked.events);
  await carryOn(page);
  const review = await settle(page);
  check('carries on to the check before Finished', /Carry on to press Finished/.test(review.paused || ''), review.paused || review.log);
  check('the outcome is on the Post Closure lead only', review.events.includes('level3:jo-2:Catch All - Ongoing / Actioned by Dealer') && !review.events.some((e) => /^level\d:jo-1:/.test(e)), review.events);
  check('the note went in Post Closure Notes', review.events.includes('konnect-notes:cad'), review.events);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// A second click of Work Tools while a run is paused, then Try again, Skip
// lead and Stop. The page is opened at the agent desktop's own address so
// the real Work-Tools.js picks its tools for it.
async function secondLoadSkipAndStop() {
  console.log('\nPost Closure: Work Tools clicked again while paused, then Try again, Skip lead and Stop');
  const { context, page, errors, fetched } = await openDesk({
    status: 'Shift Start',
    customers: [
      postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', ''),
      postClosureCustomer('al', 'Al Sample', 'al.sample@example.com', '07700 900103', '')
    ]
  }, { _workToolsDeskResults: { results: [sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership'), sendBack('Al Sample', 'al.sample@example.com', '', 'Email only')] } }, { site: true });
  check('on the agent desktop the off-desktop warning is not shown', !/Open this on the agent desktop/.test(await shadowText(page, '.body') || ''));
  await page.evaluate(() => { window.KonnectNotes = null; });
  await press(page, 'view][data-view=pc');
  await press(page, 'startPc');
  const noNotes = await settle(page);
  check('pauses when Konnect Notes is not on the page', /Konnect Notes is not on this page/.test(noNotes.paused || ''), noNotes.paused || noNotes.log);
  check('that pause can only be tried again, skipped or stopped', noNotes.buttons.join() === 'retry,skip,stop', noNotes.buttons);

  // A fast double click of the Work Tools bookmark.
  fetched.length = 0;
  await page.evaluate((code) => { Function(code)(); Function(code)(); }, workToolsScript);
  await page.waitForFunction(() => window.KonnectNotes && window.KonnectNotes.version, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const afterClick = await page.evaluate(() => ({
    panels: document.querySelectorAll('#_leadResetPanel').length,
    notesLoads: window.__notesLoads,
    regCheck: !!window._regCheckHotkeyInstalled,
    paused: !!(window._leadResetState && window._leadResetState.paused),
    booking: window.KonnectNotesBooking
  }));
  check('Work Tools loaded Konnect Notes, once', afterClick.notesLoads === 1 && fetched.filter((f) => f === 'Konnect-Notes.js').length === 1, { afterClick, fetched });
  check('Work Tools did not fetch Lead Re setup again', !fetched.includes('Lead-Reset.js'), fetched);
  check('still one panel, still paused on the same run', afterClick.panels === 1 && afterClick.paused, afterClick);
  check('Reg Check loaded with no pop up', afterClick.regCheck && !errors.some((e) => /^dialog/.test(e)), errors);

  // The script loaded directly a second time (the Lead Re setup bookmark).
  await page.addScriptTag({ content: script });
  check('a direct second load keeps the one panel and its run', await page.evaluate(() => document.querySelectorAll('#_leadResetPanel').length === 1 && !!window._leadResetState.paused));

  await press(page, 'retry');
  const review = await settle(page);
  check('Try again carries on now Konnect Notes is there', /Carry on to press Finished/.test(review.paused || '') && review.events.includes('konnect-notes:cad'), review.paused || review.log);
  check('the note was written once', count(review.events, 'konnect-notes:cad') === 1, review.events);

  await press(page, 'skip');
  const skipped = await settle(page);
  check('Skip lead says what was left changed', /Lead skipped\. Left as it is: the call is still open; the call outcome is "Update Outcomes \(No Call Made\)"; the CAD note was written; the lead outcome is set to Customer Hub Team > No Opportunity > Catch All - Ongoing \/ Actioned by Dealer; the next status is Shift Start\./.test(skipped.paused || ''), skipped.paused || skipped.log);
  check('Finished not pressed for the skipped lead', !skipped.events.some((e) => /^FINISH/.test(e)), skipped.events);
  check('that pause is not about a step: carry on and Stop only', skipped.buttons.join() === 'carry,stop', skipped.buttons);
  await page.click('#park');
  await carryOn(page);
  const second = await settle(page);
  check('the next lead starts after the skipped one is parked by hand', /Carry on to press Finished/.test(second.paused || '') && second.events.includes('open:al'), second.paused || second.log);

  await press(page, 'stop');
  const stopped = await settle(page);
  check('Stop ends the run', !stopped.running && !stopped.paused, stopped);
  check('Stop says what was left changed, in the panel and the log', /Stopped\. Left as it is: the call is still open; the call outcome is "Update Outcomes/.test(stopped.notice) && stopped.log.some((l) => /Stopped\. Left as it is/.test(l)), { notice: stopped.notice, log: stopped.log });
  check('nothing was Finished', !stopped.events.some((e) => /^FINISH/.test(e)), stopped.events);
  const progress = await stored(page, '_leadResetDeskProgress');
  check('progress: Jo skipped, Al not marked', progress && JSON.stringify(progress.pc) === JSON.stringify({ 'jo.example@example.com': 'Skipped' }), progress);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// Parked Calls rows and a customer's leads that are drawn late, in parts.
async function slowPage() {
  console.log('\nPost Closure on a slow page: late Parked Calls rows and late leads');
  const { context, page, errors } = await openDesk({
    status: 'Shift Start', delays: { parked: 2500, leads: 2500 },
    customers: [
      postClosureCustomer('al', 'Al Sample', 'al.sample@example.com', '07700 900103', ''),
      postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')
    ]
  }, { _workToolsDeskResults: { results: [sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership')] }, _leadResetSettings: { reviewBeforeFinish: false } });
  await press(page, 'view][data-view=pc');
  await press(page, 'checkParked');
  await page.waitForFunction(() => localStorage.getItem('_workToolsLiveRequest'), null, { timeout: 20000 }).catch(() => {});
  const request = await stored(page, '_workToolsLiveRequest');
  check('Check my Parked Calls waits for every row', request && request.rows === 2 && request.tsv.split('\n').length === 3, request);
  check('the request has the agreed shape', request && /^desk-/.test(request.id) && !Number.isNaN(Date.parse(request.at)) && !request.cancelled, request);
  await page.evaluate(() => { location.hash = '#!/idle'; });
  await press(page, 'startPc');
  const out = await settle(page);
  check('the run finds Jo in the late second half of the rows', out.events.includes('open:jo') && !out.log.some((l) => /not in your Parked Calls/.test(l)), out.log);
  check('the late leads are waited for, and Jo is Finished', !out.running && !out.paused && count(out.events, 'FINISHED:jo') === 1, out.paused || out.log);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// Konnect Notes takes the word and tidies Call Notes but writes no note.
async function notesPutBack() {
  console.log('\nPost Closure: both boxes are put back when Konnect Notes writes no note');
  const customer = postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', 'Earlier note.');
  customer.leads[1].notes = 'Keep these.';
  const { context, page, errors } = await openDesk({ status: 'Shift Start', notes: 'tidy-only', customers: [customer] },
    { _workToolsDeskResults: { results: [sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership')] } });
  await press(page, 'view][data-view=pc');
  await press(page, 'startPc');
  const out = await settle(page);
  check('pauses to say the note was not written', /Konnect Notes did not write the note, so the notes were put back/.test(out.paused || '') && out.events.includes('konnect-notes-refused:cad'), out.paused || out.log);
  const boxes = await page.evaluate(() => { const pane = document.querySelector('[data-lead="jo-2"]'); return { call: pane.querySelector('.callNotes').value, pc: pane.querySelector('.pcNotes').value }; });
  check('Call Notes and Post Closure Notes are back as they were', boxes.call === 'Keep these.' && boxes.pc === 'Earlier note.', boxes);
  check('carry on checks again and does not pass without the note', out.carryOnLabel === 'Typed it, check again', out.carryOnLabel);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// The email in the EO note is checked against the assigned lead, the lead
// is picked by campaign among several open ones, and an agent left
// Available is told and offered Shift Start.
async function emailOnlyChecks() {
  console.log('\nEmail Only: note email, lead picked by campaign, status at the end');
  const call = (forename, surname, email) => ({ CallID: 1, Customer: { Forename: forename, Surname: surname, EmailAddress: email } });
  const open = (ID, CampaignName) => ({ ID, CampaignName, OutcomeFullHierarchy: 'None', SourceName: 'AA Cars', notes: '' });
  const { context, page, errors } = await openDesk({
    status: 'Shift Start', queue: ['dan', 'eve', 'gus'],
    customers: [
      // The top of the page shows another email, and there are two open leads.
      { id: 'dan', name: 'Dan Davis', email: 'dan.davis@example.com', topEmail: 'dan.work@example.com', call: call('Dan', 'Davis', 'dan.davis@example.com'),
        leads: [open('dan-1', 'Peugeot - Enquiry - New'), open('dan-2', 'Vauxhall - Email Only')] },
      // No email at the top of the page.
      { id: 'eve', name: 'Eve Evans', email: 'eve.evans@example.com', topEmail: '', call: call('Eve', 'Evans', 'eve.evans@example.com'), leads: [open('eve-1', 'Vauxhall - Email Only')] },
      // Two open leads and neither is on the assigned campaign.
      { id: 'gus', name: 'Gus Green', email: 'gus.green@example.com', call: call('Gus', 'Green', 'gus.green@example.com'),
        leads: [open('gus-1', 'Peugeot - Enquiry - New'), open('gus-2', 'Citroen - Enquiry - Used')] }
    ]
  }, { _workToolsEmailOnlyAssigned: { leads: [
    { name: 'Dan Davis', email: 'dan.davis@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' },
    { name: 'Eve Evans', email: 'eve.evans@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' },
    { name: 'Gus Green', email: 'gus.green@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' }
  ] } });
  const setNote = (id, text) => page.evaluate(([lead, value]) => { const box = document.querySelector(`[data-lead="${lead}"] .callNotes`); box.value = value; box.dispatchEvent(new Event('input', { bubbles: true })); }, [id, text]);
  await press(page, 'view][data-view=eo');
  await press(page, 'startEo');

  const dan = await settle(page);
  check('status set to Available, and confirmed from the page', dan.events[0] === 'status:Available' && dan.log.some((l) => /Status set to Available/.test(l)), dan.log);
  check('Dan: the lead on the assigned campaign is the one worked', dan.log.some((l) => /Email Only lead found \(Vauxhall - Email Only\)/.test(l)) && !dan.events.some((e) => /:dan-1:/.test(e)), dan.log);
  check('Dan: pauses when the note has another email', /The EO note in Call Notes has dan\.work@example\.com, but the assigned lead's email is dan\.davis@example\.com/.test(dan.paused || '') && dan.carryOnLabel === 'The note is right, carry on', dan.paused || dan.log);
  await setNote('dan-2', 'EMAIL ONLY LEAD: dan.davis@example.com');
  await press(page, 'retry');
  const danReview = await settle(page);
  check('Dan: passes once the note has the lead\'s email', /Carry on to press Finished/.test(danReview.paused || '') && danReview.events.includes('level3:dan-2:Email Only Lead'), danReview.paused || danReview.log);
  check('Dan: the EO word was typed once only', count(danReview.events, 'konnect-notes:eo') === 1, danReview.events);
  // The other open lead has no outcome, so the agent takes it from here.
  await press(page, 'skip');
  const danSkipped = await settle(page);
  check('Dan: skipping says what was left changed', /Lead skipped\. Left as it is: the call is still open; the call outcome is "Update Outcomes \(No Call Made\)"; the EO note was written; the lead outcome is set to Customer Hub Team > Ongoing > Email Only Lead; the next status is Available\./.test(danSkipped.paused || ''), danSkipped.paused);
  await page.evaluate(() => window.mock.agentHandlesPresented());
  await carryOn(page);

  const eve = await settle(page);
  check('Eve: pauses when the note has no email', /The EO note in Call Notes has no email address\. Add eve\.evans@example\.com/.test(eve.paused || '') && eve.carryOnLabel === 'Added it, check again', eve.paused || eve.log);
  await carryOn(page);
  const eveAgain = await settle(page);
  check('Eve: carrying on without the email does not pass, and types nothing more', /has no email address/.test(eveAgain.paused || '') && count(eveAgain.events, 'konnect-notes:eo') === 2, eveAgain.paused || eveAgain.events);
  await setNote('eve-1', 'EMAIL ONLY LEAD: eve.evans@example.com');
  await carryOn(page);
  const eveReview = await settle(page);
  check('Eve: passes once the email is added', /Carry on to press Finished/.test(eveReview.paused || ''), eveReview.paused || eveReview.log);
  await carryOn(page);
  await page.waitForFunction(() => window.events.includes('FINISHED:eve'), null, { timeout: 15000 }).catch(() => {});

  const gus = await settle(page);
  check('Gus: pauses when no open lead is on the assigned campaign', /has 2 open leads and it is not clear which is the Email Only one \(assigned on Vauxhall - Email Only\)/.test(gus.paused || '') && gus.carryOnLabel === 'Its tab is open, carry on', gus.paused || gus.log);
  check('Gus: nothing written on either lead', !gus.events.some((e) => /:gus-|konnect-notes:eo/.test(e) && gus.events.indexOf(e) > gus.events.indexOf('reject:gus')), gus.events.slice(gus.events.indexOf('reject:gus')));
  await press(page, 'skip');
  await settle(page);
  await page.evaluate(() => window.mock.agentHandlesPresented());
  await carryOn(page);
  const out = await settle(page);
  check('run ended', !out.running && !out.paused, out.paused || out.log);
  check('the last line gives the status read from the page', out.log.some((l) => /All your Email Only leads are done; your status is Available/.test(l)), out.log);
  check('the panel says the agent is still Available and offers Shift Start', /are still Available, so leads can present/.test(out.notice) && await page.evaluate(() => !!document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.notice [data-action=shiftStart]')), out.notice);
  check('the status was not changed silently', await page.evaluate(() => document.getElementById('statusBtn').textContent) === 'Available');
  await press(page, 'shiftStart');
  await page.waitForFunction(() => document.getElementById('statusBtn').textContent === 'Shift Start', null, { timeout: 5000 }).catch(() => {});
  check('Set Shift Start sets it', await page.evaluate(() => document.getElementById('statusBtn').textContent) === 'Shift Start');
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function emailOnlyClearAndStop() {
  console.log('\nEmail Only: Clear & Stop while waiting, still Available');
  const { context, page, errors } = await openDesk({ status: 'Shift Start', queue: [], customers: [] },
    { _workToolsEmailOnlyAssigned: { leads: [{ name: 'Dan Davis', email: 'dan.davis@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' }] } });
  await press(page, 'view][data-view=eo');
  await press(page, 'startEo');
  await page.waitForFunction(() => document.getElementById('statusBtn').textContent === 'Available', null, { timeout: 5000 }).catch(() => {});
  // Hidden behind its launcher while it waits.
  await press(page, 'close');
  check('the launcher shows while the panel is hidden', await page.evaluate(() => { const r = document.querySelector('#_leadResetPanel').shadowRoot; return r.querySelector('.launcher').style.display !== 'none' && r.querySelector('.panel').style.display === 'none'; }));
  await press(page, 'reopen');
  await press(page, 'clearStop');
  const notice = await page.evaluate(() => { const n = document.getElementById('_leadResetNotice'); return n ? n.shadowRoot.textContent.replace(/\s+/g, ' ') : null; });
  check('Clear & Stop says the agent is still Available', /stopped and cleared\. You are still Available, so leads can present/.test(notice || ''), notice);
  check('the panel has gone', await page.evaluate(() => !document.getElementById('_leadResetPanel') && window._leadResetState === null));
  await page.evaluate(() => document.getElementById('_leadResetNotice').shadowRoot.querySelector('[data-act=shift]').click());
  await page.waitForFunction(() => document.getElementById('statusBtn').textContent === 'Shift Start', null, { timeout: 5000 }).catch(() => {});
  check('its Set Shift Start button works after the panel has gone', await page.evaluate(() => document.getElementById('statusBtn').textContent) === 'Shift Start');
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// A pause brings the panel back and cannot be missed.
async function pauseReopensThePanel() {
  console.log('\nA pause re-opens a hidden panel; hidden or minimised it says Needs you');
  const { context, page, errors } = await openDesk({ status: 'Shift Start', customers: [postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')] },
    { _workToolsDeskResults: { results: [sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership')] } }, { viewport: { width: 1024, height: 600 } });
  await press(page, 'view][data-view=pc');
  await press(page, 'startPc');
  await page.click('#_leadResetPanel [data-action=close]');
  const paused = await settle(page);
  const look = () => page.evaluate(() => {
    const r = document.querySelector('#_leadResetPanel').shadowRoot;
    const panel = r.querySelector('.panel');
    const rect = panel.getBoundingClientRect();
    const hit = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && rect.left < b.right && b.left < rect.right && rect.top < b.bottom && b.top < rect.bottom; };
    return {
      panelShown: panel.style.display !== 'none', launcher: r.querySelector('.launcher').textContent, launcherNeeds: r.querySelector('.launcher').classList.contains('needs'),
      mini: r.querySelector('.mini-status').textContent, headColour: getComputedStyle(r.querySelector('.head')).backgroundColor,
      width: Math.round(rect.width), height: Math.round(rect.height), covers: ['finished', 'park'].filter((id) => hit(document.getElementById(id))),
      body: r.querySelector('.body').textContent.replace(/\s+/g, ' '), footShown: getComputedStyle(r.querySelector('.foot')).display !== 'none',
      stops: r.querySelectorAll('.panel [data-action=stop], .panel [data-action=clearStop]').length - (getComputedStyle(r.querySelector('.foot')).display === 'none' ? 1 : 0),
      live: Array.from(r.querySelectorAll('[aria-live]')).length, first: (r.querySelector('.needs-card .btn') || {}).textContent
    };
  });
  const open = await look();
  check('the pause brought the hidden panel back', /Carry on to press Finished/.test(paused.paused || '') && open.panelShown, open);
  check('paused: small, with only the message and its buttons', open.width <= 300 && open.height < 340 && !/Version of|Send backs|Stop before Finished/.test(open.body), open);
  check('paused: the main answer comes first and there is one Stop', open.first === 'Looks right, press Finished' && open.stops === 1 && !open.footShown, open);
  check('paused: the panel does not cover Finished or Park It', open.covers.length === 0, open.covers);
  check('the whole body is no longer a live region', open.live === 0, open.live);
  await press(page, 'minimise');
  const mini = await look();
  check('minimised while paused: the header says Needs you in another colour', mini.mini === 'Needs you' && mini.headColour === 'rgb(180, 83, 9)', mini);
  await press(page, 'close');
  const hidden = await look();
  check('hidden while paused: the launcher says Needs you', /Needs you/.test(hidden.launcher) && hidden.launcherNeeds, hidden);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// What the desk reads and writes in the storage it shares with SLA Manager
// (link spec, sections 3 and 4), with no SLA Manager needed.
async function sharedStorage() {
  console.log('\nShared storage: link line, results, request and Clear & Stop');
  const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  const checkedAt = new Date(Date.now() - 7 * 60 * 1000).toISOString();
  const { context, page, errors } = await openDesk({ status: 'Shift Start', customers: [postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')] }, {
    // SLA Manager's own lead card results: not the desk's to read or clear.
    _slaLeadCheckerImportState: { results: [sendBack('Sam Buyer', 'sam.buyer@example.com', '', 'Email only')] },
    _slaNationalCheckResults: { results: [] },
    _workToolsDeskResults: { results: [{ ...sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership'), checkedAt }, { ...sendBack('Old One', 'old.one@example.com', '', 'Email only'), checkedAt: old }] },
    _leadResetDeskProgress: { savedAt: old, pc: { 'gone@example.com': 'Done' }, eo: {} },
    _leadResetProgress: { savedAt: old, byActivity: { 1: 'Done' } }
  });
  check('its own data older than a shift is removed on load', await stored(page, '_leadResetDeskProgress') === null && await stored(page, '_leadResetProgress') === null);
  const linkLine = () => shadowText(page, '.link');
  const setLink = (value) => page.evaluate((v) => {
    localStorage.setItem('_workToolsLinkState', JSON.stringify(v));
    window.dispatchEvent(new StorageEvent('storage', { key: '_workToolsLinkState' }));
  }, value);
  const NOT_RUNNING = 'SLA Manager is not running. Click Work Tools on the Konnect Manager tab.';
  check('no link state: SLA Manager is not running', await linkLine() === NOT_RUNNING, await linkLine());
  const at = () => new Date().toISOString();
  const lines = [];
  for (const state of ['none', 'idle', 'paused', 'loggedOut']) { await setLink({ state, at: at() }); lines.push(await linkLine()); }
  check('link line wording for each state', JSON.stringify(lines) === JSON.stringify(['Konnect Live: not open. Press Open Konnect Live in SLA Manager.', 'Konnect Live: linked, ready.', 'Konnect Live: paused.', 'Konnect Live: logged out, logging back in.']), lines);
  await setLink({ state: 'running', done: 12, total: 40, at: at() });
  check('link line shows progress', await linkLine() === 'Konnect Live: checking 12 of 40.', await linkLine());
  await setLink({ state: 'running', text: 'Konnect Live: checking 13 of 40.', done: 13, total: 40, at: at() });
  check('SLA Manager\'s own text is shown as given', await linkLine() === 'Konnect Live: checking 13 of 40.', await linkLine());
  const perTab = [];
  for (const view of ['re', 'pc', 'eo']) { await press(page, `view][data-view=${view}`); perTab.push(await linkLine()); }
  check('the link line is on every tab', perTab.every((l) => l === 'Konnect Live: checking 13 of 40.'), perTab);
  await setLink({ state: 'idle', at: new Date(Date.now() - 31000).toISOString() });
  check('a link state older than 30 seconds: SLA Manager is not running', await linkLine() === NOT_RUNNING, await linkLine());
  await setLink({ state: 'idle', at: new Date(Date.now() - 26000).toISOString() });
  check('a fresh one is shown', await linkLine() === 'Konnect Live: linked, ready.', await linkLine());
  await page.waitForFunction((text) => document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.link').textContent === text, NOT_RUNNING, { timeout: 12000 }).catch(() => {});
  check('and goes stale by the clock, with no new storage event', await linkLine() === NOT_RUNNING, await linkLine());

  await press(page, 'view][data-view=pc');
  check('Post Closure results come from the desk results only, and old ones are left out', /^1\s*to send back through/.test(await shadowText(page, '.big-count') || ''), await shadowText(page, '.big-count'));
  check('the age of the results is shown', /Lead Checker results from 7 min ago\./.test(await shadowText(page, '.results-age') || ''), await shadowText(page, '.results-age'));

  const hubLine = async () => (await shadowText(page, '.hub-status')) || '';
  await page.evaluate(() => {
    localStorage.setItem('_workToolsLiveRequest', JSON.stringify({ id: 'desk-1', at: new Date(Date.now() - 9 * 60 * 1000).toISOString(), rows: 1, tsv: 'x' }));
    localStorage.setItem('_workToolsLiveStatus', JSON.stringify({ id: 'desk-1', state: 'checking', text: 'Lead Checker is checking 1 lead.', at: new Date().toISOString() }));
    window.dispatchEvent(new StorageEvent('storage', { key: '_workToolsLiveStatus' }));
  });
  check('a request under 10 minutes old shows SLA Manager\'s status text', await hubLine() === 'Lead Checker is checking 1 lead.', await hubLine());
  await page.evaluate(() => {
    localStorage.setItem('_workToolsLiveRequest', JSON.stringify({ id: 'desk-1', at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), rows: 1, tsv: 'x' }));
    window.dispatchEvent(new StorageEvent('storage', { key: '_workToolsLiveStatus' }));
  });
  check('after 10 minutes the request is no longer shown as pending', await hubLine() === '', await hubLine());
  await page.evaluate(() => {
    localStorage.setItem('_workToolsLiveStatus', JSON.stringify({ id: 'desk-0', state: 'done', text: 'An older request.', at: new Date().toISOString() }));
  });

  await press(page, 'checkParked');
  await page.waitForFunction(() => /^desk-\d{5,}/.test((JSON.parse(localStorage.getItem('_workToolsLiveRequest') || '{}')).id || ''), null, { timeout: 15000 }).catch(() => {});
  const request = await stored(page, '_workToolsLiveRequest');
  check('status for another request id is not shown for this one', /Passing your Parked Calls to SLA Manager/.test(await hubLine()), await hubLine());
  await press(page, 'clearStop');
  const after = await page.evaluate(() => Object.fromEntries(['_workToolsLiveRequest', '_workToolsDeskResults', '_leadResetDeskProgress', '_slaLeadCheckerImportState', '_slaNationalCheckResults', '_workToolsLinkState', '_workToolsLiveStatus'].map((k) => [k, JSON.parse(localStorage.getItem(k) || 'null')])));
  const withdrawn = after._workToolsLiveRequest;
  check('Clear & Stop withdraws the request: { id, at, cancelled: true }', withdrawn && withdrawn.id === request.id && withdrawn.cancelled === true && !Number.isNaN(Date.parse(withdrawn.at)) && Object.keys(withdrawn).sort().join() === 'at,cancelled,id', withdrawn);
  check('Clear & Stop clears the desk results', after._workToolsDeskResults === null);
  check('Clear & Stop leaves SLA Manager\'s data alone', !!after._slaLeadCheckerImportState && !!after._slaNationalCheckResults && !!after._workToolsLinkState && !!after._workToolsLiveStatus, Object.keys(after).filter((k) => !after[k]));
  await page.addScriptTag({ content: script });
  await page.waitForSelector('#_leadResetPanel [data-action=view]', { timeout: 5000 });
  await press(page, 'view][data-view=pc');
  check('after Clear & Stop a new panel shows no withdrawn request and no results', await hubLine() === '' && /No send backs yet/.test(await shadowText(page, '.card') || ''), await shadowText(page, '.card'));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// The real Konnect-Notes.js on the mock page, loaded as its bookmark loads
// it, expanding the words Lead Re setup types.
async function realKonnectNotes() {
  console.log('\nThe real Konnect Notes expands cad, cah and eo typed by Lead Re setup');
  const eoLead = { ID: 'dan-1', CampaignName: 'Vauxhall - Email Only', OutcomeFullHierarchy: 'None', SourceName: 'AA Cars', initial: 'Email me the offer.', notes: 'Earlier call note.' };
  const withInitial = (customer, initial) => { customer.leads[1].initial = initial; return customer; };
  const { context, page, errors } = await openDesk({
    status: 'Shift Start', queue: ['dan'],
    customers: [
      withInitial(postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', ''), 'Wants a call back about the Corsa.'),
      withInitial(postClosureCustomer('al', 'Al Sample', 'al.sample@example.com', '07700 900103', ''), 'Email only please.'),
      { id: 'dan', name: 'Dan Davis', email: 'dan.davis@example.com', call: { CallID: 1, Customer: { Forename: 'Dan', Surname: 'Davis', EmailAddress: 'dan.davis@example.com' } }, leads: [eoLead] }
    ]
  }, {
    _workToolsDeskResults: { results: [sendBack('Jo Example', 'jo.example@example.com', '', 'Actioned by dealership'), sendBack('Al Sample', 'al.sample@example.com', '', 'Email only')] },
    _workToolsEmailOnlyAssigned: { leads: [{ name: 'Dan Davis', email: 'dan.davis@example.com', campaign: 'Vauxhall - Email Only', agent: 'Agent One' }] },
    _leadResetSettings: { reviewBeforeFinish: false }
  }, { query: '?realNotes=1', noScript: true });
  await page.evaluate((url) => {
    localStorage.setItem('konnectNotes:agentName:v1', 'Sam Tester');
    window.KonnectNotesBaseUrl = url;
  }, `${base}/repo/`);
  await page.addScriptTag({ url: `${base}/repo/Konnect-Notes.js` });
  const loaded = await page.waitForFunction(() => window.KonnectNotes && window.KonnectNotes.version && window.KonnectNotes.version !== 'mock' && window.KonnectNotes.state && window.KonnectNotes.state.config, null, { timeout: 10000 }).then(() => true, () => false);
  check('the real Konnect Notes loaded its phrases from the local server', loaded, await page.evaluate(() => window.KonnectNotes && window.KonnectNotes.version));
  await page.addScriptTag({ content: script });
  await page.waitForSelector('#_leadResetPanel [data-action=view]', { timeout: 5000 });
  await press(page, 'view][data-view=pc');
  await press(page, 'startPc');
  const pc = await settle(page, 90000);
  check('Post Closure run ended without pausing', !pc.running && !pc.paused, pc.paused || pc.log);
  const pcNotes = (id) => ((pc.snapshots.find((s) => s.customer === id) || { leads: [] }).leads.find((l) => l.ID === `${id}-2`) || {}).pcNotes || '';
  check('cad: the real phrase is in Post Closure Notes, and the typed word is gone', pcNotes('jo').includes(CAD) && !/(^|\n)cad$/m.test(pcNotes('jo')), pcNotes('jo'));
  check('cah: the real phrase is in Post Closure Notes', pcNotes('al').includes(CAH) && !/(^|\n)cah$/m.test(pcNotes('al')), pcNotes('al'));
  check('both were Finished', count(pc.events, 'FINISHED:jo') === 1 && count(pc.events, 'FINISHED:al') === 1, pc.events);
  await press(page, 'view][data-view=eo');
  await press(page, 'startEo');
  const eo = await settle(page, 90000);
  check('Email Only run ended without pausing', !eo.running && !eo.paused, eo.paused || eo.log);
  const danNotes = (((eo.snapshots.find((s) => s.customer === 'dan') || { leads: [] }).leads[0]) || {}).callNotes || '';
  check('eo: the note with the email from the top of the page, on its own line after the earlier note', danNotes.trimEnd() === 'Earlier call note.\nEMAIL ONLY LEAD: dan.davis@example.com', danNotes);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// The desk's Parked Calls go to the Lead Checker through SLA Manager, open
// in its own tab: both pages are on one site, so they share storage. The
// real SLA Manager script runs in manager.html, whose hidden frame stands in
// for the Konnect Live tab it opened. These follow the link spec: batches
// carry an id, results and endings are matched by it, and the desk reads
// only the shared storage keys.
const RESULTS_HEADER = 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\tInitialNotes\tTier\tTierName\tSubCategory\tSubRank\tFlags\tConfidence\tReason\tDedupeKey\tPostClosureAction\tPriorityRank\tPostClosureReason\tPostClosureEvidence';
const resultsTsv = (rows) => [RESULTS_HEADER, ...rows.map(([name, email, action, reason]) => `${name}\t\t${email}\tPost Closure Processing\t\t\t\t\t\t\t\t\tmedium\t\t\t${action}\t-2\t${reason}\t`)].join('\n');
const slaScript = readFileSync(join(repo, 'SLA-Manager.js'), 'utf8');
const LIVE_URL = 'https://carbot.ai/konnectlive/(v1.2.200)/home.html';

async function openManager(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto(`${base}/manager.html`);
  await page.addScriptTag({ content: slaScript });
  return { page, errors };
}
const sentToLive = (manager) => manager.evaluate(() => window.toLive.slice());
const fromLive = (manager, message) => manager.evaluate((m) => window.fromLive(m), message);
const ready = (manager, state = 'idle', batchId = null, done = 0, total = 0) => fromLive(manager, { type: 'workTools:ready', url: LIVE_URL, state, batchId, done, total });
const deskStatus = async (desk) => (await shadowText(desk, '.hub-status')) || '';
// SLA Manager's status for the desk's current request, once it is one of the states.
const waitForState = (desk, states) => desk.waitForFunction((wanted) => {
  const request = JSON.parse(localStorage.getItem('_workToolsLiveRequest') || 'null');
  const status = JSON.parse(localStorage.getItem('_workToolsLiveStatus') || 'null');
  return !!(request && status && status.id === request.id && wanted.includes(status.state));
}, states, { timeout: 15000 }).then(() => true, () => false);
const waitForLink = (desk, text) => desk.waitForFunction((t) => document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.link').textContent === t, text, { timeout: 15000 }).then(() => true, () => false);
const waitForSent = (manager, n) => manager.waitForFunction((k) => window.toLive.length >= k, n, { timeout: 15000 }).then(() => true, () => false);

async function parkedCallsThroughManager() {
  console.log('\nRelay: Parked Calls checked through SLA Manager (both tabs already open)');
  const customers = [
    postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', ''),
    postClosureCustomer('al', 'Al Sample', 'al.sample@example.com', '07700 900103', '')
  ];
  const { context, page: desk, errors } = await openDesk({ status: 'Shift Start', customers }, {});
  const { page: manager, errors: managerErrors } = await openManager(context);
  // The Live tab SLA Manager opened earlier says it is ready (it repeats this).
  await ready(manager);
  check('desk: the link line says Konnect Live is linked', await waitForLink(desk, 'Konnect Live: linked, ready.'), await shadowText(desk, '.link'));
  const link = await stored(desk, '_workToolsLinkState');
  check('link state has the agreed shape', link && link.state === 'idle' && typeof link.text === 'string' && !Number.isNaN(Date.parse(link.at)), link);
  check('nothing is sent to Konnect Live before anything asks', (await sentToLive(manager)).length === 0);

  await desk.evaluate(() => { window.__openedByDesk = 0; window.open = () => { window.__openedByDesk++; return null; }; });
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('desk: SLA Manager says it sent the batch', await waitForState(desk, ['sent']), await stored(desk, '_workToolsLiveStatus'));
  check('desk: its status text is shown', (await deskStatus(desk)) === ((await stored(desk, '_workToolsLiveStatus')) || {}).text, await deskStatus(desk));
  const sent = await sentToLive(manager);
  const batch = sent[0] || {};
  const lines = batch.tsv ? batch.tsv.split('\n') : [];
  check('SLA Manager passed the Parked Calls to its Live tab once, with an id', sent.length === 1 && batch.type === 'workTools:batch' && batch.kind === 'leads' && typeof batch.id === 'string' && batch.id.length > 0, sent);
  check('batch is the customer search table the Lead Checker reads', /^Name\tDetails\tVehicles\tMagic Num/.test(lines[0] || '') && lines.length === 3 && lines.some((l) => l.includes('jo.example@example.com')), lines);
  check('the desk opened no tab of its own', (await desk.evaluate(() => window.__openedByDesk)) === 0);
  check('the Live address is remembered', await manager.evaluate(() => localStorage.getItem('_slaKonnectLiveUrl')) === LIVE_URL);

  await fromLive(manager, { type: 'workTools:received', id: batch.id, rows: 2 });
  check('desk: shows the Lead Checker is checking', await waitForState(desk, ['checking']), await stored(desk, '_workToolsLiveStatus'));
  await ready(manager, 'running', batch.id, 1, 2);
  check('desk: the link line shows the progress', await waitForLink(desk, 'Konnect Live: checking 1 of 2.'), await shadowText(desk, '.link'));
  await fromLive(manager, { type: 'workTools:results', id: batch.id, partial: true, done: 1, total: 2, kind: 'leads', tsv: resultsTsv([['Jo Example', 'jo.example@example.com', 'send back through', 'Actioned by dealership']]) });
  await desk.waitForFunction(() => /^1\s*to send back through/.test((document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.big-count') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  check('the first send back shows before the batch ends', /^1\s*to send back through/.test(await shadowText(desk, '.big-count') || ''), await shadowText(desk, '.big-count'));
  await fromLive(manager, { type: 'workTools:results', id: batch.id, kind: 'leads', done: 2, total: 2, tsv: resultsTsv([['Jo Example', 'jo.example@example.com', 'send back through', 'Actioned by dealership'], ['Al Sample', 'al.sample@example.com', 'check: needs contact?', '']]) });
  await fromLive(manager, { type: 'workTools:ended', id: batch.id, reason: 'done' });
  check('desk: done', await waitForState(desk, ['done', 'ended']), await stored(desk, '_workToolsLiveStatus'));
  const results = await stored(desk, '_workToolsDeskResults');
  check('desk results have the agreed shape', results && !Number.isNaN(Date.parse(results.savedAt)) && Array.isArray(results.results) && results.results.length === 2
    && results.results.every((r) => r.name && r.email && r.postClosureAction && !Number.isNaN(Date.parse(r.checkedAt))), results);
  await desk.waitForFunction(() => /1 needs contact/.test(document.querySelector('#_leadResetPanel').shadowRoot.textContent), null, { timeout: 5000 }).catch(() => {});
  check('the one that needs contact is counted, not sent back', /1 needs contact, so it is left for you to call/.test(await shadowText(desk, '.card') || ''), await shadowText(desk, '.card'));
  check('SLA Manager\'s own lead card results are untouched', await manager.evaluate(() => localStorage.getItem('_slaLeadCheckerImportState')) === null);

  // SLA Manager's bookmark clicked again: still one answer per message.
  await manager.addScriptTag({ content: slaScript });
  await ready(manager);
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  await waitForState(desk, ['sent']);
  await desk.waitForTimeout(500);
  check('after a second click of SLA Manager the batch is still sent once', (await sentToLive(manager)).length === 2, await sentToLive(manager));
  check('no page errors', errors.length === 0 && managerErrors.length === 0, errors.concat(managerErrors));
  await context.close();
}

async function deskWaitsItsTurn() {
  console.log('\nRelay: the desk batch waits for SLA Manager\'s own batch');
  const { context, page: desk, errors } = await openDesk({ status: 'Shift Start', customers: [postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')] }, {});
  const { page: manager, errors: managerErrors } = await openManager(context);
  await ready(manager);
  await manager.evaluate(() => window._sendBatchToLeadChecker('leads', 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\nSam Buyer\t\tsam.buyer@example.com\tPost Closure Processing\tPeugeot - Enquiry - New\tSat, 26 Sep 2026 10:00'));
  await waitForSent(manager, 1);
  const own = (await sentToLive(manager))[0] || {};
  check('SLA Manager\'s own batch carries an id', own.type === 'workTools:batch' && typeof own.id === 'string' && own.id.length > 0, own);
  await fromLive(manager, { type: 'workTools:received', id: own.id, rows: 1 });
  await ready(manager, 'running', own.id, 0, 1);
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('desk: told its batch is waiting', await waitForState(desk, ['waiting']), await stored(desk, '_workToolsLiveStatus'));
  check('the desk batch is held while the other runs', (await sentToLive(manager)).length === 1, await sentToLive(manager));
  await fromLive(manager, { type: 'workTools:results', id: own.id, kind: 'leads', done: 1, total: 1, tsv: resultsTsv([['Sam Buyer', 'sam.buyer@example.com', 'send back through', 'Email only']]) });
  await fromLive(manager, { type: 'workTools:ended', id: own.id, reason: 'done' });
  check('SLA Manager\'s own results go to its lead cards', await manager.evaluate(() => (JSON.parse(localStorage.getItem('_slaLeadCheckerImportState') || '{}').results || []).length) === 1);
  check('then the desk batch goes by itself', await waitForSent(manager, 2) && await waitForState(desk, ['sent']), await sentToLive(manager));
  const deskBatch = (await sentToLive(manager))[1] || {};
  check('the desk batch has its own id', deskBatch.id && deskBatch.id !== own.id, deskBatch.id);
  const results = await stored(desk, '_workToolsDeskResults');
  check('Post Closure rows from SLA Manager\'s own batch are merged into the desk results', results && (results.results || []).some((r) => r.email === 'sam.buyer@example.com' && r.postClosureAction === 'send back through'), results);
  // Results for an id nobody sent are not the desk's.
  await fromLive(manager, { type: 'workTools:received', id: deskBatch.id, rows: 1 });
  await fromLive(manager, { type: 'workTools:results', id: deskBatch.id, kind: 'leads', done: 1, total: 1, tsv: resultsTsv([['Jo Example', 'jo.example@example.com', 'send back through', 'Actioned by dealership']]) });
  await fromLive(manager, { type: 'workTools:ended', id: deskBatch.id, reason: 'done' });
  check('desk: done, routed by the batch id', await waitForState(desk, ['done', 'ended']), await stored(desk, '_workToolsLiveStatus'));
  const merged = await stored(desk, '_workToolsDeskResults');
  check('the desk results now hold both customers', merged && ['jo.example@example.com', 'sam.buyer@example.com'].every((e) => merged.results.some((r) => r.email === e)), merged);
  check('no page errors', errors.length === 0 && managerErrors.length === 0, errors.concat(managerErrors));
  await context.close();
}

async function deskBeforeManager() {
  console.log('\nRelay: desk asks before SLA Manager is running, and a withdrawn request');
  const { context, page: desk, errors } = await openDesk({ status: 'Shift Start', customers: [postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')] }, {});
  check('desk: the link line says SLA Manager is not running', (await shadowText(desk, '.link')) === 'SLA Manager is not running. Click Work Tools on the Konnect Manager tab.', await shadowText(desk, '.link'));
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  const notPicked = await desk.waitForFunction(() => /has not picked this up/.test((document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.hub-status') || {}).textContent || ''), null, { timeout: 15000 }).then(() => true, () => false);
  check('desk: says SLA Manager has not picked it up', notPicked, await deskStatus(desk));
  const { page: manager, errors: managerErrors } = await openManager(context);
  check('desk: SLA Manager takes the waiting request once its bookmark is clicked', await waitForState(desk, ['waiting']), await stored(desk, '_workToolsLiveStatus'));
  check('desk: the link line says Konnect Live is not open', await waitForLink(desk, 'Konnect Live: not open. Press Open Konnect Live in SLA Manager.'), await shadowText(desk, '.link'));
  check('nothing sent before the Live tab links', (await sentToLive(manager)).length === 0);
  await ready(manager);
  check('sent as soon as the Live tab says it is ready', await waitForState(desk, ['sent']) && (await sentToLive(manager)).length === 1, await sentToLive(manager));
  const first = (await sentToLive(manager))[0] || {};
  await fromLive(manager, { type: 'workTools:received', id: first.id, rows: 1 });
  await fromLive(manager, { type: 'workTools:ended', id: first.id, reason: 'cancelled' });
  check('desk: told when the Lead Checker cancels the batch', await waitForState(desk, ['ended', 'failed']), await stored(desk, '_workToolsLiveStatus'));

  // A request made while Konnect Live is busy, then withdrawn by Clear & Stop.
  await ready(manager, 'paused');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  await waitForState(desk, ['waiting']);
  await desk.click('#_leadResetPanel [data-action=clearStop]');
  await desk.waitForTimeout(500);
  await ready(manager);
  await manager.waitForTimeout(1500);
  check('a request withdrawn by Clear & Stop is not sent', (await sentToLive(manager)).length === 1, await sentToLive(manager));
  check('no page errors', errors.length === 0 && managerErrors.length === 0, errors.concat(managerErrors));
  await context.close();
}

const started = Date.now();
const tests = [postClosureNoReview, postClosureWithReview, postClosureOtherEmail, emailOnly, secondLoadSkipAndStop, slowPage, notesPutBack, emailOnlyChecks,
  emailOnlyClearAndStop, pauseReopensThePanel, sharedStorage, realKonnectNotes, parkedCallsThroughManager, deskWaitsItsTurn, deskBeforeManager];
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
