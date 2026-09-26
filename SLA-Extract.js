(function() {
const BADGE_ID = '_slaBadge';
const BADGE_COLOR = '#1e293b';
const BADGE_BORDER_COLOR = '#059669';
const PANEL_ID = '_slaPanel';
const PANEL_BOX_ID = '_slaPanelBox';
const PANEL_STATE_KEY = '_slaPanelState';
const PANEL_SIZE_KEY = '_slaPanelSize';
const ASSIGN_SETTINGS_KEY = '_slaAssignSettings';

// ===================================================================
// ICONS
//
// Small inline-SVG line icons (Lucide/Feather-style: 24x24 viewBox,
// stroke-based, currentColor) replacing the emoji this panel used
// everywhere - emoji render inconsistently across OS/browser and read
// as dated next to the rest of the redesign. currentColor means each
// icon just inherits whatever color/text the element around it already
// has, no separate color plumbing needed per call site. A couple
// (bolt, the History bar chart) are filled shapes instead of strokes,
// set via their own fill/stroke attributes which override the parent
// SVG's defaults.
// ===================================================================

const ICONS = {
refresh: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/>',
history: '<path d="M3 3v18h18" fill="none"/><rect x="7" y="13" width="3" height="5" fill="currentColor" stroke="none"/><rect x="12" y="9" width="3" height="9" fill="currentColor" stroke="none"/><rect x="17" y="5" width="3" height="13" fill="currentColor" stroke="none"/>',
bolt: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" fill="currentColor" stroke="none"/>',
inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
clipboard: '<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>',
warning: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
shrink: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
minimize: '<line x1="5" y1="12" x2="19" y2="12"/>',
restore: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
chevron: '<polyline points="6 9 12 15 18 9"/>'
};

function svgIcon(name, size, extraStyle) {
return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;${extraStyle || ''}">${ICONS[name]}</svg>`;
}

// Rotates rather than swaps between two glyphs (the old ▼/▶ text-content
// toggle) - one icon, animated, is the more modern pattern, and the
// toggle handlers only need to flip a transform instead of picking
// between two strings.
function chevronIcon(collapsed, id) {
return `<svg id="${id}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; transition: transform 0.15s ease; transform: rotate(${collapsed ? -90 : 0}deg);">${ICONS.chevron}</svg>`;
}

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
let cancelRequested = false;
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
element.style.background = '#059669';
element.style.color = 'white';
setTimeout(() => {
element.textContent = originalText;
element.style.background = '';
element.style.color = '';
}, 1500);
}).catch((error) => {
console.warn('Copy failed:', error);
element.textContent = '✗ Failed';
element.style.background = '#dc2626';
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
return `<span style="padding: 4px 6px; border-radius: 4px; background: #e2e8f0; color: #94a3b8; display: inline-block; font-size: 13px;">N/A</span>`;
}
const display = escapeHtml(value);
return `<span class="sla-copyable" data-value="${display}" style="cursor: pointer; padding: 4px 6px; border-radius: 4px; background: #eef2ff; color: #1e293b; display: inline-block; font-size: 13px;">${display}</span>`;
}

function renderAssignmentBadge(assigned, agentName) {
return assigned
? `<span style="background: #d1fae5; color: #059669; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0;">✓ ${escapeHtml(agentName || 'Assigned')}</span>`
: `<span style="background: #f8fafc; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; flex-shrink: 0;">Unassigned</span>`;
}

// A per-lead agent picker, for the case of assigning one specific lead
// right now rather than waiting for the next batch/tile/Quick Assign
// sweep to reach it. Selecting an option fires immediately (no separate
// confirm step, matching the speed-first pattern everywhere else in this
// panel) via a change listener delegated on the panel root (see
// mountPanel) rather than an inline onchange with the key interpolated
// into a string - lead keys are built from raw customer name/campaign/
// etc. text, which can contain quotes or other characters that would
// break out of an inline JS string. data-lead-key keeps it as a plain
// (escaped) HTML attribute instead, read back via .dataset - the same
// pattern already used for the .sla-copyable click-to-copy fields.
function renderManualAssignPicker(leadKey, pageType) {
const agents = getAgentRoster();
if (agents.length === 0) return renderAssignmentBadge(false, null);
const options = agents.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
// Same shape/size as renderAssignmentBadge (4px radius, 11px text,
// matching padding) since this and the badge are really the same
// element in two states - only the color changes, to blue rather than
// the green used everywhere else for batch actions (the main button,
// Quick Assign, tile clicks). A one-lead manual override is a
// deliberately different kind of action from a batch sweep and should
// read that way at a glance, without the shape itself changing.
return `<select class="manual-assign-select" data-lead-key="${escapeHtml(leadKey)}" data-page-type="${pageType}"
style="font-size: 11px; font-weight: 600; padding: 2px 8px; border: 1px solid #c7d2fe; border-radius: 4px; background: #eef2ff; color: #4338ca; max-width: 140px; flex-shrink: 0; cursor: pointer;">
<option value="" selected disabled>Assign to…</option>
${options}
</select>`;
}

// Wrapped in its own span (not just the bare badge/select) so
// _manualAssignLead has a stable, narrowly-scoped element to swap the
// content of - the card's outer flex row also holds the customer name
// as a sibling, so replacing that row's innerHTML directly would wipe
// the name out along with the badge/picker.
function renderAssignmentCell(assigned, agentName, leadKey, pageType) {
const inner = assigned ? renderAssignmentBadge(true, agentName) : renderManualAssignPicker(leadKey, pageType);
return `<span class="assignment-cell">${inner}</span>`;
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

// The only way to read the agent list is scraping it out of a live
// unassigned-lead's dropdown - there's no other element on the page
// that exposes the same Angular scope data. So the moment every lead in
// the current table is already assigned, there's no dropdown left to
// read from at all, and this comes back empty - not because agents are
// actually offline, but because there's nothing left to check against.
// Caching the last successful read means that gap only shows up on a
// session's very first scan if it happens to land on an all-assigned
// table; any read that DOES succeed keeps the roster usable afterward,
// same tradeoff the rest of this panel already accepts for agent status
// (a snapshot, not a live feed).
let cachedAgentRoster = null;

function getAgentRoster() {
// Scoped to the SLA table first so an unrelated page dropdown sharing
// the same classes can't get picked up by accident.
const scopeHost = document.querySelector('table .dropdown.ng-scope') || document.querySelector('.dropdown.ng-scope');
if (!scopeHost || typeof angular === 'undefined') return cachedAgentRoster || [];
try {
const scope = angular.element(scopeHost).scope();
const agents = ((scope && scope.agents) || []).map(normalizeAgent);
if (agents.length > 0) cachedAgentRoster = agents;
return agents.length > 0 ? agents : (cachedAgentRoster || []);
} catch (error) {
console.warn('Could not read agent roster:', error);
return cachedAgentRoster || [];
}
}

// Whether there's currently anything on the page to read the agent
// roster from at all - lets callers tell "genuinely no agents online"
// apart from "can't check right now" when deciding what to say, rather
// than reporting the same confident "No agents online" for both.
function canCheckAgentRoster() {
return !!(document.querySelector('table .dropdown.ng-scope') || document.querySelector('.dropdown.ng-scope'));
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

function filterAssignableLeads(leads, { tiers, windowMinutes, customerFirstOnly, emailOnly, missedOnly }) {
const now = Date.now();
return leads.filter((lead) => {
if (lead.assigned) return false;
if (!tiers.has(lead.tier)) return false;
if (customerFirstOnly && !lead.isCustomerFirst) return false;
if (emailOnly && !lead.isEmailOnly) return false;
if (missedOnly && lead.status !== 'Missed') return false;
if (windowMinutes != null && lead.slaDate) {
const minutesUntilDue = (lead.slaDate.getTime() - now) / 60000;
if (minutesUntilDue > windowMinutes) return false;
}
return true;
});
}

// Per-tier/per-callback-type counts next to each checkbox used to be
// unscoped totals ("Tier 2 (14)" meant 14 unassigned Tier 2 leads
// anywhere, not 14 due within whatever window is currently selected) -
// misleading once a shorter window is dialed in, since the checkbox
// count wouldn't shrink to match. windowMinutes null (the 'All' preset)
// intentionally falls back to the unscoped total, matching what 'All'
// already means everywhere else in this file.
function computeSlaTierCounts(leads, windowMinutes) {
const now = Date.now();
return [1, 2, 3, 4].map(t => leads.filter((l) => {
if (l.assigned || l.tier !== t) return false;
if (windowMinutes == null || !l.slaDate) return true;
return (l.slaDate.getTime() - now) / 60000 <= windowMinutes;
}).length);
}

function computePendingCallbackCounts(leads, cutoffDate) {
const counts = {};
CALLBACK_TYPE_ORDER.forEach((type) => {
counts[type] = leads.filter((l) => {
if (l.assigned || l.callbackType !== type) return false;
if (!l.nextActionDate) return false;
if (cutoffDate && l.nextActionDate.getTime() >= cutoffDate.getTime()) return false;
return true;
}).length;
});
return counts;
}

// Assignment is randomized but still even: leads are dealt in rounds of
// one lead per agent, with the agent order reshuffled every round, so
// nobody is systematically first in line (a fixed roster order - or a
// cursor that just continues it - meant whoever sorts first, e.g. Adam,
// kept getting the extra lead and the most urgent one, while agents at
// the end of the list consistently ended up with less over time). Any
// leftover leads that don't fill a whole round go to the agents with the
// lightest CURRENT load, read from the queue itself (see
// currentAgentLoads) so it reflects assignments made directly in
// Konnect too, not just ones made through this panel.
function shuffle(items) {
const a = items.slice();
for (let i = a.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[a[i], a[j]] = [a[j], a[i]];
}
return a;
}

function normalizeAgentName(name) {
return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// How many leads each agent currently holds in the queue being viewed,
// counted from the live table's assign cells (same scan every render
// already does), keyed by agent id. Returns null - meaning "unknown, use
// random" - if the scan fails, or if leads are assigned but none of the
// names can be matched to a roster agent (i.e. the cell text isn't the
// agent's name after all), since counting nothing would silently bias
// every leftover toward the same people. Leads held by someone not in the
// current roster (gone offline) are simply not counted.
function currentAgentLoads(agents) {
try {
const leads = currentPageType === PAGE_PENDING ? collectPendingCustomers() : collectAssignableLeads();
const assigned = leads.filter(l => l.assigned && l.agentName);
const byName = new Map(agents.map(a => [normalizeAgentName(a.name), a.id]));
const loads = {};
let matched = 0;
assigned.forEach((l) => {
const id = byName.get(normalizeAgentName(l.agentName));
if (id === undefined) return;
loads[id] = (loads[id] || 0) + 1;
matched++;
});
if (assigned.length > 0 && matched === 0) return null;
return loads;
} catch (error) {
return null;
}
}

function roundRobinAssign(leads, agents) {
if (leads.length === 0 || agents.length === 0) return [];
const plan = [];
let i = 0;
while (leads.length - i >= agents.length) {
shuffle(agents).forEach((agent) => plan.push({ lead: leads[i++], agent }));
}
if (i < leads.length) {
// shuffled first so ties (and the no-data fallback, where every load
// counts as equal) break at random rather than by roster order
const loads = currentAgentLoads(agents) || {};
const extras = shuffle(agents)
.sort((a, b) => (loads[a.id] || 0) - (loads[b.id] || 0))
.slice(0, leads.length - i);
shuffle(extras).forEach((agent) => plan.push({ lead: leads[i++], agent }));
}
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
if (cancelRequested) {
for (let j = i; j < plan.length; j++) {
results[j] = { lead: plan[j].lead, agent: plan[j].agent, ok: false, reason: 'Cancelled' };
settled.push(results[j]);
}
reportProgress();
break;
}
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
const color = failed === 0 ? '#059669' : (succeeded === 0 ? '#dc2626' : '#d97706');
const icon = failed === 0 ? '✓' : '⚠';
const text = failed === 0
? `${icon} ${succeeded} assigned`
: `${icon} ${succeeded} assigned, ${failed} failed`;
const retryLink = failed > 0
? ` <span onclick="window._retryFailedAssignments()" style="text-decoration: underline; cursor: pointer;">Retry Failed</span>`
: '';
el.innerHTML = `<div style="margin-top: 8px; padding: 8px 10px; border-radius: 4px; background: ${color}20; color: ${color}; font-size: 13px; font-weight: 700; text-align: center;">${text}${retryLink}</div>`;
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

// Only ever holds today's entries - a stale entry from a previous day
// sitting in this log (surviving a bookmarklet re-invocation, since
// localStorage isn't cleared by that) made the History panel
// impossible to trust: there was no way to tell whether a count
// included today's shift only or leftover days too. Pruning anything
// not from today on every write, rather than just filtering at display
// time, also keeps the whole ASSIGN_LOG_MAX cap spent on today's data
// instead of old days quietly eating into it on a busy week.
function appendAssignmentLog(results) {
try {
const today = new Date().toDateString();
const existing = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]')
.filter(e => new Date(e.time).toDateString() === today);
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

// Filters to today defensively (appendAssignmentLog already prunes on
// write) so this never shows a stale count even if the day rolled over
// mid-session without a new assignment triggering that prune.
function renderAssignmentHistoryHtml() {
let entries = [];
try { entries = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]'); } catch (error) { /* ignore */ }
const today = new Date().toDateString();
entries = entries.filter(e => new Date(e.time).toDateString() === today);
if (entries.length === 0) return '<div style="color:#94a3b8;">No assignments recorded today yet.</div>';
const tally = {};
entries.forEach(e => { tally[e.agent] = (tally[e.agent] || 0) + 1; });
const rows = Object.entries(tally).sort((a, b) => b[1] - a[1])
.map(([name, count]) => `<div style="display:flex;justify-content:space-between;"><span>${escapeHtml(name)}</span><span style="font-weight:700;">${count}</span></div>`).join('');
const last = entries[entries.length - 1];
return `<div style="font-size:11px;color:#64748b;margin-bottom:4px;">Assigned counts (today's shift):</div>${rows}
<div style="font-size:10px;color:#cbd5e1;margin-top:6px;">Last: ${escapeHtml(last.lead)} → ${escapeHtml(last.agent)} at ${new Date(last.time).toLocaleTimeString()}</div>`;
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
style.textContent = '.wheel-scroll::-webkit-scrollbar { display: none; } .wheel-scroll:focus { outline: 2px solid #4f46e5; outline-offset: -1px; } .stat-tile-clickable:hover { background: #eef2ff !important; }';
document.head.appendChild(style);
}

function renderWheelColumnHtml(id, values, widthPx) {
const spacerHeight = Math.floor(WHEEL_VISIBLE_ROWS / 2) * WHEEL_ROW_HEIGHT;
const items = values.map(v => `<div class="wheel-item" style="height: ${WHEEL_ROW_HEIGHT}px; display: flex; align-items: center; justify-content: center; font-size: 13px; scroll-snap-align: center; color: #94a3b8; cursor: pointer; transition: color 0.15s, font-weight 0.15s;">${escapeHtml(String(v))}</div>`).join('');
return `<div style="position: relative; width: ${widthPx}px;">
<div style="position: absolute; top: ${spacerHeight}px; left: 0; right: 0; height: ${WHEEL_ROW_HEIGHT}px; background: #eef2ff; border-radius: 4px; pointer-events: none;"></div>
<div id="${id}" class="wheel-scroll" style="position: relative; height: ${WHEEL_VISIBLE_ROWS * WHEEL_ROW_HEIGHT}px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; border: 1px solid #cbd5e1; border-radius: 4px; background: white; cursor: grab;">
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
item.style.color = i === index ? '#1e293b' : '#94a3b8';
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
// preventDefault (needed to stop text selection while dragging) also
// suppresses the browser's default focus-on-click behavior - and since
// every click starts with a mousedown, that silently broke type-to-jump
// entirely: the wheel could never actually receive focus, so the
// keydown listener below never fired. Focus explicitly instead of
// relying on the default.
event.preventDefault();
el.focus();
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
item.style.color = i === index ? '#1e293b' : '#94a3b8';
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
if (!s) return '#cbd5e1';
if (s.includes('chat') || s.includes('call') || s.includes('busy') || s.includes('break') || s.includes('away') || s.includes('wrap')) return '#d97706';
if (s.includes('start') || s.includes('available') || s.includes('idle') || s.includes('ready')) return '#059669';
return '#94a3b8';
}

function renderAgentCheckboxes(agents, excludedAgentIds) {
if (agents.length === 0) {
const label = canCheckAgentRoster()
? 'No agents online'
: "Can't check agents right now (no unassigned lead to read from)";
return `<div style="font-size: 13px; color: #94a3b8;">${label}</div>`;
}
return agents.map(a => `
<label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: #1e293b;" ${a.status ? `title="${escapeHtml(a.status)}"` : ''}>
<input type="checkbox" class="assign-agent-checkbox" value="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name)}" ${excludedAgentIds.has(a.id) ? '' : 'checked'} onchange="window._updateAssignPreview()">
<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusDotColor(a.status)}; flex-shrink: 0;"></span>
${escapeHtml(a.name)}
</label>`).join('');
}

// Shared by both assign sections - a plain number input capping how many
// leads a run actually touches, applied via applyAssignLimit() right
// before roundRobinAssign() in every entry point. Blank means no cap.
function renderAssignLimitControl(settings) {
return `<label for="assignLimitInput" style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; font-weight: 700; letter-spacing: 0.3px; white-space: nowrap;">
LIMIT
<input type="number" id="assignLimitInput" min="1" placeholder="all" value="${settings.assignLimit || ''}" oninput="window._updateAssignPreview()"
style="width: 48px; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; font-weight: 400; color: #1e293b;">
</label>`;
}

// `accent` can be a boolean (true -> the standard red urgency accent, for
// backward compatibility with existing call sites) or a hex color string,
// for tile groups that need their own visual identity distinct from
// "urgent" (e.g. Customer First - important, but a customer attribute,
// not a lateness signal, so it shouldn't borrow red's urgency meaning).
// `onclick`, when given, makes the tile itself a quick-assign shortcut -
// the number displayed becomes the assign criteria, so clicking "23"
// under "15m" assigns exactly those 23 leads. title gives a hover hint
// since there's no other visible affordance marking a tile as clickable
// beyond the pointer cursor.
function renderStatTile(label, value, accent, onclick) {
const color = accent === true ? '#dc2626' : (typeof accent === 'string' ? accent : null);
const clickable = typeof onclick === 'string' && onclick.length > 0;
return `<div ${clickable ? `class="stat-tile-clickable" onclick="${onclick}" title="Click to assign these"` : ''} style="flex: 1; text-align: center; background: white; border-radius: 6px; padding: 6px 2px; border: 1px solid ${color || '#e2e8f0'}; ${clickable ? 'cursor: pointer;' : ''}">
<div style="font-size: 16px; font-weight: 700; color: ${color || '#1e293b'};">${value}</div>
<div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px;">${label}</div>
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
renderStatTile('Missed', missedCount, missedCount > 0, `window._quickAssignSlaTile(null, false, true)`),
...SLA_DUE_BUCKET_MINUTES.map((m, i) => renderStatTile(`${m}m`, dueCounts[i], m === 15 && dueCounts[i] > 0, `window._quickAssignSlaTile(${m}, false, false)`))
].join('');
// Customer First gets its own tile row, not a plain text line - the
// priority engine treats it as a distinct, important category (see
// prioritizeLeads), so it should read as important at the same glance
// speed as the Missed/due tiles above it, not as an afterthought caption.
// Purple rather than red so it doesn't borrow "urgent/late" meaning -
// this is a customer attribute, not a lateness signal.
const CUSTOMER_FIRST_ACCENT = '#7c3aed';
const cfTiles = SLA_DUE_BUCKET_MINUTES.map((m, i) =>
renderStatTile(`${m}m`, customerFirstDueCounts[i], customerFirstDueCounts[i] > 0 ? CUSTOMER_FIRST_ACCENT : null, `window._quickAssignSlaTile(${m}, true, false)`)
).join('');

return `
<div id="slaDueSummary" style="padding: 10px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b;">
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${tiles}</div>
<div style="font-size: 11px; font-weight: 700; color: ${CUSTOMER_FIRST_ACCENT}; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Customer First</div>
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${cfTiles}</div>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span style="font-size: 11px; color: #94a3b8;">Assigned ${assignedCount} &middot; Not assigned ${notAssignedCount} &middot; ${lastScannedLabel()}</span>
<button onclick="window._quickAssign()" style="background: #059669; color: white; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">${svgIcon('bolt', 11)} Quick Assign</button>
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

// Tier/callback-type section open-closed state used to live only in the
// DOM (a plain style.display toggle), which meant it reset to fully-open
// on every panel rebuild - collapsing sections you don't care about, to
// cut how far you have to scroll to reach the ones you do, had to be
// redone after every single scan/refresh. Persisted the same way as the
// rest of the assign settings so it survives.
const COLLAPSED_SECTIONS_KEY = '_slaCollapsedSections';

function loadCollapsedSections() {
try {
return new Set(JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY)) || []);
} catch (error) {
return new Set();
}
}

function isSectionCollapsed(sectionId) {
return loadCollapsedSections().has(sectionId);
}

function setSectionCollapsed(sectionId, collapsed) {
const set = loadCollapsedSections();
if (collapsed) set.add(sectionId); else set.delete(sectionId);
try {
localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(set)));
} catch (error) {
// ignore
}
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
const assignLimit = document.getElementById('assignLimitInput')?.value || null;

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
customerFirstOnly, emailOnly, windowMinutes, cutoffTime, advancedOpen, assignLimit
});
}

// Reads the persisted cap and, if set, keeps only the first N of an
// already-priority-sorted list - since prioritizeLeads/prioritizePendingLeads
// always sort most-urgent-first, capping takes the N most urgent leads
// and drops the rest for this run, rather than an arbitrary subset. Used
// by every run-building entry point (manual button, Quick Assign, tile
// clicks) so "just do 10 of these" works no matter which one is used.
function applyAssignLimit(prioritized) {
const raw = loadAssignSettings().assignLimit;
const limit = raw ? Number(raw) : null;
if (!limit || limit <= 0) return prioritized;
return prioritized.slice(0, limit);
}

// Shared by renderAssignSection/renderPendingAssignSection - the two
// pages' assign sections are identical from the header through the
// results log (agents/limit/preview/button/results), only diverging in
// the filters zone below it (tiers/special filters vs callback types)
// and which run handler the button calls. Was duplicated near-verbatim
// in both functions; factored out once both were stable rather than
// during initial development, since the shared shape only became
// obvious after both existed.
function renderAssignSectionShell(settings, agentCheckboxes, buttonDisabled, runHandlerName, filtersZoneHtml) {
return `
<div id="assignSectionContainer" style="padding: 16px 20px; background: white; border-bottom: 1px solid #e2e8f0;">
<div onclick="window._toggleAssignSection()" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
<span style="font-weight: 700; color: #1e293b; font-size: 15px; display: inline-flex; align-items: center; gap: 6px;">${svgIcon('bolt', 14)} Assign Leads</span>
<span style="color: #1e293b;">${chevronIcon(!settings.sectionOpen, 'assignSectionToggle')}</span>
</div>
<div id="assignSectionBody" style="margin-top: 12px; display: ${settings.sectionOpen ? 'block' : 'none'}; max-height: ${assignSectionBodyMaxHeight()}; overflow-y: auto; padding-right: 6px;">
<div style="margin-bottom: 10px;">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
<span style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px;">AGENTS ONLINE</span>
<span style="display: flex; gap: 8px;">
<span onclick="window._setAllAgentCheckboxes(true)" style="font-size: 11px; color: #4f46e5; cursor: pointer;">All</span>
<span onclick="window._setAllAgentCheckboxes(false)" style="font-size: 11px; color: #4f46e5; cursor: pointer;">None</span>
<span onclick="window._refreshAssignSection()" style="font-size: 11px; color: #4f46e5; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">${svgIcon('refresh', 11)} Refresh</span>
<span onclick="window._toggleAssignHistory()" style="font-size: 11px; color: #4f46e5; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">${svgIcon('history', 11)} History</span>
</span>
</div>
<div id="assignAgentList" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">${agentCheckboxes}</div>
<div id="assignHistoryPanel" style="display: none; margin-top: 6px; padding: 8px; background: #f8fafc; border-radius: 4px; font-size: 11px; color: #1e293b;"></div>
</div>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
${renderAssignLimitControl(settings)}
<span id="assignMatchPreview" style="font-size: 11px; color: #64748b; text-align: right;"></span>
</div>
<button id="assignRunButton" onclick="window.${runHandlerName}()" ${buttonDisabled ? 'disabled' : ''}
style="width: 100%; padding: 10px; background: ${buttonDisabled ? '#cbd5e1' : '#059669'}; color: white; border: none; border-radius: 8px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; font-size: 13px; font-weight: 600;">
${buttonDisabled ? (canCheckAgentRoster() ? 'No agents online' : "Can't check agents right now") : 'Assign Unassigned Leads'}
</button>
<div id="assignResultsSummary"></div>
<div id="assignResultsLog" style="margin-top: 6px; font-size: 11px; color: #64748b; max-height: 100px; overflow-y: auto;"></div>
<div style="background: #f1f5f9; border-radius: 6px; padding: 12px; margin-top: 16px;">
${filtersZoneHtml}
</div>
</div>
</div>`;
}

function renderAssignSection() {
const leads = getCachedAssignableLeads();
const agents = getAgentRoster();

const settings = loadAssignSettings();
const excludedTiers = new Set(settings.excludedTiers || []);
const excludedAgentIds = new Set(settings.excludedAgentIds || []);
const initialWindowMinutes = settings.windowMinutes ? Number(settings.windowMinutes) : null;
const tierCounts = computeSlaTierCounts(leads, initialWindowMinutes);
const customerFirstCount = leads.filter(l => l.isCustomerFirst && !l.assigned).length;
const emailOnlyCount = leads.filter(l => l.isEmailOnly && !l.assigned).length;

const tierCheckboxes = [1, 2, 3, 4].map(t => `
<label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #1e293b;">
<input type="checkbox" class="assign-tier-checkbox" value="${t}" ${excludedTiers.has(t) ? '' : 'checked'} onchange="window._updateAssignPreview()"> Tier ${t} <span id="tier-count-${t}" style="color:#94a3b8;">(${tierCounts[t - 1]})</span>
</label>`).join('');

const agentCheckboxes = renderAgentCheckboxes(agents, excludedAgentIds);
const buttonDisabled = agents.length === 0;

const filtersZoneHtml = `
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">TIERS</div>
<div style="display: flex; gap: 10px; flex-wrap: wrap;">${tierCheckboxes}</div>
</div>
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">SPECIAL FILTERS</div>
<div style="display: flex; flex-direction: column; gap: 6px;">
<label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #1e293b;">
<input type="checkbox" id="assignCustomerFirstOnly" ${settings.customerFirstOnly ? 'checked' : ''} onchange="window._updateAssignPreview()"> Customer First only <span style="color:#94a3b8;">(${customerFirstCount})</span>
</label>
<label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #1e293b;">
<input type="checkbox" id="assignEmailOnly" ${settings.emailOnly ? 'checked' : ''} onchange="window._updateAssignPreview()"> Email only (no phone) <span style="color:#94a3b8;">(${emailOnlyCount})</span>
</label>
</div>
</div>
<div>
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">DUE WITHIN (MINUTES)</div>
<input id="assignWindowMinutes" type="hidden" value="${settings.windowMinutes || ''}">
${renderWheelColumnHtml('assignWindowMinutesWheel', SLA_WINDOW_PRESETS, 90)}
</div>`;

return renderAssignSectionShell(settings, agentCheckboxes, buttonDisabled, '_runSlaAssignment', filtersZoneHtml);
}

// ===================================================================
// PENDING CUSTOMERS TAB
// ===================================================================

const CALLBACK_TYPES_PRIMARY = ['New', 'Auto Rescheduled'];
const CALLBACK_TYPES_ADVANCED = ['Manual Rescheduled', 'Post Closure'];
const CALLBACK_TYPE_ORDER = [...CALLBACK_TYPES_PRIMARY, ...CALLBACK_TYPES_ADVANCED];
const CALLBACK_TYPE_COLORS = {
'New': '#dc2626',
'Auto Rescheduled': '#0d9488',
'Manual Rescheduled': '#d97706',
'Post Closure': '#94a3b8'
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
renderStatTile('This hour', dueThisHour, dueThisHour > 0, `window._quickAssignPendingTile(0)`),
renderStatTile('Next hour', dueNextHour, false, `window._quickAssignPendingTile(1)`)
].join('');

return `
<div id="pendingDueSummary" style="padding: 10px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b;">
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${tiles}</div>
<div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${callbackLine}</div>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span style="font-size: 11px; color: #94a3b8;">Assigned ${assignedCount} &middot; Not assigned ${notAssignedCount} &middot; ${lastScannedLabel()}</span>
<button onclick="window._quickAssign()" style="background: #059669; color: white; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">${svgIcon('bolt', 11)} Quick Assign</button>
</div>
</div>`;
}

function renderPendingAssignSection() {
const leads = getCachedPendingCustomers();
const agents = getAgentRoster();

const settings = loadAssignSettings();
const excludedCallbackTypes = new Set(settings.excludedCallbackTypes || []);
const includedAdvancedCallbackTypes = new Set(settings.includedAdvancedCallbackTypes || []);
const excludedAgentIds = new Set(settings.excludedAgentIds || []);
const initialCutoffDate = parseCutoffFromInput(settings.cutoffTime);
const callbackCounts = computePendingCallbackCounts(leads, initialCutoffDate);
const countFor = (type) => callbackCounts[type] || 0;

const primaryCheckboxes = CALLBACK_TYPES_PRIMARY.map(type => `
<label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #1e293b;">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${excludedCallbackTypes.has(type) ? '' : 'checked'} onchange="window._updateAssignPreview()"> ${escapeHtml(type)} <span id="cb-count-${slugify(type)}" style="color:#94a3b8;">(${countFor(type)})</span>
</label>`).join('');

const advancedCheckboxes = CALLBACK_TYPES_ADVANCED.map(type => `
<label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #1e293b;">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${includedAdvancedCallbackTypes.has(type) ? 'checked' : ''} onchange="window._updateAssignPreview()"> ${escapeHtml(type)} <span id="cb-count-${slugify(type)}" style="color:#94a3b8;">(${countFor(type)})</span>
</label>`).join('');

const agentCheckboxes = renderAgentCheckboxes(agents, excludedAgentIds);
const buttonDisabled = agents.length === 0;
const defaultCutoff = settings.cutoffTime || formatTimeForInput(defaultHourCutoff());
const advancedOpenStyle = settings.advancedOpen ? 'display: flex;' : 'display: none;';

const filtersZoneHtml = `
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">CALLBACK TYPE</div>
<div style="display: flex; gap: 10px; flex-wrap: wrap;">${primaryCheckboxes}</div>
<div onclick="window._toggleAdvancedCallbackTypes()" style="margin-top: 6px; font-size: 11px; color: #4f46e5; cursor: pointer;">
${chevronIcon(!settings.advancedOpen, 'advancedCallbackToggle')} Advanced (Manual Rescheduled, Post Closure)
</div>
<div id="advancedCallbackTypes" style="${advancedOpenStyle} gap: 10px; flex-wrap: wrap; margin-top: 6px;">${advancedCheckboxes}</div>
</div>
<div>
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">DUE BEFORE</div>
<input id="assignCutoffTime" type="hidden" value="${defaultCutoff}">
<div style="display: flex; align-items: center; gap: 6px;">
${renderWheelColumnHtml('assignCutoffHourWheel', HOUR_VALUES, 56)}
<span style="font-weight: 700; color: #1e293b;">:</span>
${renderWheelColumnHtml('assignCutoffMinuteWheel', MINUTE_VALUES, 56)}
</div>
</div>`;

return renderAssignSectionShell(settings, agentCheckboxes, buttonDisabled, '_runPendingAssignment', filtersZoneHtml);
}

function renderCallbackTypeSection(typeName, customers, color) {
const sectionId = 'cb-' + slugify(typeName);

if (customers.length === 0) {
return `<div style="margin-bottom: 20px; padding: 16px; background: white; border-radius: 8px;
border-left: 4px solid ${color}; box-shadow: 0 1px 3px rgba(15,23,42,0.08);">
<h3 style="margin: 0; color: ${color}; font-size: 15px; font-weight: 600;">${escapeHtml(typeName)}</h3>
<p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 13px;">No customers</p>
</div>`;
}

const collapsed = isSectionCollapsed(sectionId);
return `<div style="margin-bottom: 20px;">
<div onclick="window._toggleCallbackType('${sectionId}')" style="cursor: pointer; padding: 16px; background: white; border-radius: 8px 8px 0 0;
display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${color};
border-bottom: 2px solid #e2e8f0;">
<div>
<span style="font-weight: 700; color: #1e293b; font-size: 15px;">${escapeHtml(typeName)}</span>
<span style="font-size: 13px; color: #94a3b8; margin-left: 10px;">${customers.length}</span>
</div>
<span style="color: ${color};">${chevronIcon(collapsed, 'toggle-' + sectionId)}</span>
</div>
<div id="${sectionId}" class="collapsible-section" style="display: ${collapsed ? 'none' : 'grid'}; gap: 12px; padding: 12px; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 2px 6px rgba(15,23,42,0.08);">
${customers.map(c => `<div class="customer-card" data-customer-name="${escapeHtml(c.name.toLowerCase())}" style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; background: #f1f5f9;">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: #e2e8f0; color: #1e293b; font-weight: 700; font-size: 15px;">${escapeHtml(c.name)}</span>
${renderAssignmentCell(c.assigned, c.agentName, c.key, PAGE_PENDING)}
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">MOBILE</div>
${renderCopyableField(c.mobile)}
</div>
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">LANDLINE</div>
${renderCopyableField(c.landline)}
</div>
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">NEXT ACTION</div>
<span style="font-size: 13px; color: #1e293b;">${c.nextActionDate ? escapeHtml(c.nextActionDate.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'Unknown'}</span>
</div>
</div>
<div style="padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; gap: 6px; flex-wrap: wrap; font-size: 13px;">
<span style="background: #e2e8f0; color: #1e293b; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.brand || '')}</span>
<span style="background: #d1fae5; color: #059669; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.campaign || '')}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

function renderTierSection(tierName, customers, color, tierId) {
if (customers.length === 0) {
return `<div style="margin-bottom: 20px; padding: 16px; background: white; border-radius: 8px;
border-left: 4px solid ${color}; box-shadow: 0 1px 3px rgba(15,23,42,0.08);">
<h3 style="margin: 0; color: ${color}; font-size: 15px; font-weight: 600;">${tierName}</h3>
<p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 13px;">No customers</p>
</div>`;
}

const collapsed = isSectionCollapsed(tierId);
return `<div style="margin-bottom: 20px;">
<div onclick="window._toggleTier('${tierId}')" style="cursor: pointer; padding: 16px; background: white; border-radius: 8px 8px 0 0;
display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${color};
border-bottom: 2px solid #e2e8f0;">
<div>
<span style="font-weight: 700; color: #1e293b; font-size: 15px;">${tierName}</span>
<span style="font-size: 13px; color: #94a3b8; margin-left: 10px;">${customers.length}</span>
</div>
<span style="color: ${color};">${chevronIcon(collapsed, 'toggle-' + tierId)}</span>
</div>
<div id="${tierId}" class="collapsible-section" style="display: ${collapsed ? 'none' : 'grid'}; gap: 12px; padding: 12px; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 2px 6px rgba(15,23,42,0.08);">
${customers.map(c => `<div class="customer-card" data-customer-name="${escapeHtml(c.name.toLowerCase())}" style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; background: #f1f5f9;">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: #e2e8f0; color: #1e293b; font-weight: 700; font-size: 15px;">${escapeHtml(c.name)}</span>
${renderAssignmentCell(c.assigned, c.agentName, c.key, PAGE_SLA)}
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">PHONE</div>
${renderCopyableField(c.phone)}
</div>
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
</div>
<div style="padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; gap: 6px; flex-wrap: wrap; font-size: 13px;">
<span style="background: #e2e8f0; color: #1e293b; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.source)}</span>
<span style="background: #d1fae5; color: #059669; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.campaign)}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

function renderPanelShell({ title, count, newCount, removedCount, summaryHtml, assignSectionHtml, bodyHtml }) {
const panelSize = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
const isFull = panelSize === 'full';
const positionStyle = isFull
? 'top: 0; right: 0; bottom: 0; height: 100vh; width: 450px; border-radius: 0;'
: 'bottom: 20px; right: 20px; width: 400px; height: min(560px, calc(100vh - 90px)); border-radius: 16px;';

// PANEL_STATE_KEY was being written on every minimize but never read
// back - a page-switch triggers the auto-detect poll, which rebuilds
// this whole shell from scratch (mountPanel replaces the DOM node
// entirely), and a fresh render had no idea the panel was minimized,
// so it always came back full size. Reading it here and applying the
// same transform/icon a manual minimize would have set is what makes
// "stay minimized across a rebuild" actually true.
const isMinimized = localStorage.getItem(PANEL_STATE_KEY) === 'hidden';

return `
<div id="${PANEL_BOX_ID}" style="position: fixed; ${positionStyle}
background: #f8fafc; box-shadow: 0 20px 40px -12px rgba(15,23,42,0.25), 0 4px 12px rgba(15,23,42,0.08);
z-index: 100000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
display: flex; flex-direction: column; transition: transform 0.3s ease; ${isMinimized ? 'transform: translateX(150%);' : ''}">

<div style="position: sticky; top: 0; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 20px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669;
flex-shrink: 0;">
<div style="display: flex; align-items: center; gap: 12px;">
<h2 style="margin: 0; font-size: 20px; font-weight: 700;">${title}</h2>
<span style="background: #059669; color: white; padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 600;">${count}</span>
${newCount > 0 ? `<span style="background: #d97706; color: white; padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 600;">+${newCount}</span>` : ''}
${removedCount > 0 ? `<span style="background: #64748b; color: white; padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 600;">−${removedCount}</span>` : ''}
</div>
<div style="display: flex; gap: 8px;">
<button id="_slaSizeBtn" onclick="window._togglePanelSize();"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; border-radius: 4px; transition: all 0.2s; display: flex; align-items: center;"
title="${isFull ? 'Shrink to box' : 'Expand to full height'}">${svgIcon(isFull ? 'shrink' : 'expand', 14)}</button>
<button onclick="document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0;"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; border-radius: 4px; transition: all 0.2s; display: flex; align-items: center;"
title="Top">${svgIcon('arrowUp', 14)}</button>
<button id="_slaMinimizeBtn" onclick="window._toggleMinimizePanel();"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; border-radius: 4px; transition: all 0.2s; display: flex; align-items: center;"
title="Minimize">${svgIcon(isMinimized ? 'restore' : 'minimize', 14)}</button>
</div>
</div>

${summaryHtml || ''}
${assignSectionHtml}

<div class="panelContent" style="flex: 1; overflow-y: auto; padding: 20px; padding-right: 12px;">
<div style="position: sticky; top: 0; z-index: 2; background: #f8fafc; padding-bottom: 10px; margin-bottom: 10px;">
<input type="text" id="customerSearchInput" placeholder="Search by name…" oninput="window._filterCustomerSearch(this.value)"
style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; color: #1e293b; background: white;">
</div>
${bodyHtml}
</div>

<div style="border-top: 1px solid #cbd5e1; padding: 8px 14px; background: white; flex-shrink: 0; display: flex; justify-content: flex-end; box-shadow: 0 -2px 8px rgba(15,23,42,0.05);">
<button onclick="(function() { if (confirm('Clear all data and stop?')) { window._slaResetBookmarklet(); } })();"
style="padding: 6px 12px; background: transparent; color: #dc2626; border: 1px solid #dc2626; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">Clear & Stop</button>
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

// Delegated on the panel root rather than bound per-<select>, so a
// picker that gets swapped back in after a failed manual assign (see
// _manualAssignLead) is still handled without needing to re-attach a
// listener to the freshly-injected element.
panelElement.addEventListener('change', (event) => {
const el = event.target.closest('.manual-assign-select');
if (!el) return;
window._manualAssignLead(el.dataset.pageType, el.dataset.leadKey, el.value, el);
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
<div style="color: #cbd5e1; margin-bottom: 16px;">${svgIcon('inbox', 48, ' stroke-width: 1.5;')}</div>
<h3 style="color: #1e293b; margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">No Leads in Queue</h3>
<p style="color: #64748b; margin: 0; font-size: 15px; line-height: 1.6;">The SLA queue is empty. Check back when new leads arrive.</p>
</div>
` : `
${renderTierSection('Tier 1 - Priority', tiered.tier1, '#dc2626', 'tier1')}
${renderTierSection('Tier 2 - High', tiered.tier2, '#d97706', 'tier2')}
${renderTierSection('Tier 3 - Medium', tiered.tier3, '#0d9488', 'tier3')}
${renderTierSection('Tier 4 - Standard', tiered.tier4, '#94a3b8', 'tier4')}
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
<div style="color: #cbd5e1; margin-bottom: 16px;">${svgIcon('inbox', 48, ' stroke-width: 1.5;')}</div>
<h3 style="color: #1e293b; margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">No Pending Customers</h3>
<p style="color: #64748b; margin: 0; font-size: 15px; line-height: 1.6;">Nothing in the queue right now.</p>
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
const original = badge.innerHTML;
badge.innerHTML = svgIcon('warning', 22);
setTimeout(() => { badge.innerHTML = original; }, 1500);
}
}
}

function setBadgeProgress(remaining) {
if (!badge) return;
if (remaining > 0) {
badge.textContent = String(remaining);
badge.style.fontSize = '18px';
} else {
badge.innerHTML = svgIcon('clipboard', 22);
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
badge.innerHTML = svgIcon('clipboard', 22);
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
badge.innerHTML = svgIcon('clipboard', 22);
badge.title = 'Extract leads (SLA queue or Pending Customers)';
badge.onclick = runExtraction;
attachBadgeHoverEffects();

navItem.appendChild(badge);
targetUl.appendChild(navItem); // last item in the left nav = immediately after "Client Config"
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
window._slaResetBookmarklet = resetBookmarklet;
// Patches the existing panel box's position/size directly instead of
// tearing it down and rebuilding it through displayPanel/
// displayPendingPanel - a full rebuild re-derives everything (including
// the minimized-state transform) from scratch, and this is purely a
// dimension change that has no reason to touch any of that. Sets every
// relevant property for both states explicitly (clearing the ones the
// other state doesn't use, e.g. `top`) rather than only setting what
// changes, since compact and full use different property sets to
// position the box.
window._togglePanelSize = function() {
const panel = document.getElementById(PANEL_BOX_ID);
const btn = document.getElementById('_slaSizeBtn');
if (!panel) return;
const current = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
const next = current === 'full' ? 'compact' : 'full';
localStorage.setItem(PANEL_SIZE_KEY, next);
const isFull = next === 'full';
Object.assign(panel.style, {
top: isFull ? '0' : '',
bottom: isFull ? '0' : '20px',
right: isFull ? '0' : '20px',
width: isFull ? '450px' : '400px',
height: isFull ? '100vh' : 'min(560px, calc(100vh - 90px))',
borderRadius: isFull ? '0' : '16px'
});
if (btn) {
btn.innerHTML = svgIcon(isFull ? 'shrink' : 'expand', 14);
btn.title = isFull ? 'Shrink to box' : 'Expand to full height';
}
};

window._toggleMinimizePanel = function() {
const panel = document.getElementById(PANEL_BOX_ID);
const btn = document.getElementById('_slaMinimizeBtn');
if (!panel) return;
const isHidden = panel.style.transform === 'translateX(150%)';
panel.style.transform = isHidden ? '' : 'translateX(150%)';
if (btn) btn.innerHTML = svgIcon(isHidden ? 'minimize' : 'restore', 14);
localStorage.setItem(PANEL_STATE_KEY, isHidden ? 'visible' : 'hidden');
};
window._toggleTier = function(tierId) {
const tierContent = document.getElementById(tierId);
const toggle = document.getElementById('toggle-' + tierId);
if (tierContent && toggle) {
const isHidden = tierContent.style.display === 'none';
tierContent.style.display = isHidden ? 'grid' : 'none';
toggle.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
setSectionCollapsed(tierId, !isHidden);
}
};

window._toggleCallbackType = function(sectionId) {
const content = document.getElementById(sectionId);
const toggle = document.getElementById('toggle-' + sectionId);
if (content && toggle) {
const isHidden = content.style.display === 'none';
content.style.display = isHidden ? 'grid' : 'none';
toggle.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
setSectionCollapsed(sectionId, !isHidden);
}
};

window._toggleAssignSection = function() {
const body = document.getElementById('assignSectionBody');
const toggle = document.getElementById('assignSectionToggle');
if (!body || !toggle) return;
const isHidden = body.style.display === 'none';
body.style.display = isHidden ? 'block' : 'none';
toggle.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
saveAssignSettings({ sectionOpen: isHidden });
if (isHidden) syncAllWheelPositions();
};

window._toggleAdvancedCallbackTypes = function(forceOpen) {
const body = document.getElementById('advancedCallbackTypes');
const toggle = document.getElementById('advancedCallbackToggle');
if (!body || !toggle) return;
const isCurrentlyOpen = body.style.display === 'flex';
const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !isCurrentlyOpen;
body.style.display = shouldOpen ? 'flex' : 'none';
toggle.style.transform = shouldOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
saveAssignSettings({ advancedOpen: shouldOpen });
};

// Recomputes and displays what clicking "Assign" would actually do before
// the button is even clicked, so a filter combination that matches
// nothing, an unexpectedly large batch, or (previously) a forgotten agent
// selection is visible immediately rather than found out via an empty/
// surprising results log - or worse, via the button's own "Select at
// least one agent" rejection after the preview had already implied
// everything was ready. Agent count now factors directly into what's
// shown, both for that reason and because seeing the actual per-agent
// split ("23 -> 4 agents, ~6 each") is the real pre-click control this is
// meant to give: not just "will something happen" but "is this a
// reasonable way to divide it up."
// Shared by every quick-criteria entry point (the general Quick Assign
// button and each clickable due-summary tile): expand the section if
// it's collapsed so progress is visible, then resolve which agents are
// actually checked - agent selection is real state the user is
// deliberately curating and always gets respected, no matter which
// fixed lead-criteria shortcut triggered the run. Returns null (and
// leaves a message in the log) if nothing's selected.
function beginQuickAssign() {
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
return null;
}
return agents;
}

// A fixed, opinionated "clear what's urgent right now" sweep for the LEAD
// side of the equation - deliberately ignores whatever tiers/callback-types
// happen to be checked (that's what the manual button is for). Pending
// Customers: New + Auto Rescheduled leads due by the top of the next hour.
// SLA: every tier due within the next hour.
window._quickAssign = async function() {
if (assigning) {
cancelRequested = true;
return;
}
const agents = beginQuickAssign();
if (!agents) return;
if (currentPageType === PAGE_PENDING) {
const leads = collectPendingCustomers();
const eligible = filterPendingLeads(leads, { callbackTypes: new Set(CALLBACK_TYPES_PRIMARY), cutoffDate: defaultHourCutoff() });
const prioritized = prioritizePendingLeads(eligible);
const limited = applyAssignLimit(prioritized);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locatePendingAssignCell);
} else {
const leads = collectAssignableLeads();
const eligible = filterAssignableLeads(leads, { tiers: new Set([1, 2, 3, 4]), windowMinutes: 60, customerFirstOnly: false, emailOnly: false });
const prioritized = prioritizeLeads(eligible);
const limited = applyAssignLimit(prioritized);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locateAssignCell);
}
};

// Each due-summary tile (Missed/15m/30m/1h, and the Customer First row)
// is itself a quick-assign shortcut - clicking one runs assignment using
// exactly that tile's criteria, so the number you clicked is the number
// that gets touched. Deliberately uses every tier (never just whatever
// tiers happen to be checked), matching the tile's own count, which is
// computed the same way in renderSlaDueSummary.
window._quickAssignSlaTile = async function(windowMinutes, customerFirstOnly, missedOnly) {
if (assigning) {
cancelRequested = true;
return;
}
const agents = beginQuickAssign();
if (!agents) return;
const leads = collectAssignableLeads();
const eligible = filterAssignableLeads(leads, {
tiers: new Set([1, 2, 3, 4]),
windowMinutes: windowMinutes != null ? windowMinutes : null,
customerFirstOnly: !!customerFirstOnly,
emailOnly: false,
missedOnly: !!missedOnly
});
const prioritized = prioritizeLeads(eligible);
const limited = applyAssignLimit(prioritized);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locateAssignCell);
};

// Mirrors _quickAssignSlaTile for the Pending Customers due-summary tiles
// (This hour / Next hour). Uses every callback type - not just New/Auto
// Rescheduled - since that's what the tile itself counts (see
// renderPendingDueSummary), so the assigned total matches what was
// clicked. hoursAhead 0 = "this hour" (top of next hour), 1 = "next
// hour" (top of the hour after that).
window._quickAssignPendingTile = async function(hoursAhead) {
if (assigning) {
cancelRequested = true;
return;
}
const agents = beginQuickAssign();
if (!agents) return;
const cutoffDate = new Date(defaultHourCutoff().getTime() + hoursAhead * 60 * 60000);
const leads = collectPendingCustomers();
const eligible = filterPendingLeads(leads, { callbackTypes: new Set(CALLBACK_TYPE_ORDER), cutoffDate });
const prioritized = prioritizePendingLeads(eligible);
const limited = applyAssignLimit(prioritized);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locatePendingAssignCell);
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

// Stays enabled (not disabled) during the run and changes color/label
// instead - clicking it again while a run is active is how you cancel,
// via the cancelRequested check each run-starting handler makes at its
// own top. That reuses the exact same onclick wiring already on this
// button rather than needing to swap handlers, and means "click to
// cancel" holds true regardless of whether this run was started by the
// manual button or Quick Assign.
button.disabled = false;
button.style.background = '#d97706';
button.style.cursor = 'pointer';
button.textContent = `Assigning 0/${plan.length}... (click to cancel)`;
log.innerHTML = '';
const summaryEl = document.getElementById('assignResultsSummary');
if (summaryEl) summaryEl.innerHTML = '';

cancelRequested = false;
assigning = true;
let results;
try {
results = await runAssignmentPlan(plan, locateCellFn, (soFar) => {
button.textContent = `Assigning ${soFar.length}/${plan.length}... (click to cancel)`;
log.innerHTML = soFar.map(r =>
`<div style="color: ${r.ok ? '#059669' : '#dc2626'};">${r.ok ? '✓' : '✗'} ${escapeHtml(r.lead.name)} → ${escapeHtml(r.agent.name)}${r.reason ? ' (' + escapeHtml(r.reason) + ')' : ''}</div>`
).join('');
log.scrollTop = log.scrollHeight;
});
} finally {
assigning = false;
cancelRequested = false;
}

const succeeded = results.filter(r => r.ok).length;
button.disabled = false;
button.style.background = '#059669';
button.style.cursor = 'pointer';
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
if (assigning) {
cancelRequested = true;
return;
}
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

const limited = applyAssignLimit(prioritized);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locateAssignCell);
};

window._runPendingAssignment = async function() {
if (assigning) {
cancelRequested = true;
return;
}
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

const limited = applyAssignLimit(prioritized);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locatePendingAssignCell);
};


// Assigns exactly one specific lead to exactly one chosen agent, for the
// case of handling a particular customer right now rather than waiting
// for it to come up in a batch/tile/Quick Assign sweep. Reuses
// runAssignmentPlan (same click/confirm engine, same result shape) with
// a one-item plan, but deliberately never goes through roundRobinAssign
// - a manual pick is an intentional override, not part of the fairness
// rotation, so it shouldn't perturb the round-robin cursor. Sets
// `assigning` for its duration same as a batch run, so the background
// auto-detect poll doesn't collide with it mid-confirmation (the same
// class of bug fixed for batch runs) - the tradeoff is that clicking the
// batch button during the ~1s this usually takes would itself be
// (mis)read as a cancel request, since that's also gated on `assigning`;
// accepted as a rare, low-cost collision (a harmless no-op click) against
// a real, more consequential collision it prevents.
window._manualAssignLead = async function(pageType, leadKey, agentId, selectEl) {
if (!agentId || !selectEl) return;
const agent = getAgentRoster().find(a => a.id === agentId);
const wrapper = selectEl.parentElement;
if (!agent || !wrapper) return;

if (assigning) {
selectEl.value = '';
return;
}

wrapper.innerHTML = `<span style="font-size: 11px; color: #94a3b8;">Assigning…</span>`;

const locateCellFn = pageType === PAGE_PENDING ? locatePendingAssignCell : locateAssignCell;
const leads = pageType === PAGE_PENDING ? collectPendingCustomers() : collectAssignableLeads();
const lead = leads.find(l => l.key === leadKey);

if (!lead || lead.assigned) {
wrapper.innerHTML = `<span style="font-size: 11px; color: #dc2626;">Already assigned or no longer listed</span>`;
return;
}

assigning = true;
let results;
try {
results = await runAssignmentPlan([{ lead, agent }], locateCellFn, () => {});
} finally {
assigning = false;
}

invalidateLeadsCache();
appendAssignmentLog(results);

const result = results[0];
if (result.ok) {
wrapper.innerHTML = renderAssignmentBadge(true, agent.name);
} else {
wrapper.innerHTML = `<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
<span style="font-size: 11px; color: #dc2626;">${escapeHtml(result.reason || 'Failed')}</span>
${renderManualAssignPicker(leadKey, pageType)}
</div>`;
}
};

// Filters the visible customer cards by name and auto-expands whichever
// sections contain a match, without touching the persisted collapse
// state (setSectionCollapsed) - this is a temporary view, and clearing
// the search reverts every section to exactly whatever you'd manually
// left it as, not to "open."
window._filterCustomerSearch = function(query) {
const q = query.trim().toLowerCase();
document.querySelectorAll('.customer-card').forEach((card) => {
const match = !q || (card.dataset.customerName || '').includes(q);
card.style.display = match ? '' : 'none';
});
document.querySelectorAll('.collapsible-section').forEach((section) => {
const toggle = document.getElementById('toggle-' + section.id);
if (!q) {
const collapsed = isSectionCollapsed(section.id);
section.style.display = collapsed ? 'none' : 'grid';
if (toggle) toggle.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
return;
}
const hasMatch = Array.from(section.querySelectorAll('.customer-card')).some(c => c.style.display !== 'none');
section.style.display = hasMatch ? 'grid' : 'none';
if (toggle) toggle.style.transform = hasMatch ? 'rotate(0deg)' : 'rotate(-90deg)';
});
};

window._setAllAgentCheckboxes = function(checked) {
document.querySelectorAll('.assign-agent-checkbox').forEach((el) => { el.checked = checked; });
if (window._updateAssignPreview) window._updateAssignPreview();
};

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

// Per-type counts next to each checkbox are baked in at render time -
// keep them in sync with the cutoff wheel as it moves, same as the
// preview line below.
const callbackCounts = computePendingCallbackCounts(leads, cutoffDate);
CALLBACK_TYPE_ORDER.forEach((type) => {
const el = document.getElementById(`cb-count-${slugify(type)}`);
if (el) el.textContent = `(${callbackCounts[type] || 0})`;
});
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

// Same live-sync as the callback-type counts above, for the tier counts.
const tierCounts = computeSlaTierCounts(leads, windowMinutes);
[1, 2, 3, 4].forEach((t) => {
const el = document.getElementById(`tier-count-${t}`);
if (el) el.textContent = `(${tierCounts[t - 1]})`;
});
}

const agentCount = document.querySelectorAll('.assign-agent-checkbox:checked').length;
const rawCount = count;
const limitRaw = document.getElementById('assignLimitInput')?.value;
const limit = limitRaw ? Number(limitRaw) : null;
if (limit && limit > 0) count = Math.min(count, limit);
const cappedSuffix = count < rawCount ? ` (capped from ${rawCount})` : '';

if (agentCount === 0) {
previewEl.textContent = count > 0
? `${count} lead${count === 1 ? '' : 's'} match${cappedSuffix}, but no agents are selected`
: 'Select at least one agent';
previewEl.style.color = '#dc2626';
return;
}

if (count === 0) {
previewEl.textContent = 'No leads match the current filters';
previewEl.style.color = '#dc2626';
return;
}

const perAgent = Math.floor(count / agentCount);
const remainder = count % agentCount;
const splitLabel = remainder === 0 ? `${perAgent} each` : `~${perAgent} each`;
previewEl.textContent = `${count} lead${count === 1 ? '' : 's'}${cappedSuffix} → ${agentCount} agent${agentCount === 1 ? '' : 's'} (${splitLabel})`;
previewEl.style.color = '#64748b';
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
