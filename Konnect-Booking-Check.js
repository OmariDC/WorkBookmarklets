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
// SCOPE: covers all 4 tiers per the confirmed lead-filtering framework
// (Electric, Reserve-Used, Test Drive Request, Enquiry-New/Customer
// First, Motability, Leapmotor, Offer Request, PX Valuation, Enquiry-
// Used, Robins & Day Enquiry-New, General/Register Interest, Cargurus).
// Every tier's detection criteria comes from that framework; every
// tier's OUTPUT is mapped onto the same 4 agreed categories (CONFIRMED
// DATE & TIME, DATE ONLY, WARM ENQUIRY, NON-BOOKING) rather than
// growing the category vocabulary further - the framework's own
// "RESERVED"/"ALREADY ACTIONED" label folded into NON-BOOKING instead
// of becoming its own category. WARM ENQUIRY itself was originally
// called BOOKING (TEST DRIVE), renamed once it started covering PX
// Valuation/Enquiry-Used vehicle-interest signals too - "test drive"
// stopped describing what the category actually meant. A campaign/
// source combination this framework never described still defaults to
// NON-BOOKING rather than being guessed at.
//
// Everything through search, timeline scan/matching, lead modal read/
// validate/close, and Initial Notes classification is confirmed
// against live Konnect Live DOM. loadOlderTimelineEntries' scroll
// container is a best-effort guess (see its own comment) pending live
// testing, not a confirmed selector like everything else here.
// ===================================================================

(function () {
// Re-running the bookmarklet should focus the existing panel, not
// inject a second copy of everything - same pattern as Halo-Tool.js's
// window.__haloAssistant guard.
if (window.__konnectBookingCheck && window.__konnectBookingCheck.focus) {
window.__konnectBookingCheck.focus();
return;
}

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

// A specific day/relative-date mention in free text ("Monday",
// "tomorrow") even when the structured date field itself is blank -
// per instruction, this still gives enough to reference in a
// voicemail ("classified the date way"), so it's treated as
// equivalent to having a date rather than falling through to
// NON-BOOKING. First-pass list, not an exhaustive confirmed set.
const RELATIVE_DATE_WORDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tomorrow', 'today', 'tonight', 'next week', 'this week'];

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
// Real SLA export campaign values are always brand-prefixed
// ("Citroen - Enquiry - New", "Alfa Romeo - Enquiry - New", etc.) -
// confirmed live across every real Customer First lead tested. An
// exact-equality check against the bare "enquiry - new" never matches
// any real row, so match the campaign *category* by its trailing
// segment instead.
const normalizedCampaign = String(campaign || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizedSource = String(source || '').trim().toLowerCase();
return normalizedCampaign.endsWith('enquiry - new') && normalizedSource === 'customer first';
}

// Wording that shows genuine intent to come to the dealership (test
// drive / view the car) - first-pass list per instruction, not an
// exhaustive confirmed set like OVERRIDE_KEYWORDS; expect to extend as
// more real Test Drive Request leads are seen.
const TEST_DRIVE_INTENT_KEYWORDS = ['test drive', 'drive', 'look at', 'view', 'see the car', 'come in', 'visit', 'pop in'];

// Genuine expressed interest in a vehicle that stops short of visit
// intent (no "test drive"/"come in"/etc) - real example: "Hi I would
// potentially be interested in this vehicle, and trading in my..."
// Per instruction, this stays NON-BOOKING (no date, no visit intent -
// still requires a live call to get anywhere), but is more contactable
// than a blank/generic answer, so it ranks higher within NON-BOOKING
// (see bookingPriorityRank) rather than becoming its own category.
// First-pass phrase, not an exhaustive confirmed set.
const POTENTIAL_INTEREST_PHRASES = ['potentially be interested in', 'potentially interested in'];

// Deliberately a loose substring check, not the strict brand-prefix
// suffix match isInScope() uses for Enquiry-New - per instruction, this
// tier will also be sent leads whose Source isn't "Customer First" and
// whose Campaign wording may vary, so Campaign here is a routing hint
// ("sorting help"), not a hard gate that can reject a real lead.
function isTestDriveRequestCampaign(campaign) {
return String(campaign || '').trim().toLowerCase().includes('test drive');
}

// ===================================================================
// FULL MULTI-TIER FRAMEWORK - per the confirmed lead-filtering
// framework document (all 4 tiers), extending beyond the original
// Tier 2 Enquiry - New / Customer First-only scope. Dispatch order
// below follows the framework's own stated priority (Electric first,
// since it overrides regardless of any other campaign wording; the
// rest in the order its own "FILTERING ALGORITHM" summary gives),
// with Reserve - Used and Leapmotor (prose-only, not in that summary)
// inserted where they don't collide with anything else. All campaign/
// source matching stays a loose, lowercased substring check rather
// than the framework's own "(exact)" wording - an exact-match check
// already broke once in this file against real brand-prefixed
// campaign values (see isInScope's history), so every tier here is
// deliberately as lenient as that fix.
// ===================================================================

function isElectricCampaign(campaign) {
return String(campaign || '').toLowerCase().includes('electric');
}

function isReserveUsedCampaign(campaign) {
const c = String(campaign || '').toLowerCase();
return c.includes('reserve') && c.includes('used');
}

function isMotabilityCampaign(campaign) {
return String(campaign || '').toLowerCase().includes('motability');
}

function isLeapmotorSource(source) {
return String(source || '').toLowerCase().includes('leapmotor');
}

function isOfferRequestNewCampaign(campaign) {
const c = String(campaign || '').toLowerCase();
return c.includes('offer request') && c.includes('new');
}

function isPxValuationNewCampaign(campaign) {
const c = String(campaign || '').toLowerCase();
return (c.includes('px valuation') || c.includes('p/x valuation')) && c.includes('new');
}

function isEnquiryUsedCampaign(campaign) {
const c = String(campaign || '').toLowerCase();
return c.includes('enquiry') && c.includes('used');
}

function isRobinsDayEnquiryNew(campaign, source) {
const c = String(campaign || '').toLowerCase();
const s = String(source || '').toLowerCase();
return c.includes('enquiry') && c.includes('new') && s.includes('robins');
}

function isGeneralInterestCampaign(campaign, source) {
const c = String(campaign || '').toLowerCase();
const s = String(source || '').toLowerCase();
return c.includes('general') || c.includes('register interest') || c.includes('brochure download') || c.includes('inbound') || s.includes('inbound');
}

function isCargurusLead(campaign, source) {
const c = String(campaign || '').toLowerCase();
const s = String(source || '').toLowerCase();
return c.includes('cargurus') || s.includes('cargurus');
}

const MOTABILITY_BOOKING_WORDS = ['priority', 'booked', 'confirmation needed'];

const ENQUIRY_USED_SHOPPING_WORDS = ['imv', 'deal rating', 'email preferred', 'call preferred', 'text preferred', 'delivery cost'];

// Tier 1: Test Drive Request - New/Used. Per the framework, time-of-day
// preference words count as full DATE+TIME confirmation for THIS tier
// specifically (unlike Tier 2 Enquiry-New, where the same wording only
// reaches DATE ONLY) - the vehicle/date are already locked in via this
// campaign's own dropdown/field structure, so a time preference is
// enough to call it confirmed.
function classifyTestDriveRequestTier(hasDateField, comments, lower) {
// Finance/business/technical wording only overrides to Non-Booking
// when there's NO genuine visit-intent wording alongside it - per
// instruction, a lead that also shows real interest in coming in
// shouldn't be suppressed just because it mentions a quote too.
if (containsAny(lower, OVERRIDE_KEYWORDS) && !containsAny(lower, TEST_DRIVE_INTENT_KEYWORDS)) {
return { category: 'NON-BOOKING', reason: 'Test Drive Request lead, but comments mention finance/business/technical-support wording with no visit-intent wording alongside it, which overrides to Non-Booking.', confidence: 'high' };
}
if (hasDateField) {
if (isBlankComments(comments)) {
return { category: 'DATE ONLY', reason: 'Test Drive Request lead: date field present, Customer Comments is blank.', confidence: 'high' };
}
if (containsAny(lower, TIME_PREFERENCE_WORDS) || EXACT_TIME_PATTERN.test(comments)) {
return { category: 'CONFIRMED DATE & TIME', reason: 'Test Drive Request lead: date field present with a time preference or exact time in comments.', confidence: 'high' };
}
return { category: 'DATE ONLY', reason: 'Test Drive Request lead: date field present, no time indication in comments.', confidence: 'medium' };
}
if (!isBlankComments(comments) && containsAny(lower, TEST_DRIVE_INTENT_KEYWORDS)) {
return { category: 'WARM ENQUIRY', reason: 'Test Drive Request lead with a genuine answer mentioning a dealership visit/test drive - no date field present for this tier.', confidence: 'medium' };
}
return { category: 'NON-BOOKING', reason: 'Test Drive Request lead with no date field and no dealership-visit wording in comments.', confidence: 'medium' };
}

// Tier 2: Enquiry - New / Customer First - the original, battle-tested
// scope, unchanged from its own iteration (Oscar Scully's brand-prefix
// fix, Stephen Dracup's no-date-but-test-drive-mention carve-out, and
// relative-date-in-comments detection all still apply exactly as
// before).
function classifyEnquiryNewCustomerFirstTier(hasDateField, comments, lower) {
// Finance/business/technical wording only overrides to Non-Booking
// when there's NO genuine visit-intent wording alongside it - per
// instruction, a lead that also shows real interest in coming in
// shouldn't be suppressed just because it mentions a quote too.
if (containsAny(lower, OVERRIDE_KEYWORDS) && !containsAny(lower, TEST_DRIVE_INTENT_KEYWORDS)) {
return {
category: 'NON-BOOKING',
reason: 'Comments mention finance/business/technical-support wording with no visit-intent wording alongside it, which overrides to Non-Booking regardless of any date field.',
confidence: 'high'
};
}

if (!hasDateField) {
if (containsAny(lower, RELATIVE_DATE_WORDS)) {
if (EXACT_TIME_PATTERN.test(comments)) {
return {
category: 'CONFIRMED DATE & TIME',
reason: 'No structured date field, but comments state a specific day/date together with an exact time - as concrete as a confirmed booking.',
confidence: 'medium'
};
}
return {
category: 'DATE ONLY',
reason: 'No structured date field, but comments mention a specific day/relative date - still enough to reference in a voicemail.',
confidence: 'medium'
};
}
if (!isBlankComments(comments) && containsAny(lower, TEST_DRIVE_INTENT_KEYWORDS)) {
return {
category: 'WARM ENQUIRY',
reason: 'No date field, but comments show genuine dealership-visit/test-drive intent - counts as a booking regardless of date.',
confidence: 'medium'
};
}
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

return {
category: 'CONFIRMED DATE & TIME',
reason: 'Date field present and comments contain genuine context beyond a blank or time-preference-only response.',
confidence: 'high'
};
}

function classifyMotabilityTier(comments, lower) {
if (containsAny(lower, MOTABILITY_BOOKING_WORDS) && EXACT_TIME_PATTERN.test(comments)) {
return { category: 'CONFIRMED DATE & TIME', reason: 'Motability lead: comments explicitly state booking language with a specific time.', confidence: 'high' };
}
return { category: 'NON-BOOKING', reason: 'Motability lead: no explicit booking/priority language with a specific time - most Motability leads have no date confirmed initially.', confidence: 'medium' };
}

// The framework's own vocabulary calls this "WARM ENQUIRY" too - same
// real-world shape as the dedicated test-drive/visit-intent case:
// no date anywhere, but a genuine signal of interest, so it requires
// reaching the customer live rather than being actionable by voicemail
// alone.
// Which specific vehicle page they visited is tracked behavior, not
// anything the customer said - per instruction, that's not a real
// warm signal, just browsing/valuation-checking. WARM ENQUIRY requires
// the same "genuine answer showing visit intent" wording every other
// tier uses, not merely having looked at one particular model's page.
// No OVERRIDE_KEYWORDS check here, unlike every other tier - PX
// Valuation's comments are a tracked URL, not the customer's own
// words (the framework never specified a finance-override for this
// tier either). A real bug this exposed: 'pch' (a FINANCE_KEYWORDS
// entry) matches as a bare substring anywhere, including inside a URL
// slug like ".../citroen-c5-aircross-pch" - a very common real
// dealer-site pattern for a PCH/finance vehicle listing, not the
// customer discussing finance at all. Didn't change the final
// category here (both branches land on NON-BOOKING), but mislabelled
// the reason and was one visit-intent-keyword collision away from
// mislabelling the category too.
function classifyPxValuationTier(comments, lower) {
if (!isBlankComments(comments) && containsAny(lower, TEST_DRIVE_INTENT_KEYWORDS)) {
return { category: 'WARM ENQUIRY', reason: 'PX Valuation lead with a genuine answer showing dealership-visit intent.', confidence: 'medium' };
}
if (containsAny(lower, POTENTIAL_INTEREST_PHRASES)) {
return { category: 'NON-BOOKING', reason: 'PX Valuation lead: comments express genuine interest in a vehicle, but no visit intent - still Non-Booking, but more contactable than a generic page visit.', confidence: 'medium' };
}
return { category: 'NON-BOOKING', reason: 'PX Valuation lead: a specific vehicle page visit alone is tracked behavior, not something the customer said - not a real warm signal.', confidence: 'medium' };
}

function classifyEnquiryUsedTier(source, comments, lower) {
const sourceLower = String(source || '').toLowerCase();
if (sourceLower.includes('phone') && EXACT_TIME_PATTERN.test(comments)) {
return { category: 'CONFIRMED DATE & TIME', reason: 'Enquiry - Used lead: phone source with a specific date and time in comments.', confidence: 'high' };
}
if (containsAny(lower, ENQUIRY_USED_SHOPPING_WORDS) || sourceLower.includes('cargurus')) {
return { category: 'NON-BOOKING', reason: 'Enquiry - Used lead: comments show price-comparison/shopping language (IMV, deal rating, etc), not booking intent.', confidence: 'high' };
}
// A registration/model mention or a vague phrase like "requests call"
// isn't enough on its own - per instruction, that doesn't actually
// show they want to visit, same as PX Valuation's page-visit-alone
// issue. WARM ENQUIRY requires the same genuine visit-intent wording
// every other tier uses.
if (!isBlankComments(comments) && containsAny(lower, TEST_DRIVE_INTENT_KEYWORDS)) {
return { category: 'WARM ENQUIRY', reason: 'Enquiry - Used lead with a genuine answer showing dealership-visit intent, but no date confirmed - worth calling on.', confidence: 'medium' };
}
return { category: 'NON-BOOKING', reason: 'Enquiry - Used lead: no genuine visit-intent wording identified.', confidence: 'medium' };
}

function classifyInitialNotes(initialNotes, { campaign, source } = {}) {
const { hasDateField, comments } = parseInitialNotesFields(initialNotes);
const lower = comments.toLowerCase();

// Tier 1: Electric - checked first since it overrides regardless of
// any other campaign wording, per the framework's explicit rule.
if (isElectricCampaign(campaign)) {
return { category: 'CONFIRMED DATE & TIME', reason: 'Brand - Electric campaign: treated as confirmed date & time per the framework\'s stated rule for this campaign type.', confidence: 'medium' };
}

// Tier 1: Reserve - Used - already actioned online, nothing for this
// tool to book. Mapped to NON-BOOKING (no separate "already actioned"
// category) - there's no live-contact follow-up needed here either,
// unlike a genuine NON-BOOKING enquiry, but it's the closest of the
// four agreed categories and keeps the vocabulary from growing.
if (isReserveUsedCampaign(campaign)) {
return { category: 'NON-BOOKING', reason: 'Reserve - Used campaign: vehicle already reserved online, not applicable to booking tiers.', confidence: 'high' };
}

// Tier 1: Test Drive Request - New/Used.
if (isTestDriveRequestCampaign(campaign)) {
return classifyTestDriveRequestTier(hasDateField, comments, lower);
}

// Tier 2: Enquiry - New / Customer First - original scope, unchanged.
if (isInScope(campaign, source)) {
return classifyEnquiryNewCustomerFirstTier(hasDateField, comments, lower);
}

// Tier 2: Motability.
if (isMotabilityCampaign(campaign)) {
return classifyMotabilityTier(comments, lower);
}

// Tier 2: Leapmotor - deliberately always Non-Booking per the
// framework's own explicit choice, despite noting high conversion
// potential, pending its own rules being confirmed.
if (isLeapmotorSource(source)) {
return { category: 'NON-BOOKING', reason: 'Leapmotor source: requires call confirmation despite high conversion potential - flagged Non-Booking pending its own rules.', confidence: 'medium' };
}

// Tier 3: Offer Request - New - always Non-Booking by definition.
if (isOfferRequestNewCampaign(campaign)) {
return { category: 'NON-BOOKING', reason: 'Offer Request - New campaign: 100% quote/offer interest by definition, never a booking.', confidence: 'high' };
}

// Tier 3: PX Valuation - New.
if (isPxValuationNewCampaign(campaign)) {
return classifyPxValuationTier(comments, lower);
}

// Tier 3: Enquiry - Used.
if (isEnquiryUsedCampaign(campaign)) {
return classifyEnquiryUsedTier(source, comments, lower);
}

// Tier 4: Enquiry - New (Robins & Day Website) - always Non-Booking by
// definition (a plain campaign-form completion, not this dealership's
// own Customer First enquiry).
if (isRobinsDayEnquiryNew(campaign, source)) {
return { category: 'NON-BOOKING', reason: 'Enquiry - New from Robins & Day Website: 100% campaign form completion by definition, never a booking.', confidence: 'high' };
}

// Tier 4: General / Register Interest / Brochure Download / Inbound.
if (isGeneralInterestCampaign(campaign, source)) {
return { category: 'NON-BOOKING', reason: 'General/register-interest/brochure/inbound campaign: research or interest capture, not a booking.', confidence: 'high' };
}

// Tier 4: Cargurus (catch-all if not already caught under Enquiry -
// Used above).
if (isCargurusLead(campaign, source)) {
return { category: 'NON-BOOKING', reason: 'Cargurus lead: third-party price-comparison platform, not a direct booking.', confidence: 'high' };
}

// Final catch-all shared across every tier: finance/business/
// technical wording overrides to Non-Booking regardless of tier.
if (containsAny(lower, OVERRIDE_KEYWORDS)) {
return {
category: 'NON-BOOKING',
reason: 'Comments mention finance/business/technical-support wording, which overrides to Non-Booking regardless of tier.',
confidence: 'high'
};
}

// Unmatched by any confirmed tier rule - safe default rather than
// guessing at a campaign/source combination the framework never
// described.
return {
category: 'NON-BOOKING',
reason: `Campaign="${campaign || ''}" / Source="${source || ''}" doesn't match any confirmed tier rule - defaulting to Non-Booking rather than guessing.`,
confidence: 'low'
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
// 15s, not the default 8s - confirmed live (same lesson learned
// repeatedly on the Konnect Manager side, e.g. the Live Campaigns
// month selector): the FIRST navigation to a route in a session can be
// meaningfully slower than every visit after it, and a slow-but-
// successful wait costs nothing since it resolves the moment the
// element actually appears either way.
async function openSearchPage() {
window.location.hash = KONNECT_LIVE_SEARCH_HASH;
const radio = await waitForElement('input[name="bookingSearchBy"]', 15000);
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
// treat that as SEARCH_TIMEOUT, not a zero-result search. Both waits
// widened from their original tighter defaults (1500ms/8000ms) after a
// real first-search-in-a-session SEARCH_TIMEOUT, with the very next
// search (same session, already warmed up) succeeding immediately
// after - the same "first time is slower" pattern as openSearchPage.
async function submitSearchAndWaitForResults(timeout = 15000) {
const button = findSearchButton();
if (!button || button.disabled) return null;
button.click();
const started = await waitForSpinnerState(true, 5000);
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
// TIMELINE READINESS (state machine step: WAIT_FOR_TIMELINE)
//
// Confirmed live via a high-resolution repeated trace: the route
// changes (~825ms) well before the timeline actually finishes loading
// (~1000-1160ms) - customer identity even populates mid-load, so
// "route changed" and "customer root exists" are both real but
// insufficient signals on their own. The verified boundary is route +
// both roots present + loading spinner hidden + Refresh control
// visible. Pink entries are deliberately NOT required - a customer can
// legitimately have zero sales leads and still be a fully "loaded"
// timeline (READY_WITH_ZERO_ELIGIBLE_SALES_LEADS), which the caller
// then treats as NO_ELIGIBLE_LEAD_EVENTS rather than waiting forever
// for pink entries that will never appear.
// ===================================================================

const CONNECTED_CUSTOMER_ROUTE_PATTERN = /^#\/connectedCustomer\/\d+(?:\?|$)/;
const CUSTOMER_ROOT_SELECTOR = 'div[ng-view] > div.ng-scope:has(> .row.timeline-editing-header)';
const CUSTOMER_ROOT_FALLBACK_SELECTOR = 'div.ng-scope:has(> .row.timeline-editing-header)';
const TIMELINE_ROOT_SELECTOR = 'div[ng-view] > div.ng-scope:has(> .row.timeline-editing-header) > div[style="margin-top:80px;"]';
const TIMELINE_ROOT_FALLBACK_SELECTOR = '.row.timeline-editing-header + div[style="margin-top:80px;"]';
const TIMELINE_LOADING_SELECTOR = 'i[title="Refreshing..."][ng-show="loading"]';
const TIMELINE_REFRESH_READY_SELECTOR = 'i[title="Refresh"][ng-show="!loading"]';

// ng-hide is a CSS class (display:none), but this checks the actual
// computed state rather than the class name itself - the same
// dimension/opacity/display checks confirmed live, robust to however
// the hidden state is actually implemented.
function isRendered(element) {
if (!element) return false;
const style = getComputedStyle(element);
return style.display !== 'none'
&& style.visibility !== 'hidden'
&& Number(style.opacity) !== 0
&& !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

function findCustomerRoot() {
return document.querySelector(CUSTOMER_ROOT_SELECTOR) || document.querySelector(CUSTOMER_ROOT_FALLBACK_SELECTOR);
}

function findTimelineRoot() {
return document.querySelector(TIMELINE_ROOT_SELECTOR) || document.querySelector(TIMELINE_ROOT_FALLBACK_SELECTOR);
}

function getTimelineReadyState() {
if (!CONNECTED_CUSTOMER_ROUTE_PATTERN.test(window.location.hash)) {
return { state: 'NOT_READY', reason: 'Connected-customer route not active' };
}

const customerRoot = findCustomerRoot();
const timelineRoot = findTimelineRoot();
if (!customerRoot || !timelineRoot) {
return { state: 'NOT_READY', reason: 'Customer or timeline root absent' };
}

const loading = isRendered(document.querySelector(TIMELINE_LOADING_SELECTOR));
const refreshReady = isRendered(document.querySelector(TIMELINE_REFRESH_READY_SELECTOR));
if (loading || !refreshReady) {
return { state: 'LOADING', reason: loading ? 'Refreshing indicator is visibly rendered' : 'Refresh control is not yet visibly rendered' };
}

const eligiblePinkEntries = timelineRoot.querySelectorAll('a.connected-customer-timeline-centre-pink').length;
if (eligiblePinkEntries > 0) {
return { state: 'READY_WITH_SALES_LEADS', reason: 'Loading indicator hidden, Refresh visible, eligible pink entries present', timelineRoot, eligiblePinkEntries };
}
return { state: 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS', reason: 'Loading indicator hidden and Refresh visible; no eligible pink entries present', timelineRoot, eligiblePinkEntries: 0 };
}

// Confirmed normal completion lands around 1-1.2s; the 10s ceiling is a
// genuine failure boundary, not a routine wait. Driven primarily by
// MutationObserver (used throughout this file and the rest of the
// WorkBookmarklets codebase without issue) with a 100ms poll as a
// defensive fallback, since the live inspection that confirmed this
// signal couldn't itself verify MutationObserver firing reliability in
// its sandboxed environment.
//
// Resolving the instant the Refresh icon first appears turned out to
// be an intermittent race (reported live: same batch, same customer,
// no data difference, only sometimes failed to find a lead that was
// definitely there) - the same class of bug already confirmed twice
// elsewhere in this file (the lead modal's Date/Source fields existing
// as empty shells before Angular's data-binding actually populated
// them; the search input's own confirmed ng-model-options debounce):
// a loading indicator can clear before the ng-repeat digest has
// finished rendering every entry into the DOM. Requiring the eligible-
// entry count to stay unchanged for one quiet 300ms window before
// resolving - not the instant readiness is first observed - catches a
// still-populating timeline instead of scanning it mid-render.
function waitForTimelineReady(timeout = 10000) {
return new Promise((resolve) => {
const startedAt = Date.now();
let settled = false;
let settleTimer = null;
let lastEntryCount = -1;

function finish(result) {
if (settled) return;
settled = true;
clearInterval(pollTimer);
clearTimeout(settleTimer);
observer.disconnect();
resolve(result);
}

function scheduleSettleCheck(state) {
clearTimeout(settleTimer);
lastEntryCount = state.eligiblePinkEntries;
settleTimer = setTimeout(() => {
const recheck = getTimelineReadyState();
const stillReady = recheck.state === 'READY_WITH_SALES_LEADS' || recheck.state === 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS';
if (stillReady && recheck.eligiblePinkEntries === lastEntryCount) {
finish(recheck);
}
// Otherwise the next mutation/poll tick re-drives check() itself.
}, 300);
}

function check() {
if (settled) return true;
const state = getTimelineReadyState();
if (state.state === 'READY_WITH_SALES_LEADS' || state.state === 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS') {
if (!settleTimer || state.eligiblePinkEntries !== lastEntryCount) scheduleSettleCheck(state);
return false;
}
if (Date.now() - startedAt >= timeout) {
finish({ state: 'FAILED', reason: `Timed out waiting for timeline readiness (last state: ${state.state} - ${state.reason})` });
return true;
}
return false;
}

check();

const observer = new MutationObserver(() => { check(); });
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
const pollTimer = setInterval(check, 100);
});
}

// Clicks the confirmed customer-record link (rejecting mailto:/tel:
// links defensively via isSafeCustomerLink) and waits for the full
// confirmed readiness predicate above - not just the route changing,
// which is confirmed to happen well before the timeline actually
// finishes loading.
async function openCustomerAndWaitForTimeline(customerResult, timeout = 10000) {
if (!customerResult || !customerResult.link || !isSafeCustomerLink(customerResult.link)) {
return { state: 'FAILED', reason: 'CUSTOMER_NOT_LINKED' };
}
customerResult.link.click();
return waitForTimelineReady(timeout);
}

window.KonnectBookingCheck.getTimelineReadyState = getTimelineReadyState;
window.KonnectBookingCheck.waitForTimelineReady = waitForTimelineReady;
window.KonnectBookingCheck.openCustomerAndWaitForTimeline = openCustomerAndWaitForTimeline;

(function timelineReadinessSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

check('connected customer route matches', CONNECTED_CUSTOMER_ROUTE_PATTERN.test('#/connectedCustomer/3487237?redirectRoute=%2Fsearch'), true);
check('connected customer route matches with no query', CONNECTED_CUSTOMER_ROUTE_PATTERN.test('#/connectedCustomer/3487237'), true);
check('search route does not match', CONNECTED_CUSTOMER_ROUTE_PATTERN.test('#/search?redirectRoute=%2Fsearch'), false);

if (failures.length > 0) {
console.error('KonnectBookingCheck timeline-readiness self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck timeline-readiness self-test passed (3/3)');
}
})();

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
//
// "Manually Created Sales Lead from" is not the only genuine lead
// heading, though - confirmed live via a real false-negative: a Tier 2
// Customer First lead's actual heading is "New Sales Lead from Customer
// First", a different (and equally genuine - automatically created
// from an online enquiry rather than entered by staff) prefix the
// original scan's single test customer never happened to have. Both
// are accepted; the 4th, still-unidentified non-lead pink entry from
// that original scan is presumed to be neither (its own heading text
// was never captured), so this may still need widening again if a
// third genuine prefix turns up.
const LEAD_HEADING_PREFIXES = ['Manually Created Sales Lead from', 'New Sales Lead from'];

function getLoadedLeadEntries() {
const icons = [...document.querySelectorAll('a.connected-customer-timeline-centre-pink')];
const rows = icons
.map((icon) => icon.closest('div.row.ng-scope[ng-repeat*="customerTimeLine"]'))
.filter(Boolean);
return [...new Set(rows)].filter((row) => {
const heading = row.querySelector('.connected-customer-title-pink');
const text = heading?.textContent.replace(/\s+/g, ' ').trim() || '';
return LEAD_HEADING_PREFIXES.some((prefix) => text.startsWith(prefix));
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
// #txtInitialNotes (and the Date/Source footer fields) can exist as
// empty shells the instant the modal's structure renders, before
// Angular's own data-binding has actually populated them a moment
// later - confirmed live: automation was opening a real modal,
// reading it while still blank, and closing it again fast enough to
// never visually register as having opened at all (matching Date/
// Source both coming back empty in every real test run). The
// original spec's own stated readiness condition ("Date and Source
// are present") was never actually implemented in its reference code,
// which only checked #txtInitialNotes existing - this closes that
// gap by requiring Date to have a genuine value too, not just its
// container existing.
const dateValue = extractLabeledFooterField(panel, 'Date');
if (!dateValue) return null;
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
//
// 10s, not the confirmed ~1-1.2s-implies-3s-is-plenty figure - real
// testing found this genuinely timing out (same "first action in a
// session is slower" pattern already found twice elsewhere in this
// tool: the search page and the search-submit wait). A slow-but-
// successful wait costs nothing.
async function openLeadModal(row, timeout = 10000) {
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

// Campaign is NOT a reliable confirmation field, confirmed live on a
// real, objectively-correct match (Date matched to the minute, Source
// matched exactly): the SLA table's own "Campaign" column and the lead
// modal's "Campaign" field are different underlying data, not the same
// value in a different format - one is Konnect's own SLA-queue
// categorization ("Citroen - Enquiry - New"), the other is the lead's
// actual marketing campaign/form name ("Test drive request"). Treating
// a mismatch here as a contradiction was rejecting correct leads every
// time. Kept as an informational warning only, never a rejection.
const warnings = [];
if (slaRow.campaign && panelFields.campaign && (panelFields.campaign.primary || panelFields.campaign.parenthetical)) {
const target = normalizeForCompare(slaRow.campaign);
const primaryMatch = panelFields.campaign.primary && normalizeForCompare(panelFields.campaign.primary) === target;
const parentheticalMatch = panelFields.campaign.parenthetical && normalizeForCompare(panelFields.campaign.parenthetical) === target;
if (!primaryMatch && !parentheticalMatch) {
warnings.push(`Campaign differs (informational only, not a rejection): SLA="${slaRow.campaign}" modal primary="${panelFields.campaign.primary || ''}" parenthetical="${panelFields.campaign.parenthetical || ''}"`);
}
}

return { ok: true, warnings };
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

// BEST-EFFORT, NOT CONFIRMED - unlike everything else in this file, the
// real scroll container was never verified live (the spec itself flags
// this and says to keep it replaceable rather than guess at a fixed
// selector). Reasoning for this specific attempt: the confirmed
// timeline root (div[style="margin-top:80px;"]) showed no overflow-y
// styling and its height simply grows with row count (0 -> 3001px for
// 20 rows), which is what a plain document-flow element does, not an
// internally-scrolling one - so this first looks for a genuinely
// scrollable ancestor between the timeline root and <body>, and only
// falls back to scrolling the window itself if none is found. Detects
// progress by diffing timelineEntryKey() sets before/after, not by
// trusting the scroll call itself to mean anything happened.
function findScrollableAncestor(element) {
let node = element ? element.parentElement : null;
while (node && node !== document.body) {
const style = getComputedStyle(node);
const canScrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
if (canScrollY) return node;
node = node.parentElement;
}
return null;
}

async function loadOlderTimelineEntries(maxAttempts = 3, settleMs = 400) {
const timelineRoot = findTimelineRoot();
if (!timelineRoot) return { status: 'TIMELINE_SCROLL_CONTAINER_UNKNOWN', loadedNewEntries: false };

const scrollTarget = findScrollableAncestor(timelineRoot);
const beforeKeys = new Set(getLoadedLeadEntries().map(timelineEntryKey));

for (let attempt = 0; attempt < maxAttempts; attempt++) {
if (scrollTarget) {
const before = scrollTarget.scrollTop;
scrollTarget.scrollTop = Math.max(0, before - scrollTarget.clientHeight);
if (scrollTarget.scrollTop === before) break; // already at the top - nothing more to load
} else {
const before = window.scrollY;
window.scrollTo(window.scrollX, Math.max(0, before - window.innerHeight));
if (window.scrollY === before) break;
}

await sleep(settleMs);
const afterKeys = getLoadedLeadEntries().map(timelineEntryKey);
if (afterKeys.some((key) => !beforeKeys.has(key))) {
return { status: 'OK', loadedNewEntries: true, scrollContainer: scrollTarget ? 'internal' : 'window' };
}
}

return { status: 'OK', loadedNewEntries: false, scrollContainer: scrollTarget ? 'internal' : 'window' };
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
{ name: 'LEAD 117', date: null, comments: "I'm interested in your 0% purchase offer for the e-C3. Please send details and your best purchase price", expect: 'NON-BOOKING' },
// Real SLA export campaigns are always brand-prefixed (e.g. "Citroen -
// Enquiry - New") rather than the bare "Enquiry - New" - confirmed
// live via Oscar Scully's row, which was wrongly falling into
// NON-BOOKING/"Outside current scope" before isInScope() was fixed to
// match on the trailing campaign segment instead of exact equality.
{ name: 'Oscar Scully (brand-prefixed campaign)', date: '29/09/2026', comments: '-', campaign: 'Citroen - Enquiry - New', expect: 'DATE ONLY' },
// Test Drive Request CAMPAIGN tier: no date/time required, Source
// isn't "Customer First", and Campaign is only loosely matched - all
// per instruction, since this tier will be sent non-Customer-First
// leads too and Campaign/Source are a routing hint here, not a hard
// gate.
{ name: 'Test Drive Request campaign, no date, answered', date: null, comments: 'Would like to test drive the new C4 this weekend', campaign: 'Citroen - Test Drive Request', source: 'Website', expect: 'WARM ENQUIRY' },
{ name: 'Test Drive Request campaign, blank comments', date: null, comments: '-', campaign: 'Citroen - Test Drive Request', source: 'Website', expect: 'NON-BOOKING' },
{ name: 'Test Drive Request campaign, finance wording alone (override)', date: null, comments: 'Can I get a PCH quote please', campaign: 'Citroen - Test Drive Request', source: 'Website', expect: 'NON-BOOKING' },
// Per instruction: finance wording does NOT override to Non-Booking
// when genuine visit-intent wording is also present - the visit intent
// wins.
{ name: 'Test Drive Request campaign, finance wording + visit intent (visit intent wins)', date: null, comments: 'Can I get a PCH quote as well as a test drive', campaign: 'Citroen - Test Drive Request', source: 'Website', expect: 'WARM ENQUIRY' },
// Stephen Dracup's REAL lead: Campaign is genuinely "Citroen - Enquiry
// - New" / Customer First (in Tier 2, not a Test Drive Request
// campaign at all) - isTestDriveRequestCampaign() never applies here.
// He had no date field, and was still coming back NON-BOOKING despite
// mentioning "test drive", because the !hasDateField branch used to
// bail before ever looking at the comments. This is the case that
// exposed that gap.
{ name: 'Stephen Dracup (real: Enquiry - New, no date, mentions test drive)', date: null, comments: 'Would like to book a test drive when convenient', campaign: 'Citroen - Enquiry - New', source: 'Customer First', expect: 'WARM ENQUIRY' },
// Per instruction: finance/business/technical wording does NOT override
// to Non-Booking when genuine visit-intent wording is also present.
{ name: 'Enquiry - New: finance wording + visit intent (visit intent wins)', date: null, comments: 'Could I get a finance quote, and also come in to view the car', campaign: 'Citroen - Enquiry - New', source: 'Customer First', expect: 'WARM ENQUIRY' },
// Relative-date-in-comments ("classified the date way"): no structured
// date field, but the comments name a specific day/relative date -
// still voicemail-actionable, same DATE ONLY tier as a real date field
// alone.
{ name: 'No date field, comments say "Monday"', date: null, comments: 'Could come in Monday if possible', expect: 'DATE ONLY' },
{ name: 'No date field, comments say "tomorrow"', date: null, comments: 'Free tomorrow afternoon', expect: 'DATE ONLY' },
// Visit-intent wording plus a relative-date mention: the relative-date
// wins the category (still DATE ONLY, not WARM ENQUIRY) - the
// day mentioned is what makes it voicemail-actionable regardless of
// the "view"/"test drive" wording also being present.
{ name: 'Visit intent + relative date: "view this vehicle tomorrow"', date: null, comments: 'Id like to view this vehicle tomorrow', expect: 'DATE ONLY' },
// Relative-date PLUS an exact time is as concrete as a real confirmed
// date+time, even with no structured date field.
{ name: 'No date field, comments say "Monday at 3pm"', date: null, comments: 'Monday at 3pm works for me', expect: 'CONFIRMED DATE & TIME' },

// ===== Tier 1: Electric - always confirmed, regardless of comments. =====
{ name: 'Electric campaign (always confirmed)', date: null, comments: '-', campaign: 'Citroen - Electric', expect: 'CONFIRMED DATE & TIME' },

// ===== Tier 1: Reserve - Used - already actioned, not a booking lead. =====
{ name: 'Reserve - Used (already reserved online)', date: null, comments: 'Vehicle reserved online', campaign: 'Citroen - Reserve - Used', expect: 'NON-BOOKING' },

// ===== Tier 1: Test Drive Request WITH a date field - unlike Tier 2,
// time-preference words alone count as full confirmation here. =====
{ name: 'Test Drive Request + date + "early appointment"', date: '06/08/2026', comments: 'early appointment', campaign: 'Citroen - Test Drive Request', source: 'Robins & Day Website', expect: 'CONFIRMED DATE & TIME' },
{ name: 'Test Drive Request + date + "Sunday morning please earliest slot"', date: '09/08/2026', comments: 'Sunday morning please earliest slot', campaign: 'Citroen - Test Drive Request', source: 'Robins & Day Website', expect: 'CONFIRMED DATE & TIME' },
{ name: 'Test Drive Request + date + blank comments', date: '04/08/2026', comments: '-', campaign: 'Citroen - Test Drive Request', source: 'Robins & Day Website', expect: 'DATE ONLY' },
{ name: 'Test Drive Request + date + "Would like to see/test drive" (no time)', date: '08/08/2026', comments: 'Would like to see/test drive', campaign: 'Citroen - Test Drive Request', source: 'Robins & Day Website', expect: 'DATE ONLY' },

// ===== Tier 2: Motability - only confirmed with explicit booking
// language AND a specific time; blank/generic defaults to Non-Booking. =====
{ name: 'Motability + explicit booking language + time', date: null, comments: 'PRIORITY ACCEPTANCE REQUIRED. Customer booked 05/08 at 15:00', campaign: 'Motability', expect: 'CONFIRMED DATE & TIME' },
{ name: 'Motability + blank (default)', date: null, comments: '-', campaign: 'Motability', expect: 'NON-BOOKING' },

// ===== Tier 2: Leapmotor - always Non-Booking for now, per the
// framework's own explicit choice despite noting high conversion
// potential. Also confirms campaign text ending in "Enquiry - New"
// doesn't get mis-routed into Tier 2 when Source isn't Customer First. =====
{ name: 'Leapmotor source (default requires call)', date: null, comments: '123456', campaign: 'Leapmotor - Enquiry - New', source: 'Leapmotor', expect: 'NON-BOOKING' },

// ===== Tier 3: Offer Request - New - always Non-Booking by definition. =====
{ name: 'Offer Request - New (always non-booking)', date: null, comments: '-', campaign: 'Citroen - Offer Request - New', expect: 'NON-BOOKING' },

// ===== Tier 3: PX Valuation - New - visiting a specific vehicle's
// page alone is tracked behavior, not something the customer said, so
// it's NOT a warm lead by itself. WARM ENQUIRY requires genuine
// visit-intent wording in the comments, same as every other tier. =====
{ name: 'PX Valuation + specific vehicle page visit alone (not warm)', date: null, comments: 'The customer was on the following website page: https://x/citroen-c3-aircross-pch', campaign: 'PX Valuation - New', source: 'Robins & Day Website', expect: 'NON-BOOKING' },
{ name: 'PX Valuation + generic valuation page', date: null, comments: 'https://stellantisandyou.co.uk/car-valuation', campaign: 'PX Valuation - New', source: 'Robins & Day Website', expect: 'NON-BOOKING' },
// Real reported phrasing, with a "-pch" URL slug (a common real
// dealer-site PCH/finance vehicle-listing suffix) - confirms the
// FINANCE_KEYWORDS 'pch' entry matching inside a URL slug doesn't
// hijack this into the (now-removed) override branch.
{ name: 'PX Valuation + "website page, before completing the valuation" phrasing with -pch URL', date: null, comments: 'The customer was on the following website page, before completing the valuation: https://example.com/citroen-c5-aircross-pch', campaign: 'PX Valuation - New', source: 'Robins & Day Website', expect: 'NON-BOOKING' },
// Genuine interest short of visit intent - still Non-Booking (no
// separate category), but ranks higher within it (see the priority-
// rank check below).
{ name: 'PX Valuation + "potentially interested in" (still non-booking, more contactable)', date: null, comments: 'Hi I would potentially be interested in this vehicle, and trading in my 2010 hyundai santa fe. Could i speak to someone about this, i am based in Cornwall.', campaign: 'PX Valuation - New', source: 'Robins & Day Website', expect: 'NON-BOOKING' },
{ name: 'PX Valuation + genuine visit-intent wording (warm)', date: null, comments: 'Would like to come in and view the C5 Aircross in person', campaign: 'PX Valuation - New', source: 'Robins & Day Website', expect: 'WARM ENQUIRY' },

// ===== Tier 3: Enquiry - Used - phone+time is confirmed. A vague
// phrase like "requests call" is NOT enough for WARM ENQUIRY on its
// own (doesn't actually show visit intent); genuine visit-intent
// wording does. Cargurus/shopping language is Non-Booking. =====
{ name: 'Enquiry - Used + phone + date/time', date: null, comments: '05/08/2026, 12:00 test drive C4 X Max before discussing transfer', campaign: 'Enquiry - Used', source: 'Phone call (Inbound)', expect: 'CONFIRMED DATE & TIME' },
{ name: 'Enquiry - Used + registration + "requests call" alone (not warm)', date: null, comments: 'Jeep Avenger SUV WR25XYT - requests call', campaign: 'Enquiry - Used', source: 'Robins & Day Website', expect: 'NON-BOOKING' },
{ name: 'Enquiry - Used + genuine visit-intent wording (warm)', date: null, comments: 'Jeep Avenger SUV WR25XYT - wants to come and view it', campaign: 'Enquiry - Used', source: 'Robins & Day Website', expect: 'WARM ENQUIRY' },
{ name: 'Enquiry - Used + Cargurus shopping language', date: null, comments: 'IMV £17,499, high price, email preferred', campaign: 'Enquiry - Used', source: 'Cargurus', expect: 'NON-BOOKING' },

// ===== Tier 4: Enquiry - New from Robins & Day Website - always
// Non-Booking by definition (a plain campaign-form completion, unlike
// Tier 2's Customer First enquiries). =====
{ name: 'Enquiry - New from Robins & Day (always non-booking)', date: null, comments: 'Source: Citroen e-C3 Aircross PCH Enquiry Form', campaign: 'Enquiry - New', source: 'Robins & Day Website', expect: 'NON-BOOKING' },

// ===== Tier 4: General/Register Interest/Brochure/Inbound - research
// or interest capture, never a booking. =====
{ name: 'General campaign (research/interest capture)', date: null, comments: 'Sourced from mobility scheme enquiry', campaign: 'General', source: 'Robins & Day Website', expect: 'NON-BOOKING' },

// ===== Tier 4: Cargurus, standalone (not also an Enquiry - Used
// campaign) - still catches via the dedicated Cargurus check. =====
{ name: 'Cargurus lead (standalone campaign)', date: null, comments: 'IMV £15,000, deal rating: fair', campaign: 'Cargurus Lead', source: 'Cargurus', expect: 'NON-BOOKING' }
];

const failures = [];
cases.forEach((c) => {
const result = classifyInitialNotes(notesFor(c.date, c.comments), { campaign: c.campaign || CAMPAIGN, source: c.source || SOURCE });
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

// ===================================================================
// ORCHESTRATION (the outer per-row/per-customer state machine loop)
// and UI PANEL - the two pieces this file was still missing. Everything
// this section calls (search, timeline, modal, classify) is already
// built and confirmed above; this just wires it together in order.
//
// Cancellation/pause are cooperative, checked between steps, not true
// abort-in-flight - none of the built wait functions accept an abort
// signal, so a Cancel press stops the loop from starting its NEXT step
// rather than interrupting a wait already underway. Acceptable given
// waits are bounded (a few seconds at most).
// ===================================================================

const SESSION_STORAGE_KEY = 'konnectBookingCheck:session:v1';

function saveSession(session) {
try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch (error) { /* ignore */ }
}
function loadStoredSession() {
try {
const raw = localStorage.getItem(SESSION_STORAGE_KEY);
return raw ? JSON.parse(raw) : null;
} catch (error) { return null; }
}
function clearStoredSession() {
try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (error) { /* ignore */ }
}

// Groups preserve first-occurrence order of each groupKey - processing
// walks grouped-by-customer (search once, do every lead for that
// customer), while output ordering (see orderedResults) always follows
// original input order regardless of processing order, per instruction.
function buildProcessingGroups(rows) {
const groups = [];
const byKey = new Map();
rows.forEach((row) => {
if (row.status === 'INVALID_INPUT') return;
let group = byKey.get(row.groupKey);
if (!group) {
group = { groupKey: row.groupKey, rows: [], customerMatchMethod: null };
byKey.set(row.groupKey, group);
groups.push(group);
}
group.rows.push(row);
});
return groups;
}

function makeResultBase(row) {
return {
inputIndex: row.inputIndex,
name: row.name, phone: row.phone, email: row.email,
source: row.source, campaign: row.campaign, created: row.created,
customerMatchMethod: null, timelineTimestamp: null, visibleLeadId: null,
modalDate: null, sourceValidation: null, campaignValidation: null,
initialNotes: null, category: null, reason: null, confidence: null,
warnings: [], status: 'PROCESSING', exception: null,
processingTimestamp: null
};
}

function finalizeResult(result, patch) {
return Object.assign({}, result, patch, { processingTimestamp: new Date().toISOString() });
}

function newSession(rawInput) {
const parsed = parseBatchInput(rawInput);
const rows = parsed.rows;
const results = {};
rows.forEach((row) => {
if (row.status === 'INVALID_INPUT') {
results[row.inputIndex] = finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: row.exception });
}
});
const groups = buildProcessingGroups(rows);
return {
rawInput, headerOk: parsed.headerOk, headerError: parsed.error,
rows, groups, groupIndex: 0, rowInGroupIndex: 0,
results, paused: false, cancelled: false,
done: !parsed.headerOk || groups.length === 0
};
}

// Email preferred; phone tried only if there's no email, or as a
// single fallback after email returns zero records - never repeatedly
// alternates. A non-empty result set that fails to resolve to a safe,
// unique customer (CUSTOMER_NOT_LINKED/CUSTOMER_AMBIGUOUS) is terminal
// for that attempt, not a trigger to try the other identifier.
// session is optional (standalone/console use doesn't need it) but
// checked between every awaited sub-step when given, not just once
// per attempt - Cancel/Clear & Stop are cooperative by necessity (none
// of the underlying waits carry an abort signal), so this is what
// keeps that gap to "at most one in-flight wait" rather than
// "possibly this whole customer's remaining rows".
function isCancelled(session) {
return !!(session && session.cancelled);
}

async function searchAndOpenCustomer(group, session) {
const sample = group.rows[0];
const attempts = [];
if (sample.normalizedEmail) attempts.push({ type: 'email', value: sample.email });
if (sample.normalizedPhone) attempts.push({ type: 'phone', value: sample.phone });
if (attempts.length === 0) return { status: 'FAILED', exception: 'NO_SEARCH_IDENTIFIER' };

let lastException = 'NO_SEARCH_IDENTIFIER';
for (const attempt of attempts) {
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
const opened = await openSearchPage();
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (!opened) { lastException = 'SEARCH_TIMEOUT'; continue; }

const typeSelected = await selectSearchType(attempt.type);
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (!typeSelected) { lastException = 'SEARCH_TIMEOUT'; continue; }

const entered = await enterSearchIdentifier(attempt.value);
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (!entered) { lastException = 'SEARCH_TIMEOUT'; continue; }

const count = await submitSearchAndWaitForResults();
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (count === null) { lastException = 'SEARCH_TIMEOUT'; continue; }
if (count === 0) { lastException = 'SEARCH_NO_RESULTS'; continue; }

const rows = readSearchResultRows();
const choice = chooseCustomerResult(rows, sample.name);
if (choice.status !== 'OK') {
return { status: 'FAILED', exception: choice.status };
}

const timelineState = await openCustomerAndWaitForTimeline(choice.result);
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (timelineState.state === 'FAILED') return { status: 'FAILED', exception: 'TIMELINE_TIMEOUT' };
if (timelineState.state === 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS') {
return { status: 'OK', matchMethod: attempt.type, noEligibleEvents: true };
}
return { status: 'OK', matchMethod: attempt.type, noEligibleEvents: false };
}

return { status: 'FAILED', exception: lastException };
}

// Processes exactly one SLA row against the ALREADY-open timeline for
// its customer - opens each exact-minute candidate one at a time,
// closes it whether or not it validates, and only classifies once
// exactly one candidate survives validation.
async function processLeadRow(row, session) {
const result = makeResultBase(row);
const referenceNow = new Date();

const { target, candidates } = findMatchingLeadCandidates(row.created, referenceNow);
if (!target) {
return finalizeResult(result, { status: 'EXCEPTION', exception: 'INVALID_CREATED_DATETIME' });
}

let workingCandidates = candidates;
if (workingCandidates.length === 0) {
for (let attempt = 0; attempt < 5; attempt++) {
if (isCancelled(session)) return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
const scrollResult = await loadOlderTimelineEntries();
if (scrollResult.status === 'TIMELINE_SCROLL_CONTAINER_UNKNOWN') break;
const rescan = findMatchingLeadCandidates(row.created, referenceNow);
if (rescan.candidates.length > 0) { workingCandidates = rescan.candidates; break; }
if (!scrollResult.loadedNewEntries) break;
}
}

if (isCancelled(session)) return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
if (workingCandidates.length === 0) {
// findMatchingLeadCandidates only ever logs a candidate COUNT, never
// why a specific entry didn't match - parseTimelineTimestamp's regex
// is strictly anchored (^...$), so any raw text that doesn't fit
// either confirmed shape exactly (extra whitespace variant, a
// different month abbreviation, anything appended/prepended) silently
// parses to null and the entry is just excluded, with no trace of it
// ever having been seen at all. Logging every loaded entry's raw text
// and parse result here - even though it's visible on the page and
// recorded identically to working leads, per the report that exposed
// this gap - is what actually shows whether the match failed on a
// genuine timestamp mismatch or on a raw-text shape this parser
// doesn't recognize.
console.warn('[KonnectBookingCheck] TARGET_CREATED_DATETIME_NOT_FOUND for row.created=', JSON.stringify(row.created), 'parsed target=', target, '- entries seen:', getLoadedLeadEntries().map((entryRow) => {
const raw = extractTimelineTimestamp(entryRow);
return { raw, parsed: raw ? parseTimelineTimestamp(raw, referenceNow) : null };
}));
return finalizeResult(result, { status: 'EXCEPTION', exception: 'TARGET_CREATED_DATETIME_NOT_FOUND' });
}

// Previously collapsed three genuinely different failures into the
// same generic LEAD_VALIDATION_FAILED - real testing showed this
// masking a case where the modal never actually opened at all (the
// click target was fine, but waitForActiveLeadModal never saw the
// readiness predicate settle), which needs a different fix (a timeout,
// see openLeadModal above) than a real validation contradiction would.
// Tracked per candidate and the most informative one is reported: a
// click/modal failure is more actionable than "validation failed",
// which only makes sense once we know the modal genuinely opened.
// Two rounds of live testing both came back LEAD_VALIDATION_FAILED
// with no further detail, which turned out to be genuinely ambiguous
// to diagnose from that code alone (it could mean the modal opened and
// contradicted, or - as the second round suggested - a stale modal
// being reused without a real click happening at all). Logs the actual
// decision at each step, and - critically - surfaces
// validateLeadCandidate's own detailed reason string (previously
// computed and then discarded, only the generic exception code ever
// reached the output) into this row's warnings, so the real cause is
// visible in the TSV/console instead of needing another round-trip.
const validated = [];
const candidateFailures = [];
const candidateFailureDetails = [];
for (const candidate of workingCandidates) {
if (isCancelled(session)) {
candidateFailures.push('CANCELLED');
break;
}
const clickTarget = findLeadClickTarget(candidate.row);
if (!clickTarget || !clickTarget.isConnected) {
console.warn('[KonnectBookingCheck] click target not found for candidate at', candidate.rawTimestamp);
candidateFailures.push('LEAD_CLICK_TARGET_NOT_FOUND');
continue;
}
console.info('[KonnectBookingCheck] clicking candidate at', candidate.rawTimestamp, 'visibleLeadId=', candidate.leadId);
const modalState = await openLeadModal(candidate.row);
if (isCancelled(session)) {
// The modal may have opened right as Cancel/Clear & Stop was
// pressed - close it before giving up, so it isn't left open and
// unattended once this stops.
if (modalState) await closeLeadModal();
candidateFailures.push('CANCELLED');
break;
}
if (!modalState) {
console.warn('[KonnectBookingCheck] modal did not become ready for candidate at', candidate.rawTimestamp);
candidateFailures.push('LEAD_MODAL_TIMEOUT');
continue;
}
// Empty Date/Source in the extracted fields (seen in real testing)
// could mean either a genuine modal with an unexpected internal
// structure, or - given no modal is visibly appearing on screen at
// all per direct observation - that this matched some other stale or
// hidden element that merely satisfies the readiness selectors
// without being the real, freshly-opened lead modal. Logging the
// actual matched element (not just the fields we tried to pull out of
// it) removes the guesswork either way.
console.info('[KonnectBookingCheck] modal element matched:', modalState.modal.className, '| panel used:', modalState.panel === modalState.modal ? '(fell back to whole modal - no .tab-pane.active found)' : modalState.panel.className, '| visible rect:', JSON.stringify(modalState.modal.getBoundingClientRect()));
console.info('[KonnectBookingCheck] modal panel outerHTML (first 1500 chars):', modalState.panel.outerHTML.slice(0, 1500));
const panelFields = extractLeadPanelFields(modalState.panel);
console.info('[KonnectBookingCheck] modal opened - extracted fields:', JSON.stringify(panelFields));
const validation = validateLeadCandidate(panelFields, row);
if (validation.ok) {
const initialNotes = extractInitialNotes(modalState.panel);
validated.push({ candidate, panelFields, initialNotes, warnings: validation.warnings || [] });
} else {
console.warn('[KonnectBookingCheck] validation rejected candidate:', validation.reason);
candidateFailures.push('LEAD_VALIDATION_FAILED');
candidateFailureDetails.push(`${validation.reason} (modal Date="${panelFields.date || ''}", modal Source="${panelFields.source || ''}", SLA Created="${row.created}", SLA Source="${row.source}")`);
}
await closeLeadModal();
}

if (validated.length === 0) {
const exception = candidateFailures.includes('CANCELLED') ? 'CANCELLED'
: candidateFailures.includes('LEAD_CLICK_TARGET_NOT_FOUND') ? 'LEAD_CLICK_TARGET_NOT_FOUND'
: candidateFailures.includes('LEAD_MODAL_TIMEOUT') ? 'LEAD_MODAL_TIMEOUT'
: 'LEAD_VALIDATION_FAILED';
return finalizeResult(result, { status: 'EXCEPTION', exception, warnings: candidateFailureDetails.length > 0 ? candidateFailureDetails : candidateFailures });
}
if (validated.length > 1) {
return finalizeResult(result, { status: 'EXCEPTION', exception: 'AMBIGUOUS_LEAD' });
}

const { candidate, panelFields, initialNotes, warnings } = validated[0];
const auditPatch = {
timelineTimestamp: candidate.rawTimestamp,
visibleLeadId: candidate.leadId,
modalDate: panelFields.date,
sourceValidation: panelFields.source,
campaignValidation: panelFields.campaign,
warnings: warnings || []
};

if (initialNotes === null) {
return finalizeResult(result, { status: 'EXCEPTION', exception: 'INITIAL_NOTES_FIELD_NOT_FOUND', ...auditPatch });
}
if (initialNotes === '') {
return finalizeResult(result, { status: 'EXCEPTION', exception: 'INITIAL_NOTES_EMPTY', ...auditPatch });
}

const classification = classifyInitialNotes(initialNotes, { campaign: row.campaign, source: row.source });
if (classification.confidence === 'low') {
return finalizeResult(result, { status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', initialNotes, ...auditPatch });
}

return finalizeResult(result, {
status: 'CLASSIFIED',
category: classification.category,
reason: classification.reason,
confidence: classification.confidence,
initialNotes,
...auditPatch
});
}

function advanceToNextGroup(session) {
session.groupIndex++;
session.rowInGroupIndex = 0;
if (session.groupIndex >= session.groups.length) session.done = true;
}

// Advances exactly one input row (per instruction: "Process next must
// process exactly one row") - opening/searching for a new customer
// when needed counts as part of reaching that one row, not a separate
// step of its own.
async function stepOnce(session, uiHandle) {
if (session.done || session.cancelled) return false;
if (session.groupIndex >= session.groups.length) { session.done = true; return false; }

const group = session.groups[session.groupIndex];

if (session.rowInGroupIndex === 0) {
uiHandle.setState(`Searching for ${group.rows[0].name}...`, group.rows[0].name, null);
const openResult = await searchAndOpenCustomer(group, session);
if (openResult.status !== 'OK') {
group.rows.forEach((row) => {
session.results[row.inputIndex] = finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: openResult.exception });
});
advanceToNextGroup(session);
saveSession(session);
return true;
}
if (openResult.noEligibleEvents) {
group.rows.forEach((row) => {
session.results[row.inputIndex] = finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: 'NO_ELIGIBLE_LEAD_EVENTS' });
});
advanceToNextGroup(session);
saveSession(session);
return true;
}
group.customerMatchMethod = openResult.matchMethod;
}

const row = group.rows[session.rowInGroupIndex];
uiHandle.setState(`Reading lead at ${row.created}...`, group.rows[0].name, row.created);
const result = await processLeadRow(row, session);
result.customerMatchMethod = group.customerMatchMethod;
session.results[row.inputIndex] = result;

session.rowInGroupIndex++;
if (session.rowInGroupIndex >= group.rows.length) advanceToNextGroup(session);
saveSession(session);
return true;
}

let isRunning = false;

async function runLoop(session, uiHandle) {
if (isRunning) return;
isRunning = true;
session.cancelled = false;
try {
while (!session.done && !session.cancelled) {
if (session.paused) { await sleep(200); continue; }
// Same "(N left)" countdown SLA-Extract.js's own overlay shows during
// batch ingestion (setBadgeProgress there) - showPageFlashOverlay just
// updates the existing overlay's text when already showing, so this
// is cheap to call every iteration.
const remaining = session.rows.length - Object.keys(session.results).length;
showPageFlashOverlay(`Checking leads… (${remaining} left)`);
const advanced = await stepOnce(session, uiHandle);
uiHandle.render();
if (!advanced) break;
}
} finally {
isRunning = false;
hidePageFlashOverlay();
uiHandle.setState(session.cancelled ? 'Cancelled' : (session.done ? 'Done' : 'Paused'));
}
}

function orderedResults(session) {
return session.rows.map((row) => session.results[row.inputIndex]).filter(Boolean);
}

// Lower = more valuable/urgent. Per instruction, the real axis isn't
// "how good is this booking" but "can this be actioned via a voicemail
// alone, or does it require actually reaching the customer live" -
// every voicemail-actionable category (any real date signal) ranks
// above every requires-pickup category. Within "requires pickup", a
// lead with expressed visit/test-drive intent is more likely to
// convert than one that was merely answered with no real signal, so
// WARM ENQUIRY ranks above plain NON-BOOKING rather than
// beside it.
function bookingPriorityRank(result) {
if (!result || result.status !== 'CLASSIFIED') return 7;
if (result.category === 'CONFIRMED DATE & TIME') return 1;
if (result.category === 'DATE ONLY') {
const { comments } = parseInitialNotesFields(result.initialNotes);
return containsAny(comments.toLowerCase(), TIME_PREFERENCE_WORDS) ? 2 : 3;
}
if (result.category === 'WARM ENQUIRY') return 4;
if (result.category === 'NON-BOOKING') {
// A genuine "potentially interested in..." answer, though not visit
// intent, is still more contactable than a blank/generic one - ranks
// above plain NON-BOOKING without becoming its own category.
const { comments } = parseInitialNotesFields(result.initialNotes);
return containsAny(comments.toLowerCase(), POTENTIAL_INTEREST_PHRASES) ? 5 : 6;
}
return 7;
}

function buildDefaultCopyText(session) {
const header = ['Name', 'Phone', 'Email', 'Booking classification'].join('\t');
const lines = orderedResults(session).map((r) => [r.name, r.phone, r.email, r.category || r.exception || 'PENDING'].join('\t'));
return [header, ...lines].join('\n');
}

// Feeds the reverse handoff into SLA-Extract.js: for large batches,
// classification runs there instead (right next to the assign-
// criteria/tier features), using its own ported copy of this same
// classifier - this just hands back the raw fields, no classification
// columns, matching exactly the column shape SLA-Extract.js's
// "Classify Booking Check results" panel expects to parse.
function buildRawNotesTsvForExtract(session) {
const header = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes'];
const lines = orderedResults(session).map((r) => [
r.name, r.phone, r.email, r.source, r.campaign, r.created,
(r.initialNotes || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | ')
].join('\t'));
return [header.join('\t'), ...lines].join('\n');
}

window.KonnectBookingCheck.buildProcessingGroups = buildProcessingGroups;
window.KonnectBookingCheck.newSession = newSession;
window.KonnectBookingCheck.stepOnce = stepOnce;
window.KonnectBookingCheck.runLoop = runLoop;
window.KonnectBookingCheck.orderedResults = orderedResults;
window.KonnectBookingCheck.buildDefaultCopyText = buildDefaultCopyText;
window.KonnectBookingCheck.bookingPriorityRank = bookingPriorityRank;
window.KonnectBookingCheck.buildRawNotesTsvForExtract = buildRawNotesTsvForExtract;

(function orchestrationSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const batch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Alice\t\talice@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
'Alice Again\t\talice@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 19:05',
'Bob\t07000000000\t\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 20:05'
].join('\n');
const parsed = parseBatchInput(batch);
const groups = buildProcessingGroups(parsed.rows);
check('groups by normalized email/phone', groups.map((g) => g.rows.length), [2, 1]);
check('same customer keeps a separate result per row', groups[0].rows.map((r) => r.created), ['Sat, 26 Sep 2026 18:05', 'Sat, 26 Sep 2026 19:05']);

const fakeSession = {
rows: parsed.rows,
results: {
0: { name: 'Alice', phone: '', email: 'alice@example.com', category: 'DATE ONLY', status: 'CLASSIFIED' },
1: { name: 'Alice Again', phone: '', email: 'alice@example.com', category: 'CONFIRMED DATE & TIME', status: 'CLASSIFIED' },
2: { name: 'Bob', phone: '07000000000', email: '', category: 'NON-BOOKING', status: 'CLASSIFIED' }
}
};

// Full 5-tier rank per instruction: voicemail-actionable (confirmed >
// date+time-preference > plain date-only) always outranks
// requires-pickup (test-drive intent > plain non-booking).
check('rank: CONFIRMED DATE & TIME', bookingPriorityRank({ status: 'CLASSIFIED', category: 'CONFIRMED DATE & TIME' }), 1);
check('rank: DATE ONLY + time preference beats plain DATE ONLY',
bookingPriorityRank({ status: 'CLASSIFIED', category: 'DATE ONLY', initialNotes: 'Customer Comments: Sunday morning please' })
< bookingPriorityRank({ status: 'CLASSIFIED', category: 'DATE ONLY', initialNotes: 'Customer Comments: -' }),
true);
check('rank: DATE ONLY beats WARM ENQUIRY',
bookingPriorityRank({ status: 'CLASSIFIED', category: 'DATE ONLY', initialNotes: '' }) < bookingPriorityRank({ status: 'CLASSIFIED', category: 'WARM ENQUIRY' }),
true);
check('rank: WARM ENQUIRY beats NON-BOOKING',
bookingPriorityRank({ status: 'CLASSIFIED', category: 'WARM ENQUIRY' }) < bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING' }),
true);
check('rank: unclassified/exception rows sink to the bottom',
bookingPriorityRank({ status: 'EXCEPTION', category: null }) > bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING', initialNotes: 'Customer Comments: -' }),
true);
check('rank: "potentially be interested in" NON-BOOKING beats plain NON-BOOKING, but still loses to WARM ENQUIRY',
bookingPriorityRank({ status: 'CLASSIFIED', category: 'WARM ENQUIRY' })
< bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING', initialNotes: 'Customer Comments: Hi I would potentially be interested in this vehicle' })
&& bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING', initialNotes: 'Customer Comments: Hi I would potentially be interested in this vehicle' })
< bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING', initialNotes: 'Customer Comments: -' }),
true);
check('rank: PX Valuation generic page-link-only NON-BOOKING is bottom tier (same as blank), not the "potentially interested" sub-rank',
bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING', initialNotes: 'Customer Comments: The customer was on the following website page, before completing the valuation: https://example.com/citroen-c5-aircross-pch' }),
bookingPriorityRank({ status: 'CLASSIFIED', category: 'NON-BOOKING', initialNotes: 'Customer Comments: -' }));

// The exact contract SLA-Extract.js's "Classify Booking Check
// results" panel parses (BOOKING_CHECK_IMPORT_HEADER there) - pinned
// down explicitly since the two files can't share a module and would
// otherwise only find out they'd drifted apart by failing silently on
// a real paste.
const rawExtractTsv = buildRawNotesTsvForExtract(fakeSession);
check('raw Extract export header shape', rawExtractTsv.split('\n')[0], 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\tInitialNotes');

if (failures.length > 0) {
console.error('KonnectBookingCheck orchestration self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck orchestration self-test passed (10/10)');
}
})();

// ===================================================================
// PAGE FLASH OVERLAY - same pattern as SLA-Extract.js's own
// showPageFlashOverlay/hidePageFlashOverlay (Refreshing leads/Clearing
// the queue/Morning Checks there). Konnect Live's own pages re-
// rendering mid-navigation while searching/opening a customer/opening
// a lead modal looks exactly like the same "glitching" that overlay
// was built to hide, just on a different site. Lower z-index than the
// panel host (2147483000) so the floating panel itself - and its own
// live progress state - stays visible on top of the dimmed page.
// ===================================================================

const KBC_PAGE_FLASH_OVERLAY_ID = '_kbcPageFlashOverlay';
let kbcPageFlashOverlayPrevOverflow = null;

function showPageFlashOverlay(message) {
const existing = document.getElementById(KBC_PAGE_FLASH_OVERLAY_ID);
if (existing) {
const label = existing.querySelector('[data-overlay-label]');
if (label) label.textContent = message;
return;
}
if (!document.getElementById('_kbcSpinKeyframes')) {
const style = document.createElement('style');
style.id = '_kbcSpinKeyframes';
style.textContent = '@keyframes _kbcSpin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);
}
const overlay = document.createElement('div');
overlay.id = KBC_PAGE_FLASH_OVERLAY_ID;
overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(15,23,42,0.94); z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: white; font-size: 14px; font-weight: 600;';
overlay.innerHTML = `
<div style="width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.25); border-top-color: white; border-radius: 50%; animation: _kbcSpin 0.8s linear infinite;"></div>
<div data-overlay-label>${message}</div>
`;
kbcPageFlashOverlayPrevOverflow = document.documentElement.style.overflow;
document.documentElement.style.overflow = 'hidden';
document.documentElement.appendChild(overlay);
}

function hidePageFlashOverlay() {
document.getElementById(KBC_PAGE_FLASH_OVERLAY_ID)?.remove();
document.documentElement.style.overflow = kbcPageFlashOverlayPrevOverflow || '';
kbcPageFlashOverlayPrevOverflow = null;
}

// ===================================================================
// UI PANEL - Shadow DOM, draggable, per the spec's interface list.
// Only initializes in a real browser (guarded below) so the self-tests
// above still run cleanly under a plain Node harness.
// ===================================================================

// Same Tier 1-4 categorization SLA-Extract.js already uses for its own
// panel (categorizeTier there) - ported verbatim rather than inventing
// a separate grouping, per instruction that this panel should group
// leads "into the same tiers as the extract ui".
function categorizeTier(campaign, source) {
const camp = String(campaign || '').toLowerCase();
const src = String(source || '').toLowerCase();

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

function buildPanelMarkup() {
const host = document.createElement('div');
host.id = '_kbcPanelHost';
Object.assign(host.style, { all: 'initial', position: 'fixed', top: '16px', right: '16px', zIndex: 2147483000 });
document.documentElement.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
<style>
.panel { width: 440px; max-height: 90vh; display: flex; flex-direction: column; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 20px 40px -12px rgba(15,23,42,0.35); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #1e293b; overflow: hidden; }
.header { flex-shrink: 0; background: #1e293b; color: white; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-radius: 10px 10px 0 0; cursor: move; user-select: none; }
.header button { background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
.bodyEl { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 12px; }
textarea { width: 100%; height: 70px; box-sizing: border-box; font-family: monospace; font-size: 11px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; }
.row-count { color: #64748b; margin: 4px 0 8px; }
.section-label { color: #94a3b8; text-transform: uppercase; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; margin: 10px 0 4px; }
.section-label:first-child { margin-top: 0; }
.buttons { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
button.action { padding: 5px 8px; border: 1px solid #cbd5e1; background: white; border-radius: 6px; cursor: pointer; font-size: 11px; }
button.action:hover { background: #eef2ff; }
button.primary { background: #1e293b; color: white; border-color: #1e293b; }
.status { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; }
.status div { margin-bottom: 2px; }
.exception { color: #dc2626; }
.confirmed { color: #059669; font-weight: 600; }
.dateonly { color: #d97706; }
.warm { color: #2563eb; }
.nonbooking { color: #64748b; }
.hidden { display: none; }
.footer { flex-shrink: 0; border-top: 1px solid #cbd5e1; padding: 8px 12px; background: white; display: flex; justify-content: flex-end; border-radius: 0 0 10px 10px; }
.footer button { padding: 6px 12px; background: transparent; color: #dc2626; border: 1px solid #dc2626; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; }
.topSection { flex-shrink: 0; border: 1px solid #e2e8f0; border-radius: 6px; background: white; margin-bottom: 8px; }
.topSection > summary { padding: 6px 8px; cursor: pointer; font-weight: 600; color: #475569; list-style: none; }
.topSection > summary::-webkit-details-marker { display: none; }
.topSection > summary::before { content: '\\25B8'; margin-right: 6px; color: #94a3b8; }
.topSection[open] > summary::before { content: '\\25BE'; }
.topSection-content { padding: 0 8px 8px; }
.exportBar { flex-shrink: 0; }
.tier { border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 6px; background: white; }
.tier > summary { padding: 5px 8px; cursor: pointer; font-weight: 600; list-style: none; display: flex; justify-content: space-between; }
.tier > summary::-webkit-details-marker { display: none; }
.tier > summary::before { content: '\\25B8'; margin-right: 6px; color: #94a3b8; }
.tier[open] > summary::before { content: '\\25BE'; }
.tier-count { color: #94a3b8; font-weight: 400; }
.customer { border-top: 1px solid #f1f5f9; }
.customer > summary { padding: 5px 8px 5px 20px; cursor: pointer; list-style: none; display: flex; justify-content: space-between; gap: 6px; }
.customer > summary::-webkit-details-marker { display: none; }
.customer > summary::before { content: '\\25B8'; margin-right: 6px; color: #cbd5e1; }
.customer[open] > summary::before { content: '\\25BE'; }
.customer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.customer-body { padding: 4px 8px 8px 28px; background: #f8fafc; }
.customer-body .field { margin-bottom: 3px; }
.customer-body .field b { color: #475569; }
.notes-block { white-space: pre-wrap; background: white; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; margin-top: 4px; font-family: monospace; font-size: 10.5px; }
.reason { color: #64748b; font-style: italic; margin-top: 3px; }
.empty-state { color: #94a3b8; padding: 8px 4px; }
#resultsBody { flex: 1; min-height: 40px; overflow-y: auto; }
</style>
<div class="panel">
<div class="header" id="headerEl">
<span>Konnect Booking Check</span>
<button id="minBtn" title="Minimize">_</button>
</div>
<div class="bodyEl" id="bodyEl">
<details class="topSection" id="topSection" open>
<summary>Batch input</summary>
<div class="topSection-content">
<textarea id="pasteBox" placeholder="Paste TSV: Name  Phone  Email  Source  Campaign  Created"></textarea>
<div class="row-count" id="rowCount">0 rows parsed</div>
<div class="buttons">
<button class="action primary" id="btnStart">Start</button>
<button class="action primary" id="btnPauseResume">Pause</button>
<button class="action" id="btnProcessNext">Process next</button>
<button class="action" id="btnCancel">Cancel</button>
</div>
<div class="status">
<div>Customer: <span id="curCustomer">-</span></div>
<div>Target Created: <span id="curTarget">-</span></div>
<div>State: <span id="curState">Idle</span></div>
<div>Completed: <span id="completedCount">0</span> &middot; Exceptions: <span id="exceptionCount">0</span> &middot; Total: <span id="totalCount">0</span></div>
</div>
</div>
</details>
<div id="resultsBody"></div>
<div class="exportBar">
<div class="section-label">Export</div>
<div class="buttons">
<button class="action" id="btnCopy">Copy results</button>
<button class="action" id="btnCopyRawForExtract">Copy raw for Extract</button>
<button class="action" id="btnClear">Clear session</button>
</div>
</div>
</div>
<div class="footer">
<button id="btnClearStop">Clear & Stop</button>
</div>
</div>
`;
return { host, root };
}

function escapeHtmlForUi(value) {
return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// execCommand first, synchronously, NOT inside a Promise chain - both
// execCommand('copy') and (in stricter embedded contexts) even the
// modern Clipboard API only work reliably within the click handler's
// original synchronous "user activation" window. The previous version
// tried the async Clipboard API first and only fell back to
// execCommand inside its .catch() - by the time that ran, execution
// was several microtask ticks removed from the actual click, which
// silently loses that user-activation association in exactly the kind
// of restricted, third-party-injected-iframe context a bookmarklet
// runs in (confirmed live: buttons showed no error, but nothing ever
// reached the clipboard). Trying the synchronous path first fixes it.
function copyTextToClipboard(text) {
try {
const textarea = document.createElement('textarea');
textarea.value = text;
textarea.style.position = 'fixed';
textarea.style.opacity = '0';
document.body.appendChild(textarea);
textarea.focus();
textarea.select();
const ok = document.execCommand('copy');
textarea.remove();
if (ok) return Promise.resolve();
} catch (error) {
// fall through to the async API below
}
return navigator.clipboard && navigator.clipboard.writeText
? navigator.clipboard.writeText(text)
: Promise.reject(new Error('Clipboard copy failed'));
}

function showButtonFeedback(button, text, isError) {
if (!button) return;
const original = button.textContent;
const originalColor = button.style.color;
button.textContent = text;
button.style.color = isError ? '#dc2626' : '#059669';
setTimeout(() => {
button.textContent = original;
button.style.color = originalColor;
}, 1500);
}

function initKonnectBookingCheckUI() {
const { host, root } = buildPanelMarkup();

const pasteBox = root.getElementById('pasteBox');
const rowCountEl = root.getElementById('rowCount');
const curCustomerEl = root.getElementById('curCustomer');
const curTargetEl = root.getElementById('curTarget');
const curStateEl = root.getElementById('curState');
const completedCountEl = root.getElementById('completedCount');
const exceptionCountEl = root.getElementById('exceptionCount');
const totalCountEl = root.getElementById('totalCount');
const resultsBody = root.getElementById('resultsBody');
const bodyEl = root.getElementById('bodyEl');
const minBtn = root.getElementById('minBtn');
const headerEl = root.getElementById('headerEl');

let session = loadStoredSession();
if (session) pasteBox.value = session.rawInput || '';

// <details> open/closed state doesn't survive an innerHTML rebuild, and
// render() is called after every processed row - without tracking this
// separately, expanding a customer's notes to read them would just get
// collapsed again the moment the next row finishes. Tiers default open
// (few of them, useful to see counts at a glance); customers default
// closed, per instruction ("collapsed under the customer's name x
// contact details").
const detailsState = { tiers: new Set([1, 2, 3, 4]), customers: new Set() };

function categoryClass(r) {
if (!r) return '';
if (r.exception) return 'exception';
// WARM ENQUIRY is NOT the same tier of value as an actual
// confirmed date/time - it requires reaching the customer live, no
// voicemail can act on it alone - so it gets its own distinct color
// rather than sharing "confirmed"'s green/bold styling.
if (r.category === 'CONFIRMED DATE & TIME') return 'confirmed';
if (r.category === 'DATE ONLY') return 'dateonly';
if (r.category === 'WARM ENQUIRY') return 'warm';
if (r.category === 'NON-BOOKING') return 'nonbooking';
return '';
}

// Same click-to-copy visual pattern as SLA-Extract.js's .sla-copyable
// fields (cursor pointer, light indigo background) - per instruction,
// customer number/name/email in this dropdown should work the same
// way. data-value carries the unescaped-for-copy text; the click
// handler (wired in render(), since this HTML is rebuilt from scratch
// every render) reads it back out via .dataset.value, which the
// browser un-escapes automatically from the HTML attribute.
function copyableField(value) {
if (!value) return '';
const display = escapeHtmlForUi(value);
return `<span class="kbc-copyable" data-value="${display}" style="cursor: pointer; padding: 1px 5px; border-radius: 4px; background: #eef2ff; color: #1e293b; display: inline-block;">${display}</span>`;
}

function customerBodyHtml(r) {
const parts = [];
parts.push(`<div class="field"><b>Name:</b> ${copyableField(r.name)}</div>`);
if (r.phone) parts.push(`<div class="field"><b>Phone:</b> ${copyableField(r.phone)}</div>`);
if (r.email) parts.push(`<div class="field"><b>Email:</b> ${copyableField(r.email)}</div>`);
parts.push(`<div class="field"><b>Campaign:</b> ${escapeHtmlForUi(r.campaign || '-')} &middot; <b>Source:</b> ${escapeHtmlForUi(r.source || '-')}</div>`);
parts.push(`<div class="field"><b>Created:</b> ${escapeHtmlForUi(r.created || '-')}</div>`);
if (r.reason) parts.push(`<div class="reason">${escapeHtmlForUi(r.reason)}</div>`);
if (r.initialNotes) parts.push(`<div class="notes-block">${escapeHtmlForUi(r.initialNotes)}</div>`);
else if (r.status === 'EXCEPTION') parts.push(`<div class="reason">No Initial Notes read - ${escapeHtmlForUi(r.exception || '')}</div>`);
return parts.join('');
}

function render() {
if (!session) {
rowCountEl.textContent = '0 rows parsed';
resultsBody.innerHTML = '<div class="empty-state">Paste a batch above to begin.</div>';
completedCountEl.textContent = '0';
exceptionCountEl.textContent = '0';
totalCountEl.textContent = '0';
return;
}
rowCountEl.textContent = `${session.rows.length} rows parsed` + (session.headerOk ? '' : ` - ${session.headerError}`);
const ordered = orderedResults(session);

if (ordered.length === 0) {
resultsBody.innerHTML = '<div class="empty-state">No results yet - press Start or Process next.</div>';
} else {
const byTier = new Map();
ordered.forEach((r) => {
const tier = categorizeTier(r.campaign, r.source).tier;
if (!byTier.has(tier)) byTier.set(tier, []);
byTier.get(tier).push(r);
});
resultsBody.innerHTML = Array.from(byTier.keys()).sort((a, b) => a - b).map((tier) => {
// Sorted by bookingPriorityRank (voicemail-actionable first, then
// requires-pickup ranked by likelihood) so the most actionable leads
// in each tier surface at the top rather than input order.
const rows = [...byTier.get(tier)].sort((a, b) => bookingPriorityRank(a) - bookingPriorityRank(b));
const customersHtml = rows.map((r) => `
<details class="customer" data-key="${r.inputIndex}" ${detailsState.customers.has(r.inputIndex) ? 'open' : ''}>
<summary><span class="customer-name" title="${escapeHtmlForUi(r.initialNotes || 'No Initial Notes read yet.')}">${escapeHtmlForUi(r.name)}</span><span class="${categoryClass(r)}">${escapeHtmlForUi(r.category || r.exception || 'Pending')}</span></summary>
<div class="customer-body">${customerBodyHtml(r)}</div>
</details>
`).join('');
return `
<details class="tier" data-key="${tier}" ${detailsState.tiers.has(tier) ? 'open' : ''}>
<summary><span>Tier ${tier}</span><span class="tier-count">${rows.length}</span></summary>
${customersHtml}
</details>
`;
}).join('');
}

resultsBody.querySelectorAll('details.tier').forEach((el) => {
const key = Number(el.dataset.key);
el.addEventListener('toggle', () => { if (el.open) detailsState.tiers.add(key); else detailsState.tiers.delete(key); });
});
resultsBody.querySelectorAll('details.customer').forEach((el) => {
const key = Number(el.dataset.key);
el.addEventListener('toggle', () => { if (el.open) detailsState.customers.add(key); else detailsState.customers.delete(key); });
});
resultsBody.querySelectorAll('.kbc-copyable').forEach((el) => {
el.addEventListener('click', () => {
const original = el.textContent;
copyTextToClipboard(el.dataset.value)
.then(() => {
el.textContent = '✓ Copied!';
el.style.background = '#059669';
el.style.color = 'white';
setTimeout(() => { el.textContent = original; el.style.background = ''; el.style.color = ''; }, 1200);
})
.catch(() => {
el.textContent = '✗ Failed';
el.style.background = '#dc2626';
el.style.color = 'white';
setTimeout(() => { el.textContent = original; el.style.background = ''; el.style.color = ''; }, 1200);
});
});
});

completedCountEl.textContent = String(ordered.filter((r) => r.status === 'CLASSIFIED').length);
exceptionCountEl.textContent = String(ordered.filter((r) => r.status === 'EXCEPTION').length);
totalCountEl.textContent = String(session.rows.length);
}

const uiHandle = {
setState(state, customer, target) {
curStateEl.textContent = state;
if (customer !== undefined) curCustomerEl.textContent = customer || '-';
if (target !== undefined) curTargetEl.textContent = target || '-';
render();
},
render
};

function ensureSessionFromPasteBox() {
if (session && session.rawInput === pasteBox.value) return session;
session = newSession(pasteBox.value);
saveSession(session);
return session;
}

root.getElementById('btnProcessNext').addEventListener('click', async () => {
const s = ensureSessionFromPasteBox();
if (!s.headerOk) { uiHandle.setState(`Header error: ${s.headerError}`); return; }
s.cancelled = false;
showPageFlashOverlay('Checking lead…');
try {
await stepOnce(s, uiHandle);
} finally {
hidePageFlashOverlay();
}
uiHandle.setState(s.done ? 'Done' : 'Paused after one row');
});

root.getElementById('btnStart').addEventListener('click', () => {
const s = ensureSessionFromPasteBox();
if (!s.headerOk) { uiHandle.setState(`Header error: ${s.headerError}`); return; }
s.paused = false;
s.cancelled = false;
pauseResumeBtn.textContent = 'Pause';
showPageFlashOverlay('Checking leads…');
runLoop(s, uiHandle);
});

// Pausing doesn't actually exit runLoop's while-loop (it just idles on
// a 200ms poll internally, waiting for session.paused to clear) - the
// overlay is shown/hidden here, at the actual user action, rather than
// inside runLoop's own try/finally, since that only fires once the
// loop truly ends (done/cancelled), not on every pause. Without this,
// pausing would leave the real page dimmed for as long as it stayed
// paused.
const pauseResumeBtn = root.getElementById('btnPauseResume');
pauseResumeBtn.addEventListener('click', () => {
if (!session) return;
if (session.paused) {
session.paused = false;
pauseResumeBtn.textContent = 'Pause';
uiHandle.setState('Resuming...');
showPageFlashOverlay('Checking leads…');
runLoop(session, uiHandle);
} else {
session.paused = true;
pauseResumeBtn.textContent = 'Resume';
uiHandle.setState('Paused');
hidePageFlashOverlay();
}
});

root.getElementById('btnCancel').addEventListener('click', () => {
if (session) { session.cancelled = true; uiHandle.setState('Cancelling...'); }
});

root.getElementById('btnClear').addEventListener('click', () => {
// Rebinding the module-level `session` variable alone doesn't stop a
// runLoop/stepOnce already in flight - it holds its own closure over
// the previous session object, so without cancelling that object too,
// a stuck/slow row would finish, re-save itself via saveSession(), and
// (if running via Start) the loop would keep auto-advancing through
// the rest of the batch - confirmed live: clearing mid-freeze let
// processing "carry on going" instead of stopping.
if (session) session.cancelled = true;
clearStoredSession();
session = null;
pasteBox.value = '';
pauseResumeBtn.textContent = 'Pause';
hidePageFlashOverlay();
uiHandle.setState('Idle', '-', '-');
});

// Originally left the persisted session alone, matching SLA-Extract.js's
// own Clear & Stop exactly (per instruction at the time) - but real use
// showed that reading as "not actually clearing it" here: reopening the
// bookmarklet afterward still showed the old batch/results, which reads
// as broken for a tool built around rapid iterate-and-retest cycles,
// even though it was working as originally specified. Now a genuine
// full reset - stops whatever's running, wipes the stored session, and
// tears down the panel - so reopening always starts from a clean slate.
root.getElementById('btnClearStop').addEventListener('click', () => {
const ok = window.confirm('Clear all data and stop?');
if (!ok) return;
if (session) session.cancelled = true;
isRunning = false;
hidePageFlashOverlay();
clearStoredSession();
session = null;
host.remove();
window.__konnectBookingCheck = null;
console.info('Konnect Booking Check stopped and cleared - click the bookmarklet again to start fresh');
});

root.getElementById('btnCopy').addEventListener('click', (event) => {
const s = ensureSessionFromPasteBox();
const count = orderedResults(s).length;
copyTextToClipboard(buildDefaultCopyText(s))
.then(() => showButtonFeedback(event.currentTarget, `✓ Copied ${count}`, false))
.catch(() => showButtonFeedback(event.currentTarget, '✗ Copy failed', true));
});

root.getElementById('btnCopyRawForExtract').addEventListener('click', (event) => {
const s = ensureSessionFromPasteBox();
const count = orderedResults(s).length;
copyTextToClipboard(buildRawNotesTsvForExtract(s))
.then(() => showButtonFeedback(event.currentTarget, `✓ Copied ${count}`, false))
.catch(() => showButtonFeedback(event.currentTarget, '✗ Copy failed', true));
});

minBtn.addEventListener('click', () => { bodyEl.classList.toggle('hidden'); });

let dragState = null;
headerEl.addEventListener('mousedown', (event) => {
const rect = host.getBoundingClientRect();
dragState = { startX: event.clientX, startY: event.clientY, startTop: rect.top, startRight: window.innerWidth - rect.right };
event.preventDefault();
});
window.addEventListener('mousemove', (event) => {
if (!dragState) return;
const dx = event.clientX - dragState.startX;
const dy = event.clientY - dragState.startY;
host.style.top = `${Math.max(0, dragState.startTop + dy)}px`;
host.style.right = `${Math.max(0, dragState.startRight - dx)}px`;
});
window.addEventListener('mouseup', () => { dragState = null; });

render();

window.__konnectBookingCheck = {
focus() {
host.style.display = 'block';
bodyEl.classList.remove('hidden');
},
getSession: () => session
};
}

try {
initKonnectBookingCheckUI();
} catch (error) {
console.warn('KonnectBookingCheck UI did not initialize (expected outside a real browser):', error && error.message);
}

})();
