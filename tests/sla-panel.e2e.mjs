#!/usr/bin/env node
// Browser tests for the SLA Manager panel against a small stand-in for the
// Konnect Manager SLA page (built below): reading customer pop-ups, the busy
// guard, Clear Queue, due tiles, merging results and keeping the panel's
// state across redraws, the missed lead warning, Team today, Start my day and
// Rescue. Needs Playwright with Chromium. Run from the repo root:
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
// with switches for slow or odd behaviour (QUEUE_DONE adds done rows to an
// agent's queue). All names and numbers are made up.
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
function renderQueue(){document.getElementById('view').innerHTML='<div title="Filter by Module"><span class="ng-binding">Customer Hub</span></div><button ng-click="ClearQueues()" onclick="window.CLEARED=(window.CLEARED||0)+1;if(!window.CLEAR_DOES_NOTHING)LEADS.forEach(l=>l[8]=null)">Clear Queues</button><ul>'+AGENTS.map((a,i)=>'<li ng-repeat="agent in fullqueue | filter: filterMessages"><div class="queueitem panel-heading"><div style="font-weight:bold">'+a.DisplayText+'</div></div><ul class="list-group">'+(i===0?'<li class="queueitem list-group-item"><span title="Fay Fields | fay@example.com | 07700900004">Fay</span></li>':'')+((window.QUEUE_DONE||{})[i]||[]).map(d=>'<li class="queueitem list-group-item" style="background-color: rgb(244, 244, 244);"><span title="'+d+'">done</span></li>').join('')+'</ul></li>').join('')+'</ul>';}
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
  const tile = await t.page.evaluate(() => { const el = document.querySelectorAll('.stat-tile-clickable')[1]; return `${el.tagName} ${el.textContent.replace(/\s+/g, ' ').trim()} | ${el.title}`; });
  check('the 15 minute tile counts 3 and is a button that says what a press does', /^BUTTON 3\s?15 min \| Assign these 3 now/.test(tile), tile);
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
  check('a second import adds to the first, tags in sentence case', /Date only/.test(await badges(t.page, 'mr alex sample')) && /Warm enquiry/.test(await badges(t.page, 'jo example')), [await badges(t.page, 'mr alex sample'), await badges(t.page, 'jo example')]);
  check('time past the hour reads in hours', /Missed 1 h 1\d min/.test(await badges(t.page, 'eve evans')), await badges(t.page, 'eve evans'));
  check('a wrong paste is refused in plain words', await t.page.evaluate(() => { const b = document.createElement('button'); document.getElementById('leadCheckerImportBox').value = 'Name\tPhone'; window._classifyLeadCheckerImport(b); return b.textContent; }) === 'Not Lead Checker results');

  // Results arriving over the link redraw the panel under the user.
  await t.page.evaluate(() => {
    window._toggleLeadCheckerPopover();
    const search = document.getElementById('customerSearchInput');
    search.value = 's';
    window._filterCustomerSearch('s');
    search.focus();
    search.setSelectionRange(1, 1);
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
    sendHeader: document.getElementById('_slaPanelBox').dataset.sub === 'send',
    contact: document.querySelector('.customer-card[data-customer-name="eve evans"] .contact-details').style.display,
    scroll: document.querySelector('.panelContent').scrollTop
  }));
  check('the new result is on its card', /Nurture/.test(after.badge), after);
  check('search text, focus, the open Send view, open contact details and scroll are kept', after.search === 's' && after.sendHeader && after.focused === 'customerSearchInput' && after.hidden === 'none' && after.popover === 'block' && after.contact === 'grid' && after.scroll === 60, after);
  check('the footer line shows real dots', await t.page.evaluate(() => { const l = document.querySelector('#_slaPanelBox .sla-ft span'); return /^\d leads · \d assigned · scanned \d\d:\d\d( · \d new)?( · \d gone)?$/.test(l.textContent.trim()); }), await t.page.evaluate(() => document.querySelector('#_slaPanelBox .sla-ft span').textContent));

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
  check('the checks list counts the National verdicts and offers the two waiting for a decision', await t.page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panelContent button')).find((el) => el.textContent.trim() === 'See the 2 to deal with'); if (b) b.click(); return !!b && document.getElementById('_slaPanelBox').dataset.view === 'national'; }), rowText.slice(0, 400));
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
  const todayChip = await t.page.evaluate(() => { const c = document.querySelector('#_slaTodaySummary button[data-kind="national"]'); c.click(); return { chip: c.textContent.trim(), line: document.querySelector('#_slaTodaySummary [role="status"]').textContent.trim() }; });
  check('the Today chip counts them and opens to the full line', todayChip.chip === 'National 2 to do' && todayChip.line === 'National: 4 checked, Re setup 2 to do, 0 done', todayChip);
  check('the National view stays up through its redraws, with the filled button still Needs re setup', await t.page.evaluate(() => document.getElementById('_slaPanelBox').dataset.view === 'national' && /Back to checks/.test(document.querySelector('.sla-hd').textContent) && Array.from(document.querySelectorAll('.sla-review .sla-pri')).every((b) => b.textContent.trim() === 'Needs re setup')));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function openOnLiveAndLayout() {
  console.log('\nOpen on Konnect Live from the avatar control; the compact panel keeps its header, link strip and footer');
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
  // Compact size with the agent list open: nothing is pushed out of the box.
  await t.page.evaluate(() => { window._setPanelSize('compact'); document.querySelector('.sla-agentsToggle').click(); });
  await sleep(300);
  const box = await t.page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; }; const panel = document.getElementById('_slaPanelBox'); const list = panel.querySelector('.panelContent'); list.scrollTop = 300; const search = document.getElementById('customerSearchInput').parentElement;
    return { panel: r(panel), list: r(list), link: r(document.getElementById('_slaLinkLine')), footer: r(panel.lastElementChild), top: r(document.getElementById('_slaTopArea')), search: r(search), size: getComputedStyle(panel).fontSize }; });
  check('compact: the link strip sits under the header and the footer stays inside the panel', box.link.top > box.panel.top && box.link.bottom <= box.top.top && box.footer.top >= box.list.bottom && box.footer.bottom <= box.panel.bottom && box.footer.height > 20, box);
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

async function layoutAndMenus() {
  console.log('\nLayout: the sizes, the More menu, the agents row, Filters and Email only mode');
  const t = await open();
  await openPanel(t.page);
  const box = () => t.page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) }; }; const p = document.getElementById('_slaPanelBox'); return { size: p.dataset.size, top: r(document.getElementById('_slaTopArea')), list: r(p.querySelector('.panelContent')), foot: p.querySelector('.sla-ft button').textContent.trim() }; });
  let b = await box();
  check('it opens at the standard size: Overview and Assign above the list', b.size === 'standard' && b.top.bottom <= b.list.top && b.foot === 'Full size', b);
  await t.page.click('#_slaSizeBtn');
  b = await box();
  check('Full size puts Overview and Assign in a column beside the list, agents always listed', b.size === 'full' && b.top.right <= b.list.left && b.foot === 'Standard size' && await t.page.evaluate(() => document.getElementById('assignAgentList').getBoundingClientRect().height > 0), b);
  await t.page.click('#_slaSizeBtn');
  check('and the footer switch goes back', (await box()).size === 'standard');

  const header = await t.page.evaluate(() => { const hd = document.querySelector('#_slaPanelBox .sla-hd'); const title = hd.querySelector('button.sla-ttl'); return { title: title.textContent.trim(), tip: title.title, buttons: Array.from(hd.querySelectorAll('.sla-hbtn')).filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent.trim()) }; });
  check('the header is the tool name, Send, Checks and More', header.title === 'SLA Manager' && header.tip === 'Scan again' && header.buttons.join() === 'Send,Checks,More', header);
  await t.page.evaluate(() => { document.getElementById('_slaPanelBox').dataset.mark = '1'; LEADS.push(['Hal Hughes', 'AB18CDE', 'Customer First', 'Citroen - Enquiry - New', at(-5), at(-4), at(40), 'Pending', 'Agent Charlie', '07700900008', 'hal@example.com']); renderSla(); });
  await t.page.click('#_slaPanelBox button.sla-ttl');
  check('clicking the title scans again', await waitFor(t.page, () => !document.getElementById('_slaPanelBox').dataset.mark && !!document.querySelector('.customer-card[data-customer-name="hal hughes"]') && !document.getElementById('_slaPageFlashOverlay'), null, 15000));
  await t.page.evaluate(() => { LEADS.pop(); renderSla(); return window._refreshLeadsAndPanel(); });
  await idle(t.page);
  await sleep(300);

  await t.page.click('#_slaMoreBtn');
  const menu = await t.page.evaluate(() => { const m = document.getElementById('_slaMoreMenu'); const groups = [[]]; Array.from(m.children).forEach((el) => { if (el.classList.contains('sla-ms')) groups.push([]); else if (el.classList.contains('sla-mi')) groups[groups.length - 1].push(el.querySelector('span').textContent.trim()); }); return { open: !m.hidden, groups }; });
  check('More opens with Hide the panel first and on its own', menu.open && menu.groups[0].join() === 'Hide the panel', menu);
  check('the view group ends with List only view and the missed lead warning', menu.groups[1].join() === 'Sort by Lead Checker category,Compact size,Full size, two columns,Back to top,List only view,Warn me about leads going missed', menu.groups[1]);
  check('Scan again, Refresh agents, History, Team today, Queue, Paste and Clear Queue are in More', menu.groups[2].join() === 'Scan again,Refresh agents,History,Team today,Queue,Paste Lead Checker results,Clear Queue', menu.groups[2]);
  check('then Report a problem and Clear & Stop', menu.groups[3].join() === 'Report a problem,Clear & Stop', menu.groups[3]);
  await t.page.click('#_slaMoreMenu .sla-mi:has-text("History")');
  check('History from More shows in the Assign card and the menu closes', await t.page.evaluate(() => document.getElementById('_slaMoreMenu').hidden && document.getElementById('assignHistoryPanel').style.display === 'block' && /No assignments recorded today yet/.test(document.getElementById('assignHistoryPanel').textContent)));
  await t.page.click('#_slaMoreBtn');
  await t.page.click('#_slaMoreMenu .sla-mi:has-text("Hide the panel")');
  check('Hide the panel tucks it away; the badge brings it back', await t.page.evaluate(() => document.getElementById('_slaPanelBox').style.transform === 'translateX(150%)' && localStorage.getItem('_slaPanelState') === 'hidden'));
  await t.page.evaluate(() => window._toggleMinimizePanel());

  const row = await t.page.evaluate(() => { const r = document.querySelector('#assignSectionBody .sla-agsum'); const pane = document.getElementById('assignAgentPane'); const state = { text: Array.from(r.querySelectorAll('button')).filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent.replace(/\s+/g, ' ').trim()), folded: pane.hidden, bubbles: r.querySelectorAll('.sla-av, .sla-chip').length }; r.querySelector('.sla-agentsToggle').click(); return { ...state, opened: !pane.hidden, agents: pane.querySelectorAll('.assign-agent-checkbox').length, extras: pane.textContent.replace(/\s+/g, ' ').trim() }; });
  check('the agents row is "3 agents online", Queue and Clear Queue, with no chips or bubbles', row.text.join('|') === '3 agents online|Queue|Clear Queue' && row.folded && row.bubbles === 0, row);
  check('it opens the full agent list with All, None and the limit', row.opened && row.agents === 3 && /Agent Alpha.*Agent Bravo.*Agent Charlie.*All None Limit.*per agent/.test(row.extras), row);
  check('the preview says how the leads split and the button says how many', await t.page.evaluate(() => document.getElementById('assignMatchPreview').textContent === '6 leads to 3 agents, 2 each' && document.getElementById('assignRunButton').textContent === 'Assign 6'), await t.page.evaluate(() => [document.getElementById('assignMatchPreview').textContent, document.getElementById('assignRunButton').textContent]));

  await t.page.click('#filtersTabPill');
  const filters = await t.page.evaluate(() => { const z = document.getElementById('filtersZoneBody'); const tiers = document.getElementById('_slaTierList'); return { order: Array.from(z.children).filter((el) => el.id !== '_slaTierList').map((el) => el.textContent.replace(/\s+/g, ' ').trim().replace(/All\s*5.*120/, '').replace(/\s+/g, ' ')), folded: tiers.hidden, tiers: Array.from(tiers.querySelectorAll('label')).map((l) => l.textContent.replace(/\s+/g, ' ').trim()) }; });
  check('Filters run Due within, Customer First only, Email only, then the tiers folded, then the quiet line', filters.order.join('|') === 'Due within minutes|Customer First only (2)|Email only (1)|Tiers: all four|Only leads not yet assigned are ever assigned.' && filters.folded, filters.order);
  check('each tier keeps its name and says what it holds', filters.tiers.join('|') === 'Tier 1 - Priority (1)Test drive requests, electric campaigns and Reserve Used|Tier 2 - High (3)Customer First new enquiries, Motability and Leapmotor|Tier 3 - Medium (1)Used enquiries, new offer requests and PX valuations|Tier 4 - Standard (1)Other new enquiries, General, Inbound and anything not matched', filters.tiers);
  await t.page.click('[aria-controls="_slaTierList"]');
  await t.page.click('.assign-tier-checkbox[value="4"]');
  check('unticking a tier shows on the folded row and is saved', await t.page.evaluate(() => document.getElementById('_slaTierLabel').textContent === 'Tiers: 1, 2, 3' && JSON.parse(localStorage.getItem('_slaAssignSettings')).excludedTiers.join() === '4'));
  await t.page.click('.assign-tier-checkbox[value="4"]');
  await t.page.selectOption('#assignWindowMinutes', '15');
  check('Due within narrows the run', await t.page.evaluate(() => document.getElementById('assignRunButton').textContent) === 'Assign 3', await t.page.evaluate(() => document.getElementById('assignRunButton').textContent));
  await t.page.selectOption('#assignWindowMinutes', '');
  const headings = await t.page.evaluate(() => Array.from(document.querySelectorAll('.panelContent .sla-grp')).map((h) => `${h.textContent.replace(/\s+/g, ' ').trim()} | ${h.title}`));
  check('group headings keep their names and say what the tier holds in a tooltip', headings[0] === 'Tier 1 - Priority 1 | Tier 1 - Priority: Test drive requests, electric campaigns and Reserve Used. Click to fold or unfold' && /^Tier 4 - Standard 1 \| Tier 4 - Standard: Other new enquiries/.test(headings[3]), headings);

  // Email only: the chip beside Customer First and the tick box in Filters are one switch.
  const chip = await t.page.evaluate(() => { const c = document.getElementById('_slaEoChip'); return { text: c.textContent.replace(/\s+/g, ' ').trim(), after: c.previousElementSibling.textContent.trim(), pressed: c.getAttribute('aria-pressed') }; });
  check('an Email only chip with its count sits beside the Customer First chips', chip.text === 'Email only 1' && /in 60$/.test(chip.after) && chip.pressed === 'false', chip);
  await t.page.click('#_slaEoChip');
  const eo = () => t.page.evaluate(() => ({ tick: document.getElementById('assignEmailOnly').checked, saved: JSON.parse(localStorage.getItem('_slaAssignSettings')).emailOnly, pressed: document.getElementById('_slaEoChip').getAttribute('aria-pressed'), bar: !document.getElementById('_slaEoBar').hidden, normal: !document.getElementById('_slaAssignNormal').hidden, tab: document.getElementById('assignTabPill').getAttribute('aria-selected'), count: document.getElementById('_slaEoCount').textContent, button: document.getElementById('assignRunButton').textContent }));
  let mode = await eo();
  check('the chip turns the Assign bar into Email only mode through the existing filter', mode.tick && mode.saved === true && mode.pressed === 'true' && mode.bar && !mode.normal && mode.tab === 'true' && mode.count === '1 Email only lead' && mode.button === 'Assign 1 Email only', mode);
  await t.page.click('#_slaEoBar button[aria-label="Back to normal assigning"]');
  mode = await eo();
  check('the cross goes back to normal assigning', !mode.tick && mode.saved === false && mode.pressed === 'false' && !mode.bar && mode.normal && mode.button === 'Assign 6', mode);
  await t.page.click('#filtersTabPill');
  await t.page.click('#assignEmailOnly');
  mode = await eo();
  check('the tick box in Filters switches the same mode on', mode.tick && mode.pressed === 'true' && mode.bar, mode);
  await t.page.click('#assignTabPill');
  await t.page.selectOption('#_slaEoAgent', { label: 'Agent Bravo' });
  await t.page.click('#assignRunButton');
  await waitFor(t.page, () => /assigned/.test((document.getElementById('assignResultsSummary') || {}).textContent || ''));
  const ran = await t.page.evaluate(() => ({ leads: LEADS.map((l) => l[8]), stored: JSON.parse(localStorage.getItem('_workToolsEmailOnlyAssigned') || '{}').leads, summary: document.getElementById('assignResultsSummary').textContent.trim() }));
  check('the run assigns only the Email only lead, to the chosen agent', ran.leads[2] === 'Agent Bravo' && ran.leads.filter(Boolean).length === 2 && /1 assigned$/.test(ran.summary), ran);
  check('and records it for Lead Re setup as before', Array.isArray(ran.stored) && ran.stored.length === 1 && ran.stored[0].email === 'jo@example.com' && ran.stored[0].agent === 'Agent Bravo', ran.stored);
  check('the agent is remembered as last used for Email only', await t.page.evaluate(() => document.getElementById('_slaEoAgent').selectedOptions[0].textContent === 'Agent Bravo' && document.getElementById('_slaEoAgentNote').textContent === '(last used for Email only)'));

  // List only view keeps two lines a person and hides everything above the list.
  await t.page.evaluate(() => { window._setEmailOnlyMode(false); window._toggleZenMode(); });
  await sleep(300);
  const zen = await t.page.evaluate(() => ({ sub: document.querySelector('.sla-hd .sla-sub').textContent.trim(), top: document.getElementById('_slaTopArea').textContent.replace(/\s+/g, ' ').trim(), assign: !!document.getElementById('assignSectionContainer'), today: !!document.getElementById('_slaTodaySummary'), twoLines: Array.from(document.querySelectorAll('.customer-card')).every((c) => c.querySelector('.sla-nm') && c.querySelector('.sla-meta').textContent.trim().length > 0 && c.querySelector('.sla-meta').getBoundingClientRect().top > c.querySelector('.sla-nm').getBoundingClientRect().top) }));
  check('List only view: counts and Show overview in place of Overview, Assign and Today', /list only$/.test(zen.sub) && /^\d missed\s?\d due in 30 min\s?\d not assigned\s?Show overview$/.test(zen.top) && !zen.assign && !zen.today, zen);
  check('and every lead keeps its two lines', zen.twoLines);
  await t.page.click('#_slaTopArea button:has-text("Show overview")');
  await sleep(300);
  check('Show overview brings them back', await t.page.evaluate(() => !!document.getElementById('assignSectionContainer') && !/list only/.test(document.querySelector('.sla-hd .sla-sub').textContent)));

  // The Send view takes the panel; Open Konnect Live is on the strip only.
  await t.page.click('.sla-hd .sla-hbtn:has-text("Send")');
  const send = await t.page.evaluate(() => { const v = document.getElementById('leadCheckerPopover'); return { shown: v.style.display === 'block', header: Array.from(document.querySelectorAll('.sla-hd .sla-hbtn')).filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent.trim()).join(), sub: Array.from(document.querySelectorAll('.sla-hd .sla-sub')).filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent.trim()).join(), chips: Array.from(v.querySelectorAll('.chip-label')).map((l) => l.textContent.replace(/\s+/g, ' ').trim()), send: document.getElementById('_slaSendLabel').textContent, openLive: Array.from(v.querySelectorAll('button')).some((el) => /Open Konnect Live/.test(el.textContent)), byHandFolded: document.getElementById('_slaByHand').hidden }; });
  check('Send opens its own view with Back to leads', send.shown && send.header === 'Back to leads,More' && send.sub === 'Send to Lead Checker', send);
  check('the tiers are chips with their counts, and the filled button says how many', send.chips.join('|') === 'Tier 1 - Priority (1)|Tier 2 - High (3)|Tier 3 - Medium (2)|Tier 4 - Standard (1)' && send.send === 'Send 2 leads' && !send.openLive && send.byHandFolded, send);
  await t.page.click('#leadCheckerPopover .chip-label:has-text("Tier 1")');
  await t.page.click('#bookingExportCustomerFirstOnly');
  check('choosing leads recounts the Send button', (await t.page.evaluate(() => document.getElementById('_slaSendLabel').textContent)) === 'Send 4 leads', await t.page.evaluate(() => document.getElementById('_slaSendLabel').textContent));
  await t.page.click('.sla-hd .sla-hbtn:has-text("Back to leads")');
  check('Back to leads closes it', await t.page.evaluate(() => document.getElementById('leadCheckerPopover').style.display === 'none' && !document.getElementById('_slaPanelBox').dataset.sub));

  // Post Closure tags are the two actions only, in the shared colours.
  const created = await t.page.evaluate(() => LEADS.map((l) => l[4]));
  const pcRow = (name, email, c, action, reason) => [name, '', email, 'Post Closure Processing', 'x', c, '-', '5', 'NURTURE', '', '', '', 'medium', 'r', '', action, '203', reason, 'Dealer scheduled a call'].join('\t');
  await t.page.evaluate((tsv) => { const b = document.createElement('button'); document.getElementById('leadCheckerImportBox').value = tsv; window._classifyLeadCheckerImport(b); }, [H, pcRow('Gus Green', 'gus@example.com', created[4], 'send back through', 'Actioned by dealership'), pcRow('Dan Davis', 'dan@example.com', created[5], 'check: needs contact?', ''), resultRow('Eve Evans', 'eve@example.com', created[6], 'DATE ONLY')].join('\n'));
  const tags = await t.page.evaluate(() => Object.fromEntries(['dr gus green', 'dan davis', 'eve evans'].map((n) => { const c = document.querySelector(`.customer-card[data-customer-name="${n}"]`); const tag = c.querySelector('.sla-tag'); return [n, { tag: tag.textContent.trim(), colour: tag.style.getPropertyValue('--tc').trim(), meta: c.querySelector('.sla-meta').textContent.trim() }]; })));
  check('a send back lead: the tag is the action, the reason and shorthand lead the grey line', tags['dr gus green'].tag === 'send back through' && tags['dr gus green'].colour === '#0891b2' && /^Actioned by dealership \(CAD\) · /.test(tags['dr gus green'].meta), tags['dr gus green']);
  check('a check lead: the tag is "check: needs contact?"', tags['dan davis'].tag === 'check: needs contact?' && tags['dan davis'].colour === '#d97706', tags['dan davis']);
  check('a tier tag takes the Lead Checker\'s tier colour', tags['eve evans'].tag === 'Date only' && tags['eve evans'].colour === '#2563eb', tags['eve evans']);
  check('the badge that opens SLA Manager is unchanged', await t.page.evaluate(() => { const b = document.getElementById('_slaBadge'); return !!b && b.closest('li') && b.closest('li').id === '_slaBadgeNavItem'; }));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

// A stand-in for desktop notifications that records what would be shown.
const fakeNotifications = (answer) => `
  window.NOTES = []; window.ASKED = 0;
  class FakeNotification { constructor(title, options) { window.NOTES.push({ title, body: options.body }); } close() {}
    static requestPermission() { window.ASKED++; FakeNotification.permission = '${answer}'; return Promise.resolve('${answer}'); } }
  FakeNotification.permission = 'default';
  window.Notification = FakeNotification;
  document.hasFocus = () => true;
  window.__slaWatchTiming = { scanMs: 1500, tickMs: 150 };
  window.REFRESHES = 0;
  document.querySelector('i.fa-refresh').addEventListener('click', () => { window.REFRESHES++; });`;
const OWN_TITLE = 'Konnect Manager (stand-in)';
const shot = async (page, name) => { if (process.env.SLA_SHOT_DIR) await page.locator('#_slaPanelBox').screenshot({ path: join(process.env.SLA_SHOT_DIR, name) }); };

async function missedWarning() {
  console.log('\nMissed lead warning: the tab title, one notification a scan, and the list kept fresh');
  let t = await open(fakeNotifications('granted'));
  await openPanel(t.page);
  const title = () => t.page.title();
  const notes = () => t.page.evaluate(() => window.NOTES.slice());
  await sleep(500);
  check('off by default: the title is the page\'s own and nothing is scanned', (await title()) === OWN_TITLE && await t.page.evaluate(() => !window._slaMissedWatchInterval && window.ASKED === 0));
  const refreshesBefore = await t.page.evaluate(() => window.REFRESHES);
  await sleep(2200);
  check('and there is no rescan on a timer', (await t.page.evaluate(() => window.REFRESHES)) === refreshesBefore);

  await t.page.click('#_slaMoreBtn');
  await t.page.click('#_slaMoreMenu .sla-mi:has-text("Warn me about leads going missed")');
  await waitFor(t.page, (own) => document.title !== own, OWN_TITLE, 3000);
  check('turning it on asks for notifications once and says so in More', await t.page.evaluate(() => window.ASKED === 1 && Array.from(document.querySelectorAll('#_slaMoreMenu .sla-mi')).find((el) => /Warn me/.test(el.textContent)).querySelector('em').textContent === 'on' && localStorage.getItem('_slaMissedWarning') === '1'));
  check('the title leads with the unassigned leads missed and due within 15 minutes', (await title()) === `(2 missed, 1 in 15) ${OWN_TITLE}`, await title());
  await sleep(500);
  check('with the panel in view there is no notification', (await notes()).length === 0, await notes());

  // Panel hidden: one lead comes within 15 minutes, one within 5, and a new one is already missed.
  await t.page.evaluate(() => { window._toggleMinimizePanel(); window.OPENED = {}; LEADS[4][6] = at(10); LEADS[5][6] = at(5); LEADS.push(['Hal Hughes', 'AB18CDE', 'Customer First', 'Citroen - Enquiry - New', at(-90), at(-89), at(-3), 'Missed', null, '07700900008', 'hal@example.com']); renderSla(); });
  await waitFor(t.page, () => window.NOTES.length > 1, null, 4000);
  let shown = await notes();
  check('with the panel hidden the new ones are one notification for 5 minutes and one for the rest', shown.length === 2 && shown.every((n) => n.title === 'SLA Manager') && shown.map((n) => n.body).join('|') === '1 lead due within 5 minutes. Unassigned.|1 lead due within 15 minutes, 1 missed. Unassigned.', shown);
  check('and the title counts each level', (await title()) === `(3 missed, 1 in 5 min, 2 in 15) ${OWN_TITLE}`, await title());
  await t.page.evaluate(() => { LEADS[4][6] = at(5); renderSla(); });
  await waitFor(t.page, () => window.NOTES.length > 2, null, 4000);
  shown = await notes();
  check('a lead warned about at 15 minutes warns once more at 5', shown.length === 3 && shown[2].body === '1 lead due within 5 minutes. Unassigned.' && (await title()) === `(3 missed, 2 in 5 min, 1 in 15) ${OWN_TITLE}`, { shown, title: await title() });
  const names = ['Alex', 'Sample', 'Sam', 'Buyer', 'Gus', 'Green', 'Hal', 'Hughes', 'Eve', 'Evans'];
  check('no customer name is in the title or the notification', !names.some((n) => shown.some((note) => note.body.includes(n))) && !(await title()).replace(OWN_TITLE, '').match(/[A-Z]/));
  check('the list is scanned again on its own while the warning is on', await waitFor(t.page, () => window.REFRESHES >= 1, null, 6000));
  await sleep(1200);
  shown = await notes();
  check('no lead is notified again, however many scans follow', shown.length === 3, shown);
  check('a scan with the panel hidden opens no customer pop-up', await t.page.evaluate(() => Object.keys(window.OPENED).length === 0 && !document.querySelector('.customer-card[data-customer-name="hal hughes"]')), await t.page.evaluate(() => window.OPENED));

  // Panel back: the next scan is the full one, pop-up and all.
  await t.page.evaluate(() => window._toggleMinimizePanel());
  check('with the panel showing the scan reads the new lead in', await waitFor(t.page, () => !!document.querySelector('.customer-card[data-customer-name="hal hughes"]') && !document.getElementById('_slaPageFlashOverlay'), null, 10000));

  // Never while a customer pop-up is open.
  await t.page.evaluate(() => { openModal(0); window.REFRESHES = 0; });
  await sleep(3200);
  check('no scan starts while a customer pop-up is open', (await t.page.evaluate(() => window.REFRESHES)) === 0);
  await t.page.evaluate(() => document.querySelector('.modal .close').click());
  check('and it carries on once the pop-up has closed', await waitFor(t.page, () => window.REFRESHES >= 1, null, 6000));
  await idle(t.page);

  await t.page.evaluate(() => { window.KEPT = LEADS.map((l) => l[8]); LEADS.forEach((l) => { l[8] = l[8] || 'Agent Alpha'; }); renderSla(); });
  check('the title goes back to the page\'s own when none are left', await waitFor(t.page, (own) => document.title === own, OWN_TITLE, 4000), await title());
  await t.page.evaluate(() => { LEADS.forEach((l, i) => { l[8] = window.KEPT[i]; }); renderSla(); });
  check('and counts again when leads are unassigned', await waitFor(t.page, (own) => document.title === `(3 missed, 2 in 5 min, 1 in 15) ${own}`, OWN_TITLE, 4000), await title());
  shown = await notes();
  await t.page.evaluate(() => window._slaResetBookmarklet());
  await sleep(600);
  check('Clear & Stop restores the title and stops the scans', (await title()) === OWN_TITLE && await t.page.evaluate(() => !window._slaMissedWatchInterval), await title());
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();

  // Permission refused: the title still works.
  t = await open(fakeNotifications('denied'));
  await openPanel(t.page);
  await t.page.evaluate(() => { window._toggleMinimizePanel(); window._toggleMissedWarning(null); });
  await waitFor(t.page, (own) => document.title !== own, OWN_TITLE, 3000);
  await sleep(500);
  check('with notifications refused the title still carries the counts', (await t.page.title()) === `(2 missed, 1 in 15) ${OWN_TITLE}` && await t.page.evaluate(() => window.ASKED === 1 && window.NOTES.length === 0), await t.page.title());
  check('and the panel says it is the title only', /in the tab title only/.test(await toast(t.page)), await toast(t.page));
  await t.page.evaluate(() => window._toggleMissedWarning(null));
  check('turning it off restores the title', (await t.page.title()) === OWN_TITLE && await t.page.evaluate(() => !window._slaMissedWatchInterval && localStorage.getItem('_slaMissedWarning') === '0'));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function fairShare() {
  console.log('\nTeam today: assigned by tier, done from the queues, sent back');
  const nowIso = new Date().toISOString();
  const entry = (agent, tier, over) => ({ time: nowIso, lead: 'Pat Example', agent, ...(tier ? { tier } : {}), ...over });
  const log = [
    ...[1, 1, 2, 2, 2, 3, 3, 3, 4].map((tier) => entry('Agent Alpha', tier)),
    ...[1, 2, 2, 3, 3, 3, 4, 4].map((tier) => entry('Agent Bravo', tier)), entry('Agent Bravo'),
    ...[2, 2, 3, 4, 4].map((tier) => entry('Agent Charlie', tier)),
    // Not online and not in the queues: done falls back to the guess.
    entry('Agent Delta', 2, { state: 'gone' }), entry('Agent Delta', 2),
    // Past one shift: never counted.
    entry('Agent Charlie', 1, { time: new Date(Date.now() - 13 * 3600000).toISOString() })
  ];
  const t = await open(() => { window.QUEUE_DONE = { 0: ['Pat Example | pat@example.com | 07700900021'], 1: ['Kim Example | kim@example.com | 07700900022', 'Lee Example | lee@example.com | 07700900023'] }; }, { _slaAssignmentLog: log, _slaAssignSettings: { agentsOpen: true } });
  await openPanel(t.page);
  const team = () => t.page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#_slaTeamToday [data-agent]')).map((row) => [row.dataset.agent, Array.from(row.querySelectorAll('span')).slice(1).map((el) => el.textContent.trim()).join(' | ')])));
  const fairLine = () => t.page.evaluate(() => { const el = document.getElementById('_slaFairLine'); return el.hidden ? '' : el.textContent; });
  const list = await t.page.evaluate(() => ({ labels: Array.from(document.querySelectorAll('#assignAgentList label')).map((l) => l.textContent.replace(/\s+/g, ' ').trim()), extras: document.querySelectorAll('#assignAgentList .sla-share, #assignAgentList .sla-sharenote').length, team: !!document.getElementById('_slaTeamToday') }));
  check('the agents list is name, status and count only', list.labels.join('|') === 'Agent Alpha1|Agent Bravo0|Agent Charlie0' && list.extras === 0 && !list.team, list);
  await shot(t.page, 'agents-list-as-before.png');
  await t.page.click('#_slaTodaySummary .sla-chip:has-text("Team")');
  let s = await team();
  check('Team on the Today row opens one row per agent: assigned by tier, done, sent back', s['Agent Alpha'] === '9 (2 / 3 / 3 / 1) | 1 | 0' && s['Agent Charlie'] === '5 (0 / 2 / 1 / 2) | 0 | 0', s);
  check('a lead with no tier (Pending) counts in the total only', s['Agent Bravo'] === '9 (1 / 2 / 3 / 2) + 1 no tier | 2 | 0', s);
  check('done is counted from the queue, and is "about" only where the queue shows no such agent', s['Agent Delta'] === '2 (0 / 2 / 0 / 0) | about 1 | 0', s);
  check('the best guess label is there once, at the top', await t.page.evaluate(() => { const view = document.getElementById('_slaTeamToday'); const notes = view.querySelectorAll('.sla-small'); return notes.length === 1 && /best guess/.test(notes[0].textContent) && view.firstElementChild === notes[0] && !Array.from(view.querySelectorAll('[data-agent]')).some((row) => /guess/.test(row.textContent)); }));
  check('no customer detail is kept for the done count', await t.page.evaluate(() => !/example\.com|07700|Example/.test(localStorage.getItem('_slaQueueDone'))), await t.page.evaluate(() => localStorage.getItem('_slaQueueDone')));
  await shot(t.page, 'team-today.png');
  check('the quiet line under Assign names who is behind', (await fairLine()) === 'Agent Charlie has 4 fewer than the others today.', await fairLine());
  check('the line sits under the Assign button', await t.page.evaluate(() => document.getElementById('_slaFairLine').getBoundingClientRect().top >= document.getElementById('assignRunButton').getBoundingClientRect().bottom - 1));
  await t.page.click('.assign-agent-checkbox[data-name="Agent Charlie"]');
  check('it only compares the ticked agents', (await fairLine()) === '', await fairLine());
  await t.page.click('.assign-agent-checkbox[data-name="Agent Charlie"]');

  // The Missed tile assigns the two missed leads; the numbers follow.
  await t.page.evaluate(() => window._quickAssignSlaTile(null, false, true));
  await waitFor(t.page, () => /assigned/.test((document.getElementById('assignResultsSummary') || {}).textContent || ''));
  await idle(t.page);
  const logNow = await t.page.evaluate(() => JSON.parse(localStorage.getItem('_slaAssignmentLog')));
  const added = logNow.slice(-2);
  check('an assign run records each lead\'s tier, page and key', logNow.length === 27 && added.every((e) => e.tier === 2 && e.page === 'sla' && typeof e.key === 'string' && !e.state), added);
  check('assigning itself is unchanged: the run went to ticked agents only', added.every((e) => /^Agent (Alpha|Bravo|Charlie)$/.test(e.agent)), added);
  const before = await team();
  check('Team today stays open across the redraw and counts the new leads', Object.values(before).map((text) => Number(text.split(' ')[0])).reduce((a, b) => a + b, 0) === 27, before);
  check('reading the queue again does not count the same done rows twice', ['Agent Alpha', 'Agent Bravo', 'Agent Charlie'].map((name) => before[name].split(' | ')[1]).join() === '1,2,0', before);

  // What became of them: one is unassigned again (as Clear Queue leaves it),
  // the other leaves the list while still with its agent.
  const who = Object.fromEntries(added.map((e) => [e.lead, e.agent]));
  await t.page.evaluate(() => { LEADS[0][8] = null; LEADS.splice(6, 1); renderSla(); return window._refreshLeadsAndPanel(); });
  await idle(t.page);
  s = await team();
  const states = (await t.page.evaluate(() => JSON.parse(localStorage.getItem('_slaAssignmentLog')))).slice(-2).map((e) => `${e.lead}:${e.state}`).sort().join();
  check('the next scan sees one sent back and one gone from the list', states === 'Eve Evans:gone,Mr Alex Sample:back', states);
  check('the agent whose lead was unassigned shows it as sent back', s[who['Mr Alex Sample']].split(' | ')[2] === '1' && s[who['Mr Alex Sample']].split(' | ')[0] === before[who['Mr Alex Sample']].split(' | ')[0], s);
  check('where the queue is read, done stays the queue\'s count, not the guess', s[who['Eve Evans']].split(' | ')[1] === before[who['Eve Evans']].split(' | ')[1], s);
  await t.page.click('#_slaTodaySummary .sla-chip:has-text("Team")');
  check('the Team chip closes it again', await t.page.evaluate(() => !document.getElementById('_slaTeamToday')));
  await t.page.click('#_slaMoreBtn');
  await t.page.click('#_slaMoreMenu .sla-mi:has-text("Team today")');
  check('Team today in More opens it', await t.page.evaluate(() => !!document.getElementById('_slaTeamToday') && document.getElementById('_slaMoreMenu').hidden));

  await t.page.evaluate(() => window._slaResetBookmarklet());
  const kept = await t.page.evaluate(() => JSON.parse(localStorage.getItem('_slaAssignmentLog')));
  check('Clear & Stop keeps the counts, tiers and outcomes but no customer names or keys', kept.length === 27 && kept.every((e) => !('lead' in e) && !('key' in e) && e.agent) && kept.filter((e) => e.tier).length === 26 && kept.filter((e) => e.state).length === 3, kept.slice(-2));
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function startMyDay() {
  console.log('\nStart my day: opens Konnect Live, then scan, morning checks and Send on one strip');
  const t = await open(() => { window.OPENS = 0; const openLive = window.open; window.open = (...args) => { window.OPENS++; return openLive(...args); }; });
  await openPanel(t.page);
  const strip = () => t.page.evaluate(() => { const el = document.getElementById('_slaDayStrip'); return !el || el.hidden ? '' : el.querySelector('span:not(.sla-dot)').textContent.trim(); });
  const stripButton = () => t.page.evaluate(() => { const b = document.querySelector('#_slaDayStrip button'); return b ? (b.textContent.trim() || b.getAttribute('aria-label')) : ''; });
  // The button is at the top of Checks.
  const openChecks = async () => { for (let i = 0; i < 2 && !(await t.page.$('#_slaStartDayBtn')); i++) { await t.page.evaluate(() => window._toggleMorningChecks()); await sleep(300); } };
  const pressStart = async () => { await openChecks(); await t.page.click('#_slaStartDayBtn'); };
  const batches = () => t.page.evaluate(() => Array.from(new Map(window.toLive.filter((m) => m.type === 'workTools:batch').map((m) => [m.id, m])).values()));
  const ready = (state) => t.page.evaluate((s) => window.fromLive({ type: 'workTools:ready', url: 'https://carbot.ai/konnectlive/(v1.2.200)/home.html', state: s, batchId: null, done: 0, total: 0 }), state || 'idle');
  const finishBatch = () => t.page.evaluate(() => { const last = window.toLive.filter((m) => m.type === 'workTools:batch').pop(); window.fromLive({ type: 'workTools:received', id: last.id, rows: 1 }); window.fromLive({ type: 'workTools:ended', id: last.id, reason: 'done' }); });
  const finishChecks = () => t.page.evaluate(() => window.FINISH_CHECKS());
  const waitStrip = (pattern) => waitFor(t.page, (source) => new RegExp(source).test((document.getElementById('_slaDayStrip') || {}).textContent || ''), pattern, 8000);
  // The checks themselves are stood in for: they need Konnect pages the
  // stand-in does not have. The run calls the same function the button does.
  await t.page.evaluate(() => { window.CHECKS = []; window._runAllMorningChecks = () => new Promise((resolve) => { window.CHECKS.push(document.getElementById('_slaDayStrip').textContent.trim().replace(/\s+/g, ' ')); window.FINISH_CHECKS = resolve; }); });

  check('no strip until it is asked for', (await strip()) === '');
  await t.page.click('.sla-hd .sla-hbtn:has-text("Checks")');
  const checksView = await t.page.evaluate(() => { const body = document.querySelector('#_slaPanelBox .panelContent'); const buttons = Array.from(body.querySelectorAll('button')).filter((b) => !b.closest('#_slaTodaySummary')).map((b) => b.textContent.trim()); return { buttons, first: buttons[0], more: Array.from(document.querySelectorAll('#_slaMoreMenu .sla-mi')).some((el) => /Start my day/.test(el.textContent)) }; });
  check('Start my day is the first button in Checks, with Run all checks kept, and is not in More', checksView.first === 'Start my day' && checksView.buttons.includes('Run all checks') && !checksView.more, checksView);
  await shot(t.page, 'start-my-day-in-checks.png');

  // Not linked: the click opens Konnect Live and the run goes ahead.
  await pressStart();
  check('not linked: the click opens the Konnect Live tab and starts the scan', (await strip()) === 'Start my day: 1 of 3, scan' && (await stripButton()) === 'Cancel' && (await t.page.evaluate(() => window.OPENS)) === 1 && await t.page.evaluate(() => { const b = document.getElementById('_slaStartDayBtn'); return !b || (b.disabled && b.textContent.trim() === 'Running…'); }), await strip());
  await shot(t.page, 'start-my-day-strip-step-1.png');
  check('step 2 is the morning checks, started once the scan is done', await waitFor(t.page, () => window.CHECKS.length === 1 && !document.getElementById('_slaPageFlashOverlay'), null, 15000) && (await strip()) === 'Start my day: 2 of 3, morning checks', await strip());
  await shot(t.page, 'start-my-day-strip-step-2.png');
  check('nothing is sent while the checks run', (await batches()).length === 0);
  await finishChecks();
  await waitStrip('waiting to send');
  check('the Lead Checker has not answered: the leads wait and the strip says to click Work Tools', (await strip()) === 'Start my day: scan and checks done. Click Work Tools on the Konnect Live tab: the leads are waiting to send.' && (await batches()).length === 0 && await t.page.evaluate(() => window.__workToolsLiveLink.queue.length === 1), await strip());
  await shot(t.page, 'start-my-day-waiting-for-work-tools.png');
  await ready();
  check('once Work Tools is clicked there the waiting leads go, with no second tab', await waitFor(t.page, () => window.toLive.filter((m) => m.type === 'workTools:batch').length >= 1, null, 5000) && (await batches())[0].kind === 'leads' && (await t.page.evaluate(() => window.OPENS)) === 1);
  await finishBatch();
  await t.page.click('#_slaDayStrip button');
  check('the strip can be closed', (await strip()) === '');

  // Linked and idle: straight through.
  await pressStart();
  await waitFor(t.page, () => window.CHECKS.length === 2, null, 15000);
  await finishChecks();
  await waitStrip('done');
  let sent = await batches();
  const sentRows = sent.length === 2 ? sent[1].tsv.split('\n').length - 1 : 0;
  check('linked: step 3 sends the current leads to the Lead Checker, once', sent.length === 2 && sent[1].kind === 'leads' && sentRows > 0 && (await strip()) === `Start my day: done. ${sentRows} lead${sentRows === 1 ? '' : 's'} sent to the Lead Checker.`, { strip: await strip(), sent: sent.length, sentRows });
  check('it sends what the Send button would', await t.page.evaluate((rows) => document.getElementById('_slaSendLabel').textContent === `Send ${rows} lead${rows === 1 ? '' : 's'}`, sentRows), await t.page.evaluate(() => document.getElementById('_slaSendLabel').textContent));
  check('only the one Konnect Live tab was ever opened', (await t.page.evaluate(() => window.OPENS)) === 1);
  await shot(t.page, 'start-my-day-strip-done.png');
  await finishBatch();

  // Logged out: waits for the login, then sends.
  await ready('loggedOut');
  await pressStart();
  await waitFor(t.page, () => window.CHECKS.length === 3, null, 15000);
  await finishChecks();
  await waitStrip('logging back in');
  check('logged out: the strip says Konnect Live is logging back in, and nothing goes yet', (await strip()) === 'Start my day: 3 of 3, Konnect Live is logging back in' && (await batches()).length === 2, await strip());
  await ready();
  await waitStrip('done');
  check('once it is back in the leads are sent', (await batches()).length === 3 && /sent to the Lead Checker\.$/.test(await strip()) && (await t.page.evaluate(() => window.OPENS)) === 1, await strip());
  await finishBatch();

  // Still logged out after the wait: the leads are left waiting.
  await ready('loggedOut');
  await t.page.evaluate(() => { window.__slaDayTiming = { loginWaitMs: 700 }; });
  await pressStart();
  await waitFor(t.page, () => window.CHECKS.length === 4, null, 15000);
  await finishChecks();
  await waitStrip('still logged out');
  check('still logged out after the wait: the leads wait and the strip says to press Login', (await strip()) === 'Start my day: scan and checks done. Konnect Live is still logged out. Press Login on the Konnect Live tab: the leads are waiting to send.' && (await batches()).length === 3 && await t.page.evaluate(() => window.__workToolsLiveLink.queue.length === 1), await strip());
  await ready();
  await waitFor(t.page, () => new Set(window.toLive.filter((m) => m.type === 'workTools:batch').map((m) => m.id)).size === 4, null, 5000);
  await finishBatch();

  // The Checks view is often left on another Konnect page: the scan goes to the SLA page itself.
  await openChecks();
  await t.page.evaluate(() => { location.hash = '#/other'; });
  await sleep(500);
  await t.page.click('#_slaStartDayBtn');
  check('started from another Konnect page, it opens the SLA page for the scan', await waitFor(t.page, () => window.CHECKS.length === 5, null, 20000) && await t.page.evaluate(() => !!document.querySelector('table') && document.querySelectorAll('.customer-card').length > 0));
  await t.page.click('#_slaDayStrip button:has-text("Cancel")');
  check('Cancel says it stops after the step in hand', (await strip()) === 'Start my day: stopping once the morning checks step finishes' && (await stripButton()) === '', await strip());
  await finishChecks();
  await waitStrip('cancelled');
  check('a cancelled run sends nothing', (await strip()) === 'Start my day cancelled after step 2 of 3. Nothing was sent.' && (await batches()).length === 4 && (await t.page.evaluate(() => window.OPENS)) === 1, await strip());

  // Busy: refuses rather than running over a scan.
  await idle(t.page);
  await t.page.evaluate(() => { window._refreshLeadsAndPanel(); return window._startMyDay(); });
  check('while a scan is running it says not yet', /^Start my day stopped\. Not yet: the leads are being refreshed\./.test(await strip()) && (await t.page.evaluate(() => window.CHECKS.length)) === 5, await strip());
  await idle(t.page);
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

async function rescue() {
  console.log('\nRescue: clear the queue, scan, assign the leads about to go missed to free agents');
  // Alpha is Available, Bravo on Live Chat, Charlie in wrap up. One urgent lead is already in a queue.
  let t = await open(() => {
    AGENTS[0].CurrentStatusName = 'Available'; AGENTS[2].CurrentStatusName = 'Wrap Up';
    LEADS[3][6] = at(6); renderSla();
    window.ORDER = []; const assign = window.assign; window.assign = (i, name) => { window.ORDER.push(LEADS[i][0]); assign(i, name); };
    window.RESCUE_LINES = []; setInterval(() => { const text = (document.getElementById('_slaRescueLine') || {}).textContent || ''; if (text && window.RESCUE_LINES[window.RESCUE_LINES.length - 1] !== text) window.RESCUE_LINES.push(text); }, 20);
  });
  await openPanel(t.page);
  const bar = () => t.page.evaluate(() => { const b = document.getElementById('_slaRescueBtn'); const el = document.getElementById('_slaRescueBar'); return { shown: !!el && !el.hidden, button: b ? b.textContent.trim() : '', tip: b ? b.title : '', line: (document.getElementById('_slaRescueLine') || {}).textContent || '' }; });
  let b = await bar();
  check('Rescue shows in the Assign card with how many are missed or due within 15 minutes, queued or not', b.button === 'Rescue 4' && await t.page.evaluate(() => !!document.querySelector('#assignSectionContainer #_slaRescueBtn')), b);
  check('its tooltip says exactly what it does', /clears the whole queue/.test(b.tip) && /no undo/.test(b.tip) && /most urgent first/.test(b.tip) && /Available or in wrap up/.test(b.tip) && /No prompt/.test(b.tip), b.tip);
  await shot(t.page, 'rescue-button.png');
  await t.page.evaluate(() => { window._rescueLeads(); window._rescueLeads(); });
  check('it ends with a notice of what it did', await waitFor(t.page, () => /^Cleared the queue\./.test((document.getElementById('_slaRescueLine') || {}).textContent || '') && !document.getElementById('_slaPageFlashOverlay'), null, 40000) && (await bar()).line === 'Cleared the queue. 4 leads assigned to 2 agents, most urgent first. 1 agent skipped: Live Chat.', (await bar()).line);
  await idle(t.page);
  const ran = await t.page.evaluate(() => ({ cleared: window.CLEARED, order: window.ORDER, leads: Object.fromEntries(LEADS.map((l) => [l[0], l[8]])), lines: window.RESCUE_LINES, toast: (document.getElementById('_slaLinkToast') || {}).textContent || '' }));
  check('pressed twice, it clears the queue once and asks nothing', ran.cleared === 1 && t.dialogs.length === 0, { cleared: ran.cleared, dialogs: t.dialogs });
  check('the urgent leads go most urgent first', ran.order.join() === 'Eve Evans,Mr Alex Sample,Miss Fay Fields,Mrs Sam Buyer', ran.order);
  check('only to the agents who are Available or in wrap up', ran.order.every((name) => /^Agent (Alpha|Charlie)$/.test(ran.leads[name])) && new Set(ran.order.map((name) => ran.leads[name])).size === 2, ran.leads);
  check('every other lead is left unassigned', ['Jo Example', 'Dr Gus Green', 'Dan Davis'].every((name) => ran.leads[name] === null), ran.leads);
  check('a progress line shows each step', ['Rescue: 1 of 3, clearing the queue', 'Rescue: 2 of 3, scanning the leads again', 'Rescue: 3 of 3, assigning 4 leads'].every((line) => ran.lines.includes(line)), ran.lines);
  await shot(t.page, 'rescue-notice.png');
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();

  // Nobody free: the queue is left alone.
  t = await open(() => { LEADS[3][6] = at(6); renderSla(); });
  await openPanel(t.page);
  await t.page.click('#_slaRescueBtn');
  await sleep(500);
  b = await bar();
  check('with no ticked agent free it does nothing, and does not clear the queue', b.line === 'Rescue did nothing: no ticked agent is Available or in wrap up. The queue was not cleared.' && await t.page.evaluate(() => !window.CLEARED && LEADS[3][8] === 'Agent Alpha'), b);
  await t.page.evaluate(() => { LEADS.forEach((l) => { l[6] = at(120); l[7] = 'Pending'; }); renderSla(); return window._refreshLeadsAndPanel(); });
  await idle(t.page);
  check('with nothing missed or due within 15 minutes there is no Rescue button', !(await bar()).shown && !(await bar()).button, await bar());
  check('no page errors', t.errors.length === 0, t.errors);
  await t.context.close();
}

const started = Date.now();
try {
  await missedWarning();
  await fairShare();
  await startMyDay();
  await rescue();
  await layoutAndMenus();
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
