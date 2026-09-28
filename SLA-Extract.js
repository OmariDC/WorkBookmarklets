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
chevron: '<polyline points="6 9 12 15 18 9"/>',
checklist: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
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
let lastFailedPageType = null;
let currentPageType = null;
let currentCustomers = [];
let currentPendingCustomers = [];
// 'normal' (SLA/Pending assign view) or 'morningChecks' (the separate
// page below) - entering/leaving is only ever explicit (the header
// toggle), never something the background poll decides on its own.
let currentPanelMode = 'normal';
let runningMorningChecks = false;
// True for the whole window._refreshLeadsAndPanel() flow, not just its
// final runExtraction() call - clicking the native refresh icon and
// waiting for it to finish can take several seconds with no hash
// change and no recognized-page-type change either, so nothing else
// naturally excludes the background auto-detect poll from firing its
// own independent runExtraction() mid-wait (unlike a real navigation,
// which self-excludes the poll since detectPageType() goes null while
// on an unrecognized route). Without this, swapping pages while a
// refresh was still waiting on the icon let two overlapping scans run
// against two different pages at once - the reported "SLA rescans
// everything" / "Pending briefly shows no leads then corrects itself".
let refreshingLeads = false;
// Populated by window._runAllMorningChecks as each check completes -
// {key, label, status: 'pending'|'running'|'done', ok, summary, details}.
// Drives renderMorningChecksBody(); empty means "hasn't been run yet".
// Restored from today's persisted run (if any) rather than always
// starting empty - per instruction, results should persist across a
// bookmarklet re-invocation/page reload until explicitly cleared or a
// fresh run overwrites them, not silently reset just because the
// panel/page was closed and reopened. loadMorningChecksLastRun is
// defined further down but hoisted, and already scopes to today only.
let morningChecksResults = (function() {
const lastRun = loadMorningChecksLastRun();
return (lastRun && Array.isArray(lastRun.results)) ? lastRun.results : [];
})();
const MORNING_CHECKS_ORDER = [
{ key: 'emailOnly', label: 'Email Only Count' },
{ key: 'sla', label: 'SLA Count' },
{ key: 'inProgress', label: 'In Progress' },
{ key: 'leadType', label: 'Lead Type Check' },
{ key: 'routedTo', label: 'All Leads Are Routed To' },
{ key: 'voicemail', label: 'Voicemail' },
];
const PAGE_FLASH_OVERLAY_ID = '_slaPageFlashOverlay';

// Checked against the campaign's primary segment (before any
// parenthetical) rather than the raw full string - confirmed real
// collision: Customer First's "Citroen - Enquiry - New (Test drive
// request)" contains "test drive request" only inside a parenthetical
// marketing-form label; the campaign itself is "Enquiry - New", not a
// dedicated Test Drive Request campaign like "Peugeot - Test Drive
// Request - New (...)" where "test drive request" IS the campaign
// category. Same fix as Konnect-Booking-Check.js's own
// isTestDriveRequestCampaign/isInScope, ported back here for
// consistency - this file's categorizeTier is what that one's own copy
// was ported FROM, so both need to agree, not just the copy.
function campaignPrimaryPart(campaign) {
const c = String(campaign || '').trim();
const parenIndex = c.indexOf('(');
return (parenIndex === -1 ? c : c.slice(0, parenIndex)).toLowerCase();
}

function categorizeTier(campaign, source) {
const camp = campaign.toLowerCase();
const src = source.toLowerCase();
const campPrimary = campaignPrimaryPart(campaign);

if (campPrimary.includes('test drive request') && campPrimary.includes('new'))
return { tier: 1, reason: 'Test Drive Request - New' };
if (campPrimary.includes('test drive request') && campPrimary.includes('used'))
return { tier: 1, reason: 'Test Drive Request - Used' };
// Excludes Register Interest - confirmed real collision: "Citroen -
// Register Interest (Electric Vehicles Register Your Interest)"
// contains "electric" but is a research/interest-capture campaign
// (Tier 4), not a "Brand - Electric" one. Same fix as
// Konnect-Booking-Check.js's own isElectricCampaign.
if (camp.includes('electric') && !camp.includes('register interest'))
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

// This file had no self-test coverage at all before now, unlike
// Konnect-Booking-Check.js's own copy of this same function - added
// here specifically to catch the two collisions just fixed above (and
// guard against them regressing back in), using real verbatim campaign
// strings rather than synthetic ones.
(function categorizeTierSelfTest() {
const cases = [
{ name: 'Real: Customer First Enquiry-New (Test drive request) stays Tier 2, not Tier 1', campaign: 'Citroen - Enquiry - New (Test drive request)', source: 'Customer First', expectTier: 2 },
{ name: 'Real: dedicated Test Drive Request campaign is Tier 1', campaign: 'Peugeot - Test Drive Request - New (pcr_new_test_drive)', source: 'Robins & Day Website', expectTier: 1 },
{ name: 'Real: Register Interest campaign containing "Electric" is not Tier 1 Electric', campaign: 'Citroen - Register Interest (Electric Vehicles Register Your Interest)', source: 'Robins & Day Website', expectTier: 4 },
{ name: 'A genuine Brand - Electric campaign is still Tier 1', campaign: 'Citroen - Electric', source: 'Website', expectTier: 1 },
{ name: 'Reserve - Used is Tier 1', campaign: 'Citroen - Reserve - Used', source: 'Robins & Day Website', expectTier: 1 },
{ name: 'Motability is Tier 2', campaign: 'Motability', source: 'Motability', expectTier: 2 },
{ name: 'Offer Request - New is Tier 3', campaign: 'Citroen - Offer Request - New (Quote request)', source: 'Customer First', expectTier: 3 }
];
const failures = [];
cases.forEach((c) => {
const result = categorizeTier(c.campaign, c.source);
if (result.tier !== c.expectTier) {
failures.push(`${c.name}: expected tier ${c.expectTier}, got tier ${result.tier} (${result.reason})`);
}
});
if (failures.length > 0) {
console.error('SLA Extract categorizeTier self-test FAILED:\n' + failures.join('\n'));
} else {
console.info(`SLA Extract categorizeTier self-test passed (${cases.length}/${cases.length})`);
}
})();

// Display-only urgency ordering/labeling for the SLA tier cards -
// distinct from computeSortKey further down (used for ROUND-ROBIN
// ASSIGNMENT ordering), which deliberately pushes Missed leads slightly
// behind ones still due imminently so a fair-share sweep doesn't always
// hand every agent's next lead to whoever's already overdue. That
// fairness concern doesn't apply to what a human should see FIRST while
// visually triaging the list - here, more overdue always means show it
// first, no penalty.
function computeDisplaySortKey(customer) {
if (!customer.slaDate) return Infinity;
return customer.slaDate.getTime() - Date.now();
}

function sortByUrgency(customers) {
return [...customers].sort((a, b) => computeDisplaySortKey(a) - computeDisplaySortKey(b));
}

// Status text is only confirmed to say "Missed" once a lead's SLA date
// has passed, but msUntil <= 0 is checked too in case the status column
// hasn't caught up yet - a lead already past its due time is urgent
// regardless of what the Status cell currently says. emphasize marks
// the bucket the user asked to "stand out even further" - Missed and
// due-within-15-minutes both get it, since both mean "needs attention
// right now", not just "coming up soon".
function slaUrgencyInfo(customer) {
if (!customer.slaDate) return { label: null, color: null, emphasize: false };
const minsUntil = Math.round((customer.slaDate.getTime() - Date.now()) / 60000);
if (customer.status === 'Missed' || minsUntil <= 0) {
return { label: `MISSED ${Math.abs(minsUntil)}m ago`, color: '#dc2626', emphasize: true };
}
if (minsUntil <= 15) return { label: `Due in ${minsUntil}m`, color: '#dc2626', emphasize: true };
if (minsUntil <= 30) return { label: `Due in ${minsUntil}m`, color: '#d97706', emphasize: false };
if (minsUntil <= 60) return { label: `Due in ${minsUntil}m`, color: '#ca8a04', emphasize: false };
const hrs = Math.floor(minsUntil / 60);
const mins = minsUntil % 60;
return { label: `Due in ${hrs}h ${mins}m`, color: '#64748b', emphasize: false };
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

// Generic version of the waitForModal pattern above - waits for any
// selector to exist rather than specifically the customer-detail modal,
// for navigating to a different Konnect page/route (Queue by Agent)
// where content renders in asynchronously after the hash change.
function waitForElement(selector, timeout = 5000) {
return new Promise((resolve) => {
const existing = document.querySelector(selector);
if (existing) {
resolve(existing);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(null);
}, timeout);
const observer = new MutationObserver(() => {
const el = document.querySelector(selector);
if (el) {
clearTimeout(timer);
observer.disconnect();
resolve(el);
}
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

// detectPageType() reads the table's header row, which renders before
// ng-repeat has actually populated any data rows for the page just
// switched to - the background auto-detect poll calls extractAndExportSla/
// Pending the instant it notices the header match, which could mean
// reading a still-loading table as "0 leads" and reporting an empty
// queue that a moment later turns out to have plenty, needing a manual
// refresh to fix (confirmed live, swapping Pending -> SLA). A smaller,
// one-shot version of what waitForInboundRowsSettled solved for the
// Inbound API page - there's no evidence this table loads progressively
// in chunks the way that one does, just a short delay before it renders
// in one batch, so this only needs to wait for the FIRST row rather than
// watch for growth to stop. Resolves instantly if rows already exist
// (the common case costs nothing), or after timeout with none found -
// callers still treat that as a genuinely empty queue rather than
// erroring, since an actually-empty SLA/Pending queue is a normal state.
function waitForLeadsTableRows(table, timeout = 8000) {
return new Promise((resolve) => {
const hasRows = () => table.querySelectorAll('tbody tr').length > 0;
if (hasRows()) {
resolve(true);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(false);
}, timeout);
const observer = new MutationObserver(() => {
if (hasRows()) {
clearTimeout(timer);
observer.disconnect();
resolve(true);
}
});
observer.observe(table, { childList: true, subtree: true });
});
}

// Stricter settle-based variant, used only by waitForLeadsTableReady
// (the four queue-check re-render call sites), not a replacement for
// waitForLeadsTableRows everywhere - that one's "resolve on the very
// first row" behaviour is proven fine for the main extraction flow
// (extractAndExportSla/Pending, a same-page native-icon refresh), which
// has never been reported as racy, and adding a settle window there too
// would cost every already-fast, all-cached extraction a fixed chunk of
// pure added latency for no benefit. The queue-check paths are the ones
// actually reported live as still intermittently reading a partial/
// empty table even with waitForLeadsTableRows in place - those involve
// a full route change (navigating to Queue by Agent and back), not the
// same-page refresh this function's sibling was built and confirmed
// against, so its "loads in one batch, not progressively" assumption
// (see its own comment) may simply not hold for a route change. Same
// "wait for the DOM to actually go quiet" signal already confirmed live
// for the Inbound API page's own progressive loading (see
// waitForInboundRowsSettled) - the row count must stay unchanged for a
// full quiet window before this trusts it, not just become non-zero
// once. quietMs is a reasonable-guess default, not a confirmed-live
// value the way waitForInboundRowsSettled's 1500ms is - this table is a
// much smaller, one-shot dataset than Inbound's continuously-arriving
// feed, so a shorter window was chosen, but only a live re-test can
// confirm it's actually long enough.
function waitForLeadsTableRowsSettled(table, timeout = 8000, quietMs = 400) {
return new Promise((resolve) => {
let settleTimer = null;
let hardTimer = null;

function finish() {
clearTimeout(settleTimer);
clearTimeout(hardTimer);
observer.disconnect();
resolve(table.querySelectorAll('tbody tr').length > 0);
}

function armSettleTimer() {
clearTimeout(settleTimer);
settleTimer = setTimeout(finish, quietMs);
}

const observer = new MutationObserver(armSettleTimer);
observer.observe(table, { childList: true, subtree: true });

// Armed immediately too, in case rows already existed and settled
// before this even started watching (no further mutations coming).
armSettleTimer();
hardTimer = setTimeout(finish, timeout);
});
}

// Shared by every flow that navigates away (Queue by Agent) and back
// before re-rendering the SLA/Pending panel - handleBadgeClick, the
// post-successful-assign auto re-scan, window._checkAgentQueuePositions,
// and window._clearWholeQueue all do this same navigate-away-and-back
// before calling displayPanel/displayPendingPanel. The hash changing
// back is just the route changing, not Angular having actually
// repopulated the table's rows yet (same gap this file already guards
// against for the auto-detect poll, via waitForLeadsTableRows itself).
// renderAssignSection (behind every one of those render calls) reads
// document.querySelector('table') synchronously via
// collectAssignableLeads - skipping this wait showed correct data
// briefly, then "0 leads due"/"No leads match the current filters"
// until an unrelated manual refresh fixed it.
async function waitForLeadsTableReady() {
const table = await waitForElement('table');
// A much tighter hard cap than waitForLeadsTableRowsSettled's own
// 8000ms default - this call site is a secondary refresh (the leads
// data itself is already correct from the extraction that just ran;
// this is only trying to avoid reading the table in the split-second
// it's empty right after navigating back from Queue by Agent), not a
// primary data load worth waiting a long time for. If this page's
// table rows get torn down and rebuilt on every Angular digest cycle
// rather than only when data genuinely changes, the settle timer would
// keep getting reset indefinitely and this would silently eat the
// full hard cap every single time - reported live as "not loading up
// the UI" after the queue check, which a long cap makes look identical
// to a real hang even though it would eventually resolve. 2.5s is
// enough to ride out the ordinary post-navigation gap without making a
// worse-case run feel stuck.
if (table) await waitForLeadsTableRowsSettled(table, 2500);
}

// Shared by anything that causes a real Konnect page navigation/re-
// render mid-flow (Morning Checks, Clear Queue, ingesting freshly-seen
// SLA leads) - masks the underlying page's own flashing/repopulating
// so it doesn't read as the screen glitching, without slowing down
// whatever's actually running underneath it (purely cosmetic).
//
// Opening/closing each new lead's detail modal during SLA ingestion
// toggles whether the underlying page itself has a scrollbar (the
// modal sets its own overflow while open) - a fixed, inset:0 overlay
// still tracks the viewport's actual available width, which most
// browsers shrink/grow by the scrollbar's own width as it appears and
// disappears, so the overlay was visibly jumping left-right in step
// with every single modal open/close - the exact same "looks like a
// glitch" complaint this overlay exists to prevent, just moved onto
// the overlay itself. Locking documentElement's overflow to hidden for
// the overlay's whole duration freezes the scrollbar in one state
// (fine either way, since the page underneath is fully obscured
// anyway) so nothing behind it can make it move.
let pageFlashOverlayPrevOverflow = null;

function showPageFlashOverlay(message) {
const existing = document.getElementById(PAGE_FLASH_OVERLAY_ID);
if (existing) {
const label = existing.querySelector('[data-overlay-label]');
if (label) label.textContent = message;
return;
}
if (!document.getElementById('_slaSpinKeyframes')) {
const style = document.createElement('style');
style.id = '_slaSpinKeyframes';
style.textContent = '@keyframes _slaSpin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);
}
const overlay = document.createElement('div');
overlay.id = PAGE_FLASH_OVERLAY_ID;
overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(15,23,42,0.94); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: white; font-size: 14px; font-weight: 600;';
overlay.innerHTML = `
<div style="width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.25); border-top-color: white; border-radius: 50%; animation: _slaSpin 0.8s linear infinite;"></div>
<div data-overlay-label>${message}</div>
`;
pageFlashOverlayPrevOverflow = document.documentElement.style.overflow;
document.documentElement.style.overflow = 'hidden';
document.documentElement.appendChild(overlay);
}

function hidePageFlashOverlay() {
document.getElementById(PAGE_FLASH_OVERLAY_ID)?.remove();
document.documentElement.style.overflow = pageFlashOverlayPrevOverflow || '';
pageFlashOverlayPrevOverflow = null;
}

// Confirmed live on the SLA queue page: <i class="fa fa-refresh"
// ng-class="{ 'fa-spin' : loading }" ng-click="getData()" title="Refresh">.
// No id/aria-label to key off instead - the ng-click name plus its class
// together are specific enough not to collide with anything else on the
// page. Clicking it adds fa-spin immediately and Angular's own
// $scope.loading clears it again once the refetch actually finishes
// (observed ~1.1s in testing, but that's real network time, not assumed
// to be a fixed delay) - waiting for the class to toggle both ways is
// what confirms the refetch genuinely started and genuinely finished,
// rather than guessing a duration.
function findNativeLeadsRefreshIcon() {
return document.querySelector('i.fa-refresh[ng-click="getData()"]');
}

function waitForRefreshIconSpinState(icon, spinning, timeout) {
return new Promise((resolve) => {
if (icon.classList.contains('fa-spin') === spinning) {
resolve(true);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(false);
}, timeout);
const observer = new MutationObserver(() => {
if (icon.classList.contains('fa-spin') === spinning) {
clearTimeout(timer);
observer.disconnect();
resolve(true);
}
});
observer.observe(icon, { attributes: true, attributeFilter: ['class'] });
});
}

// Triggered by clicking the panel's own title (see renderPanelShell's
// onTitleClick) - lets the underlying leads list get refreshed, and this
// panel resynced with it, without ever needing to reach Konnect's own
// refresh icon by hand, which a full-screen panel covers entirely and a
// compact one usually gets in the way of too. Clicks the native icon
// first if this page happens to have one (falls through to a plain
// re-scan otherwise, rather than failing - the panel refresh is the part
// that actually matters), waits for its spin state to confirm the
// refetch genuinely ran, then runs this panel's normal full re-scan so
// newly-arrived leads get properly ingested (tiered, detail-scraped),
// not just a stale re-render of what was already cached.
window._refreshLeadsAndPanel = async function() {
if (extracting || assigning || runningMorningChecks || refreshingLeads) return;
refreshingLeads = true;
showPageFlashOverlay('Refreshing leads…');
try {
const icon = findNativeLeadsRefreshIcon();
if (icon) {
icon.click();
await waitForRefreshIconSpinState(icon, true, 2000);
await waitForRefreshIconSpinState(icon, false, 15000);
}
await runExtraction();
} finally {
refreshingLeads = false;
hidePageFlashOverlay();
}
};

// The Customer Hub / Service Booking module selector on the Queue by
// Agent page isn't a URL-based route - it's Angular scope state, and
// neither option carries a distinguishing class when selected (both
// <li> elements are class="ng-scope" either way). The only way to tell
// which is active is reading the selector's own trigger text, and the
// only way to change it is opening the dropdown and clicking the
// matching <li> by its text content, then waiting for the trigger text
// to actually update before trusting the switch took effect - a stale
// module selection here would mean Clear Queues clears the wrong scope
// entirely.
async function ensureCustomerHubModule() {
// Re-queries the trigger fresh every time rather than trusting one
// captured reference across the whole switch - confirmed live starting
// from Service Booking, but reported live to time out starting from
// "Service" specifically. The likely difference: switching away from
// that module regenerates this whole element (Angular tearing down and
// recreating it) rather than just mutating its label text in place,
// which is what every previously-tested starting module did. A stale
// captured `trigger` would silently watch a node that's no longer part
// of the live document, so its own MutationObserver would never fire
// and the label would never appear to change, even though the switch
// genuinely succeeded on the page - a timeout that looks identical to a
// real failure. Reading document.querySelector fresh on every check
// avoids depending on that one reference surviving.
const readLabel = () => document.querySelector('div[title="Filter by Module"] span.ng-binding')?.textContent?.trim() || null;
if (readLabel() === 'Customer Hub') return true;

const trigger = document.querySelector('div[title="Filter by Module"]');
if (!trigger) return false;
trigger.click();

const menuItem = await waitForElement('li[ng-click="moduleSelected(module)"]');
if (!menuItem) return false;

const items = Array.from(document.querySelectorAll('li[ng-click="moduleSelected(module)"]'));
const target = items.find(li => li.textContent.includes('Customer Hub'));
if (!target) {
console.warn('[SLA Extract] Customer Hub option not found in the module dropdown - items seen:', items.map(li => li.textContent.trim()));
return false;
}
target.click();

if (readLabel() === 'Customer Hub') return true;

return new Promise((resolve) => {
const timer = setTimeout(() => {
observer.disconnect();
console.warn('[SLA Extract] Timed out waiting for module switch to Customer Hub - trigger now reads:', readLabel());
resolve(false);
}, 3000);
// Observes document.body, not the trigger element captured above (see
// comment at the top of this function) - same broad-observe pattern
// waitForElement already uses elsewhere in this file, for the same
// reason: the element being watched for a change can be replaced
// outright, not just mutated.
const observer = new MutationObserver(() => {
if (readLabel() === 'Customer Hub') {
clearTimeout(timer);
observer.disconnect();
resolve(true);
}
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
});
}

// Bulk-unassigns every currently-assigned lead in the queue back to
// unassigned, via Konnect's own "Clear Queues" admin action - reached
// through the Queue by Agent page rather than anything this bookmarklet
// normally touches. No confirm prompt - deliberately removed at the
// user's request since this button isn't reachable by accident.
// Konnect itself shows no confirmation before firing this either (only
// a "Queues Cleared" message after the fact), and there's no undo on
// either side once it runs. Navigates the actual visible tab there and
// back (Konnect is a single-page app sharing this same tab, not
// something reachable in a hidden background context) so expect a
// brief visible page flash.
window._clearWholeQueue = async function() {
const originalHash = window.location.hash;
// Captured before navigating away, since Clear Queue is offered from
// both the SLA and Pending Customers summaries - detectPageType()
// would otherwise be reading Queue by Agent's own (unrecognized) page
// by the time this matters.
const originatingPageType = detectPageType();
showPageFlashOverlay('Clearing the queue…');
let cleared = false;
try {
window.location.hash = '#/Queue/QueueByAgent';
const clearBtn = await waitForElement('button[ng-click="ClearQueues()"]');
if (!clearBtn) {
alert('Could not find the Clear Queues button after navigating - aborted, nothing was cleared.');
return;
}
const moduleOk = await ensureCustomerHubModule();
if (!moduleOk) {
alert('Could not confirm the Customer Hub module is selected - aborted for safety, nothing was cleared.');
return;
}
clearBtn.click();
await sleep(800);
// Clear Queues only unassigns every currently-assigned lead - it
// doesn't touch any lead's underlying details (name/phone/email/
// campaign/etc), so the fix for the panel showing stale "assigned"
// state is updating that one field on the already-cached leads, not
// re-running the full ingestion pipeline (runExtraction ->
// extractAndExportSla/extractAndExportPending). That would re-open
// every lead's detail modal again for no reason, since nothing about
// them actually changed besides assignment - confirmed live as an
// unwanted full re-ingestion, not the cheap refresh this needs.
clearAgentQueueSnapshot();
cleared = true;
} finally {
window.location.hash = originalHash;
}

// Rendering used to happen inside the try block above, before this hash
// restore ran - collectAssignableLeads (behind renderAssignSection,
// itself behind displayPanel/displayPendingPanel) reads
// document.querySelector('table') directly, so it was reading whatever
// table belonged to the Queue by Agent page (or none at all), not the
// SLA/Pending one. And the hash changing back here is itself just the
// route changing, not Angular having actually repopulated the SLA/
// Pending table yet - same gap waitForLeadsTableRows exists for
// elsewhere in this file - so a wait for real rows is needed here too,
// not just moving the render after the hash restore.
try {
if (cleared) {
try {
await waitForLeadsTableReady();
} catch (error) {
console.warn('[SLA Extract] Wait for table after clearing the queue failed - showing the panel anyway:', error);
}
try {
if (originatingPageType === PAGE_PENDING) {
currentPendingCustomers = currentPendingCustomers.map((c) => ({ ...c, assigned: false, agentName: null }));
displayPendingPanel(currentPendingCustomers, 0, 0, false);
} else {
currentCustomers = currentCustomers.map((c) => ({ ...c, assigned: false, agentName: null }));
displayPanel(currentCustomers, 0, 0, false);
}
} catch (error) {
console.error('[SLA Extract] Panel failed to render after clearing the queue:', error);
alert('SLA Manager: the queue was cleared, but the panel failed to reload.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
}
}
} finally {
// Always runs now, even if the render itself threw - previously this
// sat after an un-guarded await, so any failure in that wait left the
// "Clearing the queue…" overlay stuck on screen forever, on top of
// the panel never appearing.
hidePageFlashOverlay();
}
};

// ===================================================================
// AGENT QUEUE POSITIONS - confirmed live on the same Queue by Agent
// page Clear Queue already navigates to. Each agent has their own
// repeated panel (li[ng-repeat="agent in fullqueue | filter:
// filterMessages"] > objectqueuelist), holding up to 10 lead rows
// (ul.list-group > li.queueitem.list-group-item, ng-repeat="item in
// queueList") in queue order - DOM order top-to-bottom is queue
// position, 1st = top. The page's own info-icon tooltip confirms only
// the last 10 queued items per agent are ever shown, so counts/
// positions here are scoped to that window, not necessarily the true
// full queue for an agent holding more than 10.
//
// "Done" vs "not done" has NO class difference (both are exactly
// "queueitem list-group-item ng-scope") - it's item.IsProcessed's own
// ng-style adding an explicit inline "background-color: rgb(244, 244,
// 244)" only when done; not-done rows carry no background-color at
// all. Each row's customer identity lives in a title attribute shaped
// "Name | Email | Phone" on a span inside the row's .pull-right block -
// matched by title containing "|" rather than a fixed selector path,
// since sibling spans (campaign, "Outbound Call Attempts") also carry
// unrelated title attributes.
// ===================================================================

const AGENT_QUEUE_SNAPSHOT_KEY = '_slaAgentQueueSnapshot';

function loadAgentQueueSnapshot() {
try {
const raw = JSON.parse(localStorage.getItem(AGENT_QUEUE_SNAPSHOT_KEY));
if (raw && Array.isArray(raw.agents)) return raw;
} catch (error) {
// ignore
}
return { scannedAt: null, agents: [] };
}

function saveAgentQueueSnapshot(agents) {
try {
localStorage.setItem(AGENT_QUEUE_SNAPSHOT_KEY, JSON.stringify({ scannedAt: new Date().toISOString(), agents }));
} catch (error) {
// ignore
}
}

// Clear Queue and a successful assign run both change every affected
// lead's real queue position - the stale snapshot would show a "3rd in
// queue" badge on a lead that isn't queued to anyone anymore (Clear
// Queue), or the wrong position for one that's genuinely just been
// added (assign). Wiping it (not re-scanning Queue by Agent again) is
// the same "cheap and correct beats an unnecessary re-scan" choice
// already made for both of those actions' own lead-card refresh.
function clearAgentQueueSnapshot() {
try {
localStorage.removeItem(AGENT_QUEUE_SNAPSHOT_KEY);
} catch (error) {
// ignore
}
}

function scrapeAgentQueuePositions() {
const agentPanels = document.querySelectorAll('li[ng-repeat="agent in fullqueue | filter: filterMessages"]');
const agents = [];
agentPanels.forEach((panelLi) => {
const nameEl = panelLi.querySelector('.queueitem.panel-heading div[style*="font-weight:bold"]');
const agentName = nameEl ? nameEl.textContent.trim() : '';
if (!agentName) return;

const rows = [...panelLi.querySelectorAll('ul.list-group > li.queueitem.list-group-item')];
const queue = rows.map((row, index) => {
const infoSpan = [...row.querySelectorAll('span[title]')].find((el) => (el.getAttribute('title') || '').includes('|'));
const title = infoSpan ? infoSpan.getAttribute('title') || '' : '';
const parts = title.split('|').map((s) => s.trim());
const processed = /background-color:\s*rgb\(244,\s*244,\s*244\)/.test(row.getAttribute('style') || '');
return { position: index + 1, name: parts[0] || '', email: parts[1] || '', phone: parts[2] || '', processed };
});

agents.push({
agentName,
totalShown: queue.length,
notDoneCount: queue.filter((item) => !item.processed).length,
queue
});
});
return agents;
}

// Navigates to Queue by Agent, scrapes every agent's queue, saves the
// snapshot, and comes back - same navigation shape as
// window._clearWholeQueue. Shared by the manual "Queue" link and the
// automatic post-assign re-scan below, so the navigation logic only
// exists once. Returns true/false rather than throwing, since a failed
// refresh shouldn't abort whatever the caller was already doing.
async function refreshAgentQueueSnapshot() {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/QueueByAgent';
const ready = await waitForElement('li[ng-repeat="agent in fullqueue | filter: filterMessages"]', 15000);
if (!ready) {
console.warn('[SLA Extract] Could not find the Queue by Agent panels after navigating - queue snapshot not refreshed.');
return false;
}
const moduleOk = await ensureCustomerHubModule();
if (!moduleOk) {
console.warn('[SLA Extract] Could not confirm the Customer Hub module is selected - queue snapshot not refreshed.');
return false;
}
// Angular renders the panel shell first and fills in each agent's
// queueList items a moment after - same "first paint isn't the full
// picture yet" pattern seen elsewhere in this file, not assumed here
// without seeing it, but cheap enough to wait out regardless.
await sleep(500);
const agents = scrapeAgentQueuePositions();
// No visible confirmation this scrape actually found anything real -
// logged so a "why isn't the badge showing" report can be diagnosed
// from what was actually seen, not guessed at.
console.info(`[SLA Extract] Queue by Agent scan: ${agents.length} agent panel(s) found`, agents.map((a) => ({
agent: a.agentName, notDone: a.notDoneCount, totalShown: a.totalShown,
sample: a.queue.slice(0, 3).map((q) => ({ position: q.position, name: q.name, email: q.email, phone: q.phone, processed: q.processed }))
})));
saveAgentQueueSnapshot(agents);
return true;
} finally {
window.location.hash = originalHash;
}
}

window._checkAgentQueuePositions = async function(buttonEl) {
const originatingPageType = detectPageType();
const originalText = buttonEl ? buttonEl.textContent : null;
if (buttonEl) buttonEl.textContent = 'Checking…';
showPageFlashOverlay('Checking agent queues…');
try {
// refreshAgentQueueSnapshot/waitForLeadsTableReady's own failure is
// not a reason to also withhold the panel re-render below - reported
// live as leads ingesting fine, the queue check running, but the
// panel then never loading at all, which fits an uncaught rejection
// here previously skipping straight past the render calls entirely
// (this whole function is a plain click handler - nothing awaits it,
// so that rejection would surface nowhere visible).
try {
const ok = await refreshAgentQueueSnapshot();
if (!ok) alert('Could not check agent queues - see console for details.');
// refreshAgentQueueSnapshot navigates to Queue by Agent and back -
// its own finally block resets window.location.hash, but that's just
// the route changing, not the SLA/Pending table having actually
// re-rendered yet (same gap documented above waitForLeadsTableRows
// for the auto-detect poll). Re-rendering the panel immediately here
// was reading a table that Angular hadn't repopulated after the
// navigation back, so renderAssignSection's "due this hour/next
// hour" tiles (fed by collectAssignableLeads' own unguarded,
// synchronous scrape) briefly went from correct counts to "0 leads
// due" until the next manual refresh fixed it. extractAndExportSla/
// Pending already wait here; this path went straight through
// displayPanel/displayPendingPanel and never did.
await waitForLeadsTableReady();
} catch (error) {
console.warn('[SLA Extract] Queue check failed - showing the panel anyway:', error);
}
// The catch above only covers the queue check - if displayPanel/
// displayPendingPanel itself throws (renderAssignSection, mountPanel,
// anything inside them), that propagates out uncaught exactly the
// same way and the panel still never appears, just one step later
// than what that catch actually guards. Surfaced visibly (an alert)
// rather than only to console, which this session has had no way to
// see after two rounds of this same report.
try {
if (originatingPageType === PAGE_PENDING) displayPendingPanel(currentPendingCustomers, 0, 0, false);
else displayPanel(currentCustomers, 0, 0, false);
} catch (error) {
console.error('[SLA Extract] Panel failed to render after queue check:', error);
alert('SLA Manager: the panel failed to load after checking the queue.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
}
} finally {
hidePageFlashOverlay();
if (buttonEl) buttonEl.textContent = originalText;
}
};

// Matches a lead (any shape with .email/.phone) to its position in
// whichever agent's queue it's in, from the last snapshot taken by
// window._checkAgentQueuePositions - a point-in-time read, not live,
// same tradeoff already accepted for the agent roster elsewhere here.
function findAgentQueuePositionForLead(lead) {
const snapshot = loadAgentQueueSnapshot();
if (!snapshot.agents || snapshot.agents.length === 0) return null;
const emailKey = normalizeEmailForBookingCheckMatch(lead.email);
const phoneKey = normalizePhoneForBookingCheckMatch(lead.phone);
if (!emailKey && !phoneKey) return null;
for (const agent of snapshot.agents) {
for (const item of agent.queue) {
const itemEmailKey = normalizeEmailForBookingCheckMatch(item.email);
const itemPhoneKey = normalizePhoneForBookingCheckMatch(item.phone);
const matches = (emailKey && itemEmailKey && emailKey === itemEmailKey) || (phoneKey && itemPhoneKey && phoneKey === itemPhoneKey);
if (matches) {
return { agentName: agent.agentName, position: item.position, totalShown: agent.totalShown, processed: item.processed };
}
}
}
return null;
}

function ordinal(n) {
const s = ['th', 'st', 'nd', 'rd'];
const v = n % 100;
return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Reused as-is for the normal case (assigned here, and genuinely
// queued) and the mismatch case (shows unassigned here, but Konnect's
// own Queue by Agent already has it queued to someone) - same badge
// slot on the card either way, just recolored/reworded, rather than
// adding a second element for the mismatch. Per instruction: don't
// clutter the UI with an extra warning section just for this.
function renderQueuePositionBadge(assigned, queuePosition) {
if (!queuePosition) return '';
const mismatch = !assigned;
const label = mismatch ? `⚠ Already in ${escapeHtml(queuePosition.agentName)}'s queue` : `${ordinal(queuePosition.position)} in queue`;
const title = mismatch
? `Shows unassigned here, but Konnect's own Queue by Agent already has this lead queued to ${escapeHtml(queuePosition.agentName)} (position ${queuePosition.position} of the last ${queuePosition.totalShown} shown) - assigning it may be rejected.`
: `In ${escapeHtml(queuePosition.agentName)}'s live call queue, out of the last ${queuePosition.totalShown} shown${queuePosition.processed ? ' (already called)' : ''}`;
const color = mismatch ? '#dc2626' : '#64748b';
const background = mismatch ? '#dc262615' : '#f1f5f915';
const border = mismatch ? '#dc2626' : '#e2e8f0';
return `<div style="margin-bottom: 10px;"><span title="${title}" style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: ${background}; color: ${color}; border: 1px solid ${border};">${label}</span></div>`;
}

// ===================================================================
// MORNING CHECKS
//
// A separate daily routine from lead assignment, done once at the
// start of a shift against Konnect pages this tool otherwise never
// touches. Each check below (window._checkXxx) was built and confirmed
// one at a time against real DOM, then converted to return a plain
// {ok, summary, details} result instead of alert()-ing it directly, so
// window._runAllMorningChecks can run all five in sequence and render
// them progressively on the Morning Checks page (see
// renderMorningChecksBody / displayMorningChecks further down).
// ===================================================================

// The month selector has no id/title/distinguishing attribute - just a
// Bootstrap dropdown - so it's matched by its distinctive "YYYY - Month"
// text content instead, which nothing else on the page would have. The
// page auto-selects the current month already, but nothing loads until
// that same month is explicitly re-clicked - the trigger's own
// displayed text already tells us which one that is, so there's no
// need to compute "the current month" independently.
function findMonthSelectorTrigger() {
const triggers = Array.from(document.querySelectorAll('div[data-toggle="dropdown"]'));
return triggers.find(t => /^\d{4}\s*-\s*[A-Za-z]+$/.test(t.querySelector('span.ng-binding')?.textContent?.trim() || ''));
}

// findMonthSelectorTrigger() alone is a synchronous, one-shot DOM
// query with no wait - calling it immediately after a hash change (the
// very first thing reloadCurrentMonthCampaigns did) can run before
// Angular has rendered anything at all for a route visited for the
// first time in a session, failing even though the selector logic
// itself is correct. This actually confirmed against real use: the
// first click aborted, an immediate second click (page already loaded
// from the first attempt) succeeded instantly.
function waitForMonthSelectorTrigger(timeout = 15000) {
return new Promise((resolve) => {
const existing = findMonthSelectorTrigger();
if (existing) {
resolve(existing);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(null);
}, timeout);
const observer = new MutationObserver(() => {
const found = findMonthSelectorTrigger();
if (found) {
clearTimeout(timer);
observer.disconnect();
resolve(found);
}
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

async function reloadCurrentMonthCampaigns() {
const trigger = await waitForMonthSelectorTrigger();
if (!trigger) return false;
const label = trigger.querySelector('span.ng-binding')?.textContent?.trim();
if (!label) return false;

trigger.click();
// The first visit to this route in a session took long enough to
// abort with the original 5s default (Angular presumably compiling/
// fetching this route for the first time) - a second click right
// after succeeded instantly, confirming it's a one-off warm-up cost
// rather than something wrong with the selectors themselves. Given
// generously here since a slow-but-successful wait costs nothing (it
// resolves the moment the element actually appears either way).
const firstOption = await waitForElement('li[ng-click="monthToDateSelected(monthToDate)"]', 15000);
if (!firstOption) return false;

const options = Array.from(document.querySelectorAll('li[ng-click="monthToDateSelected(monthToDate)"]'));
const target = options.find(li => li.textContent.trim() === label);
if (!target) return false;
target.click();

const firstRow = await waitForElement('tr[ng-repeat="camp in campaigns"]', 15000);
if (!firstRow) return false;
// ng-repeat renders every row for a digest in one batch, but with
// ~300 rows a short settle delay is cheap insurance against reading
// mid-render.
await sleep(400);
return true;
}

// Column index 9 is In Progress specifically because this always
// navigates via a fixed showSLA=true/deferred=false URL - that URL
// guarantees the column layout (the 4 SLA columns and the Deferred
// column are both present, not conditionally missing), confirmed
// against two independent sample rows before writing this.
function extractInProgressData() {
const totalTh = document.querySelector('th[title="Items that have had one or more attempts (total)"]');
const totalMatch = totalTh ? totalTh.textContent.match(/\((\d+)\)/) : null;
const total = totalMatch ? Number(totalMatch[1]) : null;

const rows = Array.from(document.querySelectorAll('tr[ng-repeat="camp in campaigns"]'));
const breakdown = [];
let sum = 0;
rows.forEach((row) => {
const cells = row.querySelectorAll('td');
if (cells.length < 13) return;
const name = cells[3]?.textContent?.trim() || '(unnamed)';
const inProgress = Number(cells[9]?.textContent?.trim()) || 0;
sum += inProgress;
if (inProgress > 0) breakdown.push({ name, inProgress });
});
breakdown.sort((a, b) => b.inProgress - a.inProgress);
return { total, sum, breakdown };
}

// skipRestore lets window._runAllMorningChecks chain straight into the
// next check's own navigation instead of bouncing back through the
// page morning checks started from and back out again - standalone use
// (the console/a future single-check button) always restores as before.
window._checkInProgress = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/onGoingCampaigns/module/-6/deferred/false/showSLA/true';
const loaded = await reloadCurrentMonthCampaigns();
if (!loaded) {
return { ok: null, summary: 'Could not load the current month\'s campaigns - aborted.' };
}
const { total, sum, breakdown } = extractInProgressData();
if (total === null) {
return { ok: null, summary: 'Could not find the In Progress total - aborted.' };
}
if (sum === total) {
return { ok: true, summary: `OK (${total})` };
}
const diff = total - sum;
return {
ok: false,
summary: `MISMATCH - top total ${total}, rows sum to ${sum} (off by ${diff})`,
details: breakdown.length > 0 ? breakdown.map(b => `${b.name}: ${b.inProgress}`) : ['(no rows have any In Progress)']
};
} finally {
if (!skipRestore) window.location.hash = originalHash;
}
};

// Counts today's (or, with filterDate, a filtered subset of) rows by
// Source column, feeding both the Lead Type Check's OK/MISSING verdict
// and its secondary "what sources there are" detail listing.
//
// "Yesterday" makes a real network request (getYesterdaysData() calls
// the API and replaces $scope.leads - it's not a client-side filter on
// already-rendered rows), so this waits for the date label itself to
// change rather than assuming the click took effect instantly.
// Lead Created (column index 5, confirmed as "Sat, 26 Sep 2026 15:55" -
// the same weekday-prefixed format parseKonnectDate already handles
// elsewhere in this file) lets rows be filtered by time of day, used
// for the 7pm-8am overnight-window rule on the Lead Type Check's
// yesterday fallback. filterDate is optional - the Lead Type Check's
// today scan passes none, since that's meant to show the whole day.
function extractSourceCounts(filterDate) {
const rows = Array.from(document.querySelectorAll('table.table-striped tr')).filter(r => r.querySelectorAll('td').length > 0);
const counts = {};
rows.forEach((row) => {
const cells = row.querySelectorAll('td');
if (cells.length < 9) return;
if (filterDate) {
const leadCreated = parseKonnectDate(cells[5]?.textContent?.trim() || '');
if (!filterDate(leadCreated)) return;
}
const source = cells[8]?.textContent?.trim() || '(blank)';
counts[source] = (counts[source] || 0) + 1;
});
return counts;
}

// The 7pm-8am rule only actually narrows the YESTERDAY fallback, not
// today: midnight-8am is already inside "today", which the check scans
// with no time restriction at all, so a source arriving at 2am today
// already counts as found without needing this filter. This is applied
// only to yesterday's data, keeping just the 7pm-to-midnight slice of
// that calendar day.
function isInOvernightWindow(date) {
if (!date) return false;
return date.getHours() >= 19;
}

function currentInboundDateLabel() {
return document.querySelector('div[title="Select A Date"] span.ng-binding')?.textContent?.trim();
}

function waitForInboundDateChange(previousLabel, timeout = 8000) {
return new Promise((resolve) => {
const target = document.querySelector('div[title="Select A Date"]');
if (!target) {
resolve(false);
return;
}
if (currentInboundDateLabel() && currentInboundDateLabel() !== previousLabel) {
resolve(true);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(false);
}, timeout);
const observer = new MutationObserver(() => {
if (currentInboundDateLabel() && currentInboundDateLabel() !== previousLabel) {
clearTimeout(timer);
observer.disconnect();
resolve(true);
}
});
observer.observe(target, { childList: true, subtree: true, characterData: true });
});
}

// This table doesn't render in one atomic batch the way Live Campaigns'
// ng-repeat does - confirmed live: a check read back 28 rows and reported
// (wrongly) that every expected source was missing, then the rest of the
// day's leads kept arriving and rendering into the SAME table for a
// while AFTER the check had already finished and moved on. So neither
// "does the table element exist" nor "does at least one full row exist"
// (both tried previously) can ever be a reliable signal here - a
// perfectly well-formed 12-cell row is no guarantee at all that loading
// is actually finished, since more of them keep arriving behind it.
// The only signal that's actually true regardless of however this loads
// under the hood (one paginated fetch, several sequential ones,
// whatever) is that the DOM stops changing - this resolves once no new
// rows have appeared for a full quiet window, not the instant any
// appear, with a hard cap so a page that's genuinely stuck doesn't hang
// a check forever. Returns the settled row count (12+ cells each, same
// column requirement as before) rather than a bare boolean, so callers
// can tell "definitely still zero after the whole wait" apart from
// "read something, hopefully everything."
const INBOUND_MIN_CELLS = 12;
function countInboundRows() {
return Array.from(document.querySelectorAll('table.table-striped tr')).filter(r => r.querySelectorAll('td').length >= INBOUND_MIN_CELLS).length;
}

function waitForInboundRowsSettled(timeout = 20000, quietMs = 1500) {
return new Promise((resolve) => {
let settleTimer = null;
let hardTimer = null;

function finish() {
clearTimeout(settleTimer);
clearTimeout(hardTimer);
observer.disconnect();
resolve(countInboundRows());
}

function armSettleTimer() {
clearTimeout(settleTimer);
settleTimer = setTimeout(finish, quietMs);
}

const observer = new MutationObserver(armSettleTimer);
observer.observe(document.body, { childList: true, subtree: true });

// Armed immediately too, in case the data was already fully loaded
// before this even started watching (no further mutations coming).
armSettleTimer();
hardTimer = setTimeout(finish, timeout);
});
}

// Today's source counts, formatted as "Source: count" lines sorted by
// count - the secondary "what sources there are" display the user
// wants shown alongside the OK/MISSING verdict without dominating it,
// so this is returned as the check's `details` (collapsed by default),
// not merged into the summary itself.
function sourceCountLines(counts) {
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const lines = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([source, count]) => `${source}: ${count}`);
return [`Today (${total} total):`, ...(lines.length > 0 ? lines : ['(no rows)'])];
}

// The real Lead Type Check: does every expected daily source actually
// appear today; for any that don't, check yesterday (7pm-8am overnight
// window only) before calling it actually missing. Originally
// mislabeled as "All leads are Routed to" - that name belongs to a
// different, later check (a per-row check of the Routed To column, see
// window._checkRoutedTo), not this one. This also folds in what used
// to be a separate "scan sources" step - the user only wants one check
// here, with the raw source counts available as a secondary detail
// rather than a standalone action.
const EXPECTED_DAILY_SOURCES = ['Robins & Day Website', 'Customer First', 'Autotrader - Deal Builder', 'Cargurus'];

window._checkLeadTypes = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/InboundAPI';
const table = await waitForElement('table.table-striped', 15000);
if (!table) {
return { ok: null, summary: 'Could not load the Inbound API table - aborted.' };
}
const settledCount = await waitForInboundRowsSettled();
if (settledCount === 0) {
return { ok: null, summary: 'Inbound API table loaded but no rows appeared - aborted.' };
}
const todayLabel = currentInboundDateLabel();
const todayCounts = extractSourceCounts();
const details = sourceCountLines(todayCounts);

// Zero of ANY source (not just the expected ones) is a load problem,
// not a real result - reporting every expected source as missing on
// the back of an empty read is exactly the false alarm this is meant
// to catch, rather than confidently declaring a real problem off a
// read that likely just didn't work.
if (Object.keys(todayCounts).length === 0) {
return { ok: null, summary: 'Inbound API table read back with zero rows for Today - likely not fully loaded, re-run to confirm.', details };
}

const missingToday = EXPECTED_DAILY_SOURCES.filter(s => !todayCounts[s]);
if (missingToday.length === 0) {
return { ok: true, summary: 'OK', details };
}

const yesterdayLink = document.querySelector('li[ng-click="getYesterdaysData()"]');
if (!yesterdayLink) {
return { ok: false, summary: `MISSING - ${missingToday.join(', ')} (could not check yesterday - control not found)`, details };
}
yesterdayLink.click();
const changed = await waitForInboundDateChange(todayLabel, 15000);
if (!changed) {
return { ok: false, summary: `MISSING - ${missingToday.join(', ')} (could not confirm yesterday's data loaded)`, details };
}
await waitForInboundRowsSettled();
const yesterdayCounts = extractSourceCounts(isInOvernightWindow);
const stillMissing = missingToday.filter(s => !yesterdayCounts[s]);

if (stillMissing.length === 0) {
return { ok: true, summary: `OK (found overnight yesterday: ${missingToday.join(', ')})`, details };
}
return { ok: false, summary: `MISSING - ${stillMissing.join(', ')}`, details };
} finally {
// No need to explicitly restore Today here - the page's own
// controller calls getTodaysData() in its constructor, so the next
// fresh visit to this page loads Today automatically regardless of
// whatever this check left it on.
if (!skipRestore) window.location.hash = originalHash;
}
};

// "All leads are Routed to" - the real one, distinct from Lead Type
// Check above despite the earlier mix-up. Per-row, today only: every
// lead's own Routed To cell (index 11) should have something in it.
// Genuinely-unrouted rows are rare enough that a confirmed real
// example wasn't available to check against, so this treats a cell as
// unrouted if it's blank OR if its entire trimmed content exactly
// matches a known "no value" word - matched as a whole-cell equality,
// not a substring search, so a legitimate agent/team name that merely
// contains "no" (or similar) can't misfire this.
const UNROUTED_PLACEHOLDER_WORDS = ['no', 'not', 'n/a', 'na', 'none', 'not routed', 'not applicable', 'unrouted'];

function isUnroutedCell(text) {
const t = (text || '').trim();
if (t === '') return true;
return UNROUTED_PLACEHOLDER_WORDS.includes(t.toLowerCase());
}

// Run before Lead Type Check when both are chained back-to-back in
// window._runAllMorningChecks (execution order there differs from the
// fixed display order): this always does its own fresh hash navigation,
// which is what guarantees the page is showing Today rather than
// whatever Yesterday state a *previous* check might have left it on -
// Lead Type Check reusing this same already-loaded page afterwards is
// only safe because this one runs first and only ever reads Today.
window._checkRoutedTo = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/InboundAPI';
const table = await waitForElement('table.table-striped', 15000);
if (!table) {
return { ok: null, summary: 'Could not load the Inbound API table - aborted.' };
}
const settledCount = await waitForInboundRowsSettled();
if (settledCount === 0) {
return { ok: null, summary: 'Inbound API table read back with zero usable rows for Today - likely not fully loaded, re-run to confirm.' };
}

const rows = Array.from(document.querySelectorAll('table.table-striped tr')).filter(r => r.querySelectorAll('td').length >= INBOUND_MIN_CELLS);
const problems = [];
rows.forEach((row) => {
const cells = row.querySelectorAll('td');
const routedTo = cells[11]?.textContent?.trim() || '';
if (isUnroutedCell(routedTo)) {
problems.push({
apiReference: cells[0]?.textContent?.trim() || '(blank)',
source: cells[8]?.textContent?.trim() || '(blank)',
enquiryType: cells[9]?.textContent?.trim() || '(blank)'
});
}
});

if (problems.length === 0) {
return { ok: true, summary: 'OK' };
}
return {
ok: false,
summary: `${problems.length} NOT ROUTED`,
details: problems.map(p => `Api Ref: ${p.apiReference} | Source: ${p.source} | Enquiry: ${p.enquiryType}`)
};
} finally {
if (!skipRestore) window.location.hash = originalHash;
}
};

// Voicemail count - a plain number, no OK/report judgment (same nature
// as the SLA count). The queue-count element itself is always present
// on page load (no ng-if wraps it), but its value is filled in
// asynchronously after a separate stats API call resolves - waiting
// for the element to merely exist would risk reading it before
// Angular has actually populated a number, so this waits for a digit
// to appear in its text specifically.
function readVoicemailQueueCount() {
const el = document.querySelector('span[title="Number in Queue waiting to be processed"]');
if (!el) return null;
const match = el.textContent.trim().match(/(\d+)/);
return match ? Number(match[1]) : null;
}

function waitForVoicemailCount(timeout = 15000) {
return new Promise((resolve) => {
const existing = readVoicemailQueueCount();
if (existing !== null) {
resolve(existing);
return;
}
const timer = setTimeout(() => {
observer.disconnect();
resolve(null);
}, timeout);
const observer = new MutationObserver(() => {
const val = readVoicemailQueueCount();
if (val !== null) {
clearTimeout(timer);
observer.disconnect();
resolve(val);
}
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
});
}

window._checkVoicemails = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/Voicemails';
// Same Customer Hub / Service Booking module filter as the Queue by
// Agent page (see ensureCustomerHubModule) - the queue count is
// module-scoped, so if this page was left on a different module the
// number read below would be for the wrong queue entirely. Assumes
// (not yet confirmed against a real "wrong module selected" case)
// that switching modules re-triggers the same async count fetch
// waitForVoicemailCount already waits out below.
const moduleTrigger = await waitForElement('div[title="Filter by Module"]', 15000);
if (!moduleTrigger) {
return { ok: null, summary: 'Could not find the module filter after navigating - aborted.' };
}
const moduleOk = await ensureCustomerHubModule();
if (!moduleOk) {
return { ok: null, summary: 'Could not confirm the Customer Hub module is selected - aborted.' };
}
const count = await waitForVoicemailCount();
if (count === null) {
return { ok: null, summary: 'Could not read the voicemail queue count - aborted.' };
}
// Plain count, same nature as the SLA count - no OK/problem judgment,
// it's often legitimately 0.
return { ok: null, summary: `${count}` };
} finally {
if (!skipRestore) window.location.hash = originalHash;
}
};

// SLA count - the total leads in the SLA queue, exactly what the panel
// already shows when opened from that page (per the user: "this isn't
// a separate page nor details other than what we already have"). Since
// Morning Checks can be entered from whatever page the user happened to
// be on, this only navigates if the SLA table isn't already showing -
// normally it will be, since that's the page the panel is opened from.
window._checkSlaCount = async function(returnHash) {
if (detectPageType() !== PAGE_SLA) {
window.location.hash = returnHash;
await waitForElement('table', 15000);
await sleep(300);
}
if (detectPageType() !== PAGE_SLA) {
return { ok: null, summary: 'Could not find the SLA queue table - aborted.' };
}
// isEmailOnly is already computed per-lead by collectAssignableLeads
// (same field the Assign section's own "Email only" checkbox count
// uses) - the Email Only Count row above this one is populated from
// this same call rather than running its own separate check.
const leads = collectAssignableLeads();
const emailOnlyCount = leads.filter(l => l.isEmailOnly).length;
return { ok: null, summary: `${leads.length}`, emailOnlyCount };
};

// Persisted (not just in-memory) so "last run" survives a bookmarklet
// re-invocation later in the shift, same reasoning as ASSIGN_LOG_KEY.
// Scoped to today only - same lesson as the assignment log's own
// day-pruning: a stale run from yesterday showing up as "last run" this
// morning would be actively misleading rather than just unhelpful.
const MORNING_CHECKS_LAST_RUN_KEY = '_slaMorningChecksLastRun';

function saveMorningChecksLastRun(results, elapsedMs) {
try {
localStorage.setItem(MORNING_CHECKS_LAST_RUN_KEY, JSON.stringify({
time: new Date().toISOString(),
elapsedMs,
failedLabels: results.filter(r => r.ok === false).map(r => r.label),
results
}));
} catch (error) {
// ignore
}
}

function loadMorningChecksLastRun() {
try {
const raw = JSON.parse(localStorage.getItem(MORNING_CHECKS_LAST_RUN_KEY) || 'null');
if (!raw || new Date(raw.time).toDateString() !== new Date().toDateString()) return null;
return raw;
} catch (error) {
return null;
}
}

function formatElapsed(ms) {
return `${(ms / 1000).toFixed(1)}s`;
}

function renderLastRunLine(lastRun) {
if (!lastRun) return '';
const issueText = lastRun.failedLabels.length === 0
? 'All OK'
: `${lastRun.failedLabels.length} issue${lastRun.failedLabels.length > 1 ? 's' : ''} (${escapeHtml(lastRun.failedLabels.join(', '))})`;
return `<div style="font-size: 11px; color: #94a3b8; margin-top: 8px;">Last run today at ${formatTimeForInput(new Date(lastRun.time))} &middot; ${issueText} &middot; ${formatElapsed(lastRun.elapsedMs)}</div>`;
}

function morningCheckStatusColor(row) {
if (row.status === 'pending') return '#cbd5e1';
if (row.status === 'running') return '#d97706';
if (row.ok === true) return '#16a34a';
if (row.ok === false) return '#dc2626';
return '#2563eb';
}

// Only rendered once every check has actually settled (the 5 rows below
// already show live progress while a run is in flight) - a colored
// banner as the very first thing on the page is what answers "did
// anything go wrong" at a glance, without reading all 5 rows individually.
function renderMorningChecksSummaryBanner(results) {
const allDone = results.every(r => r.status === 'done');
if (!allDone) {
const doneCount = results.filter(r => r.status === 'done').length;
return `<div style="padding: 8px 12px; border-radius: 8px; background: #eef2ff; color: #4338ca; font-size: 12px; font-weight: 600; text-align: center; margin-bottom: 10px;">Running check ${doneCount + 1} of ${results.length}…</div>`;
}
// ok:null (SLA Count, Voicemail) is a plain count, not a pass/fail
// judgment - only an explicit ok:false counts as an issue here.
const failed = results.filter(r => r.ok === false);
if (failed.length === 0) {
return `<div style="padding: 10px 12px; border-radius: 8px; background: #d1fae5; color: #059669; font-size: 13px; font-weight: 700; text-align: center; margin-bottom: 10px;">${svgIcon('checklist', 14)} All checks passed</div>`;
}
return `<div style="padding: 10px 12px; border-radius: 8px; background: #fee2e2; color: #dc2626; font-size: 13px; font-weight: 700; text-align: center; margin-bottom: 10px;">${svgIcon('warning', 14)} ${failed.length} issue${failed.length > 1 ? 's' : ''} found - ${escapeHtml(failed.map(f => f.label).join(', '))}</div>`;
}

function renderMorningCheckRow(row) {
const color = morningCheckStatusColor(row);
const isSettled = row.status === 'done';
const isRunning = row.status === 'running';
const isPending = row.status === 'pending';
const rightText = isSettled ? (row.summary || '') : (isRunning ? 'Running…' : 'Waiting');
const hasDetails = isSettled && Array.isArray(row.details) && row.details.length > 0;
const detailsId = `_mcDetails_${row.key}`;
const chevronId = `_mcChevron_${row.key}`;
// Status reads through three visual states, not just the dot color:
// pending rows sit dimmed/dashed since there's nothing to report yet,
// running gets a light indigo highlight so it's obvious at a glance
// which check is currently in flight, and done settles to a solid
// white card - the left accent border (colored per status, same
// pattern as the tier/callback-type section borders elsewhere in this
// panel) is what carries the OK/issue/count signal once settled.
const background = isPending ? '#f8fafc' : (isRunning ? '#eef2ff' : 'white');
const borderColor = isRunning ? '#c7d2fe' : '#e2e8f0';
const borderStyle = isPending ? 'dashed' : 'solid';

return `
<div style="border: 1px ${borderStyle} ${borderColor}; border-left: 3px solid ${color}; border-radius: 8px; padding: 10px 12px; background: ${background}; opacity: ${isPending ? '0.65' : '1'}; transition: background 0.2s ease, opacity 0.2s ease;">
<div style="display: flex; align-items: center; gap: 8px; ${hasDetails ? 'cursor: pointer;' : ''}" ${hasDetails ? `onclick="window._toggleMorningCheckDetails('${row.key}')"` : ''}>
<span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></span>
<span style="font-size: 12px; font-weight: 600; color: #1e293b; flex-shrink: 0;">${row.label}</span>
<span style="font-size: 12px; color: #64748b; flex: 1; text-align: right;">${escapeHtml(rightText)}</span>
${hasDetails ? chevronIcon(true, chevronId) : ''}
</div>
${hasDetails ? `
<div id="${detailsId}" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #475569; line-height: 1.6;">
${row.details.map(d => `<div>${escapeHtml(d)}</div>`).join('')}
</div>` : ''}
</div>`;
}

// Separate page/section reached only via the header toggle - never
// something the background auto-detect poll enters or leaves on its
// own (see currentPanelMode), since that poll's silent rebuilds on a
// page switch would otherwise yank the user out of this view every
// time a check navigates to a different Konnect page mid-run.
function renderMorningChecksBody() {
const lastRun = loadMorningChecksLastRun();

if (morningChecksResults.length === 0) {
return `
<div style="padding: 24px 4px; text-align: center;">
<div style="color: #cbd5e1; margin-bottom: 12px;">${svgIcon('checklist', 40, ' stroke-width: 1.5;')}</div>
<p style="color: #64748b; margin: 0 0 20px 0; font-size: 14px; line-height: 1.6;">Runs the five morning checks in order - SLA Count, In Progress, Lead Type Check, All Leads Are Routed To, Voicemail - and reports each result here.</p>
<button onclick="window._runAllMorningChecks();" style="padding: 10px 20px; background: #1e293b; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">Run All Checks</button>
${renderLastRunLine(lastRun)}
</div>`;
}

const banner = renderMorningChecksSummaryBanner(morningChecksResults);
const rows = morningChecksResults.map(renderMorningCheckRow).join('');
const allDone = morningChecksResults.every(r => r.status === 'done');

return `
${banner}
<div style="display: flex; flex-direction: column; gap: 8px;">
${rows}
</div>
<div style="margin-top: 16px; text-align: center;">
<button onclick="window._runAllMorningChecks();" ${runningMorningChecks ? 'disabled' : ''}
style="padding: 8px 18px; background: ${runningMorningChecks ? '#cbd5e1' : '#1e293b'}; color: white; border: none; border-radius: 8px; cursor: ${runningMorningChecks ? 'default' : 'pointer'}; font-size: 13px; font-weight: 600;">
${runningMorningChecks ? 'Running…' : (allDone ? 'Run Again' : 'Run All Checks')}
</button>
${allDone && !runningMorningChecks ? `<span onclick="window._clearMorningChecks();" style="margin-left: 10px; font-size: 12px; color: #94a3b8; cursor: pointer; text-decoration: underline;">Clear</span>` : ''}
${allDone ? renderLastRunLine(lastRun) : ''}
</div>`;
}

// Results otherwise persist until end of day or the next run (see
// morningChecksResults' own init) - this is the explicit third way to
// get back to "hasn't been run yet", per instruction.
window._clearMorningChecks = function() {
morningChecksResults = [];
try {
localStorage.removeItem(MORNING_CHECKS_LAST_RUN_KEY);
} catch (error) {
// ignore
}
displayMorningChecks();
};

function displayMorningChecks() {
mountPanel(renderPanelShell({
title: 'Morning Checks',
count: '',
newCount: 0,
removedCount: 0,
summaryHtml: '',
assignSectionHtml: '',
bodyHtml: renderMorningChecksBody(),
hideSearch: true
}));
}

window._toggleMorningCheckDetails = function(key) {
const el = document.getElementById(`_mcDetails_${key}`);
if (!el) return;
const opening = el.style.display === 'none';
el.style.display = opening ? 'block' : 'none';
const chevron = document.getElementById(`_mcChevron_${key}`);
if (chevron) chevron.style.transform = `rotate(${opening ? 0 : -90}deg)`;
};

// Leaves morningChecksResults untouched on both the way out and the
// way back in - the last run's results should still be sitting there
// after switching to the normal queue view and back, not just while
// the panel itself happens to stay mounted. They're only ever replaced
// by an actual re-run (window._runAllMorningChecks resets the array
// itself right before it starts).
//
// Switching back used to go through runExtraction(), which depends on
// detectPageType() recognizing whatever page is CURRENTLY loaded - but
// Morning Checks routinely leaves the visible tab on Live Campaigns/
// Inbound API/Voicemails/Queue by Agent, none of which detectPageType()
// recognizes, so that press did nothing at all until the user happened
// to be back on the SLA or Pending page (needing a second, sometimes a
// third, press to actually take effect). currentCustomers/
// currentPendingCustomers already hold the last real scan from before
// Morning Checks was entered - showing that straight back is both
// instant (no fresh re-scrape, including any slow per-lead detail
// scraping) and independent of whatever page is currently on screen.
// Falls back to a live scan only if there's genuinely no prior normal
// view yet this session.
window._toggleMorningChecks = function() {
if (runningMorningChecks) return;
if (currentPanelMode === 'morningChecks') {
currentPanelMode = 'normal';
if (currentPageType === PAGE_PENDING) {
displayPendingPanel(currentPendingCustomers);
} else if (currentPageType === PAGE_SLA) {
displayPanel(currentCustomers);
} else {
runExtraction();
}
return;
}
currentPanelMode = 'morningChecks';
displayMorningChecks();
};

// Fastest order to actually RUN the checks in - independent of
// MORNING_CHECKS_ORDER, which is only the fixed order they're DISPLAYED
// in (renderMorningChecksBody always renders by that order regardless
// of what order results actually arrive in). sla costs nothing (no
// navigation, it's already sitting on the page it needs). routedTo and
// leadType both live on the Inbound API page, so running them back to
// back means leadType's own navigation to that page is a same-hash
// no-op and its waitForElement resolves instantly - one page load
// instead of two. routedTo has to go first in that pair: it always
// does a fresh navigation (guaranteeing Today's data), whereas leadType
// can end on Yesterday if it needed the overnight fallback, and reusing
// the page without a fresh navigation only stays correct because
// nothing after leadType depends on it being back on Today (see the
// comment on window._checkRoutedTo).
const MORNING_CHECKS_EXECUTION_ORDER = ['sla', 'routedTo', 'leadType', 'inProgress', 'voicemail'];

// Runs the five real checks (see MORNING_CHECKS_EXECUTION_ORDER for why
// that order, not the display order, is used to actually run them) -
// Email Only Count is a sixth displayed row but has no check function
// of its own, populated as a side effect of "sla" instead (see below).
// Updates the page after each check completes so results appear progressively
// rather than all at once at the end. Each check function saves/
// restores its own hash internally, but skipRestore=true is passed here
// so a check leaves the browser wherever it landed instead of bouncing
// back through the page morning checks started from between every
// single step - originalHash is only restored once, at the very end.
// Konnect's own pages re-rendering mid-navigation (a big table's rows
// all populating at once, etc.) is what the user described as making
// the screen look like it's glitching - showPageFlashOverlay dims
// the real page for the whole run so none of that is visible, without
// slowing anything down (it's purely cosmetic, nothing waits on it).
window._runAllMorningChecks = async function() {
if (runningMorningChecks) return;
runningMorningChecks = true;
const originalHash = window.location.hash;
const runStartedAt = Date.now();
showPageFlashOverlay('Running morning checks…');

const checkFns = {
sla: () => window._checkSlaCount(originalHash),
inProgress: () => window._checkInProgress(true),
leadType: () => window._checkLeadTypes(true),
routedTo: () => window._checkRoutedTo(true),
voicemail: () => window._checkVoicemails(true)
};

morningChecksResults = MORNING_CHECKS_ORDER.map(step => ({ ...step, status: 'pending' }));
displayMorningChecks();

try {
for (const key of MORNING_CHECKS_EXECUTION_ORDER) {
morningChecksResults = morningChecksResults.map(r => r.key === key ? { ...r, status: 'running' } : r);
displayMorningChecks();

let result;
try {
result = await checkFns[key]();
} catch (err) {
result = { ok: null, summary: `Error - ${err && err.message ? err.message : err}` };
}

morningChecksResults = morningChecksResults.map(r => r.key === key ? { ...r, status: 'done', ...result } : r);
// Email Only Count has no check function of its own (see
// MORNING_CHECKS_EXECUTION_ORDER, which doesn't list it) - it's
// populated here as a side effect of the SLA check, which already
// collects every lead's isEmailOnly flag while it's on the page.
// Always settled alongside "sla" (even on failure, when
// emailOnlyCount is absent) so it never dangles in "Waiting" forever.
if (key === 'sla') {
const emailSummary = typeof result.emailOnlyCount === 'number' ? `${result.emailOnlyCount}` : 'Could not be determined (SLA check failed).';
morningChecksResults = morningChecksResults.map(r => r.key === 'emailOnly' ? { ...r, status: 'done', ok: null, summary: emailSummary } : r);
}
displayMorningChecks();
}
} finally {
runningMorningChecks = false;
window.location.hash = originalHash;
hidePageFlashOverlay();
saveMorningChecksLastRun(morningChecksResults, Date.now() - runStartedAt);
// The loop's own last displayMorningChecks() call (right after the
// final check's result lands) still had runningMorningChecks === true
// at render time - that flag only flips above, after the loop exits -
// so without this the button stayed stuck on disabled "Running…"
// until something else (leaving and re-entering the page) forced a
// fresh render.
displayMorningChecks();
}
};

// ===================================================================
// LEAD DETAIL RENDERING HELPERS
//
// Shared by both the SLA and Pending Customers panels - customer detail
// modal scraping, clipboard copy, and the per-lead assignment cell/badge/
// picker markup used in both tier and callback-type sections.
// ===================================================================

// Confirmed live: the modal's Customer tab (open by default) holds its
// own labeled table - <tr><td>Email</td><td>value</td></tr>, likewise
// Mobiles/Landlines (both plural - a customer can have more than one on
// file, comma-separated, matching the confirmed "07932064637," shape).
// Reading by the field's own label is more reliable than the old
// approach of pattern-matching a phone/email shape out of the modal's
// whole text, which could in principle misfire on some other number or
// address incidentally present in the modal. Scoped to .tab-pane.active
// so the Vehicles Owned tab's own <table class="table"> (uib-tab keeps
// every tab's markup in the DOM at once, just toggling which one is
// "active" - confirmed both tabs share the exact same table class)
// could never get matched by accident.
function readModalTabField(modal, label) {
const rows = Array.from(modal.querySelectorAll('.tab-pane.active table.table tr'));
const row = rows.find(r => r.querySelector('td')?.textContent?.trim() === label);
if (!row) return '';
return row.querySelectorAll('td')[1]?.textContent?.trim() || '';
}

function firstFromCommaList(raw) {
return (raw || '').split(',').map(s => s.trim()).find(s => s.length > 0) || '';
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
let phone = (firstFromCommaList(readModalTabField(modal, 'Mobiles')) || firstFromCommaList(readModalTabField(modal, 'Landlines'))).replace(/\s+/g, '');
let email = readModalTabField(modal, 'Email');

// Falls back to the old whole-modal regex scrape only if the labeled
// lookup came back completely empty - in case some other customer's
// modal ever renders with a different table shape than the one
// confirmed here, rather than silently losing data the old approach
// would have caught.
if (!phone || !email) {
const modalText = modal.innerText || modal.textContent;
if (!phone) {
const phoneMatch = modalText.match(/\b(07\d{9}|0\d{3}\s?\d{3}\s?\d{3,4}|0\d{10})\b/);
phone = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : '';
}
if (!email) {
const emailMatch = modalText.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
email = emailMatch ? emailMatch[1] : '';
}
}

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

// Wraps a customer card's contact-info grid (phone/email, or mobile/
// email/landline on the Pending Customers side) behind a collapsed-by-
// default disclosure - these fields matter for the moment you're about
// to make contact, not for scanning/triaging the list, and showing them
// unconditionally on every card was a lot of the visual clutter in what
// was otherwise meant to be a quick scan. Toggled relative to the
// clicked element (nextElementSibling) rather than by a per-card id,
// since there's no natural unique id to hang one off here and DOM
// traversal avoids needing one.
function renderContactToggle(gridInnerHtml) {
return `
<div onclick="window._toggleCustomerContact(this)" style="cursor: pointer; display: flex; align-items: center; gap: 4px; font-size: 11px; color: #4f46e5; margin-bottom: 8px;">
${svgIcon('chevron', 12, ' transition: transform 0.15s ease; transform: rotate(-90deg);')} Contact details
</div>
<div style="display: none; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
${gridInnerHtml}
</div>`;
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

// Directly tests the actual mechanism displayPanel/displayPendingPanel's
// invalidateCache=false argument depends on (see their own comments) -
// that repeated getCached*() calls do NOT touch the live DOM again
// unless invalidateLeadsCache() ran in between. This is the part of the
// queue-refresh-race fix that's genuinely testable without a live
// browser: whether the cache-skip mechanism itself works. It does NOT
// (and can't, from here) verify the other half - that
// waitForLeadsTableRows' MutationObserver-based wait actually resolves
// at the right moment against Konnect's real Angular re-render timing.
// That half only a live re-test can confirm.
(function leadsCacheSelfTest() {
const originalQuerySelector = document.querySelector.bind(document);
let scrapeCount = 0;
document.querySelector = function(selector) {
if (selector === 'table') {
scrapeCount++;
return { querySelectorAll: () => [] };
}
return originalQuerySelector(selector);
};
try {
const failures = [];

invalidateLeadsCache();
getCachedAssignableLeads();
getCachedAssignableLeads();
getCachedAssignableLeads();
if (scrapeCount !== 1) failures.push(`getCachedAssignableLeads: expected exactly 1 DOM scrape across 3 uninvalidated calls, got ${scrapeCount}`);

scrapeCount = 0;
invalidateLeadsCache();
getCachedPendingCustomers();
getCachedPendingCustomers();
if (scrapeCount !== 1) failures.push(`getCachedPendingCustomers: expected exactly 1 DOM scrape across 2 uninvalidated calls, got ${scrapeCount}`);

scrapeCount = 0;
invalidateLeadsCache();
getCachedAssignableLeads();
invalidateLeadsCache();
getCachedAssignableLeads();
if (scrapeCount !== 2) failures.push(`invalidateLeadsCache: expected a fresh scrape after each explicit invalidation (2 calls), got ${scrapeCount}`);

if (failures.length > 0) {
console.error('SLA Extract leads-cache self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Extract leads-cache self-test passed (3/3)');
}
} finally {
document.querySelector = originalQuerySelector;
}
})();

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

// Browsers throttle setTimeout-based waits heavily in a backgrounded
// tab - reported live as detail-modal scraping (extractCustomerDetails,
// below) becoming slower and unreliable while a different browser tab
// was active. waitForModal and every other wait this touches is
// setTimeout/MutationObserver-based, so a throttled tab risks reading a
// modal as never having opened purely because of throttling, not a
// real failure. Resolves immediately if already visible (the common
// case costs nothing); otherwise waits for the tab to actually become
// the active one again before letting a new modal-open attempt start -
// same cooperative-checkpoint idea as the extracting/assigning/
// runningMorningChecks/refreshingLeads guards already used throughout
// this file, just for a condition none of those cover.
function waitForTabVisible() {
if (!document.hidden) return Promise.resolve();
return new Promise((resolve) => {
function onVisible() {
if (!document.hidden) {
document.removeEventListener('visibilitychange', onVisible);
resolve();
}
}
document.addEventListener('visibilitychange', onVisible);
});
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
const pageType = lastFailedPageType;
lastFailedAssignmentPlan = null;
lastFailedLocateCellFn = null;
lastFailedPageType = null;
await executeAssignmentRun(plan, locateCellFn, pageType);
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
// Tier/callback-type/special-filter toggles were plain label+checkbox
// rows - a bare HTML form look. Styled as chips instead via :has(), so
// the underlying <input> stays a real checkbox (every existing
// :checked/:not(:checked) query elsewhere in the file keeps working
// unchanged) while only the *label* wrapping it changes appearance -
// the input itself is visually hidden (opacity/size, not display:none,
// so it stays focusable/clickable) rather than replaced with a custom
// control.
style.textContent = '.wheel-scroll::-webkit-scrollbar { display: none; } .wheel-scroll:focus { outline: 2px solid #4f46e5; outline-offset: -1px; } .stat-tile-clickable:hover { background: #eef2ff !important; } .chip-label { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 14px; border: 1px solid #cbd5e1; background: white; color: #64748b; font-size: 12px; cursor: pointer; user-select: none; transition: background 0.15s, border-color 0.15s, color 0.15s; } .chip-label input { position: absolute; opacity: 0; width: 0; height: 0; } .chip-label:has(input:checked) { background: #eef2ff; border-color: #4f46e5; color: #4338ca; font-weight: 600; }';
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

// Same reasoning as assignSectionBodyMaxHeight, one level up: that cap
// only applied to FILTERS, but ASSIGN (agents/limit/preview/button/
// results, with FILTERS nested inside it) can independently grow tall
// enough on its own - a long agent list plus a full results log plus
// FILTERS expanded - to push the footer (Clear & Stop, etc.) out past
// the panel box's own overflow:hidden boundary, making it disappear
// entirely rather than just becoming unreachable via scroll. Capped
// looser than the inner FILTERS cap since it has to fit everything
// FILTERS already accounts for, plus the agents list/button/results
// around it.
function assignFullSectionMaxHeight() {
const panelSize = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
return panelSize === 'full' ? '65vh' : '320px';
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
// Not-done count comes from the last window._checkAgentQueuePositions
// snapshot (a point-in-time read of Konnect's own Queue by Agent page,
// scoped to the last 10 queued items per agent) - matched by name
// since that snapshot has no agent id, only the plain name Konnect
// itself displays there.
const queueSnapshot = loadAgentQueueSnapshot();
const queueByName = new Map(queueSnapshot.agents.map((q) => [normalizeAgentName(q.agentName), q]));
return agents.map(a => {
const queueInfo = queueByName.get(normalizeAgentName(a.name));
const queueBadge = queueInfo
? `<span title="${queueInfo.notDoneCount} not yet called, out of the last ${queueInfo.totalShown} queued (as of ${escapeHtml(new Date(queueSnapshot.scannedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))})" style="margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #eef2ff; color: #4338ca;">${queueInfo.notDoneCount}</span>`
: '';
return `
<label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: #1e293b;" ${a.status ? `title="${escapeHtml(a.status)}"` : ''}>
<input type="checkbox" class="assign-agent-checkbox" value="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name)}" ${excludedAgentIds.has(a.id) ? '' : 'checked'} onchange="window._updateAssignPreview()">
<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusDotColor(a.status)}; flex-shrink: 0;"></span>
${escapeHtml(a.name)}${queueBadge}
</label>`;
}).join('');
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
<div id="slaDueSummary" style="padding: 12px 20px 0; background: #f8fafc; font-size: 13px; color: #1e293b;">
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${tiles}</div>
<div style="font-size: 11px; font-weight: 700; color: ${CUSTOMER_FIRST_ACCENT}; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Customer First</div>
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${cfTiles}</div>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span style="font-size: 11px; color: #94a3b8;">Assigned ${assignedCount} &middot; Not assigned ${notAssignedCount} &middot; ${lastScannedLabel()}</span>
<button onclick="window._clearWholeQueue()" style="background: #dc2626; color: white; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">${svgIcon('warning', 11)} Clear Queue</button>
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

// Scope for the "Copy for Booking Check" export (feeds a separate,
// external bookmarklet on a different site - see the header popover
// below) - kept entirely separate from ASSIGN_SETTINGS_KEY since this
// is a one-off export scope, not part of the assign filters, and
// deliberately not surfaced anywhere in the main Assign flow at all.
//
// Restored here - this was accidentally deleted along with the
// duplicate Booking Check classifier (a separate, unrelated feature
// that happened to sit inside the same line range removed for that
// cleanup, past where the classifier itself actually ended). Its
// absence broke renderPanelShell unconditionally: every single panel
// render (not just the queue-check-triggered ones this was chased
// through several rounds of live reports for) called the now-missing
// renderBookingCheckExportPopover and threw a ReferenceError, caught
// silently inside extractAndExportSla's own try/catch (logged as "SLA
// Export Error", never surfaced) - and completely uncaught in the
// handful of call sites that render a second time after a Queue by
// Agent check, which is what actually made this visible as "leads
// ingest fine, the queue check runs, then nothing loads." Confirmed
// via a live console/error capture, not guessed.
const BOOKING_CHECK_EXPORT_KEY = '_slaBookingCheckExportSettings';

function loadBookingCheckExportSettings() {
try {
const raw = JSON.parse(localStorage.getItem(BOOKING_CHECK_EXPORT_KEY));
if (raw && Array.isArray(raw.tiers)) return raw;
} catch (error) {
// ignore
}
return { tiers: [2], customerFirstOnly: true };
}

function saveBookingCheckExportSettings(settings) {
try {
localStorage.setItem(BOOKING_CHECK_EXPORT_KEY, JSON.stringify(settings));
} catch (error) {
// ignore
}
}

// Tabs/newlines within a field would corrupt the TSV structure the
// receiving bookmarklet parses by splitting on tabs - stripped rather
// than escaped, since none of these fields should ever legitimately
// contain one.
function tsvSafe(value) {
return String(value || '').replace(/[\t\r\n]+/g, ' ').trim();
}

// Reads from currentCustomers (the same cache the panel itself is
// already showing) rather than re-scanning the table - this is a
// point-in-time snapshot of whatever's already been ingested, not a
// fresh extraction. Name is stripped of its title (Mr./Mrs./etc,
// same as the existing copy-to-clipboard fields elsewhere in this
// panel) since the receiving tool only uses it as supporting
// confirmation, not as a search key.
function buildBookingCheckTsv(tiers, customerFirstOnly) {
const tierSet = new Set(tiers);
const rows = currentCustomers.filter((c) => {
if (!tierSet.has(c.tier)) return false;
if (customerFirstOnly && !(c.source || '').toLowerCase().includes('customer first')) return false;
return true;
});
// Registration dropped per instruction - not something that needs
// copying, and not something the receiving tool can reliably search by
// either (it's often a SALESLEAD-style placeholder rather than a real
// plate, not present on Konnect Live's own customer records to match
// against).
const header = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created'].join('\t');
const lines = rows.map((c) => [
tsvSafe(stripTitle(c.name)), tsvSafe(c.phone), tsvSafe(c.email), tsvSafe(c.source), tsvSafe(c.campaign), tsvSafe(c.createdText)
].join('\t'));
return { tsv: [header, ...lines].join('\n'), count: rows.length };
}

// Deliberately a small popover toggled from a single header icon, not a
// permanent section in the main Assign flow - this only matters
// occasionally (feeding a separate bookmarklet on another site), so it
// shouldn't cost any visible space the rest of the time. Positioned
// absolutely against PANEL_BOX_ID (the nearest positioned ancestor,
// since that box itself is position:fixed) rather than pushing any
// other content down when open.
function renderBookingCheckExportPopover() {
const settings = loadBookingCheckExportSettings();
const selectedTiers = new Set(settings.tiers);
const { count } = buildBookingCheckTsv(settings.tiers, settings.customerFirstOnly);

const tierCheckboxes = [1, 2, 3, 4].map(t => `
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #1e293b;">
<input type="checkbox" class="booking-export-tier" value="${t}" ${selectedTiers.has(t) ? 'checked' : ''} onchange="window._updateBookingCheckExportPreview()">
Tier ${t}
</label>`).join('');

return `
<div id="bookingCheckExportPopover" style="display: none; position: absolute; top: 46px; right: 14px; z-index: 5; width: 200px; background: white; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(15,23,42,0.35); padding: 12px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 8px;">COPY FOR BOOKING CHECK</div>
<div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">${tierCheckboxes}</div>
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #1e293b; margin-bottom: 10px;">
<input type="checkbox" id="bookingExportCustomerFirstOnly" ${settings.customerFirstOnly ? 'checked' : ''} onchange="window._updateBookingCheckExportPreview()">
Customer First only
</label>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span id="bookingExportRowCount" style="font-size: 11px; color: #64748b;">${count} lead${count === 1 ? '' : 's'}</span>
<button onclick="window._copyBookingCheckExport(this)" style="padding: 6px 12px; background: #1e293b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Copy</button>
</div>
</div>`;
}

window._toggleBookingCheckExportPopover = function() {
const popover = document.getElementById('bookingCheckExportPopover');
if (!popover) return;
const importPopover = document.getElementById('bookingCheckImportPopover');
if (importPopover) importPopover.style.display = 'none';
popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
};

window._updateBookingCheckExportPreview = function() {
const tiers = Array.from(document.querySelectorAll('.booking-export-tier:checked')).map(el => Number(el.value));
const customerFirstOnly = document.getElementById('bookingExportCustomerFirstOnly')?.checked || false;
saveBookingCheckExportSettings({ tiers, customerFirstOnly });
const { count } = buildBookingCheckTsv(tiers, customerFirstOnly);
const countEl = document.getElementById('bookingExportRowCount');
if (countEl) countEl.textContent = `${count} lead${count === 1 ? '' : 's'}`;
};

window._copyBookingCheckExport = function(buttonEl) {
const settings = loadBookingCheckExportSettings();
const { tsv, count } = buildBookingCheckTsv(settings.tiers, settings.customerFirstOnly);
const original = buttonEl.textContent;
if (count === 0) {
buttonEl.textContent = 'No leads';
setTimeout(() => { buttonEl.textContent = original; }, 1200);
return;
}
navigator.clipboard.writeText(tsv).then(() => {
buttonEl.textContent = `✓ Copied ${count}`;
setTimeout(() => { buttonEl.textContent = original; }, 1500);
}).catch(() => {
buttonEl.textContent = '✗ Failed';
setTimeout(() => { buttonEl.textContent = original; }, 1500);
});
};

// ===================================================================
// CLASSIFY BOOKING CHECK RESULTS - the reverse handoff. Konnect
// Booking Check's own "Copy raw for Extract" button copies this exact
// column shape to the clipboard; pasted here, it's shown right next to
// the assign-criteria/tier features, instead of round-tripping back
// through Booking Check's own UI for every batch. Deliberately a
// small popover like the export one above, not a permanent section -
// this is an occasional batch operation, not part of the main Assign
// flow. State (raw paste + last results) is persisted so an in-
// progress paste survives a panel rebuild (the same reason the export
// popover's own settings are persisted, not just kept in the DOM).
//
// This used to re-classify every row here too, from a second, ~600-line
// copy of Konnect-Booking-Check.js's own classifier (parseInitialNotes
// Fields, the keyword lists, classifyInitialNotes, bookingPriorityRank -
// "ported verbatim... do not edit one without the other"). That's a real
// drift risk, not a hypothetical one - this copy never got that file's
// later dual-raw-notes-format parser fix before being deleted in favor
// of this. Booking Check now exports its own already-computed Category/
// Reason/PriorityRank columns directly (see its own buildRawNotesTsv
// ForExtract) - trusted as-is below, no second classifier needed.
// ===================================================================

const BOOKING_CHECK_IMPORT_KEY = '_slaBookingCheckImportState';
const BOOKING_CHECK_IMPORT_HEADER = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes', 'Category', 'Reason', 'PriorityRank'];

function loadBookingCheckImportState() {
try {
const raw = JSON.parse(localStorage.getItem(BOOKING_CHECK_IMPORT_KEY));
if (raw && typeof raw === 'object') {
return { rawInput: raw.rawInput || '', results: Array.isArray(raw.results) ? raw.results : [] };
}
} catch (error) {
// ignore
}
return { rawInput: '', results: [] };
}

function saveBookingCheckImportState(state) {
try {
localStorage.setItem(BOOKING_CHECK_IMPORT_KEY, JSON.stringify(state));
} catch (error) {
// ignore
}
}

// Booking Check's own export sanitizes Initial Notes and Reason (tabs ->
// spaces, newlines -> " | ") before copying, so a plain split on tab
// always yields exactly 10 cells here - no special last-column joining
// needed.
function parseBookingCheckImportTsv(rawText) {
const lines = String(rawText || '').split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
if (lines.length === 0) return { rows: [], headerOk: false, error: 'No input.' };

const header = lines[0].split('\t').map((h) => h.trim());
const headerOk = header.length === BOOKING_CHECK_IMPORT_HEADER.length && header.every((h, i) => h === BOOKING_CHECK_IMPORT_HEADER[i]);
if (!headerOk) {
return { rows: [], headerOk: false, error: `Header does not match expected columns: ${BOOKING_CHECK_IMPORT_HEADER.join('\t')}` };
}

const rows = lines.slice(1).map((line) => {
const cells = line.split('\t');
// Number('') is 0, not NaN - a blank/malformed rank must NOT silently
// become top priority, so blankness is checked before parsing, not
// left to Number.isFinite alone (confirmed by this file's own self-
// test below, which caught exactly this on the first pass).
const rawRank = (cells[9] || '').trim();
const parsedRank = rawRank === '' ? NaN : Number(rawRank);
return {
name: (cells[0] || '').trim(),
phone: (cells[1] || '').trim(),
email: (cells[2] || '').trim(),
source: (cells[3] || '').trim(),
campaign: (cells[4] || '').trim(),
created: (cells[5] || '').trim(),
initialNotes: (cells[6] || '').trim(),
category: (cells[7] || '').trim(),
reason: (cells[8] || '').trim(),
priorityRank: Number.isFinite(parsedRank) ? parsedRank : 7
};
});
return { rows, headerOk: true, error: null };
}

// Booking Check has already classified and ranked every row before
// exporting - this just orders by the rank it computed, no
// classification of its own left to do.
function classifyBookingCheckImportRows(rows) {
return [...rows].sort((a, b) => a.priorityRank - b.priorityRank);
}

// Confirms the header contract and the trust-not-reclassify behavior -
// this file no longer has a classifier of its own to get out of sync,
// so what's actually worth guarding here is that parsing reads the
// right columns and that sort order follows the imported rank exactly,
// not any re-derivation from category/notes.
(function bookingCheckImportSelfTest() {
const failures = [];
const sampleTsv = [
BOOKING_CHECK_IMPORT_HEADER.join('\t'),
['Amy Adams', '07700900001', 'amy@example.com', 'Customer First', 'Citroen - Enquiry - New', '01/09/2026', 'Customer Comments: -', 'NON-BOOKING', 'No date field present.', '7'].join('\t'),
['Ben Brown', '07700900002', 'ben@example.com', 'Customer First', 'Citroen - Enquiry - New', '02/09/2026', 'Customer Comments: See you at 3pm', 'CONFIRMED DATE & TIME', 'Exact time in comments.', '1'].join('\t'),
['Cara Chen', '07700900003', 'cara@example.com', 'Customer First', 'Citroen - Enquiry - New', '03/09/2026', 'Customer Comments: possibly interested in a C3', 'NON-BOOKING', 'Genuine interest, no visit intent.', '5'].join('\t')
].join('\n');

const parsed = parseBookingCheckImportTsv(sampleTsv);
if (!parsed.headerOk) failures.push(`Expected the real export header to parse OK, got error: ${parsed.error}`);
if (parsed.rows.length !== 3) failures.push(`Expected 3 parsed rows, got ${parsed.rows.length}`);
if (parsed.rows[1] && parsed.rows[1].category !== 'CONFIRMED DATE & TIME') failures.push(`Expected row 2's category to be read straight from the Category column, got "${parsed.rows[1].category}"`);
if (parsed.rows[1] && parsed.rows[1].priorityRank !== 1) failures.push(`Expected row 2's priorityRank to be read straight from the PriorityRank column, got ${parsed.rows[1].priorityRank}`);

const ordered = classifyBookingCheckImportRows(parsed.rows);
if (!(ordered[0] && ordered[0].name === 'Ben Brown')) failures.push(`Expected Ben Brown (rank 1) to sort first, got "${ordered[0] && ordered[0].name}"`);
if (!(ordered[1] && ordered[1].name === 'Cara Chen')) failures.push(`Expected Cara Chen (rank 5) to sort second, got "${ordered[1] && ordered[1].name}"`);
if (!(ordered[2] && ordered[2].name === 'Amy Adams')) failures.push(`Expected Amy Adams (rank 7) to sort third, got "${ordered[2] && ordered[2].name}"`);

const badHeader = parseBookingCheckImportTsv('Name\tPhone\tEmail');
if (badHeader.headerOk) failures.push('Expected a mismatched/old-shape header to be rejected, not accepted');

const missingRank = parseBookingCheckImportTsv([
BOOKING_CHECK_IMPORT_HEADER.join('\t'),
['Dee Dixon', '07700900004', 'dee@example.com', 'Customer First', 'Citroen - Enquiry - New', '04/09/2026', '-', 'NON-BOOKING', '', ''].join('\t')
].join('\n'));
if (!(missingRank.rows[0] && missingRank.rows[0].priorityRank === 7)) failures.push(`Expected a blank/malformed PriorityRank to default to 7 (lowest priority), got ${missingRank.rows[0] && missingRank.rows[0].priorityRank}`);

if (failures.length > 0) {
console.error('SLA Extract booking-check-import self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Extract booking-check-import self-test passed (9/9)');
}
})();

function bookingCheckImportCategoryColor(category) {
if (category === 'CONFIRMED DATE & TIME') return '#059669';
if (category === 'DATE ONLY') return '#d97706';
if (category === 'WARM ENQUIRY') return '#2563eb';
if (category === 'NON-BOOKING') return '#64748b';
return '#1e293b';
}

// Same normalization as Konnect-Booking-Check.js's own normalizeEmail/
// normalizePhone, so a lead classified there matches back to the exact
// same customer here regardless of formatting differences (spacing,
// +44 vs leading 0, etc).
function normalizeEmailForBookingCheckMatch(value) {
return String(value || '').trim().toLowerCase();
}

function normalizePhoneForBookingCheckMatch(value) {
const digits = String(value || '').replace(/\D+/g, '');
if (digits.startsWith('44')) return '0' + digits.slice(2);
return digits;
}

// The whole point of classifying here instead of in Konnect Booking
// Check's own UI is to see the result on the SAME card used to assign/
// view contact details - not a second, disconnected flat list. Matched
// by email (preferred) or phone, since Booking Check's raw export
// never carries Registration or this panel's own `key`; Created
// disambiguates the rare case of multiple rows sharing one contact
// (the same customer with two separate leads).
function findBookingCheckResultForCustomer(c, results) {
if (!results || results.length === 0) return null;
const emailKey = normalizeEmailForBookingCheckMatch(c.email);
const phoneKey = normalizePhoneForBookingCheckMatch(c.phone);
const candidates = results.filter((r) => {
const rEmailKey = normalizeEmailForBookingCheckMatch(r.email);
if (emailKey && rEmailKey) return emailKey === rEmailKey;
const rPhoneKey = normalizePhoneForBookingCheckMatch(r.phone);
if (phoneKey && rPhoneKey) return phoneKey === rPhoneKey;
return false;
});
if (candidates.length <= 1) return candidates[0] || null;
return candidates.find((r) => r.created === c.createdText) || candidates[0];
}

// The point of classifying here (rather than reading results in
// Konnect Booking Check's own UI) is to see them on the real lead
// cards below - alongside Assign, contact details, everything already
// built for that - not a second flat list duplicating what Booking
// Check already shows. This popover is just the input mechanism
// (paste + Classify); the actual results render as a badge on each
// matching card via findBookingCheckResultForCustomer, and the panel
// re-renders immediately after classifying so they show up right away.
function renderBookingCheckImportPopover() {
const state = loadBookingCheckImportState();
const matchedCount = state.results.filter((r) => currentCustomers.some((c) => findBookingCheckResultForCustomer(c, [r]))).length;
const summary = state.results.length === 0
? `<div style="font-size: 12px; color: #94a3b8; padding: 8px 0 0;">Paste results from Konnect Booking Check's "Copy raw for Extract" button, then press Classify - they'll show up as a badge on the matching lead card below.</div>`
: `<div style="font-size: 12px; color: #64748b; padding: 8px 0 0;">${state.results.length} classified, ${matchedCount} matched to a lead in the current list below.${state.results.length !== matchedCount ? ' The rest aren\'t in the current SLA list (already assigned, expired, or a different queue).' : ''}</div>`;

return `
<div id="bookingCheckImportPopover" style="display: none; position: absolute; top: 46px; right: 46px; z-index: 5; width: 320px; background: white; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(15,23,42,0.35); padding: 12px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 8px;">CLASSIFY BOOKING CHECK RESULTS</div>
<button onclick="window._pasteAndClassifyBookingCheck(this)" style="width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; margin-bottom: 8px;">${svgIcon('copy', 13)}Paste from clipboard & Classify</button>
<div style="font-size: 10px; color: #94a3b8; text-align: center; margin-bottom: 8px;">or paste manually below</div>
<textarea id="bookingCheckImportBox" placeholder="Paste TSV from Konnect Booking Check" oninput="window._updateBookingCheckImportInput(this.value)" style="width: 100%; height: 60px; box-sizing: border-box; font-family: monospace; font-size: 11px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px;">${escapeHtml(state.rawInput)}</textarea>
<div style="display: flex; justify-content: flex-end; margin-top: 8px;">
<button onclick="window._classifyBookingCheckImport(this)" style="padding: 6px 12px; background: #1e293b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Classify</button>
</div>
${summary}
</div>`;
}

window._toggleBookingCheckImportPopover = function() {
const popover = document.getElementById('bookingCheckImportPopover');
if (!popover) return;
const exportPopover = document.getElementById('bookingCheckExportPopover');
if (exportPopover) exportPopover.style.display = 'none';
popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
};

window._updateBookingCheckImportInput = function(value) {
const state = loadBookingCheckImportState();
saveBookingCheckImportState({ rawInput: value, results: state.results });
};

// Shared by the manual textarea+Classify button and the one-click
// Paste-from-clipboard button - both end up needing the exact same
// parse/classify/save/re-render sequence, just sourced from a
// different place (the textarea's current value vs a fresh clipboard
// read). buttonEl's feedback text is restored via a caller-supplied
// label so each entry point's own idle state (a plain icon+label
// button in one case) survives round-tripping through this.
function runBookingCheckClassification(rawInput, buttonEl, originalLabel) {
const parsed = parseBookingCheckImportTsv(rawInput);
if (!parsed.headerOk) {
buttonEl.textContent = 'Bad header';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 1500);
return false;
}
if (parsed.rows.length === 0) {
buttonEl.textContent = 'No rows';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 1200);
return false;
}
const results = classifyBookingCheckImportRows(parsed.rows);
saveBookingCheckImportState({ rawInput, results });
// Full panel re-render, not just this popover - the whole point is
// getting results onto the real lead cards (findBookingCheckResultFor
// Customer, rendered per-card in renderTierSection), not just updating
// this popover's own summary text. buttonEl itself is about to be
// replaced along with the rest of the panel, so nothing below
// references it again.
displayPanel(currentCustomers);
const reopened = document.getElementById('bookingCheckImportPopover');
if (reopened) reopened.style.display = 'block';
return true;
}

window._classifyBookingCheckImport = function(buttonEl) {
const box = document.getElementById('bookingCheckImportBox');
const rawInput = box ? box.value : '';
runBookingCheckClassification(rawInput, buttonEl, buttonEl.textContent);
};

// One click instead of three (switch to the other tab/window, copy,
// switch back, paste into the textarea, click Classify) - reads the
// clipboard directly via the async Clipboard API. That API requires
// clipboard-read permission and can be blocked entirely in some
// contexts (exactly the kind of restricted, third-party-injected-
// iframe context copyTextToClipboard's own history in this file's
// sibling already flagged as real for the WRITE side) - falls back to
// telling the user to paste manually rather than failing silently, so
// the existing textarea+Classify path always still works regardless.
window._pasteAndClassifyBookingCheck = async function(buttonEl) {
const originalLabel = buttonEl.innerHTML;
if (!navigator.clipboard || !navigator.clipboard.readText) {
buttonEl.textContent = 'Paste manually below';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 1800);
return;
}
buttonEl.textContent = 'Reading…';
try {
const rawInput = await navigator.clipboard.readText();
const box = document.getElementById('bookingCheckImportBox');
if (box) box.value = rawInput;
saveBookingCheckImportState({ rawInput, results: loadBookingCheckImportState().results });
const ok = runBookingCheckClassification(rawInput, buttonEl, originalLabel);
if (ok) return; // displayPanel already rebuilt this button with a fresh label
} catch (error) {
buttonEl.textContent = 'Clipboard blocked - paste manually';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 2000);
}
};

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
// Two independent collapse levels, not one: ASSIGN (agents/limit/
// preview/button/results) is the bulk of this zone's height, and an
// earlier pass made it permanently visible on the assumption that
// "always visible" was strictly better - it isn't, especially at the
// compact/mini panel size, where that alone can push the actual lead
// list out of view. Collapsible again, defaulting open so nothing
// changes for anyone who hasn't touched it yet. FILTERS nests inside
// it (collapsed independently, and only reachable at all while ASSIGN
// is open) since tier/callback-type/time-window filters only matter
// when you're about to run a manual assign.
function renderAssignSectionShell(settings, agentCheckboxes, buttonDisabled, runHandlerName, filtersZoneHtml) {
const filtersOpen = !!settings.filtersOpen;
const assignOpen = settings.assignOpen !== false;
return `
<div id="assignSectionContainer" style="padding: 0 20px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
<div onclick="window._toggleAssignSection()" style="cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 6px 0; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px;">
${chevronIcon(!assignOpen, 'assignSectionToggle')} ASSIGN
</div>
<div id="assignSectionBody" style="display: ${assignOpen ? 'block' : 'none'}; max-height: ${assignFullSectionMaxHeight()}; overflow-y: auto; padding-right: 6px;">
<div style="margin-bottom: 10px;">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
<span style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px;">AGENTS ONLINE</span>
<span style="display: flex; gap: 8px;">
<span onclick="window._setAllAgentCheckboxes(true)" style="font-size: 11px; color: #4f46e5; cursor: pointer;">All</span>
<span onclick="window._setAllAgentCheckboxes(false)" style="font-size: 11px; color: #4f46e5; cursor: pointer;">None</span>
<span onclick="window._refreshAssignSection()" style="font-size: 11px; color: #4f46e5; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">${svgIcon('refresh', 11)} Refresh</span>
<span onclick="window._toggleAssignHistory()" style="font-size: 11px; color: #4f46e5; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">${svgIcon('history', 11)} History</span>
<span onclick="window._checkAgentQueuePositions(this)" title="Reads each agent's live call queue from Konnect's own Queue by Agent page - shows how many leads each agent hasn't called yet, and where a given lead sits in that queue" style="font-size: 11px; color: #4f46e5; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">${svgIcon('checklist', 11)} Queue</span>
</span>
</div>
<div id="assignAgentList" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">${agentCheckboxes}</div>
<div id="assignHistoryPanel" style="display: none; margin-top: 6px; padding: 8px; background: white; border-radius: 4px; font-size: 11px; color: #1e293b;"></div>
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
<div onclick="window._toggleFiltersZone()" style="cursor: pointer; display: flex; align-items: center; gap: 6px; margin-top: 14px; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px;">
${chevronIcon(!filtersOpen, 'filtersZoneToggle')} FILTERS
</div>
<div id="filtersZoneBody" style="display: ${filtersOpen ? 'block' : 'none'}; max-height: ${assignSectionBodyMaxHeight()}; overflow-y: auto; margin-top: 10px; padding-right: 6px;">
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
<label class="chip-label">
<input type="checkbox" class="assign-tier-checkbox" value="${t}" ${excludedTiers.has(t) ? '' : 'checked'} onchange="window._updateAssignPreview()">
Tier ${t} <span id="tier-count-${t}" style="opacity: 0.7;">(${tierCounts[t - 1]})</span>
</label>`).join('');

const agentCheckboxes = renderAgentCheckboxes(agents, excludedAgentIds);
const buttonDisabled = agents.length === 0;

const filtersZoneHtml = `
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">TIERS</div>
<div style="display: flex; gap: 6px; flex-wrap: wrap;">${tierCheckboxes}</div>
</div>
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">SPECIAL FILTERS</div>
<div style="display: flex; gap: 6px; flex-wrap: wrap;">
<label class="chip-label">
<input type="checkbox" id="assignCustomerFirstOnly" ${settings.customerFirstOnly ? 'checked' : ''} onchange="window._updateAssignPreview()">
Customer First <span style="opacity: 0.7;">(${customerFirstCount})</span>
</label>
<label class="chip-label">
<input type="checkbox" id="assignEmailOnly" ${settings.emailOnly ? 'checked' : ''} onchange="window._updateAssignPreview()">
Email only <span style="opacity: 0.7;">(${emailOnlyCount})</span>
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
<div id="pendingDueSummary" style="padding: 12px 20px 0; background: #f8fafc; font-size: 13px; color: #1e293b;">
<div style="display: flex; gap: 6px; margin-bottom: 8px;">${tiles}</div>
<div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${callbackLine}</div>
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
<span style="font-size: 11px; color: #94a3b8;">Assigned ${assignedCount} &middot; Not assigned ${notAssignedCount} &middot; ${lastScannedLabel()}</span>
<button onclick="window._clearWholeQueue()" style="background: #dc2626; color: white; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">${svgIcon('warning', 11)} Clear Queue</button>
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
<label class="chip-label">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${excludedCallbackTypes.has(type) ? '' : 'checked'} onchange="window._updateAssignPreview()">
${escapeHtml(type)} <span id="cb-count-${slugify(type)}" style="opacity: 0.7;">(${countFor(type)})</span>
</label>`).join('');

const advancedCheckboxes = CALLBACK_TYPES_ADVANCED.map(type => `
<label class="chip-label">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${includedAdvancedCallbackTypes.has(type) ? 'checked' : ''} onchange="window._updateAssignPreview()">
${escapeHtml(type)} <span id="cb-count-${slugify(type)}" style="opacity: 0.7;">(${countFor(type)})</span>
</label>`).join('');

const agentCheckboxes = renderAgentCheckboxes(agents, excludedAgentIds);
const buttonDisabled = agents.length === 0;
const defaultCutoff = settings.cutoffTime || formatTimeForInput(defaultHourCutoff());
const advancedOpenStyle = settings.advancedOpen ? 'display: flex;' : 'display: none;';

const filtersZoneHtml = `
<div style="margin-bottom: 10px;">
<div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; margin-bottom: 6px;">CALLBACK TYPE</div>
<div style="display: flex; gap: 6px; flex-wrap: wrap;">${primaryCheckboxes}</div>
<div onclick="window._toggleAdvancedCallbackTypes()" style="margin-top: 6px; font-size: 11px; color: #4f46e5; cursor: pointer;">
${chevronIcon(!settings.advancedOpen, 'advancedCallbackToggle')} Advanced (Manual Rescheduled, Post Closure)
</div>
<div id="advancedCallbackTypes" style="${advancedOpenStyle} gap: 6px; flex-wrap: wrap; margin-top: 6px;">${advancedCheckboxes}</div>
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
return `<div style="margin-bottom: 16px; padding: 10px 4px; border-bottom: 2px solid ${color};">
<span style="color: ${color}; font-size: 15px; font-weight: 700;">${escapeHtml(typeName)}</span>
<span style="margin-left: 10px; color: #94a3b8; font-size: 13px;">No customers</span>
</div>`;
}

const collapsed = isSectionCollapsed(sectionId);
// Loaded once per section (not per card) - same pattern as
// renderTierSection's own bookingCheckResults.
const bookingCheckResults = loadBookingCheckImportState().results;
return `<div style="margin-bottom: 16px;">
<div onclick="window._toggleCallbackType('${sectionId}')" style="cursor: pointer; padding: 10px 4px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${color};">
<div>
<span style="font-weight: 700; color: #1e293b; font-size: 15px;">${escapeHtml(typeName)}</span>
<span style="font-size: 13px; color: #94a3b8; margin-left: 10px;">${customers.length}</span>
</div>
<span style="color: ${color};">${chevronIcon(collapsed, 'toggle-' + sectionId)}</span>
</div>
<div id="${sectionId}" class="collapsible-section" style="display: ${collapsed ? 'none' : 'block'};">
${customers.map(c => {
const queuePosition = findAgentQueuePositionForLead({ email: c.email, phone: c.mobile });
const bookingCheck = findBookingCheckResultForCustomer({ email: c.email, phone: c.mobile }, bookingCheckResults);
const bookingCheckTitle = bookingCheck ? [bookingCheck.reason, bookingCheck.initialNotes].filter(Boolean).join('\n\n') : '';
return `<div class="customer-card" data-customer-name="${escapeHtml(c.name.toLowerCase())}" style="padding: 12px 4px; border-bottom: 1px solid #e2e8f0;">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; font-weight: 700; color: #1e293b; font-size: 15px;">${escapeHtml(c.name)}</span>
${renderAssignmentCell(c.assigned, c.agentName, c.key, PAGE_PENDING)}
</div>
<div style="margin-bottom: 10px;">
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">NEXT ACTION</div>
<span style="font-size: 13px; color: #1e293b;">${c.nextActionDate ? escapeHtml(c.nextActionDate.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'Unknown'}</span>
</div>
${bookingCheck ? `<div style="margin-bottom: 10px;"><span title="${escapeHtml(bookingCheckTitle)}" style="cursor: help; display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: ${bookingCheckImportCategoryColor(bookingCheck.category)}1a; color: ${bookingCheckImportCategoryColor(bookingCheck.category)};">${escapeHtml(bookingCheck.category)}</span></div>` : ''}
${renderQueuePositionBadge(c.assigned, queuePosition)}
${renderContactToggle(`
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">MOBILE</div>
${renderCopyableField(c.mobile)}
</div>
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">LANDLINE</div>
${renderCopyableField(c.landline)}
</div>
`)}
<div style="display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px;">
<span style="color: #64748b;">${escapeHtml(c.brand || '')}</span>
<span style="color: #059669;">${escapeHtml(c.campaign || '')}</span>
</div>
</div>`;
}).join('')}
</div>
</div>`;
}

function renderTierSection(tierName, customers, color, tierId) {
if (customers.length === 0) {
return `<div style="margin-bottom: 16px; padding: 10px 4px; border-bottom: 2px solid ${color};">
<span style="color: ${color}; font-size: 15px; font-weight: 700;">${tierName}</span>
<span style="margin-left: 10px; color: #94a3b8; font-size: 13px;">No customers</span>
</div>`;
}

const collapsed = isSectionCollapsed(tierId);
// Loaded once per tier section (not per card) - the whole point of
// classifying in this panel rather than Konnect Booking Check's own
// UI is to see the result on this exact card, next to Assign/contact
// details, instead of a second disconnected list.
const bookingCheckResults = loadBookingCheckImportState().results;
return `<div style="margin-bottom: 16px;">
<div onclick="window._toggleTier('${tierId}')" style="cursor: pointer; padding: 10px 4px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${color};">
<div>
<span style="font-weight: 700; color: #1e293b; font-size: 15px;">${tierName}</span>
<span style="font-size: 13px; color: #94a3b8; margin-left: 10px;">${customers.length}</span>
</div>
<span style="color: ${color};">${chevronIcon(collapsed, 'toggle-' + tierId)}</span>
</div>
<div id="${tierId}" class="collapsible-section" style="display: ${collapsed ? 'none' : 'block'};">
${customers.map(c => {
const urgency = slaUrgencyInfo(c);
const bookingCheck = findBookingCheckResultForCustomer(c, bookingCheckResults);
const bookingCheckTitle = bookingCheck ? [bookingCheck.reason, bookingCheck.initialNotes].filter(Boolean).join('\n\n') : '';
const queuePosition = findAgentQueuePositionForLead(c);
return `<div class="customer-card" data-customer-name="${escapeHtml(c.name.toLowerCase())}" style="padding: 12px 4px 12px 10px; border-bottom: 1px solid #e2e8f0; ${urgency.emphasize ? `border-left: 3px solid ${urgency.color}; background: ${urgency.color}0d;` : ''}">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; font-weight: 700; color: #1e293b; font-size: 15px;">${escapeHtml(c.name)}</span>
${renderAssignmentCell(c.assigned, c.agentName, c.key, PAGE_SLA)}
</div>
${urgency.label ? `<div style="margin-bottom: 10px;"><span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: ${urgency.color}1a; color: ${urgency.color};">${urgency.label}</span></div>` : ''}
${bookingCheck ? `<div style="margin-bottom: 10px;"><span title="${escapeHtml(bookingCheckTitle)}" style="cursor: help; display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: ${bookingCheckImportCategoryColor(bookingCheck.category)}1a; color: ${bookingCheckImportCategoryColor(bookingCheck.category)};">${escapeHtml(bookingCheck.category)}</span></div>` : ''}
${renderQueuePositionBadge(c.assigned, queuePosition)}
${renderContactToggle(`
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">PHONE</div>
${renderCopyableField(c.phone)}
</div>
<div>
<div style="color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
`)}
<div style="display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px;">
<span style="color: #64748b;">${escapeHtml(c.source)}</span>
<span style="color: #059669;">${escapeHtml(c.campaign)}</span>
</div>
</div>`;
}).join('')}
</div>
</div>`;
}

function renderPanelShell({ title, count, newCount, removedCount, summaryHtml, assignSectionHtml, bodyHtml, hideSearch, onTitleClick, showBookingCheckExport, showBookingCheckImport }) {
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

<div style="position: sticky; top: 0; background: #1e293b; color: white; padding: 10px 14px;
display: flex; justify-content: space-between; align-items: center;
flex-shrink: 0;">
<div style="display: flex; align-items: center; gap: 8px;">
<h2 ${onTitleClick ? `onclick="${onTitleClick}" title="Click to refresh the leads and this panel" style="margin: 0; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;"` : `style="margin: 0; font-size: 15px; font-weight: 700;"`}>${title}${onTitleClick ? svgIcon('refresh', 12, ' opacity: 0.55;') : ''}</h2>
<span style="color: #94a3b8; font-size: 13px;">${count}</span>
${newCount > 0 ? `<span style="color: #d97706; font-size: 13px; font-weight: 600;">+${newCount}</span>` : ''}
${removedCount > 0 ? `<span style="color: #94a3b8; font-size: 13px; font-weight: 600;">−${removedCount}</span>` : ''}
</div>
<div style="display: flex; gap: 2px;">
${showBookingCheckExport ? `<button onclick="window._toggleBookingCheckExportPopover();"
style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 4px; transition: background 0.15s, color 0.15s; display: flex; align-items: center;"
onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';"
title="Copy for Booking Check">${svgIcon('copy', 14)}</button>` : ''}
${showBookingCheckImport ? `<button onclick="window._toggleBookingCheckImportPopover();"
style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 4px; transition: background 0.15s, color 0.15s; display: flex; align-items: center;"
onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';"
title="Classify Booking Check results">${svgIcon('inbox', 14)}</button>` : ''}
<button onclick="window._toggleMorningChecks();"
style="background: ${currentPanelMode === 'morningChecks' ? 'rgba(255,255,255,0.15)' : 'transparent'}; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 4px; transition: background 0.15s, color 0.15s; display: flex; align-items: center;"
onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white';" onmouseout="this.style.background='${currentPanelMode === 'morningChecks' ? 'rgba(255,255,255,0.15)' : 'transparent'}'; this.style.color='#94a3b8';"
title="${currentPanelMode === 'morningChecks' ? 'Back to queue view' : 'Morning Checks'}">${svgIcon('checklist', 14)}</button>
<button id="_slaSizeBtn" onclick="window._togglePanelSize();"
style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 4px; transition: background 0.15s, color 0.15s; display: flex; align-items: center;"
onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';"
title="${isFull ? 'Shrink to box' : 'Expand to full height'}">${svgIcon(isFull ? 'shrink' : 'expand', 14)}</button>
<button onclick="document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0;"
style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 4px; transition: background 0.15s, color 0.15s; display: flex; align-items: center;"
onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';"
title="Top">${svgIcon('arrowUp', 14)}</button>
<button id="_slaMinimizeBtn" onclick="window._toggleMinimizePanel();"
style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 4px; transition: background 0.15s, color 0.15s; display: flex; align-items: center;"
onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';"
title="Minimize">${svgIcon(isMinimized ? 'restore' : 'minimize', 14)}</button>
</div>
</div>

${showBookingCheckExport ? renderBookingCheckExportPopover() : ''}
${showBookingCheckImport ? renderBookingCheckImportPopover() : ''}
${summaryHtml || ''}
${assignSectionHtml}

<div class="panelContent" style="flex: 1; overflow-y: auto; padding: 20px; padding-right: 12px;">
${hideSearch ? '' : `
<div style="position: sticky; top: 0; z-index: 2; background: #f8fafc; padding-bottom: 10px; margin-bottom: 10px;">
<input type="text" id="customerSearchInput" placeholder="Search by name…" oninput="window._filterCustomerSearch(this.value)"
style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; color: #1e293b; background: white;">
</div>`}
${bodyHtml}
</div>

<div style="border-top: 1px solid #cbd5e1; padding: 8px 14px; background: white; flex-shrink: 0; display: flex; justify-content: flex-end; align-items: center; box-shadow: 0 -2px 8px rgba(15,23,42,0.05);">
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

// invalidateCache defaults to true (every existing caller relies on
// this forcing a fresh collectAssignableLeads() scrape when genuinely
// new table data just landed) - but the queue-position-only re-renders
// (handleBadgeClick's second render, the post-assign auto re-scan,
// _checkAgentQueuePositions, _clearWholeQueue) pass false, since none
// of them changed what's actually in the SLA/Pending table - only the
// Queue by Agent badges - and forcing a fresh live-DOM scrape right
// after navigating away and back to get those badges was exactly the
// race that kept reading the table before Angular had repopulated it
// (a wait alone couldn't fully close this - reusing the already-correct
// cache/currentCustomers instead avoids touching the live DOM at all
// for this render).
function displayPanel(customers, newCount = 0, removedCount = 0, invalidateCache = true) {
currentCustomers = customers;
currentPageType = PAGE_SLA;
currentPanelMode = 'normal';
if (invalidateCache) invalidateLeadsCache();
const tiered = {
tier1: sortByUrgency(customers.filter(c => c.tier === 1)),
tier2: sortByUrgency(customers.filter(c => c.tier === 2)),
tier3: sortByUrgency(customers.filter(c => c.tier === 3)),
tier4: sortByUrgency(customers.filter(c => c.tier === 4))
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
bodyHtml,
onTitleClick: 'window._refreshLeadsAndPanel()',
showBookingCheckExport: true,
showBookingCheckImport: true
}));
}

// See displayPanel's own comment on invalidateCache - same reasoning.
function displayPendingPanel(customers, newCount = 0, removedCount = 0, invalidateCache = true) {
currentPendingCustomers = customers;
currentPageType = PAGE_PENDING;
currentPanelMode = 'normal';
if (invalidateCache) invalidateLeadsCache();

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
bodyHtml,
onTitleClick: 'window._refreshLeadsAndPanel()',
showBookingCheckImport: true
}));
}

async function extractAndExportSla() {
if (extracting || assigning || runningMorningChecks) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('SLA Table not found');
return;
}
await waitForLeadsTableRows(table);

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
// Assign state, SLA date and status are all read fresh every scan,
// even for cached leads below - unlike phone/email, due/status change
// (or at least need re-evaluating against the current time) and must
// never be stale.
const assignState = getAssignCellState(cells[COL_ASSIGN]);
const slaDate = parseKonnectDate(cells[COL_SLA_DATE]?.textContent?.trim() || '');
const status = cells[COL_STATUS]?.textContent?.trim();
// Kept as the raw displayed text, not parsed into a Date - this is
// only ever surfaced verbatim (the Booking Check export), where the
// receiving tool needs to parse it itself against Konnect Live's own
// displayed format, not a value that's already been through a second
// layer of reformatting here.
const createdText = cells[COL_CREATED]?.textContent?.trim() || '';
rowDescriptors.push({ cells, name, registration, source, campaign, key, assigned: assignState.assigned, agentName: assignState.agentName, slaDate, status, createdText });
}

const pendingCount = rowDescriptors.filter(d => !previousByKey.has(d.key)).length;
let remaining = pendingCount;
setBadgeProgress(remaining);
// Only the newly-seen leads below actually click into a detail modal
// (cached ones are skipped entirely) - that's what pops the modal
// open/closed rapidly per row and reads as the screen glitching, so
// the overlay is only worth showing when there's actually one or more
// of those, not on every routine scan. The badge's own countdown
// (setBadgeProgress) is what used to show this - it's still updated
// the same way below, but the overlay now sits on top of it (same
// z-index, later in the DOM) for the exact pages this most often runs
// on, so the remaining count needs to live in the overlay text too or
// it's invisible for the whole ingestion.
if (pendingCount > 0) showPageFlashOverlay(`Loading new leads… (${remaining} left)`);

for (const d of rowDescriptors) {
const existing = previousByKey.get(d.key);
if (existing) {
// Keep cached phone/email, but never the cached assigned/agentName/
// slaDate/status/createdText - those are re-read fresh above on every
// scan regardless of cache hit. registration is folded into the key
// itself, so it can't change without also changing d.key, but it's
// re-taken from d anyway for consistency with everything else here.
customers.push({ ...existing, registration: d.registration, assigned: d.assigned, agentName: d.agentName, slaDate: d.slaDate, status: d.status, createdText: d.createdText });
continue;
}

try {
await waitForTabVisible();
const tierInfo = categorizeTier(d.campaign, d.source);
const details = await extractCustomerDetails(d.cells[0]);

customers.push({
key: d.key,
name: d.name,
registration: d.registration,
campaign: d.campaign,
source: d.source,
tier: tierInfo.tier,
reason: tierInfo.reason,
phone: details.phone,
email: details.email,
assigned: d.assigned,
agentName: d.agentName,
slaDate: d.slaDate,
status: d.status,
createdText: d.createdText
});
addedCount++;
} catch (error) {
console.warn('Error processing row:', error);
} finally {
remaining--;
setBadgeProgress(remaining);
showPageFlashOverlay(`Loading new leads… (${remaining} left)`);
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
hidePageFlashOverlay();
}
}

// No modal click-and-wait needed here - Email/Mobile/Landline are plain
// text columns, so this is a single synchronous pass over the table.
async function extractAndExportPending() {
if (extracting || assigning || runningMorningChecks) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('Pending Customers table not found');
return;
}
await waitForLeadsTableRows(table);

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
return extractAndExportSla();
} else if (pageType === PAGE_PENDING) {
return extractAndExportPending();
} else {
console.error('SLA Manager: unrecognized page - expected the SLA queue or Pending Customers queue.');
if (badge) {
const original = badge.innerHTML;
badge.innerHTML = svgIcon('warning', 22);
setTimeout(() => { badge.innerHTML = original; }, 1500);
}
return Promise.resolve();
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

// Clicking the badge is a deliberate "show me the panel" request, unlike
// the background auto-detect poll's silent rebuilds on a page switch -
// those are meant to preserve whatever minimized state already exists
// (see renderPanelShell), but a real click should always win over a
// leftover minimized state from earlier in the session, or the panel
// has no way back: it carries its own restore button, so once it's
// off-screen, that button is off-screen with it, and only an explicit
// "show it" action - not a rebuild that merely preserves state - can
// recover from that.
async function handleBadgeClick() {
localStorage.setItem(PANEL_STATE_KEY, 'visible');
// Morning Checks routinely leaves the visible tab sitting on pages
// runExtraction()/detectPageType() don't recognize at all (Live
// Campaigns, Inbound API, Voicemails, Queue by Agent) - previously,
// minimizing while on one of those meant the badge (the only way back,
// since a minimized panel's own restore button is off-screen with the
// rest of it) just flashed a warning icon and did nothing, with no way
// to reopen the panel until navigating back to the SLA/Pending page.
if (currentPanelMode === 'morningChecks') {
displayMorningChecks();
return;
}
// Also forces Konnect's own native refresh rather than just re-reading
// whatever's currently sitting in the DOM (same flow as clicking the
// panel title - see window._refreshLeadsAndPanel) - "show me the
// panel" and "make sure it's actually current" are the same ask when
// you're the one pressing the button to bring it up.
await window._refreshLeadsAndPanel();
// Per instruction: activating the panel this way should also scan
// Queue by Agent for fresh queue positions, same as already happens
// automatically after a successful assign run. Sequenced after the
// above (not run alongside it) since both navigate/manipulate the
// page - running them concurrently would race.
showPageFlashOverlay('Checking agent queues…');
try {
try {
await refreshAgentQueueSnapshot();
// Same gap as window._checkAgentQueuePositions/_clearWholeQueue: the
// navigate-away-and-back this just did only changes the route -
// Angular still needs a moment to actually repopulate the SLA/Pending
// table afterward. Rendering immediately here (this is the actual
// floating-badge "activate" path) was the real source of the reported
// "no leads match search"/tiles briefly going to zero on Pending
// Customers - this function has its own inline render call, so it
// never went through the fix already made in the other two functions.
await waitForLeadsTableReady();
} catch (error) {
// The queue check is a nice-to-have layered on top of an otherwise-
// good leads refresh; it failing outright is not a reason to also
// withhold the panel the user actually asked to see.
console.warn('[SLA Extract] Queue check failed during badge activation - showing the panel anyway:', error);
}
// This previous try/catch only covered the queue check above - it
// did NOT cover the render calls themselves, so if displayPanel/
// displayPendingPanel (or anything inside them - renderAssignSection,
// mountPanel, etc) throws, that would propagate out uncaught exactly
// the same way and the panel would still never appear, just one step
// later than what the last fix actually guarded. Reported live as
// still happening after that fix, which is what exposed this gap -
// wrapping the actual render too, and surfacing the error visibly
// (an alert, not just a console message this session hasn't been able
// to see) rather than guessing blind a third time.
if (currentPageType === PAGE_PENDING) displayPendingPanel(currentPendingCustomers, 0, 0, false);
else displayPanel(currentCustomers, 0, 0, false);
} catch (error) {
console.error('[SLA Extract] Panel failed to render after badge activation:', error);
alert('SLA Manager: the panel failed to load after activating.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
} finally {
hidePageFlashOverlay();
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
badge.onclick = handleBadgeClick;
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
badge.onclick = handleBadgeClick;
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

window._toggleCustomerContact = function(toggleEl) {
const wrapper = toggleEl.nextElementSibling;
if (!wrapper) return;
const opening = wrapper.style.display === 'none';
wrapper.style.display = opening ? 'grid' : 'none';
const chevron = toggleEl.querySelector('svg');
if (chevron) chevron.style.transform = opening ? 'rotate(0deg)' : 'rotate(-90deg)';
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

window._toggleFiltersZone = function() {
const body = document.getElementById('filtersZoneBody');
const toggle = document.getElementById('filtersZoneToggle');
if (!body || !toggle) return;
const isHidden = body.style.display === 'none';
body.style.display = isHidden ? 'block' : 'none';
toggle.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
saveAssignSettings({ filtersOpen: isHidden });
// The time wheel lives inside this disclosure - scrollTop assignments
// silently no-op while its container is display:none, so the wheel's
// position never actually took effect until now that it's visible
// (same root cause as the original "wheel always shows 00:00" bug).
if (isHidden) syncAllWheelPositions();
};

// Collapses the whole ASSIGN block (agents/limit/preview/button/
// results), not just filters. If FILTERS is currently open when this
// re-opens, its wheel needs the same re-sync as _toggleFiltersZone
// does - its own display style already says "open" from before, so
// nothing re-triggers that sync on its own now that the wheel's actual
// container (this one) has just become visible again.
window._toggleAssignSection = function() {
const body = document.getElementById('assignSectionBody');
const toggle = document.getElementById('assignSectionToggle');
if (!body || !toggle) return;
const isHidden = body.style.display === 'none';
body.style.display = isHidden ? 'block' : 'none';
toggle.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
saveAssignSettings({ assignOpen: isHidden });
const filtersBody = document.getElementById('filtersZoneBody');
if (isHidden && filtersBody && filtersBody.style.display !== 'none') syncAllWheelPositions();
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
// button and each clickable due-summary tile): expands the ASSIGN
// section if it's collapsed so progress/results are visible, then
// resolves which agents are actually checked - agent selection is real
// state the user is deliberately curating and always gets respected,
// no matter which fixed lead-criteria shortcut triggered the run.
// Returns null (and leaves a message in the log) if nothing's selected.
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

// The general "Quick Assign" button that used to live here was removed:
// on SLA it was byte-for-byte identical to clicking the "1h" due-summary
// tile (same tiers, same window), and on Pending its narrower New/Auto
// Rescheduled-only scope is still reachable via the manual button with
// those two boxes checked - genuinely lost a one-click version of that
// specific scope, kept for the sake of not having a button that
// silently duplicated a tile right next to it.

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
await executeAssignmentRun(plan, locateAssignCell, PAGE_SLA);
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
await executeAssignmentRun(plan, locatePendingAssignCell, PAGE_PENDING);
};
// Shared by the manual Assign button (whatever filters are checked) and
// Quick Assign (its own fixed opinionated criteria) - both just need to
// build a plan and hand it off the same way.
const ASSIGN_CONFIRM_THRESHOLD = 10;

async function executeAssignmentRun(plan, locateCellFn, pageType) {
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
lastFailedPageType = failedEntries.length > 0 ? pageType : null;
appendAssignmentLog(results);
console.info(`✅ Assigned ${succeeded}/${results.length} leads`);

// The assign click itself only mutates the live table's own assign
// cell for each lead - it never touches currentCustomers/
// currentPendingCustomers (this panel's own cached render source), so
// the lead cards kept showing the pre-assign "unassigned" state until
// an unrelated manual refresh. Same lightweight fix as Clear Queue's
// own (window._clearWholeQueue): update the cache directly from this
// run's own results and re-render, rather than re-running the full
// ingestion pipeline. That replaces assignResultsSummary's own DOM
// too, so it's (re)rendered AFTER this, not before - or the fresh
// render would wipe it again.
if (succeeded > 0) {
// The newly-assigned leads' real queue position is now something
// different from whatever the last scan found (or unknown, if there
// never was one) - per instruction, auto re-scan Queue by Agent so
// the badges reflect reality immediately, accepting the extra
// navigation this adds to every successful assign run.
showPageFlashOverlay('Checking agent queues…');
try {
await refreshAgentQueueSnapshot();
// Same gap as the other three call sites of refreshAgentQueueSnapshot
// in this file: the navigate-away-and-back it just did only changes
// the route, Angular still needs a moment to repopulate the SLA/
// Pending table afterward - reading it immediately (via the render
// below) briefly showed "0 leads due"/"No leads match the current
// filters" right after every successful assign run, on both pages.
await waitForLeadsTableReady();
} catch (error) {
// A failure here previously skipped the render/renderAssignResultsSummary/
// return below entirely (this whole function's caller doesn't handle a
// rejection either) - a successful assign run's own results would just
// vanish along with the panel, with nothing visible showing why. The
// queue-position rescan is a nice-to-have layered on top of an assign
// run that already genuinely succeeded; it failing is not a reason to
// also withhold that assign run's own results.
console.warn('[SLA Extract] Queue check failed after assign run - showing results anyway:', error);
} finally {
hidePageFlashOverlay();
}
// Not wrapped in anything before this fix - if this render threw, it
// propagated out uncaught (nothing here awaits/reports it either), and
// renderAssignResultsSummary/the assign run's own return value below
// never happened, on top of the panel never appearing.
try {
const successByKey = new Map(results.filter(r => r.ok).map(r => [r.lead.key, r.agent.name]));
if (pageType === PAGE_PENDING) {
currentPendingCustomers = currentPendingCustomers.map((c) => successByKey.has(c.key) ? { ...c, assigned: true, agentName: successByKey.get(c.key) } : c);
displayPendingPanel(currentPendingCustomers, 0, 0, false);
} else {
currentCustomers = currentCustomers.map((c) => successByKey.has(c.key) ? { ...c, assigned: true, agentName: successByKey.get(c.key) } : c);
displayPanel(currentCustomers, 0, 0, false);
}
} catch (error) {
console.error('[SLA Extract] Panel failed to render after assign run:', error);
alert('SLA Manager: leads were assigned, but the panel failed to reload.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
}
}
renderAssignResultsSummary(results);
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
await executeAssignmentRun(plan, locateAssignCell, PAGE_SLA);
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
await executeAssignmentRun(plan, locatePendingAssignCell, PAGE_PENDING);
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
if (extracting || assigning || runningMorningChecks || refreshingLeads || currentPanelMode === 'morningChecks') return;
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
