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
