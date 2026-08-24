(function() {
const BADGE_ID = '_slaBadge';
const BADGE_COLOR = '#2c3e50';
const BADGE_BORDER_COLOR = '#27ae60';
const PANEL_ID = '_slaPanel';
const PANEL_BOX_ID = '_slaPanelBox';
const PANEL_STATE_KEY = '_slaPanelState';
const PANEL_SIZE_KEY = '_slaPanelSize';
const ASSIGN_SETTINGS_KEY = '_slaAssignSettings';

// SLA table columns: Customer, Registration, Source, Campaign, Created,
// Received, SLA Date, Status, Assign. td-only queries mean the bare
// <tr><th>...</th></tr> header row (no real <thead> on this page) is
// skipped automatically, since row.querySelectorAll('td') is empty for it.
const COL_CUSTOMER = 0;
const COL_REGISTRATION = 1;
const COL_SOURCE = 2;
const COL_CAMPAIGN = 3;
const COL_CREATED = 4;
const COL_RECEIVED = 5;
const COL_SLA_DATE = 6;
const COL_STATUS = 7;
const COL_ASSIGN = 8;

// Pending Customers table columns: Dealer, Brand, Customer, Reg, Email,
// Mobile, Landline, Campaign, Callback Type, Last Action Date,
// Next Action Date, Assign. Reg here is plain text (unlike the SLA
// table's linked Registration column) and Email/Mobile/Landline are
// plain text too, so no modal click-and-wait is needed on this page.
const PC_COL_DEALER = 0;
const PC_COL_BRAND = 1;
const PC_COL_CUSTOMER = 2;
const PC_COL_REG = 3;
const PC_COL_EMAIL = 4;
const PC_COL_MOBILE = 5;
const PC_COL_LANDLINE = 6;
const PC_COL_CAMPAIGN = 7;
const PC_COL_CALLBACK_TYPE = 8;
const PC_COL_LAST_ACTION = 9;
const PC_COL_NEXT_ACTION = 10;
const PC_COL_ASSIGN = 11;

// How far a Missed lead's sort position gets pushed back relative to its
// real due time - keeps it from always beating a Critical lead due in
// minutes, while still generally sorting ahead of anything due much later.
const MISSED_PENALTY_MS = 30 * 60 * 1000;

const PAGE_SLA = 'sla';
const PAGE_PENDING = 'pending';
const SLA_HEADERS = ['Customer', 'Registration', 'Source', 'Campaign', 'Created', 'Received', 'SLA Date', 'Status', 'Assign'];
const PENDING_HEADERS = ['Dealer', 'Brand', 'Customer', 'Reg', 'Email', 'Mobile', 'Landline', 'Campaign', 'Callback Type', 'Last Action Date', 'Next Action Date', 'Assign'];

function headersMatch(actual, expected) {
return actual.length === expected.length && actual.every((h, i) => h === expected[i]);
}

// Detects which page we're on from the table's header row rather than the
// URL, so it keeps working regardless of route changes - and refuses to
// run at all (returns null) rather than guessing at an unrecognized table.
function detectPageType() {
const table = document.querySelector('table');
if (!table) return null;
const headerRow = table.querySelector('tr');
if (!headerRow) return null;
const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim());
if (headers.length === 0) return null;

if (headersMatch(headers, SLA_HEADERS)) return PAGE_SLA;
if (headersMatch(headers, PENDING_HEADERS)) return PAGE_PENDING;
return null;
}

let badge = null;
let panelElement = null;
let extracting = false;
let assigning = false;
let lastFailedAssignmentPlan = null;
let lastFailedLocateCellFn = null;
let currentPageType = null;
let currentCustomers = [];
let currentPendingCustomers = [];

function categorizeTier(campaign, source) {
const camp = campaign.toLowerCase();
const src = source.toLowerCase();

if (camp.includes('test drive request') && camp.includes('new'))
return { tier: 1, reason: 'Test Drive Request - New' };
if (camp.includes('test drive request') && camp.includes('used'))
return { tier: 1, reason: 'Test Drive Request - Used' };
if (camp.includes('electric'))
return { tier: 1, reason: 'Brand - Electric' };
if (camp.includes('reserve') && camp.includes('used'))
return { tier: 1, reason: 'Reserve - Used' };

if (camp.includes('enquiry') && camp.includes('new') && src.includes('customer first'))
return { tier: 2, reason: 'Enquiry - New (Customer First)' };
if (camp.includes('motability'))
return { tier: 2, reason: 'Motability' };
if (src.includes('leapmotor'))
return { tier: 2, reason: 'Leapmotor (Source)' };

if (camp.includes('enquiry') && camp.includes('used'))
return { tier: 3, reason: 'Enquiry - Used' };
if (camp.includes('offer request') && camp.includes('new'))
return { tier: 3, reason: 'Offer Request - New' };
if ((camp.includes('px valuation') || camp.includes('p/x valuation')) && camp.includes('new'))
return { tier: 3, reason: 'PX Valuation - New' };

if (camp.includes('enquiry') && camp.includes('new') && src.includes('robins'))
return { tier: 4, reason: 'Enquiry - New (Robins & Day)' };
if (camp.includes('general'))
return { tier: 4, reason: 'General' };
if (camp.includes('inbound'))
return { tier: 4, reason: 'Inbound' };

return { tier: 4, reason: 'Uncategorized' };
}

function findDetailModal() {
return document.querySelector('[role="alertdialog"]') || document.querySelector('.modal');
}

function waitForModal(timeout = 3000) {
return new Promise((resolve) => {
const existing = findDetailModal();
if (existing) {
resolve(existing);
return;
}

const timer = setTimeout(() => {
observer.disconnect();
resolve(null);
}, timeout);

const observer = new MutationObserver(() => {
const modal = findDetailModal();
if (modal) {
clearTimeout(timer);
observer.disconnect();
resolve(modal);
}
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

// Waits for the currently-open modal to actually leave the DOM, so the
// next row's click doesn't race a still-closing modal and get matched to
// it by waitForModal's "already exists" fast path.
function waitForModalGone(timeout = 500) {
return new Promise((resolve) => {
if (!findDetailModal()) {
resolve();
return;
}

const timer = setTimeout(() => {
observer.disconnect();
resolve();
}, timeout);

const observer = new MutationObserver(() => {
if (!findDetailModal()) {
clearTimeout(timer);
observer.disconnect();
resolve();
}
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

async function extractCustomerDetails(customerElement) {
const nameLink = customerElement.querySelector('a');
if (!nameLink) {
return { phone: '', email: '' };
}

nameLink.click();

const modal = await waitForModal();
if (!modal) {
return { phone: '', email: '' };
}

// Give the modal's async content a brief moment to render after it mounts.
await new Promise(resolve => setTimeout(resolve, 150));

try {
const modalText = modal.innerText || modal.textContent;

const phoneMatch = modalText.match(/\b(07\d{9}|0\d{3}\s?\d{3}\s?\d{3,4}|0\d{10})\b/);
const phone = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : '';

const emailMatch = modalText.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
const email = emailMatch ? emailMatch[1] : '';

const closeBtn = modal.querySelector('.close, [aria-label*="close"], [aria-label*="Close"]')
|| modal.querySelector('button:last-child');
if (closeBtn) {
closeBtn.click();
} else {
const escEvent = new KeyboardEvent('keydown', {
key: 'Escape',
code: 'Escape',
keyCode: 27,
which: 27,
bubbles: true
});
document.dispatchEvent(escEvent);
}

await waitForModalGone();

return { phone, email };
} catch (error) {
console.warn('Detail extraction error:', error);
return { phone: '', email: '' };
}
}

function copyToClipboard(text, element) {
const originalText = element.textContent;
navigator.clipboard.writeText(text).then(() => {
element.textContent = '✓ Copied!';
element.style.background = '#27ae60';
element.style.color = 'white';
setTimeout(() => {
element.textContent = originalText;
element.style.background = '';
element.style.color = '';
}, 1500);
}).catch((error) => {
console.warn('Copy failed:', error);
element.textContent = '✗ Failed';
element.style.background = '#e74c3c';
element.style.color = 'white';
setTimeout(() => {
element.textContent = originalText;
element.style.background = '';
element.style.color = '';
}, 1500);
});
}

function escapeHtml(value) {
return String(value).replace(/[&<>"']/g, (c) => ({
'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
}

function stripTitle(name) {
return name.replace(/^(mr|mrs|miss|ms|mx|dr|prof|rev|sir|lady)\.?\s+/i, '').trim();
}

function renderCopyableField(value) {
if (!value) {
return `<span style="padding: 4px 6px; border-radius: 4px; background: #ecf0f1; color: #95a5a6; display: inline-block; font-size: 13px;">N/A</span>`;
}
const display = escapeHtml(value);
return `<span class="sla-copyable" data-value="${display}" style="cursor: pointer; padding: 4px 6px; border-radius: 4px; background: #e8f4f8; color: #2c3e50; display: inline-block; font-size: 13px;">${display}</span>`;
}

function renderAssignmentBadge(assigned, agentName) {
return assigned
? `<span style="background: #e8f5e9; color: #27ae60; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0;">✓ ${escapeHtml(agentName || 'Assigned')}</span>`
: `<span style="background: #f8f9fa; color: #95a5a6; padding: 2px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; flex-shrink: 0;">Unassigned</span>`;
}

// ===================================================================
// ASSIGNMENT ENGINE (shared between the SLA tab and Pending Customers)
//
// Agent shape and dropdown markup both confirmed live (see normalizeAgent
// and findAgentMenuItem below). Both pages' Assign column use the
// identical div.dropdown.ng-scope structure. The one thing still
// genuinely untested end-to-end is a real click actually completing an
// assignment - runAssignmentPlan/waitForAssignConfirmed are built and
// unit-tested against fabricated data, but not yet run against Konnect.
// ===================================================================

function parseKonnectDate(text) {
// Matches "Tue, 18 Aug 2026 09:15" - the weekday prefix is ignored. Used
// for SLA Date on the SLA table and Last/Next Action Date on the Pending
// Customers table - same app-wide date rendering, unconfirmed for the
// latter two but a reasonable assumption; a lead with an unparseable date
// simply gets excluded from date-filtered results rather than guessed at.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const match = text.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
if (!match) return null;
const [, day, monName, year, hour, minute] = match;
const month = MONTHS[monName];
if (month === undefined) return null;
return new Date(Number(year), month, Number(day), Number(hour), Number(minute));
}

function getAssignCellState(cell) {
if (!cell) return { assigned: false, agentName: null };
const dropdown = cell.querySelector('.dropdown');
if (dropdown) {
return { assigned: false, agentName: null };
}
return { assigned: true, agentName: cell.textContent.trim() };
}

// Confirmed live: {ID: 1809, DisplayText: "Daniel Paling",
// CurrentStatusName: "Live Chat", $$hashKey: "object:223"}.
function normalizeAgent(agent) {
return {
id: String(agent.ID),
name: agent.DisplayText,
status: agent.CurrentStatusName || '',
raw: agent
};
}

function getAgentRoster() {
// Scoped to the SLA table first so an unrelated page dropdown sharing
// the same classes can't get picked up by accident.
const scopeHost = document.querySelector('table .dropdown.ng-scope') || document.querySelector('.dropdown.ng-scope');
if (!scopeHost || typeof angular === 'undefined') return [];
try {
const scope = angular.element(scopeHost).scope();
const agents = (scope && scope.agents) || [];
return agents.map(normalizeAgent);
} catch (error) {
console.warn('Could not read agent roster:', error);
return [];
}
}

// The live "N leads match" preview re-runs on every checkbox/wheel
// change and was re-scanning the entire table each time, which is the
// real cause behind assignment feeling slow - not the click-to-assign
// step itself. Cached per render cycle instead: invalidated once when a
// fresh extraction mounts or a manual refresh happens, then reused by
// every filter tweak until the next invalidation. The actual assign
// action (_runSlaAssignment/_runPendingAssignment) deliberately bypasses
// this cache and always re-scans fresh immediately before clicking -
// correctness matters more than speed for the action that actually
// touches live data, unlike the preview which can tolerate being a few
// seconds stale.
let cachedLeadsSnapshot = null;

function invalidateLeadsCache() {
cachedLeadsSnapshot = null;
}

function getCachedAssignableLeads() {
if (!cachedLeadsSnapshot || cachedLeadsSnapshot.pageType !== PAGE_SLA) {
cachedLeadsSnapshot = { pageType: PAGE_SLA, leads: collectAssignableLeads(), scannedAt: new Date() };
}
return cachedLeadsSnapshot.leads;
}

function getCachedPendingCustomers() {
if (!cachedLeadsSnapshot || cachedLeadsSnapshot.pageType !== PAGE_PENDING) {
cachedLeadsSnapshot = { pageType: PAGE_PENDING, leads: collectPendingCustomers(), scannedAt: new Date() };
}
return cachedLeadsSnapshot.leads;
}

// Static "last scanned at HH:MM" rather than a live-ticking "Xm ago" -
// deliberately not using an interval to keep this updating, given
// tonight's zombie-interval lesson (every past bookmarklet invocation
// would leave its own interval running forever unless very carefully
// guarded). A static timestamp still tells you whether to hit refresh,
// without adding another background timer to get wrong.
function lastScannedLabel() {
if (!cachedLeadsSnapshot || !cachedLeadsSnapshot.scannedAt) return 'not yet scanned';
return 'scanned ' + formatTimeForInput(cachedLeadsSnapshot.scannedAt);
}

function collectAssignableLeads() {
const table = document.querySelector('table');
if (!table) return [];

// collectAssignableLeads() stays a fast synchronous scan (no modal
// click-and-wait) - phone/email for the "Email only" filter come from
// currentCustomers, the cache already populated by a normal extraction
// (extractAndExportSla), rather than re-scraping every row here. A lead
// never scanned yet has unknown phone/email and is excluded from the
// Email only filter rather than guessed at (same "unknown -> excluded"
// approach used for unparseable dates elsewhere in this file).
const cachedByKey = new Map(currentCustomers.map(c => [c.key, c]));

const leads = [];
table.querySelectorAll('tbody tr').forEach((row) => {
const cells = row.querySelectorAll('td');
if (cells.length < 9) return;

const name = cells[COL_CUSTOMER]?.textContent?.trim();
const campaign = cells[COL_CAMPAIGN]?.textContent?.trim();
if (!name || !campaign) return;

const registration = cells[COL_REGISTRATION]?.textContent?.trim();
const source = cells[COL_SOURCE]?.textContent?.trim();
const slaDate = parseKonnectDate(cells[COL_SLA_DATE]?.textContent?.trim() || '');
const status = cells[COL_STATUS]?.textContent?.trim();
const tierInfo = categorizeTier(campaign, source);
const assignState = getAssignCellState(cells[COL_ASSIGN]);
const key = `${name}||${registration}||${source}||${campaign}`;
const cached = cachedByKey.get(key);

leads.push({
key,
name, registration, source, campaign,
slaDate, status, tier: tierInfo.tier,
assigned: assignState.assigned,
agentName: assignState.agentName,
isCustomerFirst: source.toLowerCase().includes('customer first'),
isEmailOnly: !!cached && !cached.phone && !!cached.email
});
});

return leads;
}

function computeSortKey(lead) {
if (!lead.slaDate) return Infinity;
const time = lead.slaDate.getTime();
return lead.status === 'Missed' ? time + MISSED_PENALTY_MS : time;
}

function prioritizeLeads(leads) {
return [...leads].sort((a, b) => computeSortKey(a) - computeSortKey(b));
}

function filterAssignableLeads(leads, { tiers, windowMinutes, customerFirstOnly, emailOnly }) {
const now = Date.now();
return leads.filter((lead) => {
if (lead.assigned) return false;
if (!tiers.has(lead.tier)) return false;
if (customerFirstOnly && !lead.isCustomerFirst) return false;
if (emailOnly && !lead.isEmailOnly) return false;
if (windowMinutes != null && lead.slaDate) {
const minutesUntilDue = (lead.slaDate.getTime() - now) / 60000;
if (minutesUntilDue > windowMinutes) return false;
}
return true;
});
}

// Always starting the cycle at agents[0] meant whoever happened to be
// first in the roster quietly got an extra lead on every single run - a
// shift with many small runs (manual clicks, repeated Quick Assigns)
// would compound that into a real skew that's easy to miss since nobody
// watches the tally after every run. Persisting which agent got the
// LAST lead of the previous run, and resuming the cycle from the next
// one after them, makes the fairness promise hold across a whole shift
// instead of resetting every time. If that agent isn't in the current
// roster (they've gone offline since), it just falls back to starting
// at 0 for this run - a reasonable one-off, not a lasting skew.
const ROUND_ROBIN_CURSOR_KEY = '_slaRoundRobinCursor';

function loadRoundRobinCursor() {
try {
return localStorage.getItem(ROUND_ROBIN_CURSOR_KEY) || null;
} catch (error) {
return null;
}
}

function saveRoundRobinCursor(agentId) {
try {
localStorage.setItem(ROUND_ROBIN_CURSOR_KEY, agentId);
} catch (error) {
// ignore
}
}

function roundRobinAssign(leads, agents) {
if (leads.length === 0 || agents.length === 0) return [];
const lastAgentId = loadRoundRobinCursor();
let startIndex = 0;
if (lastAgentId) {
const lastIndex = agents.findIndex(a => a.id === lastAgentId);
if (lastIndex !== -1) startIndex = (lastIndex + 1) % agents.length;
}
const plan = [];
for (let i = 0; i < leads.length; i++) {
plan.push({ lead: leads[i], agent: agents[(startIndex + i) % agents.length] });
}
saveRoundRobinCursor(plan[plan.length - 1].agent.id);
return plan;
}

// Re-locates a lead's Assign cell fresh at click time, rather than reusing
// a reference captured earlier - protects against the row/cell being
// re-rendered (e.g. by an Angular digest from a prior assignment) between
// when the plan was built and when this particular lead's turn comes up.
function locateAssignCell(lead) {
const table = document.querySelector('table');
if (!table) return null;
const rows = table.querySelectorAll('tbody tr');
for (const row of rows) {
const cells = row.querySelectorAll('td');
if (cells.length < 9) continue;
const name = cells[COL_CUSTOMER]?.textContent?.trim();
const registration = cells[COL_REGISTRATION]?.textContent?.trim();
const source = cells[COL_SOURCE]?.textContent?.trim();
const campaign = cells[COL_CAMPAIGN]?.textContent?.trim();
const key = `${name}||${registration}||${source}||${campaign}`;
if (key === lead.key) return cells[COL_ASSIGN];
}
return null;
}

// Confirmed live markup: <li ng-repeat="agent in agents"
// ng-click="assignToAgentQueue(lead, agent)"><a><span>{icon} {DisplayText}
// ({CurrentStatusName})</span></a></li> - the visible text is not the
// bare name, so matching on it would never work. ng-repeat guarantees the
// <li> elements render in the same order as scope.agents, so matching the
// target agent's position in that array (re-read fresh, not cached) is a
// direct match against ground truth regardless of text/markup - clicking
// the <li> itself, since that's what actually carries ng-click.
function findAgentMenuItem(cell, agent) {
const dropdown = cell.querySelector('.dropdown');
if (!dropdown || typeof angular === 'undefined') return null;
try {
const scope = angular.element(dropdown).scope();
const agents = (scope && scope.agents) || [];
const index = agents.findIndex(a => String(a.ID) === agent.id);
if (index === -1) return null;
const items = cell.querySelectorAll('.dropdown-menu li');
return items[index] || null;
} catch (error) {
console.warn('Could not resolve agent menu item:', error);
return null;
}
}

// Holding onto any specific node (the cell, or even its row) is fragile
// against Angular's ng-repeat, which is free to replace nodes at any
// level when it re-renders - a <td> swap, a whole <tr> swap, either is
// a mutation on that node's PARENT, so an observer scoped to the node
// itself never sees its own replacement and times out even on success
// (this bit us once already at the cell level - the row-level fix just
// moved the same blind spot up one level). The only reference that
// stays valid across any re-render is the lead's stable content key, so
// this re-locates the cell fresh via locateCellFn on every table
// mutation instead of tracking a node - correct regardless of what
// level Angular decides to replace.
// Clicks are pipelined (fired ~200ms apart) rather than one-at-a-time,
// so an individual confirmation's wait no longer blocks the rest of the
// batch - it resolves in the background regardless of how long it takes.
// That means a longer timeout costs nothing for overall run speed, only
// how long a genuinely slow response gets before being called a failure,
// so it's set generously to absorb real backend tail latency (the actual
// remaining source of "reports failed but it worked" - see the Retry
// Failed button, which exists precisely because a rare slow response can
// still occasionally outrun even this).
function waitForAssignConfirmed(lead, locateCellFn, timeout = 6000) {
return new Promise((resolve) => {
const table = document.querySelector('table');
if (!table) {
resolve(false);
return;
}
const stillPending = () => {
const currentCell = locateCellFn(lead);
if (!currentCell) return false;
return !!currentCell.querySelector('.dropdown');
};
if (!stillPending()) {
resolve(true);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(false);
}, timeout);
const observer = new MutationObserver(() => {
if (!stillPending()) {
clearTimeout(timer);
observer.disconnect();
resolve(true);
}
});
observer.observe(table, { childList: true, subtree: true, characterData: true });
});
}

function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

// Waiting for each lead's confirmation before clicking the next one made
// the whole run strictly sequential - slower than doing it by hand, since
// a person just fires off click after click without watching each row
// finish updating first. This fires each click with a small stagger (just
// enough for Angular's digest cycle to settle before the next row's fresh
// table scan) and lets confirmations resolve in the background,
// concurrently, closer to how someone would actually click through a
// queue. Results settle out of click order depending on how fast each
// row's own confirmation comes back, so onProgress just reports whatever
// has resolved so far rather than a fixed sequence.
const ASSIGN_CLICK_STAGGER_MS = 200;

// Uncapped concurrency meant a big sweep (30-40 leads) could briefly put
// that many simultaneous assign requests on Konnect's backend at once -
// plausibly why the occasional straggler outran even the 6s confirmation
// timeout (contention under load, not a real pairing problem). This caps
// how many leads can be simultaneously "in flight" awaiting confirmation
// at once via a simple semaphore: the loop still fires clicks on its
// normal stagger, but pauses before starting a new one once the cap is
// reached, resuming as soon as an earlier one settles. Small batches
// never hit the cap, so this costs nothing for the common case.
const ASSIGN_MAX_CONCURRENT = 6;

async function runAssignmentPlan(plan, locateCellFn, onProgress) {
const results = new Array(plan.length);
const settled = [];
const pending = [];

let inFlight = 0;
const waiters = [];
const acquireSlot = () => {
if (inFlight < ASSIGN_MAX_CONCURRENT) {
inFlight++;
return Promise.resolve();
}
return new Promise((resolve) => waiters.push(resolve));
};
const releaseSlot = () => {
if (waiters.length > 0) {
waiters.shift()();
} else {
inFlight--;
}
};

const reportProgress = () => onProgress(settled.slice());

for (let i = 0; i < plan.length; i++) {
const { lead, agent } = plan[i];
if (i > 0) await sleep(ASSIGN_CLICK_STAGGER_MS);
await acquireSlot();
try {
const cell = locateCellFn(lead);
if (!cell) {
results[i] = { lead, agent, ok: false, reason: 'Row no longer found on page' };
settled.push(results[i]);
reportProgress();
releaseSlot();
continue;
}
const menuItem = findAgentMenuItem(cell, agent);
if (!menuItem) {
results[i] = { lead, agent, ok: false, reason: 'Agent option not found in menu' };
settled.push(results[i]);
reportProgress();
releaseSlot();
continue;
}
const confirmPromise = waitForAssignConfirmed(lead, locateCellFn);
menuItem.click();
pending.push(confirmPromise.then((ok) => {
results[i] = { lead, agent, ok, reason: ok ? null : 'Timed out waiting for confirmation' };
settled.push(results[i]);
reportProgress();
releaseSlot();
}));
} catch (error) {
results[i] = { lead, agent, ok: false, reason: String(error) };
settled.push(results[i]);
reportProgress();
releaseSlot();
}
}

await Promise.all(pending);
return results;
}

// ===================================================================
// RESULTS SUMMARY + ASSIGNMENT ACTIVITY LOG
//
// The activity log persists to localStorage (capped) so agent-assignment
// counts survive across bookmarklet re-invocations and page reloads -
// its whole purpose is fairness verification ("did agent X actually get
// their fair share today"), so it needs to outlive a single run.
// ===================================================================

const ASSIGN_LOG_KEY = '_slaAssignmentLog';
const ASSIGN_LOG_MAX = 500;

function renderAssignResultsSummary(results) {
const el = document.getElementById('assignResultsSummary');
if (!el) return;
if (!results || results.length === 0) { el.innerHTML = ''; return; }
const succeeded = results.filter(r => r.ok).length;
const failed = results.length - succeeded;
const color = failed === 0 ? '#27ae60' : (succeeded === 0 ? '#e74c3c' : '#f39c12');
const icon = failed === 0 ? '✓' : '⚠';
const text = failed === 0
? `${icon} ${succeeded} assigned`
: `${icon} ${succeeded} assigned, ${failed} failed`;
const retryLink = failed > 0
? ` <span onclick="window._retryFailedAssignments()" style="text-decoration: underline; cursor: pointer;">Retry Failed</span>`
: '';
el.innerHTML = `<div style="margin-top: 8px; padding: 8px 10px; border-radius: 4px; background: ${color}20; color: ${color}; font-size: 12px; font-weight: 700; text-align: center;">${text}${retryLink}</div>`;
}

// Retrying re-runs only the leads that actually failed, keeping each one
// paired with the same agent it was already assigned to (preserving the
// original round-robin distribution) - since most runs succeed ~90% of
// the time and the odd failure is usually a slow backend response outrun
// by even the generous confirmation timeout, not a real problem with the
// lead/agent pairing itself, there's no reason to re-scan/re-filter/
// re-shuffle the whole batch to fix a couple of stragglers.
window._retryFailedAssignments = async function() {
if (!lastFailedAssignmentPlan || lastFailedAssignmentPlan.length === 0) return;
const plan = lastFailedAssignmentPlan;
const locateCellFn = lastFailedLocateCellFn;
lastFailedAssignmentPlan = null;
lastFailedLocateCellFn = null;
await executeAssignmentRun(plan, locateCellFn);
};

function appendAssignmentLog(results) {
try {
const existing = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]');
const now = new Date().toISOString();
const entries = results.filter(r => r.ok).map(r => ({
time: now,
lead: r.lead.name,
agent: r.agent.name
}));
const updated = existing.concat(entries).slice(-ASSIGN_LOG_MAX);
localStorage.setItem(ASSIGN_LOG_KEY, JSON.stringify(updated));
} catch (error) {
console.warn('Failed to persist assignment log', error);
}
}

function renderAssignmentHistoryHtml() {
let entries = [];
try { entries = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]'); } catch (error) { /* ignore */ }
if (entries.length === 0) return '<div style="color:#95a5a6;">No assignments recorded yet.</div>';
const tally = {};
entries.forEach(e => { tally[e.agent] = (tally[e.agent] || 0) + 1; });
const rows = Object.entries(tally).sort((a, b) => b[1] - a[1])
.map(([name, count]) => `<div style="display:flex;justify-content:space-between;"><span>${escapeHtml(name)}</span><span style="font-weight:700;">${count}</span></div>`).join('');
const last = entries[entries.length - 1];
return `<div style="font-size:11px;color:#7f8c8d;margin-bottom:4px;">Assigned counts (all-time, this browser):</div>${rows}
<div style="font-size:10px;color:#bdc3c7;margin-top:6px;">Last: ${escapeHtml(last.lead)} → ${escapeHtml(last.agent)} at ${new Date(last.time).toLocaleTimeString()}</div>`;
}

window._toggleAssignHistory = function() {
const panel = document.getElementById('assignHistoryPanel');
if (!panel) return;
const hidden = panel.style.display === 'none';
if (hidden) panel.innerHTML = renderAssignmentHistoryHtml();
panel.style.display = hidden ? 'block' : 'none';
};

// ===================================================================
// WHEEL PICKERS (shared between both assign sections' time inputs)
//
// Each wheel writes its settled value into the same hidden <input> the
// rest of the code already reads (#assignWindowMinutes / #assignCutoffTime)
// so parseCutoffFromInput(), the assignment handlers, and the refresh
// value-preservation logic all need zero changes - the wheel is purely a
// presentation-layer swap for the plain inputs that used to be there.
// ===================================================================

const WHEEL_ROW_HEIGHT = 32;
const WHEEL_VISIBLE_ROWS = 3;
const SLA_WINDOW_PRESETS = ['All', '5', '10', '15', '20', '30', '45', '60', '90', '120'];
const HOUR_VALUES = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_VALUES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function ensureWheelStyles() {
if (document.getElementById('_slaWheelStyles')) return;
const style = document.createElement('style');
style.id = '_slaWheelStyles';
style.textContent = '.wheel-scroll::-webkit-scrollbar { display: none; } .wheel-scroll:focus { outline: 2px solid #3498db; outline-offset: -1px; }';
document.head.appendChild(style);
}

function renderWheelColumnHtml(id, values, widthPx) {
const spacerHeight = Math.floor(WHEEL_VISIBLE_ROWS / 2) * WHEEL_ROW_HEIGHT;
const items = values.map(v => `<div class="wheel-item" style="height: ${WHEEL_ROW_HEIGHT}px; display: flex; align-items: center; justify-content: center; font-size: 13px; scroll-snap-align: center; color: #95a5a6; cursor: pointer; transition: color 0.15s, font-weight 0.15s;">${escapeHtml(String(v))}</div>`).join('');
return `<div style="position: relative; width: ${widthPx}px;">
<div style="position: absolute; top: ${spacerHeight}px; left: 0; right: 0; height: ${WHEEL_ROW_HEIGHT}px; background: #e8f4f8; border-radius: 4px; pointer-events: none;"></div>
<div id="${id}" class="wheel-scroll" style="position: relative; height: ${WHEEL_VISIBLE_ROWS * WHEEL_ROW_HEIGHT}px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: grab;">
<div style="height: ${spacerHeight}px;"></div>
${items}
<div style="height: ${spacerHeight}px;"></div>
</div>
</div>`;
}

// Click-and-drag needs mousemove/mouseup to keep tracking even once the
// cursor leaves the small wheel area, which means binding to window - but
// initWheelColumn runs on every panel re-render (every refresh, every
// extraction), and a plain window.addEventListener there would stack a
// new pair on top of every previous render's, forever (the exact class of
// bug that broke the auto-detect interval earlier). Installed at most
// once per script execution, and at most once ever across re-invocations
// via the window-level guard; all wheels share it through
// window._slaWheelDragState rather than each wheel owning its own pair.
function ensureWheelDragHandlers() {
if (window._slaWheelDragHandlersInstalled) return;
window._slaWheelDragHandlersInstalled = true;
window._slaWheelDragState = null;

window.addEventListener('mousemove', (event) => {
const drag = window._slaWheelDragState;
if (!drag) return;
const dy = event.clientY - drag.startY;
if (Math.abs(dy) > 4) drag.moved = true;
drag.el.scrollTop = drag.startScrollTop - dy;
});

window.addEventListener('mouseup', () => {
const drag = window._slaWheelDragState;
if (!drag) return;
window._slaWheelDragState = null;
drag.el.style.cursor = 'grab';
if (drag.moved) drag.settleFromDrag();
});
}

// Wires scroll-snap "settle" detection, click-to-select, and click-and-
// drag onto an already-mounted wheel column - can only run after the
// HTML has actually been inserted into the DOM, so callers invoke this
// post-mount, never inline with the HTML string building above.
function initWheelColumn(id, values, initialValue, onSettle) {
const el = document.getElementById(id);
if (!el) return;

ensureWheelDragHandlers();

// Type-to-jump: click a wheel to focus it, then type digits to jump
// straight to that value instead of scrolling/clicking through it.
// Hour/minute (and any other zero-padded fixed-width list) match on the
// padded string once enough digits are typed; SLA_WINDOW_PRESETS mixes
// 'All' with un-padded numbers, so those match numerically instead. The
// buffer resets on a short pause (or immediately once a fixed-width
// value is fully typed) so the next keystroke starts a fresh number
// rather than concatenating onto the last one.
const fixedWidth = values.length > 0 && values.every(v => /^\d+$/.test(String(v)) && String(v).length === String(values[0]).length)
? String(values[0]).length : null;
let typeBuffer = '';
let typeTimer = null;
function resetTypeBuffer() {
typeBuffer = '';
clearTimeout(typeTimer);
typeTimer = null;
}
function findTypedIndex(buffer) {
if (fixedWidth) {
const padded = buffer.padStart(fixedWidth, '0');
const exact = values.findIndex(v => String(v) === padded);
if (exact !== -1) return exact;
return values.findIndex(v => String(v) === buffer);
}
const num = Number(buffer);
if (Number.isNaN(num)) return -1;
const exact = values.findIndex(v => Number(v) === num);
if (exact !== -1) return exact;
return values.findIndex(v => String(v).startsWith(buffer));
}

function highlightAndSettle(index) {
index = Math.max(0, Math.min(values.length - 1, index));
const value = values[index];
el.querySelectorAll('.wheel-item').forEach((item, i) => {
item.style.fontWeight = i === index ? '700' : '400';
item.style.color = i === index ? '#2c3e50' : '#95a5a6';
});
if (onSettle) onSettle(value);
}

function scrollToIndex(index, smooth) {
index = Math.max(0, Math.min(values.length - 1, index));
el.scrollTo({ top: index * WHEEL_ROW_HEIGHT, behavior: smooth ? 'smooth' : 'auto' });
highlightAndSettle(index);
}

function handleSettle() {
highlightAndSettle(Math.round(el.scrollTop / WHEEL_ROW_HEIGHT));
}

el.setAttribute('tabindex', '0');
el.addEventListener('keydown', (event) => {
if (event.key === 'Escape') {
resetTypeBuffer();
return;
}
if (event.key === 'Backspace') {
event.preventDefault();
typeBuffer = typeBuffer.slice(0, -1);
clearTimeout(typeTimer);
typeTimer = null;
if (!typeBuffer) return;
const idx = findTypedIndex(typeBuffer);
if (idx !== -1) scrollToIndex(idx, false);
typeTimer = setTimeout(resetTypeBuffer, 700);
return;
}
if (!/^[0-9]$/.test(event.key)) return;
event.preventDefault();
typeBuffer += event.key;
if (fixedWidth && typeBuffer.length > fixedWidth) typeBuffer = event.key;
const idx = findTypedIndex(typeBuffer);
if (idx !== -1) scrollToIndex(idx, false);
clearTimeout(typeTimer);
typeTimer = setTimeout(resetTypeBuffer, fixedWidth && typeBuffer.length >= fixedWidth ? 300 : 700);
});

if ('onscrollend' in window) {
el.addEventListener('scrollend', handleSettle);
}
let scrollDebounce = null;
el.addEventListener('scroll', () => {
clearTimeout(scrollDebounce);
scrollDebounce = setTimeout(handleSettle, 120);
});

// Click any visible row (not just the centered one) to jump straight to
// it - mouse-wheel notches alone are too coarse to land precisely.
let suppressNextClick = false;
el.querySelectorAll('.wheel-item').forEach((item, index) => {
item.addEventListener('click', () => {
if (suppressNextClick) { suppressNextClick = false; return; }
scrollToIndex(index, true);
});
});

// Click-and-drag for direct, precise control. mousedown is scoped to
// this el (fine to re-attach every render - it's garbage-collected along
// with the old el once a re-render replaces it); mousemove/mouseup are
// the single shared pair from ensureWheelDragHandlers.
el.addEventListener('mousedown', (event) => {
el.style.cursor = 'grabbing';
window._slaWheelDragState = {
el,
startY: event.clientY,
startScrollTop: el.scrollTop,
moved: false,
settleFromDrag: () => {
suppressNextClick = true;
scrollToIndex(Math.round(el.scrollTop / WHEEL_ROW_HEIGHT), true);
}
};
event.preventDefault();
});

const startIndex = Math.max(0, values.indexOf(initialValue));
el.scrollTop = startIndex * WHEEL_ROW_HEIGHT;
highlightAndSettle(startIndex);
}

// Position-only sync, no listener (re)attachment - a wheel's scrollTop
// assignment silently does nothing while an ancestor is display:none
// (nothing laid out to scroll yet), so the position set at render time
// never actually took effect if the Assign Leads section started
// collapsed - this is why the wheel always looked reset to 00:00 despite
// initWheelColumn correctly computing the right starting index. Called
// when the section becomes visible, to catch the wheel up now that
// there's something real to scroll. Deliberately doesn't call
// initWheelColumn again here - that would attach a second set of
// scroll/click/drag listeners on top of the ones already wired at
// render time, the same "listener accumulates on every re-render/
// re-invocation" mistake that broke the auto-detect interval earlier.
function syncWheelPositionOnly(id, values, value) {
const el = document.getElementById(id);
if (!el) return;
const index = Math.max(0, values.indexOf(value));
el.scrollTop = index * WHEEL_ROW_HEIGHT;
el.querySelectorAll('.wheel-item').forEach((item, i) => {
item.style.fontWeight = i === index ? '700' : '400';
item.style.color = i === index ? '#2c3e50' : '#95a5a6';
});
}

function syncAllWheelPositions() {
if (document.getElementById('assignWindowMinutesWheel')) {
const hidden = document.getElementById('assignWindowMinutes');
syncWheelPositionOnly('assignWindowMinutesWheel', SLA_WINDOW_PRESETS, hidden && hidden.value ? hidden.value : 'All');
}
const hourWheel = document.getElementById('assignCutoffHourWheel');
const minuteWheel = document.getElementById('assignCutoffMinuteWheel');
if (hourWheel && minuteWheel) {
const hidden = document.getElementById('assignCutoffTime');
const [currentHour, currentMinute] = (hidden && hidden.value ? hidden.value : formatTimeForInput(defaultHourCutoff())).split(':');
syncWheelPositionOnly('assignCutoffHourWheel', HOUR_VALUES, currentHour);
syncWheelPositionOnly('assignCutoffMinuteWheel', MINUTE_VALUES, currentMinute);
}
}

// Compact mode's panel has a fixed, fairly short total height and the
// panel box itself clips overflow - without a cap here, an expanded
// assign section can push content past that boundary with nothing able
// to scroll it into view (the panel's own scroll only covers the tier/
// lead list below it, not the assign section). Full mode has much more
// room, so it gets a looser cap.
function assignSectionBodyMaxHeight() {
const panelSize = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
return panelSize === 'full' ? '55vh' : '280px';
}

// Reads whichever wheels are actually present in the currently-mounted
// assign section (SLA's single minutes wheel, or Pending Customers' hour
// + minute pair) and wires them up, seeding each from its hidden input's
// current value so a manual refresh's preserved value is respected.
function initAssignSectionWheels() {
if (document.getElementById('assignWindowMinutesWheel')) {
const hidden = document.getElementById('assignWindowMinutes');
const current = hidden && hidden.value ? hidden.value : 'All';
initWheelColumn('assignWindowMinutesWheel', SLA_WINDOW_PRESETS, current, (value) => {
if (hidden) hidden.value = value === 'All' ? '' : value;
if (window._updateAssignPreview) window._updateAssignPreview();
});
}

const hourWheel = document.getElementById('assignCutoffHourWheel');
const minuteWheel = document.getElementById('assignCutoffMinuteWheel');
if (hourWheel && minuteWheel) {
const hidden = document.getElementById('assignCutoffTime');
const [currentHour, currentMinute] = (hidden && hidden.value ? hidden.value : formatTimeForInput(defaultHourCutoff())).split(':');
let selectedHour = currentHour;
let selectedMinute = currentMinute;
const sync = () => {
if (hidden) hidden.value = `${selectedHour}:${selectedMinute}`;
if (window._updateAssignPreview) window._updateAssignPreview();
};

initWheelColumn('assignCutoffHourWheel', HOUR_VALUES, currentHour, (value) => { selectedHour = value; sync(); });
initWheelColumn('assignCutoffMinuteWheel', MINUTE_VALUES, currentMinute, (value) => { selectedMinute = value; sync(); });
}

if (window._updateAssignPreview) window._updateAssignPreview();
}

// Always-visible, no interaction needed - answers "how many are due
// before X" and "how many are already assigned" at a glance, without
// expanding the (collapsed-by-default) Assign Leads section or running
// anything. Buckets are cumulative (30m includes the 15m count), and an
// already-overdue/Missed lead counts toward every bucket since it's due
// before all of them. Unassigned-only for the due buckets - this is a
// "what's left to do" readout, not a total-in-queue count.
const SLA_DUE_BUCKET_MINUTES = [15, 30, 60];

// Best-effort keyword heuristic, not an exhaustive status enumeration -
// only "Live Chat" and "Shift Start" are confirmed real values so far.
// Falls back to neutral gray for anything unrecognized rather than
// guessing wrong in either direction.
function statusDotColor(status) {
const s = (status || '').toLowerCase();
if (!s) return '#bdc3c7';
if (s.includes('chat') || s.includes('call') || s.includes('busy') || s.includes('break') || s.includes('away') || s.includes('wrap')) return '#f39c12';
if (s.includes('start') || s.includes('available') || s.includes('idle') || s.includes('ready')) return '#27ae60';
return '#95a5a6';
}

function renderAgentCheckboxes(agents, excludedAgentIds) {
if (agents.length === 0) {
return `<div style="font-size: 12px; color: #95a5a6;">No agents online</div>`;
}
return agents.map(a => `
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #2c3e50;" ${a.status ? `title="${escapeHtml(a.status)}"` : ''}>
<input type="checkbox" class="assign-agent-checkbox" value="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name)}" ${excludedAgentIds.has(a.id) ? '' : 'checked'} onchange="window._updateAssignPreview()">
<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusDotColor(a.status)}; flex-shrink: 0;"></span>
${escapeHtml(a.name)}
</label>`).join('');
}

function renderStatTile(label, value, urgent) {
return `<div style="flex: 1; text-align: center; background: white; border-radius: 6px; padding: 6px 2px; border: 1px solid ${urgent ? '#e74c3c' : '#ecf0f1'};">
<div style="font-size: 16px; font-weight: 700; color: ${urgent ? '#e74c3c' : '#2c3e50'};">${value}</div>
<div style="font-size: 9px; color: #95a5a6; text-transform: uppercase; letter-spacing: 0.3px;">${label}</div>
</div>`;
}

function renderSlaDueSummary() {
const leads = getCachedAssignableLeads();
const now = Date.now();
const minutesUntilDue = (lead) => lead.slaDate ? (lead.slaDate.getTime() - now) / 60000 : null;

const missedCount = leads.filter(l => !l.assigned && l.status === 'Missed').length;
const dueCounts = SLA_DUE_BUCKET_MINUTES.map(mins =>
leads.filter(l => !l.assigned && minutesUntilDue(l) !== null && minutesUntilDue(l) <= mins).length
);
const customerFirstDueCounts = SLA_DUE_BUCKET_MINUTES.map(mins =>
leads.filter(l => !l.assigned && l.isCustomerFirst && minutesUntilDue(l) !== null && minutesUntilDue(l) <= mins).length
);
const assignedCount = leads.filter(l => l.assigned).length;
const notAssignedCount = leads.filter(l => !l.assigned).length;

const tiles = [
renderStatTile('Missed', missedCount, missedCount > 0),
...SLA_DUE_BUCKET_MINUTES.map((m, i) => renderStatTile(`${m}m`, dueCounts[i], m === 15 && dueCounts[i] > 0))
].join('');
const cfLine = SLA_DUE_BUCKET_MINUTES.map((m, i) => `${m}m: <strong>${customerFirstDueCounts[i]}</strong>`).join(' &nbsp; ');

return `
<div id="slaDueSummary" style="padding: 10px 20px; background: #f8f9fa; border-bottom: 1px solid #ecf0f1; font-size: 12px; color: #2c3e50;">
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${tiles}</div>
<div style="font-size: 11px; color: #7f8c8d; margin-bottom: 6px;">Customer First — ${cfLine}</div>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span style="font-size: 11px; color: #95a5a6;">Assigned ${assignedCount} &middot; Not assigned ${notAssignedCount} &middot; ${lastScannedLabel()}</span>
<button onclick="window._quickAssign()" style="background: #27ae60; color: white; border: none; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0;">⚡ Quick Assign</button>
</div>
</div>`;
}

// Filter/agent selections persist across every scan (not just within a
// single manual "Refresh" cycle, unlike the existing outerHTML-replace
// preservation below) so a consistent shift-long routine only has to be
// set once. Agent/tier/callback-type exclusions are stored as opt-OUT
// sets (which ones are unchecked) rather than opt-in - a new agent
// coming online, or a tier/type nobody has ever excluded, defaults to
// included without needing to already be known about.
function loadAssignSettings() {
try {
return JSON.parse(localStorage.getItem(ASSIGN_SETTINGS_KEY)) || {};
} catch (error) {
return {};
}
}

function saveAssignSettings(partial) {
localStorage.setItem(ASSIGN_SETTINGS_KEY, JSON.stringify({ ...loadAssignSettings(), ...partial }));
}

// Reads the currently-mounted assign section's DOM and saves whatever
// it finds - called from onchange handlers and wheel settle callbacks,
// so it only needs to know how to read the page, not track state itself.
function persistCurrentAssignSettings() {
const excludedTiers = Array.from(document.querySelectorAll('.assign-tier-checkbox:not(:checked)')).map(el => Number(el.value));
const excludedAgentIds = Array.from(document.querySelectorAll('.assign-agent-checkbox:not(:checked)')).map(el => el.value);
const customerFirstOnly = document.getElementById('assignCustomerFirstOnly')?.checked || false;
const emailOnly = document.getElementById('assignEmailOnly')?.checked || false;
const windowMinutes = document.getElementById('assignWindowMinutes')?.value ?? null;
const cutoffTime = document.getElementById('assignCutoffTime')?.value ?? null;
const advancedOpen = document.getElementById('advancedCallbackTypes')?.style.display === 'flex';

// Primary callback types default ON (opt-out, mirrors tiers); Advanced
// ones default OFF (opt-in) - so unlike everything else here, "excluded"
// and "included" aren't just each other's inverse and need separate sets.
const allCallbackCheckboxes = Array.from(document.querySelectorAll('.assign-callback-checkbox'));
const excludedCallbackTypes = allCallbackCheckboxes
.filter(el => !el.checked && !el.closest('#advancedCallbackTypes'))
.map(el => el.value);
const includedAdvancedCallbackTypes = allCallbackCheckboxes
.filter(el => el.checked && el.closest('#advancedCallbackTypes'))
.map(el => el.value);

saveAssignSettings({
excludedTiers, excludedCallbackTypes, includedAdvancedCallbackTypes, excludedAgentIds,
customerFirstOnly, emailOnly, windowMinutes, cutoffTime, advancedOpen
});
}

function renderAssignSection() {
const leads = getCachedAssignableLeads();
const agents = getAgentRoster();
const tierCounts = [1, 2, 3, 4].map(t => leads.filter(l => l.tier === t && !l.assigned).length);
const customerFirstCount = leads.filter(l => l.isCustomerFirst && !l.assigned).length;
const emailOnlyCount = leads.filter(l => l.isEmailOnly && !l.assigned).length;

const settings = loadAssignSettings();
const excludedTiers = new Set(settings.excludedTiers || []);
const excludedAgentIds = new Set(settings.excludedAgentIds || []);

const tierCheckboxes = [1, 2, 3, 4].map(t => `
<label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #2c3e50;">
<input type="checkbox" class="assign-tier-checkbox" value="${t}" ${excludedTiers.has(t) ? '' : 'checked'} onchange="window._updateAssignPreview()"> Tier ${t} <span style="color:#95a5a6;">(${tierCounts[t - 1]})</span>
</label>`).join('');

const agentCheckboxes = renderAgentCheckboxes(agents, excludedAgentIds);

const buttonDisabled = agents.length === 0;

return `
<div id="assignSectionContainer" style="padding: 16px 20px; background: white; border-bottom: 1px solid #ecf0f1;">
<div onclick="window._toggleAssignSection()" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
<span style="font-weight: 700; color: #2c3e50; font-size: 14px;">⚡ Assign Leads</span>
<span id="assignSectionToggle" style="font-size: 14px; color: #2c3e50;">${settings.sectionOpen ? '▼' : '▶'}</span>
</div>
<div id="assignSectionBody" style="margin-top: 12px; display: ${settings.sectionOpen ? 'block' : 'none'}; max-height: ${assignSectionBodyMaxHeight()}; overflow-y: auto; padding-right: 6px;">
<div style="font-size: 11px; color: #7f8c8d; background: #f8f9fa; border-radius: 4px; padding: 8px 10px; margin-bottom: 12px; line-height: 1.5;">
Leads go out in order of <strong>when they're due</strong>, not by tier — filters below only narrow which leads are included.
</div>
<div style="margin-bottom: 10px;">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
<span style="font-size: 11px; font-weight: 700; color: #7f8c8d;">AGENTS ONLINE</span>
<span style="display: flex; gap: 8px;">
<span onclick="window._setAllAgentCheckboxes(true)" style="font-size: 11px; color: #3498db; cursor: pointer;">All</span>
<span onclick="window._setAllAgentCheckboxes(false)" style="font-size: 11px; color: #3498db; cursor: pointer;">None</span>
<span onclick="window._refreshAssignSection()" style="font-size: 11px; color: #3498db; cursor: pointer;">↻ Refresh</span>
<span onclick="window._toggleAssignHistory()" style="font-size: 11px; color: #3498db; cursor: pointer;">📊 History</span>
</span>
</div>
<div id="assignAgentList" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">${agentCheckboxes}</div>
<div id="assignHistoryPanel" style="display: none; margin-top: 6px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-size: 11px; color: #2c3e50;"></div>
</div>
<div id="assignMatchPreview" style="font-size: 11px; color: #7f8c8d; margin-bottom: 8px;"></div>
<button id="assignRunButton" onclick="window._runSlaAssignment()" ${buttonDisabled ? 'disabled' : ''}
style="width: 100%; padding: 10px; background: ${buttonDisabled ? '#bdc3c7' : '#27ae60'}; color: white; border: none; border-radius: 6px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; font-size: 13px; font-weight: 600;">
${buttonDisabled ? 'No agents online' : 'Assign Unassigned Leads'}
</button>
<div id="assignResultsSummary"></div>
<div id="assignResultsLog" style="margin-top: 6px; font-size: 11px; color: #7f8c8d; max-height: 100px; overflow-y: auto;"></div>
<div style="margin: 16px 0 10px; border-top: 1px solid #ecf0f1; padding-top: 12px;">
<div style="font-size: 11px; font-weight: 700; color: #7f8c8d; margin-bottom: 6px;">TIERS</div>
<div style="display: flex; gap: 10px; flex-wrap: wrap;">${tierCheckboxes}</div>
</div>
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #7f8c8d; margin-bottom: 6px;">SPECIAL FILTERS</div>
<div style="display: flex; flex-direction: column; gap: 6px;">
<label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #2c3e50;">
<input type="checkbox" id="assignCustomerFirstOnly" ${settings.customerFirstOnly ? 'checked' : ''} onchange="window._updateAssignPreview()"> Customer First only <span style="color:#95a5a6;">(${customerFirstCount})</span>
</label>
<label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #2c3e50;">
<input type="checkbox" id="assignEmailOnly" ${settings.emailOnly ? 'checked' : ''} onchange="window._updateAssignPreview()"> Email only (no phone) <span style="color:#95a5a6;">(${emailOnlyCount})</span>
</label>
</div>
<div style="font-size: 10px; color: #95a5a6; margin-top: 4px;">Based on the last scan — click the badge first if these counts look stale.</div>
</div>
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #7f8c8d; margin-bottom: 6px;">DUE WITHIN (MINUTES)</div>
<input id="assignWindowMinutes" type="hidden" value="${settings.windowMinutes || ''}">
${renderWheelColumnHtml('assignWindowMinutesWheel', SLA_WINDOW_PRESETS, 90)}
</div>
</div>
</div>`;
}

// ===================================================================
// PENDING CUSTOMERS TAB
// ===================================================================

const CALLBACK_TYPES_PRIMARY = ['New', 'Auto Rescheduled'];
const CALLBACK_TYPES_ADVANCED = ['Manual Rescheduled', 'Post Closure'];
const CALLBACK_TYPE_ORDER = [...CALLBACK_TYPES_PRIMARY, ...CALLBACK_TYPES_ADVANCED];
const CALLBACK_TYPE_COLORS = {
'New': '#e74c3c',
'Auto Rescheduled': '#3498db',
'Manual Rescheduled': '#f39c12',
'Post Closure': '#95a5a6'
};

function collectPendingCustomers() {
const table = document.querySelector('table');
if (!table) return [];

const leads = [];
table.querySelectorAll('tbody tr').forEach((row) => {
const cells = row.querySelectorAll('td');
if (cells.length < 12) return;

const name = cells[PC_COL_CUSTOMER]?.textContent?.trim();
if (!name) return;

const dealer = cells[PC_COL_DEALER]?.textContent?.trim();
const brand = cells[PC_COL_BRAND]?.textContent?.trim();
const reg = cells[PC_COL_REG]?.textContent?.trim();
const email = cells[PC_COL_EMAIL]?.textContent?.trim();
const mobile = cells[PC_COL_MOBILE]?.textContent?.trim();
const landline = cells[PC_COL_LANDLINE]?.textContent?.trim();
const campaign = cells[PC_COL_CAMPAIGN]?.textContent?.trim();
const callbackType = cells[PC_COL_CALLBACK_TYPE]?.textContent?.trim();
const nextActionText = cells[PC_COL_NEXT_ACTION]?.textContent?.trim() || '';
const lastActionDate = parseKonnectDate(cells[PC_COL_LAST_ACTION]?.textContent?.trim() || '');
const nextActionDate = parseKonnectDate(nextActionText);
const assignState = getAssignCellState(cells[PC_COL_ASSIGN]);

leads.push({
key: `${name}||${reg}||${campaign}||${callbackType}||${nextActionText}`,
name, dealer, brand, reg, email, mobile, landline, campaign,
callbackType, lastActionDate, nextActionDate,
assigned: assignState.assigned,
agentName: assignState.agentName
});
});

return leads;
}

function prioritizePendingLeads(leads) {
return [...leads].sort((a, b) =>
(a.nextActionDate ? a.nextActionDate.getTime() : Infinity) - (b.nextActionDate ? b.nextActionDate.getTime() : Infinity)
);
}

// A lead with no parseable Next Action Date is excluded rather than
// guessed at - if the date format assumption turns out to be wrong,
// this fails loudly (nothing matches) instead of assigning on unknown
// urgency.
function filterPendingLeads(leads, { callbackTypes, cutoffDate }) {
return leads.filter((lead) => {
if (lead.assigned) return false;
if (!callbackTypes.has(lead.callbackType)) return false;
if (!lead.nextActionDate) return false;
if (cutoffDate && lead.nextActionDate.getTime() >= cutoffDate.getTime()) return false;
return true;
});
}

// "Due within the hour" means up to the top of the next clock hour (e.g.
// at 12:47 that's 13:00), not a rolling 60-minute lookahead.
function defaultHourCutoff() {
const now = new Date();
return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
}

function formatTimeForInput(date) {
const hh = String(date.getHours()).padStart(2, '0');
const mm = String(date.getMinutes()).padStart(2, '0');
return `${hh}:${mm}`;
}

function parseCutoffFromInput(value) {
if (!value) return defaultHourCutoff();
const [hh, mm] = value.split(':').map(Number);
const now = new Date();
return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
}

// Re-locates a lead's Assign cell fresh at click time - same reasoning as
// locateAssignCell on the SLA tab.
function locatePendingAssignCell(lead) {
const table = document.querySelector('table');
if (!table) return null;
const rows = table.querySelectorAll('tbody tr');
for (const row of rows) {
const cells = row.querySelectorAll('td');
if (cells.length < 12) continue;
const name = cells[PC_COL_CUSTOMER]?.textContent?.trim();
const reg = cells[PC_COL_REG]?.textContent?.trim();
const campaign = cells[PC_COL_CAMPAIGN]?.textContent?.trim();
const callbackType = cells[PC_COL_CALLBACK_TYPE]?.textContent?.trim();
const nextActionText = cells[PC_COL_NEXT_ACTION]?.textContent?.trim() || '';
const key = `${name}||${reg}||${campaign}||${callbackType}||${nextActionText}`;
if (key === lead.key) return cells[PC_COL_ASSIGN];
}
return null;
}

function slugify(value) {
return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Same "always visible, unassigned-only" readout as the SLA tab's due
// summary, but bucketed to match this page's actual hour-cutoff workflow
// instead of minutes. "This hour" reuses defaultHourCutoff() (the same
// boundary the wheel defaults to); "Next hour" is cumulative - due before
// the hour after that.
function renderPendingDueSummary() {
const leads = getCachedPendingCustomers();
const thisHourCutoff = defaultHourCutoff();
const nextHourCutoff = new Date(thisHourCutoff.getTime() + 60 * 60000);

const dueThisHour = leads.filter(l => !l.assigned && l.nextActionDate && l.nextActionDate.getTime() < thisHourCutoff.getTime()).length;
const dueNextHour = leads.filter(l => !l.assigned && l.nextActionDate && l.nextActionDate.getTime() < nextHourCutoff.getTime()).length;

const callbackLine = CALLBACK_TYPES_PRIMARY.map(type =>
`${escapeHtml(type)}: <strong>${leads.filter(l => !l.assigned && l.callbackType === type).length}</strong>`
).join(' &nbsp; ');

const assignedCount = leads.filter(l => l.assigned).length;
const notAssignedCount = leads.filter(l => !l.assigned).length;

const tiles = [
renderStatTile('This hour', dueThisHour, dueThisHour > 0),
renderStatTile('Next hour', dueNextHour, false)
].join('');

return `
<div id="pendingDueSummary" style="padding: 10px 20px; background: #f8f9fa; border-bottom: 1px solid #ecf0f1; font-size: 12px; color: #2c3e50;">
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${tiles}</div>
<div style="font-size: 11px; color: #7f8c8d; margin-bottom: 6px;">${callbackLine}</div>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span style="font-size: 11px; color: #95a5a6;">Assigned ${assignedCount} &middot; Not assigned ${notAssignedCount} &middot; ${lastScannedLabel()}</span>
<button onclick="window._quickAssign()" style="background: #27ae60; color: white; border: none; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0;">⚡ Quick Assign</button>
</div>
</div>`;
}

function renderPendingAssignSection() {
const leads = getCachedPendingCustomers();
const agents = getAgentRoster();
const countFor = (type) => leads.filter(l => l.callbackType === type && !l.assigned).length;

const settings = loadAssignSettings();
const excludedCallbackTypes = new Set(settings.excludedCallbackTypes || []);
const includedAdvancedCallbackTypes = new Set(settings.includedAdvancedCallbackTypes || []);
const excludedAgentIds = new Set(settings.excludedAgentIds || []);

const primaryCheckboxes = CALLBACK_TYPES_PRIMARY.map(type => `
<label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #2c3e50;">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${excludedCallbackTypes.has(type) ? '' : 'checked'} onchange="window._updateAssignPreview()"> ${escapeHtml(type)} <span style="color:#95a5a6;">(${countFor(type)})</span>
</label>`).join('');

const advancedCheckboxes = CALLBACK_TYPES_ADVANCED.map(type => `
<label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #2c3e50;">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${includedAdvancedCallbackTypes.has(type) ? 'checked' : ''} onchange="window._updateAssignPreview()"> ${escapeHtml(type)} <span style="color:#95a5a6;">(${countFor(type)})</span>
</label>`).join('');

const agentCheckboxes = renderAgentCheckboxes(agents, excludedAgentIds);

const buttonDisabled = agents.length === 0;
const defaultCutoff = settings.cutoffTime || formatTimeForInput(defaultHourCutoff());
const advancedOpenStyle = settings.advancedOpen ? 'display: flex;' : 'display: none;';
const advancedToggleArrow = settings.advancedOpen ? '▼' : '▶';

return `
<div id="assignSectionContainer" style="padding: 16px 20px; background: white; border-bottom: 1px solid #ecf0f1;">
<div onclick="window._toggleAssignSection()" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
<span style="font-weight: 700; color: #2c3e50; font-size: 14px;">⚡ Assign Leads</span>
<span id="assignSectionToggle" style="font-size: 14px; color: #2c3e50;">${settings.sectionOpen ? '▼' : '▶'}</span>
</div>
<div id="assignSectionBody" style="margin-top: 12px; display: ${settings.sectionOpen ? 'block' : 'none'}; max-height: ${assignSectionBodyMaxHeight()}; overflow-y: auto; padding-right: 6px;">
<div style="margin-bottom: 10px;">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
<span style="font-size: 11px; font-weight: 700; color: #7f8c8d;">AGENTS ONLINE</span>
<span style="display: flex; gap: 8px;">
<span onclick="window._setAllAgentCheckboxes(true)" style="font-size: 11px; color: #3498db; cursor: pointer;">All</span>
<span onclick="window._setAllAgentCheckboxes(false)" style="font-size: 11px; color: #3498db; cursor: pointer;">None</span>
<span onclick="window._refreshAssignSection()" style="font-size: 11px; color: #3498db; cursor: pointer;">↻ Refresh</span>
<span onclick="window._toggleAssignHistory()" style="font-size: 11px; color: #3498db; cursor: pointer;">📊 History</span>
</span>
</div>
<div id="assignAgentList" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">${agentCheckboxes}</div>
<div id="assignHistoryPanel" style="display: none; margin-top: 6px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-size: 11px; color: #2c3e50;"></div>
</div>
<div id="assignMatchPreview" style="font-size: 11px; color: #7f8c8d; margin-bottom: 8px;"></div>
<button id="assignRunButton" onclick="window._runPendingAssignment()" ${buttonDisabled ? 'disabled' : ''}
style="width: 100%; padding: 10px; background: ${buttonDisabled ? '#bdc3c7' : '#27ae60'}; color: white; border: none; border-radius: 6px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; font-size: 13px; font-weight: 600;">
${buttonDisabled ? 'No agents online' : 'Assign Unassigned Leads'}
</button>
<div id="assignResultsSummary"></div>
<div id="assignResultsLog" style="margin-top: 6px; font-size: 11px; color: #7f8c8d; max-height: 100px; overflow-y: auto;"></div>
<div style="margin: 16px 0 10px; border-top: 1px solid #ecf0f1; padding-top: 12px;">
<div style="font-size: 11px; font-weight: 700; color: #7f8c8d; margin-bottom: 6px;">CALLBACK TYPE</div>
<div style="display: flex; gap: 10px; flex-wrap: wrap;">${primaryCheckboxes}</div>
<div onclick="window._toggleAdvancedCallbackTypes()" style="margin-top: 6px; font-size: 11px; color: #3498db; cursor: pointer;">
<span id="advancedCallbackToggle">${advancedToggleArrow}</span> Advanced (Manual Rescheduled, Post Closure)
</div>
<div id="advancedCallbackTypes" style="${advancedOpenStyle} gap: 10px; flex-wrap: wrap; margin-top: 6px;">${advancedCheckboxes}</div>
</div>
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #7f8c8d; margin-bottom: 6px;">DUE BEFORE <span style="font-weight: 400; color: #95a5a6;">(defaults to the top of the next hour)</span></div>
<input id="assignCutoffTime" type="hidden" value="${defaultCutoff}">
<div style="display: flex; align-items: center; gap: 6px;">
${renderWheelColumnHtml('assignCutoffHourWheel', HOUR_VALUES, 56)}
<span style="font-weight: 700; color: #2c3e50;">:</span>
${renderWheelColumnHtml('assignCutoffMinuteWheel', MINUTE_VALUES, 56)}
</div>
</div>
</div>
</div>`;
}

function renderCallbackTypeSection(typeName, customers, color) {
const sectionId = 'cb-' + slugify(typeName);

if (customers.length === 0) {
return `<div style="margin-bottom: 20px; padding: 16px; background: white; border-radius: 8px;
border-left: 4px solid ${color}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
<h3 style="margin: 0; color: ${color}; font-size: 14px; font-weight: 600;">${escapeHtml(typeName)}</h3>
<p style="margin: 8px 0 0 0; color: #95a5a6; font-size: 13px;">No customers</p>
</div>`;
}

return `<div style="margin-bottom: 20px;">
<div onclick="window._toggleCallbackType('${sectionId}')" style="cursor: pointer; padding: 14px; background: white; border-radius: 8px 8px 0 0;
display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${color};
border-bottom: 2px solid #ecf0f1;">
<div>
<span style="font-weight: 700; color: #2c3e50; font-size: 14px;">${escapeHtml(typeName)}</span>
<span style="font-size: 12px; color: #95a5a6; margin-left: 10px;">${customers.length}</span>
</div>
<span id="toggle-${sectionId}" style="font-size: 14px; color: ${color};">▼</span>
</div>
<div id="${sectionId}" style="display: grid; gap: 12px; padding: 12px; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
${customers.map(c => `<div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; background: #fafbfc;">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: #ecf0f1; color: #2c3e50; font-weight: 700; font-size: 14px;">${escapeHtml(c.name)}</span>
${renderAssignmentBadge(c.assigned, c.agentName)}
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">MOBILE</div>
${renderCopyableField(c.mobile)}
</div>
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">LANDLINE</div>
${renderCopyableField(c.landline)}
</div>
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">NEXT ACTION</div>
<span style="font-size: 13px; color: #2c3e50;">${c.nextActionDate ? escapeHtml(c.nextActionDate.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'Unknown'}</span>
</div>
</div>
<div style="padding-top: 10px; border-top: 1px solid #ecf0f1; display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px;">
<span style="background: #ecf0f1; color: #2c3e50; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.brand || '')}</span>
<span style="background: #e8f5e9; color: #27ae60; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.campaign || '')}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

function resetBookmarklet() {
currentCustomers = [];
currentPendingCustomers = [];
currentPageType = null;
extracting = false;

if (panelElement) {
panelElement.remove();
panelElement = null;
}

if (badge) {
// Badge now lives inside a wrapping <li> in the host navbar (see
// createBadge) - remove that wrapper too, or the fallback fixed-position
// case's plain badge.remove(), so nothing gets left behind either way.
const navItem = document.getElementById('_slaBadgeNavItem');
if (navItem) navItem.remove();
else badge.remove();
badge = null;
}

console.info('🔄 SLA Manager stopped - click bookmarklet again to run');
}

// Shared panel chrome (positioning, header, footer) for both pages - only
// the title/counts, the assign section, and the body content differ.
function renderPanelShell({ title, count, newCount, removedCount, summaryHtml, assignSectionHtml, bodyHtml }) {
const panelSize = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
const isFull = panelSize === 'full';
const positionStyle = isFull
? 'top: 0; right: 0; bottom: 0; height: 100vh; width: 450px; border-radius: 0;'
: 'bottom: 20px; right: 20px; width: 400px; height: min(560px, calc(100vh - 90px)); border-radius: 16px;';

return `
<div id="${PANEL_BOX_ID}" style="position: fixed; ${positionStyle}
background: #f8f9fa; box-shadow: 0 8px 30px rgba(0,0,0,0.25);
z-index: 100000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
display: flex; flex-direction: column; transition: transform 0.3s ease;">

<div style="position: sticky; top: 0; background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 20px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #27ae60;
flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
<div style="display: flex; align-items: center; gap: 12px;">
<h2 style="margin: 0; font-size: 18px; font-weight: 700;">${title}</h2>
<span style="background: #27ae60; color: white; padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 600;">${count}</span>
${newCount > 0 ? `<span style="background: #f39c12; color: white; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 600;">+${newCount}</span>` : ''}
${removedCount > 0 ? `<span style="background: #7f8c8d; color: white; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 600;">−${removedCount}</span>` : ''}
</div>
<div style="display: flex; gap: 8px;">
<button onclick="window._togglePanelSize();"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;"
title="${isFull ? 'Shrink to box' : 'Expand to full height'}">${isFull ? '⤡' : '⤢'}</button>
<button onclick="document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0;"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;"
title="Top">↑</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_BOX_ID}'); if (!panel) return; const btn = event.target; const isHidden = panel.style.transform === 'translateX(150%)'; panel.style.transform = isHidden ? '' : 'translateX(150%)'; btn.textContent = isHidden ? '−' : '□'; localStorage.setItem('${PANEL_STATE_KEY}', isHidden ? 'visible' : 'hidden'); })();"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;"
title="Minimize">−</button>
</div>
</div>

${summaryHtml || ''}
${assignSectionHtml}

<div class="panelContent" style="flex: 1; overflow-y: auto; padding: 20px; padding-right: 12px;">
${bodyHtml}
</div>

<div style="border-top: 1px solid #ddd; padding: 14px; background: white; flex-shrink: 0; display: flex; gap: 10px; box-shadow: 0 -2px 8px rgba(0,0,0,0.05);">
<button onclick="(function() { if (confirm('Clear all data and stop?')) { window._slaResetBookmarklet(); } })();"
style="flex: 1; padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Clear & Stop</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_ID}'); if (!panel) return; const content = panel.querySelector('.panelContent'); content.scrollTop = 0; })();"
style="flex: 1; padding: 10px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Top</button>
</div>
</div>
`;
}

function mountPanel(panelHTML) {
if (panelElement) panelElement.remove();
panelElement = document.createElement('div');
panelElement.id = PANEL_ID;
panelElement.innerHTML = panelHTML;
document.documentElement.appendChild(panelElement);

const contentArea = panelElement.querySelector('.panelContent');
if (contentArea) {
contentArea.addEventListener('scroll', () => {
localStorage.setItem('_slaPanelScroll', contentArea.scrollTop);
});
}

panelElement.querySelectorAll('.sla-copyable').forEach(el => {
el.addEventListener('click', function() {
copyToClipboard(this.dataset.value, this);
});
});

initAssignSectionWheels();
}

function displayPanel(customers, newCount = 0, removedCount = 0) {
currentCustomers = customers;
currentPageType = PAGE_SLA;
invalidateLeadsCache();
const tiered = {
tier1: customers.filter(c => c.tier === 1),
tier2: customers.filter(c => c.tier === 2),
tier3: customers.filter(c => c.tier === 3),
tier4: customers.filter(c => c.tier === 4)
};

const bodyHtml = customers.length === 0 ? `
<div style="padding: 40px 20px; text-align: center;">
<div style="font-size: 56px; margin-bottom: 16px;">📭</div>
<h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">No Leads in Queue</h3>
<p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.6;">The SLA queue is empty. Check back when new leads arrive.</p>
</div>
` : `
${renderTierSection('Tier 1 - Priority', tiered.tier1, '#e74c3c', 'tier1')}
${renderTierSection('Tier 2 - High', tiered.tier2, '#f39c12', 'tier2')}
${renderTierSection('Tier 3 - Medium', tiered.tier3, '#3498db', 'tier3')}
${renderTierSection('Tier 4 - Standard', tiered.tier4, '#95a5a6', 'tier4')}
`;

mountPanel(renderPanelShell({
title: 'SLA Report',
count: customers.length,
newCount, removedCount,
summaryHtml: renderSlaDueSummary(),
assignSectionHtml: renderAssignSection(),
bodyHtml
}));
}

function displayPendingPanel(customers, newCount = 0, removedCount = 0) {
currentPendingCustomers = customers;
currentPageType = PAGE_PENDING;
invalidateLeadsCache();

const grouped = CALLBACK_TYPE_ORDER.map(type => ({
type,
color: CALLBACK_TYPE_COLORS[type],
customers: customers.filter(c => c.callbackType === type)
}));

const bodyHtml = customers.length === 0 ? `
<div style="padding: 40px 20px; text-align: center;">
<div style="font-size: 56px; margin-bottom: 16px;">📭</div>
<h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">No Pending Customers</h3>
<p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.6;">Nothing in the queue right now.</p>
</div>
` : grouped.map(g => renderCallbackTypeSection(g.type, g.customers, g.color)).join('');

mountPanel(renderPanelShell({
title: 'Pending Customers',
count: customers.length,
newCount, removedCount,
summaryHtml: renderPendingDueSummary(),
assignSectionHtml: renderPendingAssignSection(),
bodyHtml
}));
}

function renderTierSection(tierName, customers, color, tierId) {
if (customers.length === 0) {
return `<div style="margin-bottom: 20px; padding: 16px; background: white; border-radius: 8px;
border-left: 4px solid ${color}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
<h3 style="margin: 0; color: ${color}; font-size: 14px; font-weight: 600;">${tierName}</h3>
<p style="margin: 8px 0 0 0; color: #95a5a6; font-size: 13px;">No customers</p>
</div>`;
}

return `<div style="margin-bottom: 20px;">
<div onclick="window._toggleTier('${tierId}')" style="cursor: pointer; padding: 14px; background: white; border-radius: 8px 8px 0 0;
display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${color};
border-bottom: 2px solid #ecf0f1;">
<div>
<span style="font-weight: 700; color: #2c3e50; font-size: 14px;">${tierName}</span>
<span style="font-size: 12px; color: #95a5a6; margin-left: 10px;">${customers.length}</span>
</div>
<span id="toggle-${tierId}" style="font-size: 14px; color: ${color};">▼</span>
</div>
<div id="${tierId}" style="display: grid; gap: 12px; padding: 12px; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
${customers.map(c => `<div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; background: #fafbfc;">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: #ecf0f1; color: #2c3e50; font-weight: 700; font-size: 14px;">${escapeHtml(c.name)}</span>
${renderAssignmentBadge(c.assigned, c.agentName)}
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">PHONE</div>
${renderCopyableField(c.phone)}
</div>
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
</div>
<div style="padding-top: 10px; border-top: 1px solid #ecf0f1; display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px;">
<span style="background: #ecf0f1; color: #2c3e50; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.source)}</span>
<span style="background: #e8f5e9; color: #27ae60; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.campaign)}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

async function extractAndExportSla() {
if (extracting || assigning) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('SLA Table not found');
return;
}

const previousByKey = new Map(currentCustomers.map(c => [c.key, c]));
const seenKeys = new Set();
const customers = [];
let addedCount = 0;
const rows = table.querySelectorAll('tbody tr');

const rowDescriptors = [];
for (const row of rows) {
const cells = row.querySelectorAll('td');
const name = cells[0]?.textContent?.trim();
const registration = cells[1]?.textContent?.trim();
const source = cells[2]?.textContent?.trim();
const campaign = cells[3]?.textContent?.trim();

if (!name || !campaign) continue;

// Registration is folded into the key (not displayed) so same-name
// leads from the same source/campaign don't collide with each other.
const key = `${name}||${registration}||${source}||${campaign}`;
seenKeys.add(key);
// Assign state is read fresh every scan, even for cached leads below -
// unlike phone/email, it changes constantly and must never be stale.
const assignState = getAssignCellState(cells[COL_ASSIGN]);
rowDescriptors.push({ cells, name, source, campaign, key, assigned: assignState.assigned, agentName: assignState.agentName });
}

const pendingCount = rowDescriptors.filter(d => !previousByKey.has(d.key)).length;
let remaining = pendingCount;
setBadgeProgress(remaining);

for (const d of rowDescriptors) {
const existing = previousByKey.get(d.key);
if (existing) {
// Keep cached phone/email, but never the cached assigned/agentName -
// that's re-read fresh above on every scan regardless of cache hit.
customers.push({ ...existing, assigned: d.assigned, agentName: d.agentName });
continue;
}

try {
const tierInfo = categorizeTier(d.campaign, d.source);
const details = await extractCustomerDetails(d.cells[0]);

customers.push({
key: d.key,
name: d.name,
campaign: d.campaign,
source: d.source,
tier: tierInfo.tier,
reason: tierInfo.reason,
phone: details.phone,
email: details.email,
assigned: d.assigned,
agentName: d.agentName
});
addedCount++;
} catch (error) {
console.warn('Error processing row:', error);
} finally {
remaining--;
setBadgeProgress(remaining);
}
}

const removedCount = currentCustomers.filter(c => !seenKeys.has(c.key)).length;

const startTime = Date.now();
displayPanel(customers, addedCount, removedCount);
const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
console.info(`✅ SLA Report generated in ${totalTime}s (${customers.length} customers, +${addedCount}/-${removedCount})`);
} catch (error) {
console.error('SLA Export Error:', error);
} finally {
const panelBox = document.getElementById(PANEL_BOX_ID);
if (panelBox) panelBox.style.transform = '';
setBadgeProgress(0);
extracting = false;
}
}

// No modal click-and-wait needed here - Email/Mobile/Landline are plain
// text columns, so this is a single synchronous pass over the table.
async function extractAndExportPending() {
if (extracting || assigning) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('Pending Customers table not found');
return;
}

const previousByKey = new Map(currentPendingCustomers.map(c => [c.key, c]));
const leads = collectPendingCustomers();
const seenKeys = new Set(leads.map(l => l.key));
const addedCount = leads.filter(l => !previousByKey.has(l.key)).length;
const removedCount = currentPendingCustomers.filter(c => !seenKeys.has(c.key)).length;

displayPendingPanel(leads, addedCount, removedCount);
console.info(`✅ Pending Customers report generated (${leads.length} customers, +${addedCount}/-${removedCount})`);
} catch (error) {
console.error('Pending Customers Export Error:', error);
} finally {
const panelBox = document.getElementById(PANEL_BOX_ID);
if (panelBox) panelBox.style.transform = '';
setBadgeProgress(0);
extracting = false;
}
}

// Entry point wired to the badge - detects which page we're on and routes
// to the matching extraction path, refusing to run on anything else.
function runExtraction() {
const pageType = detectPageType();
if (pageType === PAGE_SLA) {
extractAndExportSla();
} else if (pageType === PAGE_PENDING) {
extractAndExportPending();
} else {
console.error('SLA Manager: unrecognized page - expected the SLA queue or Pending Customers queue.');
if (badge) {
const original = badge.textContent;
badge.textContent = '❓';
setTimeout(() => { badge.textContent = original; }, 1500);
}
}
}

function setBadgeProgress(remaining) {
if (!badge) return;
if (remaining > 0) {
badge.textContent = String(remaining);
badge.style.fontSize = '18px';
} else {
badge.textContent = '📋';
badge.style.fontSize = '22px';
}
}

function attachBadgeHoverEffects() {
badge.addEventListener('mouseenter', () => {
badge.style.transform = 'scale(1.15)';
badge.style.boxShadow = '0 6px 16px rgba(39, 174, 96, 0.5)';
});
badge.addEventListener('mouseleave', () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.3)';
});
}

function createBadge() {
// Remove any existing instance before recreating
const existingItem = document.getElementById('_slaBadgeNavItem');
if (existingItem) existingItem.remove();
const existingBadge = document.getElementById(BADGE_ID);
if (existingBadge) existingBadge.remove();

// Find the LEFT navbar <ul> specifically, the one containing "Client Config" -
// both nav lists share the class "nav navbar-nav", so match by content, not position.
const targetUl = Array.from(document.querySelectorAll('ul.nav.navbar-nav'))
.find(ul => Array.from(ul.querySelectorAll('a')).some(a => a.textContent.trim() === 'Client Config'));

if (!targetUl) {
console.warn('SLA Manager: navbar structure not found, falling back to fixed position');
badge = document.createElement('div');
badge.id = BADGE_ID;
badge.onclick = runExtraction;
document.documentElement.appendChild(badge);
Object.assign(badge.style, {
position: 'fixed', right: '12px', top: '12px', width: '48px', height: '48px',
background: BADGE_COLOR, border: `2px solid ${BADGE_BORDER_COLOR}`, borderRadius: '50%',
boxShadow: '0 4px 12px rgba(39, 174, 96, 0.3)', zIndex: 99999, cursor: 'pointer',
display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
fontWeight: 'bold', color: BADGE_BORDER_COLOR, transition: 'all 0.3s ease'
});
badge.textContent = '📋';
badge.title = 'Extract leads (SLA queue or Pending Customers)';
attachBadgeHoverEffects();
return;
}

// Plain <li>, no "dropdown" class - sibling items use that for their caret/toggle
// behavior, which this item doesn't need.
const navItem = document.createElement('li');
navItem.id = '_slaBadgeNavItem';
Object.assign(navItem.style, {
display: 'flex', alignItems: 'center', height: '50px', padding: '0 8px'
});

badge = document.createElement('div');
badge.id = BADGE_ID;
Object.assign(badge.style, {
boxSizing: 'border-box', width: '48px', height: '48px',
background: BADGE_COLOR, border: `2px solid ${BADGE_BORDER_COLOR}`, borderRadius: '50%',
boxShadow: '0 4px 12px rgba(39, 174, 96, 0.3)', cursor: 'pointer',
display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
fontWeight: 'bold', color: BADGE_BORDER_COLOR, transition: 'all 0.3s ease'
});
badge.textContent = '📋';
badge.title = 'Extract leads (SLA queue or Pending Customers)';
badge.onclick = runExtraction;
attachBadgeHoverEffects();

navItem.appendChild(badge);
targetUl.appendChild(navItem); // last item in the left nav = immediately after "Client Config"
}

window._slaResetBookmarklet = resetBookmarklet;
window._togglePanelSize = function() {
const current = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
localStorage.setItem(PANEL_SIZE_KEY, current === 'full' ? 'compact' : 'full');
if (currentPageType === PAGE_PENDING) {
displayPendingPanel(currentPendingCustomers);
} else {
displayPanel(currentCustomers);
}
};
window._toggleTier = function(tierId) {
const tierContent = document.getElementById(tierId);
const toggle = document.getElementById('toggle-' + tierId);
if (tierContent && toggle) {
const isHidden = tierContent.style.display === 'none';
tierContent.style.display = isHidden ? 'grid' : 'none';
toggle.textContent = isHidden ? '▼' : '▶';
}
};

window._toggleCallbackType = function(sectionId) {
const content = document.getElementById(sectionId);
const toggle = document.getElementById('toggle-' + sectionId);
if (content && toggle) {
const isHidden = content.style.display === 'none';
content.style.display = isHidden ? 'grid' : 'none';
toggle.textContent = isHidden ? '▼' : '▶';
}
};

window._toggleAssignSection = function() {
const body = document.getElementById('assignSectionBody');
const toggle = document.getElementById('assignSectionToggle');
if (!body || !toggle) return;
const isHidden = body.style.display === 'none';
body.style.display = isHidden ? 'block' : 'none';
toggle.textContent = isHidden ? '▼' : '▶';
saveAssignSettings({ sectionOpen: isHidden });
if (isHidden) syncAllWheelPositions();
};

// A fixed, opinionated "clear what's urgent right now" sweep for the LEAD
// side of the equation - deliberately ignores whatever tiers/callback-types
// happen to be checked (that's what the manual button is for). Pending
// Customers: New + Auto Rescheduled leads due by the top of the next hour.
// SLA: every tier due within the next hour. The AGENT selection is still
// respected, though - only currently-checked agents get leads, same as the
// manual button, since which agents are online/available is real state the
// user is deliberately curating, not something to override.
window._quickAssign = async function() {
const body = document.getElementById('assignSectionBody');
if (body && body.style.display === 'none') {
window._toggleAssignSection();
}
const selectedAgentIds = new Set(
Array.from(document.querySelectorAll('.assign-agent-checkbox:checked')).map(el => el.value)
);
const agents = getAgentRoster().filter(a => selectedAgentIds.has(a.id));
if (agents.length === 0) {
const log = document.getElementById('assignResultsLog');
if (log) log.textContent = 'Select at least one agent.';
return;
}
if (currentPageType === PAGE_PENDING) {
const leads = collectPendingCustomers();
const eligible = filterPendingLeads(leads, { callbackTypes: new Set(CALLBACK_TYPES_PRIMARY), cutoffDate: defaultHourCutoff() });
const prioritized = prioritizePendingLeads(eligible);
const plan = roundRobinAssign(prioritized, agents);
await executeAssignmentRun(plan, locatePendingAssignCell);
} else {
const leads = collectAssignableLeads();
const eligible = filterAssignableLeads(leads, { tiers: new Set([1, 2, 3, 4]), windowMinutes: 60, customerFirstOnly: false, emailOnly: false });
const prioritized = prioritizeLeads(eligible);
const plan = roundRobinAssign(prioritized, agents);
await executeAssignmentRun(plan, locateAssignCell);
}
};

window._setAllAgentCheckboxes = function(checked) {
document.querySelectorAll('.assign-agent-checkbox').forEach((el) => { el.checked = checked; });
if (window._updateAssignPreview) window._updateAssignPreview();
};

window._toggleAdvancedCallbackTypes = function(forceOpen) {
const body = document.getElementById('advancedCallbackTypes');
const toggle = document.getElementById('advancedCallbackToggle');
if (!body || !toggle) return;
const isCurrentlyOpen = body.style.display === 'flex';
const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !isCurrentlyOpen;
body.style.display = shouldOpen ? 'flex' : 'none';
toggle.textContent = shouldOpen ? '▼' : '▶';
saveAssignSettings({ advancedOpen: shouldOpen });
};

// Recomputes and displays "N leads match" before the button is even
// clicked, so a filter combination that matches nothing (or an
// unexpectedly large batch) is visible immediately rather than found out
// via an empty/surprising results log after the fact. Deliberately
// excludes agent selection - that decides who gets the leads, not how
// many qualify.
window._updateAssignPreview = function() {
const previewEl = document.getElementById('assignMatchPreview');
if (!previewEl) return;
persistCurrentAssignSettings();

let count;
if (currentPageType === PAGE_PENDING) {
const selectedTypes = new Set(
Array.from(document.querySelectorAll('.assign-callback-checkbox:checked')).map(el => el.value)
);
const cutoffInput = document.getElementById('assignCutoffTime');
const cutoffDate = parseCutoffFromInput(cutoffInput ? cutoffInput.value : '');
const leads = getCachedPendingCustomers();
count = filterPendingLeads(leads, { callbackTypes: selectedTypes, cutoffDate }).length;
} else {
const selectedTiers = new Set(
Array.from(document.querySelectorAll('.assign-tier-checkbox:checked')).map(el => Number(el.value))
);
const windowInput = document.getElementById('assignWindowMinutes');
const windowMinutes = windowInput && windowInput.value ? Number(windowInput.value) : null;
const customerFirstOnly = document.getElementById('assignCustomerFirstOnly')?.checked || false;
const emailOnly = document.getElementById('assignEmailOnly')?.checked || false;
const leads = getCachedAssignableLeads();
count = filterAssignableLeads(leads, { tiers: selectedTiers, windowMinutes, customerFirstOnly, emailOnly }).length;
}

previewEl.textContent = `${count} lead${count === 1 ? '' : 's'} match${count === 1 ? 'es' : ''} the current filters`;
previewEl.style.color = count === 0 ? '#e74c3c' : '#7f8c8d';
};

window._refreshAssignSection = function() {
const container = document.getElementById('assignSectionContainer');
if (!container) return;
invalidateLeadsCache();

// Preserve deliberate exclusions (unchecked tiers/callback types/agents)
// and the timeframe value across a manual refresh instead of resetting
// them.
const uncheckedAgentIds = new Set(
Array.from(document.querySelectorAll('.assign-agent-checkbox:not(:checked)')).map(el => el.value)
);
const uncheckedFilters = new Set(
Array.from(document.querySelectorAll('.assign-tier-checkbox:not(:checked), .assign-callback-checkbox:not(:checked)')).map(el => el.value)
);
const windowInput = document.getElementById('assignWindowMinutes');
const windowValue = windowInput ? windowInput.value : '';
const cutoffInput = document.getElementById('assignCutoffTime');
const cutoffValue = cutoffInput ? cutoffInput.value : '';
const advancedWasOpen = document.getElementById('advancedCallbackTypes')?.style.display === 'flex';
const customerFirstChecked = document.getElementById('assignCustomerFirstOnly')?.checked;
const emailOnlyChecked = document.getElementById('assignEmailOnly')?.checked;

container.outerHTML = currentPageType === PAGE_PENDING ? renderPendingAssignSection() : renderAssignSection();

uncheckedAgentIds.forEach((id) => {
const el = document.querySelector(`.assign-agent-checkbox[value="${CSS.escape(id)}"]`);
if (el) el.checked = false;
});
uncheckedFilters.forEach((v) => {
const el = document.querySelector(`.assign-tier-checkbox[value="${CSS.escape(v)}"], .assign-callback-checkbox[value="${CSS.escape(v)}"]`);
if (el) el.checked = false;
});
const newWindowInput = document.getElementById('assignWindowMinutes');
if (newWindowInput && windowValue) newWindowInput.value = windowValue;
const newCutoffInput = document.getElementById('assignCutoffTime');
if (newCutoffInput && cutoffValue) newCutoffInput.value = cutoffValue;
if (advancedWasOpen) window._toggleAdvancedCallbackTypes(true);
const newCustomerFirst = document.getElementById('assignCustomerFirstOnly');
if (newCustomerFirst && customerFirstChecked) newCustomerFirst.checked = true;
const newEmailOnly = document.getElementById('assignEmailOnly');
if (newEmailOnly && emailOnlyChecked) newEmailOnly.checked = true;

initAssignSectionWheels();
};

// Shared by the manual Assign button (whatever filters are checked) and
// Quick Assign (its own fixed opinionated criteria) - both just need to
// build a plan and hand it off the same way.
const ASSIGN_CONFIRM_THRESHOLD = 10;

async function executeAssignmentRun(plan, locateCellFn) {
const button = document.getElementById('assignRunButton');
const log = document.getElementById('assignResultsLog');
if (!button || !log) return null;

if (plan.length === 0) {
log.textContent = 'No unassigned leads match.';
return null;
}

if (plan.length >= ASSIGN_CONFIRM_THRESHOLD) {
const agentCount = new Set(plan.map(p => p.agent.id)).size;
const proceed = window.confirm(`About to assign ${plan.length} leads to ${agentCount} agent${agentCount === 1 ? '' : 's'}. Proceed?`);
if (!proceed) return null;
}

button.disabled = true;
button.textContent = `Assigning 0/${plan.length}...`;
log.innerHTML = '';
const summaryEl = document.getElementById('assignResultsSummary');
if (summaryEl) summaryEl.innerHTML = '';

assigning = true;
let results;
try {
results = await runAssignmentPlan(plan, locateCellFn, (soFar) => {
button.textContent = `Assigning ${soFar.length}/${plan.length}...`;
log.innerHTML = soFar.map(r =>
`<div style="color: ${r.ok ? '#27ae60' : '#e74c3c'};">${r.ok ? '✓' : '✗'} ${escapeHtml(r.lead.name)} → ${escapeHtml(r.agent.name)}${r.reason ? ' (' + escapeHtml(r.reason) + ')' : ''}</div>`
).join('');
log.scrollTop = log.scrollHeight;
});
} finally {
assigning = false;
}

const succeeded = results.filter(r => r.ok).length;
button.disabled = false;
button.textContent = 'Assign Unassigned Leads';
const failedEntries = results.filter(r => !r.ok).map(r => ({ lead: r.lead, agent: r.agent }));
lastFailedAssignmentPlan = failedEntries.length > 0 ? failedEntries : null;
lastFailedLocateCellFn = failedEntries.length > 0 ? locateCellFn : null;
renderAssignResultsSummary(results);
appendAssignmentLog(results);
console.info(`✅ Assigned ${succeeded}/${results.length} leads`);
return results;
}

window._runSlaAssignment = async function() {
const log = document.getElementById('assignResultsLog');
if (!log) return;

const selectedTiers = new Set(
Array.from(document.querySelectorAll('.assign-tier-checkbox:checked')).map(el => Number(el.value))
);
const selectedAgentIds = new Set(
Array.from(document.querySelectorAll('.assign-agent-checkbox:checked')).map(el => el.value)
);
const windowInput = document.getElementById('assignWindowMinutes');
const windowMinutes = windowInput && windowInput.value ? Number(windowInput.value) : null;
const customerFirstOnly = document.getElementById('assignCustomerFirstOnly')?.checked || false;
const emailOnly = document.getElementById('assignEmailOnly')?.checked || false;

if (selectedTiers.size === 0) {
log.textContent = 'Select at least one tier.';
return;
}

const agents = getAgentRoster().filter(a => selectedAgentIds.has(a.id));
if (agents.length === 0) {
log.textContent = 'Select at least one agent.';
return;
}

const leads = collectAssignableLeads();
const eligible = filterAssignableLeads(leads, { tiers: selectedTiers, windowMinutes, customerFirstOnly, emailOnly });
const prioritized = prioritizeLeads(eligible);

if (prioritized.length === 0) {
log.textContent = 'No unassigned leads match the selected tiers/filters/timeframe.';
return;
}

const plan = roundRobinAssign(prioritized, agents);
await executeAssignmentRun(plan, locateAssignCell);
};

window._runPendingAssignment = async function() {
const log = document.getElementById('assignResultsLog');
if (!log) return;

const selectedTypes = new Set(
Array.from(document.querySelectorAll('.assign-callback-checkbox:checked')).map(el => el.value)
);
const selectedAgentIds = new Set(
Array.from(document.querySelectorAll('.assign-agent-checkbox:checked')).map(el => el.value)
);
const cutoffInput = document.getElementById('assignCutoffTime');
const cutoffDate = parseCutoffFromInput(cutoffInput ? cutoffInput.value : '');

if (selectedTypes.size === 0) {
log.textContent = 'Select at least one callback type.';
return;
}

const agents = getAgentRoster().filter(a => selectedAgentIds.has(a.id));
if (agents.length === 0) {
log.textContent = 'Select at least one agent.';
return;
}

const leads = collectPendingCustomers();
const eligible = filterPendingLeads(leads, { callbackTypes: selectedTypes, cutoffDate });
const prioritized = prioritizePendingLeads(eligible);

if (prioritized.length === 0) {
log.textContent = 'No unassigned leads match the selected callback types/timeframe.';
return;
}

const plan = roundRobinAssign(prioritized, agents);
await executeAssignmentRun(plan, locatePendingAssignCell);
};

// Detects switching between the SLA queue and Pending Customers by
// polling detectPageType() on a timer, rather than reacting to
// hashchange - this app's customer-detail modal (and likely other
// in-page interactions) also fire hashchange, which was re-triggering
// full panel rebuilds far more often than intended. Polling only
// samples state at fixed intervals regardless of what caused any given
// DOM/hash change in between, so brief modal-related noise is a
// non-issue, and it skips entirely while a scrape is actively running.
//
// Re-running the bookmarklet re-executes this whole script as a fresh,
// independent instance with its own closures - nothing tears down a
// previous instance's background work. window._slaAutoDetectInterval
// persists across re-invocations specifically so a new instance can
// find and clear an old one's still-running interval before starting
// its own; otherwise every past click leaves a zombie poll behind, each
// with its own stale panelElement/currentCustomers, all fighting over
// the same shared badge/panel DOM every 2.5s - which looks exactly like
// "click minimize, it animates away, then reverts" the moment a zombie
// instance's poll fires and rebuilds the panel from scratch.
if (window._slaAutoDetectInterval) {
clearInterval(window._slaAutoDetectInterval);
}
let lastKnownPageType = detectPageType();
window._slaAutoDetectInterval = setInterval(() => {
if (extracting || assigning) return;
const pageType = detectPageType();
if (pageType && pageType !== lastKnownPageType) {
lastKnownPageType = pageType;
runExtraction();
} else if (pageType) {
lastKnownPageType = pageType;
}
}, 2500);

ensureWheelStyles();
createBadge();
console.info('✅ SLA Manager ready');
})();
