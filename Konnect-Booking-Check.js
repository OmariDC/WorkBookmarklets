// ===================================================================
// KONNECT BOOKING CHECK
//
// Separate tool, separate site - runs on Konnect Live, not the Konnect
// Manager app SLA-Extract.js/SLA-Manager.js live in. Takes a batch of
// SLA leads pasted from SLA-Extract.js's "Copy for Booking Check"
// export (Name/Phone/Email/Source/Campaign/Created, tab-separated),
// finds each customer, locates the exact lead, and classifies its
// Initial Notes as a booking or not.
//
// CLASSIFIER: implements lead-classification-spec.md v1.10 in full -
// built from ~6,000 reviewed real leads, not the earlier ad-hoc 4-
// category scheme this replaced. 6 priority tiers (CONFIRMED DATE &
// TIME / DATE ONLY / LIKELY BOOKING / WARM ENQUIRY / NURTURE /
// REDIRECT-NO CALL), each with its own sub-categories and sort ranks,
// 20+ independent flags, a 13-step ordered pipeline (Section 3 of the
// spec - order matters: agent-note detection and customer redirect/
// reschedule checks both run before any system-template or campaign-
// based classification, so a booking/cancellation/complaint/fleet
// lead is never miscategorised as a fresh enquiry just because its
// notes also happen to mention a car). Every rule traces back to a
// numbered spec section, cited in that result's own `reason` text.
// All 119 of the spec's own worked test cases (Section 12) are ported
// below as this file's self-test suite.
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

// ===================================================================
// CLASSIFIER ENGINE - lead-classification-spec.md v1.10
// ===================================================================

function low(s) { return String(s || '').toLowerCase(); }

// Section 3.1: normalise - strip system suffixes before any keyword
// scan (Cargurus IMV/deal-rating block, collection-point line, the
// "URL of vehicle of interest:" label, the Vehicle notes price line,
// the generic "Requests: General enquiry." line).
function stripSystemSuffixes(text) {
let t = String(text || '');
t = t.replace(/\(CarGurus (IMV|deal rating)[^)]*\)\.?/gi, '');
t = t.replace(/The closest collection point to the consumer is[^.|]*\.?/gi, '');
t = t.replace(/URL of vehicle of interest:\s*\S*/gi, '');
t = t.replace(/Vehicle notes:\s*\*£[\d,]+\*\s*/gi, '');
t = t.replace(/Requests: General enquiry\./gi, '');
return t.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*/g, ' | ').trim();
}

function segs(text) {
return String(text || '').split('|').map((s) => s.trim()).filter(Boolean);
}

// Customer First/website fields use "Name: value"; MB Mail/Autofunnel
// fields use "Name = value" - both accepted.
function field(text, name) {
const re = new RegExp(name + '\\s*[:=]\\s*([^|]*)', 'i');
const m = String(text || '').match(re);
return m ? m[1].trim() : null;
}

// Real terms fields (Deposit, Term, Monthly Budget) sometimes appear
// as "Deposit £5,000" with no colon, not just "Deposit: £5,000" -
// this checks presence of the field with either shape.
function hasAmountField(text, name) {
return new RegExp(name + '\\s*:?\\s*£?[\\d,]+', 'i').test(String(text || ''));
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WRITTEN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const WRITTEN_KEYS = Object.keys(WRITTEN).join('|');

// Section 10: date/time parsing.

// Placeholder 00:00 must never count as a real clock time (Fiat/Abarth
// First Desired Schedule, template placeholders) - stripped before
// scanning for a genuine time elsewhere in the same text.
function stripPlaceholderTime(lowerText) {
return lowerText.replace(/\b00:00\b/g, ' ');
}

const CLOCK_RE = new RegExp(
'\\b([01]?\\d|2[0-3])[:.][0-5]\\d(\\s*hrs)?\\b' +
'|\\b\\d{1,2}\\s*[-\u2013]\\s*\\d{1,2}\\s*(am|pm)\\b' +
'|\\b\\d{1,2}[:.]\\d{2}\\s*/\\s*\\d{1,2}\\s*(am|pm)\\b' +
'|\\b\\d{4}\\s*-\\s*\\d{4}\\b' +
'|\\bafter\\s+\\d{3,4}\\b' +
'|\\b\\d{1,2}\\s*o\'?clock\\b' +
'|\\b\\d{1,2}(:\\d{2})?\\s*(am|pm)\\b',
'i'
);

const WRITTEN_TIME_RE = new RegExp(
'\\bhalf\\s+(' + WRITTEN_KEYS + ')\\b' +
'|\\bquarter\\s+(past|to)\\s+(' + WRITTEN_KEYS + ')\\b' +
'|\\b(' + WRITTEN_KEYS + ')\\s*(thirty|fifteen|forty[- ]?five|o\'?clock)\\b',
'i'
);

function hasClockTime(text) {
const lowered = stripPlaceholderTime(low(text));
if (/\bslot\s*\d/i.test(lowered)) return false; // "Slot 1" is not a time
if (/\d+\s*hour test drive/i.test(lowered)) return false; // duration, not a time
if (CLOCK_RE.test(lowered)) return true;
// Written-out times only count near day/visit wording (Section 10).
if (WRITTEN_TIME_RE.test(lowered) && /\b(morning|afternoon|evening|am|pm|visit|view|test drive|come|see|come in|drop|around|at)\b/i.test(lowered)) return true;
return false;
}

function hasDayMention(text) {
const lowered = low(text);
if (WEEKDAYS.some((d) => lowered.includes(d))) return true;
if (/\btoday\b|\btonight\b|\btomorrow\b|\bthis morning\b|\bthis afternoon\b|\bthis weekend\b|\bnext week\b/i.test(lowered)) return true;
if (new RegExp('\\b\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(' + MONTHS.join('|') + ')\\b', 'i').test(lowered)) return true;
if (/\b\d{1,2}\/\d{1,2}\b/.test(lowered)) return true;
return false;
}

// Section 6: flags. Attached to every result regardless of which
// pipeline step matched, over the same normalised text - ctx carries
// signals the matching step already worked out (e.g. whether "Finance"
// wording was genuinely a customer request vs a system field name)
// that a flat text regex alone can't always tell apart.
function computeFlags(text, campaign, source, ctx) {
ctx = ctx || {};
const lowered = low(text);
const src = low(source);
const flags = [];

if (/\bpx\b|part\s*exchange|partex\s*=\s*yes|partex\s*=\s*possibly|enhancedpartexchangeoffer|partexreg|\(i have a part exchange\)|px derivative|desc1/i.test(lowered) && !ctx.noPx) flags.push('PX');
if (/negative equity|\bneg eq\b|\bnegs\b|equity:\s*£?-\s*\d/i.test(lowered)) flags.push('Negative Equity');
if (ctx.highEquity) flags.push('High Equity');
if (ctx.noValuationGiven) flags.push('No Valuation Given');
if (/outright cash|cash purchase|cash buyer|paying in cash|cleared funds|self finance full amount|arranged my own finance/i.test(lowered)) flags.push('Cash Buyer');
if (ctx.finance) flags.push('Finance');
if (ctx.motab) flags.push('Motab');
if (/\bvan\b|commercial vehicle|\blcv\b/i.test(lowered)) flags.push('Van / Commercial');
if (/\bltd\b|\bvat\b|business lease|\bbch\b|business_enquiry|limited company/i.test(lowered)) flags.push('Business');
if (ctx.model) flags.push('Model');
if (/email only|no calls|do not call|prefer email|can'?t take calls|email reply is preferred/i.test(lowered) || /^email only -/i.test(lowered)) flags.push('Email Only');
if (/can you deliver|delivery to [a-z0-9]|move.{0,20}(this car|it) to|transfer.{0,20} to |too far to travel/i.test(lowered) && !ctx.systemTransferField) flags.push('Delivery / Transfer');
if (/second request|third chaser/i.test(lowered) || ctx.repeatRequest) flags.push('Repeat Request');
if (ctx.duplicate) flags.push('Duplicate');
if (/call today|close a deal today/i.test(lowered) || ctx.urgentToday) flags.push('Urgent Today');
if (ctx.reschedule) flags.push('Reschedule');
if (ctx.staleIncomplete) flags.push('Stale / Incomplete');
if (/walk\s*around video|walkaround video|send a video|video walkthrough|personalised video|cold start video/i.test(lowered)) flags.push('Remote / Video');
if (src.endsWith('- online store') || /\(online store\)|online store car/i.test(lowered)) flags.push('Online Store');
if (/please allocate to|\bexec:\s*[a-z]|fao\s+[a-z]/i.test(text) || ctx.execRequested) flags.push('Exec Requested');
if (/noproject|outright_sale|looking to sell my car/i.test(lowered) || ctx.sellOnly) flags.push('Sell Only');
if (ctx.suspicious) flags.push('Suspicious');
if (ctx.reservation15) flags.push('Reservation 15-Min Call');

return flags;
}

const TIER_NAMES = {
1: 'CONFIRMED DATE & TIME', 2: 'DATE ONLY', 3: 'LIKELY BOOKING',
4: 'WARM ENQUIRY', 5: 'NURTURE', 6: 'REDIRECT / NO CALL'
};

function R(tier, subCategory, subRank, confidence, reason) {
return { tier, tierName: TIER_NAMES[tier], subCategory, subRank, confidence, reason };
}

// Section 7.9: Motability detection.
function isMotabilityText(lowered) {
return /\bmotab|motability|motabltlity|motobility|motorbility|mobility scheme|mobility car|notability\b.{0,15}car|\bpip\b|\bwav\b|advance payment/i.test(lowered);
}
function isMotabilityHandback(lowered) {
return /lease is up|drop back my mobility car|picked up from my home|dropping.{0,15}mobility car/i.test(lowered);
}

// Section 7.8: complaint keywords.
const COMPLAINT_RE = /formal complaint|\bcomplaint\b|escalate|small claims|solicitor|financial ombudsman|\bbreach\b|consumer rights|statutory rights|\breject\b|terminate my agreement|total refund|sold me.{0,20}faulty|\brubbish\b|a joke\b|appalling|disrespectful|\bfurious\b|harassment|not been contacted|third chaser|wish to return|requesting return|not acceptable|angry and annoyed|disgusting|\bmisled\b/i;

// Section 7.7: cancellation / reschedule / withdrawal.
const CANCEL_RE = /\bcancel\b|no longer able to attend|will not be attending|won'?t be able to make it|can no longer make/i;
const ORDER_CONTEXT_RE = /cancel my order|cancel the reservation|order number|order id|\bdeposit\b|\brefund\b/i;
const WITHDRAWN_RE = /found a car( locally)?|may now be sorted|decided to stick with|changed our minds|going to go for that/i;
const RESCHEDULE_RE = /\breschedule\b|alternative time|another date|move my (appointment|test drive)|make a new date|\brearrange\b|\brebook\b|rather than \d|change my appointment to/i;

// Section 7.12: agent note markers.
const AGENT_NOTE_RE = /\*\*\* priority acceptance required \*\*\*|please confirm provisional appointment with customer|customer requires further communication|customer is booked in|customer has been booked in|customer booked in for|provisionally booked in|customer is booked in|customer called in|\bvm left\b|rec customer to|explained online store process|please call customer|please can \w+ confirm|\bhot lead\b|customer said|i have advised|i had advised|i couldn'?t locate vehicle|^-\s*customer\b|contact centre sales event lead from inbound call|contact centre sales event lead from api|customer has called to confirm appointment|warm transferred|came through on live chat|email sent -|called cx\b|no answer\b|\bcx\b|fao\s+[a-z]/i;
const AGENT_NOTE_THIRDPERSON_RE = /^customer (wants|has|is looking|is interested|interested)|they have a budget of/i;
const AGENT_INITIALS_RE = /-\s*[A-Z]{2}\s*$|with\s+[A-Z]{2}\s*$/;

function looksLikeAgentNote(text) {
return AGENT_NOTE_RE.test(text) || AGENT_NOTE_THIRDPERSON_RE.test(text) || AGENT_INITIALS_RE.test(text);
}

// Section 8.1: source inference (only when Source is blank).
function inferSource(text, source) {
if (source) return source;
if (/Lead ID:\s*00Qa/i.test(text)) return 'Customer First';
if (/Comment Line #1:|Sourced from Robins & Day Website/i.test(text)) return 'Robins & Day Website';
if (/Misc:.*UniqueID/i.test(text)) return 'Autofunnel';
if (/Message from Consumer at/i.test(text)) return 'Autotrader';
// Confirmed live: a real CarGurus lead had a blank Source column, with
// only the "(CarGurus IMV: ...)"/"Deal rating:" signature in the notes
// themselves to go on - without this, it's indistinguishable from a
// generic Robins & Day enquiry and never reaches marketplaceTemplates'
// CarGurus branch at all.
if (/\(CarGurus (IMV|deal rating)/i.test(text)) return 'Cargurus';
return source;
}

// Section 7.10: spam / test.
function isSpamOrTest(text, lowered) {
if (/\bmb000[1-6]\b/i.test(text)) return true;
if (/\btest123\b/i.test(text)) return true;
if (/pop-in-instant-voucher-qa/i.test(text)) return true;
const partExVal = field(text, 'PartExReg') || '';
const partExMil = field(text, 'PartExMileage') || '';
const anythingElse = field(text, 'AnythingElse') || '';
if (/test/i.test(partExVal) || /test/i.test(partExMil) || /test/i.test(anythingElse) || /no reg/i.test(partExVal) && /test/i.test(text)) return true;
const commentsOnly = (field(text, 'Customer Comments') || '').toLowerCase();
if (/^(qwerty|asdf|zxcv)$/i.test(lowered) || /^(.)\1{3,}$/.test(lowered.replace(/\s/g, ''))
|| /^(qwerty|asdf|zxcv)$/i.test(commentsOnly) || (commentsOnly && /^(.)\1{3,}$/.test(commentsOnly.replace(/\s/g, '')))) return true;
if (/\breviews\b|\bseo\b|google maps.{0,20}marketing|whatsapp:\s*\+|noticed a few opportunities|\bsponsor\b|training offers|\btender\b|collaboration opportunities/i.test(lowered)) return true;
return false;
}

// Section 7.16: non-customer / admin.
function isNonCustomerAdmin(lowered) {
if (/apply for a job role|industry placement|work experience|\bcv\b|sales advisor position|t level industry placement/i.test(lowered)) return true;
if (/remittance|require a payment of £|financial interest in this vehicle/i.test(lowered)) return true;
if (/would you consider listing this on|head of trade/i.test(lowered)) return true;
if (/\bdonation\b|community project discount|publicity car loan/i.test(lowered)) return true;
return false;
}
function isSuspicious(lowered) {
return /sort code|account number|require a payment of £/i.test(lowered);
}

// Section 7.17: B2B / Fleet.
function isFleet(text, campaign, lowered) {
if (/campaign:\s*b2b/i.test(text)) return true;
if (/vehicle type:.*fleet size:/i.test(text)) return true;
if (/business fleet enquiry form/i.test(text)) return true;
if (/\bfleet\b/i.test(lowered) && /\d+\b.{0,25}\b(vans?|vehicles?)\b/i.test(lowered)) return true;
if (/commercial\s*\/\s*fleet sales team/i.test(lowered)) return true;
return false;
}

// Section 7.11: finance override - restricted to customer-typed text
// only (never form-label fields), whole-word matched so "tech" never
// fires inside PureTech/Tech Line/etc, with an explicit negation list
// so "no finance owned"/"self financed" never count as a request.
function hasFinanceWording(lowered) {
if (/no finance|no outstanding finance|cleared and owned|self financed|self finance|arranged my own finance|finance paid off/i.test(lowered)) return false;
return /\bfinance\b|\bpcp\b|\bhp\b|\bquote\b|\bquotes\b|\bleasing\b|\b0%\b|\bbest price\b|\btechnical\b|\btech support\b/i.test(lowered);
}

// Main pipeline - Section 3's 13 steps, in order. Each step below
// either returns a result (stop) or null (continue to the next step).
function classifyLead(initialNotesRaw, opts) {
opts = opts || {};
let { campaign, source, created, referenceDate, hasAlreadyEngagedCallEntry } = opts;
referenceDate = referenceDate || new Date();

// inferSource runs against the RAW text, before stripSystemSuffixes -
// the CarGurus signature it looks for ("(CarGurus IMV: ...)") is
// exactly the system suffix Section 3.1 strips before any keyword
// scan, so checking the already-stripped text would never find it
// (confirmed live: a real CarGurus lead with a blank Source column
// was never recognised as CarGurus at all because of this ordering).
source = inferSource(initialNotesRaw, source);
const text0 = stripSystemSuffixes(initialNotesRaw);
const lowered = low(text0);
const camp = low(campaign);
const src = low(source);
const flagCtx = {};

let result = null;

// Step 3/4: spam / non-customer admin.
if (isSpamOrTest(text0, lowered)) {
result = R(6, 'Spam / Test', 9, 'high', 'Matched spam/test detection (Section 7.10).');
} else if (isNonCustomerAdmin(lowered)) {
result = R(6, 'Non-Customer / Admin', 10, 'high', 'Matched non-customer admin detection (Section 7.16).');
if (isSuspicious(lowered)) flagCtx.suspicious = true;
}

// Step 5: our agent notes (skipped for Live chat/marketplace sources,
// which are customer-originated even when third-person-shaped).
const isLiveChat = src === 'live chat';
const isMarketplace = /cargurus|aa cars|cargeneralemaildealer|vangeneralemaildealer|dealerimageenquiry|vehiclecartradeenquiry|vehiclevantradeenquiry|autotrader/i.test(src);
if (!result && !isLiveChat && !isMarketplace && looksLikeAgentNote(text0)) {
if (/customer is booked in|customer has been booked in|customer booked in for|provisionally booked in|priority acceptance required|customer requires further communication.{0,10}to confirm test drive|customer called in to reschedule|customer has called to confirm appointment|coming in\b.*\d{1,2}:\d{2}|rather than \d{1,2}:\d{2}/i.test(lowered)) {
result = R(6, 'Already Booked', 2, 'high', 'Agent note recording a booking (Section 7.12).');
if (/\[make model\]|00:00/i.test(text0)) flagCtx.staleIncomplete = true;
} else if (/but can no longer make that|2nd september @ 11:00 but/i.test(lowered) || (CANCEL_RE.test(lowered) && !ORDER_CONTEXT_RE.test(lowered))) {
result = R(6, 'Cancelled / Withdrawn', 1, 'high', 'Agent note recording a cancellation (Section 7.12).');
} else {
result = R(6, 'Inbound: Already Handled', 3, 'high', 'Our own agent note, not a fresh enquiry (Section 7.12).');
if (/video/i.test(lowered)) flagCtx.systemTransferField = false;
}
}

// Step 6: customer redirect/reschedule checks, in order.
if (!result) result = customerRedirectChecks(text0, lowered, camp, src, flagCtx);

// Step 7: system note templates.
if (!result) result = systemTemplates(text0, lowered, camp, src, referenceDate, flagCtx);

// Step 8: Customer First marketing codes.
if (!result) result = customerFirstMarketingCode(text0, lowered, camp, src, flagCtx);

// Step 9: free-text date/time.
if (!result) result = freeTextDateTime(text0, lowered, referenceDate, flagCtx);

// Step 10: campaign rules.
if (!result) result = campaignRules(text0, lowered, camp, src, flagCtx);

// Step 11: fallback.
if (!result) result = R(5, 'Enquiry: Blank', 9, 'low', 'Nothing matched - fallback to Enquiry: Blank.');

// Step 12: flags.
const flags = computeFlags(text0, campaign, source, flagCtx);

// Step 13: Post Closure Processing. Being carved out incrementally as
// real criteria are confirmed (per instruction) rather than replaced in
// one go - "Scheduled a call" and a "Spoke To Customer" call outcome
// anywhere in the customer's timeline are the confirmed signals so far
// (see hasAlreadyEngagedCallEntry/anyCallEntryIndicatesAlreadyEngaged),
// meaning the customer's already been engaged and the lead should go
// straight back rather than being worked again. Everything else still
// falls to the "check" bucket - not yet known whether a dealer already
// contacted the customer or the lead was rejected, which would also
// mean "send back", just not detectable yet. "check:" drops once those
// are carved out too and this stops being a guess.
const postClosureAction = src === 'post closure processing'
? (hasAlreadyEngagedCallEntry ? 'send back through' : 'check: needs contact?')
: null;

return Object.assign({}, result, { flags, dedupeKey: computeDedupeKey(text0, campaign, source), postClosureAction, source });
}

// Step 6: customer redirect / reschedule checks (Section 3.6, order
// matters - confirmed live in v1.4 that checking cancellation/
// withdrawal and reschedule BEFORE "references an existing booking"
// fixes real misclassifications a naive order produces).
function customerRedirectChecks(text, lowered, camp, src, flagCtx) {
// 6.1/6.2: cancellation-without-rebook / withdrawal.
if (CANCEL_RE.test(lowered) && !ORDER_CONTEXT_RE.test(lowered)) {
if (RESCHEDULE_RE.test(lowered) || /will be in touch to set up an alternative time|will call next week to rearrange|will rebook at some point next week/i.test(lowered)) {
// handled by the reschedule branch below
} else {
return R(6, 'Cancelled / Withdrawn', 1, 'high', 'Customer cancellation with no rebook request (Section 3.6.1).');
}
}
if (WITHDRAWN_RE.test(lowered)) {
return R(6, 'Cancelled / Withdrawn', 1, 'high', 'Customer withdrew interest (Section 3.6.1).');
}

// 6.2: reschedule of a view/discuss/test drive.
if (RESCHEDULE_RE.test(lowered) || (CANCEL_RE.test(lowered) && /will be in touch to set up an alternative time|will call next week to rearrange|will rebook at some point next week|need to cancel/i.test(lowered))) {
// "I will be in touch/call to rearrange" explicitly means no new
// day/time has been given YET (a future promise) - any day/time
// elsewhere in the text describes the OLD appointment being given
// up, not a new slot, so it must not upgrade the tier here.
const noNewSlotYet = /will be in touch to set up an alternative time|will call next week to rearrange|will rebook at some point next week/i.test(lowered);
const dayTime = noNewSlotYet ? null : freeTextDateTime(text, lowered, new Date(), flagCtx, true);
if (dayTime) {
flagCtx.reschedule = true;
return Object.assign({}, dayTime, { reason: dayTime.reason + ' (customer reschedule with a new day/time).' });
}
flagCtx.reschedule = true;
return R(3, 'Reschedule Request', 1, 'high', 'Customer-written reschedule request, no new day/time given (Section 5, Tier 3 rank 1).');
}

// 6.3: references an existing booking/reservation.
if (/i have a (test drive|viewing) (already )?booked|your head office booked me in|i have booking for/i.test(lowered)) {
if (/named|allocate to/i.test(lowered)) flagCtx.execRequested = true;
return R(6, 'Already Booked', 2, 'high', 'Customer references an existing booking (Section 3.6.3).');
}

// 6.4: existing customer wanting to change car.
if (/(on pcp with yourselves|finance with (us|stellantis)|voluntarily terminate).{0,80}(change|reduce|newer|replace)/i.test(lowered)
|| /(want|wanting|looking|requiring) (about |to )?chang(e|ing) my (vehicle|car).{0,60}(reduce|payments)/i.test(lowered)
|| /voluntarily terminate my current pcp/i.test(lowered)
|| (/purchased from yourselves|from yourselves/i.test(lowered) && /chang(e|ing)/i.test(lowered))) {
flagCtx.noPx = false;
return R(4, 'Existing Customer: Upgrade', 1, 'medium', 'Existing customer with car/finance with us wanting to change (Section 3.6.4).');
}

// 6.5: named exec contact, not a rebooking.
if (/(can|could)\s+[a-z]+\s+[a-z]*\s*call me|following up on discussion with|i have spoken to\s+[a-z]+ and|as discussed with|\bi met\s+[a-z]+\b/i.test(lowered) && !/reservation made for viewing|as discussed by phone, reservation/i.test(lowered)) {
flagCtx.execRequested = true;
return R(6, 'Send to Dealer (named exec)', 4, 'medium', 'Customer references an exec/prior conversation, not a rebooking (Section 3.6.5).');
}

// 6.6: fleet.
if (isFleet(text, camp, lowered)) {
return R(6, 'Fleet', 5, 'high', 'Fleet/multi-vehicle language (Section 7.17).');
}

// 6.7: complaint.
if (COMPLAINT_RE.test(lowered)) {
return R(6, 'Complaint', 6, 'high', 'Complaint keyword matched (Section 7.8).');
}

// 6.8: existing order.
if (/cancel my order|order id|order:\s*em|deposit refund|£99 reservation refund/i.test(lowered) && !/reservation made for viewing/i.test(lowered)) {
return R(6, 'Existing Order', 7, 'high', 'Order/reservation cancellation or admin (Section 3.6.8).');
}

// 6.9: aftersales.
if (/recall|\bmot\b|service plan|warranty|spare key|gap policy|courtesy car|rental car|direct debit|account login/i.test(lowered)) {
if (isMotabilityHandback(lowered) && !/next car|newer|replace/i.test(lowered)) flagCtx.motab = true;
return R(6, 'Aftersales', 8, 'high', 'Aftersales/recall/warranty/admin wording (Section 3.6.9).');
}
// A day+time mention still wins over a plain handback read (Section
// 5's "a day/time still raises it to Tier 1/2" pattern, applied here
// too) - a scheduled visit is a real appointment, not just handback
// admin, even when it's framed around a Motability lease.
if (isMotabilityHandback(lowered) && !/next car|newer|replace/i.test(lowered) && !(hasDayMention(text) && hasClockTime(text))) {
flagCtx.motab = true;
return R(6, 'Aftersales', 8, 'high', 'Motability handback, no next car mentioned (Section 7.9).');
}
if (isMotabilityHandback(lowered)) flagCtx.motab = true;
if (/settlement figure|won'?t let me access my account|settlement.{0,20}(login|extension)/i.test(lowered) && !/change|newer|replace/i.test(lowered)) {
return R(6, 'Aftersales', 8, 'medium', 'Settlement/login/extension question, no mention of changing car (Section 3.6.9).');
}

return null;
}

// Step 9: free-text date/time detection - also reused by the
// reschedule check above for "does the reschedule request itself
// carry a new day/time".
function freeTextDateTime(text, lowered, referenceDate, flagCtx, forReschedule) {
const hasTime = hasClockTime(text);
const hasDay = hasDayMention(text);
if (hasDay && hasTime) {
return R(1, 'Customer-Stated Slot', 3, 'medium', 'Free text contains a specific/relative day AND a clock time (Section 5, Tier 1 rank 3).');
}
if (hasDay) {
return R(2, 'Customer-Stated Day', 3, 'medium', 'Free text contains a specific/relative day, no clock time (Section 5, Tier 2 rank 3).');
}
return null;
}

// Step 7: system note templates (Section 7.1-7.9, 7.13-7.15, 7.17).
function systemTemplates(text, lowered, camp, src, referenceDate, flagCtx) {
// 7.1: website test drive.
if (/Preferred Date\/Time:\s*\d{4}-\d{2}-\d{2},\s*\d{1,2}:\d{2}\s*[AP]M/i.test(text)) {
return R(1, 'Website Test Drive', 1, 'high', 'Structured new-car form with Preferred Date/Time (Section 7.1).');
}
if (/Vehicle URL:.*Date\/Time:\s*\w{3}\s\w{3}\s\d{1,2}\s\d{4}\s\d{1,2}:\d{2}\s*[AP]M/i.test(text)) {
return R(1, 'Website Test Drive', 1, 'high', 'Used-car form with Vehicle URL + Date/Time (Section 7.1).');
}
if (/Booking date:\s*\d{4}-\d{2}-\d{2}/i.test(text)) {
return R(2, 'Website Booking Date', 2, 'high', 'Booking date template (Section 7.1).');
}

// 8.3: "Comment Line #1: Source: [campaign name]" - the phone-led
// website campaign form. Checked as its own template (not gated on
// an exact campaign/source string match) since the literal template
// text is the real signal; the spec ties it to Robins & Day Enquiry -
// New but this exact label only ever appears on that form in
// practice.
const sourceFieldMatch = text.match(/Comment Line #1:\s*Source:\s*([\s\S]*)$/i);
if (sourceFieldMatch) {
const formName = sourceFieldMatch[1];
// 7.9: a form NAME containing Motability goes to 3.6, not this
// rank - same "Source:" template, just naming a Motability form.
if (isMotabilityText(low(formName))) {
flagCtx.motab = true;
return R(3, 'Motability: Information Only', 6, 'high', 'Comment Line #1: Source: template naming a Motability form (Section 7.9).');
}
// 8.2 v1.10: Register Interest / Keep Me Informed forms are a
// passive notify-me sign-up, not this phone-led rank.
if (/register interest|keep me informed/i.test(formName)) {
return R(5, 'Enquiry: Blank', 9, 'medium', 'Comment Line #1: Source: template naming a Register Interest/Keep Me Informed form (Section 8.2, v1.10).');
}
flagCtx.model = true;
return R(4, 'Website Campaign Form (phone-led)', 6, 'medium', 'Comment Line #1: Source: template (Section 8.3).');
}

// 7.2: valuation (Robins & Day).
if (/the customer is possibly interested in the following vehicle/i.test(text)) {
return R(4, 'Valuation + VOI Stated', 9, 'medium', '"Possibly interested in the following vehicle" template (Section 7.2).');
}
const valMatch = text.match(/the customer was on the following website page, before completing the valuation:\s*(\S+)/i);
if (valMatch) return classifyValuationUrl(valMatch[1], flagCtx);

// 7.3: valuation (Customer First and others).
if (/px derivative:/i.test(text)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'PX Derivative field present (Section 7.3).');
if (/owned vehicle price:/i.test(text)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Owned Vehicle Price field present (Section 7.3).');
if (/ds certified-trade in-(ads|generic)|bonus reprise/i.test(text)) { flagCtx.noPx = false; return R(5, 'Valuation Only / Sell Only', 6, 'high', 'DS Certified trade-in template (Section 7.3).'); }
if (/spoticar-trade in-(ads|generic)/i.test(text)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Spoticar trade-in template (Section 7.3/7.15).');
if (/customer submitted a vehicle valuation for registration/i.test(text)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Customer submitted a vehicle valuation template (Section 7.3).');

// 7.4: configurator / stock.
if (/trim selected:|paint selected:|finance selected:|sol-configuration-info|sol-stock-info|modelvin:/i.test(text)) {
return R(4, 'Configurator Build', 2, 'high', 'Configurator/stock template (Section 7.4).');
}

// 7.5: vehicle URL / reservation.
if (/has been reserved online/i.test(text)) return reservationResult(text, lowered, flagCtx);
if (/note:: this is an auto trader reservation\./i.test(text)) return reservationResult(text, lowered, flagCtx);
if (/Vehicle URL:\s*\S*\/(used-vehicles|new-cars-in-stock)\/\S*/i.test(text)) {
return classifyVehicleUrlComment(text, lowered, flagCtx);
}

// 7.6: system feeds.
if (/Misc:.*UniqueID\s*=/i.test(text)) return autofunnelResult(text, lowered, flagCtx);
if (/FindOutMore\s*=|Purchase\s*=/i.test(text) && !/Misc:.*UniqueID/i.test(text)) return mbMailResult(text, lowered, flagCtx);
if (/Annual Mileage:.*Customer Number:/is.test(text)) {
if (COMPLAINT_RE.test(lowered)) return R(6, 'Complaint', 6, 'high', 'MB Mail aftersales with complaint wording (Section 7.6).');
return R(6, 'Aftersales', 8, 'high', 'MB Mail aftersales template (Section 7.6).');
}
if (/customer is 6 months from renewal/i.test(text)) return R(5, 'Motability Renewal (6-month)', 5, 'high', 'Motability renewal template (Section 7.6).');
if (/booking_type:.*sales_or_service:\s*sales/is.test(text)) return R(5, 'Service Lane Opportunity', 12, 'medium', 'Service Lane booking template, sales-flavoured (Section 7.6).');
if (/customer was unable to generate a quote online and has requested a quote from the dealer/i.test(text)) {
flagCtx.finance = true;
return R(3, 'Finance Quote Request: Specific Car', 9, 'high', 'Finance quote request template (Section 7.6).');
}

// 7.9: Motability wording (non-CF marketing code paths).
if (isMotabilityText(lowered) && !camp.includes('motability')) {
flagCtx.motab = true;
// Day+time still wins - falls through to step 9 instead of being
// caught here as a lower-tier Motability read.
if (hasDayMention(text) && hasClockTime(text)) return null;
if (/visit|test drive|order|view|come in|see the car/i.test(lowered)) {
return R(3, 'Motability Enquiry: Visit Intent', 5, 'medium', 'Motability wording + visit intent (Section 7.9).');
}
return R(3, 'Motability: Information Only', 6, 'medium', 'Motability wording, question only (Section 7.9).');
}

// 7.13: marketplace templates.
const marketplaceResult = marketplaceTemplates(text, lowered, camp, src, referenceDate, flagCtx);
if (marketplaceResult) return marketplaceResult;

// 7.14: live chat templates (customer-originated, Source = Live chat
// only - the same wording on any other source is an agent note,
// already handled in step 5).
if (src === 'live chat') {
const liveChatResult = liveChatTemplates(text, lowered, flagCtx);
if (liveChatResult) return liveChatResult;
}

// 7.15: Spoticar templates.
const spoticarResult = spoticarTemplates(text, lowered, flagCtx);
if (spoticarResult) return spoticarResult;

// Section 5, Tier 4 rank 7: Used Stock Search - no specific car, but
// concrete criteria (model/trim, year range, gearbox, fuel, mileage,
// budget, colour), distinguished from a vague request (5.9) by at
// least one concrete detail alongside "looking for" wording.
if (/looking for a\b|i'?m looking for\b/i.test(lowered) && /\b20\d{2}\b|onwards|or newer|automatic|manual|hybrid|electric|petrol|diesel|\bblack\b|\bwhite\b|\bblue\b|\bred\b|\bseater\b/i.test(lowered)) {
return R(4, 'Used Stock Search', 7, 'medium', 'Concrete stock-search criteria, no specific car identified (Section 5, Tier 4 rank 7).');
}

// Section 5, Tier 4 rank 3: Quote/Offer Request: Detailed - real terms
// (deposit, term, mileage) on a model with no specific stock car.
// Confirmed live from a real manually-reviewed lead ("interested in
// lease deals... 2 year contract 8000 miles no arrangement fee and
// low penalty charge") that the classifier's blanket 5.9 fallback was
// missing: genuine quote terms phrased as prose ("lease deal"/a
// contract length + a mileage figure), not just the CF form's own
// Deposit:/Term:/Monthly Budget: field labels hasAmountField looks
// for elsewhere. Guarded on no day/time - a day/time mention still
// wins regardless (Section 5's own repeated rule), so this only
// catches leads that get this far without one.
if (!(hasDayMention(text) && hasClockTime(text)) && /lease deals?\b|\b\d+\s*(year|yr|month)s?\s*(contract|lease|term)\b/i.test(lowered) && /\b\d[\d,]*\s*(k\s*)?miles?\b/i.test(lowered)) {
flagCtx.finance = true;
return R(4, 'Quote / Offer Request: Detailed', 3, 'medium', 'Real quote terms in free text - contract length + mileage (Section 5, Tier 4 rank 3).');
}

return null;
}

function classifyValuationUrl(rawUrl, flagCtx) {
let path;
try {
path = new URL(rawUrl).pathname;
} catch (error) {
path = rawUrl.split('?')[0];
}
path = path.replace(/\/$/, '');
if (/\/24-hour-test-drive\//i.test(path)) return R(5, '24hr EV Test Drive Page', 1, 'high', 'EV 24hr test drive page visit (Section 7.2).');
if (/\/configurator\/.*\/personalise-finance/i.test(path)) return R(4, 'Valuation + VOI Page', 10, 'medium', 'Configurator personalise-finance page (Section 7.2).');
if (/\/motability\//i.test(path)) { if (flagCtx) flagCtx.motab = true; return R(4, 'Valuation + VOI Page', 10, 'medium', 'Motability valuation page (Section 7.2).'); }
if (/\/service\//i.test(path)) return R(5, 'Valuation: Service Page', 14, 'low', 'Service-area valuation page (Section 7.2).');
if (/\/used-vehicles\/|\/new-cars-in-stock\//i.test(path)) return R(4, 'Valuation + VOI Page', 10, 'medium', 'Specific stock car valuation page (Section 7.2).');
if (/\/new\/[^/]+/i.test(path)) return R(4, 'Valuation + VOI Page', 10, 'medium', 'Model/offer page under /new/ with something after it (Section 7.2).');
if (/^\/(dealers\/[a-z-]+|(peugeot|citroen|ds|vauxhall|fiat|abarth|alfa-romeo|jeep|leapmotor)-[a-z-]+)$/i.test(path)) {
return R(5, 'Valuation Only / Sell Only', 6, 'medium', 'Dealer page (Section 7.2).');
}
if (/^\/[a-z-]+\/new$/i.test(path)) return R(5, 'Valuation Only / Sell Only', 6, 'medium', 'Bare /[brand]/new landing page, nothing after it (Section 7.2, v1.10).');
if (/mbmail/i.test(rawUrl)) return R(5, 'Valuation Only / Sell Only', 6, 'low', 'MB Mail valuation campaign - bottom of Nurture (Section 7.2).');
return R(5, 'Valuation Only / Sell Only', 6, 'medium', 'Generic/car-valuation/home/brand/stock-listing page (Section 7.2).');
}

function reservationResult(text, lowered, flagCtx) {
if (/as discussed by phone, reservation made for viewing and test drive|re telecom with.*please reserve subject to.*visit/i.test(lowered)) {
flagCtx.execRequested = /named|allocate/i.test(lowered);
return R(6, 'Already Booked', 2, 'high', 'Reservation with a visit already arranged by phone/named person (Section 5, Tier 3 rank 3).');
}
if (/i have spoken to.*running finance options/i.test(lowered)) {
flagCtx.execRequested = true;
return R(6, 'Send to Dealer (named exec)', 4, 'medium', 'Reservation with exec conversation, no visit arranged (Section 5, Tier 3 rank 3).');
}
if (/would love to cancel|reserved this car just now but/i.test(lowered)) {
return R(6, 'Existing Order', 7, 'high', 'Reservation cancellation (Section 5, Tier 3 rank 3).');
}
if (hasDayMention(text) && hasClockTime(text)) return R(1, 'Reserve with Appointment', 5, 'high', 'Reserved AND booked a time (Section 5, Tier 1 rank 5).');
if (hasDayMention(text)) return R(2, 'Customer-Stated Day', 3, 'medium', 'Reservation with a day mentioned, subject to visit (Section 5, Tier 2 rank 3).');
flagCtx.reservation15 = true;
return R(3, 'Reserve Online', 3, 'high', 'Online/Autotrader reservation template (Section 7.5).');
}

function classifyVehicleUrlComment(text, lowered, flagCtx) {
if (/Date\/Time:\s*\w{3}\s\w{3}\s\d{1,2}\s\d{4}\s\d{1,2}:\d{2}\s*[AP]M/i.test(text)) {
return R(1, 'Website Test Drive', 1, 'high', 'Vehicle URL used-car form with Date/Time (Section 7.1/7.5).');
}
const commentMatch = text.match(/Customer comment:\s*([\s\S]*)$/i);
const comment = commentMatch ? commentMatch[1].trim() : '';
const commentLower = comment.toLowerCase();
if (!comment || comment === '-') return R(3, 'Vehicle URL / Video Request', 10, 'high', 'Vehicle URL with a specific stock car, blank comment (Section 7.5).');
if (/i have a viewing booked|i have a test drive already booked/i.test(commentLower)) {
if (/video|picture/i.test(commentLower)) flagCtx.systemTransferField = false;
return R(6, 'Already Booked', 2, 'high', 'Vehicle URL comment references an existing booking (Section 5, Tier 3 rank 10).');
}
if (hasDayMention(comment) && hasClockTime(comment)) return R(1, 'Customer-Stated Slot', 3, 'high', 'Vehicle URL comment with day + time (Section 5, Tier 1 rank 3).');
if (hasDayMention(comment)) return R(2, 'Customer-Stated Day', 3, 'medium', 'Vehicle URL comment with a day only (Section 5, Tier 2 rank 3).');
if (/on pcp with yourselves|finance with (us|stellantis)|voluntarily terminate.{0,60}(change|reduce|newer|replace)/i.test(commentLower)) {
flagCtx.noPx = false;
return R(4, 'Existing Customer: Upgrade', 1, 'medium', 'Vehicle URL comment: existing customer with car/finance with us (Section 3.6.4).');
}
if (/currently have|owe just under|wanting a.*pcp/i.test(commentLower) && hasFinanceWording(commentLower)) {
flagCtx.finance = true;
return R(3, 'Finance Quote Request: Specific Car', 9, 'high', 'Vehicle URL comment with finance terms on an identified car (Section 5, Tier 3 rank 9).');
}
return R(3, 'Vehicle URL / Video Request', 10, 'medium', 'Vehicle URL with spec/history question (Section 7.5).');
}

function autofunnelResult(text, lowered, flagCtx) {
if (field(text, 'Desc1')) flagCtx.noPx = false;
return R(5, 'Email Campaign (Autofunnel)', 10, 'medium', 'Autofunnel template (Section 7.6).');
}

function mbMailResult(text, lowered, flagCtx) {
const findOutMore = (field(text, 'FindOutMore') || '').toLowerCase();
if (field(text, 'PartExReg')) flagCtx.noPx = false;
if (/test drive/i.test(findOutMore)) return R(5, 'MB Mail Enquiry Form', 11, 'medium', 'MB Mail form, Test Drive ticked (Section 7.6, top of group).');
return R(5, 'MB Mail Enquiry Form', 11, 'low', 'MB Mail form (Section 7.6, bottom of group).');
}

function marketplaceTemplates(text, lowered, camp, src, referenceDate, flagCtx) {
if (src === 'autotrader' || src.startsWith('autotrader')) {
const tsMatch = text.match(/Message from Consumer at \w{3}, \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2}\s*[AP]M:/i);
if (tsMatch) {
// Cuts after the FULL timestamp (...AM: / ...PM:), not the first
// colon in the string - the timestamp itself contains a colon
// (7:23 AM), so a naive first-colon split leaves residual digits
// from the time in the "message" and hasClockTime spuriously
// matches them (confirmed: "23 AM" from a truncated "7:23 AM").
const msg = text.slice(tsMatch.index + tsMatch[0].length);
const msgLower = msg.toLowerCase();
if (/i'?m interested in finance for this/i.test(msgLower)) { flagCtx.finance = true; return R(3, 'Autotrader Enquiry', 8, 'high', 'Autotrader finance button (Section 7.13).'); }
if (/i can offer £/i.test(msgLower) && /ready to purchase|do not have a px/i.test(msgLower)) {
return R(4, 'Offer Made: Price Offer', 5, 'medium', 'Autotrader firm price offer (Section 5, Tier 4 rank 5).');
}
if (/would love to cancel|reserved this car just now/i.test(msgLower)) return R(6, 'Existing Order', 7, 'high', 'Autotrader reservation cancellation (Section 5).');
if (hasDayMention(msg) && hasClockTime(msg)) return R(1, 'Customer-Stated Slot', 3, 'high', 'Autotrader message with day+time (Section 5, Tier 1 rank 3).');
if (hasDayMention(msg)) return R(2, 'Customer-Stated Day', 3, 'medium', 'Autotrader message with a day (Section 5, Tier 2 rank 3).');
return R(3, 'Autotrader Enquiry', 8, 'medium', 'Autotrader consumer message (Section 7.13).');
}
if (/^Sourced from Autotrader - Deal Builder(\s*-\s*Online Store)?\.?$/i.test(text.trim())) {
return R(3, 'Autotrader Enquiry', 8, 'low', 'Blank Autotrader Deal Builder template (Section 7.13, bottom).');
}
}
if (src === 'cargurus' || src.startsWith('cargurus')) {
const msgMatch = text.match(/Message from customer:\s*([\s\S]*)$/i);
const transcriptMatch = text.match(/Transcript(\s*\(may be truncated\))?:\s*([\s\S]*)$/i);
if (transcriptMatch) {
const lines = transcriptMatch[2].split(/\n/).filter((l) => /^(visitor|\(consumer\)):/i.test(l.trim()));
const combined = lines.join(' ').toLowerCase();
if (hasDayMention(combined) && hasClockTime(combined)) return R(1, 'Customer-Stated Slot', 3, 'medium', 'CarGurus transcript with day+time (Section 5, Tier 1 rank 3).');
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'medium', 'CarGurus transcript (Section 7.13).');
}
if (msgMatch) {
const msg = msgMatch[1];
const msgLower = msg.toLowerCase();
if (/are you able to transfer this to|transfer this to/i.test(msgLower)) { flagCtx.systemTransferField = false; return R(3, 'Used Enquiry: Specific Car', 7, 'medium', 'CarGurus transfer + view request (Section 5, Tier 3 rank 7).'); }
if (/i'?m interested in this.*and i'?d like to know if it'?s still available|i am interested in your.*you can reach me by/i.test(msgLower)) {
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'low', 'CarGurus bare enquiry template (Section 7.13, bottom).');
}
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'medium', 'CarGurus message (Section 7.13).');
}
}
if (src === 'aa cars') {
// "URL of vehicle of interest:" is stripped as a system suffix at
// normalise time (Section 3.1), so it's no longer there to anchor
// against by the time this runs - match to end-of-segment instead.
const m = text.match(/Reg:\s*(\S+)\s*\|\s*Message from customer:\s*([\s\S]*?)\s*\|?\s*$/i);
if (m) {
const msgLower = m[2].toLowerCase();
if (/would like to book a test drive/i.test(msgLower)) return R(3, 'Test Drive Request (no date)', 2, 'high', 'AA Cars test drive request (Section 7.13).');
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'medium', 'AA Cars message (Section 7.13).');
}
}
if (/cargeneralemaildealer|vangeneralemaildealer|dealerimageenquiry|vehiclecartradeenquiry|vehiclevantradeenquiry/i.test(src)) {
const m = text.match(/Message from customer:\s*Email Message:\s*\|?\s*([\s\S]*)$/i);
if (m) {
const msg = m[1].trim();
const msgLower = msg.toLowerCase();
if (!msg || /no message/i.test(msgLower) || /is this still available/i.test(msgLower)) {
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'low', 'Email-style bare enquiry (Section 7.13, bottom).');
}
if (/would like to book a test drive/i.test(msgLower)) return R(3, 'Test Drive Request (no date)', 2, 'high', 'Email-style test drive request (Section 7.13).');
if (hasDayMention(msg) && hasClockTime(msg)) return R(1, 'Customer-Stated Slot', 3, 'high', 'Email-style message with day+time (Section 5, Tier 1 rank 3).');
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'medium', 'Email-style message (Section 7.13).');
}
}
return null;
}

function liveChatTemplates(text, lowered, flagCtx) {
if (/Test Drive Request For Reg\s*=\s*\S+/i.test(text) || /Customer would like to (request|book) a test drive for -\s*\S+/i.test(text)) {
return R(3, 'Test Drive Request (no date)', 2, 'high', 'Live chat test drive request (Section 7.14).');
}
if (/Can I see more photos or a walkaround video|I'?d like a walkaround video of|Customer has requested a personalised video of/i.test(text)) {
return R(3, 'Vehicle URL / Video Request', 10, 'high', 'Live chat video request (Section 7.14).');
}
if (/Customer has requested a valuation for - Registration:/i.test(text)) {
return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Live chat valuation request (Section 7.14).');
}
const saleOrTrade = text.match(/Vehicle:.*Registration:.*Sale or trade in:\s*(trade_in|outright_sale)/i);
if (saleOrTrade) {
if (saleOrTrade[1].toLowerCase() === 'outright_sale') flagCtx.sellOnly = true;
return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Live chat sale/trade-in template (Section 7.14).');
}
if (/^Request For A Callback$/i.test(text.trim())) {
return R(5, 'Enquiry: Blank', 9, 'medium', 'Live chat bare callback request (Section 7.14).');
}
const callbackReason = text.match(/Callback reason:\s*([\s\S]*)$/i);
if (callbackReason) {
const reasonText = callbackReason[1];
if (hasDayMention(reasonText) && hasClockTime(reasonText)) return R(1, 'Customer-Stated Slot', 3, 'medium', 'Live chat callback reason with day+time (Section 7.14).');
if (hasDayMention(reasonText)) return R(2, 'Customer-Stated Day', 3, 'medium', 'Live chat callback reason with a day (Section 7.14).');
return R(4, 'Marketplace Enquiry (non-Autotrader)', 10, 'medium', 'Live chat callback reason classified by content (Section 7.14).');
}
return null;
}

function spoticarTemplates(text, lowered, flagCtx) {
const tradeInMatch = text.match(/Marketing Code:\s*(SPOTICAR-TRADE IN-(ADS|GENERIC)|DS CERTIFIED-TRADE IN-(ADS|GENERIC))/i);
if (tradeInMatch) {
const purchase = (field(text, 'purchase') || '').toLowerCase();
const quotation = text.match(/Quotation showed\s*:\s*(\d+)/i);
if ((quotation && quotation[1] === '0') || /i can'?t find my version/i.test(lowered)) flagCtx.noValuationGiven = true;
if (purchase === 'vo') return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Spoticar/DS trade-in, purchase : VO (Section 7.15, top).');
flagCtx.sellOnly = true;
return R(5, 'Valuation Only / Sell Only', 6, 'medium', 'Spoticar/DS trade-in, Sell Only (Section 7.15).');
}
const formMatch = text.match(/Marketing Code:\s*(SP-SPOTICAR|DS-SPOTICAR|DS CERTIFIED-ENQUIRIES)\s*\|\s*Customer Comments:\s*([\s\S]*)$/i);
if (formMatch) {
const comment = formMatch[2].trim();
const commentLower = comment.toLowerCase();
if (!comment || comment === '-') return R(3, 'Vehicle URL / Video Request', 10, 'high', 'Spoticar form, blank comment (Section 7.15).');
if (hasDayMention(comment) && hasClockTime(comment)) return R(1, 'Customer-Stated Slot', 3, 'high', 'Spoticar form with day+time (Section 7.15).');
if (/test drive|view|come to see/i.test(commentLower)) return R(3, 'Test Drive Request (no date)', 2, 'high', 'Spoticar form, test drive/view (Section 7.15).');
if (/transfer|move.*to/i.test(commentLower)) { flagCtx.systemTransferField = false; return R(3, 'Used Enquiry: Specific Car', 7, 'medium', 'Spoticar form, transfer request (Section 7.15).'); }
if (hasFinanceWording(commentLower) && !/no finance owned/i.test(commentLower)) { flagCtx.finance = true; return R(3, 'Finance Quote Request: Specific Car', 9, 'medium', 'Spoticar form, finance terms (Section 7.15).'); }
return R(3, 'Vehicle URL / Video Request', 10, 'medium', 'Spoticar form comment (Section 7.15).');
}
if (/Marketing Code:\s*SP-SPOTICAR-FINANCE/i.test(text)) {
if (/please email link for finance application/i.test(lowered)) { flagCtx.finance = true; return R(4, 'Quote / Offer Request: Detailed', 3, 'medium', 'Spoticar finance form, explicit request (Section 7.15).'); }
return R(5, 'Quote / Offer Request: Blank', 4, 'medium', 'Spoticar finance form, blank/finance-only (Section 7.15).');
}
if (/Spoticar Direct: This is a SPOTiCAR direct lead\./i.test(text)) {
const rest = text.replace(/Spoticar Direct: This is a SPOTiCAR direct lead\./i, '').trim();
if (!rest) return R(5, 'Enquiry: Blank', 9, 'medium', 'Spoticar Direct, blank (Section 7.15).');
return null;
}
return null;
}

// Step 8: Customer First marketing codes (Section 8.2).
function customerFirstMarketingCode(text, lowered, camp, src, flagCtx) {
// Real notes label this "Marketing Code: X"; other confirmed exports
// sometimes give the code as the bare first pipe-segment instead
// ("BrandSite-Test_Drive | ..."). Both shapes are accepted: labelled
// first, falling back to segment 0 when it doesn't look like some
// other known field.
let code = field(text, 'Marketing Code');
if (!code) {
const firstSeg = segs(text)[0] || '';
if (firstSeg && !/^(lead id|customer comments|first appointment date desired|first desired schedule)\b/i.test(firstSeg)) {
code = firstSeg;
}
}
if (!code) return null;
const codeLower = code.toLowerCase();
const dateField = field(text, 'First Appointment Date Desired') || field(text, 'Date');
let comments = field(text, 'Customer Comments');
if (comments === null) {
comments = segs(text).slice(1)
.filter((s) => !/^(lead id|marketing code|first appointment date desired|first desired schedule):/i.test(s))
.join(' | ');
}
const commentsLower = comments.toLowerCase();
const isFiatAbarth = /fiat|abarth/i.test(camp) || /fiat|abarth/i.test(codeLower);

if (/brandsite-test_drive|sol-store_test-drive/i.test(codeLower)) {
if (dateField && hasClockTime(comments)) return R(1, 'Customer First Test Drive', 2, 'high', 'CF test drive marketing code, date + time (Section 8.2).');
if (dateField) return R(2, 'Customer First Test Drive (date, no time)', 1, 'high', 'CF test drive marketing code, date only (Section 8.2).');
return R(3, 'Test Drive Request (no date)', 2, 'high', 'CF test drive marketing code, no date (Section 8.2).');
}
if (/fiat - test drive|abarth website|pop-in-test_drive_.*fiat|pop-in-test_drive_.*abarth/i.test(codeLower) || (isFiatAbarth && /test.drive/i.test(codeLower))) {
if (dateField && hasClockTime(comments)) return R(1, 'Customer First Test Drive', 2, 'high', 'CF Fiat/Abarth test drive, date+time (Section 8.2).');
if (dateField) return R(2, 'Customer First Test Drive (date, no time)', 1, 'high', 'CF Fiat/Abarth test drive, date only (Section 8.2).');
return R(5, 'Enquiry: Blank', 9, 'medium', 'Fiat/Abarth new-car test drive form, no date/time - general enquiry (Section 8.2).');
}
if (/sol-configuration-info|sol-stock-info/i.test(codeLower)) return R(4, 'Configurator Build', 2, 'high', 'CF configurator marketing code (Section 8.2).');
if (/-bstcot-part exchange tool/i.test(codeLower)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'CF part exchange tool marketing code (Section 8.2).');
if (/^part exchange$/i.test(codeLower)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'Fiat part exchange marketing code (Section 8.2).');
if (/ds certified-trade in-(ads|generic)|spoticar-trade in-(ads|generic)/i.test(codeLower)) return R(5, 'Valuation Only / Sell Only', 6, 'high', 'CF trade-in marketing code (Section 8.2/7.15).');
if (/^(sp-spoticar|ds-spoticar|ds certified-enquiries)$/i.test(codeLower)) {
return spoticarTemplates(text, lowered, flagCtx) || R(3, 'Vehicle URL / Video Request', 10, 'medium', 'Spoticar marketing code (Section 8.2/7.15).');
}
if (/sp-spoticar-finance/i.test(codeLower)) return R(5, 'Quote / Offer Request: Blank', 4, 'medium', 'Spoticar finance marketing code (Section 8.2/7.15).');
if (/-affptr|-affret|-affemp/i.test(codeLower)) return R(5, 'Affinity Scheme', 8, 'medium', 'Affinity scheme marketing code (Section 8.2).');
if (/affiliates-(askaprice|tla|greencar)/i.test(codeLower)) {
const when = field(text, 'When');
const consider = field(text, 'ConsiderStock');
if (when && /asap/i.test(when) && !/notsure/i.test(commentsLower) && consider && /yes/i.test(consider)) {
return R(4, 'Affiliate Quote: ASAP firm', 4, 'high', 'Affiliate quote ASAP+firm (Section 8.2).');
}
return R(5, 'Affiliate Quote (other)', 3, 'medium', 'Affiliate quote, other timeframe (Section 8.2).');
}
if (/affiliates-(regit|pistonheads|carfinder|the_car_expert|electricroad)/i.test(codeLower)) return R(5, 'Enquiry: Blank', 9, 'medium', 'Affiliate low-intent marketing code (Section 8.2).');
if (/affiliates-cargurus/i.test(codeLower)) {
if (/in_the_next_4_weeks/i.test(commentsLower)) return R(4, 'Affiliate Quote: Near-term (CarGurus)', 11, 'medium', 'CarGurus affiliate, in_the_next_4_weeks (Section 8.2, v1.9).');
return R(5, 'Affiliate Quote (other)', 3, 'medium', 'CarGurus affiliate, other timeframe (Section 8.2).');
}
if (/google-search-|google-pmaxsearch-/i.test(codeLower)) return R(5, 'Enquiry: Blank', 9, 'medium', 'Google search marketing code (Section 8.2).');
if (/ap-dypiru-dynamic yield/i.test(codeLower)) return R(5, 'Enquiry: Blank', 9, 'medium', 'Dynamic Yield marketing code (Section 8.2).');
if (/pop-in-stock|brandsite-sales_event_enquiry_/i.test(codeLower)) {
if (!comments || comments === '-') return R(5, 'Enquiry: Blank', 9, 'medium', 'Pop-in-stock/sales event, blank (Section 8.2).');
}
if (/pop-in - instant voucher/i.test(codeLower)) {
if (/-qa$/i.test(codeLower)) return R(6, 'Spam / Test', 9, 'high', 'Instant Voucher QA test code (Section 8.2).');
return R(5, 'Instant Voucher', 7, 'medium', 'Instant Voucher marketing code (Section 8.2).');
}
if (/social-meta-|pch\/pcp\/cs offers pages|fiat website|pop-in-overagestock|vx-raqhub/i.test(codeLower)) {
if (/motab/i.test(codeLower)) flagCtx.motab = true;
if (hasAmountField(text, 'Deposit') || hasAmountField(text, 'Term') || hasAmountField(text, 'Monthly Budget')) {
flagCtx.finance = true;
return R(4, 'Quote / Offer Request: Detailed', 3, 'medium', 'Social/Meta offer form with real terms (Section 8.2).');
}
return R(5, 'Quote / Offer Request: Blank', 4, 'medium', 'Social/Meta offer form, blank (Section 8.2).');
}
if (/concierge phone call|concierge follow up/i.test(codeLower)) return null; // treat as blank; classify by comment
if (/concierge 7 day unreached/i.test(codeLower)) {
if (!comments || comments === '-') return R(5, 'Enquiry: Blank', 9, 'medium', 'Concierge 7 Day Unreached, blank comment (Section 8.2, v1.9).');
return null;
}
if (/motability brand site/i.test(codeLower)) { flagCtx.motab = true; return R(3, 'Motability: Information Only', 6, 'high', 'Motability Brand Site marketing code (Section 8.2).'); }
if (/jeep website|alfa romeo - test drive|pop-in-test_drive_/i.test(codeLower)) {
return R(3, 'Test Drive Request (no date)', 2, 'high', 'Jeep/Alfa/blank test drive marketing code, real request (Section 8.2, v1.9).');
}
if (/brandsite-takata_recall_certificate/i.test(codeLower)) return R(6, 'Aftersales', 8, 'high', 'Takata recall certificate marketing code (Section 8.2).');
if (/brandsite-enquiry/i.test(codeLower)) return null; // classify by comment
if (/register interest|keep me informed/i.test(codeLower)) return R(5, 'Enquiry: Blank', 9, 'medium', 'Register Interest/Keep Me Informed marketing code (Section 8.2, v1.10).');
if (/Event-\S*TestDrive/i.test(text) && /\d{4}-\d{2}-\d{2}\s*(Slot\s*\d+|Morning|Afternoon|Evening)/i.test(text)) {
return R(2, 'Event Slot', 4, 'high', 'Event test drive slot template (Section 8.2).');
}
if (/event-motability-/i.test(codeLower)) { flagCtx.motab = true; return R(3, 'Motability: Information Only', 6, 'high', 'Event-Motability marketing code (Section 8.2).'); }
return null;
}

// Step 10: campaign rules (Section 8.3).
function campaignRules(text, lowered, camp, src, flagCtx) {
if (/reserve\s*-\s*(new|used)/i.test(camp)) {
if (hasDayMention(text) && hasClockTime(text)) return R(1, 'Reserve with Appointment', 5, 'high', 'Reserve campaign with day+time (Section 8.3).');
return R(3, 'Reserve Online', 3, 'medium', 'Reserve campaign (Section 8.3).');
}
// Leapmotor (ID only) - reaching here means nothing more specific
// (templates, marketing codes, day/time) already matched, so a
// Leapmotor-sourced lead with nothing else is the "ID only" case
// (Section 5, Tier 3 rank 4). Any real content on a Leapmotor lead
// is still classified normally by the earlier steps, per spec.
if (/leapmotor/i.test(src) || /leapmotor/i.test(camp)) {
return R(3, 'Leapmotor (ID only)', 4, 'high', 'Leapmotor source/brand, only a Lead ID (Section 5, Tier 3 rank 4).');
}
return null;
}

// Section 9.1: dedupe keys, computed per row from its own fields.
// null when no rule applies for that source - matches the spec's own
// acknowledged "known limit" that cross-channel dedupe can't be caught
// by text alone.
function computeDedupeKey(text, campaign, source) {
const leadId = field(text, 'Lead ID');
if (leadId) return 'leadid:' + leadId.toLowerCase();
const uniqueId = field(text, 'UniqueID');
if (uniqueId) return 'uniqueid:' + uniqueId.toLowerCase();
const arn = field(text, 'ARN');
if (arn) return 'arn:' + arn.toLowerCase();
const reservationMatch = text.match(/\/admin\/reservations\/(\d+)/i);
if (reservationMatch) return 'reservation:' + reservationMatch[1];
const vehicleUrlMatch = text.match(/Vehicle URL:\s*(\S+)/i);
if (vehicleUrlMatch) return 'vehicleurl:' + vehicleUrlMatch[1].toLowerCase();
if (source && low(source).includes('robins')) {
return 'rdtext:' + low(campaign) + '|' + low(text).replace(/\s+/g, ' ').trim();
}
if (source && low(source).startsWith('autotrader')) {
const msgMatch = text.match(/Message from Consumer at [^:]+:\s*([\s\S]*)$/i);
if (msgMatch) return 'autotrader:' + low(msgMatch[1]).replace(/\s+/g, ' ').trim();
}
return null;
}

// Section 9.1: dedupe pass over an already-classified batch. Dedupe
// keys for several source types depend on Initial Notes content, only
// available after each lead's live read, so this runs as a post-
// processing pass over results already produced by classifyLead, not
// a pre-filter that skips live reads. `getResult`/`getCreated`/
// `setDuplicate` are small accessors so this stays agnostic to
// whatever shape the caller's own row/result objects use.
function applyDedupe(rows, getResult, getCreatedMs, isPostClosure, setDuplicate) {
const byKey = new Map();
rows.forEach((row) => {
const result = getResult(row);
if (!result || !result.dedupeKey) return;
if (!byKey.has(result.dedupeKey)) byKey.set(result.dedupeKey, []);
byKey.get(result.dedupeKey).push(row);
});
byKey.forEach((group) => {
if (group.length < 2) return;
const sorted = [...group].sort((a, b) => (getCreatedMs(a) || 0) - (getCreatedMs(b) || 0));
let keeper = sorted.find((row) => !isPostClosure(row)) || sorted[0];
const keeperMs = getCreatedMs(keeper) || 0;
sorted.forEach((row) => {
if (row === keeper) return;
const ms = getCreatedMs(row) || 0;
if (Math.abs(ms - keeperMs) <= 24 * 60 * 60 * 1000) setDuplicate(row);
});
});
}

window.KonnectBookingCheck = window.KonnectBookingCheck || {};
window.KonnectBookingCheck.classifyLead = classifyLead;
window.KonnectBookingCheck.computeDedupeKey = computeDedupeKey;
window.KonnectBookingCheck.applyDedupe = applyDedupe;
window.KonnectBookingCheck.hasClockTime = hasClockTime;
window.KonnectBookingCheck.hasDayMention = hasDayMention;
window.KonnectBookingCheck.stripSystemSuffixes = stripSystemSuffixes;


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
// original scan's single test customer never happened to have. A third
// genuine prefix has since turned up, confirmed via live DOM
// inspection of a real customer timeline (not this file's own testing -
// a separate investigation into timeline entry structure surfaced it):
// a lead with no identifiable source is headed just "Source Unknown",
// not "New Sales Lead from...". That same investigation found the pink
// styling itself is nowhere near specific to leads either - on one real
// customer, 144 entries were pink, nearly all "Email sent"
// (rss icon) or "New Sales Event Opportunity Added" (ticket icon) - so
// this heading-prefix allowlist is still the only thing distinguishing
// a genuine lead entry from those, and may need widening again if a
// fourth genuine prefix turns up.
const LEAD_HEADING_PREFIXES = ['Manually Created Sales Lead from', 'New Sales Lead from', 'Source Unknown'];

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
// "Sat, 26 Sep 2026 17:48" - weekday+comma prefix, ignored (the
// with-year branch below is deliberately not anchored, so the regex
// just skips past it). Pending Customers' Last Actioned field (fed into
// this same column for the call-entry fallback above - see
// buildPendingBookingCheckTsv/findMatchingCallLeadId) follows a
// different, Konnect-wide convention instead - the same one
// parseTimelineTimestamp already handles for timeline entries
// themselves: no year shown at all for the current calendar year
// ("26 Sep 14:18", no weekday prefix either), only shown for older ones
// ("30 Jan 2025 12:26"). Without this second branch, every Pending
// Customers lead actioned this year - the common case - would silently
// fail to parse at all, before the call-entry match ever gets a chance
// to run. referenceDate supplies the implicit year for the shorter
// shape, exactly like parseTimelineTimestamp's own without-year branch -
// never assumed, taken from whatever "now" actually is at match time.
function parseSlaCreated(text, referenceDate) {
const cleaned = String(text || '').replace(/\s+/g, ' ').trim();

const withYear = cleaned.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
if (withYear) {
const month = parseNamedMonth(withYear[2]);
if (month === null) return null;
return { year: Number(withYear[3]), month, day: Number(withYear[1]), hour: Number(withYear[4]), minute: Number(withYear[5]) };
}

const withoutYear = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}):(\d{2})$/);
if (withoutYear) {
const month = parseNamedMonth(withoutYear[2]);
if (month === null) return null;
const ref = referenceDate || new Date();
return { year: ref.getFullYear(), month, day: Number(withoutYear[1]), hour: Number(withoutYear[3]), minute: Number(withoutYear[4]) };
}

// "Created Date" as exported by Konnect's own reporting tool (not the
// Manager/Live UI's own displayed format) - "YYYY-MM-DD HH:MM:SS" or
// "YYYY-MM-DDTHH:MM" (seconds ignored, matching only ever happens at
// minute precision anyway - see datetimesMatchAtMinute). Confirmed
// live from a real exported row: "2026-09-01 15:20:35".
const isoLike = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
if (isoLike) {
return { year: Number(isoLike[1]), month: Number(isoLike[2]) - 1, day: Number(isoLike[3]), hour: Number(isoLike[4]), minute: Number(isoLike[5]) };
}

return null;
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
const referenceNow = referenceDate || new Date();
const target = parseSlaCreated(targetCreatedText, referenceNow);
if (!target) return { target: null, candidates: [] };
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

// ===================================================================
// CALL-ENTRY FALLBACK - for Pending Customers leads specifically, which
// (unlike SLA rows) have no lead-creation timestamp to export at all
// (see SLA-Extract.js's own buildPendingBookingCheckTsv) and instead
// export their Last Actioned date/time, as shown on Konnect Manager's
// own Pending Customers table. That value is NOT an exact-minute match
// against the blue "call" entry (a.connected-customer-timeline-centre-lightblue
// > i.fa.fa-phone) on Konnect Live's own timeline for the same event -
// confirmed live via 14 real paired examples that Konnect Manager's
// displayed time runs AT OR AFTER Konnect Live's own timestamp for the
// same call, never earlier, by a variable amount (0 to 3 minutes
// observed, most commonly 1). That range rules out a simple rounding/
// truncation difference (which could only ever produce 0 or ±1 minute,
// never +2/+3) - this is a genuine processing/sync delay between the
// two systems, Manager apparently showing when IT recorded the update
// rather than when the call itself happened. So the match below is a
// bounded, one-directional window (see CALL_MATCH_TOLERANCE_MINUTES),
// not equality.
//
// Confirmed NOT reliable: matching by DOM order/proximity to the
// nearest pink entry. A real example had an unrelated second lead
// logged between a call and the lead it actually belonged to, which a
// "nearest entry" heuristic would have matched to the wrong lead - and
// blue rows never show a visible Lead ID the way pink rows do
// (extractVisibleLeadId's own selector is pink-only), so there's no
// DOM-visible link at all. The only reliable link confirmed live is
// Angular's own underlying scope data (angular.element(row).scope().item.LeadID) -
// a call entry carries the exact same LeadID as its corresponding
// lead's own pink row. Used here only to pick WHICH already-detected
// lead entry (getLoadedLeadEntries already reliably narrows to genuine
// leads via LEAD_HEADING_PREFIXES) a given call belongs to - not to
// detect lead-ness itself, since it's unconfirmed whether LeadID is
// exclusive to lead entries (an "Email sent" entry about the same lead
// might plausibly carry it too).
// ===================================================================

function getLoadedCallEntries() {
const icons = [...document.querySelectorAll('a.connected-customer-timeline-centre-lightblue > i.fa.fa-phone')];
return [...new Set(icons
.map((icon) => icon.closest('div.row.ng-scope[ng-repeat*="customerTimeLine"]'))
.filter(Boolean))];
}

function extractCallTimestamp(row) {
const heading = row.querySelector('.connected-customer-timeline-heading-left-lightblue, .connected-customer-timeline-heading-right-lightblue');
return heading ? heading.textContent.replace(/\s+/g, ' ').trim() : null;
}

// Confirmed live via a real DOM dump: a call entry's own text ("Amy
// Agent called the customer with an outcome of No Answer Message
// Left" / "Amy Agent Scheduled a call") lives in .connected-customer-
// title-lightblue - a different element from extractCallTimestamp's
// heading-lightblue (that one only holds the date/time). No Lead-ID-
// span contamination to strip here (unlike extractTimelineTimestamp's
// pink equivalent) - the only other child is an <img> badge with no
// text content of its own.
function extractCallHeadingText(row) {
const title = row.querySelector('.connected-customer-title-lightblue');
return title ? title.textContent.replace(/\s+/g, ' ').trim() : null;
}

// Post Closure Processing Step 13 (see classifyLead) - either of these
// two confirmed signals anywhere in the customer's currently-loaded
// timeline means the lead should be sent straight back through rather
// than worked again:
// - "Scheduled a call" - per a real reviewed example, one customer had
//   voicemail-only calls both before AND after this entry, and was
//   still confirmed as a "do not contact again" case; the entry itself
//   is the signal, regardless of what (if anything) happens around it.
// - "...with an outcome of Spoke To Customer" - a real reported case
//   was wrongly left classified by tier (WARM ENQUIRY) despite this
//   outcome appearing twice in the customer's own history, once with a
//   Face To Face appointment resulting from it - a genuine live
//   connection is exactly the "if we spoke to the customer... we do
//   not contact again" case from the original brief.
// Pure/testable half split out from the real DOM read below it, same
// pattern as the rest of this file's DOM-touching functions.
function anyCallEntryIndicatesAlreadyEngaged(callEntryRows) {
return callEntryRows.some((row) => {
const heading = extractCallHeadingText(row);
if (heading == null) return false;
return /\bscheduled a call\b/i.test(heading) || /\bspoke to customer\b/i.test(heading);
});
}

function hasAlreadyEngagedCallEntry() {
return anyCallEntryIndicatesAlreadyEngaged(getLoadedCallEntries());
}

// ===================================================================
// Self-test for the already-engaged detection - real row text pulled
// directly from a live DOM dump of three actual customers (one
// voicemail-only "needs contact" case, one with a "Scheduled a call"
// entry mixed in among voicemail-only calls on either side, and one
// with "Spoke To Customer" outcomes - a real reported case that had
// been wrongly left classified by tier (WARM ENQUIRY) instead).
// ===================================================================
(function alreadyEngagedDetectionSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}
function fakeCallRow(headingText) {
return { querySelector: (sel) => sel === '.connected-customer-title-lightblue' ? { textContent: headingText } : null };
}

check('extractCallHeadingText reads the real heading text, whitespace collapsed',
extractCallHeadingText(fakeCallRow('\n                            Charles Harvey called the customer with an outcome of No Answer Message Left\n                            ')),
'Charles Harvey called the customer with an outcome of No Answer Message Left');
check('extractCallHeadingText on a genuine Scheduled a call row',
extractCallHeadingText(fakeCallRow('\n                            Amanullah Mirlashari Scheduled a call\n                        ')),
'Amanullah Mirlashari Scheduled a call');
check('extractCallHeadingText returns null when the title element is missing', extractCallHeadingText({ querySelector: () => null }), null);

const voicemailOnlyRows = [
fakeCallRow('Charles Harvey called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Wajih Jamil called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Adam Ali called the customer with an outcome of No Answer Message Left')
];
check('Real "needs contact" example (Sylvia Lyddy) - voicemail only, no engagement signal', anyCallEntryIndicatesAlreadyEngaged(voicemailOnlyRows), false);

// Real "do not contact again" example (Kevin Hu) - voicemail calls both
// BEFORE and AFTER the Scheduled a call entry. The entry itself is what
// matters, not its position relative to the other calls.
const scheduledCallMixedIn = [
fakeCallRow('Darryl Nwafor called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Wajih Jamil called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Amanullah Mirlashari Scheduled a call'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left')
];
check('Real "do not contact again" example (Kevin Hu) - Scheduled a call mixed in among voicemail-only calls', anyCallEntryIndicatesAlreadyEngaged(scheduledCallMixedIn), true);

// Real "wrongly filtered as a warm lead" example - a genuine live
// connection ("Spoke To Customer") appears twice in this customer's
// history, once resulting in a Face To Face appointment, mixed among
// otherwise voicemail-only calls.
const spokeToCustomerMixedIn = [
fakeCallRow('Omari Duporte- Clarke called the customer with an outcome of No Answer Message Left'),
fakeCallRow('Jamario Belnavis called the customer with an outcome of Spoke To Customer'),
fakeCallRow('Henry Marnell called the customer with an outcome of Spoke To Customer'),
fakeCallRow('Lillian Ferrando Auberton called the customer with an outcome of No Answer No Message Left')
];
check('Real "wrongly filtered as a warm lead" example - Spoke To Customer is also an already-engaged signal', anyCallEntryIndicatesAlreadyEngaged(spokeToCustomerMixedIn), true);

check('Empty call history', anyCallEntryIndicatesAlreadyEngaged([]), false);

if (failures.length > 0) {
console.error('KonnectBookingCheck already-engaged-detection self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck already-engaged-detection self-test passed (8/8)');
}
})();

// Wrapped defensively, not assumed to always succeed - confirmed live
// that angular.element(row).scope().item carries LeadID, but there's no
// guarantee `angular` stays reachable as a global exactly where/when
// this runs every time, or that a row's own scope digest has settled
// the instant this reads it.
function readTimelineItemScope(row) {
try {
if (typeof angular === 'undefined') return null;
const scope = angular.element(row).scope();
return (scope && scope.item) || null;
} catch (error) {
return null;
}
}

// Deliberately as strict as findMatchingLeadCandidates itself about
// what counts as a match: exactly one call at the target minute, with
// a readable LeadID. Anything else (none found, more than one at the
// same minute, or a LeadID that couldn't be read) is reported back
// distinctly rather than guessed at - the caller turns each of these
// into its own specific exception code instead of collapsing them into
// one generic failure, the same "don't guess, tell me which specific
// thing didn't work" approach every other exception code in this file
// already follows.
// Generous but bounded on a small (14-example) sample, not a confirmed
// hard limit - real delays this sample didn't happen to capture could
// run longer. Deliberately erring toward "wide enough to actually catch
// real matches" over "tight enough to never need the ambiguity check" -
// widening this risks more AMBIGUOUS_CALL_MATCH results (safe: nothing
// gets guessed), not wrong matches, since every candidate found within
// the window still has to resolve to a lead before anything's trusted.
const CALL_MATCH_TOLERANCE_MINUTES = 5;

function minutesSinceEpoch(parsed) {
if (!parsed) return null;
return Math.floor(new Date(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute).getTime() / 60000);
}

// Window is one-directional (call at or BEFORE target, never after) and
// bounded to CALL_MATCH_TOLERANCE_MINUTES - matching the confirmed live
// direction and rough size of the Manager/Live delay, not a symmetric
// guess. Multiple calls can legitimately fall inside that window (the
// delay isn't exact, and a customer can have several close-together
// calls) - what actually matters is whether they agree on WHICH lead,
// not how many rows matched. Every candidate is resolved to its own
// LeadID independently; this only reports ambiguous if two candidates
// genuinely disagree on the lead, not merely because more than one
// timeline row fell in the window. A candidate whose scope couldn't be
// read is dropped rather than treated as a hard failure, as long as at
// least one other candidate in the window did resolve.
function findMatchingCallLeadId(targetCreatedText, referenceDate) {
const referenceNow = referenceDate || new Date();
const target = parseSlaCreated(targetCreatedText, referenceNow);
if (!target) return { target: null, status: 'NO_TARGET', leadId: null };
const targetMinutes = minutesSinceEpoch(target);

const withinWindow = getLoadedCallEntries()
.map((row) => {
const rawTimestamp = extractCallTimestamp(row);
const parsed = rawTimestamp ? parseTimelineTimestamp(rawTimestamp, referenceNow) : null;
return { row, parsed, minutes: minutesSinceEpoch(parsed), item: readTimelineItemScope(row) };
})
.filter((c) => c.minutes !== null && c.minutes <= targetMinutes && targetMinutes - c.minutes <= CALL_MATCH_TOLERANCE_MINUTES);

if (withinWindow.length === 0) return { target, status: 'NO_CALL_MATCH', leadId: null };

const resolvedLeadIds = withinWindow
.map((c) => (c.item && c.item.LeadID != null ? String(c.item.LeadID) : null))
.filter(Boolean);
if (resolvedLeadIds.length === 0) return { target, status: 'LEAD_ID_UNREADABLE', leadId: null };

const distinctLeadIds = [...new Set(resolvedLeadIds)];
if (distinctLeadIds.length > 1) return { target, status: 'AMBIGUOUS_CALL_MATCH', leadId: null };

return { target, status: 'OK', leadId: distinctLeadIds[0] };
}

// extractVisibleLeadId is the same DOM-visible field already confirmed
// and used (for audit/logging only, until now) on the pink side - no
// Angular scope reading needed here, unlike the call side, since pink
// rows do show this directly.
function findLeadEntryByLeadId(leadId) {
if (!leadId) return null;
return getLoadedLeadEntries().find((row) => extractVisibleLeadId(row) === leadId) || null;
}

// Bounded scroll-and-retry, mirroring processLeadRow's own existing
// loop for the direct pink-match path - a call from before the
// timeline's initial load window needs the same "load older entries
// and rescan" treatment a lead's own entry would.
async function findLeadCandidateViaCallFallback(targetCreatedText, session, referenceDate) {
const referenceNow = referenceDate || new Date();
let callMatch = findMatchingCallLeadId(targetCreatedText, referenceNow);
if (callMatch.status === 'NO_CALL_MATCH') {
for (let attempt = 0; attempt < 5; attempt++) {
if (isCancelled(session)) return { status: 'CANCELLED' };
const scrollResult = await loadOlderTimelineEntries();
if (scrollResult.status === 'TIMELINE_SCROLL_CONTAINER_UNKNOWN') break;
const rescan = findMatchingCallLeadId(targetCreatedText, referenceNow);
if (rescan.status !== 'NO_CALL_MATCH') { callMatch = rescan; break; }
if (!scrollResult.loadedNewEntries) break;
}
}
if (callMatch.status !== 'OK') return { status: callMatch.status };

const leadRow = findLeadEntryByLeadId(callMatch.leadId);
if (!leadRow) return { status: 'LEAD_ENTRY_NOT_FOUND_FOR_CALL' };

const rawTimestamp = extractTimelineTimestamp(leadRow);
const parsed = rawTimestamp ? parseTimelineTimestamp(rawTimestamp, referenceNow) : null;
return { status: 'OK', candidate: { row: leadRow, rawTimestamp, parsed, leadId: callMatch.leadId } };
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

// Created date/time remains the decisive key (already matched before a
// modal was ever opened, via findMatchingLeadCandidates or, for a
// Pending Customers lead, findLeadCandidateViaCallFallback) - this
// re-confirms it against the modal's own Date, then treats Source and
// Campaign as confirmation fields that can REJECT a clearly
// contradictory candidate but never redirect to a different lead.
// Registration is deliberately not checked here - confirmed absent
// from the inspected Initial Call panel, so it stays optional per
// instruction rather than required.
//
// Validates against the CANDIDATE's own already-parsed timestamp
// (candidateParsed), not slaRow.created re-parsed here - confirmed live
// as a real failure otherwise: for a direct match these are identical
// by construction (a candidate only exists because its own parsed
// timestamp already matched target, in findMatchingLeadCandidates), so
// this changes nothing for that path. For a call-fallback match they
// are NOT the same value - slaRow.created is the CALL's own timestamp
// (e.g. "26 Sep 14:18"), not the matched lead's (e.g. "26 Sep 13:05") -
// a live test found the correct lead and opened it, then rejected it
// here for comparing the modal's genuine date against the wrong target
// entirely. Comparing against the candidate's own confirmed timestamp
// is correct for both paths, not a special case for either.
function validateLeadCandidate(panelFields, candidateParsed, slaRow) {
const modalDateParsed = panelFields.date ? parseModalDate(panelFields.date) : null;
if (!datetimesMatchAtMinute(modalDateParsed, candidateParsed)) {
return { ok: false, reason: 'Modal Date does not match the candidate\'s own timeline minute.' };
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
window.KonnectBookingCheck.minutesSinceEpoch = minutesSinceEpoch;
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
// Pending Customers' Last Actioned field (fed into this same column for
// the call-entry fallback) omits the year for the current calendar
// year, the same convention timeline entries themselves use - without
// this branch, every such lead would fail to parse at all before ever
// reaching the call-entry match.
check('parseSlaCreated without year (Last Actioned format)', parseSlaCreated('26 Sep 14:18', now2026), { year: 2026, month: 8, day: 26, hour: 14, minute: 18 });
check('parseSlaCreated with year still wins even when a referenceDate is also given', parseSlaCreated('Sat, 26 Sep 2020 17:48', now2026), { year: 2020, month: 8, day: 26, hour: 17, minute: 48 });
// Real "Created Date" value from Konnect's own reporting export (not
// the Manager/Live UI's displayed format) - confirmed live.
check('parseSlaCreated accepts the reporting export\'s ISO-like format', parseSlaCreated('2026-09-01 15:20:35'), { year: 2026, month: 8, day: 1, hour: 15, minute: 20 });
check('parseSlaCreated accepts the same format with a T separator, no seconds', parseSlaCreated('2026-09-01T15:20'), { year: 2026, month: 8, day: 1, hour: 15, minute: 20 });
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

// Real paired examples (Konnect Manager's "Last Actioned" vs Konnect
// Live's own blue call timestamp for the same event, confirmed live) -
// locks in both the observed direction (Manager's time is always at or
// after Live's, never earlier) and that CALL_MATCH_TOLERANCE_MINUTES
// actually covers the full observed range (up to 3 minutes), not just
// the common 1-minute case.
const REAL_MANAGER_VS_LIVE_PAIRS = [
['Mon, 28 Sep 2026 09:06', '28 Sep 09:05'],
['Mon, 28 Sep 2026 09:10', '28 Sep 09:09'],
['Mon, 28 Sep 2026 09:10', '28 Sep 09:09'],
['Mon, 28 Sep 2026 09:13', '28 Sep 09:12'],
['Mon, 28 Sep 2026 09:27', '28 Sep 09:26'],
['Mon, 28 Sep 2026 09:38', '28 Sep 09:37'],
['Mon, 28 Sep 2026 09:45', '28 Sep 09:45'],
['Mon, 28 Sep 2026 09:48', '28 Sep 09:45'],
['Mon, 28 Sep 2026 09:50', '28 Sep 09:48'],
['Mon, 28 Sep 2026 09:51', '28 Sep 09:50'],
['Mon, 28 Sep 2026 09:55', '28 Sep 09:53'],
['Mon, 28 Sep 2026 11:04', '28 Sep 11:03'],
['Mon, 28 Sep 2026 10:06', '28 Sep 10:05'],
['Mon, 28 Sep 2026 10:11', '28 Sep 10:10']
];
REAL_MANAGER_VS_LIVE_PAIRS.forEach(([managerText, liveText], i) => {
const managerMinutes = minutesSinceEpoch(parseSlaCreated(managerText, now2026));
const liveMinutes = minutesSinceEpoch(parseTimelineTimestamp(liveText, now2026));
const diff = managerMinutes - liveMinutes;
check(`real pair ${i + 1}: Live is at or before Manager`, diff >= 0, true);
check(`real pair ${i + 1}: gap is within CALL_MATCH_TOLERANCE_MINUTES`, diff <= CALL_MATCH_TOLERANCE_MINUTES, true);
});

if (failures.length > 0) {
console.error('KonnectBookingCheck timeline self-test FAILED:\n' + failures.join('\n'));
} else {
console.info(`KonnectBookingCheck timeline self-test passed (${12 + REAL_MANAGER_VS_LIVE_PAIRS.length * 2}/${12 + REAL_MANAGER_VS_LIVE_PAIRS.length * 2})`);
}
})();


// ===================================================================
// Self-test against all 119 worked test cases from lead-classification-
// spec.md v1.10 Section 12 - the spec's own acceptance criteria for
// the classifier, run automatically on load so a regression here is
// loud immediately, not discovered later against real customer data.
// Only checks the resulting TIER (what Section 12's table itself
// gives) - sub-category/rank/flags are exercised structurally by the
// pipeline but the spec's own worked examples only commit to a tier
// number per case, so that's what's asserted here.
// ===================================================================
(function classifyLeadSelfTest() {
const cases = [
['T1', 'Preferred Date/Time: 2026-09-25, 9:00 AM', 'Sales Leads - Others', 'R&D Website', 1],
['T2', 'BrandSite-Test_Drive | First Appointment Date Desired: 25/09/2026 | Anytime between 1300 - 1600', 'Peugeot Enquiry New', 'CF', 1],
['T3', 'BrandSite-Test_Drive | Date: 28/09/2026 | Test drive e-5008 & e-4008/e-3008', 'Peugeot', 'CF', 2],
['T4', 'BrandSite-Test_Drive | Date: 29/09/2026 | Do you offer 24hour test drives ??', 'Peugeot', 'CF', 2],
['T5', 'BrandSite-Test_Drive | Date: 19/09/2026 | may be leasing one very soon... automatic', 'Vauxhall', 'CF', 2],
['T6', 'Booking date: 2026-10-11', 'Peugeot TD Request', 'R&D', 2],
['T7', 'Event-GrandePandaConquestTestDrive | 2026-09-05 Slot 1', 'Fiat TD Request', 'CF', 2],
['T8', 'BrandSite-Test_Drive | Customer Comments: -', 'Peugeot', 'CF', 3],
['T9', 'BrandSite-Test_Drive | Would like to test drive a 3008 hybrid, between 10am and 11am', 'Peugeot', 'CF', 3],
['T10', 'Fiat - Test Drive | First Desired Schedule: 00:00 | -', 'Fiat TD Request', 'CF', 5],
['T11', 'Pop-in-Test_Drive_New_Users | -', 'Abarth TD Request', 'CF', 5],
['T12', 'Social-Meta-Q3-600eCompProspect | https://fb.me/...', 'Abarth TD Request', 'CF', 5],
['T13', 'This vehicle has been reserved online...', 'Sales Leads - Others', 'R&D', 3],
["T14", "Message from Consumer at Thu, Sep 3, 2026 7:23 AM: Hi, I'm interested in this Fiat 600. Please could you contact me back.", 'Enquiry - Used', 'Autotrader - Deal Builder', 3],
['T15', 'Message from Consumer at Thu, Sep 3, 2026 7:23 AM: view and test drive the car on Tuesday morning', 'Enquiry - Used', 'Autotrader - Deal Builder', 2],
['T16', 'Vehicle URL: .../used-vehicles/.../kk25jgy | Customer comment:', 'Enquiry - Used', 'R&D - Online Store', 3],
['T17', 'Trim selected: GT Premium | Paint selected: Metallic cumulus grey', 'Peugeot Enquiry New', 'R&D', 4],
['T18', 'SOL-STOCK-INFO | VR3K... | Please email only... quote via email for BCH', 'Peugeot', 'CF', 4],
['T19', 'The customer is possibly interested in the following vehicle Fiat 600...', 'Fiat PX Valuation', 'R&D', 4],
['T20', 'Social-Meta-Q3-Vivaro-0Offer | My London Plumbers Ltd | Deposit £5,000 | Monthly Budget £250', 'Vauxhall Offer', 'CF', 4],
['T21', 'Comment Line #1: Source: Peugeot 208 Personal Contract Purchase Enquiry Form', 'Peugeot Enquiry New', 'R&D', 4],
['T22', 'CUSTOMER REQUIRES FURTHER COMMUNICATION - Please send walk around video... Quote - Conditional Sale', 'Peugeot Enquiry New', 'blank', 6],
['T23', 'Misc: ... FindOutMore = Test Drive | Purchase = Within 3 Months', 'Fiat Enquiry New', 'MB Mail', 5],
['T24', 'Misc: ... FindOutMore = Price List | Purchase = Just Browsing', 'Fiat', 'MB Mail', 5],
['T25', 'Notes Line #1: Customer is 6 months from renewal... End of Contract Date: 28/02/2027', 'Sales Leads - Others', 'Motability-Renewal', 5],
['T26', 'VX-BSTCOT-Part Exchange Tool | Equity: 18800 | PX Derivative: 1.5 TSI 150 R-Line', 'Vauxhall PX', 'CF', 5],
['T27', 'Part Exchange | Good: 4100, Average: 3525, Poor: 2975, Owned Vehicle Price: 3525', 'Fiat', 'CF', 5],
['T28', 'DS CERTIFIED-TRADE IN-ADS | ... Quotation showed : 1550 Sterling', 'Sales Leads - Others', 'CF', 5],
['T29', 'Misc: ... Desc1 = 208 GT 1.2L PureTech 130 S&S | UniqueID = d2y0rw', 'Peugeot', 'Autofunnel', 5],
['T30', 'Digital URL: ... booking_type: Waiter | visit_date_and_time: 09/09/2026 | sales_or_service: Sales', 'Sales Leads - Others', 'Service-Sales-Dealer-Sourced', 5],
['T31', '... finance ends in less than 12 months... Equity: £-187 and on a PCP... booking_type: Waiter', '', 'Service-Sales-Finance', 5],
['T32', 'Sourced from Robins & Day Website.', 'Enquiry New', 'R&D', 5],
['T33', '*** PRIORITY ACCEPTANCE REQUIRED *** ... Customer is booked in on 19/09 at 11:30 to test drive a new Peugeot e5008', 'any', 'any', 6],
['T34', '*** PRIORITY ACCEPTANCE REQUIRED *** ... booked in on 10/06 at 00:00 to test drive a [MAKE MODEL]', 'any', 'any', 6],
['T35', 'Contact Centre Sales Event Lead from Inbound Call', 'any', 'any', 6],
['T36', 'Peugeot 2008 GT new - TD', 'Peugeot Enquiry New', 'Phone call', 6],
["T37", "Ben is coming in tomorrow 12:00 - rather than 10:00 ... Please can Eniola Confirm", 'Peugeot Used', 'blank', 6],
["T38", "I booked a test drive for Tuesday at 9.30 am at Croydon but we've now found a car so I'd like to cancel", 'Peugeot General', 'R&D', 6],
['T39', 'BrandSite-Takata_Recall_Certificate | -', 'Vauxhall Enquiry New', 'CF', 6],
['T40', 'Annual Mileage: 7000 | Customer Number: 11201549', 'Peugeot', 'MB Mail', 6],
['T41', 'Comment Line #1: Free 5 Reviews | ... WhatsApp: +880...', 'Peugeot General', 'R&D', 6],
['T42', 'Misc: UniqueID = MB0005 | ...', 'Peugeot', 'Autofunnel', 6],
['T43', 'BrandSite-Test_Drive | Customer Comments: QWERTY', 'Vauxhall', 'CF', 6],
['T44', "Hi, my mum's motability car lease is up... come on Sunday 13th September 2026 at around 12 o'clock", 'Peugeot General', 'R&D', 1],
['T45', 'Would like to test drive a 2008 this coming Saturday.', 'Peugeot General', 'R&D', 2],
['T46', 'Dear Commercial/Fleet Sales Team, I am currently sourcing 11 brand new vans...', 'Peugeot General', 'R&D', 6],
['T47', 'I have an appointment for the event on Friday at 4:30pm. Unfortunately I am no longer able to attend. I will be in touch to set up an alternative time to visit.', 'Peugeot General', 'R&D', 3],
['T48', 'Hi, I met TJ yesterday and he was going to send over a quote for me to review, please can you send ASAP', 'Peugeot General', 'R&D', 6],
['T49', 'Hi iam requiring about changing my vehicle to reduce my payments... I have a Peugeot 2008 at the moment purchased from yourselves.', 'Peugeot General', 'R&D', 4],
["T50", "I am trying to get a settlement figure for my car... won't let me access my account", 'Peugeot General', 'R&D', 6],
['T51', 'Please CANCEL my order for the car B10', 'Peugeot General', 'R&D', 6],
["T52", "I would like to register an official complaint. As am still waiting for my £500 deposit...", 'Abarth General', 'R&D', 6],
['T53', 'Leapmotor source, Lead ID only', 'any', 'Leapmotor', 3],
['T54', 'Message from Consumer at Thu, Sep 3, 2026 7:23 AM: Is it possible to come and do a test drive today at 5pm?', 'Enquiry - Used', 'Autotrader - Deal Builder', 1],
['T55', 'Message from Consumer at Fri, Sep 11, 2026 8:55 AM: Can I come and see car tomorrow afternoon??', 'Enquiry - Used', 'Autotrader - Deal Builder', 2],
["T56", "Message from Consumer at Fri, Sep 11, 2026 8:55 AM: Hi, I'm interested in finance for this Vauxhall Grandland Electric. Please could you contact me back.", 'Enquiry - Used', 'Autotrader - Deal Builder', 3],
['T57', 'Sourced from Autotrader - Deal Builder.', 'Enquiry - Used', 'Autotrader - Deal Builder', 3],
['T58', 'Note:: This is an Auto Trader reservation.', 'Enquiry - Used', 'Autotrader - Deal Builder', 3],
['T59', 'Note:: This is an Auto Trader reservation. | Message from Consumer at Mon, Sep 28, 2026 9:00 AM: re telecom with Flynn today - please reserve subject to Saturday visit.', 'Enquiry - Used', 'Autotrader - Deal Builder', 6],
['T60', 'Note:: This is an Auto Trader reservation. | Message from Consumer at Mon, Sep 28, 2026 9:00 AM: As discussed by phone, Reservation made for viewing and test drive on Saturday 3rd October.', 'Enquiry - Used', 'Autotrader - Deal Builder', 6],
['T61', 'Message from Consumer at Mon, Sep 28, 2026 9:00 AM: Hi, I reserved this car just now but would love to cancel.', 'Enquiry - Used', 'Autotrader - Deal Builder', 6],
['T62', 'Message from Consumer at Mon, Sep 28, 2026 9:00 AM: Hi, I can offer £17000 for this vehicle. I do not have a px & am ready to purchase', 'Enquiry - Used', 'Autotrader - Deal Builder', 4],
["T63", "Message from customer: I?m interested in this 2023 Vauxhall Mokka and I?d like to know if it?s still available. (CarGurus IMV: £14,409 / Deal rating: Good Deal)", 'Enquiry - Used', 'Cargurus', 4],
['T64', "Message from customer: I?m interested in this 2025 Mazda MX-30... Are you able to transfer this to Brentford for me to test drive? (CarGurus IMV...)", 'Enquiry - Used', 'Cargurus', 3],
['T65', 'Transcript (may be truncated): visitor: Tomorrow 12pm visitor: Book appointment for viewing tomorrow', 'Enquiry - Used', 'Cargurus', 1],
["T66", "Vehicle notes: *£16,981* Reg: KJ19PSX | Message from customer: I would like to book a test drive for vehicle Audi Q2... | URL of vehicle of interest:", 'Enquiry - Used', 'AA Cars', 3],
['T67', 'Message from customer: Email Message: | No Message', 'Enquiry - Used', 'CarGeneralEmailDealer', 4],
["T68", "Message from customer: Email Message: | Hi seller. I'm interested can I come and test drive on Sunday morning at eleven thirty", 'Enquiry - Used', 'CarGeneralEmailDealer', 1],
["T69", "Lead ID: 00Qa1 | Marketing Code: SPOTICAR-TRADE IN-ADS | Quotation showed : 4450 Sterling, purchase : VO", 'Enquiry - Used', 'CF', 5],
["T70", "Lead ID: 00Qa1 | Marketing Code: SPOTICAR-TRADE IN-GENERIC | I can't find my version Quotation showed : 0, purchase : noProject", 'Enquiry - Used', 'CF', 5],
['T71', 'Customer was unable to generate a quote online and has requested a quote from the dealer: | Finance type: Personal Contract Purchase | Term: 36 months | Deposit: 2000 deposit | Mileage: 6000 miles per annum | Vehicle URL: https://example.com/used-vehicles/x', 'Offer Request - Used', 'R&D', 3],
['T72', 'Lead ID: 00Qa1 | Marketing Code: SP-SPOTICAR | Customer Comments: -', 'Offer Request - Used', 'CF', 3],
['T73', 'Lead ID: 00Qa1 | Marketing Code: SP-SPOTICAR | Customer Comments: I\'m interested in coming to see this car and test drive it on saturday around 1-2 pm', 'Offer Request - Used', 'CF', 1],
["T74", "Lead ID: 00Qa1 | Marketing Code: SP-SPOTICAR | Customer Comments: 208 tech edition in black... put a hold on it... birthday gift", 'Offer Request - Used', 'CF', 3],
["T75", "Lead ID: 00Qa1 | Marketing Code: SP-SPOTICAR | Customer Comments: Hi I would like to Purchase the Peugeot 308sw GT Electric... straight swap for my PX... No finance owned", 'Offer Request - Used', 'CF', 3],
['T76', 'Test Drive Request For Reg = wo23loa', 'Enquiry - Used', 'Live chat', 3],
['T77', 'Customer has requested a personalised video of the interior and full exterior of - bf16uew', 'Enquiry - Used', 'Live chat', 3],
['T78', 'Vehicle: PORSCHE 718 BOXSTER | Registration: XX | Sale or trade in: outright_sale', 'Enquiry - Used', 'Live chat', 5],
['T79', 'Please call customer back asap. | Customer said he wants to close a deal today... cash deal', 'Enquiry - Used', 'R&D', 6],
["T80", "Comment Line #1: I'd like to buy a used 7 seater car.", 'Enquiry - Used', 'R&D', 5],
["T81", "Comment Line #1: I'm looking for a 2008 GT Premium hybrid auto, 2025 onwards. Preferably black or obsession blue... What do you have?", 'Enquiry - Used', 'R&D', 4],
['T82', 'Comment Line #1: Hello Frankie... I may now be sorted for a vehicle, apologies for the mix up', 'Enquiry - Used', 'R&D', 6],
['T83', 'Comment Line #1: Could you please supply me with a copy remittances... Volkswagen Financial Services Ltd', 'Enquiry - Used', 'R&D', 6],
['T84', 'Comment Line #1: we hold a financial interest in this vehicle... require a payment of £19614.44... Sort Code...', 'Enquiry - Used', 'R&D', 6],
['T85', 'Comment Line #1: Cancel my viewing booked for Sunday the 13th at Stellantis walton at 12:30pm | I will be away', 'Enquiry - Used', 'R&D', 6],
['T86', 'Comment Line #1: I have an appointment at 2 with Laura which I need to cancel... I will call next week to rearrange.', 'Enquiry - Used', 'R&D', 3],
['T87', 'Comment Line #1: Hi Sean... appointment on Friday at 1.30pm... change my appointment to Sale?', 'Enquiry - Used', 'R&D', 1],
['T88', 'Comment Line #1: Vehicle URL: https://example.com/used-vehicles/x | Customer comment: I have a viewing booked for this car on Saturday at 1:30, I have asked if I could get some pictures/video', 'Enquiry - Used', 'R&D', 6],
['T89', 'Comment Line #1: Vehicle URL: https://example.com/used-vehicles/x | Customer comment: Corsa On PCP with yourselves... Settlement agreement figure is £9500... negative equity', 'Enquiry - Used', 'R&D', 4],
['T90', 'Comment Line #1: Vehicle URL: https://example.com/used-vehicles/seat-arona | Customer comment: Toyota Corolla... negative equity, my settlement is around £31,000...', 'Enquiry - Used', 'R&D', 3],
['T91', 'Comment Line #1: Hey im trying to get appointment too drop back my mobility car the lease ends 29th September', 'Enquiry - Used', 'R&D', 6],
['T92', '2nd September @ 11:00 but can no longer make that', 'Enquiry - Used', 'Phone call', 6],
['T93', 'The customer was on the following website page, before completing the valuation: https://www.stellantisandyou.co.uk/used-vehicles/x', 'PX Valuation - Used', 'R&D', 4],
['T94', 'Comment Line #1: I brought a car from Selly Oak... I want to terminate my agreement, I want my £1000 deposit refunded...', 'Enquiry - Used', 'R&D', 6],
['T95', 'The customer was on the following website page, before completing the valuation: https://www.stellantisandyou.co.uk/citroen?mh_matchtype=e', 'PX Valuation - Used', 'R&D', 5],
['T96', 'The customer was on the following website page, before completing the valuation: https://www.stellantisandyou.co.uk/used-vehicles', 'PX Valuation - Used', 'R&D', 5],
['T97', 'The customer was on the following website page, before completing the valuation: https://www.stellantisandyou.co.uk/car-valuation?utm_source=mbmail&utm_medium=email', 'PX Valuation - Used', 'R&D', 5],
['T98', 'The customer was on the following website page, before completing the valuation: https://www.stellantisandyou.co.uk/alfa-romeo-leicester?utm_source=google', 'PX Valuation - Used', 'R&D', 5],
['T99', 'Comment Line #1: Vehicle URL: https://example.com/used-vehicles/vauxhall-grandland-electric | Customer comment: Currently have PN23RBY... Owe just under £10900. Wanting a 4 year PCP, £0 deposit, 10k miles per year', 'Enquiry - Used', 'R&D', 3],
['T100', 'Customer interested in dealer transfer -to Bristol - is also interested in any negotiation on price - cash buyer', 'Enquiry - Used', 'blank', 6],
['T101', 'Comment Line #1: Vehicle URL: https://example.com/used-vehicles/peugeot-5008-km25eae | Customer comment: | Date/Time: Sat Sep 05 2026 3:00PM', 'Test Drive Request - Used', 'R&D', 1],
['T102', 'Comment Line #1: Vehicle URL: https://example.com/peugeot-2008-suv-12-puretech-allure | Customer comment: | Date/Time: Sun Sep 06 2026 11:00AM', 'Test Drive Request - Used', 'R&D', 1],
['T103', 'Lead ID: 00Qa1 | Marketing Code: Event-JuniorElettrica24HourTestDrive | Customer Comments: 2026-09-17 Morning', 'Alfa TD Request', 'CF', 2],
["T104", "Misc: ... FindOutMore = Price List,Test Drive | Purchase = Within 3 Months | PartExReg = Tina Test | PartExMileage = RETEST", 'Jeep Enquiry New', 'MB Mail', 6],
['T105', 'Lead ID: 00Qa1 | Marketing Code: Motability Brand Site | First Desired Schedule: 00:00 | Customer Comments: -', 'Jeep TD Request', 'CF', 3],
["T106", "Customer wants to purchase vehicle asap. | They have already test driven the vehicle already. | Warm transferred lead to site. | HOT LEAD", 'Leapmotor Enquiry New', 'R&D', 6],
['T107', 'cx is in the market and interested in attending between 10th - 13th --- requested call back at 16:30 with DP', 'Alfa Enquiry New', 'blank', 6],
['T108', 'Comment Line #1: Source: Motability Scheme - NIL Advance Payment Enquiry Form', 'Leapmotor Enquiry New', 'R&D', 3],
['T109', 'Comment Line #1: Source: Leapmotor B03X - Keep Me Informed', 'Leapmotor Register Interest', 'R&D', 5],
["T110", "Comment Line #1: Vehicle type: car. Fleet size: 2-49. Customer comments: I would like a contract hire quote for a Peugeot 308SW Allure", 'B2B', 'R&D', 6],
["T111", "I've booked a test drive next weekend but I need to cancel", 'Leapmotor General', 'R&D', 6],
["T112", "Hi, i am due to come in tomorrow to test drive the jeep avenger. Ive just realised ive something on. Can i reschedule please?", 'Jeep General', 'R&D', 2],
['T113', 'I attempted to book an appointment for Monday 21st around 5:30-6:00 pm but I missed the call...', 'Leapmotor General', 'R&D', 1],
["T114", "Requesting Return of the Leapmotor B10 (GJ26PLO) | Reasons for Requesting Return...", 'Leapmotor General', 'R&D', 6],
["T115", "I no longer wish to be contacted by yourselves in any way... appalling manner...", 'Alfa Romeo General', 'R&D', 6],
['T116', 'Subject: T Level Industry Placement Enquiry, 315 Hours...', 'Leapmotor General', 'R&D', 6],
['T117', 'Hello team. I am looking to join the motability scheme and weighing up mid size SUV options. Is there someone I can speak to about the Jeep Compass?', 'Jeep General', 'R&D', 3],
['T118', 'The customer was on the following website page, before completing the valuation: https://example.com/leapmotor/new/offers/c10-0-apr', 'Leapmotor P/X Valuation', 'R&D', 4],
['T119', 'The customer was on the following website page, before completing the valuation: https://example.com/leapmotor/new', 'Leapmotor P/X Valuation', 'R&D', 5]
];

const failures = [];
cases.forEach(([id, notes, campaign, source, expectedTier]) => {
const result = classifyLead(notes, { campaign, source, created: 'Sun, 27 Sep 2026 12:00' });
if (result.tier !== expectedTier) {
failures.push(`${id}: expected tier ${expectedTier}, got tier ${result.tier} (${result.subCategory}) - reason: ${result.reason}`);
}
});

if (failures.length > 0) {
console.error('KonnectBookingCheck classifyLead spec self-test FAILED:\n' + failures.join('\n'));
} else {
console.info(`KonnectBookingCheck classifyLead spec self-test passed (${cases.length}/${cases.length})`);
}
})();

// Section 9.1 dedupe - not covered by the spec's own tier-only test
// cases above, so exercised separately here against computeDedupeKey
// and the applyDedupe batch pass.
(function dedupeSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

check('computeDedupeKey: Lead ID wins', computeDedupeKey('Lead ID: 00Qa123 | Marketing Code: X', 'Camp', 'Src'), 'leadid:00qa123');
check('computeDedupeKey: no rule for this source/shape returns null', computeDedupeKey('Just some free text with nothing recognisable', 'Camp', 'Some Other Source'), null);

const ms = (day, h, m) => new Date(2026, 8, day, h, m).getTime();
const toMs = (r) => ms(r.day, r.h, r.m);
const rows = [
{ id: 'A', day: 27, h: 9, m: 0, result: { dedupeKey: 'leadid:x', source: 'Customer First', flags: [] } },
{ id: 'B', day: 27, h: 9, m: 30, result: { dedupeKey: 'leadid:x', source: 'Customer First', flags: [] } }, // duplicate of A, 30 min later
{ id: 'C', day: 27, h: 8, m: 0, result: { dedupeKey: 'leadid:x', source: 'Post Closure Processing', flags: [] } }, // earliest by time, but Post Closure - not the keeper
{ id: 'D', day: 27, h: 9, m: 0, result: { dedupeKey: 'leadid:y', source: 'Customer First', flags: [] } }, // different key, untouched
{ id: 'E', day: 27, h: 12, m: 0, result: { dedupeKey: 'leadid:z', source: 'Customer First', flags: [] } },
{ id: 'F', day: 28, h: 14, m: 1, result: { dedupeKey: 'leadid:z', source: 'Customer First', flags: [] } } // same key as E, but >24h later - not a duplicate
];
applyDedupe(
rows,
(r) => r.result,
toMs,
(r) => r.result.source === 'Post Closure Processing',
(r) => r.result.flags = [...r.result.flags, 'Duplicate']
);
const flagged = (id) => rows.find((r) => r.id === id).result.flags.includes('Duplicate');
check('Earliest non-Post-Closure copy (A) is kept, not flagged', flagged('A'), false);
check('Later copy of the same key (B) is flagged Duplicate', flagged('B'), true);
check('Post Closure copy (C) is flagged Duplicate even though it\'s earliest by time - never the keeper', flagged('C'), true);
check('Different dedupe key (D) is untouched', flagged('D'), false);
check('Same key but >24h apart (E) is not flagged - outside the dedupe window', flagged('E'), false);
check('Same key but >24h apart (F) is not flagged - outside the dedupe window', flagged('F'), false);

if (failures.length > 0) {
console.error('KonnectBookingCheck dedupe self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck dedupe self-test passed (8/8)');
}
})();

// Real leads caught via the Needs Review -> Copy review decisions ->
// feed back real examples workflow (Section 12's own worked cases
// don't cover either of these) - locked in as their own self-test the
// same way every other rule in this file originated from a real
// reported lead.
(function realReviewedLeadsSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

// A genuine CarGurus lead with a blank Source column - only the
// "(CarGurus IMV: ...)" signature in the notes themselves gives it
// away. Previously fell through to the 5.9 fallback entirely, since
// marketplaceTemplates' CarGurus branch only ever checked the Source
// field, and by the time it ran, stripSystemSuffixes had already
// removed the one piece of text that could have identified it.
const carGurusResult = classifyLead(
"Message from customer: I am interested in your 2026 Peugeot 3008 1.2 Hybrid 145 Gt Premium 5dr E-dsc6. You can reach me by email at brianandrewhough@gmail.com or phone at 07426 512197. Thank you! (CarGurus IMV: £28,354 / Deal rating: Fair Deal / Is from deliverable listing: No)",
{ campaign: 'Enquiry - Used', source: '' }
);
check('CarGurus lead with blank Source is now recognised as CarGurus (tier)', carGurusResult.tier, 4);
check('CarGurus lead with blank Source is now recognised as CarGurus (source inferred)', carGurusResult.source, 'Cargurus');

// Real quote terms phrased as prose on a Brand - General campaign
// ("classify by content" per Section 8.3) - previously missed because
// hasAmountField/hasFinanceWording only recognised the CF form's own
// Deposit:/Term:/Monthly Budget: field labels, not this phrasing.
const leaseResult = classifyLead(
'Comment Line #1: interested in lease deals cheapest the best please 2 year contract 8000 miles no arrangement fee and low penalty charge',
{ campaign: 'Peugeot - General', source: '' }
);
check('Lease-quote-terms prose on a General campaign lands in Tier 4 (was 5.9 fallback)', leaseResult.tier, 4);
check('Lease-quote-terms result is flagged Finance', leaseResult.flags.includes('Finance'), true);

if (failures.length > 0) {
console.error('KonnectBookingCheck real-reviewed-leads self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck real-reviewed-leads self-test passed (4/4)');
}
})();

// ===================================================================
// Self-test for classifyLead's Step 13 postClosureAction output - being
// carved out incrementally (per instruction) as each real criterion is
// confirmed. Scheduled-call is the first one; everything else still
// falls to the "check" bucket until dealer-contact/rejected signals are
// confirmed too.
// ===================================================================
(function postClosureActionSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}

const opts = { campaign: 'Citroen - Enquiry - New', source: 'Post Closure Processing', created: 'Sat, 26 Sep 2026 10:00' };
check('No engagement signal - falls to the "check" bucket', classifyLead('Customer Comments: -', { ...opts, hasAlreadyEngagedCallEntry: false }).postClosureAction, 'check: needs contact?');
check('hasAlreadyEngagedCallEntry omitted entirely - same "check" default', classifyLead('Customer Comments: -', opts).postClosureAction, 'check: needs contact?');
check('Engagement signal confirmed (Scheduled a call or Spoke To Customer) - sent straight back, not worked again', classifyLead('Customer Comments: -', { ...opts, hasAlreadyEngagedCallEntry: true }).postClosureAction, 'send back through');
check('Non-Post-Closure source - postClosureAction stays null regardless of the signal', classifyLead('Customer Comments: -', { campaign: 'Citroen - Enquiry - New', source: 'Customer First', hasAlreadyEngagedCallEntry: true }).postClosureAction, null);

if (failures.length > 0) {
console.error('KonnectBookingCheck postClosureAction self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck postClosureAction self-test passed (4/4)');
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

// Opt-in, not default - per instruction, starting a real batch of
// automated clicking/searching on Konnect Live should stay a deliberate
// choice unless the user has explicitly asked to skip that
// confirmation step.
const SETTINGS_STORAGE_KEY = 'konnectBookingCheck:settings:v1';

function loadSettings() {
try {
const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
if (raw && typeof raw === 'object') return { autoStart: !!raw.autoStart };
} catch (error) {
// ignore
}
return { autoStart: false };
}

function saveSettings(partial) {
try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...partial })); } catch (error) { /* ignore */ }
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

// Finds the earliest group, starting from fromIndex, that ISN'T fully
// resolved (every row in it already has a result) - i.e. the correct
// place to resume/retry from. Never treats a PARTIALLY resolved group
// as skippable (even one unresolved row leaves the whole group as the
// resume point, reprocessed in full including its already-resolved
// rows) - a customer's rows are searched/opened together in one pass,
// so there's no meaningful way to resume mid-group without redoing
// that shared search-and-open step anyway. Originally inline in
// newSession alone (run once, at session creation), factored out once
// retryExceptions needed the exact same logic applied mid-session too -
// see stepOnce's own comment on why a one-time skip isn't enough there.
function firstUnresolvedGroupIndex(groups, results, fromIndex) {
let groupIndex = fromIndex || 0;
while (groupIndex < groups.length && groups[groupIndex].rows.every((r) => results[r.inputIndex])) {
groupIndex++;
}
return groupIndex;
}

function makeResultBase(row) {
return {
inputIndex: row.inputIndex,
name: row.name, phone: row.phone, email: row.email,
source: row.source, campaign: row.campaign, created: row.created,
customerMatchMethod: null, timelineTimestamp: null, visibleLeadId: null,
modalDate: null, sourceValidation: null, campaignValidation: null,
initialNotes: null,
tier: null, tierName: null, subCategory: null, subRank: null,
flags: [], dedupeKey: null, postClosureAction: null,
reason: null, confidence: null,
warnings: [], status: 'PROCESSING', exception: null,
processingTimestamp: null
};
}

function finalizeResult(result, patch) {
return Object.assign({}, result, patch, { processingTimestamp: new Date().toISOString() });
}

// Identifies the same LEAD (not just the same customer - groupKey alone
// would conflate two different leads from one customer) across two
// separate pastes, so a genuinely-completed result can be carried over
// rather than reprocessed. campaign/source/created together are the
// same real-world fields Extract's own "Copy for Booking Check" export
// draws from a specific SLA row - two rows sharing all of these really
// are the same lead, not a coincidence.
function rowIdentityKey(row) {
return [row.groupKey, row.campaign, row.source, row.created].join('||');
}

// previousSession is optional - when given (the panel's own workflow:
// pasting a grown batch over a session already in progress, per
// instruction to improve this handoff so new leads streaming in don't
// force redoing already-completed work), any row in the new paste that
// exactly matches a row from the old one (see rowIdentityKey) carries
// its already-computed result over instead of being reprocessed from
// scratch. This is a pure starting-state computation - it does not
// change stepOnce/runLoop's own per-step behavior at all, which is
// deliberate: the live DOM automation those drive can't be verified
// without a live browser, so nothing about how a row actually gets
// processed changes here, only which rows still need to be.
function newSession(rawInput, previousSession) {
const parsed = parseBatchInput(rawInput);
const rows = parsed.rows;
const results = {};

const carriedResultsByIdentity = new Map();
if (previousSession) {
previousSession.rows.forEach((prevRow) => {
const prevResult = previousSession.results[prevRow.inputIndex];
if (prevResult) carriedResultsByIdentity.set(rowIdentityKey(prevRow), prevResult);
});
}

rows.forEach((row) => {
if (row.status === 'INVALID_INPUT') {
results[row.inputIndex] = finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: row.exception });
return;
}
const carried = carriedResultsByIdentity.get(rowIdentityKey(row));
if (carried) results[row.inputIndex] = carried;
});

const groups = buildProcessingGroups(rows);

// Skip past whole groups that are already fully resolved (every row
// in them has a carried-over result) - resuming from here behaves
// identically to having genuinely just finished processing them.
const groupIndex = firstUnresolvedGroupIndex(groups, results, 0);

return {
rawInput, headerOk: parsed.headerOk, headerError: parsed.error,
rows, groups, groupIndex, rowInGroupIndex: 0,
results, paused: false, cancelled: false,
done: !parsed.headerOk || groupIndex >= groups.length
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
// Direct match against row.created as a lead's own Created timestamp
// failed - try it as a Last Actioned value instead, matching a blue
// call entry first and following that call's own LeadID to its lead's
// pink entry (see the CALL-ENTRY FALLBACK section above). This is
// deliberately a fallback, not a separate up-front branch chosen by
// row type - SLA rows always match directly above and never reach
// here, so Booking Check never needs the batch input to declare in
// advance which kind of row it's looking at.
const callFallback = await findLeadCandidateViaCallFallback(row.created, session, referenceNow);
if (callFallback.status === 'CANCELLED') return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
if (callFallback.status === 'OK') {
workingCandidates = [callFallback.candidate];
} else if (callFallback.status !== 'NO_CALL_MATCH') {
// A call WAS found at the target minute, but something past that
// point didn't work out - reported as its own specific exception
// rather than falling through to the generic
// TARGET_CREATED_DATETIME_NOT_FOUND below, which would wrongly imply
// nothing matched the target time at all.
console.warn('[KonnectBookingCheck] Call-entry fallback did not resolve to a lead for row.created=', JSON.stringify(row.created), '- status:', callFallback.status);
return finalizeResult(result, { status: 'EXCEPTION', exception: `CALL_FALLBACK_${callFallback.status}` });
}
}

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
const validation = validateLeadCandidate(panelFields, candidate.parsed, row);
if (validation.ok) {
const initialNotes = extractInitialNotes(modalState.panel);
validated.push({ candidate, panelFields, initialNotes, warnings: validation.warnings || [] });
} else {
console.warn('[KonnectBookingCheck] validation rejected candidate:', validation.reason);
candidateFailures.push('LEAD_VALIDATION_FAILED');
// Both the candidate's own timestamp and the row's original Created/
// Last-Actioned value are shown, not just one - a call-fallback match
// legitimately has different values for each (the lead's own time vs
// the call's), and collapsing them to one label would hide exactly the
// distinction that matters when diagnosing a rejection.
candidateFailureDetails.push(`${validation.reason} (modal Date="${panelFields.date || ''}", candidate timeline entry="${candidate.rawTimestamp || ''}", modal Source="${panelFields.source || ''}", SLA/input Created="${row.created}", SLA Source="${row.source}")`);
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

// source falls back to the modal's own confirmed value (panelFields.source)
// when the batch didn't supply one - Pending Customers leads have no
// Source column at all to export (unlike SLA rows, which always do), so
// without this they'd default through the classifier with no source
// context at all. Safe for existing SLA rows: row.source is already
// reliable there, so this only ever changes behavior when it was
// otherwise going to classify against nothing. campaign deliberately
// does NOT get the same fallback - panelFields.campaign (extractCampaignField)
// is a completely different concept from row.campaign, not just a
// different format of the same value (see validateLeadCandidate's own
// comment on this) - falling back to it would feed the classifier the
// lead's marketing form name where it expects Konnect's SLA-queue
// categorization, a wrong value, not a missing one.
const resolvedSource = row.source || panelFields.source;
// Only scanned for Post Closure Processing rows - classifyLead's own
// Step 13 is the only place this matters, and getLoadedCallEntries
// scans the customer's whole currently-loaded timeline, no reason to
// pay for that on every other row.
const alreadyEngagedCallEntry = String(resolvedSource || '').toLowerCase() === 'post closure processing' ? hasAlreadyEngagedCallEntry() : false;
const classification = classifyLead(initialNotes, { campaign: row.campaign, source: resolvedSource, created: row.created, hasAlreadyEngagedCallEntry: alreadyEngagedCallEntry });
if (classification.confidence === 'low') {
// tier/subCategory/flags/reason/confidence are stored even though
// status stays EXCEPTION (never auto-trusted/applied) - so a human
// reviewing it in the Needs Review section, or anyone diagnosing it
// afterward, can see the classifier's own tentative reasoning without
// re-deriving it by hand.
return finalizeResult(result, {
status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', initialNotes,
tier: classification.tier, tierName: classification.tierName, subCategory: classification.subCategory, subRank: classification.subRank,
flags: classification.flags, dedupeKey: classification.dedupeKey, postClosureAction: classification.postClosureAction,
reason: classification.reason, confidence: classification.confidence, ...auditPatch
});
}

return finalizeResult(result, {
status: 'CLASSIFIED',
tier: classification.tier, tierName: classification.tierName, subCategory: classification.subCategory, subRank: classification.subRank,
flags: classification.flags, dedupeKey: classification.dedupeKey, postClosureAction: classification.postClosureAction,
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

// "Retry exceptions" - clears every EXCEPTION-status result except
// CLASSIFICATION_REVIEW_REQUIRED (not a failure at all - that's the
// Needs Review flow's own resolution path, not something to blindly
// reprocess) and rows whose own INPUT was INVALID_INPUT (excluded from
// processing groups entirely by buildProcessingGroups - clearing their
// result would leave them with none at all forever, since nothing in
// group-based processing ever revisits them). Everything else genuinely
// failed a live DOM step (timeout, page not finished loading, no match
// found) and, per instruction ("the page doesn't load the details
// straight away sometimes... no way of easily having the exceptions
// retried"), deserves a fresh attempt rather than staying stuck. Reuses
// newSession's own group-resume-skip logic (rewind groupIndex to the
// earliest group with any unresolved row) rather than a separate
// mechanism, since "some rows in an already-processed group need
// reprocessing" is exactly what that logic already handles correctly.
//
// Mutates session in place, deliberately NOT returning a new object the
// way newSession does - a PAUSED runLoop is still alive (its own while
// loop just idling on session.paused, see runLoop's own comment on
// that), holding its own reference to this exact session object.
// Reassigning the caller's `session` variable to a fresh object would
// silently orphan that still-running loop, which would keep polling
// the stale original forever and never see any of this. Mutating the
// shared object is what lets an already-paused run pick this up
// correctly the moment it's resumed.
function retryExceptions(session) {
session.rows.forEach((row) => {
if (row.status === 'INVALID_INPUT') return;
const result = session.results[row.inputIndex];
if (result && result.status === 'EXCEPTION' && result.exception !== 'CLASSIFICATION_REVIEW_REQUIRED') {
delete session.results[row.inputIndex];
}
});

const groupIndex = firstUnresolvedGroupIndex(session.groups, session.results, 0);

session.groupIndex = groupIndex;
session.rowInGroupIndex = 0;
session.cancelled = false;
session.done = groupIndex >= session.groups.length;
}

// Ephemeral, in-memory only (not persisted to session/localStorage) -
// purely a display aid so the status panel shows what just finished
// instead of only the current in-flight "Searching for X..." line,
// which changes too fast to read during a fast batch. Capped at 5;
// reset whenever a session is cleared, in the two btnClear/
// btnClearStop handlers.
let recentCompletions = [];
function recordResult(session, inputIndex, result) {
session.results[inputIndex] = result;
recentCompletions.unshift(result);
if (recentCompletions.length > 5) recentCompletions.length = 5;
}

// Advances exactly one input row (per instruction: "Process next must
// process exactly one row") - opening/searching for a new customer
// when needed counts as part of reaching that one row, not a separate
// step of its own.
async function stepOnce(session, uiHandle) {
if (session.done || session.cancelled) return false;
// Re-checked on EVERY call, not just once at session creation (that
// happens too, in newSession, via this exact same helper) - without
// this, retryExceptions rewinding groupIndex back to some EARLIER
// group (to reprocess a scattered exception) would then have
// advanceToNextGroup's own blind +1 sequential advance march forward
// through every group after it too, reprocessing already-good results
// all the way to the end of the batch instead of stopping once caught
// back up. Confirmed live: retrying reran the whole rest of the list,
// not just the exception.
session.groupIndex = firstUnresolvedGroupIndex(session.groups, session.results, session.groupIndex);
if (session.groupIndex >= session.groups.length) { session.done = true; return false; }

const group = session.groups[session.groupIndex];

if (session.rowInGroupIndex === 0) {
uiHandle.setState(`Searching for ${group.rows[0].name}...`, group.rows[0].name, null);
const openResult = await searchAndOpenCustomer(group, session);
if (openResult.status !== 'OK') {
group.rows.forEach((row) => {
recordResult(session, row.inputIndex, finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: openResult.exception }));
});
advanceToNextGroup(session);
saveSession(session);
return true;
}
if (openResult.noEligibleEvents) {
group.rows.forEach((row) => {
recordResult(session, row.inputIndex, finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: 'NO_ELIGIBLE_LEAD_EVENTS' }));
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
recordResult(session, row.inputIndex, result);

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
// Browsers throttle setTimeout-based waits heavily in a backgrounded
// tab - reported live as modals freezing and pages changing slower/
// failing to collect info while a different browser tab was active.
// Every DOM wait a step depends on (waitForModal, waitForTimelineReady,
// etc) is setTimeout/MutationObserver-based, so a throttled tab risks
// a wait timing out and misreading a lead as failed purely because of
// throttling, not a real automation problem. Pausing here - before
// starting a NEW step, same cooperative-checkpoint pattern as the
// session.paused check just above (there's no way to abort a step
// already in flight either way) - avoids compounding that risk for
// every lead not yet started, and resumes automatically the moment the
// tab is foregrounded again.
if (document.hidden) { uiHandle.setState('Paused - tab is in the background'); await sleep(200); continue; }
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

function retryableExceptionCount(s) {
if (!s) return 0;
return s.rows.filter((row) => {
if (row.status === 'INVALID_INPUT') return false;
const result = s.results[row.inputIndex];
return result && result.status === 'EXCEPTION' && result.exception !== 'CLASSIFICATION_REVIEW_REQUIRED';
}).length;
}

function hasRetryableExceptions(s) {
return retryableExceptionCount(s) > 0;
}

// The Booking Checker button row used to be one flat always-visible
// row of 7 buttons regardless of session state (confirmed live:
// nothing toggled .hidden/.disabled on any of them) - reported as "too
// many ambiguous buttons sandwiched together". Grouped into run
// controls / maintenance / handoff, each button now only shown when it
// would actually do something, so at most 2-4 are visible at once
// instead of a static 7. Pure function (no DOM) so it's directly
// self-testable against fabricated session states - syncButtonStates
// in the UI closure just applies its result to the real buttons,
// called from render(), which is already the universal redraw hook
// for every state-changing action.
function computeButtonVisibility(s, loopAlive) {
const hasSession = !!s;
// isRunning alone stays true for the whole time a run is paused too
// (runLoop just idles on its own poll, see runLoop's own comment) -
// "actively running" means mid-step-and-unpaused specifically.
const running = loopAlive && !(hasSession && s.paused);
const doneOrNoSession = !hasSession || s.done;
const hasResults = hasSession && orderedResults(s).some((r) => r.status === 'CLASSIFIED' || r.status === 'EXCEPTION');
const retryable = hasRetryableExceptions(s) && !running;
const start = !loopAlive && !(hasSession && s.done);
const pauseResume = loopAlive;
const processNext = !running && !doneOrNoSession;
const cancel = loopAlive;
return {
start,
pauseResume,
processNext,
cancel,
// The container is only ever empty (Done state) once none of its own
// buttons have anything to show - deriving it from them, rather than
// a separate ad-hoc condition, is what keeps Start visible on a fresh
// no-session page load instead of being hidden along with it.
runControls: start || pauseResume || processNext || cancel,
retryExceptions: retryable,
clear: hasSession,
maintenanceControls: retryable || hasSession,
copyRawForExtract: hasResults,
handoffControls: hasResults
};
}

// One color per tier (6, was 4 categories) - same palette family SLA-
// Extract.js's own bookingCheckImportCategoryColor uses, extended for
// the new tier count, so a lead reads the same color whichever tool
// it's looked at in.
const TIER_COLORS = { 1: '#059669', 2: '#d97706', 3: '#2563eb', 4: '#7c3aed', 5: '#64748b', 6: '#94a3b8' };

// Per instruction: for a Post Closure lead, the tier/sub-category the
// classifier would otherwise have landed on (WARM ENQUIRY, NURTURE,
// etc.) isn't the important part - most of the time it's just "didn't
// answer the phone" regardless of tier, and what actually matters is
// the Post Closure decision itself. Shared by categoryColor/categoryKey/
// categoryBadge and Extract's own postClosureActionColor (kept in
// lockstep the same way TIER_COLORS already is) so a lead reads the
// same way wherever it's looked at.
function postClosureColor(action) {
return action === 'send back through' ? '#0891b2' : '#d97706';
}

function categoryColor(r) {
if (!r) return '#1e293b';
if (r.exception) return '#dc2626';
if (r.postClosureAction) return postClosureColor(r.postClosureAction);
return TIER_COLORS[r.tier] || '#1e293b';
}

// Stable key for both the stats bar and the category filter - EXCEPTION
// rows have no tier at all yet (they have r.exception instead), so
// this gives them one consistent key rather than leaving them grouped
// under whatever raw exception code happens to be on each one.
// Post Closure leads get their own two keys, checked before tierName,
// for the same reason categoryBadge below leads with postClosureAction -
// tier isn't what should group/filter these.
function categoryKey(r) {
if (!r) return 'PENDING';
if (r.exception) return 'EXCEPTION';
if (r.postClosureAction) return r.postClosureAction === 'send back through' ? 'POST CLOSURE: SEND BACK' : 'POST CLOSURE: CHECK';
return r.tierName || 'PENDING';
}

// Split into a short primary pill + a separately-styled, muted
// secondary label instead of one long concatenated string ("WARM
// ENQUIRY - Quote / Offer Request: Detailed") - the single pill read
// as one dense block next to the customer name, hurting scannability
// in the collapsed summary row. For a Post Closure lead the primary
// pill is the Post Closure decision, not the tier (per instruction,
// that's the part that actually matters here) - tier/sub-category still
// shows, just demoted to the same secondary spot subCategory normally
// occupies.
function categoryBadge(r) {
const color = categoryColor(r);
if (r.exception) {
const icon = svgIcon('warning', 10, ' margin-right: 3px;');
return `<span class="category-badge" style="background: ${color}1a; color: ${color};">${icon}${escapeHtmlForUi(r.exception)}</span>`;
}
if (r.postClosureAction) {
const pcPill = `<span class="category-badge" style="background: ${color}1a; color: ${color};">${escapeHtmlForUi(r.postClosureAction)}</span>`;
const tierLabel = r.tierName ? `<span class="subcat-label" title="${escapeHtmlForUi(r.tierName)}">${escapeHtmlForUi(r.tierName)}</span>` : '';
return pcPill + tierLabel;
}
const tierPill = `<span class="category-badge" style="background: ${color}1a; color: ${color};">${escapeHtmlForUi(r.tierName || 'Pending')}</span>`;
const subcat = r.subCategory ? `<span class="subcat-label" title="${escapeHtmlForUi(r.subCategory)}">${escapeHtmlForUi(r.subCategory)}</span>` : '';
return tierPill + subcat;
}

// curState only ever gets a real value from uiHandle.setState, which is
// called mid-step ("Searching for X...", "Reading lead at Y...") and at
// the end of a run (Done/Paused/Cancelled) - but render() itself never
// touched it, so reopening the panel on a restored session (e.g. after
// a page reload) left it stuck on its hardcoded HTML placeholder
// ("Idle") forever, even for a session that was actually fully done or
// mid-retry - confirmed live: a 42/42-resolved session still showed
// "State: Idle" until something was clicked. Returns null specifically
// while actively stepping (isRunning && not paused), since a live
// setState call already owns the label in that state and this must not
// stomp it with a generic one between steps.
function deriveRestStateLabel(s, loopAlive) {
if (!s) return 'Idle';
if (loopAlive && !s.paused) return null;
if (s.paused) return 'Paused';
if (s.cancelled) return 'Cancelled';
if (s.done) return 'Done';
return 'Idle';
}

// Section 2's own sort order: tier ASC, then subRank ASC, then (for
// Tier 1-2) appointment date ASC, then lead received time ASC. The
// single-number PriorityRank (tier*100 + subRank) carries the primary
// two keys directly - it's what gets exported to Extract, which sorts
// on it as a plain number (see classifyBookingCheckImportRows there).
// The appointment-date tie-break isn't implemented (would need a real
// date VALUE extracted from free text, not just the yes/no hasDayMention/
// hasClockTime checks the classifier itself uses) - a known
// simplification, not a silent gap: same-tier/same-subRank leads fall
// straight to the `created` (received time) tie-break below instead,
// which is the spec's own final tie-break anyway.
function bookingPriorityRankValue(result) {
if (!result || result.status !== 'CLASSIFIED') return 700;
const tier = result.tier || 6;
const subRank = result.subRank != null ? result.subRank : 99;
return tier * 100 + subRank;
}

// Full comparator (used for the panel's own within-tier ordering,
// where real result objects - not just the flattened export number -
// are available to tie-break on `created`).
function compareByBookingPriority(a, b) {
const diff = bookingPriorityRankValue(a) - bookingPriorityRankValue(b);
if (diff !== 0) return diff;
const createdA = a.parsedCreated || parseSlaCreated(a.created);
const createdB = b.parsedCreated || parseSlaCreated(b.created);
if (createdA && createdB) {
const ms = (p) => new Date(p.year, p.month, p.day, p.hour, p.minute).getTime();
return ms(createdA) - ms(createdB);
}
return 0;
}

// ===================================================================
// NEEDS REVIEW - manual triage for low-confidence classifications
// (classifyLead's own confidence:'low' already refuses to guess rather
// than risk a wrong auto-classification - see its own fallback step -
// and processLeadRow turns that into this one specific EXCEPTION
// rather than genuinely failing, since the Initial Notes WERE read
// successfully; there's just no confident rule for them yet). An
// easier way to confirm, across many leads at once, which of the 6
// tiers one of these should actually go into, with a free-text sub-
// category/reason - captured specifically so those decisions can be
// handed back as real examples to extend classifyLead's own rules
// with, the same way every rule in this file originated from a real
// reported lead.
// ===================================================================

// 6 tiers (was 4 fixed categories) - matches lead-classification-
// spec.md v1.10's own tier names, in tier order.
const REVIEW_TIER_OPTIONS = [1, 2, 3, 4, 5, 6];

// !r.postClosureAction - a Post Closure lead's underlying tier
// classification can still land on CLASSIFICATION_REVIEW_REQUIRED (low
// confidence), but per instruction that tier isn't what matters for
// these leads at all - pulling them into Needs Review to manually pick
// a tier would bury the actual, more confident Post Closure decision
// they already have. These always go to their own Post Closure section
// in the tier list instead (see render()'s virtual -2/-1 tier keys).
function isNeedsReview(r) {
return !!(r && r.status === 'EXCEPTION' && r.exception === 'CLASSIFICATION_REVIEW_REQUIRED' && !r.postClosureAction);
}

// Pure - takes the existing result and returns the patched one, same
// finalizeResult shape processLeadRow itself produces, so a manually-
// confirmed row is indistinguishable downstream (tier grouping, the
// Extract handoff, priority sort) from one the classifier was simply
// confident about. confidence:'manual' and manualOverride:true are
// the only markers distinguishing it, kept for the review-decisions
// export below - nothing else reads them. subCategory is a free-text
// field (not a picker) - the spec has dozens of sub-categories per
// tier, too many for a fixed button set, so a manual reviewer just
// names it themselves; subRank defaults to the bottom of the tier
// (highest number = least urgent within it) since a manually-picked
// tier has no real sub-rank of its own.
function applyManualReviewDecision(result, tier, subCategoryText, note) {
return finalizeResult(result, {
status: 'CLASSIFIED',
tier, tierName: TIER_NAMES[tier] || null,
subCategory: subCategoryText || '(manually reviewed)',
subRank: 99,
reason: note ? `Manually confirmed - ${note}` : 'Manually confirmed (no reason given).',
confidence: 'manual',
manualOverride: true,
manualNote: note || '',
exception: null
});
}

// No name/phone/email - deliberately just the content that's actually
// useful for extending the classifier's rules (the real notes text,
// what a human decided it meant, and the campaign/source context those
// rules dispatch on), not the customer's personal details, which have
// no bearing on what a future rule should match against.
function buildManualReviewDecisionsExport(session) {
const rows = orderedResults(session).filter((r) => r.manualOverride);
const header = ['InitialNotes', 'Tier', 'TierName', 'SubCategory', 'Reason', 'Campaign', 'Source'].join('\t');
const lines = rows.map((r) => [
(r.initialNotes || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
String(r.tier || ''), r.tierName || '', r.subCategory || '',
(r.manualNote || '').replace(/\t/g, ' '),
r.campaign || '', r.source || ''
].join('\t'));
return [header, ...lines].join('\n');
}

// Feeds the reverse handoff into SLA-Extract.js. Used to hand back only
// the raw fields and let Extract re-classify from a second, separately-
// maintained copy of this exact classifier - a real drift risk that
// already happened (that copy never got this file's later dual-raw-
// notes-format parser fix before it was deleted in favor of trusting
// this export directly). Now exports the already-computed Tier/
// SubCategory/Flags/PriorityRank too, so Extract just uses them - one
// classifier, not two that can quietly disagree on the same lead. Kept
// in lockstep with SLA-Extract.js's own BOOKING_CHECK_IMPORT_HEADER -
// changing this header without changing that one breaks the handoff.
function buildRawNotesTsvForExtract(session) {
const header = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes', 'Tier', 'TierName', 'SubCategory', 'SubRank', 'Flags', 'Confidence', 'Reason', 'DedupeKey', 'PostClosureAction', 'PriorityRank'];
const lines = orderedResults(session).map((r) => [
r.name, r.phone, r.email, r.source, r.campaign, r.created,
(r.initialNotes || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
String(r.tier || ''), r.tierName || '', r.subCategory || '', String(r.subRank != null ? r.subRank : ''),
(r.flags || []).join(', '),
r.confidence || '',
(r.reason || r.exception || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
r.dedupeKey || '', r.postClosureAction || '',
String(bookingPriorityRankValue(r))
].join('\t'));
return [header.join('\t'), ...lines].join('\n');
}

// ===================================================================
// BULK PATTERN-ANALYSIS EXPORT (temporary) - not part of the actual
// classifier pipeline. Per instruction that the rule system currently
// feels "too rigid" (fixed rules dispatching to 4 fixed categories),
// this hands every processed lead's classification-relevant fields to
// a *separate* Claude chat so the user can ask it to look for
// recurring templates (e.g. PX leads that always read the same way)
// across a much larger batch than could be eyeballed by hand, then
// decide from that analysis whether new categories/filters are
// warranted. It does not feed back into this file automatically -
// same "real reported lead" discipline as REVIEW_DECISIONS above, just
// upstream of a rule existing yet. No name/phone/email, for the same
// reason as that export: none of it bears on classification.
function buildBulkAnalysisExport(session) {
// initialNotes presence, not status - a genuine automation failure
// (e.g. SEARCH_NO_RESULTS) never got as far as reading the notes, so
// it has nothing to contribute to pattern-finding and would just be a
// blank-text row; CLASSIFIED and CLASSIFICATION_REVIEW_REQUIRED rows
// both have notes regardless of which way they ended up.
const rows = orderedResults(session).filter((r) => r.initialNotes);
const header = ['InitialNotes', 'Tier', 'TierName', 'SubCategory', 'Flags', 'Confidence', 'Reason', 'Campaign', 'Source'].join('\t');
const lines = rows.map((r) => [
(r.initialNotes || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
String(r.tier || ''), r.tierName || '', r.subCategory || '',
(r.flags || []).join(', '),
r.confidence || '',
(r.reason || r.exception || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
r.campaign || '', r.source || ''
].join('\t'));
return [header, ...lines].join('\n');
}

// Sent alongside buildBulkAnalysisExport's data so the other Claude
// chat knows what it's looking at and what kind of answer is useful,
// without the user having to re-explain the whole system from scratch
// each time they run this.
const BULK_ANALYSIS_PROMPT = `I'm analysing a batch of car-dealership leads that have already been auto-classified by a rules-based system (lead-classification-spec.md v1.10) into one of 6 priority tiers, each with its own sub-categories, based on their "Initial Notes" text (what the customer wrote/said) plus Campaign/Source context:
1. CONFIRMED DATE & TIME - customer gave a specific day AND a clock time
2. DATE ONLY - a specific day, no clock time
3. LIKELY BOOKING - clear intent to visit/test drive/buy a specific car, no day given
4. WARM ENQUIRY - interested but needs further conversation
5. NURTURE - callable, but may not be interested at all (plain valuations, blank forms, etc.)
6. REDIRECT / NO CALL - not a call for this pipeline (already booked, already handled, dealer relationship, fleet, aftersales, complaints, spam)

Confidence is "high"/"medium"/"low" - "low" means the existing rules didn't confidently match and a human had to decide manually.

The data below is tab-separated: InitialNotes | Tier | TierName | SubCategory | Flags | Confidence | Reason | Campaign | Source.

What I want from you:
1. Group leads that share a recognisable "template" - i.e. Initial Notes text (or Campaign/Source combos) that reliably means the same thing every time, especially ones marked "low" confidence, or where the sub-category reads too broad for what's actually happening.
2. For each group you find, show 2-3 representative examples and describe the pattern in plain terms.
3. Suggest whether it deserves its own new sub-category/rule, or a refinement of an existing one - and if so, propose a name, which tier it belongs under, and a short description of what should trigger it.
4. Flag anything that looks miscategorised, even if it's a one-off, so I can decide whether it's worth a rule.

Don't invent categories that only fit one example - I want genuine recurring templates, backed by the examples in this data.

Here's the data:
`;

function buildBulkAnalysisClipboardPayload(session) {
return BULK_ANALYSIS_PROMPT + '\n' + buildBulkAnalysisExport(session);
}

window.KonnectBookingCheck.buildBulkAnalysisExport = buildBulkAnalysisExport;
window.KonnectBookingCheck.buildBulkAnalysisClipboardPayload = buildBulkAnalysisClipboardPayload;

window.KonnectBookingCheck.buildProcessingGroups = buildProcessingGroups;
window.KonnectBookingCheck.firstUnresolvedGroupIndex = firstUnresolvedGroupIndex;
window.KonnectBookingCheck.newSession = newSession;
window.KonnectBookingCheck.retryExceptions = retryExceptions;
window.KonnectBookingCheck.rowIdentityKey = rowIdentityKey;
window.KonnectBookingCheck.isNeedsReview = isNeedsReview;
window.KonnectBookingCheck.applyManualReviewDecision = applyManualReviewDecision;
window.KonnectBookingCheck.buildManualReviewDecisionsExport = buildManualReviewDecisionsExport;
window.KonnectBookingCheck.stepOnce = stepOnce;
window.KonnectBookingCheck.runLoop = runLoop;
window.KonnectBookingCheck.orderedResults = orderedResults;
window.KonnectBookingCheck.bookingPriorityRankValue = bookingPriorityRankValue;
window.KonnectBookingCheck.compareByBookingPriority = compareByBookingPriority;
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
0: { name: 'Alice', phone: '', email: 'alice@example.com', tier: 2, tierName: 'DATE ONLY', subCategory: 'Customer-Stated Day', subRank: 3, flags: [], status: 'CLASSIFIED', created: 'Sat, 26 Sep 2026 18:05' },
1: { name: 'Alice Again', phone: '', email: 'alice@example.com', tier: 1, tierName: 'CONFIRMED DATE & TIME', subCategory: 'Customer-Stated Slot', subRank: 3, flags: ['PX'], status: 'CLASSIFIED', created: 'Sat, 26 Sep 2026 19:05' },
2: { name: 'Bob', phone: '07000000000', email: '', tier: 5, tierName: 'NURTURE', subCategory: 'Enquiry: Blank', subRank: 9, flags: [], status: 'CLASSIFIED', created: 'Sat, 26 Sep 2026 20:05' }
}
};

// Tier ASC then subRank ASC (Section 2's own sort order).
check('rank: Tier 1 beats Tier 2', bookingPriorityRankValue(fakeSession.results[1]) < bookingPriorityRankValue(fakeSession.results[0]), true);
check('rank: Tier 2 beats Tier 5', bookingPriorityRankValue(fakeSession.results[0]) < bookingPriorityRankValue(fakeSession.results[2]), true);
check('rank: lower subRank beats higher subRank within the same tier',
bookingPriorityRankValue({ status: 'CLASSIFIED', tier: 3, subRank: 1 }) < bookingPriorityRankValue({ status: 'CLASSIFIED', tier: 3, subRank: 9 }),
true);
check('rank: unclassified/exception rows (no tier at all) sink to the bottom',
bookingPriorityRankValue({ status: 'EXCEPTION', tier: null }) > bookingPriorityRankValue(fakeSession.results[2]),
true);
check('compareByBookingPriority ties on tier+subRank by received time (created) ascending',
compareByBookingPriority(
{ status: 'CLASSIFIED', tier: 3, subRank: 5, created: 'Sat, 26 Sep 2026 20:00' },
{ status: 'CLASSIFIED', tier: 3, subRank: 5, created: 'Sat, 26 Sep 2026 19:00' }
) > 0,
true);

// The exact contract SLA-Extract.js's "Classify Booking Check
// results" panel parses (BOOKING_CHECK_IMPORT_HEADER there) - pinned
// down explicitly since the two files can't share a module and would
// otherwise only find out they'd drifted apart by failing silently on
// a real paste. Extract now trusts these columns directly instead of
// re-classifying (see its own booking-check-import self-test), so this
// check also confirms the actual computed tier/subCategory/rank land
// in the right columns, not just that the header row's shape is right.
const rawExtractTsv = buildRawNotesTsvForExtract(fakeSession);
const rawExtractLines = rawExtractTsv.split('\n');
check('raw Extract export header shape', rawExtractLines[0], 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\tInitialNotes\tTier\tTierName\tSubCategory\tSubRank\tFlags\tConfidence\tReason\tDedupeKey\tPostClosureAction\tPriorityRank');
const aliceAgainCells = rawExtractLines[2].split('\t');
check('raw Extract export: TierName column carries the computed tier name', aliceAgainCells[8], 'CONFIRMED DATE & TIME');
check('raw Extract export: Flags column carries the computed flags', aliceAgainCells[11], 'PX');
check('raw Extract export: PriorityRank column carries a real numeric rank', aliceAgainCells[16], String(bookingPriorityRankValue(fakeSession.results[1])));

if (failures.length > 0) {
console.error('KonnectBookingCheck orchestration self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck orchestration self-test passed (10/10)');
}
})();

(function retryExceptionsSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const batch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Alice\t\talice@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
'Bob\t07000000000\t\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 19:05',
'Carol\t\tcarol@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 20:05',
'Dee\t\t\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 21:05'
].join('\n');
const parsed = parseBatchInput(batch);
const groups = buildProcessingGroups(parsed.rows);
check('Dee (no phone/email) is excluded from processing groups', groups.length, 3);

const originalAlice = { name: 'Alice', status: 'CLASSIFIED', tier: 2, tierName: 'DATE ONLY' };
const originalCarol = { name: 'Carol', status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED' };
const originalDee = { name: 'Dee', status: 'EXCEPTION', exception: 'NO_SEARCH_IDENTIFIER' };
const fakeSession = {
rows: parsed.rows,
groups,
// isRunning-but-paused is the real scenario this has to work
// correctly under (a live runLoop idling on session.paused, still
// holding this exact object) - included here so mutating in place,
// not returning a new object, is actually exercised.
groupIndex: 3, done: true, cancelled: false, paused: true,
results: {
0: originalAlice,
1: { name: 'Bob', status: 'EXCEPTION', exception: 'TIMELINE_TIMEOUT' },
2: originalCarol,
3: originalDee
}
};

retryExceptions(fakeSession);
check('A genuine processing failure (Bob) is cleared for retry', fakeSession.results[1], undefined);
check('An already-classified row (Alice) is left untouched', fakeSession.results[0], originalAlice);
check('CLASSIFICATION_REVIEW_REQUIRED (Carol) is NOT retried - not a failure, has its own resolution flow', fakeSession.results[2], originalCarol);
check('INVALID_INPUT (Dee) is left untouched - excluded from groups entirely, retrying would strand it with no result', fakeSession.results[3], originalDee);
check('groupIndex rewinds to the earliest group with a cleared result (Bob\'s, index 1)', fakeSession.groupIndex, 1);
check('rowInGroupIndex resets', fakeSession.rowInGroupIndex, 0);
check('done recalculated as false - there is work left', fakeSession.done, false);
check('cancelled reset to false', fakeSession.cancelled, false);
check('paused is left alone - retrying doesn\'t itself resume a paused run', fakeSession.paused, true);

// The actual bug reported live: retrying didn't just rerun the
// exception, it reran the rest of the whole list. Root cause was
// stepOnce only ever skipping resolved groups ONCE, at session
// creation - after retryExceptions rewinds groupIndex back to Bob's
// group (index 1), advanceToNextGroup's own blind +1 would move on to
// Carol's group (index 2) next and stepOnce would reprocess it too,
// even though results[2] (Carol) was never cleared and is still
// perfectly valid. Simulates exactly what stepOnce now does on every
// call: Bob's group just got a fresh result (as if reprocessing it
// succeeded), then re-checks from where advanceToNextGroup would have
// landed (index 2) - it must recognize Carol's group is ALREADY
// resolved and skip straight past it to the end, not reprocess it.
fakeSession.results[1] = { name: 'Bob', status: 'CLASSIFIED', tier: 4, tierName: 'WARM ENQUIRY' };
const nextIndex = firstUnresolvedGroupIndex(fakeSession.groups, fakeSession.results, 2);
check('Already-resolved Carol\'s group (index 2) is skipped, not reprocessed, once Bob\'s retry is done', nextIndex, 3);

if (failures.length > 0) {
console.error('KonnectBookingCheck retryExceptions self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck retryExceptions self-test passed (10/10)');
}
})();

// ===================================================================
// Self-test for computeButtonVisibility - the button row used to be
// one flat always-visible row of 7 regardless of state; this locks in
// which of them should actually be shown for each real session state
// (no session, running, paused with/without retryable exceptions,
// done) without needing a real DOM.
// ===================================================================
(function buttonVisibilitySelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const noSessionResult = computeButtonVisibility(null, false);
check('No session: only Start is visible', noSessionResult, {
start: true, pauseResume: false, processNext: false, cancel: false, runControls: true,
retryExceptions: false, clear: false, maintenanceControls: false,
copyRawForExtract: false, handoffControls: false
});

const freshSession = { rows: [{ inputIndex: 0, status: 'OK' }], results: {}, done: false, paused: false };
check('Fresh unstarted session: Start + Process next (single-stepping without ever clicking Start is a real, already-supported action) + Clear', computeButtonVisibility(freshSession, false), {
start: true, pauseResume: false, processNext: true, cancel: false, runControls: true,
retryExceptions: false, clear: true, maintenanceControls: true,
copyRawForExtract: false, handoffControls: false
});

const runningSession = { rows: [{ inputIndex: 0, status: 'OK' }], results: {}, done: false, paused: false };
check('Actively running: Pause + Cancel only (no Start, no Process next)', computeButtonVisibility(runningSession, true), {
start: false, pauseResume: true, processNext: false, cancel: true, runControls: true,
retryExceptions: false, clear: true, maintenanceControls: true,
copyRawForExtract: false, handoffControls: false
});

const pausedWithException = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'EXCEPTION', exception: 'SEARCH_NO_RESULTS' } },
done: false, paused: true
};
check('Paused with a retryable exception: Resume + Process next + Cancel + Retry exceptions + Clear - Copy raw for Extract also shows since an exception is still a processed result (exported with its exception as the reason)', computeButtonVisibility(pausedWithException, true), {
start: false, pauseResume: true, processNext: true, cancel: true, runControls: true,
retryExceptions: true, clear: true, maintenanceControls: true,
copyRawForExtract: true, handoffControls: true
});

const pausedNoException = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'CLASSIFIED', tier: 4 } },
done: false, paused: true
};
check('Paused with no retryable exceptions: no Retry exceptions button, but Copy raw for Extract appears (has a real result)', computeButtonVisibility(pausedNoException, true), {
start: false, pauseResume: true, processNext: true, cancel: true, runControls: true,
retryExceptions: false, clear: true, maintenanceControls: true,
copyRawForExtract: true, handoffControls: true
});

const doneSession = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'CLASSIFIED', tier: 4 } },
done: true, paused: false
};
check('Done: run controls collapse entirely, Clear + Copy raw for Extract remain', computeButtonVisibility(doneSession, false), {
start: false, pauseResume: false, processNext: false, cancel: false, runControls: false,
retryExceptions: false, clear: true, maintenanceControls: true,
copyRawForExtract: true, handoffControls: true
});

const reviewOnlyException = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED' } },
done: false, paused: true
};
check('CLASSIFICATION_REVIEW_REQUIRED is not retryable (own resolution flow, not a processing failure)', retryableExceptionCount(reviewOnlyException), 0);

if (failures.length > 0) {
console.error('KonnectBookingCheck button-visibility self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck button-visibility self-test passed (7/7)');
}
})();

// ===================================================================
// Self-test for the Post Closure carve-out's card/grouping display -
// categoryColor/categoryKey/categoryBadge must all treat postClosureAction
// as the primary signal (per instruction: tier isn't what matters for
// these leads), ahead of the tier they'd otherwise group/colour under.
// ===================================================================
(function postClosureDisplaySelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}

check('postClosureColor: confident send-back gets the teal colour', postClosureColor('send back through'), '#0891b2');
check('postClosureColor: the uncertain "check" bucket gets the amber colour', postClosureColor('check: needs contact?'), '#d97706');

const sendBackLead = { tier: 4, tierName: 'WARM ENQUIRY', postClosureAction: 'send back through' };
const checkLead = { tier: 5, tierName: 'NURTURE', postClosureAction: 'check: needs contact?' };
const normalLead = { tier: 4, tierName: 'WARM ENQUIRY', subCategory: 'Quote / Offer Request: Detailed' };

check('categoryColor uses postClosureColor, not TIER_COLORS, once postClosureAction is set', categoryColor(sendBackLead), '#0891b2');
check('categoryColor falls back to the real tier colour when there is no postClosureAction', categoryColor(normalLead), '#7c3aed');

check('categoryKey groups a confident send-back separately from its underlying tier', categoryKey(sendBackLead), 'POST CLOSURE: SEND BACK');
check('categoryKey groups the uncertain check bucket separately too', categoryKey(checkLead), 'POST CLOSURE: CHECK');
check('categoryKey falls back to tierName when there is no postClosureAction', categoryKey(normalLead), 'WARM ENQUIRY');

check('categoryBadge leads with the Post Closure decision, not the tier pill', categoryBadge(sendBackLead).indexOf('send back through') < categoryBadge(sendBackLead).indexOf('WARM ENQUIRY'), true);
check('categoryBadge still surfaces the underlying tier as secondary info', categoryBadge(sendBackLead).includes('WARM ENQUIRY'), true);
check('categoryBadge for a normal lead still leads with the tier pill as before', categoryBadge(normalLead).indexOf('WARM ENQUIRY') < categoryBadge(normalLead).indexOf('Quote'), true);

if (failures.length > 0) {
console.error('KonnectBookingCheck postClosureDisplay self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck postClosureDisplay self-test passed (9/9)');
}
})();

// ===================================================================
// Self-test for deriveRestStateLabel - reopening the panel on a
// restored session left "State" stuck on its hardcoded "Idle" HTML
// placeholder forever (render() never touched it, only setState did,
// and nothing calls setState on a plain reopen) - confirmed live via a
// 42/42-resolved session still reading "State: Idle" until a button
// was clicked.
// ===================================================================
(function deriveRestStateLabelSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}

check('No session', deriveRestStateLabel(null, false), 'Idle');
check('Actively running, unpaused - null, so a live setState message is never stomped', deriveRestStateLabel({ paused: false, done: false, cancelled: false }, true), null);
check('Running but paused - loopAlive alone stays true while paused (see runLoop)', deriveRestStateLabel({ paused: true, done: false, cancelled: false }, true), 'Paused');
check('Paused with no loop alive (e.g. reopened after a reload mid-pause)', deriveRestStateLabel({ paused: true, done: false, cancelled: false }, false), 'Paused');
check('Done, loop not alive - the reported live case (42/42 resolved)', deriveRestStateLabel({ paused: false, done: true, cancelled: false }, false), 'Done');
check('Cancelled takes priority over done being false', deriveRestStateLabel({ paused: false, done: false, cancelled: true }, false), 'Cancelled');
check('Freshly parsed, never started', deriveRestStateLabel({ paused: false, done: false, cancelled: false }, false), 'Idle');

if (failures.length > 0) {
console.error('KonnectBookingCheck deriveRestStateLabel self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck deriveRestStateLabel self-test passed (7/7)');
}
})();

// ===================================================================
// Self-test for newSession's merge behavior (pasting a grown batch over
// a session already in progress) - the actual improvement this was
// added for: new leads streaming in from Extract shouldn't force
// redoing already-completed work. Kept separate from the orchestration
// self-test above since this is specifically about session-merge
// semantics, not the search/classify pipeline itself.
// ===================================================================
(function sessionMergeSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const batch1 = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Alice\t\talice@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
'Bob\t07000000000\t\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 20:05'
].join('\n');
const session1 = newSession(batch1);
// Simulate both rows having genuinely finished processing, same shape
// stepOnce itself produces.
session1.results[0] = finalizeResult(makeResultBase(session1.rows[0]), { status: 'CLASSIFIED', tier: 2, tierName: 'DATE ONLY', initialNotes: 'Customer Comments: -' });
session1.results[1] = finalizeResult(makeResultBase(session1.rows[1]), { status: 'CLASSIFIED', tier: 1, tierName: 'CONFIRMED DATE & TIME', initialNotes: 'Customer Comments: 3pm works' });

// batch2 = the exact same two rows (as a real re-export from Extract
// would produce, byte-for-byte) plus one genuinely new one.
const batch2 = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Alice\t\talice@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
'Bob\t07000000000\t\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 20:05',
'Carol\t\tcarol@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 21:05'
].join('\n');
const session2 = newSession(batch2, session1);

check('Alice\'s already-completed result is carried over verbatim', session2.results[0], session1.results[0]);
check('Bob\'s already-completed result is carried over verbatim', session2.results[1], session1.results[1]);
check('Carol (genuinely new) has no result yet', session2.results[2], undefined);
check('Cursor resumes past both fully-resolved groups, landing on Carol\'s', session2.groups[session2.groupIndex].rows[0].name, 'Carol');
check('Session is not marked done - Carol still needs processing', session2.done, false);

// A paste with NOTHING carried over (genuinely unrelated batch) must
// still behave exactly like the pre-merge newSession(rawInput) always
// did - groupIndex 0, nothing pre-resolved.
const unrelatedBatch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Dee\t\tdee@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 22:05'
].join('\n');
const session3 = newSession(unrelatedBatch, session1);
check('Unrelated batch: no carried-over results', session3.results[0], undefined);
check('Unrelated batch: cursor starts at the beginning as normal', session3.groupIndex, 0);

// Re-pasting the exact same fully-completed batch (nothing new at all)
// must mark the session done immediately, not require a wasted step.
const session4 = newSession(batch1, session1);
check('Re-pasting a fully-completed batch is immediately done', session4.done, true);

if (failures.length > 0) {
console.error('KonnectBookingCheck session-merge self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck session-merge self-test passed (8/8)');
}
})();

(function needsReviewSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const lowConfidenceResult = finalizeResult(
{ inputIndex: 0, name: 'Fran Foster', phone: '', email: 'fran@example.com', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 18:05' },
{ status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', initialNotes: 'Customer Comments: maybe next month if the price is right' }
);
check('Low-confidence review-required row is flagged needs-review', isNeedsReview(lowConfidenceResult), true);

const lowConfidencePostClosure = finalizeResult(
{ inputIndex: 99, name: 'Ivy Ingram', phone: '', email: 'ivy@example.com', source: 'Post Closure Processing', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 18:05' },
{ status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', initialNotes: 'Customer Comments: maybe next month if the price is right', postClosureAction: 'check: needs contact?' }
);
check('Low-confidence tier classification does NOT pull a Post Closure lead into Needs Review - it always gets its own section instead', isNeedsReview(lowConfidencePostClosure), false);

const genuineException = finalizeResult(
{ inputIndex: 1, name: 'Gus Grant', phone: '07000000001', email: '', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 19:05' },
{ status: 'EXCEPTION', exception: 'SEARCH_NO_RESULTS' }
);
check('A genuine automation failure is NOT needs-review (nothing to triage)', isNeedsReview(genuineException), false);

const classified = finalizeResult(
{ inputIndex: 2, name: 'Hana Hill', phone: '', email: 'hana@example.com', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 20:05' },
{ status: 'CLASSIFIED', tier: 2, tierName: 'DATE ONLY', subCategory: 'Customer-Stated Day', initialNotes: 'Customer Comments: -' }
);
check('An already-classified row is not needs-review', isNeedsReview(classified), false);

const decided = applyManualReviewDecision(lowConfidenceResult, 4, 'Quote / Offer Request: Detailed', 'mentions price but no visit intent yet - still worth a call');
check('Manual decision applies the chosen tier', [decided.tier, decided.tierName], [4, 'WARM ENQUIRY']);
check('Manual decision applies the given sub-category', decided.subCategory, 'Quote / Offer Request: Detailed');
check('Manual decision clears the exception/moves to CLASSIFIED', [decided.status, decided.exception], ['CLASSIFIED', null]);
check('Manual decision is no longer needs-review', isNeedsReview(decided), false);
check('Manual decision preserves the original Initial Notes untouched', decided.initialNotes, lowConfidenceResult.initialNotes);
check('Manual decision records the reason given', decided.manualNote, 'mentions price but no visit intent yet - still worth a call');
check('Manual decision is marked as a manual override', decided.manualOverride, true);

const decidedNoReason = applyManualReviewDecision(lowConfidenceResult, 5, '', '');
check('A blank reason still produces a sensible default, not an empty string reason', decidedNoReason.reason, 'Manually confirmed (no reason given).');
check('A blank sub-category still produces a sensible default, not an empty string', decidedNoReason.subCategory, '(manually reviewed)');

const fakeSessionForExport = {
rows: [{ inputIndex: 0 }, { inputIndex: 1 }],
results: { 0: decided, 1: classified }
};
const exportTsv = buildManualReviewDecisionsExport(fakeSessionForExport);
const exportLines = exportTsv.split('\n');
check('Review-decisions export header has no name/phone/email columns', exportLines[0], 'InitialNotes\tTier\tTierName\tSubCategory\tReason\tCampaign\tSource');
check('Review-decisions export includes only the manually-overridden row', exportLines.length, 2);
check('Review-decisions export row carries the chosen tier name', exportLines[1].split('\t')[2], 'WARM ENQUIRY');

if (failures.length > 0) {
console.error('KonnectBookingCheck needs-review self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck needs-review self-test passed (15/15)');
}
})();

(function bulkAnalysisExportSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const classifiedRow = finalizeResult(
{ inputIndex: 0, name: 'Ivy Irwin', phone: '', email: 'ivy@example.com', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 20:05' },
{ status: 'CLASSIFIED', tier: 2, tierName: 'DATE ONLY', subCategory: 'Customer-Stated Day', flags: [], confidence: 'high', reason: 'Explicit date, no time given.', initialNotes: 'Customer Comments: Tuesday works' }
);
const needsReviewRow = finalizeResult(
{ inputIndex: 1, name: 'Jack Jones', phone: '07000000002', email: '', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 21:05' },
{ status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', confidence: 'low', initialNotes: 'Customer Comments: maybe, will call back' }
);
const automationFailureRow = finalizeResult(
{ inputIndex: 2, name: 'Kim King', phone: '', email: 'kim@example.com', source: 'Customer First', campaign: 'Citroen - Enquiry - New', created: 'Sat, 26 Sep 2026 22:05' },
{ status: 'EXCEPTION', exception: 'SEARCH_NO_RESULTS' }
);
const fakeSession = {
rows: [{ inputIndex: 0 }, { inputIndex: 1 }, { inputIndex: 2 }],
results: { 0: classifiedRow, 1: needsReviewRow, 2: automationFailureRow }
};

const exportTsv = buildBulkAnalysisExport(fakeSession);
const exportLines = exportTsv.split('\n');
check('Bulk-analysis export header has no name/phone/email columns', exportLines[0], 'InitialNotes\tTier\tTierName\tSubCategory\tFlags\tConfidence\tReason\tCampaign\tSource');
check('Bulk-analysis export includes classified and needs-review rows, excludes the automation failure with no notes', exportLines.length, 3);
check('Bulk-analysis export carries the classified row\'s tier name', exportLines[1].split('\t')[2], 'DATE ONLY');
check('Bulk-analysis export carries the needs-review row\'s low confidence', exportLines[2].split('\t')[5], 'low');
check('Bulk-analysis export carries the needs-review row\'s exception as its reason column', exportLines[2].split('\t')[6], 'CLASSIFICATION_REVIEW_REQUIRED');

const payload = buildBulkAnalysisClipboardPayload(fakeSession);
check('Clipboard payload leads with the explanatory prompt text', payload.startsWith(BULK_ANALYSIS_PROMPT), true);
check('Clipboard payload includes the export data after the prompt', payload.includes(exportTsv), true);

if (failures.length > 0) {
console.error('KonnectBookingCheck bulk-analysis-export self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectBookingCheck bulk-analysis-export self-test passed (7/7)');
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
// ICONS - ported verbatim from SLA-Extract.js's own redesign (small
// inline-SVG line icons, Lucide/Feather-style: 24x24 viewBox, stroke-
// based, currentColor) so this panel matches the rest of the toolset
// instead of the plain-text/emoji buttons it had before. Only the icons
// this panel actually uses are included, not the full set - extend as
// needed rather than porting everything preemptively.
// ===================================================================

const ICONS = {
clipboard: '<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>',
refresh: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/>',
copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
warning: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
minimize: '<line x1="5" y1="12" x2="19" y2="12"/>',
restore: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
chevron: '<polyline points="6 9 12 15 18 9"/>',
search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
play: '<polygon points="6 3 20 12 6 21 6 3"/>',
pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};

function svgIcon(name, size, extraStyle) {
return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;${extraStyle || ''}">${ICONS[name]}</svg>`;
}

// A ".chev"-classed chevron for the <details> summary rows below - kept
// separate from svgIcon (whose third argument is raw CSS text appended
// to its own style attribute, not a class) since the rotation here is
// driven by a plain CSS "parent:not([open]) .chev" rule, not a JS-
// computed transform - these are native <details> elements with no
// toggle listener/re-render of their own, so there's no "collapsed"
// boolean to pass in the way SLA-Extract.js's own chevronIcon needs one.
function detailsChevronIcon() {
return `<svg class="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;">${ICONS.chevron}</svg>`;
}

// ===================================================================
// UI PANEL - Shadow DOM, draggable, per the spec's interface list.
// Only initializes in a real browser (guarded below) so the self-tests
// above still run cleanly under a plain Node harness.
// ===================================================================

// Every fresh bookmarklet click always starts minimized to just the
// nav item/badge, per instruction - unlike SLA-Extract.js (a
// persistent auto-detect script that rebuilds its panel across route
// changes, where remembering "was open" matters), this only ever
// initializes once per click, so there's no reload-continuity case
// worth a persisted flag for - it would only ever get read once, right
// after being set false at the very same startup it's supposedly
// remembering.
const KBC_NAV_ITEM_ID = '_kbcNavItem';
const KBC_BADGE_ID = '_kbcBadge';

// Docks into Konnect Live's own top nav rather than floating a colored
// circle over the page - confirmed live via a real DOM scan: the right
// side of nav.navbar.navbar-inverse.navbar-fixed-top is built from
// sibling <ul class="nav navbar-right top-nav"><li class="dropdown
// hidden-sm"><a><i class="fa ... text-konnect-live"></i>Label</a></li>
// </ul> blocks (one per module - Live/Feedback/Care/Pricing/user menu).
// Reusing that exact shape, plus the page's own text-konnect-live
// class for the icon color (rather than hardcoding its hex), is what
// makes this actually blend in as "one more of the page's own nav
// items" instead of a generic badge that happens to sit nearby - same
// intent as SLA-Extract.js's own createBadge() docking into Konnect
// Manager's navbar, just matched to Konnect Live's real markup.
// Falls back to a small fixed circular badge - recolored to this
// page's own confirmed palette (#222222 nav background, white,
// #C2CB42 the "Live" accent) rather than a generic scheme - only if
// that nav structure isn't there (a page this was never confirmed
// against, or a future Konnect Live redesign).
function buildBadge() {
document.getElementById(KBC_NAV_ITEM_ID)?.remove();
document.getElementById(KBC_BADGE_ID)?.remove();

const nav = document.querySelector('nav.navbar.navbar-inverse.navbar-fixed-top');
if (nav) {
const ul = document.createElement('ul');
ul.id = KBC_NAV_ITEM_ID;
ul.className = 'nav navbar-right top-nav';
// Explicit float, not just the class - a dynamically-injected element
// shouldn't depend on cascade/load-order luck for something this
// structural. padding-right/left matches the confirmed 3px gap the
// existing sibling <ul>s use between each other.
ul.style.cssText = 'float:right;padding-right:3px;padding-left:3px';
const li = document.createElement('li');
li.className = 'dropdown hidden-sm';
const a = document.createElement('a');
a.href = 'javascript:void(0)';
a.title = 'Konnect Booking Check';
const icon = document.createElement('i');
icon.className = 'fa fa-clipboard fa-fw text-konnect-live';
const label = document.createElement('span');
label.textContent = 'Check';
a.appendChild(icon);
a.appendChild(label);
li.appendChild(a);
ul.appendChild(li);
// Confirmed live via a real DOM scan: nav's own children are the
// existing navbar-right <ul>s FIRST, then a full-width, 50px-tall
// <div class="collapse navbar-collapse"> AFTER them, then nothing else
// - appendChild put this new <ul> after that div. A float can't rise
// above a preceding block-level box, only avoid content that comes
// after it, so appending there put this on its own row starting below
// that div's full height, instead of alongside the other icons at
// all. Inserting before that div instead keeps this in the same
// contiguous floated run as Live/Feedback/etc - and since float:right
// siblings stack right-to-left in DOM order (first in source = flush
// right, each later one takes the next slot to its left), being last
// among THAT run still puts it on their left, per instruction.
const collapseDiv = nav.querySelector('.navbar-collapse');
if (collapseDiv) nav.insertBefore(ul, collapseDiv); else nav.appendChild(ul);
return {
clickTarget: a,
show() { ul.style.display = ''; },
hide() { ul.style.display = 'none'; },
remove() { ul.remove(); },
// No remaining-count next to the label, per instruction - just the
// plain "Check" text regardless of what's processing.
setProgress() {}
};
}

console.warn('KonnectBookingCheck: navbar not found, falling back to a fixed badge');
const badge = document.createElement('div');
badge.id = KBC_BADGE_ID;
Object.assign(badge.style, {
position: 'fixed', top: '16px', right: '16px', width: '48px', height: '48px',
background: '#222222', border: '2px solid #C2CB42', borderRadius: '50%',
boxShadow: '0 4px 12px rgba(194,203,66,0.35)', zIndex: 2147483000, cursor: 'pointer',
display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
fontWeight: 'bold', color: '#C2CB42', transition: 'transform 0.15s ease, box-shadow 0.15s ease',
fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
});
badge.innerHTML = svgIcon('clipboard', 22);
badge.title = 'Konnect Booking Check';
badge.addEventListener('mouseenter', () => {
badge.style.transform = 'scale(1.12)';
badge.style.boxShadow = '0 6px 16px rgba(194,203,66,0.5)';
});
badge.addEventListener('mouseleave', () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 4px 12px rgba(194,203,66,0.35)';
});
document.documentElement.appendChild(badge);
return {
clickTarget: badge,
show() { badge.style.display = 'flex'; },
hide() { badge.style.display = 'none'; },
remove() { badge.remove(); },
setProgress(remaining) {
if (remaining != null) {
badge.textContent = String(remaining);
badge.style.fontSize = '16px';
} else {
badge.innerHTML = svgIcon('clipboard', 22);
badge.style.fontSize = '18px';
}
}
};
}

// Idle (no session, or a finished one) always falls back to the plain
// idle label/icon - the number only means something while there's
// still work left, same as SLA-Extract.js's own setBadgeProgress.
function updateBadgeProgress(badge, ordered, session) {
if (!badge) return;
if (!session || ordered.length === 0 || session.done) {
badge.setProgress(null);
return;
}
const remaining = session.rows.length - ordered.length;
badge.setProgress(remaining > 0 ? remaining : null);
}

function buildPanelMarkup() {
// Same zombie-instance class of bug confirmed live in SLA-Extract.js's
// own panel: the window.__konnectBookingCheck guard at the top of this
// file is meant to stop a second panel ever being created while one
// already exists, but per instruction ("refresh the bookmarklet so the
// next click starts anew"), that guard alone wasn't reliably enough -
// clicking again after Clear & Stop (or any other path that leaves the
// guard and the real DOM state disagreeing) could still end up with two
// #_kbcPanelHost trees, the newer one silently fighting the older one
// for duplicate-ID elements the exact same way. Removing any existing
// host by ID unconditionally, right before creating a fresh one, makes
// this correct regardless of why the guard might be wrong, not just
// when it happens to be right.
document.getElementById('_kbcPanelHost')?.remove();
const host = document.createElement('div');
host.id = '_kbcPanelHost';
Object.assign(host.style, { all: 'initial', position: 'fixed', top: '16px', right: '16px', zIndex: 2147483000, display: 'none' });
document.documentElement.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
<style>
/* Header background (#222222) and the primary-action/progress accent
(#C2CB42) are Konnect Live's own confirmed navbar/branding colors
(live DOM scan), not a generic scheme - only the chrome/branding
surfaces use them; category/warning/error colors elsewhere stay as
their own semantic colors regardless of page theme. */
.panel { width: 460px; max-height: 90vh; display: flex; flex-direction: column; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 20px 40px -12px rgba(15,23,42,0.35); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #1e293b; overflow: hidden; }
.header { flex-shrink: 0; background: #222222; color: white; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; border-radius: 10px 10px 0 0; cursor: move; user-select: none; }
.header-title { display: flex; align-items: center; gap: 6px; font-weight: 600; overflow: hidden; }
.header-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header button { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 2px; display: flex; align-items: center; }
.header button:hover { color: white; }
.bodyEl { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 12px; }
textarea { width: 100%; height: 70px; box-sizing: border-box; font-family: monospace; font-size: 11px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; }
textarea:focus, .search-input:focus { outline: none; border-color: #C2CB42; box-shadow: 0 0 0 2px rgba(194,203,66,0.3); }
.row-count { color: #64748b; margin: 4px 0 8px; }
.section-label { color: #94a3b8; text-transform: uppercase; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; margin: 10px 0 4px; }
.section-label:first-child { margin-top: 0; }
.buttons { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
button.action { padding: 5px 8px; border: 1px solid #cbd5e1; background: white; border-radius: 6px; cursor: pointer; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
button.action:hover { background: #f6f7e4; }
button.action:disabled { opacity: 0.45; cursor: default; }
button.action:disabled:hover { background: white; }
button.action.temp { border-style: dashed; border-color: #f59e0b; color: #92400e; }
button.action.temp:hover { background: #fffbeb; }
button.primary { background: #C2CB42; color: #1e293b; border-color: #C2CB42; }
button.primary:hover { background: #aab238; }
.status { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; }
.status div { margin-bottom: 2px; }
.recent-log { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.recent-log-row { display: flex; align-items: center; gap: 5px; font-size: 10.5px; overflow: hidden; }
.recent-log-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }
.recent-log-tier { flex-shrink: 0; padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 9.5px; white-space: nowrap; }
.progress-track { height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin: 6px 0 2px; }
.progress-fill { height: 100%; background: #C2CB42; transition: width 0.2s ease; border-radius: 3px; }
.progress-fill.active { background-image: linear-gradient(135deg, rgba(255,255,255,0.4) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.4) 75%, transparent 75%, transparent); background-size: 14px 14px; animation: kbcProgressStripes 0.6s linear infinite; }
@keyframes kbcProgressStripes { from { background-position: 0 0; } to { background-position: 14px 0; } }
/* !important, not a plain class rule - button.action's own display:
inline-flex (a type+class selector, higher specificity than a single
class) was winning over a plain .hidden every time regardless of CSS
source order, so toggling this class on a button did nothing visible
even though the underlying visibility logic (computeButtonVisibility)
was correct. This is CSS, not JS - a // comment here is invalid syntax
and silently ate the whole rule that followed it on the first attempt,
which is why the previous fix didn't actually take effect live even
though the class was being toggled correctly the whole time. */
.hidden { display: none !important; }
.footer { flex-shrink: 0; border-top: 1px solid #cbd5e1; padding: 8px 12px; background: white; display: flex; justify-content: flex-end; border-radius: 0 0 10px 10px; }
.footer button { padding: 6px 12px; background: transparent; color: #dc2626; border: 1px solid #dc2626; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.topSection { flex-shrink: 0; border: 1px solid #e2e8f0; border-radius: 6px; background: white; margin-bottom: 8px; }
.topSection > summary { padding: 6px 8px; cursor: pointer; font-weight: 600; color: #475569; list-style: none; display: flex; align-items: center; gap: 6px; }
.topSection > summary::-webkit-details-marker { display: none; }
.topSection > summary .chev { transition: transform 0.15s ease; color: #94a3b8; }
.topSection:not([open]) > summary .chev { transform: rotate(-90deg); }
.topSection-content { padding: 0 8px 8px; }
.exportBar { flex-shrink: 0; }
.stats-bar { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.stat-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 5px; font-size: 10.5px; font-weight: 700; cursor: pointer; user-select: none; border: 1px solid transparent; transition: opacity 0.1s ease, border-color 0.1s ease; }
.stat-pill.inactive { opacity: 0.35; }
.stat-pill:hover { border-color: currentColor; }
.category-badge { border: 1px solid transparent; }
details.customer:hover > summary .category-badge { border-color: currentColor; }
.filter-bar { display: flex; gap: 6px; margin-bottom: 8px; }
.search-input { flex: 1; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 11px; box-sizing: border-box; font-family: inherit; }
.category-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.subcat-label { display: inline-block; margin-left: 4px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 500; color: #64748b; vertical-align: middle; }
.maintenance-controls { margin-top: 6px; }
.maintenance-controls .action { background: #f1f5f9; color: #64748b; font-weight: 600; }
.handoff-controls { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1; }
.handoff-controls .action { width: 100%; justify-content: center; }
.tier { border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 6px; background: white; }
.tier > summary { padding: 5px 8px; cursor: pointer; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.tier > summary::-webkit-details-marker { display: none; }
.tier > summary .chev { transition: transform 0.15s ease; color: #94a3b8; }
.tier:not([open]) > summary .chev { transform: rotate(-90deg); }
.tier-left { display: flex; align-items: center; gap: 6px; }
.tier-count { color: #94a3b8; font-weight: 400; }
.customer { border-top: 1px solid #f1f5f9; }
.customer > summary { padding: 5px 8px 5px 20px; cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.customer > summary::-webkit-details-marker { display: none; }
.customer > summary .chev { transition: transform 0.15s ease; color: #cbd5e1; flex-shrink: 0; }
.customer:not([open]) > summary .chev { transform: rotate(-90deg); }
.customer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.customer-body { padding: 4px 8px 8px 28px; background: #f8fafc; }
.customer-body .field { margin-bottom: 3px; }
.customer-body .field b { color: #475569; }
.notes-block { white-space: pre-wrap; background: white; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; margin-top: 4px; font-family: monospace; font-size: 10.5px; }
.reason { color: #64748b; font-style: italic; margin-top: 3px; }
.empty-state { color: #94a3b8; padding: 8px 4px; }
.review-section { flex-shrink: 0; border: 1px solid #fbbf24; border-radius: 6px; background: #fffbeb; margin-bottom: 8px; }
.review-section > summary { padding: 6px 8px; cursor: pointer; font-weight: 600; color: #92400e; list-style: none; display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.review-section > summary::-webkit-details-marker { display: none; }
.review-section > summary .chev { transition: transform 0.15s ease; }
.review-section:not([open]) > summary .chev { transform: rotate(-90deg); }
.review-section-left { display: flex; align-items: center; gap: 6px; }
.review-row { border-top: 1px solid #fde68a; padding: 8px; }
.review-name { font-weight: 600; margin-bottom: 2px; }
.review-notes { white-space: pre-wrap; background: white; border: 1px solid #fde68a; border-radius: 4px; padding: 6px; margin: 4px 0 6px; font-family: monospace; font-size: 10.5px; }
.review-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.review-actions button { padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; cursor: pointer; font-size: 10.5px; font-weight: 700; }
.review-reason { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-family: inherit; }
#resultsBody { flex: 1; min-height: 40px; overflow-y: auto; }
</style>
<div class="panel">
<div class="header" id="headerEl">
<div class="header-title">${svgIcon('clipboard', 15)}<span>Konnect Booking Check</span></div>
<button id="minBtn" title="Minimize">${svgIcon('minimize', 14)}</button>
</div>
<div class="bodyEl" id="bodyEl">
<details class="topSection" id="topSection" open>
<summary>${detailsChevronIcon()}Batch input</summary>
<div class="topSection-content">
<textarea id="pasteBox" placeholder="Paste TSV: Name  Phone  Email  Source  Campaign  Created"></textarea>
<button class="action" id="btnPasteClipboard" style="margin-bottom: 6px;">${svgIcon('copy', 11)}Paste from clipboard</button>
<div class="row-count" id="rowCount">0 rows parsed</div>
<label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; margin-bottom: 6px; cursor: pointer;">
<input type="checkbox" id="autoStartToggle">
Auto-start on paste
</label>
<div class="buttons" id="runControls">
<button class="action primary" id="btnStart">${svgIcon('play', 11)}Start</button>
<button class="action primary" id="btnPauseResume">${svgIcon('pause', 11)}Pause</button>
<button class="action" id="btnProcessNext">Process next</button>
<button class="action" id="btnCancel">${svgIcon('x', 11)}Cancel</button>
</div>
<div class="buttons maintenance-controls" id="maintenanceControls">
<button class="action" id="btnRetryExceptions">${svgIcon('refresh', 11)}Retry exceptions</button>
<button class="action" id="btnClear">Clear session</button>
</div>
<div class="buttons handoff-controls" id="handoffControls">
<button class="action" id="btnCopyRawForExtract">${svgIcon('copy', 11)}Copy raw for Extract</button>
</div>
<div class="status">
<div>Customer: <span id="curCustomer">-</span></div>
<div>Target Created: <span id="curTarget">-</span></div>
<div>State: <span id="curState">Idle</span></div>
<div>Completed: <span id="completedCount">0</span> &middot; Exceptions: <span id="exceptionCount">0</span> &middot; Total: <span id="totalCount">0</span></div>
<div class="progress-track"><div class="progress-fill" id="progressFill" style="width: 0%;"></div></div>
<div class="recent-log" id="recentLog"></div>
</div>
</div>
</details>
<div id="needsReviewSection"></div>
<div class="stats-bar hidden" id="statsBar"></div>
<div class="filter-bar hidden" id="filterBar">
<input type="text" class="search-input" id="searchInput" placeholder="Filter by name...">
</div>
<div id="resultsBody"></div>
<div class="exportBar">
<div class="section-label">Export</div>
<div class="buttons">
<button class="action" id="btnCopyReviewDecisions">${svgIcon('copy', 11)}Copy review decisions</button>
<button class="action temp" id="btnCopyBulkAnalysis" title="Temporary: copies all processed leads plus an explanatory prompt, for pasting into a separate Claude chat to look for recurring patterns.">${svgIcon('copy', 11)}Copy for pattern analysis (temp)</button>
</div>
</div>
</div>
<div class="footer">
<button id="btnClearStop">${svgIcon('trash', 11)}Clear & Stop</button>
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
// innerHTML, not textContent - several of these buttons carry an icon
// (svgIcon output) alongside their label; textContent would silently
// strip it out permanently the first time feedback fires, since
// setting .textContent replaces ALL child content, icon included, not
// just the text.
const original = button.innerHTML;
const originalColor = button.style.color;
button.textContent = text;
button.style.color = isError ? '#dc2626' : '#059669';
setTimeout(() => {
button.innerHTML = original;
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
const progressFillEl = root.getElementById('progressFill');
const statsBarEl = root.getElementById('statsBar');
const filterBarEl = root.getElementById('filterBar');
const searchInputEl = root.getElementById('searchInput');
const resultsBody = root.getElementById('resultsBody');
const needsReviewSectionEl = root.getElementById('needsReviewSection');
const minBtn = root.getElementById('minBtn');
const headerEl = root.getElementById('headerEl');
const recentLogEl = root.getElementById('recentLog');
const runControlsEl = root.getElementById('runControls');
const maintenanceControlsEl = root.getElementById('maintenanceControls');
const handoffControlsEl = root.getElementById('handoffControls');
const btnStartEl = root.getElementById('btnStart');
const btnProcessNextEl = root.getElementById('btnProcessNext');
const btnCancelEl = root.getElementById('btnCancel');
const btnRetryExceptionsEl = root.getElementById('btnRetryExceptions');
const btnClearEl = root.getElementById('btnClear');
const btnCopyRawForExtractEl = root.getElementById('btnCopyRawForExtract');
const pauseResumeBtn = root.getElementById('btnPauseResume');

const badge = buildBadge();
badge.show();
badge.clickTarget.addEventListener('click', () => {
host.style.display = 'block';
badge.hide();
});

// Category filter toggled by clicking a stat pill - empty set means "no
// filter, show everything" (also true again once every category has
// been individually re-toggled back on, per containsAny-style set
// semantics below), not "show nothing". Name filter is plain live text
// match, kept as a local variable rather than in `session`/localStorage
// since it's a transient view concern, not something worth persisting
// across a panel reopen.
const activeCategoryFilters = new Set();
let nameFilterText = '';

let session = loadStoredSession();
if (session) pasteBox.value = session.rawInput || '';

// <details> open/closed state doesn't survive an innerHTML rebuild, and
// render() is called after every processed row - without tracking this
// separately, expanding a customer's notes to read them would just get
// collapsed again the moment the next row finishes. Tiers default open
// (few of them, useful to see counts at a glance); customers default
// closed, per instruction ("collapsed under the customer's name x
// contact details").
const detailsState = { tiers: new Set([-2, -1, 1, 2, 3, 4, 5, 6]), customers: new Set() };
let reviewSectionOpen = false;

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
if (r.flags && r.flags.length > 0) parts.push(`<div class="field"><b>Flags:</b> ${escapeHtmlForUi(r.flags.join(', '))}</div>`);
if (r.postClosureAction) {
parts.push(`<div class="field"><b>Post Closure:</b> <span style="color: ${postClosureColor(r.postClosureAction)}; font-weight: 700;">${escapeHtmlForUi(r.postClosureAction)}</span></div>`);
}
if (r.reason) parts.push(`<div class="reason">${escapeHtmlForUi(r.reason)}</div>`);
if (r.initialNotes) parts.push(`<div class="notes-block">${escapeHtmlForUi(r.initialNotes)}</div>`);
else if (r.status === 'EXCEPTION') parts.push(`<div class="reason">No Initial Notes read - ${escapeHtmlForUi(r.exception || '')}</div>`);
return parts.join('');
}

// Ordered by the same priority scale as the tier pills, so both the
// stats bar and its column-selection filtering behavior read top-to-
// bottom as "most to least actionable" consistently. Post Closure keys
// lead the list - per instruction, these matter more than the generic
// tier grouping when they apply at all.
const STATS_BAR_CATEGORY_ORDER = ['POST CLOSURE: SEND BACK', 'POST CLOSURE: CHECK'].concat([1, 2, 3, 4, 5, 6].map((t) => TIER_NAMES[t])).concat(['EXCEPTION']);

function renderNeedsReviewSection(needsReview) {
if (needsReview.length === 0) {
needsReviewSectionEl.innerHTML = '';
return;
}
const rowsHtml = needsReview.map((r) => `
<div class="review-row" data-key="${r.inputIndex}">
<div class="review-name">${escapeHtmlForUi(r.name)}</div>
<div class="notes-block review-notes">${escapeHtmlForUi(r.initialNotes || '')}</div>
${r.tierName ? `<div class="reason">Classifier's best guess (not trusted): Tier ${r.tier} - ${escapeHtmlForUi(r.tierName)}${r.subCategory ? ' - ' + escapeHtmlForUi(r.subCategory) : ''} - ${escapeHtmlForUi(r.reason || '')}</div>` : ''}
<div class="review-actions">
${REVIEW_TIER_OPTIONS.map((tier) => `<button data-tier="${tier}" style="background: ${categoryColor({ tier })}1a; color: ${categoryColor({ tier })};">Tier ${tier}: ${escapeHtmlForUi(TIER_NAMES[tier])}</button>`).join('')}
</div>
<input type="text" class="review-subcategory" placeholder="Sub-category (optional) - e.g. Website Test Drive...">
<input type="text" class="review-reason" placeholder="Why (optional) - helps refine the rules later...">
</div>
`).join('');
needsReviewSectionEl.innerHTML = `
<details class="review-section" ${reviewSectionOpen ? 'open' : ''}>
<summary><span class="review-section-left">${detailsChevronIcon()}<span>Needs Review</span></span><span>${needsReview.length}</span></summary>
${rowsHtml}
</details>
`;
const detailsEl = needsReviewSectionEl.querySelector('details.review-section');
if (detailsEl) detailsEl.addEventListener('toggle', () => { reviewSectionOpen = detailsEl.open; });
needsReviewSectionEl.querySelectorAll('.review-row').forEach((rowEl) => {
const key = Number(rowEl.dataset.key);
const subCategoryInput = rowEl.querySelector('.review-subcategory');
const reasonInput = rowEl.querySelector('.review-reason');
rowEl.querySelectorAll('.review-actions button').forEach((btn) => {
btn.addEventListener('click', () => {
const result = session.results[key];
if (!result) return;
session.results[key] = applyManualReviewDecision(result, Number(btn.dataset.tier), subCategoryInput.value.trim(), reasonInput.value.trim());
saveSession(session);
render();
});
});
});
}

function render() {
if (!session) {
rowCountEl.textContent = '0 rows parsed';
resultsBody.innerHTML = '<div class="empty-state">Paste a batch above to begin.</div>';
completedCountEl.textContent = '0';
exceptionCountEl.textContent = '0';
totalCountEl.textContent = '0';
progressFillEl.style.width = '0%';
statsBarEl.classList.add('hidden');
filterBarEl.classList.add('hidden');
needsReviewSectionEl.innerHTML = '';
updateBadgeProgress(badge, [], session);
curStateEl.textContent = deriveRestStateLabel(session, isRunning);
syncButtonStates();
renderRecentLog();
return;
}
rowCountEl.textContent = `${session.rows.length} rows parsed` + (session.headerOk ? '' : ` - ${session.headerError}`);
const orderedAll = orderedResults(session);
// Section 9.1 dedupe - within whatever's currently pasted, per
// instruction. Re-run on every render (idempotent: setDuplicate only
// adds the flag once) rather than once at the end, so duplicates
// already show correctly while a batch is still mid-run.
applyDedupe(
orderedAll,
(r) => r,
(r) => { const p = parseSlaCreated(r.created); return p ? new Date(p.year, p.month, p.day, p.hour, p.minute).getTime() : null; },
(r) => String(r.source || '').toLowerCase() === 'post closure processing',
(r) => { if (!r.flags.includes('Duplicate')) r.flags = [...r.flags, 'Duplicate']; }
);
const needsReview = orderedAll.filter(isNeedsReview);
const ordered = orderedAll.filter((r) => !isNeedsReview(r));
renderNeedsReviewSection(needsReview);
const percent = session.rows.length > 0 ? Math.round((100 * orderedAll.length) / session.rows.length) : 0;
progressFillEl.style.width = `${percent}%`;
// Animated only while actual work is happening - at rest (idle,
// paused, or done) a moving stripe would read as "still working" when
// it isn't.
progressFillEl.classList.toggle('active', isRunning && !session.done);
updateBadgeProgress(badge, orderedAll, session);

if (ordered.length === 0) {
// Distinct from "nothing processed at all" - if every processed row
// so far is sitting in the Needs Review section above, saying "no
// results yet" here would read as wrong/contradictory.
resultsBody.innerHTML = needsReview.length > 0
? '<div class="empty-state">All results so far need review - see above.</div>'
: '<div class="empty-state">No results yet - press Start or Process next.</div>';
statsBarEl.classList.add('hidden');
filterBarEl.classList.add('hidden');
} else {
statsBarEl.classList.remove('hidden');
filterBarEl.classList.remove('hidden');

// Stats bar is built from the FULL unfiltered set - it's the stable
// overview a filter selection narrows FROM, not a count of what's
// currently showing (which would shrink to match itself the moment
// any filter is active, defeating the point of showing it).
const countsByKey = new Map();
ordered.forEach((r) => {
const key = categoryKey(r);
countsByKey.set(key, (countsByKey.get(key) || 0) + 1);
});
statsBarEl.innerHTML = STATS_BAR_CATEGORY_ORDER.filter((key) => countsByKey.has(key)).map((key) => {
const sample = ordered.find((r) => categoryKey(r) === key);
const color = categoryColor(sample);
const isActive = activeCategoryFilters.size === 0 || activeCategoryFilters.has(key);
return `<span class="stat-pill${isActive ? '' : ' inactive'}" data-key="${escapeHtmlForUi(key)}" style="background: ${color}1a; color: ${color};">${escapeHtmlForUi(key)}<span style="opacity: 0.7;">${countsByKey.get(key)}</span></span>`;
}).join('');
statsBarEl.querySelectorAll('.stat-pill').forEach((el) => {
el.addEventListener('click', () => {
const key = el.dataset.key;
if (activeCategoryFilters.has(key)) activeCategoryFilters.delete(key);
else activeCategoryFilters.add(key);
render();
});
});

const filtered = ordered.filter((r) => {
if (!(activeCategoryFilters.size === 0 || activeCategoryFilters.has(categoryKey(r)))) return false;
if (nameFilterText && !r.name.toLowerCase().includes(nameFilterText)) return false;
return true;
});

if (filtered.length === 0) {
resultsBody.innerHTML = '<div class="empty-state">No results match the current filters.</div>';
} else {
const byTier = new Map();
filtered.forEach((r) => {
// Post Closure leads group by their Post Closure decision (virtual
// keys -2/-1), not their real tier - per instruction, tier isn't
// what matters for these, and mixing them into WARM ENQUIRY/NURTURE
// etc. buried them among leads that need actual classification work.
// -2/-1 sort ahead of every real tier (1-6) via the same numeric
// sort below, so they surface first without any separate container
// or duplicated event-wiring.
// r.tier otherwise comes straight from classifyLead's own real
// classification, not a separate campaign-based display heuristic -
// a card always groups under the exact tier that actually classified
// it. Genuine automation failures (SEARCH_NO_RESULTS etc.) never
// reach classifyLead at all, so they have no tier of their own -
// grouped into a trailing "Unclassified" bucket (7) rather than
// sorting first via null-coerces-to-0 arithmetic.
const tier = r.postClosureAction ? (r.postClosureAction === 'send back through' ? -2 : -1) : (r.tier || 7);
if (!byTier.has(tier)) byTier.set(tier, []);
byTier.get(tier).push(r);
});
resultsBody.innerHTML = Array.from(byTier.keys()).sort((a, b) => a - b).map((tier) => {
// Sorted by the spec's own priority order (tier/subRank, then
// received time) so the most actionable leads in each tier surface
// at the top rather than input order.
const rows = [...byTier.get(tier)].sort(compareByBookingPriority);
const customersHtml = rows.map((r) => `
<details class="customer" data-key="${r.inputIndex}" ${detailsState.customers.has(r.inputIndex) ? 'open' : ''}>
<summary><span style="display: flex; align-items: center; gap: 6px; overflow: hidden;">${detailsChevronIcon()}<span class="customer-name" title="${escapeHtmlForUi(r.initialNotes || 'No Initial Notes read yet.')}">${escapeHtmlForUi(r.name)}</span></span>${categoryBadge(r)}</summary>
<div class="customer-body">${customerBodyHtml(r)}</div>
</details>
`).join('');
const tierLabel = tier === -2 ? 'Post Closure - Send back through'
: tier === -1 ? 'Post Closure - Check: needs contact?'
: tier === 7 ? 'Unclassified'
: `Tier ${tier} - ${TIER_NAMES[tier]}`;
const tierLabelColor = tier === -2 || tier === -1 ? ` style="color: ${postClosureColor(tier === -2 ? 'send back through' : 'check')};"` : '';
return `
<details class="tier" data-key="${tier}" ${detailsState.tiers.has(tier) ? 'open' : ''}>
<summary><span class="tier-left">${detailsChevronIcon()}<span${tierLabelColor}>${escapeHtmlForUi(tierLabel)}</span></span><span class="tier-count">${rows.length}</span></summary>
${customersHtml}
</details>
`;
}).join('');
}
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

// orderedAll here, not the reduced `ordered` - needs-review rows are
// real EXCEPTION-status results too (just pulled into their own
// section above instead of the tier list), so using the reduced set
// would silently undercount them out of this summary.
completedCountEl.textContent = String(orderedAll.filter((r) => r.status === 'CLASSIFIED').length);
exceptionCountEl.textContent = String(orderedAll.filter((r) => r.status === 'EXCEPTION').length);
totalCountEl.textContent = String(session.rows.length);
const restStateLabel = deriveRestStateLabel(session, isRunning);
if (restStateLabel !== null) curStateEl.textContent = restStateLabel;
syncButtonStates();
renderRecentLog();
}

function syncButtonStates() {
const v = computeButtonVisibility(session, isRunning);
btnStartEl.classList.toggle('hidden', !v.start);
pauseResumeBtn.classList.toggle('hidden', !v.pauseResume);
btnProcessNextEl.classList.toggle('hidden', !v.processNext);
btnCancelEl.classList.toggle('hidden', !v.cancel);
runControlsEl.classList.toggle('hidden', !v.runControls);
btnRetryExceptionsEl.classList.toggle('hidden', !v.retryExceptions);
btnClearEl.classList.toggle('hidden', !v.clear);
maintenanceControlsEl.classList.toggle('hidden', !v.maintenanceControls);
btnCopyRawForExtractEl.classList.toggle('hidden', !v.copyRawForExtract);
handoffControlsEl.classList.toggle('hidden', !v.handoffControls);
}

function renderRecentLog() {
if (recentCompletions.length === 0) { recentLogEl.innerHTML = ''; return; }
recentLogEl.innerHTML = recentCompletions.map((r) => {
const color = categoryColor(r);
const label = escapeHtmlForUi(r.exception || r.tierName || 'Pending');
return `<div class="recent-log-row"><span class="recent-log-name">${escapeHtmlForUi(r.name || '-')}</span><span class="recent-log-tier" style="background: ${color}1a; color: ${color};">${label}</span></div>`;
}).join('');
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
// Passes the outgoing session so newSession can carry over already-
// completed results for any row that's still present (same lead) in
// the new paste - the common real case being a grown batch (previous
// leads + new ones just exported from Extract), not a genuinely
// unrelated one.
session = newSession(pasteBox.value, session);
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

// pauseResumeBtn.textContent alone would wipe out its icon (textContent
// replaces ALL child content, SVG included, not just the label text) -
// this keeps both in sync instead, swapping the icon to match (pause
// icon while running/offering to pause, play icon while paused/offering
// to resume).
function setPauseResumeLabel(text) {
pauseResumeBtn.innerHTML = svgIcon(text === 'Pause' ? 'pause' : 'play', 11) + text;
}

function startProcessing() {
const s = ensureSessionFromPasteBox();
if (!s.headerOk) { uiHandle.setState(`Header error: ${s.headerError}`); return; }
s.paused = false;
s.cancelled = false;
setPauseResumeLabel('Pause');
showPageFlashOverlay('Checking leads…');
runLoop(s, uiHandle);
}

root.getElementById('btnStart').addEventListener('click', startProcessing);

const autoStartToggle = root.getElementById('autoStartToggle');
autoStartToggle.checked = loadSettings().autoStart;
autoStartToggle.addEventListener('change', () => {
saveSettings({ autoStart: autoStartToggle.checked });
});

// Deferred with setTimeout(0), not read directly in the paste handler -
// confirmed the standard cross-browser way to do this: the 'paste'
// event fires BEFORE the browser has actually applied the pasted text
// to the textarea's own value, so reading pasteBox.value synchronously
// here would still see whatever was there beforehand (typically empty).
// Only triggers on an actual paste, not on manual typing - the
// checkbox's own opt-in nature already limits this to users who
// explicitly want it, but distinguishing paste from typing still
// matters so autofilling one character at a time doesn't repeatedly
// try to start a run against an incomplete/invalid batch.
pasteBox.addEventListener('paste', () => {
if (!autoStartToggle.checked) return;
setTimeout(() => {
if (isRunning) return;
const s = ensureSessionFromPasteBox();
if (s.headerOk && s.rows.length > 0 && !s.done) startProcessing();
}, 0);
});

// Reported live: the row count only ever updated on clicking Start/
// Process next, so a real paste left "0 rows parsed" showing with no
// visible sign anything happened, confusing enough that live testing
// worked around it by typing and deleting a character first. Debounced
// rather than reparsing on every keystroke - ensureSessionFromPasteBox
// re-parses the whole batch AND writes it to localStorage (saveSession),
// which for a large pasted batch would otherwise mean doing both on
// every single keystroke while still mid-paste/mid-edit.
let pasteBoxInputDebounce = null;
pasteBox.addEventListener('input', () => {
clearTimeout(pasteBoxInputDebounce);
pasteBoxInputDebounce = setTimeout(() => {
ensureSessionFromPasteBox();
render();
}, 300);
});

// One click instead of switching windows/tabs, copying, switching
// back, clicking into the textarea, and pasting - reads the clipboard
// directly via the async Clipboard API, same approach and same
// fallback (that API needs clipboard-read permission and can be
// blocked entirely in some contexts) already proven out in
// SLA-Extract.js's own "Paste from clipboard & Classify" button.
// Setting pasteBox.value directly does NOT fire its 'paste' event, so
// ensureSessionFromPasteBox/render/auto-start are called explicitly
// here rather than relying on the listeners above.
root.getElementById('btnPasteClipboard').addEventListener('click', async (event) => {
if (!navigator.clipboard || !navigator.clipboard.readText) {
showButtonFeedback(event.currentTarget, 'Clipboard blocked - paste manually', true);
return;
}
try {
const text = await navigator.clipboard.readText();
pasteBox.value = text;
const s = ensureSessionFromPasteBox();
render();
if (autoStartToggle.checked && !isRunning && s.headerOk && s.rows.length > 0 && !s.done) {
startProcessing();
} else {
showButtonFeedback(event.currentTarget, `✓ Pasted ${s.rows.length}`, false);
}
} catch (error) {
showButtonFeedback(event.currentTarget, 'Clipboard blocked - paste manually', true);
}
});

// Pausing doesn't actually exit runLoop's while-loop (it just idles on
// a 200ms poll internally, waiting for session.paused to clear) - the
// overlay is shown/hidden here, at the actual user action, rather than
// inside runLoop's own try/finally, since that only fires once the
// loop truly ends (done/cancelled), not on every pause. Without this,
// pausing would leave the real page dimmed for as long as it stayed
// paused.
pauseResumeBtn.addEventListener('click', () => {
if (!session) return;
if (session.paused) {
session.paused = false;
setPauseResumeLabel('Pause');
uiHandle.setState('Resuming...');
showPageFlashOverlay('Checking leads…');
runLoop(session, uiHandle);
} else {
session.paused = true;
setPauseResumeLabel('Resume');
uiHandle.setState('Paused');
hidePageFlashOverlay();
}
});

root.getElementById('btnCancel').addEventListener('click', () => {
if (session) { session.cancelled = true; uiHandle.setState('Cancelling...'); }
});

// Guarded on isRunning && !session.paused, not isRunning alone -
// isRunning stays true for the entire time a run is PAUSED too (the
// loop is still alive, just idling in its own sleep-and-recheck poll -
// see runLoop's own comment on that), so isRunning alone would wrongly
// block retrying a paused run, which is actually the safe/expected
// case (confirmed live: reported as blocking even after pausing). Only
// genuinely mid-loop-and-unpaused is unsafe to mutate into - a step
// could be actively in flight, and stepOnce reads session.groupIndex/
// rowInGroupIndex at its own start, writing back based on whatever
// they are when it finishes; racing that with a concurrent rewind here
// could advance against the wrong group. retryExceptions mutates
// session in place (not a reassignment) specifically so a currently-
// paused runLoop - still holding this exact object - picks the change
// up correctly the moment it's resumed, rather than being silently
// orphaned on a stale session.
root.getElementById('btnRetryExceptions').addEventListener('click', (event) => {
if (!session) return;
if (isRunning && !session.paused) {
showButtonFeedback(event.currentTarget, 'Pause/stop first', true);
return;
}
const retryCount = retryableExceptionCount(session);
if (retryCount === 0) {
showButtonFeedback(event.currentTarget, 'No exceptions to retry', true);
return;
}
retryExceptions(session);
saveSession(session);
// One click now both queues the exceptions AND starts working through
// them, instead of queuing then requiring a separate Start/Resume
// click - previously reported as an extra, unnecessary step.
if (isRunning) {
// A paused loop is still alive (see runLoop's own comment on this) -
// just clearing paused lets its own poll pick the change up; calling
// runLoop again here would start a second, duplicate loop.
session.paused = false;
setPauseResumeLabel('Pause');
uiHandle.setState('Resuming...');
showPageFlashOverlay('Checking leads…');
} else {
session.paused = false;
session.cancelled = false;
setPauseResumeLabel('Pause');
showPageFlashOverlay('Checking leads…');
runLoop(session, uiHandle);
}
showButtonFeedback(event.currentTarget, `✓ Retrying ${retryCount}`, false);
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
recentCompletions = [];
pasteBox.value = '';
setPauseResumeLabel('Pause');
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
if (session) session.cancelled = true;
isRunning = false;
hidePageFlashOverlay();
clearStoredSession();
session = null;
recentCompletions = [];
host.remove();
badge.remove();
window.__konnectBookingCheck = null;
console.info('Konnect Booking Check stopped and cleared - click the bookmarklet again to start fresh');
});

root.getElementById('btnCopyRawForExtract').addEventListener('click', (event) => {
const s = ensureSessionFromPasteBox();
const count = orderedResults(s).length;
copyTextToClipboard(buildRawNotesTsvForExtract(s))
.then(() => showButtonFeedback(event.currentTarget, `✓ Copied ${count}`, false))
.catch(() => showButtonFeedback(event.currentTarget, '✗ Copy failed', true));
});

root.getElementById('btnCopyReviewDecisions').addEventListener('click', (event) => {
const s = ensureSessionFromPasteBox();
const count = orderedResults(s).filter((r) => r.manualOverride).length;
if (count === 0) {
showButtonFeedback(event.currentTarget, 'No manual reviews yet', true);
return;
}
copyTextToClipboard(buildManualReviewDecisionsExport(s))
.then(() => showButtonFeedback(event.currentTarget, `✓ Copied ${count}`, false))
.catch(() => showButtonFeedback(event.currentTarget, '✗ Copy failed', true));
});

root.getElementById('btnCopyBulkAnalysis').addEventListener('click', (event) => {
const s = ensureSessionFromPasteBox();
const count = buildBulkAnalysisExport(s).split('\n').length - 1;
if (count <= 0) {
showButtonFeedback(event.currentTarget, 'Nothing processed yet', true);
return;
}
copyTextToClipboard(buildBulkAnalysisClipboardPayload(s))
.then(() => showButtonFeedback(event.currentTarget, `✓ Copied ${count} + prompt`, false))
.catch(() => showButtonFeedback(event.currentTarget, '✗ Copy failed', true));
});

// Hides the whole host, not just bodyEl - leaving the 460px header bar
// on screen (the old behavior) wasn't actually minimized, just a
// shorter panel. The badge (mutually exclusive with the host, see its
// own click handler above) is the only way back once hidden.
minBtn.addEventListener('click', () => {
host.style.display = 'none';
badge.show();
});

// Live filter-as-you-type, not rebuilt by render() itself (searchInputEl
// is part of the static panel shell, not resultsBody's rebuilt innerHTML)
// so typing never loses focus/cursor position mid-batch-run the way
// resetting .value on every render would.
searchInputEl.addEventListener('input', () => {
nameFilterText = searchInputEl.value.trim().toLowerCase();
render();
});

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
badge.hide();
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
