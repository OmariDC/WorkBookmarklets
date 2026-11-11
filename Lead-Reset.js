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

// One copy per page. A second click of the bookmark shows the panel that is
// already there: a second copy would share the page but not the paused run,
// so its buttons would do nothing. A newer version only takes over when no
// run is going.
const INSTANCE_KEY = '_leadResetInstance';
const earlier = window[INSTANCE_KEY];
if (earlier && typeof earlier.show === 'function') {
if (!earlier.replaceable()) { earlier.show(); return; }
earlier.unload();
} else if (window._leadResetState && window._leadResetState.running) {
// A copy from before this rule is mid-run: leave it alone.
return;
}

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
if (state.newer) return 'A newer version is out. Click the bookmark again to load it.';
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

function resetLeadsFrom(results) {
// "Reset" is how older exports named Re setup. The notes and dropdowns
// are read from the closed lead on the page, not from the export.
return (results || []).filter((r) => r && (r.Verdict === 'Re setup' || r.Verdict === 'Reset') && r.Customer).map((r) => ({
activityId: r.ActivityID || '',
name: r.Customer,
reg: r.Reg || '',
campaign: r.ResetCampaign || '',
notes: '',
fields: {}
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

// Pure. Whether a lead on the page is the National check's lead. The
// check's number (the "...SALESLEAD" reference) is held on the page as the
// lead's RegistrationNumber, not its ID, so both are compared.
function isLeadNumber(activity, activityId) {
const id = String(activityId || '').replace(/\D/g, '');
if (!activity || !id) return false;
return String(activity.ID) === id || String(activity.RegistrationNumber || '').replace(/\D/g, '') === id;
}

// Pure. The customer's lead list holds closed leads too, so a lead only
// counts as an earlier reset when staff created it by hand on the same
// campaign after the closed lead.
function findEarlierReset(activities, lead) {
const closed = activities.find((a) => isLeadNumber(a, lead.activityId));
const closedAt = closed ? new Date(closed.CreatedDate).getTime() : NaN;
return activities.find((a) => a !== closed
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

// true or false as the closed lead had it, else null (leave the switch alone).
function wantedPartExchange(lead) {
return typeof lead.fields.HasPartExchange === 'boolean' ? lead.fields.HasPartExchange : null;
}

// ===================================================================
// POST CLOSURE SEND BACK AND EMAIL ONLY (pure parts)
// ===================================================================

// Both runs read what SLA Manager saved on this site for the desk: the Post
// Closure results from the Lead Checker, and the Email Only leads it
// assigned today.
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
// The desk's Parked Calls go to the Lead Checker through SLA Manager, which
// holds the Konnect Live link: the request, SLA Manager's progress and the
// results pass through storage both pages share (same site, two tabs).
const LIVE_REQUEST_KEY = '_workToolsLiveRequest';
const LIVE_STATUS_KEY = '_workToolsLiveStatus';
const DESK_RESULTS_KEY = '_workToolsDeskResults';
const LIVE_LINK_KEY = '_workToolsLinkState';
// How long SLA Manager has to say it took a request before the panel says
// it is not answering.
const HUB_ANSWER_MS = 6000;
// A request is good for this long on both sides.
const REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
// SLA Manager rewrites the link state at least every 10 seconds, so one
// older than this means SLA Manager is not running.
const LINK_STALE_MS = 30 * 1000;
const LINK_TEXT = {
none: 'Konnect Live: not open. Press Open Konnect Live in SLA Manager.',
idle: 'Konnect Live: linked, ready.',
paused: 'Konnect Live: paused.',
loggedOut: 'Konnect Live: logged out, logging back in.'
};
const HUB_NOT_RUNNING = 'SLA Manager is not running. Click Work Tools on the Konnect Manager tab.';

// Pure. The link status line for what SLA Manager last saved.
function linkLineText(link, now) {
const at = link && link.at ? new Date(link.at).getTime() : NaN;
if (!Number.isFinite(at) || now - at > LINK_STALE_MS) return HUB_NOT_RUNNING;
if (link.text) return String(link.text);
if (link.state === 'running') return `Konnect Live: checking ${Number(link.done) || 0} of ${Number(link.total) || 0}.`;
return LINK_TEXT[link.state] || LINK_TEXT.none;
}

// Pure. "just now", "5 min ago", "2 h 10 min ago".
function ageText(isoTime, now) {
const minutes = Math.floor((now - new Date(isoTime).getTime()) / 60000);
if (!Number.isFinite(minutes)) return '';
if (minutes < 1) return 'just now';
if (minutes < 60) return `${minutes} min ago`;
return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}
// The Lead Checker reads a customer search table with this header.
const PARKED_BATCH_HEADER = ['Name', 'Details', 'Vehicles', 'Magic Num', 'Dealer', 'Brand', 'Campaign', 'Best Number', 'Email', 'Address', 'Confirm'];

// Pure. Parked Calls rows as the Lead Checker's customer search batch.
function parkedBatchTsv(rows) {
const clean = (v) => String(v || '').replace(/[\t\r\n]+/g, ' ').trim();
return [PARKED_BATCH_HEADER.join('\t')].concat(rows.map((r) => PARKED_BATCH_HEADER.map((h) => (h === 'Confirm' || h === 'Details' ? '' : clean((r.cells || {})[h.toLowerCase()]))).join('\t'))).join('\n');
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
.map((r) => ({ key: personKey(r), name: r.name || '', email: r.email || '', phone: r.phone || '', reason: r.postClosureReason, checkedAt: r.checkedAt || '', ...SEND_BACK_STEPS[r.postClosureReason] }));
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

// Pure. Text to add after a box's contents so a shorthand sits on a line
// of its own (Konnect Notes only expands a word that is alone on its line).
function shorthandInsertion(value, word) {
return (String(value || '') && !/\n$/.test(String(value)) ? '\n' : '') + word;
}

// Pure. The open lead that is the assigned Email Only one, as an index
// into open ([{email, campaign}]), or -1 when that is unclear. The lead's
// email narrows it first; among several, only one on the assigned campaign
// counts.
function chooseEmailOnlyLead(open, lead) {
const email = normalise(lead.email);
const mine = email ? open.filter((a) => normalise(a.email) === email) : [];
const pool = mine.length ? mine : open;
if (pool.length === 1) return open.indexOf(pool[0]);
const campaign = normalise(lead.campaign);
const onCampaign = campaign ? pool.filter((a) => normalise(a.campaign) === campaign) : [];
return onCampaign.length === 1 ? open.indexOf(onCampaign[0]) : -1;
}

const EMAIL_PATTERN = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;

// Pure. How the EO note in Call Notes stands against the assigned lead's
// email: 'none' (no EO line), 'ok', 'missing' (a line with no email) or
// 'other' with the email found. accepted is an email the agent confirmed.
function emailOnlyNoteState(value, email, accepted) {
const lines = String(value || '').split(/\n/).filter((l) => SHORTHAND_MARKERS.eo.test(l));
if (!lines.length) return { state: 'none' };
const found = lines.flatMap((l) => l.match(EMAIL_PATTERN) || []).map(normalise);
const wanted = [normalise(email), normalise(accepted)].filter(Boolean);
if (wanted.length ? found.some((e) => wanted.includes(e)) : found.length) return { state: 'ok' };
return found.length ? { state: 'other', found: found[found.length - 1] } : { state: 'missing' };
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
check('an older export saying Reset still counts', resetLeadsFrom([{ Verdict: 'Reset', Customer: 'Jo Example' }]).map((l) => l.name), ['Jo Example']);
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
check('part exchange as the closed lead had it', [wantedPartExchange({ fields: { HasPartExchange: true } }), wantedPartExchange({ fields: { HasPartExchange: false } })], [true, false]);
check('part exchange unknown', wantedPartExchange({ fields: {} }), null);
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
check('the National lead number matches the page lead\'s reference', [isLeadNumber({ ID: 77553567, RegistrationNumber: '91893259SALESLEAD' }, '91893259'), isLeadNumber({ ID: 77553567, RegistrationNumber: '91893259SALESLEAD' }, '91893259SALESLEAD'), isLeadNumber({ ID: 77553567 }, '77553567'), isLeadNumber({ ID: 77553567, RegistrationNumber: '91893260SALESLEAD' }, '91893259')], [true, true, true, false]);
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
check('shorthand goes on a line of its own', [shorthandInsertion('', 'cad'), shorthandInsertion('Notes', 'cad'), shorthandInsertion('Notes ', 'cad'), shorthandInsertion('Notes\n', 'eo')], ['cad', '\ncad', '\ncad', 'eo']);
const batch = parkedBatchTsv([{ cells: { name: 'Jo Example', vehicles: 'AB12CDE', 'magic num': '9', dealer: 'Preston', brand: 'Peugeot', campaign: 'Enquiry - Used', 'best number': '07700900123', email: 'jo@example.com', address: 'AB1 2CD', confirm: 'Open', details: 'ViewHide' } }]).split('\n');
check('parked calls batch header', batch[0].split('\t')[0] === 'Name' && batch[0].includes('Magic Num') && batch[0].includes('Best Number'), true);
check('parked calls batch row', batch[1].split('\t'), ['Jo Example', '', 'AB12CDE', '9', 'Preston', 'Peugeot', 'Enquiry - Used', '07700900123', 'jo@example.com', 'AB1 2CD', '']);
const openLeads = [{ email: 'dan@example.com', campaign: 'Peugeot - Enquiry' }, { email: 'dan@example.com', campaign: 'Vauxhall - Email Only' }];
check('one open lead is the Email Only one', chooseEmailOnlyLead(openLeads.slice(0, 1), { email: 'dan@example.com', campaign: 'Other' }), 0);
check('two open leads are split by the assigned campaign', chooseEmailOnlyLead(openLeads, { email: 'dan@example.com', campaign: 'vauxhall - email only' }), 1);
check('two open leads and no campaign match is unclear', [chooseEmailOnlyLead(openLeads, { email: 'dan@example.com', campaign: 'Citroen' }), chooseEmailOnlyLead(openLeads.concat(openLeads[1]), { email: 'dan@example.com', campaign: 'Vauxhall - Email Only' })], [-1, -1]);
check('EO note: none, right email, no email, another email', [
emailOnlyNoteState('Called twice', 'dan@example.com').state,
emailOnlyNoteState('Notes\nEMAIL ONLY LEAD: Dan@Example.com', 'dan@example.com').state,
emailOnlyNoteState('EMAIL ONLY LEAD:', 'dan@example.com').state,
emailOnlyNoteState('EMAIL ONLY LEAD: old@example.com', 'dan@example.com')
], ['none', 'ok', 'missing', { state: 'other', found: 'old@example.com' }]);
check('EO note: an email the agent confirmed passes', emailOnlyNoteState('EMAIL ONLY LEAD: old@example.com', 'dan@example.com', 'old@example.com').state, 'ok');
check('EO note: an older line does not hide a right one', emailOnlyNoteState('EMAIL ONLY LEAD: old@example.com\nEMAIL ONLY LEAD: dan@example.com', 'dan@example.com').state, 'ok');
const linkNow = new Date('2026-11-11T10:00:30Z').getTime();
check('link line: no state or an old one means SLA Manager is not running', [linkLineText(null, linkNow), linkLineText({ state: 'idle', at: '2026-11-11T09:59:59Z' }, linkNow)], [HUB_NOT_RUNNING, HUB_NOT_RUNNING]);
check('link line: wording per state', ['none', 'idle', 'paused', 'loggedOut'].map((state) => linkLineText({ state, at: '2026-11-11T10:00:20Z' }, linkNow)), ['Konnect Live: not open. Press Open Konnect Live in SLA Manager.', 'Konnect Live: linked, ready.', 'Konnect Live: paused.', 'Konnect Live: logged out, logging back in.']);
check('link line: progress, and SLA Manager\'s own text first', [linkLineText({ state: 'running', done: 12, total: 40, at: '2026-11-11T10:00:20Z' }, linkNow), linkLineText({ state: 'running', text: 'Konnect Live: checking 3 of 9.', at: '2026-11-11T10:00:20Z' }, linkNow)], ['Konnect Live: checking 12 of 40.', 'Konnect Live: checking 3 of 9.']);
check('age of a result', [ageText('2026-11-11T10:00:10Z', linkNow), ageText('2026-11-11T09:55:00Z', linkNow), ageText('2026-11-11T07:50:00Z', linkNow)], ['just now', '5 min ago', '2 h 10 min ago']);
check('Available until the last Email Only lead', [statusAfterEmailOnly(2), statusAfterEmailOnly(0)], ['Available', 'Shift Start']);
} catch (error) {
failures.push('threw: ' + (error && error.message));
}
if (failures.length) {
selfTestFailures.push(...failures);
console.error('Lead Re setup self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('Lead Re setup self-test passed');
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

// Clear & Stop sets this: every wait in a run then ends at once, so nothing
// more is pressed after the panel has gone.
let halted = false;
class Halted extends Error {}

async function pollUntil(fn, timeoutMs, intervalMs, canHalt) {
const end = Date.now() + timeoutMs;
for (;;) {
if (canHalt && halted) throw new Halted('Stopped');
let value = null;
try { value = fn(); } catch (error) { value = null; }
if (value) return value;
if (Date.now() > end) return null;
await sleep(intervalMs || 250);
}
}

const waitFor = (fn, timeoutMs, intervalMs) => pollUntil(fn, timeoutMs, intervalMs, true);

// A list the page draws bit by bit (leads, Parked Calls rows): returned
// once it has stopped changing for quietMs. An empty list is only believed
// after emptyMs, as the page may simply not have drawn it yet.
async function settledList(read, signature, emptyMs, quietMs) {
const started = Date.now();
let last = null;
let changedAt = started;
for (;;) {
if (halted) throw new Halted('Stopped');
const list = read();
const now = signature(list);
if (now !== last) { last = now; changedAt = Date.now(); }
if (list.length ? Date.now() - changedAt >= quietMs : Date.now() - started >= emptyMs) return list;
if (Date.now() - started > emptyMs + 20000) return list;
await sleep(250);
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

// The customer's leads once Konnect has finished drawing them.
function settledLeads() {
return settledList(liveActivities, (list) => list.map(({ activity }) => activityKey(activity)).join(','), 12000, 1000);
}

function statusButton() {
return Array.from(document.querySelectorAll('button.dropdown-toggle')).find((b) => /\S/.test(b.textContent) && !/toggle dropdown/i.test(b.textContent)) || null;
}

// The agent's status as the page shows it, '' when it cannot be read.
function currentStatus() {
const button = statusButton();
return button ? button.textContent.replace(/\s+/g, ' ').trim() : '';
}

function isAvailable() {
return normalise(currentStatus()) === normalise(STATUS_AVAILABLE);
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
const o = options || {};
this.carryOnLabel = o.carryOnLabel || 'Done it, carry on';
// A pause that asks for a decision, not a step done by hand: carrying on
// records the answer and runs the step again, so the step still does its
// work. Try again asks the same question again.
this.onConfirm = o.onConfirm || null;
// No carry on: the step cannot safely be passed over, only tried again.
this.noCarry = !!o.noCarry;
// A check by eye before something is pressed: Try again has no meaning.
this.review = !!o.review;
}
}

// Not stopped by Clear & Stop, as its notice offers this too.
async function ensureShiftStart() {
const button = statusButton();
if (button && normalise(button.textContent) === normalise(STATUS_WHILE_RESETTING)) return 'Status already Shift Start';
const item = byText(document, '[ng-click^="setMakeBusy"]', /^shift start$/i)[0];
if (!item) throw new NeedsYou('Could not find the Shift Start status. Set your status to Shift Start yourself.');
item.click();
const ok = await pollUntil(() => !button || normalise(button.textContent) === normalise(STATUS_WHILE_RESETTING), 5000);
if (!ok) throw new NeedsYou('Your status did not change to Shift Start. Set it yourself.');
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
const entries = await settledLeads();
if (!entries.length) {
throw new NeedsYou('This customer\'s leads have not shown on the page, so the wrong customer and already set up checks could not be made. Wait for the leads to show, then press Try again.', { noCarry: true });
}
const activities = entries.map(({ activity }) => activity);
const closed = entries.find(({ activity }) => isLeadNumber(activity, lead.activityId));
// The customer opens on its open lead; the closed one's tab is brought
// forward so its Initial Notes box can be read.
if (closed) await bringLeadIntoView(closed.activity);
if (lead.activityId && activities.length && !closed && !ctx.allowOtherCustomer) {
throw new NeedsYou(`The closed lead is not on this customer, so this may be the wrong ${lead.name}. Go back and pick the right customer, or carry on if this is them.`, { carryOnLabel: 'This is them, carry on', onConfirm: () => { ctx.allowOtherCustomer = true; } });
}
const adopted = adoptClosedLead(lead, closed && closed.activity, closedLeadPageNotes(closed && closed.activity));
Object.assign(lead, adopted.lead);
ctx.notesFrom = adopted.notesFrom;
const earlier = findEarlierReset(activities, lead);
if (earlier && !ctx.allowExisting) {
throw new NeedsYou(`This customer already has a ${lead.campaign} lead added by hand after the closed one, so it may already be set up again. Press Skip lead to leave it, or carry on to add another.`, { carryOnLabel: 'Add another lead', onConfirm: () => { ctx.allowExisting = true; } });
}
if (earlier) return 'Adding another lead as asked';
if (closed) return `Closed ${lead.campaign} lead found on this customer, not set up again yet`;
return lead.activityId ? 'The closed lead is not on this customer; carrying on as asked' : 'No lead number to check against this customer';
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

// Leads that were not on the customer when Add the new lead first ran.
function freshLeads(ctx) {
if (!ctx || !ctx.beforeKeys) return [];
return liveActivities().filter(({ activity }) => !ctx.beforeObjects.has(activity) && !ctx.beforeKeys.has(activityKey(activity)));
}

const ALREADY_ADDED = 'A new lead has shown since the first try, so a second one was not added';

async function addNewLead(ctx, lead) {
const createWindow = () => openModal((m) => !!m.querySelector('input[name="salesOptions"]'));
// The leads are noted once, so a second try can tell whether the first
// one's lead (saved slowly, or by hand) has shown since.
if (!ctx.beforeKeys) {
ctx.beforeKeys = new Set(liveActivities().map(({ activity }) => activityKey(activity)));
ctx.beforeObjects = new Set(liveActivities().map(({ activity }) => activity));
} else {
await waitFor(() => freshLeads(ctx).length > 0 || (ctx.savePressed && !createWindow()), ctx.savePressed ? 10000 : 4000);
if (ctx.savePressed && !freshLeads(ctx).length && !createWindow()) await waitFor(() => freshLeads(ctx).length > 0, 10000);
if (freshLeads(ctx).length) return ALREADY_ADDED;
if (ctx.savePressed && createWindow()) {
throw new NeedsYou('Save was pressed but the Create Activity window is still open. Check it, press Save yourself if it has not saved, then carry on once the new lead shows.');
}
if (ctx.savePressed) {
throw new NeedsYou('Save was pressed but no new lead has shown. Look at the customer\'s leads: only add it again if there is no new one.', { carryOnLabel: 'No new lead there, add it again', onConfirm: () => { ctx.savePressed = false; } });
}
}
let modal = createWindow();
if (!modal) {
const add = byClick(document, 'createNewSalesLead');
if (!add) throw new NeedsYou('Press Add New Lead yourself, pick Regular Sales Lead and the campaign, then Save.');
add.click();
modal = await waitFor(createWindow, 10000);
}
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
ctx.savePressed = true;
save.click();
if (!await waitFor(() => !document.body.contains(modal) || !isVisible(modal), 15000)) {
throw new NeedsYou('The Create Activity window did not close. Check it and press Save yourself.');
}
return `New ${lead.campaign} lead added`;
}

async function findNewLead(ctx, lead) {
const found = await waitFor(() => {
const fresh = freshLeads(ctx);
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
// No lead means no controls: an unset lead would otherwise match every
// control on the page.
if (!activity) return [];
return Array.from(document.querySelectorAll(selector)).filter((el) => belongsTo(el, activity));
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
if (!ctx.newLead) {
ctx.missedFields = ['Lead dropdowns (the new lead was not found)'];
return 'No new lead found, dropdowns left alone';
}
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

// Anything that could not be filled is always put to the agent before the
// call is parked, whatever the setting says.
async function reviewBeforePark(ctx) {
const missed = ctx.missedFields && ctx.missedFields.length ? ctx.missedFields.join(', ') : '';
if (ctx.reviewed) return 'Checked';
if (!ctx.settings.reviewBeforePark && !missed) return 'Review skipped (setting off)';
const what = missed ? `These could not be filled: ${missed}. Set them on the new lead yourself and check it.` : 'Check the new lead.';
throw new NeedsYou(`${what} Carry on to clear the call outcome, set Shift Start and park the call.`, { carryOnLabel: missed ? 'Done, park it' : 'Looks right, park it', review: true, onConfirm: () => { ctx.reviewed = true; } });
}

async function parkCall() {
const outcome = visibleFirst(document.querySelectorAll('select[ng-model="selected.CallOutcome"]'));
if (!outcome || !chooseByText(outcome, OUTCOME_NONE)) throw new NeedsYou(`Set the call outcome back to "${OUTCOME_NONE}" and park the call yourself.`);
const next = visibleFirst(document.querySelectorAll('select[ng-model="selected.NextAgentStatus"]'));
if (!next || !chooseByText(next, STATUS_WHILE_RESETTING)) throw new NeedsYou('Set the next status (by Park It) to Shift Start and park the call yourself.');
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
{ label: 'Clear Call Notes', run: clearCallNotes }
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

// Work Tools loads Konnect Notes when it is missing and only shows this
// panel again, so clicking it mid-run is safe.
function needKonnectNotes() {
if (!(window.KonnectNotes && window.KonnectNotes.version)) {
throw new NeedsYou('Konnect Notes is not on this page, and it writes the notes. Click Work Tools once to load it, then press Try again.', { noCarry: true });
}
}

function callNotesBoxOf(activity) {
return visibleFirst(controlsOf(activity, CALL_NOTES_SELECTOR).filter(isVisible)) || findLabelledBox('call notes');
}

// Types a Konnect Notes shorthand at the end of a box and presses space,
// so Konnect Notes writes the full note exactly as when typed by hand.
// Returns false when Konnect Notes did not write the note (it takes the
// word but writes nothing when it cannot read the Initial Notes), after
// putting back the box and any others it may have rewritten: a Catch All
// note can tidy Call Notes as well.
async function typeShorthand(box, word, others) {
const saved = [box].concat(others || []).filter(Boolean).map((b) => [b, b.value]);
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
saved.forEach(([b, value]) => { if (b.value !== value) setFieldValue(b, value); });
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
if (!activity) throw new NeedsYou(`The lead was not found, so its outcome was left alone. Set it to ${path.join(' > ')} yourself, or skip this one.`);
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
throw new NeedsYou('Check the notes and the lead outcome. Carry on to press Finished.', { carryOnLabel: 'Looks right, press Finished', review: true, onConfirm: () => { ctx.reviewed = true; } });
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

// The Parked Calls rows once the table has finished filling.
function settledParkedRows() {
return settledList(() => readSearchRows().rows, (rows) => rows.map((r) => r.tr.textContent).join('|'), 6000, 1200);
}

async function goToParked() {
const already = onParkedPage();
if (!already) {
if (onCallPage()) throw new NeedsYou('A call is open. Finish or park it yourself, then carry on.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
const nav = byText(document, '[ng-click]', /^parked( calls)?$/i).find(isVisible);
if (nav) nav.click(); else location.hash = '#!/search/parked';
if (!await waitFor(onParkedPage, 15000)) throw new NeedsYou('Parked Calls did not open. Open it yourself.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
}
await settledParkedRows();
return already ? 'On Parked Calls' : 'Opened Parked Calls';
}

async function openParkedCustomer(ctx, lead) {
if (onCallPage()) return 'Customer already open';
const rows = await settledParkedRows();
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

// When the tool cannot tell which of several open leads is meant, the
// agent opens its tab and says so; the lead in view is then used.
function leadPickedByAgent(ctx, candidates, what) {
const inView = ctx.useLeadInView ? leadInView() : null;
ctx.useLeadInView = false;
if (inView && candidates.includes(inView)) return inView;
throw new NeedsYou(`${what} Open the right lead's tab yourself and carry on, or skip this one.`, { carryOnLabel: 'Its tab is open, carry on', onConfirm: () => { ctx.useLeadInView = true; } });
}

async function findPostClosureLead(ctx, lead) {
await settledLeads();
const found = await waitFor(() => {
const list = liveActivities().map(({ activity }) => activity)
.filter((a) => /post closure processing/i.test(String((a.SalesLead && a.SalesLead.SourceName) || '')) && isOpenLead(a));
return list.length ? list : null;
}, 8000);
if (!found) throw new NeedsYou('No open Post Closure lead on this customer. Skip them, or finish this one yourself and skip.', { noCarry: true });
const activity = found.length === 1 ? found[0] : leadPickedByAgent(ctx, found, 'This customer has more than one open Post Closure lead.');
const email = normalise(activity.SalesLead && activity.SalesLead.EmailAddress);
if (lead.email && email && email !== normalise(lead.email) && !ctx.allowOtherEmail) {
throw new NeedsYou(`This customer's email is not the one the Lead Checker checked, so this may be the wrong ${lead.name}. Skip them, or carry on if this is them.`, { carryOnLabel: 'This is them, carry on', onConfirm: () => { ctx.allowOtherEmail = true; } });
}
ctx.activity = activity;
if (!await bringLeadIntoView(activity)) throw new NeedsYou('Open the Post Closure lead\'s tab yourself, then carry on.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
return 'Post Closure lead found';
}

async function writePostClosureNote(ctx, lead) {
needKonnectNotes();
const box = findLabelledBox('post closure notes');
const typeIt = { carryOnLabel: 'Typed it, check again', onConfirm: () => {} };
if (!box) throw new NeedsYou(`Could not find Post Closure Notes. Type ${lead.shorthand} there and press space yourself.`, typeIt);
if (SHORTHAND_MARKERS[lead.shorthand].test(box.value)) return `${lead.shorthand.toUpperCase()} note already in Post Closure Notes`;
if (!await typeShorthand(box, lead.shorthand, [callNotesBoxOf(ctx.activity)])) {
throw new NeedsYou(`Konnect Notes did not write the note, so the notes were put back as they were. Type ${lead.shorthand} in Post Closure Notes and press space yourself.`, typeIt);
}
ctx.wrote = `the ${lead.shorthand.toUpperCase()} note`;
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
(String(main.innerText || '').match(EMAIL_PATTERN) || []).forEach((e) => emails.add(e));
return { name: name.trim(), emails: Array.from(emails) };
}

async function ensureAvailable() {
if (onPresentPage() || onCallPage()) return 'A lead is already open';
if (isAvailable()) return 'Status already Available';
const item = byText(document, '[ng-click^="setMakeBusy"], [ng-click^="setAvailable"], .dropdown-menu [ng-click]', /^available$/i)[0];
if (!item) throw new NeedsYou('Set your status to Available yourself so your Email Only leads present.', { carryOnLabel: 'Done, wait for leads' });
item.click();
// A lead may present straight away, which also shows it worked.
if (!statusButton()) { await sleep(1000); return 'Available pressed (your status could not be read from the page to confirm it)'; }
if (!await waitFor(() => isAvailable() || onPresentPage() || onCallPage(), 5000)) {
throw new NeedsYou('Your status did not change to Available. Set it yourself so your Email Only leads present.', { carryOnLabel: 'Done, wait for leads' });
}
return 'Status set to Available';
}

async function rejectPresented() {
if (onCallPage()) return 'Lead already open';
const button = byClick(document, 'rejectCall');
if (!button) throw new NeedsYou('Press Reject yourself so the lead opens without dialling.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
button.click();
if (!await waitFor(onCallPage, 20000)) throw new NeedsYou('The lead did not open after Reject. Open it yourself.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
await sleep(1000);
return 'Rejected, so the lead opened without dialling';
}

// The presented customer may have other open leads: the assigned lead's
// campaign picks between them, and the agent does when it cannot.
async function findEmailOnlyLead(ctx, lead) {
const open = (await settledLeads()).map(({ activity }) => activity).filter(isOpenLead);
if (!open.length) throw new NeedsYou('No open lead was found on this customer. Do this one yourself and skip it.', { noCarry: true });
const index = chooseEmailOnlyLead(open.map((a) => ({ email: a.SalesLead && a.SalesLead.EmailAddress, campaign: a.CampaignName })), lead);
const activity = index >= 0 ? open[index] : leadPickedByAgent(ctx, open, `This customer has ${open.length} open leads and it is not clear which is the Email Only one${lead.campaign ? ` (assigned on ${lead.campaign})` : ''}.`);
ctx.activity = activity;
if (!await bringLeadIntoView(activity)) throw new NeedsYou('Open the Email Only lead\'s tab yourself, then carry on.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
return open.length > 1 ? `Email Only lead found (${activity.CampaignName || 'picked by you'})` : 'Email Only lead found';
}

// Konnect Notes writes the email shown at the top of the page, which is
// not always the assigned lead's, so the note is checked against the lead.
async function writeEmailOnlyNote(ctx, lead) {
needKonnectNotes();
const box = callNotesBoxOf(ctx.activity);
const typeIt = { carryOnLabel: 'Typed it, check again', onConfirm: () => {} };
if (!box) throw new NeedsYou('Could not find Call Notes. Type eo there and press space yourself.', typeIt);
let note = emailOnlyNoteState(box.value, lead.email, ctx.noteEmailAccepted);
if (note.state === 'ok') return ctx.wrote ? 'EO note checked' : 'EO note with this lead\'s email already in Call Notes';
if (note.state === 'none') {
if (!await typeShorthand(box, 'eo')) throw new NeedsYou('Konnect Notes did not write the note. Type eo in Call Notes and press space yourself.', typeIt);
ctx.wrote = 'the EO note';
note = emailOnlyNoteState(box.value, lead.email, ctx.noteEmailAccepted);
if (note.state === 'ok') return 'EO written in Call Notes with this lead\'s email';
}
if (note.state === 'other') {
throw new NeedsYou(`The EO note in Call Notes has ${note.found}, but the assigned lead's email is ${lead.email}. Check which is right and correct the note.`, { carryOnLabel: 'The note is right, carry on', onConfirm: () => { ctx.noteEmailAccepted = note.found; } });
}
throw new NeedsYou(`The EO note in Call Notes has no email address. Add ${lead.email || 'the customer\'s email'} after "EMAIL ONLY LEAD:" yourself.`, { carryOnLabel: 'Added it, check again', onConfirm: () => {} });
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

const state = window._leadResetState = {
running: false, paused: null, stopRequested: false, currentIndex: -1, stepIndex: 0, ctx: null, log: [], notice: null
};
let resolvePause = null;
let versionState = null;
let hubTimer = null;
let ui = null; // The panel's elements and what is open in it.

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

// inLead: the pause is inside a lead's steps, so Try again and Skip lead
// make sense.
function waitForUser(error, inLead) {
if (halted) return Promise.resolve('stop');
state.paused = { message: error.message, carryOnLabel: error.carryOnLabel, noCarry: !!error.noCarry, review: !!error.review, inLead: !!inLead };
showPanel();
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

// What a skipped or stopped lead leaves on the page for the agent, in
// words, '' when nothing.
function leftAsIs(ctx) {
const parts = [];
if (onCallPage()) {
parts.push('the call is still open');
const outcome = visibleFirst(document.querySelectorAll('select[ng-model="selected.CallOutcome"]'));
const chosen = outcome ? selectedText(outcome) : '';
if (chosen && !isPlaceholderOption(chosen)) parts.push(`the call outcome is "${chosen}"`);
if (ctx && freshLeads(ctx).length) parts.push('the new lead was added');
if (ctx && ctx.notesBox && document.body.contains(ctx.notesBox) && ctx.notesBox.value) parts.push('the initial notes are still in Call Notes');
if (ctx && ctx.wrote) parts.push(`${ctx.wrote} was written`);
const levels = ctx && ctx.activity ? outcomeLevelSelects(ctx.activity).map(selectedText).filter((t) => !isPlaceholderOption(t)) : [];
if (levels.length) parts.push(`the lead outcome is set to ${levels.join(' > ')}`);
const next = visibleFirst(document.querySelectorAll('select[ng-model="selected.NextAgentStatus"]'));
if (next && selectedText(next)) parts.push(`the next status is ${selectedText(next)}`);
} else if (onPresentPage()) {
parts.push('a lead is presenting');
}
return parts.length ? `Left as it is: ${parts.join('; ')}.` : '';
}

// Runs one lead through a list of steps. Returns 'Done', 'Skipped', or
// null when stopped.
async function runLeadSteps(lead, steps) {
state.steps = steps;
let outcome = 'Done';
for (state.stepIndex = 0; state.stepIndex < steps.length;) {
if (halted) return null;
if (state.stopRequested) { outcome = null; break; }
const step = steps[state.stepIndex];
render();
try {
const message = await step.run(state.ctx, lead);
if (halted) return null;
if (message) addLog(message);
state.stepIndex++;
} catch (error) {
if (halted || error instanceof Halted) return null;
const needsYou = error instanceof NeedsYou ? error : new NeedsYou(`${step.label} went wrong: ${error && error.message}. Do this step yourself.`);
addLog(needsYou.review ? 'Waiting for your check' : `Stopped at "${step.label}"`);
const answer = await waitForUser(needsYou, true);
if (answer === 'retry') continue;
if (answer === 'carry') {
if (needsYou.onConfirm) needsYou.onConfirm(); else state.stepIndex++;
continue;
}
if (answer === 'skip') { outcome = 'Skipped'; break; }
outcome = null;
state.stopRequested = true;
break;
}
}
return outcome;
}

function beginRun(mode) {
state.running = true;
state.mode = mode;
state.stopRequested = false;
state.notice = null;
state.deskLead = null;
state.deskCount = { done: 0, total: 0 };
render();
}

// Every run ends here. A stop says what was left changed on the page, and
// an agent left Available is told so: the status is never changed silently.
function endRun() {
if (halted) return;
const stopped = state.stopRequested;
const left = stopped ? leftAsIs(state.ctx) : '';
const available = state.mode !== 'here' && isAvailable();
const lines = [];
if (stopped) lines.push(left ? `Stopped. ${left}` : 'Stopped.');
if (available) lines.push(`${stopped ? 'You' : 'The run has ended and you'} are still Available, so leads can present.`);
state.running = false;
state.mode = null;
state.currentIndex = -1;
state.deskLead = null;
state.paused = null;
state.ctx = null;
state.stopRequested = false;
resolvePause = null;
state.notice = left || available ? { text: lines.join(' '), shiftStart: available } : null;
if (lines.length) addLog(lines.join(' ')); else render();
}

// Asks the agent and returns true to carry on, false to stop.
async function askToCarryOn(message, carryOnLabel) {
const answer = await waitForUser(new NeedsYou(message, { carryOnLabel }), false);
if (answer === 'stop') { state.stopRequested = true; return false; }
return true;
}

// A step outside any lead (getting to the right page or status). Returns
// false when the run should end. again: carrying on runs it again instead
// of taking the agent's word that it is done.
async function outsideLead(fn, again) {
for (;;) {
try {
const message = await fn();
if (message) addLog(message);
return true;
} catch (error) {
if (halted || error instanceof Halted) return false;
if (!(error instanceof NeedsYou)) { addLog(`Stopped: ${error && error.message}`); return false; }
if (!await askToCarryOn(error.message, error.carryOnLabel)) return false;
if (!again) return true;
}
}
}

function skippedMessage(next) {
const left = leftAsIs(state.ctx);
return `Lead skipped.${left ? ' ' + left : ''} Park or finish the open call yourself so ${next}.`;
}

function logRunError(error) {
if (!halted && !(error instanceof Halted)) addLog(`Stopped: ${error && error.message}`);
}

// Sets one of the open customer's leads up again and stops in the new lead.
async function runHere(activityId) {
if (state.running) return;
const entry = liveActivities().find(({ activity }) => String(activity.ID) === String(activityId));
if (!entry) { addLog('That lead is no longer on the page'); return; }
const salesLead = entry.activity.SalesLead || {};
const base = { activityId: String(entry.activity.ID), name: salesLead.CustomerName || 'This customer', reg: '', campaign: '', notes: '', fields: {} };
const adopted = adoptClosedLead(base, entry.activity, closedLeadPageNotes(entry.activity));
const lead = adopted.lead;
state.hereLead = lead;
beginRun('here');
state.ctx = { log: addLog, settings: loadSettings(), notesFrom: adopted.notesFrom };
addLog(`Setting up ${lead.campaign} again on this customer`);
try {
const outcome = await runLeadSteps(lead, HERE_STEPS);
const missed = state.ctx.missedFields && state.ctx.missedFields.length ? ` These could not be filled, so set them yourself: ${state.ctx.missedFields.join(', ')}.` : '';
if (outcome === 'Done') addLog(`Lead set up again. You are in the new lead.${missed}`);
} catch (error) {
logRunError(error);
} finally {
endRun();
}
}

async function runAll() {
if (state.running) return;
const settings = loadSettings();
beginRun('batch');
try {
if (onIdlePage() && !await outsideLead(ensureShiftStart, false)) return;
const progress = loadProgress();
const leads = leadsToDo();
for (let i = 0; i < leads.length && !state.stopRequested; i++) {
const lead = leads[i];
if (progress.byActivity[lead.activityId]) continue;
state.currentIndex = i;
state.ctx = { log: addLog, settings };
addLog(`Started ${lead.name}`);
const outcome = await runLeadSteps(lead, STEPS);
if (!outcome) break;
progress.byActivity[lead.activityId] = outcome;
saveProgress(progress);
addLog(`${outcome}: ${lead.name}`);
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn(skippedMessage('the next lead can start'), 'Done, next lead')) break;
// What this lead left is the agent's now; a later stop must not repeat it.
state.ctx = null;
}
if (!state.stopRequested && !halted) addLog('All Re setup leads are done');
} catch (error) {
logRunError(error);
} finally {
endRun();
}
}

// ===================================================================
// POST CLOSURE SEND BACK AND EMAIL ONLY (runs)
// ===================================================================

// The Post Closure results SLA Manager keeps for the desk: every Post
// Closure row from any Lead Checker results it receives. Nothing else is
// read for them.
function postClosureSaved() {
const saved = readJson(DESK_RESULTS_KEY);
return saved && Array.isArray(saved.results) && isFresh(saved.savedAt) ? saved : null;
}

function postClosureResults() {
const saved = postClosureSaved();
return saved ? saved.results.filter((r) => r && r.postClosureAction && isFresh(r.checkedAt || saved.savedAt)) : [];
}

function sendBackLeads() {
return sendBackLeadsFrom(postClosureResults());
}

// "Lead Checker results from 5 min ago", by the newest result.
function resultsAgeLine() {
const saved = postClosureSaved();
const results = postClosureResults();
if (!saved || !results.length) return '';
const newest = results.map((r) => r.checkedAt || saved.savedAt).sort().pop();
return `Lead Checker results from ${ageText(newest, Date.now())}.`;
}

// The desk's request while it is still good, else null.
function pendingRequest() {
const request = readJson(LIVE_REQUEST_KEY);
const at = request && request.at ? new Date(request.at).getTime() : NaN;
return request && !request.cancelled && Number.isFinite(at) && Date.now() - at <= REQUEST_MAX_AGE_MS ? request : null;
}

// Tells SLA Manager the request is no longer wanted.
function withdrawRequest() {
const request = readJson(LIVE_REQUEST_KEY);
if (!request || request.cancelled) return;
if (pendingRequest()) writeJson(LIVE_REQUEST_KEY, { id: request.id, at: new Date().toISOString(), cancelled: true });
else { try { localStorage.removeItem(LIVE_REQUEST_KEY); } catch (error) { /* ignore */ } }
}

// Asks SLA Manager (open in its own tab) to check the Parked Calls on the
// Lead Checker. No Konnect Live tab is opened from here.
async function checkParkedOnLive() {
let rows = [];
// Nothing else starts while the rows are being read.
state.checking = true;
try {
await goToParked();
rows = readSearchRows().rows;
} catch (error) {
if (!halted && !(error instanceof Halted)) addLog(error.message);
return;
} finally {
state.checking = false;
}
if (!rows.length) { addLog('No parked calls to check'); return; }
const request = { id: `desk-${Date.now()}`, at: new Date().toISOString(), rows: rows.length, tsv: parkedBatchTsv(rows) };
if (!writeJson(LIVE_REQUEST_KEY, request)) { addLog('Could not pass the Parked Calls to SLA Manager (browser storage full)'); return; }
addLog(`Asked SLA Manager to check ${rows.length} parked call${rows.length === 1 ? '' : 's'}`);
clearTimeout(hubTimer);
hubTimer = setTimeout(() => { if (ui && !state.running) render(); }, HUB_ANSWER_MS + 200);
}

// What SLA Manager last said about this desk's request, for the panel.
function hubStatusLine() {
const request = pendingRequest();
if (!request) return '';
const status = readJson(LIVE_STATUS_KEY);
if (status && status.id === request.id) return status.text || '';
return Date.now() - new Date(request.at).getTime() > HUB_ANSWER_MS
? 'SLA Manager has not picked this up. Open the Konnect Manager tab and click Work Tools there; it then takes the request by itself.'
: 'Passing your Parked Calls to SLA Manager.';
}

function emailOnlySaved() {
const saved = readJson(EMAIL_ONLY_ASSIGNED_KEY);
return saved && isFresh(saved.savedAt) && Array.isArray(saved.leads) ? saved.leads : [];
}

function emailOnlyAgents() {
return Array.from(new Set(emailOnlySaved().map((l) => l.agent).filter(Boolean)));
}

// Only the chosen agent's leads, as those are the ones that present here.
function emailOnlyLeads() {
const agents = emailOnlyAgents();
const chosen = loadSettings().emailOnlyAgent;
const agent = agents.includes(chosen) ? chosen : agents[0];
return emailOnlySaved().filter((l) => !agent || l.agent === agent).map((l) => ({ ...l, key: normalise(l.email) }));
}

function loadDeskProgress() {
const p = readJson(DESK_PROGRESS_KEY);
return p && isFresh(p.savedAt) ? { savedAt: p.savedAt, pc: p.pc || {}, eo: p.eo || {} } : { savedAt: new Date().toISOString(), pc: {}, eo: {} };
}
function saveDeskProgress(progress) {
progress.savedAt = new Date().toISOString();
writeJson(DESK_PROGRESS_KEY, progress);
}

async function runSendBack() {
if (state.running) return;
beginRun('pc');
try {
const settings = loadSettings();
const progress = loadDeskProgress();
if (!await outsideLead(goToParked, true)) return;
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
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn(skippedMessage('the next one can start'), 'Done, next one')) break;
state.ctx = null;
}
if (!state.stopRequested && !halted) addLog('All Post Closure send backs are done');
} catch (error) {
logRunError(error);
} finally {
endRun();
}
}

// Waits for the next lead to present, as long as the agent likes.
async function waitForPresentedLead() {
for (;;) {
const presented = await waitFor(() => state.stopRequested || onPresentPage() || onCallPage(), 180000, 500);
if (state.stopRequested) return false;
if (presented) return true;
if (!await askToCarryOn(`No lead has presented for 3 minutes. Your status is ${currentStatus() || 'not readable from the page'}; it needs to be Available.`, 'Keep waiting')) return false;
}
}

async function runEmailOnly() {
if (state.running) return;
beginRun('eo');
try {
const settings = loadSettings();
const progress = loadDeskProgress();
const left = () => emailOnlyLeads().filter((l) => !progress.eo[l.key]);
state.deskCount = { done: 0, total: left().length };
if (!left().length) { addLog('No Email Only leads left to do'); return; }
if (!onPresentPage() && !onCallPage() && !await outsideLead(ensureAvailable, false)) return;
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
if (halted || error instanceof Halted) return;
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
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn(skippedMessage('the next one can present'), 'Done, wait for the next')) break;
state.ctx = null;
}
// The status is read from the page: a skipped last lead leaves it Available.
if (!state.stopRequested && !halted && !left().length) addLog(`All your Email Only leads are done; your status is ${currentStatus() || 'not readable from the page'}`);
} catch (error) {
logRunError(error);
} finally {
endRun();
}
}

// ===================================================================
// PANEL
// ===================================================================

// The launcher sits above Konnect Notes' own launcher (left 20px, bottom
// 20px), and the panel opens above that too.
const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel { position: fixed; bottom: 68px; left: 20px; width: 340px; max-width: calc(100vw - 32px); max-height: calc(100vh - 88px); display: flex; flex-direction: column; z-index: 2147483000;
  --bg: #f2f2f7; --surface: #ffffff; --text: #1c1c1e; --text-2: #334155; --muted: #5b6577; --border: #e2e8f0; --accent: #C2CB42; --head: #1c1c1e; --ring: #1c1c1e;
  --green: #047857; --amber: #b45309; --red: #c40013;
  background: var(--bg); color: var(--text); border-radius: 16px; box-shadow: 0 18px 40px rgba(15, 23, 42, .22), 0 2px 6px rgba(15, 23, 42, .08); overflow: hidden;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
.panel.paused { width: 300px; }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--head); color: #fff; cursor: move; user-select: none; flex-shrink: 0; }
.panel.paused .head { background: var(--amber); }
.head .title { font-weight: 700; font-size: 13.5px; flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.head .mini-status { font-weight: 600; color: #e2e8f0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel.paused .mini-status { color: #fff; }
.icon-btn { background: transparent; border: 0; color: #e2e8f0; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 16px; }
.icon-btn:hover { background: rgba(255,255,255,.16); color: #fff; }
.link { flex-shrink: 0; padding: 5px 12px; font-size: 11.5px; color: var(--text-2); background: #e9e9ef; border-bottom: 1px solid var(--border); }
.link.down { color: #78350f; background: #fffbeb; }
.body { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.panel.minimised .body, .panel.minimised .foot, .panel.minimised .link, .panel.paused .foot, .panel.paused .link { display: none; }
.launcher { position: fixed; bottom: 68px; left: 20px; z-index: 2147483000; align-items: center; gap: 6px; padding: 8px 14px; border: 0; border-radius: 999px; background: #1c1c1e; color: #fff; font: 600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; box-shadow: 0 6px 16px rgba(15, 23, 42, .25); cursor: pointer; }
.launcher:hover { background: #2c2c2e; }
.launcher.needs { background: #b45309; animation: nudge 1.2s ease-in-out infinite; }
.launcher:focus-visible { outline: 2px solid #fff; outline-offset: 0; box-shadow: 0 0 0 4px #1c1c1e; }
@keyframes nudge { 50% { box-shadow: 0 0 0 6px rgba(180, 83, 9, .35); } }
.foot { flex-shrink: 0; padding: 8px 12px; background: var(--surface); display: flex; justify-content: space-between; border-top: 1px solid var(--border); }
.stop-clear { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--red); background: transparent; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.stop-clear:hover { background: #fef2f2; }
.report { font: inherit; font-size: 12.5px; font-weight: 600; color: var(--muted); background: transparent; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.report:hover { background: var(--bg); color: var(--text); }
.card { background: var(--surface); border-radius: 12px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 1px 1px rgba(0,0,0,.03); }
.muted { color: var(--muted); }
.small { font-size: 11.5px; }
.version { font-size: 11px; color: var(--text-2); }
.version.newer { color: var(--red); font-weight: 700; font-size: 12px; }
.alert { border-radius: 10px; padding: 9px 11px; font-size: 12.5px; }
.alert.red { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.alert.amber { background: #fffbeb; color: #78350f; border: 1px solid #fde68a; }
.alert .row { margin-top: 8px; }
.big-count { display: flex; align-items: baseline; gap: 8px; }
.big-count strong { font-size: 30px; line-height: 1; letter-spacing: -.5px; }
.btn { font: inherit; font-weight: 600; font-size: 12.5px; border-radius: 999px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.btn.primary { background: var(--accent); color: #1c1c1e; }
.btn.primary:hover { filter: brightness(.95); }
.btn.secondary { background: #e5e5ea; color: var(--text); }
.btn.secondary:hover { background: #d9d9de; }
.btn.ghost { background: transparent; color: var(--text-2); border-color: #cbd5e1; }
.btn.ghost:hover { background: var(--bg); }
.btn.danger { background: transparent; color: var(--red); border-color: transparent; }
.btn.danger:hover { background: #fef2f2; }
.btn.wide { width: 100%; padding: 10px 14px; font-size: 13.5px; }
.btn.small { padding: 5px 11px; font-size: 12px; }
.btn:focus-visible, .tab:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible, .report:focus-visible, .stop-clear:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.icon-btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tabs { display: flex; gap: 4px; background: #e5e5ea; border-radius: 10px; padding: 3px; }
.tab { flex: 1; font: inherit; font-size: 12px; font-weight: 600; color: var(--text-2); background: transparent; border: 0; border-radius: 8px; padding: 6px 4px; cursor: pointer; }
.tab.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
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
.needs-card { border: 2px solid #f59e0b; background: #fffbeb; }
.needs-card .who { font-size: 11.5px; color: #78350f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.needs-card h3 { margin: 0 0 4px; font-size: 14px; color: #7c2d12; }
.needs-card p { margin: 0 0 10px; color: #451a03; font-size: 13px; }
.needs-card .others { margin-top: 8px; justify-content: space-between; }
details { background: var(--surface); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
summary { cursor: pointer; padding: 10px 12px; font-weight: 600; font-size: 12.5px; display: flex; justify-content: space-between; align-items: center; list-style: none; border-radius: 12px; }
summary::-webkit-details-marker { display: none; }
summary .count { background: var(--bg); color: var(--muted); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
details.how { background: none; box-shadow: none; margin: 4px 0 10px; }
details.how > summary { display: inline-block; padding: 0; font-size: 11.5px; font-weight: 600; color: var(--text-2); text-decoration: underline; border-radius: 4px; }
details.how > div { margin-top: 4px; font-size: 11.5px; color: var(--muted); }
.fold { padding: 0 12px 10px; }
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

const CHIP_COLORS = { Done: '#047857', Skipped: '#5b6577', Waiting: '#5b6577', Working: '#5b6300', 'Needs you': '#b45309' };

function chip(text) {
const color = CHIP_COLORS[text] || '#5b6577';
return `<span class="chip" style="background:${color}1a;color:${color};">${escapeHtml(text)}</span>`;
}

function initials(name) {
return stripNameTitle(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

function btn(action, label, kind, extraClass) {
return `<button type="button" class="btn ${kind || 'secondary'}${extraClass ? ' ' + extraClass : ''}" data-action="${action}">${escapeHtml(label)}</button>`;
}

// A one line summary with the detail behind a fold.
function howItWorks(detail) {
return `<details class="how" data-section="how"${ui.howOpen ? ' open' : ''}><summary>How it works</summary><div>${detail}</div></details>`;
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
<div class="muted small" style="margin:2px 0 6px;">The lead in view is ticked; tick another to set that one up again instead. It stops in the new lead.</div>
${rows}
<div style="margin-top:10px;">${chosen ? btn('here', 'Set up the ticked lead again', 'primary', 'wide') : '<div class="muted small">Tick the lead to set up again.</div>'}</div>
</div>`;
}

function renderTabs() {
const view = ui.view || 're';
const tab = (key, label) => `<button type="button" class="tab${view === key ? ' on' : ''}" data-action="view" data-view="${key}" aria-pressed="${view === key}">${label}</button>`;
return `<div class="tabs" role="group" aria-label="Choose a run">${tab('re', 'Re setup')}${tab('pc', 'Post Closure')}${tab('eo', 'Email Only')}</div>`;
}

function listRow(name, detail, status) {
const color = CHIP_COLORS[status] || '#5b6577';
return `<div class="list-row"><span class="avatar" style="background:${color}1a;color:${color};">${escapeHtml(initials(name))}</span><div class="who"><div><strong>${escapeHtml(name)}</strong></div><div class="muted small">${escapeHtml(detail)}</div></div>${chip(status)}</div>`;
}

function listFold(title, doneCount, rows) {
return `<details data-section="list"${ui.listOpen ? ' open' : ''}><summary>${title} <span class="count">${doneCount}/${rows.length}</span></summary><div class="list">${rows.join('')}</div></details>`;
}

function finishToggle(settings) {
return `<label class="toggle"><input type="checkbox" data-action="reviewFinish" ${settings.reviewBeforeFinish ? 'checked' : ''}> Stop before Finished so I can check each one</label>`;
}

const SEND_BACK_HOW = 'Each one is opened from your Parked Calls: CAD or CAH in Post Closure Notes, call outcome Update Outcomes, lead outcome Customer Hub Team &gt; No Opportunity &gt; the Catch All reason, next status Shift Start, then Finished. Ones not in your Parked Calls are left alone. To check your Parked Calls, SLA Manager passes them to its Konnect Live tab.';
const EMAIL_ONLY_HOW = 'Sets you Available. Each assigned lead that presents is rejected (so it does not dial), set to Update Outcomes, given EO in Call Notes and Customer Hub Team &gt; Ongoing &gt; Email Only Lead, then Finished. You stay Available until the last one, then Shift Start.';

function renderSendBackView(settings) {
const leads = sendBackLeads();
const done = loadDeskProgress().pc;
const left = leads.filter((l) => !done[l.key]).length;
const checks = postClosureResults().filter((r) => normalise(r.postClosureAction) !== 'send back through').length;
const needContact = checks ? `${checks} ${checks === 1 ? 'needs contact, so it is' : 'need contact, so they are'} left for you to call.` : '';
const hubLine = hubStatusLine();
const requestLine = hubLine ? `<div class="muted small hub-status" role="status" style="margin-top:6px;">${escapeHtml(hubLine)}</div>` : '';
const age = resultsAgeLine();
const ageLine = age ? `<div class="muted small results-age">${escapeHtml(age)}</div>` : '';
const checkButton = btn('checkParked', 'Check my Parked Calls', leads.length ? 'secondary' : 'primary', 'wide');
if (!leads.length) {
return [`<div class="card empty"><strong>No send backs yet</strong><div class="muted small">Check your Parked Calls on the Lead Checker. The ones marked "send back through" show here.${needContact ? ' ' + needContact : ''}</div>${ageLine}${howItWorks(SEND_BACK_HOW)}${checkButton}${requestLine}</div>`];
}
const now = Date.now();
const rows = leads.map((l) => listRow(l.name, `${l.shorthand.toUpperCase()} · ${l.reason}${l.checkedAt ? ' · checked ' + ageText(l.checkedAt, now) : ''}`, done[l.key] || 'Waiting'));
return [`<div class="card">
<div class="big-count"><strong>${left}</strong><span>to send back through</span></div>
<div class="muted small" style="margin-top:4px;">Opens each one from your Parked Calls, writes CAD or CAH, sets the outcomes and presses Finished.</div>
${ageLine}${howItWorks(SEND_BACK_HOW)}
${left ? btn('startPc', `Start (${left})`, 'primary', 'wide') : '<div class="muted small">All done.</div>'}
${needContact ? `<div class="muted small" style="margin-top:6px;">${needContact}</div>` : ''}
<div style="margin-top:8px;">${checkButton}</div>${requestLine}
${Object.keys(done).length ? `<div class="row" style="margin-top:8px;">${btn('clearPc', 'Clear progress', 'ghost', 'small')}</div>` : ''}
</div>`, finishToggle(settings), listFold('Send backs', leads.length - left, rows)];
}

function renderEmailOnlyView(settings) {
const agents = emailOnlyAgents();
const leads = emailOnlyLeads();
const done = loadDeskProgress().eo;
const left = leads.filter((l) => !done[l.key]).length;
if (!leads.length) {
return [`<div class="card empty"><strong>No Email Only leads assigned today</strong><div class="muted small">Assign your Email Only leads in SLA Manager first; they show here. Anything else that presents is left to you.</div></div>`];
}
const chosen = agents.includes(settings.emailOnlyAgent) ? settings.emailOnlyAgent : agents[0];
const picker = agents.length > 1 ? `<label class="small muted" style="display:block;margin-bottom:8px;">Assigned to <select data-action="eoAgent">${agents.map((a) => `<option${a === chosen ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('')}</select></label>` : '';
const rows = leads.map((l) => listRow(l.name, l.campaign || 'Email Only', done[l.key] || 'Waiting'));
return [`<div class="card">
${picker}
<div class="big-count"><strong>${left}</strong><span>Email Only lead${left === 1 ? '' : 's'} to do</span></div>
<div class="muted small" style="margin-top:4px;">Sets you Available and works each of these as it presents. Any other lead is left to you.</div>
${howItWorks(EMAIL_ONLY_HOW)}
${left ? btn('startEo', `Start (${left})`, 'primary', 'wide') : '<div class="muted small">All done.</div>'}
${Object.keys(done).length ? `<div class="row" style="margin-top:8px;">${btn('clearEo', 'Clear progress', 'ghost', 'small')}</div>` : ''}
</div>`, finishToggle(settings), listFold('Email Only leads', leads.length - left, rows)];
}

function renderReSetupView(settings, source, leads, progress) {
const parts = [];
const doneCount = leads.filter((l) => progress.byActivity[l.activityId]).length;
const remaining = leads.length - doneCount;
const pasted = !!readJson(PASTED_RESULTS_KEY);
const tidy = `${doneCount ? btn('clearRe', 'Clear progress', 'ghost', 'small') : ''}${pasted ? btn('clearPasted', 'Remove pasted results', 'ghost', 'small') : ''}`;
if (onCallPage() && liveActivities().length) parts.push(renderHereCard());
if (!source) {
// Nothing from the National check: the This customer card (if any) is enough.
if (!onCallPage()) parts.push(`<div class="card empty">
<strong>No National results yet</strong>
<div class="muted small">Import the National results in SLA Manager, or copy them from the Lead Checker and paste them here. On a customer, you can set one of their leads up again.</div>
<div class="row" style="justify-content:center;margin-top:10px;">${btn('paste', 'Paste results', 'primary')}</div>
</div>`);
else parts.push(`<div class="row">${btn('paste', 'Paste National results')}</div>`);
} else if (leads.length === 0) {
parts.push(`<div class="card empty">
<strong>No leads need setting up again</strong>
<div class="muted small">The last National check found nothing to set up again.</div>
<div class="row" style="justify-content:center;margin-top:10px;">${btn('paste', 'Paste results')}${tidy}</div>
</div>`);
} else if (remaining === 0) {
parts.push(`<div class="card">
<strong>All done</strong>
<div class="tiles">${['Done', 'Skipped'].map((key) => `<div class="tile"><strong>${leads.filter((l) => progress.byActivity[l.activityId] === key).length}</strong><span>${key}</span></div>`).join('')}<div class="tile"><strong>0</strong><span>Left</span></div></div>
<div class="row">${btn('copySummary', 'Copy summary', 'primary')}${tidy}</div>
</div>`);
} else {
const savedAt = new Date(source.savedAt).toTimeString().slice(0, 5);
parts.push(`<div class="card">
<div class="big-count"><strong>${remaining}</strong><span>lead${remaining === 1 ? '' : 's'} to set up again</span></div>
<div class="muted small" style="margin:4px 0 12px;">From the National check at ${escapeHtml(savedAt)}${doneCount ? ` &middot; ${doneCount} already done` : ''}</div>
${btn('start', doneCount ? `Continue (${remaining} left)` : 'Start', 'primary', 'wide')}
<div class="row" style="margin-top:8px;">${btn('paste', 'Paste results', 'ghost', 'small')}${doneCount ? btn('copySummary', 'Copy summary', 'ghost', 'small') : ''}${tidy}</div>
</div>`);
}
if (leads.length) {
parts.push(`<label class="toggle"><input type="checkbox" data-action="review" ${settings.reviewBeforePark ? 'checked' : ''}> Stop before parking so I can check each lead</label>`);
parts.push(listFold('Leads', doneCount, leads.map((l, i) => listRow(l.name, l.campaign || 'Campaign read from the closed lead', leadStatus(l, i, progress)))));
}
return parts;
}

// What the running card shows for the run in hand.
function runInfo(leads, progress) {
if (state.mode === 'here') {
const lead = state.hereLead;
return { left: 'This customer', right: 'Stops in the new lead', percent: null, name: lead.name, meta: lead.campaign || '', steps: true };
}
if (state.mode === 'pc' || state.mode === 'eo') {
const lead = state.deskLead;
const count = state.deskCount || { done: 0, total: 0 };
return {
left: state.mode === 'pc' ? 'Post Closure send back' : 'Email Only',
right: `${count.done} of ${count.total} done`,
percent: count.total ? Math.round((100 * count.done) / count.total) : 0,
name: lead ? lead.name : (state.mode === 'eo' ? 'Waiting for your next Email Only lead' : 'Getting ready'),
meta: lead ? (state.mode === 'pc' ? `${lead.shorthand.toUpperCase()} · ${lead.reason}` : (lead.email || '')) : '',
steps: !!lead
};
}
const lead = leads[state.currentIndex];
const doneCount = leads.filter((l) => progress.byActivity[l.activityId]).length;
return {
left: `Lead ${state.currentIndex + 1} of ${leads.length}`,
right: `${doneCount} done`,
percent: leads.length ? Math.round((100 * doneCount) / leads.length) : 0,
name: lead ? lead.name : 'Getting ready',
meta: lead ? [lead.campaign || 'Campaign read from the closed lead', lead.reg].filter(Boolean).join(' · ') : '',
steps: !!lead
};
}

function activityFold() {
if (!state.log.length) return '';
return `<details data-section="log"${ui.logOpen ? ' open' : ''}><summary>Activity <span class="count">${state.log.length}</span></summary><div class="log">${state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div></details>`;
}

// Paused: only the message and its buttons, so the panel covers as little
// as it can of the page the agent is asked to look at. The main answer is
// the one wide button; the rest are small and apart from it.
function renderPaused(info) {
const paused = state.paused;
const step = paused.inLead && state.steps ? state.steps[state.stepIndex] : null;
const who = [info.steps ? info.name : '', step ? step.label : ''].filter(Boolean).join(' · ');
const others = [];
if (paused.inLead && !paused.review) others.push(btn('retry', 'Try again', 'ghost', 'small'));
if (paused.inLead && state.mode !== 'here') others.push(btn('skip', 'Skip lead', 'ghost', 'small'));
return [`<div class="card needs-card">
<div role="alert">${who ? `<div class="who">${escapeHtml(who)}</div>` : ''}<h3>Needs you</h3><p>${escapeHtml(paused.message)}</p></div>
${paused.noCarry ? '' : btn('carry', paused.carryOnLabel, 'primary', 'wide')}
<div class="row others"><span class="row">${others.join('')}</span>${btn('stop', 'Stop', 'danger', 'small')}</div>
</div>`,
`<details data-section="more"${ui.moreOpen ? ' open' : ''}><summary>Steps and activity</summary><div class="fold">${info.steps ? renderSteps() : ''}</div><div class="log">${state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div></details>`];
}

function renderRunning(info) {
return [`<div class="card">
<div class="progress-top"><span>${escapeHtml(info.left)}</span><span>${escapeHtml(info.right)}</span></div>
${info.percent == null ? '' : `<div class="track"><div class="fill" style="width:${info.percent}%"></div></div>`}
<div class="lead-name">${escapeHtml(info.name)}</div>${info.meta ? `<div class="lead-meta">${escapeHtml(info.meta)}</div>` : ''}
${info.steps ? renderSteps() : ''}
</div>`, `<div class="row">${btn('stop', 'Stop after this step', 'ghost')}</div>`, activityFold()];
}

function focusKey(el) {
const action = el && el.getAttribute && el.getAttribute('data-action');
if (!action) return null;
return { action, view: el.getAttribute('data-view') || '', value: el.name === 'hereLead' ? el.value : '', label: action === 'carry' ? el.textContent : '' };
}

// The link status line: its own strip, so SLA Manager's regular updates
// change one line of text and not the whole panel.
function renderLinkLine() {
if (!ui) return;
const link = readJson(LIVE_LINK_KEY);
const text = linkLineText(link, Date.now());
if (text === ui.linkText) return;
ui.linkText = text;
const line = ui.root.querySelector('.link');
line.textContent = text;
line.classList.toggle('down', text === HUB_NOT_RUNNING || !link || link.state === 'none');
}

function render() {
if (!ui) return;
// A redraw between mouse down and mouse up would swap the button under
// the pointer and lose the click, so it waits for the mouse to come up.
if (ui.pointerDownAt && Date.now() - ui.pointerDownAt < 3000) { ui.renderPending = true; return; }
ui.renderPending = false;
const source = loadResults();
const leads = source ? resetLeadsFrom(source.results) : [];
const progress = loadProgress();
const settings = loadSettings();
const onDesktop = /agent-desktop/i.test(location.pathname || '');
if (!versionState) versionState = startVersionWatch('Lead-Reset.js', () => render());

const parts = [];
const info = state.running ? runInfo(leads, progress) : null;
if (state.paused) parts.push(...renderPaused(info));
else {
const versionText = versionLineText(versionState);
if (versionText) parts.push(`<div class="version${versionState.newer ? ' newer' : ''}">${escapeHtml(versionText)}</div>`);
if (selfTestFailures.length) parts.push(`<div class="alert red" role="alert"><strong>Self-test failed.</strong> Please send this on: ${escapeHtml(selfTestFailures[0])}</div>`);
if (!onDesktop) parts.push(`<div class="alert amber">Open this on the agent desktop: Re setup, Post Closure and Email Only only work there.</div>`);
if (state.running) parts.push(...renderRunning(info));
else {
if (state.notice) {
parts.push(`<div class="alert amber notice" role="alert">${escapeHtml(state.notice.text)}<div class="row">${state.notice.shiftStart ? btn('shiftStart', 'Set Shift Start', 'primary', 'small') : ''}${btn('dismissNotice', 'OK', 'ghost', 'small')}</div></div>`);
}
parts.push(renderTabs());
if (ui.view === 'pc') parts.push(...renderSendBackView(settings));
else if (ui.view === 'eo') parts.push(...renderEmailOnlyView(settings));
else parts.push(...renderReSetupView(settings, source, leads, progress));
parts.push(activityFold());
}
}

const html = parts.join('');
if (html !== ui.html) {
const body = ui.root.querySelector('.body');
const active = ui.root.activeElement;
const key = active && body.contains(active) ? focusKey(active) : null;
const scroll = body.scrollTop;
body.innerHTML = html;
ui.html = html;
body.scrollTop = scroll;
// Keyboard focus stays on the same control when it is still there. A
// carry on button with another label is another question, so it does
// not get the focus by itself.
if (key) {
const again = Array.from(body.querySelectorAll(`[data-action="${key.action}"]`)).find((el) => {
const k = focusKey(el);
return k.view === key.view && k.value === key.value && k.label === key.label;
});
if (again) again.focus({ preventScroll: true });
}
}

const doneCount = leads.filter((l) => progress.byActivity[l.activityId]).length;
const status = state.paused ? 'Needs you'
: state.running ? (state.mode === 'here' ? 'This customer' : state.mode === 'batch' ? `${doneCount}/${leads.length} done` : `${state.deskCount.done}/${state.deskCount.total} done`)
: (leads.length ? `${leads.length - doneCount} to do` : '');
ui.root.querySelector('.mini-status').textContent = ui.minimised && status ? status : '';
ui.panel.classList.toggle('paused', !!state.paused);
ui.launcher.classList.toggle('needs', !!state.paused);
ui.launcher.textContent = state.paused ? '! Needs you' : state.running ? '↻ Re setup: running' : '↻ Re setup';
renderLinkLine();
keepClear();
}

// ===================================================================
// WHERE THE PANEL SITS
// ===================================================================

const POSITION_KEY = '_leadResetPanelPos';
// Tried in turn until the panel covers none of Konnect's own Finished and
// Park It buttons, nor the Konnect Notes launcher.
const CORNERS = [{ left: 20, bottom: 68 }, { right: 20, bottom: 20 }, { right: 20, top: 20 }, { left: 20, top: 20 }];

function loadPosition() {
try {
const p = JSON.parse(sessionStorage.getItem(POSITION_KEY) || 'null');
return p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : null;
} catch (error) { return null; }
}

function placeAt(spot) {
['left', 'right', 'top', 'bottom'].forEach((side) => { ui.panel.style[side] = spot[side] == null ? 'auto' : `${spot[side]}px`; });
}

function overlaps(a, b) {
return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// A place the agent dragged the panel to is kept for the session.
// Otherwise the panel stays in its corner unless it would cover one of
// Konnect's buttons there, and then moves to the next corner that is clear.
function keepClear() {
if (!ui || ui.panel.style.display === 'none' || (ui.pointerDownAt && Date.now() - ui.pointerDownAt < 3000)) return;
if (ui.position) {
placeAt({ left: Math.max(0, Math.min(window.innerWidth - 80, ui.position.left)), top: Math.max(0, Math.min(window.innerHeight - 40, ui.position.top)) });
return;
}
const avoid = Array.from(document.querySelectorAll('button[ng-click^="completeCall("], #kn-inbound-launcher')).filter(isVisible).map((el) => el.getBoundingClientRect());
for (let i = 0; i < CORNERS.length; i++) {
const corner = (ui.corner + i) % CORNERS.length;
placeAt(CORNERS[corner]);
const rect = ui.panel.getBoundingClientRect();
if (!avoid.some((a) => overlaps(rect, a))) { ui.corner = corner; return; }
}
placeAt(CORNERS[ui.corner]);
}

// Brings the panel back in full: from the launcher, or from minimised.
function showPanel() {
if (!ui) return;
ui.launcher.style.display = 'none';
ui.panel.style.display = '';
if (ui.minimised) {
ui.minimised = false;
ui.panel.classList.remove('minimised');
const toggle = ui.root.querySelector('[data-action="minimise"]');
toggle.textContent = '–';
toggle.setAttribute('aria-label', 'Minimise');
}
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

// ===================================================================
// STOPPING AND CLEARING
// ===================================================================

// Customer data is kept for one shift: anything of this tool's own that is
// older goes when the tool loads.
function purgeExpired() {
try {
[PROGRESS_KEY, PASTED_RESULTS_KEY, DESK_PROGRESS_KEY, DESK_RESULTS_KEY].forEach((key) => {
const saved = readJson(key);
if (saved && !isFresh(saved.savedAt)) localStorage.removeItem(key);
});
// A withdrawn request stays its ten minutes, so SLA Manager sees it.
const request = readJson(LIVE_REQUEST_KEY);
if (request && !(Date.now() - new Date(request.at).getTime() <= REQUEST_MAX_AGE_MS)) localStorage.removeItem(LIVE_REQUEST_KEY);
} catch (error) { /* storage blocked: nothing to purge */ }
}

// Takes this copy off the page: its panel, timers and listeners. What it
// keeps in storage stays.
function unload() {
if (versionState && versionState.timer) clearInterval(versionState.timer);
clearTimeout(hubTimer);
if (ui) {
clearInterval(ui.pageTimer);
clearInterval(ui.linkTimer);
if (typeof window.removeEventListener === 'function') {
window.removeEventListener('storage', ui.onStorage);
window.removeEventListener('mouseup', ui.onMouseUp, true);
}
ui.host.remove();
ui = null;
}
if (window[INSTANCE_KEY] === instance) window[INSTANCE_KEY] = null;
}

// Shown in place of the panel after Clear & Stop ends a run part way: what
// was left on the page, and Shift Start on offer when still Available.
const NOTICE_ID = '_leadResetNotice';
function showStoppedNotice(text, offerShiftStart) {
const old = document.getElementById(NOTICE_ID);
if (old) old.remove();
const host = document.createElement('div');
host.id = NOTICE_ID;
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
:host { all: initial; }
.note { position: fixed; left: 20px; bottom: 68px; width: 300px; max-width: calc(100vw - 40px); z-index: 2147483000; background: #fffbeb; color: #451a03; border: 2px solid #f59e0b; border-radius: 12px; padding: 12px; box-shadow: 0 12px 30px rgba(15, 23, 42, .25); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
p { margin: 0 0 10px; }
button { font: inherit; font-weight: 600; font-size: 12.5px; border-radius: 999px; padding: 6px 12px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #1c1c1e; margin-right: 6px; }
button.main { background: #C2CB42; border-color: #C2CB42; }
button:focus-visible { outline: 2px solid #1c1c1e; outline-offset: 2px; }
</style><div class="note" role="alert"><p></p>${offerShiftStart ? '<button type="button" class="main" data-act="shift">Set Shift Start</button>' : ''}<button type="button" data-act="close">OK</button></div>`;
const message = root.querySelector('p');
message.textContent = text;
const timer = setTimeout(() => host.remove(), offerShiftStart ? 120000 : 20000);
root.addEventListener('click', (event) => {
const act = event.target.getAttribute && event.target.getAttribute('data-act');
if (act === 'close') { clearTimeout(timer); host.remove(); }
if (act === 'shift') {
ensureShiftStart().then((done) => { message.textContent = `${done}.`; event.target.remove(); }, (error) => { message.textContent = error.message; });
}
});
document.body.appendChild(host);
}

// Same as SLA Manager's Clear & Stop: ends any run at once, wipes what
// this tool keeps (and nothing of SLA Manager's), withdraws its request
// and removes the panel, so the next click of the bookmark starts from
// scratch.
function clearAndStop() {
const wasRunning = state.running;
const left = wasRunning ? leftAsIs(state.ctx) : '';
const available = wasRunning && isAvailable();
halted = true;
state.stopRequested = true;
if (resolvePause) answerPause('stop');
try { [PROGRESS_KEY, PASTED_RESULTS_KEY, DESK_PROGRESS_KEY, DESK_RESULTS_KEY].forEach((key) => localStorage.removeItem(key)); } catch (error) { /* ignore */ }
withdrawRequest();
unload();
window._leadResetState = null;
if (left || available) {
showStoppedNotice(`Lead Re setup stopped and cleared.${left ? ' ' + left : ''}${available ? ' You are still Available, so leads can present.' : ''}`, available);
}
console.info('Lead Re setup stopped and cleared. Click the bookmark again to start fresh.');
}

function clearDeskProgress(run) {
const progress = loadDeskProgress();
progress[run] = {};
saveDeskProgress(progress);
render();
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
if (action === 'reopen') { showPanel(); render(); return; }
if (action === 'minimise') {
ui.minimised = !ui.minimised;
ui.panel.classList.toggle('minimised', ui.minimised);
target.textContent = ui.minimised ? '+' : '–';
target.setAttribute('aria-label', ui.minimised ? 'Expand' : 'Minimise');
render();
return;
}
if (action === 'review' || action === 'reviewFinish') {
writeJson(SETTINGS_KEY, { ...(readJson(SETTINGS_KEY) || {}), [action === 'review' ? 'reviewBeforePark' : 'reviewBeforeFinish']: target.checked });
if (state.ctx) state.ctx.settings = loadSettings();
return;
}
if (action === 'eoAgent') return;
if (action === 'view') { ui.view = target.getAttribute('data-view'); ui.listOpen = false; ui.howOpen = false; render(); return; }
if (action === 'pickHere') { ui.herePicked = target.value; render(); return; }
if (action === 'dismissNotice') { state.notice = null; render(); return; }
if (action === 'shiftStart') {
ensureShiftStart().then((done) => { state.notice = null; addLog(done); }, (error) => { state.notice = { text: error.message, shiftStart: isAvailable() }; render(); });
return;
}
if (action === 'stop') {
if (state.paused) answerPause('stop');
else if (state.running && !state.stopRequested) { state.stopRequested = true; addLog('Stopping after this step'); }
return;
}
if (action === 'carry' || action === 'retry' || action === 'skip') { answerPause(action); return; }
// Everything below starts something, so it waits for any run to end.
if (state.running || state.checking) return;
if (action === 'start') { runAll(); return; }
if (action === 'startPc') { runSendBack(); return; }
if (action === 'startEo') { runEmailOnly(); return; }
if (action === 'checkParked') { checkParkedOnLive(); return; }
if (action === 'here') {
const chosen = hereChoice();
if (!chosen) { addLog('Tick the lead to set up again first'); return; }
runHere(chosen);
return;
}
if (action === 'paste') { pasteResults(); return; }
if (action === 'copySummary') {
navigator.clipboard.writeText(summaryForClipboard(leadsToDo(), loadProgress())).then(() => addLog('Summary copied'), () => addLog('Could not copy the summary'));
return;
}
if (action === 'clearRe') { try { localStorage.removeItem(PROGRESS_KEY); } catch (error) { /* ignore */ } render(); return; }
if (action === 'clearPasted') { try { localStorage.removeItem(PASTED_RESULTS_KEY); } catch (error) { /* ignore */ } render(); return; }
if (action === 'clearPc') { clearDeskProgress('pc'); return; }
if (action === 'clearEo') { clearDeskProgress('eo'); }
}

// The panel lives in its own shadow root: Konnect's styles cannot reach
// it, and the steps' page searches cannot mistake its buttons for Konnect's.
function buildPanel() {
const stale = document.getElementById(PANEL_ID);
if (stale) stale.remove();
if (!document.body || typeof document.body.appendChild !== 'function') return false;
const host = document.createElement('div');
host.id = PANEL_ID;
if (typeof host.attachShadow !== 'function') return false;
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>${STYLE}</style>
<div class="panel" role="dialog" aria-label="Lead Re setup">
<div class="head"><div class="title"><span aria-hidden="true">&#8635;</span><span>Lead Re setup</span><span class="mini-status" role="status"></span></div>
<button type="button" class="icon-btn" data-action="minimise" aria-label="Minimise">&ndash;</button>
<button type="button" class="icon-btn" data-action="close" aria-label="Hide" title="Hide (the Re setup button brings it back)">&times;</button></div>
<div class="link" role="status"></div>
<div class="body"></div>
<div class="foot"><button type="button" class="report" data-action="report">Report a problem</button><button type="button" class="stop-clear" data-action="clearStop" title="Stops any run, clears this tool's data and closes it">Clear &amp; Stop</button></div>
</div>
<button type="button" class="launcher" data-action="reopen" style="display:none;" title="Show Lead Re setup">&#8635; Re setup</button>`;
document.body.appendChild(host);
const panel = root.querySelector('.panel');
const head = root.querySelector('.head');
if (!panel || !head) return false;
ui = { host, root, panel, launcher: root.querySelector('.launcher'), minimised: false, listOpen: false, logOpen: false, stepsOpen: false, moreOpen: false, howOpen: false, corner: 0, position: loadPosition(), html: null, linkText: null };
root.addEventListener('click', onPanelClick);
root.addEventListener('change', (event) => {
if (event.target.getAttribute && event.target.getAttribute('data-action') === 'eoAgent') {
writeJson(SETTINGS_KEY, { ...(readJson(SETTINGS_KEY) || {}), emailOnlyAgent: event.target.value });
render();
}
});
root.addEventListener('toggle', (event) => {
const section = event.target.getAttribute && event.target.getAttribute('data-section');
const key = { list: 'listOpen', log: 'logOpen', steps: 'stepsOpen', more: 'moreOpen', how: 'howOpen' }[section];
if (key) ui[key] = event.target.open;
}, true);
root.addEventListener('mousedown', () => { ui.pointerDownAt = Date.now(); });
ui.onMouseUp = () => {
if (!ui) return;
ui.pointerDownAt = 0;
// After the click that this mouse up belongs to has been handled.
if (ui.renderPending) setTimeout(render, 0);
};
// Redraw when SLA Manager, in another tab on this site, saves new results,
// Email Only assignments or progress on the desk's request.
ui.onStorage = (event) => {
if (!ui) return;
if (event.key === LIVE_LINK_KEY) renderLinkLine();
else if (!state.running && [EMAIL_ONLY_ASSIGNED_KEY, NATIONAL_RESULTS_KEY, DESK_RESULTS_KEY, LIVE_STATUS_KEY].includes(event.key)) render();
};
if (typeof window.addEventListener === 'function') {
window.addEventListener('storage', ui.onStorage);
window.addEventListener('mouseup', ui.onMouseUp, true);
}
// Redraw when the agent moves to another page or customer, and as the
// results on show get older.
ui.pageTimer = setInterval(() => {
if (!ui) return;
// A redraw held back by a mouse press whose release was never seen.
if (ui.renderPending) { render(); return; }
if (state.running) { keepClear(); return; }
const inView = onCallPage() ? leadInView() : null;
const signature = `${onCallPage()}|${liveActivities().map(({ activity }) => activity.ID).join(',')}|${inView ? inView.ID : ''}|${ui.view === 'pc' ? resultsAgeLine() + hubStatusLine() : ''}`;
if (signature !== ui.pageSignature) { ui.pageSignature = signature; render(); } else keepClear();
}, 2000);
// The link line goes stale by the clock, with no storage event to say so.
ui.linkTimer = setInterval(renderLinkLine, 5000);
// Drag by the header to move the panel; where it is left is kept for the
// session.
head.addEventListener('mousedown', (event) => {
if (event.target.closest('button')) return;
const rect = panel.getBoundingClientRect();
const dx = event.clientX - rect.left;
const dy = event.clientY - rect.top;
let moved = null;
const move = (e) => {
moved = { left: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx)), top: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy)) };
placeAt(moved);
};
const up = () => {
window.removeEventListener('mousemove', move);
window.removeEventListener('mouseup', up);
if (!moved) return;
ui.position = moved;
try { sessionStorage.setItem(POSITION_KEY, JSON.stringify(moved)); } catch (error) { /* kept until the panel closes */ }
};
window.addEventListener('mousemove', move);
window.addEventListener('mouseup', up);
event.preventDefault();
});
render();
return true;
}

// What a second click of the bookmark reaches: it shows this panel again
// and puts the keyboard on it. replaceable: a newer version may take over,
// which is only so when no run is going.
const instance = {
show() {
if (!ui) return;
showPanel();
render();
const first = ui.root.querySelector('.body [data-action]') || ui.root.querySelector('[data-action="minimise"]');
if (first && !state.paused) first.focus({ preventScroll: true });
},
replaceable: () => !ui || (!state.running && !!(versionState && versionState.newer)),
unload
};

purgeExpired();
if (buildPanel()) window[INSTANCE_KEY] = instance;
})();
