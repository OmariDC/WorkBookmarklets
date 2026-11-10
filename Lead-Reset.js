(function() {
'use strict';

// Lead Re setup runs on the Konnect agent desktop. Re setup takes the
// leads the National check marked Re setup and, one at a time, adds a new
// lead with the same campaign, notes and dropdowns as the closed one, then
// parks the call; it never presses Finished. Post Closure sends the Lead
// Checker's "send back through" leads back from Parked Calls, and Email
// Only works the Email Only leads assigned in SLA Manager as they present;
// both press Finished. When a step cannot be done safely it stops and says
// what to do by hand.

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

// Report a problem: runs the Diagnostics capture (customer details masked)
// with this tool's recent activity added, ready to copy and send on.
async function reportProblem(tool, state, lines) {
window.__wbDiagnosticsExtra = { tool, state, log: lines };
try {
const response = await fetch(`https://raw.githubusercontent.com/OmariDC/WorkBookmarklets/main/Diagnostics.js?_=${Date.now()}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
Function(await response.text())();
} catch (error) {
alert(`Could not open the problem report: ${error && error.message}`);
}
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
// POST CLOSURE SEND BACK AND EMAIL ONLY (pure parts)
// ===================================================================

// Both runs read what SLA Manager saved on this site: the Lead Checker
// results it imported, and the Email Only leads it assigned today.
const LEAD_CHECKER_RESULTS_KEY = '_slaLeadCheckerImportState';
const EMAIL_ONLY_ASSIGNED_KEY = '_workToolsEmailOnlyAssigned';
const DESK_PROGRESS_KEY = '_leadResetDeskProgress';
// Per send back reason: the Konnect Notes shorthand typed in Post Closure
// Notes and the lead outcome under Customer Hub Team > No Opportunity.
const SEND_BACK_STEPS = {
'Actioned by dealership': { shorthand: 'cad', outcome: 'Catch All - Ongoing / Actioned by Dealer' },
'Email only': { shorthand: 'cah', outcome: 'Catch All - Email Only Lead' },
"In market won't commit": { shorthand: 'cah', outcome: 'Catch All - In Market Would Not Commit to appoint' }
};
const SEND_BACK_OUTCOME_PATH = ['Customer Hub Team', 'No Opportunity'];
const EMAIL_ONLY_OUTCOME_PATH = ['Customer Hub Team', 'Ongoing', 'Email Only Lead'];
// What each shorthand writes once Konnect Notes expands it.
const SHORTHAND_MARKERS = { cad: /actioned by dealer/i, cah: /customer hub will not contact/i, eo: /email only lead:/i };
const STATUS_AVAILABLE = 'Available';
// The desk can send its own Parked Calls to the Lead Checker, over the same
// link SLA Manager uses (this site is the one the Lead Checker answers).
const DESK_RESULTS_KEY = '_leadResetPostClosureResults';
const LIVE_ORIGIN = 'https://carbot.ai';
const LIVE_URL_KEY = '_slaKonnectLiveUrl';
const LIVE_URL_DEFAULT = 'https://carbot.ai/konnectlive/(v1.2.168)/home.html';
const LIVE_WINDOW_NAME = 'workToolsKonnectLiveDesk';
// The Lead Checker reads a customer search table with this header.
const PARKED_BATCH_HEADER = ['Name', 'Details', 'Vehicles', 'Magic Num', 'Dealer', 'Brand', 'Campaign', 'Best Number', 'Email', 'Address', 'Confirm'];

// Pure. Parked Calls rows as the Lead Checker's customer search batch.
function parkedBatchTsv(rows) {
const clean = (v) => String(v || '').replace(/[\t\r\n]+/g, ' ').trim();
return [PARKED_BATCH_HEADER.join('\t')].concat(rows.map((r) => PARKED_BATCH_HEADER.map((h) => (h === 'Confirm' || h === 'Details' ? '' : clean((r.cells || {})[h.toLowerCase()]))).join('\t'))).join('\n');
}

// Pure. The Lead Checker's results export, read by column name.
function parseLeadCheckerResults(tsv) {
const lines = String(tsv || '').split(/\r\n|\r|\n/).filter((l) => l.trim());
if (!lines.length) return [];
const header = lines[0].split('\t').map((h) => h.trim());
const at = (cells, name) => (header.indexOf(name) >= 0 ? String(cells[header.indexOf(name)] || '').trim() : '');
if (header.indexOf('Name') < 0 || header.indexOf('PostClosureAction') < 0) return [];
return lines.slice(1).map((line) => {
const cells = line.split('\t');
return { name: at(cells, 'Name'), phone: at(cells, 'Phone'), email: at(cells, 'Email'), source: at(cells, 'Source'), postClosureAction: at(cells, 'PostClosureAction'), postClosureReason: at(cells, 'PostClosureReason'), postClosureEvidence: at(cells, 'PostClosureEvidence') };
});
}

// Pure. One Post Closure result per customer, the newest source first.
function latestPostClosureResults(sources) {
const seen = new Set();
const out = [];
sources.forEach((source) => (source.results || []).forEach((r) => {
if (!r || !r.postClosureAction) return;
const key = personKey(r);
if (!key || seen.has(key)) return;
seen.add(key);
out.push(r);
}));
return out;
}

function digitsOf(value) {
return String(value || '').replace(/\D/g, '').slice(-10);
}

function personKey(person) {
return normalise(person.email) || digitsOf(person.phone) || normalise(stripNameTitle(person.name));
}

// Pure. The Lead Checker results that go back through, with what to do.
function sendBackLeadsFrom(results) {
return (results || [])
.filter((r) => r && normalise(r.postClosureAction) === 'send back through' && SEND_BACK_STEPS[r.postClosureReason])
.map((r) => ({ key: personKey(r), name: r.name || '', email: r.email || '', phone: r.phone || '', reason: r.postClosureReason, ...SEND_BACK_STEPS[r.postClosureReason] }));
}

// Pure. The entry for a person: by email, then phone, then a name only
// one entry has.
function matchPerson(list, person) {
const email = normalise(person.email);
if (email) {
const byEmail = list.find((x) => normalise(x.email) === email);
if (byEmail) return byEmail;
}
const phone = digitsOf(person.phone);
if (phone.length >= 10) {
const byPhone = list.find((x) => digitsOf(x.phone) === phone);
if (byPhone) return byPhone;
}
const name = normalise(stripNameTitle(person.name));
const named = name ? list.filter((x) => normalise(stripNameTitle(x.name)) === name) : [];
return named.length === 1 ? named[0] : null;
}

// Pure. The assigned Email Only lead a presented lead is, or null. Any
// email read from the lead must match; a name is only used when no email
// could be read at all.
function matchEmailOnly(list, presented) {
const emails = (presented.emails || []).map(normalise).filter(Boolean);
if (emails.length) return list.find((x) => emails.includes(normalise(x.email))) || null;
const name = normalise(stripNameTitle(presented.name));
const named = name ? list.filter((x) => normalise(stripNameTitle(x.name)) === name) : [];
return named.length === 1 ? named[0] : null;
}

// Pure. Text to add after a box's contents so a shorthand starts its own
// word (Konnect Notes only expands a word after a space or line break).
function shorthandInsertion(value, word) {
return (String(value || '') && !/\s$/.test(String(value)) ? '\n' : '') + word;
}

// Pure. Stay Available while more assigned Email Only leads are to come;
// Shift Start after the last, so nothing else presents.
function statusAfterEmailOnly(leftAfterThis) {
return leftAfterThis > 0 ? STATUS_AVAILABLE : STATUS_WHILE_RESETTING;
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
const results = [
{ name: 'Jo Example', email: 'jo@example.com', phone: '', postClosureAction: 'send back through', postClosureReason: 'Actioned by dealership' },
{ name: 'Sam Buyer', email: '', phone: '07700 900123', postClosureAction: 'send back through', postClosureReason: 'Email only' },
{ name: 'Alex Sample', email: 'alex@example.com', phone: '', postClosureAction: 'check: needs contact?', postClosureReason: '' }
];
const sendBack = sendBackLeadsFrom(results);
check('send back leads and their shorthand', sendBack.map((l) => [l.name, l.shorthand, l.outcome]), [['Jo Example', 'cad', 'Catch All - Ongoing / Actioned by Dealer'], ['Sam Buyer', 'cah', 'Catch All - Email Only Lead']]);
check('in market is CAH too', SEND_BACK_STEPS["In market won't commit"].shorthand, 'cah');
check('parked row found by email', matchPerson([{ name: 'J Example', email: 'JO@example.com' }, { name: 'Jo Example', email: 'other@example.com' }], sendBack[0]).name, 'J Example');
check('parked row found by phone', matchPerson([{ name: 'S B', phone: '07700900123' }], sendBack[1]).name, 'S B');
check('two rows with the name and nothing else is no match', matchPerson([{ name: 'Sam Buyer' }, { name: 'Sam Buyer' }], { name: 'Sam Buyer' }), null);
const assigned = [{ name: 'Dan Davis', email: 'dan@example.com' }, { name: 'Eve Evans', email: 'eve@example.com' }];
check('presented lead matched by email', matchEmailOnly(assigned, { name: 'Someone', emails: ['EVE@example.com'] }), assigned[1]);
check('a lead whose email is not assigned is not worked', matchEmailOnly(assigned, { name: 'Dan Davis', emails: ['dan.other@example.com'] }), null);
check('name only when no email was read', matchEmailOnly(assigned, { name: 'Mr Dan Davis', emails: [] }), assigned[0]);
check('shorthand starts a new line after text', [shorthandInsertion('', 'cad'), shorthandInsertion('Notes', 'cad'), shorthandInsertion('Notes\n', 'eo')], ['cad', '\ncad', 'eo']);
const batch = parkedBatchTsv([{ cells: { name: 'Jo Example', vehicles: 'AB12CDE', 'magic num': '9', dealer: 'Preston', brand: 'Peugeot', campaign: 'Enquiry - Used', 'best number': '07700900123', email: 'jo@example.com', address: 'AB1 2CD', confirm: 'Open', details: 'ViewHide' } }]).split('\n');
check('parked calls batch header', batch[0].split('\t')[0] === 'Name' && batch[0].includes('Magic Num') && batch[0].includes('Best Number'), true);
check('parked calls batch row', batch[1].split('\t'), ['Jo Example', '', 'AB12CDE', '9', 'Preston', 'Peugeot', 'Enquiry - Used', '07700900123', 'jo@example.com', 'AB1 2CD', '']);
const back = parseLeadCheckerResults(['Name\tPhone\tEmail\tSource\tTier\tPostClosureAction\tPostClosureReason\tPostClosureEvidence', 'Jo Example\t\tjo@example.com\tPost Closure Processing\t\tsend back through\tEmail only\tSent through'].join('\n'));
check('Lead Checker results read by column', [back[0].email, back[0].postClosureAction, back[0].postClosureReason], ['jo@example.com', 'send back through', 'Email only']);
check('newest Post Closure result per customer wins', latestPostClosureResults([{ results: [{ email: 'jo@example.com', postClosureAction: 'check: needs contact?' }] }, { results: [{ email: 'JO@example.com', postClosureAction: 'send back through', postClosureReason: 'Email only' }, { email: 'sam@example.com', postClosureAction: '' }] }]).map((r) => r.postClosureAction), ['check: needs contact?']);
check('Available until the last Email Only lead', [statusAfterEmailOnly(2), statusAfterEmailOnly(0)], ['Available', 'Shift Start']);
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
return { reviewBeforePark: s.reviewBeforePark !== false, reviewBeforeFinish: s.reviewBeforeFinish !== false, emailOnlyAgent: s.emailOnlyAgent || '' };
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
email: text(col('email')),
phone: text(col('best number')),
cells: headers.reduce((all, h, i) => { if (h) all[h] = text(i); return all; }, {}),
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

// The new lead's own Call Notes box (LeadDetails.Notes), the one Konnect
// Notes writes to; Manage Appointments takes the notes from there. Found
// by its model name so a folded Details section does not matter.
const CALL_NOTES_SELECTOR = 'textarea[ng-model$="LeadDetails.Notes"]';
function findCallNotesBox(ctx) {
if (ctx && ctx.newLead) {
const own = controlsOf(ctx.newLead.activity, CALL_NOTES_SELECTOR)[0];
if (own) return own;
}
const pane = document.querySelector('.tab-pane.active');
return (pane && pane.querySelector(CALL_NOTES_SELECTOR)) || null;
}

// Writes like typing, so Konnect's model and its undo both follow, then
// sets the model directly in case the events were not enough.
function writeBox(box, text) {
try {
box.focus({ preventScroll: true });
box.setSelectionRange(0, box.value.length);
if (text) document.execCommand('insertText', false, text);
else document.execCommand('delete', false);
} catch (error) { /* set below */ }
if (box.value !== text) setFieldValue(box, text);
box.dispatchEvent(new Event('input', { bubbles: true }));
box.dispatchEvent(new Event('change', { bubbles: true }));
try {
const model = window.angular && typeof window.angular.element(box).controller === 'function' ? window.angular.element(box).controller('ngModel') : null;
if (model && model.$viewValue !== text) { model.$setViewValue(text); model.$render(); }
} catch (error) { /* the events above still reach Konnect */ }
box.blur();
}

function modelValue(box) {
try {
const model = window.angular && typeof window.angular.element(box).controller === 'function' ? window.angular.element(box).controller('ngModel') : null;
return model ? model.$viewValue : box.value;
} catch (error) { return box.value; }
}

async function fillNotes(ctx, lead) {
if (!String(lead.notes || '').trim()) {
throw new NeedsYou('No initial notes were found for this lead. Copy them from the closed lead into the new lead\'s Call Notes yourself.');
}
const box = findCallNotesBox(ctx);
if (!box) {
try { await navigator.clipboard.writeText(lead.notes); } catch (error) { /* shown below */ }
throw new NeedsYou('Could not find the new lead\'s Call Notes box. The initial notes are on your clipboard: paste them into Call Notes.');
}
ctx.notesBox = box;
writeBox(box, lead.notes);
await sleep(300);
if (box.value !== lead.notes || modelValue(box) !== lead.notes) {
try { await navigator.clipboard.writeText(lead.notes); } catch (error) { /* shown below */ }
throw new NeedsYou('The notes did not copy exactly. They are on your clipboard: paste them over what is in Call Notes.');
}
if (ctx.notesFrom === DESCRIPTION_SOURCE && !ctx.notesChecked) {
ctx.notesChecked = true;
throw new NeedsYou('The Initial Notes box was not found, so the notes came from the lead\'s description. Check Call Notes matches the closed lead\'s initial notes before carrying on.', { carryOnLabel: 'They match, carry on' });
}
return `Initial notes from ${ctx.notesFrom || 'the closed lead'} copied exactly into Call Notes`;
}

async function clearCallNotes(ctx) {
const box = (ctx.notesBox && document.body.contains(ctx.notesBox)) ? ctx.notesBox : findCallNotesBox(ctx);
if (!box) throw new NeedsYou('Delete the notes from the new lead\'s Call Notes yourself.');
if (box.value === '' && !modelValue(box)) return 'Call Notes already empty';
writeBox(box, '');
await sleep(300);
if (box.value !== '' || modelValue(box)) throw new NeedsYou('Call Notes did not clear. Delete the notes yourself.');
return 'Call Notes cleared';
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

function openDiaries() {
return Array.from(document.querySelectorAll('.modal')).filter((m) => (isVisible(m) || m.classList.contains('in')) && /manage appointments/i.test(m.textContent || ''));
}

// The diary's own Close (or the cross). Its date picker has a hidden Close
// button of its own, so only visible cancel() buttons count.
async function closeDiaries() {
for (let attempt = 0; attempt < 3 && openDiaries().length; attempt++) {
const diary = openDiaries().pop();
const cancels = Array.from(diary.querySelectorAll('button[ng-click="cancel()"]')).filter(isVisible);
const close = cancels.find((b) => /^close$/i.test(b.textContent.trim())) || cancels[0];
if (close) close.click();
await waitFor(() => !document.body.contains(diary) || !isVisible(diary), 5000);
}
return openDiaries().length === 0;
}

async function manageAppointments(ctx) {
// Try again after a diary stayed open: close it rather than open another.
if (openDiaries().length) {
if (!await closeDiaries()) throw new NeedsYou('The diary did not close. Close it yourself.');
return 'Diary closed';
}
const button = ctx.newLead ? visibleFirst(controlsOf(ctx.newLead.activity, '[ng-click^="manageSalesEventBookings"]')) : null;
if (!button) throw new NeedsYou('Press Manage Appointments on the new lead, then close the diary yourself.');
button.click();
if (!await waitFor(() => openDiaries().length > 0, 15000)) throw new NeedsYou('The diary did not open. Press Manage Appointments, then close the diary yourself.');
await sleep(800);
if (!await closeDiaries()) throw new NeedsYou('The diary did not close. Close it yourself.');
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
{ label: 'Copy the notes into Call Notes', run: fillNotes },
{ label: 'Manage Appointments', run: manageAppointments },
{ label: 'Clear Call Notes', run: clearCallNotes },
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
{ label: 'Copy the notes into Call Notes', run: fillNotes },
{ label: 'Manage Appointments', run: manageAppointments },
{ label: 'Clear the call notes', run: clearCallNotes }
];

// ===================================================================
// POST CLOSURE SEND BACK AND EMAIL ONLY (page steps)
// ===================================================================

// The text a node holds itself, not its children's.
function ownText(el) {
return normalise(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
}

// The visible box nearest below a visible label, as Konnect Notes finds
// Call Notes and Post Closure Notes.
function findLabelledBox(labelText) {
const want = normalise(labelText);
const labels = Array.from(document.querySelectorAll('label,legend,dt,th,span,strong,b,p,div')).filter((el) => isVisible(el) && ownText(el) === want);
for (const label of labels) {
const top = label.getBoundingClientRect().top;
let container = label.parentElement;
for (let depth = 0; container && depth < 7; depth++, container = container.parentElement) {
const below = Array.from(container.querySelectorAll('textarea')).filter((t) => isVisible(t) && t.getBoundingClientRect().top >= top - 4);
if (below.length) return below.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
}
}
return null;
}

function needKonnectNotes() {
if (!(window.KonnectNotes && window.KonnectNotes.version)) {
throw new NeedsYou('Konnect Notes is not on this page, and it writes the notes. Click Work Tools once to load it, then press Try again.');
}
}

// Types a Konnect Notes shorthand at the end of a box and presses space,
// so Konnect Notes writes the full note exactly as when typed by hand.
// Puts the box back and returns false when Konnect Notes did not write
// the note (it takes the word but writes nothing when it cannot read the
// Initial Notes).
async function typeShorthand(box, word) {
const before = box.value;
const text = shorthandInsertion(before, word);
box.focus({ preventScroll: true });
box.setSelectionRange(before.length, before.length);
try { document.execCommand('insertText', false, text); } catch (error) { /* set below */ }
if (box.value !== before + text) setFieldValue(box, before + text);
box.setSelectionRange(box.value.length, box.value.length);
await sleep(200);
const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
box.dispatchEvent(space);
await sleep(500);
if (!space.defaultPrevented || !SHORTHAND_MARKERS[word].test(box.value)) {
if (box.value !== before) setFieldValue(box, before);
return false;
}
return true;
}

async function chooseCallOutcome(text) {
const select = visibleFirst(document.querySelectorAll('select[ng-model="selected.CallOutcome"]'));
if (!select || !chooseByText(select, text)) throw new NeedsYou(`Set the call outcome to "${text}" yourself.`);
await sleep(600);
return `Call outcome: ${text}`;
}

function outcomeLevelSelects(activity) {
const level = (el) => Number((el.getAttribute('ng-model').match(/(\d+)$/) || [])[1]) || 0;
return controlsOf(activity, 'select[ng-model^="theActivity.SelectedOutcomeLevel"]').filter(isVisible).sort((a, b) => level(a) - level(b));
}

// Chooses the lead outcome one level at a time; each level's options load
// after the one above is chosen.
async function setLeadOutcome(activity, path) {
const first = controlsOf(activity, 'select[ng-model^="theActivity.SelectedOutcomeLevel"]')[0];
if (first) revealSection(first);
for (let level = 0; level < path.length; level++) {
const select = await waitFor(() => {
const s = outcomeLevelSelects(activity)[level];
return s && chooseOptionIndex(optionTexts(s), path[level]) >= 0 ? s : null;
}, 8000);
if (!select) throw new NeedsYou(`Could not choose "${path[level]}". Set the lead outcome to ${path.join(' > ')} yourself.`);
if (normalise(selectedText(select)) !== normalise(path[level])) {
if (!chooseByText(select, path[level])) throw new NeedsYou(`Could not choose "${path[level]}". Set the lead outcome to ${path.join(' > ')} yourself.`);
await sleep(600);
}
}
const chosen = outcomeLevelSelects(activity).slice(0, path.length).map(selectedText);
if (chosen.map(normalise).join('|') !== path.map(normalise).join('|')) throw new NeedsYou(`The lead outcome did not stay as ${path.join(' > ')}. Set it yourself.`);
return `Lead outcome: ${path.join(' > ')}`;
}

function setNextStatus(status) {
const next = visibleFirst(document.querySelectorAll('select[ng-model="selected.NextAgentStatus"]'));
if (!next || !chooseByText(next, status)) throw new NeedsYou(`Set the next status (by Finished) to ${status} yourself.`);
return `Next status: ${status}`;
}

async function reviewBeforeFinish(ctx) {
if (!ctx.settings.reviewBeforeFinish) return 'Check skipped (setting off)';
if (ctx.reviewed) return 'Checked';
ctx.reviewed = true;
throw new NeedsYou(`Check the notes and the lead outcome. Carry on to press Finished.`, { carryOnLabel: 'Looks right, press Finished' });
}

async function pressFinished() {
if (!onCallPage()) return 'Already finished';
const button = byText(document, 'button[ng-click^="completeCall(false"]', /^finished$/i)[0];
if (!button) throw new NeedsYou('Press Finished yourself.');
button.click();
if (!await waitFor(() => !onCallPage(), 30000)) throw new NeedsYou('The call did not finish. Check the page for a message, then press Finished yourself.');
return 'Finished';
}

// The lead's tab to the front, so its notes boxes are the visible ones.
async function bringLeadIntoView(activity) {
if (leadInView() === activity) return true;
const links = Array.from(document.querySelectorAll('[ng-repeat^="tab in tabs"] a'));
for (const link of links) {
link.click();
await sleep(600);
if (leadInView() === activity) return true;
}
return false;
}

function onParkedPage() {
return /\/search\/parked/i.test(location.hash) && readSearchRows().headers.includes('best number');
}

async function goToParked() {
if (onParkedPage()) return 'On Parked Calls';
if (onCallPage()) throw new NeedsYou('A call is open. Finish or park it yourself, then carry on.', { carryOnLabel: 'Done, carry on' });
const nav = byText(document, '[ng-click]', /^parked( calls)?$/i).find(isVisible);
if (nav) nav.click(); else location.hash = '#!/search/parked';
if (!await waitFor(onParkedPage, 15000)) throw new NeedsYou('Parked Calls did not open. Open it yourself.', { carryOnLabel: 'Done, carry on' });
await sleep(800);
return 'Opened Parked Calls';
}

async function openParkedCustomer(ctx, lead) {
const rows = readSearchRows().rows;
const row = matchPerson(rows, lead);
if (!row) throw new NeedsYou(`${lead.name} is not in your Parked Calls. Skip them, or open them yourself and carry on.`, { carryOnLabel: 'Opened, carry on' });
(row.confirm || row.tr).click();
if (!await waitFor(onCallPage, 20000)) throw new NeedsYou(`${lead.name} did not open. Press Open on them yourself.`, { carryOnLabel: 'Opened, carry on' });
await sleep(1000);
return `Opened ${lead.name}`;
}

function isOpenLead(activity) {
return outcomeLabel(activity) === 'Open';
}

async function findPostClosureLead(ctx, lead) {
const found = await waitFor(() => {
const list = liveActivities().map(({ activity }) => activity)
.filter((a) => /post closure processing/i.test(String((a.SalesLead && a.SalesLead.SourceName) || '')) && isOpenLead(a));
return list.length ? list : null;
}, 8000);
if (!found) throw new NeedsYou('No open Post Closure lead on this customer. Skip them, or do this one yourself.');
if (found.length > 1) throw new NeedsYou('This customer has more than one open Post Closure lead. Do this one yourself, or skip them.');
const activity = found[0];
const email = normalise(activity.SalesLead && activity.SalesLead.EmailAddress);
if (lead.email && email && email !== normalise(lead.email) && !ctx.allowOtherEmail) {
ctx.allowOtherEmail = true;
throw new NeedsYou(`This customer's email is not the one the Lead Checker checked, so this may be the wrong ${lead.name}. Skip them, or carry on if this is them.`, { carryOnLabel: 'This is them, carry on' });
}
ctx.activity = activity;
if (!await bringLeadIntoView(activity)) throw new NeedsYou('Open the Post Closure lead\'s tab yourself, then carry on.', { carryOnLabel: 'Done, carry on' });
return 'Post Closure lead found';
}

async function writePostClosureNote(ctx, lead) {
needKonnectNotes();
const box = findLabelledBox('post closure notes');
if (!box) throw new NeedsYou(`Could not find Post Closure Notes. Type ${lead.shorthand} there and press space yourself.`);
if (SHORTHAND_MARKERS[lead.shorthand].test(box.value)) return `${lead.shorthand.toUpperCase()} note already in Post Closure Notes`;
if (!await typeShorthand(box, lead.shorthand) || !SHORTHAND_MARKERS[lead.shorthand].test(box.value)) {
throw new NeedsYou(`Konnect Notes did not write the note. Type ${lead.shorthand} in Post Closure Notes and press space yourself.`);
}
return `${lead.shorthand.toUpperCase()} written in Post Closure Notes`;
}

const SEND_BACK_RUN = [
{ label: 'Go to Parked Calls', run: goToParked },
{ label: 'Open the customer', run: openParkedCustomer },
{ label: 'Find the Post Closure lead', run: findPostClosureLead },
{ label: 'Write CAD or CAH in Post Closure Notes', run: writePostClosureNote },
{ label: 'Call outcome: Update Outcomes', run: () => chooseCallOutcome(OUTCOME_UPDATE_ONLY) },
{ label: 'Lead outcome: Customer Hub Team > No Opportunity > Catch All', run: (ctx, lead) => setLeadOutcome(ctx.activity, SEND_BACK_OUTCOME_PATH.concat(lead.outcome)) },
{ label: 'Next status: Shift Start', run: () => setNextStatus(STATUS_WHILE_RESETTING) },
{ label: 'Check before Finished', run: reviewBeforeFinish },
{ label: 'Press Finished', run: pressFinished }
];

function onPresentPage() {
return /present-outbound-call/i.test(location.hash) && !!byClick(document, 'rejectCall');
}

// Who the presented lead is, from the page's own data: every email on the
// call and the customer's name.
function presentedPerson() {
let scope = scopeOf(byClick(document, 'rejectCall'));
let call = null;
for (let depth = 0; scope && depth < 12; depth++, scope = scope.$parent) {
if (scope.Call) { call = scope.Call; break; }
}
const emails = new Set();
let name = '';
const walk = (value, depth) => {
if (!value || depth > 5) return;
if (typeof value === 'string') { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) emails.add(value.trim()); return; }
if (typeof value !== 'object') return;
if (Array.isArray(value)) { value.slice(0, 20).forEach((v) => walk(v, depth + 1)); return; }
if (!name && typeof value.CustomerName === 'string') name = value.CustomerName;
if (!name && typeof value.Forename === 'string') name = `${value.Forename} ${value.Surname || ''}`;
Object.keys(value).filter((k) => !/^\$/.test(k)).slice(0, 80).forEach((k) => walk(value[k], depth + 1));
};
walk(call, 0);
// The page's own text as well, in case the data sits elsewhere. Only an
// assigned lead's email can match, so other emails on the page do no harm.
const main = document.querySelector('[ng-view], .main-content, main') || document.body;
(String(main.innerText || '').match(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi) || []).forEach((e) => emails.add(e));
return { name: name.trim(), emails: Array.from(emails) };
}

async function ensureAvailable() {
if (onPresentPage() || onCallPage()) return 'A lead is already open';
const statusButton = Array.from(document.querySelectorAll('button.dropdown-toggle')).find((b) => /\S/.test(b.textContent) && !/toggle dropdown/i.test(b.textContent));
if (statusButton && normalise(statusButton.textContent) === normalise(STATUS_AVAILABLE)) return 'Status already Available';
const item = byText(document, '[ng-click^="setMakeBusy"], [ng-click^="setAvailable"], .dropdown-menu [ng-click]', /^available$/i)[0];
if (!item) throw new NeedsYou('Set your status to Available yourself so your Email Only leads present.', { carryOnLabel: 'Done, wait for leads' });
item.click();
await sleep(1000);
return 'Status set to Available';
}

async function rejectPresented() {
if (onCallPage()) return 'Lead already open';
const button = byClick(document, 'rejectCall');
if (!button) throw new NeedsYou('Press Reject yourself so the lead opens without dialling.', { carryOnLabel: 'Done, carry on' });
button.click();
if (!await waitFor(onCallPage, 20000)) throw new NeedsYou('The lead did not open after Reject. Open it yourself.', { carryOnLabel: 'Done, carry on' });
await sleep(1000);
return 'Rejected, so the lead opened without dialling';
}

async function findEmailOnlyLead(ctx, lead) {
const open = liveActivities().map(({ activity }) => activity).filter(isOpenLead);
const byEmail = open.filter((a) => normalise(a.SalesLead && a.SalesLead.EmailAddress) === normalise(lead.email));
const activity = byEmail.length === 1 ? byEmail[0] : open.length === 1 ? open[0] : null;
if (!activity) throw new NeedsYou('Could not tell which lead is the Email Only one. Do this one yourself, or skip it.');
ctx.activity = activity;
if (!await bringLeadIntoView(activity)) throw new NeedsYou('Open the Email Only lead\'s tab yourself, then carry on.', { carryOnLabel: 'Done, carry on' });
return 'Email Only lead found';
}

async function writeEmailOnlyNote(ctx) {
needKonnectNotes();
const box = visibleFirst(controlsOf(ctx.activity, CALL_NOTES_SELECTOR).filter(isVisible)) || findLabelledBox('call notes');
if (!box) throw new NeedsYou('Could not find Call Notes. Type eo there and press space yourself.');
if (SHORTHAND_MARKERS.eo.test(box.value)) return 'EO note already in Call Notes';
if (!await typeShorthand(box, 'eo') || !SHORTHAND_MARKERS.eo.test(box.value)) {
throw new NeedsYou('Konnect Notes did not write the note. Type eo in Call Notes and press space yourself.');
}
if (!/@/.test(box.value.split(/\n/).filter((l) => SHORTHAND_MARKERS.eo.test(l)).pop() || '')) {
throw new NeedsYou('The EO note has no email address in it. Add the email after "EMAIL ONLY LEAD:" yourself.');
}
return 'EO written in Call Notes';
}

const EMAIL_ONLY_RUN = [
{ label: 'Press Reject (opens it without dialling)', run: rejectPresented },
{ label: 'Call outcome back to (Select a Call Outcome)', run: () => chooseCallOutcome(OUTCOME_NONE) },
{ label: 'Find the Email Only lead', run: findEmailOnlyLead },
{ label: 'Call outcome: Update Outcomes', run: () => chooseCallOutcome(OUTCOME_UPDATE_ONLY) },
{ label: 'Write EO in Call Notes', run: writeEmailOnlyNote },
{ label: 'Lead outcome: Customer Hub Team > Ongoing > Email Only Lead', run: (ctx) => setLeadOutcome(ctx.activity, EMAIL_ONLY_OUTCOME_PATH) },
{ label: 'Next status', run: (ctx) => setNextStatus(statusAfterEmailOnly(ctx.leftAfterThis)) },
{ label: 'Check before Finished', run: reviewBeforeFinish },
{ label: 'Press Finished', run: pressFinished }
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

// ===================================================================
// POST CLOSURE SEND BACK AND EMAIL ONLY (runs)
// ===================================================================

// Results the desk fetched itself and those SLA Manager imported, the
// newest per customer.
function postClosureResults() {
const sources = [readJson(DESK_RESULTS_KEY), readJson(LEAD_CHECKER_RESULTS_KEY)]
.filter((s) => s && isFresh(s.savedAt) && Array.isArray(s.results))
.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
return latestPostClosureResults(sources);
}

function sendBackLeads() {
return sendBackLeadsFrom(postClosureResults());
}

// The Lead Checker link from this desk: the Konnect Live tab it opened and
// any batch waiting for that tab's Lead Checker to start.
const liveLink = window.__leadResetLiveLink || (window.__leadResetLiveLink = { win: null, ready: false, pending: null, status: '' });

function liveUrl() {
let saved = '';
try { saved = localStorage.getItem(LIVE_URL_KEY) || ''; } catch (error) { saved = ''; }
const base = /^https:\/\/carbot\.ai\/konnectlive\//i.test(saved) ? saved : LIVE_URL_DEFAULT;
return `${base}#/search?redirectRoute=%2Fsearch`;
}

// Opens Konnect Live straight from the click (a pop up opened later is
// blocked), then sends the Parked Calls once its Lead Checker is ready.
function checkParkedOnLive() {
let win = liveLink.win && !liveLink.win.closed ? liveLink.win : null;
if (win) { try { win.focus(); } catch (error) { /* still usable */ } }
else {
win = window.open(liveUrl(), LIVE_WINDOW_NAME);
if (!win) { addLog('Allow pop ups for this site, then try again'); return; }
liveLink.win = win;
liveLink.ready = false;
}
(async () => {
if (!onParkedPage()) {
try { await goToParked(); } catch (error) { addLog(error.message); return; }
}
const rows = readSearchRows().rows;
if (!rows.length) { addLog('No parked calls to check'); return; }
liveLink.pending = { type: 'workTools:batch', kind: 'leads', tsv: parkedBatchTsv(rows) };
liveLink.status = `${rows.length} parked call${rows.length === 1 ? '' : 's'} waiting for the Lead Checker`;
if (liveLink.ready) win.postMessage(liveLink.pending, LIVE_ORIGIN);
addLog(liveLink.ready ? 'Parked Calls sent to the Lead Checker' : 'Konnect Live is opening. Click Work Tools there to start the Lead Checker; the results come back here.');
render();
})();
}

function onLiveMessage(event) {
if (event.origin !== LIVE_ORIGIN || (liveLink.win && event.source !== liveLink.win)) return;
const data = event.data;
if (!data || typeof data.type !== 'string' || !data.type.startsWith('workTools:')) return;
if (data.type === 'workTools:ready') {
liveLink.ready = true;
liveLink.win = event.source;
if (typeof data.url === 'string' && /^https:\/\/carbot\.ai\/konnectlive\/[^#?]*$/i.test(data.url)) {
try { localStorage.setItem(LIVE_URL_KEY, data.url); } catch (error) { /* the default still works */ }
}
if (liveLink.pending) event.source.postMessage(liveLink.pending, LIVE_ORIGIN);
} else if (data.type === 'workTools:received') {
liveLink.pending = null;
liveLink.status = `The Lead Checker is checking ${data.rows || 0} parked call${data.rows === 1 ? '' : 's'}`;
addLog(liveLink.status);
} else if (data.type === 'workTools:busy') {
addLog('The Lead Checker is still running a batch. Try again when it has finished.');
} else if (data.type === 'workTools:results' && data.kind === 'leads' && typeof data.tsv === 'string') {
const results = parseLeadCheckerResults(data.tsv);
writeJson(DESK_RESULTS_KEY, { savedAt: new Date().toISOString(), results });
liveLink.status = data.partial ? `Lead Checker: ${data.done} of ${data.total} checked` : `Lead Checker done: ${results.length} checked`;
if (!data.partial) addLog(liveLink.status);
if (!state.running) render();
}
}

function emailOnlyAgents() {
const saved = readJson(EMAIL_ONLY_ASSIGNED_KEY);
const leads = saved && isFresh(saved.savedAt) && Array.isArray(saved.leads) ? saved.leads : [];
return Array.from(new Set(leads.map((l) => l.agent).filter(Boolean)));
}

// Only the chosen agent's leads, as those are the ones that present here.
function emailOnlyLeads() {
const saved = readJson(EMAIL_ONLY_ASSIGNED_KEY);
const leads = saved && isFresh(saved.savedAt) && Array.isArray(saved.leads) ? saved.leads : [];
const agents = emailOnlyAgents();
const agent = agents.includes(loadSettings().emailOnlyAgent) ? loadSettings().emailOnlyAgent : agents[0];
return leads.filter((l) => !agent || l.agent === agent).map((l) => ({ ...l, key: normalise(l.email) }));
}

function loadDeskProgress() {
const p = readJson(DESK_PROGRESS_KEY);
return p && isFresh(p.savedAt) ? { savedAt: p.savedAt, pc: p.pc || {}, eo: p.eo || {} } : { savedAt: new Date().toISOString(), pc: {}, eo: {} };
}
function saveDeskProgress(progress) {
progress.savedAt = new Date().toISOString();
writeJson(DESK_PROGRESS_KEY, progress);
}

function startDeskRun(mode) {
state.running = true;
state.mode = mode;
state.stopRequested = false;
state.deskLead = null;
state.deskCount = { done: 0, total: 0 };
render();
}

function endDeskRun() {
state.running = false;
state.mode = null;
state.deskLead = null;
state.paused = null;
resolvePause = null;
render();
}

// Asks the agent and returns true to carry on, false to stop.
async function askToCarryOn(message, carryOnLabel) {
const answer = await waitForUser(new NeedsYou(message, { carryOnLabel }));
if (answer === 'stop') { state.stopRequested = true; return false; }
return true;
}

async function runSendBack() {
if (state.running) return;
startDeskRun('pc');
try {
const settings = loadSettings();
const progress = loadDeskProgress();
for (;;) {
try { addLog(await goToParked()); break; } catch (error) {
if (!(error instanceof NeedsYou) || !await askToCarryOn(error.message, error.carryOnLabel)) return;
}
}
const parked = readSearchRows().rows;
const all = sendBackLeads().filter((l) => !progress.pc[l.key]);
const todo = all.filter((l) => matchPerson(parked, l));
if (all.length > todo.length) addLog(`${all.length - todo.length} not in your Parked Calls, left alone`);
state.deskCount = { done: 0, total: todo.length };
for (const lead of todo) {
if (state.stopRequested) break;
state.deskLead = lead;
state.ctx = { log: addLog, settings };
addLog(`Started ${lead.name} (${lead.shorthand.toUpperCase()})`);
const outcome = await runLeadSteps(lead, SEND_BACK_RUN);
if (!outcome) break;
progress.pc[lead.key] = outcome;
saveDeskProgress(progress);
state.deskCount.done++;
addLog(`${outcome}: ${lead.name}`);
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn('Skipped. Park or finish the open call yourself so the next one can start.', 'Done, next one')) break;
}
if (!state.stopRequested) addLog('All Post Closure send backs are done');
} catch (error) {
addLog(`Stopped: ${error && error.message}`);
} finally {
endDeskRun();
}
}

// Waits for the next lead to present, as long as the agent likes.
async function waitForPresentedLead() {
for (;;) {
const presented = await waitFor(() => state.stopRequested || onPresentPage() || onCallPage(), 180000, 500);
if (state.stopRequested) return false;
if (presented) return true;
if (!await askToCarryOn('No lead has presented for 3 minutes. Check your status is Available.', 'Keep waiting')) return false;
}
}

async function runEmailOnly() {
if (state.running) return;
startDeskRun('eo');
try {
const settings = loadSettings();
const progress = loadDeskProgress();
const left = () => emailOnlyLeads().filter((l) => !progress.eo[l.key]);
state.deskCount = { done: 0, total: left().length };
if (!left().length) { addLog('No Email Only leads left to do'); return; }
if (!onPresentPage() && !onCallPage()) {
for (;;) {
try { addLog(await ensureAvailable()); break; } catch (error) {
if (!(error instanceof NeedsYou) || !await askToCarryOn(error.message, error.carryOnLabel)) return;
break;
}
}
}
while (left().length && !state.stopRequested) {
state.deskLead = null;
render();
if (!onPresentPage() && !onCallPage() && !await waitForPresentedLead()) break;
if (onCallPage() && !onPresentPage()) {
if (!await askToCarryOn('A call is already open. Finish it yourself; your next Email Only lead will be picked up after.', 'Done, wait for the next')) break;
continue;
}
const presented = presentedPerson();
const lead = matchEmailOnly(left(), presented);
if (!lead) {
// Rejected and reset all the same, so it cannot dial unnoticed, then
// left for the agent: nothing else on it is changed.
let opened = true;
try {
await rejectPresented();
await chooseCallOutcome(OUTCOME_NONE);
} catch (error) {
opened = false;
}
addLog(`A lead that is not one of your Email Only leads presented; ${opened ? 'rejected so it does not dial, and' : ''} left to you`);
const message = opened
? 'This lead is not one of the Email Only leads you assigned. It has been rejected so it does not dial, and the call outcome is back to (Select a Call Outcome). Deal with it yourself and finish or park it, then carry on to wait for the next.'
: 'This lead is not one of the Email Only leads you assigned, and it could not be rejected. Reject it yourself before it dials, deal with it, then carry on to wait for the next.';
if (!await askToCarryOn(message, 'Done, wait for the next')) break;
continue;
}
state.deskLead = lead;
state.ctx = { log: addLog, settings, leftAfterThis: left().length - 1 };
addLog(`Started ${lead.name}`);
const outcome = await runLeadSteps(lead, EMAIL_ONLY_RUN);
if (!outcome) break;
progress.eo[lead.key] = outcome;
saveDeskProgress(progress);
state.deskCount.done++;
addLog(`${outcome}: ${lead.name}`);
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn('Skipped. Finish the open lead yourself so the next one can present.', 'Done, wait for the next')) break;
}
if (!state.stopRequested && !left().length) addLog('All your Email Only leads are done; status is Shift Start');
} catch (error) {
addLog(`Stopped: ${error && error.message}`);
} finally {
endDeskRun();
}
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel { position: fixed; bottom: 16px; left: 16px; width: 360px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); display: flex; flex-direction: column; z-index: 2147483000;
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
.launcher { position: fixed; bottom: 16px; left: 16px; z-index: 2147483000; align-items: center; gap: 6px; padding: 8px 14px; border: 0; border-radius: 999px; background: #1c1c1e; color: #fff; font: 600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; box-shadow: 0 6px 16px rgba(15, 23, 42, .25); cursor: pointer; }
.launcher:hover { background: #2c2c2e; }
.launcher:focus-visible { outline: 2px solid #C2CB42; outline-offset: 2px; }
.foot { flex-shrink: 0; padding: 8px 12px; background: var(--surface); display: flex; justify-content: space-between; border-top: 1px solid var(--border); }
.stop-clear { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--red); background: transparent; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.stop-clear:hover { background: #fef2f2; }
.report { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--muted); background: transparent; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.report:hover { background: var(--bg); color: var(--text); }
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
.tabs { display: flex; gap: 4px; background: #e5e5ea; border-radius: 10px; padding: 3px; }
.tab { flex: 1; font: inherit; font-size: 12px; font-weight: 600; color: var(--text-2); background: transparent; border: 0; border-radius: 8px; padding: 6px 4px; cursor: pointer; }
.tab.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
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

function renderTabs() {
const view = ui.view || 're';
const tab = (key, label) => `<button type="button" class="tab${view === key ? ' on' : ''}" data-action="view" data-view="${key}" aria-pressed="${view === key}">${label}</button>`;
return `<div class="tabs" role="group" aria-label="Choose a run">${tab('re', 'Re setup')}${tab('pc', 'Post Closure')}${tab('eo', 'Email Only')}</div>`;
}

function deskList(leads, done, describe) {
return `<div class="list">${leads.map((l) => {
const status = done[l.key] || 'Waiting';
const color = CHIP_COLORS[status] || '#64748b';
return `<div class="list-row"><span class="avatar" style="background:${color}1a;color:${color};">${escapeHtml(initials(l.name))}</span><div class="who"><div><strong>${escapeHtml(l.name)}</strong></div><div class="muted small">${escapeHtml(describe(l))}</div></div>${chip(status)}</div>`;
}).join('')}</div>`;
}

function finishToggle(settings) {
return `<label class="toggle"><input type="checkbox" data-action="reviewFinish" ${settings.reviewBeforeFinish ? 'checked' : ''}> Stop before Finished so I can check each one</label>`;
}

function renderSendBackView(settings) {
const leads = sendBackLeads();
const done = loadDeskProgress().pc;
const left = leads.filter((l) => !done[l.key]).length;
const checks = postClosureResults().filter((r) => normalise(r.postClosureAction) !== 'send back through').length;
const linkLine = liveLink.status ? `<div class="muted small" role="status">${escapeHtml(liveLink.status)}</div>` : '';
const checkButton = btn('checkParked', 'Check my Parked Calls on the Lead Checker', leads.length ? 'secondary' : 'primary', 'wide');
if (!leads.length) {
return [`<div class="card empty"><strong>No send backs yet</strong><div class="muted small" style="margin-bottom:10px;">Check your Parked Calls on the Lead Checker from here (Konnect Live opens; click Work Tools there), or send them from SLA Manager. The ones marked "send back through" show here by themselves.${checks ? ` ${checks} checked so far need contact.` : ''}</div>${checkButton}${linkLine}</div>`];
}
return [`<div class="card">${linkLine}
<div class="big-count"><strong>${left}</strong><span>to send back through</span></div>
<div class="muted small" style="margin:4px 0 12px;">Each one is opened from your Parked Calls: CAD or CAH in Post Closure Notes, call outcome Update Outcomes, lead outcome Customer Hub Team &gt; No Opportunity &gt; the Catch All reason, next status Shift Start, then Finished. Ones not in your Parked Calls are left alone.</div>
${left ? btn('startPc', `Start (${left})`, 'primary', 'wide') : '<div class="muted small">All done.</div>'}
${checks ? `<div class="muted small" style="margin-top:6px;">${checks} need contact (check), so they are left for you to call.</div>` : ''}
<div style="margin-top:8px;">${checkButton}</div>
<div class="row" style="margin-top:8px;">${Object.keys(done).length ? btn('clearDesk', 'Clear progress') : ''}</div>
</div>`, finishToggle(settings),
`<details data-section="list"${ui.listOpen ? ' open' : ''}><summary>Send backs <span class="count">${leads.length - left}/${leads.length}</span></summary>${deskList(leads, done, (l) => `${l.shorthand.toUpperCase()} · ${l.reason}`)}</details>`];
}

function renderEmailOnlyView(settings) {
const agents = emailOnlyAgents();
const leads = emailOnlyLeads();
const done = loadDeskProgress().eo;
const left = leads.filter((l) => !done[l.key]).length;
if (!leads.length) {
return [`<div class="card empty"><strong>No Email Only leads assigned today</strong><div class="muted small">Assign your Email Only leads in SLA Manager first; they show here. Only those leads are worked, so anything else that presents is left to you.</div></div>`];
}
const chosen = agents.includes(settings.emailOnlyAgent) ? settings.emailOnlyAgent : agents[0];
const picker = agents.length > 1 ? `<label class="small muted" style="display:block;margin-bottom:8px;">Assigned to <select data-action="eoAgent">${agents.map((a) => `<option${a === chosen ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('')}</select></label>` : '';
return [`<div class="card">
${picker}
<div class="big-count"><strong>${left}</strong><span>Email Only lead${left === 1 ? '' : 's'} to do</span></div>
<div class="muted small" style="margin:4px 0 12px;">Sets you Available. Each of these that presents is rejected (so it does not dial), set to Update Outcomes, given EO in Call Notes and Customer Hub Team &gt; Ongoing &gt; Email Only Lead, then Finished. You stay Available until the last one, then Shift Start. Any other lead that presents is left to you.</div>
${left ? btn('startEo', `Start (${left})`, 'primary', 'wide') : '<div class="muted small">All done.</div>'}
<div class="row" style="margin-top:8px;">${Object.keys(done).length ? btn('clearDesk', 'Clear progress') : ''}</div>
</div>`, finishToggle(settings),
`<details data-section="list"${ui.listOpen ? ' open' : ''}><summary>Email Only leads <span class="count">${leads.length - left}/${leads.length}</span></summary>${deskList(leads, done, (l) => l.campaign || 'Email Only')}</details>`];
}

function renderDeskRun() {
const lead = state.deskLead;
const count = state.deskCount || { done: 0, total: 0 };
const percent = count.total ? Math.round((100 * count.done) / count.total) : 0;
const title = state.mode === 'pc' ? 'Post Closure send back' : 'Email Only';
const parts = [`<div class="card">
<div class="progress-top"><span>${title}</span><span>${count.done} of ${count.total} done</span></div>
<div class="track"><div class="fill" style="width:${percent}%"></div></div>
${lead ? `<div class="lead-name">${escapeHtml(lead.name)}</div><div class="lead-meta">${escapeHtml(state.mode === 'pc' ? `${lead.shorthand.toUpperCase()} · ${lead.reason}` : (lead.email || ''))}</div>${renderSteps()}` : `<div class="lead-name">${state.mode === 'eo' ? 'Waiting for your next Email Only lead' : 'Getting ready'}</div>`}
</div>`];
if (state.paused) {
parts.push(`<div class="card needs-card" role="alert">
<h3>Needs you</h3><p>${escapeHtml(state.paused.message)}</p>
<div class="row">${btn('carry', state.paused.carryOnLabel, 'primary')}${lead ? btn('retry', 'Try again') + btn('skip', 'Skip') : ''}${btn('stop', 'Stop', 'danger')}</div>
</div>`);
} else {
parts.push(`<div class="row">${btn('stop', 'Stop after this step', 'ghost')}</div>`);
}
return parts;
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

const deskRun = state.running && (state.mode === 'pc' || state.mode === 'eo');
if (!state.running) parts.push(renderTabs());
if (deskRun) parts.push(...renderDeskRun());
else if (!state.running && ui.view === 'pc') parts.push(...renderSendBackView(settings));
else if (!state.running && ui.view === 'eo') parts.push(...renderEmailOnlyView(settings));
else {
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
}
if (state.log.length) {
const open = ui.logOpen ? ' open' : '';
parts.push(`<details data-section="log"${open}><summary>Activity <span class="count">${state.log.length}</span></summary><div class="log">${state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div></details>`);
}

ui.root.querySelector('.body').innerHTML = parts.join('');
const status = state.running
? (state.paused ? 'Needs you' : state.mode === 'here' ? 'This customer' : state.deskCount && (state.mode === 'pc' || state.mode === 'eo') ? `${state.deskCount.done}/${state.deskCount.total} done` : `${doneCount}/${leads.length} done`)
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
try { [PROGRESS_KEY, PASTED_RESULTS_KEY, DESK_PROGRESS_KEY, DESK_RESULTS_KEY].forEach((key) => localStorage.removeItem(key)); } catch (error) { /* ignore */ }
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
if (action === 'report') {
// Names never leave the page: every known customer name is replaced.
const names = leadsToDo().map((l) => l.name).concat(state.hereLead ? [state.hereLead.name] : [], sendBackLeads().map((l) => l.name), emailOnlyLeads().map((l) => l.name)).filter(Boolean);
const redact = (line) => names.reduce((text, name) => text.split(name).join('<customer>'), String(line));
const where = state.running ? `running ${state.mode || ''} step ${state.stepIndex + 1}${state.paused ? ', needs you: ' + state.paused.message : ''}` : 'idle';
reportProblem('Lead Re setup', redact(where), state.log.map(redact));
return;
}
if (action === 'close') {
// Tucks the panel away behind a small launcher button rather than closing
// it, so the tool stays one click away without the bookmark.
ui.panel.style.display = 'none';
ui.launcher.style.display = 'inline-flex';
return;
}
if (action === 'reopen') {
ui.launcher.style.display = 'none';
ui.panel.style.display = '';
render();
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
writeJson(SETTINGS_KEY, { ...(readJson(SETTINGS_KEY) || {}), reviewBeforePark: target.checked });
if (state.ctx) state.ctx.settings = loadSettings();
return;
}
if (action === 'start') { runAll(); return; }
if (action === 'view') { ui.view = target.getAttribute('data-view'); ui.listOpen = false; render(); return; }
if (action === 'startPc') { runSendBack(); return; }
if (action === 'checkParked') { if (!state.running) checkParkedOnLive(); return; }
if (action === 'startEo') { runEmailOnly(); return; }
if (action === 'reviewFinish') {
writeJson(SETTINGS_KEY, { ...(readJson(SETTINGS_KEY) || {}), reviewBeforeFinish: target.checked });
if (state.ctx) state.ctx.settings = loadSettings();
return;
}
if (action === 'eoAgent') return;
if (action === 'clearDesk') {
try { localStorage.removeItem(DESK_PROGRESS_KEY); } catch (error) { /* ignore */ }
render();
return;
}
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
if (existing && ui) { ui.panel.classList.remove('minimised'); ui.minimised = false; ui.panel.style.display = ''; ui.launcher.style.display = 'none'; render(); return; }
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
<button type="button" class="icon-btn" data-action="close" aria-label="Hide" title="Hide (the Re setup button brings it back)">&times;</button></div>
<div class="body" aria-live="polite"></div>
<div class="foot"><button type="button" class="report" data-action="report">Report a problem</button><button type="button" class="stop-clear" data-action="clearStop">Clear &amp; Stop</button></div>
</div>
<button type="button" class="launcher" data-action="reopen" style="display:none;" title="Show Lead Re setup">&#8635; Re setup</button>`;
document.body.appendChild(host);
const panel = root.querySelector('.panel');
const head = root.querySelector('.head');
if (!panel || !head) return;
ui = { host, root, panel, launcher: root.querySelector('.launcher'), minimised: false, listOpen: false, logOpen: false, stepsOpen: false };
root.addEventListener('click', onPanelClick);
root.addEventListener('change', (event) => {
if (event.target.getAttribute && event.target.getAttribute('data-action') === 'eoAgent') {
writeJson(SETTINGS_KEY, { ...(readJson(SETTINGS_KEY) || {}), emailOnlyAgent: event.target.value });
render();
}
});
root.addEventListener('toggle', (event) => {
const section = event.target.getAttribute && event.target.getAttribute('data-section');
if (section === 'list') ui.listOpen = event.target.open;
if (section === 'log') ui.logOpen = event.target.open;
if (section === 'steps') ui.stepsOpen = event.target.open;
}, true);
// Redraw when SLA Manager, in another tab on this site, saves new results
// or Email Only assignments, so the lists update without a refresh.
// One listener per page; it calls whichever copy of the tool loaded last.
window.__leadResetOnStorage = (key) => {
if (ui && !state.running && [LEAD_CHECKER_RESULTS_KEY, EMAIL_ONLY_ASSIGNED_KEY, NATIONAL_RESULTS_KEY, DESK_RESULTS_KEY].includes(key)) render();
};
window.__leadResetOnLive = onLiveMessage;
if (typeof window.addEventListener === 'function' && !window.__leadResetLiveWatch) {
window.__leadResetLiveWatch = true;
window.addEventListener('message', (event) => { if (window.__leadResetOnLive) window.__leadResetOnLive(event); });
}
if (typeof window.addEventListener === 'function' && !window.__leadResetStorageWatch) {
window.__leadResetStorageWatch = true;
window.addEventListener('storage', (event) => { if (window.__leadResetOnStorage) window.__leadResetOnStorage(event.key); });
}
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
panel.style.bottom = 'auto';
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
