#!/usr/bin/env node
// Browser tests for the Post Closure send back and Email Only runs in
// Lead-Reset.js, against the mock agent desktop in
// tests/agent-desktop-mock/desk.html. Needs Playwright with Chromium. Run
// from the repo root:
//
//   node tests/desk-runs.e2e.mjs
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

const browser = await chromium.launch();

const CAD = '**** Catch All Return Lead **** Lead has been **actioned by dealer**';
const CAH = '**** Catch All Return Lead **** **Customer Hub will not contact this lead type** - please contact and update Emax';

async function openDesk(setup, storage) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ commit: { committer: { date: '2026-01-02T03:04:00Z' } } }]) }));
  await context.route('**/raw.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: script }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/desk.html#!/idle`);
  await page.evaluate(({ setup, storage }) => {
    window.mock.setup(setup);
    const now = new Date().toISOString();
    Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify({ savedAt: now, ...value })));
  }, { setup, storage });
  await page.addScriptTag({ content: script });
  await page.waitForSelector('#_leadResetPanel [data-action=view]', { timeout: 5000 });
  return { context, page, errors };
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
    return { running: s.running, paused: s.paused && s.paused.message, carryOnLabel: s.paused && s.paused.carryOnLabel, log: s.log.slice(), events: window.events.slice(), snapshots: window.snapshots.slice() };
  });
}

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
    _slaLeadCheckerImportState: { results: [
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
    _slaLeadCheckerImportState: { results: [
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
    // Try again at the check is not an approval: it asks again.
    await page.click('#_leadResetPanel [data-action=retry]');
    await page.waitForTimeout(1500);
    const again = await settle(page);
    check(`${id}: Try again at the check does not press Finished`, /Carry on to press Finished/.test(again.paused || '') && !again.events.includes(`FINISHED:${id}`), again.paused || again.events);
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
  }, { _slaLeadCheckerImportState: { results: [sendBack('Jo Example', 'jo.old@example.com', '07700 900101', 'Actioned by dealership')] } });
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

// The desk's Parked Calls go to the Lead Checker through SLA Manager, open
// in its own tab: both pages are on one site, so they share storage. The
// real SLA Manager script runs in manager.html, whose hidden frame stands in
// for the Konnect Live tab it opened.
const RESULTS_HEADER = 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\tInitialNotes\tTier\tTierName\tSubCategory\tSubRank\tFlags\tConfidence\tReason\tDedupeKey\tPostClosureAction\tPriorityRank\tPostClosureReason\tPostClosureEvidence';
const resultsTsv = (rows) => [RESULTS_HEADER, ...rows.map(([name, email, action, reason]) => `${name}\t\t${email}\tPost Closure Processing\t\t\t\t\t\t\t\t\tmedium\t\t\t${action}\t-2\t${reason}\t`)].join('\n');
const slaScript = readFileSync(join(here, '..', 'SLA-Manager.js'), 'utf8');

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
const deskStatus = async (desk) => (await shadowText(desk, '.hub-status')) || '';
const waitForStatus = (desk, re) => desk.waitForFunction((src) => {
  const el = document.querySelector('#_leadResetPanel').shadowRoot.querySelector('.hub-status');
  return el && new RegExp(src).test(el.textContent);
}, re.source, { timeout: 15000 }).then(() => true, () => false);

async function parkedCallsThroughManager() {
  console.log('\nPost Closure, Parked Calls checked through SLA Manager (both tabs already open)');
  const customers = [
    postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', ''),
    postClosureCustomer('al', 'Al Sample', 'al.sample@example.com', '07700 900103', '')
  ];
  const { context, page: desk, errors } = await openDesk({ status: 'Shift Start', customers }, {});
  const { page: manager, errors: managerErrors } = await openManager(context);
  // The Live tab SLA Manager opened earlier says it is ready (it repeats this).
  await manager.evaluate(() => window.fromLive({ type: 'workTools:ready', url: 'https://carbot.ai/konnectlive/(v1.2.200)/home.html' }));
  check('nothing is sent to Konnect Live before anything asks', (await sentToLive(manager)).length === 0);

  await desk.evaluate(() => { window.__openedByDesk = 0; window.open = () => { window.__openedByDesk++; return null; }; });
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('desk: SLA Manager says it sent the batch', await waitForStatus(desk, /Sent to the Lead Checker/), await deskStatus(desk));
  const sent = await sentToLive(manager);
  const lines = sent[0] && sent[0].tsv ? sent[0].tsv.split('\n') : [];
  check('SLA Manager passed the Parked Calls to its Live tab once', sent.length === 1 && sent[0].type === 'workTools:batch' && sent[0].kind === 'leads', sent);
  check('batch is the customer search table the Lead Checker reads', /^Name\tDetails\tVehicles\tMagic Num/.test(lines[0] || '') && lines.length === 3 && lines.some((l) => l.includes('jo.example@example.com')), lines);
  check('the desk opened no tab of its own', (await desk.evaluate(() => window.__openedByDesk)) === 0);
  check('the Live address is remembered', await manager.evaluate(() => localStorage.getItem('_slaKonnectLiveUrl')) === 'https://carbot.ai/konnectlive/(v1.2.200)/home.html');

  await manager.evaluate(() => window.fromLive({ type: 'workTools:received', rows: 2 }));
  check('desk: shows the Lead Checker is checking', await waitForStatus(desk, /checking 2 leads/), await deskStatus(desk));
  await manager.evaluate((t) => window.fromLive({ type: 'workTools:results', partial: true, done: 1, total: 2, kind: 'leads', tsv: t }), resultsTsv([['Jo Example', 'jo.example@example.com', 'send back through', 'Actioned by dealership']]));
  check('desk: progress shown', await waitForStatus(desk, /1 of 2 checked/), await deskStatus(desk));
  check('the first send back shows before the batch ends', /^1\s*to send back through/.test(await shadowText(desk, '.big-count') || ''), await shadowText(desk, '.big-count'));
  await manager.evaluate((t) => window.fromLive({ type: 'workTools:results', kind: 'leads', tsv: t }), resultsTsv([['Jo Example', 'jo.example@example.com', 'send back through', 'Actioned by dealership'], ['Al Sample', 'al.sample@example.com', 'check: needs contact?', '']]));
  check('desk: done', await waitForStatus(desk, /Lead Checker done: 2 checked/), await deskStatus(desk));
  check('the one that needs contact is counted, not sent back', /1 need contact/.test(await shadowText(desk, '.card') || ''), await shadowText(desk, '.card'));
  check('SLA Manager\'s own lead card results are untouched', await manager.evaluate(() => localStorage.getItem('_slaLeadCheckerImportState')) === null);

  // SLA Manager's bookmark clicked again: still one answer per message.
  await manager.addScriptTag({ content: slaScript });
  await manager.evaluate(() => window.fromLive({ type: 'workTools:ready' }));
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('after a second click of SLA Manager the batch is still sent once', await waitForStatus(desk, /Sent to the Lead Checker/) && (await sentToLive(manager)).length === 2, await sentToLive(manager));
  check('no page errors', errors.length === 0 && managerErrors.length === 0, errors.concat(managerErrors));
  await context.close();
}

async function deskWaitsItsTurn() {
  console.log('\nPost Closure, the desk batch waits for SLA Manager\'s own batch');
  const { context, page: desk, errors } = await openDesk({ status: 'Shift Start', customers: [postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')] }, {});
  const { page: manager, errors: managerErrors } = await openManager(context);
  await manager.evaluate(() => window.fromLive({ type: 'workTools:ready' }));
  await manager.evaluate(() => window._sendBatchToLeadChecker('leads', 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\nSam Buyer\t\tsam.buyer@example.com\tCustomer First\tPeugeot - Enquiry - New\tSat, 26 Sep 2026 10:00'));
  await manager.evaluate(() => window.fromLive({ type: 'workTools:received', rows: 1 }));
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('desk: told its batch goes next', await waitForStatus(desk, /yours goes next/), await deskStatus(desk));
  check('the desk batch is held while the other runs', (await sentToLive(manager)).length === 1);
  await manager.evaluate((t) => window.fromLive({ type: 'workTools:results', kind: 'leads', tsv: t }), resultsTsv([['Sam Buyer', 'sam.buyer@example.com', '', '']]));
  check('SLA Manager\'s own results go to its lead cards', await manager.evaluate(() => (JSON.parse(localStorage.getItem('_slaLeadCheckerImportState') || '{}').results || []).length) === 1);
  check('then the desk batch goes by itself', await waitForStatus(desk, /Sent to the Lead Checker/) && (await sentToLive(manager)).length === 2, await sentToLive(manager));
  check('no page errors', errors.length === 0 && managerErrors.length === 0, errors.concat(managerErrors));
  await context.close();
}

async function deskBeforeManager() {
  console.log('\nPost Closure, desk asks before SLA Manager is running');
  const { context, page: desk, errors } = await openDesk({ status: 'Shift Start', customers: [postClosureCustomer('jo', 'Jo Example', 'jo.example@example.com', '07700 900101', '')] }, {});
  await desk.click('#_leadResetPanel [data-action=view][data-view=pc]');
  await desk.click('#_leadResetPanel [data-action=checkParked]');
  check('desk: says SLA Manager has not picked it up', await waitForStatus(desk, /has not picked this up/), await deskStatus(desk));
  const { page: manager, errors: managerErrors } = await openManager(context);
  check('desk: SLA Manager takes the waiting request once its bookmark is clicked', await waitForStatus(desk, /not linked yet/), await deskStatus(desk));
  check('nothing sent before the Live tab links', (await sentToLive(manager)).length === 0);
  await manager.evaluate(() => window.fromLive({ type: 'workTools:ready' }));
  check('sent as soon as the Live tab says it is ready', await waitForStatus(desk, /Sent to the Lead Checker/) && (await sentToLive(manager)).length === 1, await sentToLive(manager));
  check('no page errors', errors.length === 0 && managerErrors.length === 0, errors.concat(managerErrors));
  await context.close();
}

const started = Date.now();
try {
  await postClosureNoReview();
  await postClosureWithReview();
  await postClosureOtherEmail();
  await emailOnly();
  await parkedCallsThroughManager();
  await deskWaitsItsTurn();
  await deskBeforeManager();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failures ? `${failures} failed` : 'All passed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
