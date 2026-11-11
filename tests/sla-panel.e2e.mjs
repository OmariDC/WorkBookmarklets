#!/usr/bin/env node
// Browser tests for the SLA Manager panel against a small stand-in for the
// Konnect Manager SLA page (built below): reading customer pop-ups, the busy
// guard, Clear Queue, due tiles, merging results and keeping the panel's
// state across redraws. Needs Playwright with Chromium. Run from the repo
// root:
//
//   node tests/sla-panel.e2e.mjs
//
// The stand-in only copies what SLA Manager reads from the real page, so a
// pass here does not prove the real page behaves the same.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const slaScript = readFileSync(join(here, '..', 'SLA-Manager.js'), 'utf8');

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

// The SLA table, the customer pop-up, the Assign menus and Queue by Agent,
// with switches for slow or odd behaviour. All names and numbers are made up.
const MOCK = `<!doctype html><html><head><meta charset="utf-8"><title>Konnect Manager (stand-in)</title>
<style>body{font-family:Arial;margin:0}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px;font-size:12px}.dropdown-menu{display:none}</style></head>
<body><nav><ul class="nav navbar-nav"><li><a href="#/x">Client Config</a></li></ul></nav>
<i class="fa fa-refresh" ng-click="getData()"></i>
<div id="view"></div>
<iframe id="live" src="about:blank" style="display:none"></iframe>
<script>
const AGENTS=[{ID:1,DisplayText:'Agent Alpha',CurrentStatusName:'Shift Start'},{ID:2,DisplayText:'Agent Bravo',CurrentStatusName:'Live Chat'},{ID:3,DisplayText:'Agent Charlie',CurrentStatusName:''}];
window.angular={element:()=>({scope:()=>({agents:AGENTS})})};
function fmt(d){const D=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const p=n=>String(n).padStart(2,'0');return D[d.getDay()]+', '+p(d.getDate())+' '+M[d.getMonth()]+' '+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());}
const now=Date.now();const at=m=>fmt(new Date(now+m*60000));
window.at=at;
window.LEADS=[
 ['Mr Alex Sample','AB12CDE','Customer First','Citroen - Enquiry - New (Test drive request)',at(-300),at(-290),at(-25),'Missed',null,'07700900001','alex@example.com'],
 ['Mrs Sam Buyer','AB13CDE','Robins & Day Website','Peugeot - Test Drive Request - New (pcr_new_test_drive)',at(-100),at(-99),at(8),'Pending',null,'07700900002','sam@example.com'],
 ['Jo Example','','Customer First','Citroen - Enquiry - New',at(-60),at(-59),at(25),'Pending',null,'','jo@example.com'],
 ['Miss Fay Fields','AB14CDE','Autotrader - Deal Builder','Vauxhall - Enquiry - Used',at(-50),at(-49),at(50),'Pending','Agent Alpha','07700900004','fay@example.com'],
 ['Dr Gus Green','AB15CDE','Robins & Day Website','Citroen - Offer Request - New (Quote request)',at(-40),at(-39),at(130),'Pending',null,'07700900005','gus@example.com'],
 ['Dan Davis','AB16CDE','Cargurus','General',at(-30),at(-29),at(200),'Pending',null,'07700900006','dan@example.com'],
 ['Eve Evans','AB17CDE','Motability','Motability',at(-20),at(-19),at(-70),'Missed',null,'07700900007','eve@example.com'],
];
function renderSla(){
 document.getElementById('view').innerHTML='<table class="table"><tbody><tr>'+['Customer','Registration','Source','Campaign','Created','Received','SLA Date','Status','Assign'].map(h=>'<th>'+h+'</th>').join('')+'</tr>'+
 LEADS.map((l,i)=>'<tr>'+[0,1,2,3,4,5,6,7].map(c=>c===0?'<td><a href="javascript:void 0" onclick="openModal('+i+')">'+l[0]+'</a></td>':'<td>'+l[c]+'</td>').join('')+'<td>'+(l[8]?l[8]:'<div class="dropdown ng-scope"><ul class="dropdown-menu">'+AGENTS.map(a=>'<li onclick="assign('+i+',\\''+a.DisplayText+'\\')">x '+a.DisplayText+'</li>').join('')+'</ul></div>')+'</td></tr>').join('')+'</tbody></table>';
}
window.assign=(i,name)=>{setTimeout(()=>{LEADS[i][8]=name;renderSla();},window.ASSIGN_DELAY||150);};
// Switches: how slowly the pop-up closes and fills; leads whose pop-up is
// blank the first time; leads shown with no labelled rows; a lead whose
// pop-up shows somebody else.
window.MODAL_CLOSE_DELAY=100;window.MODAL_FILL_DELAY=0;window.BLANK_FIRST={};window.NO_LABELS={};window.WRONG_NAME={};window.OPENED={};
window.openModal=(i)=>{const l=LEADS[i];window.OPENED[i]=(window.OPENED[i]||0)+1;const m=document.createElement('div');m.className='modal';m.setAttribute('role','alertdialog');
 const close=()=>setTimeout(()=>m.remove(),window.MODAL_CLOSE_DELAY);
 const blank=window.BLANK_FIRST[i]&&window.OPENED[i]===1;
 const who=window.WRONG_NAME[i]?'Somebody Else':l[0];
 const fill=()=>{m.innerHTML=window.NO_LABELS[i]
  ?'<div class="tab-pane active"><p>'+l[0]+' can be reached at '+l[10]+'</p></div><button class="close">x</button>'
  :'<div class="tab-pane active"><table class="table"><tr><td>Name</td><td>'+who+'</td></tr><tr><td>Mobiles</td><td>'+(blank?'':l[9])+'</td></tr><tr><td>Landlines</td><td></td></tr><tr><td>Email</td><td>'+(blank?'':l[10])+'</td></tr></table></div><button class="close">x</button>';
  m.querySelector('.close').onclick=close;};
 m.innerHTML='<button class="close">x</button>';m.querySelector('.close').onclick=close;
 document.body.appendChild(m); if(window.MODAL_FILL_DELAY) setTimeout(fill,window.MODAL_FILL_DELAY); else fill();};
function renderQueue(){document.getElementById('view').innerHTML='<div title="Filter by Module"><span class="ng-binding">Customer Hub</span></div><button ng-click="ClearQueues()" onclick="window.CLEARED=(window.CLEARED||0)+1;if(!window.CLEAR_DOES_NOTHING)LEADS.forEach(l=>l[8]=null)">Clear Queues</button><ul>'+AGENTS.map((a,i)=>'<li ng-repeat="agent in fullqueue | filter: filterMessages"><div class="queueitem panel-heading"><div style="font-weight:bold">'+a.DisplayText+'</div></div><ul class="list-group">'+(i===0?'<li class="queueitem list-group-item"><span title="Fay Fields | fay@example.com | 07700900004">Fay</span></li>':'')+'</ul></li>').join('')+'</ul>';}
function renderOther(){document.getElementById('view').innerHTML='<p>Another Konnect page</p>';}
window.NAVS=[];
window.addEventListener('hashchange',()=>{ window.NAVS.push(location.hash); if(location.hash.includes('QueueByAgent')) setTimeout(renderQueue,200); else if(location.hash.includes('other')) renderOther(); else setTimeout(renderSla,200); });
renderSla();
// Stands in for the Konnect Live tab, as in agent-desktop-mock/manager.html.
window.toLive=[];
const live=document.getElementById('live').contentWindow;
live.postMessage=(message,origin)=>{ if(origin==='https://carbot.ai') window.toLive.push(message); };
window.open=()=>live;
window.fromLive=(data)=>window.dispatchEvent(new MessageEvent('message',{origin:'https://carbot.ai',source:live,data}));
</script></body></html>`;

const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(MOCK); }).listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();

async function open(init, storage) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.route('**/api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await context.route('**/raw.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: slaScript }));
  const page = await context.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.goto(`${base}/`);
  if (storage) await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, storage);
  if (init) await page.evaluate(init);
  await page.addScriptTag({ content: slaScript });
  return { context, page, errors, dialogs };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (page, fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
// The badge click scans the leads, then reads Queue by Agent and comes back.
const idle = (page) => waitFor(page, () => document.querySelectorAll('.customer-card').length > 0 && !document.getElementById('_slaPageFlashOverlay') && !location.hash.includes('QueueByAgent'));
async function openPanel(page) {
  await page.click('#_slaBadge');
  await sleep(300);
  await idle(page);
  await sleep(400);
}
const cards = (page) => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.customer-card')).map((c) => [c.dataset.customerName, Array.from(c.querySelectorAll('.contact-details .sla-copyable')).map((e) => e.dataset.value).join(' / ')])));
const badges = (page, name) => page.evaluate((n) => Array.from(document.querySelectorAll('.customer-card')).filter((c) => c.dataset.customerName === n).map((c) => Array.from(c.querySelectorAll('span[title]')).map((s) => s.textContent.trim()).filter(Boolean).join(','))[0] || '', name);
const toast = (page) => page.evaluate(() => (document.getElementById('_slaLinkToast') || {}).textContent || '');
const emailOnlyCount = (page) => page.evaluate(() => (document.getElementById('assignEmailOnly').parentElement.textContent.match(/\((\d+)\)/) || [])[1]);
const H = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes', 'Tier', 'TierName', 'SubCategory', 'SubRank', 'Flags', 'Confidence', 'Reason', 'DedupeKey', 'PostClosureAction', 'PriorityRank', 'PostClosureReason', 'PostClosureEvidence'].join('\t');
const resultRow = (name, email, created, tierName) => [name, '', email, 'Customer First', 'x', created, '-', '2', tierName, '', '', '', 'medium', 'r', '', '', '203', '', ''].join('\t');
const EXPECTED = {
  'mr alex sample': '07700900001 / alex@example.com', 'mrs sam buyer': '07700900002 / sam@example.com', 'jo example': 'jo@example.com',
  'miss fay fields': '07700900004 / fay@example.com', 'dr gus green': '07700900005 / gus@example.com', 'dan davis': '07700900006 / dan@example.com', 'eve evans': '07700900007 / eve@example.com'
};

async function popUps() {
  console.log('\nCustomer pop-ups');
  let t = await open(() => { window.MODAL_CLOSE_DELAY = 900; });
  await openPanel(t.page);
  check('a pop-up slow to close: every lead still gets its own details', JSON.stringify(await cards(t.page)) === JSON.stringify(Object.fromEntries(Object.keys(await cards(t.page)).map((k) => [k, EXPECTED[k]]))) && Object.keys(await cards(t.page)).length === 7, await cards(t.page));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();

  t = await open(() => { window.MODAL_FILL_DELAY = 500; });
  await openPanel(t.page);
  check('a pop-up slow to fill is waited for', (await cards(t.page))['mr alex sample'] === EXPECTED['mr alex sample'] && (await cards(t.page))['eve evans'] === EXPECTED['eve evans'], await cards(t.page));
  await t.context.close();

  // Lead 1 is blank the first time, lead 4 has no labelled rows, lead 5
  // shows another customer.
  t = await open(() => { window.BLANK_FIRST = { 1: true }; window.NO_LABELS = { 4: true }; window.WRONG_NAME = { 5: true }; });
  await openPanel(t.page);
  let seen = await cards(t.page);
  check('a pop-up that stayed blank gives no details', seen['mrs sam buyer'] === '', seen);
  check('a pop-up showing another customer is not read', seen['dan davis'] === '', seen);
  check('a pop-up with no labelled rows is read as text', seen['dr gus green'] === 'gus@example.com', seen);
  check('only the lead really read with no phone counts as Email only', (await emailOnlyCount(t.page)) === '1', await emailOnlyCount(t.page));
  const firstOpens = await t.page.evaluate(() => ({ ...window.OPENED }));
  await t.page.evaluate(() => { window.WRONG_NAME = {}; return window._refreshLeadsAndPanel(); });
  await idle(t.page);
  seen = await cards(t.page);
  const opens = await t.page.evaluate(() => ({ ...window.OPENED }));
  check('leads left blank are read again on the next scan', seen['mrs sam buyer'] === EXPECTED['mrs sam buyer'] && seen['dan davis'] === EXPECTED['dan davis'], seen);
  check('leads already read are not opened again', opens[0] === firstOpens[0] && opens[2] === firstOpens[2] && opens[1] === 2, opens);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function busyGuard() {
  console.log('\nOne thing at a time');
  let t = await open();
  await t.page.evaluate(() => { const b = document.getElementById('_slaBadge'); b.click(); b.click(); });
  await sleep(300);
  await idle(t.page);
  await sleep(500);
  check('a double click on the badge ends on the leads page with the panel', (await t.page.evaluate(() => !location.hash.includes('Queue') && !!document.querySelector('#view table'))) && Object.keys(await cards(t.page)).length === 7);
  check('the queue page was visited once', (await t.page.evaluate(() => window.NAVS.filter((h) => h.includes('QueueByAgent')).length)) === 1, await t.page.evaluate(() => window.NAVS));

  // Clear Queue: no prompt, once per double click, and checked afterwards.
  await t.page.evaluate(() => { window._clearWholeQueue(); window._clearWholeQueue(); });
  await sleep(300);
  await idle(t.page);
  check('a double click on Clear Queue presses Clear Queues once, with no prompt', (await t.page.evaluate(() => window.CLEARED)) === 1 && t.dialogs.length === 0, t.dialogs);
  check('it says cleared only after reading the list back', /Queue cleared/.test(await toast(t.page)) && (await t.page.evaluate(() => document.querySelectorAll('.customer-card[data-assigned="1"]').length)) === 0, await toast(t.page));
  await t.page.evaluate(() => { window.CLEAR_DOES_NOTHING = true; LEADS[3][8] = 'Agent Alpha'; });
  await t.page.evaluate(() => window._clearWholeQueue());
  await idle(t.page);
  check('when a lead still shows an agent it says so, and the card keeps the agent', /1 lead still shows an agent/.test(await toast(t.page)) && (await t.page.evaluate(() => document.querySelectorAll('.customer-card[data-assigned="1"]').length)) === 1, await toast(t.page));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();

  // A lead with no readable SLA date; slow assigns so the run can be poked.
  t = await open(() => { window.ASSIGN_DELAY = 1500; LEADS[5][6] = ''; });
  await openPanel(t.page);
  const tile = await t.page.evaluate(() => { window._toggleStatSummary(); return document.querySelectorAll('.stat-tile-clickable')[1].textContent.replace(/\s+/g, ' ').trim(); });
  check('the 15 minute tile counts 3 and reads as something to press', /^3 Due 15m Assign$/.test(tile), tile);
  const navsBefore = await t.page.evaluate(() => window.NAVS.length);
  await t.page.evaluate(() => { window._quickAssignSlaTile(15, false, false); });
  await sleep(500);
  check('the tile starts a run of exactly the leads it counts', /Assigning \d\/3/.test(await t.page.evaluate(() => document.getElementById('assignRunButton').textContent)), await t.page.evaluate(() => document.getElementById('assignRunButton').textContent));
  await t.page.evaluate(() => { document.getElementById('_slaBadge').click(); window._clearWholeQueue(); window._checkAgentQueuePositions(null); });
  await sleep(300);
  check('badge, Clear Queue and Queue are refused during the run', (await t.page.evaluate(() => window.NAVS.length)) === navsBefore && /Not yet: an assign run is in progress/.test(await toast(t.page)) && !(await t.page.evaluate(() => window.CLEARED)), await toast(t.page));
  await waitFor(t.page, () => /assigned/.test((document.getElementById('assignResultsSummary') || {}).textContent || ''));
  check('the run reports what really happened', /3 assigned$/.test((await t.page.evaluate(() => document.getElementById('assignResultsSummary').textContent)).trim()) && (await t.page.evaluate(() => LEADS.filter((l) => l[8]).length)) === 4, await t.page.evaluate(() => document.getElementById('assignResultsSummary').textContent));
  check('the lead with no readable SLA date was left alone', (await t.page.evaluate(() => LEADS[5][8])) === null);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();

  // A row that leaves the page mid-assign is not counted as assigned.
  t = await open(() => { window.assign = (i) => { setTimeout(() => { LEADS.splice(i, 1); document.querySelectorAll('#view tbody tr')[i + 1].remove(); }, 100); }; });
  await openPanel(t.page);
  await t.page.evaluate(() => { document.getElementById('assignLimitInput').value = '1'; window._updateAssignPreview(); window._quickAssignSlaTile(null, false, true); });
  await waitFor(t.page, () => /not confirmed|assigned|failed/.test((document.getElementById('assignResultsSummary') || {}).textContent || ''));
  check('a row that vanishes mid-run counts as not confirmed', /0 assigned, 1 not confirmed$/.test((await t.page.evaluate(() => document.getElementById('assignResultsSummary').textContent)).trim()), await t.page.evaluate(() => document.getElementById('assignResultsSummary').textContent));
  check('and is not written to the assignment log', (await t.page.evaluate(() => localStorage.getItem('_slaAssignmentLog'))) === '[]', await t.page.evaluate(() => localStorage.getItem('_slaAssignmentLog')));
  await t.context.close();
}

async function resultsAndState() {
  console.log('\nResults merge, and the panel keeps its place');
  const t = await open();
  await openPanel(t.page);
  const created = await t.page.evaluate(() => LEADS.map((l) => l[4]));
  const paste = (tsv) => t.page.evaluate((text) => { const b = document.createElement('button'); document.body.appendChild(b); document.getElementById('leadCheckerImportBox').value = text; window._classifyLeadCheckerImport(b); }, tsv);
  await paste([H, resultRow('Alex Sample', 'alex@example.com', created[0], 'DATE ONLY')].join('\n'));
  await paste([H, resultRow('Jo Example', 'jo@example.com', created[2], 'WARM ENQUIRY')].join('\n'));
  check('a second import adds to the first', /DATE ONLY/.test(await badges(t.page, 'mr alex sample')) && /WARM ENQUIRY/.test(await badges(t.page, 'jo example')), [await badges(t.page, 'mr alex sample'), await badges(t.page, 'jo example')]);
  check('time past the hour reads in hours', /MISSED 1h 1\dm ago/.test(await badges(t.page, 'eve evans')), await badges(t.page, 'eve evans'));
  check('a wrong paste is refused in plain words', await t.page.evaluate(() => { const b = document.createElement('button'); document.getElementById('leadCheckerImportBox').value = 'Name\tPhone'; window._classifyLeadCheckerImport(b); return b.textContent; }) === 'Not Lead Checker results');

  // Results arriving over the link redraw the panel under the user.
  await t.page.evaluate(() => {
    window._toggleLeadCheckerPopover();
    const search = document.getElementById('customerSearchInput');
    search.value = 'eve';
    window._filterCustomerSearch('eve');
    search.focus();
    search.setSelectionRange(3, 3);
    document.querySelector('.customer-card[data-customer-name="eve evans"] .contact-toggle').click();
    document.querySelector('.panelContent').scrollTop = 60;
  });
  await t.page.evaluate(() => window.fromLive({ type: 'workTools:ready', state: 'idle', batchId: null, done: 0, total: 0 }));
  await t.page.evaluate((tsv) => window.fromLive({ type: 'workTools:results', id: 'manager-x', kind: 'leads', partial: true, done: 1, total: 3, tsv }), [H, resultRow('Gus Green', 'gus@example.com', created[4], 'NURTURE')].join('\n'));
  const after = await t.page.evaluate(() => ({
    badge: Array.from(document.querySelectorAll('.customer-card[data-customer-name="dr gus green"] span[title]')).map((s) => s.textContent.trim()).join(','),
    search: document.getElementById('customerSearchInput').value,
    focused: document.activeElement && document.activeElement.id,
    hidden: document.querySelector('.customer-card[data-customer-name="jo example"]').style.display,
    popover: document.getElementById('leadCheckerPopover').style.display,
    contact: document.querySelector('.customer-card[data-customer-name="eve evans"] .contact-details').style.display,
    scroll: document.querySelector('.panelContent').scrollTop
  }));
  check('the new result is on its card', /NURTURE/.test(after.badge), after);
  check('search text, focus, the open pop-over, open contact details and scroll are kept', after.search === 'eve' && after.focused === 'customerSearchInput' && after.hidden === 'none' && after.popover === 'block' && after.contact === 'grid' && after.scroll === 60, after);
  check('the overview line shows real dots', await t.page.evaluate(() => { const l = document.getElementById('statSummaryLabel'); return /\d missed · \d due within 30m · \d unassigned/.test(l.dataset.summary) && !/&middot;/.test(l.dataset.summary + l.textContent); }));

  // A copy chip clicked twice still goes back to the name.
  await t.page.evaluate(() => { navigator.clipboard.writeText = () => Promise.resolve(); const el = document.querySelector('.customer-card[data-customer-name="eve evans"] .sla-copyable'); el.click(); setTimeout(() => el.click(), 300); });
  await sleep(2300);
  check('a copy chip clicked twice goes back to its own text', (await t.page.evaluate(() => document.querySelector('.customer-card[data-customer-name="eve evans"] .sla-copyable').textContent)) === 'Eve Evans');

  // Leaving the leads page and coming back scans again.
  await t.page.evaluate(() => { location.hash = '#/other'; });
  await sleep(2600);
  await t.page.evaluate(() => { LEADS.push(['Hal Hughes', 'AB18CDE', 'Customer First', 'Citroen - Enquiry - New', at(-5), at(-4), at(40), 'Pending', null, '07700900008', 'hal@example.com']); location.hash = ''; });
  check('coming back to the SLA page scans again', await waitFor(t.page, () => !!document.querySelector('.customer-card[data-customer-name="hal hughes"]'), null, 8000));

  // Clear & Stop.
  await t.page.evaluate(() => { localStorage.setItem('_slaAssignmentLog', JSON.stringify([{ time: new Date().toISOString(), lead: 'Eve Evans', agent: 'Agent Alpha' }])); window._slaResetBookmarklet(); });
  check('Clear & Stop stops the timers and removes its stored customer names', await t.page.evaluate(() => !window._slaAutoDetectInterval && !window.__workToolsLinkTimer && !document.getElementById('_slaPanel')
    && localStorage.getItem('_slaLeadCheckerImportState') === null && localStorage.getItem('_slaAgentQueueSnapshot') === null
    && JSON.stringify(JSON.parse(localStorage.getItem('_slaAssignmentLog')).map((e) => Object.keys(e).sort().join())) === '["agent,time"]'));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function nationalDecisions() {
  console.log('\nNational: hand decisions survive new results');
  const NH = ['NationalResult', 'Customer', 'ActivityID', 'LeadID', 'Verdict', 'Reason', 'Attempts', 'FinalOutcome', 'EnquiryMaxDealer', 'FollowUpNotes', 'ResetCampaign', 'Reg'];
  const nat = (customer, id, verdict) => ({ NationalResult: 'national', Customer: customer, ActivityID: id, LeadID: '', Verdict: verdict, Reason: 'r', Attempts: '1', FinalOutcome: '', EnquiryMaxDealer: '', FollowUpNotes: '', ResetCampaign: '', Reg: '' });
  const natTsv = (rows) => [NH.join('\t'), ...rows.map((r) => NH.map((h) => r[h]).join('\t'))].join('\n');
  const nowIso = new Date().toISOString();
  const order = [['emailOnly', 'Email Only Count'], ['sla', 'SLA Count'], ['inProgress', 'In Progress'], ['leadType', 'Lead Type Check'], ['routedTo', 'All Leads Are Routed To'], ['voicemail', 'Voicemail'], ['national', 'National leads']];
  const t = await open(null, {
    _slaMorningChecksLastRun: { time: nowIso, elapsedMs: 1000, failedLabels: [], results: order.map(([key, label]) => ({ key, label, status: key === 'national' ? 'running' : 'done', ok: null, summary: '1' })) },
    _slaNationalCheckResults: { savedAt: nowIso, results: [nat('Alex Sample', '70000001', 'Check'), nat('Sam Buyer', '70000002', 'Check'), nat('Jo Example', '70000003', 'OK')] },
    _slaLeadCheckerImportState: { savedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(), rawInput: '', results: [{ name: 'Old Example', email: 'old@example.com', created: 'x', tier: 2 }] }
  });
  check('customer data past one shift is removed when the tool loads', (await t.page.evaluate(() => localStorage.getItem('_slaLeadCheckerImportState'))) === null);
  await t.page.evaluate(() => window._toggleMorningChecks());
  const rowText = await t.page.evaluate(() => document.querySelector('.panelContent').textContent.replace(/\s+/g, ' '));
  check('a run saved while National was still going comes back as not finished, not stuck running', /National leads\s*Not finished\. Run the checks again\./.test(rowText) && !/Running/.test(rowText), rowText.slice(0, 300));
  await t.page.evaluate(() => { const n = document.querySelector('input[data-national-note="70000001"]'); n.value = 'dealer rang them'; document.querySelector('button[data-activity="70000001"][onclick*="Valid"]').click(); });
  // The user is part-way through a reason for the second lead when more
  // results arrive.
  await t.page.evaluate(() => { const n = document.querySelector('input[data-national-note="70000002"]'); n.focus(); n.value = 'still typ'; });
  await t.page.evaluate(() => window.fromLive({ type: 'workTools:ready', state: 'idle', batchId: null, done: 0, total: 0 }));
  await t.page.evaluate((tsv) => window.fromLive({ type: 'workTools:results', id: 'manager-n', kind: 'national', partial: true, done: 3, total: 4, tsv }), natTsv([nat('New Lead', '70000009', 'Re setup'), nat('Alex Sample', '70000001', 'Check'), nat('Sam Buyer', '70000002', 'Check')]));
  const during = await t.page.evaluate(() => ({ typing: document.activeElement && document.activeElement.value, stored: JSON.parse(localStorage.getItem('_slaNationalCheckResults')).results.map((r) => `${r.ActivityID}:${r.Verdict}:${r.Decision || ''}:${r.DecisionNote || ''}`) }));
  check('the reason being typed is not wiped by results arriving', during.typing === 'still typ', during);
  check('the decision already made is kept, by ActivityID', during.stored.includes('70000001:OK:Valid:dealer rang them') && during.stored.includes('70000009:Re setup::') && during.stored.includes('70000003:OK::'), during.stored);
  await t.page.evaluate(() => document.querySelector('button[data-activity="70000002"][onclick*="Re setup"]').click());
  const done = await t.page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('_slaNationalCheckResults')).results.map((r) => `${r.ActivityID}:${r.Verdict}:${r.Decision || ''}:${r.DecisionNote || ''}`), text: document.querySelector('.panelContent').textContent.replace(/\s+/g, ' ') }));
  check('the second decision lands on the right lead with its reason', done.stored.includes('70000002:Re setup:Re setup:still typ') && done.stored.includes('70000001:OK:Valid:dealer rang them'), done.stored);
  check('the new results show once the typing is done', /New Lead/.test(done.text), done.text.slice(0, 200));
  check('the Today summary counts them', /TODAY\s*National: 4 checked, Re setup 2 to do, 0 done/.test(done.text), done.text.slice(0, 200));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function openOnLiveAndLayout() {
  console.log('\nOpen on Konnect Live from the avatar control; the compact panel keeps its header, link line and footer');
  const t = await open();
  await openPanel(t.page);
  await t.page.evaluate(() => { window.OPEN_CALLS = 0; const real = window.open; window.open = (...a) => { window.OPEN_CALLS++; return real(...a); }; });
  const avatar = (name) => `.customer-card[data-customer-name="${name}"] .avatar-circle`;
  const entry = '#_slaAvatarAssignPopover button.open-on-live';
  const pop = () => t.page.evaluate(() => { const p = document.getElementById('_slaAvatarAssignPopover'); const b = p.querySelector('button.open-on-live'); return { open: p.style.display !== 'none', text: p.textContent.replace(/\s+/g, ' ').trim(), select: !!p.querySelector('select.manual-assign-select'), entry: b ? b.textContent.trim() : null }; });
  check('the cards carry no extra button', await t.page.evaluate(() => document.querySelectorAll('.customer-card button.open-on-live').length === 0));
  await t.page.click(avatar('mrs sam buyer'));
  let p = await pop();
  check('the avatar still opens the assign control, now with Open on Konnect Live', p.open && p.select && /^Assign to/.test(p.text) && p.entry === 'Open on Konnect Live', p);
  await t.page.click(entry);
  check('not linked: says so, sends nothing and opens no tab', (await toast(t.page)) === 'Konnect Live is not open. Press Open Konnect Live first.' && await t.page.evaluate(() => window.toLive.length === 0 && window.OPEN_CALLS === 0), await toast(t.page));
  await t.page.evaluate(() => window.fromLive({ type: 'workTools:ready', state: 'idle', batchId: null, done: 0, total: 0 }));
  await t.page.evaluate(() => { const live = document.getElementById('live').contentWindow; window.FOCUSED = 0; live.focus = () => { window.FOCUSED++; }; });
  await t.page.click(avatar('mrs sam buyer'));
  await t.page.click(entry);
  const sent = await t.page.evaluate(() => ({ messages: window.toLive.slice(), created: window.LEADS[1][4], focused: window.FOCUSED, opened: window.OPEN_CALLS }));
  check('linked: posts the lead as the export writes it', sent.messages.length === 1 && JSON.stringify(sent.messages[0]) === JSON.stringify({ type: 'workTools:open', row: { name: 'Sam Buyer', phone: '07700900002', email: 'sam@example.com', source: 'Robins & Day Website', campaign: 'Peugeot - Test Drive Request - New (pcr_new_test_drive)', created: sent.created } }), sent.messages);
  check('and brings the Live tab forward, opens no other tab and closes the control', sent.focused === 1 && sent.opened === 0 && !(await pop()).open, sent);
  await t.page.evaluate(() => window.fromLive({ type: 'workTools:opened', ok: true, text: 'Opened Sam Buyer.' }));
  check('the Lead Checker\'s answer is shown', (await toast(t.page)) === 'Opened Sam Buyer.', await toast(t.page));
  await t.page.evaluate(() => window.fromLive({ type: 'workTools:opened', ok: false, text: 'The Lead Checker is busy with a batch. Try again when it has finished.' }));
  check('a busy answer is shown as it is', /busy with a batch/.test(await toast(t.page)), await toast(t.page));
  await t.page.click(avatar('miss fay fields'));
  p = await pop();
  check('an assigned lead: who has it, and the entry', p.open && !p.select && /^Assigned to\s*Agent Alpha/.test(p.text) && p.entry === 'Open on Konnect Live', p);
  await t.page.click(entry);
  check('an assigned lead opens too', await t.page.evaluate(() => window.toLive.length === 2 && window.toLive[1].row.name === 'Fay Fields'), await t.page.evaluate(() => window.toLive));
  await t.page.evaluate(() => window._toggleZenMode());
  await sleep(500);
  await t.page.click(avatar('mrs sam buyer'));
  check('List only view has the entry too', (await pop()).entry === 'Open on Konnect Live', await pop());
  await t.page.evaluate(() => window._toggleZenMode());
  await sleep(500);
  await t.page.evaluate(() => { localStorage.setItem('_workToolsDeskDecisions', JSON.stringify({ savedAt: new Date().toISOString(), rows: [{ at: new Date().toISOString(), run: 'Email Only', name: 'Jo Example', detail: '', outcome: 'Done', step: '' }] })); window._toggleLeadCheckerPopover(); });
  check('the popover counts the desk\'s decisions when it opens', await t.page.evaluate(() => document.getElementById('_slaCopyReviewBtn').textContent) === 'Copy review decisions (1)', await t.page.evaluate(() => document.getElementById('_slaCopyReviewBtn').textContent));
  await t.page.evaluate(() => window._toggleLeadCheckerPopover());
  // Compact size with Overview and Assign open: nothing is pushed out of the box.
  await t.page.evaluate(() => { if (document.getElementById('_slaPanelBox').getBoundingClientRect().height >= window.innerHeight) window._togglePanelSize(); if (document.getElementById('statSummaryBody').style.display === 'none') window._toggleStatSummary(); });
  await sleep(300);
  const box = await t.page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; }; const panel = document.getElementById('_slaPanelBox'); const list = panel.querySelector('.panelContent'); list.scrollTop = 300; const search = document.getElementById('customerSearchInput').parentElement;
    return { panel: r(panel), list: r(list), link: r(document.getElementById('_slaLinkLine')), footer: r(panel.lastElementChild), top: r(document.getElementById('_slaTopArea')), search: r(search), size: getComputedStyle(panel).fontSize }; });
  check('compact: the link line and footer stay inside the panel', box.link.top >= box.list.bottom && box.footer.bottom <= box.panel.bottom && box.footer.height > 20, box);
  check('compact: the list keeps at least 160px and Overview scrolls instead', box.list.height >= 160 && box.top.bottom <= box.list.top, box);
  check('the search box sticks flush to the top of the list', box.search.top === box.list.top, box);
  check('the panel sets its own type size', box.size === '13px', box.size);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
  // No agents online: the picker falls back to a plain badge, the entry stays.
  const n = await open(() => { window.angular = { element: () => ({ scope: () => ({ agents: [] }) }) }; });
  await openPanel(n.page);
  await n.page.evaluate(() => window.fromLive({ type: 'workTools:ready', state: 'idle', batchId: null, done: 0, total: 0 }));
  await n.page.click('.customer-card[data-customer-name="mrs sam buyer"] .avatar-circle');
  const none = await n.page.evaluate(() => { const p = document.getElementById('_slaAvatarAssignPopover'); const b = p.querySelector('button.open-on-live'); const state = { open: p.style.display !== 'none', select: !!p.querySelector('select'), entry: b ? b.textContent.trim() : null }; if (b) b.click(); return { ...state, sent: window.toLive.filter((m) => m.type === 'workTools:open').map((m) => m.row.name) }; });
  check('with no agents online the entry is still there and sends', none.open && !none.select && none.entry === 'Open on Konnect Live' && none.sent.join() === 'Sam Buyer', none);
  await n.context.close();
}

const started = Date.now();
try {
  await openOnLiveAndLayout();
  await popUps();
  await busyGuard();
  await resultsAndState();
  await nationalDecisions();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failures ? `${failures} failed` : 'All passed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
