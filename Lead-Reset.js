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

// Shows when the running copy was published and notices a newer one going
// live. The date comes from GitHub once per open; later checks compare the
// published file's text, which has no rate limit to share between staff.
function startVersionWatch(fileName, onChange) {
const state = { publishedAt: null, newer: false };
if (typeof fetch !== 'function') return state;
const repo = 'OmariDC/WorkBookmarklets';
const fileText = () => fetch(`https://raw.githubusercontent.com/${repo}/main/${fileName}?_=${Date.now()}`).then((r) => (r.ok ? r.text() : null));
const fingerprint = (text) => { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return `${text.length}:${h}`; };
let baseline = null;
fetch(`https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(fileName)}&sha=main&per_page=1`)
.then((r) => (r.ok ? r.json() : null))
.then((list) => {
const date = list && list[0] && list[0].commit && list[0].commit.committer && list[0].commit.committer.date;
if (date) { state.publishedAt = new Date(date); onChange(state); }
}).catch(() => {});
fileText().then((text) => { if (text) baseline = fingerprint(text); }).catch(() => {});
state.timer = setInterval(() => {
if (state.newer || baseline == null) return;
fileText().then((text) => {
if (text && fingerprint(text) !== baseline) { state.newer = true; onChange(state); }
}).catch(() => {});
}, 20 * 60 * 1000);
return state;
}

function versionLineText(state) {
if (state.newer) return 'A newer version is out. Close this panel and click the bookmarklet again.';
if (!state.publishedAt) return '';
const d = state.publishedAt;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
return `Version of ${d.getDate()} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
const DESCRIPTION_SOURCE = 'the closed lead\'s description';
const CLOSED_FIELD_KEYS = /^(LeadType|ChannelBadge|SourceOfEnquiry|LeadRequest|VehicleOfInterest|HasPartExchange)/;
function adoptClosedLead(lead, closed, pageNotes) {
if (!closed) return { lead, notesFrom: lead.notes ? 'the Lead Checker' : '' };
const details = (closed.SalesLead && closed.SalesLead.LeadDetails) || {};
const fields = { ...lead.fields };
Object.keys(details).forEach((key) => {
const value = details[key];
if (CLOSED_FIELD_KEYS.test(key) && value != null && value !== '' && typeof value !== 'object') fields[key] = value;
});
// The box under the closed lead's "Initial Notes" label is what staff
// copy by hand; the stored fields are fallbacks.
const noteKey = Object.keys(details).find((k) => /initial.?notes?$/i.test(k) && typeof details[k] === 'string' && details[k].trim());
const description = closed.SalesLead && typeof closed.SalesLead.Description === 'string' ? closed.SalesLead.Description.trim() : '';
let notes = lead.notes;
let notesFrom = lead.notes ? 'the Lead Checker' : '';
if (pageNotes && pageNotes.trim()) { notes = pageNotes.trim(); notesFrom = 'the closed lead\'s Initial Notes box'; }
else if (noteKey) { notes = details[noteKey]; notesFrom = 'the closed lead'; }
else if (description) { notes = description; notesFrom = DESCRIPTION_SOURCE; }
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
check('the Initial Notes box wins', adoptClosedLead({ campaign: 'X', notes: '', fields: {} }, { CampaignName: 'X', SalesLead: { Description: 'Desc', LeadDetails: { InitialNotes: 'Key' } } }, ' Box notes ').lead.notes, 'Box notes');
check('the description is the last page fallback', adoptClosedLead({ campaign: 'X', notes: '', fields: {} }, { CampaignName: 'X', SalesLead: { Description: 'Desc', LeadDetails: {} } }, '').notesFrom, DESCRIPTION_SOURCE);
check('outcome to bring up Add New Lead', [chooseRevealOutcome(['(Select a Call Outcome)', 'Spoke to Customer', 'Update Outcomes (No Call Made)']), chooseRevealOutcome(['(Select a Call Outcome)', 'Booking Opportunity', 'Amend Booking', 'No Booking', 'Manual Reschedule', 'Do Not Contact'])], [2, 3]);
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

// Pure. Index of the outcome that brings up Add New Lead: Update Outcomes
// where offered (outbound), otherwise a harmless one (inbound offers
// Booking Opportunity, Amend Booking, No Booking...). -1 when none fits.
function chooseRevealOutcome(optionTexts) {
const prefer = [/^update outcomes/i, /^no booking$/i, /^spoke to customer$/i];
for (const re of prefer) {
const i = optionTexts.findIndex((t) => re.test(String(t).trim()));
if (i >= 0) return i;
}
return optionTexts.findIndex((t) => !isPlaceholderOption(t) && !/do not contact|reject|reschedule|amend/i.test(t));
}

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

// The box directly under the closed lead's "Initial Notes" label.
function closedLeadPageNotes(activity) {
if (!activity) return '';
const labels = Array.from(document.querySelectorAll('label, dt, th, strong, b, span, div, p, h4, h5, h6'))
.filter((el) => el.children.length <= 1 && /^initial notes:?$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim()) && belongsTo(el, activity));
for (const label of labels) {
const candidates = [label.nextElementSibling, label.parentElement && label.parentElement.nextElementSibling].filter(Boolean);
for (const c of candidates) {
const box = c.matches('textarea, input') ? c : c.querySelector('textarea, input[type="text"], input:not([type])');
const value = String(box ? box.value : c.textContent || '').trim();
if (value) return value;
}
}
return '';
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
const adopted = adoptClosedLead(lead, closed && closed.activity, closedLeadPageNotes(closed && closed.activity));
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
const index = select ? chooseRevealOutcome(optionTexts(select)) : -1;
if (index < 0) throw new NeedsYou(`Choose "${OUTCOME_UPDATE_ONLY}" (or any outcome) so Add New Lead appears.`);
chooseByIndex(select, index);
const chosen = optionTexts(select)[index];
if (!await waitFor(() => { const b = byClick(document, 'createNewSalesLead'); return b && isVisible(b) ? b : null; }, 5000)) {
throw new NeedsYou('The Add New Lead button did not appear. Choose the outcome again yourself.');
}
return `Outcome set to ${chosen} to bring up Add New Lead`;
}

// Staff set the outcome back as soon as the new lead exists.
async function resetOutcome() {
const select = visibleFirst(document.querySelectorAll('select[ng-model="selected.CallOutcome"]'));
if (!select || !chooseByText(select, OUTCOME_NONE)) throw new NeedsYou(`Set the call outcome back to "${OUTCOME_NONE}" yourself.`);
return 'Call outcome set back to (Select a Call Outcome)';
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
function belongsTo(el, activity) {
for (let scope = scopeOf(el), depth = 0; scope && depth < 8; scope = scope.$parent, depth++) {
if (scope.theActivity === activity) return true;
}
return false;
}

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
if (ctx.notesFrom === DESCRIPTION_SOURCE && !ctx.notesChecked) {
ctx.notesChecked = true;
throw new NeedsYou('The Initial Notes box was not found, so the notes came from the lead\'s description. Check the call notes match the closed lead\'s initial notes before carrying on.', { carryOnLabel: 'They match, carry on' });
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
{ label: 'Set the outcome back', run: resetOutcome },
{ label: 'Match the dropdowns', run: fillLeadFields },
{ label: 'Copy the notes into the call notes', run: fillNotes },
{ label: 'Manage Appointments', run: manageAppointments },
{ label: 'Clear the call notes', run: clearCallNotes },
{ label: 'Check before parking', run: reviewBeforePark },
{ label: 'Clear the outcome and park', run: parkCall }
];

// On the customer already open (an inbound, say): no search and no
// parking; it stops in the new lead.
const HERE_STEPS = [
{ label: 'Bring up Add New Lead', run: chooseUpdateOutcomes },
{ label: 'Add the new lead', run: addNewLead },
{ label: 'Find the new lead', run: findNewLead },
{ label: 'Set the outcome back', run: resetOutcome },
{ label: 'Match the dropdowns', run: fillLeadFields },
{ label: 'Copy the notes into the call notes', run: fillNotes },
{ label: 'Manage Appointments', run: manageAppointments },
{ label: 'Clear the call notes', run: clearCallNotes }
];

// ===================================================================
// RUNNER AND PANEL
// ===================================================================

const state = window._leadResetState || (window._leadResetState = {
running: false, paused: null, stopRequested: false, currentIndex: -1, stepIndex: 0, ctx: null, log: []
});
let resolvePause = null;
let versionState = null;

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

// Runs one lead through a list of steps. Returns 'Done', 'Skipped', or
// null when stopped.
async function runLeadSteps(lead, steps) {
state.steps = steps;
let outcome = 'Done';
for (state.stepIndex = 0; state.stepIndex < steps.length;) {
if (state.stopRequested) { outcome = null; break; }
const step = steps[state.stepIndex];
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
return outcome;
}

// Sets one of the open customer's leads up again and stops in the new lead.
async function runHere(activityId) {
if (state.running) return;
const entry = liveActivities().find(({ activity }) => String(activity.ID) === String(activityId));
if (!entry) { addLog('That lead is no longer on the page'); return; }
const salesLead = entry.activity.SalesLead || {};
const base = { activityId: String(entry.activity.ID), name: salesLead.CustomerName || 'This customer', reg: '', campaign: '', notes: '', voi: '', px: '', fields: {} };
const adopted = adoptClosedLead(base, entry.activity, closedLeadPageNotes(entry.activity));
const lead = adopted.lead;
state.running = true;
state.mode = 'here';
state.hereLead = lead;
state.stopRequested = false;
state.ctx = { log: addLog, settings: loadSettings(), notesFrom: adopted.notesFrom };
addLog(`Setting up ${lead.campaign} again on this customer`);
try {
const outcome = await runLeadSteps(lead, HERE_STEPS);
if (outcome === 'Done') addLog('Lead set up again. You are in the new lead.');
} catch (error) {
addLog(`Stopped: ${error && error.message}`);
} finally {
state.running = false;
state.mode = null;
state.paused = null;
resolvePause = null;
render();
}
}

async function runAll() {
if (state.running) return;
const settings = loadSettings();
state.running = true;
state.mode = 'batch';
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
const outcome = await runLeadSteps(lead, STEPS);
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

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel { position: fixed; top: 70px; right: 16px; width: 360px; max-width: calc(100vw - 32px); max-height: calc(100vh - 90px); display: flex; flex-direction: column; z-index: 2147483000;
  --bg: #f2f2f7; --surface: #ffffff; --text: #1c1c1e; --text-2: #334155; --muted: #64748b; --border: #e2e8f0; --accent: #C2CB42; --head: #1c1c1e;
  --green: #047857; --amber: #b45309; --red: #d70015;
  background: var(--bg); color: var(--text); border-radius: 16px; box-shadow: 0 18px 40px rgba(15, 23, 42, .22), 0 2px 6px rgba(15, 23, 42, .08); overflow: hidden;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--head); color: #fff; cursor: move; user-select: none; }
.head .title { font-weight: 700; font-size: 13.5px; flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.head .mini-status { font-weight: 500; color: #cbd5e1; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { background: transparent; border: 0; color: #cbd5e1; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 16px; }
.icon-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
.body { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.panel.minimised .body, .panel.minimised .foot { display: none; }
.foot { flex-shrink: 0; padding: 8px 12px; background: var(--surface); display: flex; justify-content: center; border-top: 1px solid var(--border); }
.stop-clear { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--red); background: transparent; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.stop-clear:hover { background: #fef2f2; }
.card { background: var(--surface); border-radius: 12px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 1px 1px rgba(0,0,0,.03); }
.muted { color: var(--muted); }
.small { font-size: 11.5px; }
.version { font-size: 11px; color: var(--muted); }
.version.newer { color: var(--red); font-weight: 700; font-size: 12px; }
.alert { border-radius: 10px; padding: 9px 11px; font-size: 12.5px; }
.alert.red { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.alert.amber { background: #fffbeb; color: #78350f; border: 1px solid #fde68a; }
.big-count { display: flex; align-items: baseline; gap: 8px; }
.big-count strong { font-size: 30px; line-height: 1; letter-spacing: -.5px; }
.btn { font: inherit; font-weight: 600; font-size: 12.5px; border-radius: 999px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.btn.primary { background: var(--accent); color: #1c1c1e; }
.btn.primary:hover { filter: brightness(.95); }
.btn.secondary { background: #e5e5ea; color: var(--text); }
.btn.secondary:hover { background: #d9d9de; }
.btn.ghost { background: transparent; color: var(--muted); border-color: var(--border); }
.btn.danger { background: transparent; color: var(--red); border-color: #fecaca; }
.btn.wide { width: 100%; padding: 10px 14px; font-size: 13.5px; }
.btn:focus-visible, .icon-btn:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; }
.toggle { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-2); cursor: pointer; }
.toggle input { width: 16px; height: 16px; accent-color: #1c1c1e; margin: 0; }
.progress-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--muted); }
.track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin: 6px 0 2px; }
.fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width .3s; }
.lead-name { font-size: 16px; font-weight: 700; margin-top: 8px; }
.lead-meta { font-size: 12px; color: var(--muted); margin-top: 1px; }
.steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.step { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); padding: 2px 0; }
.step .dot { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; border: 1.5px solid var(--border); background: var(--surface); }
.step.done { color: var(--text-2); }
.step.done .dot { background: var(--green); border-color: var(--green); color: #fff; }
.step.current { color: var(--text); font-weight: 600; }
.step.current .dot { border-color: var(--accent); background: #f7f9dd; }
.step.current .dot::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #8a9100; animation: pulse 1s ease-in-out infinite; }
.step.needs .dot { background: var(--amber); border-color: var(--amber); color: #fff; }
.step.needs { color: var(--amber); font-weight: 700; }
@keyframes pulse { 50% { opacity: .3; } }
.done-steps { background: none; box-shadow: none; border-radius: 0; }
.done-steps > summary { padding: 2px 0; font-weight: 500; font-size: 12.5px; justify-content: flex-start; cursor: pointer; }
.steps.inner { margin: 2px 0 4px 26px; }
.needs-card { border: 1.5px solid #fbbf24; background: #fffbeb; }
.needs-card h3 { margin: 0 0 4px; font-size: 13px; color: #92400e; }
.needs-card p { margin: 0 0 10px; color: #78350f; font-size: 12.5px; }
details { background: var(--surface); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
summary { cursor: pointer; padding: 10px 12px; font-weight: 600; font-size: 12.5px; display: flex; justify-content: space-between; align-items: center; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary .count { background: var(--bg); color: var(--muted); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
.list { padding: 0 12px 8px; max-height: 220px; overflow-y: auto; }
.list-row { display: flex; align-items: center; gap: 9px; padding: 7px 0; border-top: 1px solid var(--border); }
.avatar { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.list-row .who { flex: 1; min-width: 0; }
.list-row .who div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0 10px; }
.tile { background: var(--bg); border-radius: 10px; padding: 8px; text-align: center; }
.tile strong { display: block; font-size: 20px; }
.tile span { font-size: 11px; color: var(--muted); }
.log { padding: 0 12px 10px; font-size: 11px; color: var(--muted); max-height: 150px; overflow-y: auto; }
.log div { padding: 2px 0; }
.empty { text-align: center; padding: 8px 4px; }
.pick { display: flex; gap: 9px; align-items: flex-start; padding: 7px 0; border-top: 1px solid var(--border); cursor: pointer; font-size: 12.5px; }
.pick input { margin: 3px 0 0; accent-color: #1c1c1e; }
.empty strong { display: block; font-size: 14px; margin-bottom: 4px; }
`;

const CHIP_COLORS = { Done: '#047857', Skipped: '#64748b', Waiting: '#64748b', Working: '#5b6300', 'Needs you': '#b45309' };

function chip(text) {
const color = CHIP_COLORS[text] || '#64748b';
return `<span class="chip" style="background:${color}1a;color:${color};">${escapeHtml(text)}</span>`;
}

function initials(name) {
return stripNameTitle(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

function btn(action, label, kind, extraClass) {
return `<button type="button" class="btn ${kind || 'secondary'}${extraClass ? ' ' + extraClass : ''}" data-action="${action}">${escapeHtml(label)}</button>`;
}

let ui = null; // { host, root, panel, minimised }

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

function leadStatus(lead, index, progress) {
const done = progress.byActivity[lead.activityId];
if (done) return done;
if (state.running && index === state.currentIndex) return state.paused ? 'Needs you' : 'Working';
return 'Waiting';
}

// Finished steps fold into one line (expandable) so the current step and
// what comes next stay in view.
function renderSteps() {
const row = (step, i) => {
const cls = i < state.stepIndex ? 'done' : i === state.stepIndex ? (state.paused ? 'needs' : 'current') : '';
const mark = cls === 'done' ? '&#10003;' : cls === 'needs' ? '!' : '';
return `<li class="step ${cls}"><span class="dot" aria-hidden="true">${mark}</span>${escapeHtml(step.label)}</li>`;
};
const steps = state.steps || STEPS;
const done = steps.slice(0, state.stepIndex);
const rest = steps.slice(state.stepIndex).map((step, i) => row(step, i + state.stepIndex)).join('');
const folded = done.length
? `<li><details class="done-steps"${ui.stepsOpen ? ' open' : ''} data-section="steps"><summary class="step done"><span class="dot" aria-hidden="true">&#10003;</span>${done.length} step${done.length === 1 ? '' : 's'} done</summary><ol class="steps inner">${done.map(row).join('')}</ol></details></li>`
: '';
return `<ol class="steps">${folded}${rest}</ol>`;
}

function outcomeLabel(activity) {
const hierarchy = String(activity.OutcomeFullHierarchy || '').trim();
if (!hierarchy || hierarchy === 'None') return 'Open';
return hierarchy.split('->').pop().trim();
}

function shortDate(iso) {
const d = new Date(iso);
return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB');
}

// The lead whose tab is open: Konnect hides the other leads' sections, so
// it is the only lead with visible controls. null when that is unclear.
function leadInView() {
const entries = liveActivities();
if (entries.length === 1) return entries[0].activity;
const visible = entries.filter(({ activity }) => controlsOf(activity, 'select, textarea, button, input').some(isVisible));
return visible.length === 1 ? visible[0].activity : null;
}

// Ticked: the agent's own pick for this customer, else the lead in view.
function hereChoice() {
const activities = liveActivities().map(({ activity }) => activity);
const customerKey = activities.map((a) => a.ID).sort().join(',');
if (ui.hereCustomer !== customerKey) { ui.hereCustomer = customerKey; ui.herePicked = ''; }
if (ui.herePicked && activities.some((a) => String(a.ID) === ui.herePicked)) return ui.herePicked;
const inView = leadInView();
return inView ? String(inView.ID) : '';
}

function renderHereCard() {
const activities = liveActivities().map(({ activity }) => activity);
const chosen = hereChoice();
const inView = leadInView();
const rows = activities.map((a) => {
const outcome = outcomeLabel(a);
const meta = [shortDate(a.CreatedDate), a.SalesLead && a.SalesLead.DealerName, outcome === 'Open' ? 'Open' : `Closed: ${outcome}`].filter(Boolean).join(' · ');
const viewTag = inView && inView === a ? ' <span class="chip" style="background:#C2CB4233;color:#5b6300;">In view</span>' : '';
return `<label class="pick"><input type="radio" name="hereLead" value="${escapeHtml(String(a.ID))}" data-action="pickHere"${String(a.ID) === chosen ? ' checked' : ''}><span><strong>${escapeHtml(a.CampaignName || 'Lead')}</strong>${viewTag}<br><span class="muted small">${escapeHtml(meta)}</span></span></label>`;
}).join('');
return `<div class="card">
<strong>This customer</strong>
<div class="muted small" style="margin:2px 0 6px;">The lead in view is ticked; tick another to set that one up again instead. Only the ticked lead is copied, and it stops in the new lead.</div>
${rows}
<div style="margin-top:10px;">${chosen ? btn('here', 'Set up the ticked lead again', 'primary', 'wide') : '<div class="muted small">Tick the lead to set up again.</div>'}</div>
</div>`;
}

function render() {
if (!ui) return;
const source = loadResults();
const leads = source ? resetLeadsFrom(source.results) : [];
const progress = loadProgress();
const settings = loadSettings();
const savedAt = source ? new Date(source.savedAt).toTimeString().slice(0, 5) : '';
const onDesktop = /agent-desktop/i.test(location.pathname || '');
const doneCount = leads.filter((l) => progress.byActivity[l.activityId]).length;
const remaining = leads.length - doneCount;
if (!versionState) versionState = startVersionWatch('Lead-Reset.js', () => render());

const parts = [];
const versionText = versionLineText(versionState);
if (versionText) parts.push(`<div class="version${versionState.newer ? ' newer' : ''}" role="status">${escapeHtml(versionText)}</div>`);
if (selfTestFailures.length) parts.push(`<div class="alert red" role="alert"><strong>Self-test failed.</strong> Please send this on: ${escapeHtml(selfTestFailures[0])}</div>`);
if (!onDesktop) parts.push(`<div class="alert amber">Open this on the agent desktop to set leads up again.</div>`);

if (state.running && state.mode === 'here') {
const lead = state.hereLead;
parts.push(`<div class="card">
<div class="progress-top"><span>This customer</span><span>Stops in the new lead</span></div>
<div class="lead-name">${escapeHtml(lead.name)}</div><div class="lead-meta">${escapeHtml(lead.campaign || '')}</div>
${renderSteps()}
</div>`);
if (state.paused) {
parts.push(`<div class="card needs-card" role="alert">
<h3>Needs you</h3><p>${escapeHtml(state.paused.message)}</p>
<div class="row">${btn('carry', state.paused.carryOnLabel, 'primary')}${btn('retry', 'Try again')}${btn('stop', 'Stop', 'danger')}</div>
</div>`);
} else {
parts.push(`<div class="row">${btn('stop', 'Stop after this step', 'ghost')}</div>`);
}
} else if (state.running) {
const lead = leads[state.currentIndex];
const position = leads.slice(0, state.currentIndex + 1).length;
const percent = leads.length ? Math.round((100 * doneCount) / leads.length) : 0;
parts.push(`<div class="card">
<div class="progress-top"><span>Lead ${position} of ${leads.length}</span><span>${doneCount} done</span></div>
<div class="track"><div class="fill" style="width:${percent}%"></div></div>
${lead ? `<div class="lead-name">${escapeHtml(lead.name)}</div><div class="lead-meta">${escapeHtml([lead.campaign || 'Campaign read from the closed lead', lead.reg].filter(Boolean).join(' · '))}</div>` : '<div class="lead-name">Getting ready</div>'}
${lead ? renderSteps() : ''}
</div>`);
if (state.paused) {
parts.push(`<div class="card needs-card" role="alert">
<h3>Needs you</h3><p>${escapeHtml(state.paused.message)}</p>
<div class="row">${btn('carry', state.paused.carryOnLabel, 'primary')}${btn('retry', 'Try again')}${btn('skip', 'Skip lead')}${btn('stop', 'Stop', 'danger')}</div>
</div>`);
} else {
parts.push(`<div class="row">${btn('stop', 'Stop after this step', 'ghost')}</div>`);
}
} else if (onCallPage() && liveActivities().length) {
parts.push(renderHereCard());
}
if (!state.running && !source) {
// Nothing from the National check: the This customer card (if any) is enough.
if (!onCallPage()) parts.push(`<div class="card empty">
<strong>No National results yet</strong>
<div class="muted small">Import the National results in SLA Manager, or copy them from the Lead Checker and paste them here. On a customer, you can set one of their leads up again.</div>
<div class="row" style="justify-content:center;margin-top:10px;">${btn('paste', 'Paste results', 'primary')}</div>
</div>`);
else parts.push(`<div class="row">${btn('paste', 'Paste National results')}</div>`);
} else if (state.running) {
// Running cards are above.
} else if (leads.length === 0) {
parts.push(`<div class="card empty">
<strong>${source ? 'No leads need setting up again' : 'No National results yet'}</strong>
<div class="muted small">${source ? 'The last National check found nothing to set up again.' : 'Import the National results in SLA Manager, or copy them from the Lead Checker and paste them here.'}</div>
<div class="row" style="justify-content:center;margin-top:10px;">${btn('paste', 'Paste results', source ? 'secondary' : 'primary')}</div>
</div>`);
} else if (remaining === 0) {
parts.push(`<div class="card">
<strong>All done</strong>
<div class="tiles">${[['Done', 'Done'], ['Skipped', 'Skipped']].map(([key, label]) => `<div class="tile"><strong>${leads.filter((l) => progress.byActivity[l.activityId] === key).length}</strong><span>${label}</span></div>`).join('')}<div class="tile"><strong>0</strong><span>Left</span></div></div>
<div class="row">${btn('copySummary', 'Copy summary', 'primary')}${btn('clear', 'Clear')}</div>
</div>`);
} else {
parts.push(`<div class="card">
<div class="big-count"><strong>${remaining}</strong><span>lead${remaining === 1 ? '' : 's'} to set up again</span></div>
<div class="muted small" style="margin:4px 0 12px;">From the National check at ${escapeHtml(savedAt)}${doneCount ? ` &middot; ${doneCount} already done` : ''}</div>
${btn('start', doneCount ? `Continue (${remaining} left)` : 'Start', 'primary', 'wide')}
<div class="row" style="margin-top:8px;">${btn('paste', 'Paste results')}${doneCount || readJson(PASTED_RESULTS_KEY) ? btn('clear', 'Clear') : ''}${doneCount ? btn('copySummary', 'Copy summary') : ''}</div>
</div>`);
}

if (leads.length && state.mode !== 'here') parts.push(`<label class="toggle"><input type="checkbox" data-action="review" ${settings.reviewBeforePark ? 'checked' : ''}> Stop before parking so I can check each lead</label>`);

if (leads.length) {
const open = ui.listOpen ? ' open' : '';
parts.push(`<details data-section="list"${open}><summary>Leads <span class="count">${doneCount}/${leads.length}</span></summary><div class="list">${leads.map((l, i) => {
const status = leadStatus(l, i, progress);
const color = CHIP_COLORS[status] || '#64748b';
return `<div class="list-row"><span class="avatar" style="background:${color}1a;color:${color};">${escapeHtml(initials(l.name))}</span><div class="who"><div><strong>${escapeHtml(l.name)}</strong></div><div class="muted small">${escapeHtml(l.campaign || 'Campaign read from the closed lead')}</div></div>${chip(status)}</div>`;
}).join('')}</div></details>`);
}
if (state.log.length) {
const open = ui.logOpen ? ' open' : '';
parts.push(`<details data-section="log"${open}><summary>Activity <span class="count">${state.log.length}</span></summary><div class="log">${state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div></details>`);
}

ui.root.querySelector('.body').innerHTML = parts.join('');
const status = state.running
? (state.paused ? 'Needs you' : state.mode === 'here' ? 'This customer' : `${doneCount}/${leads.length} done`)
: (leads.length ? `${remaining} to do` : '');
ui.root.querySelector('.mini-status').textContent = ui.minimised && status ? status : '';
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

// Same as SLA Manager's Clear & Stop: ends any run after its current step,
// wipes everything this tool keeps and removes the panel, so the next
// click of the bookmarklet starts from scratch.
function clearAndStop() {
state.stopRequested = true;
if (resolvePause) answerPause('stop');
try { localStorage.removeItem(PROGRESS_KEY); localStorage.removeItem(PASTED_RESULTS_KEY); } catch (error) { /* ignore */ }
if (versionState && versionState.timer) clearInterval(versionState.timer);
if (ui) {
clearInterval(ui.pageTimer);
ui.host.remove();
ui = null;
}
window._leadResetState = null;
console.info('Lead Re setup stopped and cleared. Click the bookmarklet again to start fresh.');
}

function onPanelClick(event) {
const target = event.target.closest('[data-action]');
if (!target) return;
const action = target.getAttribute('data-action');
if (action === 'clearStop') { clearAndStop(); return; }
if (action === 'close') {
if (state.running) { addLog('Stop the run before closing'); return; }
ui.host.remove();
ui = null;
return;
}
if (action === 'minimise') {
ui.minimised = !ui.minimised;
ui.panel.classList.toggle('minimised', ui.minimised);
target.textContent = ui.minimised ? '+' : '–';
target.setAttribute('aria-label', ui.minimised ? 'Expand' : 'Minimise');
render();
return;
}
if (action === 'review') {
writeJson(SETTINGS_KEY, { reviewBeforePark: target.checked });
if (state.ctx) state.ctx.settings = loadSettings();
return;
}
if (action === 'start') { runAll(); return; }
if (action === 'pickHere') { ui.herePicked = target.value; render(); return; }
if (action === 'here') {
const chosen = hereChoice();
if (!chosen) { addLog('Tick the lead to set up again first'); return; }
runHere(chosen);
return;
}
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

// The panel lives in its own shadow root: Konnect's styles cannot reach
// it, and the steps' page searches cannot mistake its buttons for Konnect's.
function buildPanel() {
const existing = document.getElementById(PANEL_ID);
if (existing && ui) { ui.panel.classList.remove('minimised'); ui.minimised = false; render(); return; }
if (existing) existing.remove();
if (!document.body || typeof document.body.appendChild !== 'function') return;
const host = document.createElement('div');
host.id = PANEL_ID;
if (typeof host.attachShadow !== 'function') return;
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>${STYLE}</style>
<div class="panel" role="dialog" aria-label="Lead Re setup">
<div class="head"><div class="title"><span aria-hidden="true">&#8635;</span><span>Lead Re setup</span><span class="mini-status"></span></div>
<button type="button" class="icon-btn" data-action="minimise" aria-label="Minimise">&ndash;</button>
<button type="button" class="icon-btn" data-action="close" aria-label="Close">&times;</button></div>
<div class="body" aria-live="polite"></div>
<div class="foot"><button type="button" class="stop-clear" data-action="clearStop">Clear &amp; Stop</button></div>
</div>`;
document.body.appendChild(host);
const panel = root.querySelector('.panel');
const head = root.querySelector('.head');
if (!panel || !head) return;
ui = { host, root, panel, minimised: false, listOpen: false, logOpen: false, stepsOpen: false };
root.addEventListener('click', onPanelClick);
root.addEventListener('toggle', (event) => {
const section = event.target.getAttribute && event.target.getAttribute('data-section');
if (section === 'list') ui.listOpen = event.target.open;
if (section === 'log') ui.logOpen = event.target.open;
if (section === 'steps') ui.stepsOpen = event.target.open;
}, true);
// Redraw when the agent moves to another page or customer.
ui.pageTimer = setInterval(() => {
if (!ui || state.running) return;
const inView = onCallPage() ? leadInView() : null;
const signature = `${onCallPage()}|${liveActivities().map(({ activity }) => activity.ID).join(',')}|${inView ? inView.ID : ''}`;
if (signature !== ui.pageSignature) { ui.pageSignature = signature; render(); }
}, 2000);
// Drag by the header so the panel can be moved off Konnect's buttons.
head.addEventListener('mousedown', (event) => {
if (event.target.closest('button')) return;
const rect = panel.getBoundingClientRect();
const dx = event.clientX - rect.left;
const dy = event.clientY - rect.top;
const move = (e) => {
panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx))}px`;
panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
panel.style.right = 'auto';
};
const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
window.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
event.preventDefault();
});
render();
}

buildPanel();
})();
