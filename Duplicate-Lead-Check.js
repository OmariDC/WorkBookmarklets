// ===================================================================
// DUPLICATE LEAD CHECK
//
// Quick one-off tool for Konnect Live. A bulk drop of leads came
// through in late Oct that look like exact copies of earlier leads. For each customer (Name / Email / First contact date+time)
// this:
//   1. searches the customer by email and opens their timeline,
//   2. finds the lead at the given date+time (exact minute) and reads
//      its Initial Notes, Source and creation method (the timeline
//      heading, e.g. "New Sales Lead from Customer First" vs
//      "Manually Created Sales Lead from ..."),
//   3. opens every other lead from 1 July onwards on the same
//      timeline and compares.
// A lead is flagged DUPLICATE when its Initial Notes are exactly the
// same AND its creation method is the same.
//
// All selectors are copied from Konnect-Lead-Checker.js, where they are
// confirmed against the live DOM - see the comments there for why each
// one is shaped the way it is.
// ===================================================================

(function () {
if (window.__dupLeadCheck && window.__dupLeadCheck.focus) {
window.__dupLeadCheck.focus();
return;
}

const COMPARE_FROM_MONTH = 6; // July (0-based), in the same year as the new lead

// ===================================================================
// SHARED HELPERS (from Konnect-Lead-Checker.js)
// ===================================================================

function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(s) {
return String(s || '').replace(/\s+/g, ' ').trim();
}

function setNativeValue(el, value) {
const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
if (desc && desc.set) desc.set.call(el, value);
else el.value = value;
el.dispatchEvent(new Event('input', { bubbles: true }));
}

function setNativeChecked(el, checked) {
const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'checked');
if (desc && desc.set) desc.set.call(el, checked);
else el.checked = checked;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitFor(predicate, timeout, observeOpts) {
return new Promise((resolve) => {
const first = predicate();
if (first) { resolve(first); return; }
const timer = setTimeout(() => { observer.disconnect(); clearInterval(poll); resolve(null); }, timeout);
function check() {
const v = predicate();
if (v) { clearTimeout(timer); observer.disconnect(); clearInterval(poll); resolve(v); }
}
const observer = new MutationObserver(check);
observer.observe(document.body, observeOpts || { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
const poll = setInterval(check, 150);
});
}

function isVisible(el) {
if (!(el instanceof Element)) return false;
const rect = el.getBoundingClientRect();
const style = getComputedStyle(el);
return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function isRendered(el) {
if (!el) return false;
const style = getComputedStyle(el);
return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
&& !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// ---------- Dates ----------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function monthFromName(text) {
const key = String(text || '').slice(0, 3).toLowerCase();
return Object.prototype.hasOwnProperty.call(MONTHS, key) ? MONTHS[key] : null;
}

// Timeline shapes: "5 May 2023 07:02" and "26 Sep 22:10" (current year).
function parseTimelineTimestamp(text) {
const c = clean(text);
let m = c.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})$/);
if (m) {
const month = monthFromName(m[2]);
return month === null ? null : { year: +m[3], month, day: +m[1], hour: +m[4], minute: +m[5] };
}
m = c.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}):(\d{2})$/);
if (m) {
const month = monthFromName(m[2]);
return month === null ? null : { year: new Date().getFullYear(), month, day: +m[1], hour: +m[3], minute: +m[4] };
}
return null;
}

// Input shapes accepted for the first contact date+time:
// "23 Oct 2026 14:05", "Thu, 23 Oct 2026 14:05", "23 Oct 14:05",
// "2026-10-23 14:05(:ss)", "10/24/2026 9:21" (the export's own US
// month-first shape). Slash dates are read month-first unless the
// first number can only be a day (over 12), e.g. "24/10/2026 9:21".
function parseInputDateTime(text) {
const c = clean(text);
const year = new Date().getFullYear();
let m = c.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
if (m && monthFromName(m[2]) !== null) return { year: +m[3], month: monthFromName(m[2]), day: +m[1], hour: +m[4], minute: +m[5] };
m = c.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}):(\d{2})/);
if (m && monthFromName(m[2]) !== null) return { year, month: monthFromName(m[2]), day: +m[1], hour: +m[3], minute: +m[4] };
m = c.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
if (m) return { year: +m[1], month: +m[2] - 1, day: +m[3], hour: +m[4], minute: +m[5] };
m = c.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?,?\s+(\d{1,2}):(\d{2})/);
if (m) {
let y = m[3] ? +m[3] : year;
if (y < 100) y += 2000;
const dayFirst = +m[1] > 12;
return { year: y, month: (dayFirst ? +m[2] : +m[1]) - 1, day: dayFirst ? +m[1] : +m[2], hour: +m[4], minute: +m[5] };
}
return null;
}

// Modal Date: "Fri 5th May 2023 07:02".
function parseModalDate(text) {
return parseTimelineTimestamp(String(text || '').replace(/^[A-Za-z]{3,}\s+/, '').replace(/(\d{1,2})(st|nd|rd|th)\b/i, '$1'));
}

function sameMinute(a, b) {
return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

function sameDay(a, b) {
return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
}

// ===================================================================
// SEARCH + TIMELINE
// ===================================================================

async function openCustomerByEmail(email, name) {
window.location.hash = '#/search?redirectRoute=%2Fsearch';
if (!await waitFor(() => document.querySelector('input[name="bookingSearchBy"]'), 15000)) return { error: 'Search page did not load' };

const radio = document.querySelector('input[name="bookingSearchBy"][value="4"]');
if (!radio) return { error: 'Email search option not found' };
if (!radio.checked) setNativeChecked(radio, true);

const input = document.querySelector('input[ng-model="uiSettings.searchText"]');
if (!input) return { error: 'Search box not found' };
setNativeValue(input, '');
input.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(20);
setNativeValue(input, email);
input.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(150);

const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent.trim() === 'Records Found:');
const spinner = label ? label.parentElement.querySelector('i.fa-refresh') : null;
const button = document.getElementById('btnSearch');
if (!button || button.disabled || !spinner) return { error: 'Search button not found' };
button.click();
if (!await waitFor(() => !spinner.classList.contains('ng-hide'), 5000)) return { error: 'Search did not start' };
if (!await waitFor(() => spinner.classList.contains('ng-hide'), 15000)) return { error: 'Search timed out' };

const grid = document.getElementById('grid');
const rows = grid ? Array.from(grid.querySelectorAll('[role="row"][row-index]')).map((row) => {
const link = row.querySelector('[col-id="CustomerName"] a[ng-click*="navToConnectedCustomer"]');
const id = link ? (link.getAttribute('ng-click') || '').match(/navToConnectedCustomer\((\d+)\)/) : null;
return { link, id: id ? id[1] : null, name: link ? clean(link.textContent) : '' };
}).filter((r) => r.link && r.id) : [];
if (rows.length === 0) return { error: 'No customer found for that email' };

let pick = rows[0];
if (new Set(rows.map((r) => r.id)).size > 1) {
const want = clean(name).toLowerCase();
const byName = rows.filter((r) => r.name.toLowerCase().includes(want));
if (byName.length !== 1) return { error: 'More than one customer on that email - check by hand' };
pick = byName[0];
}

pick.link.click();
const ready = await waitForTimelineReady();
return ready ? { ok: true } : { error: 'Timeline did not load' };
}

function findTimelineRoot() {
return document.querySelector('div[ng-view] > div.ng-scope:has(> .row.timeline-editing-header) > div[style="margin-top:80px;"]')
|| document.querySelector('.row.timeline-editing-header + div[style="margin-top:80px;"]');
}

async function waitForTimelineReady() {
let lastCount = -1;
let stableSince = 0;
return waitFor(() => {
if (!/^#\/connectedCustomer\/\d+(?:\?|$)/.test(window.location.hash)) return null;
if (!findTimelineRoot()) return null;
if (isRendered(document.querySelector('i[title="Refreshing..."][ng-show="loading"]'))) return null;
if (!isRendered(document.querySelector('i[title="Refresh"][ng-show="!loading"]'))) return null;
const count = getLeadEntries().length;
if (count !== lastCount) { lastCount = count; stableSince = Date.now(); return null; }
return Date.now() - stableSince >= 300 ? true : null;
}, 15000);
}

const LEAD_HEADING_PREFIXES = ['Manually Created Sales Lead from', 'New Sales Lead from', 'Source Unknown'];

function leadHeading(row) {
const el = row.querySelector('.connected-customer-title-pink');
return el ? clean(el.textContent) : '';
}

function getLeadEntries() {
const rows = [...document.querySelectorAll('a.connected-customer-timeline-centre-pink')]
.map((icon) => icon.closest('div.row.ng-scope[ng-repeat*="customerTimeLine"]'))
.filter(Boolean);
return [...new Set(rows)].filter((row) => LEAD_HEADING_PREFIXES.some((p) => leadHeading(row).startsWith(p)));
}

function entryTimestamp(row) {
const heading = row.querySelector('.connected-customer-timeline-heading-left-pink, .connected-customer-timeline-heading-right-pink');
if (!heading) return null;
const direct = clean([...heading.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' '));
if (direct) return direct;
const clone = heading.cloneNode(true);
clone.querySelectorAll('[title="This is the Konnect Lead ID"]').forEach((el) => el.remove());
return clean(clone.textContent);
}

function entryLeadId(row) {
const m = row.querySelector('[title="This is the Konnect Lead ID"]')?.textContent.match(/\d+/);
return m ? m[0] : null;
}

function describeEntries() {
return getLeadEntries().map((row) => {
const raw = entryTimestamp(row);
return { row, raw, parsed: raw ? parseTimelineTimestamp(raw) : null, leadId: entryLeadId(row), method: leadHeading(row) };
});
}

// Scroll until no new lead entries appear, so July onwards is loaded.
// The scroll container is a best guess (same as Lead Checker's).
async function loadWholeTimeline(isEarliestEnough) {
const root = findTimelineRoot();
let scroller = root ? root.parentElement : null;
while (scroller && scroller !== document.body) {
const s = getComputedStyle(scroller);
if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
scroller = scroller.parentElement;
}
if (scroller === document.body) scroller = null;

let quiet = 0;
for (let i = 0; i < 40 && quiet < 3; i++) {
if (isEarliestEnough()) return;
const before = getLeadEntries().length;
if (scroller) scroller.scrollTop = scroller.scrollHeight;
else window.scrollTo(window.scrollX, document.documentElement.scrollHeight);
await sleep(500);
if (getLeadEntries().length === before) quiet++;
else quiet = 0;
}
}

// ===================================================================
// LEAD MODAL
// ===================================================================

function footerField(panel, labelText) {
const labels = Array.from(panel.querySelectorAll('div')).filter((el) => el.children.length === 0 && clean(el.textContent) === labelText);
for (const label of labels) {
const strong = label.parentElement ? label.parentElement.querySelector('footer strong.ng-binding') : null;
if (strong) return clean(strong.textContent);
}
return null;
}

function activeModal() {
const modal = Array.from(document.querySelectorAll('.modal[role="dialog"].in')).find(isVisible);
if (!modal) return null;
const panel = modal.querySelector('.tab-pane.active') || modal;
const notes = panel.querySelector('#txtInitialNotes');
if (!notes || !footerField(panel, 'Date')) return null;
return { modal, panel, notes };
}

function anyModalOpen() {
return Array.from(document.querySelectorAll('.modal[role="dialog"].in')).some(isVisible);
}

async function closeModal() {
if (!anyModalOpen()) return;
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
await waitFor(() => !anyModalOpen(), 1500, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

// Opens a lead, reads it, closes it. Checks the modal's own Date
// against the entry's timestamp so a stale modal is never read.
async function readLead(entry) {
await closeModal();
const target = entry.row.querySelector('a.connected-customer-timeline-centre-pink > i[ng-click^="showDetails("]');
if (!target) return { error: 'Could not click lead' };
target.scrollIntoView({ block: 'center' });
target.click();
let state = await waitFor(activeModal, 10000);
if (!state) {
target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
state = await waitFor(activeModal, 10000);
}
if (!state) return { error: 'Lead did not open' };
const date = footerField(state.panel, 'Date');
const source = footerField(state.panel, 'Source');
const notes = state.notes.textContent.trim();
await closeModal();
if (entry.parsed && !sameMinute(parseModalDate(date), entry.parsed)) return { error: `Opened lead date "${date}" did not match timeline "${entry.raw}"` };
return { notes, source, date };
}

// ===================================================================
// CHECK ONE CUSTOMER
// ===================================================================

async function checkCustomer(row, log) {
const target = parseInputDateTime(row.created);
if (!target) return { verdict: 'ERROR', detail: `Could not read date/time "${row.created}"` };

log(`Searching ${row.email}...`);
const opened = await openCustomerByEmail(row.email, row.name);
if (opened.error) return { verdict: 'ERROR', detail: opened.error };

log('Loading timeline back to July...');
await loadWholeTimeline(() => describeEntries().some((e) => e.parsed && (e.parsed.year < target.year || e.parsed.month < COMPARE_FROM_MONTH)));

const entries = describeEntries();
let targetEntry = entries.filter((e) => sameMinute(e.parsed, target));
let note = '';
if (targetEntry.length === 0) {
// First contact time may not be the exact lead minute - fall back
// to the single lead on that day if there's only one.
const sameDayEntries = entries.filter((e) => sameDay(e.parsed, target));
if (sameDayEntries.length === 1) {
targetEntry = sameDayEntries;
note = `No lead at that exact minute, used the only lead that day (${sameDayEntries[0].raw}). `;
}
}
if (targetEntry.length === 0) return { verdict: 'ERROR', detail: 'No lead found at that date/time on the timeline' };
if (targetEntry.length > 1) return { verdict: 'ERROR', detail: 'More than one lead at that date/time - check by hand' };
const newEntry = targetEntry[0];

log(`Reading lead ${newEntry.raw}...`);
const newLead = await readLead(newEntry);
if (newLead.error) return { verdict: 'ERROR', detail: newLead.error };

const compareEntries = entries.filter((e) => e !== newEntry && e.parsed
&& (e.parsed.year > target.year || (e.parsed.year === target.year && e.parsed.month >= COMPARE_FROM_MONTH)));
const base = { newLeadId: newEntry.leadId, newMethod: newEntry.method, newSource: newLead.source, newNotes: newLead.notes };
if (compareEntries.length === 0) return { verdict: 'NO OTHER LEADS', detail: note + 'No other leads since 1 July on this timeline.', ...base };

const exact = [];
const notesOnly = [];
const loose = [];
const unread = [];
for (let i = 0; i < compareEntries.length; i++) {
const other = compareEntries[i];
log(`Comparing with ${other.raw} (${i + 1}/${compareEntries.length})...`);
const old = await readLead(other);
// One lead that won't open shouldn't sink the rest of the check.
if (old.error) { unread.push(`${other.raw}: ${old.error}`); continue; }
const sameMethod = other.method === newEntry.method;
const label = `${other.raw} (Lead ${other.leadId || '?'})`;
if (old.notes === newLead.notes) {
(sameMethod ? exact : notesOnly).push(label);
} else if (sameMethod && clean(old.notes).toLowerCase() === clean(newLead.notes).toLowerCase()) {
loose.push(label);
}
}

const unreadNote = unread.length ? ` Could not read ${unread.length}: ${unread.join('; ')}` : '';
if (exact.length) return { verdict: 'DUPLICATE', detail: note + `Exact same notes and creation method as ${exact.join(', ')}` + unreadNote, ...base };
if (loose.length) return { verdict: 'NEAR DUPLICATE', detail: note + `Same creation method, notes only differ in spacing/case: ${loose.join(', ')}` + unreadNote, ...base };
if (notesOnly.length) return { verdict: 'NOTES MATCH, METHOD DIFFERS', detail: note + `Same notes but different creation method: ${notesOnly.join(', ')}` + unreadNote, ...base };
if (unread.length) return { verdict: 'INCOMPLETE', detail: note + `No match in the ${compareEntries.length - unread.length} lead(s) read since 1 July.` + unreadNote, ...base };
return { verdict: 'NOT DUPLICATE', detail: note + `Checked ${compareEntries.length} lead(s) since 1 July, none matched.`, ...base };
}

// ===================================================================
// INPUT
// ===================================================================

// One customer per line: Name, Email, First contact date/time,
// separated by tabs (pasted from a spreadsheet) or commas. The email
// is found by its @, so column order doesn't matter much.
function parseInput(text) {
return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
const parts = (line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*(?=\S)/)).map((p) => p.trim()).filter(Boolean);
const emailIdx = parts.findIndex((p) => /\S+@\S+\.\S+/.test(p));
const dateIdx = parts.findIndex((p, i) => i !== emailIdx && parseInputDateTime(p));
const name = parts.filter((p, i) => i !== emailIdx && i !== dateIdx).join(' ');
return { line, name, email: emailIdx >= 0 ? parts[emailIdx] : '', created: dateIdx >= 0 ? parts[dateIdx] : '' };
}).filter((r, i, all) => !/^name\b/i.test(r.line)
// The same customer pasted twice only needs checking once.
&& all.findIndex((o) => o.email.toLowerCase() === r.email.toLowerCase() && o.created === r.created) === i);
}

// ===================================================================
// UI
// ===================================================================

const COLORS = {
'DUPLICATE': '#c62828',
'NEAR DUPLICATE': '#ef6c00',
'NOTES MATCH, METHOD DIFFERS': '#8e6c00',
'NOT DUPLICATE': '#2e7d32',
'NO OTHER LEADS': '#2e7d32',
'INCOMPLETE': '#616161',
'ERROR': '#616161'
};

function esc(s) {
return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const panel = document.createElement('div');
panel.id = 'dup-lead-check';
panel.style.cssText = 'position:fixed;top:70px;right:16px;width:440px;max-height:calc(100vh - 90px);display:flex;flex-direction:column;z-index:2147483646;background:#fff;color:#1d1d1f;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
panel.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e5e5ea;">
<strong style="font-size:14px;">Duplicate Lead Check (Jul to now)</strong>
<button data-act="close" style="border:0;background:none;font-size:18px;cursor:pointer;color:#888;">&times;</button>
</div>
<div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
<div style="color:#666;font-size:12px;">One customer per line: <b>Name, Email, First contact date/time</b> (tab or comma separated). E.g.<br><code>Mr. Omar Sowe&#9;omar@x.com&#9;10/24/2026 9:21</code></div>
<textarea data-el="input" rows="5" style="width:100%;box-sizing:border-box;font:12px monospace;padding:6px;border:1px solid #ccc;border-radius:6px;resize:vertical;"></textarea>
<div style="display:flex;gap:8px;">
<button data-act="run" style="flex:1;padding:7px;border:0;border-radius:6px;background:#0071e3;color:#fff;cursor:pointer;font-weight:600;">Check</button>
<button data-act="stop" style="padding:7px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;">Stop</button>
<button data-act="copy" style="padding:7px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;">Copy results</button>
</div>
<div data-el="status" style="color:#666;font-size:12px;min-height:16px;"></div>
</div>
<div data-el="results" style="overflow:auto;padding:0 14px 12px;"></div>`;
document.body.appendChild(panel);

const $ = (sel) => panel.querySelector(sel);
const results = [];
let running = false;
let stopRequested = false;

function setStatus(text) { $('[data-el="status"]').textContent = text; }

function renderResults() {
$('[data-el="results"]').innerHTML = results.map((r) => `
<div style="border:1px solid #e5e5ea;border-left:4px solid ${COLORS[r.verdict] || '#999'};border-radius:8px;padding:8px 10px;margin-top:8px;">
<div style="display:flex;justify-content:space-between;gap:8px;">
<b>${esc(r.name || r.email)}</b>
<span style="color:${COLORS[r.verdict] || '#999'};font-weight:700;white-space:nowrap;">${esc(r.verdict)}</span>
</div>
<div style="color:#666;font-size:12px;">${esc(r.email)} &middot; ${esc(r.created)}${r.newLeadId ? ' &middot; Lead ' + esc(r.newLeadId) : ''}</div>
${r.newMethod ? `<div style="font-size:12px;">${esc(r.newMethod)}${r.newSource ? ' &middot; ' + esc(r.newSource) : ''}</div>` : ''}
<div style="font-size:12px;margin-top:4px;">${esc(r.detail)}</div>
${r.newNotes ? `<details style="font-size:12px;margin-top:4px;"><summary style="cursor:pointer;color:#0071e3;">Initial notes</summary><div style="white-space:pre-wrap;background:#f5f5f7;padding:6px;border-radius:4px;margin-top:4px;">${esc(r.newNotes)}</div></details>` : ''}
</div>`).join('');
}

function resultsTsv() {
const header = ['Name', 'Email', 'First Contact', 'Verdict', 'Lead ID', 'Creation Method', 'Source', 'Detail'];
const rows = results.map((r) => [r.name, r.email, r.created, r.verdict, r.newLeadId, r.newMethod, r.newSource, r.detail]
.map((v) => clean(v).replace(/\t/g, ' ')).join('\t'));
return [header.join('\t')].concat(rows).join('\n');
}

async function run() {
if (running) return;
const rows = parseInput($('[data-el="input"]').value);
if (rows.length === 0) { setStatus('Nothing to check - paste at least one line.'); return; }
running = true;
stopRequested = false;
results.length = 0;
renderResults();
for (let i = 0; i < rows.length; i++) {
if (stopRequested) break;
const row = rows[i];
const prefix = `[${i + 1}/${rows.length}] ${row.name || row.email}: `;
let outcome;
if (!row.email) outcome = { verdict: 'ERROR', detail: 'No email found on this line' };
else if (!row.created) outcome = { verdict: 'ERROR', detail: 'No date/time found on this line' };
else {
try {
outcome = await checkCustomer(row, (msg) => setStatus(prefix + msg));
} catch (e) {
outcome = { verdict: 'ERROR', detail: String(e && e.message || e) };
}
}
results.push({ ...row, ...outcome });
renderResults();
}
const dupCount = results.filter((r) => r.verdict === 'DUPLICATE').length;
setStatus(`${stopRequested ? 'Stopped' : 'Done'}: ${results.length} checked, ${dupCount} duplicate(s).`);
running = false;
}

panel.addEventListener('click', (e) => {
const act = e.target.closest('[data-act]')?.getAttribute('data-act');
if (act === 'run') run();
if (act === 'stop') { stopRequested = true; setStatus('Stopping after the current customer...'); }
if (act === 'copy') {
const text = resultsTsv();
(navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
() => setStatus('Results copied - paste into a spreadsheet.'),
() => { window.prompt('Copy the results:', text); }
);
}
if (act === 'close') {
stopRequested = true;
panel.remove();
delete window.__dupLeadCheck;
}
});

window.__dupLeadCheck = { focus: () => $('[data-el="input"]').focus() };
window.__dupLeadCheck.focus();
})();
