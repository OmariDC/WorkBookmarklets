// ===================================================================
// KONNECT BOOKING CHECK
//
// Separate tool, separate site - runs on Konnect Live, not the Konnect
// Manager app SLA-Extract.js/SLA-Manager.js live in. Takes a batch of
// SLA leads pasted from SLA-Extract.js's "Copy for Booking Check"
// export (Name/Phone/Email/Source/Campaign/Created, tab-separated),
// finds each customer, locates the exact lead, and classifies its
// Initial Notes as a booking or not. See the original implementation
// prompt for the full state machine (search -> timeline -> lead modal
// -> notes -> classify) - none of that is built yet, since none of
// Konnect Live's DOM has been confirmed live. This file currently holds
// only the one piece that has zero DOM dependency and can be built and
// tested standalone: the classifier itself.
//
// SCOPE: Tier 2 "Enquiry - New" / Source "Customer First" leads only,
// per the tool's stated purpose. Any other campaign/source combination
// is deliberately classified NON-BOOKING for now rather than guessed at
// - the wider multi-tier framework (Test Drive Request, Electric,
// Motability, Leapmotor, Offer Request, PX Valuation, Enquiry-Used,
// Cargurus, etc.) exists but is explicitly held back until this
// narrower scope is proven working end to end.
// ===================================================================

(function () {

// Confirmed Initial Notes structure for this lead type:
//   Lead ID: [ID]
//   Marketing Code: [CODE]
//   First Appointment Date Desired: [DD/MM/YYYY]   (optional line)
//   Customer Comments: [TEXT or "-"]
// Split on the field's own label rather than a fixed line count, since
// Marketing Code (and the whole block) may or may not include the date
// line, and Customer Comments is always the last field so it's safe to
// capture everything after its label through to the end of the notes,
// including any internal line breaks.
function parseInitialNotesFields(notes) {
const text = String(notes || '');
const dateMatch = text.match(/First Appointment Date Desired:\s*([^\r\n]*)/i);
const commentsMatch = text.match(/Customer Comments:\s*([\s\S]*)$/i);
const dateValue = dateMatch ? dateMatch[1].trim() : '';
const comments = commentsMatch ? commentsMatch[1].trim() : '';
return {
hasDateField: dateValue.length > 0,
dateValue,
comments
};
}

// "-" is the only confirmed "nothing here" marker across every example
// given - not extended to n/a, none, etc. since those weren't actually
// observed, matching this project's established "don't guess beyond
// what's confirmed" rule.
function isBlankComments(comments) {
return comments === '' || comments === '-';
}

// These three groups always override to NON-BOOKING regardless of any
// date field (Edge Cases 3/4/5 in the confirmed rules) - checked before
// anything else, since a date field present alongside finance/business/
// technical wording is still NON-BOOKING, not DATE ONLY or CONFIRMED.
const FINANCE_KEYWORDS = ['quote', 'quotes', 'leasing', 'pch', '0%', 'offer', 'best price', 'purchase price', 'finance', 'details'];
const BUSINESS_KEYWORDS = ['behalf of our business', 'company use', 'hardware', 'control systems', 'business', 'company'];
const TECHNICAL_KEYWORDS = ['android auto', 'connectivity', 'support', 'tech', 'system'];
const OVERRIDE_KEYWORDS = [...FINANCE_KEYWORDS, ...BUSINESS_KEYWORDS, ...TECHNICAL_KEYWORDS];

// Confirmed: a time PREFERENCE word (morning/afternoon/early/slot) is
// DATE ONLY, not CONFIRMED DATE & TIME - explicitly resolved this way
// even though a date field is present, since it's a preference, not an
// actual time.
const TIME_PREFERENCE_WORDS = ['morning', 'afternoon', 'evening', 'early', 'earliest slot', 'slot'];

// An actual clock time - 24h (17:48) or 12h with am/pm (5:00 pm, 3pm).
// Confirmed rare for this lead type specifically (unlike Test Drive
// Request campaigns' "Preferred Date/Time: ..., HH:MM"), but still
// checked for robustness rather than assumed never to occur.
const EXACT_TIME_PATTERN = /\b([01]?\d|2[0-3]):[0-5]\d\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i;

function containsAny(haystackLower, needles) {
return needles.some((n) => haystackLower.includes(n));
}

// campaign/source are passed in (already available on every exported
// row) so leads outside this tool's actual scope get a clearly-labeled
// NON-BOOKING rather than running Tier 2-specific wording rules against
// content they were never designed for - per instruction, other tiers'
// real rules are deliberately deferred until this scope is confirmed
// working.
function isInScope(campaign, source) {
return String(campaign || '').trim().toLowerCase() === 'enquiry - new'
&& String(source || '').trim().toLowerCase() === 'customer first';
}

function classifyInitialNotes(initialNotes, { campaign, source } = {}) {
if (!isInScope(campaign, source)) {
return {
category: 'NON-BOOKING',
reason: `Outside current scope (Campaign="${campaign || ''}", Source="${source || ''}") - only Tier 2 Enquiry - New / Customer First is classified for now; other tiers are filtered to Non-Booking until their own rules are confirmed.`,
confidence: 'high'
};
}

const { hasDateField, comments } = parseInitialNotesFields(initialNotes);
const lower = comments.toLowerCase();

if (containsAny(lower, OVERRIDE_KEYWORDS)) {
return {
category: 'NON-BOOKING',
reason: 'Comments mention finance/business/technical-support wording, which overrides to Non-Booking regardless of any date field.',
confidence: 'high'
};
}

if (!hasDateField) {
return {
category: 'NON-BOOKING',
reason: 'No "First Appointment Date Desired" field present.',
confidence: 'high'
};
}

if (isBlankComments(comments)) {
return {
category: 'DATE ONLY',
reason: 'Date field present but Customer Comments is blank ("-").',
confidence: 'high'
};
}

if (containsAny(lower, TIME_PREFERENCE_WORDS)) {
return {
category: 'DATE ONLY',
reason: 'Date field present; comments only state a time preference (e.g. "morning"/"early"/"slot"), not an exact time.',
confidence: 'high'
};
}

if (EXACT_TIME_PATTERN.test(comments)) {
return {
category: 'CONFIRMED DATE & TIME',
reason: 'Date field present and comments contain an exact time.',
confidence: 'high'
};
}

// Date present, comments non-blank, no override keywords, no time-
// preference words, no exact time - genuine free-text content
// (vehicle/model, "test drive", location, etc), matching the Tier 2
// section's own stated rule directly. A LEAD 88 vs LEAD 123 pair that
// looked like this bucket disagreeing with itself turned out to be bad
// example data (LEAD 88's real Customer Comments is blank, not the
// vehicle-mention text it was first given as - already correctly
// caught above by isBlankComments before reaching here), not an actual
// rule conflict, so this stays high confidence.
return {
category: 'CONFIRMED DATE & TIME',
reason: 'Date field present and comments contain genuine context beyond a blank or time-preference-only response.',
confidence: 'high'
};
}

window.KonnectBookingCheck = window.KonnectBookingCheck || {};
window.KonnectBookingCheck.classifyInitialNotes = classifyInitialNotes;
window.KonnectBookingCheck.parseInitialNotesFields = parseInitialNotesFields;

// ===================================================================
// SEARCH (state machine steps: OPEN_SEARCH -> SET_SEARCH_TYPE ->
// ENTER_IDENTIFIER -> SUBMIT_SEARCH -> READ_RESULTS -> OPEN_CUSTOMER)
//
// Every selector below is confirmed live against Konnect Live's real
// search page - none of it is guessed. Timeline/lead-modal/Initial
// Notes extraction still need their own live confirmation before
// they're built; this is only the search step.
// ===================================================================

function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same native-setter pattern as Halo-Tool.js (setNativeValue/
// setNativeChecked there) - Angular's own input/radio directives listen
// for real 'input'/'change' events, not a plain .value= or .checked=
// assignment, so those are dispatched explicitly rather than assumed.
function setNativeValue(el, value) {
const proto = Object.getPrototypeOf(el);
const desc = Object.getOwnPropertyDescriptor(proto, 'value');
if (desc && desc.set) desc.set.call(el, value);
else el.value = value;
el.dispatchEvent(new Event('input', { bubbles: true }));
}

function setNativeChecked(el, checked) {
const proto = Object.getPrototypeOf(el);
const desc = Object.getOwnPropertyDescriptor(proto, 'checked');
if (desc && desc.set) desc.set.call(el, checked);
else el.checked = checked;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
}

const KONNECT_LIVE_SEARCH_HASH = '#/search?redirectRoute=%2Fsearch';

// Confirmed live: <input type="radio" name="bookingSearchBy" ...> with
// value="4" for Email, value="3" for Phone (1=Name, 5=Reg, 2=Magic -
// not used by this tool).
const SEARCH_TYPE_VALUES = { email: '4', phone: '3' };

function findSearchTypeRadio(type) {
return document.querySelector(`input[name="bookingSearchBy"][value="${SEARCH_TYPE_VALUES[type]}"]`);
}

function findSearchInput() {
return document.querySelector('input[ng-model="uiSettings.searchText"]');
}

function findSearchButton() {
return document.getElementById('btnSearch');
}

// "Records Found:" label and its value span are siblings inside the
// same .pull-right container (confirmed live), not label->span nesting -
// the span itself only exists in the DOM while !isSearching (ng-if), so
// its absence is itself meaningful (a search is currently in flight),
// not just "not found yet".
function findRecordsFoundContainer() {
const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === 'Records Found:');
return label ? label.parentElement : null;
}

function findRecordsFoundValue() {
const container = findRecordsFoundContainer();
const span = container ? container.querySelector('span.ng-binding') : null;
return span ? span.textContent.trim() : null;
}

// ng-show="isSearching" toggles the ng-hide CLASS (confirmed live: class
// includes "ng-hide" when idle, excludes it while a search is running) -
// this is the single most direct isSearching signal, more reliable than
// inferring state from whether the count span currently happens to
// exist, which could momentarily read as "no count yet" for reasons
// unrelated to a real search being in flight.
function findSearchSpinnerIcon() {
const container = findRecordsFoundContainer();
return container ? container.querySelector('i.fa-refresh') : null;
}

function isSearchSpinnerActive(icon) {
return !!icon && !icon.classList.contains('ng-hide');
}

function waitForSpinnerState(active, timeout) {
return new Promise((resolve) => {
const icon = findSearchSpinnerIcon();
if (!icon) { resolve(false); return; }
if (isSearchSpinnerActive(icon) === active) { resolve(true); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
const observer = new MutationObserver(() => {
if (isSearchSpinnerActive(icon) === active) {
clearTimeout(timer);
observer.disconnect();
resolve(true);
}
});
observer.observe(icon, { attributes: true, attributeFilter: ['class'] });
});
}

function waitForElement(selector, timeout = 8000) {
return new Promise((resolve) => {
const existing = document.querySelector(selector);
if (existing) { resolve(existing); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
const observer = new MutationObserver(() => {
const el = document.querySelector(selector);
if (el) { clearTimeout(timer); observer.disconnect(); resolve(el); }
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

// Navigates via the app's own hash route rather than a menu/dropdown
// sequence (per instruction - avoids selecting the wrong menu item).
// Waits for the search-type radios to exist rather than a fixed delay.
async function openSearchPage() {
window.location.hash = KONNECT_LIVE_SEARCH_HASH;
const radio = await waitForElement('input[name="bookingSearchBy"]');
return !!radio;
}

async function selectSearchType(type) {
const radio = findSearchTypeRadio(type);
if (!radio) return false;
if (radio.checked) return true;
setNativeChecked(radio, true);
return radio.checked === true;
}

// Follows the spec's exact prescribed sequence (clear -> events ->
// set -> events -> read back) rather than a single set-and-go, since
// the earlier manual workflow occasionally duplicated or truncated the
// entered value. Also waits out the input's own 100ms
// ng-model-options debounce (confirmed live) before returning - the
// Search button's getSearchData() reads Angular's own bound
// uiSettings.searchText, not the raw DOM value, so clicking before the
// debounce settles risks searching on a stale/empty bound value even
// though the visible input already shows the right text.
async function enterSearchIdentifier(value) {
const input = findSearchInput();
if (!input) return false;
setNativeValue(input, '');
input.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(20);
setNativeValue(input, value);
input.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(150);
return input.value === value;
}

// Waits for a real search cycle to complete: the spinner turning on (a
// new search genuinely started, not just trusting whatever count was
// already showing from a previous search) then off again (confirmed
// finished), then reads the settled count. Returns null if a search
// never detectably started or never finished within timeout - callers
// treat that as SEARCH_TIMEOUT, not a zero-result search.
async function submitSearchAndWaitForResults(timeout = 8000) {
const button = findSearchButton();
if (!button || button.disabled) return null;
button.click();
const started = await waitForSpinnerState(true, 1500);
if (!started) return null;
const finished = await waitForSpinnerState(false, timeout);
if (!finished) return null;
const raw = findRecordsFoundValue();
return raw !== null && raw !== '' ? Number(raw) : null;
}

// ag-Grid virtualizes rows (only visible ones exist in the DOM) - fine
// for this tool's small result counts (a handful of matches per email/
// phone search, confirmed live), but a search returning many results
// could have rows this doesn't see without scrolling the grid, which
// isn't handled yet.
function readSearchResultRows() {
const grid = document.getElementById('grid');
if (!grid) return [];
return Array.from(grid.querySelectorAll('[role="row"][row-index]')).map((row) => {
const nameCell = row.querySelector('[col-id="CustomerName"]');
const link = nameCell ? nameCell.querySelector('a[ng-click*="navToConnectedCustomer"]') : null;
const idMatch = link ? (link.getAttribute('ng-click') || '').match(/navToConnectedCustomer\((\d+)\)/) : null;
return {
row,
link,
customerId: idMatch ? idMatch[1] : null,
customerName: link ? link.textContent.replace(/\s+/g, ' ').trim() : '',
dealerName: row.querySelector('[col-id="DealerName"]')?.textContent?.trim() || '',
registrationNumber: row.querySelector('[col-id="RegistrationNumber"]')?.textContent?.trim() || '',
summary: row.querySelector('[col-id="Summary"]')?.textContent?.trim() || ''
};
});
}

function normalizeForNameMatch(value) {
return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// The results grid has no per-row email/phone column at all (confirmed
// live) - only Dealer/CustomerName/Module/Registration/LastActionDate/
// Summary - so the original plan of re-verifying each row's own email/
// phone doesn't apply here; there's nothing to re-check against. If
// every matching row already points at the same customer ID, it doesn't
// matter which one gets clicked (multiple leads/visits under one
// profile) - only genuinely different customer IDs need the name
// fallback, which is a weaker signal than the original plan intended
// but the only one actually available in this grid.
function chooseCustomerResult(rows, expectedName) {
if (rows.length === 0) return { status: 'SEARCH_NO_RESULTS' };
const withLinks = rows.filter(r => r.link && r.customerId);
if (withLinks.length === 0) return { status: 'CUSTOMER_NOT_LINKED' };

const uniqueIds = new Set(withLinks.map(r => r.customerId));
if (uniqueIds.size === 1) return { status: 'OK', result: withLinks[0] };

const expected = normalizeForNameMatch(expectedName);
const nameMatches = withLinks.filter(r => normalizeForNameMatch(r.customerName).includes(expected));
if (nameMatches.length === 1) return { status: 'OK', result: nameMatches[0] };
return { status: 'CUSTOMER_AMBIGUOUS' };
}

// Rejects mailto:/tel: links defensively even though none were found in
// the confirmed markup (the earlier manual workflow's actual failure
// mode) - the real customer link's href is empty, navigation happens
// entirely through ng-click, so .click() is what actually matters here,
// not href.
function isSafeCustomerLink(link) {
const href = (link.getAttribute('href') || '').trim().toLowerCase();
return !href.startsWith('mailto:') && !href.startsWith('tel:');
}

window.KonnectBookingCheck.openSearchPage = openSearchPage;
window.KonnectBookingCheck.selectSearchType = selectSearchType;
window.KonnectBookingCheck.enterSearchIdentifier = enterSearchIdentifier;
window.KonnectBookingCheck.submitSearchAndWaitForResults = submitSearchAndWaitForResults;
window.KonnectBookingCheck.readSearchResultRows = readSearchResultRows;
window.KonnectBookingCheck.chooseCustomerResult = chooseCustomerResult;
window.KonnectBookingCheck.isSafeCustomerLink = isSafeCustomerLink;

// ===================================================================
// TIMELINE (state machine steps: WAIT_FOR_TIMELINE -> SCAN_LOADED_ENTRIES
// -> MATCH_CREATED_DATETIME -> OPEN_LEAD_MODAL -> WAIT_FOR_REQUIRED_FIELDS
// -> VALIDATE_LEAD -> EXTRACT_INITIAL_NOTES)
//
// Every selector/structure below is confirmed live against a real
// Konnect Live customer timeline and lead modal - none of it is
// guessed. LOAD_OLDER_ENTRIES (scrolling for entries not yet loaded),
// CLOSE_MODAL, and the outer per-customer/per-row orchestration loop
// are not built yet - still pending further confirmation.
// ===================================================================

// Confirmed live: icon-to-row traversal, not :has(), visual scanning,
// coordinates or inspecting every timeline element. A pink icon alone
// isn't sufficient - confirmed live that 4 pink-styled entries matched
// this selector on one real timeline but only 3 had a heading starting
// "Manually Created Sales Lead from" (the 4th was some other pink-
// styled event type) - both conditions are required.
function getLoadedLeadEntries() {
const icons = [...document.querySelectorAll('a.connected-customer-timeline-centre-pink')];
const rows = icons
.map((icon) => icon.closest('div.row.ng-scope[ng-repeat*="customerTimeLine"]'))
.filter(Boolean);
return [...new Set(rows)].filter((row) => {
const heading = row.querySelector('.connected-customer-title-pink');
return heading?.textContent.replace(/\s+/g, ' ').trim().startsWith('Manually Created Sales Lead from');
});
}

// The timestamp container also holds the Lead ID span (title="This is
// the Konnect Lead ID") - confirmed live - so this can't just read the
// container's unfiltered textContent, that would contaminate the
// timestamp with the Lead ID digits. Direct text nodes first (the
// common case, since the Lead ID lives in its own child <span>, not as
// a text-node sibling); a sanitized-clone fallback only if that comes
// back empty.
function extractTimelineTimestamp(row) {
const heading = row.querySelector('.connected-customer-timeline-heading-left-pink, .connected-customer-timeline-heading-right-pink');
if (!heading) return null;

const directText = [...heading.childNodes]
.filter((node) => node.nodeType === Node.TEXT_NODE)
.map((node) => node.textContent)
.join(' ')
.replace(/\s+/g, ' ')
.trim();
if (directText) return directText;

const clone = heading.cloneNode(true);
clone.querySelectorAll('[title="This is the Konnect Lead ID"]').forEach((el) => el.remove());
return clone.textContent.replace(/\s+/g, ' ').trim();
}

// For audit/logging only - confirmed live that a real Konnect Lead ID
// is visible in the timeline, but it's never used as a match key since
// the SLA export (SLA-Extract.js) doesn't supply one.
function extractVisibleLeadId(row) {
const el = row.querySelector('[title="This is the Konnect Lead ID"]');
const match = el?.textContent.match(/\d+/);
return match ? match[0] : null;
}

const MONTH_NAMES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseNamedMonth(text) {
const key = String(text || '').slice(0, 3).toLowerCase();
return Object.prototype.hasOwnProperty.call(MONTH_NAMES, key) ? MONTH_NAMES[key] : null;
}

// Two confirmed live timeline shapes: "D MMM YYYY HH:mm" (older
// entries, e.g. "5 May 2023 07:02") and "D MMM HH:mm" (current
// calendar year, no year shown, e.g. "26 Sep 22:10"). Never falls back
// to Date.parse() for these UK-ordered, ambiguous-if-misparsed
// strings. When the year is implicit, it's taken from referenceDate
// (the year "now" actually is at match time, not assumed) - comparing
// that against the target SLA year is what naturally enforces "only
// accept a missing-year timestamp as this year", with no separate
// special case needed (see datetimesMatchAtMinute).
function parseTimelineTimestamp(text, referenceDate) {
const cleaned = String(text || '').replace(/\s+/g, ' ').trim();

const withYear = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})$/);
if (withYear) {
const month = parseNamedMonth(withYear[2]);
if (month === null) return null;
return { year: Number(withYear[3]), month, day: Number(withYear[1]), hour: Number(withYear[4]), minute: Number(withYear[5]), yearWasImplicit: false };
}

const withoutYear = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}):(\d{2})$/);
if (withoutYear) {
const month = parseNamedMonth(withoutYear[2]);
if (month === null) return null;
const ref = referenceDate || new Date();
return { year: ref.getFullYear(), month, day: Number(withoutYear[1]), hour: Number(withoutYear[3]), minute: Number(withoutYear[4]), yearWasImplicit: true };
}

return null;
}

// SLA-Extract.js's own Created column format, confirmed live:
// "Sat, 26 Sep 2026 17:48" - weekday+comma prefix, ignored (not
// anchored, so the regex just skips past it).
function parseSlaCreated(text) {
const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
const match = cleaned.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
if (!match) return null;
const month = parseNamedMonth(match[2]);
if (month === null) return null;
return { year: Number(match[3]), month, day: Number(match[1]), hour: Number(match[4]), minute: Number(match[5]) };
}

// Confirmed modal Date shape: "Fri 5th May 2023 07:02" - weekday plus
// an ordinal-suffixed day. Stripped down to the same "D MMM YYYY
// HH:mm" shape parseTimelineTimestamp's with-year branch already
// handles, rather than a separate parser to maintain.
function parseModalDate(text) {
const cleaned = String(text || '')
.replace(/^[A-Za-z]{3,}\s+/, '')
.replace(/(\d{1,2})(st|nd|rd|th)\b/i, '$1')
.replace(/\s+/g, ' ')
.trim();
return parseTimelineTimestamp(cleaned);
}

function datetimesMatchAtMinute(a, b) {
if (!a || !b) return false;
return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

// Never chooses "nearest" or "same day, different time" - only an
// exact minute match is ever a candidate at all. Multiple candidates
// sharing the same displayed minute are all retained here and left for
// the caller to validate individually through their modals (see
// VALIDATE_LEAD) rather than picked between at this stage.
function findMatchingLeadCandidates(targetCreatedText, referenceDate) {
const target = parseSlaCreated(targetCreatedText);
if (!target) return { target: null, candidates: [] };
const referenceNow = referenceDate || new Date();
const entries = getLoadedLeadEntries();
const candidates = entries
.map((row) => {
const rawTimestamp = extractTimelineTimestamp(row);
const parsed = rawTimestamp ? parseTimelineTimestamp(rawTimestamp, referenceNow) : null;
return { row, rawTimestamp, parsed, leadId: extractVisibleLeadId(row) };
})
.filter((c) => datetimesMatchAtMinute(c.parsed, target));
return { target, candidates };
}

// Confirmed live: the functional click handler (ng-click="showDetails(...)")
// is on the inner <i> icon, not the wrapping <a> (whose href is empty) -
// clicking the anchor alone would never fire it, since the event's
// path never passes through the icon when dispatched at a different
// element.
function findLeadClickTarget(row) {
return row.querySelector('a.connected-customer-timeline-centre-pink > i[ng-click^="showDetails("]');
}

function isVisible(element) {
if (!(element instanceof Element)) return false;
const rect = element.getBoundingClientRect();
const style = getComputedStyle(element);
return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

// Confirmed live readiness condition: a visible .modal[role="dialog"].in
// exists, its active tab exists, and #txtInitialNotes exists inside
// that active tab. Deliberately does NOT wait for the modal's complete
// DOM to stop expanding - confirmed live that required fields were
// populated at ~1.06s while irrelevant hidden-tab/dropdown markup kept
// expanding until ~1.18s; waiting for that extra expansion would be
// pure wasted time.
function findActiveLeadModalState() {
const modal = Array.from(document.querySelectorAll('.modal[role="dialog"].in')).find(isVisible);
if (!modal) return null;
const panel = modal.querySelector('.tab-pane.active') || modal;
const notes = panel.querySelector('#txtInitialNotes');
if (!notes) return null;
return { modal, panel, notes };
}

function waitForActiveLeadModal(timeout = 3000) {
return new Promise((resolve) => {
const existing = findActiveLeadModalState();
if (existing) { resolve(existing); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
const observer = new MutationObserver(() => {
const state = findActiveLeadModalState();
if (state) { clearTimeout(timer); observer.disconnect(); resolve(state); }
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

// Click the actual DOM control, never showDetails() directly (per
// instruction). If the fast-path click alone doesn't produce a ready
// modal, re-queries the target fresh (never trusts a possibly-stale
// reference), scrolls it into view once, and dispatches one bubbled
// mouse click - never repeatedly clicks beyond that single retry.
async function openLeadModal(row, timeout = 3000) {
const target = findLeadClickTarget(row);
if (!target || !target.isConnected) return null;
target.click();
let state = await waitForActiveLeadModal(timeout);
if (state) return state;

const retryTarget = findLeadClickTarget(row);
if (!retryTarget || !retryTarget.isConnected) return null;
retryTarget.scrollIntoView({ block: 'center' });
retryTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
state = await waitForActiveLeadModal(timeout);
return state;
}

function directText(el) {
return Array.from(el.childNodes)
.filter((n) => n.nodeType === Node.TEXT_NODE)
.map((n) => n.textContent)
.join(' ')
.replace(/\s+/g, ' ')
.trim();
}

// Date and Source share the same confirmed shape: a label-only child
// <div> (no element children) sitting inside a container whose sibling
// <footer><strong> holds the value - matched by the label's own text,
// not column position.
function extractLabeledFooterField(panel, labelText) {
const labelDivs = Array.from(panel.querySelectorAll('div')).filter((el) => el.children.length === 0 && el.textContent.replace(/\s+/g, ' ').trim() === labelText);
for (const labelDiv of labelDivs) {
const container = labelDiv.parentElement;
const strong = container ? container.querySelector('footer strong.ng-binding') : null;
if (strong) return strong.textContent.replace(/\s+/g, ' ').trim();
}
return null;
}

// Campaign's label is a direct text node of the SAME container that
// also holds the value spans (a different shape from Date/Source,
// confirmed live) - primary and parenthetical values extracted
// separately, per instruction never required to match combined text.
function extractCampaignField(panel) {
const container = Array.from(panel.querySelectorAll('div')).find((el) => directText(el) === 'Campaign');
if (!container) return { primary: null, parenthetical: null };
const spans = Array.from(container.querySelectorAll(':scope > span'));
const primary = spans[0] ? spans[0].textContent.replace(/\s+/g, ' ').trim() : null;
const parenthetical = spans[1] ? spans[1].textContent.replace(/\s+/g, ' ').trim().replace(/^\(|\)$/g, '') : null;
return { primary, parenthetical };
}

// Name/phone used only as confirmation - never clicked (per
// instruction, this would navigate away from the lead being read).
function extractCustomerField(panel) {
const link = panel.querySelector('a[ng-click="navToConnectedCustomer()"]');
if (!link) return { name: null, phone: null };
const strongs = Array.from(link.querySelectorAll('strong.ng-binding'));
const name = strongs[0] ? strongs[0].textContent.replace(/\s+/g, ' ').trim() : null;
const phoneRaw = strongs[1] ? strongs[1].textContent.replace(/\s+/g, ' ').trim() : null;
return { name, phone: phoneRaw ? phoneRaw.replace(/^\(|\)$/g, '') : null };
}

function extractLeadPanelFields(panel) {
return {
date: extractLabeledFooterField(panel, 'Date'),
source: extractLabeledFooterField(panel, 'Source'),
campaign: extractCampaignField(panel),
customer: extractCustomerField(panel)
};
}

// Confirmed live: Initial Notes is a read-only <div id="txtInitialNotes">,
// not a textarea/input - .textContent, not .value. Internal line breaks
// are preserved (only outer whitespace trimmed), since trim() alone
// doesn't collapse internal whitespace the way the label extractors
// above deliberately do.
function extractInitialNotes(panel) {
const el = panel.querySelector('#txtInitialNotes');
return el ? el.textContent.trim() : null;
}

function normalizeForCompare(value) {
return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Created date/time remains the decisive key (already matched before
// a modal was ever opened, via findMatchingLeadCandidates) - this
// re-confirms it against the modal's own Date, then treats Source and
// Campaign as confirmation fields that can REJECT a clearly
// contradictory candidate but never redirect to a different lead.
// Registration is deliberately not checked here - confirmed absent
// from the inspected Initial Call panel, so it stays optional per
// instruction rather than required.
function validateLeadCandidate(panelFields, slaRow) {
const modalDateParsed = panelFields.date ? parseModalDate(panelFields.date) : null;
const targetParsed = parseSlaCreated(slaRow.created);
if (!datetimesMatchAtMinute(modalDateParsed, targetParsed)) {
return { ok: false, reason: 'Modal Date does not match the target Created minute.' };
}

if (slaRow.source && panelFields.source && normalizeForCompare(slaRow.source) !== normalizeForCompare(panelFields.source)) {
return { ok: false, reason: `Source contradicts: SLA="${slaRow.source}" modal="${panelFields.source}"` };
}

if (slaRow.campaign && panelFields.campaign && (panelFields.campaign.primary || panelFields.campaign.parenthetical)) {
const target = normalizeForCompare(slaRow.campaign);
const primaryMatch = panelFields.campaign.primary && normalizeForCompare(panelFields.campaign.primary) === target;
const parentheticalMatch = panelFields.campaign.parenthetical && normalizeForCompare(panelFields.campaign.parenthetical) === target;
if (!primaryMatch && !parentheticalMatch) {
return { ok: false, reason: `Campaign contradicts both modal representations: SLA="${slaRow.campaign}"` };
}
}

return { ok: true };
}

window.KonnectBookingCheck.getLoadedLeadEntries = getLoadedLeadEntries;
window.KonnectBookingCheck.extractTimelineTimestamp = extractTimelineTimestamp;
window.KonnectBookingCheck.extractVisibleLeadId = extractVisibleLeadId;
window.KonnectBookingCheck.parseTimelineTimestamp = parseTimelineTimestamp;
window.KonnectBookingCheck.parseSlaCreated = parseSlaCreated;
window.KonnectBookingCheck.parseModalDate = parseModalDate;
window.KonnectBookingCheck.datetimesMatchAtMinute = datetimesMatchAtMinute;
window.KonnectBookingCheck.findMatchingLeadCandidates = findMatchingLeadCandidates;
window.KonnectBookingCheck.openLeadModal = openLeadModal;
window.KonnectBookingCheck.extractLeadPanelFields = extractLeadPanelFields;
window.KonnectBookingCheck.extractInitialNotes = extractInitialNotes;
window.KonnectBookingCheck.validateLeadCandidate = validateLeadCandidate;

// A stable key for "have I already examined this entry" tracking across
// scroll attempts (per instruction: never rescan every historical row
// after every scroll) - timestamp + heading + Lead ID together, since
// none alone is guaranteed unique (two different leads could share a
// displayed minute).
function timelineEntryKey(row) {
const timestamp = extractTimelineTimestamp(row) || '';
const heading = row.querySelector('.connected-customer-title-pink')?.textContent.replace(/\s+/g, ' ').trim() || '';
const leadId = extractVisibleLeadId(row) || '';
return `${timestamp}||${heading}||${leadId}`;
}

// Confirmed: press Escape once, wait for .modal[role="dialog"].in to
// be absent/no-longer-visible - a condition wait, not a fixed sleep -
// bounded to ~750ms since modals close fast once dismissed.
function isAnyLeadModalVisible() {
return Array.from(document.querySelectorAll('.modal[role="dialog"].in')).some(isVisible);
}

function waitForLeadModalGone(timeout = 750) {
return new Promise((resolve) => {
if (!isAnyLeadModalVisible()) { resolve(true); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(!isAnyLeadModalVisible()); }, timeout);
const observer = new MutationObserver(() => {
if (!isAnyLeadModalVisible()) { clearTimeout(timer); observer.disconnect(); resolve(true); }
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
});
}

async function closeLeadModal(timeout = 750) {
if (!isAnyLeadModalVisible()) return true;
const escEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
document.dispatchEvent(escEvent);
return waitForLeadModalGone(timeout);
}

// The real scroll container (browser window vs. some internal timeline
// element) was explicitly NOT confirmed in any live DOM capture this
// tool is built against - the spec itself says to keep this as its own
// small, replaceable helper rather than guess, so it can be swapped for
// a real implementation the moment that's confirmed, without touching
// anything that calls it. Until then, this safely reports the
// container as unknown instead of scrolling something that might be
// wrong.
async function loadOlderTimelineEntries() {
return { status: 'TIMELINE_SCROLL_CONTAINER_UNKNOWN', loadedNewEntries: false };
}

// Email: trim + lowercase. Phone: digits only, UK +44 and leading 0
// treated as equivalent by canonicalizing to the leading-0 form - e.g.
// "+44 7393 966086" and "07393966086" both normalize to
// "07393966086". No normalizeRegistration - Registration was
// deliberately dropped from the SLA-Extract.js export (see that
// repo's own history: "not something we need to copy, nor can search
// reliably by anyways"), so it's never part of this tool's input at
// all, not just optional.
function normalizeEmail(value) {
return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
const digits = String(value || '').replace(/\D+/g, '');
if (digits.startsWith('44')) return '0' + digits.slice(2);
return digits;
}

// Matches the CURRENT SLA-Extract.js "Copy for Booking Check" export
// exactly - six columns, no Registration (an earlier draft of this
// tool's spec still assumed a 7-column Registration-included schema;
// the export itself changed after that spec was written). Each row is
// validated per instruction: an email or phone is required for
// customer search, and a complete parseable Created value is required
// for lead matching - rows failing either are flagged INVALID_INPUT
// with the specific reason, not silently dropped.
const EXPECTED_BATCH_HEADER = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created'];

function parseBatchInput(rawText) {
const lines = String(rawText || '').split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
if (lines.length === 0) return { rows: [], headerOk: false, error: 'No input.' };

const header = lines[0].split('\t').map((h) => h.trim());
const headerOk = header.length === EXPECTED_BATCH_HEADER.length && header.every((h, i) => h === EXPECTED_BATCH_HEADER[i]);
if (!headerOk) {
return { rows: [], headerOk: false, error: `Header does not match expected columns: ${EXPECTED_BATCH_HEADER.join('\t')}` };
}

const rows = lines.slice(1).map((line, index) => {
const cells = line.split('\t');
const name = (cells[0] || '').trim();
const phone = (cells[1] || '').trim();
const email = (cells[2] || '').trim();
const source = (cells[3] || '').trim();
const campaign = (cells[4] || '').trim();
const created = (cells[5] || '').trim();

const normalizedEmail = normalizeEmail(email);
const normalizedPhone = normalizePhone(phone);
const hasIdentifier = normalizedEmail.length > 0 || normalizedPhone.length > 0;
const parsedCreated = created ? parseSlaCreated(created) : null;

let status = 'QUEUED';
let exception = null;
if (!hasIdentifier) { status = 'INVALID_INPUT'; exception = 'NO_SEARCH_IDENTIFIER'; }
else if (!parsedCreated) { status = 'INVALID_INPUT'; exception = 'INVALID_CREATED_DATETIME'; }

return {
inputIndex: index,
name, phone, email, source, campaign, created,
normalizedEmail, normalizedPhone, parsedCreated,
groupKey: normalizedEmail || normalizedPhone,
status, exception
};
});

return { rows, headerOk: true, error: null };
}

window.KonnectBookingCheck.timelineEntryKey = timelineEntryKey;
window.KonnectBookingCheck.closeLeadModal = closeLeadModal;
window.KonnectBookingCheck.loadOlderTimelineEntries = loadOlderTimelineEntries;
window.KonnectBookingCheck.normalizeEmail = normalizeEmail;
window.KonnectBookingCheck.normalizePhone = normalizePhone;
window.KonnectBookingCheck.parseBatchInput = parseBatchInput;

// ===================================================================
// Self-test for batch-input parsing and normalization - no DOM
// dependency.
// ===================================================================
(function batchInputSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

check('normalizeEmail trims+lowercases', normalizeEmail(' Foo@Bar.COM '), 'foo@bar.com');
check('normalizePhone +44 form', normalizePhone('+44 7393 966086'), '07393966086');
check('normalizePhone leading-0 form matches +44 form', normalizePhone('07393966086'), normalizePhone('+44 7393 966086'));

const goodBatch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Stephen Dracup\t07917074816\tstephen@dracup.me.uk\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
'No Identifier\t\t\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
'Bad Date\t07000000000\tbad@date.com\tCustomer First\tCitroen - Enquiry - New\tnot a date'
].join('\n');
const parsed = parseBatchInput(goodBatch);
check('parseBatchInput header ok', parsed.headerOk, true);
check('parseBatchInput row count', parsed.rows.length, 3);
check('parseBatchInput row 0 queued', parsed.rows[0].status, 'QUEUED');
check('parseBatchInput row 1 missing identifier', parsed.rows[1].exception, 'NO_SEARCH_IDENTIFIER');
check('parseBatchInput row 2 bad created', parsed.rows[2].exception, 'INVALID_CREATED_DATETIME');

const badHeaderBatch = 'Name\tPhone\tEmail\tRegistration\tSource\tCampaign\tCreated\nx\ty\tz\ta\tb\tc\td';
check('parseBatchInput rejects the old 7-column Registration header', parseBatchInput(badHeaderBatch).headerOk, false);

if (failures.length > 0) {
console.error('KonnectBookingCheck batch-input self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck batch-input self-test passed (6/6)');
}
})();

// ===================================================================
// Self-test for the pure parsing/matching logic above - no DOM
// dependency, so it can run the same way the classifier's self-test
// does. Uses the exact example strings confirmed live.
// ===================================================================
(function timelineSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const now2026 = new Date(2026, 8, 27); // 27 Sep 2026, matches "today" at time of writing

check('parseTimelineTimestamp with year', parseTimelineTimestamp('5 May 2023 07:02'), { year: 2023, month: 4, day: 5, hour: 7, minute: 2, yearWasImplicit: false });
check('parseTimelineTimestamp without year', parseTimelineTimestamp('26 Sep 22:10', now2026), { year: 2026, month: 8, day: 26, hour: 22, minute: 10, yearWasImplicit: true });
check('parseSlaCreated', parseSlaCreated('Sat, 26 Sep 2026 17:48'), { year: 2026, month: 8, day: 26, hour: 17, minute: 48 });
check('parseModalDate', parseModalDate('Fri 5th May 2023 07:02'), { year: 2023, month: 4, day: 5, hour: 7, minute: 2, yearWasImplicit: false });

check('datetimesMatchAtMinute true', datetimesMatchAtMinute(parseModalDate('Fri 5th May 2023 07:02'), parseTimelineTimestamp('5 May 2023 07:02')), true);
check('datetimesMatchAtMinute false (different minute)', datetimesMatchAtMinute(parseTimelineTimestamp('5 May 2023 07:02'), parseTimelineTimestamp('5 May 2023 07:03')), false);

// A current-year (no displayed year) timeline entry must only match a
// target from that SAME year - not an arbitrary different year sharing
// the same day/month/time.
const impliedThisYear = parseTimelineTimestamp('26 Sep 22:10', now2026);
const targetSameYear = parseSlaCreated('Sat, 26 Sep 2026 22:10');
const targetDifferentYear = parseSlaCreated('Thu, 26 Sep 2024 22:10');
check('implicit-year entry matches same-year target', datetimesMatchAtMinute(impliedThisYear, targetSameYear), true);
check('implicit-year entry does not match a different-year target', datetimesMatchAtMinute(impliedThisYear, targetDifferentYear), false);

if (failures.length > 0) {
console.error('KonnectBookingCheck timeline self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck timeline self-test passed (8/8)');
}
})();

// ===================================================================
// Self-test against every numbered example from the confirmed rules -
// run automatically on load so a regression here is loud immediately,
// not discovered later against real customer data. Only covers Tier 2
// Enquiry - New / Customer First, matching this file's current scope.
// ===================================================================
(function selfTest() {
const CAMPAIGN = 'Enquiry - New';
const SOURCE = 'Customer First';
const notesFor = (date, comments) => [
'Lead ID: TEST',
'Marketing Code: TEST',
date ? `First Appointment Date Desired: ${date}` : null,
`Customer Comments: ${comments}`
].filter(Boolean).join('\n');

const cases = [
{ name: 'LEAD 76', date: '04/08/2026', comments: 'I am interested in purchasing C5 Aircross...trading in FG73DFZ', expect: 'CONFIRMED DATE & TIME' },
{ name: 'LEAD 81', date: '06/08/2026', comments: 'Test drive 1.2 manual C3 early appointment please', expect: 'DATE ONLY' },
{ name: 'LEAD 88', date: '10/08/2026', comments: '-', expect: 'DATE ONLY' },
{ name: 'LEAD 94', date: '09/08/2026', comments: 'Sunday morning please earliest slot', expect: 'DATE ONLY' },
{ name: 'LEAD 80', date: null, comments: '-', expect: 'NON-BOOKING' },
{ name: 'LEAD 119', date: null, comments: '-', expect: 'NON-BOOKING' },
{ name: 'LEAD 123', date: '08/08/2026', comments: 'Would like to see / test drive one of these somewhere local to Hampshire', expect: 'CONFIRMED DATE & TIME' },
{ name: 'LEAD 54', date: null, comments: '-', expect: 'NON-BOOKING' },
{ name: 'LEAD 59', date: null, comments: '-', expect: 'NON-BOOKING' },
{ name: 'LEAD 67', date: null, comments: '-', expect: 'NON-BOOKING' },
{ name: 'LEAD 102', date: null, comments: '-', expect: 'NON-BOOKING' },
{ name: 'LEAD 109', date: null, comments: 'Could I please get 2 PCH (leasing) quotes - Citroen eC3 Aircross (Electric) Max Standard Range 44kWh', expect: 'NON-BOOKING' },
{ name: 'LEAD 114', date: null, comments: 'Finance on this Vehicle', expect: 'NON-BOOKING' },
{ name: 'LEAD 117', date: null, comments: "I'm interested in your 0% purchase offer for the e-C3. Please send details and your best purchase price", expect: 'NON-BOOKING' }
];

const failures = [];
cases.forEach((c) => {
const result = classifyInitialNotes(notesFor(c.date, c.comments), { campaign: CAMPAIGN, source: SOURCE });
if (result.category !== c.expect) {
failures.push(`${c.name}: expected ${c.expect}, got ${result.category} (${result.reason})`);
}
});

if (failures.length > 0) {
console.error('KonnectBookingCheck classifyInitialNotes self-test FAILED:\n' + failures.join('\n'));
} else {
console.info(`KonnectBookingCheck classifyInitialNotes self-test passed (${cases.length}/${cases.length})`);
}
})();

})();
