(function() {
'use strict';

// Lead Re setup runs on the Konnect agent desktop. Re setup takes the
// leads the National check marked Re setup and, one at a time, adds a new
// lead with the same campaign, notes and dropdowns as the closed one, then
// parks the call; it never presses Finished. Post Closure sends the Lead
// Checker's "send back through" leads back from Parked Calls, and Email
// Only works the Email Only leads assigned in SLA Manager as they present;
// both press Finished. Send through sets the lead outcome on the agent's own
// leads the Lead Checker says need no call, as they present or from Parked
// Calls, so they go through to the dealership; it presses Finished too.
// When a step cannot be done safely it stops and says what to do by hand.

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
// What the agent decided on each lead in the three runs (done, skipped or
// stopped, and why), for SLA Manager's "Copy review decisions".
const DESK_DECISIONS_KEY = '_workToolsDeskDecisions';
const DESK_DECISIONS_MAX = 300;
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
// SEND THROUGH TO THE DEALERSHIP (pure parts)
// ===================================================================

// The leads the Lead Checker says need no call (tier 6, not Post Closure),
// saved by SLA Manager with the agent each was assigned to.
const SEND_THROUGH_KEY = '_workToolsSendThrough';
// The lead outcomes this run can set. The option wording is not confirmed
// against the real page, so options are matched by letters only.
const SEND_THROUGH_OUTCOMES = {
dealer: { label: 'In Progress with Dealer', path: ['Customer Hub Team', 'Ongoing', 'In Progress with Dealer'] },
defer: { label: 'Defer to Site', path: ['Customer Hub Team', 'Ongoing', 'Defer to Site'] },
misdirected: { label: 'Misdirected', path: ['Customer Hub Team', 'No Opportunity', 'Misdirected'] }
};
// Lead Checker sub category -> what to do. set: the outcome is chosen by the
// tool. recommend: the run stops and the owner chooses, with this one put
// first. Neither: the run stops with nothing recommended. A sub category
// that is not here stops too.
const SEND_THROUGH_MAP = {
'Already Booked': { set: 'dealer' },
'Send to Dealer': { set: 'dealer' },
'Existing Order': { set: 'dealer' },
'Inbound: Already Handled': { set: 'defer' },
Fleet: { set: 'defer' },
Complaint: { set: 'defer' },
'Cancelled / Withdrawn': { set: 'defer' },
Aftersales: { recommend: 'misdirected' },
'Agreement Hand-back': { recommend: 'misdirected' },
'Spam / Test': {},
'Non-Customer / Admin': {}
};

function lettersOnly(value) {
return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Pure. As chooseOptionIndex, but by letters and digits only, so case,
// spaces and punctuation in the page's wording do not matter.
function chooseOptionByLetters(optionTexts, wanted) {
const w = lettersOnly(wanted);
if (!w) return -1;
const exact = optionTexts.findIndex((t) => lettersOnly(t) === w);
if (exact >= 0) return exact;
const loose = optionTexts.map((t, i) => (lettersOnly(t).includes(w) ? i : -1)).filter((i) => i >= 0);
return loose.length === 1 ? loose[0] : -1;
}

// Pure. What the run does for a sub category: { stop, outcome, recommend },
// outcome and recommend being keys of SEND_THROUGH_OUTCOMES or ''.
function sendThroughPlan(subCategory) {
const wanted = lettersOnly(subCategory);
const name = wanted ? Object.keys(SEND_THROUGH_MAP).find((k) => lettersOnly(k) === wanted) : '';
const entry = name ? SEND_THROUGH_MAP[name] : {};
const outcome = SEND_THROUGH_OUTCOMES[entry.set] ? entry.set : '';
return { stop: !outcome, outcome, recommend: !outcome && SEND_THROUGH_OUTCOMES[entry.recommend] ? entry.recommend : '' };
}

// Pure. The outcome to set: the owner's choice when there is one, else the
// table's. '' means stop and ask: a recommendation is never applied by itself.
function sendThroughOutcome(lead, chosen) {
if (SEND_THROUGH_OUTCOMES[chosen]) return chosen;
return lead.stop ? '' : (lead.outcome || '');
}

// Pure. "Aftersales · you choose (Misdirected recommended)".
function sendThroughDetail(lead) {
const key = sendThroughOutcome(lead, lead.chosen);
const what = key ? SEND_THROUGH_OUTCOMES[key].label : lead.recommend ? `you choose (${SEND_THROUGH_OUTCOMES[lead.recommend].label} recommended)` : 'you choose';
return `${lead.subCategory || 'No sub category'} · ${what}`;
}

// Pure. The saved leads that are this agent's, each with its plan. A lead
// with no agent recorded is nobody's yet, so it is left out.
function sendThroughLeadsFrom(leads, me) {
const seen = new Set();
return (leads || []).filter((l) => l && me && l.agent === me).map((l) => ({
kind: 'st', key: personKey(l), name: l.name || '', email: l.email || '', phone: l.phone || '', campaign: l.campaign || '', created: l.created || '',
subCategory: l.subCategory || '', checkedAt: l.checkedAt || '', ...sendThroughPlan(l.subCategory)
})).filter((l) => l.key && !seen.has(l.key) && seen.add(l.key));
}

// Pure. Whose leads are shown: the one name recorded, or the name picked
// when there are several. '' while that has not been asked.
function agentAmong(agents, chosen) {
if (agents.length <= 1) return agents[0] || '';
return agents.includes(chosen) ? chosen : '';
}

// Pure. The open lead to send through, as an index into open ([{email,
// campaign, source}]), or -1 when that is unclear or there is none. A Post
// Closure lead is never it; then the email and the campaign decide, as for
// an Email Only lead.
function chooseSendThroughLead(open, lead) {
const pool = open.filter((a) => !/post closure processing/i.test(String(a.source || '')));
const index = chooseEmailOnlyLead(pool, lead);
return index >= 0 ? open.indexOf(pool[index]) : -1;
}

// Pure. The listed lead a presented lead is, or null: by any email read
// from it, then any phone number, then a name only one entry has.
function matchPresented(list, presented) {
for (const email of presented.emails || []) {
const found = email ? matchPerson(list, { email }) : null;
if (found) return found;
}
for (const phone of presented.phones || []) {
const found = matchPerson(list, { phone });
if (found) return found;
}
return matchPerson(list, { name: presented.name });
}

// Pure. One Parked Calls pass over the Post Closure send backs and the send
// through leads: those not yet done that are in Parked Calls, send backs
// first. A customer in both lists is two items, worked on one opening of
// the call: opens is false on an item whose customer the item before
// leaves open, and finishes is false on that item before.
function parkedWorkList(sendBacks, sendThroughs, done, parkedRows) {
const pending = (sendBacks || []).filter((l) => !(done.pc || {})[l.key]).map((lead) => ({ kind: 'pc', lead }))
.concat((sendThroughs || []).filter((l) => !(done.st || {})[l.key]).map((lead) => ({ kind: 'st', lead })))
.map((item) => ({ ...item, row: matchPerson(parkedRows || [], item.lead) }));
const found = pending.filter((item) => item.row);
const order = [];
found.forEach((item) => {
if (order.includes(item)) return;
order.push(item, ...found.filter((other) => other !== item && other.row === item.row && !order.includes(other)));
});
const items = order.map((item, i) => ({
kind: item.kind, lead: item.lead,
opens: !(i > 0 && order[i - 1].row === item.row),
finishes: !(i + 1 < order.length && order[i + 1].row === item.row)
}));
const missing = (kind) => pending.filter((item) => item.kind === kind && !item.row).length;
return { items, missing: { pc: missing('pc'), st: missing('st') } };
}

// Pure. The next status in the presenting run: as Email Only while the
// owner stays Available between leads, else Shift Start after each one.
function statusAfterSendThrough(leftAfterThis, stayAvailable) {
return stayAvailable ? statusAfterEmailOnly(leftAfterThis) : STATUS_WHILE_RESETTING;
}

// ===================================================================
// SELF-TESTS
// ===================================================================

// Pure. The decision rows still inside one shift, newest 300 at most.
function freshDecisions(rows, now) {
return (Array.isArray(rows) ? rows : [])
.filter((r) => { const age = r && r.at ? now - new Date(r.at).getTime() : NaN; return age >= 0 && age <= STORED_MAX_AGE_MS; })
.slice(-DESK_DECISIONS_MAX);
}

// Pure. One decision row. confirmed: what the agent said yes to on the way.
function decisionRow(mode, lead, outcome, step, confirmed, typedWhy, at) {
const run = mode === 'st' ? 'Send through' : mode === 'pc' ? 'Post Closure' : mode === 'eo' ? 'Email Only' : 'Re setup';
const detail = mode === 'st' ? sendThroughDetail(lead) : mode === 'pc' ? [String(lead.shorthand || '').toUpperCase(), lead.reason].filter(Boolean).join(' · ') : (lead.campaign || '');
const why = Array.from(new Set(confirmed || [])).concat(String(typedWhy || '').trim()).filter(Boolean).join('. ');
return { at, run, name: lead.name || '', detail, outcome, step: outcome === 'Done' ? '' : (step || ''), why };
}

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
const pcLead = { ID: 9, CreatedDate: '2026-11-14T10:09:00', CampaignName: 'Enquiry - Used', VehicleID: 5, SalesLeadJsonData: '{"a":1}', SalesLead: { SourceName: 'Post Closure Processing', Description: 'Wants a used 208', LeadDetails: { InitialNotes: 'Wants a used 208' } } };
const older = (id, over) => ({ ID: id, CreatedDate: '2026-11-12T20:10:00', CampaignName: 'Enquiry - Used', VehicleID: 5, SalesLeadJsonData: '', SalesLead: { SourceName: 'Cargurus', Description: '', LeadDetails: { InitialNotes: '' } }, ...over });
const idOf = (m) => [m.lead ? m.lead.ID : null, m.why || '', (m.close || []).map((a) => a.ID)];
check('the lead with the same lead data is the one it was raised for', idOf(matchOriginalLead(pcLead, [older(1), older(2, { SalesLeadJsonData: '{"a":1}' })])), [2, 'the same lead data', []]);
check('or the same Initial Notes, however they are spaced', idOf(matchOriginalLead(pcLead, [older(1), older(3, { SalesLead: { SourceName: 'Cargurus', LeadDetails: { InitialNotes: ' wants a  used 208 ' } } })])), [3, 'the same Initial Notes', []]);
check('the same car and campaign alone is not proof, and neither is being the only other lead', idOf(matchOriginalLead(pcLead, [older(1)])), [null, '', [1]]);
check('two leads with the same data are for the owner to tell apart, newest first', idOf(matchOriginalLead(pcLead, [older(1, { SalesLeadJsonData: '{"a":1}', CreatedDate: '2026-11-10T09:00:00' }), older(2, { SalesLeadJsonData: '{"a":1}' })])), [null, '', [2, 1]]);
check('a lead made after it, or another Post Closure lead, is never the one', idOf(matchOriginalLead(pcLead, [older(4, { SalesLeadJsonData: '{"a":1}', CreatedDate: '2026-11-14T11:00:00' }), older(5, { SalesLeadJsonData: '{"a":1}', SalesLead: { SourceName: 'Post Closure Processing' } })])), [null, '', []]);
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
const dNow = new Date('2026-11-11T10:00:00Z').getTime();
check('decisions older than 12 hours are dropped', freshDecisions([{ at: '2026-11-10T21:59:00Z', name: 'Old' }, { at: '2026-11-10T22:01:00Z', name: 'Kept' }, { name: 'No time' }], dNow).map((r) => r.name), ['Kept']);
check('decisions are capped at the newest 300', [freshDecisions(Array.from({ length: 305 }, (_, i) => ({ at: '2026-11-11T09:00:00Z', name: String(i) })), dNow).length, freshDecisions(Array.from({ length: 305 }, (_, i) => ({ at: '2026-11-11T09:00:00Z', name: String(i) })), dNow)[0].name], [300, '5']);
check('a Done row has no step and keeps what was confirmed', decisionRow('pc', { name: 'Jo Example', shorthand: 'cad', reason: 'Actioned by dealership' }, 'Done', 'Press Finished', ['Said this is the right customer', 'Said this is the right customer'], '', 'T'), { at: 'T', run: 'Post Closure', name: 'Jo Example', detail: 'CAD · Actioned by dealership', outcome: 'Done', step: '', why: 'Said this is the right customer' });
check('a Skipped row has the step and the typed reason', decisionRow('batch', { name: 'Jo Example', campaign: 'Vauxhall - Enquiry - Used' }, 'Skipped', 'Check before parking', [], ' already rang in ', 'T'), { at: 'T', run: 'Re setup', name: 'Jo Example', detail: 'Vauxhall - Enquiry - Used', outcome: 'Skipped', step: 'Check before parking', why: 'already rang in' });
check('Available until the last Email Only lead', [statusAfterEmailOnly(2), statusAfterEmailOnly(0)], ['Available', 'Shift Start']);
// Send through to the dealership.
const planOf = (sub) => { const p = sendThroughPlan(sub); return [p.stop, p.outcome, p.recommend].join('|'); };
check('send through: these go to In Progress with Dealer', ['Already Booked', 'Send to Dealer', 'Existing Order'].map(planOf), ['false|dealer|', 'false|dealer|', 'false|dealer|']);
check('send through: these go to Defer to Site', ['Inbound: Already Handled', 'Fleet', 'Complaint', 'Cancelled / Withdrawn'].map(planOf), ['false|defer|', 'false|defer|', 'false|defer|', 'false|defer|']);
check('send through: these stop with Misdirected recommended', ['Aftersales', 'Agreement Hand-back'].map(planOf), ['true||misdirected', 'true||misdirected']);
check('send through: these, and anything not in the table, stop with nothing recommended', ['Spam / Test', 'Non-Customer / Admin', 'Something New', '', undefined].map(planOf), ['true||', 'true||', 'true||', 'true||', 'true||']);
check('send through: the sub category is matched by letters only', [planOf('cancelled/withdrawn'), planOf(' INBOUND - already handled ')], ['false|defer|', 'false|defer|']);
check('send through: every path starts Customer Hub Team', Object.values(SEND_THROUGH_OUTCOMES).map((o) => o.path[0] + '|' + o.path.length), ['Customer Hub Team|3', 'Customer Hub Team|3', 'Customer Hub Team|3']);
check('send through: every table entry names an outcome that exists', Object.values(SEND_THROUGH_MAP).every((e) => (!e.set || SEND_THROUGH_OUTCOMES[e.set]) && (!e.recommend || SEND_THROUGH_OUTCOMES[e.recommend]) && !(e.set && e.recommend)), true);
const stops = Object.keys(SEND_THROUGH_MAP).concat('Something New').map((sub) => ({ subCategory: sub, ...sendThroughPlan(sub) })).filter((l) => l.stop);
check('send through: a stop is never automatic, recommended or not', [stops.length, stops.map((l) => sendThroughOutcome(l, '')).join(''), stops.map((l) => sendThroughOutcome(l, 'nonsense')).join('')], [5, '', '']);
check('send through: the owner\'s choice is what is set, over the recommendation', [sendThroughOutcome({ stop: true, outcome: '', recommend: 'misdirected' }, 'defer'), sendThroughOutcome({ stop: false, outcome: 'dealer' }, ''), sendThroughOutcome({ stop: false, outcome: 'dealer' }, 'defer')], ['defer', 'dealer', 'defer']);
check('send through: options are matched by letters only', [chooseOptionByLetters(['', 'In-Progress With  dealer', 'Defer To Site'], 'In Progress with Dealer'), chooseOptionByLetters(['', 'Mis-directed'], 'Misdirected'), chooseOptionByLetters(['', 'Misdirected - Sales', 'Misdirected - Service'], 'Misdirected'), chooseOptionByLetters(['', 'Ongoing'], '')], [1, 1, -1, -1]);
const saved = [
{ name: 'Ann Able', email: 'ann.able@example.com', phone: '07700 900201', campaign: 'Vauxhall - Enquiry - Used', subCategory: 'Already Booked', checkedAt: 'T', agent: 'Agent One' },
{ name: 'Bob Baker', email: '', phone: '07700 900202', campaign: 'Peugeot - Enquiry - New', subCategory: 'Aftersales', agent: 'Agent One' },
{ name: 'Cat Other', email: 'cat.other@example.com', subCategory: 'Fleet', agent: 'Agent Two' },
{ name: 'Del Nobody', email: 'del.nobody@example.com', subCategory: 'Fleet', agent: '' },
{ name: 'Ann Able', email: 'ANN.ABLE@example.com', subCategory: 'Fleet', agent: 'Agent One' }
];
const through = sendThroughLeadsFrom(saved, 'Agent One');
check('send through list: only this agent\'s leads, one per customer, with the plan', through.map((l) => [l.kind, l.key, l.name, l.stop, l.outcome, l.recommend].join('|')), ['st|ann.able@example.com|Ann Able|false|dealer|', 'st|7700900202|Bob Baker|true||misdirected']);
check('send through list: nobody remembered, or no agent recorded, lists nothing', [sendThroughLeadsFrom(saved, '').length, sendThroughLeadsFrom(saved, 'Agent Three').length, sendThroughLeadsFrom(null, 'Agent One').length], [0, 0, 0]);
check('send through list: the two lines per person', through.map(sendThroughDetail), ['Already Booked · In Progress with Dealer', 'Aftersales · you choose (Misdirected recommended)']);
check('which agent: the one recorded, or the one picked among several', [agentAmong([], 'X'), agentAmong(['Agent One'], ''), agentAmong(['Agent One', 'Agent Two'], ''), agentAmong(['Agent One', 'Agent Two'], 'Agent Two'), agentAmong(['Agent One', 'Agent Two'], 'Agent Nine')], ['', 'Agent One', '', 'Agent Two', '']);
const stOpen = [{ email: 'ann.able@example.com', campaign: 'Vauxhall - Post Closure', source: 'Post Closure Processing' }, { email: 'ann.able@example.com', campaign: 'Peugeot - Enquiry - New', source: 'AA Cars' }, { email: 'ann.able@example.com', campaign: 'Vauxhall - Enquiry - Used', source: 'AA Cars' }];
check('send through lead: a Post Closure lead is never it', [chooseSendThroughLead(stOpen.slice(0, 2), through[0]), chooseSendThroughLead(stOpen.slice(0, 1), through[0]), chooseSendThroughLead([], through[0])], [1, -1, -1]);
check('send through lead: the campaign picks among several, else it is unclear', [chooseSendThroughLead(stOpen, through[0]), chooseSendThroughLead(stOpen, { ...through[0], campaign: 'Citroen - Enquiry' }), chooseSendThroughLead(stOpen, { ...through[0], campaign: '' })], [2, -1, -1]);
check('presented lead: by any email, then any phone, then a name only one has', [
matchPresented(through, { name: 'Someone', emails: ['dealer@example.com', 'ANN.ABLE@example.com'], phones: [] }),
matchPresented(through, { name: 'Someone', emails: ['dealer@example.com'], phones: ['01632 960000', '+44 7700 900202'] }),
matchPresented(through, { name: 'Mr Bob Baker', emails: [], phones: [] }),
matchPresented(through, { name: 'Uma Unlisted', emails: ['uma.unlisted@example.com'], phones: ['07700 900299'] })
].map((l) => (l ? l.name : null)), ['Ann Able', 'Bob Baker', 'Bob Baker', null]);
const parkedRows = [{ name: 'Jo Example', email: 'jo@example.com' }, { name: 'Bob Baker', phone: '07700900202' }, { name: 'Ann Able', email: 'ann.able@example.com' }];
const backs = sendBack.concat(sendBackLeadsFrom([{ name: 'Ann Able', email: 'ann.able@example.com', postClosureAction: 'send back through', postClosureReason: 'Email only' }]));
const mixed = parkedWorkList(backs, through, { pc: {}, st: {} }, parkedRows);
check('parked pass: send backs and send through leads in one list, each with its kind', mixed.items.map((i) => `${i.kind}:${i.lead.name}`), ['pc:Jo Example', 'pc:Ann Able', 'st:Ann Able', 'st:Bob Baker']);
check('parked pass: a customer in both lists is two items on one opening of the call', mixed.items.map((i) => `${i.opens ? 'opens' : 'open already'}/${i.finishes ? 'finishes' : 'stays open'}`), ['opens/finishes', 'opens/stays open', 'open already/finishes', 'opens/finishes']);
check('parked pass: ones not in Parked Calls are counted and left alone', mixed.missing, { pc: 1, st: 0 });
check('parked pass: ones already done are not listed again', parkedWorkList(backs, through, { pc: { 'jo@example.com': 'Done', 'ann.able@example.com': 'Skipped' }, st: { 7700900202: 'Done' } }, parkedRows).items.map((i) => `${i.kind}:${i.lead.name}:${i.opens}:${i.finishes}`), ['st:Ann Able:true:true']);
check('parked pass: nothing parked, nothing to do', parkedWorkList(backs, through, {}, []), { items: [], missing: { pc: 3, st: 2 } });
check('send through status: Available until the last, or Shift Start after each', [statusAfterSendThrough(2, true), statusAfterSendThrough(0, true), statusAfterSendThrough(2, false)], ['Available', 'Shift Start', 'Shift Start']);
check('a send through decision row says what was chosen', decisionRow('st', { ...through[1], chosen: 'defer' }, 'Done', '', ['Recommended: Misdirected. Chose: Defer to Site'], '', 'T'), { at: 'T', run: 'Send through', name: 'Bob Baker', detail: 'Aftersales · Defer to Site', outcome: 'Done', step: '', why: 'Recommended: Misdirected. Chose: Defer to Site' });
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

function loadDecisions() {
const saved = readJson(DESK_DECISIONS_KEY);
return freshDecisions(saved && saved.rows, Date.now());
}
function saveDecisions(rows) {
try {
if (rows.length) writeJson(DESK_DECISIONS_KEY, { savedAt: new Date().toISOString(), rows });
else localStorage.removeItem(DESK_DECISIONS_KEY);
} catch (error) { /* storage blocked */ }
}

function loadSettings() {
const s = readJson(SETTINGS_KEY) || {};
return { reviewBeforePark: s.reviewBeforePark !== false, reviewBeforeFinish: s.reviewBeforeFinish !== false, emailOnlyAgent: s.emailOnlyAgent || '', stayAvailable: s.stayAvailable !== false };
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
// Read before choosing: Konnect drops its unknown "?" option once a real
// one is chosen, which moves every option up a place.
const wanted = optionTexts(select)[index];
chooseByIndex(select, index);
return normalise(selectedText(select)) === normalise(wanted);
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
// A safety question: carrying on is noted against the lead's decision.
this.confirms = o.confirms || '';
// A pause that asks for a decision, not a step done by hand: carrying on
// records the answer and runs the step again, so the step still does its
// work. Try again asks the same question again.
this.onConfirm = o.onConfirm || null;
// No carry on: the step cannot safely be passed over, only tried again.
this.noCarry = !!o.noCarry;
// A check by eye before something is pressed: Try again has no meaning.
this.review = !!o.review;
// A decision between named answers ([{ key, label, recommended }]), each
// offered as a button. onChoose is given the key pressed and returns what
// to note against the lead's decision; the step then runs again.
this.choices = o.choices || null;
this.onChoose = o.onChoose || null;
}
}

// Not stopped by Clear & Stop, as its notice offers this too.
async function ensureShiftStart() {
const button = statusButton();
if (button && normalise(button.textContent) === normalise(STATUS_WHILE_RESETTING)) return 'Status already Shift Start';
const item = byText(document, '[ng-click^="setMakeBusy"]', /^shift start$/i)[0];
if (!item) throw new NeedsYou('Could not find the Shift Start status. Set your status to Shift Start yourself.');
item.click();
// The button is drawn again when the status changes, so it is looked up
// afresh. A press that did not take is made once more.
let ok = await pollUntil(() => !button || normalise(currentStatus()) === normalise(STATUS_WHILE_RESETTING), 3000);
if (!ok) {
const again = byText(document, '[ng-click^="setMakeBusy"]', /^shift start$/i)[0];
if (again) again.click();
ok = await pollUntil(() => normalise(currentStatus()) === normalise(STATUS_WHILE_RESETTING), 4000);
}
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
throw new NeedsYou(`The closed lead is not on this customer, so this may be the wrong ${lead.name}. Go back and pick the right customer, or carry on if this is them.`, { carryOnLabel: 'This is them, carry on', confirms: 'Said this is the right customer', onConfirm: () => { ctx.allowOtherCustomer = true; } });
}
const adopted = adoptClosedLead(lead, closed && closed.activity, closedLeadPageNotes(closed && closed.activity));
Object.assign(lead, adopted.lead);
ctx.notesFrom = adopted.notesFrom;
const earlier = findEarlierReset(activities, lead);
if (earlier && !ctx.allowExisting) {
throw new NeedsYou(`This customer already has a ${lead.campaign} lead added by hand after the closed one, so it may already be set up again. Press Skip lead to leave it, or carry on to add another.`, { carryOnLabel: 'Add another lead', confirms: 'Added another lead as asked', onConfirm: () => { ctx.allowExisting = true; } });
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
throw new NeedsYou('Save was pressed but no new lead has shown. Look at the customer\'s leads: only add it again if there is no new one.', { carryOnLabel: 'No new lead there, add it again', confirms: 'Said no new lead was there, so it was added again', onConfirm: () => { ctx.savePressed = false; } });
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
// A control already in view needs nothing: pressing the heading again
// would fold the section away.
if (!panel || panel.classList.contains('panel-open') || isVisible(el)) return;
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
// pick: how an option is matched to the wanted text when it is not
// chooseOptionIndex; the page's own wording then stands in for ours.
async function setLeadOutcome(activity, path, pick) {
const indexIn = pick || chooseOptionIndex;
const picked = [];
if (!activity) throw new NeedsYou(`The lead was not found, so its outcome was left alone. Set it to ${path.join(' > ')} yourself, or skip this one.`);
const first = controlsOf(activity, 'select[ng-model^="theActivity.SelectedOutcomeLevel"]')[0];
if (first) revealSection(first);
for (let level = 0; level < path.length; level++) {
const select = await waitFor(() => {
const s = outcomeLevelSelects(activity)[level];
return s && indexIn(optionTexts(s), path[level]) >= 0 ? s : null;
}, 8000);
if (!select) throw new NeedsYou(`Could not choose "${path[level]}". Set the lead outcome to ${path.join(' > ')} yourself.`);
const wanted = pick ? optionTexts(select)[pick(optionTexts(select), path[level])] : path[level];
picked.push(wanted);
if (normalise(selectedText(select)) !== normalise(wanted)) {
if (!chooseByText(select, wanted)) throw new NeedsYou(`Could not choose "${path[level]}". Set the lead outcome to ${path.join(' > ')} yourself.`);
await sleep(600);
}
}
const chosen = outcomeLevelSelects(activity).slice(0, path.length).map(selectedText);
if (chosen.map(normalise).join('|') !== picked.map(normalise).join('|')) throw new NeedsYou(`The lead outcome did not stay as ${path.join(' > ')}. Set it yourself.`);
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

// Shift Start comes first every time, so no lead presents and no inbound is
// forced while Parked Calls is open: Konnect can leave an agent showing as
// Available in there and push them out. The status can only be read and set
// on the idle screen, so that is where this starts, and Parked Calls is not
// opened until the page itself shows Shift Start.
let parkedUnderShiftStart = '';
// Leaving Parked Calls ends that: the status may change before the next visit.
if (typeof window.addEventListener === 'function') window.addEventListener('hashchange', () => { if (!/\/search\/parked/i.test(location.hash)) parkedUnderShiftStart = ''; });
async function goToParked() {
const already = onParkedPage();
// Already in Parked Calls, put there by this tool under Shift Start.
if (already && parkedUnderShiftStart === location.hash) { await settledParkedRows(); return 'On Parked Calls'; }
parkedUnderShiftStart = '';
if (!already && onCallPage()) throw new NeedsYou('A call is open. Finish or park it yourself, then carry on.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
if (!onIdlePage()) {
const back = byClick(document, 'goBackToIdleView');
if (back) back.click();
if (!await waitFor(onIdlePage, 8000)) throw new NeedsYou('Go back to the idle screen and set your status to Shift Start, then press again.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
await sleep(300);
}
const status = await ensureShiftStart();
if (/^Status set/.test(status)) addLog(status);
// Changing status redraws the idle screen, which undoes a move made too
// soon after it.
if (/^Status set/.test(status)) await sleep(700);
// Checked once more on the page before going in.
if (normalise(currentStatus()) !== normalise(STATUS_WHILE_RESETTING)) {
throw new NeedsYou('Your status is not showing Shift Start. Set it yourself, then press again.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
}
// The page's own button is pressed: Konnect sends an address typed for it
// straight back to the idle screen. Its label carries a count.
const parkedNav = () => byClick(document, 'navToParkedCustomers')
|| byText(document, '[ng-click]', /^parked( (calls|customers))?( \d+)?$/i).find(isVisible);
const nav = parkedNav();
if (nav) nav.click(); else location.hash = '#!/search/parked';
// One more press if the first was swallowed by the redraw.
if (!await waitFor(onParkedPage, 5000)) { const again = parkedNav(); if (again) again.click(); }
if (!await waitFor(onParkedPage, 12000)) throw new NeedsYou('Parked Calls did not open. Open it yourself.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
parkedUnderShiftStart = location.hash;
await settledParkedRows();
return 'Opened Parked Calls';
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

// Pure. The lead a Post Closure lead was raised for, out of the customer's
// other leads. Konnect copies the enquiry onto the Post Closure lead, so the
// two share the same lead data and the same Initial Notes: either one
// matching is proof. Sharing only the car and campaign is not, and neither
// is being the only other lead. Returns { lead, why } when exactly one lead
// is proven, else { lead: null, close } with the nearest ones for the owner.
function matchOriginalLead(postClosure, others) {
const text = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
const notesOf = (a) => text(a && a.SalesLead && a.SalesLead.LeadDetails && a.SalesLead.LeadDetails.InitialNotes);
const madeAt = (a) => new Date((a && a.CreatedDate) || 0).getTime() || 0;
const candidates = (others || []).filter((a) => a && a !== postClosure
&& !/post closure processing/i.test(String((a.SalesLead && a.SalesLead.SourceName) || ''))
&& (!madeAt(postClosure) || !madeAt(a) || madeAt(a) <= madeAt(postClosure)));
const same = (get) => candidates.filter((a) => get(postClosure) && get(a) === get(postClosure));
const proofs = [
['the same lead data', same((a) => text(a.SalesLeadJsonData))],
['the same Initial Notes', same(notesOf)],
['the same description', same((a) => text(a.SalesLead && a.SalesLead.Description))]
];
for (const [why, found] of proofs) {
if (found.length === 1) return { lead: found[0], why };
// Several leads carry the same enquiry: the newest before it is the one
// it was raised for only when the others are older copies of it.
if (found.length > 1) return { lead: null, close: found.slice().sort((a, b) => madeAt(b) - madeAt(a)) };
}
const close = candidates.filter((a) => (postClosure.VehicleID && a.VehicleID === postClosure.VehicleID) || text(a.CampaignName) === text(postClosure.CampaignName));
return { lead: null, close: (close.length ? close : candidates).slice().sort((a, b) => madeAt(b) - madeAt(a)) };
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
throw new NeedsYou(`This customer's email is not the one the Lead Checker checked, so this may be the wrong ${lead.name}. Skip them, or carry on if this is them.`, { carryOnLabel: 'This is them, carry on', confirms: 'Said this is the right customer', onConfirm: () => { ctx.allowOtherEmail = true; } });
}
ctx.activity = activity;
// The note goes on the lead it was raised for, the outcome on the Post
// Closure lead: two tabs when the customer has both.
const others = liveActivities().map(({ activity: a }) => a).filter((a) => a !== activity);
// Only a proven match is used here. Where there is none, the note step
// looks on the Post Closure lead itself and asks only if it has to.
const match = others.length ? matchOriginalLead(activity, others) : { lead: null, close: [] };
ctx.original = match.lead || null;
ctx.originalChoices = match.lead ? [] : match.close;
if (!await bringLeadIntoView(ctx.original || activity)) throw new NeedsYou('Open the tab of the lead the Post Closure lead was raised for, then carry on.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
return ctx.original ? 'Post Closure lead found, with the lead it was raised for' : 'Post Closure lead found';
}

async function writePostClosureNote(ctx, lead) {
needKonnectNotes();
const PC_NOTES = 'textarea[ng-model$="LeadDetails.PostClosureNotes"]';
// On the lead it was raised for first, then the Post Closure lead itself.
let box = null;
for (const holder of [ctx.original, ctx.activity].filter(Boolean)) {
await bringLeadIntoView(holder);
const own = controlsOf(holder, PC_NOTES)[0];
if (own && !isVisible(own)) { revealSection(own); await sleep(400); }
box = (own && isVisible(own) ? own : null) || findLabelledBox('post closure notes');
if (box) { ctx.notesOn = holder; break; }
}
// No box on the Post Closure lead and no proven match: the owner says
// which lead it was raised for, and the note goes there.
if (!box && !ctx.original && (ctx.originalChoices || []).length) {
ctx.original = leadPickedByAgent(ctx, ctx.originalChoices, 'Post Closure Notes are on the lead this one was raised for, and it is not certain which that is.');
await bringLeadIntoView(ctx.original);
const own = controlsOf(ctx.original, PC_NOTES)[0];
if (own && !isVisible(own)) { revealSection(own); await sleep(400); }
box = (own && isVisible(own) ? own : null) || findLabelledBox('post closure notes');
if (box) ctx.notesOn = ctx.original;
}
const typeIt = { carryOnLabel: 'Typed it, check again', onConfirm: () => {} };
if (!box) throw new NeedsYou(`Could not find Post Closure Notes. Type ${lead.shorthand} there and press space yourself.`, typeIt);
if (SHORTHAND_MARKERS[lead.shorthand].test(box.value)) return `${lead.shorthand.toUpperCase()} note already in Post Closure Notes`;
if (!await typeShorthand(box, lead.shorthand, [callNotesBoxOf(ctx.notesOn || ctx.activity)])) {
throw new NeedsYou(`Konnect Notes did not write the note, so the notes were put back as they were. Type ${lead.shorthand} in Post Closure Notes and press space yourself.`, typeIt);
}
ctx.wrote = `the ${lead.shorthand.toUpperCase()} note`;
return `${lead.shorthand.toUpperCase()} written in Post Closure Notes`;
}

const SEND_BACK_RUN = [
{ label: 'Go to Parked Calls', run: goToParked, part: 'open' },
{ label: 'Open the customer', run: openParkedCustomer, part: 'open' },
{ label: 'Find the Post Closure lead', run: findPostClosureLead },
{ label: 'Write CAD or CAH in Post Closure Notes', run: writePostClosureNote },
{ label: 'Call outcome: Update Outcomes', run: () => chooseCallOutcome(OUTCOME_UPDATE_ONLY) },
{ label: 'Lead outcome: Customer Hub Team > No Opportunity > Catch All', run: async (ctx, lead) => { await bringLeadIntoView(ctx.activity); return setLeadOutcome(ctx.activity, SEND_BACK_OUTCOME_PATH.concat(lead.outcome)); } },
{ label: 'Next status: Shift Start', run: () => setNextStatus(STATUS_WHILE_RESETTING), part: 'finish' },
{ label: 'Check before Finished', run: reviewBeforeFinish, part: 'finish' },
{ label: 'Press Finished', run: pressFinished, part: 'finish' }
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
const phones = new Set();
let name = '';
const walk = (value, depth) => {
if (!value || depth > 5) return;
if (typeof value === 'string') { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) emails.add(value.trim()); return; }
if (typeof value !== 'object') return;
if (Array.isArray(value)) { value.slice(0, 20).forEach((v) => walk(v, depth + 1)); return; }
if (!name && typeof value.CustomerName === 'string') name = value.CustomerName;
if (!name && typeof value.Forename === 'string') name = `${value.Forename} ${value.Surname || ''}`;
Object.keys(value).filter((k) => !/^\$/.test(k)).slice(0, 80).forEach((k) => {
if (/phone|mobile|tel|number/i.test(k) && /^(string|number)$/.test(typeof value[k]) && digitsOf(value[k]).length >= 10) phones.add(String(value[k]));
walk(value[k], depth + 1);
});
};
walk(call, 0);
// The page's own text as well, in case the data sits elsewhere. Only an
// assigned lead's email can match, so other emails on the page do no harm.
const main = document.querySelector('[ng-view], .main-content, main') || document.body;
(String(main.innerText || '').match(EMAIL_PATTERN) || []).forEach((e) => emails.add(e));
return { name: name.trim(), emails: Array.from(emails), phones: Array.from(phones) };
}

// yours: the leads the agent is going Available for, as the messages name them.
async function ensureAvailable(yours) {
const what = yours || 'Email Only leads';
if (onPresentPage() || onCallPage()) return 'A lead is already open';
if (isAvailable()) return 'Status already Available';
const item = byText(document, '[ng-click^="setMakeBusy"], [ng-click^="setAvailable"], .dropdown-menu [ng-click]', /^available$/i)[0];
if (!item) throw new NeedsYou(`Set your status to Available yourself so your ${what} present.`, { carryOnLabel: 'Done, wait for leads' });
item.click();
// A lead may present straight away, which also shows it worked.
if (!statusButton()) { await sleep(1000); return 'Available pressed (your status could not be read from the page to confirm it)'; }
if (!await waitFor(() => isAvailable() || onPresentPage() || onCallPage(), 5000)) {
throw new NeedsYou(`Your status did not change to Available. Set it yourself so your ${what} present.`, { carryOnLabel: 'Done, wait for leads' });
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
throw new NeedsYou(`The EO note in Call Notes has ${note.found}, but the assigned lead's email is ${lead.email}. Check which is right and correct the note.`, { carryOnLabel: 'The note is right, carry on', confirms: 'Said the email in the EO note is right', onConfirm: () => { ctx.noteEmailAccepted = note.found; } });
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

// The customer may have other open leads: a Post Closure lead is never the
// one, the checked lead's email and campaign pick between the rest, and the
// agent does when they cannot.
async function findSendThroughLead(ctx, lead) {
const open = (await settledLeads()).map(({ activity }) => activity).filter(isOpenLead);
const source = (a) => String((a.SalesLead && a.SalesLead.SourceName) || '');
const candidates = open.filter((a) => !/post closure processing/i.test(source(a)));
if (!candidates.length) throw new NeedsYou('No open lead to send through was found on this customer. Do this one yourself and skip it.', { noCarry: true });
const index = chooseSendThroughLead(open.map((a) => ({ email: a.SalesLead && a.SalesLead.EmailAddress, campaign: a.CampaignName, source: source(a) })), lead);
const activity = index >= 0 ? open[index] : leadPickedByAgent(ctx, candidates, `This customer has ${candidates.length} open leads and it is not clear which is the one to send through${lead.campaign ? ` (checked on ${lead.campaign})` : ''}.`);
ctx.activity = activity;
if (!await bringLeadIntoView(activity)) throw new NeedsYou('Open the tab of the lead to send through yourself, then carry on.', { carryOnLabel: 'Done, carry on', onConfirm: () => {} });
return candidates.length > 1 ? `Lead to send through found (${activity.CampaignName || 'picked by you'})` : 'Lead to send through found';
}

// The outcome comes from the table, or the run stops here for the owner to
// choose: nothing has been changed on the lead at this point. What was
// recommended and what was chosen go on the lead's decision.
function chooseSendThroughOutcome(ctx, lead) {
const key = sendThroughOutcome(lead, lead.chosen);
if (key) return `${lead.stop ? 'You chose' : 'Outcome for ' + (lead.subCategory || 'this lead') + ':'} ${SEND_THROUGH_OUTCOMES[key].path.join(' > ')}`;
const recommended = lead.recommend ? SEND_THROUGH_OUTCOMES[lead.recommend] : null;
const says = lead.subCategory ? `The Lead Checker says: ${lead.subCategory}.` : 'The Lead Checker gave no sub category.';
const message = recommended
? `${says} Recommended: ${recommended.path.join(' > ')}. Choose the lead outcome, or skip to leave the lead as it is.`
: `Not sure where this one goes. ${says} Choose the lead outcome, or skip to leave the lead as it is.`;
throw new NeedsYou(message, {
noCarry: true,
choices: ['defer', 'dealer', 'misdirected'].map((k) => ({ key: k, label: SEND_THROUGH_OUTCOMES[k].label, recommended: k === lead.recommend })),
onChoose: (chosen) => {
if (!SEND_THROUGH_OUTCOMES[chosen]) return '';
lead.chosen = chosen;
return `Recommended: ${recommended ? recommended.label : 'nothing'}. Chose: ${SEND_THROUGH_OUTCOMES[chosen].label}`;
}
});
}

function setSendThroughOutcome(ctx, lead) {
return setLeadOutcome(ctx.activity, SEND_THROUGH_OUTCOMES[sendThroughOutcome(lead, lead.chosen)].path, chooseOptionByLetters);
}

function setSendThroughStatus(ctx) {
ctx.nextStatus = statusAfterSendThrough(ctx.leftAfterThis, loadSettings().stayAvailable);
return setNextStatus(ctx.nextStatus);
}

// No note is written for any of the outcomes. A note step would go here:
// both runs below take these steps between the call outcome and the lead
// outcome.
const SEND_THROUGH_NOTE_STEPS = [];

const SEND_THROUGH_CORE = [
{ label: 'Find the lead to send through', run: findSendThroughLead },
{ label: 'Choose the lead outcome', run: chooseSendThroughOutcome },
{ label: 'Call outcome: Update Outcomes', run: () => chooseCallOutcome(OUTCOME_UPDATE_ONLY) },
...SEND_THROUGH_NOTE_STEPS,
{ label: 'Set the lead outcome under Customer Hub Team', run: setSendThroughOutcome }
];

// As they present.
const SEND_THROUGH_RUN = [
{ label: 'Press Reject (opens it without dialling)', run: rejectPresented },
{ label: 'Call outcome back to (Select a Call Outcome)', run: () => chooseCallOutcome(OUTCOME_NONE) },
...SEND_THROUGH_CORE,
{ label: 'Next status', run: setSendThroughStatus },
{ label: 'Check before Finished', run: reviewBeforeFinish },
{ label: 'Press Finished', run: pressFinished }
];

// From Parked Calls, in the Post Closure pass.
const SEND_THROUGH_PARKED_RUN = [
{ label: 'Go to Parked Calls', run: goToParked, part: 'open' },
{ label: 'Open the customer', run: openParkedCustomer, part: 'open' },
...SEND_THROUGH_CORE,
{ label: 'Next status: Shift Start', run: () => setNextStatus(STATUS_WHILE_RESETTING), part: 'finish' },
{ label: 'Check before Finished', run: reviewBeforeFinish, part: 'finish' },
{ label: 'Press Finished', run: pressFinished, part: 'finish' }
];

// The steps for one item of the Parked Calls pass. A customer with two
// items is opened for the first and finished after the second.
function parkedSteps(item) {
return (item.kind === 'st' ? SEND_THROUGH_PARKED_RUN : SEND_BACK_RUN).filter((step) => (item.opens || step.part !== 'open') && (item.finishes || step.part !== 'finish'));
}

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
// Hidden with Alt+H: a pause brings the tools back so it is seen.
if (window.WorkTools && window.WorkTools.show) window.WorkTools.show('Lead Re setup needs you.');
state.paused = { message: error.message, carryOnLabel: error.carryOnLabel, noCarry: !!error.noCarry, review: !!error.review, inLead: !!inLead, choices: inLead && error.choices ? error.choices : null };
if (ui) { ui.skipAsk = false; ui.choiceWhy = ''; }
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

// What a skipped or stopped lead leaves on the page for the agent, one
// short phrase per thing, none when nothing.
function leftParts(ctx) {
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
return parts;
}

// The same in one sentence, '' when nothing.
function leftAsIs(ctx) {
const parts = leftParts(ctx);
return parts.length ? `Left as it is: ${parts.join('; ')}.` : '';
}

// Runs one lead through a list of steps. Returns 'Done', 'Skipped', or
// null when stopped.
async function runLeadSteps(lead, steps) {
state.steps = steps;
let outcome = 'Done';
const confirmed = [];
if (ui) { ui.skipWhy = ''; ui.skipAsk = false; }
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
if (answer && answer.choose) {
const note = needsYou.onChoose ? needsYou.onChoose(answer.choose) : '';
if (note) confirmed.push([note, answer.why ? `Why: ${answer.why}` : ''].filter(Boolean).join('. '));
continue;
}
if (answer === 'carry') {
if (needsYou.confirms) confirmed.push(needsYou.confirms);
if (needsYou.onConfirm) needsYou.onConfirm(); else state.stepIndex++;
continue;
}
if (answer === 'skip') { outcome = 'Skipped'; break; }
outcome = null;
state.stopRequested = true;
break;
}
}
// Clear & Stop returned above: it removes the decisions, so adds none.
const step = steps[state.stepIndex];
const rows = loadDecisions();
rows.push(decisionRow(lead.kind === 'st' ? 'st' : state.mode, lead, outcome || 'Stopped', step ? step.label : '', confirmed, ui ? ui.skipWhy : '', new Date().toISOString()));
saveDecisions(freshDecisions(rows, Date.now()));
if (ui) { ui.skipWhy = ''; ui.skipAsk = false; }
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
const parts = stopped ? leftParts(state.ctx) : [];
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
state.notice = left || available ? { text: lines.join(' '), shiftStart: available, stopped, parts } : null;
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

// "Checked 5 min ago", by the newest result.
function resultsAgeLine() {
const saved = postClosureSaved();
const results = postClosureResults();
if (!saved || !results.length) return '';
const newest = results.map((r) => r.checkedAt || saved.savedAt).sort().pop();
return `Checked ${ageText(newest, Date.now())}`;
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
// Said in the panel, not only the log: a press that did nothing looked
// like the button was broken.
if (!halted && !(error instanceof Halted)) { addLog(error.message); state.notice = { text: error.message, shiftStart: isAvailable() }; render(); }
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

// Whose Email Only leads these are: the one name recorded, or the name the
// agent picked when there are several. '' while that has not been asked.
function emailOnlyMe() {
const agents = emailOnlyAgents();
if (agents.length <= 1) return agents[0] || '';
const chosen = loadSettings().emailOnlyAgent;
return agents.includes(chosen) ? chosen : '';
}

// True when the agent has to say who they are before any lead is listed.
function emailOnlyAsk() {
return emailOnlyAgents().length > 1 && !emailOnlyMe();
}

// Only this agent's own leads, as those are the ones that present here.
function emailOnlyLeads() {
if (emailOnlyAsk()) return [];
const me = emailOnlyMe();
return emailOnlySaved().filter((l) => !me || l.agent === me).map((l) => ({ ...l, key: normalise(l.email) }));
}

function sendThroughSaved() {
const saved = readJson(SEND_THROUGH_KEY);
return saved && isFresh(saved.savedAt) && Array.isArray(saved.leads) ? saved.leads.filter((l) => l && isFresh(l.checkedAt || saved.savedAt)) : [];
}

// Every agent name SLA Manager recorded, so the one "which agent are you"
// answer serves Email Only and Send through alike.
function sendThroughAgents() {
return Array.from(new Set(emailOnlyAgents().concat(sendThroughSaved().map((l) => l.agent).filter(Boolean))));
}

function sendThroughMe() {
return agentAmong(sendThroughAgents(), loadSettings().emailOnlyAgent);
}

function sendThroughAsk() {
return sendThroughSaved().length > 0 && sendThroughAgents().length > 1 && !sendThroughMe();
}

// Only this agent's own leads, with what the run will do for each.
function sendThroughLeads() {
return sendThroughLeadsFrom(sendThroughSaved(), sendThroughMe());
}

function loadDeskProgress() {
const p = readJson(DESK_PROGRESS_KEY);
return p && isFresh(p.savedAt) ? { savedAt: p.savedAt, pc: p.pc || {}, eo: p.eo || {}, st: p.st || {} } : { savedAt: new Date().toISOString(), pc: {}, eo: {}, st: {} };
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
const { items, missing } = parkedWorkList(sendBackLeads(), sendThroughLeads(), progress, readSearchRows().rows);
if (missing.pc) addLog(`${missing.pc} not in your Parked Calls, left alone`);
if (missing.st) addLog(`${missing.st} send through lead${missing.st === 1 ? '' : 's'} not in your Parked Calls, left for when ${missing.st === 1 ? 'it presents' : 'they present'}`);
state.deskCount = { done: 0, total: items.length };
for (const item of items) {
const lead = item.lead;
if (state.stopRequested) break;
state.deskLead = lead;
state.ctx = { log: addLog, settings };
addLog(`Started ${lead.name} (${item.kind === 'st' ? 'send through' : lead.shorthand.toUpperCase()})`);
// A customer the item before was meant to leave open is opened again
// when the call is no longer there (that item was skipped and parked).
const outcome = await runLeadSteps(lead, parkedSteps({ ...item, opens: item.opens || !onCallPage() }));
if (!outcome) break;
progress[item.kind][lead.key] = outcome;
saveDeskProgress(progress);
state.deskCount.done++;
addLog(`${outcome}: ${lead.name}`);
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn(skippedMessage('the next one can start'), 'Done, next one')) break;
state.ctx = null;
}
if (!state.stopRequested && !halted) addLog(items.some((item) => item.kind === 'st') ? 'All Post Closure send backs and parked send through leads are done' : 'All Post Closure send backs are done');
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

// The two runs that take leads as they present, and how each names its leads.
const PRESENT_RUNS = {
eo: { leads: () => emailOnlyLeads(), match: matchEmailOnly, steps: EMAIL_ONLY_RUN, yours: 'Email Only leads', one: 'Email Only lead', listed: 'the Email Only leads you assigned' },
st: { leads: () => sendThroughLeads(), match: matchPresented, steps: SEND_THROUGH_RUN, yours: 'send through leads', one: 'send through lead', listed: 'your send through leads' }
};

async function runPresenting(mode) {
if (state.running) return;
const run = PRESENT_RUNS[mode];
beginRun(mode);
try {
const settings = loadSettings();
const progress = loadDeskProgress();
const left = () => run.leads().filter((l) => !progress[mode][l.key]);
state.deskCount = { done: 0, total: left().length };
if (!left().length) { addLog(`No ${run.yours} left to do`); return; }
if (!onPresentPage() && !onCallPage() && !await outsideLead(() => ensureAvailable(run.yours), false)) return;
// Send through with "Stay Available between leads" off: the lead just
// finished left the agent on Shift Start, and the next is only asked for
// when they say so.
let resting = false;
while (left().length && !state.stopRequested) {
state.deskLead = null;
render();
if (resting && !onPresentPage() && !onCallPage()) {
resting = false;
if (!await askToCarryOn('You are on Shift Start, as Stay Available between leads is off. Carry on to go Available for the next one.', 'Go Available for the next')) break;
if (!await outsideLead(() => ensureAvailable(run.yours), false)) break;
}
if (!onPresentPage() && !onCallPage() && !await waitForPresentedLead()) break;
if (onCallPage() && !onPresentPage()) {
if (!await askToCarryOn(`A call is already open. Finish it yourself; your next ${run.one} will be picked up after.`, 'Done, wait for the next')) break;
continue;
}
const presented = presentedPerson();
const lead = run.match(left(), presented);
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
addLog(`A lead that is not one of your ${run.yours} presented; ${opened ? 'rejected so it does not dial, and' : ''} left to you`);
const message = opened
? `This lead is not one of ${run.listed}. It has been rejected so it does not dial, and the call outcome is back to (Select a Call Outcome). Deal with it yourself and finish or park it, then carry on to wait for the next.`
: `This lead is not one of ${run.listed}, and it could not be rejected. Reject it yourself before it dials, deal with it, then carry on to wait for the next.`;
if (!await askToCarryOn(message, 'Done, wait for the next')) break;
continue;
}
state.deskLead = lead;
state.ctx = { log: addLog, settings, leftAfterThis: left().length - 1 };
addLog(`Started ${lead.name}`);
const outcome = await runLeadSteps(lead, run.steps);
if (!outcome) break;
progress[mode][lead.key] = outcome;
saveDeskProgress(progress);
state.deskCount.done++;
addLog(`${outcome}: ${lead.name}`);
if (outcome === 'Skipped' && onCallPage() && !await askToCarryOn(skippedMessage('the next one can present'), 'Done, wait for the next')) break;
resting = outcome === 'Done' && left().length > 0 && state.ctx.nextStatus === STATUS_WHILE_RESETTING;
state.ctx = null;
}
// The status is read from the page: a skipped last lead leaves it Available.
if (!state.stopRequested && !halted && !left().length) addLog(`All your ${run.yours} are done; your status is ${currentStatus() || 'not readable from the page'}`);
} catch (error) {
logRunError(error);
} finally {
endRun();
}
}

const runEmailOnly = () => runPresenting('eo');
const runSendThrough = () => runPresenting('st');

// ===================================================================
// PANEL
// ===================================================================

// One frame: a teal header with Hide and the one More menu, the link strip,
// the body, and a footer that says the current stop setting in words.
const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel { position: fixed; bottom: 68px; left: 20px; width: 360px; max-width: calc(100vw - 32px); max-height: calc(100vh - 88px); display: flex; flex-direction: column; z-index: 2147483000;
  --bg: #f2f2f7; --surface: #ffffff; --text: #1c1c1e; --muted: #5b6577; --border: #dfe3ea; --head: #0d3b3a; --pri: #0f766e; --acc: #0f766e; --tint: #dcf3f0; --ring: #1c1c1e;
  --ok: #047857; --ok-t: #dff5ec; --warn: #a85a00; --warn-t: #fdf0dc; --bad: #c62828; --bad-t: #fde8e8; --info: #1d4ed8; --info-t: #e3ebfd; --amber: #b4530a;
  background: var(--bg); color: var(--text); border-radius: 16px; box-shadow: 0 14px 34px rgba(15, 23, 42, .22), 0 2px 6px rgba(15, 23, 42, .08);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
.panel.paused { width: 300px; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: left; }
svg.ic { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.head { display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: var(--head); color: #fff; cursor: move; user-select: none; flex-shrink: 0; border-radius: 16px 16px 0 0; }
.panel.paused .head { background: var(--amber); }
.head .title { font-weight: 700; font-size: 13.5px; flex: 1; display: flex; align-items: baseline; gap: 8px; min-width: 0; white-space: nowrap; }
.head .sub { font-weight: 500; opacity: .8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.hbtn { display: inline-flex; align-items: center; gap: 5px; color: #fff; background: rgba(255,255,255,.14); border-radius: 8px; padding: 5px 9px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.hbtn:hover { background: rgba(255,255,255,.24); }
.hbtn.quiet { background: transparent; }
.hbtn.quiet:hover, .hbtn[aria-expanded="true"] { background: rgba(255,255,255,.24); }
.hbtn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.link { flex-shrink: 0; display: flex; align-items: center; gap: 7px; padding: 6px 12px; min-height: 31px; font-size: 12px; color: var(--muted); background: var(--surface); border-bottom: 1px solid var(--border); }
.link.warn { background: var(--warn-t); color: #7a3d00; }
.link.bad { background: var(--bad-t); color: var(--bad); font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
.dot.off { background: #8a93a3; } .dot.busy { background: var(--info); } .dot.warn { background: #d98200; } .dot.bad { background: var(--bad); }
.body { padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.body > * { flex-shrink: 0; }
.foot { flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 12px; background: var(--surface); border-top: 1px solid var(--border); border-radius: 0 0 16px 16px; font-size: 11.5px; color: var(--muted); }
.panel.paused .foot, .panel.paused .link { display: none; }
.card { background: var(--surface); border-radius: 12px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
.col { display: flex; flex-direction: column; gap: 8px; }
.muted { color: var(--muted); }
.small { font-size: 11.5px; }
.quiet-line { font-size: 11.5px; color: var(--muted); }
.alert { border-radius: 12px; padding: 10px; font-size: 12.5px; display: flex; flex-direction: column; gap: 8px; }
.alert.red { background: var(--bad-t); color: #8f1d1d; border: 1px solid #efb4b4; }
.alert.amber { background: #fff8e6; color: #7a3d00; border: 1px solid #f1d98a; }
.alert ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.alert li { display: flex; gap: 7px; align-items: flex-start; }
.alert li svg { margin-top: 2px; }
.big-count { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.big-count strong { font-size: 28px; line-height: 1; }
.cf { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 11.5px; color: var(--muted); }
.chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; background: var(--surface); border: 1px solid var(--border); color: var(--text); white-space: nowrap; }
.chip.ok { background: var(--ok-t); border-color: transparent; color: var(--ok); }
.chip.warn { background: var(--warn-t); border-color: transparent; color: var(--warn); }
.chip.info { background: var(--info-t); border-color: transparent; color: var(--info); }
.chip.acc { background: var(--tint); border-color: transparent; color: var(--acc); }
.chip.wrap { white-space: normal; align-self: flex-start; border-radius: 10px; }
/* 20px is a full pill on one line and a tidy rounded box if a long label wraps. */
.btn { font-weight: 600; font-size: 12px; line-height: 1.3; text-align: center; border-radius: 20px; padding: 6px 11px; border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.btn.primary { background: var(--pri); color: #fff; font-weight: 700; font-size: 12.5px; padding: 8px 14px; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.sec { background: var(--surface); color: var(--text); border-color: #c5cbd6; }
.btn.sec:hover { border-color: var(--acc); }
.btn.txt { color: var(--acc); text-decoration: underline; text-underline-offset: 2px; padding: 2px 4px; border-radius: 6px; }
.btn.danger { color: var(--bad); font-weight: 700; padding: 6px 8px; }
.btn.danger:hover { background: var(--bad-t); }
.btn.wide { width: 100%; }
.btn.primary.wide { padding: 10px 14px; font-size: 13.5px; }
.btn.small { white-space: nowrap; }
.btn:focus-visible, .tab:focus-visible, summary:focus-visible, input:focus-visible, .av:focus-visible, .rmain:focus-visible, .mi:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.grow { flex: 1; min-width: 0; }
.tabs { display: flex; gap: 3px; background: #e5e5ea; border-radius: 10px; padding: 3px; }
.tab { flex: 1; font-size: 12px; font-weight: 600; text-align: center; color: var(--muted); border-radius: 8px; padding: 6px 4px; white-space: nowrap; }
.tab.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.tab em { font-style: normal; font-size: 10.5px; background: var(--tint); color: var(--acc); border-radius: 999px; padding: 0 6px; margin-left: 4px; }
.track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; background: var(--pri); border-radius: 3px; transition: width .3s; }
.av { width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: var(--tint); color: var(--acc); flex: none; text-align: center; }
button.av:hover { box-shadow: 0 0 0 2px var(--acc); }
.av.grn { background: var(--ok-t); color: var(--ok); } .av.gry { background: #e9ebf0; color: #4b5565; } .av.amb { background: var(--warn-t); color: var(--warn); }
.g { display: flex; flex-direction: column; gap: 6px; }
.grp { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 12.5px; padding: 2px 2px 0; }
.grp span { color: var(--muted); font-weight: 500; }
.list { background: var(--surface); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.05); max-height: 250px; overflow-y: auto; }
.r { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 9px; align-items: center; padding: 8px 10px; }
.r + .r { border-top: 1px solid var(--border); }
.rmain { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; min-width: 0; width: 100%; border-radius: 6px; }
.nm { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.meta { grid-column: 1 / 3; font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r .more { grid-column: 2; display: none; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: 12px; }
.r.open .more { display: block; }
.r.open .meta, .r.open .nm { white-space: normal; overflow-wrap: anywhere; }
dl.kv { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; overflow-wrap: anywhere; }
.tag { font-size: 10.5px; font-weight: 700; border-radius: 6px; padding: 1px 6px; white-space: nowrap; flex: none; }
.tag.done { background: var(--ok-t); color: var(--ok); } .tag.wait { background: #e9ebf0; color: #4b5565; } .tag.ck { background: var(--warn-t); color: var(--warn); } .tag.next { background: var(--tint); color: var(--acc); }
.lead-name { font-weight: 700; overflow-wrap: anywhere; }
.steps { display: grid; gap: 6px; font-size: 12.5px; }
.step { display: flex; gap: 8px; align-items: center; }
.step.current, .step.needs { font-weight: 700; }
.step.needs { color: var(--amber); }
.step.todo { color: var(--muted); }
.num { width: 20px; height: 20px; border-radius: 50%; background: var(--tint); color: var(--acc); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.step.done .num { background: var(--ok); color: #fff; }
.step.current .num { background: var(--pri); color: #fff; }
.step.needs .num { background: var(--amber); color: #fff; }
details.step-fold > summary { padding: 0; font-weight: 500; justify-content: flex-start; border-radius: 6px; }
.step-fold ol { margin: 4px 0 2px 28px; padding: 0; list-style: none; display: grid; gap: 2px; font-size: 11.5px; color: var(--muted); }
.needs-card { background: #fff8e6; border: 2px solid #e9a13b; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; box-shadow: none; }
.needs-card .who { font-size: 11.5px; color: #7a3d00; overflow-wrap: anywhere; }
.needs-card .ask { margin: 2px 0 0; font-size: 13px; font-weight: 600; color: #5a2c00; overflow-wrap: anywhere; }
.needs-card .others { justify-content: space-between; }
.needs-card .why { display: block; width: 100%; font: inherit; font-size: 12px; color: var(--text); background: #fff; border: 1px solid #e5c98b; border-radius: 10px; padding: 6px 10px; }
.needs-card .why::placeholder { color: #8a6d3b; }
.needs-card .choices { display: flex; flex-direction: column; gap: 6px; }
.tgs { display: inline-flex; gap: 4px; align-items: center; }
.sw { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; font-weight: 600; font-size: 12.5px; padding: 7px 10px; border-radius: 10px; background: var(--bg); }
.sw .knob { flex: none; width: 34px; height: 20px; border-radius: 999px; background: #b8bfcc; position: relative; transition: background .15s; }
.sw .knob::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
.sw[aria-checked="true"] .knob { background: var(--pri); }
.sw[aria-checked="true"] .knob::after { left: 16px; }
.sw:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
details.fold { background: var(--surface); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
summary { cursor: pointer; padding: 9px 10px; font-weight: 700; font-size: 12.5px; display: flex; justify-content: space-between; align-items: center; list-style: none; border-radius: 12px; }
summary::-webkit-details-marker { display: none; }
summary .count { color: var(--muted); font-weight: 500; }
.fold-body { padding: 0 10px 10px; }
.log { padding: 0 10px 10px; font-size: 11.5px; color: var(--muted); max-height: 150px; overflow-y: auto; display: grid; gap: 2px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.tile { background: var(--bg); border-radius: 10px; padding: 8px; text-align: center; }
.tile strong { display: block; font-size: 20px; }
.tile span { font-size: 11px; color: var(--muted); }
.empty { text-align: center; padding: 14px 10px; align-items: center; }
.empty strong { display: block; font-size: 14px; }
.pick { display: flex; gap: 9px; align-items: flex-start; padding: 7px 0; border-top: 1px solid var(--border); cursor: pointer; font-size: 12.5px; }
.pick input { margin: 3px 0 0; accent-color: #0f766e; }
.menu { position: absolute; z-index: 5; min-width: 220px; max-width: 290px; overflow-y: auto; background: #fff; color: #1c1c1e; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,.3), 0 0 0 1px rgba(15,23,42,.08); padding: 5px; display: flex; flex-direction: column; font-size: 12.5px; }
.menu .mh { font-weight: 700; padding: 6px 9px 3px; overflow-wrap: anywhere; }
.menu .ms { height: 1px; background: #e3e6ec; margin: 4px 0; flex: none; }
.menu .mn { color: #5b6577; font-size: 11.5px; padding: 4px 9px; }
.menu .mn.newer { color: var(--bad); font-weight: 700; }
.mi { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 8px; width: 100%; font-weight: 500; flex: none; }
.mi:hover, .mi:focus-visible { background: #eef0f5; outline: none; }
.mi.danger { color: var(--bad); font-weight: 700; }
.mi em { margin-left: auto; font-style: normal; font-size: 11px; color: #5b6577; font-weight: 600; }
.edge-tab { position: fixed; left: 0; bottom: 68px; z-index: 2147483000; display: none; align-items: center; justify-content: center; min-width: 26px; height: 36px; padding: 0 4px; border-radius: 0 6px 6px 0; background: #0f766e; color: #fff; font: 700 10.5px/1 Arial, sans-serif; overflow: hidden; }
.edge-tab svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.edge-tab:hover { filter: brightness(1.25); }
.edge-tab[data-state="run"] { box-shadow: inset 0 0 0 2px rgba(255,255,255,.55); }
.edge-tab[data-state="need"] { background: #b4530a; box-shadow: inset 0 0 0 2px #fff; font-size: 16px; }
.edge-tab:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
`;

const ICONS = {
minus: '<path d="M5 12h14"/>',
more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
ok: '<path d="M5 12l5 5L20 7"/>',
blank: '',
paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2"/>',
copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>'
};

function icon(name) {
return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function chip(text, kind, extraClass) {
return `<span class="chip${kind ? ' ' + kind : ''}${extraClass ? ' ' + extraClass : ''}">${escapeHtml(text)}</span>`;
}

const TAG_CLASS = { Done: 'done', Next: 'next', Skipped: 'ck', Waiting: 'wait', Working: 'next', 'Needs you': 'ck' };
const AVATAR_CLASS = { Done: 'grn', Waiting: 'gry', Skipped: 'amb', 'Needs you': 'amb' };

function initials(name) {
return stripNameTitle(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

// kind: primary (the one filled button), sec (outline), txt or danger.
function btn(action, label, kind, extraClass, iconName) {
return `<button type="button" class="btn ${kind || 'sec'}${extraClass ? ' ' + extraClass : ''}" data-action="${action}">${iconName ? icon(iconName) : ''}${escapeHtml(label)}</button>`;
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

// Finished steps fold into one line, and so do the steps still to come, so
// the step being done now stands out. Either line opens on a click.
function renderSteps() {
const steps = state.steps || STEPS;
const at = Math.min(state.stepIndex, steps.length);
const done = steps.slice(0, at);
const current = steps[at];
const todo = steps.slice(at + 1);
const count = (n, word) => `${n} step${n === 1 ? '' : 's'} ${word}`;
const fold = (section, open, cls, mark, label, list) => `<details class="step-fold" data-section="${section}"${open ? ' open' : ''}><summary class="step ${cls}"><span class="num" aria-hidden="true">${mark}</span>${label}</summary><ol>${list.map((step) => `<li>${escapeHtml(step.label)}</li>`).join('')}</ol></details>`;
return `<div class="steps">${done.length ? fold('steps', ui.stepsOpen, 'done', '&#10003;', count(done.length, 'done'), done) : ''}${current ? `<div class="step ${state.paused ? 'needs' : 'current'}"><span class="num" aria-hidden="true">${state.paused ? '!' : at + 1}</span><span>${escapeHtml(current.label)}</span></div>` : ''}${todo.length ? fold('todo', ui.todoOpen, 'todo', at + 2, count(todo.length, 'to go'), todo) : ''}</div>`;
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
const viewTag = inView && inView === a ? ' <span class="tag next">In view</span>' : '';
return `<label class="pick"><input type="radio" name="hereLead" value="${escapeHtml(String(a.ID))}" data-action="pickHere"${String(a.ID) === chosen ? ' checked' : ''}><span><strong>${escapeHtml(a.CampaignName || 'Lead')}</strong>${viewTag}<br><span class="muted small">${escapeHtml(meta)}</span></span></label>`;
}).join('');
return `<div class="card">
<strong>This customer</strong>
<div class="muted small" style="margin:2px 0 6px;">The lead in view is ticked; tick another to set that one up again instead. It stops in the new lead.</div>
${rows}
<div style="margin-top:10px;">${chosen ? btn('here', 'Set up the ticked lead again', 'primary', 'wide') : '<div class="muted small">Tick the lead to set up again.</div>'}</div>
</div>`;
}

// How many are left in each run, shown on the tabs and in the header.
function runCounts(leads, progress) {
const desk = loadDeskProgress();
return {
re: leads.filter((l) => !progress.byActivity[l.activityId]).length,
pc: sendBackLeads().filter((l) => !desk.pc[l.key]).length,
eo: emailOnlyLeads().filter((l) => !desk.eo[l.key]).length,
st: sendThroughLeads().filter((l) => !desk.st[l.key]).length
};
}

function renderTabs(counts) {
const view = ui.view || 're';
const tab = (key, label) => `<button type="button" class="tab${view === key ? ' on' : ''}" role="tab" data-action="view" data-view="${key}" aria-selected="${view === key}">${label}${counts[key] ? `<em>${counts[key]}</em>` : ''}</button>`;
return `<div class="tabs" role="tablist" aria-label="Choose a run">${tab('re', 'Re setup')}${tab('pc', 'Post Closure')}${tab('eo', 'Email Only')}${tab('st', 'Send through')}</div>`;
}

// Which lead a list row stands for. The key is kept in the row so the
// initials menu and the details can find the lead again after a redraw.
function reKey(lead) {
return `${lead.activityId}|${lead.name}`;
}
function listLead(run, key) {
if (run === 'pc') return sendBackLeads().find((l) => l.key === key) || null;
if (run === 'eo') return emailOnlyLeads().find((l) => l.key === key) || null;
if (run === 'st') return sendThroughLeads().find((l) => l.key === key) || null;
return leadsToDo().find((l) => reKey(l) === key) || null;
}

// Two lines per person: name and state, then the detail. The initials open
// the actions; the row itself opens for more.
// flag: a second tag before the state, for a row that needs saying more.
function listRow(run, key, name, detail, status, more, flag) {
const id = `${run}:${key}`;
const open = ui.openRows.has(id);
const attrs = `data-run="${run}" data-key="${escapeHtml(key)}"`;
const kv = more.filter((pair) => pair[1]).map((pair) => `<dt>${escapeHtml(pair[0])}</dt><dd>${escapeHtml(pair[1])}</dd>`).join('');
return `<div class="r${open ? ' open' : ''}">
<button type="button" class="av ${AVATAR_CLASS[status] || ''}" data-action="who" ${attrs} title="Actions for ${escapeHtml(name)}" aria-haspopup="true">${escapeHtml(initials(name))}</button>
<button type="button" class="rmain" data-action="row" ${attrs} aria-expanded="${open}" title="Show or hide details"><span class="nm">${escapeHtml(name)}</span>${flag ? `<span class="tgs"><span class="tag ck">${escapeHtml(flag)}</span>` : ''}<span class="tag ${TAG_CLASS[status] || 'wait'}">${escapeHtml(status)}</span>${flag ? '</span>' : ''}<span class="meta">${escapeHtml(detail)}</span></button>
<div class="more"><dl class="kv">${kv}</dl></div>
</div>`;
}

function listGroup(title, doneCount, rows) {
return `<div class="g"><div class="grp">${title} <span>${doneCount} of ${rows.length} done</span></div><div class="list">${rows.join('')}</div></div>`;
}

// The first lead not yet dealt with is the one a run takes next.
function withNext(leads, statusOf) {
let nextGiven = false;
return leads.map((l) => {
const status = statusOf(l);
if (status !== 'Waiting' || nextGiven) return status;
nextGiven = true;
return 'Next';
});
}

const SEND_BACK_HOW = 'Each one is opened from your Parked Calls: CAD or CAH in Post Closure Notes, call outcome Update Outcomes, lead outcome Customer Hub Team &gt; No Opportunity &gt; the Catch All reason, next status Shift Start, then Finished. Ones not in your Parked Calls are left alone. To check your Parked Calls, SLA Manager passes them to its Konnect Live tab.';
const EMAIL_ONLY_HOW = 'Sets you Available. Each of your leads that presents is rejected (so it does not dial), set to Update Outcomes, given EO in Call Notes and Customer Hub Team &gt; Ongoing &gt; Email Only Lead, then Finished. Any other lead that presents is left to you. You stay Available until the last one, then Shift Start.';

const SEND_BACK_ALSO_HOW = ' Your send through leads that are in Parked Calls are done in the same pass: call outcome Update Outcomes, their lead outcome under Customer Hub Team, next status Shift Start, then Finished.';
const SEND_THROUGH_HOW = 'Sets you Available. Each of your leads that presents is rejected (so it does not dial), set to Update Outcomes and given its lead outcome under Customer Hub Team: Ongoing &gt; In Progress with Dealer or Ongoing &gt; Defer to Site, from the Lead Checker result. No note is written. On the ones marked Stops for you it stops for you to choose the outcome. Then Finished. Any other lead that presents is left to you. The ones in your Parked Calls are done by Start on the Post Closure tab.';
const STOPS_FOR_YOU = 'Stops for you';

function howLink() {
return `<button type="button" class="btn txt" data-action="how" aria-expanded="${!!ui.howOpen}">How it works</button>`;
}
function howText(detail) {
return ui.howOpen ? `<div class="muted small how">${detail}</div>` : '';
}

// While a stopped notice is showing its own button is the filled one, so
// Start is an outline button until the notice is dealt with.
function startButton(action, label) {
return state.notice ? btn(action, `${label} again`, 'sec', 'wide') : btn(action, label, 'primary', 'wide');
}

function renderSendBackView() {
const leads = sendBackLeads();
const done = loadDeskProgress().pc;
const left = leads.filter((l) => !done[l.key]).length;
const checks = postClosureResults().filter((r) => normalise(r.postClosureAction) !== 'send back through').length;
const needCall = checks ? chip(`${checks} need${checks === 1 ? 's' : ''} a call`, 'warn') : '';
const hubLine = hubStatusLine();
const requestLine = hubLine ? `<div class="muted small hub-status" role="status">${escapeHtml(hubLine)}</div>` : '';
const age = resultsAgeLine();
const ageChip = age ? chip(age, '', 'results-age') : '';
const through = sendThroughLeads();
const throughDone = loadDeskProgress().st;
const throughLeft = through.filter((l) => !throughDone[l.key]).length;
const how = `${SEND_BACK_HOW}${checks ? ` The ${checks} that need${checks === 1 ? 's' : ''} contact ${checks === 1 ? 'is' : 'are'} left for you to call.` : ''}${through.length ? SEND_BACK_ALSO_HOW : ''}`;
if (!leads.length && !through.length) {
return [`<div class="card col empty"><strong>No send backs yet</strong><div class="muted small">Check your Parked Calls on the Lead Checker. The ones marked "send back through" show here.</div><div class="cf">${needCall}${ageChip}${howLink()}</div>${howText(how)}${btn('checkParked', 'Check my Parked Calls', 'primary', 'wide')}${requestLine}</div>`];
}
const now = Date.now();
const statuses = withNext(leads, (l) => done[l.key] || 'Waiting');
const rows = leads.map((l, i) => listRow('pc', l.key, l.name, `${l.shorthand.toUpperCase()} · ${l.reason}`, statuses[i], [
['Checked', l.checkedAt ? ageText(l.checkedAt, now) : ''],
['Result', `Send back through: ${l.reason} (${l.shorthand.toUpperCase()})`],
['Phone', l.phone], ['Email', l.email]
]));
return [`<div class="card col">
<div class="big-count"><strong>${left}</strong><span>to send back</span></div>
<div class="cf">${needCall}${throughLeft ? chip(`${throughLeft} to send through`, 'acc', 'through-chip') : ''}${ageChip}${howLink()}</div>
${howText(how)}
${left || throughLeft ? `${startButton('startPc', 'Start')}<span class="quiet-line shift-line">Sets Shift Start before opening Parked Calls, every time.</span>` : '<div class="muted small">All done.</div>'}
${btn('checkParked', 'Check my Parked Calls', 'sec', 'wide')}${requestLine}
</div>`, leads.length ? listGroup('Send backs', leads.length - left, rows) : '',
through.length ? listGroup('Send through, if in Parked Calls', through.length - throughLeft, sendThroughRows(through, throughDone, false)) : ''];
}

// Only ever this agent's own leads. With several agents recorded and no
// name remembered, the one question comes first.
function renderEmailOnlyView() {
if (emailOnlyAsk()) {
return [`<div class="card col ask-me"><strong>Which agent are you?</strong><div class="muted small">Pick your name once. It is remembered, and you can change it in More.</div>${emailOnlyAgents().map((a) => `<button type="button" class="btn sec wide" data-action="iAm" data-agent="${escapeHtml(a)}">${escapeHtml(a)}</button>`).join('')}</div>`];
}
const leads = emailOnlyLeads();
const done = loadDeskProgress().eo;
const left = leads.filter((l) => !done[l.key]).length;
if (!leads.length) {
return [`<div class="card col empty"><strong>No Email Only leads assigned today</strong><div class="muted small">Assign your Email Only leads in SLA Manager first; they show here. Anything else that presents is left to you.</div></div>`];
}
const doneCount = leads.length - left;
const statuses = withNext(leads, (l) => done[l.key] || 'Waiting');
const rows = leads.map((l, i) => listRow('eo', l.key, l.name, l.campaign || 'Email Only', statuses[i], [['Email', l.email], ['Phone', l.phone], ['Campaign', l.campaign]]));
const words = doneCount ? `Email Only lead${left === 1 ? '' : 's'} to do` : `Email Only lead${left === 1 ? '' : 's'} assigned to you in SLA Manager`;
return [`<div class="card col">
<div class="big-count"><strong>${left}</strong><span>${words}</span></div>
<div class="cf">${chip('Sets you Available', 'info')}${doneCount ? chip(`${doneCount} done`, 'ok') : ''}${howLink()}</div>
${howText(EMAIL_ONLY_HOW)}
${left ? startButton('startEo', 'Start') : '<div class="muted small">All done.</div>'}
</div>`, listGroup('Email Only leads', doneCount, rows)];
}

// Two lines per person: the name, then the Lead Checker's reason and the
// outcome that will be set. next: mark the first one still to do as Next.
function sendThroughRows(leads, done, next) {
const now = Date.now();
const statuses = next ? withNext(leads, (l) => done[l.key] || 'Waiting') : leads.map((l) => done[l.key] || 'Waiting');
return leads.map((l, i) => listRow('st', l.key, l.name, sendThroughDetail(l), statuses[i], [
['Checked', l.checkedAt ? ageText(l.checkedAt, now) : ''],
['Result', l.subCategory],
['Sets', l.stop ? 'You choose the outcome' : SEND_THROUGH_OUTCOMES[l.outcome].path.join(' > ')],
['Campaign', l.campaign], ['Phone', l.phone], ['Email', l.email]
], l.stop && !done[l.key] ? STOPS_FOR_YOU : ''));
}

// Only ever this agent's own leads, as the Email Only tab.
function renderSendThroughView() {
if (sendThroughAsk()) {
return [`<div class="card col ask-me"><strong>Which agent are you?</strong><div class="muted small">Pick your name once. It is remembered, and you can change it in More.</div>${sendThroughAgents().map((a) => `<button type="button" class="btn sec wide" data-action="iAm" data-agent="${escapeHtml(a)}">${escapeHtml(a)}</button>`).join('')}</div>`];
}
const leads = sendThroughLeads();
if (!leads.length) {
return [`<div class="card col empty"><strong>No leads to send through yet</strong><div class="muted small">Leads assigned to you in SLA Manager that the Lead Checker says need no call show here, to go through to the dealership.</div><div class="cf">${howLink()}</div>${howText(SEND_THROUGH_HOW)}</div>`];
}
const done = loadDeskProgress().st;
const left = leads.filter((l) => !done[l.key]).length;
const doneCount = leads.length - left;
const stops = leads.filter((l) => l.stop && !done[l.key]).length;
const stay = loadSettings().stayAvailable;
return [`<div class="card col">
<div class="big-count"><strong>${left}</strong><span>to send through to the dealership</span></div>
<div class="cf">${chip('Sets you Available', 'info')}${stops ? chip(`${stops} stop${stops === 1 ? 's' : ''} for you`, 'warn') : ''}${doneCount ? chip(`${doneCount} done`, 'ok') : ''}${howLink()}</div>
${howText(SEND_THROUGH_HOW)}
<button type="button" class="sw" role="switch" aria-checked="${stay}" data-action="stayAvailable"><span>Stay Available between leads</span><span class="knob" aria-hidden="true"></span></button>
<span class="quiet-line stay-line">${stay ? 'You stay Available until the last one, then Shift Start.' : 'Shift Start after each one. It asks before going Available for the next.'}</span>
${left ? startButton('startSt', 'Start') : '<div class="muted small">All done.</div>'}
${left ? btn('startPc', 'Do the ones in my Parked Calls', 'sec', 'wide') : ''}
</div>`, listGroup('Send through', doneCount, sendThroughRows(leads, done, true))];
}

function leadStatus(lead, index, progress) {
const done = progress.byActivity[lead.activityId];
if (done) return done;
if (state.running && index === state.currentIndex) return state.paused ? 'Needs you' : 'Working';
return 'Waiting';
}

function renderReSetupView(source, leads, progress) {
const parts = [];
const doneCount = leads.filter((l) => progress.byActivity[l.activityId]).length;
const remaining = leads.length - doneCount;
if (onCallPage() && liveActivities().length) parts.push(renderHereCard());
if (!source) {
// Nothing from the National check: the This customer card (if any) is enough.
if (!onCallPage()) parts.push(`<div class="card col empty">
<strong>No National results yet</strong>
<div class="muted small">Import the National results in SLA Manager, or copy them from the Lead Checker and paste them here. On a customer, you can set one of their leads up again.</div>
${btn('paste', 'Paste results', 'primary', '', 'paste')}
</div>`);
else parts.push(btn('paste', 'Paste National results', 'sec', 'wide', 'paste'));
} else if (leads.length === 0) {
parts.push(`<div class="card col empty">
<strong>No leads need setting up again</strong>
<div class="muted small">The last National check found nothing to set up again.</div>
${btn('paste', 'Paste results', 'sec', '', 'paste')}
</div>`);
} else if (remaining === 0) {
parts.push(`<div class="card col">
<strong>All done</strong>
<div class="tiles">${['Done', 'Skipped'].map((key) => `<div class="tile"><strong>${leads.filter((l) => progress.byActivity[l.activityId] === key).length}</strong><span>${key}</span></div>`).join('')}<div class="tile"><strong>0</strong><span>Left</span></div></div>
${btn('copySummary', 'Copy summary', 'primary', 'wide', 'copy')}
</div>`);
} else {
const savedAt = new Date(source.savedAt).toTimeString().slice(0, 5);
parts.push(`<div class="card col">
<div class="big-count"><strong>${remaining}</strong><span>to set up again</span></div>
<div class="cf">${chip(`National check ${savedAt}`)}${doneCount ? chip(`${doneCount} done`, 'ok') : ''}</div>
${startButton('start', doneCount ? 'Continue' : 'Start')}
${btn('paste', 'Paste results', 'sec', 'wide', 'paste')}
</div>`);
}
if (leads.length) {
const statuses = withNext(leads, (l) => leadStatus(l, leads.indexOf(l), progress));
parts.push(listGroup('Leads', doneCount, leads.map((l, i) => listRow('re', reKey(l), l.name, l.campaign || 'Campaign read from the closed lead', statuses[i], [['Lead', l.activityId], ['Reg', l.reg], ['Progress', progress.byActivity[l.activityId] || 'Not set up yet']]))));
}
return parts;
}

// What the running card shows for the run in hand. count is "1 of 5" and
// short "1/5", both '' when the run has no count to show.
function runInfo(leads, progress) {
if (state.mode === 'here') {
const lead = state.hereLead;
return { left: 'This customer', right: 'Stops in the new lead', percent: null, name: lead.name, meta: lead.campaign || '', steps: true, count: '', short: '' };
}
if (state.mode === 'pc' || state.mode === 'eo' || state.mode === 'st') {
const lead = state.deskLead;
const through = !!lead && lead.kind === 'st';
const waiting = state.mode === 'eo' ? 'Waiting for your next Email Only lead' : state.mode === 'st' ? 'Waiting for your next send through lead' : 'Getting ready';
const count = state.deskCount || { done: 0, total: 0 };
const at = Math.min(count.done + 1, count.total);
return {
left: through ? 'Send through to the dealership' : state.mode === 'pc' ? 'Post Closure send back' : state.mode === 'st' ? 'Send through to the dealership' : 'Email Only',
right: `${count.done} of ${count.total} done`,
percent: count.total ? Math.round((100 * count.done) / count.total) : 0,
name: lead ? lead.name : waiting,
meta: lead ? (through ? sendThroughDetail(lead) : state.mode === 'pc' ? `${lead.shorthand.toUpperCase()} · ${lead.reason}` : (lead.email || '')) : '',
steps: !!lead,
count: count.total ? `${at} of ${count.total}` : '',
short: count.total ? `${at}/${count.total}` : ''
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
steps: !!lead,
count: lead ? `${state.currentIndex + 1} of ${leads.length}` : '',
short: lead ? `${state.currentIndex + 1}/${leads.length}` : ''
};
}

function logLines() {
return state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join('');
}

function activityFold() {
if (!state.log.length) return '';
return `<details class="fold" data-section="log"${ui.logOpen ? ' open' : ''}><summary>Activity <span class="count">${state.log.length}</span></summary><div class="log">${logLines()}</div></details>`;
}

// Paused: only the question and its buttons, so the panel covers as little
// as it can of the page the agent is asked to look at. The header says
// "Needs you"; the main answer is the one wide button. The why box only
// comes once Skip lead is pressed.
function renderPaused(info) {
const paused = state.paused;
const step = paused.inLead && state.steps ? state.steps[state.stepIndex] : null;
const who = [info.steps ? info.name : '', info.steps ? info.count : '', step ? step.label : ''].filter(Boolean).join(' · ');
const canSkip = paused.inLead && state.mode !== 'here';
const others = [];
if (paused.inLead && !paused.review && !paused.choices) others.push(btn('retry', 'Try again', 'sec', 'small'));
// A decision: one button per answer, the recommended one filled, and an
// optional reason that is kept with the decision.
const choices = paused.choices && !ui.skipAsk
? `<div class="choices">${paused.choices.map((c) => `<button type="button" class="btn ${c.recommended ? 'primary' : 'sec'} wide" data-action="choose" data-key="${escapeHtml(c.key)}">${escapeHtml(c.label)}${c.recommended ? ' (recommended)' : ''}</button>`).join('')}<input type="text" class="why" data-role="choiceWhy" maxlength="200" autocomplete="off" placeholder="Why this one? (optional)" aria-label="Why this one? (optional)"></div>`
: '';
if (canSkip) others.push(btn('skip', 'Skip lead', 'sec', 'small'));
// The box's text is kept in ui.skipWhy and put back by render(), so it is
// not part of the html that decides whether the panel is redrawn.
const lower = canSkip && ui.skipAsk
? `<input type="text" class="why" data-role="skipWhy" maxlength="200" autocomplete="off" placeholder="Why are you skipping? (optional)" aria-label="Why are you skipping? (optional)"><div class="row">${btn('skipConfirm', 'Skip this lead', 'sec', 'small')}${btn('skipCancel', 'Do not skip', 'txt', 'small')}</div>`
: `<div class="row others"><span class="row">${others.join('')}</span>${btn('stop', 'Stop', 'danger', 'small')}</div>`;
return [`<div class="card needs-card">
<div role="alert">${who ? `<div class="who">${escapeHtml(who)}</div>` : ''}<p class="ask">${escapeHtml(paused.message)}</p></div>
${paused.noCarry ? '' : btn('carry', paused.carryOnLabel, 'primary', 'wide')}
${choices}${lower}
</div>`,
`<details class="fold" data-section="more"${ui.moreOpen ? ' open' : ''}><summary>Steps and activity <span class="count">${ui.moreOpen ? 'hide' : 'show'}</span></summary><div class="fold-body">${info.steps ? renderSteps() : ''}</div><div class="log">${logLines()}</div></details>`];
}

function renderRunning(info) {
return [`<div class="card col">
<div class="row"><span class="small muted grow">${escapeHtml(info.left)}</span>${chip(info.right)}</div>
${info.percent == null ? '' : `<div class="track"><div class="fill" style="width:${info.percent}%"></div></div>`}
<div class="row" style="flex-wrap:nowrap;"><span class="av">${escapeHtml(info.steps ? initials(info.name) : '…')}</span><div class="grow"><div class="lead-name">${escapeHtml(info.name)}</div>${info.meta ? `<div class="small muted">${escapeHtml(info.meta)}</div>` : ''}</div></div>
${info.steps ? renderSteps() : ''}
</div>`, `<div class="row">${btn('stop', 'Stop after this step', 'sec', '', 'stop')}</div>`, activityFold()];
}

// A stopped run's notice: one short line per thing left on the page, the
// part that needs action pulled out, and Set Shift Start as the one filled
// button.
function renderNotice() {
const notice = state.notice;
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const buttons = `<div class="row">${notice.shiftStart ? btn('shiftStart', 'Set Shift Start', 'primary', 'small') : ''}${btn('dismissNotice', 'OK', 'sec', 'small')}</div>`;
const available = 'You are still Available, so leads can present';
if (!notice.stopped) return `<div class="alert amber notice" role="alert"><span>${escapeHtml(notice.text)}</span>${buttons}</div>`;
const list = notice.parts && notice.parts.length
? `<b>Stopped. Left on the page as it is:</b><ul>${notice.parts.map((part) => `<li>${icon('ok')}<span>${escapeHtml(cap(part))}</span></li>`).join('')}</ul>`
: '<b>Stopped.</b>';
return `<div class="alert amber notice" role="alert">${list}${notice.shiftStart ? chip(available, 'warn', 'wrap') : ''}${buttons}</div>`;
}

function focusKey(el) {
const action = el && el.getAttribute && el.getAttribute('data-action');
if (!action) return null;
return { action, view: el.getAttribute('data-view') || '', key: el.getAttribute('data-key') || el.getAttribute('data-agent') || '', value: el.name === 'hereLead' ? el.value : '', label: action === 'carry' ? el.textContent : '' };
}

// The link status line: its own strip, so SLA Manager's regular updates
// change one line of text and not the whole panel. The dot shows the state
// of the link; amber means it needs the agent.
function renderLinkLine() {
if (!ui) return;
const link = readJson(LIVE_LINK_KEY);
const text = linkLineText(link, Date.now());
if (text === ui.linkText) return;
ui.linkText = text;
const line = ui.root.querySelector('.link');
const down = text === HUB_NOT_RUNNING;
const state_ = down ? 'warn' : !link || link.state === 'none' || link.state === 'paused' ? 'off' : link.state === 'loggedOut' ? 'bad' : link.state === 'running' ? 'busy' : '';
line.querySelector('.link-text').textContent = text;
line.querySelector('.dot').className = `dot${state_ ? ' ' + state_ : ''}`;
line.classList.toggle('warn', down);
line.classList.toggle('bad', state_ === 'bad');
}

// True when the run in hand, or the tab on show, is one that presses
// Finished; the others park.
function stopsBeforeFinish() {
if (state.running) return state.mode === 'pc' || state.mode === 'eo' || state.mode === 'st';
return ui.view === 'pc' || ui.view === 'eo' || ui.view === 'st';
}

function footerText(settings) {
if (state.running && state.mode === 'here') return 'Stops in the new lead';
if (stopsBeforeFinish()) return settings.reviewBeforeFinish ? 'Stops before Finished on each one' : 'Presses Finished without stopping';
return settings.reviewBeforePark ? 'Stops before parking each lead' : 'Parks each lead without stopping';
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
const counts = runCounts(leads, progress);
if (state.paused) parts.push(...renderPaused(info));
else {
if (versionState.newer) parts.push(`<div class="alert red version newer">${escapeHtml(versionLineText(versionState))}</div>`);
if (selfTestFailures.length) parts.push(`<div class="alert red" role="alert"><span><strong>Self-test failed.</strong> Please send this on: ${escapeHtml(selfTestFailures[0])}</span></div>`);
if (!onDesktop) parts.push(`<div class="alert amber"><span>Open this on the agent desktop: Re setup, Post Closure, Email Only and Send through only work there.</span></div>`);
if (state.running) parts.push(...renderRunning(info));
else {
if (state.notice) parts.push(renderNotice());
parts.push(renderTabs(counts));
if (ui.view === 'pc') parts.push(...renderSendBackView());
else if (ui.view === 'eo') parts.push(...renderEmailOnlyView());
else if (ui.view === 'st') parts.push(...renderSendThroughView());
else parts.push(...renderReSetupView(source, leads, progress));
parts.push(activityFold());
}
}

const html = parts.join('');
if (html !== ui.html) {
const body = ui.root.querySelector('.body');
const active = ui.root.activeElement;
const key = active && body.contains(active) ? focusKey(active) : null;
const inWhy = !!active && body.contains(active) && active.getAttribute('data-role') === 'skipWhy';
const scroll = body.scrollTop;
const listScroll = (body.querySelector('.list') || {}).scrollTop || 0;
body.innerHTML = html;
ui.html = html;
body.scrollTop = scroll;
const list = body.querySelector('.list');
if (list && listScroll) list.scrollTop = listScroll;
const choiceWhy = body.querySelector('[data-role="choiceWhy"]');
if (choiceWhy) choiceWhy.value = ui.choiceWhy || '';
const whyBox = body.querySelector('[data-role="skipWhy"]');
if (whyBox) {
whyBox.value = ui.skipWhy || '';
if (inWhy || ui.focusWhy) whyBox.focus({ preventScroll: true });
}
ui.focusWhy = false;
// Keyboard focus stays on the same control when it is still there. A
// carry on button with another label is another question, so it does
// not get the focus by itself.
if (key) {
const again = Array.from(body.querySelectorAll(`[data-action="${key.action}"]`)).find((el) => {
const k = focusKey(el);
return k.view === key.view && k.key === key.key && k.value === key.value && k.label === key.label;
});
if (again) again.focus({ preventScroll: true });
}
// A menu opened from a row that has been redrawn has lost its row.
if (ui.menu && ui.menuOpener && !ui.menuOpener.isConnected) closeMenu();
}

const title = ui.root.querySelector('.head .name');
const sub = ui.root.querySelector('.head .sub');
const subText = state.paused ? (info ? info.count : '')
: state.running ? (info.count ? `Running · ${info.count}` : 'Running')
: state.notice && state.notice.stopped ? 'Stopped'
: (counts[ui.view || 're'] ? `${counts[ui.view || 're']} to do` : '');
const titleText = state.paused ? 'Needs you' : 'Lead Re setup';
if (title.textContent !== titleText) title.textContent = titleText;
if (sub.textContent !== subText) sub.textContent = subText;
const foot = ui.root.querySelector('.foot .setting');
const footText = footerText(settings);
if (foot.textContent !== footText) foot.textContent = footText;
ui.panel.classList.toggle('paused', !!state.paused);
ui.button = state.paused ? { state: 'need', text: '!', title: 'Lead Re setup needs you' }
: state.running ? { state: 'run', text: info.short, title: info.count ? `Lead Re setup: running, ${info.count}` : 'Lead Re setup: running' }
: { state: 'rest', text: '', title: 'Lead Re setup' };
renderLinkLine();
syncButton();
keepClear();
}

// ===================================================================
// MENUS
// ===================================================================

function closeMenu(refocus) {
if (!ui || !ui.menu) return;
const opener = ui.menuOpener;
ui.menu.remove();
ui.menu = null;
ui.menuOpener = null;
ui.root.querySelector('[data-action="more"]').setAttribute('aria-expanded', 'false');
if (refocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
}

// Opens a menu under the control that asked for it, or above when there is
// more room there. It belongs to the panel, so it moves with it.
function openMenu(opener, html, alignRight) {
closeMenu();
const menu = document.createElement('div');
menu.className = 'menu';
menu.setAttribute('role', 'menu');
menu.innerHTML = html;
ui.panel.appendChild(menu);
ui.menu = menu;
ui.menuOpener = opener;
const p = ui.panel.getBoundingClientRect();
const o = opener.getBoundingClientRect();
const m = menu.getBoundingClientRect();
const below = window.innerHeight - o.bottom - 12;
const above = o.top - 12;
const up = m.height > below && above > below;
const room = Math.max(120, Math.floor(up ? above : below));
const height = Math.min(m.height, room);
menu.style.maxHeight = `${room}px`;
menu.style.top = `${Math.round((up ? o.top - height - 4 : o.bottom + 4) - p.top)}px`;
const left = Math.max(8, Math.min(window.innerWidth - m.width - 8, alignRight ? o.right - m.width : o.left));
menu.style.left = `${Math.round(left - p.left)}px`;
const first = menu.querySelector('.mi');
if (first) first.focus({ preventScroll: true });
}

function menuItem(action, iconName, label, attrs, danger) {
return `<button type="button" class="mi${danger ? ' danger' : ''}" role="menuitem" data-action="${action}"${attrs ? ' ' + attrs : ''}>${icon(iconName)}<span>${escapeHtml(label)}</span></button>`;
}

// The one More menu: the stop setting first with its tick, then the rarely
// used actions for the tab on show, then the tool's own controls.
function moreMenuHtml() {
const settings = loadSettings();
const finish = stopsBeforeFinish();
const on = finish ? settings.reviewBeforeFinish : settings.reviewBeforePark;
const sep = '<div class="ms" role="separator"></div>';
const groups = [`<button type="button" class="mi" role="menuitemcheckbox" aria-checked="${on}" data-action="${finish ? 'reviewFinish' : 'review'}">${icon(on ? 'ok' : 'blank')}<span>${finish ? 'Stop before Finished so I can check' : 'Stop before parking so I can check'}</span><em>${on ? 'On' : 'Off'}</em></button>`];
const acts = [];
if (!state.running && !state.checking) {
const view = ui.view || 're';
const desk = loadDeskProgress();
if (view === 're') {
const leads = leadsToDo();
const progress = loadProgress();
acts.push(menuItem('paste', 'paste', 'Paste results'));
if (leads.length) acts.push(menuItem('copySummary', 'copy', 'Copy summary'));
if (leads.some((l) => progress.byActivity[l.activityId])) acts.push(menuItem('clearRe', 'trash', 'Clear progress'));
if (readJson(PASTED_RESULTS_KEY)) acts.push(menuItem('clearPasted', 'trash', 'Remove pasted results'));
} else {
if (Object.keys(desk[view] || {}).length) acts.push(menuItem(view === 'pc' ? 'clearPc' : view === 'st' ? 'clearSt' : 'clearEo', 'trash', 'Clear progress'));
acts.push(menuItem('how', 'help', 'How it works'));
}
if ((emailOnlyAgents().length > 1 && emailOnlyMe()) || (sendThroughAgents().length > 1 && sendThroughMe())) acts.push(menuItem('changeMe', 'user', 'Change who I am'));
}
if (acts.length) groups.push(acts.join(''));
const version = versionState ? versionLineText(versionState) : '';
groups.push(`${menuItem('report', 'flag', 'Report a problem')}${menuItem('clearStop', 'stop', 'Clear & Stop', 'title="Stops any run, clears this tool\'s data and closes it"', true)}${version ? `<div class="mn version${versionState.newer ? ' newer' : ''}">${escapeHtml(version)}</div>` : ''}`);
return groups.join(sep);
}

// The actions behind a person's initials.
function whoMenuHtml(run, key) {
const lead = listLead(run, key);
if (!lead) return '';
const attrs = `data-run="${run}" data-key="${escapeHtml(key)}"`;
return `<div class="mh">${escapeHtml(lead.name)}</div>${run === 'pc' || run === 'st' ? menuItem('openParked', 'phone', 'Open from Parked Calls', attrs) : ''}${menuItem('copyDetails', 'copy', 'Copy details', attrs)}`;
}

function detailsForClipboard(run, lead) {
const lines = [lead.name];
if (run === 'pc') lines.push(`Send back through: ${lead.reason} (${lead.shorthand.toUpperCase()})`, lead.phone, lead.email);
else if (run === 'eo') lines.push(lead.campaign || 'Email Only', lead.email, lead.phone);
else if (run === 'st') lines.push(`Send through: ${sendThroughDetail(lead)}`, lead.campaign, lead.phone, lead.email);
else lines.push(lead.campaign, lead.reg ? `Reg ${lead.reg}` : '', lead.activityId ? `Lead ${lead.activityId}` : '');
return lines.filter(Boolean).join('\n');
}

// Opens one send back or send through lead from Parked Calls for the agent and stops there:
// nothing is written and Finished is not pressed.
async function openFromParked(lead) {
if (state.running || state.checking) return;
state.checking = true;
try {
await goToParked();
addLog(await openParkedCustomer(null, lead));
} catch (error) {
if (!halted && !(error instanceof Halted)) addLog(error.message);
} finally {
state.checking = false;
}
}

// ===================================================================
// THE BUTTON ON THE PAGE
// ===================================================================

// Tucked away, the panel is its button. The button sits beside the Konnect
// Notes one: in Konnect's rail when a lead is open, in the Phone column
// above the call button otherwise, and as a small tab at the screen edge
// when the page has neither. It takes its shape and size from the Konnect
// button next to it, and every state is drawn inside that shape.
const BUTTON_ID = '_leadResetButton';
const RAIL_SECTION_ID = '_leadResetRailSection';
const BUTTON_STYLE_ID = '_leadResetButtonStyle';
const BUTTON_SYMBOL = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.reset}</svg>`;
const BUTTON_STYLE = `
#${RAIL_SECTION_ID} { text-align: center; }
#${BUTTON_ID} { align-items: center !important; justify-content: center !important; padding: 0 !important; border: 0 !important; background: #0f766e !important; color: #fff !important; box-shadow: none !important; font: 700 15px/1 Arial, sans-serif !important; text-decoration: none !important; text-shadow: none !important; overflow: hidden !important; cursor: pointer; }
#${BUTTON_ID}[data-host="rail"] { display: inline-flex !important; }
#${BUTTON_ID}[data-host="phone"] { display: flex !important; }
#${BUTTON_ID}:hover { filter: brightness(1.25); }
#${BUTTON_ID}[data-state="run"] { box-shadow: inset 0 0 0 3px rgba(255,255,255,.55) !important; }
#${BUTTON_ID}[data-state="need"] { background: #b4530a !important; box-shadow: inset 0 0 0 3px #fff !important; font-size: 24px !important; }
#${BUTTON_ID}:focus-visible { outline: 3px solid #fff !important; outline-offset: -5px !important; }
#${BUTTON_ID} svg { width: 55%; max-width: 32px; height: 60%; max-height: 32px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
`;

function firstVisible(selector) {
return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
}

// Where the button belongs on the page as it stands, or null for the edge
// tab. A lead is open when the call page is, or when Konnect Notes shows
// its own rail button.
function buttonHost() {
const rail = firstVisible('.userQuotesAffix');
if (rail && (onCallPage() || isVisible(rail.querySelector('#kn-notes-launcher-section')))) return { kind: 'rail', rail };
const anchor = firstVisible('button[ng-click="manualCallClick()"]') || firstVisible('button[ng-click="endCall()"]');
return anchor ? { kind: 'phone', anchor } : null;
}

// Only what differs is written: Konnect Notes watches the page and scans
// again on every change.
function setStyle(el, name, value) {
if (el.style.getPropertyValue(name) !== value || el.style.getPropertyPriority(name) !== 'important') el.style.setProperty(name, value, 'important');
}

function pageButton() {
if (ui.pageButton) return ui.pageButton;
if (!document.getElementById(BUTTON_STYLE_ID)) {
const style = document.createElement('style');
style.id = BUTTON_STYLE_ID;
style.textContent = BUTTON_STYLE;
(document.head || document.body).appendChild(style);
}
const button = document.createElement('button');
button.type = 'button';
button.id = BUTTON_ID;
button.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
if (!ui) return;
if (ui.hidden) { showPanel(); render(); } else hidePanel();
});
ui.pageButton = button;
return button;
}

function placeInRail(rail) {
const button = pageButton();
let section = ui.railSection;
if (!section) {
section = ui.railSection = document.createElement('section');
section.id = RAIL_SECTION_ID;
section.className = 'cassini-section';
}
if (button.parentElement !== section) section.appendChild(button);
// Directly under the Konnect Notes button, else under Konnect's last one.
const notes = rail.querySelector('#kn-notes-launcher-section');
const others = Array.from(rail.children).filter((el) => el !== section);
const before = notes && notes.parentElement === rail ? notes : others[others.length - 1] || null;
if (section.parentElement !== rail || section.previousElementSibling !== before) {
if (before) before.insertAdjacentElement('afterend', section); else rail.appendChild(section);
}
// The same circle as the Konnect button beside it, and the same slot.
const neighbour = Array.from(rail.querySelectorAll('.btn-circle')).find((el) => el !== button && isVisible(el));
const size = neighbour ? neighbour.getBoundingClientRect() : { width: 60, height: 60 };
const slot = neighbour && neighbour.closest('section') ? neighbour.closest('section').getBoundingClientRect().height : 75;
const classes = 'btn btn-circle btn-lgr btn-call-nav';
if (button.className !== classes) button.className = classes;
setStyle(button, 'width', `${Math.round(size.width)}px`);
setStyle(button, 'height', `${Math.round(size.height)}px`);
setStyle(button, 'border-radius', neighbour ? getComputedStyle(neighbour).borderRadius || '50%' : '50%');
setStyle(section, 'height', `${Math.round(slot)}px`);
}

function placeInPhoneColumn(anchor) {
const button = pageButton();
if (ui.railSection && ui.railSection.isConnected) ui.railSection.remove();
// Directly above the Konnect Notes Booking button when that is in the
// column, else directly above the call button.
const notes = document.getElementById('kn-inbound-launcher');
const before = notes && notes.parentElement === anchor.parentElement && notes.nextElementSibling === anchor ? notes : anchor;
if (button.nextElementSibling !== before) before.insertAdjacentElement('beforebegin', button);
// Same size and shape as the Phone buttons, without their colour or actions.
const classes = Array.from(anchor.classList).filter((name) => !/^btn-(danger|success|info|warning|primary|default|switch)$/.test(name) && !/^ng-/.test(name)).join(' ');
const size = anchor.getBoundingClientRect();
if (button.className !== classes) button.className = classes;
setStyle(button, 'width', `${Math.round(size.width)}px`);
setStyle(button, 'height', `${Math.round(size.height)}px`);
setStyle(button, 'border-radius', getComputedStyle(anchor).borderRadius || '4px');
}

function removePageButton() {
if (ui.railSection && ui.railSection.isConnected) ui.railSection.remove();
if (ui.pageButton && ui.pageButton.isConnected) ui.pageButton.remove();
}

function paintButton(el, look, hidden) {
if (el.getAttribute('data-state') !== look.state) el.setAttribute('data-state', look.state);
const label = look.text || 'symbol';
if (el.getAttribute('data-label') !== label) {
el.setAttribute('data-label', label);
if (look.text) el.textContent = look.text; else el.innerHTML = BUTTON_SYMBOL;
}
if (el.title !== look.title) el.title = look.title;
const aria = `${look.title}. ${hidden ? 'Open the panel' : 'Hide the panel'}`;
if (el.getAttribute('aria-label') !== aria) el.setAttribute('aria-label', aria);
if (el.getAttribute('aria-expanded') !== String(!hidden)) el.setAttribute('aria-expanded', String(!hidden));
}

// Puts the button where the page as it now stands wants it, and draws its
// state. Runs on every redraw and whenever the page changes.
function syncButton() {
if (!ui) return;
const look = ui.button || { state: 'rest', text: '', title: 'Lead Re setup' };
let host = null;
try { host = buttonHost(); } catch (error) { host = null; }
if (host) {
if (host.kind === 'rail') placeInRail(host.rail); else placeInPhoneColumn(host.anchor);
if (ui.pageButton.getAttribute('data-host') !== host.kind) ui.pageButton.setAttribute('data-host', host.kind);
paintButton(ui.pageButton, look, ui.hidden);
} else removePageButton();
const showTab = !host && ui.hidden;
ui.edgeTab.style.display = showTab ? 'inline-flex' : 'none';
if (showTab) paintButton(ui.edgeTab, look, true);
}

// ===================================================================
// WHERE THE PANEL SITS
// ===================================================================

const POSITION_KEY = '_leadResetPanelPos';
// Tried in turn until the panel covers none of Konnect's own Finished and
// Park It buttons, nor the Konnect Notes Booking button.
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
if (!ui || ui.hidden || (ui.pointerDownAt && Date.now() - ui.pointerDownAt < 3000)) return;
if (ui.position) {
placeAt({ left: Math.max(0, Math.min(window.innerWidth - 80, ui.position.left)), top: Math.max(0, Math.min(window.innerHeight - 40, ui.position.top)) });
return;
}
const avoid = Array.from(document.querySelectorAll(`button[ng-click^="completeCall("], #kn-inbound-launcher, #${BUTTON_ID}`)).filter(isVisible).map((el) => el.getBoundingClientRect());
for (let i = 0; i < CORNERS.length; i++) {
const corner = (ui.corner + i) % CORNERS.length;
placeAt(CORNERS[corner]);
const rect = ui.panel.getBoundingClientRect();
if (!avoid.some((a) => overlaps(rect, a))) { ui.corner = corner; return; }
}
placeAt(CORNERS[ui.corner]);
}

// Brings the panel back from its button.
function showPanel() {
if (!ui) return;
ui.hidden = false;
ui.panel.style.display = '';
syncButton();
}

// Tucks the panel into its button, so the tool stays one click away
// without the bookmark.
function hidePanel() {
if (!ui) return;
closeMenu();
ui.hidden = true;
ui.panel.style.display = 'none';
syncButton();
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
if (readJson(DESK_DECISIONS_KEY)) saveDecisions(loadDecisions());
// A withdrawn request stays its ten minutes, so SLA Manager sees it.
const request = readJson(LIVE_REQUEST_KEY);
if (request && !(Date.now() - new Date(request.at).getTime() <= REQUEST_MAX_AGE_MS)) localStorage.removeItem(LIVE_REQUEST_KEY);
} catch (error) { /* storage blocked: nothing to purge */ }
}

// Takes this copy off the page: its panel, its button, timers and
// listeners. What it keeps in storage stays.
function unload() {
if (versionState && versionState.timer) clearInterval(versionState.timer);
clearTimeout(hubTimer);
if (ui) {
clearInterval(ui.pageTimer);
clearInterval(ui.linkTimer);
clearTimeout(ui.syncTimer);
if (ui.observer) ui.observer.disconnect();
if (typeof window.removeEventListener === 'function') {
window.removeEventListener('storage', ui.onStorage);
window.removeEventListener('mouseup', ui.onMouseUp, true);
window.removeEventListener('mousedown', ui.onOutsideDown, true);
window.removeEventListener('hashchange', ui.onPageChange);
}
removePageButton();
const style = document.getElementById(BUTTON_STYLE_ID);
if (style) style.remove();
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
.note { position: fixed; left: 20px; bottom: 68px; width: 300px; max-width: calc(100vw - 40px); z-index: 2147483000; background: #fff8e6; color: #5a2c00; border: 2px solid #e9a13b; border-radius: 12px; padding: 12px; box-shadow: 0 12px 30px rgba(15, 23, 42, .25); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
p { margin: 0 0 10px; }
button { font: inherit; font-weight: 600; font-size: 12.5px; border-radius: 999px; padding: 6px 12px; cursor: pointer; border: 1px solid #c5cbd6; background: #fff; color: #1c1c1e; margin-right: 6px; }
button.main { background: #0f766e; border-color: #0f766e; color: #fff; }
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
// scratch. Who the agent said they are is a setting, not data, and stays.
function clearAndStop() {
const wasRunning = state.running;
const left = wasRunning ? leftAsIs(state.ctx) : '';
const available = wasRunning && isAvailable();
halted = true;
state.stopRequested = true;
if (resolvePause) answerPause('stop');
try { [PROGRESS_KEY, PASTED_RESULTS_KEY, DESK_PROGRESS_KEY, DESK_RESULTS_KEY, DESK_DECISIONS_KEY].forEach((key) => localStorage.removeItem(key)); } catch (error) { /* ignore */ }
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

function saveSetting(name, value) {
writeJson(SETTINGS_KEY, { ...(readJson(SETTINGS_KEY) || {}), [name]: value });
if (state.ctx) state.ctx.settings = loadSettings();
}

function onPanelClick(event) {
const target = event.target.closest('[data-action]');
const inMenu = !!(ui.menu && target && ui.menu.contains(target));
// A click anywhere but in the open menu closes it. On its own opener that
// is all the click does.
if (ui.menu && !inMenu) {
const sameOpener = target && target === ui.menuOpener;
closeMenu();
if (sameOpener) return;
}
if (!target) return;
const action = target.getAttribute('data-action');
const run = target.getAttribute('data-run');
const key = target.getAttribute('data-key');
if (inMenu) closeMenu(true);
if (action === 'more') {
openMenu(target, moreMenuHtml(), true);
target.setAttribute('aria-expanded', 'true');
return;
}
if (action === 'who') {
const html = whoMenuHtml(run, key);
if (html) openMenu(target, html, false);
return;
}
if (action === 'row') {
const id = `${run}:${key}`;
if (ui.openRows.has(id)) ui.openRows.delete(id); else ui.openRows.add(id);
render();
return;
}
if (action === 'clearStop') { clearAndStop(); return; }
if (action === 'report') {
// Names never leave the page: every known customer name is replaced.
const names = leadsToDo().map((l) => l.name).concat(state.hereLead ? [state.hereLead.name] : [], sendBackLeads().map((l) => l.name), emailOnlySaved().map((l) => l.name), sendThroughSaved().map((l) => l.name)).filter(Boolean);
const redact = (line) => names.reduce((text, name) => text.split(name).join('<customer>'), String(line));
const where = state.running ? `running ${state.mode || ''} step ${state.stepIndex + 1}${state.paused ? ', needs you: ' + state.paused.message : ''}` : 'idle';
reportProblem('Lead Re setup', redact(where), state.log.map(redact));
return;
}
if (action === 'close') { hidePanel(); return; }
if (action === 'reopen') { showPanel(); render(); return; }
if (action === 'review' || action === 'reviewFinish') {
const name = action === 'review' ? 'reviewBeforePark' : 'reviewBeforeFinish';
saveSetting(name, !loadSettings()[name]);
render();
return;
}
if (action === 'how') { ui.howOpen = !ui.howOpen; render(); return; }
if (action === 'copyDetails') {
const lead = listLead(run, key);
if (lead) navigator.clipboard.writeText(detailsForClipboard(run, lead)).then(() => addLog('Details copied'), () => addLog('Could not copy the details'));
return;
}
if (action === 'view') { ui.view = target.getAttribute('data-view'); ui.howOpen = false; render(); return; }
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
if (action === 'skip') { ui.skipAsk = true; ui.focusWhy = true; render(); return; }
if (action === 'skipCancel') { ui.skipAsk = false; ui.skipWhy = ''; render(); return; }
if (action === 'skipConfirm') { answerPause('skip'); return; }
// A reason typed and then not used for a skip is not kept.
if (action === 'carry' || action === 'retry') { ui.skipAsk = false; ui.skipWhy = ''; answerPause(action); return; }
if (action === 'choose') {
const why = String(ui.choiceWhy || '').trim();
ui.choiceWhy = '';
answerPause({ choose: key, why });
return;
}
// Everything below starts or changes something, so it waits for any run
// to end.
if (state.running || state.checking) return;
if (action === 'iAm') { saveSetting('emailOnlyAgent', target.getAttribute('data-agent') || ''); render(); return; }
if (action === 'changeMe') { saveSetting('emailOnlyAgent', ''); ui.view = ui.view === 'st' && sendThroughSaved().length ? 'st' : 'eo'; ui.howOpen = false; render(); return; }
if (action === 'stayAvailable') { saveSetting('stayAvailable', !loadSettings().stayAvailable); render(); return; }
if (action === 'startSt') { runSendThrough(); return; }
if (action === 'start') { runAll(); return; }
if (action === 'startPc') { runSendBack(); return; }
if (action === 'startEo') { runEmailOnly(); return; }
if (action === 'checkParked') { checkParkedOnLive(); return; }
if (action === 'openParked') {
const lead = listLead(run || 'pc', key);
if (lead) openFromParked(lead);
return;
}
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
if (action === 'clearEo') { clearDeskProgress('eo'); return; }
if (action === 'clearSt') { clearDeskProgress('st'); }
}

function onPanelKey(event) {
if (!ui || !ui.menu) return;
if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
const items = Array.from(ui.menu.querySelectorAll('.mi'));
const at = items.indexOf(ui.root.activeElement);
const next = items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
if (next) { event.preventDefault(); next.focus({ preventScroll: true }); }
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
<div class="head"><div class="title"><span class="name">Lead Re setup</span><span class="sub" role="status"></span></div>
<button type="button" class="hbtn" data-action="close" title="Tuck the panel into its button">${icon('minus')}Hide</button>
<button type="button" class="hbtn quiet" data-action="more" aria-haspopup="true" aria-expanded="false">${icon('more')}More</button></div>
<div class="link" role="status"><span class="dot" aria-hidden="true"></span><span class="link-text grow"></span></div>
<div class="body"></div>
<div class="foot"><span class="setting"></span><span>Change it in More</span></div>
</div>
<button type="button" class="edge-tab" data-action="reopen"></button>`;
document.body.appendChild(host);
const panel = root.querySelector('.panel');
const head = root.querySelector('.head');
if (!panel || !head) return false;
ui = { host, root, panel, edgeTab: root.querySelector('.edge-tab'), hidden: false, openRows: new Set(), logOpen: false, stepsOpen: false, todoOpen: false, moreOpen: false, howOpen: false, corner: 0, position: loadPosition(), html: null, linkText: null };
root.addEventListener('click', onPanelClick);
root.addEventListener('keydown', onPanelKey);
root.addEventListener('input', (event) => {
if (event.target.getAttribute && event.target.getAttribute('data-role') === 'skipWhy') ui.skipWhy = event.target.value;
if (event.target.getAttribute && event.target.getAttribute('data-role') === 'choiceWhy') ui.choiceWhy = event.target.value;
});
root.addEventListener('toggle', (event) => {
const section = event.target.getAttribute && event.target.getAttribute('data-section');
const key = { log: 'logOpen', steps: 'stepsOpen', todo: 'todoOpen', more: 'moreOpen' }[section];
if (key) ui[key] = event.target.open;
}, true);
root.addEventListener('mousedown', () => { ui.pointerDownAt = Date.now(); });
ui.onMouseUp = () => {
if (!ui) return;
ui.pointerDownAt = 0;
// After the click that this mouse up belongs to has been handled.
if (ui.renderPending) setTimeout(render, 0);
};
// A press anywhere else on the page closes an open menu.
ui.onOutsideDown = (event) => {
if (ui && ui.menu && !(event.composedPath && event.composedPath().includes(ui.host))) closeMenu();
};
// Redraw when SLA Manager, in another tab on this site, saves new results,
// Email Only assignments or progress on the desk's request.
ui.onStorage = (event) => {
if (!ui) return;
if (event.key === LIVE_LINK_KEY) renderLinkLine();
else if (!state.running && [EMAIL_ONLY_ASSIGNED_KEY, SEND_THROUGH_KEY, NATIONAL_RESULTS_KEY, DESK_RESULTS_KEY, LIVE_STATUS_KEY].includes(event.key)) render();
};
// The button follows the page as leads open and close. The page is only
// watched, never reloaded, and a burst of changes is answered once.
ui.onPageChange = () => {
if (!ui || ui.syncTimer) return;
ui.syncTimer = setTimeout(() => { if (ui) { ui.syncTimer = 0; syncButton(); } }, 250);
};
if (typeof window.addEventListener === 'function') {
window.addEventListener('storage', ui.onStorage);
window.addEventListener('mouseup', ui.onMouseUp, true);
window.addEventListener('mousedown', ui.onOutsideDown, true);
window.addEventListener('hashchange', ui.onPageChange);
}
if (typeof MutationObserver === 'function') {
ui.observer = new MutationObserver(ui.onPageChange);
ui.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
}
// Redraw when the agent moves to another page or customer, and as the
// results on show get older.
ui.pageTimer = setInterval(() => {
if (!ui) return;
// A redraw held back by a mouse press whose release was never seen.
if (ui.renderPending) { render(); return; }
if (state.running) { syncButton(); keepClear(); return; }
const inView = onCallPage() ? leadInView() : null;
const signature = `${onCallPage()}|${liveActivities().map(({ activity }) => activity.ID).join(',')}|${inView ? inView.ID : ''}|${ui.view === 'pc' ? resultsAgeLine() + hubStatusLine() : ''}`;
if (signature !== ui.pageSignature) { ui.pageSignature = signature; render(); } else { syncButton(); keepClear(); }
}, 2000);
// The link line goes stale by the clock, with no storage event to say so.
ui.linkTimer = setInterval(renderLinkLine, 5000);
// Drag by the header to move the panel; where it is left is kept for the
// session.
head.addEventListener('mousedown', (event) => {
if (event.target.closest('button')) return;
closeMenu();
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
const first = ui.root.querySelector('.body [data-action]') || ui.root.querySelector('[data-action="close"]');
if (first && !state.paused) first.focus({ preventScroll: true });
},
replaceable: () => !ui || (!state.running && !!(versionState && versionState.newer)),
unload
};

purgeExpired();
if (buildPanel()) {
window[INSTANCE_KEY] = instance;
// Loaded by Work Tools at the start of the day: stay out of the way as the
// button until it is wanted. A second click of the bookmark opens it.
if (window.WorkToolsStartTucked && !state.running && !state.paused) hidePanel();
}
})();
