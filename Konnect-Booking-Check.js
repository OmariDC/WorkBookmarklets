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
