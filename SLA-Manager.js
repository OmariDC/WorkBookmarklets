(function() {
const BADGE_ID = '_slaBadge';
// Konnect Manager's own navbar colours, so the badge matches the page.
const BADGE_COLOR = '#22365D';
const BADGE_BORDER_COLOR = '#FFFFFF';
const PANEL_ID = '_slaPanel';
const PANEL_BOX_ID = '_slaPanelBox';
const PANEL_STATE_KEY = '_slaPanelState';
const PANEL_SIZE_KEY = '_slaPanelSize';
const ASSIGN_SETTINGS_KEY = '_slaAssignSettings';

// Stored data holding customer names, phones, emails or notes is kept for
// one shift only. Anything older than this, or with no timestamp, is
// discarded on load.
const STORED_CUSTOMER_DATA_MAX_AGE_MS = 12 * 60 * 60 * 1000;
function isStoredTimeFresh(isoTime) {
const t = isoTime ? new Date(isoTime).getTime() : NaN;
return Number.isFinite(t) && Date.now() - t <= STORED_CUSTOMER_DATA_MAX_AGE_MS;
}
// Customer details only reach the console when the debug flag is set:
// localStorage.setItem('workBookmarklets:debug', '1').
function isDebugLogging() {
try { return localStorage.getItem('workBookmarklets:debug') === '1'; } catch (error) { return false; }
}
function removeStoredKey(key) {
try { localStorage.removeItem(key); } catch (error) { /* ignore */ }
}


// Shows when the running copy was published and notices a newer one going
// live. The date comes from GitHub once per open; later checks compare the
// published file's text, which has no rate limit to share between staff.
function startVersionWatch(fileName, onChange) {
const state = { publishedAt: null, newer: false, timer: null };
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

let slaVersionState = null;
function renderVersionLine() {
const html = () => {
const text = versionLineText(slaVersionState);
const newer = slaVersionState.newer;
return `<div id="_slaVersionLine" class="sla-mn" role="status" ${newer ? 'style="font-weight: 700; color: #b91c1c;"' : ''}>${escapeHtml(text)}</div>`;
};
if (!slaVersionState) {
slaVersionState = startVersionWatch('SLA-Manager.js', () => {
const el = document.getElementById('_slaVersionLine');
if (el) el.outerHTML = html();
const notice = document.getElementById('_slaNewerNotice');
if (notice) notice.outerHTML = renderNewerVersionNotice();
});
}
return html();
}

// The version is the last line of the More menu. A newer version being out
// matters more than that, so it also shows above the list.
function renderNewerVersionNotice() {
const newer = !!(slaVersionState && slaVersionState.newer);
return `<div id="_slaNewerNotice" class="sla-notice bad" role="status" ${newer ? '' : 'hidden'}>${newer ? escapeHtml(versionLineText(slaVersionState)) : ''}</div>`;
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

// Self-tests run on every load. A failure is logged and also shown as a
// banner in the panel, so a broken build is visible to the person using it.
const selfTestFailures = [];
function reportSelfTestFailure(message) {
console.error(message);
const lines = String(message).split('\n');
selfTestFailures.push(lines.slice(0, 2).join(': ').replace(/ self-test FAILED:?:?/, ''));
}
function runSelfTest(name, fn) {
try {
fn();
} catch (error) {
reportSelfTestFailure(`SLA Manager ${name} threw: ${error && error.message}`);
}
}
function renderSelfTestBanner() {
if (selfTestFailures.length === 0) return '';
const list = selfTestFailures.slice(0, 3).map((f) => `<div style="margin-top:4px;">${escapeHtml(f)}</div>`).join('');
return `<div role="alert" style="margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:12px;"><strong>Self-test failed:</strong> some results may be wrong. Please send this message on.${list}</div>`;
}

// Standard is layout 1 (one column), full is two columns at full height and
// compact is the small box. Anything else stored reads as standard.
const PANEL_SIZES = ['standard', 'full', 'compact'];
function getPanelSize() {
const stored = localStorage.getItem(PANEL_SIZE_KEY);
return PANEL_SIZES.includes(stored) ? stored : 'standard';
}

// ===================================================================
// ICONS
//
// Inline SVG line icons using currentColor, so each one inherits the colour
// of the element around it. Emoji render inconsistently across browsers.
// ===================================================================

const ICONS = {
refresh: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/>',
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
copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
check: '<polyline points="20 6 9 17 4 12"/>',
openOut: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
back: '<path d="M15 18l-6-6 6-6"/>',
queue: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>',
trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
flag: '<path d="M4 21V4h12l-2 4 2 4H4"/>',
stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
sort: '<path d="M3 6h18M6 12h12M10 18h4"/>',
clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2"/>',
bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
};

function svgIcon(name, size, extraStyle, className) {
return `<svg${className ? ` class="${className}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;${extraStyle || ''}">${ICONS[name]}</svg>`;
}

// Only for the two full-panel empty states. Per-section empty lines stay compact.
function renderZeroState(iconName, title, subtitle) {
return `<div class="sla-zero">
<div style="width: 64px; height: 64px; border-radius: 50%; background: #e5e5ea; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
${svgIcon(iconName, 28, ' stroke-width: 1.5; color: var(--wb-muted, #5b6577);')}
</div>
<h3 style="color: var(--wb-text, #1c1c1e); margin: 0 0 6px 0; font-size: 17px; font-weight: 600;">${title}</h3>
<p style="color: var(--wb-muted, #5b6577); margin: 0; font-size: 14px; line-height: 1.5;">${subtitle}</p>
</div>`;
}

function chevronIcon(collapsed, id) {
return `<svg id="${id}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; transition: transform 0.15s ease; transform: rotate(${collapsed ? -90 : 0}deg);">${ICONS.chevron}</svg>`;
}

// td-only queries skip the header row, which uses th cells with no real thead.
const COL_CUSTOMER = 0;
const COL_REGISTRATION = 1;
const COL_SOURCE = 2;
const COL_CAMPAIGN = 3;
const COL_CREATED = 4;
const COL_RECEIVED = 5;
const COL_SLA_DATE = 6;
const COL_STATUS = 7;
const COL_ASSIGN = 8;

// Every Pending Customers column is plain text, so no modal click is needed.
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

// Pushes a Missed lead's sort time back so it does not always beat a
// Critical lead due in minutes.
const MISSED_PENALTY_MS = 30 * 60 * 1000;

const PAGE_SLA = 'sla';
const PAGE_PENDING = 'pending';
const SLA_HEADERS = ['Customer', 'Registration', 'Source', 'Campaign', 'Created', 'Received', 'SLA Date', 'Status', 'Assign'];
const PENDING_HEADERS = ['Dealer', 'Brand', 'Customer', 'Reg', 'Email', 'Mobile', 'Landline', 'Campaign', 'Callback Type', 'Last Action Date', 'Next Action Date', 'Assign'];

function headersMatch(actual, expected) {
return actual.length === expected.length && actual.every((h, i) => h === expected[i]);
}

// Detects the page from the table header rather than the URL, and returns
// null for an unrecognised table rather than guessing.
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
// The last real +N/-N diff, so a redraw that is not a new scan can show it
// again instead of 0/0.
let lastSlaDiffCounts = { newCount: 0, removedCount: 0 };
let lastPendingDiffCounts = { newCount: 0, removedCount: 0 };
// 'normal' or 'morningChecks'. Only the header toggle changes it, never the poll.
let currentPanelMode = 'normal';
let runningMorningChecks = false;
// Covers the whole refresh, which can take seconds with no hash change, so
// the background poll does not start its own extraction mid-wait.
let refreshingLeads = false;
// Set while a flow has the tab on another Konnect page (Queue by Agent):
// Clear Queue, the Queue check, the badge's queue scan and the scan after an
// assign run.
let navigating = false;
// One guard for everything that scans, assigns or navigates, so two of them
// never run over each other. Returns why the panel is busy, or null.
function busyReason() {
if (assigning) return 'an assign run is in progress';
if (extracting) return 'the leads are still loading';
if (runningMorningChecks) return 'the morning checks are running';
if (refreshingLeads) return 'the leads are being refreshed';
if (navigating) return 'the agent queues are being read';
return null;
}
function refuseIfBusy() {
const reason = busyReason();
if (!reason) return false;
showToast(`Not yet: ${reason}. Try again when it has finished.`);
return true;
}
// Filled by _runAllMorningChecks as each check completes. Empty means not run
// yet. Today's last run is put back further down, once its storage key exists.
let morningChecksResults = [];
// 'national' while the National results view is showing over the checks.
let morningChecksSubView = null;
const MORNING_CHECKS_ORDER = [
{ key: 'emailOnly', label: 'Email Only Count' },
{ key: 'sla', label: 'SLA Count' },
{ key: 'inProgress', label: 'In Progress' },
{ key: 'leadType', label: 'Lead Type Check' },
{ key: 'routedTo', label: 'All Leads Are Routed To' },
{ key: 'voicemail', label: 'Voicemail' },
{ key: 'national', label: 'National leads' },
];
const PAGE_FLASH_OVERLAY_ID = '_slaPageFlashOverlay';

// Matched on the part before any parenthetical: a marketing-form label such
// as "(Test drive request)" does not make it a Test Drive campaign. Must
// agree with Konnect-Lead-Checker.js.
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
// "Register Interest (Electric Vehicles ...)" is a Tier 4 interest campaign.
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
if ((camp.includes('px valuation') || camp.includes('p/x valuation')) && camp.includes('used'))
return { tier: 3, reason: 'PX Valuation - Used' };

if (camp.includes('enquiry') && camp.includes('new') && src.includes('robins'))
return { tier: 4, reason: 'Enquiry - New (Robins & Day)' };
if (camp.includes('general'))
return { tier: 4, reason: 'General' };
if (camp.includes('inbound'))
return { tier: 4, reason: 'Inbound' };

return { tier: 4, reason: 'Uncategorized' };
}

// SLA Manager's own campaign tiers, in the words categorizeTier works to.
// The names are fixed; `holds` is the grey line and tooltip beside each.
const SLA_TIERS = [
{ tier: 1, id: 'tier1', name: 'Tier 1 - Priority', holds: 'Test drive requests, electric campaigns and Reserve Used' },
{ tier: 2, id: 'tier2', name: 'Tier 2 - High', holds: 'Customer First new enquiries, Motability and Leapmotor' },
{ tier: 3, id: 'tier3', name: 'Tier 3 - Medium', holds: 'Used enquiries, new offer requests and PX valuations' },
{ tier: 4, id: 'tier4', name: 'Tier 4 - Standard', holds: 'Other new enquiries, General, Inbound and anything not matched' }
];

// Real campaign strings covering the parenthetical and Register Interest cases.
runSelfTest('categorizeTierSelfTest', function categorizeTierSelfTest() {
const cases = [
{ name: 'Real: Customer First Enquiry-New (Test drive request) stays Tier 2, not Tier 1', campaign: 'Citroen - Enquiry - New (Test drive request)', source: 'Customer First', expectTier: 2 },
{ name: 'Real: dedicated Test Drive Request campaign is Tier 1', campaign: 'Peugeot - Test Drive Request - New (pcr_new_test_drive)', source: 'Robins & Day Website', expectTier: 1 },
{ name: 'Real: Register Interest campaign containing "Electric" is not Tier 1 Electric', campaign: 'Citroen - Register Interest (Electric Vehicles Register Your Interest)', source: 'Robins & Day Website', expectTier: 4 },
{ name: 'A genuine Brand - Electric campaign is still Tier 1', campaign: 'Citroen - Electric', source: 'Website', expectTier: 1 },
{ name: 'Reserve - Used is Tier 1', campaign: 'Citroen - Reserve - Used', source: 'Robins & Day Website', expectTier: 1 },
{ name: 'Motability is Tier 2', campaign: 'Motability', source: 'Motability', expectTier: 2 },
{ name: 'Offer Request - New is Tier 3', campaign: 'Citroen - Offer Request - New (Quote request)', source: 'Customer First', expectTier: 3 },
{ name: 'PX Valuation - Used is Tier 3, same as PX Valuation - New', campaign: 'PX Valuation - Used', source: 'Robins & Day Website', expectTier: 3 }
];
const failures = [];
cases.forEach((c) => {
const result = categorizeTier(c.campaign, c.source);
if (result.tier !== c.expectTier) {
failures.push(`${c.name}: expected tier ${c.expectTier}, got tier ${result.tier} (${result.reason})`);
}
});
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager categorizeTier self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager categorizeTier self-test passed');
}
});

// Display order only: more overdue always shows first. computeSortKey, used
// for assignment, adds the Missed penalty instead.
function computeDisplaySortKey(customer) {
if (!customer.slaDate) return Infinity;
return customer.slaDate.getTime() - Date.now();
}

function sortByUrgency(customers) {
return [...customers].sort((a, b) => computeDisplaySortKey(a) - computeDisplaySortKey(b));
}

function findDetailModal() {
return document.querySelector('[role="alertdialog"]') || document.querySelector('.modal');
}

// Polls until test() gives something truthy, or gives up and returns null.
async function waitUntil(test, timeout, interval = 60) {
const deadline = Date.now() + timeout;
for (;;) {
const value = test();
if (value) return value;
if (Date.now() >= deadline) return null;
await sleep(interval);
}
}

// Waits for the open pop-up to leave the page. Resolves false if it is
// still there, so the next lead is not read from the last lead's pop-up.
async function waitForModalGone(timeout = 4000) {
return !!(await waitUntil(() => !findDetailModal(), timeout));
}

// For routes such as Queue by Agent that render after the hash change.
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

// The header renders before the rows, so reading at once can report an empty
// queue. This table renders in one batch, so the first row is enough.
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

// Waits for rows to stop changing. Only used after returning from Queue by
// Agent; the main extraction keeps the faster first-row wait.
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

// Armed now too, in case rows had already settled before watching started.
armSettleTimer();
hardTimer = setTimeout(finish, timeout);
});
}

// For every flow that visits Queue by Agent and comes back. The hash
// returning does not mean Angular has refilled the table, and rendering
// early showed "0 leads due".
async function waitForLeadsTableReady() {
const table = await waitForElement('table');
// Short cap: the lead data is already correct, this only avoids reading
// the briefly empty table after navigating back.
if (table) await waitForLeadsTableRowsSettled(table, 2500);
}

// Masks the page flashing during navigation. The root overflow is locked
// because modals toggle the scrollbar, which made the overlay jump sideways.
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
// Must sit above the panel's z-index of 100000.
overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(20,20,22,0.92); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 100001; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: white; font-size: 13px; font-weight: 600;';
overlay.innerHTML = `
<div style="width: 28px; height: 28px; border: 2.5px solid rgba(255,255,255,0.2); border-top-color: white; border-radius: 50%; animation: _slaSpin 0.7s linear infinite;"></div>
<div data-overlay-label style="background: rgba(255,255,255,0.12); padding: 6px 14px; border-radius: 999px;">${message}</div>
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

// The refresh icon has no id or aria-label; ng-click plus class is specific enough.
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

// Clicking the panel title refreshes the leads list (via Konnect's own icon
// when present), then re-scans so new leads are fully ingested.
// options.quiet: the missed lead watch. No overlay, and new leads' pop-ups
// are only read while the tab is in view with the panel showing; otherwise
// the table alone is refreshed, which is all the warning needs.
window._refreshLeadsAndPanel = async function(options) {
if (busyReason()) return;
const quiet = !!(options && options.quiet === true);
refreshingLeads = true;
if (!quiet) showPageFlashOverlay('Refreshing leads…');
try {
const icon = findNativeLeadsRefreshIcon();
if (icon) {
icon.click();
await waitForRefreshIconSpinState(icon, true, 2000);
await waitForRefreshIconSpinState(icon, false, 15000);
}
if (!quiet || (panelElement && !document.hidden && localStorage.getItem(PANEL_STATE_KEY) !== 'hidden')) await runExtraction();
} finally {
refreshingLeads = false;
hidePageFlashOverlay();
}
};

// The module selector is Angular scope state with no selected class, so the
// active module is read from the trigger text and changed by clicking the
// matching li. A wrong module would clear the wrong scope.
async function ensureCustomerHubModule() {
// Re-queried on every check because the trigger element can be replaced.
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
console.warn('[SLA Manager] Customer Hub option not found in the module dropdown - items seen:', items.map(li => li.textContent.trim()));
return false;
}
target.click();

if (readLabel() === 'Customer Hub') return true;

return new Promise((resolve) => {
const timer = setTimeout(() => {
observer.disconnect();
console.warn('[SLA Manager] Timed out waiting for module switch to Customer Hub - trigger now reads:', readLabel());
resolve(false);
}, 3000);
// Observes body because the trigger itself can be replaced.
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

// Unassigns every lead via Konnect's Clear Queues action. No confirm prompt
// and no undo, so it runs once however many times it is clicked. Konnect is
// a single-page app, so the visible tab navigates to Queue by Agent and
// back. The result is read back from the leads table before it is reported.
window._clearWholeQueue = async function() {
if (refuseIfBusy()) return;
navigating = true;
const originalHash = window.location.hash;
// Captured first, since detectPageType() would then read Queue by Agent.
const originatingPageType = detectPageType();
showPageFlashOverlay('Clearing the queue…');
try {
let pressed = false;
try {
window.location.hash = '#/Queue/QueueByAgent';
const clearBtn = await waitForElement('button[ng-click="ClearQueues()"]');
if (!clearBtn) {
alert('Could not find the Clear Queues button after navigating. Nothing was cleared.');
return;
}
const moduleOk = await ensureCustomerHubModule();
if (!moduleOk) {
alert('Could not confirm the Customer Hub module is selected, so nothing was cleared.');
return;
}
clearBtn.click();
pressed = true;
await sleep(800);
clearAgentQueueSnapshot();
} finally {
window.location.hash = originalHash;
}
if (!pressed) return;

const readLive = () => (originatingPageType === PAGE_PENDING ? collectPendingCustomers() : collectAssignableLeads());
let live = [];
try {
await waitForLeadsTableReady();
live = readLive();
// Leads still showing an agent may only be an old copy of the list:
// refresh it once before believing them.
if (live.some((l) => l.assigned)) {
const icon = findNativeLeadsRefreshIcon();
if (icon) {
icon.click();
await waitForRefreshIconSpinState(icon, true, 2000);
await waitForRefreshIconSpinState(icon, false, 15000);
await waitForLeadsTableReady();
live = readLive();
}
}
} catch (error) {
console.warn('[SLA Manager] Could not read the list back after clearing the queue:', error && error.message);
}

try {
const stillAssigned = live.filter((l) => l.assigned).length;
// The cards follow what the page shows now. If the list could not be
// read at all, they are shown unassigned, as pressed.
const liveByKey = new Map(live.map((l) => [l.key, l]));
const applyLive = (c) => {
const now = liveByKey.get(c.key);
return live.length === 0 || !now ? { ...c, assigned: false, agentName: null } : { ...c, assigned: now.assigned, agentName: now.agentName };
};
if (live.length > 0) cachedLeadsSnapshot = { pageType: originatingPageType === PAGE_PENDING ? PAGE_PENDING : PAGE_SLA, leads: live, scannedAt: new Date() };
else patchCachedLeadsCleared();
followAssignments(originatingPageType, live);
if (originatingPageType === PAGE_PENDING) {
currentPendingCustomers = currentPendingCustomers.map(applyLive);
displayPendingPanel(currentPendingCustomers, 0, 0, false);
} else {
currentCustomers = currentCustomers.map(applyLive);
displayPanel(currentCustomers, 0, 0, false);
}
showToast(live.length === 0
? 'Clear Queues was pressed, but the list could not be read back to confirm it. Refresh to check.'
: stillAssigned === 0
? 'Queue cleared: no lead shows an agent now.'
: `Clear Queues was pressed, but ${stillAssigned} lead${stillAssigned === 1 ? ' still shows' : 's still show'} an agent. Refresh and check before relying on it.`);
} catch (error) {
console.error('[SLA Manager] Panel failed to render after clearing the queue:', error);
alert('SLA Manager: Clear Queues was pressed, but the panel failed to reload.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
}
} finally {
navigating = false;
hidePageFlashOverlay();
}
};

// ===================================================================
// AGENT QUEUE POSITIONS
//
// Each agent panel on Queue by Agent shows only their last 10 queued items,
// top row first. Done rows differ only by an inline background-color, and
// the customer is in a "Name | Email | Phone" title attribute.
// ===================================================================

const AGENT_QUEUE_SNAPSHOT_KEY = '_slaAgentQueueSnapshot';

function loadAgentQueueSnapshot() {
try {
const raw = JSON.parse(localStorage.getItem(AGENT_QUEUE_SNAPSHOT_KEY));
if (raw && Array.isArray(raw.agents)) {
if (isStoredTimeFresh(raw.scannedAt)) return raw;
removeStoredKey(AGENT_QUEUE_SNAPSHOT_KEY);
}
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

// Assigning or clearing changes queue positions, so the snapshot is wiped
// rather than re-scanned.
function clearAgentQueueSnapshot() {
removeStoredKey(AGENT_QUEUE_SNAPSHOT_KEY);
}

// DONE, FROM THE QUEUE. Queue by Agent draws a lead the agent has done in a
// slightly greyer row. This is the one place that marker is read: if
// Konnect changes how a done row looks, change it here.
function isQueueRowDone(row) {
return /background-color:\s*rgb\(244,\s*244,\s*244\)/.test(row.getAttribute('style') || '');
}

// Pure. A short fingerprint of a queue row's customer, so the same done row
// read twice counts once and no contact detail is stored. '' when the row
// shows neither an email nor a phone.
function queueItemId(email, phone) {
const text = `${String(email || '').toLowerCase().trim()}|${String(phone || '').replace(/\D/g, '').slice(-10)}`;
if (text === '|') return '';
let hash = 5381;
for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
return hash.toString(36);
}

const QUEUE_DONE_KEY = '_slaQueueDone';
const QUEUE_DONE_MAX = 500;

// Pure. Adds the done rows of one Queue read to the day's record, per agent
// (by normalised name). Every agent the Queue shows gets an entry, so "none
// done" can be told from "queue not read". It only ever grows: the page
// shows each agent's last 10 rows, so earlier done rows have scrolled off.
function mergeQueueDone(stored, agents, nowIso) {
const byAgent = { ...((stored && stored.agents) || {}) };
agents.forEach((a) => {
const key = normalizeAgentName(a.agentName);
if (!key) return;
const ids = new Set((byAgent[key] && byAgent[key].ids) || []);
(a.doneIds || []).forEach((id) => { if (id) ids.add(id); });
byAgent[key] = { name: a.agentName, ids: Array.from(ids).slice(-QUEUE_DONE_MAX) };
});
return { savedAt: (stored && stored.savedAt) || nowIso, agents: byAgent };
}

// Today's record only, and only within one shift.
function loadQueueDone() {
const stored = readStoredJson(QUEUE_DONE_KEY);
if (stored && stored.agents && isStoredTimeFresh(stored.savedAt) && new Date(stored.savedAt).toDateString() === new Date().toDateString()) return stored;
if (stored) removeStoredKey(QUEUE_DONE_KEY);
return null;
}

function recordQueueDone(agents) {
try {
localStorage.setItem(QUEUE_DONE_KEY, JSON.stringify(mergeQueueDone(loadQueueDone(), agents, new Date().toISOString())));
} catch (error) {
console.warn('[SLA Manager] Could not save the done counts from the queue.');
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
// Only what matching a lead needs is kept: no name.
return { position: index + 1, email: parts[1] || '', phone: parts[2] || '', done: isQueueRowDone(row) };
});

agents.push({
agentName,
totalShown: queue.length,
notDoneCount: queue.filter((item) => !item.done).length,
doneIds: queue.filter((item) => item.done).map((item) => queueItemId(item.email, item.phone)),
queue: queue.map(({ done, ...item }) => item)
});
});
return agents;
}

// Visits Queue by Agent, saves the snapshot and comes back. Returns true or
// false so a failed refresh does not abort the caller.
async function refreshAgentQueueSnapshot() {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/QueueByAgent';
const ready = await waitForElement('li[ng-repeat="agent in fullqueue | filter: filterMessages"]', 15000);
if (!ready) {
console.warn('[SLA Manager] Could not find the Queue by Agent panels after navigating - queue snapshot not refreshed.');
return false;
}
const moduleOk = await ensureCustomerHubModule();
if (!moduleOk) {
console.warn('[SLA Manager] Could not confirm the Customer Hub module is selected - queue snapshot not refreshed.');
return false;
}
// Agent queue items render a moment after the panel shell.
await sleep(500);
const agents = scrapeAgentQueuePositions();
if (isDebugLogging()) console.info(`[SLA Manager] Queue by Agent scan: ${agents.length} agent panel(s) found`, agents.map((a) => ({
agent: a.agentName, notDone: a.notDoneCount, totalShown: a.totalShown, sample: a.queue.slice(0, 3)
})));
recordQueueDone(agents);
saveAgentQueueSnapshot(agents.map(({ doneIds, ...agent }) => agent));
return true;
} finally {
window.location.hash = originalHash;
}
}

window._checkAgentQueuePositions = async function(buttonEl) {
if (refuseIfBusy()) return;
navigating = true;
const originatingPageType = detectPageType();
const originalText = buttonEl ? buttonEl.textContent : null;
if (buttonEl) buttonEl.textContent = 'Checking…';
showPageFlashOverlay('Checking agent queues…');
try {
// A failed queue check must not skip the render below. Nothing awaits this
// click handler, so a rejection would be silent.
try {
const ok = await refreshAgentQueueSnapshot();
if (!ok) alert('Could not check agent queues. See the console for details.');
// Wait for Angular to refill the table after navigating back, or the tiles
// briefly read "0 leads due".
await waitForLeadsTableReady();
} catch (error) {
console.warn('[SLA Manager] Queue check failed - showing the panel anyway:', error);
}
// The catch above only covers the queue check.
try {
if (originatingPageType === PAGE_PENDING) displayPendingPanel(currentPendingCustomers, 0, 0, false);
else displayPanel(currentCustomers, 0, 0, false);
} catch (error) {
console.error('[SLA Manager] Panel failed to render after queue check:', error);
alert('SLA Manager: the panel failed to load after checking the queue.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
}
} finally {
navigating = false;
hidePageFlashOverlay();
if (buttonEl) buttonEl.textContent = originalText;
}
};

// Finds a lead's position in the last Queue by Agent snapshot (not live).
function findAgentQueuePositionInSnapshot(lead, snapshot) {
if (!snapshot.agents || snapshot.agents.length === 0) return null;
const emailKey = normalizeEmailForLeadCheckerMatch(lead.email);
const phoneKey = normalizePhoneForLeadCheckerMatch(lead.phone);
if (!emailKey && !phoneKey) return null;
for (const agent of snapshot.agents) {
for (const item of agent.queue) {
const itemEmailKey = normalizeEmailForLeadCheckerMatch(item.email);
const itemPhoneKey = normalizePhoneForLeadCheckerMatch(item.phone);
const matches = (emailKey && itemEmailKey && emailKey === itemEmailKey) || (phoneKey && itemPhoneKey && phoneKey === itemPhoneKey);
if (matches) {
return { agentName: agent.agentName, position: item.position, totalShown: agent.totalShown };
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

// ===================================================================
// MORNING CHECKS
//
// Daily start-of-shift checks against other Konnect pages. Each returns
// {ok, summary, details} so _runAllMorningChecks can run them in sequence.
// ===================================================================

// The month selector has no id, so it is found by its "YYYY - Month" text.
// Nothing loads until the selected month is clicked again.
function findMonthSelectorTrigger() {
const triggers = Array.from(document.querySelectorAll('div[data-toggle="dropdown"]'));
return triggers.find(t => /^\d{4}\s*-\s*[A-Za-z]+$/.test(t.querySelector('span.ng-binding')?.textContent?.trim() || ''));
}

// The first visit to this route in a session renders slowly, so wait for it.
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
// Long timeout: the first visit to this route in a session can exceed 5s.
const firstOption = await waitForElement('li[ng-click="monthToDateSelected(monthToDate)"]', 15000);
if (!firstOption) return false;

const options = Array.from(document.querySelectorAll('li[ng-click="monthToDateSelected(monthToDate)"]'));
const target = options.find(li => li.textContent.trim() === label);
if (!target) return false;
target.click();

const firstRow = await waitForElement('tr[ng-repeat="camp in campaigns"]', 15000);
if (!firstRow) return false;
// Short settle delay before reading around 300 rows.
await sleep(400);
return true;
}

// Column 9 is In Progress because the fixed showSLA=true, deferred=false URL
// guarantees the column layout.
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

// skipRestore lets _runAllMorningChecks go straight to the next check's page.
window._checkInProgress = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/onGoingCampaigns/module/-6/deferred/false/showSLA/true';
const loaded = await reloadCurrentMonthCampaigns();
if (!loaded) {
return { ok: null, summary: 'Could not load the current month\'s campaigns. Stopped.' };
}
const { total, sum, breakdown } = extractInProgressData();
if (total === null) {
return { ok: null, summary: 'Could not find the In Progress total. Stopped.' };
}
if (sum === total) {
return { ok: true, summary: `OK (${total})` };
}
const diff = total - sum;
return {
ok: false,
summary: `MISMATCH: top total ${total}, rows sum to ${sum} (off by ${diff})`,
details: breakdown.length > 0 ? breakdown.map(b => `${b.name}: ${b.inProgress}`) : ['(no rows have any In Progress)']
};
} finally {
if (!skipRestore) window.location.hash = originalHash;
}
};

// Counts rows by Source, optionally only those passing filterDate (on Lead
// Created, column 5). "Yesterday" refetches from the API, so callers wait
// for the date label to change.
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

// Only narrows yesterday: midnight to 8am is already in today's scan, so
// only yesterday's 7pm to midnight slice is kept.
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

// This table renders progressively, so one complete row does not mean
// loading has finished.
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

// Armed now too, in case the data had loaded before watching started.
armSettleTimer();
hardTimer = setTimeout(finish, timeout);
});
}

// Shown as the check's collapsed details, not in the summary.
function sourceCountLines(counts) {
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const lines = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([source, count]) => `${source}: ${count}`);
return [`Today (${total} total):`, ...(lines.length > 0 ? lines : ['(no rows)'])];
}

// Each expected source must appear today, or in yesterday's 7pm-8am window,
// before it counts as missing.
const EXPECTED_DAILY_SOURCES = ['Robins & Day Website', 'Customer First', 'Autotrader - Deal Builder', 'Cargurus'];

window._checkLeadTypes = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/InboundAPI';
const table = await waitForElement('table.table-striped', 15000);
if (!table) {
return { ok: null, summary: 'Could not load the Inbound API table. Stopped.' };
}
const settledCount = await waitForInboundRowsSettled();
if (settledCount === 0) {
return { ok: null, summary: 'Inbound API table loaded but no rows appeared. Stopped.' };
}
const todayLabel = currentInboundDateLabel();
const todayCounts = extractSourceCounts();
const details = sourceCountLines(todayCounts);

// No sources at all means the read failed, not that every source is missing.
if (Object.keys(todayCounts).length === 0) {
return { ok: null, summary: 'Inbound API table read back with zero rows for Today. It may not have fully loaded, so run it again to confirm.', details };
}

const missingToday = EXPECTED_DAILY_SOURCES.filter(s => !todayCounts[s]);
if (missingToday.length === 0) {
return { ok: true, summary: 'OK', details };
}

const yesterdayLink = document.querySelector('li[ng-click="getYesterdaysData()"]');
if (!yesterdayLink) {
return { ok: false, summary: `MISSING: ${missingToday.join(', ')} (could not check yesterday - control not found)`, details };
}
yesterdayLink.click();
const changed = await waitForInboundDateChange(todayLabel, 15000);
if (!changed) {
return { ok: false, summary: `MISSING: ${missingToday.join(', ')} (could not confirm yesterday's data loaded)`, details };
}
await waitForInboundRowsSettled();
const yesterdayCounts = extractSourceCounts(isInOvernightWindow);
const stillMissing = missingToday.filter(s => !yesterdayCounts[s]);

if (stillMissing.length === 0) {
return { ok: true, summary: `OK (found overnight yesterday: ${missingToday.join(', ')})`, details };
}
return { ok: false, summary: `MISSING: ${stillMissing.join(', ')}`, details };
} finally {
// No restore to Today needed: the page loads Today on every fresh visit.
if (!skipRestore) window.location.hash = originalHash;
}
};

// Every lead today needs a Routed To value (column 11). Blank or exactly one
// of these words counts as unrouted, so names containing "no" do not match.
const UNROUTED_PLACEHOLDER_WORDS = ['no', 'not', 'n/a', 'na', 'none', 'not routed', 'not applicable', 'unrouted'];

function isUnroutedCell(text) {
const t = (text || '').trim();
if (t === '') return true;
return UNROUTED_PLACEHOLDER_WORDS.includes(t.toLowerCase());
}

// Runs before Lead Type Check in _runAllMorningChecks: its fresh navigation
// guarantees Today is showing, which Lead Type Check then reuses.
window._checkRoutedTo = async function(skipRestore) {
const originalHash = window.location.hash;
try {
window.location.hash = '#/Queue/InboundAPI';
const table = await waitForElement('table.table-striped', 15000);
if (!table) {
return { ok: null, summary: 'Could not load the Inbound API table. Stopped.' };
}
const settledCount = await waitForInboundRowsSettled();
if (settledCount === 0) {
return { ok: null, summary: 'Inbound API table read back with zero usable rows for Today. It may not have fully loaded, so run it again to confirm.' };
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

// Voicemail count, a plain number with no pass or fail. The element is always
// present but its value arrives from a later stats call, so this waits for a
// digit to appear.
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
// The count is module-scoped, so make sure Customer Hub is selected first.
const moduleTrigger = await waitForElement('div[title="Filter by Module"]', 15000);
if (!moduleTrigger) {
return { ok: null, summary: 'Could not find the module filter after navigating. Stopped.' };
}
const moduleOk = await ensureCustomerHubModule();
if (!moduleOk) {
return { ok: null, summary: 'Could not confirm the Customer Hub module is selected. Stopped.' };
}
const count = await waitForVoicemailCount();
if (count === null) {
return { ok: null, summary: 'Could not read the voicemail queue count. Stopped.' };
}
// Plain count with no pass or fail: it is often legitimately 0.
return { ok: null, summary: `${count}` };
} finally {
if (!skipRestore) window.location.hash = originalHash;
}
};

// SLA count: the total leads in the SLA queue. Only navigates if the SLA
// table is not already showing. The hash is read from Konnect's own menu
// link when present, so a changed route is picked up.
const SLA_PAGE_HASH = '#/Queue/SalesLeadsPending';
function findSlaPageHash() {
const link = Array.from(document.querySelectorAll('a[href^="#/Queue/"]'))
.find((a) => /leads pending sla/i.test(a.textContent || ''));
return (link && link.getAttribute('href')) || SLA_PAGE_HASH;
}

async function waitForSlaPage(timeout = 15000) {
const deadline = Date.now() + timeout;
while (Date.now() < deadline) {
if (detectPageType() === PAGE_SLA) return true;
await sleep(250);
}
return false;
}

window._checkSlaCount = async function() {
if (detectPageType() !== PAGE_SLA) {
window.location.hash = findSlaPageHash();
await waitForSlaPage();
}
if (detectPageType() !== PAGE_SLA) {
return { ok: null, summary: 'Could not open the SLA page (Customer Hub Leads Pending SLA). Stopped.' };
}
const table = document.querySelector('table');
await waitForLeadsTableRows(table);
await sleep(300);
// The Email Only count needs each lead's phone and email, which come from
// loading the leads. Load any not seen yet, so this works without the SLA
// page having been opened in the panel first.
const cachedKeys = new Set(currentCustomers.map((c) => c.key));
const unseen = collectAssignableLeads().some((l) => !cachedKeys.has(l.key));
if (unseen) await extractAndExportSla({ quiet: true });
// isEmailOnly comes from collectAssignableLeads, which also feeds the Email
// Only Count row.
const leads = collectAssignableLeads();
const emailOnlyCount = leads.filter(l => l.isEmailOnly).length;
return { ok: null, summary: `${leads.length}`, emailOnlyCount };
};

// Stored so "last run" survives a re-invocation, but only for today: a run
// from yesterday shown as "last run" would mislead.
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
if (!raw) return null;
if (new Date(raw.time).toDateString() !== new Date().toDateString() || !isStoredTimeFresh(raw.time)) {
removeStoredKey(MORNING_CHECKS_LAST_RUN_KEY);
return null;
}
return raw;
} catch (error) {
return null;
}
}

// Nothing restored can still be running: a check saved part-way (the
// National file was still being made) is shown as not finished.
morningChecksResults = (function() {
const lastRun = loadMorningChecksLastRun();
const results = (lastRun && Array.isArray(lastRun.results)) ? lastRun.results : [];
return results.map((r) => (r.status === 'done' ? r : { ...r, status: 'done', ok: null, progress: '', summary: 'Not finished. Run the checks again.' }));
})();

function formatElapsed(ms) {
return `${(ms / 1000).toFixed(1)}s`;
}

// Pure-ish. "Checks run today at 09:12, all OK, 12.3s", for the footer.
function lastRunText(lastRun) {
if (!lastRun) return '';
const issueText = lastRun.failedLabels.length === 0
? 'all OK'
: `${lastRun.failedLabels.length} issue${lastRun.failedLabels.length > 1 ? 's' : ''} (${lastRun.failedLabels.join(', ')})`;
return `Checks run today at ${formatTimeForInput(new Date(lastRun.time))}, ${issueText}, ${formatElapsed(lastRun.elapsedMs)}`;
}

function morningCheckStatusColor(row) {
if (row.status === 'pending') return '#cbd5e1';
if (row.status === 'running') return '#d97706';
if (row.ok === true) return '#047857';
if (row.ok === false) return '#c62828';
return '#1d4ed8';
}

// The check names as they read in the list. The stored labels stay as they
// are, since the saved run and the problem report use them.
const MORNING_CHECK_DISPLAY_NAMES = {
emailOnly: 'Email Only count', sla: 'SLA count', inProgress: 'In progress', leadType: 'Lead type check', routedTo: 'All leads are routed to', voicemail: 'Voicemail', national: 'National leads'
};

// Shown once every check has settled, to answer "did anything go wrong" at
// a glance.
function renderMorningChecksSummaryBanner(results) {
const allDone = results.every(r => r.status === 'done');
if (!allDone) {
const doneCount = results.filter(r => r.status === 'done').length;
return `<div class="sla-notice info" role="status">Running check ${doneCount + 1} of ${results.length}…</div>`;
}
// ok:null is a plain count; only an explicit ok:false is an issue.
const failed = results.filter(r => r.ok === false);
if (failed.length === 0) {
return `<div class="sla-notice ok" role="status">${svgIcon('check', 14)}All checks passed</div>`;
}
return `<div class="sla-notice bad" role="status">${svgIcon('warning', 14)}<span>${failed.length} issue${failed.length > 1 ? 's' : ''} found: ${escapeHtml(failed.map(f => f.label).join(', '))}</span></div>`;
}

// One line per check: a dot, the name and the answer. Blue is a count for
// information, green a pass, red a fail. A row with details opens on a click.
function renderMorningCheckRow(row) {
const color = morningCheckStatusColor(row);
const isSettled = row.status === 'done';
const isRunning = row.status === 'running';
const rightText = isSettled ? (row.summary || '') : (isRunning ? (row.progress || 'Running…') : 'Waiting');
const hasDetails = isSettled && Array.isArray(row.details) && row.details.length > 0;
const detailsId = `_mcDetails_${row.key}`;
const chevronId = `_mcChevron_${row.key}`;
const valueClass = isSettled && row.ok === true ? 'sla-tag done' : (isSettled && row.ok === false ? 'sla-tag bad' : 'sla-due mut');
return `
<div class="sla-check ${row.status === 'pending' ? 'pending' : ''}" ${hasDetails ? `style="cursor: pointer;" title="Show or hide the details" onclick="window._toggleMorningCheckDetails('${row.key}')"` : ''}>
<span class="sla-dot" style="background: ${color};"></span>
<b>${escapeHtml(MORNING_CHECK_DISPLAY_NAMES[row.key] || row.label)}</b>
<span class="${valueClass}" style="white-space: normal; text-align: right;">${escapeHtml(rightText)}</span>
${hasDetails ? chevronIcon(true, chevronId) : '<span></span>'}
${hasDetails ? `<div id="${detailsId}" class="sla-details" style="display: none;">
${row.details.map(d => `<div>${escapeHtml(d)}</div>`).join('')}
</div>` : ''}
</div>`;
}

// Reached only via the header button, never the background poll, which would
// otherwise pull the user out every time a check changes page.
// Start my day leads the Checks view: the same checks with the scan before
// them and Send after, in one press. Run all checks stays for the checks alone.
function renderStartMyDayCard() {
return `<div class="sla-card" style="margin-bottom: 10px;">
<div class="sla-bar">
<b class="sla-grow">Start my day</b>
<button type="button" id="_slaStartDayBtn" class="sla-pri" onclick="window._startMyDay()" ${dayRun.running ? 'disabled' : ''} title="Scans the leads, runs the morning checks, then sends the leads to the Lead Checker">${svgIcon('sun', 14)}<span>${dayRun.running ? 'Running…' : 'Start my day'}</span></button>
</div>
<span class="sla-small">Scans the leads, runs the checks below, then sends the leads to the Lead Checker. Konnect Live must be linked first.</span>
</div>`;
}

function renderMorningChecksBody() {
if (morningChecksResults.length === 0) {
return `
${renderStartMyDayCard()}
<div class="sla-zero">
<div style="color: #cbd5e1; margin-bottom: 12px;">${svgIcon('checklist', 40, ' stroke-width: 1.5;')}</div>
<p style="color: var(--wb-muted, #5b6577); margin: 0 0 20px 0; font-size: 13px; line-height: 1.6;">Runs the morning checks in order: SLA count, In progress, Lead type check, All leads are routed to, Voicemail and National leads, and reports each result here.</p>
<button type="button" class="sla-sec" onclick="window._runAllMorningChecks();" title="The checks alone, with no scan before or Send after">Run all checks</button>
</div>`;
}

const allDone = morningChecksResults.every(r => r.status === 'done');
const nationalRow = morningChecksResults.find((r) => r.key === 'national');

return `
${renderStartMyDayCard()}
${renderMorningChecksSummaryBanner(morningChecksResults)}
<div class="sla-list">
${morningChecksResults.map(renderMorningCheckRow).join('')}
</div>
${nationalRow ? renderNationalCard(nationalRow) : ''}
<div class="sla-bar" style="justify-content: center;">
<button type="button" class="sla-sec" onclick="window._runAllMorningChecks();" ${runningMorningChecks ? 'disabled' : ''}>${svgIcon('refresh', 13)}${runningMorningChecks ? 'Running…' : (allDone ? 'Run again' : 'Run all checks')}</button>
${allDone && !runningMorningChecks ? `<button type="button" class="sla-txt" onclick="window._clearMorningChecks();">Clear</button>` : ''}
</div>`;
}

// Results otherwise persist until end of day or the next run.
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
const nationalResults = morningChecksSubView === 'national' ? loadNationalResults() : null;
if (!nationalResults) morningChecksSubView = null;
mountPanel(renderPanelShell({
view: nationalResults ? 'national' : 'checks',
headerMode: nationalResults ? 'national' : 'checks',
subtitle: nationalResults ? 'National results' : 'Morning checks',
summaryHtml: '',
assignSectionHtml: '',
bodyHtml: nationalResults ? renderNationalResultsBody(nationalResults) : renderMorningChecksBody(),
footerText: nationalResults ? `${nationalResults.length} National lead${nationalResults.length === 1 ? '' : 's'} checked` : escapeHtml(lastRunText(loadMorningChecksLastRun())),
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

// Leaves morningChecksResults untouched both ways, so the last run is still
// there after switching views. Only a re-run replaces it.
window._toggleMorningChecks = function() {
if (runningMorningChecks) return;
morningChecksSubView = null;
if (currentPanelMode === 'morningChecks') {
currentPanelMode = 'normal';
// The page showing now decides which panel comes back, not the page the
// checks last read.
const pageType = detectPageType();
if (pageType === PAGE_PENDING && currentPageType === PAGE_PENDING) {
displayPendingPanel(currentPendingCustomers);
} else if (pageType === PAGE_SLA && currentPageType === PAGE_SLA) {
displayPanel(currentCustomers);
} else if (pageType) {
lastKnownPageType = pageType;
runExtraction();
} else if (currentPageType === PAGE_PENDING) {
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

// ===================================================================
// NATIONAL LEADS CHECK
//
// National leads must be manually rescheduled until closed with a
// correct outcome, or sent to a dealership through Enquiry Max. This
// step pulls the Customer Hub "All" export, keeps the national leads
// touched in the last 3 days, and hands them to the Lead Checker on
// Konnect Live, which reads each lead's timeline to give the verdict.
// The export cannot see Enquiry Max sends, so every lead goes across.
// ===================================================================

const NATIONAL_DEALERS = ['National', 'Stellantis &You National Used Cars'];
// Whole days: today plus the 3 days before it, from midnight. A rolling 72
// hours would drop the morning of the earliest day.
const NATIONAL_WINDOW_DAYS = 3;
function nationalWindowStart(now) {
return new Date(now.getFullYear(), now.getMonth(), now.getDate() - NATIONAL_WINDOW_DAYS);
}
const NATIONAL_BATCH_HEADER = ['NationalCheck', 'Customer', 'Reg', 'ActivityID', 'LeadCreated', 'Campaign', 'Dealer', 'LastContact', 'State', 'ExportOutcome', 'Attempts', 'ManualReschedules', 'AutoReschedules', 'ExportHint'];
const NATIONAL_RESULT_HEADER = ['NationalResult', 'Customer', 'ActivityID', 'LeadID', 'Verdict', 'Reason', 'Attempts', 'FinalOutcome', 'EnquiryMaxDealer', 'FollowUpNotes', 'ResetCampaign', 'Reg'];
// "Re setup": the lead must be set up again as a new lead. Older exports
// said "Reset" and are read as Re setup.
const RE_SETUP = 'Re setup';
const NATIONAL_VERDICTS = [RE_SETUP, 'Check', 'Not found', 'OK'];
const NATIONAL_RESULTS_KEY = '_slaNationalCheckResults';
// Written by Lead Re setup on the agent desktop (same site), read here.
const LEAD_RESET_PROGRESS_KEY = '_leadResetProgress';
const LEAD_RESET_DESK_PROGRESS_KEY = '_leadResetDeskProgress';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Tabs and newlines would break the tab separated handoff.
function tsvClean(value) {
return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

// Tab separated. A field may be wrapped in double quotes with "" inside.
function splitTsvLine(line) {
return line.split('\t').map((cell) => {
const c = cell.replace(/\r$/, '');
if (c.length >= 2 && c.startsWith('"') && c.endsWith('"')) return c.slice(1, -1).replace(/""/g, '"');
return c;
});
}

function parseCustomerHubTsv(text) {
const lines = String(text || '').split(/\n/).filter((l) => l.trim() !== '');
if (lines.length === 0) return [];
const header = splitTsvLine(lines[0]).map((h) => h.trim());
return lines.slice(1).map((line) => {
const cells = splitTsvLine(line);
const row = {};
header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
return row;
});
}

function parseHubIsoDate(value) {
const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}

function hubUkDateToMinute(value) {
const m = String(value || '').match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
return m ? `${m[1]} ${m[2]}` : String(value || '').trim();
}

function formatHubDate(date) {
const p = (n) => String(n).padStart(2, '0');
return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function lastCallDate(list) {
const calls = list.filter((r) => /call/i.test(r['Communication Type'] || ''));
const last = calls[calls.length - 1];
return last ? parseHubIsoDate(last['Intervention Created Date']) : null;
}

// One entry per national lead whose latest contact falls in the window.
function prescreenNationalLeads(rows, now) {
const nowMs = (now || new Date()).getTime();
const windowStartMs = nationalWindowStart(now || new Date()).getTime();
const byActivity = new Map();
rows.forEach((r) => {
if (!NATIONAL_DEALERS.includes(r['Dealer'])) return;
const id = r['ActivityID'];
if (!id) return;
if (!byActivity.has(id)) byActivity.set(id, []);
byActivity.get(id).push(r);
});
const leads = [];
byActivity.forEach((list, activityId) => {
list.sort((a, b) => (parseHubIsoDate(a['Intervention Created Date']) || 0) - (parseHubIsoDate(b['Intervention Created Date']) || 0));
const last = list[list.length - 1];
const lastDate = parseHubIsoDate(last['Intervention Created Date']);
if (!lastDate || lastDate.getTime() < windowStartMs || lastDate.getTime() > nowMs + 60000) return;
const attempts = list.reduce((max, r) => Math.max(max, parseInt(r['AttemptNumber'], 10) || 0), 0);
const manualReschedules = list.filter((r) => r['Callback Type'] === 'Manual Rescheduled' || r['Call Outcome'] === 'Manual Rescheduled').length;
const autoReschedules = list.filter((r) => r['Callback Type'] === 'Auto Rescheduled').length;
const state = last['Activity State'];
const open = /in progress/i.test(state);
leads.push({
customer: last['Customer'],
reg: last['Reg Number'],
activityId,
leadCreated: hubUkDateToMinute(last['Activity Created Date']),
campaign: last['Campaign'],
dealer: last['Dealer'],
// The last call, not a notification email sent after it: the Lead
// Checker compares Enquiry Max sends with this time.
lastContact: formatHubDate(lastCallDate(list) || lastDate),
state,
outcome: open ? '' : (last['ActivityOutcome'] || ''),
attempts,
manualReschedules,
autoReschedules,
exportHint: open ? (autoReschedules > 0 ? 'open-auto' : 'open') : 'closed'
});
});
return leads.sort((a, b) => a.customer.localeCompare(b.customer) || a.leadCreated.localeCompare(b.leadCreated));
}

function buildNationalBatchTsv(leads) {
const lines = leads.map((l) => ['national', l.customer, l.reg, l.activityId, l.leadCreated, l.campaign, l.dealer, l.lastContact, l.state, l.outcome, l.attempts, l.manualReschedules, l.autoReschedules, l.exportHint].map(tsvClean).join('\t'));
return [NATIONAL_BATCH_HEADER.join('\t'), ...lines].join('\n');
}

// Reads columns by name, so an export from an older or newer Lead Checker
// (fewer or extra columns) still imports. Returns {ok, results, error}.
function parseNationalResultsTsv(text) {
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
if (r.Verdict === 'Reset') r.Verdict = RE_SETUP;
return r;
}).filter((r) => r.NationalResult === 'national');
return { ok: true, results, error: null };
}

function countNationalVerdicts(results) {
const counts = {};
NATIONAL_VERDICTS.forEach((v) => { counts[v] = 0; });
results.forEach((r) => { counts[r.Verdict] = (counts[r.Verdict] || 0) + 1; });
return counts;
}

function saveNationalResults(results) {
try {
localStorage.setItem(NATIONAL_RESULTS_KEY, JSON.stringify({ savedAt: new Date().toISOString(), results }));
return true;
} catch (error) {
console.warn('SLA Manager: could not save National results.');
return false;
}
}

function loadNationalResults() {
try {
const raw = JSON.parse(localStorage.getItem(NATIONAL_RESULTS_KEY) || 'null');
if (!raw || !isStoredTimeFresh(raw.savedAt) || !Array.isArray(raw.results)) {
removeStoredKey(NATIONAL_RESULTS_KEY);
return null;
}
return raw.results;
} catch (error) {
return null;
}
}

// ---- Page step (Data > Customer Hub > All) ----

function readExportFileRows() {
return Array.from(document.querySelectorAll('tr[ng-repeat="file in exportFiles"]')).map((tr) => {
let file = null;
try { file = window.angular ? window.angular.element(tr).scope().file : null; } catch (error) { file = null; }
return { tr, file };
}).filter((x) => x.file);
}

function findExportFileRow(year, month) {
const rows = readExportFileRows();
const exact = rows.find((x) => Number(x.file.Year) === year && Number(x.file.Month) === month);
if (exact) return exact;
const name = `${year}-${String(month).padStart(2, '0')}-${MONTH_NAMES[month - 1]}`;
return rows.find((x) => String(x.file.Filename || '').includes(name)) || null;
}

function parseLastModified(value) {
const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
}

function setNationalProgress(text) {
morningChecksResults = morningChecksResults.map((r) => r.key === 'national' ? { ...r, progress: text } : r);
if (currentPanelMode === 'morningChecks') displayMorningChecks();
}

async function fetchExportText(file) {
const response = await fetch(file.Url, { credentials: 'include' });
if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`);
return response.text();
}

const NATIONAL_EXPORT_HASH = '#/fileexport/Sales/all';
// A sibling export page, used to make Konnect load the All list afresh.
const NATIONAL_EXPORT_SIBLING_HASH = '#/fileexport/Sales/calls';

function allFilesListed() {
return readExportFileRows().some((x) => /^All\b/i.test(String(x.file.Filename || '')));
}

async function waitForAllFilesList(timeout) {
const deadline = Date.now() + timeout;
while (Date.now() < deadline) {
if (allFilesListed()) { await sleep(400); return true; }
await sleep(250);
}
return false;
}

async function openExportFilePage() {
if (window.location.hash !== NATIONAL_EXPORT_HASH) window.location.hash = NATIONAL_EXPORT_HASH;
return waitForAllFilesList(20000);
}

// The All list is only loaded when the page opens, so a rebuild that
// finishes in the background still shows the old time and link. Leaving
// for the Calls page and coming back makes Konnect load it again.
async function reloadExportFilePage() {
window.location.hash = NATIONAL_EXPORT_SIBLING_HASH;
const deadline = Date.now() + 10000;
while (allFilesListed() && Date.now() < deadline) await sleep(250);
window.location.hash = NATIONAL_EXPORT_HASH;
return waitForAllFilesList(20000);
}

function clickRecreate(row) {
const link = row.tr.querySelector('a[ng-click="recreateExportFile(file);"]');
if (!link) return false;
link.click();
return true;
}

// Step 1: press Recreate on this month's file and note its old time. The
// file rebuilds on the server, so the other morning checks can run while
// it does.
async function startNationalRecreate(now) {
if (!(await openExportFilePage())) return { error: 'Could not find the Customer Hub file list. Stopped.' };
const year = now.getFullYear();
const month = now.getMonth() + 1;
const row = findExportFileRow(year, month);
if (!row) return { error: `Could not find the ${MONTH_NAMES[month - 1]} ${year} file on the Customer Hub page.` };
const before = row.file.LastModified;
if (!clickRecreate(row)) return { error: 'Could not find the Recreate link for the current month.' };
setNationalProgress('Recreating Customer Hub file in the background…');
return { now, year, month, before, clickedAt: Date.now() };
}

// Step 2: come back to the file list, wait until the new file is ready,
// then read it. If the rebuild did not start (the time never moves and
// nothing is spinning), Recreate is pressed once more.
async function finishNationalRecreate(started) {
const { year, month, before, clickedAt } = started;
let reclicked = false;
const deadline = Date.now() + 5 * 60 * 1000;
setNationalProgress('Waiting for the Customer Hub file…');
let firstPass = true;
while (Date.now() < deadline) {
const listed = firstPass ? await openExportFilePage() : await reloadExportFilePage();
firstPass = false;
if (!listed) return { error: 'Could not find the Customer Hub file list. Stopped.' };
const row = findExportFileRow(year, month);
if (row && !row.file.recreating) {
const modified = parseLastModified(row.file.LastModified);
const changed = row.file.LastModified !== before;
const sinceClick = modified && modified.getTime() >= clickedAt - 60 * 1000;
if (changed || sinceClick) {
setNationalProgress('Reading Customer Hub file…');
return { text: await fetchExportText(row.file), previousVersion: before };
}
if (!reclicked && Date.now() - clickedAt > 30 * 1000) {
reclicked = clickRecreate(row);
if (reclicked) setNationalProgress('Recreating Customer Hub file…');
}
}
await sleep(3000);
}
return { error: 'The Customer Hub file did not finish recreating within 5 minutes.' };
}

// True when the newest activity in the file is older than the time the
// previous version was made, which means the download was the old file.
function isHubFileOlderThan(rows, previousVersion) {
const previous = parseLastModified(previousVersion);
if (!previous) return false;
let newest = 0;
rows.forEach((r) => {
const d = parseHubIsoDate(r['Intervention Created Date']);
if (d && d.getTime() > newest) newest = d.getTime();
});
return newest > 0 && newest < previous.getTime() - 60 * 1000;
}

async function buildNationalCheckResult(started, fetched) {
if (fetched.error) return { ok: null, summary: fetched.error };
const now = started.now;
let rows = parseCustomerHubTsv(fetched.text);
// The 3-day window reaches into last month for the first days of a month.
if (now.getDate() <= 3) {
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const prevRow = findExportFileRow(prev.getFullYear(), prev.getMonth() + 1);
if (prevRow) rows = rows.concat(parseCustomerHubTsv(await fetchExportText(prevRow.file)));
}
if (rows.length === 0 || !('ActivityID' in rows[0]) || !('Dealer' in rows[0])) {
return { ok: null, summary: 'The Customer Hub file did not have the expected columns. Stopped.' };
}
const leads = prescreenNationalLeads(rows, now);
// A new check starts from nothing: the last run's verdicts are dropped.
removeStoredKey(NATIONAL_RESULTS_KEY);
const stale = isHubFileOlderThan(rows, fetched.previousVersion);
return {
ok: null,
summary: `${leads.length} national lead${leads.length === 1 ? '' : 's'} since ${formatHubDate(nationalWindowStart(now)).slice(0, 5)}, ready to check on Konnect Live`
+ (stale ? '. Warning: the file has no activity newer than its previous version, so it may not have refreshed. Run the check again before relying on it.' : ''),
nationalBatchTsv: buildNationalBatchTsv(leads),
nationalCount: leads.length
};
}

async function finishNationalLeads(started) {
try {
if (!started || started.error) return { ok: null, summary: (started && started.error) || 'The Customer Hub file was not recreated.' };
return await buildNationalCheckResult(started, await finishNationalRecreate(started));
} catch (error) {
return { ok: null, summary: `Could not complete the National leads check: ${error && error.message ? error.message : error}` };
}
}

window._checkNationalLeads = async function(skipRestore) {
const originalHash = window.location.hash;
try {
let started;
try { started = await startNationalRecreate(new Date()); } catch (error) { started = { error: `Could not start the recreate: ${error && error.message ? error.message : error}` }; }
return await finishNationalLeads(started);
} finally {
if (!skipRestore) window.location.hash = originalHash;
}
};

// Which National leads need dealing with: set up again, waiting for a
// decision, or already decided by hand.
function nationalFlagged(results) {
return results.filter((r) => r.Verdict === RE_SETUP || r.Verdict === 'Check' || r.Decision);
}

function renderNationalCountChips(results, asFilters) {
const counts = countNationalVerdicts(results);
const tone = { [RE_SETUP]: 'bad', Check: 'warn', OK: 'ok' };
const filter = { [RE_SETUP]: 'rs', Check: 'ck' };
return NATIONAL_VERDICTS.map((v) => {
const text = `${escapeHtml(v)} ${counts[v] || 0}`;
return asFilters && filter[v]
? `<button type="button" class="sla-chip ${tone[v] || ''}" aria-pressed="false" data-filter="${filter[v]}" onclick="window._filterNationalResults(this)" title="Show only these">${text}</button>`
: `<span class="sla-chip ${tone[v] || ''}">${text}</span>`;
}).join('');
}

// The card under the morning checks list: the handoff buttons and, once the
// Lead Checker's verdicts are back, the counts and the way in to them.
function renderNationalCard(row) {
if (row.status !== 'done') return '';
const results = loadNationalResults();
const flagged = results ? nationalFlagged(results).length : 0;
const sendClass = results ? 'sla-sec' : 'sla-pri';
return `<div class="sla-card">
<div class="sla-bar"><b class="sla-grow">National leads</b>${results ? `<span class="sla-small">${results.length} checked</span>` : ''}</div>
${results ? `<div class="sla-cf">${renderNationalCountChips(results, false)}</div>` : ''}
<div class="sla-bar">
${results ? `<button type="button" class="sla-pri" onclick="window._showNationalResults(true)" ${flagged ? '' : 'disabled'}>${flagged ? `See the ${flagged} to deal with` : 'None to deal with'}</button>` : ''}
${row.nationalBatchTsv ? `<button type="button" class="${sendClass}" onclick="window._sendToLeadChecker(this, 'national')" title="Opens Konnect Live and sends the batch to the Lead Checker; the results come back here">Send to Lead Checker</button><button type="button" class="sla-sec" onclick="window._copyNationalBatch(this)">Copy instead</button>` : ''}
<button type="button" class="sla-sec" onclick="window._pasteNationalResults(this)">Paste National results</button>
</div>
</div>`;
}

// The National results view: Re setup leads as two line rows with their
// state as a tag, each lead waiting for a decision as a card with the reason,
// the note it was decided on, the why box and the two answers.
function renderNationalResultsBody(results) {
const resetProgress = loadLeadResetProgress();
const flagged = nationalFlagged(results);
const outcomeLine = (r) => `Lead ${escapeHtml(r.ActivityID)}${r.FinalOutcome ? ` &middot; Final outcome: ${escapeHtml(r.FinalOutcome)}` : ''}`;
const notesText = (r) => (r.FollowUpNotes ? `${r.FollowUpNotes.slice(0, 160)}${r.FollowUpNotes.length > 160 ? '…' : ''}` : '');
const decidedLine = (r) => {
// Keyed by ActivityID, not position: results arriving in parts move rows.
const activity = escapeHtml(r.ActivityID);
return r.Decision ? `<dt>By hand</dt><dd>${escapeHtml(r.Decision)}${r.DecisionNote ? ` (${escapeHtml(r.DecisionNote)})` : ''} <button type="button" class="sla-sec tight" data-activity="${activity}" onclick="window._undoNationalDecision(this.dataset.activity)">Undo</button></dd>` : '';
};
const row = (r, tagHtml, progressText) => `<div class="sla-r">
<span class="sla-av ${r.Verdict === RE_SETUP ? 'red' : ''}" aria-hidden="true">${escapeHtml(initialsFor(r.Customer))}</span>
<div class="sla-rmain" onclick="window._toggleCustomerContact(this)" aria-expanded="false" title="Show or hide details">
<span class="sla-nm"><i>${escapeHtml(r.Customer)}</i></span>
${tagHtml}
<span class="sla-meta">${escapeHtml(r.Reason)}</span>
</div>
<dl class="contact-details" style="display: none;">
<dt>Lead</dt><dd>${escapeHtml(r.ActivityID)}</dd>
${r.FinalOutcome ? `<dt>Final outcome</dt><dd>${escapeHtml(r.FinalOutcome)}</dd>` : ''}
${notesText(r) ? `<dt>Notes</dt><dd>${escapeHtml(notesText(r))}</dd>` : ''}
${progressText ? `<dt>Progress</dt><dd>${progressText}</dd>` : ''}
${decidedLine(r)}
</dl>
</div>`;

const reSetup = flagged.filter((r) => r.Verdict === RE_SETUP).map((r) => {
const status = resetProgress[r.ActivityID];
const tag = status === 'Done' ? '<span class="sla-tag done">Set up again</span>' : (status ? '<span class="sla-tag wait">Skipped</span>' : '<span class="sla-tag bad">To do</span>');
const progress = status
? `${status === 'Done' ? 'Set up again' : 'Skipped'} in Lead Re setup`
: `Not set up again yet: use Lead Re setup on the agent desktop${r.ResetCampaign ? ` (${escapeHtml(r.ResetCampaign)})` : ''}.`;
return row(r, tag, progress);
});
const toDecide = flagged.filter((r) => r.Verdict === 'Check' && !r.Decision).map((r) => {
const activity = escapeHtml(r.ActivityID);
return `<div class="sla-review">
<div class="sla-bar"><span class="sla-av amb" aria-hidden="true">${escapeHtml(initialsFor(r.Customer))}</span><b class="sla-grow">${escapeHtml(r.Customer)}</b><span class="sla-tag warn">Check</span></div>
<div>${escapeHtml(r.Reason)}</div>
${notesText(r) ? `<div class="sla-quote">${escapeHtml(notesText(r))}</div>` : ''}
<div class="sla-small">${outcomeLine(r)}</div>
<input type="text" id="_slaNatNote_${activity}" data-national-note="${activity}" placeholder="Why (optional, helps me add a rule)" aria-label="Why">
<div class="sla-bar">
<button type="button" class="sla-pri" data-activity="${activity}" onclick="window._decideNational(this.dataset.activity, '${RE_SETUP}')">Needs re setup</button>
<button type="button" class="sla-sec" data-activity="${activity}" onclick="window._decideNational(this.dataset.activity, 'Valid')">Valid</button>
</div>
</div>`;
});
const decidedValid = flagged.filter((r) => r.Decision && r.Verdict !== RE_SETUP && r.Verdict !== 'Check').map((r) => row(r, '<span class="sla-tag done">Valid</span>', ''));
const group = (key, title, count, inner) => (count ? `<div class="sla-g" data-ng="${key}"><div class="sla-grp">${title} <span>${count}</span></div>${inner}</div>` : '');
const decisions = results.filter((r) => r.Decision).length;

return `
<div class="sla-cf">${renderNationalCountChips(results, true)}</div>
<div id="_slaNationalList" class="sla-col" style="gap: 10px;" data-nf="">
${group('rs', 'Re setup', reSetup.length, `<div class="sla-list">${reSetup.join('')}</div>`)}
${group('ck', 'Check', toDecide.length, toDecide.join(''))}
${group('ck', 'Checked by hand: valid', decidedValid.length, `<div class="sla-list">${decidedValid.join('')}</div>`)}
${flagged.length ? '' : '<div class="sla-small">Nothing to deal with.</div>'}
</div>
${decisions ? `<button type="button" class="sla-sec" style="align-self: flex-start;" onclick="window._copyNationalDecisions(this)">Copy my decisions (${decisions}) for new rules</button>` : ''}`;
}

// A count chip shows only its own leads; pressing it again shows all.
window._filterNationalResults = function(chip) {
const list = document.getElementById('_slaNationalList');
if (!list) return;
const on = chip.getAttribute('aria-pressed') !== 'true';
chip.parentElement.querySelectorAll('button[data-filter]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
chip.setAttribute('aria-pressed', on ? 'true' : 'false');
list.dataset.nf = on ? chip.dataset.filter : '';
};

window._showNationalResults = function(show) {
morningChecksSubView = show ? 'national' : null;
displayMorningChecks();
};

// Lead Re setup is on the same site and records what it did per lead.
function loadLeadResetProgress() {
try {
const p = JSON.parse(localStorage.getItem(LEAD_RESET_PROGRESS_KEY) || 'null');
return p && p.byActivity && isStoredTimeFresh(p.savedAt) ? p.byActivity : {};
} catch (error) { return {}; }
}

// Pure. A hand decision on a Check lead. Re setup sends it to Lead Re setup;
// Valid closes it. The original verdict is kept so it can be undone.
function applyNationalDecision(result, decision, note) {
const next = { ...result, Decision: decision, DecisionNote: String(note || '').trim(), OriginalVerdict: result.OriginalVerdict || result.Verdict };
next.Verdict = decision === RE_SETUP ? RE_SETUP : 'OK';
return next;
}
function undoNationalDecision(result) {
const next = { ...result, Verdict: result.OriginalVerdict || result.Verdict };
delete next.Decision; delete next.DecisionNote; delete next.OriginalVerdict;
return next;
}

// Pure. New results from the Lead Checker keep any hand decision already
// made on the same lead (by ActivityID). keepMissing also keeps earlier rows
// the new results do not mention, for results that arrive in parts.
function mergeNationalResults(previous, incoming, keepMissing) {
const previousById = new Map((previous || []).filter((r) => r && r.ActivityID).map((r) => [r.ActivityID, r]));
const seen = new Set();
const merged = (incoming || []).map((r) => {
seen.add(r.ActivityID);
const old = previousById.get(r.ActivityID);
return old && old.Decision ? applyNationalDecision(r, old.Decision, old.DecisionNote) : r;
});
if (keepMissing) (previous || []).forEach((r) => { if (r && r.ActivityID && !seen.has(r.ActivityID)) merged.push(r); });
return merged;
}

// No names: what the check saw and what was decided, for writing rules.
function buildNationalDecisionsTsv(results) {
const header = ['ActivityID', 'CheckerReason', 'FinalOutcome', 'Attempts', 'EnquiryMaxDealer', 'Decision', 'Why'];
const rows = results.filter((r) => r.Decision).map((r) => [r.ActivityID, r.Reason, r.FinalOutcome, r.Attempts, r.EnquiryMaxDealer, r.Decision, r.DecisionNote].map(tsvClean).join('\t'));
return [header.join('\t'), ...rows].join('\n');
}

function flashNationalButton(btn, text) {
if (!btn) return;
const original = btn.textContent;
btn.textContent = text;
setTimeout(() => { btn.textContent = original; }, 1800);
}

window._decideNational = function(activityId, decision) {
const results = loadNationalResults() || [];
const index = results.findIndex((r) => r.ActivityID === activityId);
if (index < 0) return;
const noteEl = Array.from(document.querySelectorAll('input[data-national-note]')).find((el) => el.dataset.nationalNote === activityId);
results[index] = applyNationalDecision(results[index], decision, noteEl ? noteEl.value : '');
if (noteEl) noteEl.value = '';
saveNationalResults(results);
displayMorningChecks();
};

window._undoNationalDecision = function(activityId) {
const results = loadNationalResults() || [];
const index = results.findIndex((r) => r.ActivityID === activityId);
if (index < 0) return;
results[index] = undoNationalDecision(results[index]);
saveNationalResults(results);
displayMorningChecks();
};

window._copyNationalDecisions = function(btn) {
navigator.clipboard.writeText(buildNationalDecisionsTsv(loadNationalResults() || [])).then(
() => flashNationalButton(btn, 'Copied'),
() => flashNationalButton(btn, 'Clipboard blocked')
);
};

window._copyNationalBatch = function(btn) {
const row = morningChecksResults.find((r) => r.key === 'national');
if (!row || !row.nationalBatchTsv) return;
navigator.clipboard.writeText(row.nationalBatchTsv).then(
() => flashNationalButton(btn, `Copied ${row.nationalCount || 0}`),
() => flashNationalButton(btn, 'Clipboard blocked')
);
};

window._pasteNationalResults = async function(btn) {
let text = '';
try {
text = await navigator.clipboard.readText();
} catch (error) {
flashNationalButton(btn, 'Clipboard blocked');
return;
}
const parsed = parseNationalResultsTsv(text);
if (!parsed.ok) {
flashNationalButton(btn, parsed.error);
return;
}
// A fresh paste replaces the list, but hand decisions already made stay.
saveNationalResults(mergeNationalResults(loadNationalResults() || [], parsed.results, false));
displayMorningChecks();
};


runSelfTest('national-check', function() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
const header = ['InterventionID', 'Intervention Created Date', 'Communication Type', 'Campaign', 'Dealer', 'Reg Number', 'Customer', 'Callback Type', 'ActivityID', 'Activity Created Date', 'Call Outcome', 'Activity State', 'AttemptNumber', 'ActivityOutcome'].join('\t');
const row = (iid, when, dealer, customer, cbType, aid, outcome, state, attempt, actOutcome) =>
[iid, when, 'Outbound Call', 'Enquiry - Used', dealer, 'AB12CDE', customer, cbType, aid, '07/11/2026 09:00:00', outcome, state, attempt, actOutcome].join('\t');
const tsv = [header,
row('1', '2026-11-07 09:10:00', 'Stellantis &You National Used Cars', 'Alex Sample', 'New', '70000001', 'Manual Rescheduled', 'In Progress', '1', ''),
row('2', '2026-11-08 10:00:00', 'Stellantis &You National Used Cars', 'Alex Sample', 'Manual Rescheduled', '70000001', 'No Answer - Message Left', 'Completed', '3', 'Max Attempts Reached -  No Answer'),
row('3', '2026-11-08 11:00:00', 'National', 'Sam Buyer', 'Auto Rescheduled', '70000002', 'Manual Rescheduled', 'In Progress', '2', ''),
row('4', '2026-11-08 11:00:00', 'Stellantis &You Croydon', 'Jo Example', 'New', '70000003', 'Spoke to Customer', 'Completed', '1', 'Test Drive'),
row('5', '2026-11-01 11:00:00', 'National', 'Old Example', 'New', '70000004', 'No Answer - Message Left', 'Completed', '1', 'Email Only Lead')
].join('\n');
const rows = parseCustomerHubTsv(tsv);
check('parse row count', rows.length, 5);
check('parse reads a column by header', rows[0]['ActivityID'], '70000001');
const leads = prescreenNationalLeads(rows, new Date(2026, 10, 9, 9, 0));
check('dealer filter and 3-day window keep two leads', leads.map((l) => l.activityId), ['70000001', '70000002']);
const earlyRows = parseCustomerHubTsv([header,
row('6', '2026-11-06 08:00:00', 'National', 'Early Example', 'New', '70000005', 'Manual Rescheduled', 'In Progress', '1', ''),
row('7', '2026-11-05 23:59:00', 'National', 'Too Early', 'New', '70000006', 'Manual Rescheduled', 'In Progress', '1', '')].join('\n'));
check('window is whole days: a Monday afternoon run keeps Friday morning but not Thursday', prescreenNationalLeads(earlyRows, new Date(2026, 10, 9, 14, 30)).map((l) => l.activityId), ['70000005']);
const emailAfter = parseCustomerHubTsv([header,
row('8', '2026-11-08 09:59:00', 'Stellantis &You National Used Cars', 'Alex Sample', 'New', '70000007', 'Spoke to Customer', 'Completed', '1', 'Face to Face - National UCS'),
row('9', '2026-11-08 10:15:00', 'Stellantis &You National Used Cars', 'Alex Sample', 'Completed', '70000007', 'Notification Sent', 'Completed', '1', 'Face to Face - National UCS').replace('Outbound Call', 'Outbound Email')].join('\n'));
check('last contact is the last call, not a later notification email', prescreenNationalLeads(emailAfter, new Date(2026, 10, 9, 9, 0))[0].lastContact, '08/11/2026 09:59');
const alex = leads.find((l) => l.activityId === '70000001');
check('latest row wins for state', alex.state, 'Completed');
check('latest row wins for outcome', alex.outcome, 'Max Attempts Reached -  No Answer');
check('attempts is the highest attempt number', alex.attempts, 3);
check('manual reschedules counted', alex.manualReschedules, 2);
check('closed lead hint', alex.exportHint, 'closed');
check('lead created trimmed to the minute', alex.leadCreated, '07/11/2026 09:00');
const sam = leads.find((l) => l.activityId === '70000002');
check('auto reschedule counted', sam.autoReschedules, 1);
check('open lead with an auto reschedule', sam.exportHint, 'open-auto');
check('open lead has no outcome', sam.outcome, '');
const batch = buildNationalBatchTsv(leads).split('\n');
check('batch header', batch[0], NATIONAL_BATCH_HEADER.join('\t'));
check('batch row count', batch.length, 3);
check('batch row starts with national and has every column', [batch[1].split('\t')[0], batch[1].split('\t').length], ['national', NATIONAL_BATCH_HEADER.length]);
const freshRows = [{ 'Intervention Created Date': '2026-11-09 12:30:00' }];
check('file with activity after the previous version is fresh', isHubFileOlderThan(freshRows, '09/11/2026 08:53'), false);
check('file with nothing newer than the previous version is flagged', isHubFileOlderThan([{ 'Intervention Created Date': '2026-11-09 08:40:00' }], '09/11/2026 12:38'), true);
check('no previous version time means no warning', isHubFileOlderThan(freshRows, ''), false);
check('values with tabs are cleaned', buildNationalBatchTsv([{ ...alex, customer: 'Alex\tSample' }]).split('\n')[1].split('\t')[1], 'Alex Sample');
const resultTsv = [NATIONAL_RESULT_HEADER.join('\t'),
['national', 'Alex Sample', '70000001', '1400001', 'OK', 'Closed with Max Attempts', '3', 'Max Attempts Reached', '', '', '', 'AB12CDE'].join('\t'),
['national', 'Sam Buyer', '70000002', '1400002', 'Re setup', 'Closed with no dealership', '2', 'Email Only Lead', '', 'Customer asked for a call back', 'Enquiry - Used', 'AB12CDE'].join('\t'),
['national', 'Jo Example', '70000003', '', 'Not found', 'No matching lead', '', '', '', '', '', ''].join('\t')
].join('\n');
const parsed = parseNationalResultsTsv(resultTsv);
check('results import accepts the exact header', parsed.ok, true);
check('verdict counts', countNationalVerdicts(parsed.results), { 'Re setup': 1, Check: 0, 'Not found': 1, OK: 1 });
check('results import rejects another header', parseNationalResultsTsv('Name\tPhone\nx\ty').ok, false);
const olderHeader = ['NationalResult', 'Customer', 'ActivityID', 'LeadID', 'Verdict', 'Reason', 'Attempts', 'FinalOutcome', 'EnquiryMaxDealer', 'FollowUpNotes', 'ResetCampaign', 'ResetInitialNotes', 'ResetVoi', 'ResetPx'];
const olderExport = [olderHeader.join('\t'), ['national', 'Sam Buyer', '70000002', '1400002', 'Reset', 'x', '2', '', '', '', 'Enquiry - Used', 'notes', '', ''].join('\t')].join('\n');
check('an older export still imports and Reset reads as Re setup', [parseNationalResultsTsv(olderExport).ok, parseNationalResultsTsv(olderExport).results[0].Verdict, parseNationalResultsTsv(olderExport).results[0].Reg], [true, 'Re setup', '']);
check('older notes columns are not kept', 'ResetInitialNotes' in parseNationalResultsTsv(olderExport).results[0], false);
check('a stray line or byte order mark before the header is ignored', parseNationalResultsTsv('\uFEFFcopied from Lead Checker\n' + resultTsv).results.length, 3);
const checkRow = { ActivityID: '70000004', Verdict: 'Check', Reason: 'Misdirected', FinalOutcome: 'Misdirected', Attempts: '1', EnquiryMaxDealer: '' };
const decided = applyNationalDecision(checkRow, RE_SETUP, ' dealer never got it ');
check('a hand decision of re setup joins the Lead Re setup list', [decided.Verdict, decided.Decision, decided.DecisionNote, decided.OriginalVerdict], [RE_SETUP, RE_SETUP, 'dealer never got it', 'Check']);
check('a valid decision closes it', applyNationalDecision(checkRow, 'Valid', '').Verdict, 'OK');
check('undo restores the checker verdict', [undoNationalDecision(decided).Verdict, 'Decision' in undoNationalDecision(decided)], ['Check', false]);
check('decisions export carries no names', buildNationalDecisionsTsv([{ ...decided, Customer: 'Alex Sample' }]).includes('Alex Sample'), false);
check('an export missing a needed column is refused', parseNationalResultsTsv('NationalResult\tCustomer\nnational\tAlex').ok, false);
const partOne = [decided, { ActivityID: '70000005', Verdict: 'OK', Reason: 'a' }];
const partTwo = [{ ...checkRow, Reason: 'Misdirected (rechecked)' }, { ActivityID: '70000006', Verdict: 'Check', Reason: 'b' }];
const mergedParts = mergeNationalResults(partOne, partTwo, true);
check('a hand decision survives newer results for the same lead', [mergedParts[0].Verdict, mergedParts[0].Decision, mergedParts[0].DecisionNote, mergedParts[0].OriginalVerdict, mergedParts[0].Reason], [RE_SETUP, RE_SETUP, 'dealer never got it', 'Check', 'Misdirected (rechecked)']);
check('results arriving in parts keep the earlier rows', mergedParts.map((r) => r.ActivityID), ['70000004', '70000006', '70000005']);
check('a fresh paste replaces the list but keeps decisions', mergeNationalResults(partOne, partTwo, false).map((r) => [r.ActivityID, r.Decision || '']), [['70000004', RE_SETUP], ['70000006', '']]);
check('a lead with no decision is taken as the checker gave it', mergeNationalResults(partOne, [{ ActivityID: '70000005', Verdict: 'Check' }], false)[0].Verdict, 'Check');
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager national-check self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager national-check self-test passed');
}
});

// Run order, separate from display order. sla needs no navigation. routedTo
// and leadType share the Inbound API page, and routedTo goes first because
// it always loads Today. National leads is not here: its slow recreate is
// started before these and finished after them.
const MORNING_CHECKS_EXECUTION_ORDER = ['sla', 'routedTo', 'leadType', 'inProgress', 'voicemail'];

// Runs the five checks, redrawing after each so results appear as they land.
// Email Only Count is filled as a side effect of "sla".
window._runAllMorningChecks = async function() {
if (runningMorningChecks) return;
if (refuseIfBusy()) return;
runningMorningChecks = true;
const originalHash = window.location.hash;
const runStartedAt = Date.now();
showPageFlashOverlay('Running morning checks…');

const checkFns = {
sla: () => window._checkSlaCount(),
inProgress: () => window._checkInProgress(true),
leadType: () => window._checkLeadTypes(true),
routedTo: () => window._checkRoutedTo(true),
voicemail: () => window._checkVoicemails(true)
};

morningChecksResults = MORNING_CHECKS_ORDER.map(step => ({ ...step, status: 'pending' }));
displayMorningChecks();

let overlayShown = true;
try {
// Start the Customer Hub recreate first so it rebuilds while the other
// checks run.
morningChecksResults = morningChecksResults.map(r => r.key === 'national' ? { ...r, status: 'running' } : r);
displayMorningChecks();
let nationalStarted;
try { nationalStarted = await startNationalRecreate(new Date()); } catch (err) { nationalStarted = { error: `Could not start the recreate: ${err && err.message ? err.message : err}` }; }

for (const key of MORNING_CHECKS_EXECUTION_ORDER) {
morningChecksResults = morningChecksResults.map(r => r.key === key ? { ...r, status: 'running' } : r);
displayMorningChecks();

let result;
try {
result = await checkFns[key]();
} catch (err) {
result = { ok: null, summary: `Error: ${err && err.message ? err.message : err}` };
}

morningChecksResults = morningChecksResults.map(r => r.key === key ? { ...r, status: 'done', ...result } : r);
// Email Only Count comes from the SLA check and is settled with it, even on
// failure, so it never stays on "Waiting".
if (key === 'sla') {
const emailSummary = typeof result.emailOnlyCount === 'number' ? `${result.emailOnlyCount}` : 'Could not be determined (SLA check failed).';
morningChecksResults = morningChecksResults.map(r => r.key === 'emailOnly' ? { ...r, status: 'done', ok: null, summary: emailSummary } : r);
}
displayMorningChecks();
}

// Every other check is done: lift the overlay so their results can be
// read while the National leads file finishes.
hidePageFlashOverlay();
overlayShown = false;
saveMorningChecksLastRun(morningChecksResults, Date.now() - runStartedAt);
const nationalResult = await finishNationalLeads(nationalStarted);
morningChecksResults = morningChecksResults.map(r => r.key === 'national' ? { ...r, status: 'done', progress: '', ...nationalResult } : r);
displayMorningChecks();
} finally {
runningMorningChecks = false;
window.location.hash = originalHash;
if (overlayShown) hidePageFlashOverlay();
saveMorningChecksLastRun(morningChecksResults, Date.now() - runStartedAt);
// runningMorningChecks only clears after the loop, so redraw once more or
// the button stays on "Running".
displayMorningChecks();
}
};

// ===================================================================
// LEAD DETAIL RENDERING HELPERS
//
// Shared by the SLA and Pending Customers panels: modal scraping, clipboard
// copy and the per-lead assignment markup.
// ===================================================================

// Reads a labelled row from the modal's Customer tab. Scoped to the active
// tab pane because uib-tab keeps the Vehicles Owned tab's identical table in
// the DOM too. Mobiles and Landlines can hold comma-separated lists.
function readModalTabField(modal, label) {
const rows = Array.from(modal.querySelectorAll('.tab-pane.active table.table tr'));
const row = rows.find(r => r.querySelector('td')?.textContent?.trim() === label);
if (!row) return '';
return row.querySelectorAll('td')[1]?.textContent?.trim() || '';
}

function firstFromCommaList(raw) {
return (raw || '').split(',').map(s => s.trim()).find(s => s.length > 0) || '';
}

function closeDetailModal(modal) {
if (!modal) return;
const closeBtn = modal.querySelector('.close, [aria-label*="close"], [aria-label*="Close"]') || modal.querySelector('button:last-child');
if (closeBtn) { closeBtn.click(); return; }
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
}

// Pure. True when every word of the row's customer name (title dropped)
// appears in the text given.
function nameAppearsIn(expectedName, text) {
const words = stripTitle(String(expectedName || '')).toLowerCase().split(/\s+/).filter(Boolean);
const hay = String(text || '').toLowerCase();
return words.length > 0 && words.every((word) => hay.includes(word));
}

// What the pop-up shows now. labelled: the Customer tab's own rows are there.
function readModalContact(modal) {
const labels = Array.from(modal.querySelectorAll('.tab-pane.active table.table tr')).map((r) => r.querySelector('td')?.textContent?.trim() || '');
const mobiles = readModalTabField(modal, 'Mobiles');
const landlines = readModalTabField(modal, 'Landlines');
const email = readModalTabField(modal, 'Email');
const name = readModalTabField(modal, 'Name');
return {
labelled: ['Mobiles', 'Landlines', 'Email'].some((label) => labels.includes(label)),
name,
phone: (firstFromCommaList(mobiles) || firstFromCommaList(landlines)).replace(/\s+/g, ''),
email,
signature: [name, mobiles, landlines, email].join('|')
};
}

const DETAIL_SETTLE_MS = 100;
// How long a pop-up with its rows in place but no phone or email is given
// to fill before the lead is taken to have neither.
const DETAIL_BLANK_WAIT_MS = 1200;
// How long to wait for the customer's name to show in the pop-up before
// reading it anyway (the old pop-up is already known to have gone).
const DETAIL_NAME_WAIT_MS = 2000;
const DETAIL_MAX_WAIT_MS = 4000;

// Opens the row's customer pop-up and reads the phone and email. read is
// false when the details could not be trusted: such a lead is tried again
// on the next scan and never counts as Email Only.
async function extractCustomerDetails(customerElement, expectedName) {
const unread = { phone: '', email: '', read: false };
const nameLink = customerElement.querySelector('a');
if (!nameLink) return unread;

// A pop-up left open, or still closing, belongs to another lead.
if (findDetailModal() && !(await waitForModalGone(1500))) {
closeDetailModal(findDetailModal());
if (!(await waitForModalGone())) return unread;
}

nameLink.click();
const modal = await waitUntil(findDetailModal, DETAIL_MAX_WAIT_MS);
if (!modal) return unread;

try {
// The content arrives after the pop-up mounts: wait until the labelled
// rows are there, have stopped changing, and the name is this row's.
const started = Date.now();
let contact = readModalContact(modal);
let previous = null;
let nameOk = false;
while (Date.now() - started < DETAIL_MAX_WAIT_MS) {
await sleep(DETAIL_SETTLE_MS);
contact = readModalContact(modal);
nameOk = nameAppearsIn(expectedName, contact.name || modal.textContent);
const waited = Date.now() - started;
const settled = contact.signature === previous;
previous = contact.signature;
if (!settled) continue;
if (nameOk && contact.labelled && (contact.phone || contact.email)) break;
if (nameOk && contact.labelled && waited >= DETAIL_BLANK_WAIT_MS) break;
if (waited >= DETAIL_NAME_WAIT_MS && (contact.labelled || modal.textContent.trim())) break;
}

let { phone, email } = contact;
// A Name row showing somebody else means this is not this lead's pop-up.
const wrongCustomer = !!contact.name && !nameOk;
let read = contact.labelled && !wrongCustomer;
if (wrongCustomer) {
phone = '';
email = '';
} else if (!contact.labelled) {
// A layout without the labelled rows: fall back to reading the whole
// pop-up, but do not treat a missing phone as known.
const modalText = modal.innerText || modal.textContent;
const phoneMatch = modalText.match(/\b(07\d{9}|0\d{3}\s?\d{3}\s?\d{3,4}|0\d{10})\b/);
const emailMatch = modalText.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
phone = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : '';
email = emailMatch ? emailMatch[1] : '';
}

closeDetailModal(modal);
await waitForModalGone();
return { phone, email, read };
} catch (error) {
console.warn('Detail extraction error:', error && error.message);
return unread;
}
}

// The chip's own text is kept on the element the first time, so a second
// click while "Copied!" is showing does not save that as the original.
function copyToClipboard(text, element) {
if (element.dataset.copyOriginal === undefined) element.dataset.copyOriginal = element.textContent;
const flash = (label, background) => {
clearTimeout(element._slaCopyTimer);
element.textContent = label;
element.style.background = background;
element.style.color = 'white';
element._slaCopyTimer = setTimeout(() => {
element.textContent = element.dataset.copyOriginal;
element.style.background = '';
element.style.color = '';
delete element.dataset.copyOriginal;
}, 1500);
};
navigator.clipboard.writeText(text).then(() => flash('✓ Copied!', '#047857')).catch((error) => {
console.warn('Copy failed:', error && error.message);
flash('✗ Failed', '#dc2626');
});
}

function escapeHtml(value) {
return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
}

function stripTitle(name) {
return name.replace(/^(mr|mrs|miss|ms|mx|dr|prof|rev|sir|lady)\.?\s+/i, '').trim();
}

function initialsFor(name) {
const parts = stripTitle(name || '').split(/\s+/).filter(Boolean);
if (parts.length === 0) return '?';
if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Order matters: Post-Closure "send back through" and a queue mismatch (both
// "do not just assign this") outrank an SLA timer, which outranks a note.
// The Konnect Notes shorthand for each send back reason (CAD dealer acted,
// CAH hub contact or email only), kept in step with the Lead Checker.
const POST_CLOSURE_SHORTHAND = { 'Actioned by dealership': 'CAD', 'Email only': 'CAH', "In market won't commit": 'CAH' };

function pickLeadCheckerBadge(leadChecker) {
if (!leadChecker) return null;
// Post Closure leads only ever show the send back or check label, never a
// tier, including results from an older Lead Checker that set no action.
if (!leadChecker.postClosureAction && /^post closure processing$/i.test(String(leadChecker.source || '').trim())) {
return { label: 'check: needs contact?', color: postClosureActionColor('check: needs contact?'), source: 'leadChecker' };
}
if (leadChecker.postClosureAction) {
const shorthand = POST_CLOSURE_SHORTHAND[leadChecker.postClosureReason];
const label = leadChecker.postClosureReason ? `${leadChecker.postClosureAction}: ${leadChecker.postClosureReason}${shorthand ? ` (${shorthand})` : ''}` : leadChecker.postClosureAction;
return { label, color: postClosureActionColor(leadChecker.postClosureAction), source: 'leadChecker' };
}
if (leadChecker.tierName) {
return { label: leadChecker.tierName, color: leadCheckerImportCategoryColor(leadChecker.tier), source: 'leadChecker' };
}
return null;
}

function renderAssignmentBadge(assigned, agentName) {
return assigned
? `<span class="sla-tag done">${escapeHtml(agentName || 'Assigned')}</span>`
: `<span class="sla-tag wait">Unassigned</span>`;
}

// Assigns one lead immediately on change. Handled by a delegated listener
// with data-lead-key, because lead keys come from raw customer text that
// could break out of an inline JS string.
function renderManualAssignPicker(leadKey, pageType) {
const agents = getAgentRoster();
if (agents.length === 0) return renderAssignmentBadge(false, null);
const options = agents.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
return `<select class="manual-assign-select" data-lead-key="${escapeHtml(leadKey)}" data-page-type="${pageType}"
style="cursor: pointer;" aria-label="Assign to">
<option value="" selected disabled>Choose an agent</option>
${options}
</select>`;
}

// ===================================================================
// ASSIGNMENT ENGINE (shared between the SLA tab and Pending Customers)
//
// Both pages' Assign columns use the same div.dropdown.ng-scope structure.
// ===================================================================

function parseKonnectDate(text) {
// Matches "Tue, 18 Aug 2026 09:15", ignoring the weekday. Returns null for
// anything else. A lead with no readable date is left out of every "due
// within" count and run, and is only assigned when no time limit is set.
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

// Shape: {ID, DisplayText, CurrentStatusName, $$hashKey}.
function normalizeAgent(agent) {
return {
id: String(agent.ID),
name: agent.DisplayText,
status: agent.CurrentStatusName || '',
raw: agent
};
}

// The agent list can only be scraped from an unassigned lead's dropdown, so
// an all-assigned table has nothing to read. The last good read is cached
// so the roster stays usable.
let cachedAgentRoster = null;

function getAgentRoster() {
// Scoped to the table first so an unrelated dropdown with the same classes
// is not picked up.
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

// Lets callers tell "no agents online" apart from "cannot check right now".
function canCheckAgentRoster() {
return !!(document.querySelector('table .dropdown.ng-scope') || document.querySelector('.dropdown.ng-scope'));
}

// Cached per render because the live "N leads match" preview re-scanned the
// whole table on every filter change. The assign action itself always
// re-scans fresh before clicking.
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

// Patches this cache alongside currentCustomers after an assign run, so the
// stat tiles match the cards. Patched in place rather than invalidated, since
// a re-scan right after the queue check would race Angular's repopulation.
function patchCachedLeadsAssigned(successByKey) {
if (!cachedLeadsSnapshot) return;
cachedLeadsSnapshot.leads = cachedLeadsSnapshot.leads.map((l) =>
successByKey.has(l.key) ? { ...l, assigned: true, agentName: successByKey.get(l.key) } : l
);
}

// The same for Clear Queue, which unassigns every lead.
function patchCachedLeadsCleared() {
if (!cachedLeadsSnapshot) return;
cachedLeadsSnapshot.leads = cachedLeadsSnapshot.leads.map((l) => ({ ...l, assigned: false, agentName: null }));
}

// Checks that repeated getCached*() calls do not touch the DOM again until
// invalidateLeadsCache() runs. Whether the table wait matches Konnect's real
// render timing can only be checked live.
runSelfTest('leadsCacheSelfTest', function leadsCacheSelfTest() {
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
reportSelfTestFailure('SLA Manager leads-cache self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager leads-cache self-test passed');
}
} finally {
document.querySelector = originalQuerySelector;
}
});

// A static "last scanned at HH:MM" rather than a ticking "Xm ago", to avoid
// another interval that could outlive the bookmarklet.
function lastScannedLabel() {
if (!cachedLeadsSnapshot || !cachedLeadsSnapshot.scannedAt) return 'not yet scanned';
return 'scanned ' + formatTimeForInput(cachedLeadsSnapshot.scannedAt);
}

function collectAssignableLeads() {
const table = document.querySelector('table');
if (!table) return [];

// Stays a fast synchronous scan: phone and email come from currentCustomers.
// A lead not yet scanned, or whose details could not be read, is excluded
// from the Email only filter.
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
isEmailOnly: !!cached && cached.detailsRead === true && !cached.phone && !!cached.email
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
if (windowMinutes != null) {
// A "due within" run only takes leads whose SLA date could be read, the
// same leads the due tiles count.
if (!lead.slaDate) return false;
const minutesUntilDue = (lead.slaDate.getTime() - now) / 60000;
if (minutesUntilDue > windowMinutes) return false;
}
return true;
});
}

// Counts are scoped to the selected window so they shrink with it. A null
// window (the 'All' preset) uses the unscoped total.
function computeSlaTierCounts(leads, windowMinutes) {
const now = Date.now();
return [1, 2, 3, 4].map(t => leads.filter((l) => {
if (l.assigned || l.tier !== t) return false;
if (windowMinutes == null) return true;
return !!l.slaDate && (l.slaDate.getTime() - now) / 60000 <= windowMinutes;
}).length);
}

runSelfTest('dueFilterSelfTest', function dueFilterSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
const at = (mins) => new Date(Date.now() + mins * 60000);
const lead = (name, slaDate, over) => ({ name, slaDate, tier: 2, assigned: false, status: 'Pending', isCustomerFirst: false, isEmailOnly: false, ...over });
const leads = [
lead('missed', at(-20), { status: 'Missed' }),
lead('due in 10', at(10)),
lead('due in 40', at(40)),
lead('no readable date', null),
lead('assigned', at(5), { assigned: true }),
lead('tier 4', at(5), { tier: 4 })
];
const all = new Set([1, 2, 3, 4]);
const names = (options) => filterAssignableLeads(leads, { tiers: all, windowMinutes: null, customerFirstOnly: false, emailOnly: false, ...options }).map((l) => l.name);
check('a due within run leaves out a lead whose SLA date could not be read', names({ windowMinutes: 15 }), ['missed', 'due in 10', 'tier 4']);
check('with no time limit that lead is still assigned', names({}), ['missed', 'due in 10', 'due in 40', 'no readable date', 'tier 4']);
check('missed only', names({ missedOnly: true }), ['missed']);
check('tier filter', names({ tiers: new Set([4]) }), ['tier 4']);
check('tier counts in a window match the run', computeSlaTierCounts(leads, 15), [0, 2, 0, 1]);
check('tier counts with no window count every unassigned lead', computeSlaTierCounts(leads, null), [0, 4, 0, 1]);
check('time past in plain words', [45, 60, 71, 120].map(formatDueMinutes), ['45 min', '1 h', '1 h 11 min', '2 h']);
const dueNow = Date.now();
const dueAt = (mins, status) => slaDueDisplay({ slaDate: new Date(dueNow + mins * 60000), status: status || 'Pending' }, dueNow);
check('the time on a row: missed and under 15 minutes red, within the hour amber, later grey', [dueAt(-65, 'Missed'), dueAt(8), dueAt(21), dueAt(187)].map((d) => `${d.text}|${d.tone}`), ['Missed 1 h 5 min|bad', '8 min|bad', '21 min|warn', '3 h 7 min|mut']);
check('campaign on the grey line', ['Peugeot - Test Drive Request - New (pcr_new_test_drive)', 'Citroen - Enquiry - New (Test drive request)', 'Motability', 'Citroen - Electric'].map(shortCampaign), ['Peugeot Test Drive Request, New', 'Citroen Enquiry, New (Test drive request)', 'Motability', 'Citroen Electric']);
check('tier names read in sentence case', ['DATE ONLY', 'Date and time', ''].map(sentenceCase), ['Date only', 'Date and time', '']);
check('the folded tiers row', [[1, 2, 3, 4], [1, 3], []].map((s) => tierFilterLabel(new Set(s))), ['Tiers: all four', 'Tiers: 1, 3', 'Tiers: none']);
check('an unreadable date is null, not a guess', [parseKonnectDate('soon'), parseKonnectDate('') === null, parseKonnectDate('Tue, 18 Aug 2026 09:15').getHours()], [null, true, 9]);
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager due-filter self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager due-filter self-test passed');
}
});

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

// Dealt in rounds of one lead per agent, reshuffling the agent order every
// round, so nobody is always first in line. Leftovers go to the agents with
// the lightest current load in the queue, including Konnect's own assigns.
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

// Leads each agent holds in this queue, keyed by agent id. Returns null
// (meaning use random) if the scan fails or no assigned name matches a roster
// agent, since counting nothing would bias every leftover to the same people.
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
// Shuffled first so ties break at random rather than by roster order.
const loads = currentAgentLoads(agents) || {};
const extras = shuffle(agents)
.sort((a, b) => (loads[a.id] || 0) - (loads[b.id] || 0))
.slice(0, leads.length - i);
shuffle(extras).forEach((agent) => plan.push({ lead: leads[i++], agent }));
}
return plan;
}

// Re-located at click time because Angular may have re-rendered the row
// since the plan was built. More than one match means two leads share a key,
// and the run skips them rather than guess.
function findSlaAssignCells(lead) {
const found = [];
const table = document.querySelector('table');
if (!table) return found;
const rows = table.querySelectorAll('tbody tr');
for (const row of rows) {
const cells = row.querySelectorAll('td');
if (cells.length < 9) continue;
const key = `${cells[COL_CUSTOMER]?.textContent?.trim()}||${cells[COL_REGISTRATION]?.textContent?.trim()}||${cells[COL_SOURCE]?.textContent?.trim()}||${cells[COL_CAMPAIGN]?.textContent?.trim()}`;
if (key === lead.key) found.push(cells[COL_ASSIGN]);
}
return found;
}
function locateAssignCell(lead) {
return findSlaAssignCells(lead)[0] || null;
}
locateAssignCell.findAll = findSlaAssignCells;

// The visible text includes an icon and status, not the bare name, so the
// agent is matched by position: ng-repeat renders the li elements in the same
// order as scope.agents. The li carries the ng-click.
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

// ng-repeat can replace the cell or its whole row, so the row is found
// afresh on every look. Resolves 'confirmed' once the row shows an agent,
// 'timeout' if it still offers the menu, or 'gone' if the row has left the
// page: a missing row is not proof the assign went through.
const ASSIGN_ROW_GONE_MS = 1500;
async function waitForAssignConfirmed(lead, locateCellFn, timeout = 6000) {
const started = Date.now();
let missingSince = null;
for (;;) {
const cell = locateCellFn(lead);
const now = Date.now();
if (cell) {
missingSince = null;
if (!cell.querySelector('.dropdown')) return 'confirmed';
} else {
if (missingSince === null) missingSince = now;
// A row being redrawn is back within a moment.
if (now - missingSince >= ASSIGN_ROW_GONE_MS) return 'gone';
}
if (now - started >= timeout) return cell ? 'timeout' : 'gone';
await sleep(100);
}
}

function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

// Background tabs throttle timers heavily, which could make a modal look as
// if it never opened.
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

// Clicks are staggered just enough for Angular's digest to settle, and
// confirmations resolve concurrently, so results arrive out of click order.
const ASSIGN_CLICK_STAGGER_MS = 200;

// Caps leads awaiting confirmation at once, so a big sweep does not flood
// Konnect's backend and push stragglers past the confirmation timeout.
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
const allCells = locateCellFn.findAll(lead);
if (allCells.length > 1) {
results[i] = { lead, agent, ok: false, reason: 'Skipped: more than one row matches this lead. Assign it by hand' };
settled.push(results[i]);
reportProgress();
releaseSlot();
continue;
}
const cell = locateCellFn(lead);
if (cell && getAssignCellState(cell).assigned) {
results[i] = { lead, agent, ok: false, reason: 'Already assigned on the page' };
settled.push(results[i]);
reportProgress();
releaseSlot();
continue;
}
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
pending.push(confirmPromise.then((outcome) => {
const ok = outcome === 'confirmed';
results[i] = { lead, agent, ok, unconfirmed: outcome === 'gone', reason: ok ? null : (outcome === 'gone' ? 'Not confirmed: the row left the page. Check it in Konnect' : 'Timed out waiting for confirmation') };
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
// The log persists (capped) so today's per-agent counts survive
// re-invocations, for checking everyone got a fair share.
// ===================================================================

const ASSIGN_LOG_KEY = '_slaAssignmentLog';
const ASSIGN_LOG_MAX = 500;

function renderAssignResultsSummary(results) {
const el = document.getElementById('assignResultsSummary');
if (!el) return;
if (!results || results.length === 0) { el.innerHTML = ''; return; }
const succeeded = results.filter(r => r.ok).length;
const unconfirmed = results.filter(r => !r.ok && r.unconfirmed).length;
const failed = results.length - succeeded - unconfirmed;
const problems = failed + unconfirmed;
const color = problems === 0 ? '#047857' : (succeeded === 0 ? '#b91c1c' : '#b45309');
const icon = problems === 0 ? '✓' : '⚠';
const text = `${icon} ${[`${succeeded} assigned`, unconfirmed ? `${unconfirmed} not confirmed` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(', ')}`;
const retryLink = failed > 0
? ` <span onclick="window._retryFailedAssignments()" style="text-decoration: underline; cursor: pointer;">Retry Failed</span>`
: '';
el.innerHTML = `<div style="margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: ${color}20; color: ${color}; font-size: 13px; font-weight: 700; text-align: center;">${text}${retryLink}</div>`;
}

// Retries only the failed leads with the same agents, keeping the original
// distribution. Failures are usually a slow backend, not a bad pairing.
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

// Prunes anything not from today on every write, so History counts are
// trustworthy and the cap is spent on today's entries.
function appendAssignmentLog(results, pageType) {
try {
const today = new Date().toDateString();
const existing = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]')
.filter(e => new Date(e.time).toDateString() === today && isStoredTimeFresh(e.time));
const now = new Date().toISOString();
// The tier, page and lead key are kept for the fair share numbers (Pending
// leads have no tier). shown is the name the Assign column now shows for
// the agent, in case it differs from the roster's.
const locate = pageType === PAGE_PENDING ? locatePendingAssignCell : locateAssignCell;
const entries = results.filter(r => r.ok).map((r) => {
const shown = pageType ? getAssignCellState(locate(r.lead)).agentName : null;
return {
time: now,
lead: r.lead.name,
agent: r.agent.name,
...(r.lead.tier ? { tier: r.lead.tier } : {}),
...(pageType && r.lead.key ? { key: r.lead.key, page: pageType } : {}),
...(shown && normalizeAgentName(shown) !== normalizeAgentName(r.agent.name) ? { shown } : {})
};
});
const updated = existing.concat(entries).slice(-ASSIGN_LOG_MAX);
localStorage.setItem(ASSIGN_LOG_KEY, JSON.stringify(updated));
} catch (error) {
console.warn('Failed to persist assignment log', error);
}
recordEmailOnlyAssignments(results);
}

// Email Only leads assigned today, for Lead Re setup's Email Only run on
// the agent desktop (same site). It only works leads on this list, so a
// lead that presents without being on it is left to the agent.
const EMAIL_ONLY_ASSIGNED_KEY = '_workToolsEmailOnlyAssigned';

function emailOnlyAssignmentsFrom(results, cachedByKey) {
return results.filter((r) => r.ok).map((r) => {
const cached = cachedByKey.get(r.lead.key) || r.lead;
// No phone only means Email Only when the lead's details were really read.
if (cached.detailsRead === false) return { name: r.lead.name, email: '', phone: '' };
const email = String(cached.email || r.lead.email || '').trim();
const phone = String(cached.phone || r.lead.mobile || r.lead.landline || '').trim();
return { name: r.lead.name, email, phone, campaign: r.lead.campaign || '', agent: r.agent.name };
}).filter((e) => e.email && !e.phone).map(({ phone, ...e }) => e);
}

function recordEmailOnlyAssignments(results) {
try {
const fresh = emailOnlyAssignmentsFrom(results, new Map(currentCustomers.map((c) => [c.key, c])));
if (!fresh.length) return;
const today = new Date().toDateString();
const stored = JSON.parse(localStorage.getItem(EMAIL_ONLY_ASSIGNED_KEY) || 'null');
const kept = stored && new Date(stored.savedAt).toDateString() === today && Array.isArray(stored.leads) ? stored.leads : [];
const byEmail = new Map(kept.map((e) => [e.email.toLowerCase(), e]));
fresh.forEach((e) => byEmail.set(e.email.toLowerCase(), { ...e, assignedAt: new Date().toISOString() }));
localStorage.setItem(EMAIL_ONLY_ASSIGNED_KEY, JSON.stringify({ savedAt: new Date().toISOString(), leads: Array.from(byEmail.values()) }));
} catch (error) {
console.warn('[SLA Manager] Could not save the Email Only assignments.');
}
}

// Filters to today again in case the day rolled over mid-session.
function todaysAssignmentLog() {
let entries = [];
try { entries = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]'); } catch (error) { /* ignore */ }
if (!Array.isArray(entries)) return [];
const today = new Date().toDateString();
return entries.filter(e => e && new Date(e.time).toDateString() === today && isStoredTimeFresh(e.time));
}

// FAIR SHARE (the Team today view): what each agent has been assigned today
// by this tool, from the assignment log, and what became of those leads on
// later scans. "Assigned" and "sent back" are things the tool saw. "Done"
// comes from the agents' queues where they have been read. Without that it
// is a best guess: the lead left the list while still showing that agent,
// which also happens when a lead expires or moves queue.

// Pure. Follows today's assignments through a scan of the page they were
// made on. leads: every row of that scan ({key, assigned, agentName}).
// state 'back': seen unassigned or with another agent since (Clear Queue
// does this), or assigned again by this tool. state 'gone': no longer on the
// list, last seen with the agent. A lead that shows again with the agent
// goes back to open. Returns the same array when nothing changed.
function reconcileAssignments(entries, pageType, leads) {
const byKey = new Map();
const twice = new Set();
leads.forEach((l) => { if (byKey.has(l.key)) twice.add(l.key); else byKey.set(l.key, l); });
const latest = new Map();
entries.forEach((e, i) => { if (e.key && e.page === pageType) latest.set(e.key, i); });
let changed = false;
const next = entries.map((e, i) => {
if (!e.key || e.page !== pageType || e.state === 'back') return e;
let state;
if (latest.get(e.key) !== i) state = 'back';
// Two rows with one key: no telling which is this lead.
else if (twice.has(e.key)) return e;
else {
const lead = byKey.get(e.key);
if (!lead) state = 'gone';
else if (!lead.assigned || normalizeAgentName(lead.agentName) !== normalizeAgentName(e.shown || e.agent)) state = 'back';
}
if (state === e.state) return e;
changed = true;
const { state: previous, ...rest } = e;
return state ? { ...rest, state } : rest;
});
return changed ? next : entries;
}

// Called after a scan. An empty read is skipped, since it is more often a
// table not drawn yet than a queue with nothing in it.
function followAssignments(pageType, leads) {
if (!pageType || !leads || leads.length === 0) return;
try {
const stored = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]');
if (!Array.isArray(stored) || stored.length === 0) return;
const next = reconcileAssignments(stored, pageType, leads);
if (next !== stored) localStorage.setItem(ASSIGN_LOG_KEY, JSON.stringify(next));
} catch (error) {
console.warn('[SLA Manager] Could not follow the assignments.');
}
}

// Pure. Per agent (by normalised name): the total, the count in each SLA
// tier, and how many are gone from the list (done) or were sent back. An
// entry with no tier (a Pending lead) counts in the total only.
function fairShareTally(entries) {
const tally = {};
entries.forEach((e) => {
const key = normalizeAgentName(e.agent);
if (!key) return;
const row = tally[key] || (tally[key] = { name: e.agent, total: 0, tiers: [0, 0, 0, 0], done: 0, back: 0 });
row.total++;
if (e.tier >= 1 && e.tier <= 4) row.tiers[e.tier - 1]++;
if (e.state === 'gone') row.done++;
if (e.state === 'back') row.back++;
});
return tally;
}

// Pure. The Team today rows, one per agent, by name. names: the agents
// online. Done is the count from the agent's queue where the Queue has been
// read today (it includes leads this tool did not assign); otherwise the
// guess from the lead list, marked "about".
function teamTodayRows(names, tally, queueDone) {
const queue = (queueDone && queueDone.agents) || {};
const display = {};
names.forEach((name) => { display[normalizeAgentName(name)] = name; });
Object.keys(queue).forEach((key) => { if (!display[key]) display[key] = queue[key].name; });
Object.keys(tally).forEach((key) => { if (!display[key]) display[key] = tally[key].name; });
return Object.keys(display).filter(Boolean).sort().map((key) => {
const row = tally[key] || { total: 0, tiers: [0, 0, 0, 0], done: 0, back: 0 };
const tiered = row.tiers.reduce((sum, n) => sum + n, 0);
const untiered = row.total - tiered;
const assigned = row.total === 0 ? '0' : `${row.total}${tiered ? ` (${row.tiers.join(' / ')})` : ''}${tiered && untiered ? ` + ${untiered} no tier` : ''}`;
return { name: display[key], assigned, done: queue[key] ? String(queue[key].ids.length) : `about ${row.done}`, back: String(row.back) };
});
}

function renderTeamToday() {
const rows = teamTodayRows(getAgentRoster().map((a) => a.name), fairShareTally(todaysAssignmentLog()), loadQueueDone());
const body = rows.length
? `<div class="sla-team" role="table" aria-label="Team today">
<div role="row"><span class="h" role="columnheader">Agent</span><span class="h" role="columnheader" title="Leads this tool assigned to the agent today, then how many in Tier 1 / Tier 2 / Tier 3 / Tier 4">Assigned (by tier)</span><span class="h" role="columnheader">Done</span><span class="h" role="columnheader" title="Assigned by this tool, then seen unassigned or with someone else, as Clear Queue leaves them">Sent back</span></div>
${rows.map((r) => `<div role="row" data-agent="${escapeHtml(r.name)}"><span role="cell" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span><span role="cell">${escapeHtml(r.assigned)}</span><span role="cell">${escapeHtml(r.done)}</span><span role="cell">${escapeHtml(r.back)}</span></div>`).join('')}
</div>`
: '<span class="sla-small">Nothing assigned by this tool today, and the queues have not been read.</span>';
return `<div id="_slaTeamToday" class="sla-card">
<span class="sla-small">Assigned and Sent back count only leads this tool assigned. Done is counted from each agent's queue when Queue is read (its last 10 rows), so it can run low. "about" is a best guess instead: leads that left the list while theirs.</span>
${body}
</div>`;
}

// Pure. One quiet line when the agents with the fewest are well behind the
// rest, or '' when the spread is even enough. names: the agents compared.
// Leads sent back do not count as theirs.
const FAIR_SHARE_GAP = 3;
function fairShareGapText(names, tally) {
if (names.length < 2) return '';
const counts = names.map((name) => { const row = tally[normalizeAgentName(name)] || { total: 0, back: 0 }; return { name, total: row.total - row.back }; });
const low = Math.min(...counts.map((c) => c.total));
const lows = counts.filter((c) => c.total === low);
const rest = counts.filter((c) => c.total > low);
if (rest.length === 0) return '';
const gap = Math.round(rest.reduce((sum, c) => sum + c.total, 0) / rest.length) - low;
if (gap < FAIR_SHARE_GAP) return '';
const who = lows.length === 1 ? `${lows[0].name} has` : (lows.length === 2 ? `${lows[0].name} and ${lows[1].name} have` : `${lows.length} agents have`);
return `${who} ${gap} fewer than the others today.`;
}

// The line under the Assign button, for the ticked agents.
function renderFairShareLine() {
const line = document.getElementById('_slaFairLine');
if (!line) return;
const names = Array.from(document.querySelectorAll('.assign-agent-checkbox:checked')).map((el) => el.dataset.name);
const text = fairShareGapText(names, fairShareTally(todaysAssignmentLog()));
line.textContent = text;
line.hidden = !text;
}

runSelfTest('fairShareSelfTest', function fairShareSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
const entry = (agent, tier) => ({ time: new Date().toISOString(), agent, ...(tier ? { tier } : {}) });
const log = [
...[1, 1, 2, 2, 2, 3, 3, 3, 4].map((t) => entry('Agent Alpha', t)),
...[1, 2, 2, 3, 3, 3, 4, 4].map((t) => entry('agent  bravo', t)), entry('Agent Bravo'),
...[2, 2, 3, 4, 4].map((t) => entry('Agent Charlie', t))
];
const tally = fairShareTally(log);
const team = (name) => teamTodayRows(['Agent Alpha', 'Agent Bravo', 'Agent Charlie', 'Agent Delta'], tally, { agents: { 'agent alpha': { name: 'Agent Alpha', ids: ['a', 'b', 'c'] }, 'agent zulu': { name: 'Agent Zulu', ids: ['z'] } } }).find((r) => r.name === name);
check('total and tiers per agent, done from the queue', team('Agent Alpha'), { name: 'Agent Alpha', assigned: '9 (2 / 3 / 3 / 1)', done: '3', back: '0' });
check('names are matched however they are spaced or cased, a Pending lead counts in the total only, and done is a guess where the queue was not read', team('Agent Bravo'), { name: 'Agent Bravo', assigned: '9 (1 / 2 / 3 / 2) + 1 no tier', done: 'about 0', back: '0' });
check('an agent with nothing', team('Agent Delta'), { name: 'Agent Delta', assigned: '0', done: 'about 0', back: '0' });
check('an agent only the queue knows still has a row', team('Agent Zulu'), { name: 'Agent Zulu', assigned: '0', done: '1', back: '0' });
check('only Pending leads: no tiers', teamTodayRows([], fairShareTally([entry('Agent Echo'), entry('Agent Echo')]), null)[0].assigned, '2');
const merged = mergeQueueDone({ savedAt: 'then', agents: { 'agent alpha': { name: 'Agent Alpha', ids: ['a'] } } }, [{ agentName: 'Agent  Alpha', doneIds: ['a', 'b', ''] }, { agentName: 'Agent Bravo', doneIds: [] }], 'now');
check('a done row read twice counts once, a row with no contact is not counted, and an agent with none done still has an entry', [merged.savedAt, merged.agents['agent alpha'].ids, merged.agents['agent bravo'].ids], ['then', ['a', 'b'], []]);
check('the fingerprint is the same however the contact is written, and empty for none', [queueItemId('Pat@Example.com ', '07700 900123') === queueItemId('pat@example.com', '+447700900123'), queueItemId('', ''), queueItemId('pat@example.com', '') !== queueItemId('sam@example.com', '')], [true, '', true]);
check('one agent behind the rest', fairShareGapText(['Agent Alpha', 'Agent Bravo', 'Agent Charlie'], tally), 'Agent Charlie has 4 fewer than the others today.');
check('two agents behind', fairShareGapText(['Agent Alpha', 'Agent Charlie', 'Agent Delta'], fairShareTally(log.filter((e) => e.agent !== 'Agent Charlie'))), 'Agent Charlie and Agent Delta have 9 fewer than the others today.');
check('a small gap says nothing', fairShareGapText(['Agent Alpha', 'Agent Bravo'], tally), '');
check('nothing assigned yet says nothing', fairShareGapText(['Agent Alpha', 'Agent Bravo'], {}), '');
check('one agent has nobody to compare with', fairShareGapText(['Agent Charlie'], tally), '');
// Following assignments through a scan.
const held = (key, agent, over) => ({ time: new Date().toISOString(), agent, tier: 2, key, page: 'sla', ...over });
const row = (key, agentName) => ({ key, assigned: !!agentName, agentName: agentName || null });
const before = [held('a', 'Agent Alpha'), held('b', 'Agent Alpha'), held('c', 'Agent Alpha'), held('d', 'Agent Bravo'), held('e', 'Agent Bravo', { shown: 'Bravo, Agent' }), held('p', 'Agent Bravo', { page: 'pending' }), { time: new Date().toISOString(), agent: 'Agent Alpha' }];
const scan = [row('a', 'Agent Alpha'), row('c', null), row('d', 'Agent Charlie'), row('e', 'Bravo, Agent'), row('z', null)];
const after = reconcileAssignments(before, 'sla', scan);
check('still with the agent: open; gone from the list: done; unassigned or with someone else: sent back', after.map((e) => e.state || 'open'), ['open', 'gone', 'back', 'back', 'open', 'open', 'open']);
check('the name the page shows for the agent is the one compared', after[4].state, undefined);
check('nothing changed returns the same list', reconcileAssignments(after, 'sla', scan) === after, true);
check('a gone lead that shows again with the agent is open again', reconcileAssignments(after, 'sla', scan.concat(row('b', 'Agent Alpha')))[1].state, undefined);
check('sent back stays sent back, even once the lead has gone', reconcileAssignments(after, 'sla', [row('a', 'Agent Alpha')]).map((e) => e.state || 'open'), ['open', 'gone', 'back', 'back', 'gone', 'open', 'open']);
check('assigned again by this tool: the earlier one was sent back', reconcileAssignments([held('a', 'Agent Alpha'), held('a', 'Agent Bravo')], 'sla', [row('a', 'Agent Bravo')]).map((e) => e.state || 'open'), ['back', 'open']);
check('two rows with one key are left alone', reconcileAssignments([held('a', 'Agent Alpha')], 'sla', [row('a', null), row('a', 'Agent Alpha')])[0].state, undefined);
check('a Pending scan only follows Pending assignments', reconcileAssignments(before, 'pending', [row('q', null)]).map((e) => e.state || 'open'), ['open', 'open', 'open', 'open', 'open', 'gone', 'open']);
check('the numbers', teamTodayRows([], fairShareTally(after), null)[0], { name: 'Agent Alpha', assigned: '4 (0 / 3 / 0 / 0) + 1 no tier', done: 'about 1', back: '1' });
check('a lead sent back is not counted as theirs when comparing', fairShareGapText(['Agent Alpha', 'Agent Bravo'], fairShareTally([...[1, 2, 3, 4].map((n) => held('k' + n, 'Agent Alpha')), ...[5, 6, 7, 8].map((n) => held('k' + n, 'Agent Bravo', { state: 'back' }))])), 'Agent Bravo has 4 fewer than the others today.');
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager fair-share self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager fair-share self-test passed');
}
});

function renderAssignmentHistoryHtml() {
const entries = todaysAssignmentLog();
if (entries.length === 0) return '<div style="color: var(--wb-muted, #5b6577);">No assignments recorded today yet.</div>';
const tally = {};
entries.forEach(e => { tally[e.agent] = (tally[e.agent] || 0) + 1; });
const rows = Object.entries(tally).sort((a, b) => b[1] - a[1])
.map(([name, count]) => `<div style="display:flex;justify-content:space-between;"><span>${escapeHtml(name)}</span><span style="font-weight:700;">${count}</span></div>`).join('');
const last = entries[entries.length - 1];
return `<div style="font-size:11px;color: var(--wb-muted, #5b6577);margin-bottom:4px;">Assigned counts (today's shift):</div>${rows}
<div style="font-size:11px;color: var(--wb-muted, #5b6577);margin-top:6px;">Last: ${last.lead ? `${escapeHtml(last.lead)} → ` : ''}${escapeHtml(last.agent)} at ${new Date(last.time).toLocaleTimeString()}</div>`;
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
// Each wheel writes into the hidden input the rest of the code reads
// (#assignWindowMinutes / #assignCutoffTime), so nothing else changes.
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
style.textContent = '.wheel-scroll::-webkit-scrollbar { display: none; } .wheel-scroll:focus { outline: 2px solid #3f3ad6; outline-offset: -1px; }';
document.head.appendChild(style);
ensurePanelThemeStyles();
}

// One stylesheet for the whole panel, scoped to the panel's own ids so the
// host page's styles and ours do not leak into each other. The resets use
// :where() so any class rule below wins over them. Token names match the
// Lead Checker panel. Tier colours are set inline from the shared colour map.
function ensurePanelThemeStyles() {
if (document.getElementById('_slaThemeStyles')) return;
const style = document.createElement('style');
style.id = '_slaThemeStyles';
const P = `#${PANEL_ID}`;
const B = `#${PANEL_BOX_ID}`;
style.textContent = `
${P} { --wb-bg: #f2f2f7; --wb-surface: #ffffff; --wb-text: #1c1c1e; --wb-muted: #5b6577; --wb-border: #dfe3ea; --wb-accent: #3f3ad6; --wb-danger: #c62828;
--sla-hd: #1e2a52; --sla-tint: #eceaff; --sla-bad-t: #fde8e8; --sla-warn: #a85a00; --sla-warn-t: #fdf0dc; --sla-ok: #047857; --sla-ok-t: #dff5ec; --sla-info: #1d4ed8; --sla-info-t: #e3ebfd; --sla-vio: #6d28d9; --sla-vio-t: #efe7fd; color: var(--wb-text); }
${P} :focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
${P} .sla-hd :focus-visible { outline-color: #ffffff; }
${P} *, ${P} *::before, ${P} *::after { box-sizing: border-box; }
${P} [hidden] { display: none !important; }
${B} { position: fixed; z-index: 100000; display: flex; flex-direction: column; overflow: hidden; background: var(--wb-bg); box-shadow: 0 14px 34px rgba(15,23,42,0.22);
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 400; font-style: normal; line-height: 1.4; letter-spacing: normal; text-align: left; text-transform: none; color: var(--wb-text);
transition: transform 0.3s ease; max-width: calc(100vw - 32px); }
${B}[data-size="standard"] { right: 20px; bottom: 20px; width: 440px; height: calc(100vh - 90px); border-radius: 16px; }
${B}[data-size="compact"] { right: 20px; bottom: 20px; width: 424px; height: min(560px, calc(100vh - 90px)); border-radius: 16px; }
${B}[data-size="full"] { top: 0; right: 0; bottom: 0; width: 812px; height: 100vh; border-radius: 0; }
:where(${P}) button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; text-transform: none; letter-spacing: normal; }
:where(${P}) label { font-weight: inherit; margin: 0; max-width: none; }
:where(${P}) input, :where(${P}) select, :where(${P}) textarea { font-family: inherit; line-height: inherit; }
:where(${P}) input[type="checkbox"] { accent-color: var(--wb-accent); margin: 0; width: 14px; height: 14px; flex: none; }
:where(${P}) input[type="text"], :where(${P}) input[type="number"], :where(${P}) textarea, :where(${P}) select { font-size: inherit; color: var(--wb-text); background: var(--wb-surface); border: 1px solid var(--wb-border); border-radius: 10px; padding: 7px 10px; height: auto; box-shadow: none; }
${P} svg { flex: none; }
${P} .sla-hd { background: var(--sla-hd); color: #ffffff; display: flex; align-items: center; gap: 4px; padding: 9px 8px 9px 12px; flex: none; }
${P} .sla-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; white-space: nowrap; font-weight: 700; font-size: 13.5px; }
${P} .sla-ttl { display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; padding: 2px 5px; margin-left: -5px; font-weight: 700; }
${P} button.sla-ttl:hover { background: rgba(255,255,255,0.16); }
${P} .sla-ttl svg { opacity: 0.7; }
${P} .sla-sub { font-weight: 500; opacity: 0.75; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
${P} .sla-hbtn { display: inline-flex; align-items: center; gap: 5px; color: #ffffff; background: rgba(255,255,255,0.14); border-radius: 8px; padding: 5px 8px; font-size: 12px; font-weight: 600; white-space: nowrap; }
${P} .sla-hbtn:hover { background: rgba(255,255,255,0.24); }
${P} .sla-hbtn.quiet { background: transparent; }
${P} .sla-hbtn.quiet:hover, ${P} .sla-hbtn[aria-expanded="true"] { background: rgba(255,255,255,0.24); }
${B}[data-sub="send"] .sla-when-main, ${B}:not([data-sub="send"]) .sla-when-send { display: none; }
${P} .sla-link { display: flex; align-items: center; gap: 7px; padding: 6px 12px; background: var(--wb-surface); border-bottom: 1px solid var(--wb-border); font-size: 12px; color: var(--wb-muted); min-height: 31px; flex: none; }
${P} .sla-link[data-state="loggedOut"] { background: var(--sla-bad-t); color: var(--wb-danger); font-weight: 600; }
${P} .sla-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sla-ok); flex: none; display: inline-block; }
${P} .sla-dot.off { background: #8a93a3; } ${P} .sla-dot.busy { background: var(--sla-info); } ${P} .sla-dot.warn { background: #d98200; } ${P} .sla-dot.bad { background: var(--wb-danger); } ${P} .sla-dot.none { background: #cbd5e1; }
${P} .sla-grow { flex: 1; min-width: 0; }
${P} .sla-prog { height: 6px; border-radius: 3px; background: var(--wb-border); overflow: hidden; display: block; }
${P} .sla-prog i { display: block; height: 100%; background: var(--sla-info); }
${P} .sla-main { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
${P} #_slaTopArea { flex: 0 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px 2px; display: flex; flex-direction: column; gap: 10px; }
${P} #_slaTopArea > *, ${P} .panelContent > * { flex: none; }
${P} .panelContent { flex: 1 1 160px; min-height: min(160px, 30vh); overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
${B}[data-size="full"] .sla-main.two { display: grid; grid-template-columns: 280px minmax(0, 1fr); }
${B}[data-size="full"] .sla-main.two #_slaTopArea { padding: 10px 0 10px 12px; }
${B}[data-size="full"] .sla-main.two .panelContent { min-height: 0; }
${P} #_slaSearchBar { position: sticky; top: -10px; z-index: 2; background: var(--wb-bg); margin: -10px -12px -4px; padding: 10px 12px 4px; }
${P} #_slaSearchBar input { width: 100%; }
${P} .sla-ft { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 12px; background: var(--wb-surface); border-top: 1px solid var(--wb-border); font-size: 11.5px; color: var(--wb-muted); flex: none; min-height: 31px; }
${P} .sla-ft button { font-weight: 600; color: var(--wb-accent); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
${P} .sla-col { display: flex; flex-direction: column; gap: 8px; }
${P} .sla-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
${P} .sla-card { background: var(--wb-surface); border-radius: 12px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 8px; }
${P} .sla-small { font-size: 11.5px; color: var(--wb-muted); }
${P} .sla-lbl { font-size: 11.5px; font-weight: 700; color: var(--wb-muted); }
${P} .sla-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
${B}[data-size="full"] .sla-tiles, ${P} .sla-tiles.two { grid-template-columns: repeat(2, 1fr); }
${P} .sla-tile { background: var(--wb-surface); border: 1px solid var(--wb-border); border-radius: 10px; padding: 6px 4px; text-align: center; }
${P} .sla-tile:hover { border-color: var(--wb-accent); }
${P} .sla-tile:active { transform: translateY(1px); }
${P} .sla-tile b { display: block; font-size: 17px; line-height: 1.1; font-weight: 700; }
${P} .sla-tile span { font-size: 11px; color: var(--wb-muted); }
${P} .sla-tile.bad { border-color: #efb4b4; } ${P} .sla-tile.bad b { color: var(--wb-danger); } ${P} .sla-tile.warn b { color: var(--sla-warn); }
${P} .sla-cf { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 11.5px; color: var(--wb-muted); }
${P} .sla-chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; background: var(--wb-surface); border: 1px solid var(--wb-border); color: var(--wb-text); white-space: nowrap; }
${P} button.sla-chip:hover { border-color: var(--wb-accent); }
${P} button.sla-chip[aria-pressed="true"] { background: var(--wb-text); color: #ffffff; border-color: var(--wb-text); }
${P} .sla-chip.vio { background: var(--sla-vio-t); border-color: transparent; color: var(--sla-vio); }
${P} .sla-chip.warn { background: var(--sla-warn-t); border-color: transparent; color: var(--sla-warn); }
${P} .sla-chip.ok { background: var(--sla-ok-t); border-color: transparent; color: var(--sla-ok); }
${P} .sla-chip.bad { background: var(--sla-bad-t); border-color: transparent; color: var(--wb-danger); }
${P} .sla-chip.eo { background: #e6e9f0; border-color: transparent; color: #2b3445; }
${P} button.sla-chip.eo[aria-pressed="true"] { background: #2b3445; color: #ffffff; }
${P} .chip-label { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--wb-border); background: var(--wb-surface); color: var(--wb-text); font-size: 11.5px; font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; }
${P} .chip-label input { position: absolute; opacity: 0; width: 0; height: 0; }
${P} .chip-label:hover { border-color: var(--wb-accent); }
${P} .chip-label:has(input:checked) { background: var(--wb-text); border-color: var(--wb-text); color: #ffffff; }
${P} .chip-label:has(input:focus-visible) { outline: 2px solid #1d4ed8; outline-offset: 2px; }
${P} .sla-tabs { display: flex; background: #e5e5ea; border-radius: 10px; padding: 3px; gap: 3px; }
${P} .sla-tabs button { flex: 1; text-align: center; font-weight: 600; font-size: 12px; padding: 6px 4px; border-radius: 8px; color: var(--wb-muted); white-space: nowrap; }
${P} .sla-tabs button[aria-selected="true"] { background: var(--wb-surface); color: var(--wb-text); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
${B}[data-size="compact"] .sla-tabs, ${B}[data-size="compact"] #_slaTodaySummary { display: none; }
${B}[data-size="compact"] #assignSectionBody { display: flex !important; }
${B}[data-size="compact"] #filtersZoneBody { display: none !important; }
${P} .sla-pri { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--wb-accent); color: #ffffff; font-weight: 700; font-size: 12.5px; border-radius: 999px; padding: 8px 14px; white-space: nowrap; text-align: center; }
${P} .sla-pri:hover { filter: brightness(1.08); }
${P} .sla-pri:disabled { background: #d9dce3; color: #6b7280; cursor: default; filter: none; }
${P} .sla-pri.running { background: #b4530a; white-space: normal; }
${P} .sla-pri.wide { width: 100%; padding: 10px 14px; font-size: 13.5px; }
${P} .sla-sec { display: inline-flex; align-items: center; justify-content: center; gap: 5px; background: var(--wb-surface); border: 1px solid #c5cbd6; color: var(--wb-text); font-weight: 600; font-size: 12px; border-radius: 999px; padding: 6px 11px; white-space: nowrap; }
${P} .sla-sec:hover { border-color: var(--wb-accent); }
${P} .sla-sec:disabled { opacity: 0.5; cursor: default; }
${P} .sla-sec.caution { color: var(--wb-danger); border-color: #e2b6b6; }
${P} .sla-sec.caution:hover { border-color: var(--wb-danger); }
${P} .sla-sec.tight { padding: 2px 8px; }
${P} .sla-txt { font-weight: 600; font-size: 12px; color: var(--wb-accent); text-decoration: underline; text-underline-offset: 2px; }
${P} .sla-chev { transition: transform 0.15s ease; }
${P} [aria-expanded="true"] > .sla-chev { transform: rotate(180deg); }
${P} .sla-agsum { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
${P} .sla-agsum .sla-sec { gap: 3px; }
${P} .sla-agents { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; max-height: 150px; overflow-y: auto; padding: 1px; }
${P} .sla-agents label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
${P} .sla-agents b { margin-left: auto; color: var(--wb-muted); font-weight: 600; }
${P} .sla-team { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 4px 12px; font-size: 12px; font-variant-numeric: tabular-nums; align-items: baseline; }
${P} .sla-team > div { display: contents; }
${P} .sla-team .h { font-size: 11px; color: var(--wb-muted); font-weight: 600; }
${P} .sla-team span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${P} .sla-team span + span { text-align: right; white-space: nowrap; }
${P} .sla-day { background: var(--wb-surface); }
${P} .sla-day[data-tone="warn"] { color: var(--wb-text, #1c1c1e); font-weight: 600; }
${P} .sla-ckl { display: flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; flex-wrap: wrap; }
${P} .sla-ckl select, ${P} .sla-eo select { width: auto; padding: 3px 6px; }
${P} .sla-agentsOnly { display: none; }
${B}[data-size="compact"] .sla-wideonly { display: none; }
${B}[data-size="full"] .sla-main.two #_slaTodaySummary { background: var(--wb-surface); border-radius: 12px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
${B}[data-size="full"] .sla-agentsToggle { display: none; }
${B}[data-size="full"] .sla-agentsOnly { display: inline; font-weight: 700; font-size: 12.5px; }
${B}[data-size="full"] #assignAgentPane { display: flex !important; }
${B}[data-size="full"] .sla-runbar { flex-direction: column-reverse; align-items: stretch; }
${B}[data-size="full"] .sla-runbar .sla-pri { width: 100%; padding: 10px 14px; font-size: 13.5px; }
${P} .sla-tierl { display: grid; gap: 5px; }
${P} .sla-tierl label { display: grid; grid-template-columns: auto 1fr; gap: 0 7px; align-items: start; cursor: pointer; font-size: 12.5px; }
${P} .sla-tierl input { margin-top: 2px; }
${P} .sla-tierl small { display: block; color: var(--wb-muted); font-size: 11.5px; }
${P} #assignHistoryPanel { background: var(--wb-bg); border-radius: 8px; padding: 8px; font-size: 11.5px; }
${P} #assignResultsLog { font-size: 11.5px; color: var(--wb-muted); max-height: 100px; overflow-y: auto; }
${P} #assignResultsLog:empty, ${P} #assignResultsSummary:empty, ${P} #bookingExportRowCount:empty { display: none; }
${P} .sla-g { display: flex; flex-direction: column; gap: 6px; }
${P} .sla-grp { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-weight: 700; font-size: 12.5px; padding: 2px 2px 0; width: 100%; }
${P} .sla-grp span { color: var(--wb-muted); font-weight: 500; }
${P} button.sla-grp[aria-expanded="false"] { opacity: 0.7; }
${P} .sla-list { background: var(--wb-surface); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
${P} .sla-r { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 9px; align-items: center; padding: 8px 10px; }
${P} .sla-r + .sla-r { border-top: 1px solid var(--wb-border); }
${P} .sla-rmain { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; min-width: 0; width: 100%; border-radius: 6px; cursor: pointer; }
${P} .sla-nm { font-weight: 600; white-space: nowrap; overflow: hidden; display: flex; gap: 6px; align-items: center; min-width: 0; }
${P} .sla-nm i { font-style: normal; overflow: hidden; text-overflow: ellipsis; cursor: copy; }
${P} .sla-meta { grid-column: 1 / 3; font-size: 11.5px; color: var(--wb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${P} .sla-rmain[aria-expanded="true"] .sla-meta { white-space: normal; }
${P} .contact-details { grid-column: 2; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--wb-border); font-size: 12px; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; align-items: baseline; }
${P} .contact-details dt, ${P} .sla-kv dt { color: var(--wb-muted); font-weight: 400; }
${P} .contact-details dd, ${P} .sla-kv dd { margin: 0; overflow-wrap: anywhere; }
${P} .sla-kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; margin: 0; font-size: 12px; }
${P} .sla-copyable { cursor: copy; }
${P} dd .sla-copyable { border-radius: 5px; padding: 0 4px; margin-left: -4px; background: var(--sla-tint); display: inline-block; }
${P} .sla-due { font-size: 11.5px; font-weight: 700; white-space: nowrap; }
${P} .sla-due.bad { color: var(--wb-danger); } ${P} .sla-due.warn { color: var(--sla-warn); } ${P} .sla-due.mut { color: var(--wb-muted); font-weight: 600; }
${P} .sla-tag { font-size: 10.5px; font-weight: 700; border-radius: 6px; padding: 1px 6px; white-space: nowrap; flex: none; background: color-mix(in srgb, var(--tc, #64748b) 15%, #ffffff); color: color-mix(in srgb, var(--tc, #64748b) 72%, #000000); }
${P} .sla-tag.done { background: var(--sla-ok-t); color: var(--sla-ok); }
${P} .sla-tag.bad { background: var(--sla-bad-t); color: var(--wb-danger); }
${P} .sla-tag.wait { background: #e9ebf0; color: #4b5565; }
${P} .sla-tag.warn { background: var(--sla-warn-t); color: var(--sla-warn); }
${P} .sla-av { width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: #e9ebf0; color: #4b5565; flex: none; text-align: center; }
${P} button.sla-av:hover { box-shadow: 0 0 0 2px var(--wb-accent); }
${P} .sla-av.red { background: var(--sla-bad-t); color: var(--wb-danger); } ${P} .sla-av.amb { background: var(--sla-warn-t); color: var(--sla-warn); }
${P} .sla-notice { border-radius: 12px; padding: 10px; font-size: 12.5px; display: flex; align-items: center; gap: 8px; font-weight: 700; }
${P} .sla-notice.ok { background: var(--sla-ok-t); color: var(--sla-ok); }
${P} .sla-notice.bad { background: var(--sla-bad-t); border: 1px solid #efb4b4; color: #8f1d1d; }
${P} .sla-notice.info { background: var(--sla-info-t); color: var(--sla-info); }
${P} .sla-check { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 0 9px; align-items: center; padding: 8px 10px; }
${P} .sla-check + .sla-check { border-top: 1px solid var(--wb-border); }
${P} .sla-check.pending { opacity: 0.6; }
${P} .sla-check b { font-weight: 600; }
${P} .sla-check .sla-details { grid-column: 2 / 5; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--wb-border); font-size: 11.5px; color: var(--wb-muted); line-height: 1.6; }
${P} .sla-review { background: #fffbe8; border: 1px solid #f1d98a; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
${P} .sla-review.decided { background: var(--sla-ok-t); border-color: #9fdcc4; }
${P} .sla-quote { background: var(--wb-surface); border-radius: 8px; padding: 7px 9px; font-size: 12px; }
${P} [data-nf="rs"] [data-ng="ck"], ${P} [data-nf="ck"] [data-ng="rs"] { display: none; }
${P} #leadCheckerPopover { position: absolute; inset: 0; z-index: 5; background: var(--wb-bg); overflow-y: auto; padding: 10px 12px; }
${P} #leadCheckerPopover > .sla-col { gap: 10px; }
${P} #leadCheckerImportBox { width: 100%; min-height: 58px; resize: vertical; font-family: monospace; font-size: 11px; }
${P} .sla-pop { position: absolute; z-index: 9; top: 44px; right: 8px; min-width: 230px; max-width: calc(100% - 16px); max-height: calc(100% - 52px); overflow-y: auto; background: #ffffff; color: #1c1c1e; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,0.3), 0 0 0 1px rgba(15,23,42,0.08); padding: 5px; display: flex; flex-direction: column; font-size: 12.5px; }
${P} .sla-pop .sla-ms { height: 1px; background: #e3e6ec; margin: 4px 0; flex: none; }
${P} .sla-pop .sla-mn { color: #5b6577; font-size: 11.5px; padding: 4px 9px; }
${P} .sla-pop .sla-mn:empty { display: none; }
${P} .sla-mi { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 8px; width: 100%; font-weight: 500; flex: none; }
${P} .sla-mi:hover, ${P} .sla-mi:focus-visible { background: #eef0f5; outline: none; }
${P} .sla-mi.danger { color: #c62828; font-weight: 700; }
${P} .sla-mi:disabled { opacity: 0.45; cursor: default; background: none; }
${P} .sla-mi em { margin-left: auto; font-style: normal; font-size: 11px; color: #5b6577; font-weight: 600; }
${P} #_slaAvatarAssignPopover { max-width: calc(100vw - 16px); }
${P} #_slaAvatarAssignPopover .manual-assign-select { width: 100%; max-width: none; font-size: 12px; padding: 5px 8px; }
${P} .sla-zero { padding: 40px 20px; text-align: center; }
@media (prefers-reduced-motion: reduce) {
${P}, ${P} * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}`;
document.head.appendChild(style);
}

function renderWheelColumnHtml(id, values, widthPx) {
const spacerHeight = Math.floor(WHEEL_VISIBLE_ROWS / 2) * WHEEL_ROW_HEIGHT;
const items = values.map(v => `<div class="wheel-item" style="height: ${WHEEL_ROW_HEIGHT}px; display: flex; align-items: center; justify-content: center; font-size: 13px; scroll-snap-align: center; color: var(--wb-muted, #5b6577); cursor: pointer; transition: color 0.15s, font-weight 0.15s;">${escapeHtml(String(v))}</div>`).join('');
return `<div style="position: relative; width: ${widthPx}px;">
<div style="position: absolute; top: ${spacerHeight}px; left: 0; right: 0; height: ${WHEEL_ROW_HEIGHT}px; background: #eef2ff; border-radius: 6px; pointer-events: none;"></div>
<div id="${id}" class="wheel-scroll" style="position: relative; height: ${WHEEL_VISIBLE_ROWS * WHEEL_ROW_HEIGHT}px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; border: 1px solid var(--wb-border, #cbd5e1); border-radius: 6px; background: var(--wb-surface, white); cursor: grab;">
<div style="height: ${spacerHeight}px;"></div>
${items}
<div style="height: ${spacerHeight}px;"></div>
</div>
</div>`;
}

// Dragging needs window-level mousemove and mouseup, but initWheelColumn runs
// on every render. One shared pair is installed once, guarded on window, and
// every wheel shares it through window._slaWheelDragState.
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

// Wires settle detection, click and drag onto a mounted wheel, so it must run
// after the HTML is in the DOM.
function initWheelColumn(id, values, initialValue, onSettle) {
const el = document.getElementById(id);
if (!el) return;

ensureWheelDragHandlers();

// Type-to-jump. Zero-padded lists match on the padded string; the SLA window
// presets mix 'All' with plain numbers, so they match numerically. The buffer
// resets after a pause or once a fixed-width value is complete.
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
item.style.color = i === index ? 'var(--wb-text, #1e293b)' : 'var(--wb-muted, #5b6577)';
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

// Click any visible row to jump to it; wheel notches are too coarse.
let suppressNextClick = false;
el.querySelectorAll('.wheel-item').forEach((item, index) => {
item.addEventListener('click', () => {
if (suppressNextClick) { suppressNextClick = false; return; }
scrollToIndex(index, true);
});
});

// mousemove and mouseup come from the shared pair in ensureWheelDragHandlers.
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
// preventDefault stops text selection but also stops focus on click, which
// broke type-to-jump, so focus explicitly.
event.preventDefault();
el.focus();
});

const startIndex = Math.max(0, values.indexOf(initialValue));
el.scrollTop = startIndex * WHEEL_ROW_HEIGHT;
highlightAndSettle(startIndex);
}

// scrollTop does nothing while an ancestor is display:none, so a wheel in a
// collapsed section showed 00:00. Called when the section opens. It does not
// call initWheelColumn again, which would stack a second set of listeners.
function syncWheelPositionOnly(id, values, value) {
const el = document.getElementById(id);
if (!el) return;
const index = Math.max(0, values.indexOf(value));
el.scrollTop = index * WHEEL_ROW_HEIGHT;
el.querySelectorAll('.wheel-item').forEach((item, i) => {
item.style.fontWeight = i === index ? '700' : '400';
item.style.color = i === index ? 'var(--wb-text, #1e293b)' : 'var(--wb-muted, #5b6577)';
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

// Wires whichever wheels are mounted, seeding each from its hidden input so a
// refresh keeps the value.
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

// Always-visible due counts. Buckets are cumulative, an overdue lead counts in
// every bucket, and only unassigned leads are counted.
const SLA_DUE_BUCKET_MINUTES = [15, 30, 60];

// Keyword guess: only "Live Chat" and "Shift Start" are known values. Anything
// else is neutral grey.
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
return `<div class="sla-small">${label}</div>`;
}
// Not-done counts come from the last Queue by Agent snapshot, matched by
// name since it has no agent id.
const queueSnapshot = loadAgentQueueSnapshot();
const queueByName = new Map(queueSnapshot.agents.map((q) => [normalizeAgentName(q.agentName), q]));
return agents.map(a => {
const queueInfo = queueByName.get(normalizeAgentName(a.name));
const queueBadge = queueInfo
? `<b title="${queueInfo.notDoneCount} not yet called, out of the last ${queueInfo.totalShown} queued (as of ${escapeHtml(new Date(queueSnapshot.scannedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))})">${queueInfo.notDoneCount}</b>`
: '';
return `
<label ${a.status ? `title="${escapeHtml(a.status)}"` : ''}>
<input type="checkbox" class="assign-agent-checkbox" value="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name)}" ${excludedAgentIds.has(a.id) ? '' : 'checked'} onchange="window._updateAssignPreview()">
<span class="sla-dot" style="background: ${statusDotColor(a.status)};"></span>
${escapeHtml(a.name)}${queueBadge}
</label>`;
}).join('');
}

// All and None, then the cap on how many leads a run touches, applied before
// roundRobinAssign() in every entry point. Blank means no cap.
function renderAssignLimitControl(settings) {
return `<div class="sla-bar sla-small">
<button type="button" class="sla-txt" onclick="window._setAllAgentCheckboxes(true)">All</button>
<button type="button" class="sla-txt" onclick="window._setAllAgentCheckboxes(false)">None</button>
<span class="sla-grow"></span>
<label for="assignLimitInput" class="sla-ckl" style="font-size: 11.5px;" title="The most leads one run assigns. Leave empty to assign all">Limit
<input type="number" id="assignLimitInput" min="1" placeholder="all" value="${settings.assignLimit || ''}" oninput="window._updateAssignPreview()" style="width: 58px; padding: 3px 6px;">
</label>
<label for="assignLimitPerAgent" class="sla-ckl" style="font-size: 11.5px;" title="When on, the limit is the number of leads each ticked agent gets, not the total across all of them">
<input type="checkbox" id="assignLimitPerAgent" ${settings.assignLimitPerAgent ? 'checked' : ''} onchange="window._updateAssignPreview()">
per agent
</label>
</div>`;
}

// The agents row: one control that opens the agent list, then Queue and
// Clear Queue. Clear Queue unassigns everything and has no prompt, so it is
// outlined in red, never filled.
function renderAgentsRow(agentCount, agentsOpen) {
const label = agentCount === 0
? (canCheckAgentRoster() ? 'No agents online' : "Can't check agents")
: `${agentCount}<span class="sla-wideonly">&nbsp;agent${agentCount === 1 ? '' : 's'}</span>&nbsp;online`;
return `<div class="sla-agsum">
<button type="button" class="sla-sec sla-agentsToggle" aria-expanded="${agentsOpen ? 'true' : 'false'}" aria-controls="assignAgentPane" onclick="window._toggleAgentList(this)" title="Show or hide the agent list">${label}${svgIcon('chevron', 12, '', 'sla-chev')}</button>
<span class="sla-agentsOnly">${agentCount === 0 ? 'No agents online' : `${agentCount} online`}</span>
<span class="sla-grow"></span>
<button type="button" class="sla-sec" onclick="window._checkAgentQueuePositions(this.querySelector('span'))" title="Queue: reads each agent's live call queue from Konnect and shows how many leads each has not called yet">${svgIcon('queue', 13)}<span>Queue</span></button>
<button type="button" class="sla-sec caution" onclick="window._clearWholeQueue()" title="Clear Queue: unassigns every lead (Konnect's Clear Queues). There is no undo">Clear Queue</button>
</div>`;
}

// `tone` is 'bad' or 'warn' when the count needs attention. A tile assigns
// exactly the leads it counts, with no prompt, so it is drawn as a button.
function renderStatTile(label, value, tone, onclick) {
return `<button type="button" class="sla-tile stat-tile-clickable ${tone || ''}" onclick="${onclick}" title="Assign these ${value} now to the ticked agents" aria-label="${escapeHtml(label)}: ${value}. Assign these now"><b>${value}</b><span>${escapeHtml(label)}</span></button>`;
}

const ZEN_MODE_KEY = '_slaZenMode';

// List only view (stored as "zen mode") hides Overview, Assign, Filters and
// Today so more leads fit. The rows keep their two lines.
function isZenModeOn() {
return localStorage.getItem(ZEN_MODE_KEY) === '1';
}

function setZenMode(on) {
try { localStorage.setItem(ZEN_MODE_KEY, on ? '1' : '0'); } catch (error) { /* ignore */ }
}

// What List only view shows in place of the tiles: the headline counts and
// the way back.
function renderListOnlySummary(id, chips) {
return `<div id="${id}" class="sla-cf">
${chips.map(([text, tone]) => `<span class="sla-chip ${tone || ''}">${escapeHtml(text)}</span>`).join('')}
<span class="sla-grow"></span>
<button type="button" class="sla-sec tight" onclick="window._toggleZenMode()" title="Show Overview, Assign, Filters and Today again">Show overview</button>
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
const notAssignedCount = leads.filter(l => !l.assigned).length;
const emailOnlyCount = leads.filter(l => l.isEmailOnly && !l.assigned).length;

if (isZenModeOn()) {
return renderListOnlySummary('slaDueSummary', [
[`${missedCount} missed`, missedCount > 0 ? 'bad' : ''],
[`${dueCounts[1]} due in 30 min`, dueCounts[1] > 0 ? 'warn' : ''],
[`${notAssignedCount} not assigned`, '']
]);
}

const tiles = [
renderStatTile('Missed', missedCount, missedCount > 0 ? 'bad' : '', `window._quickAssignSlaTile(null, false, true)`),
...SLA_DUE_BUCKET_MINUTES.map((m, i) => renderStatTile(`${m} min`, dueCounts[i], m === 15 && dueCounts[i] > 0 ? 'warn' : '', `window._quickAssignSlaTile(${m}, false, false)`))
].join('');
// Customer First gets its own chips because prioritizeLeads treats it as a
// distinct category. Purple, not red: it is not a lateness signal.
const cfChips = SLA_DUE_BUCKET_MINUTES.map((m, i) =>
`<button type="button" class="sla-chip vio" onclick="window._quickAssignSlaTile(${m}, true, false)" title="Assign these ${customerFirstDueCounts[i]} Customer First leads now to the ticked agents" aria-label="Customer First due in ${m} minutes: ${customerFirstDueCounts[i]}. Assign these now">${customerFirstDueCounts[i]} in ${m}</button>`
).join('');
const emailOnlyOn = !!loadAssignSettings().emailOnly;

return `
<div id="slaDueSummary" class="sla-col" style="gap: 10px;">
<div class="sla-tiles">${tiles}</div>
<div class="sla-cf"><span class="sla-lbl">Customer First</span>${cfChips}
<button type="button" id="_slaEoChip" class="sla-chip eo" aria-pressed="${emailOnlyOn ? 'true' : 'false'}" onclick="window._setEmailOnlyMode()" title="Assign the Email only leads">${svgIcon('mail', 12)}Email only <span id="_slaEoChipCount">${emailOnlyCount}</span></button>
</div>
</div>`;
}

// Filter and agent choices persist across scans. Exclusions are stored as
// opt-out sets so a new agent, tier or type is included by default.
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

// Scope for the "Copy for Lead Checker" export, kept apart from the assign
// filters.
const LEAD_CHECKER_EXPORT_KEY = '_slaLeadCheckerExportSettings';

function loadLeadCheckerExportSettings() {
try {
const raw = JSON.parse(localStorage.getItem(LEAD_CHECKER_EXPORT_KEY));
if (raw && Array.isArray(raw.tiers)) return raw;
} catch (error) {
// ignore
}
return { tiers: [2], customerFirstOnly: true };
}

function saveLeadCheckerExportSettings(settings) {
try {
localStorage.setItem(LEAD_CHECKER_EXPORT_KEY, JSON.stringify(settings));
} catch (error) {
// ignore
}
}

// Built from currentCustomers, not a fresh scan. The title is stripped from
// the name, which the Lead Checker only uses to confirm a match.
function buildLeadCheckerTsv(tiers, customerFirstOnly) {
const tierSet = new Set(tiers);
const importResults = loadLeadCheckerImportState().results;
let excludedCount = 0;
const rows = currentCustomers.filter((c) => {
if (!tierSet.has(c.tier)) return false;
if (customerFirstOnly && !(c.source || '').toLowerCase().includes('customer first')) return false;
if (isAlreadyClassifiedForContact(c, importResults)) { excludedCount++; return false; }
return true;
});
// No Registration: it is often a placeholder, and Konnect Live cannot search by it.
const header = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created'].join('\t');
const lines = rows.map((c) => [
tsvClean(stripTitle(c.name)), tsvClean(c.phone), tsvClean(c.email), tsvClean(c.source), tsvClean(c.campaign), tsvClean(c.createdText)
].join('\t'));
return { tsv: [header, ...lines].join('\n'), count: rows.length, excludedCount };
}

// Pending callback types offered in the Send view.
const PENDING_LEAD_CHECKER_CALLBACK_TYPES = ['Auto Rescheduled', 'Manual Rescheduled', 'Post Closure'];
const LEAD_CHECKER_EXPORT_PENDING_KEY = '_slaLeadCheckerExportSettingsPending';

function loadPendingLeadCheckerExportSettings() {
try {
const raw = JSON.parse(localStorage.getItem(LEAD_CHECKER_EXPORT_PENDING_KEY));
if (raw && Array.isArray(raw.callbackTypes)) return raw;
} catch (error) {
// ignore
}
return { callbackTypes: PENDING_LEAD_CHECKER_CALLBACK_TYPES.slice() };
}

function savePendingLeadCheckerExportSettings(settings) {
try {
localStorage.setItem(LEAD_CHECKER_EXPORT_PENDING_KEY, JSON.stringify(settings));
} catch (error) {
// ignore
}
}

// Source is blank because Pending Customers has no Source column. The Lead
// Checker falls back to the lead modal's Source.
function buildPendingLeadCheckerTsv(callbackTypes) {
const typeSet = new Set(callbackTypes);
const importResults = loadLeadCheckerImportState().results;
let excludedCount = 0;
const rows = currentPendingCustomers.filter((c) => {
if (!typeSet.has(c.callbackType)) return false;
if (!c.lastActionText) return false;
// lastActionText is Pending's equivalent of createdText, so it is aliased
// rather than forking the matching logic.
if (isAlreadyClassifiedForContact({ ...c, createdText: c.lastActionText }, importResults)) { excludedCount++; return false; }
return true;
});
const header = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created'].join('\t');
const lines = rows.map((c) => [
// Post Closure leads get Konnect's own Post Closure source label. Otherwise
// the Lead Checker would see the original enquiry source and never detect
// them.
tsvClean(stripTitle(c.name)), tsvClean(c.mobile || c.landline), tsvClean(c.email), c.callbackType === 'Post Closure' ? 'Post Closure Processing' : '', tsvClean(c.campaign), tsvClean(c.lastActionText)
].join('\t'));
return { tsv: [header, ...lines].join('\n'), count: rows.length, excludedCount };
}

function sendLabelText(count) {
return `Send ${count} lead${count === 1 ? '' : 's'}`;
}
function sendLeftOutText(excludedCount) {
return excludedCount > 0 ? `${excludedCount} already checked, left out` : '';
}

// The Send view, opened by Send in the header. It covers the lead list and
// stays in the page while closed, so results pasted from More and the
// by-hand box work without opening it. Open Konnect Live is on the status
// strip only.
function renderLeadCheckerPopover() {
let chips;
let scopeExtra;
let exported;
if (currentPageType === PAGE_PENDING) {
const settings = loadPendingLeadCheckerExportSettings();
const selectedTypes = new Set(settings.callbackTypes);
exported = buildPendingLeadCheckerTsv(settings.callbackTypes);
chips = PENDING_LEAD_CHECKER_CALLBACK_TYPES.map(t => `
<label class="chip-label">
<input type="checkbox" class="booking-export-callback-type" value="${escapeHtml(t)}" ${selectedTypes.has(t) ? 'checked' : ''} onchange="window._updateLeadCheckerExportPreview()">
${escapeHtml(t)} (${currentPendingCustomers.filter((c) => c.callbackType === t).length})
</label>`).join('');
scopeExtra = '<span class="sla-small">New leads nobody has worked yet are left out. Check the SLA queue for those.</span>';
} else {
const settings = loadLeadCheckerExportSettings();
const selectedTiers = new Set(settings.tiers);
exported = buildLeadCheckerTsv(settings.tiers, settings.customerFirstOnly);
chips = SLA_TIERS.map(({ tier, name, holds }) => `
<label class="chip-label" title="${escapeHtml(`${name}: ${holds}.`)}">
<input type="checkbox" class="booking-export-tier" value="${tier}" ${selectedTiers.has(tier) ? 'checked' : ''} onchange="window._updateLeadCheckerExportPreview()">
${escapeHtml(name)} (${currentCustomers.filter((c) => c.tier === tier).length})
</label>`).join('');
scopeExtra = `<label class="sla-ckl">
<input type="checkbox" id="bookingExportCustomerFirstOnly" ${settings.customerFirstOnly ? 'checked' : ''} onchange="window._updateLeadCheckerExportPreview()">
Customer First only
</label>`;
}

const importState = loadLeadCheckerImportState();
// Match against the list for the page being viewed.
const customersForMatching = currentPageType === PAGE_PENDING ? currentPendingCustomers : currentCustomers;
// Indexed so each customer needs one lookup; a Set is enough since this only
// asks whether each result has at least one match.
const leadCheckerMatchIndex = buildLeadCheckerResultIndex(importState.results);
const matchedResultsSet = new Set();
customersForMatching.forEach((c) => {
leadCheckerResultCandidatesIndexed(c, leadCheckerMatchIndex).forEach((r) => matchedResultsSet.add(r));
});
const matchedCount = matchedResultsSet.size;
const importSummary = importState.results.length === 0
? ''
: `<span class="sla-small">${importState.results.length} result${importState.results.length === 1 ? '' : 's'} held, ${matchedCount} matched to a lead in the list.${importState.results.length !== matchedCount ? ' The rest are not in this list (already worked, expired, or in the other queue).' : ''}</span>`;
// Text typed or pasted but not added yet keeps the box open.
const byHandOpen = !!importState.rawInput;

return `
<div id="leadCheckerPopover" style="display: none;">
<div class="sla-col">
<div class="sla-card">
<span class="sla-lbl">Which leads</span>
<div class="sla-cf">${chips}</div>
${scopeExtra}
<button type="button" class="sla-pri wide" onclick="window._sendToLeadChecker(this.querySelector('span'), 'leads')" title="Opens Konnect Live and sends these leads to the Lead Checker; the results come back here">${svgIcon('send', 14)}<span id="_slaSendLabel">${sendLabelText(exported.count)}</span></button>
<span id="bookingExportRowCount" class="sla-small">${sendLeftOutText(exported.excludedCount)}</span>
<div class="sla-bar">
<button type="button" class="sla-sec" onclick="window._copyLeadCheckerExport(this.querySelector('span'))" title="Copies these leads to paste into the Lead Checker by hand">${svgIcon('copy', 13)}<span>Copy</span></button>
<button id="_slaCopyReviewBtn" type="button" class="sla-sec" onclick="window._copyReviewDecisions(this)" title="Copies the review decisions the Lead Checker has sent this shift, to paste where new rules are written">${reviewDecisionsButtonText()}</button>
</div>
</div>
<div class="sla-card">
<button type="button" class="sla-txt" style="align-self: flex-start;" aria-expanded="${byHandOpen ? 'true' : 'false'}" aria-controls="_slaByHand" onclick="window._slaFold(this)">Bring results back by hand</button>
<div id="_slaByHand" class="sla-col" ${byHandOpen ? '' : 'hidden'}>
<textarea id="leadCheckerImportBox" placeholder="Paste the results copied from the Lead Checker" oninput="window._updateLeadCheckerImportInput(this.value)">${escapeHtml(importState.rawInput)}</textarea>
<button type="button" class="sla-sec" style="align-self: flex-end;" onclick="window._classifyLeadCheckerImport(this)">Add results</button>
</div>
${importSummary}
</div>
<div>
<button type="button" class="sla-txt" aria-expanded="false" aria-controls="_slaHowSend" onclick="window._slaFold(this)">How it works</button>
<p id="_slaHowSend" class="sla-small" style="margin: 6px 0 0;" hidden>Results sent back by the Lead Checker show by themselves. To bring them in by hand, copy the results in the Lead Checker, paste them here and press Add results, or use Paste Lead Checker results in More. Each one shows as a tag on its lead.</p>
</div>
</div>
</div>`;
}

// Folds or unfolds the element a button names in aria-controls.
window._slaFold = function(button) {
const target = document.getElementById(button.getAttribute('aria-controls'));
if (!target) return;
const open = target.hidden;
target.hidden = !open;
button.setAttribute('aria-expanded', open ? 'true' : 'false');
};

// Shows or hides the Send view. The header follows through data-sub.
function setSendView(open) {
const popover = document.getElementById('leadCheckerPopover');
const box = document.getElementById(PANEL_BOX_ID);
if (!popover || !box) return;
popover.style.display = open ? 'block' : 'none';
if (open) box.dataset.sub = 'send'; else delete box.dataset.sub;
}

window._toggleLeadCheckerPopover = function() {
const popover = document.getElementById('leadCheckerPopover');
if (!popover) return;
setSendView(popover.style.display === 'none');
// The desk may have recorded decisions since the panel was drawn.
const reviewButton = document.getElementById('_slaCopyReviewBtn');
if (reviewButton) reviewButton.textContent = reviewDecisionsButtonText();
};


window._toggleZenMode = function() {
setZenMode(!isZenModeOn());
if (currentPageType === PAGE_PENDING) displayPendingPanel(currentPendingCustomers, 0, 0, false);
else displayPanel(currentCustomers, 0, 0, false);
};

window._updateLeadCheckerExportPreview = function() {
if (currentPageType === PAGE_PENDING) {
const callbackTypes = Array.from(document.querySelectorAll('.booking-export-callback-type:checked')).map(el => el.value);
savePendingLeadCheckerExportSettings({ callbackTypes });
showSendCounts(buildPendingLeadCheckerTsv(callbackTypes));
return;
}
const tiers = Array.from(document.querySelectorAll('.booking-export-tier:checked')).map(el => Number(el.value));
const customerFirstOnly = document.getElementById('bookingExportCustomerFirstOnly')?.checked || false;
saveLeadCheckerExportSettings({ tiers, customerFirstOnly });
showSendCounts(buildLeadCheckerTsv(tiers, customerFirstOnly));
};

function showSendCounts({ count, excludedCount }) {
const label = document.getElementById('_slaSendLabel');
if (label) label.textContent = sendLabelText(count);
const countEl = document.getElementById('bookingExportRowCount');
if (countEl) countEl.textContent = sendLeftOutText(excludedCount);
}

// ===================================================================
// LINK TO THE LEAD CHECKER
// SLA Manager opens Konnect Live itself, which lets the two tabs message
// each other: the batch goes over and the results come back without the
// clipboard. Konnect Live only answers the tab that opened it, so the
// agent desktop (same site, its own tab) asks through shared storage and
// SLA Manager passes its batch on and its results back. A Live tab opened
// by hand has no link; Copy still works.
// ===================================================================
const LIVE_ORIGIN = 'https://carbot.ai';
// The Live address carries its version, so the last one the Lead Checker
// reported is kept and used next time.
const LIVE_URL_KEY = '_slaKonnectLiveUrl';
const LIVE_URL_DEFAULT = 'https://carbot.ai/konnectlive/(v1.2.168)/home.html';
const LIVE_WINDOW_NAME = 'workToolsKonnectLive';
// Shared with Lead Re setup on the agent desktop.
const LIVE_REQUEST_KEY = '_workToolsLiveRequest';
const LIVE_STATUS_KEY = '_workToolsLiveStatus';
const LIVE_LINK_KEY = '_workToolsLinkState';
const DESK_RESULTS_KEY = '_workToolsDeskResults';
const REVIEW_DECISIONS_KEY = '_slaReviewDecisions';
// Written by Lead Re setup on the agent desktop; only read here.
const DESK_DECISIONS_KEY = '_workToolsDeskDecisions';
const DESK_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
// resendMs: a batch not acknowledged in this time is sent again. downMs: no
// "ready" for this long means the Live tab has gone. lostGraceMs: how long
// after "received" an idle "ready" is taken to mean the batch was lost.
// legacyBusyMs: how long to hold off after an older Lead Checker (which
// does not report its state) said it was busy. A test may shorten these
// through window.__workToolsLinkTiming.
const LIVE_TIMING = { resendMs: 15000, downMs: 30000, tickMs: 1000, heartbeatMs: 10000, lostGraceMs: 2000, legacyBusyMs: 60000 };
function liveTiming() {
return { ...LIVE_TIMING, ...(window.__workToolsLinkTiming || {}) };
}
const LIVE_STATES = ['idle', 'running', 'paused', 'loggedOut'];

function liveUrl() {
let saved = '';
try { saved = localStorage.getItem(LIVE_URL_KEY) || ''; } catch (error) { saved = ''; }
const base = /^https:\/\/carbot\.ai\/konnectlive\//i.test(saved) ? saved : LIVE_URL_DEFAULT;
return `${base}#/search?redirectRoute=%2Fsearch`;
}

// One link per page, kept on window so clicking the bookmark again carries
// on with the same Live tab and queue. queue: batches waiting to go. sent:
// the batch posted but not yet acknowledged. running: the batch the Lead
// Checker said it took. known: who each recent batch id belongs to.
function newLiveLink(previous) {
const old = previous || {};
return {
version: 2, win: old.win || null, state: 'none', lastReadyAt: 0, done: 0, total: 0,
queue: Array.isArray(old.queue) ? old.queue.filter((b) => b && b.id && typeof b.tsv === 'string') : [],
sent: null, running: null, known: {}, handledRequest: old.handledRequest || null, withdrawn: null,
legacyBusyAt: 0, lastLinkWrite: 0, batchCount: 0
};
}
const liveLink = (window.__workToolsLiveLink && window.__workToolsLiveLink.version === 2)
? window.__workToolsLiveLink
: (window.__workToolsLiveLink = newLiveLink(window.__workToolsLiveLink));

function currentLeadCheckerExport() {
return currentPageType === PAGE_PENDING
? buildPendingLeadCheckerTsv(loadPendingLeadCheckerExportSettings().callbackTypes)
: (() => { const s = loadLeadCheckerExportSettings(); return buildLeadCheckerTsv(s.tiers, s.customerFirstOnly); })();
}

// For one-off events only. What the link is doing now is on the status line.
function showToast(text) {
const previous = document.getElementById('_slaLinkToast');
if (previous) previous.remove();
const toast = document.createElement('div');
toast.id = '_slaLinkToast';
toast.setAttribute('role', 'status');
toast.textContent = text;
toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1c1c1e;color:#fff;padding:10px 16px;border-radius:10px;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;';
document.body.appendChild(toast);
setTimeout(() => toast.remove(), 5000);
}

// Pure. The same wording as the Lead Checker and Lead Re setup panels.
function linkStatusText(state, done, total) {
if (state === 'idle') return 'Konnect Live: linked, ready.';
if (state === 'running') return total > 0 ? `Konnect Live: checking ${done || 0} of ${total}.` : 'Konnect Live: checking.';
if (state === 'paused') return 'Konnect Live: paused.';
if (state === 'loggedOut') return 'Konnect Live: logged out, logging back in.';
return 'Konnect Live: not open. Press Open Konnect Live in SLA Manager.';
}

// Pure. A new batch replaces a waiting one only when it comes from the same
// page and is the same kind.
function addToLiveQueue(queue, batch) {
return queue.filter((b) => !(b.from === batch.from && b.kind === batch.kind)).concat(batch);
}

// Pure. What to post next, if anything. A new batch goes only when the Lead
// Checker last said it was idle and nothing of ours is sent or running; a
// batch sent but not acknowledged is sent again after resendMs.
function nextLiveAction(link, now, timing) {
if (link.state === 'none') return null;
if (link.sent) return now - link.sent.at >= timing.resendMs ? { type: 'resend', batch: link.sent.batch } : null;
if (link.running) return null;
if (link.state !== 'idle') return null;
return link.queue.length ? { type: 'send', batch: link.queue[0] } : null;
}

// Pure. Whose batch an id is. Results are routed by id only: an id this page
// sent is in known; the desk's own request id is the desk's; anything else
// is treated as SLA Manager's own.
function liveBatchOwner(id, known, deskIds) {
if (id != null && known[id]) return { id, from: known[id].from, kind: known[id].kind };
if (id != null && deskIds.includes(id)) return { id, from: 'desk', kind: 'leads' };
return { id: id == null ? null : id, from: 'manager', kind: null };
}

function ownerOfLiveBatch(id) {
const status = readStoredJson(LIVE_STATUS_KEY);
const request = readStoredJson(LIVE_REQUEST_KEY);
return liveBatchOwner(id, liveLink.known, [status && status.id, request && request.id].filter(Boolean));
}

function rememberLiveBatch(batch) {
liveLink.known[batch.id] = { from: batch.from, kind: batch.kind };
const ids = Object.keys(liveLink.known);
if (ids.length > 30) ids.slice(0, ids.length - 30).forEach((id) => { delete liveLink.known[id]; });
}

function isLiveLinked() {
return !!(liveLink.win && !liveLink.win.closed && liveLink.state !== 'none');
}

// STALLED. A Konnect Live tab kept behind another tab can stop drawing its
// pages, so the count stops while the Lead Checker still answers. Pure:
// true when a running batch has made no progress for the given time.
const LIVE_STALL_MS = 90000;
function isLiveStalled(state, progressAt, now, stallMs) {
return state === 'running' && progressAt > 0 && now - progressAt >= stallMs;
}
const LIVE_STALL_HELP = 'Drag the Konnect Live tab out into its own window and keep part of it in view.';
function liveStatusText() {
if (isLiveStalled(liveLink.state, liveLink.progressAt || 0, Date.now(), LIVE_STALL_MS)) {
return `Konnect Live: stopped moving at ${liveLink.done || 0} of ${liveLink.total || 0}. ${LIVE_STALL_HELP}`;
}
return linkStatusText(liveLink.state, liveLink.done, liveLink.total);
}
// Called on every link change: notes when the count last moved, and says so
// once when it has stopped.
function trackLiveProgress() {
const key = `${liveLink.state}|${liveLink.done}|${liveLink.total}`;
if (key !== liveLink.progressKey) { liveLink.progressKey = key; liveLink.progressAt = Date.now(); liveLink.stallTold = false; return; }
if (!liveLink.stallTold && isLiveStalled(liveLink.state, liveLink.progressAt || 0, Date.now(), LIVE_STALL_MS)) {
liveLink.stallTold = true;
showToast(`Konnect Live has stopped moving. ${LIVE_STALL_HELP}`);
}
}

function writeLinkState() {
trackLiveProgress();
liveLink.lastLinkWrite = Date.now();
try {
localStorage.setItem(LIVE_LINK_KEY, JSON.stringify({
state: liveLink.state, text: liveStatusText(),
done: liveLink.done, total: liveLink.total, at: new Date().toISOString()
}));
} catch (error) { /* the desk then says SLA Manager is not running */ }
}

// The strip under the header: what the link is doing now. The stored text
// tells the desk to press Open Konnect Live here; on this panel the button
// beside the line says it.
function renderLinkLine() {
const state = liveLink.state;
const dot = state === 'idle' ? '' : state === 'running' ? 'busy' : state === 'none' ? 'off' : state === 'loggedOut' ? 'bad' : 'warn';
const waiting = liveLink.queue.length + (liveLink.sent ? 1 : 0);
const waitingText = waiting ? ` ${waiting} batch${waiting === 1 ? '' : 'es'} waiting to go.` : '';
const stalled = isLiveStalled(state, liveLink.progressAt || 0, Date.now(), LIVE_STALL_MS);
const text = (state === 'none' ? 'Konnect Live: not open.' : liveStatusText()).replace(/\.$/, '') + waitingText;
const openButton = state === 'none'
? `<button type="button" class="sla-sec" onclick="window._openKonnectLive(this.querySelector('span'))" title="Opens the Konnect Live tab, or brings it forward, without sending anything">${svgIcon('openOut', 13)}<span>Open Konnect Live</span></button>`
: '';
const showBar = state === 'running' && liveLink.total > 0 && !stalled;
const bar = showBar ? `<span class="sla-prog sla-grow" aria-hidden="true"><i style="width: ${Math.max(0, Math.min(100, Math.round(((liveLink.done || 0) / liveLink.total) * 100)))}%;"></i></span>` : '';
return `<div id="_slaLinkLine" class="sla-link" role="status" data-state="${state}">
<span aria-hidden="true" class="sla-dot ${stalled ? 'bad' : dot}"></span>
<span ${showBar ? '' : 'class="sla-grow"'}>${escapeHtml(text)}</span>${bar}${openButton}
</div>`;
}

function linkChanged() {
writeLinkState();
const line = document.getElementById('_slaLinkLine');
if (line) line.outerHTML = renderLinkLine();
}

function writeDeskStatus(id, state, text) {
if (id == null || id === liveLink.withdrawn) return;
try { localStorage.setItem(LIVE_STATUS_KEY, JSON.stringify({ id, state, text, at: new Date().toISOString() })); } catch (error) { /* the desk says it was not picked up */ }
}

function readStoredJson(key) {
try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (error) { return null; }
}

function postLiveBatch(batch) {
liveLink.win.postMessage({ type: 'workTools:batch', id: batch.id, kind: batch.kind, tsv: batch.tsv }, LIVE_ORIGIN);
if (batch.from === 'desk') writeDeskStatus(batch.id, 'sent', 'Sent to the Lead Checker in Konnect Live.');
}

function pumpLiveQueue() {
const now = Date.now();
// A desk request is only good for 10 minutes.
liveLink.queue = liveLink.queue.filter((b) => !(b.from === 'desk' && b.at && now - b.at > DESK_REQUEST_MAX_AGE_MS));
if (!liveLink.win || liveLink.win.closed) return;
const action = nextLiveAction(liveLink, now, liveTiming());
if (!action) return;
if (action.type === 'send') {
liveLink.queue = liveLink.queue.filter((b) => b !== action.batch);
liveLink.sent = { batch: action.batch, at: now };
rememberLiveBatch(action.batch);
} else {
liveLink.sent.at = now;
}
postLiveBatch(action.batch);
linkChanged();
}

function queueLiveBatch(batch) {
liveLink.queue = addToLiveQueue(liveLink.queue, batch);
pumpLiveQueue();
linkChanged();
}

// Opens Konnect Live straight away (a blank tab steered afterwards was
// left blank by the browser). A Live tab this page already opened is
// brought forward rather than reloaded.
function openLiveTab() {
if (liveLink.win && !liveLink.win.closed) {
try { liveLink.win.focus(); } catch (error) { /* still usable */ }
return liveLink.win;
}
const win = window.open(liveUrl(), LIVE_WINDOW_NAME);
if (!win) return null;
liveLink.win = win;
return win;
}

// Opens or brings forward the Live tab with nothing to send, so the link
// can be made before a batch (the desk's, say) needs it.
window._openKonnectLive = function(btn) {
const win = openLiveTab();
if (!win) {
if (btn) { const original = btn.textContent; btn.textContent = 'Allow pop-ups for this site'; setTimeout(() => { btn.textContent = original; }, 2200); }
return false;
}
if (!isLiveLinked()) showToast('Konnect Live is opening. Click Work Tools there to start the Lead Checker; this panel shows when it is linked.');
return true;
};

window._sendToLeadChecker = function(btn, kind) {
const original = btn.textContent;
const flash = (text) => { btn.textContent = text; setTimeout(() => { btn.textContent = original; }, 2200); };
let tsv = '';
if (kind === 'national') {
const row = morningChecksResults.find((r) => r.key === 'national');
tsv = row && row.nationalBatchTsv;
} else {
const exported = currentLeadCheckerExport();
tsv = exported.count ? exported.tsv : '';
}
if (!tsv) { flash('No leads'); return; }
const sent = sendBatchToLeadChecker(kind, tsv);
flash(sent ? 'Sent' : 'Allow pop-ups for this site');
};

function sendBatchToLeadChecker(kind, tsv) {
const win = openLiveTab();
if (!win) return false;
liveLink.batchCount++;
const batch = { from: 'manager', id: `manager-${Date.now()}-${liveLink.batchCount}`, kind, tsv };
queueLiveBatch(batch);
const waiting = liveLink.queue.some((b) => b.id === batch.id);
showToast(!isLiveLinked()
? 'Konnect Live is opening. Click Work Tools there to start the Lead Checker; the batch is passed over and the results come back here.'
: (waiting ? 'The Lead Checker is busy; this batch goes when it is free.' : 'Sent to the Lead Checker.'));
// If the tabs never link up (a page that blocks it), say so instead of
// leaving the batch waiting.
setTimeout(() => {
if (liveLink.queue.some((b) => b.id === batch.id) && !isLiveLinked()) showToast('The Lead Checker has not picked the batch up. Click Work Tools in the Konnect Live tab; if nothing happens, use Copy instead.');
}, 90000);
return true;
}
window._sendBatchToLeadChecker = sendBatchToLeadChecker;

// The agent desktop's request (its Parked Calls). Only a fresh request this
// page has not taken yet is queued; nothing here opens a tab. A request the
// desk has withdrawn is dropped if it has not gone yet.
function takeDeskRequest(request) {
if (!request || !request.id) return;
if (request.cancelled) {
if (liveLink.withdrawn === request.id) return;
liveLink.withdrawn = request.id;
liveLink.handledRequest = request.id;
const before = liveLink.queue.length;
liveLink.queue = liveLink.queue.filter((b) => b.id !== request.id);
if (liveLink.queue.length !== before) linkChanged();
return;
}
if (request.id === liveLink.handledRequest || typeof request.tsv !== 'string') return;
const at = new Date(request.at).getTime();
if (!(Date.now() - at < DESK_REQUEST_MAX_AGE_MS)) return;
const status = readStoredJson(LIVE_STATUS_KEY);
if (status && status.id === request.id && status.state !== 'waiting') return;
liveLink.handledRequest = request.id;
queueLiveBatch({ from: 'desk', id: request.id, kind: 'leads', tsv: request.tsv, at });
if (!liveLink.queue.some((b) => b.id === request.id)) return;
if (!isLiveLinked()) writeDeskStatus(request.id, 'waiting', 'SLA Manager has your Parked Calls, but Konnect Live is not linked yet: press Open Konnect Live in SLA Manager, then click Work Tools in the Konnect Live tab.');
else writeDeskStatus(request.id, 'waiting', 'The Lead Checker is finishing another batch; yours goes next.');
}

// Pure. The Post Closure rows of a results import, in the shape the desk
// reads.
function postClosureRowsFrom(rows, nowIso) {
return (rows || []).filter((r) => r && r.postClosureAction).map((r) => ({
name: r.name || '', phone: r.phone || '', email: r.email || '', source: r.source || '',
postClosureAction: r.postClosureAction, postClosureReason: r.postClosureReason || '', postClosureEvidence: r.postClosureEvidence || '',
checkedAt: nowIso
}));
}

// Pure. One row per customer: email, else the last 10 phone digits, else
// the name. A newer row replaces the older one; rows past one shift go.
function deskResultKey(r) {
const email = String(r.email || '').trim().toLowerCase();
if (email) return `e:${email}`;
const digits = String(r.phone || '').replace(/\D+/g, '');
if (digits) return `p:${digits.slice(-10)}`;
return `n:${stripTitle(String(r.name || '')).toLowerCase().replace(/\s+/g, ' ').trim()}`;
}
function mergeDeskResults(existing, incoming, nowIso) {
const cutoff = new Date(nowIso).getTime() - STORED_CUSTOMER_DATA_MAX_AGE_MS;
const byKey = new Map();
(existing || []).forEach((r) => {
if (!r || !(new Date(r.checkedAt).getTime() >= cutoff)) return;
byKey.set(deskResultKey(r), r);
});
(incoming || []).forEach((r) => {
const key = deskResultKey(r);
// Deleted first so a rechecked customer moves to the end, newest last.
byKey.delete(key);
byKey.set(key, r);
});
return Array.from(byKey.values());
}

// SEND THROUGH: tier 6 leads (no call needed, not Post Closure) for Lead Re
// setup's Send through run. Kept apart from the Post Closure rows, which
// hold one row per customer.
const SEND_THROUGH_KEY = '_workToolsSendThrough';

// Pure. The no call rows of a results import, in the shape the desk reads.
function sendThroughRowsFrom(rows, nowIso) {
return (rows || []).filter((r) => r && r.tier === 6 && !r.postClosureAction).map((r) => ({
name: r.name || '', email: r.email || '', phone: r.phone || '', campaign: r.campaign || '', created: r.created || '',
subCategory: r.subCategory || '', checkedAt: nowIso, agent: ''
}));
}

// Pure. A newer row replaces the older one but keeps the agent already
// recorded; rows past one shift go.
function mergeSendThrough(existing, incoming, nowIso) {
const cutoff = new Date(nowIso).getTime() - STORED_CUSTOMER_DATA_MAX_AGE_MS;
const byKey = new Map();
(existing || []).forEach((l) => { if (l && new Date(l.checkedAt).getTime() >= cutoff) byKey.set(deskResultKey(l), l); });
(incoming || []).forEach((l) => {
const key = deskResultKey(l);
const old = byKey.get(key);
byKey.delete(key);
byKey.set(key, { ...l, agent: l.agent || (old && old.agent) || '' });
});
return Array.from(byKey.values());
}

// Pure. Each saved lead given the agent who holds it on the page now. The
// desk only lists leads whose agent is its own, so a lead nobody holds
// keeps the last agent recorded. known: agent names already recorded, so
// one person is not saved under two spellings.
function stampSendThroughAgents(leads, customers, known) {
const holder = new Map();
(customers || []).forEach((c) => {
if (!c || !c.assigned || !c.agentName) return;
const wanted = normalizeAgentName(c.agentName);
const name = (known || []).find((k) => normalizeAgentName(k) === wanted) || c.agentName;
holder.set(deskResultKey({ name: c.name, email: c.email, phone: c.phone || c.mobile || c.landline }), name);
});
let changed = false;
const stamped = (leads || []).map((l) => {
const name = holder.get(deskResultKey(l));
if (!name || name === l.agent) return l;
changed = true;
return { ...l, agent: name };
});
return { leads: stamped, changed };
}

function knownAgentNames() {
const emailOnly = readStoredJson(EMAIL_ONLY_ASSIGNED_KEY);
return emailOnly && Array.isArray(emailOnly.leads) ? Array.from(new Set(emailOnly.leads.map((l) => l.agent).filter(Boolean))) : [];
}

function saveSendThroughForDesk(rows) {
const nowIso = new Date().toISOString();
const fresh = sendThroughRowsFrom(rows, nowIso);
if (!fresh.length) return;
const stored = readStoredJson(SEND_THROUGH_KEY);
const merged = mergeSendThrough(stored && Array.isArray(stored.leads) ? stored.leads : [], fresh, nowIso);
try {
localStorage.setItem(SEND_THROUGH_KEY, JSON.stringify({ savedAt: nowIso, leads: stampSendThroughAgents(merged, currentCustomers, knownAgentNames()).leads }));
} catch (error) {
console.warn('[SLA Manager] Could not save the Send through leads for the agent desktop (browser storage full or blocked).');
}
}

// After a scan or an assignment: who holds each saved lead now.
function refreshSendThroughAgents() {
try {
const stored = readStoredJson(SEND_THROUGH_KEY);
if (!stored || !Array.isArray(stored.leads) || !stored.leads.length) return;
const { leads, changed } = stampSendThroughAgents(stored.leads, currentCustomers, knownAgentNames());
if (changed) localStorage.setItem(SEND_THROUGH_KEY, JSON.stringify({ ...stored, leads }));
} catch (error) { /* The desk keeps the last agents recorded. */ }
}

// Every Post Closure row from any results that arrive (this page's batches,
// the desk's, and results pasted by hand) goes into the one place the desk
// reads them from. Returns false if they could not be saved.
function savePostClosureForDesk(rows) {
const nowIso = new Date().toISOString();
const fresh = postClosureRowsFrom(rows, nowIso);
if (!fresh.length) return true;
const stored = readStoredJson(DESK_RESULTS_KEY);
const existing = stored && Array.isArray(stored.results)
? stored.results.map((r) => (r && !r.checkedAt ? { ...r, checkedAt: stored.savedAt } : r))
: [];
try {
localStorage.setItem(DESK_RESULTS_KEY, JSON.stringify({ savedAt: nowIso, results: mergeDeskResults(existing, fresh, nowIso) }));
return true;
} catch (error) {
console.warn('[SLA Manager] Could not save the Post Closure results for the agent desktop (browser storage full or blocked).');
return false;
}
}

// The desk's batch: its results never touch the lead cards.
function saveDeskResults(id, tsv, progress) {
const parsed = parseLeadCheckerImportTsv(tsv);
if (!parsed.headerOk) { writeDeskStatus(id, 'failed', 'The Lead Checker results could not be read.'); return; }
saveSendThroughForDesk(parsed.rows);
if (!savePostClosureForDesk(parsed.rows)) { writeDeskStatus(id, 'failed', 'The results could not be saved (browser storage full).'); return; }
writeDeskStatus(id, progress ? 'checking' : 'done', progress ? `Lead Checker: ${progress.done} of ${progress.total} checked.` : `Lead Checker done: ${parsed.rows.length} checked.`);
}

function importLinkedResults(kind, tsv, progress) {
if (kind === 'national') {
const parsed = parseNationalResultsTsv(tsv);
if (!parsed.ok) { showToast(`Lead Checker results could not be read: ${parsed.error}`); return; }
saveNationalResults(mergeNationalResults(loadNationalResults() || [], parsed.results, true));
if (!progress) showToast(`National results back from the Lead Checker (${parsed.results.length}).`);
if (currentPanelMode === 'morningChecks') redrawWhenNotTyping(() => { if (currentPanelMode === 'morningChecks') displayMorningChecks(); });
else renderTodaySummaryInPlace();
return;
}
const parsed = parseLeadCheckerImportTsv(tsv);
if (!parsed.headerOk || parsed.rows.length === 0) { showToast('Lead Checker results could not be read.'); return; }
addLeadCheckerResults(parsed.rows);
if (!progress) showToast(`Lead Checker results back (${parsed.rows.length}) and shown on the lead cards.`);
if (currentPanelMode === 'normal') redrawWhenNotTyping(redrawLeadsPanel);
}

const LIVE_ENDED_TEXT = {
cancelled: 'The check was cancelled in the Lead Checker.',
cleared: 'The Lead Checker was cleared before the check finished.',
empty: 'The Lead Checker found no leads to check in that batch.',
unreadable: 'The Lead Checker could not read that batch.',
lost: 'Konnect Live reloaded and the check stopped before it finished.'
};

// Tells whoever sent a batch how it ended. finalSeen: its full results
// already arrived, which said so themselves.
function notifyLiveBatchEnded(batch, reason, finalSeen) {
const finished = reason === 'done' || !LIVE_ENDED_TEXT[reason];
if (finished) {
if (batch.from === 'desk' && !finalSeen) writeDeskStatus(batch.id, 'done', 'Lead Checker done.');
} else if (batch.from === 'desk') {
writeDeskStatus(batch.id, 'ended', `${LIVE_ENDED_TEXT[reason]} Results already checked are kept; ask again to check the rest.`);
} else {
showToast(`${LIVE_ENDED_TEXT[reason]} Press Send again if you still need it.`);
}
}

// A batch has stopped for good, with or without results.
function endLiveBatch(id, reason, finalSeen) {
if (id == null && !liveLink.running) return;
const running = liveLink.running && (id == null || liveLink.running.id === id) ? liveLink.running : null;
const batch = running || ownerOfLiveBatch(id);
if (running) liveLink.running = null;
if (liveLink.sent && liveLink.sent.batch.id === batch.id) liveLink.sent = null;
liveLink.queue = liveLink.queue.filter((b) => b.id !== batch.id);
if (!liveLink.running) {
if (liveLink.state !== 'none') liveLink.state = 'idle';
liveLink.done = 0;
liveLink.total = 0;
}
notifyLiveBatchEnded(batch, reason, !!finalSeen || !!(running && running.finalSeen));
pumpLiveQueue();
linkChanged();
}

// No "ready" for too long, or the tab has gone. Waiting batches are kept
// for when the link comes back.
function setLinkDown() {
if (liveLink.state === 'none') return;
liveLink.state = 'none';
liveLink.done = 0;
liveLink.total = 0;
if (liveLink.sent) {
liveLink.queue = [liveLink.sent.batch].concat(liveLink.queue.filter((b) => b.id !== liveLink.sent.batch.id));
liveLink.sent = null;
}
const ours = liveLink.queue.concat(liveLink.running ? [liveLink.running] : []);
const desk = ours.find((b) => b.from === 'desk');
if (desk) writeDeskStatus(desk.id, 'waiting', 'Konnect Live has stopped answering (its tab was closed or moved on). Your Parked Calls are kept: press Open Konnect Live in SLA Manager.');
if (ours.some((b) => b.from === 'manager')) showToast('Konnect Live has stopped answering. The batch is kept: press Open Konnect Live.');
linkChanged();
}

function markLiveBatchReceived(batch, rows, now) {
if (liveLink.sent && liveLink.sent.batch.id === batch.id) liveLink.sent = null;
liveLink.queue = liveLink.queue.filter((b) => b.id !== batch.id);
// The Lead Checker runs one batch at a time, so one still marked as
// running here has ended without a message.
const previous = liveLink.running && liveLink.running.id !== batch.id ? liveLink.running : null;
rememberLiveBatch(batch);
liveLink.running = { id: batch.id, from: batch.from, kind: batch.kind, receivedAt: now, finalSeen: false };
if (previous) notifyLiveBatchEnded(previous, previous.finalSeen ? 'done' : 'lost', previous.finalSeen);
liveLink.state = 'running';
liveLink.done = 0;
liveLink.total = rows || 0;
}

function onLiveReady(event, data, now) {
const timing = liveTiming();
liveLink.win = event.source;
liveLink.lastReadyAt = now;
if (typeof data.url === 'string' && /^https:\/\/carbot\.ai\/konnectlive\/[^#?]*$/i.test(data.url)) {
try { localStorage.setItem(LIVE_URL_KEY, data.url); } catch (error) { /* the default still works */ }
}
if (typeof data.state !== 'string') {
// An older Lead Checker does not say what it is doing: it is taken to be
// idle unless a batch of ours is running or it just said it was busy.
liveLink.state = (liveLink.running || now - liveLink.legacyBusyAt < timing.legacyBusyMs) ? 'running' : 'idle';
} else {
// A state this copy does not know is treated as busy, so nothing is sent.
const state = LIVE_STATES.includes(data.state) ? data.state : 'running';
const batchId = data.batchId == null ? null : String(data.batchId);
if (batchId !== null) {
if (liveLink.sent && liveLink.sent.batch.id === batchId) {
// The "received" message was missed.
markLiveBatchReceived(liveLink.sent.batch, data.total, now);
} else if (!liveLink.running || liveLink.running.id !== batchId) {
// A batch from before this page reloaded, restored by the Live tab.
markLiveBatchReceived(ownerOfLiveBatch(batchId), data.total, now);
}
} else if (liveLink.running && state === 'idle' && now - liveLink.running.receivedAt >= timing.lostGraceMs) {
// Idle with no batch while one of ours should be running: it ended
// without a message (the Live tab reloaded).
endLiveBatch(liveLink.running.id, liveLink.running.finalSeen ? 'done' : 'lost');
}
liveLink.state = state;
liveLink.done = batchId !== null && Number.isFinite(data.done) ? data.done : 0;
liveLink.total = batchId !== null && Number.isFinite(data.total) ? data.total : 0;
}
pumpLiveQueue();
linkChanged();
}

// Pure. One lead as the Lead Checker export writes it, for either page.
function leadCheckerRowFor(c, pageType) {
const pending = pageType === PAGE_PENDING;
return {
name: tsvClean(stripTitle(c.name || '')),
phone: tsvClean(pending ? (c.mobile || c.landline) : c.phone),
email: tsvClean(c.email),
source: pending ? (c.callbackType === 'Post Closure' ? 'Post Closure Processing' : '') : tsvClean(c.source),
campaign: tsvClean(c.campaign),
created: tsvClean(pending ? c.lastActionText : c.createdText)
};
}

// Asks the Lead Checker to open one lead. Never opens a tab itself; the
// focus call has to stay inside the click.
window._openLeadOnLive = function(buttonEl) {
if (!buttonEl) return;
const pageType = buttonEl.dataset.pageType;
const lead = (pageType === PAGE_PENDING ? currentPendingCustomers : currentCustomers).find((c) => c.key === buttonEl.dataset.leadKey);
if (!lead) return;
const avatarPopover = document.getElementById('_slaAvatarAssignPopover');
if (avatarPopover) avatarPopover.style.display = 'none';
if (!isLiveLinked()) { showToast('Konnect Live is not open. Press Open Konnect Live first.'); return; }
const row = leadCheckerRowFor(lead, pageType);
liveLink.win.postMessage({ type: 'workTools:open', row }, LIVE_ORIGIN);
try { liveLink.win.focus(); } catch (error) { /* still sent */ }
showToast(`Asked Konnect Live to open ${row.name}.`);
};

// ---- Review decisions the Lead Checker sends as they are made ----

// Pure. Header line plus rows, each row keyed by its header.
function parseReviewTsv(tsv) {
const lines = String(tsv || '').split(/\r?\n/).filter((line) => line.trim() !== '');
if (!lines.length) return { header: [], rows: [] };
const header = lines[0].split('\t').map((h) => h.trim());
const rows = lines.slice(1).map((line) => {
const cells = line.split('\t');
const row = {};
header.forEach((h, i) => { if (h) row[h] = (cells[i] || '').trim(); });
return row;
});
return { header: header.filter(Boolean), rows };
}

// Pure. Name and Created when the header has them, else the first columns.
function reviewRowIdentity(cells, header) {
const clean = (value) => String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
const column = (wanted) => header.find((h) => h.toLowerCase() === wanted);
const name = column('name'); const created = column('created');
if (name && created && (cells[name] || cells[created])) return `${clean(stripTitle(cells[name] || ''))}|${clean(cells[created])}`;
return header.slice(0, 3).map((h) => clean(cells[h])).join('|');
}

// Pure. A newer decision for the same lead replaces the older one in place;
// rows older than a shift are dropped.
function mergeReviewDecisions(stored, incoming, nowIso) {
const now = new Date(nowIso).getTime();
const header = (stored && Array.isArray(stored.header) ? stored.header : []).slice();
incoming.header.forEach((h) => { if (!header.includes(h)) header.push(h); });
const rows = (stored && Array.isArray(stored.rows) ? stored.rows : [])
.filter((r) => r && r.cells && now - new Date(r.at).getTime() <= STORED_CUSTOMER_DATA_MAX_AGE_MS);
const index = new Map(rows.map((r, i) => [reviewRowIdentity(r.cells, header), i]));
incoming.rows.forEach((cells) => {
const key = reviewRowIdentity(cells, header);
const entry = { at: nowIso, cells };
if (index.has(key)) rows[index.get(key)] = entry;
else { index.set(key, rows.length); rows.push(entry); }
});
return { savedAt: nowIso, header, rows };
}

// Pure. The merged set as the Lead Checker sent it: same header, one line each.
function reviewDecisionsTsv(store) {
return [store.header.join('\t')].concat(store.rows.map((r) => store.header.map((h) => tsvClean(r.cells[h])).join('\t'))).join('\n');
}

function loadReviewDecisions() {
const stored = readStoredJson(REVIEW_DECISIONS_KEY);
if (!stored || !Array.isArray(stored.rows) || !Array.isArray(stored.header)) return { header: [], rows: [] };
if (!isStoredTimeFresh(stored.savedAt)) { removeStoredKey(REVIEW_DECISIONS_KEY); return { header: [], rows: [] }; }
return { header: stored.header, rows: stored.rows.filter((r) => r && r.cells && isStoredTimeFresh(r.at)) };
}

function loadDeskDecisions() {
const stored = readStoredJson(DESK_DECISIONS_KEY);
return stored && Array.isArray(stored.rows) ? stored.rows.filter((r) => r && isStoredTimeFresh(r.at)) : [];
}

// Pure. The Lead Checker's block, a blank line, then the desk's block; a
// side with nothing to copy is left out.
function combinedDecisionsText(store, deskRows) {
const blocks = [];
if (store.rows.length) blocks.push(reviewDecisionsTsv(store));
if (deskRows.length) blocks.push(['Run\tCustomer\tDetail\tOutcome\tStep\tWhy\tAt'].concat(deskRows.map((r) => [r.run, r.name, r.detail, r.outcome, r.step, r.why, r.at].map(tsvClean).join('\t'))).join('\n'));
return blocks.join('\n\n');
}

function reviewDecisionsButtonText() {
return `Copy review decisions (${loadReviewDecisions().rows.length + loadDeskDecisions().length})`;
}

function saveReviewDecisions(tsv) {
const incoming = parseReviewTsv(tsv);
if (!incoming.header.length) return;
try {
localStorage.setItem(REVIEW_DECISIONS_KEY, JSON.stringify(mergeReviewDecisions(readStoredJson(REVIEW_DECISIONS_KEY), incoming, new Date().toISOString())));
} catch (error) { /* storage full: the Lead Checker still holds them */ }
const button = document.getElementById('_slaCopyReviewBtn');
if (button) button.textContent = reviewDecisionsButtonText();
}

window._copyReviewDecisions = function(buttonEl) {
const store = loadReviewDecisions();
const deskRows = loadDeskDecisions();
const count = store.rows.length + deskRows.length;
const restore = () => { buttonEl.textContent = reviewDecisionsButtonText(); };
if (!count) {
buttonEl.textContent = 'No review decisions yet';
setTimeout(restore, 1200);
return;
}
navigator.clipboard.writeText(combinedDecisionsText(store, deskRows)).then(() => {
buttonEl.textContent = `✓ Copied ${count}`;
setTimeout(restore, 1200);
}).catch(() => {
buttonEl.textContent = '✗ Failed';
setTimeout(restore, 1500);
});
};

function onLiveMessage(event) {
if (event.origin !== LIVE_ORIGIN) return;
const data = event.data;
if (!data || typeof data.type !== 'string' || !data.type.startsWith('workTools:')) return;
const now = Date.now();
// An older Lead Checker sends no ids: its messages are about the batch
// last sent or running.
const id = data.id == null ? null : String(data.id);
if (data.type === 'workTools:ready') {
onLiveReady(event, data, now);
} else if (data.type === 'workTools:received') {
const batch = (liveLink.sent && (id === null || liveLink.sent.batch.id === id)) ? liveLink.sent.batch
: (id !== null ? (liveLink.queue.find((b) => b.id === id) || ownerOfLiveBatch(id)) : null);
if (!batch) return;
markLiveBatchReceived(batch, data.rows, now);
const rows = `${data.rows || 0} lead${data.rows === 1 ? '' : 's'}`;
if (batch.from === 'desk') writeDeskStatus(batch.id, 'checking', `The Lead Checker is checking ${rows}.`);
else showToast(`The Lead Checker has the batch (${rows}) and is checking it.`);
linkChanged();
} else if (data.type === 'workTools:busy') {
const refused = liveLink.sent && (id === null || liveLink.sent.batch.id === id) ? liveLink.sent.batch : null;
if (!refused) return;
if (data.runningId != null && String(data.runningId) === refused.id) {
// Sent twice and the first copy is the one running.
markLiveBatchReceived(refused, 0, now);
} else {
liveLink.sent = null;
// Back to the front, unless a newer batch has taken its place.
if (!liveLink.queue.some((b) => b.from === refused.from && b.kind === refused.kind)) liveLink.queue = [refused].concat(liveLink.queue);
if (!('runningId' in data)) liveLink.legacyBusyAt = now;
if (liveLink.state === 'idle') liveLink.state = 'running';
if (refused.from === 'desk') writeDeskStatus(refused.id, 'waiting', 'The Lead Checker is finishing another batch; yours goes next.');
else showToast('The Lead Checker is still running a batch. This one goes when it has finished.');
}
linkChanged();
} else if (data.type === 'workTools:results' && typeof data.tsv === 'string') {
let batch;
if (id !== null) batch = (liveLink.running && liveLink.running.id === id) ? liveLink.running : ownerOfLiveBatch(id);
else if (liveLink.running) batch = liveLink.running;
else {
// No id and nothing known to be running (this page reloaded mid-batch
// with an older Lead Checker): the desk's own status says if it was its.
const status = readStoredJson(LIVE_STATUS_KEY);
batch = status && ['sent', 'checking'].includes(status.state) ? { from: 'desk', id: status.id } : { from: 'manager', id: null };
}
const progress = data.partial ? { done: data.done, total: data.total } : null;
if (liveLink.running && liveLink.running === batch) {
if (progress) {
if (Number.isFinite(data.done)) liveLink.done = data.done;
if (Number.isFinite(data.total)) liveLink.total = data.total;
} else liveLink.running.finalSeen = true;
}
if (data.kind === 'leads' && batch.from === 'desk') saveDeskResults(batch.id, data.tsv, progress);
else importLinkedResults(data.kind, data.tsv, progress);
// An older Lead Checker sends no "ended": its final results are the end.
if (!progress && id === null) { if (liveLink.running === batch) endLiveBatch(batch.id, 'done', true); }
linkChanged();
} else if (data.type === 'workTools:ended') {
endLiveBatch(id, typeof data.reason === 'string' ? data.reason : 'done');
} else if (data.type === 'workTools:opened') {
showToast(typeof data.text === 'string' && data.text ? data.text : (data.ok ? 'Opened on Konnect Live.' : 'Konnect Live could not open the lead.'));
} else if (data.type === 'workTools:review' && typeof data.tsv === 'string') {
saveReviewDecisions(data.tsv);
}
}

function liveLinkTick() {
const now = Date.now();
const timing = liveTiming();
if (liveLink.state !== 'none' && ((liveLink.win && liveLink.win.closed) || now - liveLink.lastReadyAt > timing.downMs)) setLinkDown();
takeDeskRequest(readStoredJson(LIVE_REQUEST_KEY));
pumpLiveQueue();
// Rewritten in step even when nothing changes, so the desk can tell that
// SLA Manager is still running.
if (now - liveLink.lastLinkWrite >= timing.heartbeatMs) writeLinkState();
}

// One listener of each kind and one timer per page; each calls the newest
// copy of the handler, so clicking the bookmark again does not leave an old
// one answering.
window.__workToolsOnLiveMessage = onLiveMessage;
window.__workToolsOnDeskRequest = takeDeskRequest;
window.__workToolsLinkTick = liveLinkTick;
if (!window.__workToolsLinkListening && typeof window.addEventListener === 'function') {
window.__workToolsLinkListening = true;
window.addEventListener('message', (event) => { if (window.__workToolsOnLiveMessage) window.__workToolsOnLiveMessage(event); });
window.addEventListener('storage', (event) => {
if (event.key === LIVE_REQUEST_KEY && window.__workToolsOnDeskRequest) window.__workToolsOnDeskRequest(readStoredJson(LIVE_REQUEST_KEY));
});
}
if (window.__workToolsLinkTimer) clearInterval(window.__workToolsLinkTimer);
window.__workToolsLinkTimer = setInterval(() => { if (window.__workToolsLinkTick) window.__workToolsLinkTick(); }, liveTiming().tickMs);
writeLinkState();
// A request the desk made before this page (or this copy) was running.
takeDeskRequest(readStoredJson(LIVE_REQUEST_KEY));

runSelfTest('liveLinkSelfTest', function liveLinkSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
const timing = { ...LIVE_TIMING };
const t0 = 1000000;
const desk = { from: 'desk', id: 'desk-1', kind: 'leads' };
const own = { from: 'manager', id: 'manager-1', kind: 'leads' };
const link = (over) => ({ state: 'idle', queue: [desk], sent: null, running: null, ...over });
const typeOf = (action) => (action ? `${action.type}:${action.batch.id}` : null);
check('a waiting batch goes when the Lead Checker is idle', typeOf(nextLiveAction(link({}), t0, timing)), 'send:desk-1');
check('nothing goes while the link is down', nextLiveAction(link({ state: 'none' }), t0, timing), null);
check('nothing goes while the Lead Checker is running, paused or logged out', ['running', 'paused', 'loggedOut'].map((state) => nextLiveAction(link({ state }), t0, timing)), [null, null, null]);
check('nothing goes while a batch of ours is running, however long it takes', nextLiveAction(link({ running: { id: 'manager-1', receivedAt: t0 - 60 * 60 * 1000 } }), t0, timing), null);
check('a batch just sent is not sent again straight away', nextLiveAction(link({ sent: { batch: own, at: t0 - 1000 } }), t0, timing), null);
check('a batch not acknowledged in time is sent again', typeOf(nextLiveAction(link({ sent: { batch: own, at: t0 - timing.resendMs } }), t0, timing)), 'resend:manager-1');
check('nothing to send with an empty queue', nextLiveAction(link({ queue: [] }), t0, timing), null);
const national = { from: 'manager', id: 'manager-2', kind: 'national' };
check('a newer batch replaces a waiting one from the same page of the same kind only',
addToLiveQueue([desk, own, national], { from: 'manager', id: 'manager-3', kind: 'leads' }).map((b) => b.id), ['desk-1', 'manager-2', 'manager-3']);
check('the desk batch does not replace SLA Manager\'s', addToLiveQueue([own], desk).map((b) => b.id), ['manager-1', 'desk-1']);
const known = { 'manager-1': { from: 'manager', kind: 'leads' }, 'desk-1': { from: 'desk', kind: 'leads' } };
check('results are routed by the id the batch was sent with', [liveBatchOwner('desk-1', known, []).from, liveBatchOwner('manager-1', known, []).from], ['desk', 'manager']);
check('the desk request id is the desk\'s even after this page reloaded', liveBatchOwner('desk-9', {}, ['desk-9']).from, 'desk');
check('an unknown id, or none, is SLA Manager\'s own', [liveBatchOwner('other-1', known, ['desk-9']).from, liveBatchOwner(null, known, []).from], ['manager', 'manager']);
check('a running batch with no progress for 90 seconds is stalled; idle and fresh ones are not', [isLiveStalled('running', 1000, 91000, 90000), isLiveStalled('running', 1000, 50000, 90000), isLiveStalled('idle', 1000, 999999, 90000), isLiveStalled('running', 0, 999999, 90000)], [true, false, false, false]);
check('status line wording', ['none', 'idle', 'running', 'paused', 'loggedOut'].map((s) => linkStatusText(s, 12, 40)), [
'Konnect Live: not open. Press Open Konnect Live in SLA Manager.', 'Konnect Live: linked, ready.', 'Konnect Live: checking 12 of 40.', 'Konnect Live: paused.', 'Konnect Live: logged out, logging back in.']);
const now = '2026-11-11T12:00:00.000Z';
const rows = [
{ name: 'Jo Example', phone: '', email: 'Jo.Example@example.com', source: 'Post Closure Processing', postClosureAction: 'send back through', postClosureReason: 'Email only', postClosureEvidence: 'x', tier: null },
{ name: 'Sam Buyer', phone: '07700 900102', email: '', source: 'Customer First', postClosureAction: '', tier: 2 }
];
const pc = postClosureRowsFrom(rows, now);
check('only no call rows that are not Post Closure go to Send through',
sendThroughRowsFrom([{ name: 'Sam Buyer', email: 'sam.buyer@example.com', tier: 6, subCategory: 'Fleet', postClosureAction: '' }, { name: 'Jo Example', tier: 6, postClosureAction: 'send back through' }, { name: 'Al Sample', tier: 2 }], now).map((l) => [l.name, l.subCategory, l.agent]),
[['Sam Buyer', 'Fleet', '']]);
check('a rechecked Send through lead keeps its agent, and the page holder is stamped under the known spelling',
stampSendThroughAgents(mergeSendThrough([{ name: 'Sam Buyer', email: 'sam.buyer@example.com', checkedAt: now, agent: 'Agent Alpha' }], [{ name: 'Sam Buyer', email: 'sam.buyer@example.com', checkedAt: now, agent: '' }, { name: 'Al Sample', email: 'al.sample@example.com', checkedAt: now, agent: '' }], now),
[{ name: 'Al Sample', email: 'AL.SAMPLE@example.com', assigned: true, agentName: 'agent  bravo' }], ['Agent Bravo']).leads.map((l) => [l.name, l.agent]),
[['Sam Buyer', 'Agent Alpha'], ['Al Sample', 'Agent Bravo']]);
check('only Post Closure rows are kept for the desk', pc.map((r) => [r.name, r.postClosureAction, r.checkedAt]), [['Jo Example', 'send back through', now]]);
const stored = [
{ name: 'Jo Example', email: 'jo.example@example.com', phone: '', postClosureAction: 'check: needs contact?', checkedAt: '2026-11-11T09:00:00.000Z' },
{ name: 'Al Sample', email: '', phone: '+44 7700 900103', postClosureAction: 'send back through', checkedAt: '2026-11-11T09:00:00.000Z' },
{ name: 'Old Example', email: 'old@example.com', phone: '', postClosureAction: 'send back through', checkedAt: '2026-11-10T20:00:00.000Z' }
];
const merged = mergeDeskResults(stored, pc.concat([{ name: 'Al Sample', email: '', phone: '07700 900103', postClosureAction: 'check: needs contact?', checkedAt: now }]), now);
check('desk results merge by email, else the last 10 phone digits; newer wins; a shift old is dropped',
merged.map((r) => [r.name, r.postClosureAction]), [['Jo Example', 'send back through'], ['Al Sample', 'check: needs contact?']]);
check('with no email or phone the name is the key, title ignored', deskResultKey({ name: 'Mr  Jo Example' }) === deskResultKey({ name: 'jo example' }), true);
check('open on Konnect Live: an SLA lead as the export writes it', leadCheckerRowFor({ name: 'Mrs Jo Example', phone: '07700 900101', email: 'jo@example.com', source: 'Customer First', campaign: 'Citroen - Enquiry - New', createdText: 'Wed, 11 Nov 2026 09:00' }, PAGE_SLA),
{ name: 'Jo Example', phone: '07700 900101', email: 'jo@example.com', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Wed, 11 Nov 2026 09:00' });
check('open on Konnect Live: a Pending Post Closure lead, landline when there is no mobile', leadCheckerRowFor({ name: 'Al Sample', mobile: '', landline: '01632 960001', email: '', callbackType: 'Post Closure', campaign: 'General', lastActionText: 'Wed, 11 Nov 2026 08:00' }, PAGE_PENDING),
{ name: 'Al Sample', phone: '01632 960001', email: '', source: 'Post Closure Processing', campaign: 'General', created: 'Wed, 11 Nov 2026 08:00' });
check('open on Konnect Live: a lead not read yet sends its name', leadCheckerRowFor({ name: 'Dr Al Sample' }, PAGE_SLA).name, 'Al Sample');
const reviewHeader = 'Name\tCreated\tDecision\tNote';
const first = mergeReviewDecisions(null, parseReviewTsv(`${reviewHeader}\nJo Example\tWed, 11 Nov 2026 09:00\tTier 2\t\nAl Sample\tWed, 11 Nov 2026 08:00\tTier 4\tasked for a quote`), '2026-11-11T09:00:00.000Z');
const second = mergeReviewDecisions(first, parseReviewTsv(`${reviewHeader}\nMr jo  example\tWed, 11 Nov 2026 09:00\tTier 1\tgave a time\nJo Example\tWed, 11 Nov 2026 10:30\tTier 5\t`), '2026-11-11T10:00:00.000Z');
check('review decisions merge by name and created; newer replaces older in place', second.rows.map((r) => [r.cells.Name, r.cells.Decision]), [['Mr jo  example', 'Tier 1'], ['Al Sample', 'Tier 4'], ['Jo Example', 'Tier 5']]);
check('review decisions copy with the same header', reviewDecisionsTsv(second).split('\n')[0] + '|' + reviewDecisionsTsv(second).split('\n').length, reviewHeader + '|4');
const deskRow = { at: '2026-11-11T10:05:00.000Z', run: 'Post Closure', name: 'Jo Example', detail: 'Citroen - Enquiry - New', outcome: 'Skipped', step: 'Update Outcomes', why: 'already\tworked' };
const deskBlock = 'Run\tCustomer\tDetail\tOutcome\tStep\tWhy\tAt\nPost Closure\tJo Example\tCitroen - Enquiry - New\tSkipped\tUpdate Outcomes\talready worked\t2026-11-11T10:05:00.000Z';
check('both kinds of decision copy as two blocks with a blank line between', combinedDecisionsText(second, [deskRow]), `${reviewDecisionsTsv(second)}\n\n${deskBlock}`);
check('desk decisions alone copy as just their block', combinedDecisionsText({ header: [], rows: [] }, [deskRow]), deskBlock);
check('Lead Checker decisions alone copy as before', combinedDecisionsText(second, []), reviewDecisionsTsv(second));
check('review decisions a shift old are dropped', mergeReviewDecisions(first, parseReviewTsv(`${reviewHeader}\nEve Evans\tx\tTier 3\t`), '2026-11-12T09:00:00.000Z').rows.map((r) => r.cells.Name), ['Eve Evans']);
check('with no Name or Created the first columns are the identity', mergeReviewDecisions(mergeReviewDecisions(null, parseReviewTsv('Lead\tDecision\nA1\tValid'), '2026-11-11T09:00:00.000Z'), parseReviewTsv('Lead\tDecision\nA1\tValid\nA2\tValid'), '2026-11-11T09:05:00.000Z').rows.length, 2);
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager live-link self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager live-link self-test passed');
}
});

window._copyLeadCheckerExport = function(buttonEl) {
const original = buttonEl.textContent;
const { tsv, count } = currentPageType === PAGE_PENDING
? buildPendingLeadCheckerTsv(loadPendingLeadCheckerExportSettings().callbackTypes)
: (() => { const s = loadLeadCheckerExportSettings(); return buildLeadCheckerTsv(s.tiers, s.customerFirstOnly); })();
if (count === 0) {
buttonEl.textContent = 'No leads';
setTimeout(() => { buttonEl.textContent = original; }, 1200);
return;
}
navigator.clipboard.writeText(tsv).then(() => {
buttonEl.textContent = `✓ Copied ${count}`;
// Closes only on success, so an error stays visible for a retry.
setTimeout(() => {
buttonEl.textContent = original;
setSendView(false);
}, 900);
}).catch(() => {
buttonEl.textContent = '✗ Failed';
setTimeout(() => { buttonEl.textContent = original; }, 1500);
});
};

// ===================================================================
// CLASSIFY LEAD CHECKER RESULTS
//
// The reverse handoff: paste the Lead Checker's "Copy raw for Extract" output
// to show its results on the lead cards. Its Tier, SubCategory, Flags,
// Reason and PriorityRank are trusted as-is, so no second classifier lives
// here to drift. The paste and results persist across panel rebuilds.
// ===================================================================

const LEAD_CHECKER_IMPORT_KEY = '_slaLeadCheckerImportState';
// Must match Konnect-Lead-Checker.js's buildRawNotesTsvForExtract header; the
// files cannot share a module.
const LEAD_CHECKER_IMPORT_HEADER = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes', 'Tier', 'TierName', 'SubCategory', 'SubRank', 'Flags', 'Confidence', 'Reason', 'DedupeKey', 'PostClosureAction', 'PriorityRank', 'PostClosureReason', 'PostClosureEvidence'];

// Results saved before Post Closure leads lost their tier can hold a wrong
// tier (NURTURE) that would hide those leads from the next Send, so they
// are dropped once.
const LEAD_CHECKER_RESULTS_VALID_FROM = '2026-11-10T17:15:39Z';

function loadLeadCheckerImportState() {
try {
const raw = JSON.parse(localStorage.getItem(LEAD_CHECKER_IMPORT_KEY));
if (raw && typeof raw === 'object') {
if (!isStoredTimeFresh(raw.savedAt) || !(new Date(raw.savedAt) >= new Date(LEAD_CHECKER_RESULTS_VALID_FROM))) {
removeStoredKey(LEAD_CHECKER_IMPORT_KEY);
return { rawInput: '', results: [] };
}
// Each result carries when it was checked, so merged results still expire
// after one shift. Results saved before that was recorded take the time
// they were saved.
const results = (Array.isArray(raw.results) ? raw.results : [])
.map((r) => (r && !r.checkedAt ? { ...r, checkedAt: raw.savedAt } : r))
.filter((r) => r && isStoredTimeFresh(r.checkedAt));
return { rawInput: raw.rawInput || '', results };
}
} catch (error) {
// ignore
}
return { rawInput: '', results: [] };
}

function saveLeadCheckerImportState(state) {
try {
localStorage.setItem(LEAD_CHECKER_IMPORT_KEY, JSON.stringify({ ...state, savedAt: new Date().toISOString() }));
} catch (error) {
console.warn('[SLA Manager] Could not save the Lead Checker results (browser storage full or blocked).');
}
}

// The Lead Checker replaces tabs and newlines inside fields, so a plain tab
// split gives one cell per column.
function parseLeadCheckerImportTsv(rawText) {
const lines = String(rawText || '').split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
if (lines.length === 0) return { rows: [], headerOk: false, error: 'No input.' };

const header = lines[0].split('\t').map((h) => h.trim());
// Exports from an older Lead Checker panel, without the newer trailing
// columns (from PriorityRank on), are still accepted.
const headerOk = header.length >= 17 && header.length <= LEAD_CHECKER_IMPORT_HEADER.length
&& header.every((h, i) => h === LEAD_CHECKER_IMPORT_HEADER[i]);
if (!headerOk) {
return { rows: [], headerOk: false, error: `Header does not match expected columns: ${LEAD_CHECKER_IMPORT_HEADER.join('\t')}` };
}

const rows = lines.slice(1).map((line) => {
const cells = line.split('\t');
// Number('') is 0, so a blank rank is checked first rather than becoming top
// priority.
const rawRank = (cells[16] || '').trim();
const parsedRank = rawRank === '' ? NaN : Number(rawRank);
const rawTier = (cells[7] || '').trim();
const parsedTier = rawTier === '' ? NaN : Number(rawTier);
return {
name: (cells[0] || '').trim(),
phone: (cells[1] || '').trim(),
email: (cells[2] || '').trim(),
source: (cells[3] || '').trim(),
campaign: (cells[4] || '').trim(),
created: (cells[5] || '').trim(),
initialNotes: (cells[6] || '').trim(),
tier: Number.isFinite(parsedTier) ? parsedTier : null,
tierName: (cells[8] || '').trim(),
subCategory: (cells[9] || '').trim(),
subRank: (cells[10] || '').trim(),
flags: (cells[11] || '').trim(),
confidence: (cells[12] || '').trim(),
reason: (cells[13] || '').trim(),
dedupeKey: (cells[14] || '').trim(),
postClosureAction: (cells[15] || '').trim(),
postClosureReason: (cells[17] || '').trim(),
postClosureEvidence: (cells[18] || '').trim(),
priorityRank: Number.isFinite(parsedRank) ? parsedRank : 700
};
});
return { rows, headerOk: true, error: null };
}

// Orders by the rank the Lead Checker computed.
function classifyLeadCheckerImportRows(rows) {
return [...rows].sort((a, b) => a.priorityRank - b.priorityRank);
}

// Pure. One result per contact: the customer (email, else phone, else name)
// and that lead's Created time.
function leadCheckerResultKey(r) {
const who = normalizeEmailForLeadCheckerMatch(r.email) || normalizePhoneForLeadCheckerMatch(r.phone) || `name:${String(r.name || '').trim().toLowerCase()}`;
return `${who}||${r.created || ''}`;
}

// Pure. New results are added to the ones already held rather than
// replacing them, so a second batch does not wipe the first. A newer result
// for the same contact wins, except that a row the Lead Checker did not
// finish (no tier, no Post Closure action) never replaces a finished one.
function mergeLeadCheckerResults(existing, incoming, nowIso) {
const byKey = new Map((existing || []).map((r) => [leadCheckerResultKey(r), r]));
(incoming || []).forEach((r) => {
const key = leadCheckerResultKey(r);
const old = byKey.get(key);
const unfinished = r.tier == null && !r.postClosureAction;
if (old && unfinished && (old.tier != null || old.postClosureAction)) return;
byKey.set(key, { ...r, checkedAt: nowIso });
});
return classifyLeadCheckerImportRows(Array.from(byKey.values()));
}

// Results from a paste or from the link, added to the lead cards' results.
// Post Closure rows also go to the agent desktop's list.
function addLeadCheckerResults(rows) {
const merged = mergeLeadCheckerResults(loadLeadCheckerImportState().results, rows, new Date().toISOString());
saveLeadCheckerImportState({ rawInput: '', results: merged });
savePostClosureForDesk(rows);
saveSendThroughForDesk(rows);
return merged;
}

// Confirms the header contract and the trust-not-reclassify behavior.
runSelfTest('leadCheckerImportSelfTest', function leadCheckerImportSelfTest() {
const failures = [];
// Same column order as LEAD_CHECKER_IMPORT_HEADER.
const sampleTsv = [
LEAD_CHECKER_IMPORT_HEADER.join('\t'),
['Amy Adams', '07700900001', 'amy@example.com', 'Customer First', 'Citroen - Enquiry - New', '01/09/2026', 'Customer Comments: -', '5', 'NURTURE', 'Enquiry: Blank', '9', '', 'low', 'Nothing matched.', '', '', '509'].join('\t'),
['Ben Brown', '07700900002', 'ben@example.com', 'Customer First', 'Citroen - Enquiry - New', '02/09/2026', 'Customer Comments: See you at 3pm', '1', 'CONFIRMED DATE & TIME', 'Customer-Stated Slot', '3', '', 'medium', 'Exact time in comments.', '', '', '103'].join('\t'),
['Cara Chen', '07700900003', 'cara@example.com', 'Customer First', 'Citroen - Enquiry - New', '03/09/2026', 'Customer Comments: possibly interested in a C3', '4', 'WARM ENQUIRY', 'Valuation + VOI Stated', '9', '', 'medium', 'Genuine interest, no visit intent.', '', '', '409'].join('\t')
].join('\n');

const parsed = parseLeadCheckerImportTsv(sampleTsv);
if (!parsed.headerOk) failures.push(`Expected the real export header to parse OK, got error: ${parsed.error}`);
if (parsed.rows.length !== 3) failures.push(`Expected 3 parsed rows, got ${parsed.rows.length}`);
if (parsed.rows[1] && parsed.rows[1].tierName !== 'CONFIRMED DATE & TIME') failures.push(`Expected row 2's tierName to be read straight from the TierName column, got "${parsed.rows[1].tierName}"`);
if (parsed.rows[1] && parsed.rows[1].priorityRank !== 103) failures.push(`Expected row 2's priorityRank to be read straight from the PriorityRank column, got ${parsed.rows[1].priorityRank}`);

const ordered = classifyLeadCheckerImportRows(parsed.rows);
if (!(ordered[0] && ordered[0].name === 'Ben Brown')) failures.push(`Expected Ben Brown (rank 103) to sort first, got "${ordered[0] && ordered[0].name}"`);
if (!(ordered[1] && ordered[1].name === 'Cara Chen')) failures.push(`Expected Cara Chen (rank 409) to sort second, got "${ordered[1] && ordered[1].name}"`);
if (!(ordered[2] && ordered[2].name === 'Amy Adams')) failures.push(`Expected Amy Adams (rank 509) to sort third, got "${ordered[2] && ordered[2].name}"`);

const withReason = parseLeadCheckerImportTsv([
LEAD_CHECKER_IMPORT_HEADER.join('\t'),
['Eve Evans', '07700900005', 'eve@example.com', 'Post Closure Processing', 'Citroen - Enquiry - New', '', '-', '5', 'NURTURE', '', '', '', 'medium', '', '', 'send back through', '-2', 'Email only', 'Sent through: Email only lead'].join('\t')
].join('\n'));
if (!(withReason.rows[0] && withReason.rows[0].postClosureReason === 'Email only')) failures.push('Expected the PostClosureReason column to be read');
if (!(withReason.rows[0] && withReason.rows[0].postClosureEvidence === 'Sent through: Email only lead')) failures.push('Expected the PostClosureEvidence column to be read');
if (pickLeadCheckerBadge(withReason.rows[0]).label !== 'send back through: Email only (CAH)') failures.push('Expected the badge to show the send back reason');
if (pickLeadCheckerBadge({ source: 'Post Closure Processing', tier: 5, tierName: 'NURTURE', postClosureAction: '' }).label !== 'check: needs contact?') failures.push('Expected a Post Closure result with no action to show as a check, never a tier');
const eoAssigned = emailOnlyAssignmentsFrom([
{ ok: true, lead: { key: 'k1', name: 'Dan Davis', campaign: 'X' }, agent: { name: 'Agent A' } },
{ ok: true, lead: { key: 'k2', name: 'Gus Green', campaign: 'X' }, agent: { name: 'Agent A' } },
{ ok: false, lead: { key: 'k3', name: 'Fay Fields', campaign: 'X' }, agent: { name: 'Agent A' } },
{ ok: true, lead: { key: 'k4', name: 'Eve Evans', campaign: 'Y', email: 'eve@example.com', mobile: '' }, agent: { name: 'Agent B' } }
], new Map([['k1', { email: 'dan@example.com', phone: '' }], ['k2', { email: 'gus@example.com', phone: '07700900001' }], ['k3', { email: 'fay@example.com', phone: '' }]]));
if (JSON.stringify(eoAssigned.map((e) => e.email)) !== JSON.stringify(['dan@example.com', 'eve@example.com'])) failures.push(`Expected only assigned Email Only leads to be recorded, got ${JSON.stringify(eoAssigned)}`);
const eoUnread = emailOnlyAssignmentsFrom([{ ok: true, lead: { key: 'k5', name: 'Hal Hughes', campaign: 'X' }, agent: { name: 'Agent A' } }], new Map([['k5', { email: 'hal@example.com', phone: '', detailsRead: false }]]));
if (eoUnread.length !== 0) failures.push('Expected a lead whose details could not be read never to be recorded as Email Only');
if (!nameAppearsIn('Mr Alex Sample', 'Name ALEX  SAMPLE') || nameAppearsIn('Mr Alex Sample', 'Sam Buyer') || nameAppearsIn('', 'anything')) failures.push('Expected the pop-up name check to match on the name words, title dropped');
const first = parseLeadCheckerImportTsv(sampleTsv).rows;
const second = [
{ ...first[0], tier: 4, tierName: 'WARM ENQUIRY', priorityRank: 409 },
{ ...first[1], tier: null, tierName: '', priorityRank: 700 },
{ name: 'Dee Dixon', phone: '07700 900004', email: '', created: '04/09/2026', tier: 2, tierName: 'DATE ONLY', priorityRank: 203 },
{ ...first[2], created: '05/09/2026', tier: 5, tierName: 'NURTURE', priorityRank: 509 }
];
const mergedResults = mergeLeadCheckerResults(first, second, '2026-11-11T12:00:00.000Z');
const tierOf = (name, created) => { const r = mergedResults.find((x) => x.name === name && x.created === created); return r ? r.tierName : '(missing)'; };
if (mergedResults.length !== 5) failures.push(`Expected a second import to add to the first (5 results), got ${mergedResults.length}`);
if (tierOf('Amy Adams', '01/09/2026') !== 'WARM ENQUIRY') failures.push('Expected a newer result for the same contact to replace the older one');
if (tierOf('Ben Brown', '02/09/2026') !== 'CONFIRMED DATE & TIME') failures.push('Expected an unfinished row not to wipe a finished result');
if (tierOf('Cara Chen', '03/09/2026') !== 'WARM ENQUIRY' || tierOf('Cara Chen', '05/09/2026') !== 'NURTURE') failures.push('Expected a new contact from the same customer to be kept beside the earlier one');
if (mergedResults[0].name !== 'Ben Brown') failures.push('Expected merged results to stay in priority order');
if (leadCheckerResultKey({ email: '', phone: '+44 7700 900004', created: 'x' }) !== leadCheckerResultKey({ email: '', phone: '07700900004', created: 'x' })) failures.push('Expected phone formats to give the same result key');
const olderExport = parseLeadCheckerImportTsv(sampleTsv.split('\n').map((l) => l.split('\t').slice(0, 17).join('\t')).join('\n'));
if (!olderExport.headerOk) failures.push('Expected an export without the reason column to still be accepted');

const badHeader = parseLeadCheckerImportTsv('Name\tPhone\tEmail');
if (badHeader.headerOk) failures.push('Expected a mismatched/old-shape header to be rejected, not accepted');

const missingRank = parseLeadCheckerImportTsv([
LEAD_CHECKER_IMPORT_HEADER.join('\t'),
['Dee Dixon', '07700900004', 'dee@example.com', 'Customer First', 'Citroen - Enquiry - New', '04/09/2026', '-', '', '', '', '', '', '', '', '', '', ''].join('\t')
].join('\n'));
if (!(missingRank.rows[0] && missingRank.rows[0].priorityRank === 700)) failures.push(`Expected a blank/malformed PriorityRank to default to 700 (lowest priority), got ${missingRank.rows[0] && missingRank.rows[0].priorityRank}`);

if (failures.length > 0) {
reportSelfTestFailure('SLA Manager lead-checker-import self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager lead-checker-import self-test passed');
}
});

runSelfTest('postClosureActionColorSelfTest', function postClosureActionColorSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}
check('send back through gets the confident colour', postClosureActionColor('send back through'), '#0891b2');
check('the uncertain "check" bucket gets the warning colour', postClosureActionColor('check: needs contact?'), '#d97706');
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager postClosureActionColor self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager postClosureActionColor self-test passed');
}
});

runSelfTest('pendingLeadCheckerExportSelfTest', function pendingLeadCheckerExportSelfTest() {
const failures = [];
const originalPendingCustomers = currentPendingCustomers;
currentPendingCustomers = [
// Never actioned: must be excluded even if 'New' were selected, because the
// filter is on real action history, not the label.
{ name: 'Amy Adams', mobile: '07700900001', landline: '', email: 'amy@example.com', campaign: 'Citroen - Enquiry - New', callbackType: 'New', lastActionText: '' },
// Actioned, matching callback type: included.
{ name: 'Ben Brown', mobile: '', landline: '01234567890', email: '', campaign: 'Citroen - Enquiry - New', callbackType: 'Auto Rescheduled', lastActionText: 'Sat, 26 Sep 2026 18:05' },
// Actioned, but its callback type is not selected: excluded.
{ name: 'Cara Chen', mobile: '07700900003', landline: '', email: 'cara@example.com', campaign: 'Citroen - Enquiry - New', callbackType: 'Post Closure', lastActionText: 'Sat, 26 Sep 2026 19:05' }
];

const { tsv, count } = buildPendingLeadCheckerTsv(['Auto Rescheduled', 'Manual Rescheduled']);
const lines = tsv.split('\n');
if (count !== 1) failures.push(`Expected exactly 1 matching lead (Ben Brown), got ${count}`);
if (lines[0] !== 'Name\tPhone\tEmail\tSource\tCampaign\tCreated') failures.push(`Unexpected header shape: ${lines[0]}`);
if (lines.length !== 2) failures.push(`Expected exactly 1 data row, got ${lines.length - 1}`);
else {
const cells = lines[1].split('\t');
if (cells[0] !== 'Ben Brown') failures.push(`Expected Ben Brown, got "${cells[0]}"`);
if (cells[1] !== '01234567890') failures.push(`Expected mobile-or-landline fallback to use landline when mobile is blank, got "${cells[1]}"`);
if (cells[3] !== '') failures.push(`Expected Source to be deliberately blank (no Source data exists on this page), got "${cells[3]}"`);
if (cells[5] !== 'Sat, 26 Sep 2026 18:05') failures.push(`Expected Created to be the raw lastActionText verbatim, got "${cells[5]}"`);
}

const neverActionedResult = buildPendingLeadCheckerTsv(['New', 'Auto Rescheduled', 'Manual Rescheduled', 'Post Closure']);
if (neverActionedResult.count !== 2) failures.push(`Expected never-actioned leads to stay excluded even if their callback type were selectable, got count ${neverActionedResult.count}`);
// Post Closure rows must carry the explicit source label (see buildPendingLeadCheckerTsv).
const caraRow = neverActionedResult.tsv.split('\n').find((line) => line.startsWith('Cara Chen'));
if (!caraRow) failures.push('Expected Cara Chen (callbackType Post Closure) to appear in the export');
else if (caraRow.split('\t')[3] !== 'Post Closure Processing') failures.push(`Expected Cara Chen's Source to read "Post Closure Processing", got "${caraRow.split('\t')[3]}"`);

currentPendingCustomers = originalPendingCustomers;

if (failures.length > 0) {
reportSelfTestFailure('SLA Manager pending-lead-checker-export self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager pending-lead-checker-export self-test passed');
}
});

// ===================================================================
// A customer already classified for this exact contact drops out of the
// next export; a new contact (different created time) is still exported.
// ===================================================================
runSelfTest('leadCheckerExportDedupeSelfTest', function leadCheckerExportDedupeSelfTest() {
const failures = [];
const originalCustomers = currentCustomers;
const originalPendingCustomers = currentPendingCustomers;
const originalImportState = localStorage.getItem(LEAD_CHECKER_IMPORT_KEY);

try {
saveLeadCheckerImportState({
rawInput: '',
results: [
{ name: 'Dan Davis', email: 'dan@example.com', phone: '', created: 'Sat, 26 Sep 2026 10:00', tier: 2 },
{ name: 'Eve Evans', email: 'eve@example.com', phone: '', created: 'Sat, 26 Sep 2026 09:00', tier: 2 },
// A failed or cancelled row (blank tier) does not count as classified.
{ name: 'Gus Green', email: 'gus@example.com', phone: '', created: 'Sat, 26 Sep 2026 13:00', tier: null }
]
});

currentCustomers = [
// Already classified for this exact contact - must be excluded.
{ name: 'Dan Davis', tier: 2, source: 'Autos', campaign: 'X', phone: '', email: 'dan@example.com', createdText: 'Sat, 26 Sep 2026 10:00' },
// Same person, but this is a NEW contact (different created time than
// the stored result) - a real auto re-contact, must still be included.
{ name: 'Eve Evans', tier: 2, source: 'Autos', campaign: 'X', phone: '', email: 'eve@example.com', createdText: 'Sat, 26 Sep 2026 11:00' },
// Never classified before - included.
{ name: 'Fay Fields', tier: 2, source: 'Autos', campaign: 'X', phone: '', email: 'fay@example.com', createdText: 'Sat, 26 Sep 2026 12:00' },
{ name: 'Gus Green', tier: 2, source: 'Autos', campaign: 'X', phone: '', email: 'gus@example.com', createdText: 'Sat, 26 Sep 2026 13:00' }
];
const slaResult = buildLeadCheckerTsv([2], false);
if (slaResult.count !== 3) failures.push(`SLA export: expected 3 included (Eve, Fay, Gus with a failed earlier check), got ${slaResult.count}`);
if (!slaResult.tsv.includes('Gus Green')) failures.push('SLA export: Gus Green (earlier check failed, blank tier) should be sent again');
if (slaResult.excludedCount !== 1) failures.push(`SLA export: expected 1 excluded (Dan), got ${slaResult.excludedCount}`);
if (slaResult.tsv.includes('Dan Davis')) failures.push('SLA export: Dan Davis (already classified for this exact contact) should not appear in the TSV');
if (!slaResult.tsv.includes('Eve Evans')) failures.push('SLA export: Eve Evans (new contact, different created time) should still appear');

currentPendingCustomers = [
{ name: 'Dan Davis', mobile: '', landline: '', email: 'dan@example.com', campaign: 'X', callbackType: 'Auto Rescheduled', lastActionText: 'Sat, 26 Sep 2026 10:00' },
{ name: 'Fay Fields', mobile: '', landline: '', email: 'fay@example.com', campaign: 'X', callbackType: 'Auto Rescheduled', lastActionText: 'Sat, 26 Sep 2026 12:00' }
];
const pendingResult = buildPendingLeadCheckerTsv(['Auto Rescheduled']);
if (pendingResult.count !== 1) failures.push(`Pending export: expected 1 included (Fay), got ${pendingResult.count}`);
if (pendingResult.excludedCount !== 1) failures.push(`Pending export: expected 1 excluded (Dan), got ${pendingResult.excludedCount}`);
} finally {
currentCustomers = originalCustomers;
currentPendingCustomers = originalPendingCustomers;
if (originalImportState === null) localStorage.removeItem(LEAD_CHECKER_IMPORT_KEY);
else localStorage.setItem(LEAD_CHECKER_IMPORT_KEY, originalImportState);
}

if (failures.length > 0) {
reportSelfTestFailure('SLA Manager lead-checker-export-dedupe self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager lead-checker-export-dedupe self-test passed');
}
});

// Same tier colours as Konnect-Lead-Checker.js, so a lead looks the same in
// either tool.
const LEAD_CHECKER_TIER_COLORS = { 1: '#059669', 2: '#2563eb', 3: '#7c3aed', 4: '#9333ea', 5: '#64748b', 6: '#94a3b8' };

function leadCheckerImportCategoryColor(tier) {
return LEAD_CHECKER_TIER_COLORS[tier] || '#1e293b';
}

// Matches Konnect-Lead-Checker.js's postClosureBadge colouring.
function postClosureActionColor(action) {
return action === 'send back through' ? '#0891b2' : '#d97706';
}

// Same normalisation as Konnect-Lead-Checker.js, so formatting differences
// (spacing, +44 or leading 0) still match.
function normalizeEmailForLeadCheckerMatch(value) {
return String(value || '').trim().toLowerCase();
}

function normalizePhoneForLeadCheckerMatch(value) {
const digits = String(value || '').replace(/\D+/g, '');
if (digits.startsWith('44')) return '0' + digits.slice(2);
return digits;
}

// Matched by email (preferred) or phone, since the export has no Registration
// or key, and then only when Created is the card's own time. Pending rows
// have mobile and landline instead of phone. The card loops use the indexed
// version below; this one checks a single lead before an export.
function findLeadCheckerResultForCustomer(c, results) {
if (!results || results.length === 0) return null;
const emailKey = normalizeEmailForLeadCheckerMatch(c.email);
const phoneKey = normalizePhoneForLeadCheckerMatch(c.phone || c.mobile || c.landline);
const candidates = results.filter((r) => {
const rEmailKey = normalizeEmailForLeadCheckerMatch(r.email);
if (emailKey && rEmailKey) return emailKey === rEmailKey;
const rPhoneKey = normalizePhoneForLeadCheckerMatch(r.phone);
if (phoneKey && rPhoneKey) return phoneKey === rPhoneKey;
return false;
});
return pickLeadCheckerResultForCard(c, candidates);
}

// A result belongs to a card only when its Created matches the card's own
// time (Created on SLA rows, Last Actioned on Pending rows). A result for
// an older lead from the same customer is never shown on the new one.
function leadCheckerCardTimeKey(c) {
return (c && (c.createdText || c.lastActionText)) || '';
}
function pickLeadCheckerResultForCard(c, candidates) {
const key = leadCheckerCardTimeKey(c);
if (!key) return null;
return candidates.find((r) => r.created === key) || null;
}

// Index for the per-card render loops. The matching rule is asymmetric: when
// both sides have an email, only email can match. Phone is used only when
// the customer or that result has no email. byPhone indexes every phone and
// the email branch filters out phone candidates that have an email.
// leadCheckerResultIndexEquivalenceSelfTest checks it agrees with the linear
// version.
function buildLeadCheckerResultIndex(results) {
const byEmail = new Map();
const byPhone = new Map();
(results || []).forEach((r) => {
const e = normalizeEmailForLeadCheckerMatch(r.email);
const p = normalizePhoneForLeadCheckerMatch(r.phone);
if (e) {
if (!byEmail.has(e)) byEmail.set(e, []);
byEmail.get(e).push(r);
}
if (p) {
if (!byPhone.has(p)) byPhone.set(p, []);
byPhone.get(p).push(r);
}
});
return { byEmail, byPhone };
}

// Shared with the Send view's match count, which needs every candidate, so the
// asymmetric rule is not written a third time.
function leadCheckerResultCandidatesIndexed(c, index) {
const emailKey = normalizeEmailForLeadCheckerMatch(c.email);
const phoneKey = normalizePhoneForLeadCheckerMatch(c.phone || c.mobile || c.landline);
if (emailKey) {
const emailMatches = index.byEmail.get(emailKey) || [];
const phoneMatches = phoneKey
? (index.byPhone.get(phoneKey) || []).filter((r) => !normalizeEmailForLeadCheckerMatch(r.email))
: [];
return emailMatches.concat(phoneMatches);
}
return phoneKey ? (index.byPhone.get(phoneKey) || []) : [];
}

function findLeadCheckerResultForCustomerIndexed(c, index) {
const candidates = leadCheckerResultCandidatesIndexed(c, index);
return pickLeadCheckerResultForCard(c, candidates);
}

// The indexed lookup must return exactly what the linear scan does, and
// both must pick the result named here.
runSelfTest('leadCheckerResultIndexEquivalenceSelfTest', function leadCheckerResultIndexEquivalenceSelfTest() {
const failures = [];
const results = [
{ name: 'Email Match', email: 'alice@example.com', phone: '', created: 'A' },
{ name: 'Phone Only', email: '', phone: '07700 900001', created: 'B' },
{ name: 'Email And Phone', email: 'carol@example.com', phone: '07700900002', created: 'C' },
{ name: 'Dup Email 1', email: 'dup@example.com', phone: '', created: 'D1' },
{ name: 'Dup Email 2', email: 'dup@example.com', phone: '', created: 'D2' }
];
const index = buildLeadCheckerResultIndex(results);
const cases = [
{ label: 'email match, case ignored', c: { email: 'Alice@Example.com', phone: '', createdText: 'A' }, expect: 'Email Match' },
{ label: 'phone match when neither side has an email, +44 form', c: { email: '', phone: '+447700900001', createdText: 'B' }, expect: 'Phone Only' },
{ label: 'a Pending row matches on its mobile and Last Actioned time', c: { email: '', mobile: '07700900001', lastActionText: 'B' }, expect: 'Phone Only' },
{ label: 'customer with no email still matches a result that has one, by phone', c: { email: '', phone: '07700900002', createdText: 'C' }, expect: 'Email And Phone' },
{ label: 'different emails never match on phone', c: { email: 'notcarol@example.com', phone: '07700900002', createdText: 'C' }, expect: null },
{ label: 'two results for one customer: the card\'s own Created picks', c: { email: 'dup@example.com', phone: '', createdText: 'D2' }, expect: 'Dup Email 2' },
{ label: 'a result for an older lead is not shown on a new one', c: { email: 'dup@example.com', phone: '', createdText: 'D3' }, expect: null },
{ label: 'a card with no time shows nothing', c: { email: 'alice@example.com', phone: '' }, expect: null },
{ label: 'no match', c: { email: 'nobody@example.com', phone: '07700900009', createdText: 'A' }, expect: null },
{ label: 'customer with neither email nor phone', c: { email: '', phone: '', createdText: 'A' }, expect: null }
];
cases.forEach(({ c, label, expect }) => {
const linear = findLeadCheckerResultForCustomer(c, results);
const indexed = findLeadCheckerResultForCustomerIndexed(c, index);
if (indexed !== linear) failures.push(`${label}: the indexed and linear lookups disagree`);
if ((linear ? linear.name : null) !== expect) failures.push(`${label}: expected ${JSON.stringify(expect)}, got ${JSON.stringify(linear ? linear.name : null)}`);
});
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager leadCheckerResultIndexEquivalence self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager leadCheckerResultIndexEquivalence self-test passed');
}
});

// Repeat contacts (autos often reach the same person several times) should
// not be re-sent to the Lead Checker. A result only counts for the contact
// with the same Created time; a different time is a new contact.
function isAlreadyClassifiedForContact(c, importResults) {
if (!importResults || importResults.length === 0) return false;
// Only a row that was actually classified counts. A failed or cancelled
// row (blank Tier) must be sent to the Lead Checker again.
const match = findLeadCheckerResultForCustomer(c, importResults);
return !!match && match.tier != null && match.created === c.createdText;
}

window._updateLeadCheckerImportInput = function(value) {
const state = loadLeadCheckerImportState();
saveLeadCheckerImportState({ rawInput: value, results: state.results });
};

// Shared by the box's Add results button and the one-click paste button.
// originalLabel restores each button's own idle state.
function runLeadCheckerClassification(rawInput, buttonEl, originalLabel) {
const parsed = parseLeadCheckerImportTsv(rawInput);
if (!parsed.headerOk) {
buttonEl.textContent = 'Not Lead Checker results';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 2200);
return false;
}
if (parsed.rows.length === 0) {
buttonEl.textContent = 'No rows';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 1200);
return false;
}
// The pasted text is cleared once read: the results are on the cards, and
// old text in the box reads as unhandled.
addLeadCheckerResults(parsed.rows);
// A full panel redraw for the current page. buttonEl is replaced with it;
// the redraw keeps the Send view open if it was.
redrawLeadsPanel();
return true;
}

window._classifyLeadCheckerImport = function(buttonEl) {
const box = document.getElementById('leadCheckerImportBox');
const rawInput = box ? box.value : '';
runLeadCheckerClassification(rawInput, buttonEl, buttonEl.textContent);
};

// Reads the clipboard directly. That API needs permission and can be blocked,
// so it falls back to asking for a manual paste.
window._pasteAndClassifyLeadChecker = async function(buttonEl) {
const originalLabel = buttonEl.innerHTML;
if (!navigator.clipboard || !navigator.clipboard.readText) {
buttonEl.textContent = 'Paste by hand in the Lead Checker box';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 1800);
return;
}
buttonEl.textContent = 'Reading…';
try {
const rawInput = await navigator.clipboard.readText();
const box = document.getElementById('leadCheckerImportBox');
if (box) box.value = rawInput;
saveLeadCheckerImportState({ rawInput, results: loadLeadCheckerImportState().results });
const ok = runLeadCheckerClassification(rawInput, buttonEl, originalLabel);
if (ok) return; // displayPanel already rebuilt this button with a fresh label
} catch (error) {
buttonEl.textContent = 'Clipboard blocked: paste by hand';
setTimeout(() => { buttonEl.innerHTML = originalLabel; }, 2000);
}
};

// Section collapse state is persisted so it survives every rebuild.
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

// Off by default. It only reorders cards within their existing sections.
const LEAD_CHECKER_PRIORITY_SORT_KEY = '_slaLeadCheckerPrioritySort';

function isLeadCheckerPrioritySortEnabled() {
return localStorage.getItem(LEAD_CHECKER_PRIORITY_SORT_KEY) === '1';
}

// Ascending by imported tier. Customers with no result sort after every tier
// in a stable sort, keeping each section's existing order.
function leadCheckerPriorityRank(customer, leadCheckerResultIndex) {
const result = findLeadCheckerResultForCustomerIndexed(customer, leadCheckerResultIndex);
if (!result) return 7;
if (result.postClosureAction === 'send back through') return -2;
if (result.postClosureAction) return -1;
if (!result.tier) return 7;
return result.tier;
}

// Bucket 0 is due before the next clock hour, including overdue, matching
// "This hour" everywhere else. No due date sorts last.
function hourBucketIndex(dueMs) {
if (!Number.isFinite(dueMs)) return Infinity;
const thisHourCutoff = defaultHourCutoff().getTime();
if (dueMs < thisHourCutoff) return 0;
return 1 + Math.floor((dueMs - thisHourCutoff) / (60 * 60000));
}

// SLA: category first (Send back, Check, the Lead Checker tiers, then
// unchecked), most urgent first within each, so Date Only sits above Warm
// and Nurture. Pending (options.byHour): the due hour comes first and the
// category orders leads within it.
function sortByLeadCheckerPriority(customers, leadCheckerResults, getDueDate, options) {
const byHour = !!(options && options.byHour);
const leadCheckerResultIndex = buildLeadCheckerResultIndex(leadCheckerResults);
const dueMs = (c) => {
const due = getDueDate ? getDueDate(c) : null;
return due && typeof due.getTime === 'function' ? due.getTime() : Infinity;
};
return customers
.map((c, index) => {
const due = dueMs(c);
return { c, index, due, hour: byHour ? hourBucketIndex(due) : 0, rank: leadCheckerPriorityRank(c, leadCheckerResultIndex) };
})
.sort((a, b) => (a.hour === b.hour ? 0 : a.hour < b.hour ? -1 : 1) || a.rank - b.rank || (a.due === b.due ? 0 : a.due < b.due ? -1 : 1) || a.index - b.index)
.map((entry) => entry.c);
}

runSelfTest('sortByLeadCheckerPrioritySelfTest', function sortByLeadCheckerPrioritySelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}

const customers = [
{ name: 'Alice (no result)', email: 'alice@example.com', phone: '', createdText: 'T' },
{ name: 'Bob (tier 4)', email: 'bob@example.com', phone: '', createdText: 'T' },
{ name: 'Carol (no result)', email: 'carol@example.com', phone: '', createdText: 'T' },
{ name: 'Dee (tier 1)', email: 'dee@example.com', phone: '', createdText: 'T' },
{ name: 'Eve (tier 5)', email: 'eve@example.com', phone: '', createdText: 'T' },
{ name: 'Fay (tier 3)', email: 'fay@example.com', phone: '', createdText: 'T' }
];
const leadCheckerResults = [
{ email: 'bob@example.com', phone: '', created: 'T', tier: 4, tierName: 'WARM ENQUIRY' },
{ email: 'dee@example.com', phone: '', created: 'T', tier: 1, tierName: 'CONFIRMED DATE & TIME' },
{ email: 'eve@example.com', phone: '', created: 'T', tier: 5, tierName: 'NURTURE' },
{ email: 'fay@example.com', phone: '', created: 'T', tier: 3, tierName: 'LIKELY BOOKING' }
];

const sorted = sortByLeadCheckerPriority(customers, leadCheckerResults).map((c) => c.name);
check('Tier 1 comes first', sorted[0], 'Dee (tier 1)');
check('Tier 3 comes second - generalises to every tier, not just two hardcoded ones', sorted[1], 'Fay (tier 3)');
check('Tier 4 comes third', sorted[2], 'Bob (tier 4)');
check('Tier 5 comes fourth', sorted[3], 'Eve (tier 5)');
check('No-result customers sort after every real tier, keeping their original relative order', sorted.slice(4).join(', '), 'Alice (no result), Carol (no result)');

const untouched = sortByLeadCheckerPriority(customers, []);
check('With no Lead Checker results at all, original order is preserved entirely', untouched.map((c) => c.name).join(', '), customers.map((c) => c.name).join(', '));

// Checks the default with the setting cleared, then restores the user's own
// choice, so the test does not fail for anyone who switched it on.
let savedPrioritySort = null;
try { savedPrioritySort = localStorage.getItem(LEAD_CHECKER_PRIORITY_SORT_KEY); } catch (error) { /* ignore */ }
try {
try { localStorage.removeItem(LEAD_CHECKER_PRIORITY_SORT_KEY); } catch (error) { /* ignore */ }
check('Disabled by default (LEAD_CHECKER_PRIORITY_SORT_KEY unset)', isLeadCheckerPrioritySortEnabled(), false);
} finally {
if (savedPrioritySort !== null) {
try { localStorage.setItem(LEAD_CHECKER_PRIORITY_SORT_KEY, savedPrioritySort); } catch (error) { /* ignore */ }
}
}

if (failures.length > 0) {
reportSelfTestFailure('SLA Manager sortByLeadCheckerPriority self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager sortByLeadCheckerPriority self-test passed');
}
});

// ===================================================================
// Within Post Closure, Send back through sorts ahead of Check: needs
// contact, and both ahead of unclassified leads, whatever their tier.
// ===================================================================
runSelfTest('leadCheckerPriorityRankPostClosureSelfTest', function leadCheckerPriorityRankPostClosureSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const customers = [
{ name: 'Not Yet Classified', email: 'nyc@example.com', phone: '', createdText: '' },
{ name: 'Check Needed', email: 'check@example.com', phone: '', createdText: 'Sat, 26 Sep 2026 11:00' },
{ name: 'Send Back', email: 'sendback@example.com', phone: '', createdText: 'Sat, 26 Sep 2026 10:00' }
];
const leadCheckerResults = [
{ email: 'check@example.com', phone: '', created: 'Sat, 26 Sep 2026 11:00', tier: 4, postClosureAction: 'check: needs contact?' },
{ email: 'sendback@example.com', phone: '', created: 'Sat, 26 Sep 2026 10:00', tier: 6, postClosureAction: 'send back through' }
];
const sorted = sortByLeadCheckerPriority(customers, leadCheckerResults).map((c) => c.name);
check('Send back through comes first, even though its underlying tier (6) is the least urgent one', sorted[0], 'Send Back');
check('Check: needs contact comes second', sorted[1], 'Check Needed');
check('Not yet classified comes last', sorted[2], 'Not Yet Classified');

if (failures.length > 0) {
reportSelfTestFailure('SLA Manager leadCheckerPriorityRank-postClosure self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager leadCheckerPriorityRank-postClosure self-test passed');
}
});

// ===================================================================
// A Post Closure lead stays in its normal section, but its badge shows
// only the Post Closure decision in place of the tier badge.
// ===================================================================
runSelfTest('postClosureBadgeReplacementSelfTest', function postClosureBadgeReplacementSelfTest() {
const failures = [];
const originalImportState = localStorage.getItem(LEAD_CHECKER_IMPORT_KEY);
try {
saveLeadCheckerImportState({
rawInput: '',
results: [{ name: 'Sendback Sam', email: 'sam@example.com', phone: '', created: 'Sat, 26 Sep 2026 10:00', tier: 4, tierName: 'WARM ENQUIRY', postClosureAction: 'send back through' }]
});

const html = renderTierSection({ ...SLA_TIERS[0], id: 'tier1-badge-test' }, [
{ name: 'Sendback Sam', email: 'sam@example.com', phone: '', createdText: 'Sat, 26 Sep 2026 10:00', tier: 1, key: 'k1' }
]);

if (!html.includes('send back through')) failures.push('Expected the Post Closure badge text to appear on the card');
if (/warm enquiry/i.test(html)) failures.push('Expected the underlying tier badge (WARM ENQUIRY) to be replaced, not shown alongside the Post Closure badge');
} finally {
if (originalImportState === null) localStorage.removeItem(LEAD_CHECKER_IMPORT_KEY);
else localStorage.setItem(LEAD_CHECKER_IMPORT_KEY, originalImportState);
}

if (failures.length > 0) {
reportSelfTestFailure('SLA Manager postClosureBadgeReplacement self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager postClosureBadgeReplacement self-test passed');
}
});

runSelfTest('sortByLeadCheckerPriorityCategorySelfTest', function sortByLeadCheckerPriorityCategorySelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}
const now = Date.now();
const at = (mins) => new Date(now + mins * 60000);
const customers = [
{ name: 'Amy (nurture, missed)', email: 'amy@example.com', phone: '', createdText: 'T', slaDate: at(-20) },
{ name: 'Ben (date only, due in 90m)', email: 'ben@example.com', phone: '', createdText: 'T', slaDate: at(90) },
{ name: 'Cat (warm, due in 5m)', email: 'cat@example.com', phone: '', createdText: 'T', slaDate: at(5) },
{ name: 'Dee (date only, due in 10m)', email: 'dee@example.com', phone: '', createdText: 'T', slaDate: at(10) },
{ name: 'Eve (no result, missed)', email: 'eve@example.com', phone: '', createdText: 'T', slaDate: at(-30) },
{ name: 'Fay (warm, missed)', email: 'fay@example.com', phone: '', createdText: 'T', slaDate: at(-1) }
];
const results = [
{ email: 'amy@example.com', phone: '', created: 'T', tier: 5, tierName: 'NURTURE' },
{ email: 'ben@example.com', phone: '', created: 'T', tier: 2, tierName: 'DATE ONLY' },
{ email: 'cat@example.com', phone: '', created: 'T', tier: 4, tierName: 'WARM ENQUIRY' },
{ email: 'dee@example.com', phone: '', created: 'T', tier: 2, tierName: 'DATE ONLY' },
{ email: 'fay@example.com', phone: '', created: 'T', tier: 4, tierName: 'WARM ENQUIRY' }
];
const sorted = sortByLeadCheckerPriority(customers, results, (c) => c.slaDate).map((c) => c.name);
check('Date Only comes first even when due later than others', sorted[0], 'Dee (date only, due in 10m)');
check('each category stays together, most urgent first', sorted.join(' | '), 'Dee (date only, due in 10m) | Ben (date only, due in 90m) | Fay (warm, missed) | Cat (warm, due in 5m) | Amy (nurture, missed) | Eve (no result, missed)');
const cutoff = defaultHourCutoff().getTime();
const pending = [
{ name: 'Gus (date only, next hour)', email: 'gus@example.com', phone: '', createdText: 'T', due: new Date(cutoff + 10 * 60000) },
{ name: 'Hal (nurture, this hour)', email: 'hal@example.com', phone: '', createdText: 'T', due: new Date(cutoff - 5 * 60000) },
{ name: 'Ivy (date only, this hour)', email: 'ivy@example.com', phone: '', createdText: 'T', due: new Date(cutoff - 2 * 60000) }
];
const pendingResults = [
{ email: 'gus@example.com', phone: '', created: 'T', tier: 2, tierName: 'DATE ONLY' },
{ email: 'hal@example.com', phone: '', created: 'T', tier: 5, tierName: 'NURTURE' },
{ email: 'ivy@example.com', phone: '', created: 'T', tier: 2, tierName: 'DATE ONLY' }
];
check('Pending keeps the due hour first, category within it', sortByLeadCheckerPriority(pending, pendingResults, (c) => c.due, { byHour: true }).map((c) => c.name).join(' | '), 'Ivy (date only, this hour) | Hal (nurture, this hour) | Gus (date only, next hour)');
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager sortByLeadCheckerPriority-category self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager sortByLeadCheckerPriority-category self-test passed');
}
});

function setSectionCollapsed(sectionId, collapsed) {
const set = loadCollapsedSections();
if (collapsed) set.add(sectionId); else set.delete(sectionId);
try {
localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(set)));
} catch (error) {
// ignore
}
}

// Reads the mounted assign section's DOM and saves it; called from change
// handlers and wheel settle callbacks.
function persistCurrentAssignSettings() {
const excludedTiers = Array.from(document.querySelectorAll('.assign-tier-checkbox:not(:checked)')).map(el => Number(el.value));
const excludedAgentIds = Array.from(document.querySelectorAll('.assign-agent-checkbox:not(:checked)')).map(el => el.value);
const customerFirstOnly = document.getElementById('assignCustomerFirstOnly')?.checked || false;
const emailOnly = document.getElementById('assignEmailOnly')?.checked || false;
const windowMinutes = document.getElementById('assignWindowMinutes')?.value ?? null;
const cutoffTime = document.getElementById('assignCutoffTime')?.value ?? null;
const advancedOpen = document.getElementById('advancedCallbackTypes')?.style.display === 'flex';
const assignLimit = document.getElementById('assignLimitInput')?.value || null;
const assignLimitPerAgent = document.getElementById('assignLimitPerAgent')?.checked || false;

// Primary callback types default on (opt-out), Advanced ones default off
// (opt-in), so they need separate excluded and included sets.
const allCallbackCheckboxes = Array.from(document.querySelectorAll('.assign-callback-checkbox'));
const excludedCallbackTypes = allCallbackCheckboxes
.filter(el => !el.checked && !el.closest('#advancedCallbackTypes'))
.map(el => el.value);
const includedAdvancedCallbackTypes = allCallbackCheckboxes
.filter(el => el.checked && el.closest('#advancedCallbackTypes'))
.map(el => el.value);

const emailOnlyAgent = document.getElementById('_slaEoAgent');
saveAssignSettings({
excludedTiers, excludedCallbackTypes, includedAdvancedCallbackTypes, excludedAgentIds,
customerFirstOnly, emailOnly, windowMinutes, cutoffTime, advancedOpen, assignLimit, assignLimitPerAgent,
...(emailOnlyAgent ? { emailOnlyAgentId: emailOnlyAgent.value } : {})
});
}

// Keeps the first N of an already most-urgent-first list, so a cap takes the
// N most urgent leads.
function applyAssignLimit(prioritized, agents) {
const settings = loadAssignSettings();
const raw = settings.assignLimit;
const limit = raw ? Number(raw) : null;
if (!limit || limit <= 0) return prioritized;
const effectiveLimit = settings.assignLimitPerAgent ? limit * agents.length : limit;
return prioritized.slice(0, effectiveLimit);
}

// Shared by both assign sections, which only differ in the filters zone, the
// run handler and the Email only bar (SLA page only).
function renderAssignSectionShell(settings, agents, runHandlerName, filtersZoneHtml, emailOnlyBarHtml, rescueBarHtml) {
if (isZenModeOn()) return '';
const filtersOpen = !!settings.filtersOpen;
const excludedAgentIds = new Set(settings.excludedAgentIds || []);
const buttonDisabled = agents.length === 0;
const emailOnlyOn = !!emailOnlyBarHtml && !!settings.emailOnly;
return `
<div id="assignSectionContainer" class="sla-card">
<div class="sla-tabs" role="tablist">
<button type="button" role="tab" id="assignTabPill" aria-selected="${filtersOpen ? 'false' : 'true'}" onclick="window._toggleAssignSection()">Assign</button>
<button type="button" role="tab" id="filtersTabPill" aria-selected="${filtersOpen ? 'true' : 'false'}" onclick="window._toggleFiltersZone()">Filters</button>
</div>
<div id="assignSectionBody" class="sla-col" style="display: ${filtersOpen ? 'none' : 'flex'};">
<div id="_slaAssignNormal" class="sla-col" ${emailOnlyOn ? 'hidden' : ''}>
${renderAgentsRow(agents.length, !!settings.agentsOpen)}
<div id="assignAgentPane" class="sla-col" ${settings.agentsOpen ? '' : 'hidden'}>
<div id="assignAgentList" class="sla-agents">${renderAgentCheckboxes(agents, excludedAgentIds)}</div>
${renderAssignLimitControl(settings)}
</div>
</div>
${emailOnlyBarHtml || ''}
<div id="assignHistoryPanel" style="display: none;"></div>
<div class="sla-bar sla-runbar">
<span id="assignMatchPreview" class="sla-small sla-grow"></span>
<button type="button" id="assignRunButton" class="sla-pri" onclick="window.${runHandlerName}()" ${buttonDisabled ? 'disabled' : ''}>${buttonDisabled ? (canCheckAgentRoster() ? 'No agents online' : "Can't check agents right now") : 'Assign'}</button>
</div>
<div id="_slaFairLine" class="sla-small" role="status" hidden></div>
${rescueBarHtml || ''}
<div id="assignResultsSummary"></div>
<div id="assignResultsLog"></div>
</div>
<div id="filtersZoneBody" class="sla-col" style="display: ${filtersOpen ? 'flex' : 'none'};">
${filtersZoneHtml}
<span class="sla-small">Only leads not yet assigned are ever assigned.</span>
</div>
</div>`;
}

// Pure. The folded tiers row says which tiers a run takes.
function tierFilterLabel(selectedTiers) {
const picked = [1, 2, 3, 4].filter((t) => selectedTiers.has(t));
if (picked.length === 4) return 'Tiers: all four';
if (picked.length === 0) return 'Tiers: none';
return `Tiers: ${picked.join(', ')}`;
}

// The agent Email only leads last went to, if still online: the stored choice
// first, then whoever the last recorded Email only lead was assigned to.
function lastEmailOnlyAgentId(agents, settings) {
if (settings.emailOnlyAgentId && agents.some((a) => a.id === settings.emailOnlyAgentId)) return settings.emailOnlyAgentId;
const stored = readStoredJson(EMAIL_ONLY_ASSIGNED_KEY);
const leads = stored && Array.isArray(stored.leads) ? stored.leads : [];
const lastName = leads.length ? normalizeAgentName(leads[leads.length - 1].agent || '') : '';
const match = lastName ? agents.find((a) => normalizeAgentName(a.name) === lastName) : null;
return match ? match.id : '';
}

// Replaces the agents row while Email only is on (the chip beside Customer
// First, or the tick box in Filters). The run itself is the normal one with
// the Email only filter; the agent here is who it goes to.
function renderEmailOnlyBar(agents, settings) {
const lastId = lastEmailOnlyAgentId(agents, settings);
const options = agents.map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === lastId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
return `<div id="_slaEoBar" class="sla-col sla-eo" ${settings.emailOnly ? '' : 'hidden'}>
<div class="sla-bar">
<span class="sla-chip eo">${svgIcon('mail', 12)}Email only</span>
<b class="sla-grow" id="_slaEoCount"></b>
<button type="button" class="sla-sec" style="padding: 5px 7px;" onclick="window._setEmailOnlyMode(false)" title="Back to normal assigning" aria-label="Back to normal assigning">${svgIcon('x', 13)}</button>
</div>
<div class="sla-bar">
<span class="sla-small">to</span>
<select id="_slaEoAgent" data-last="${escapeHtml(lastId)}" aria-label="Agent for Email only leads" onchange="window._updateAssignPreview()">
<option value="">the ticked agents</option>${options}
</select>
<span class="sla-small" id="_slaEoAgentNote"></span>
</div>
</div>`;
}

function renderAssignSection() {
const leads = getCachedAssignableLeads();
const agents = getAgentRoster();

const settings = loadAssignSettings();
const excludedTiers = new Set(settings.excludedTiers || []);
const initialWindowMinutes = settings.windowMinutes ? Number(settings.windowMinutes) : null;
const tierCounts = computeSlaTierCounts(leads, initialWindowMinutes);
const customerFirstCount = leads.filter(l => l.isCustomerFirst && !l.assigned).length;
const emailOnlyCount = leads.filter(l => l.isEmailOnly && !l.assigned).length;

const tierCheckboxes = SLA_TIERS.map(({ tier, name, holds }) => `
<label>
<input type="checkbox" class="assign-tier-checkbox" value="${tier}" ${excludedTiers.has(tier) ? '' : 'checked'} onchange="window._updateAssignPreview()">
<span>${escapeHtml(name)} <span id="tier-count-${tier}">(${tierCounts[tier - 1]})</span><small>${escapeHtml(holds)}</small></span>
</label>`).join('');
const windowOptions = SLA_WINDOW_PRESETS.map((v) => {
const value = v === 'All' ? '' : v;
return `<option value="${value}" ${String(settings.windowMinutes || '') === value ? 'selected' : ''}>${v}</option>`;
}).join('');

// In the order they are used: due within, the two special filters, then the
// tiers folded away last.
const filtersZoneHtml = `
<label class="sla-ckl">Due within
<select id="assignWindowMinutes" aria-label="Due within, minutes" onchange="window._updateAssignPreview()">${windowOptions}</select>
minutes</label>
<label class="sla-ckl">
<input type="checkbox" id="assignCustomerFirstOnly" ${settings.customerFirstOnly ? 'checked' : ''} onchange="window._updateAssignPreview()">
Customer First only (${customerFirstCount})
</label>
<label class="sla-ckl">
<input type="checkbox" id="assignEmailOnly" ${settings.emailOnly ? 'checked' : ''} onchange="window._updateAssignPreview()">
Email only (${emailOnlyCount})
</label>
<button type="button" class="sla-sec" style="align-self: flex-start;" aria-expanded="false" aria-controls="_slaTierList" onclick="window._slaFold(this)" title="Choose which tiers are assigned"><span id="_slaTierLabel">${tierFilterLabel(new Set([1, 2, 3, 4].filter((t) => !excludedTiers.has(t))))}</span>${svgIcon('chevron', 12, '', 'sla-chev')}</button>
<div id="_slaTierList" class="sla-tierl" hidden>${tierCheckboxes}</div>`;

return renderAssignSectionShell(settings, agents, '_runSlaAssignment', filtersZoneHtml, renderEmailOnlyBar(agents, settings), renderRescueBar());
}

// ===================================================================
// PENDING CUSTOMERS TAB
// ===================================================================

const CALLBACK_TYPES_PRIMARY = ['New', 'Auto Rescheduled'];
const CALLBACK_TYPES_ADVANCED = ['Manual Rescheduled', 'Post Closure'];
const CALLBACK_TYPE_ORDER = [...CALLBACK_TYPES_PRIMARY, ...CALLBACK_TYPES_ADVANCED];
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
const lastActionText = cells[PC_COL_LAST_ACTION]?.textContent?.trim() || '';
const lastActionDate = parseKonnectDate(lastActionText);
const nextActionDate = parseKonnectDate(nextActionText);
const assignState = getAssignCellState(cells[PC_COL_ASSIGN]);

leads.push({
key: `${name}||${reg}||${campaign}||${callbackType}||${nextActionText}`,
name, dealer, brand, reg, email, mobile, landline, campaign,
callbackType, lastActionText, lastActionDate, nextActionDate,
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

// A lead with no parseable Next Action Date is excluded, so a wrong date
// format fails loudly instead of assigning on unknown urgency.
function filterPendingLeads(leads, { callbackTypes, cutoffDate }) {
return leads.filter((lead) => {
if (lead.assigned) return false;
if (!callbackTypes.has(lead.callbackType)) return false;
if (!lead.nextActionDate) return false;
if (cutoffDate && lead.nextActionDate.getTime() >= cutoffDate.getTime()) return false;
return true;
});
}

// Means up to the top of the next clock hour (at 12:47, 13:00), not a rolling
// 60 minutes.
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

// Re-located at click time, as on the SLA tab.
function findPendingAssignCells(lead) {
const found = [];
const table = document.querySelector('table');
if (!table) return found;
const rows = table.querySelectorAll('tbody tr');
for (const row of rows) {
const cells = row.querySelectorAll('td');
if (cells.length < 12) continue;
const key = `${cells[PC_COL_CUSTOMER]?.textContent?.trim()}||${cells[PC_COL_REG]?.textContent?.trim()}||${cells[PC_COL_CAMPAIGN]?.textContent?.trim()}||${cells[PC_COL_CALLBACK_TYPE]?.textContent?.trim()}||${cells[PC_COL_NEXT_ACTION]?.textContent?.trim() || ''}`;
if (key === lead.key) found.push(cells[PC_COL_ASSIGN]);
}
return found;
}
function locatePendingAssignCell(lead) {
return findPendingAssignCells(lead)[0] || null;
}
locatePendingAssignCell.findAll = findPendingAssignCells;

function slugify(value) {
return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Same unassigned-only readout as the SLA tab, bucketed by hour to match this
// page's workflow. "Next hour" is cumulative.
function renderPendingDueSummary() {
const leads = getCachedPendingCustomers();
const thisHourCutoff = defaultHourCutoff();
const nextHourCutoff = new Date(thisHourCutoff.getTime() + 60 * 60000);

const dueThisHour = leads.filter(l => !l.assigned && l.nextActionDate && l.nextActionDate.getTime() < thisHourCutoff.getTime()).length;
const dueNextHour = leads.filter(l => !l.assigned && l.nextActionDate && l.nextActionDate.getTime() < nextHourCutoff.getTime()).length;
const notAssignedCount = leads.filter(l => !l.assigned).length;

if (isZenModeOn()) {
return renderListOnlySummary('pendingDueSummary', [
[`${dueThisHour} due this hour`, dueThisHour > 0 ? 'bad' : ''],
[`${dueNextHour} due next hour`, ''],
[`${notAssignedCount} not assigned`, '']
]);
}

const callbackChips = CALLBACK_TYPES_PRIMARY.map(type =>
`<span class="sla-chip">${escapeHtml(type)} ${leads.filter(l => !l.assigned && l.callbackType === type).length}</span>`
).join('');

const tiles = [
renderStatTile('This hour', dueThisHour, dueThisHour > 0 ? 'bad' : '', `window._quickAssignPendingTile(0)`),
renderStatTile('Next hour', dueNextHour, '', `window._quickAssignPendingTile(1)`)
].join('');

return `
<div id="pendingDueSummary" class="sla-col" style="gap: 10px;">
<div class="sla-tiles two">${tiles}</div>
<div class="sla-cf"><span class="sla-lbl">Not assigned</span>${callbackChips}</div>
</div>`;
}

function renderPendingAssignSection() {
const leads = getCachedPendingCustomers();
const agents = getAgentRoster();

const settings = loadAssignSettings();
const excludedCallbackTypes = new Set(settings.excludedCallbackTypes || []);
const includedAdvancedCallbackTypes = new Set(settings.includedAdvancedCallbackTypes || []);
const initialCutoffDate = parseCutoffFromInput(settings.cutoffTime);
const callbackCounts = computePendingCallbackCounts(leads, initialCutoffDate);
const countFor = (type) => callbackCounts[type] || 0;

const primaryCheckboxes = CALLBACK_TYPES_PRIMARY.map(type => `
<label class="chip-label">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${excludedCallbackTypes.has(type) ? '' : 'checked'} onchange="window._updateAssignPreview()">
${escapeHtml(type)} <span id="cb-count-${slugify(type)}">(${countFor(type)})</span>
</label>`).join('');

const advancedCheckboxes = CALLBACK_TYPES_ADVANCED.map(type => `
<label class="chip-label">
<input type="checkbox" class="assign-callback-checkbox" value="${escapeHtml(type)}" ${includedAdvancedCallbackTypes.has(type) ? 'checked' : ''} onchange="window._updateAssignPreview()">
${escapeHtml(type)} <span id="cb-count-${slugify(type)}">(${countFor(type)})</span>
</label>`).join('');

const defaultCutoff = settings.cutoffTime || formatTimeForInput(defaultHourCutoff());
const advancedOpenStyle = settings.advancedOpen ? 'display: flex;' : 'display: none;';

const filtersZoneHtml = `
<span class="sla-lbl">Due before</span>
<input id="assignCutoffTime" type="hidden" value="${defaultCutoff}">
<div style="display: flex; align-items: center; gap: 6px;">
${renderWheelColumnHtml('assignCutoffHourWheel', HOUR_VALUES, 56)}
<span style="font-weight: 700;">:</span>
${renderWheelColumnHtml('assignCutoffMinuteWheel', MINUTE_VALUES, 56)}
</div>
<span class="sla-lbl">Callback type</span>
<div class="sla-cf">${primaryCheckboxes}</div>
<button type="button" class="sla-txt" style="align-self: flex-start;" onclick="window._toggleAdvancedCallbackTypes()">
${chevronIcon(!settings.advancedOpen, 'advancedCallbackToggle')} Advanced (Manual Rescheduled, Post Closure)
</button>
<div id="advancedCallbackTypes" class="sla-cf" style="${advancedOpenStyle}">${advancedCheckboxes}</div>`;

return renderAssignSectionShell(settings, agents, '_runPendingAssignment', filtersZoneHtml, '');
}

// ===================================================================
// CARD RENDERING (SLA + PENDING)
// ===================================================================

// Pure. 8 reads "8 min", 187 reads "3 h 7 min", 120 reads "2 h".
function formatDueMinutes(minutes) {
if (minutes < 60) return `${minutes} min`;
const hours = Math.floor(minutes / 60);
const rest = minutes % 60;
return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// Pure. The time on the right of an SLA row. Red is missed or within 15
// minutes, amber is within the hour, grey is later.
function slaDueDisplay(customer, now) {
if (!customer.slaDate) return { text: '', tone: 'mut' };
const minsUntil = Math.round((customer.slaDate.getTime() - now) / 60000);
if (customer.status === 'Missed' || minsUntil <= 0) return { text: `Missed ${formatDueMinutes(Math.abs(minsUntil))}`, tone: 'bad' };
return { text: formatDueMinutes(minsUntil), tone: minsUntil <= 15 ? 'bad' : (minsUntil <= 60 ? 'warn' : 'mut') };
}

// Pure. "DATE ONLY" reads "Date only"; anything not all capitals is left.
function sentenceCase(text) {
const s = String(text || '').trim();
if (!s || s !== s.toUpperCase()) return s;
return s.charAt(0) + s.slice(1).toLowerCase();
}

// Pure. The campaign as it reads on the grey line: "Peugeot - Enquiry - New
// (pcr_code)" becomes "Peugeot Enquiry, New". The full name is in the opened row.
function shortCampaign(campaign) {
const parts = String(campaign || '').replace(/\s*\([^)]*_[^)]*\)\s*$/, '').split(' - ').map((p) => p.trim()).filter(Boolean);
if (parts.length < 3) return parts.join(' ');
return `${parts.slice(0, -1).join(' ')}, ${parts[parts.length - 1]}`;
}

// Pure. What a Lead Checker result shows on its lead: one tag in the shared
// tier colour, and for Post Closure the reason for the grey line. Post
// Closure tags are only ever the two actions.
function leadCheckerTagFor(leadChecker) {
const badge = pickLeadCheckerBadge(leadChecker);
if (!badge) return null;
const isPostClosure = !!leadChecker.postClosureAction || badge.label === 'check: needs contact?';
if (!isPostClosure) return { text: sentenceCase(badge.label), color: badge.color, reason: '', full: '' };
const shorthand = POST_CLOSURE_SHORTHAND[leadChecker.postClosureReason];
return {
text: leadChecker.postClosureAction || 'check: needs contact?',
color: badge.color,
reason: leadChecker.postClosureReason ? `${leadChecker.postClosureReason}${shorthand ? ` (${shorthand})` : ''}` : '',
full: badge.label
};
}

function renderDetailRow(label, valueHtml) {
return `<dt>${label}</dt><dd>${valueHtml}</dd>`;
}

function renderCopyableField(value) {
if (!value) return '<span class="sla-small">None</span>';
const display = escapeHtml(value);
return `<span class="sla-copyable" data-value="${display}" title="Click to copy">${display}</span>`;
}

// One lead: two lines, the initials as the actions button, the row itself
// opening the details. Shared by the SLA and Pending lists.
function renderLeadRow({ c, pageType, tone, dueText, dueTone, dueTitle, leadChecker, queuePosition, metaParts, detailRowsHtml }) {
const tag = leadCheckerTagFor(leadChecker);
const tagTitle = leadChecker ? [leadChecker.postClosureEvidence ? `Why: ${leadChecker.postClosureEvidence}` : '', leadChecker.reason, leadChecker.initialNotes].filter(Boolean).join('\n\n') : '';
const assignedText = c.assigned ? `Assigned${queuePosition ? `, ${ordinal(queuePosition.position)}` : ''}` : '';
const assignedTitle = c.assigned ? `Assigned to ${c.agentName || 'an agent'}${queuePosition ? `, ${ordinal(queuePosition.position)} in their queue` : ''}` : '';
// A lead Konnect already has queued while it shows unassigned here.
const queueWarning = queuePosition && !c.assigned
? `<span class="sla-tag warn" title="${escapeHtml(`Shows unassigned here, but Konnect's own Queue by Agent already has this lead queued to ${queuePosition.agentName} (position ${queuePosition.position} of the last ${queuePosition.totalShown} shown), so assigning it may be rejected.`)}">In ${escapeHtml(queuePosition.agentName)}'s queue</span>`
: '';
const tags = [
tag ? `<span class="sla-tag" style="--tc: ${tag.color};" title="${escapeHtml(tagTitle)}">${escapeHtml(tag.text)}</span>` : '',
queueWarning,
!tag && c.assigned ? `<span class="sla-tag done" title="${escapeHtml(assignedTitle)}">${escapeHtml(assignedText)}</span>` : ''
].join('');
const meta = [tag && tag.reason, ...metaParts, tag && c.assigned ? assignedText : ''].filter(Boolean).map(escapeHtml).join(' &middot; ');
const details = [
detailRowsHtml,
tag && tag.full ? renderDetailRow('Post Closure', escapeHtml(tag.full)) : '',
tag && !tag.full ? renderDetailRow('Lead Checker', escapeHtml([tag.text, leadChecker.subCategory].filter(Boolean).join(': '))) : '',
leadChecker && leadChecker.postClosureEvidence ? renderDetailRow('Why', escapeHtml(leadChecker.postClosureEvidence)) : '',
c.assigned ? renderDetailRow('Assigned', escapeHtml(`${c.agentName || 'An agent'}${queuePosition ? `, ${ordinal(queuePosition.position)} in the queue` : ''}`)) : ''
].join('');
const avatarTone = queueWarning ? 'amb' : (tone === 'bad' ? 'red' : (tone === 'warn' ? 'amb' : ''));
return `<div class="customer-card sla-r" data-customer-name="${escapeHtml(c.name.toLowerCase())}" data-lead-key="${escapeHtml(c.key)}" data-page-type="${pageType}" data-assigned="${c.assigned ? 1 : 0}" data-agent-name="${escapeHtml(c.agentName || '')}">
<button type="button" class="avatar-circle sla-av ${avatarTone}" title="Actions for ${escapeHtml(c.name)}" aria-haspopup="true">${escapeHtml(initialsFor(c.name))}</button>
<div class="contact-toggle sla-rmain" onclick="window._toggleCustomerContact(this)" aria-expanded="false" title="Show or hide details">
<span class="sla-nm"><i class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}">${escapeHtml(c.name)}</i>${tags}</span>
<span class="sla-due ${dueTone}" title="${escapeHtml(dueTitle || '')}">${escapeHtml(dueText)}</span>
<span class="sla-meta">${meta}</span>
</div>
<dl class="contact-details" style="display: none;">${details}</dl>
</div>`;
}

// Shared section shell for the SLA tier and Pending callback-type views. The
// row stays a renderRow callback because its content differs per page.
function renderCustomerCardListSection({ label, tooltip, customers, sectionId, toggleHandlerName, renderRow }) {
const tip = tooltip ? `${tooltip} ` : '';
if (customers.length === 0) {
return `<div class="sla-grp" title="${escapeHtml(tip.trim())}">${escapeHtml(label)} <span>No customers</span></div>`;
}
const collapsed = isSectionCollapsed(sectionId);
return `<div class="sla-g">
<button type="button" class="sla-grp" id="toggle-${sectionId}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="${sectionId}" onclick="window.${toggleHandlerName}('${sectionId}')" title="${escapeHtml(tip)}Click to fold or unfold">${escapeHtml(label)} <span>${customers.length}</span></button>
<div id="${sectionId}" class="collapsible-section sla-list" style="display: ${collapsed ? 'none' : 'block'};">
${customers.map(renderRow).join('')}
</div>
</div>`;
}

function renderCallbackTypeSection(typeName, customers) {
const sectionId = 'cb-' + slugify(typeName);
// Loaded once per section, not per card.
const leadCheckerResults = loadLeadCheckerImportState().results;
const leadCheckerResultIndex = buildLeadCheckerResultIndex(leadCheckerResults);
const agentQueueSnapshot = loadAgentQueueSnapshot();
// No hour-bucketing for Post Closure; every other callback type keeps the
// due hour as the dominant key.
const orderedCustomers = isLeadCheckerPrioritySortEnabled()
? sortByLeadCheckerPriority(customers, leadCheckerResults, typeName === 'Post Closure' ? null : (c) => c.nextActionDate, { byHour: true })
: customers;
return renderCustomerCardListSection({
label: typeName,
customers: orderedCustomers,
sectionId,
toggleHandlerName: '_toggleCallbackType',
renderRow: (c) => {
const nextActionFull = c.nextActionDate ? c.nextActionDate.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
return renderLeadRow({
c,
pageType: PAGE_PENDING,
tone: '',
dueText: c.nextActionDate ? formatTimeForInput(c.nextActionDate) : '',
dueTone: 'mut',
dueTitle: `Next action: ${nextActionFull}`,
leadChecker: findLeadCheckerResultForCustomerIndexed(c, leadCheckerResultIndex),
queuePosition: findAgentQueuePositionInSnapshot({ email: c.email, phone: c.mobile }, agentQueueSnapshot),
metaParts: [c.brand, shortCampaign(c.campaign)],
detailRowsHtml: [
renderDetailRow('Mobile', renderCopyableField(c.mobile)),
renderDetailRow('Email', renderCopyableField(c.email)),
renderDetailRow('Landline', renderCopyableField(c.landline)),
renderDetailRow('Campaign', escapeHtml(c.campaign || '')),
renderDetailRow('Next action', escapeHtml(nextActionFull))
].join('')
});
}
});
}

function renderTierSection(tierInfo, customers) {
// Loaded once per tier section, not per card.
const leadCheckerResults = loadLeadCheckerImportState().results;
const leadCheckerResultIndex = buildLeadCheckerResultIndex(leadCheckerResults);
const agentQueueSnapshot = loadAgentQueueSnapshot();
const orderedCustomers = isLeadCheckerPrioritySortEnabled()
? sortByLeadCheckerPriority(customers, leadCheckerResults, (c) => c.slaDate)
: customers;
const now = Date.now();
return renderCustomerCardListSection({
label: tierInfo.name,
tooltip: `${tierInfo.name}: ${tierInfo.holds}.`,
customers: orderedCustomers,
sectionId: tierInfo.id,
toggleHandlerName: '_toggleTier',
renderRow: (c) => {
const due = slaDueDisplay(c, now);
return renderLeadRow({
c,
pageType: PAGE_SLA,
tone: due.tone,
dueText: due.text,
dueTone: due.tone,
dueTitle: c.slaDate ? `SLA: ${c.slaDate.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '',
leadChecker: findLeadCheckerResultForCustomerIndexed(c, leadCheckerResultIndex),
queuePosition: findAgentQueuePositionInSnapshot(c, agentQueueSnapshot),
metaParts: [c.source, shortCampaign(c.campaign)],
detailRowsHtml: [
renderDetailRow('Phone', renderCopyableField(c.phone)),
renderDetailRow('Email', renderCopyableField(c.email)),
renderDetailRow('Campaign', escapeHtml(c.campaign || ''))
].join('')
});
}
});
}

// ===================================================================
// PANEL MOUNTING & DISPLAY
// ===================================================================

// ---- Today: what has been checked and worked so far, across the tools ----

// Pure. The same customer key Lead Re setup files its progress under.
function deskPersonKey(r) {
const clean = (value) => String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
return clean(r.email) || String(r.phone || '').replace(/\D/g, '').slice(-10) || clean(stripTitle(String(r.name || '').trim()));
}

// Pure. Counts from what SLA Manager and Lead Re setup have stored.
function computeTodayCounts({ national, resetProgress, deskResults, deskProgress, emailOnly }) {
const reSetup = (national || []).filter((r) => r.Verdict === RE_SETUP);
const progress = resetProgress || {};
const pc = (deskProgress && deskProgress.pc) || {};
const eo = (deskProgress && deskProgress.eo) || {};
const sendBack = (deskResults || []).filter((r) => r.postClosureAction === 'send back through');
const emailLeads = emailOnly || [];
return {
nationalChecked: (national || []).length,
reSetupToDo: reSetup.filter((r) => !progress[r.ActivityID]).length,
reSetupDone: reSetup.filter((r) => progress[r.ActivityID] === 'Done').length,
sendBack: sendBack.length,
sendBackDone: sendBack.filter((r) => pc[deskPersonKey(r)] === 'Done').length,
toCheck: (deskResults || []).filter((r) => r.postClosureAction === 'check: needs contact?').length,
emailOnly: emailLeads.length,
emailOnlyDone: emailLeads.filter((l) => eo[deskPersonKey({ email: l.email })] === 'Done').length
};
}

function loadTodayCounts() {
const fresh = (stored, timeField) => (stored && isStoredTimeFresh(stored[timeField || 'savedAt']) ? stored : null);
const national = fresh(readStoredJson(NATIONAL_RESULTS_KEY));
const reset = fresh(readStoredJson(LEAD_RESET_PROGRESS_KEY));
const desk = fresh(readStoredJson(DESK_RESULTS_KEY));
const deskProgress = fresh(readStoredJson(LEAD_RESET_DESK_PROGRESS_KEY));
const emailOnly = fresh(readStoredJson(EMAIL_ONLY_ASSIGNED_KEY));
const today = new Date().toDateString();
return computeTodayCounts({
national: national && Array.isArray(national.results) ? national.results : [],
resetProgress: reset && reset.byActivity,
deskResults: desk && Array.isArray(desk.results) ? desk.results.filter((r) => r && isStoredTimeFresh(r.checkedAt || desk.savedAt)) : [],
deskProgress,
emailOnly: emailOnly && Array.isArray(emailOnly.leads) && new Date(emailOnly.savedAt).toDateString() === today ? emailOnly.leads : []
});
}

// Pure. One short line per kind of work, only for kinds with something in.
function todaySummaryLines(c) {
const lines = [];
if (c.nationalChecked) lines.push(`National: ${c.nationalChecked} checked, Re setup ${c.reSetupToDo} to do, ${c.reSetupDone} done`);
if (c.sendBack || c.toCheck) lines.push(`Post Closure: ${c.sendBack} to send back (${c.sendBackDone} done), ${c.toCheck} to check`);
if (c.emailOnly) lines.push(`Email Only: ${c.emailOnly} assigned, ${c.emailOnlyDone} done`);
return lines;
}

// Pure. One chip per kind of work, showing the number that matters; the full
// sentence from todaySummaryLines shows when the chip is clicked.
function todayChips(c) {
const chips = [];
const lines = todaySummaryLines(c);
if (c.nationalChecked) chips.push({ kind: 'national', label: `National ${c.reSetupToDo} to do`, detail: lines[chips.length] });
if (c.sendBack || c.toCheck) chips.push({ kind: 'postClosure', label: `Post Closure ${c.sendBack} to send back`, detail: lines[chips.length] });
if (c.emailOnly) chips.push({ kind: 'emailOnly', label: `Email Only ${c.emailOnly}`, detail: lines[chips.length] });
return chips;
}

// Which Today chip is open, kept here so a redraw does not fold it.
let todayOpenKind = null;

function hasTeamData() {
return todaysAssignmentLog().length > 0 || !!loadQueueDone();
}

function renderTodaySummary() {
let chips = [];
try { chips = todayChips(loadTodayCounts()); } catch (error) { chips = []; }
const teamOpen = todayOpenKind === 'team';
const team = teamOpen || hasTeamData();
if (!chips.length && !team) return '<div id="_slaTodaySummary" hidden></div>';
const open = chips.find((chip) => chip.kind === todayOpenKind);
return `<div id="_slaTodaySummary" class="sla-col" style="gap: 5px;">
<div class="sla-cf"><span class="sla-lbl">Today</span>
${chips.map((chip) => `<button type="button" class="sla-chip" data-kind="${chip.kind}" aria-pressed="${open === chip ? 'true' : 'false'}" title="${escapeHtml(chip.detail)}" onclick="window._toggleTodayDetail(this.dataset.kind)">${escapeHtml(chip.label)}</button>`).join('')}
${team ? `<button type="button" class="sla-chip" data-kind="team" aria-pressed="${teamOpen ? 'true' : 'false'}" title="Team today: what each agent has been assigned, done and sent back" onclick="window._toggleTodayDetail(this.dataset.kind)">Team</button>` : ''}
</div>
<div class="sla-small" role="status" ${open ? '' : 'hidden'}>${open ? escapeHtml(open.detail) : ''}</div>
${teamOpen ? renderTeamToday() : ''}
</div>`;
}

// Team today from the More menu.
window._showTeamToday = function() {
todayOpenKind = 'team';
renderTodaySummaryInPlace();
const view = document.getElementById('_slaTeamToday');
if (view && typeof view.scrollIntoView === 'function') view.scrollIntoView({ block: 'nearest' });
};

window._toggleTodayDetail = function(kind) {
todayOpenKind = todayOpenKind === kind ? null : kind;
renderTodaySummaryInPlace();
};

function renderTodaySummaryInPlace() {
const el = document.getElementById('_slaTodaySummary');
if (el) el.outerHTML = renderTodaySummary();
}

// Lead Re setup works in another tab, so its progress arrives as storage
// events. One listener per page, calling the newest copy of the tool.
const TODAY_KEYS = [NATIONAL_RESULTS_KEY, LEAD_RESET_PROGRESS_KEY, DESK_RESULTS_KEY, LEAD_RESET_DESK_PROGRESS_KEY, EMAIL_ONLY_ASSIGNED_KEY];
window.__slaOnTodayStorage = (key) => { if (TODAY_KEYS.includes(key)) renderTodaySummaryInPlace(); };
if (!window.__slaTodayListening && typeof window.addEventListener === 'function') {
window.__slaTodayListening = true;
window.addEventListener('storage', (event) => { if (window.__slaOnTodayStorage) window.__slaOnTodayStorage(event.key); });
}

runSelfTest('todaySummarySelfTest', function todaySummarySelfTest() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
const counts = computeTodayCounts({
national: [{ ActivityID: '1', Verdict: RE_SETUP }, { ActivityID: '2', Verdict: RE_SETUP }, { ActivityID: '3', Verdict: RE_SETUP }, { ActivityID: '4', Verdict: 'OK' }],
resetProgress: { 1: 'Done', 2: 'Skipped' },
deskResults: [
{ name: 'Jo Example', email: 'Jo.Example@example.com', phone: '', postClosureAction: 'send back through' },
{ name: 'Al Sample', email: '', phone: '07700 900103', postClosureAction: 'send back through' },
{ name: 'Sam Buyer', email: 'sam@example.com', phone: '', postClosureAction: 'check: needs contact?' }
],
deskProgress: { pc: { 'jo.example@example.com': 'Done', '7700900103': 'Skipped' }, eo: { 'eve@example.com': 'Done' } },
emailOnly: [{ email: 'Eve@example.com' }, { email: 'dan@example.com' }]
});
check('counts', counts, { nationalChecked: 4, reSetupToDo: 1, reSetupDone: 1, sendBack: 2, sendBackDone: 1, toCheck: 1, emailOnly: 2, emailOnlyDone: 1 });
check('lines', todaySummaryLines(counts), ['National: 4 checked, Re setup 1 to do, 1 done', 'Post Closure: 2 to send back (1 done), 1 to check', 'Email Only: 2 assigned, 1 done']);
check('nothing stored gives no lines', todaySummaryLines(computeTodayCounts({})), []);
check('chips show what is left to do and carry the full line', todayChips(counts).map((chip) => `${chip.label}|${chip.detail}`), ['National 1 to do|National: 4 checked, Re setup 1 to do, 1 done', 'Post Closure 2 to send back|Post Closure: 2 to send back (1 done), 1 to check', 'Email Only 2|Email Only: 2 assigned, 1 done']);
check('a kind with nothing in has no chip', todayChips(computeTodayCounts({ emailOnly: [{ email: 'eve@example.com' }] })).map((chip) => chip.kind), ['emailOnly']);
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager today-summary self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager today-summary self-test passed');
}
});

// One line of the More menu. The menu closes on a click unless `keep` is
// set, for lines that answer in their own text.
function renderMoreItem(icon, label, onclick, options) {
const o = options || {};
return `<button type="button" role="menuitem" class="sla-mi ${o.danger ? 'danger' : ''}" ${o.keep ? 'data-keep="1"' : ''} ${o.disabled ? 'disabled' : ''} ${o.title ? `title="${escapeHtml(o.title)}"` : ''} onclick="${onclick}">${svgIcon(icon, 14)}<span>${label}</span>${o.state ? `<em>${o.state}</em>` : ''}</button>`;
}

// Everything not used every few minutes, in one named list. Lines that need
// the lead list or the Assign card are greyed where those are not showing.
function renderMoreMenu(leadsView) {
const size = getPanelSize();
const zen = isZenModeOn();
const needsLeads = { disabled: !leadsView, title: leadsView ? '' : 'Go back to the leads first' };
const needsAssign = { disabled: !leadsView || zen, title: !leadsView ? 'Go back to the leads first' : (zen ? 'Turn List only view off first' : '') };
const sizeItems = [
size !== 'standard' ? renderMoreItem('restore', 'Standard size', `window._setPanelSize('standard')`) : '',
size !== 'compact' ? renderMoreItem('shrink', 'Compact size', `window._setPanelSize('compact')`) : '',
size !== 'full' ? renderMoreItem('expand', 'Full size, two columns', `window._setPanelSize('full')`) : ''
].join('');
const sep = '<div class="sla-ms"></div>';
return `<div id="_slaMoreMenu" class="sla-pop" role="menu" aria-label="More" hidden>
${renderMoreItem('minimize', 'Hide the panel', 'window._toggleMinimizePanel()', { title: 'Click the badge in the top bar to bring it back' })}
${sep}
${renderMoreItem('sort', 'Sort by Lead Checker category', 'window._toggleLeadCheckerPrioritySort()', { ...needsLeads, state: isLeadCheckerPrioritySortEnabled() ? 'on' : 'off', title: needsLeads.title || 'Groups each section by Lead Checker category, most urgent first within each' })}
${sizeItems}
${renderMoreItem('arrowUp', 'Back to top', `document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0`)}
${renderMoreItem('list', 'List only view', 'window._toggleZenMode()', { ...needsLeads, state: zen ? 'on' : 'off', title: needsLeads.title || 'Hides Overview, Assign, Filters and Today so more leads fit' })}
${renderMoreItem('bell', 'Warn me about leads going missed', 'window._toggleMissedWarning(this)', { state: isMissedWarningOn() ? 'on' : 'off', title: 'Counts unassigned leads that are missed, due within 5 minutes and due within 15 in the tab title, with a desktop notification if the browser allows it. The SLA list is scanned again every 2 minutes while this is on' })}
${sep}
${renderMoreItem('refresh', 'Scan again', 'window._refreshLeadsAndPanel()', needsLeads)}
${renderMoreItem('user', 'Refresh agents', 'window._refreshAssignSection()', needsAssign)}
${renderMoreItem('clock', 'History', 'window._showAssignHistory()', { ...needsAssign, title: needsAssign.title || 'How many leads each agent has been assigned today' })}
${renderMoreItem('user', 'Team today', 'window._showTeamToday()', { ...needsAssign, title: needsAssign.title || 'What each agent has been assigned, done and sent back today' })}
${renderMoreItem('queue', 'Queue', 'window._checkAgentQueuePositions(null)', { ...needsLeads, title: needsLeads.title || "Reads each agent's live call queue from Konnect and shows how many leads each has not called yet" })}
${renderMoreItem('paste', 'Paste Lead Checker results', `window._pasteAndClassifyLeadChecker(this.querySelector('span'))`, { ...needsLeads, keep: true, title: needsLeads.title || 'Reads the results copied from the Lead Checker off the clipboard and shows them on the leads' })}
${renderMoreItem('trash', 'Clear Queue', 'window._clearWholeQueue()', { ...needsLeads, danger: true, title: needsLeads.title || "Unassigns every lead (Konnect's Clear Queues). There is no undo" })}
${sep}
${renderMoreItem('flag', 'Report a problem', 'window._slaReportProblem()')}
${renderMoreItem('stop', 'Clear &amp; Stop', 'window._slaResetBookmarklet()', { danger: true })}
${renderVersionLine()}
</div>`;
}

window._toggleMoreMenu = function(forceOpen) {
const menu = document.getElementById('_slaMoreMenu');
const button = document.getElementById('_slaMoreBtn');
if (!menu) return;
const open = typeof forceOpen === 'boolean' ? forceOpen : menu.hidden;
menu.hidden = !open;
if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
};

// Shared chrome for every view: header, Konnect Live strip, body, footer and
// the More menu. Only the header buttons, counts, top area and body differ.
// The header, strip and footer never shrink; Overview and Assign scroll in
// their own area so the list always keeps a usable height. At full size the
// two areas sit side by side. The search bar's negative offset and margins
// cancel the list's padding, so it sticks flush to the top and sides.
// headerMode: 'leads' (Send, Checks), 'checks' (Back to leads), 'national'
// (Back to checks) or 'plain' (Checks only).
function renderPanelShell({ view, headerMode, subtitle, summaryHtml, assignSectionHtml, bodyHtml, hideSearch, onTitleClick, showLeadChecker, footerText }) {
const panelSize = getPanelSize();
const zen = headerMode === 'leads' && isZenModeOn();
const leadsView = headerMode === 'leads';

// The poll rebuilds the whole shell on a page switch, so the minimised state
// is reapplied here from PANEL_STATE_KEY.
const isMinimized = localStorage.getItem(PANEL_STATE_KEY) === 'hidden';
const topHtml = ((summaryHtml || '') + (assignSectionHtml || '')).trim();
const todayHtml = zen ? '' : renderTodaySummary();
const headerButton = (icon, label, onclick, title, when) => `<button type="button" class="sla-hbtn ${when || ''}" onclick="${onclick}" title="${title}">${svgIcon(icon, 14)}${label}</button>`;
const buttons = {
leads: headerButton('send', 'Send', 'window._toggleLeadCheckerPopover()', 'Send leads to the Lead Checker, or bring results back by hand', 'sla-when-main')
+ headerButton('checklist', 'Checks', 'window._toggleMorningChecks()', 'Morning checks', 'sla-when-main')
+ headerButton('back', 'Back to leads', 'window._toggleLeadCheckerPopover()', 'Back to the lead list', 'sla-when-send'),
checks: headerButton('back', 'Back to leads', 'window._toggleMorningChecks()', 'Back to the lead list'),
national: headerButton('back', 'Back to checks', 'window._showNationalResults(false)', 'Back to the morning checks'),
plain: headerButton('checklist', 'Checks', 'window._toggleMorningChecks()', 'Morning checks')
}[headerMode] || '';
const sizeButton = panelSize === 'standard'
? `<button type="button" id="_slaSizeBtn" onclick="window._togglePanelSize()" title="Two columns, full height">${svgIcon('expand', 12)}Full size</button>`
: `<button type="button" id="_slaSizeBtn" onclick="window._togglePanelSize()" title="Back to the standard size">${svgIcon(panelSize === 'full' ? 'shrink' : 'expand', 12)}Standard size</button>`;

return `
<div id="${PANEL_BOX_ID}" data-view="${escapeHtml(view)}" data-size="${panelSize}" style="${isMinimized ? 'transform: translateX(150%);' : ''}">
<div class="sla-hd">
<div class="sla-name">
${onTitleClick ? `<button type="button" class="sla-ttl" onclick="${onTitleClick}" title="Scan again">SLA Manager${svgIcon('refresh', 12)}</button>` : '<span class="sla-ttl">SLA Manager</span>'}
<span class="sla-sub sla-when-main" title="${escapeHtml(subtitle || '')}${zen ? ', list only view' : ''}">${escapeHtml(subtitle || '')}${zen ? ' &middot; list only' : ''}</span>
<span class="sla-sub sla-when-send">Send to Lead Checker</span>
</div>
${buttons}
<button type="button" id="_slaMoreBtn" class="sla-hbtn quiet" aria-haspopup="true" aria-expanded="false" onclick="window._toggleMoreMenu()">${svgIcon('more', 14)}More</button>
</div>
${renderLinkLine()}
${renderDayStrip()}
<div class="sla-main ${topHtml && !zen ? 'two' : ''}">
${topHtml ? `<div id="_slaTopArea">
${summaryHtml || ''}
${assignSectionHtml || ''}
${todayHtml}
</div>` : ''}
<div class="panelContent">
${renderSelfTestBanner()}
${renderNewerVersionNotice()}
${topHtml ? '' : todayHtml}
${hideSearch ? '' : `<div id="_slaSearchBar">
<input type="text" id="customerSearchInput" placeholder="Search by name" oninput="window._filterCustomerSearch(this.value)">
</div>`}
${bodyHtml}
</div>
${showLeadChecker ? renderLeadCheckerPopover() : ''}
</div>
${renderMoreMenu(leadsView)}
<div class="sla-ft"><span>${footerText || ''}</span>${sizeButton}</div>
</div>
`;
}

function showTableNotFoundPanel(tableName) {
mountPanel(renderPanelShell({
view: 'missing', headerMode: 'plain', subtitle: '', summaryHtml: '', assignSectionHtml: '', hideSearch: true,
bodyHtml: renderZeroState('warning', `${tableName} table not found`, 'The table has not loaded yet, or the page layout has changed. Reload the page, then click the bookmarklet again.')
}));
}

// Gives mouse-only controls (clickable spans/divs, copyable chips, avatars)
// button semantics and keyboard focus, and names unlabelled inputs and
// icon-only buttons from their placeholder or tooltip. Idempotent, so it is
// re-run whenever part of the panel is re-rendered.
const NATIVE_CONTROL_SELECTOR = 'button, a[href], input, select, textarea, summary';
function enhancePanelAccessibility(root) {
if (!root) return;
root.querySelectorAll('[onclick], .sla-copyable, .avatar-circle').forEach((el) => {
if (el.matches(NATIVE_CONTROL_SELECTOR) || el.closest('label')) return;
if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
if (!el.hasAttribute('aria-label') && el.getAttribute('title') && !el.textContent.trim()) el.setAttribute('aria-label', el.getAttribute('title'));
});
root.querySelectorAll('input, select, textarea').forEach((el) => {
if (el.hasAttribute('aria-label') || el.closest('label') || (el.id && root.querySelector(`label[for="${el.id}"]`))) return;
const name = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name');
if (name) el.setAttribute('aria-label', name);
});
root.querySelectorAll('button').forEach((el) => {
if (!el.hasAttribute('aria-label') && !el.textContent.trim() && el.getAttribute('title')) el.setAttribute('aria-label', el.getAttribute('title'));
});
}

// What the user had open or typed, read before a redraw and put back after
// it, so results arriving in the background do not reset the panel.
function capturePanelViewState() {
if (!panelElement) return null;
const q = (selector) => panelElement.querySelector(selector);
const box = q(`#${PANEL_BOX_ID}`);
const shown = (el) => !!el && el.style.display !== 'none';
const active = panelElement.contains(document.activeElement) ? document.activeElement : null;
let caret = null;
try { if (active && typeof active.selectionStart === 'number') caret = [active.selectionStart, active.selectionEnd]; } catch (error) { caret = null; }
const notes = {};
panelElement.querySelectorAll('input[data-national-note]').forEach((el) => { if (el.value) notes[el.dataset.nationalNote] = el.value; });
return {
view: box ? box.dataset.view : '',
focusedId: active ? active.id : '',
caret,
scrollTop: q('.panelContent') ? q('.panelContent').scrollTop : 0,
assignScrollTop: q('#assignSectionBody') ? q('#assignSectionBody').scrollTop : 0,
topAreaScrollTop: q('#_slaTopArea') ? q('#_slaTopArea').scrollTop : 0,
search: q('#customerSearchInput') ? q('#customerSearchInput').value : '',
popoverOpen: shown(q('#leadCheckerPopover')),
historyOpen: shown(q('#assignHistoryPanel')),
openFolds: Array.from(panelElement.querySelectorAll('[onclick*="_slaFold"][aria-expanded="true"]')).map((el) => el.getAttribute('aria-controls')),
openContacts: Array.from(panelElement.querySelectorAll('.customer-card')).filter((card) => shown(card.querySelector('.contact-details'))).map((card) => card.dataset.leadKey),
openCheckDetails: Array.from(panelElement.querySelectorAll('[id^="_mcDetails_"]')).filter(shown).map((el) => el.id.replace('_mcDetails_', '')),
notes
};
}

function restorePanelViewState(state) {
if (!state || !panelElement) return;
const q = (selector) => panelElement.querySelector(selector);
const box = q(`#${PANEL_BOX_ID}`);
if (state.focusedId && document.getElementById(state.focusedId)) {
const el = document.getElementById(state.focusedId);
el.focus({ preventScroll: true });
try { if (state.caret && typeof el.setSelectionRange === 'function') el.setSelectionRange(state.caret[0], state.caret[1]); } catch (error) { /* not a text field */ }
}
// The rest only applies when the same view is drawn again.
if (!box || box.dataset.view !== state.view) return;
if (state.popoverOpen && q('#leadCheckerPopover')) setSendView(true);
state.openFolds.forEach((id) => {
const button = q(`[onclick*="_slaFold"][aria-controls="${id}"]`);
if (button && button.getAttribute('aria-expanded') !== 'true') window._slaFold(button);
});
if (state.historyOpen && q('#assignHistoryPanel')) window._toggleAssignHistory();
if (state.openContacts.length) {
const open = new Set(state.openContacts);
panelElement.querySelectorAll('.customer-card').forEach((card) => {
const toggle = card.querySelector('.contact-toggle');
if (toggle && open.has(card.dataset.leadKey)) window._toggleCustomerContact(toggle);
});
}
state.openCheckDetails.forEach((key) => window._toggleMorningCheckDetails(key));
panelElement.querySelectorAll('input[data-national-note]').forEach((el) => { if (state.notes[el.dataset.nationalNote]) el.value = state.notes[el.dataset.nationalNote]; });
if (state.search && q('#customerSearchInput')) {
q('#customerSearchInput').value = state.search;
window._filterCustomerSearch(state.search);
}
if (q('#assignSectionBody')) q('#assignSectionBody').scrollTop = state.assignScrollTop;
if (q('#_slaTopArea')) q('#_slaTopArea').scrollTop = state.topAreaScrollTop || 0;
if (q('.panelContent')) q('.panelContent').scrollTop = state.scrollTop;
}

// A redraw that results arriving in the background ask for. It waits while
// the user is in a drop-down or typing a reason, or an assign run is using
// the panel, so their input is not wiped; the caller's own redraw follows.
let deferredRedraw = null;
function isHoldingPanelInput() {
const active = document.activeElement;
return !!(panelElement && active && panelElement.contains(active) && typeof active.matches === 'function' && active.matches('select, input[data-national-note]'));
}
function redrawWhenNotTyping(redraw) {
if (assigning || isHoldingPanelInput()) { deferredRedraw = redraw; return; }
deferredRedraw = null;
redraw();
}
function flushDeferredRedraw() {
if (!deferredRedraw || assigning || isHoldingPanelInput()) return;
const redraw = deferredRedraw;
deferredRedraw = null;
redraw();
}

// Redraws the leads view for the page being shown, from what is already held.
function redrawLeadsPanel() {
if (currentPanelMode !== 'normal') return;
if (currentPageType === PAGE_PENDING) displayPendingPanel(currentPendingCustomers, lastPendingDiffCounts.newCount, lastPendingDiffCounts.removedCount, false);
else if (currentPageType === PAGE_SLA) displayPanel(currentCustomers, lastSlaDiffCounts.newCount, lastSlaDiffCounts.removedCount, false);
}

function mountPanel(panelHTML) {
const isFirstOpen = !panelElement;
const viewState = capturePanelViewState();
deferredRedraw = null;
if (panelElement) panelElement.remove();
panelElement = document.createElement('div');
panelElement.id = PANEL_ID;
panelElement.setAttribute('role', 'region');
panelElement.setAttribute('aria-label', 'SLA Manager');
panelElement.innerHTML = panelHTML;
document.documentElement.appendChild(panelElement);
enhancePanelAccessibility(panelElement);
const mountedPanel = panelElement;
let enhanceQueued = false;
new MutationObserver(() => {
if (enhanceQueued) return;
enhanceQueued = true;
setTimeout(() => { enhanceQueued = false; enhancePanelAccessibility(mountedPanel); }, 50);
}).observe(panelElement, { childList: true, subtree: true });
panelElement.addEventListener('keydown', (event) => {
if (event.key !== 'Enter' && event.key !== ' ') return;
const el = event.target;
if (!el || el.getAttribute('role') !== 'button' || el.matches(NATIVE_CONTROL_SELECTOR)) return;
event.preventDefault();
el.click();
});
const panelBox = panelElement.querySelector(`#${PANEL_BOX_ID}`);
if (isFirstOpen && panelBox) {
panelBox.setAttribute('tabindex', '-1');
panelBox.focus({ preventScroll: true });
}
// A redraw held back while a drop-down or reason box had focus.
panelElement.addEventListener('focusout', () => setTimeout(flushDeferredRedraw, 0));

// A copy chip inside a row copies without also opening the row.
panelElement.querySelectorAll('.sla-copyable').forEach(el => {
el.addEventListener('click', function(event) {
event.stopPropagation();
copyToClipboard(this.dataset.value, this);
});
});

// The More menu closes on a click anywhere else, and after one of its own
// lines unless that line answers in its own text.
panelElement.addEventListener('click', (event) => {
const menu = document.getElementById('_slaMoreMenu');
if (!menu || menu.hidden || event.target.closest('#_slaMoreBtn')) return;
const item = event.target.closest('#_slaMoreMenu .sla-mi');
if (item ? !item.dataset.keep : !event.target.closest('#_slaMoreMenu')) window._toggleMoreMenu(false);
});
panelElement.addEventListener('keydown', (event) => {
if (event.key === 'Escape') window._toggleMoreMenu(false);
});

// Delegated on the panel root so a picker swapped back in after a failed
// manual assign, and the avatar popover's select, are both handled.
panelElement.addEventListener('change', (event) => {
const el = event.target.closest('.manual-assign-select');
if (!el) return;
window._manualAssignLead(el.dataset.pageType, el.dataset.leadKey, el.value, el);
});

// One popover, positioned with position:fixed from getBoundingClientRect() on
// each click so it survives the list scrolling. A child of panelElement, so
// the next mountPanel removes it.
const avatarPopover = document.createElement('div');
avatarPopover.id = '_slaAvatarAssignPopover';
avatarPopover.style.cssText = 'display: none; position: fixed; z-index: 100001; width: 210px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12.5px; line-height: 1.4; text-align: left; color: #1c1c1e; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,0.3), 0 0 0 1px rgba(15,23,42,0.08); padding: 5px;';
panelElement.appendChild(avatarPopover);

function closeAvatarPopover() {
avatarPopover.style.display = 'none';
}

panelElement.querySelectorAll('.avatar-circle').forEach(el => {
el.addEventListener('click', (event) => {
event.stopPropagation();
const card = el.closest('.customer-card');
if (!card) return;
const alreadyOpenForThisCard = avatarPopover.style.display !== 'none' && avatarPopover.dataset.forCard === card.dataset.leadKey;
if (alreadyOpenForThisCard) {
closeAvatarPopover();
return;
}
// The avatar dropdown only assigns unassigned leads; for an assigned lead it
// shows who has it, read-only.
const assigned = card.dataset.assigned === '1';
// The picker has its own wrapper: a failed assign redraws only that, so the
// Open on Konnect Live entry below stays, with or without agents online.
const assignHtml = assigned
? `<div class="sla-mn">Assigned to</div><div style="padding: 0 9px 4px; font-weight: 600;">${escapeHtml(card.dataset.agentName || 'Unknown')}</div>`
: `<div class="sla-mn">Assign to</div><div style="padding: 0 9px 4px;">${renderManualAssignPicker(card.dataset.leadKey, card.dataset.pageType)}</div>`;
avatarPopover.innerHTML = `${assignHtml}<div class="sla-ms" style="height: 1px; background: #e3e6ec; margin: 4px 0;"></div><button type="button" class="open-on-live sla-mi" data-lead-key="${escapeHtml(card.dataset.leadKey)}" data-page-type="${escapeHtml(card.dataset.pageType)}" onclick="window._openLeadOnLive(this);" title="Asks the Lead Checker to open this lead in the Konnect Live tab">${svgIcon('openOut', 14)}Open on Konnect Live</button>`;
avatarPopover.dataset.forCard = card.dataset.leadKey;
const rect = el.getBoundingClientRect();
avatarPopover.style.display = 'block';
const popoverRect = avatarPopover.getBoundingClientRect();
const top = rect.bottom + 6;
const maxLeft = window.innerWidth - popoverRect.width - 8;
avatarPopover.style.top = `${Math.min(top, window.innerHeight - popoverRect.height - 8)}px`;
avatarPopover.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
});
});
panelElement.addEventListener('click', (event) => {
if (!event.target.closest('#_slaAvatarAssignPopover') && !event.target.closest('.avatar-circle')) closeAvatarPopover();
});

initAssignSectionWheels();
restorePanelViewState(viewState);
}

function leadCountText(count) {
return `${count} lead${count === 1 ? '' : 's'}`;
}

// The footer's one line: the counts, when the list was last scanned and what
// that scan added or lost.
function leadsFooterText(customers, newCount, removedCount) {
const assigned = customers.filter((c) => c.assigned).length;
const changes = [newCount > 0 ? `${newCount} new` : '', removedCount > 0 ? `${removedCount} gone` : ''].filter(Boolean).map((part) => ` &middot; ${part}`).join('');
return `${leadCountText(customers.length)} &middot; ${assigned} assigned &middot; ${escapeHtml(lastScannedLabel())}${changes}`;
}

// Pass invalidateCache false for re-renders that only change Queue by Agent
// badges. A fresh DOM scrape right after navigating back raced Angular's
// repopulation; reusing the cache avoids the live table entirely.
function displayPanel(customers, newCount = 0, removedCount = 0, invalidateCache = true) {
currentCustomers = customers;
refreshSendThroughAgents();
currentPageType = PAGE_SLA;
currentPanelMode = 'normal';
if (invalidateCache) invalidateLeadsCache();
// A new scan retires the last Rescue notice.
if (invalidateCache && !rescue.running) rescue.text = '';
const tiered = {
tier1: sortByUrgency(customers.filter(c => c.tier === 1)),
tier2: sortByUrgency(customers.filter(c => c.tier === 2)),
tier3: sortByUrgency(customers.filter(c => c.tier === 3)),
tier4: sortByUrgency(customers.filter(c => c.tier === 4))
};

// Drawn first: it refills the leads cache the footer's scan time reads.
const summaryHtml = renderSlaDueSummary();
const bodyHtml = customers.length === 0
? renderZeroState('inbox', 'No Leads in Queue', 'The SLA queue is empty. Check back when new leads arrive.')
: SLA_TIERS.map((tierInfo) => renderTierSection(tierInfo, tiered[tierInfo.id])).join('');

mountPanel(renderPanelShell({
view: 'sla',
headerMode: 'leads',
subtitle: leadCountText(customers.length),
footerText: leadsFooterText(customers, newCount, removedCount),
summaryHtml,
assignSectionHtml: renderAssignSection(),
bodyHtml,
onTitleClick: 'window._refreshLeadsAndPanel()',
showLeadChecker: true
}));
updateMissedWarning();
}

// See displayPanel on invalidateCache.
function displayPendingPanel(customers, newCount = 0, removedCount = 0, invalidateCache = true) {
currentPendingCustomers = customers;
currentPageType = PAGE_PENDING;
currentPanelMode = 'normal';
if (invalidateCache) invalidateLeadsCache();

const summaryHtml = renderPendingDueSummary();
const bodyHtml = customers.length === 0
? renderZeroState('inbox', 'No Pending Customers', 'Nothing in the queue right now.')
: CALLBACK_TYPE_ORDER.map((type) => renderCallbackTypeSection(type, customers.filter(c => c.callbackType === type))).join('');

mountPanel(renderPanelShell({
view: 'pending',
headerMode: 'leads',
subtitle: `Pending \u00b7 ${leadCountText(customers.length)}`,
footerText: leadsFooterText(customers, newCount, removedCount),
summaryHtml,
assignSectionHtml: renderPendingAssignSection(),
bodyHtml,
onTitleClick: 'window._refreshLeadsAndPanel()',
showLeadChecker: true
}));
}

// ===================================================================
// EXTRACTION & EXPORT
// ===================================================================

const DETAIL_MAX_TRIES = 3;

// options.quiet: called from the morning checks. Loads the leads into the
// cache without switching the panel away from the morning checks.
async function extractAndExportSla(options = {}) {
const quiet = !!options.quiet;
if (extracting || assigning || navigating || (runningMorningChecks && !quiet)) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('[SLA Manager] SLA table not found');
showTableNotFoundPanel('SLA');
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

// Registration is part of the key so same-name leads from the same source and
// campaign do not collide.
const key = `${name}||${registration}||${source}||${campaign}`;
seenKeys.add(key);
// Assign state, SLA date and status are read fresh on every scan, even for
// cached leads, since they change.
const assignState = getAssignCellState(cells[COL_ASSIGN]);
const slaDate = parseKonnectDate(cells[COL_SLA_DATE]?.textContent?.trim() || '');
const status = cells[COL_STATUS]?.textContent?.trim();
// Kept as raw text: the Lead Checker parses it itself against Konnect Live's
// format.
const createdText = cells[COL_CREATED]?.textContent?.trim() || '';
rowDescriptors.push({ cells, name, registration, source, campaign, key, assigned: assignState.assigned, agentName: assignState.agentName, slaDate, status, createdText });
}

// A lead read with neither phone nor email is read again (a few times at
// most), in case its pop-up had not filled in.
const needsDetails = (d) => {
const existing = previousByKey.get(d.key);
return !existing || (!existing.phone && !existing.email && (existing.detailTries || 0) < DETAIL_MAX_TRIES);
};
const pendingCount = rowDescriptors.filter(needsDetails).length;
let remaining = pendingCount;
setBadgeProgress(remaining);
// Only new leads open a detail modal, which flashes the screen, so the
// overlay is only shown when there are some.
if (pendingCount > 0) showPageFlashOverlay(`Loading new leads… (${remaining} left)`);

for (const d of rowDescriptors) {
const existing = previousByKey.get(d.key);
if (existing && !needsDetails(d)) {
// Keeps cached phone and email only; everything else is taken fresh from d.
customers.push({ ...existing, registration: d.registration, assigned: d.assigned, agentName: d.agentName, slaDate: d.slaDate, status: d.status, createdText: d.createdText });
continue;
}

try {
await waitForTabVisible();
const tierInfo = categorizeTier(d.campaign, d.source);
const details = await extractCustomerDetails(d.cells[0], d.name);

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
detailsRead: details.read,
detailTries: ((existing && existing.detailTries) || 0) + 1,
assigned: d.assigned,
agentName: d.agentName,
slaDate: d.slaDate,
status: d.status,
createdText: d.createdText
});
if (!existing) addedCount++;
} catch (error) {
console.warn('Error processing row:', error && error.message);
} finally {
remaining--;
setBadgeProgress(remaining);
showPageFlashOverlay(`Loading new leads… (${remaining} left)`);
}
}

const removedCount = currentCustomers.filter(c => !seenKeys.has(c.key)).length;
lastSlaDiffCounts = { newCount: addedCount, removedCount };
followAssignments(PAGE_SLA, rowDescriptors);

if (quiet) {
// Only the lead data is loaded. The page the panel belongs to is left
// alone: the checks may have been started from Pending.
currentCustomers = customers;
refreshSendThroughAgents();
invalidateLeadsCache();
return;
}
const startTime = Date.now();
displayPanel(customers, addedCount, removedCount);
const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
console.info(`✅ SLA Report generated in ${totalTime}s (${customers.length} customers, +${addedCount}/-${removedCount})`);
} catch (error) {
console.error('SLA Export Error:', error);
} finally {
setBadgeProgress(0);
extracting = false;
if (quiet) showPageFlashOverlay('Running morning checks…'); else hidePageFlashOverlay();
}
}

// Email, Mobile and Landline are plain text, so no modal is needed here.
async function extractAndExportPending() {
if (extracting || assigning || navigating || runningMorningChecks) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('[SLA Manager] Pending Customers table not found');
showTableNotFoundPanel('Pending Customers');
return;
}
await waitForLeadsTableRows(table);

const previousByKey = new Map(currentPendingCustomers.map(c => [c.key, c]));
const leads = collectPendingCustomers();
const seenKeys = new Set(leads.map(l => l.key));
const addedCount = leads.filter(l => !previousByKey.has(l.key)).length;
const removedCount = currentPendingCustomers.filter(c => !seenKeys.has(c.key)).length;
lastPendingDiffCounts = { newCount: addedCount, removedCount };
followAssignments(PAGE_PENDING, leads);

displayPendingPanel(leads, addedCount, removedCount);
console.info(`✅ Pending Customers report generated (${leads.length} customers, +${addedCount}/-${removedCount})`);
} catch (error) {
console.error('Pending Customers Export Error:', error);
} finally {
setBadgeProgress(0);
extracting = false;
}
}

// Badge entry point: routes to the extraction for this page, or refuses.
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

// ===================================================================
// BADGE LIFECYCLE & RESET
// ===================================================================

function setBadgeProgress(remaining) {
if (!badge) return;
if (remaining > 0) {
badge.textContent = String(remaining);
badge.style.fontSize = '13px';
} else {
badge.innerHTML = svgIcon('clipboard', 14);
badge.style.fontSize = '14px';
}
}

// A badge click always shows the panel, even if it was left minimised: the
// restore button is off-screen with it, and the poll's rebuilds keep the
// minimised state.
async function handleBadgeClick() {
localStorage.setItem(PANEL_STATE_KEY, 'visible');
// Morning Checks often leaves the tab on a page detectPageType() does not
// recognise.
if (currentPanelMode === 'morningChecks') {
displayMorningChecks();
return;
}
// A click while a scan or an assign run is going must not navigate away
// under it.
if (refuseIfBusy()) return;
// Forces Konnect's own refresh too, so the panel shown is current.
await window._refreshLeadsAndPanel();
if (busyReason()) return;
// Also scans Queue by Agent for positions. Run after the refresh, not
// alongside it, since both navigate.
navigating = true;
showPageFlashOverlay('Checking agent queues…');
try {
try {
await refreshAgentQueueSnapshot();
// Angular needs a moment to refill the table after navigating back.
await waitForLeadsTableReady();
} catch (error) {
// A failed queue check is not a reason to withhold the panel.
console.warn('[SLA Manager] Queue check failed during badge activation - showing the panel anyway:', error);
}
// The render sits outside the queue check's try, so its own failure is
// reported below.
if (currentPageType === PAGE_PENDING) displayPendingPanel(currentPendingCustomers, 0, 0, false);
else displayPanel(currentCustomers, 0, 0, false);
} catch (error) {
console.error('[SLA Manager] Panel failed to render after badge activation:', error);
alert('SLA Manager: the panel failed to load after activating.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
} finally {
navigating = false;
hidePageFlashOverlay();
}
}

function attachBadgeHoverEffects() {
badge.addEventListener('mouseenter', () => {
badge.style.transform = 'scale(1.12)';
badge.style.boxShadow = '0 3px 8px rgba(34, 54, 93, 0.45)';
});
badge.addEventListener('mouseleave', () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 2px 6px rgba(34, 54, 93, 0.3)';
});
}

function createBadge() {
const existingItem = document.getElementById('_slaBadgeNavItem');
if (existingItem) existingItem.remove();
const existingBadge = document.getElementById(BADGE_ID);
if (existingBadge) existingBadge.remove();

// Both navbar lists share "nav navbar-nav", so the left one is found by its
// "Client Config" item, not position.
const targetUl = Array.from(document.querySelectorAll('ul.nav.navbar-nav'))
.find(ul => Array.from(ul.querySelectorAll('a')).some(a => a.textContent.trim() === 'Client Config'));

if (!targetUl) {
console.warn('SLA Manager: navbar structure not found, falling back to fixed position');
badge = document.createElement('div');
badge.id = BADGE_ID;
badge.onclick = handleBadgeClick;
document.documentElement.appendChild(badge);
Object.assign(badge.style, {
position: 'fixed', right: '12px', top: '12px', width: '32px', height: '32px',
background: BADGE_COLOR, border: `1px solid ${BADGE_BORDER_COLOR}`, borderRadius: '50%',
boxShadow: '0 2px 6px rgba(34, 54, 93, 0.3)', zIndex: 99999, cursor: 'pointer',
display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
fontWeight: 'bold', color: BADGE_BORDER_COLOR, transition: 'all 0.3s ease'
});
badge.innerHTML = svgIcon('clipboard', 14);
badge.title = 'Extract leads (SLA queue or Pending Customers)';
attachBadgeHoverEffects();
return;
}

// No "dropdown" class: siblings use it for caret behaviour this item lacks.
const navItem = document.createElement('li');
navItem.id = '_slaBadgeNavItem';
Object.assign(navItem.style, {
display: 'flex', alignItems: 'center', height: '50px', padding: '0 8px'
});

badge = document.createElement('div');
badge.id = BADGE_ID;
Object.assign(badge.style, {
boxSizing: 'border-box', width: '32px', height: '32px',
background: BADGE_COLOR, border: `1px solid ${BADGE_BORDER_COLOR}`, borderRadius: '50%',
boxShadow: '0 2px 6px rgba(34, 54, 93, 0.3)', cursor: 'pointer',
display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
fontWeight: 'bold', color: BADGE_BORDER_COLOR, transition: 'all 0.3s ease'
});
badge.innerHTML = svgIcon('clipboard', 14);
badge.title = 'Extract leads (SLA queue or Pending Customers)';
badge.onclick = handleBadgeClick;
attachBadgeHoverEffects();

navItem.appendChild(badge);
targetUl.appendChild(navItem); // last item in the left nav = immediately after "Client Config"
}

// Clear & Stop: stops every timer and listener this tool runs and clears
// its own data. What belongs to Lead Re setup, or is shared with it (the
// National results, the Email Only list, the Post Closure results), stays.
function resetBookmarklet() {
currentCustomers = [];
currentPendingCustomers = [];
currentPageType = null;
extracting = false;
cancelRequested = true;
deferredRedraw = null;
invalidateLeadsCache();

clearInterval(window._slaAutoDetectInterval);
window._slaAutoDetectInterval = null;
// The warning stays switched on for next time; its timer, counts and the
// tab title go.
stopMissedWatch();
missedWarned.due = {};
missedWarned.soon = {};
missedWarned.missed = {};
setTitlePrefix('');
dayRun = { running: false, cancelled: true, text: '', tone: '' };
rescue = { running: false, text: '' };
if (slaVersionState && slaVersionState.timer) clearInterval(slaVersionState.timer);
// The link: no more answers, heartbeats or sends from this page until the
// bookmark is clicked again. The desk's waiting batch is kept for then.
clearInterval(window.__workToolsLinkTimer);
window.__workToolsLinkTimer = null;
window.__workToolsLinkTick = null;
window.__workToolsOnLiveMessage = null;
window.__workToolsOnDeskRequest = null;
window.__slaOnTodayStorage = null;
liveLink.queue = liveLink.queue.filter((b) => b.from !== 'manager');
if (liveLink.sent && liveLink.sent.batch.from === 'manager') liveLink.sent = null;

// The lead card results and the queue snapshot go. The assignment log keeps
// its per-agent counts for the day but loses the customer names.
removeStoredKey(LEAD_CHECKER_IMPORT_KEY);
removeStoredKey(AGENT_QUEUE_SNAPSHOT_KEY);
removeStoredKey(REVIEW_DECISIONS_KEY);
try {
const log = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || '[]');
if (Array.isArray(log)) localStorage.setItem(ASSIGN_LOG_KEY, JSON.stringify(log.map((e) => ({ time: e.time, agent: e.agent, ...(e.tier ? { tier: e.tier } : {}), ...(e.state ? { state: e.state } : {}) }))));
} catch (error) { removeStoredKey(ASSIGN_LOG_KEY); }

document.getElementById('_slaLinkToast')?.remove();
hidePageFlashOverlay();
if (panelElement) {
panelElement.remove();
panelElement = null;
}

if (badge) {
// Remove the wrapping nav li as well as the badge.
const navItem = document.getElementById('_slaBadgeNavItem');
if (navItem) navItem.remove();
else badge.remove();
badge = null;
}

console.info('🔄 SLA Manager stopped - click bookmarklet again to run');
}

// Customer data past one shift is removed when the tool loads, whether or
// not the part of the panel that reads it is ever opened. Each loader drops
// its own key when it is too old.
function purgeExpiredStoredData() {
loadAgentQueueSnapshot();
loadQueueDone();
loadNationalResults();
loadMorningChecksLastRun();
const importState = loadLeadCheckerImportState();
try {
const raw = JSON.parse(localStorage.getItem(LEAD_CHECKER_IMPORT_KEY) || 'null');
if (raw && Array.isArray(raw.results) && raw.results.length !== importState.results.length) saveLeadCheckerImportState(importState);
} catch (error) { removeStoredKey(LEAD_CHECKER_IMPORT_KEY); }
try {
const log = JSON.parse(localStorage.getItem(ASSIGN_LOG_KEY) || 'null');
if (log !== null) {
const kept = Array.isArray(log) ? log.filter((e) => e && isStoredTimeFresh(e.time)) : [];
if (!kept.length) removeStoredKey(ASSIGN_LOG_KEY);
else if (kept.length !== log.length) localStorage.setItem(ASSIGN_LOG_KEY, JSON.stringify(kept));
}
} catch (error) { removeStoredKey(ASSIGN_LOG_KEY); }
const emailOnly = readStoredJson(EMAIL_ONLY_ASSIGNED_KEY);
if (emailOnly && !isStoredTimeFresh(emailOnly.savedAt)) removeStoredKey(EMAIL_ONLY_ASSIGNED_KEY);
const sendThrough = readStoredJson(SEND_THROUGH_KEY);
if (sendThrough && !isStoredTimeFresh(sendThrough.savedAt)) removeStoredKey(SEND_THROUGH_KEY);
// This tool writes the Post Closure results the desk reads.
const desk = readStoredJson(DESK_RESULTS_KEY);
if (desk && Array.isArray(desk.results)) {
const kept = desk.results.filter((r) => r && isStoredTimeFresh(r.checkedAt || desk.savedAt));
try {
if (!kept.length) removeStoredKey(DESK_RESULTS_KEY);
else if (kept.length !== desk.results.length) localStorage.setItem(DESK_RESULTS_KEY, JSON.stringify({ ...desk, results: kept }));
} catch (error) { /* left for the next load */ }
}
}

window._slaResetBookmarklet = resetBookmarklet;

// No names are sent: the panel, page and morning check statuses only.
window._slaReportProblem = function() {
const checks = (typeof morningChecksResults !== 'undefined' && Array.isArray(morningChecksResults) ? morningChecksResults : [])
.map((r) => `${r.key || r.label}: ${r.status || ''}${r.ok === false ? ' (failed)' : ''}`);
reportProblem('SLA Manager', `panel ${currentPanelMode || '-'}, page ${currentPageType || '-'}, ${location.hash}`, checks);
};

// ===================================================================
// PANEL UI TOGGLES
// ===================================================================

// The three sizes lay the panel out differently, so a change of size redraws
// the view that is showing from what is already held.
window._setPanelSize = function(size) {
if (!PANEL_SIZES.includes(size) || !document.getElementById(PANEL_BOX_ID)) return;
localStorage.setItem(PANEL_SIZE_KEY, size);
if (currentPanelMode === 'morningChecks') displayMorningChecks();
else if (currentPageType === PAGE_PENDING || currentPageType === PAGE_SLA) redrawLeadsPanel();
else document.getElementById(PANEL_BOX_ID).dataset.size = size;
};

// The footer switch: standard to full size, and back to standard from
// either of the others.
window._togglePanelSize = function() {
window._setPanelSize(getPanelSize() === 'standard' ? 'full' : 'standard');
};

// A full rebuild, since card order changes, but with invalidateCache false
// because the table data has not changed.
window._toggleLeadCheckerPrioritySort = function() {
const next = !isLeadCheckerPrioritySortEnabled();
localStorage.setItem(LEAD_CHECKER_PRIORITY_SORT_KEY, next ? '1' : '0');
if (currentPageType === PAGE_PENDING) {
displayPendingPanel(currentPendingCustomers, 0, 0, false);
} else if (currentPageType === PAGE_SLA) {
displayPanel(currentCustomers, 0, 0, false);
}
};

window._toggleMinimizePanel = function() {
const panel = document.getElementById(PANEL_BOX_ID);
if (!panel) return;
const isHidden = panel.style.transform === 'translateX(150%)';
panel.style.transform = isHidden ? '' : 'translateX(150%)';
localStorage.setItem(PANEL_STATE_KEY, isHidden ? 'visible' : 'hidden');
};

// Folds or unfolds one group of the list and remembers it.
function toggleListSection(sectionId) {
const content = document.getElementById(sectionId);
if (!content) return;
const isHidden = content.style.display === 'none';
content.style.display = isHidden ? 'block' : 'none';
const heading = document.getElementById('toggle-' + sectionId);
if (heading) heading.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
setSectionCollapsed(sectionId, !isHidden);
}

window._toggleTier = toggleListSection;
window._toggleCallbackType = toggleListSection;

// The row opens its details: toggleEl is the row, the details follow it.
window._toggleCustomerContact = function(toggleEl) {
const wrapper = toggleEl.nextElementSibling;
if (!wrapper) return;
const opening = wrapper.style.display === 'none';
wrapper.style.display = opening ? 'grid' : 'none';
toggleEl.setAttribute('aria-expanded', opening ? 'true' : 'false');
};

// Assign and Filters are mutually exclusive tabs.
function setActiveAssignTab(tab) {
const assignBody = document.getElementById('assignSectionBody');
const filtersBody = document.getElementById('filtersZoneBody');
const assignPill = document.getElementById('assignTabPill');
const filtersPill = document.getElementById('filtersTabPill');
if (!assignBody || !filtersBody || !assignPill || !filtersPill) return;
const showAssign = tab === 'assign';
assignBody.style.display = showAssign ? 'flex' : 'none';
filtersBody.style.display = showAssign ? 'none' : 'flex';
assignPill.setAttribute('aria-selected', showAssign ? 'true' : 'false');
filtersPill.setAttribute('aria-selected', showAssign ? 'false' : 'true');
saveAssignSettings({ filtersOpen: !showAssign });
if (!showAssign) syncAllWheelPositions();
}

// The "N agents online" control: opens the list of agents with their tick
// boxes, All, None and the limit. Remembered across redraws.
window._toggleAgentList = function(button) {
const pane = document.getElementById('assignAgentPane');
if (!pane) return;
const open = pane.hidden;
pane.hidden = !open;
button.setAttribute('aria-expanded', open ? 'true' : 'false');
saveAssignSettings({ agentsOpen: open });
};

// Email only mode is the Email only filter: the chip beside Customer First
// and the tick box in Filters are the same switch. The chip also brings the
// Assign tab forward, since that is where the run starts.
window._setEmailOnlyMode = function(on) {
const box = document.getElementById('assignEmailOnly');
if (!box) return;
box.checked = typeof on === 'boolean' ? on : !box.checked;
if (box.checked) setActiveAssignTab('assign');
window._updateAssignPreview();
};

// History from the More menu: shown in the Assign tab, under the agents.
window._showAssignHistory = function() {
const panel = document.getElementById('assignHistoryPanel');
if (!panel) return;
setActiveAssignTab('assign');
window._toggleAssignHistory();
if (panel.style.display !== 'none' && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest' });
};

window._toggleFiltersZone = function() {
setActiveAssignTab('filters');
};

window._toggleAssignSection = function() {
setActiveAssignTab('assign');
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

// ===================================================================
// ASSIGN EXECUTION & PREVIEW
// ===================================================================

// Shows what "Assign" would do before it is clicked, so an empty match, a
// large batch or no agent selected is visible up front.
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


// Each due tile assigns exactly the leads it counts, so it uses every tier
// rather than the checked ones, matching renderSlaDueSummary.
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
const limited = applyAssignLimit(prioritized, agents);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locateAssignCell, PAGE_SLA);
};

// The Pending version: every callback type, matching renderPendingDueSummary.
// hoursAhead 0 is this hour, 1 is next hour.
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
const limited = applyAssignLimit(prioritized, agents);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locatePendingAssignCell, PAGE_PENDING);
};
// Shared by the manual Assign button and the tiles: both build a plan and
// hand it off the same way.
const ASSIGN_CONFIRM_THRESHOLD = 10;

// options.noConfirm: Rescue, which has no prompt.
async function executeAssignmentRun(plan, locateCellFn, pageType, options) {
const button = document.getElementById('assignRunButton');
const log = document.getElementById('assignResultsLog');
if (!button || !log) return null;

const busy = busyReason();
if (busy) {
log.textContent = `Not yet: ${busy}. Try again when it has finished.`;
return null;
}

if (plan.length === 0) {
log.textContent = 'No unassigned leads match.';
return null;
}

if (plan.length >= ASSIGN_CONFIRM_THRESHOLD && !(options && options.noConfirm)) {
const agentCount = new Set(plan.map(p => p.agent.id)).size;
const proceed = window.confirm(`About to assign ${plan.length} leads to ${agentCount} agent${agentCount === 1 ? '' : 's'}. Proceed?`);
if (!proceed) return null;
}

// Stays enabled during a run: clicking it again cancels, through the same
// onclick, whichever entry point started the run.
button.disabled = false;
button.classList.add('running');
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
button.classList.remove('running');
button.textContent = 'Assign';
// A lead that may have gone through is not offered for a retry.
const failedEntries = results.filter(r => !r.ok && !r.unconfirmed).map(r => ({ lead: r.lead, agent: r.agent }));
lastFailedAssignmentPlan = failedEntries.length > 0 ? failedEntries : null;
lastFailedLocateCellFn = failedEntries.length > 0 ? locateCellFn : null;
lastFailedPageType = failedEntries.length > 0 ? pageType : null;
appendAssignmentLog(results, pageType);
console.info(`✅ Assigned ${succeeded}/${results.length} leads`);

// The assign click only changes the live table, so patch the cached leads and
// redraw. The results summary is rendered after, or the redraw would wipe it.
if (succeeded > 0) {
// New assignments change queue positions.
navigating = true;
showPageFlashOverlay('Checking agent queues…');
try {
await refreshAgentQueueSnapshot();
// Angular needs a moment to refill the table after navigating back, or the
// redraw shows "0 leads due".
await waitForLeadsTableReady();
} catch (error) {
// A failed queue rescan must not hide the results of an assign run that
// already succeeded.
console.warn('[SLA Manager] Queue check failed after assign run - showing results anyway:', error);
} finally {
navigating = false;
hidePageFlashOverlay();
}
// Guarded so a render error still lets the results summary and return value
// happen.
try {
const successByKey = new Map(results.filter(r => r.ok).map(r => [r.lead.key, r.agent.name]));
patchCachedLeadsAssigned(successByKey);
if (pageType === PAGE_PENDING) {
currentPendingCustomers = currentPendingCustomers.map((c) => successByKey.has(c.key) ? { ...c, assigned: true, agentName: successByKey.get(c.key) } : c);
displayPendingPanel(currentPendingCustomers, 0, 0, false);
} else {
currentCustomers = currentCustomers.map((c) => successByKey.has(c.key) ? { ...c, assigned: true, agentName: successByKey.get(c.key) } : c);
refreshSendThroughAgents();
displayPanel(currentCustomers, 0, 0, false);
}
} catch (error) {
console.error('[SLA Manager] Panel failed to render after assign run:', error);
alert('SLA Manager: leads were assigned, but the panel failed to reload.\n\n' + (error && error.stack ? error.stack : error) + '\n\nPlease report this exact message.');
}
}
// Results that arrived during the run were held back so its progress
// stayed on screen.
flushDeferredRedraw();
renderAssignResultsSummary(results);
// Puts the count back on the Assign button, whichever copy is now mounted.
if (window._updateAssignPreview) window._updateAssignPreview();
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

// In Email only mode the leads go to the agent chosen on the Email only
// bar, unless that is left on the ticked agents.
const emailOnlyAgentId = emailOnly ? (document.getElementById('_slaEoAgent')?.value || '') : '';
const agents = getAgentRoster().filter(a => (emailOnlyAgentId ? a.id === emailOnlyAgentId : selectedAgentIds.has(a.id)));
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

const limited = applyAssignLimit(prioritized, agents);
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

const limited = applyAssignLimit(prioritized, agents);
const plan = roundRobinAssign(limited, agents);
await executeAssignmentRun(plan, locatePendingAssignCell, PAGE_PENDING);
};


// Assigns one lead to one chosen agent via a one-item runAssignmentPlan,
// outside the round-robin rotation. Sets `assigning` so the poll does not
// collide with it; a batch-button click meanwhile reads as a harmless cancel.
window._manualAssignLead = async function(pageType, leadKey, agentId, selectEl) {
if (!agentId || !selectEl) return;
const agent = getAgentRoster().find(a => a.id === agentId);
const wrapper = selectEl.parentElement;
if (!agent || !wrapper) return;

if (busyReason()) {
selectEl.value = '';
refuseIfBusy();
return;
}

wrapper.innerHTML = `<span style="font-size: 11px; color: var(--wb-muted, #5b6577);">Assigning…</span>`;

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

appendAssignmentLog(results, pageType);

const result = results[0];
if (result.ok) {
// Patch the cache and redraw, as the batch path does.
const successByKey = new Map([[lead.key, agent.name]]);
patchCachedLeadsAssigned(successByKey);
if (pageType === PAGE_PENDING) {
currentPendingCustomers = currentPendingCustomers.map((c) => c.key === lead.key ? { ...c, assigned: true, agentName: agent.name } : c);
displayPendingPanel(currentPendingCustomers, 0, 0, false);
} else {
currentCustomers = currentCustomers.map((c) => c.key === lead.key ? { ...c, assigned: true, agentName: agent.name } : c);
refreshSendThroughAgents();
displayPanel(currentCustomers, 0, 0, false);
}
} else {
wrapper.innerHTML = `<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
<span style="font-size: 11px; color: #dc2626;">${escapeHtml(result.reason || 'Failed')}</span>
${renderManualAssignPicker(leadKey, pageType)}
</div>`;
flushDeferredRedraw();
}
};

// Filters cards by name and expands matching sections without touching the
// saved collapse state, so clearing the search restores it.
window._filterCustomerSearch = function(query) {
const q = query.trim().toLowerCase();
document.querySelectorAll('.customer-card').forEach((card) => {
const match = !q || (card.dataset.customerName || '').includes(q);
card.style.display = match ? '' : 'none';
});
document.querySelectorAll('.collapsible-section').forEach((section) => {
if (!q) {
section.style.display = isSectionCollapsed(section.id) ? 'none' : 'block';
return;
}
const hasMatch = Array.from(section.querySelectorAll('.customer-card')).some(c => c.style.display !== 'none');
section.style.display = hasMatch ? 'block' : 'none';
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
renderFairShareLine();

let count;
if (currentPageType === PAGE_PENDING) {
const selectedTypes = new Set(
Array.from(document.querySelectorAll('.assign-callback-checkbox:checked')).map(el => el.value)
);
const cutoffInput = document.getElementById('assignCutoffTime');
const cutoffDate = parseCutoffFromInput(cutoffInput ? cutoffInput.value : '');
const leads = getCachedPendingCustomers();
count = filterPendingLeads(leads, { callbackTypes: selectedTypes, cutoffDate }).length;

// Keep the per-type counts in step with the cutoff wheel.
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

// Same for the tier counts.
const tierCounts = computeSlaTierCounts(leads, windowMinutes);
[1, 2, 3, 4].forEach((t) => {
const el = document.getElementById(`tier-count-${t}`);
if (el) el.textContent = `(${tierCounts[t - 1]})`;
});
const tierLabel = document.getElementById('_slaTierLabel');
if (tierLabel) tierLabel.textContent = tierFilterLabel(selectedTiers);
}

// Email only mode: its bar takes the place of the agents row, and the leads
// go to the agent chosen there unless it is left on the ticked agents.
const emailOnlyOn = currentPageType !== PAGE_PENDING && (document.getElementById('assignEmailOnly')?.checked || false);
const emailOnlyBar = document.getElementById('_slaEoBar');
const normalBar = document.getElementById('_slaAssignNormal');
if (emailOnlyBar && normalBar) { emailOnlyBar.hidden = !emailOnlyOn; normalBar.hidden = emailOnlyOn; }
const emailOnlyChip = document.getElementById('_slaEoChip');
if (emailOnlyChip) emailOnlyChip.setAttribute('aria-pressed', emailOnlyOn ? 'true' : 'false');
const emailOnlyAgent = document.getElementById('_slaEoAgent');
const emailOnlyNote = document.getElementById('_slaEoAgentNote');
if (emailOnlyNote) emailOnlyNote.textContent = emailOnlyAgent && emailOnlyAgent.value && emailOnlyAgent.value === emailOnlyAgent.dataset.last ? '(last used for Email only)' : '';

const agentCount = emailOnlyOn && emailOnlyAgent && emailOnlyAgent.value ? 1 : document.querySelectorAll('.assign-agent-checkbox:checked').length;
const rawCount = count;
const limitRaw = document.getElementById('assignLimitInput')?.value;
const limit = limitRaw ? Number(limitRaw) : null;
const limitPerAgent = document.getElementById('assignLimitPerAgent')?.checked || false;
if (limit && limit > 0) count = Math.min(count, limitPerAgent ? limit * agentCount : limit);
const cappedSuffix = count < rawCount ? ` (capped from ${rawCount})` : '';

// The filled button says how many leads it would assign. Left alone during
// a run, when it reads as the way to cancel, and with no agents online.
const button = document.getElementById('assignRunButton');
if (button && !assigning && !button.disabled) {
button.textContent = emailOnlyOn ? `Assign ${count} Email only` : (count > 0 && agentCount > 0 ? `Assign ${count}` : 'Assign');
}
const emailOnlyCountEl = document.getElementById('_slaEoCount');
if (emailOnlyCountEl) emailOnlyCountEl.textContent = `${count} Email only lead${count === 1 ? '' : 's'}`;

if (agentCount === 0) {
previewEl.textContent = count > 0
? `${count} lead${count === 1 ? '' : 's'} match${cappedSuffix}, but no agents are selected`
: 'Select at least one agent';
previewEl.style.color = 'var(--wb-danger, #c62828)';
return;
}

if (count === 0) {
previewEl.textContent = 'No leads match the current filters';
previewEl.style.color = 'var(--wb-danger, #c62828)';
return;
}

const perAgent = Math.floor(count / agentCount);
const remainder = count % agentCount;
const splitLabel = remainder === 0 ? `${perAgent} each` : `about ${perAgent} each`;
previewEl.textContent = `${count} lead${count === 1 ? '' : 's'}${cappedSuffix} to ${agentCount} agent${agentCount === 1 ? '' : 's'}, ${splitLabel}`;
previewEl.style.color = '';
};

window._refreshAssignSection = function() {
const container = document.getElementById('assignSectionContainer');
if (!container) return;
invalidateLeadsCache();

// Keep deliberate exclusions and the timeframe across a manual refresh.
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

// ===================================================================
// MISSED LEAD WARNING
//
// For when the panel is hidden or the tab is not in view: the tab title
// carries how many unassigned leads are missed, due within 5 minutes and
// due within 15, and a desktop notification says when more join each. A
// lead is counted once, at its most urgent. Counts only, never
// a customer's name. Off unless switched on in More. While it is on the
// SLA list is scanned again every 2 minutes, since nothing else keeps it
// fresh.
// ===================================================================

const MISSED_WARNING_KEY = '_slaMissedWarning';
const MISSED_WARNING_MINUTES = 15;
const MISSED_URGENT_MINUTES = 5;
// scanMs: how often the list is scanned again. tickMs: how often the counts
// are brought up to date in between, as leads come due with time alone. A
// test may shorten these through window.__slaWatchTiming.
const WATCH_TIMING = { scanMs: 120000, tickMs: 15000 };
function watchTiming() {
return { ...WATCH_TIMING, ...(window.__slaWatchTiming || {}) };
}
let lastWatchScanAt = 0;
// Leads already warned about, kept on window so clicking the bookmark again
// does not warn about them twice.
const missedWarned = window.__slaMissedWarned || (window.__slaMissedWarned = { due: {}, soon: {}, missed: {} });

function isMissedWarningOn() {
try { return localStorage.getItem(MISSED_WARNING_KEY) === '1'; } catch (error) { return false; }
}

// Pure. The keys of the unassigned leads that are missed (marked Missed, or
// past their SLA time), due within 5 minutes (soon) and due within 15 (due).
function missedWarningKeys(leads, now) {
const missed = [];
const soon = [];
const due = [];
leads.forEach((l) => {
if (l.assigned) return;
const minutes = l.slaDate ? (new Date(l.slaDate).getTime() - now) / 60000 : null;
if (l.status === 'Missed' || (minutes !== null && minutes <= 0)) missed.push(l.key);
else if (minutes !== null && minutes <= MISSED_URGENT_MINUTES) soon.push(l.key);
else if (minutes !== null && minutes <= MISSED_WARNING_MINUTES) due.push(l.key);
});
return { missed, soon, due };
}

// Pure. "(1 missed, 2 in 5 min, 3 in 15) ", or '' when there are none.
function missedTitlePrefix(missedCount, soonCount, dueCount) {
const parts = [missedCount ? `${missedCount} missed` : '', soonCount ? `${soonCount} in ${MISSED_URGENT_MINUTES} min` : '', dueCount ? `${dueCount} in ${MISSED_WARNING_MINUTES}` : ''].filter(Boolean);
return parts.length ? `(${parts.join(', ')}) ` : '';
}

// Pure. One sentence for the leads newly due within 15 minutes or missed in
// this scan, and one for those newly within 5.
function missedNotificationText(dueCount, missedCount) {
const leads = (n) => `${n} lead${n === 1 ? '' : 's'}`;
const parts = [];
if (dueCount) parts.push(`${leads(dueCount)} due within ${MISSED_WARNING_MINUTES} minutes`);
if (missedCount) parts.push(parts.length ? `${missedCount} missed` : `${leads(missedCount)} missed`);
return parts.length ? `${parts.join(', ')}. Unassigned.` : '';
}
function urgentNotificationText(soonCount) {
return soonCount ? `${soonCount} lead${soonCount === 1 ? '' : 's'} due within ${MISSED_URGENT_MINUTES} minutes. Unassigned.` : '';
}

// Pure. Which leads have not been warned about yet, and the record once
// they have. A lead is warned about once at 15 minutes, once again at 5 and
// once when it goes missed. One first seen inside 5 minutes skips the 15.
function newMissedWarnings(keys, warned) {
const was = { due: warned.due || {}, soon: warned.soon || {}, missed: warned.missed || {} };
const newMissed = keys.missed.filter((k) => !was.missed[k]);
const newSoon = keys.soon.filter((k) => !was.soon[k] && !was.missed[k]);
const newDue = keys.due.filter((k) => !was.due[k] && !was.soon[k] && !was.missed[k]);
const due = { ...was.due };
const soon = { ...was.soon };
const missed = { ...was.missed };
keys.due.forEach((k) => { due[k] = 1; });
keys.soon.forEach((k) => { soon[k] = 1; due[k] = 1; });
keys.missed.forEach((k) => { missed[k] = 1; });
return { newDue: newDue.length, newSoon: newSoon.length, newMissed: newMissed.length, due, soon, missed };
}

// The page's own title is whatever follows our counts, so a title Konnect
// changes meanwhile is kept.
const MISSED_TITLE_PATTERN = /^\((?:\d+ missed|\d+ in 5 min|\d+ in 15)(?:, (?:\d+ in 5 min|\d+ in 15))*\) /;
function setTitlePrefix(prefix) {
const own = document.title.replace(MISSED_TITLE_PATTERN, '');
if (document.title !== prefix + own) document.title = prefix + own;
}

function isPanelOutOfView() {
return document.hidden || !document.hasFocus() || !panelElement || localStorage.getItem(PANEL_STATE_KEY) === 'hidden';
}

// The two levels have their own tag, so one does not replace the other.
function showMissedNotification(text, tag) {
try {
if (!text || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
const notification = new Notification('SLA Manager', { body: text, tag, renotify: true });
notification.onclick = () => { window.focus(); notification.close(); };
return true;
} catch (error) {
return false;
}
}

// The SLA table as it stands when this tab is on it and nothing is using
// it; otherwise the leads from the last scan, which still come due with time.
function watchedLeads() {
if (!busyReason() && detectPageType() === PAGE_SLA) return collectAssignableLeads();
return currentCustomers;
}

function updateMissedWarning() {
if (!isMissedWarningOn()) return;
const keys = missedWarningKeys(watchedLeads(), Date.now());
setTitlePrefix(missedTitlePrefix(keys.missed.length, keys.soon.length, keys.due.length));
const fresh = newMissedWarnings(keys, missedWarned);
missedWarned.due = fresh.due;
missedWarned.soon = fresh.soon;
missedWarned.missed = fresh.missed;
// With the panel in view the tiles already say it.
if (!isPanelOutOfView()) return;
showMissedNotification(urgentNotificationText(fresh.newSoon), 'sla-manager-due-5');
showMissedNotification(missedNotificationText(fresh.newDue, fresh.newMissed), 'sla-manager-due-15');
}

// Not while anything else is scanning, assigning, checking or sending, a
// customer pop-up is open, or the user is in the More menu or a drop-down.
function canWatchScan() {
if (busyReason() || dayRun.running || rescue.running || currentPanelMode === 'morningChecks') return false;
if (findDetailModal()) return false;
if (liveLink.sent || liveLink.queue.some((b) => b.from === 'manager')) return false;
const menu = document.getElementById('_slaMoreMenu');
if ((menu && !menu.hidden) || isHoldingPanelInput()) return false;
return detectPageType() === PAGE_SLA;
}

async function missedWatchTick() {
if (!isMissedWarningOn()) { stopMissedWatch(); return; }
if (Date.now() - lastWatchScanAt >= watchTiming().scanMs && canWatchScan()) {
lastWatchScanAt = Date.now();
try { await window._refreshLeadsAndPanel({ quiet: true }); } catch (error) { console.warn('[SLA Manager] The scan for the missed lead warning failed:', error && error.message); }
if (!busyReason() && detectPageType() === PAGE_SLA) followAssignments(PAGE_SLA, collectAssignableLeads());
}
updateMissedWarning();
}

function stopMissedWatch() {
clearInterval(window._slaMissedWatchInterval);
window._slaMissedWatchInterval = null;
}

function startMissedWatch() {
stopMissedWatch();
lastWatchScanAt = Date.now();
window._slaMissedWatchInterval = setInterval(missedWatchTick, watchTiming().tickMs);
updateMissedWarning();
}

// Asks for notifications once. The title works whatever the answer.
function askForMissedNotifications() {
const say = (permission) => showToast(permission === 'granted'
? 'Warnings are on: the tab title shows the counts and a notification says when more leads are due or missed.'
: 'Warnings are on, in the tab title only: notifications are not allowed for this site.');
if (typeof Notification === 'undefined') { say('denied'); return; }
if (Notification.permission !== 'default') { say(Notification.permission); return; }
try {
Promise.resolve(Notification.requestPermission()).then(say, () => say('denied'));
} catch (error) {
say('denied');
}
}

window._toggleMissedWarning = function(item) {
const on = !isMissedWarningOn();
try { localStorage.setItem(MISSED_WARNING_KEY, on ? '1' : '0'); } catch (error) { /* stays off */ }
const state = item && item.querySelector('em');
if (state) state.textContent = isMissedWarningOn() ? 'on' : 'off';
if (isMissedWarningOn()) {
askForMissedNotifications();
startMissedWatch();
} else {
stopMissedWatch();
setTitlePrefix('');
}
};

runSelfTest('missedWarningSelfTest', function missedWarningSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
const now = Date.now();
const lead = (key, mins, over) => ({ key, slaDate: mins === null ? null : new Date(now + mins * 60000), status: 'Pending', assigned: false, ...over });
const leads = [
lead('a', -20, { status: 'Missed' }), lead('b', -1), lead('c', 4), lead('d', 15), lead('e', 16),
lead('f', 3, { assigned: true }), lead('g', -30, { status: 'Missed', assigned: true }), lead('h', null), lead('i', 6)
];
const keys = missedWarningKeys(leads, now);
check('missed is marked Missed or past its time; then within 5 minutes; then within 15; assigned leads never count', keys, { missed: ['a', 'b'], soon: ['c'], due: ['d', 'i'] });
check('the title prefix', [[1, 2, 3], [2, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 3], [0, 0, 0]].map(([m, s, d]) => missedTitlePrefix(m, s, d)), ['(1 missed, 2 in 5 min, 3 in 15) ', '(2 missed) ', '(1 in 5 min) ', '(1 in 15) ', '(2 missed, 3 in 15) ', '']);
check('the prefix is found again whatever the counts', ['(1 missed, 2 in 5 min, 3 in 15) Konnect', '(1 in 15) Konnect', '(12 missed) Konnect', '(4 in 5 min, 1 in 15) Konnect', '(beta) Konnect'].map((t) => t.replace(MISSED_TITLE_PATTERN, '')), ['Konnect', 'Konnect', 'Konnect', 'Konnect', '(beta) Konnect']);
check('the 15 minute notification', [[3, 1], [1, 0], [0, 2], [0, 0]].map(([d, m]) => missedNotificationText(d, m)), ['3 leads due within 15 minutes, 1 missed. Unassigned.', '1 lead due within 15 minutes. Unassigned.', '2 leads missed. Unassigned.', '']);
check('the 5 minute notification', [2, 1, 0].map(urgentNotificationText), ['2 leads due within 5 minutes. Unassigned.', '1 lead due within 5 minutes. Unassigned.', '']);
const first = newMissedWarnings(keys, { due: {}, soon: {}, missed: {} });
check('every lead is new the first time', [first.newDue, first.newSoon, first.newMissed], [2, 1, 2]);
const again = newMissedWarnings(keys, first);
check('and none the second', [again.newDue, again.newSoon, again.newMissed], [0, 0, 0]);
const later = newMissedWarnings({ missed: ['a', 'b', 'c'], soon: ['d'], due: ['i', 'e'] }, first);
check('a lead warns once more at 5 minutes and once more when missed; a lead newly within 15 warns once', [later.newDue, later.newSoon, later.newMissed], [1, 1, 1]);
check('a lead first seen inside 5 minutes is not also warned about at 15', newMissedWarnings({ missed: [], soon: [], due: ['c'] }, first).newDue, 0);
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager missed-warning self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager missed-warning self-test passed');
}
});

// ===================================================================
// START MY DAY
//
// The button at the top of Checks. One press for the morning: a scan, the
// morning checks, then Send to the Lead Checker, each through the function
// its own button uses. It is also a way to open the Lead Checker: the one
// Konnect Live tab is opened or brought forward at the click, while the
// browser still allows it, and the link comes up while the scan and checks
// run. Cancel takes effect when the step in hand finishes; the checks
// cannot be cut short.
// ===================================================================

const DAY_STEPS = ['scan', 'morning checks', 'send to the Lead Checker'];
// loginWaitMs: how long Send waits for a logged out Konnect Live to log
// back in. A test may shorten it through window.__slaDayTiming.
const DAY_TIMING = { loginWaitMs: 120000 };
function dayTiming() {
return { ...DAY_TIMING, ...(window.__slaDayTiming || {}) };
}
// text is the strip's one line ('' for no strip). tone 'warn' is a stop.
let dayRun = { running: false, cancelled: false, text: '', tone: '' };

// Pure.
function dayStepText(step) {
return `Start my day: ${step} of ${DAY_STEPS.length}, ${DAY_STEPS[step - 1]}`;
}

function renderDayStrip() {
if (!dayRun.text) return '<div id="_slaDayStrip" hidden></div>';
const button = dayRun.running
? (dayRun.cancelled ? '' : '<button type="button" class="sla-sec tight" onclick="window._cancelStartMyDay()" title="Stops once the step in hand has finished">Cancel</button>')
: `<button type="button" class="sla-sec tight" onclick="window._cancelStartMyDay()" title="Close this line" aria-label="Close this line">${svgIcon('x', 12)}</button>`;
return `<div id="_slaDayStrip" class="sla-link sla-day" role="status" data-tone="${dayRun.tone || ''}">
<span aria-hidden="true" class="sla-dot ${dayRun.running ? 'busy' : (dayRun.tone === 'warn' ? 'warn' : '')}"></span>
<span class="sla-grow">${escapeHtml(dayRun.text)}</span>${button}
</div>`;
}

function showDayStrip(text, tone) {
dayRun.text = text;
dayRun.tone = tone || '';
const strip = document.getElementById('_slaDayStrip');
if (strip) strip.outerHTML = renderDayStrip();
const button = document.getElementById('_slaStartDayBtn');
if (button) {
button.disabled = dayRun.running;
button.querySelector('span').textContent = dayRun.running ? 'Running…' : 'Start my day';
}
}

window._cancelStartMyDay = function() {
if (!dayRun.running) { showDayStrip(''); return; }
dayRun.cancelled = true;
showDayStrip(`Start my day: stopping once the ${DAY_STEPS[dayRun.step - 1]} step finishes`);
};

window._startMyDay = async function() {
if (dayRun.running) return;
const stop = (message) => { dayRun.running = false; showDayStrip(`Start my day stopped. ${message}`, 'warn'); };
const busy = busyReason();
if (busy) { stop(`Not yet: ${busy}. Press Start my day again when it has finished.`); return; }
// Before anything is awaited, so the browser still counts it as the click.
// A link that is up and working is left alone.
if (!isLiveLinked() || liveLink.state === 'loggedOut') {
if (openLiveTab() && !isLiveLinked()) showToast('Konnect Live is opening. Click Work Tools there to start the Lead Checker, then come back to this tab: the scan and checks run here.');
}

dayRun = { running: true, cancelled: false, step: 0, text: '', tone: '' };
const begin = (step) => { dayRun.step = step; showDayStrip(dayStepText(step)); };
const cancelledAfter = (step) => {
if (!dayRun.cancelled) return false;
dayRun.running = false;
showDayStrip(`Start my day cancelled after step ${step} of ${DAY_STEPS.length}. Nothing was sent.`, 'warn');
return true;
};
try {
begin(1);
// The Checks view is often left on another Konnect page.
if (!detectPageType()) {
window.location.hash = findSlaPageHash();
await waitForSlaPage();
}
if (!detectPageType()) { stop('The SLA page could not be opened. Open the SLA queue, then press Start my day again.'); return; }
await window._refreshLeadsAndPanel();
if (cancelledAfter(1)) return;
if (busyReason() || (currentPageType !== PAGE_SLA && currentPageType !== PAGE_PENDING)) { stop('The leads could not be scanned. Press Scan again in More, then Start my day again.'); return; }

begin(2);
currentPanelMode = 'morningChecks';
morningChecksSubView = null;
await window._runAllMorningChecks();
if (cancelledAfter(2)) return;

begin(3);
const exported = currentLeadCheckerExport();
if (!exported.count) {
dayRun.running = false;
showDayStrip('Start my day: done. There were no leads to send.');
return;
}
const leadsText = `${exported.count} lead${exported.count === 1 ? '' : 's'}`;
if (liveLink.state === 'loggedOut') {
showDayStrip(`Start my day: 3 of ${DAY_STEPS.length}, Konnect Live is logging back in`);
const deadline = Date.now() + dayTiming().loginWaitMs;
while (liveLink.state === 'loggedOut' && Date.now() < deadline && !dayRun.cancelled) await sleep(250);
if (cancelledAfter(2)) return;
}
// Send as the Send button does: the batch waits in the queue until the
// Lead Checker says it is ready.
if (!sendBatchToLeadChecker('leads', exported.tsv)) { stop('The scan and the morning checks are done, but Konnect Live could not be opened. Allow pop-ups for this site, then press Send.'); return; }
dayRun.running = false;
const waiting = liveLink.queue.some((b) => b.from === 'manager' && b.kind === 'leads');
if (!isLiveLinked()) showDayStrip('Start my day: scan and checks done. Click Work Tools on the Konnect Live tab: the leads are waiting to send.', 'warn');
else if (liveLink.state === 'loggedOut') showDayStrip('Start my day: scan and checks done. Konnect Live is still logged out. Press Login on the Konnect Live tab: the leads are waiting to send.', 'warn');
else if (waiting) showDayStrip(`Start my day: done. ${leadsText} will go to the Lead Checker when it is free.`);
else showDayStrip(`Start my day: done. ${leadsText} sent to the Lead Checker.`);
} catch (error) {
console.error('[SLA Manager] Start my day failed:', error && error.message);
stop(`Something went wrong in the ${DAY_STEPS[Math.max(dayRun.step, 1) - 1]} step. Run the rest from their own buttons.`);
} finally {
dayRun.running = false;
}
};

runSelfTest('startMyDaySelfTest', function startMyDaySelfTest() {
const expected = ['Start my day: 1 of 3, scan', 'Start my day: 2 of 3, morning checks', 'Start my day: 3 of 3, send to the Lead Checker'];
const actual = [1, 2, 3].map(dayStepText);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
reportSelfTestFailure(`SLA Manager start-my-day self-test FAILED:\nexpected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
} else {
console.info('SLA Manager start-my-day self-test passed');
}
});

// ===================================================================
// RESCUE
//
// For leads about to go missed while they sit in a queue. One press does
// what was done by hand: Clear Queue (Konnect can only clear the whole
// queue), a new scan, then the leads that are missed or due within 15
// minutes are assigned, most urgent first, to the ticked agents who are
// free. No prompt, like Clear Queue. The other leads stay unassigned.
// ===================================================================

// The agent statuses that count as free to take a rescued lead, matched on
// the whole status as Konnect shows it.
const FREE_AGENT_STATUSES = [/^available$/i, /^wrap[\s-]*up$/i, /^wash[\s-]*up$/i];
const RESCUE_WINDOW_MINUTES = 15;
let rescue = { running: false, text: '' };

function isAgentFree(agent) {
const status = String((agent && agent.status) || '').trim();
return FREE_AGENT_STATUSES.some((pattern) => pattern.test(status));
}

// Pure. Leads that are missed or due within 15 minutes, queued or not.
function rescueCount(leads, now) {
return leads.filter((l) => l.status === 'Missed' || (l.slaDate && (new Date(l.slaDate).getTime() - now) / 60000 <= RESCUE_WINDOW_MINUTES)).length;
}

// Pure. What Rescue did, in one line. skipped: the statuses of the ticked
// agents who were not free.
function rescueNoticeText({ cleared, assigned, agentCount, failed, skipped }) {
const parts = [cleared ? 'Cleared the queue.' : 'The queue could not be confirmed as cleared.'];
if (agentCount === 0) parts.push('No ticked agent is Available or in wrap up, so nothing was assigned.');
else if (assigned === 0 && !failed) parts.push('No lead is missed or due within 15 minutes now, so nothing was assigned.');
else parts.push(`${assigned} lead${assigned === 1 ? '' : 's'} assigned to ${agentCount} agent${agentCount === 1 ? '' : 's'}, most urgent first.`);
if (failed) parts.push(`${failed} could not be assigned.`);
if (skipped.length) {
const statuses = Array.from(new Set(skipped.map((s) => String(s || '').trim() || 'no status')));
parts.push(`${skipped.length} agent${skipped.length === 1 ? '' : 's'} skipped: ${statuses.join(', ')}.`);
}
return parts.join(' ');
}

// Shown only when there is something to rescue, or a notice to read.
function renderRescueBar() {
const count = rescueCount(getCachedAssignableLeads(), Date.now());
if (!count && !rescue.text && !rescue.running) return '<div id="_slaRescueBar" hidden></div>';
const button = count || rescue.running
? `<button type="button" id="_slaRescueBtn" class="sla-sec caution" onclick="window._rescueLeads()" ${rescue.running ? 'disabled' : ''} title="Rescue: clears the whole queue (Konnect's Clear Queues, no undo), scans again, then assigns the leads that are missed or due within ${RESCUE_WINDOW_MINUTES} minutes, most urgent first, to the ticked agents who are Available or in wrap up. No prompt. Every other lead is left unassigned">${rescue.running ? 'Rescuing…' : `Rescue ${count}`}</button>`
: '';
return `<div id="_slaRescueBar" class="sla-bar">${button}<span id="_slaRescueLine" class="sla-small sla-grow" role="status">${escapeHtml(rescue.text)}</span></div>`;
}

function showRescue(text) {
rescue.text = text;
const bar = document.getElementById('_slaRescueBar');
if (bar) bar.outerHTML = renderRescueBar();
}

window._rescueLeads = async function() {
// Single fire: a second press while it runs does nothing.
if (rescue.running) return;
if (refuseIfBusy()) return;
if (detectPageType() !== PAGE_SLA) return;
// The ticked agents, from the saved choice: the tick boxes are not drawn
// while every lead is assigned.
const excluded = new Set(loadAssignSettings().excludedAgentIds || []);
const ticked = () => getAgentRoster().filter((a) => !excluded.has(a.id));
// Nothing is cleared when it is already known nobody could take the leads.
if (getAgentRoster().length > 0 && !ticked().some(isAgentFree)) {
showRescue('Rescue did nothing: no ticked agent is Available or in wrap up. The queue was not cleared.');
return;
}
rescue.running = true;
try {
showRescue('Rescue: 1 of 3, clearing the queue');
await window._clearWholeQueue();
await waitForLeadsTableReady();
showRescue('Rescue: 2 of 3, scanning the leads again');
await window._refreshLeadsAndPanel();
const leads = collectAssignableLeads();
const cleared = leads.length > 0 && !leads.some((l) => l.assigned);
const agents = ticked();
const free = agents.filter(isAgentFree);
const skipped = agents.filter((a) => !isAgentFree(a)).map((a) => a.status);
const urgent = prioritizeLeads(filterAssignableLeads(leads, { tiers: new Set([1, 2, 3, 4]), windowMinutes: RESCUE_WINDOW_MINUTES, customerFirstOnly: false, emailOnly: false }));
let results = [];
if (free.length > 0 && urgent.length > 0) {
showRescue(`Rescue: 3 of 3, assigning ${urgent.length} lead${urgent.length === 1 ? '' : 's'}`);
setActiveAssignTab('assign');
results = (await executeAssignmentRun(roundRobinAssign(urgent, free), locateAssignCell, PAGE_SLA, { noConfirm: true })) || [];
}
const assigned = results.filter((r) => r.ok).length;
const notice = rescueNoticeText({ cleared, assigned, agentCount: free.length, failed: (free.length ? urgent.length : 0) - assigned, skipped });
rescue.running = false;
showRescue(notice);
showToast(notice);
} catch (error) {
console.error('[SLA Manager] Rescue failed:', error && error.message);
rescue.running = false;
showRescue('Rescue stopped part way: something went wrong. Check the queue in Konnect before assigning again.');
} finally {
rescue.running = false;
}
};

runSelfTest('rescueSelfTest', function rescueSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
const a = JSON.stringify(actual); const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};
check('free is Available or wrap up, on the whole status', ['Available', 'available ', 'Wrap Up', 'Wrapup', 'Wash up', 'Not Available', 'Shift Start', 'Live Chat', 'Toilet Break', ''].map((status) => isAgentFree({ status })), [true, true, true, true, true, false, false, false, false, false]);
const now = Date.now();
const lead = (mins, over) => ({ slaDate: mins === null ? null : new Date(now + mins * 60000), status: 'Pending', assigned: false, ...over });
check('missed or due within 15 minutes, queued or not', rescueCount([lead(-5, { status: 'Missed' }), lead(10, { assigned: true }), lead(15), lead(16), lead(null), lead(null, { status: 'Missed', assigned: true })], now), 4);
check('the notice', rescueNoticeText({ cleared: true, assigned: 9, agentCount: 3, failed: 0, skipped: ['Live Chat', 'Live Chat'] }), 'Cleared the queue. 9 leads assigned to 3 agents, most urgent first. 2 agents skipped: Live Chat.');
check('nobody free', rescueNoticeText({ cleared: true, assigned: 0, agentCount: 0, failed: 0, skipped: ['Shift Start', ''] }), 'Cleared the queue. No ticked agent is Available or in wrap up, so nothing was assigned. 2 agents skipped: Shift Start, no status.');
check('some failed, queue not confirmed', rescueNoticeText({ cleared: false, assigned: 1, agentCount: 1, failed: 2, skipped: [] }), 'The queue could not be confirmed as cleared. 1 lead assigned to 1 agent, most urgent first. 2 could not be assigned.');
check('nothing urgent left', rescueNoticeText({ cleared: true, assigned: 0, agentCount: 2, failed: 0, skipped: [] }), 'Cleared the queue. No lead is missed or due within 15 minutes now, so nothing was assigned.');
if (failures.length > 0) {
reportSelfTestFailure('SLA Manager rescue self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('SLA Manager rescue self-test passed');
}
});

// ===================================================================
// BOOTSTRAP / PAGE AUTO-DETECT
// ===================================================================

// Polls detectPageType() rather than listening for hashchange, which the
// customer modal also fires. Re-scans on a change of lead page and on coming
// back to one after being elsewhere. The interval is stored on window so a re-run of
// the bookmarklet can clear the previous instance's poll; zombie polls each
// rebuilt the panel with their own stale state.
if (window._slaAutoDetectInterval) {
clearInterval(window._slaAutoDetectInterval);
}

// A previous instance's panel is unknown to this instance's panelElement.
document.getElementById(PANEL_ID)?.remove();
let lastKnownPageType = detectPageType();
// A new page type must be seen on two consecutive ticks before acting, since
// a stale table left during an Angular re-render can be misread once.
let pendingPageType = null;
let ticksOffLeadPages = 0;
window._slaAutoDetectInterval = setInterval(() => {
if (busyReason() || currentPanelMode === 'morningChecks') return;
const pageType = detectPageType();
if (!pageType) {
// Away from both lead pages for a few ticks (not just a table redrawing):
// coming back is then a page change, so the list is scanned again. Only
// once the panel has been opened, so nothing pops up unasked.
pendingPageType = null;
if (++ticksOffLeadPages >= 3 && panelElement) lastKnownPageType = null;
return;
}
ticksOffLeadPages = 0;
if (pageType === lastKnownPageType) { pendingPageType = null; return; }
if (pageType === pendingPageType) {
lastKnownPageType = pageType;
pendingPageType = null;
runExtraction();
} else {
pendingPageType = pageType;
}
}, 600);

purgeExpiredStoredData();
ensureWheelStyles();
createBadge();
if (isMissedWarningOn()) startMissedWatch();
console.info('✅ SLA Manager ready');
})();
