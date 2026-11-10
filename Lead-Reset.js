(function() {
'use strict';

// Lead Reset runs on the Konnect agent desktop. It takes the leads the
// National check marked Reset and, one at a time, adds a new lead with the
// same campaign, notes and dropdowns as the closed one, then parks the call.
// It never presses Finished. When a step cannot be done safely it stops and
// says what to do by hand.

const PANEL_ID = '_leadResetPanel';
const NATIONAL_RESULT_HEADER = ['NationalResult', 'Customer', 'ActivityID', 'LeadID', 'Verdict', 'Reason', 'Attempts', 'FinalOutcome', 'EnquiryMaxDealer', 'FollowUpNotes', 'ResetCampaign', 'Reg'];
const NATIONAL_RESULTS_KEY = '_slaNationalCheckResults';
const PASTED_RESULTS_KEY = '_leadResetPastedResults';
const PROGRESS_KEY = '_leadResetProgress';
const SETTINGS_KEY = '_leadResetSettings';
// Customer data is kept for one shift only, as in SLA Manager.
const STORED_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const OUTCOME_UPDATE_ONLY = 'Update Outcomes (No Call Made)';
const OUTCOME_NONE = '(Select a Call Outcome)';
const STATUS_WHILE_RESETTING = 'Shift Start';

// ===================================================================
// PURE HELPERS
// ===================================================================

function isFresh(isoTime) {
const t = isoTime ? new Date(isoTime).getTime() : NaN;
return Number.isFinite(t) && Date.now() - t <= STORED_MAX_AGE_MS;
}

function normalise(value) {
return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
}

// "Mr. Alex Sample" -> "Alex Sample": Konnect keeps the title apart from
// the name, so a search with it finds nothing.
function stripNameTitle(name) {
return String(name || '').replace(/^\s*(mr|mrs|miss|ms|mx|dr)\b\.?\s+/i, '').replace(/\s+/g, ' ').trim();
}

function compactReg(value) {
return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function escapeHtml(value) {
return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseResetFields(result) {
try {
const fields = JSON.parse((result && result.ResetFields) || '{}');
return fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
} catch (error) {
return {};
}
}

// The exact notes travel inside ResetFields; the plain column has its line
// breaks flattened and is only a fallback.
function resetNotesOf(result) {
const fields = parseResetFields(result);
return typeof fields.InitialNotes === 'string' ? fields.InitialNotes : String((result && result.ResetInitialNotes) || '');
}

function resetLeadsFrom(results) {
// "Reset" is how older exports named Re setup.
return (results || []).filter((r) => r && (r.Verdict === 'Re setup' || r.Verdict === 'Reset') && r.Customer).map((r) => ({
activityId: r.ActivityID || '',
name: r.Customer,
reg: r.Reg || '',
campaign: r.ResetCampaign || '',
notes: resetNotesOf(r),
voi: r.ResetVoi || '',
px: r.ResetPx || '',
fields: parseResetFields(r)
}));
}

// Same export the Lead Checker copies. Reads columns by name, so an export from an older or newer Lead Checker
// (fewer or extra columns) still imports. Returns {ok, results, error}.
function parseResultsTsv(text) {
const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
if (lines.length === 0) return { ok: false, results: [], error: 'Nothing on the clipboard.' };
const headerAt = lines.findIndex((l) => l.split('\t')[0].trim() === 'NationalResult');
if (headerAt < 0) return { ok: false, results: [], error: 'This is not a National results export from the Lead Checker.' };
const header = lines[headerAt].split('\t').map((h) => h.trim());
const missing = ['Customer', 'ActivityID', 'Verdict'].filter((h) => !header.includes(h));
if (missing.length) return { ok: false, results: [], error: `The National results are missing ${missing.join(', ')}. Copy them again from the Lead Checker.` };
const results = lines.slice(headerAt + 1).map((line) => {
const cells = line.split('\t');
const r = {};
NATIONAL_RESULT_HEADER.forEach((h) => { const i = header.indexOf(h); r[h] = i >= 0 ? (cells[i] || '').trim() : ''; });
return r;
}).filter((r) => r.NationalResult === 'national');
return { ok: true, results, error: null };
}

// rows: [{name, vehicles, magic, campaign}]. Returns {index, reason};
// index is -1 when no row or more than one customer could be meant. The
// Vehicles column lists SALES references, so the activity ID and the
// campaign also help to pick between customers with the same name.
function chooseSearchRow(rows, name, reg, extra) {
const target = normalise(stripNameTitle(name));
const regKey = compactReg(reg);
const indexes = rows.map((_, i) => i);
const exact = indexes.filter((i) => normalise(stripNameTitle(rows[i].name)) === target);
const sameCustomer = (list) => list.length > 1 && list.every((i) => rows[i].magic && rows[i].magic === rows[list[0]].magic);
if (exact.length === 1 || sameCustomer(exact)) return { index: exact[0], reason: 'name' };
const pool = exact.length ? exact : indexes;
const tiebreaks = [];
if (regKey) tiebreaks.push(['reg', (i) => compactReg(rows[i].vehicles).includes(regKey)]);
const activity = String((extra && extra.activityId) || '').replace(/\D/g, '');
if (activity) tiebreaks.push(['activity ID', (i) => (String(rows[i].vehicles).match(/\d+/g) || []).includes(activity)]);
const campaign = normalise(extra && extra.campaign);
if (campaign && exact.length) tiebreaks.push(['campaign', (i) => normalise(rows[i].campaign) === campaign]);
for (const [label, test] of tiebreaks) {
const hits = pool.filter(test);
if (hits.length === 1 || sameCustomer(hits)) return { index: hits[0], reason: exact.length ? `name and ${label}` : label };
}
return { index: -1, reason: exact.length > 1 ? 'several' : 'none' };
}

// The customer's lead list holds closed leads too, so a lead only counts
// as an earlier reset when staff created it by hand on the same campaign
// after the closed lead. Each lead's ID is the export's ActivityID.
function findEarlierReset(activities, lead) {
const closed = activities.find((a) => String(a.ID) === String(lead.activityId));
const closedAt = closed ? new Date(closed.CreatedDate).getTime() : NaN;
return activities.find((a) => String(a.ID) !== String(lead.activityId)
&& a.ManuallyCreated === true
&& normalise(a.CampaignName) === normalise(lead.campaign)
&& (!Number.isFinite(closedAt) || new Date(a.CreatedDate).getTime() > closedAt)) || null;
}

// The closed lead is on the agent desktop page too, so its own campaign,
// dropdowns and notes are used over what the Lead Checker read. Returns
// the lead to reset and where its notes came from.
const CLOSED_FIELD_KEYS = /^(LeadType|ChannelBadge|SourceOfEnquiry|LeadRequest|VehicleOfInterest|HasPartExchange)/;
function adoptClosedLead(lead, closed, pageNotes) {
if (!closed) return { lead, notesFrom: lead.notes ? 'the Lead Checker' : '' };
const details = (closed.SalesLead && closed.SalesLead.LeadDetails) || {};
const fields = { ...lead.fields };
Object.keys(details).forEach((key) => {
const value = details[key];
if (CLOSED_FIELD_KEYS.test(key) && value != null && value !== '' && typeof value !== 'object') fields[key] = value;
});
const noteKey = Object.keys(details).find((k) => /initial.?notes?$/i.test(k) && typeof details[k] === 'string' && details[k].trim());
const notes = noteKey ? details[noteKey] : (pageNotes && pageNotes.trim() ? pageNotes : lead.notes);
const notesFrom = noteKey || (pageNotes && pageNotes.trim()) ? 'the closed lead' : (lead.notes ? 'the Lead Checker' : '');
return { lead: { ...lead, campaign: closed.CampaignName || lead.campaign, fields, notes }, notesFrom };
}

// Exact text first, then a single option that contains the wanted text.
function chooseOptionIndex(optionTexts, wanted) {
const w = normalise(wanted);
if (!w) return -1;
const exact = optionTexts.findIndex((t) => normalise(t) === w);
if (exact >= 0) return exact;
const loose = optionTexts.map((t, i) => (normalise(t).includes(w) ? i : -1)).filter((i) => i >= 0);
return loose.length === 1 ? loose[0] : -1;
}

function isPlaceholderOption(text) {
return /^\s*\(select\b/i.test(String(text || '')) || /^\s*$/.test(String(text || ''));
}

// "Has Part Exchange" -> true, "No Part Exchange" -> false, else null.
function wantedPartExchange(lead) {
if (typeof lead.fields.HasPartExchange === 'boolean') return lead.fields.HasPartExchange;
if (/^has part exchange$/i.test(lead.px.trim())) return true;
if (/^no part exchange$/i.test(lead.px.trim())) return false;
return null;
}

// ===================================================================
// SELF-TESTS
// ===================================================================

const selfTestFailures = [];
(function runSelfTests() {
const failures = [];
const check = (label, actual, expected) => {
if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
try {
const tsv = [NATIONAL_RESULT_HEADER.join('\t'),
['national', 'Mr. Sam Buyer', '70000002', '1400002', 'Re setup', 'Closed with no dealership', '2', 'Email Only Lead', '', '', 'Vauxhall - Offer Request - New', 'AB12 CDE'].join('\t'),
['national', 'Alex Sample', '70000001', '1400001', 'OK', 'Sent to Preston', '1', '', 'Preston', '', '', 'AB12CDF'].join('\t')
].join('\n');
const parsed = parseResultsTsv(tsv);
check('accepts the Lead Checker export', parsed.ok, true);
check('rejects another header', parseResultsTsv('Name\tPhone\nx\ty').ok, false);
const leads = resetLeadsFrom(parsed.results);
check('only Re setup leads are kept', leads.map((l) => [l.activityId, l.campaign, l.reg]), [['70000002', 'Vauxhall - Offer Request - New', 'AB12 CDE']]);
check('an older export saying Reset still counts', resetLeadsFrom([{ Verdict: 'Reset', Customer: 'Jo Example', ResetFields: JSON.stringify({ InitialNotes: 'A\nB' }) }]).map((l) => l.notes), ['A\nB']);
check('no notes in the export means none until the page supplies them', leads[0].notes, '');
check('summary counts', leadSummaryText([{ activityId: '1', name: 'A' }, { activityId: '2', name: 'B' }, { activityId: '3', name: 'C' }], { byActivity: { 1: 'Done', 2: 'Skipped' } }), '1 done, 1 skipped, 1 left');
check('title stripped', stripNameTitle('Mrs Jo Example'), 'Jo Example');
const rows = [
{ name: 'Sam Buyerson', vehicles: 'XY12ZZZ', magic: '9001' },
{ name: 'Sam Buyer', vehicles: 'AB12CDE Vauxhall Corsa', magic: '9002' },
{ name: 'sam  buyer', vehicles: 'AB12CDG', magic: '9003' }
];
check('two exact names are split by the reg', chooseSearchRow(rows, 'Mr. Sam Buyer', 'AB12 CDE'), { index: 1, reason: 'name and reg' });
check('two exact names and no reg is ambiguous', chooseSearchRow(rows, 'Sam Buyer', ''), { index: -1, reason: 'several' });
check('one exact name wins over a longer name', chooseSearchRow(rows.slice(0, 2), 'Sam Buyer', ''), { index: 1, reason: 'name' });
check('one customer on two rows is still one customer', chooseSearchRow([{ name: 'Jo Example', vehicles: 'A', magic: '7' }, { name: 'Jo Example', vehicles: 'B', magic: '7' }], 'Jo Example', ''), { index: 0, reason: 'name' });
check('reg alone finds the customer', chooseSearchRow([{ name: 'J Example', vehicles: 'AB12CDE', magic: '1' }], 'Jo Example', 'AB12CDE'), { index: 0, reason: 'reg' });
const salesRows = [
{ name: 'Sam Buyer', vehicles: '70000009SALES, 70000010SALES', magic: '1', campaign: 'Peugeot - Enquiry' },
{ name: 'Sam Buyer', vehicles: '70000002SALES, -', magic: '2', campaign: 'Vauxhall - Offer Request - Used' }
];
check('activity ID in the SALES references picks the customer', chooseSearchRow(salesRows, 'Sam Buyer', 'AB12CDE', { activityId: '70000002' }), { index: 1, reason: 'name and activity ID' });
check('campaign picks the customer when nothing else does', chooseSearchRow(salesRows, 'Sam Buyer', '', { campaign: 'Peugeot - Enquiry' }), { index: 0, reason: 'name and campaign' });
check('nothing matching', chooseSearchRow([{ name: 'Other Person', vehicles: '', magic: '1' }], 'Jo Example', 'AB12CDE'), { index: -1, reason: 'none' });
const options = ['(Select a Campaign)', 'Vauxhall - Offer Request - New', 'Vauxhall - Offer Request - Used', 'Peugeot - Enquiry'];
check('campaign exact match', chooseOptionIndex(options, 'vauxhall - offer request - new'), 1);
check('campaign single contains match', chooseOptionIndex(options, 'Peugeot'), 3);
check('campaign ambiguous contains match', chooseOptionIndex(options, 'Offer Request'), -1);
check('placeholder option spotted', [isPlaceholderOption('(Select a Lead Type)'), isPlaceholderOption('New')], [true, false]);
check('part exchange from fields first', wantedPartExchange({ fields: { HasPartExchange: true }, px: 'No Part Exchange' }), true);
check('part exchange from text', wantedPartExchange({ fields: {}, px: 'No Part Exchange' }), false);
check('part exchange unknown', wantedPartExchange({ fields: {}, px: '' }), null);
const history = [
{ ID: 77000001, CampaignName: 'Peugeot - PX Valuation - New', ManuallyCreated: false, CreatedDate: '2026-10-02T07:10:35+01:00' },
{ ID: 77000002, CampaignName: 'Peugeot - PX Valuation - New', ManuallyCreated: false, CreatedDate: '2026-10-03T18:45:32+01:00' },
{ ID: 77000003, CampaignName: 'Enquiry - Used', ManuallyCreated: false, CreatedDate: '2026-11-07T07:52:39+00:00' }
];
const pxLead = { activityId: '77000001', campaign: 'Peugeot - PX Valuation - New' };
check('closed leads on the same campaign are not an earlier reset', findEarlierReset(history, pxLead), null);
const fromPage = adoptClosedLead({ activityId: '77000003', campaign: 'Peugeot - PX Valuation - New', notes: '', fields: { LeadTypeID: 1 } },
{ ID: 77000003, CampaignName: 'Enquiry - Used', SalesLead: { LeadDetails: { LeadTypeID: 2, InitialNotes: 'Wants a call\nafter 5', MonthlyPayment: 199 } } }, '');
check('the closed lead on the page sets the campaign', fromPage.lead.campaign, 'Enquiry - Used');
check('and its dropdowns and notes', [fromPage.lead.fields.LeadTypeID, fromPage.lead.notes, fromPage.notesFrom, 'MonthlyPayment' in fromPage.lead.fields], [2, 'Wants a call\nafter 5', 'the closed lead', false]);
check('notes fall back to the Lead Checker', adoptClosedLead({ campaign: 'X', notes: 'Read on Live', fields: {} }, { CampaignName: 'X', SalesLead: { LeadDetails: {} } }, '').notesFrom, 'the Lead Checker');
check('no notes anywhere is reported', adoptClosedLead({ campaign: 'X', notes: '', fields: {} }, null, '').notesFrom, '');
const resetDone = { ID: 77000009, CampaignName: 'Peugeot - PX Valuation - New', ManuallyCreated: true, CreatedDate: '2026-11-09T16:00:00+00:00' };
check('a hand-made lead on the campaign after the closed one is', findEarlierReset(history.concat(resetDone), pxLead), resetDone);
check('a hand-made lead from before the closed one is not', findEarlierReset(history.concat({ ...resetDone, CreatedDate: '2026-09-01T09:00:00+01:00' }), pxLead), null);
} catch (error) {
failures.push('threw: ' + (error && error.message));
}
if (failures.length) {
selfTestFailures.push(...failures);
console.error('Lead Reset self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('Lead Reset self-test passed');
}
})();

// ===================================================================
// STORAGE
// ===================================================================

function readJson(key) {
try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (error) { return null; }
}
function writeJson(key, value) {
try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { return false; }
}

// SLA Manager saves the National results on the same site; a paste here
// is the fallback when they were not imported there.
function loadResults() {
const sources = [readJson(PASTED_RESULTS_KEY), readJson(NATIONAL_RESULTS_KEY)]
.filter((s) => s && Array.isArray(s.results) && isFresh(s.savedAt))
.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
return sources[0] || null;
}

function loadProgress() {
const p = readJson(PROGRESS_KEY);
return p && isFresh(p.savedAt) && p.byActivity ? p : { savedAt: new Date().toISOString(), byActivity: {} };
}
function saveProgress(progress) {
progress.savedAt = new Date().toISOString();
writeJson(PROGRESS_KEY, progress);
}

function loadSettings() {
const s = readJson(SETTINGS_KEY) || {};
return { reviewBeforePark: s.reviewBeforePark !== false };
}

// ===================================================================
// PAGE HELPERS
// ===================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs, intervalMs) {
const end = Date.now() + timeoutMs;
for (;;) {
let value = null;
try { value = fn(); } catch (error) { value = null; }
if (value) return value;
if (Date.now() > end) return null;
await sleep(intervalMs || 250);
}
}

function isVisible(el) {
return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
}

function visibleFirst(list) {
const all = Array.from(list || []);
return all.find(isVisible) || all[0] || null;
}

function byClick(root, prefix) {
return visibleFirst((root || document).querySelectorAll(`[ng-click^="${prefix}"]`));
}

function byText(root, selector, pattern) {
return Array.from((root || document).querySelectorAll(selector)).filter((el) => pattern.test((el.textContent || '').replace(/\s+/g, ' ').trim()));
}

function scopeOf(el) {
try { return window.angular ? window.angular.element(el).scope() : null; } catch (error) { return null; }
}

function setFieldValue(el, value) {
const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
setter.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
}

function optionTexts(select) {
return Array.from(select.options).map((o) => (o.textContent || '').replace(/\s+/g, ' ').trim());
}

function selectedText(select) {
const o = select.options[select.selectedIndex];
return o ? (o.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function chooseByIndex(select, index) {
select.selectedIndex = index;
select.dispatchEvent(new Event('change', { bubbles: true }));
}

function chooseByText(select, text) {
const index = chooseOptionIndex(optionTexts(select), text);
if (index < 0) return false;
chooseByIndex(select, index);
return normalise(selectedText(select)) === normalise(optionTexts(select)[index]);
}

// Sets an ng-model to a stored ID (the dropdowns show names but hold IDs).
// Rolls back when the ID is not one of the options.
function assignModel(el, value) {
const model = el.getAttribute('ng-model');
const scope = scopeOf(el);
if (!model || !scope || !window.angular) return false;
let parse;
try { parse = window.angular.element(document.body).injector().get('$parse')(model); } catch (error) { return false; }
const before = parse(scope);
const apply = (v) => {
parse.assign(scope, v);
if (typeof scope.$apply === 'function' && !(scope.$root && scope.$root.$$phase)) scope.$apply();
};
apply(value);
if (el.tagName === 'SELECT' && (el.value === '?' || /^\?/.test(el.value) || isPlaceholderOption(selectedText(el)))) {
apply(before);
return false;
}
return true;
}

function onIdlePage() {
return !!byClick(document, 'navToManualOutbound');
}

function onCallPage() {
return /#!\/call\//.test(location.hash) && !!document.querySelector('select[ng-model="selected.CallOutcome"]');
}

function openModal(test) {
const modals = Array.from(document.querySelectorAll('.modal')).filter((m) => isVisible(m) || m.classList.contains('in'));
return modals.reverse().find(test) || null;
}

function liveActivities() {
const seen = new Set();
const list = [];
document.querySelectorAll('[ng-repeat^="theActivity in liveActivities"]').forEach((el) => {
const scope = scopeOf(el);
const activity = scope && scope.theActivity;
if (!activity || seen.has(activity)) return;
seen.add(activity);
list.push({ activity, el });
});
return list;
}

function activityKey(activity) {
const lead = activity && activity.SalesLead;
return String((lead && (lead.ID || lead.ActivityGuid)) || activity.ID || '');
}

// ===================================================================
// THE STEPS
// ===================================================================

class NeedsYou extends Error {
constructor(message, options) {
super(message);
this.carryOnLabel = (options && options.carryOnLabel) || 'Done it, carry on';
}
}

async function ensureShiftStart(ctx) {
const statusButton = Array.from(document.querySelectorAll('button.dropdown-toggle')).find((b) => /\S/.test(b.textContent) && !/toggle dropdown/i.test(b.textContent));
if (statusButton && normalise(statusButton.textContent) === normalise(STATUS_WHILE_RESETTING)) return 'Status already Shift Start';
const item = byText(document, '[ng-click^="setMakeBusy"]', /^shift start$/i)[0];
if (!item) throw new NeedsYou('Could not find the Shift Start status. Set your status to Shift Start yourself.');
item.click();
const ok = await waitFor(() => !statusButton || normalise(statusButton.textContent) === normalise(STATUS_WHILE_RESETTING), 5000);
if (!ok) throw new NeedsYou('Your status did not change to Shift Start. Set it yourself.');
ctx.log('Status set to Shift Start');
return 'Status set to Shift Start';
}

async function openManualOutbound() {
if (isVisible(document.getElementById('btnSearchCustomers'))) return 'Already on the outbound search';
const button = byClick(document, 'navToManualOutbound');
if (!button) throw new NeedsYou('Go back to the idle screen (park or finish any open call first).', { carryOnLabel: 'Done, try again' });
button.click();
if (!await waitFor(() => isVisible(document.getElementById('btnSearchCustomers')), 15000)) {
throw new NeedsYou('The outbound call search did not open. Press New Manual Outbound Call yourself.');
}
return 'Opened New Manual Outbound Call';
}

function readSearchRows() {
const table = Array.from(document.querySelectorAll('table')).find((t) => /magic num/i.test(t.textContent || '') && t.querySelector('th'));
if (!table) return { headers: [], rows: [] };
const headers = Array.from(table.querySelectorAll('th')).map((th) => normalise(th.textContent));
const col = (name) => headers.indexOf(name);
const rows = Array.from(table.querySelectorAll('tbody tr')).filter((tr) => tr.children.length >= 4).map((tr) => {
const cells = Array.from(tr.children);
const text = (i) => (i >= 0 && cells[i] ? cells[i].textContent.replace(/\s+/g, ' ').trim() : '');
const confirmCell = cells[col('confirm')] || cells[cells.length - 1];
const select = tr.querySelector('button[ng-click^="eventHandler"]');
return {
tr,
name: text(col('name')),
vehicles: text(col('vehicles')),
magic: text(col('magic num')),
campaign: text(col('campaign')),
confirm: select || (confirmCell ? confirmCell.querySelector('button, a, input[type="button"], [ng-click]') : null)
};
});
return { headers, rows };
}

async function runSearch(term) {
const button = document.getElementById('btnSearchCustomers');
const scopeRoot = button.closest('form, .input-group, .row, div') || document;
const input = scopeRoot.querySelector('input[ng-model="searchText"]') || document.querySelector('input[ng-model="searchText"]') || scopeRoot.querySelector('input[type="text"], input[type="search"], input:not([type])');
if (!input) throw new NeedsYou('Could not find the customer search box.');
const before = readSearchRows().rows.map((r) => r.tr.textContent).join('|');
setFieldValue(input, term);
await sleep(100);
button.click();
const started = Date.now();
// New rows, or the same rows still there after a while (same answer).
await waitFor(() => {
const now = readSearchRows().rows.map((r) => r.tr.textContent).join('|');
return (now && now !== before) || Date.now() - started > 10000;
}, 30000, 400);
let last = '';
await waitFor(() => {
const now = readSearchRows().rows.map((r) => r.tr.textContent).join('|');
const stable = now === last;
last = now;
return stable;
}, 5000, 800);
return readSearchRows().rows;
}

async function searchAndOpenCustomer(ctx, lead) {
if (onCallPage()) return 'Customer already open';
if (!isVisible(document.getElementById('btnSearchCustomers'))) throw new NeedsYou('Open New Manual Outbound Call first.', { carryOnLabel: 'Done, try again' });
const terms = [stripNameTitle(lead.name), compactReg(lead.reg)].filter(Boolean);
let ambiguous = false;
for (const term of terms) {
const rows = await runSearch(term);
const choice = chooseSearchRow(rows, lead.name, lead.reg, { activityId: lead.activityId, campaign: lead.campaign });
if (choice.index >= 0) {
const row = rows[choice.index];
ctx.log(`Found the customer by ${choice.reason}`);
(row.confirm || row.tr).click();
if (!await waitFor(onCallPage, 20000)) throw new NeedsYou('The customer did not open. Press Select on the right customer yourself.');
return 'Customer opened';
}
if (choice.reason === 'several') ambiguous = true;
}
throw new NeedsYou(ambiguous
? `More than one customer is called ${lead.name}. Press Select on the right one yourself.`
: `No customer found for ${lead.name}${lead.reg ? ' or ' + lead.reg : ''}. Search and press Select yourself.`);
}

function closedLeadPageNotes(el) {
if (!el) return '';
const box = Array.from(el.querySelectorAll('textarea')).find((t) => /initial/i.test(t.getAttribute('ng-model') || '') && t.value.trim());
return box ? box.value : '';
}

async function checkNotAlreadyReset(ctx, lead) {
await sleep(500);
const entries = liveActivities();
const activities = entries.map(({ activity }) => activity);
const closed = entries.find(({ activity }) => String(activity.ID) === String(lead.activityId));
if (lead.activityId && activities.length && !closed && !ctx.allowOtherCustomer) {
ctx.allowOtherCustomer = true;
throw new NeedsYou(`The closed lead is not on this customer, so this may be the wrong ${lead.name}. Go back and pick the right customer, or carry on if this is them.`, { carryOnLabel: 'This is them, carry on' });
}
const adopted = adoptClosedLead(lead, closed && closed.activity, closedLeadPageNotes(closed && closed.el));
Object.assign(lead, adopted.lead);
ctx.notesFrom = adopted.notesFrom;
const earlier = findEarlierReset(activities, lead);
if (earlier && !ctx.allowExisting) {
ctx.allowExisting = true;
throw new NeedsYou(`This customer already has a ${lead.campaign} lead added by hand after the closed one, so it may already be set up again. Press Skip lead to leave it, or carry on to add another.`, { carryOnLabel: 'Add another lead' });
}
if (earlier) return 'Adding another lead as asked';
return closed ? `Closed ${lead.campaign} lead found on this customer, not set up again yet` : 'Closed lead not checked on this customer';
}

async function chooseUpdateOutcomes() {
const select = visibleFirst(document.querySelectorAll('select[ng-model="selected.CallOutcome"]'));
if (!select || !chooseByText(select, OUTCOME_UPDATE_ONLY)) throw new NeedsYou(`Choose "${OUTCOME_UPDATE_ONLY}" as the call outcome yourself.`);
if (!await waitFor(() => { const b = byClick(document, 'createNewSalesLead'); return b && isVisible(b) ? b : null; }, 5000)) {
throw new NeedsYou('The Add New Lead button did not appear. Choose the outcome again yourself.');
}
return 'Outcome set to Update Outcomes (No Call Made)';
}

async function addNewLead(ctx, lead) {
ctx.beforeKeys = new Set(liveActivities().map(({ activity }) => activityKey(activity)));
ctx.beforeObjects = new Set(liveActivities().map(({ activity }) => activity));
const add = byClick(document, 'createNewSalesLead');
if (!add) throw new NeedsYou('Press Add New Lead yourself, pick Regular Sales Lead and the campaign, then Save.');
add.click();
const modal = await waitFor(() => openModal((m) => !!m.querySelector('input[name="salesOptions"]')), 10000);
if (!modal) throw new NeedsYou('The Create Activity window did not open. Add the lead yourself and Save.');
const regular = modal.querySelector('input[name="salesOptions"][value="true"]');
if (regular && !regular.checked) regular.click();
const campaignSelect = await waitFor(() => {
const selects = Array.from(modal.querySelectorAll('select'));
const s = selects.find((x) => /campaign/i.test(x.getAttribute('ng-model') || '')) || selects.find((x) => x.options.length > 1);
return s && s.options.length > 1 ? s : null;
}, 10000);
if (!campaignSelect || !chooseByText(campaignSelect, lead.campaign)) {
throw new NeedsYou(`Pick the campaign "${lead.campaign}" in the window and press Save yourself.`);
}
await sleep(300);
const save = byClick(modal, 'ok(') || byText(modal, 'button', /^save$/i)[0];
if (!save) throw new NeedsYou('Press Save in the Create Activity window yourself.');
save.click();
if (!await waitFor(() => !document.body.contains(modal) || !isVisible(modal), 15000)) {
throw new NeedsYou('The Create Activity window did not close. Check it and press Save yourself.');
}
return `New ${lead.campaign} lead added`;
}

async function findNewLead(ctx, lead) {
const found = await waitFor(() => {
const fresh = liveActivities().filter(({ activity }) => !ctx.beforeObjects.has(activity) && !ctx.beforeKeys.has(activityKey(activity)));
const onCampaign = fresh.filter(({ activity }) => normalise(activity.CampaignName) === normalise(lead.campaign));
return (onCampaign.length ? onCampaign : fresh).slice(-1)[0] || null;
}, 15000);
if (!found) throw new NeedsYou('Could not find the new lead on the page. Fill it in yourself up to Manage Appointments.', { carryOnLabel: 'Done, go to parking' });
ctx.newLead = found;
// Bring its tab forward so it can be checked by eye.
const tab = Array.from(document.querySelectorAll('[ng-repeat^="tab in tabs"]')).pop();
const tabLink = tab && tab.querySelector('a');
if (tabLink && normalise(tabLink.textContent).includes(normalise(lead.campaign).slice(0, 12))) tabLink.click();
return 'New lead found';
}

// Konnect draws each lead's sections in a shared tab area, away from the
// lead's own block, so a lead's controls are found by the lead they belong
// to rather than by where they sit on the page.
function controlsOf(activity, selector) {
return Array.from(document.querySelectorAll(selector)).filter((el) => {
// Widgets with their own scope reach the lead through their parents.
for (let scope = scopeOf(el), depth = 0; scope && depth < 8; scope = scope.$parent, depth++) {
if (scope.theActivity === activity) return true;
}
return false;
});
}

// Opens the closed section around a control so the result can be seen.
function revealSection(el) {
const panel = el && el.closest('.panel');
if (!panel || panel.classList.contains('panel-open')) return;
const toggle = panel.querySelector('.accordion-toggle, a[ng-click="toggleOpen()"]');
if (toggle) toggle.click();
}

// The notes go into the call notes box (Internal Notes), never the lead's
// Initial notes box. Manage Appointments carries them onto the new lead, and the box
// is cleared afterwards.
function findCallNotesBox() {
const inSection = document.querySelector('#section-call-notes textarea, [id*="call-notes"] textarea');
if (inSection) return inSection;
return visibleFirst(Array.from(document.querySelectorAll('textarea')).filter((t) =>
/note/i.test(t.getAttribute('ng-model') || '') && !/initial/i.test(t.getAttribute('ng-model') || '')
&& !t.closest('[ng-repeat^="theActivity in liveActivities"]')));
}

async function fillNotes(ctx, lead) {
if (!String(lead.notes || '').trim()) {
throw new NeedsYou('No initial notes were found for this lead. Copy them from the closed lead into the call notes yourself.');
}
const box = findCallNotesBox();
if (!box) {
try { await navigator.clipboard.writeText(lead.notes); } catch (error) { /* shown below */ }
throw new NeedsYou('Could not find the call notes box. The initial notes are on your clipboard: paste them into Internal Notes.');
}
ctx.notesBox = box;
setFieldValue(box, lead.notes);
await sleep(200);
if (box.value !== lead.notes) {
try { await navigator.clipboard.writeText(lead.notes); } catch (error) { /* shown below */ }
throw new NeedsYou('The notes did not copy exactly. They are on your clipboard: paste them over what is in the call notes.');
}
return `Initial notes from ${ctx.notesFrom || 'the closed lead'} copied exactly into the call notes`;
}

async function clearCallNotes(ctx) {
const box = (ctx.notesBox && document.body.contains(ctx.notesBox)) ? ctx.notesBox : findCallNotesBox();
if (!box) throw new NeedsYou('Delete the notes from the call notes box yourself.');
if (box.value === '') return 'Call notes already empty';
setFieldValue(box, '');
await sleep(200);
if (box.value !== '') throw new NeedsYou('The call notes did not clear. Delete them yourself.');
return 'Call notes cleared';
}

const FIELD_LABELS = {
LeadTypeID: 'Lead type', ChannelBadgeID: 'Brand', SourceOfEnquiryID: 'Source', LeadRequestID: 'Lead request',
VehicleOfInterestPurchaseTypeID: 'VOI purchase type', VehicleOfInterestMake: 'VOI make', VehicleOfInterestModel: 'VOI model',
VehicleOfInterestFuelType: 'VOI fuel', VehicleOfInterestReg: 'VOI reg'
};
const fieldLabel = (key) => FIELD_LABELS[key] || key.replace(/ID$/, '');

async function fillLeadFields(ctx, lead) {
if (!ctx.newLead) return 'No new lead found, dropdowns left alone';
const activity = ctx.newLead.activity;
const missed = [];
const done = [];
const selects = controlsOf(activity, 'select[ng-model^="theActivity.SalesLead.LeadDetails."]');
selects.forEach(revealSection);
await sleep(400);
if (selects.length === 0) missed.push('Lead dropdowns (not found on the new lead)');
selects.forEach((select) => {
const key = select.getAttribute('ng-model').split('.').pop();
if (lead.fields[key] != null) {
if (assignModel(select, lead.fields[key])) done.push(fieldLabel(key));
else missed.push(fieldLabel(key));
} else if (key === 'LeadRequestID' && lead.fields.LeadRequestText) {
if (chooseByText(select, lead.fields.LeadRequestText)) done.push(fieldLabel(key));
else missed.push(fieldLabel(key));
}
});
['VehicleOfInterestMake', 'VehicleOfInterestModel', 'VehicleOfInterestFuelType', 'VehicleOfInterestReg'].forEach((key) => {
if (!lead.fields[key]) return;
const input = controlsOf(activity, `input[ng-model$="LeadDetails.${key}"]`)[0];
if (!input) { missed.push(fieldLabel(key)); return; }
setFieldValue(input, String(lead.fields[key]));
done.push(fieldLabel(key));
});
const px = wantedPartExchange(lead);
if (px != null) {
const toggle = visibleFirst(controlsOf(activity, '[ng-click^="onSwitch"]'));
if (!toggle) missed.push('Part exchange');
else {
const box = toggle.querySelector('input[type="checkbox"]');
const isOn = () => (box ? box.checked : !toggle.classList.contains('off'));
if (isOn() !== px) { toggle.click(); await sleep(300); }
if (isOn() === px) done.push('Part exchange'); else missed.push('Part exchange');
}
}
ctx.missedFields = missed;
return `Filled ${done.length ? done.join(', ') : 'nothing'}${missed.length ? '. Not filled: ' + missed.join(', ') : ''}`;
}

async function manageAppointments(ctx) {
const button = ctx.newLead ? visibleFirst(controlsOf(ctx.newLead.activity, '[ng-click^="manageSalesEventBookings"]')) : null;
if (!button) throw new NeedsYou('Press Manage Appointments on the new lead, then close the diary yourself.');
button.click();
const diary = await waitFor(() => openModal((m) => /manage appointments/i.test(m.textContent || '')), 15000);
if (!diary) throw new NeedsYou('The diary did not open. Press Manage Appointments, then close the diary yourself.');
await sleep(800);
const close = byText(diary, 'button', /^close$/i)[0] || byClick(diary, 'cancel()');
if (!close) throw new NeedsYou('Close the diary yourself.');
close.click();
if (!await waitFor(() => !document.body.contains(diary) || !isVisible(diary), 10000)) throw new NeedsYou('The diary did not close. Close it yourself.');
return 'Manage Appointments opened and closed';
}

async function reviewBeforePark(ctx) {
if (!ctx.settings.reviewBeforePark) return 'Review skipped (setting off)';
if (ctx.reviewed) return 'Checked';
ctx.reviewed = true;
const missed = ctx.missedFields && ctx.missedFields.length ? ` Check these by hand: ${ctx.missedFields.join(', ')}.` : '';
throw new NeedsYou(`Check the new lead.${missed} Carry on to clear the call outcome, set Shift Start and park the call.`, { carryOnLabel: 'Looks right, park it' });
}

async function parkCall() {
const outcome = visibleFirst(document.querySelectorAll('select[ng-model="selected.CallOutcome"]'));
if (!outcome || !chooseByText(outcome, OUTCOME_NONE)) throw new NeedsYou(`Set the call outcome back to "${OUTCOME_NONE}" and park the call yourself.`);
const next = visibleFirst(document.querySelectorAll('select[ng-model="selected.NextAgentStatus"]'));
if (next && !chooseByText(next, STATUS_WHILE_RESETTING)) throw new NeedsYou('Set the next status to Shift Start and park the call yourself.');
await sleep(300);
const park = byText(document, 'button[ng-click^="completeCall(true"]', /park it/i)[0];
if (!park) throw new NeedsYou('Press Park It yourself.');
park.click();
if (!await waitFor(onIdlePage, 30000)) throw new NeedsYou('The call did not park. Park it yourself.');
return 'Call parked';
}

const STEPS = [
{ label: 'Open New Manual Outbound Call', run: openManualOutbound },
{ label: 'Find the customer', run: searchAndOpenCustomer },
{ label: 'Check it is not already set up again', run: checkNotAlreadyReset },
{ label: 'Choose Update Outcomes', run: chooseUpdateOutcomes },
{ label: 'Add the new lead', run: addNewLead },
{ label: 'Find the new lead', run: findNewLead },
{ label: 'Match the dropdowns', run: fillLeadFields },
{ label: 'Copy the notes into the call notes', run: fillNotes },
{ label: 'Manage Appointments', run: manageAppointments },
{ label: 'Clear the call notes', run: clearCallNotes },
{ label: 'Check before parking', run: reviewBeforePark },
{ label: 'Clear the outcome and park', run: parkCall }
];

// ===================================================================
// RUNNER AND PANEL
// ===================================================================

const state = window._leadResetState || (window._leadResetState = {
running: false, paused: null, stopRequested: false, currentIndex: -1, stepIndex: 0, ctx: null, log: []
});
let resolvePause = null;

function leadsToDo() {
const source = loadResults();
return source ? resetLeadsFrom(source.results) : [];
}

function addLog(text) {
const time = new Date().toTimeString().slice(0, 5);
state.log.push(`${time} ${text}`);
if (state.log.length > 40) state.log.shift();
render();
}

function waitForUser(error) {
state.paused = { message: error.message, carryOnLabel: error.carryOnLabel };
render();
return new Promise((resolve) => { resolvePause = resolve; });
}

function answerPause(answer) {
if (!resolvePause) return;
const r = resolvePause;
resolvePause = null;
state.paused = null;
r(answer);
}

async function runAll() {
if (state.running) return;
const settings = loadSettings();
state.running = true;
state.stopRequested = false;
render();
try {
if (onIdlePage()) {
try { await ensureShiftStart({ log: addLog }); } catch (error) {
if (!(error instanceof NeedsYou)) throw error;
const answer = await waitForUser(error);
if (answer === 'stop') return;
}
}
const progress = loadProgress();
const leads = leadsToDo();
for (let i = 0; i < leads.length && !state.stopRequested; i++) {
const lead = leads[i];
if (progress.byActivity[lead.activityId]) continue;
state.currentIndex = i;
state.ctx = { log: addLog, settings };
addLog(`Started ${lead.name}`);
let outcome = 'Done';
for (state.stepIndex = 0; state.stepIndex < STEPS.length;) {
if (state.stopRequested) { outcome = null; break; }
const step = STEPS[state.stepIndex];
render();
try {
const message = await step.run(state.ctx, lead);
if (message) addLog(message);
state.stepIndex++;
} catch (error) {
const needsYou = error instanceof NeedsYou ? error : new NeedsYou(`${step.label} went wrong: ${error && error.message}. Do this step yourself.`);
addLog(step.run === reviewBeforePark ? 'Waiting for your check' : `Stopped at "${step.label}"`);
const answer = await waitForUser(needsYou);
if (answer === 'retry') continue;
if (answer === 'carry') { state.stepIndex++; continue; }
if (answer === 'skip') { outcome = 'Skipped'; break; }
outcome = null;
state.stopRequested = true;
break;
}
}
if (outcome) {
progress.byActivity[lead.activityId] = outcome;
saveProgress(progress);
addLog(`${outcome}: ${lead.name}`);
if (outcome === 'Skipped' && !onIdlePage()) {
const answer = await waitForUser(new NeedsYou('Lead skipped. Park or finish the open call yourself so the next lead can start.', { carryOnLabel: 'Done, next lead' }));
if (answer === 'stop') state.stopRequested = true;
}
}
}
if (!state.stopRequested) addLog('All Re setup leads are done');
} catch (error) {
addLog(`Stopped: ${error && error.message}`);
} finally {
state.running = false;
state.currentIndex = -1;
state.paused = null;
resolvePause = null;
render();
}
}

const COLORS = { navy: '#22365D', red: '#d70015', green: '#047857', amber: '#b45309', grey: '#475569', line: '#e2e8f0' };

function statusChip(text, color) {
return `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:${color}1a;color:${color};white-space:nowrap;">${escapeHtml(text)}</span>`;
}

function button(action, label, primary) {
const style = primary
? `background:${COLORS.navy};color:#fff;border:1px solid ${COLORS.navy};`
: `background:#fff;color:${COLORS.navy};border:1px solid ${COLORS.line};`;
return `<button type="button" data-action="${action}" style="${style}border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;margin:0 6px 6px 0;">${escapeHtml(label)}</button>`;
}

// "3 done, 1 skipped, 2 left" plus the names under each heading.
function leadSummaryText(leads, progress) {
const groups = { Done: [], Skipped: [], Left: [] };
leads.forEach((l) => { (groups[progress.byActivity[l.activityId]] || groups.Left).push(l.name); });
return `${groups.Done.length} done, ${groups.Skipped.length} skipped, ${groups.Left.length} left`;
}

function summaryForClipboard(leads, progress) {
const lines = [leadSummaryText(leads, progress)];
['Done', 'Skipped'].forEach((outcome) => {
const names = leads.filter((l) => progress.byActivity[l.activityId] === outcome).map((l) => `${l.name} (${l.campaign || 'campaign not read'})`);
if (names.length) lines.push(`${outcome}:`, ...names.map((n) => `- ${n}`));
});
const left = leads.filter((l) => !progress.byActivity[l.activityId]).map((l) => `- ${l.name}`);
if (left.length) lines.push('Left:', ...left);
return lines.join('\n');
}

function render() {
const panel = document.getElementById(PANEL_ID);
if (!panel) return;
const source = loadResults();
const leads = source ? resetLeadsFrom(source.results) : [];
const progress = loadProgress();
const settings = loadSettings();
const savedAt = source ? new Date(source.savedAt).toTimeString().slice(0, 5) : '';
const onDesktop = /agent-desktop/i.test(location.pathname || '');
const remaining = leads.filter((l) => !progress.byActivity[l.activityId]).length;

const banner = selfTestFailures.length
? `<div role="alert" style="margin-bottom:8px;padding:8px;border-radius:6px;background:#fef2f2;color:#991b1b;font-size:12px;"><strong>Self-test failed:</strong> please send this on. ${escapeHtml(selfTestFailures[0])}</div>` : '';
const where = onDesktop ? '' : `<div style="margin-bottom:8px;color:${COLORS.amber};">Open this on the agent desktop to set leads up again.</div>`;
const sourceLine = source
? `<div style="margin-bottom:8px;">${leads.length} lead${leads.length === 1 ? '' : 's'} to set up again from the National check at ${escapeHtml(savedAt)}. ${remaining} left.</div>`
: `<div style="margin-bottom:8px;">No National results found. Import them in SLA Manager, or copy them from the Lead Checker and press Paste results.</div>`;

const list = leads.map((l, i) => {
const done = progress.byActivity[l.activityId];
const current = state.running && i === state.currentIndex;
const chip = done ? statusChip(done, done === 'Done' ? COLORS.green : COLORS.grey)
: current ? statusChip(state.paused ? 'Needs you' : STEPS[state.stepIndex] ? STEPS[state.stepIndex].label : 'Working', state.paused ? COLORS.red : COLORS.navy)
: statusChip('Waiting', COLORS.grey);
return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid ${COLORS.line};">
<span style="overflow:hidden;"><strong>${escapeHtml(l.name)}</strong><br><span style="color:${COLORS.grey};font-size:11px;">${escapeHtml(l.campaign || 'No campaign read')}</span></span>${chip}</div>`;
}).join('');

const pause = state.paused
? `<div role="status" style="margin:8px 0;padding:8px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;">${escapeHtml(state.paused.message)}</div>
${button('carry', state.paused.carryOnLabel, true)}${button('retry', 'Try again')}${button('skip', 'Skip lead')}${button('stop', 'Stop')}`
: '';
const controls = state.running
? (state.paused ? '' : button('stop', 'Stop after this step'))
: `${remaining ? button('start', 'Start', true) : ''}${button('paste', 'Paste results')}${Object.keys(progress.byActivity).length || readJson(PASTED_RESULTS_KEY) ? button('clear', 'Clear') : ''}`;
const outcomes = leads.map((l) => progress.byActivity[l.activityId]).filter(Boolean);
const summary = !state.running && outcomes.length
? `<div style="margin:6px 0;padding:8px;border-radius:6px;background:#f8fafc;border:1px solid ${COLORS.line};">${leadSummaryText(leads, progress)}</div>${button('copySummary', 'Copy summary')}`
: '';
const log = state.log.length ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:${COLORS.grey};">Activity</summary><div style="font-size:11px;color:${COLORS.grey};max-height:140px;overflow:auto;">${state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div></details>` : '';

panel.querySelector('[data-body]').innerHTML = `${banner}${where}${sourceLine}
<div style="max-height:220px;overflow:auto;margin-bottom:8px;">${list}</div>
${pause}${summary}<div>${controls}</div>
<label style="display:flex;gap:6px;align-items:center;margin-top:4px;font-size:12px;"><input type="checkbox" data-action="review" ${settings.reviewBeforePark ? 'checked' : ''}> Stop before parking so I can check each lead</label>
${log}`;
}

async function pasteResults() {
let text = '';
try { text = await navigator.clipboard.readText(); } catch (error) {
addLog('Could not read the clipboard. Allow clipboard access and try again.');
return;
}
const parsed = parseResultsTsv(text);
if (!parsed.ok) { addLog(parsed.error); return; }
writeJson(PASTED_RESULTS_KEY, { savedAt: new Date().toISOString(), results: parsed.results });
addLog(`Pasted ${resetLeadsFrom(parsed.results).length} Re setup leads`);
}

function onPanelClick(event) {
const target = event.target.closest('[data-action]');
if (!target) return;
const action = target.getAttribute('data-action');
if (action === 'close') {
if (state.running) { addLog('Stop the run before closing'); return; }
document.getElementById(PANEL_ID).remove();
return;
}
if (action === 'review') {
writeJson(SETTINGS_KEY, { reviewBeforePark: target.checked });
if (state.ctx) state.ctx.settings = loadSettings();
return;
}
if (action === 'start') { runAll(); return; }
if (action === 'paste') { pasteResults(); return; }
if (action === 'copySummary') {
const source = loadResults();
const text = summaryForClipboard(source ? resetLeadsFrom(source.results) : [], loadProgress());
navigator.clipboard.writeText(text).then(() => addLog('Summary copied'), () => addLog('Could not copy the summary'));
return;
}
if (action === 'clear') {
// Wipes everything this tool keeps, so the next start is from scratch.
try { localStorage.removeItem(PROGRESS_KEY); localStorage.removeItem(PASTED_RESULTS_KEY); } catch (error) { /* ignore */ }
state.log = [];
render();
return;
}
if (action === 'stop' && !state.paused) { state.stopRequested = true; addLog('Stopping after this step'); return; }
answerPause(action);
}

function buildPanel() {
const existing = document.getElementById(PANEL_ID);
if (existing) { render(); return; }
if (!document.body || typeof document.body.appendChild !== 'function') return;
const panel = document.createElement('div');
panel.id = PANEL_ID;
panel.setAttribute('role', 'dialog');
panel.setAttribute('aria-label', 'Lead Re setup');
panel.style.cssText = 'position:fixed;top:70px;right:16px;width:340px;max-width:calc(100vw - 32px);z-index:2147483000;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.18);font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;';
panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:${COLORS.navy};color:#fff;border-radius:10px 10px 0 0;">
<strong>Lead Re setup</strong><button type="button" data-action="close" aria-label="Close" style="background:none;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1;">&times;</button></div>
<div data-body style="padding:10px 12px;"></div>`;
panel.addEventListener('click', onPanelClick);
document.body.appendChild(panel);
render();
}

buildPanel();
})();
