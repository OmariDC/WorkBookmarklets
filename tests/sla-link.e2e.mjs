#!/usr/bin/env node
// Browser tests for SLA Manager's side of the Work Tools link (the hub):
// the real SLA-Manager.js runs in tests/agent-desktop-mock/manager.html and
// the test plays the Lead Checker's messages in and the agent desktop's
// storage writes. Needs Playwright with Chromium. Run from the repo root:
//
//   node tests/sla-link.e2e.mjs
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
const slaScript = readFileSync(join(here, '..', 'SLA-Manager.js'), 'utf8');

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
    res.setHeader('Content-Type', 'text/html');
    res.end(readFileSync(p));
  } else { res.statusCode = 404; res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();

const RESULTS_HEADER = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes', 'Tier', 'TierName', 'SubCategory', 'SubRank', 'Flags', 'Confidence', 'Reason', 'DedupeKey', 'PostClosureAction', 'PriorityRank', 'PostClosureReason', 'PostClosureEvidence'].join('\t');
// One results row: a Post Closure row when action is set, else a tier 2 lead.
const row = ({ name, phone = '', email = '', created = 'Sat, 26 Sep 2026 10:00', action = '', reason = '' }) =>
  [name, phone, email, action ? 'Post Closure Processing' : 'Customer First', 'Peugeot - Enquiry - New', created, '-', action ? '' : '2', action ? '' : 'DATE ONLY', '', '', '', 'medium', '', '', action, action ? '-2' : '203', reason, ''].join('\t');
const resultsTsv = (rows) => [RESULTS_HEADER, ...rows.map(row)].join('\n');
const LEADS_TSV = 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\nSam Buyer\t\tsam.buyer@example.com\tCustomer First\tPeugeot - Enquiry - New\tSat, 26 Sep 2026 10:00';
const DESK_TSV = 'Name\tDetails\tVehicles\tMagic Num\tDealer\tBrand\tCampaign\tBest Number\tEmail\tAddress\tConfirm\nJo Example\t\t\t\t\t\t\t07700 900101\tjo.example@example.com\t\t';
// Fast ticks; the long waits (resend, link down) are shortened per test.
const FAST = { tickMs: 40, heartbeatMs: 100, lostGraceMs: 0 };

// The manager page running SLA Manager, and a second page on the same site
// standing in for the agent desktop (it only writes and reads storage).
async function open(timing) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.route('**/api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await context.route('**/raw.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: slaScript }));
  const desk = await context.newPage();
  await desk.goto(`${base}/manager.html`);
  const manager = await context.newPage();
  const errors = [];
  manager.on('pageerror', (e) => errors.push(e.message));
  manager.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await manager.goto(`${base}/manager.html`);
  await manager.evaluate((t) => { window.__workToolsLinkTiming = t; }, { ...FAST, ...(timing || {}) });
  await manager.addScriptTag({ content: slaScript });
  return { context, manager, desk, errors };
}
const fromLive = (manager, data) => manager.evaluate((d) => window.fromLive(d), data);
const toLive = (manager) => manager.evaluate(() => window.toLive.slice());
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
const link = (manager) => manager.evaluate(() => { const l = window.__workToolsLiveLink; return { state: l.state, queue: l.queue.map((b) => b.id), sent: l.sent ? l.sent.batch.id : null, running: l.running ? l.running.id : null }; });
const send = (manager, kind = 'leads', tsv = LEADS_TSV) => manager.evaluate(([k, t]) => window._sendBatchToLeadChecker(k, t), [kind, tsv]);
const deskAsks = (desk, id, extra) => desk.evaluate(([i, t, e]) => localStorage.setItem('_workToolsLiveRequest', JSON.stringify({ id: i, at: new Date().toISOString(), rows: 1, tsv: t, ...e })), [id, DESK_TSV, extra || {}]);
const waitFor = async (read, test, ms = 4000) => {
  const end = Date.now() + ms;
  let value;
  for (;;) { value = await read(); if (test(value)) return value; if (Date.now() > end) return value; await new Promise((r) => setTimeout(r, 30)); }
};
const waitStatus = (page, id, state) => waitFor(() => stored(page, '_workToolsLiveStatus'), (s) => s && s.id === id && s.state === state);
const waitSent = (manager, count) => waitFor(() => toLive(manager), (m) => m.length >= count);
const cardResults = async (manager) => ((await stored(manager, '_slaLeadCheckerImportState')) || { results: [] }).results;
const deskResults = async (page) => ((await stored(page, '_workToolsDeskResults')) || { results: [] }).results;
const ready = (manager, over) => fromLive(manager, { type: 'workTools:ready', url: 'https://carbot.ai/konnectlive/(v1.2.200)/home.html', state: 'idle', batchId: null, done: 0, total: 0, ...over });

async function idsAreRouted() {
  console.log('\nIds: a manager batch and a desk batch, messages interleaved');
  const { context, manager, desk, errors } = await open();
  await ready(manager);
  check('link line reads linked once the Lead Checker says ready', (await stored(desk, '_workToolsLinkState')).text === 'Konnect Live: linked, ready.', await stored(desk, '_workToolsLinkState'));
  await send(manager);
  let sent = await toLive(manager);
  const managerId = sent[0] && sent[0].id;
  check('the batch carries an id', sent.length === 1 && typeof managerId === 'string' && managerId.startsWith('manager-') && sent[0].kind === 'leads', sent);
  await fromLive(manager, { type: 'workTools:received', id: managerId, rows: 1 });
  await deskAsks(desk, 'desk-1');
  const waiting = await waitStatus(desk, 'desk-1', 'waiting');
  check('desk: told its batch goes next', /yours goes next/.test(waiting && waiting.text), waiting);
  check('the desk batch is held while the other runs', (await toLive(manager)).length === 1 && (await link(manager)).queue.join() === 'desk-1', await link(manager));
  await ready(manager, { state: 'running', batchId: managerId, done: 3, total: 10 });
  check('link state shows the Lead Checker\'s progress', (await stored(desk, '_workToolsLinkState')).text === 'Konnect Live: checking 3 of 10.', await stored(desk, '_workToolsLinkState'));
  check('a ready that says running sends nothing', (await toLive(manager)).length === 1);
  await fromLive(manager, { type: 'workTools:results', id: managerId, kind: 'leads', partial: true, done: 1, total: 2, tsv: resultsTsv([{ name: 'Sam Buyer', email: 'sam.buyer@example.com' }]) });
  check('partial results reach the lead cards', (await cardResults(manager)).length === 1);
  check('partial results do not end the batch', (await link(manager)).running === managerId);
  await fromLive(manager, { type: 'workTools:results', id: managerId, kind: 'leads', tsv: resultsTsv([{ name: 'Sam Buyer', email: 'sam.buyer@example.com' }, { name: 'Pat Closure', email: 'pat.closure@example.com', created: 'Sat, 26 Sep 2026 11:00', action: 'send back through', reason: 'Email only' }]) });
  check('final results alone do not send the next batch', (await toLive(manager)).length === 1 && (await link(manager)).running === managerId, await link(manager));
  await fromLive(manager, { type: 'workTools:ended', id: managerId, reason: 'done' });
  sent = await waitSent(manager, 2);
  check('after ended the desk batch goes, with its own id', sent.length === 2 && sent[1].id === 'desk-1' && sent[1].kind === 'leads', sent.map((m) => m.id));
  check('desk: told it was sent', ((await waitStatus(desk, 'desk-1', 'sent')) || {}).state === 'sent');
  await fromLive(manager, { type: 'workTools:received', id: 'desk-1', rows: 1 });
  check('desk: checking', /checking 1 lead\./.test(((await waitStatus(desk, 'desk-1', 'checking')) || {}).text));
  // A late message for the first batch arrives while the desk's is running.
  await fromLive(manager, { type: 'workTools:results', id: managerId, kind: 'leads', tsv: resultsTsv([{ name: 'Late Lead', email: 'late.lead@example.com', created: 'Sat, 26 Sep 2026 12:00' }]) });
  check('a late result is filed by its id, on the lead cards', (await cardResults(manager)).map((r) => r.name).sort().join() === 'Late Lead,Pat Closure,Sam Buyer', (await cardResults(manager)).map((r) => r.name));
  check('and the desk batch is still running', (await link(manager)).running === 'desk-1' && (await stored(desk, '_workToolsLiveStatus')).state === 'checking');
  const cardsBefore = (await cardResults(manager)).length;
  await fromLive(manager, { type: 'workTools:results', id: 'desk-1', kind: 'leads', tsv: resultsTsv([{ name: 'Jo Example', email: 'jo.example@example.com', action: 'send back through', reason: 'Actioned by dealership' }]) });
  check('desk results never touch the lead cards', (await cardResults(manager)).length === cardsBefore);
  check('desk: done with the count', /Lead Checker done: 1 checked/.test(((await waitStatus(desk, 'desk-1', 'done')) || {}).text), await stored(desk, '_workToolsLiveStatus'));
  const merged = await deskResults(desk);
  check('Post Closure rows from both batches are in the desk results', merged.map((r) => r.name).join() === 'Pat Closure,Jo Example' && merged.every((r) => r.checkedAt && r.postClosureAction === 'send back through'), merged);
  check('the desk results carry no tier or notes', merged.every((r) => !('tier' in r) && !('initialNotes' in r)), merged[0]);
  await fromLive(manager, { type: 'workTools:ended', id: 'desk-1', reason: 'done' });
  check('desk: still done after ended', (await stored(desk, '_workToolsLiveStatus')).state === 'done' && /1 checked/.test((await stored(desk, '_workToolsLiveStatus')).text));
  check('nothing left running or waiting', JSON.stringify(await link(manager)) === JSON.stringify({ state: 'idle', queue: [], sent: null, running: null }), await link(manager));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function endedReasons() {
  console.log('\nEnded: each reason, and the next batch follows');
  const { context, manager, desk, errors } = await open();
  await ready(manager);
  const expected = { cancelled: /cancelled/, cleared: /cleared/, empty: /no leads to check/, unreadable: /could not read/ };
  let count = 0;
  for (const [reason, text] of Object.entries(expected)) {
    const id = `desk-${reason}`;
    await deskAsks(desk, id);
    await waitSent(manager, ++count);
    await fromLive(manager, { type: 'workTools:received', id, rows: 1 });
    await fromLive(manager, { type: 'workTools:ended', id, reason });
    const status = await waitStatus(desk, id, 'ended');
    check(`ended "${reason}" is passed to the desk in plain words`, status && status.state === 'ended' && text.test(status.text), status);
    check(`after "${reason}" nothing is left running`, (await link(manager)).running === null && (await link(manager)).state === 'idle', await link(manager));
  }
  await deskAsks(desk, 'desk-done');
  await waitSent(manager, ++count);
  await fromLive(manager, { type: 'workTools:received', id: 'desk-done', rows: 0 });
  await fromLive(manager, { type: 'workTools:ended', id: 'desk-done', reason: 'done' });
  check('ended "done" with no results still tells the desk it is done', ((await waitStatus(desk, 'desk-done', 'done')) || {}).state === 'done', await stored(desk, '_workToolsLiveStatus'));
  // A manager batch that is cancelled lets the waiting desk batch go.
  await send(manager);
  const managerId = (await waitSent(manager, ++count))[count - 1].id;
  await fromLive(manager, { type: 'workTools:received', id: managerId, rows: 1 });
  await deskAsks(desk, 'desk-after');
  await waitStatus(desk, 'desk-after', 'waiting');
  await fromLive(manager, { type: 'workTools:ended', id: managerId, reason: 'cancelled' });
  const sent = await waitSent(manager, ++count);
  check('the next batch goes right after ended', sent.length === count && sent[count - 1].id === 'desk-after', sent.map((m) => m.id));
  check('the owner is told the batch was cancelled', /cancelled/.test(await manager.evaluate(() => (document.getElementById('_slaLinkToast') || {}).textContent || '')));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function lostBatch() {
  console.log('\nLost: the Live tab reloads mid-batch');
  const { context, manager, desk, errors } = await open();
  await ready(manager);
  await deskAsks(desk, 'desk-1');
  await waitSent(manager, 1);
  await fromLive(manager, { type: 'workTools:received', id: 'desk-1', rows: 4 });
  await fromLive(manager, { type: 'workTools:results', id: 'desk-1', kind: 'leads', partial: true, done: 1, total: 4, tsv: resultsTsv([{ name: 'Jo Example', email: 'jo.example@example.com', action: 'check: needs contact?' }]) });
  await ready(manager, { state: 'running', batchId: 'desk-1', done: 1, total: 4 });
  check('a ready naming the batch keeps it running', (await link(manager)).running === 'desk-1');
  await send(manager);
  await ready(manager, { state: 'idle', batchId: null });
  const status = await waitStatus(desk, 'desk-1', 'ended');
  check('idle with no batch while one should be running: ended as lost', status && status.state === 'ended' && /reloaded/.test(status.text), status);
  check('what was already checked is kept', (await deskResults(desk)).map((r) => r.name).join() === 'Jo Example');
  const sent = await waitSent(manager, 2);
  check('the waiting batch goes next', sent.length === 2 && sent[1].id.startsWith('manager-'), sent.map((m) => m.id));
  // A reloaded SLA Manager hears about a batch it no longer remembers.
  const second = await open();
  await deskAsks(second.desk, 'desk-7');
  await waitStatus(second.desk, 'desk-7', 'waiting');
  await second.desk.evaluate(() => localStorage.setItem('_workToolsLiveStatus', JSON.stringify({ id: 'desk-7', state: 'checking', text: 'x', at: new Date().toISOString() })));
  await second.manager.evaluate(() => { const l = window.__workToolsLiveLink; l.queue = []; l.known = {}; });
  await ready(second.manager, { state: 'running', batchId: 'desk-7', done: 2, total: 5 });
  check('a batch restored by the Live tab is taken up again by its id', (await link(second.manager)).running === 'desk-7', await link(second.manager));
  await fromLive(second.manager, { type: 'workTools:results', id: 'desk-7', kind: 'leads', tsv: resultsTsv([{ name: 'Al Sample', phone: '07700 900103', action: 'send back through', reason: 'Email only' }]) });
  check('its results go to the desk, not the lead cards', (await deskResults(second.desk)).length === 1 && (await cardResults(second.manager)).length === 0);
  check('no page errors', errors.length === 0 && second.errors.length === 0, errors.concat(second.errors));
  await context.close();
  await second.context.close();
}

async function linkDown() {
  console.log('\nLink down: no ready for too long');
  const { context, manager, desk, errors } = await open({ downMs: 500 });
  check('before any ready the link is "not open"', (await stored(desk, '_workToolsLinkState')).text === 'Konnect Live: not open. Press Open Konnect Live in SLA Manager.', await stored(desk, '_workToolsLinkState'));
  const firstAt = (await stored(desk, '_workToolsLinkState')).at;
  await ready(manager, { state: 'running', batchId: null });
  await deskAsks(desk, 'desk-1');
  await waitStatus(desk, 'desk-1', 'waiting');
  check('linked while ready keeps coming', (await stored(desk, '_workToolsLinkState')).state === 'running');
  const down = await waitFor(() => stored(desk, '_workToolsLinkState'), (s) => s.state === 'none');
  check('with no ready the link goes down', down.state === 'none' && /not open/.test(down.text), down);
  check('the waiting batch is kept', (await link(manager)).queue.join() === 'desk-1');
  const status = await waitFor(() => stored(desk, '_workToolsLiveStatus'), (s) => s && /stopped answering/.test(s.text));
  check('the desk is told', status.state === 'waiting' && /stopped answering/.test(status.text), status);
  const later = await waitFor(() => stored(desk, '_workToolsLinkState'), (s) => s.at !== down.at);
  check('the link state is still rewritten, so the desk knows SLA Manager is running', later.at !== down.at && later.at !== firstAt && later.state === 'none', later);
  check('nothing was sent while down', (await toLive(manager)).length === 0);
  await ready(manager);
  const sent = await waitSent(manager, 1);
  check('when ready comes back the batch goes', sent.length === 1 && sent[0].id === 'desk-1', sent.map((m) => m.id));
  // Sent but never acknowledged when the link drops: back in the queue.
  await waitFor(() => link(manager), (l) => l.state === 'none');
  check('a batch sent but not acknowledged waits again when the link drops', JSON.stringify(await link(manager)) === JSON.stringify({ state: 'none', queue: ['desk-1'], sent: null, running: null }), await link(manager));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function resend() {
  console.log('\nResend: a batch not acknowledged is sent again');
  const { context, manager, errors } = await open({ resendMs: 300 });
  await ready(manager);
  await send(manager);
  const first = await toLive(manager);
  check('sent once straight away', first.length === 1);
  const again = await waitSent(manager, 2);
  check('sent again with the same id when no "received" comes', again.length >= 2 && again[1].id === again[0].id && again[1].tsv === again[0].tsv, again.map((m) => m.id));
  await fromLive(manager, { type: 'workTools:received', id: again[0].id, rows: 1 });
  const countNow = (await toLive(manager)).length;
  await new Promise((r) => setTimeout(r, 700));
  check('not sent again once received', (await toLive(manager)).length === countNow);
  // Sent twice and the first copy is running: "busy" names it as running.
  await fromLive(manager, { type: 'workTools:ended', id: again[0].id, reason: 'done' });
  await send(manager);
  const next = (await toLive(manager)).pop();
  await fromLive(manager, { type: 'workTools:busy', id: next.id, runningId: next.id });
  check('busy for the batch that is itself running counts as received', (await link(manager)).running === next.id && (await link(manager)).queue.length === 0, await link(manager));
  await fromLive(manager, { type: 'workTools:ended', id: next.id, reason: 'done' });
  // Refused because something else is running: it waits for idle.
  await send(manager);
  const refused = (await toLive(manager)).pop();
  await fromLive(manager, { type: 'workTools:busy', id: refused.id, runningId: null });
  const sentCount = (await toLive(manager)).length;
  await new Promise((r) => setTimeout(r, 600));
  check('a refused batch waits and is not sent again while the Lead Checker is busy', (await toLive(manager)).length === sentCount && (await link(manager)).queue.join() === refused.id, await link(manager));
  for (const state of ['paused', 'loggedOut', 'running']) await ready(manager, { state });
  check('paused, logged out and running send nothing', (await toLive(manager)).length === sentCount);
  await ready(manager);
  check('it goes when the Lead Checker says idle', (await waitSent(manager, sentCount + 1)).pop().id === refused.id);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function queueAndRequests() {
  console.log('\nQueue and desk requests');
  const { context, manager, desk, errors } = await open();
  // Not linked yet: batches wait.
  await send(manager, 'leads');
  await send(manager, 'national', 'NationalCheck\tCustomer\nnational\tJo Example');
  await send(manager, 'leads', LEADS_TSV + '\nAl Sample\t\tal.sample@example.com\tCustomer First\tX\tSat, 26 Sep 2026 10:00');
  await deskAsks(desk, 'desk-1');
  const waiting = await waitStatus(desk, 'desk-1', 'waiting');
  check('desk: told Konnect Live is not linked yet', /not linked yet/.test(waiting && waiting.text), waiting);
  const queue = await manager.evaluate(() => window.__workToolsLiveLink.queue.map((b) => `${b.from}:${b.kind}:${b.tsv.split('\n').length - 1}`));
  check('a newer batch replaces a waiting one only from the same page and of the same kind', queue.join() === 'manager:national:1,manager:leads:2,desk:leads:1', queue);
  await deskAsks(desk, 'desk-1', { cancelled: true, tsv: undefined });
  await waitFor(() => link(manager), (l) => !l.queue.includes('desk-1'));
  check('a request the desk withdraws is dropped', !(await link(manager)).queue.includes('desk-1'), await link(manager));
  await desk.evaluate((t) => localStorage.setItem('_workToolsLiveRequest', JSON.stringify({ id: 'desk-old', at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), rows: 1, tsv: t })), DESK_TSV);
  await new Promise((r) => setTimeout(r, 300));
  check('a request older than 10 minutes is ignored', !(await link(manager)).queue.includes('desk-old'));
  await desk.evaluate((t) => localStorage.setItem('_workToolsLiveRequest', JSON.stringify({ id: 'desk-nine', at: new Date(Date.now() - 9 * 60 * 1000).toISOString(), rows: 1, tsv: t })), DESK_TSV);
  await waitFor(() => link(manager), (l) => l.queue.includes('desk-nine'));
  check('a request 9 minutes old is still taken', (await link(manager)).queue.includes('desk-nine'));
  check('nothing is sent before the link is up', (await toLive(manager)).length === 0);
  await ready(manager);
  check('one batch at a time once linked', (await waitSent(manager, 1)).length === 1 && (await link(manager)).queue.length === 2, await link(manager));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function deskResultsMerge() {
  console.log('\nDesk results: merged, never replaced');
  const { context, manager, desk, errors } = await open();
  await ready(manager);
  const run = async (rows) => {
    await send(manager);
    const id = (await toLive(manager)).pop().id;
    await fromLive(manager, { type: 'workTools:received', id, rows: rows.length });
    await fromLive(manager, { type: 'workTools:results', id, kind: 'leads', tsv: resultsTsv(rows) });
    await fromLive(manager, { type: 'workTools:ended', id, reason: 'done' });
  };
  await run([
    { name: 'Jo Example', email: 'jo.example@example.com', action: 'check: needs contact?' },
    { name: 'Al Sample', phone: '07700 900103', action: 'send back through', reason: 'Email only' },
    { name: 'Sam Buyer', email: 'sam.buyer@example.com' }
  ]);
  check('first batch: only its Post Closure rows are kept for the desk', (await deskResults(desk)).map((r) => r.name).join() === 'Jo Example,Al Sample', await deskResults(desk));
  await run([
    { name: 'Jo Example', email: 'JO.Example@example.com', action: 'send back through', reason: 'Actioned by dealership' },
    { name: 'Mr Al Sample', phone: '+44 7700 900103', action: 'check: needs contact?' },
    { name: 'Pat Closure', action: 'send back through', reason: 'Email only', created: 'Sat, 26 Sep 2026 12:00' }
  ]);
  const merged = await deskResults(desk);
  check('second batch merges by email, else phone, else name; the newer row wins', merged.map((r) => `${r.name}=${r.postClosureAction}`).join('|') === 'Jo Example=send back through|Mr Al Sample=check: needs contact?|Pat Closure=send back through', merged);
  check('the lead cards keep both batches too, one result per contact', (await cardResults(manager)).map((r) => r.name).sort().join() === 'Jo Example,Mr Al Sample,Pat Closure,Sam Buyer', (await cardResults(manager)).map((r) => r.name));
  // Pasted by hand in the panel: Post Closure rows reach the desk as well.
  await manager.evaluate((tsv) => {
    window._toggleMorningChecks();
    const button = document.createElement('button');
    document.body.appendChild(button);
    const box = document.createElement('textarea');
    box.id = 'leadCheckerImportBox';
    box.value = tsv;
    document.body.appendChild(box);
    window._classifyLeadCheckerImport(button);
  }, resultsTsv([{ name: 'Di Paste', email: 'di.paste@example.com', action: 'send back through', reason: 'Email only' }]));
  check('results pasted by hand are merged in as well', (await deskResults(desk)).map((r) => r.name).join() === 'Jo Example,Mr Al Sample,Pat Closure,Di Paste', (await deskResults(desk)).map((r) => r.name));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function openWithNoLeads() {
  console.log('\nOpen Konnect Live with no leads');
  const { context, manager, desk, errors } = await open();
  const flash = await manager.evaluate(() => { const b = document.createElement('button'); b.textContent = 'Send'; window._sendToLeadChecker(b, 'leads'); return b.textContent; });
  check('Send with no leads opens nothing', flash === 'No leads' && (await manager.evaluate(() => window.opened)) === 0);
  await manager.evaluate(() => window._toggleMorningChecks());
  // On the panel the strip is short and its button says the rest; the text stored for the desk keeps the full sentence.
  check('the panel shows the link strip, "not open", with an Open Konnect Live button', await manager.evaluate(() => { const line = document.getElementById('_slaLinkLine'); const button = line && line.querySelector('button'); return !!button && button.textContent.trim() === 'Open Konnect Live' && line.querySelector('span:not(.sla-dot)').textContent.trim() === 'Konnect Live: not open'; }), await manager.evaluate(() => (document.getElementById('_slaLinkLine') || {}).textContent));
  await manager.click('#_slaLinkLine button');
  check('Open Konnect Live opens the tab with nothing to send', (await manager.evaluate(() => window.opened)) === 1 && (await toLive(manager)).length === 0);
  await manager.evaluate(() => window._openKonnectLive());
  check('pressing it again reuses the tab', (await manager.evaluate(() => window.opened)) === 1);
  await ready(manager);
  check('the line follows the link without a redraw', await manager.evaluate(() => { const line = document.getElementById('_slaLinkLine'); return line.textContent.trim() === 'Konnect Live: linked, ready' && !line.querySelector('button'); }));
  await deskAsks(desk, 'desk-1');
  check('the desk batch can then go with no Send pressed', (await waitSent(manager, 1)).length === 1 && (await manager.evaluate(() => window.opened)) === 1);
  for (const [state, text] of [['paused', 'Konnect Live: paused.'], ['loggedOut', 'Konnect Live: logged out, logging back in.']]) {
    await ready(manager, { state, batchId: null });
    check(`line wording for ${state}`, (await manager.evaluate(() => document.getElementById('_slaLinkLine').textContent.trim())).startsWith(text.replace(/\.$/, '')) && (await stored(desk, '_workToolsLinkState')).text === text, await stored(desk, '_workToolsLinkState'));
  }
  // Clear & Stop really stops the link.
  await manager.evaluate(() => window._slaResetBookmarklet());
  const stoppedAt = (await stored(desk, '_workToolsLinkState')).at;
  await new Promise((r) => setTimeout(r, 400));
  await ready(manager);
  await deskAsks(desk, 'desk-2');
  await new Promise((r) => setTimeout(r, 300));
  check('after Clear & Stop the link state is no longer rewritten', (await stored(desk, '_workToolsLinkState')).at === stoppedAt);
  check('and nothing is answered or sent', (await toLive(manager)).length === 1 && ((await stored(desk, '_workToolsLiveStatus')) || {}).id !== 'desk-2');
  await manager.addScriptTag({ content: slaScript });
  check('clicking the bookmark again takes the waiting request', ((await waitStatus(desk, 'desk-2', 'waiting')) || (await waitStatus(desk, 'desk-2', 'sent')) || {}).id === 'desk-2', await stored(desk, '_workToolsLiveStatus'));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function olderLeadChecker() {
  console.log('\nOlder Lead Checker: no ids, no state, no ended');
  const { context, manager, desk, errors } = await open();
  await fromLive(manager, { type: 'workTools:ready', url: 'https://carbot.ai/konnectlive/(v1.2.200)/home.html' });
  check('a ready with no state counts as idle', (await stored(desk, '_workToolsLinkState')).state === 'idle');
  check('the Live address is remembered', await manager.evaluate(() => localStorage.getItem('_slaKonnectLiveUrl')) === 'https://carbot.ai/konnectlive/(v1.2.200)/home.html');
  await send(manager);
  await fromLive(manager, { type: 'workTools:received', rows: 1 });
  check('received with no id is the batch just sent', (await link(manager)).running === (await toLive(manager))[0].id);
  await deskAsks(desk, 'desk-1');
  await waitStatus(desk, 'desk-1', 'waiting');
  await fromLive(manager, { type: 'workTools:ready' });
  check('a ready with no state sends nothing while our batch runs', (await toLive(manager)).length === 1 && (await stored(desk, '_workToolsLinkState')).state === 'running');
  await fromLive(manager, { type: 'workTools:results', kind: 'leads', partial: true, done: 1, total: 2, tsv: resultsTsv([{ name: 'Sam Buyer', email: 'sam.buyer@example.com' }]) });
  check('partial results with no id go to the running batch', (await cardResults(manager)).length === 1 && (await toLive(manager)).length === 1);
  check('and their progress shows on the link line', (await stored(desk, '_workToolsLinkState')).text === 'Konnect Live: checking 1 of 2.', await stored(desk, '_workToolsLinkState'));
  await fromLive(manager, { type: 'workTools:results', kind: 'leads', tsv: resultsTsv([{ name: 'Sam Buyer', email: 'sam.buyer@example.com' }]) });
  const sent = await waitSent(manager, 2);
  check('final results with no id end the batch and the next goes', sent.length === 2 && sent[1].id === 'desk-1', sent.map((m) => m.id));
  await fromLive(manager, { type: 'workTools:received', rows: 1 });
  await fromLive(manager, { type: 'workTools:results', kind: 'leads', tsv: resultsTsv([{ name: 'Jo Example', email: 'jo.example@example.com', action: 'send back through', reason: 'Email only' }]) });
  check('the desk batch\'s results go to the desk', /done: 1 checked/.test(((await waitStatus(desk, 'desk-1', 'done')) || {}).text) && (await cardResults(manager)).length === 1 && (await deskResults(desk)).length === 1);
  await send(manager);
  await fromLive(manager, { type: 'workTools:busy' });
  const count = (await toLive(manager)).length;
  await fromLive(manager, { type: 'workTools:ready' });
  check('busy with no id puts the batch back, and it is not sent again straight away', (await toLive(manager)).length === count && (await link(manager)).queue.length === 1, await link(manager));
  await manager.evaluate(() => { window.__workToolsLinkTiming.legacyBusyMs = 0; });
  await fromLive(manager, { type: 'workTools:ready' });
  check('it is tried again later', (await toLive(manager)).length === count + 1);
  check('messages from another site are ignored', await manager.evaluate(() => { const before = window.toLive.length; window.dispatchEvent(new MessageEvent('message', { origin: 'https://example.com', data: { type: 'workTools:ended', reason: 'done' } })); return window.toLive.length === before && !!window.__workToolsLiveLink.sent; }));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function openedAndReview() {
  console.log('\nOpen on Konnect Live answers and review decisions');
  const { context, manager, errors } = await open();
  const toast = () => manager.evaluate(() => (document.getElementById('_slaLinkToast') || {}).textContent || '');
  await ready(manager);
  await fromLive(manager, { type: 'workTools:opened', ok: true, text: 'Opened Sam Buyer.' });
  check('the answer to an open request is shown', (await toast()) === 'Opened Sam Buyer.', await toast());
  await fromLive(manager, { type: 'workTools:opened', ok: false, text: 'The Lead Checker is busy with a batch.' });
  check('a refusal is shown as the Lead Checker worded it', (await toast()) === 'The Lead Checker is busy with a batch.', await toast());
  check('an open answer sends nothing back', (await toLive(manager)).length === 0, await toLive(manager));
  const header = 'Name\tCreated\tDecision\tNote';
  await fromLive(manager, { type: 'workTools:review', tsv: `${header}\nSam Buyer\tSat, 26 Sep 2026 10:00\tTier 2\t\nPat Closure\tSat, 26 Sep 2026 11:00\tTier 4\tquote only` });
  await fromLive(manager, { type: 'workTools:review', tsv: `${header}\nSam Buyer\tSat, 26 Sep 2026 10:00\tTier 1\tgave a time\nJo Example\tSat, 26 Sep 2026 12:00\tTier 5\t` });
  const store = await stored(manager, '_slaReviewDecisions');
  check('review decisions merge across messages, newer replacing older', store && !!store.savedAt && store.rows.map((r) => `${r.cells.Name}:${r.cells.Decision}`).join() === 'Sam Buyer:Tier 1,Pat Closure:Tier 4,Jo Example:Tier 5', store);
  const copied = await manager.evaluate(async () => { let text = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { text = t; return Promise.resolve(); } } }); const b = document.createElement('button'); window._copyReviewDecisions(b); await new Promise((r) => setTimeout(r, 50)); return { text, label: b.textContent }; });
  check('Copy review decisions copies the merged set under the same header', copied.text === `${header}\nSam Buyer\tSat, 26 Sep 2026 10:00\tTier 1\tgave a time\nPat Closure\tSat, 26 Sep 2026 11:00\tTier 4\tquote only\nJo Example\tSat, 26 Sep 2026 12:00\tTier 5\t`, copied);
  check('and says how many', /Copied 3/.test(copied.label), copied.label);
  // The agent desktop records its own decisions; SLA Manager only reads them.
  const deskAt = new Date().toISOString();
  await manager.evaluate((at) => localStorage.setItem('_workToolsDeskDecisions', JSON.stringify({ savedAt: at, rows: [
    { at, run: 'Post Closure', name: 'Pat Closure', detail: 'Peugeot - Enquiry - New', outcome: 'Skipped', step: 'Update Outcomes', why: 'already worked' },
    { at, run: 'Email Only', name: 'Jo Example', detail: '', outcome: 'Done', step: '' },
    { at: new Date(Date.now() - 13 * 3600000).toISOString(), run: 'Re setup', name: 'Old Example', detail: '', outcome: 'Stopped', step: 'Add lead', why: '' }] })), deskAt);
  const DESK_BLOCK = `Run\tCustomer\tDetail\tOutcome\tStep\tWhy\tAt\nPost Closure\tPat Closure\tPeugeot - Enquiry - New\tSkipped\tUpdate Outcomes\talready worked\t${deskAt}\nEmail Only\tJo Example\t\tDone\t\t\t${deskAt}`;
  const copyAll = () => manager.evaluate(async () => { let text = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { text = t; return Promise.resolve(); } } }); const b = document.createElement('button'); window._copyReviewDecisions(b); await new Promise((r) => setTimeout(r, 50)); return { text, label: b.textContent }; });
  const both = await copyAll();
  check('with desk decisions the copy has both blocks, a blank line between, fresh rows only', both.text === `${copied.text}\n\n${DESK_BLOCK}` && /Copied 5/.test(both.label), both);
  await manager.evaluate(() => localStorage.removeItem('_slaReviewDecisions'));
  const deskOnly = await copyAll();
  check('with only desk decisions just that block is copied', deskOnly.text === DESK_BLOCK && /Copied 2/.test(deskOnly.label), deskOnly);
  await manager.evaluate(() => localStorage.setItem('_slaReviewDecisions', JSON.stringify({ savedAt: new Date(Date.now() - 13 * 3600000).toISOString(), header: ['Name'], rows: [{ at: new Date(Date.now() - 13 * 3600000).toISOString(), cells: { Name: 'Old Example' } }] })));
  await fromLive(manager, { type: 'workTools:review', tsv: 'Name\nNew Example' });
  check('decisions a shift old are dropped', (await stored(manager, '_slaReviewDecisions')).rows.map((r) => r.cells.Name).join() === 'New Example', await stored(manager, '_slaReviewDecisions'));
  await manager.evaluate(() => window._slaResetBookmarklet());
  check('Clear & Stop removes them', (await stored(manager, '_slaReviewDecisions')) === null);
  check('Clear & Stop leaves the desk\'s decisions alone', ((await stored(manager, '_workToolsDeskDecisions')) || { rows: [] }).rows.length === 3);
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function startMyDayAndTheLink() {
  console.log('\nStart my day: opens the one Konnect Live tab, and Send follows the link');
  const { context, manager, errors } = await open();
  // An SLA table with one lead whose pop-up opens and closes, and the checks stood in for.
  await manager.evaluate(() => {
    window.openModal = () => { const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'alertdialog'); m.innerHTML = '<div class="tab-pane active"><table class="table"><tr><td>Name</td><td>Sam Buyer</td></tr><tr><td>Mobiles</td><td></td></tr><tr><td>Landlines</td><td></td></tr><tr><td>Email</td><td>sam.buyer@example.com</td></tr></table></div><button class="close">x</button>'; m.querySelector('.close').onclick = () => m.remove(); document.body.appendChild(m); };
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr>' + ['Customer', 'Registration', 'Source', 'Campaign', 'Created', 'Received', 'SLA Date', 'Status', 'Assign'].map((h) => `<th>${h}</th>`).join('') + '</tr><tr><td><a href="javascript:void 0" onclick="openModal()">Sam Buyer</a></td><td>AB12CDE</td><td>Customer First</td><td>Peugeot - Enquiry - New</td><td>Sat, 26 Sep 2026 10:00</td><td>Sat, 26 Sep 2026 10:01</td><td>Sat, 26 Sep 2026 12:00</td><td>Pending</td><td>Agent Alpha</td></tr></tbody>';
    document.body.appendChild(table);
    window.CHECKS = 0;
    window._runAllMorningChecks = () => new Promise((resolve) => { window.CHECKS++; window.FINISH_CHECKS = resolve; });
  });
  const strip = () => manager.evaluate(() => { const el = document.getElementById('_slaDayStrip'); return !el || el.hidden ? '' : el.querySelector('span:not(.sla-dot)').textContent.trim(); });
  const opened = () => manager.evaluate(() => window.opened);
  const batches = async () => (await toLive(manager)).filter((m) => m.type === 'workTools:batch');
  const run = async (n) => {
    manager.evaluate(() => { window._startMyDay(); });
    await waitFor(() => manager.evaluate(() => window.CHECKS), (count) => count === n, 20000);
    await manager.evaluate(() => window.FINISH_CHECKS());
  };
  const finishBatch = async () => { const last = (await batches()).pop(); await fromLive(manager, { type: 'workTools:received', id: last.id, rows: 1 }); await fromLive(manager, { type: 'workTools:ended', id: last.id, reason: 'done' }); };

  // Not linked: the tab is opened at the click and the batch waits.
  manager.evaluate(() => { window._startMyDay(); });
  await waitFor(opened, (n) => n === 1);
  check('not linked: the click opens the Konnect Live tab', (await opened()) === 1 && (await batches()).length === 0, await opened());
  await waitFor(() => manager.evaluate(() => window.CHECKS), (count) => count === 1, 20000);
  check('the scan and the checks run while the link comes up', (await strip()) === 'Start my day: 2 of 3, morning checks', await strip());
  await manager.evaluate(() => window.FINISH_CHECKS());
  await waitFor(strip, (text) => /waiting to send/.test(text));
  check('the Lead Checker has not answered: the batch is queued and the strip says to click Work Tools', (await strip()) === 'Start my day: scan and checks done. Click Work Tools on the Konnect Live tab: the leads are waiting to send.' && (await batches()).length === 0 && (await link(manager)).queue.length === 1, { strip: await strip(), link: await link(manager) });
  await ready(manager);
  let sent = await waitSent(manager, 1);
  check('when the Lead Checker says ready the batch goes, with the lead in it', sent.length === 1 && sent[0].kind === 'leads' && /sam\.buyer@example\.com/.test(sent[0].tsv) && (await opened()) === 1, sent.map((m) => m.kind));
  await finishBatch();

  // Linked and idle: sent at once, the tab left alone.
  await run(2);
  await waitFor(strip, (text) => /done/.test(text));
  check('linked and idle: sent straight away', (await strip()) === 'Start my day: done. 1 lead sent to the Lead Checker.' && (await batches()).length === 2 && (await opened()) === 1, await strip());
  await finishBatch();

  // Logged out: wait for it to log back in.
  await ready(manager, { state: 'loggedOut' });
  await run(3);
  await waitFor(strip, (text) => /logging back in/.test(text));
  await new Promise((r) => setTimeout(r, 400));
  check('logged out: it waits, saying Konnect Live is logging back in', (await strip()) === 'Start my day: 3 of 3, Konnect Live is logging back in' && (await batches()).length === 2, await strip());
  await ready(manager);
  await waitFor(strip, (text) => /done/.test(text));
  check('back in: the batch is sent', (await strip()) === 'Start my day: done. 1 lead sent to the Lead Checker.' && (await waitSent(manager, 3)).length === 3, await strip());
  await finishBatch();

  // Logged out for longer than the wait.
  await ready(manager, { state: 'loggedOut' });
  await manager.evaluate(() => { window.__slaDayTiming = { loginWaitMs: 400 }; });
  await run(4);
  await waitFor(strip, (text) => /still logged out/.test(text));
  check('still logged out after the wait: the batch is queued and the strip says to press Login', (await strip()) === 'Start my day: scan and checks done. Konnect Live is still logged out. Press Login on the Konnect Live tab: the leads are waiting to send.' && (await batches()).length === 3 && (await link(manager)).queue.length === 1, await strip());
  await ready(manager);
  check('it goes once Konnect Live is back in', (await waitSent(manager, 4)).length === 4);
  check('only the one Konnect Live tab was ever opened', (await opened()) === 1, await opened());
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

async function bookingChecks() {
  console.log('\nBooking checks: due, asked one at a time between batches, answers kept');
  // Three minutes and five minutes, shortened.
  const { context, manager, desk, errors } = await open({ verifyFirstMs: 700, verifyRetryMs: 300, verifyAnswerMs: 5000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sheetRow = (name) => ['13/11/2026', name, 'Crawley', 'Test Drive', '14 November 2026', '10:00', '', 'AB12CDE'].join('\t');
  const booking = (id, name, over) => ({ id, name, email: `${name.toLowerCase().replace(' ', '.')}@example.com`, phone: '07700 900111', dealer: 'Crawley', apptType: 'Test Drive', apptDate: '14 November 2026', row: sheetRow(name), bookedAt: new Date().toISOString(), state: 'waiting', tries: 0, checkedAt: null, appointment: null, outcome: null, sent: null, text: '', ...over });
  const bookings = async () => ((await stored(manager, '_workToolsBookingChecks')) || { bookings: [] }).bookings;
  const entry = async (id) => (await bookings()).find((e) => e.id === id);
  const verifies = async () => (await toLive(manager)).filter((m) => m.type === 'workTools:verify');
  const waitVerifies = (count) => waitFor(verifies, (v) => v.length >= count);
  const answer = (id, over) => fromLive(manager, { type: 'workTools:verified', id, ok: true, found: true, appointment: true, outcome: true, sent: false, text: '', ...over });
  const copyRows = () => manager.evaluate(async () => { let text = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { text = t; return Promise.resolve(); } } }); const b = document.createElement('button'); window._copyBookingRows(b); await new Promise((r) => setTimeout(r, 50)); return { text, label: b.textContent }; });
  // Later bookings are added on the manager page: another tab can read a
  // value a moment old and write it back over an answer just stored.
  const addBooking = (b) => manager.evaluate((x) => { const v = JSON.parse(localStorage.getItem('_workToolsBookingChecks')); v.bookings.push(x); localStorage.setItem('_workToolsBookingChecks', JSON.stringify(v)); }, b);
  await ready(manager);
  // Konnect Notes writes from the agent desktop tab.
  const sam = booking('bk-sam', 'Sam Buyer', { extra: 'kept' });
  await desk.evaluate((list) => localStorage.setItem('_workToolsBookingChecks', JSON.stringify({ savedAt: new Date().toISOString(), bookings: list })), [sam, booking('bk-old', 'Old Example', { bookedAt: new Date(Date.now() - 13 * 3600000).toISOString() })]);
  await sleep(300);
  check('a booking just made is not checked before it is due', (await verifies()).length === 0, await verifies());
  check('a booking older than 12 hours is dropped', (await bookings()).map((e) => e.id).join() === 'bk-sam', (await bookings()).map((e) => e.id));
  let sent = await waitVerifies(1);
  check('once due it is asked about, by id, with the customer and the booking time', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ type: 'workTools:verify', id: 'bk-sam', row: { name: 'Sam Buyer', phone: '07700 900111', email: 'sam.buyer@example.com' }, since: sam.bookedAt }), sent);
  await sleep(500);
  check('it is not asked again while the answer is awaited', (await verifies()).length === 1);

  await answer('bk-sam');
  let e = await entry('bk-sam');
  check('a partial answer leaves it waiting, with one try used and what is missing', e.state === 'waiting' && e.tries === 1 && e.appointment === true && e.outcome === true && e.sent === false && !!e.checkedAt && /^Not yet: sent to dealership\./.test(e.text), e);
  check('fields SLA Manager does not know are kept', e.extra === 'kept' && e.row === sam.row, e);
  sent = await waitVerifies(2);
  check('and it is tried again after the retry time', sent.length === 2 && sent[1].id === 'bk-sam', sent.map((m) => m.id));

  await answer('bk-sam', { ok: false, found: false, appointment: false, outcome: false, text: 'The Lead Checker is busy with a batch.' });
  e = await entry('bk-sam');
  check('ok false uses no try and keeps what was already known', e.state === 'waiting' && e.tries === 1 && e.appointment === true && e.text === 'The Lead Checker is busy with a batch.', e);
  sent = await waitVerifies(3);
  check('it is asked again later', sent.length === 3);
  await answer('bk-sam', { ok: false, found: false, text: 'Konnect Live is logged out.' });
  check('logged out uses no try either', (await entry('bk-sam')).tries === 1, await entry('bk-sam'));
  await waitVerifies(4);
  await answer('bk-sam');
  check('a second real answer is the second try', (await entry('bk-sam')).tries === 2);

  // A batch takes the link: no check goes until it has ended.
  await send(manager);
  const batch = (await toLive(manager)).find((m) => m.type === 'workTools:batch');
  await sleep(600);
  check('nothing is asked while a batch is sent and not yet acknowledged', (await verifies()).length === 4, await link(manager));
  await fromLive(manager, { type: 'workTools:received', id: batch.id, rows: 1 });
  await ready(manager, { state: 'running', batchId: batch.id, done: 0, total: 1 });
  await sleep(600);
  check('nothing is asked while a batch is running', (await verifies()).length === 4);
  await ready(manager, { state: 'paused', batchId: batch.id, done: 0, total: 1 });
  await manager.evaluate(() => window._checkBookingNow('bk-sam'));
  await sleep(300);
  check('not even with Check now, while it is paused', (await verifies()).length === 4);
  await fromLive(manager, { type: 'workTools:ended', id: batch.id, reason: 'done' });
  sent = await waitVerifies(5);
  check('once the batch has ended the check goes', sent.length === 5 && (await toLive(manager)).filter((m) => m.type === 'workTools:batch').length === 1, sent.length);

  await answer('bk-sam', { sent: true });
  e = await entry('bk-sam');
  check('all three true makes it checked', e.state === 'checked' && e.tries === 3 && e.sent === true && e.text === 'Checked on Konnect Live.', e);

  // A second booking, not due for a minute: only Check now asks about it.
  await manager.evaluate(() => { window.__workToolsLinkTiming.verifyFirstMs = 60000; });
  const jo = booking('bk-jo', 'Jo Example');
  await addBooking(jo);
  await sleep(500);
  check('a checked booking is not asked about again, nor one not yet due', (await verifies()).length === 5);
  const copied = await copyRows();
  const lines = (copied.text || '').split('\n').map((l) => l.split('\t'));
  check('Copy rows puts Y in the seventh cell for the checked booking only', lines.length === 2 && lines[0][1] === 'Sam Buyer' && lines[0][6] === 'Y' && lines[1][1] === 'Jo Example' && lines[1][6] === '' && lines.every((c) => c.length === 8 && c[7] === 'AB12CDE') && /Copied 2/.test(copied.label), copied);
  await manager.evaluate(() => window._checkBookingNow('bk-jo'));
  sent = await waitVerifies(6);
  check('Check now asks straight away', sent.length === 6 && sent[5].id === 'bk-jo' && sent[5].since === jo.bookedAt, sent.map((m) => m.id));

  // Six tries without all three.
  await manager.evaluate(() => { window.__workToolsLinkTiming.verifyRetryMs = 80; });
  for (let n = 1; n <= 6; n++) {
    await waitVerifies(5 + n);
    await answer('bk-jo', { outcome: false });
    if (n === 5) check('five tries leaves it waiting', (await entry('bk-jo')).state === 'waiting' && (await entry('bk-jo')).tries === 5, await entry('bk-jo'));
  }
  e = await entry('bk-jo');
  check('six tries makes it failed, saying what is missing', e.state === 'failed' && e.tries === 6 && e.text === 'Still missing after 6 tries: outcome set, sent to dealership.', e);
  await sleep(500);
  check('a failed booking is not asked about again', (await verifies()).length === 11, (await verifies()).length);
  await manager.evaluate(() => window._checkBookingNow());
  await waitVerifies(12);
  await answer('bk-jo', { outcome: true, sent: true });
  check('Check now for all asks about the failed one, and a full answer makes it checked', (await verifies()).length === 12 && (await entry('bk-jo')).state === 'checked', await entry('bk-jo'));

  const kim = booking('bk-kim', 'Kim Example');
  await addBooking(kim);
  await manager.evaluate(() => window._slaResetBookmarklet());
  check('Clear & Stop removes only the checked bookings', (await bookings()).map((b) => b.id).join() === 'bk-kim', (await bookings()).map((b) => b.id));
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

const started = Date.now();
try {
  await openedAndReview();
  await idsAreRouted();
  await endedReasons();
  await lostBatch();
  await linkDown();
  await resend();
  await queueAndRequests();
  await deskResultsMerge();
  await openWithNoLeads();
  await olderLeadChecker();
  await startMyDayAndTheLink();
  await bookingChecks();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failures ? `${failures} failed` : 'All passed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
