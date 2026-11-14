// ===================================================================
// KONNECT LEAD CHECKER
//
// Runs on Konnect Live. Takes the batch pasted from SLA-Manager.js
// ("Copy for Lead Checker"), finds each customer and the exact lead, and
// classifies its Initial Notes per lead-classification-spec.md v1.10:
// six priority tiers, flags and a 13-step ordered pipeline. Reasons cite
// the spec section; Section 12 cases are ported as self-tests.
// ===================================================================

// Shows when the running copy was published and notices a newer one going
// live. The date comes from GitHub once per open; later checks compare the
// published file's text, which has no rate limit to share between staff.
function startVersionWatch(fileName, onChange) {
const state = { publishedAt: null, newer: false };
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
const timer = setInterval(() => {
if (state.newer || baseline == null) return;
fileText().then((text) => {
if (text && fingerprint(text) !== baseline) { state.newer = true; onChange(state); }
}).catch(() => {});
}, 20 * 60 * 1000);
state.stop = () => clearInterval(timer);
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

function konnectNavReady() {
const nav = document.querySelector('nav.navbar.navbar-inverse.navbar-fixed-top');
return !!(nav && nav.querySelector('ul.nav.navbar-right.top-nav'));
}

// After a time out Konnect can put its login box over the page it was on,
// with the menus still there, so a shown password box beside a Login button
// counts as logged out too.
function onLoginPage() {
const password = document.querySelector('input[type="password"]');
if (!password) return false;
if (!konnectNavReady()) return true;
const shown = (el) => !!el && !!(el.offsetWidth || el.offsetHeight);
return shown(password) && Array.from(document.querySelectorAll('button[ng-click="login()"], button.btn-login')).some(shown);
}

function showLoginWaitNote() {
if (!document.body || typeof document.body.appendChild !== 'function') return null;
const note = document.createElement('div');
note.setAttribute('role', 'status');
note.textContent = 'Logging you in. Lead Checker opens once you are in. If the page reloads instead, click Work Tools once more: a batch sent from SLA Manager then starts by itself.';
note.style.cssText = 'position:fixed;top:16px;right:16px;max-width:300px;z-index:2147483000;background:#222;color:#fff;border:2px solid #C2CB42;border-radius:10px;padding:10px 12px;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;';
document.body.appendChild(note);
setTimeout(() => { note.style.display = 'none'; }, 8000);
return note;
}

(function () {
// Re-running the bookmarklet focuses the existing panel instead of
// injecting a second copy.
if (window.__konnectLeadChecker && window.__konnectLeadChecker.focus) {
window.__konnectLeadChecker.focus();
return;
}

// Problems the panel must show the user, not just the console. Self-tests
// set these before the panel exists; the notice bar shows them on render.
const lcNotices = { saveFailed: false, otherTab: false, selfTestFailures: [], stopped: null, loggedOut: false, hiddenWait: false, onChange: null };

// One per page, shared by every copy of this tool that loads on it: the
// timer worker, the message listener and the mark that a lead is being
// checked. A second copy (after Clear & Stop) takes these over, so two
// copies never answer SLA Manager or drive the page together.
const klcShared = window.__klcShared || (window.__klcShared = { timers: null, onMessage: null, onTick: null, listening: false, tickTimer: null, stepBusy: false });

// Browsers slow a hidden tab's own timers to one a second, then to one a
// minute, but not a worker's. A small worker keeps the time; the page timer
// set beside it is only the backstop for a worker that dies. Where the
// worker cannot start (a content security policy), ordinary timers are used
// and the run waits while the tab is hidden.
function createHiddenSafeTimers() {
const pageTimers = {
mode: 'page',
setTimeout: (fn, ms) => window.setTimeout(fn, ms),
clearTimeout: (id) => window.clearTimeout(id),
setInterval: (fn, ms) => window.setInterval(fn, ms),
clearInterval: (id) => window.clearInterval(id)
};
let worker = null;
try {
if (window.__klcNoWorkerTimers || typeof Worker !== 'function' || typeof Blob !== 'function') throw new Error('no worker');
const source = 'var t={};onmessage=function(e){var d=e.data;if(d[0]===1){t[d[1]]=setTimeout(function(){delete t[d[1]];postMessage(d[1]);},d[2]);}else if(d[0]===2){t[d[1]]=setInterval(function(){postMessage(d[1]);},d[2]);}else{clearTimeout(t[d[1]]);clearInterval(t[d[1]]);delete t[d[1]];}};';
worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
} catch (error) {
return pageTimers;
}
const pending = new Map();
let nextId = 1;
const api = { mode: 'worker' };
function fire(id) {
const entry = pending.get(id);
if (!entry) return;
if (!entry.repeat) { pending.delete(id); window.clearTimeout(entry.backstop); }
try { entry.fn(); } catch (error) { window.setTimeout(() => { throw error; }, 0); }
}
// A blocked worker reports its error after it is made, so timers already
// set move to page timers here.
function usePageTimers() {
if (api.mode !== 'worker') return;
api.mode = 'page';
try { worker.terminate(); } catch (error) { /* already gone */ }
pending.forEach((entry, id) => { if (entry.repeat) entry.backstop = window.setInterval(() => fire(id), entry.ms); });
}
worker.onmessage = (event) => fire(event.data);
worker.onerror = usePageTimers;
function add(fn, ms, repeat) {
if (typeof fn !== 'function') return 0;
const id = nextId++;
const delay = Math.max(0, Number(ms) || 0);
const entry = { fn, ms: delay, repeat, backstop: null };
pending.set(id, entry);
if (api.mode === 'worker') {
try { worker.postMessage([repeat ? 2 : 1, id, delay]); } catch (error) { usePageTimers(); }
}
if (repeat) { if (api.mode !== 'worker' && entry.backstop == null) entry.backstop = window.setInterval(() => fire(id), delay); }
else entry.backstop = window.setTimeout(() => fire(id), api.mode === 'worker' ? delay + 2000 : delay);
return id;
}
function clear(id) {
const entry = pending.get(id);
if (!entry) return;
pending.delete(id);
if (entry.repeat) window.clearInterval(entry.backstop); else window.clearTimeout(entry.backstop);
if (api.mode === 'worker') { try { worker.postMessage([0, id]); } catch (error) { /* worker gone */ } }
}
api.setTimeout = (fn, ms) => add(fn, ms, false);
api.setInterval = (fn, ms) => add(fn, ms, true);
api.clearTimeout = clear;
api.clearInterval = clear;
return api;
}
if (!klcShared.timers) klcShared.timers = createHiddenSafeTimers();
const klcTimers = klcShared.timers;
// Every timer below this line goes through the worker.
const setTimeout = (fn, ms) => klcTimers.setTimeout(fn, ms);
const clearTimeout = (id) => klcTimers.clearTimeout(id);
const setInterval = (fn, ms) => klcTimers.setInterval(fn, ms);
const clearInterval = (id) => klcTimers.clearInterval(id);

// While hidden, Konnect's own timers still fire only once a second. Fixed
// pauses that give the page time to react are stretched past that, and time
// limits are widened. A wait still ends the moment its result shows.
function pagePause(ms) {
return document.hidden ? Math.max(ms, 1200) : ms;
}
function pageLimit(ms) {
return document.hidden ? ms * 3 + 3000 : ms;
}
// True when the tab is hidden and nothing can keep the timers on time.
function hiddenAndSlowed() {
return !!document.hidden && klcTimers.mode !== 'worker';
}
function notifyNoticesChanged() {
if (typeof lcNotices.onChange === 'function') { try { lcNotices.onChange(); } catch (error) { /* panel not ready */ } }
}

function runSelfTest(name, fn) {
const originalError = console.error;
let failed = false;
console.error = function (...args) { failed = true; return originalError.apply(console, args); };
try {
fn();
} catch (error) {
failed = true;
originalError.call(console, `KonnectLeadChecker ${name} threw:`, error);
} finally {
console.error = originalError;
}
if (failed) { lcNotices.selfTestFailures.push(name); notifyNoticesChanged(); }
}

function isDebugLogging() {
try { return localStorage.getItem('workBookmarklets:debug') === '1'; } catch (error) { return false; }
}
function debugLog(...args) {
if (isDebugLogging()) console.log(...args);
}

// ===================================================================
// CLASSIFIER ENGINE - lead-classification-spec.md v1.10
// ===================================================================

function low(s) { return String(s || '').toLowerCase(); }

// Section 3.1: strip system suffixes (CarGurus IMV block, collection
// point, vehicle URL label, price line, "General enquiry") before scanning.
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

// Terms fields sometimes appear without a colon ("Deposit £5,000").
function hasAmountField(text, name) {
return new RegExp(name + '\\s*:?\\s*£?[\\d,]+', 'i').test(String(text || ''));
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Abbreviated weekdays ("sat afternoon"). Word boundaries matter: these
// collide with real words otherwise ("mon" in "money", "sat" in "satisfied"),
// and so do the words after them ("sat nav", "sun roof", "sat in").
const WEEKDAY_ABBR_RE = /\b(sun(?![\s-]*(roof|visor|blind|shade))|mon|tue|tues|wed|thu|thur|thurs|fri|sat(?![\s-]*nav)(?!\s+(in|on|down|there|here|with)\b))\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WRITTEN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const WRITTEN_KEYS = Object.keys(WRITTEN).join('|');

// Section 10: date/time parsing.

// Placeholder 00:00 (Fiat/Abarth First Desired Schedule, templates) is
// never a real clock time, so it is stripped before scanning.
function stripPlaceholderTime(lowerText) {
return lowerText.replace(/\b00:00\b/g, ' ');
}

const CLOCK_RE = new RegExp(
'\\b([01]?\\d|2[0-3]):[0-5]\\d(\\s*hrs)?\\b' +
// A dotted time ("9.30") can also be a price or a size, so it does not
// count after a pound sign or before a rate or a unit ("12.50 a day").
'|(?<![£$\\d.,])\\b([01]?\\d|2[0-3])\\.[0-5]\\d(\\s*hrs)?\\b(?!\\s*(?:%|a\\s+(?:day|week|month|year)|per\\s|each\\b|p\\/?[wm]\\b|pw\\b|pcm\\b|litres?\\b|ltr\\b|mpg\\b|miles\\b|k\\b))' +
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
if (WEEKDAY_ABBR_RE.test(lowered)) return true;
if (/\btoday\b|\btonight\b|\btomorrow\b|\bthis morning\b|\bthis afternoon\b|\bthis weekend\b|\bnext week\b/i.test(lowered)) return true;
if (new RegExp('\\b\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(' + MONTHS.join('|') + ')\\b', 'i').test(lowered)) return true;
// A numeric date needs a real day and month: "50/50 finance" and "24/7"
// are not dates.
const numeric = lowered.match(/\b\d{1,2}\/\d{1,2}\b/g) || [];
if (numeric.some((d) => { const [day, month] = d.split('/').map(Number); return day >= 1 && day <= 31 && month >= 1 && month <= 12 && d !== '24/7'; })) return true;
return false;
}

// Section 6: flags, attached to every result. ctx carries signals the
// matching step already worked out (e.g. whether "Finance" was a real
// customer request or just a field name).
function computeFlags(text, campaign, source, ctx) {
ctx = ctx || {};
const lowered = low(text);
const src = low(source);
const flags = [];

if (/\bpx\b|part\s*exchange|partex\s*=\s*yes|partex\s*=\s*possibly|enhancedpartexchangeoffer|partexreg|\(i have a part exchange\)|px derivative|desc1/i.test(lowered)) flags.push('PX');
if (/negative equity|\bneg eq\b|\bnegs\b|equity:\s*£?-\s*\d/i.test(lowered)) flags.push('Negative Equity');
if (ctx.noValuationGiven) flags.push('No Valuation Given');
if (/outright cash|cash purchase|cash buyer|paying in cash|cleared funds|self finance full amount|arranged my own finance/i.test(lowered)) flags.push('Cash Buyer');
if (ctx.finance) flags.push('Finance');
if (ctx.motab) flags.push('Motab');
if (/\bvan\b|commercial vehicle|\blcv\b/i.test(lowered)) flags.push('Van / Commercial');
if (/\bltd\b|\bvat\b|business lease|\bbch\b|business_enquiry|limited company/i.test(lowered)) flags.push('Business');
if (ctx.model) flags.push('Model');
if (/email only|no calls|do not call|prefer email|can'?t take calls|email reply is preferred/i.test(lowered) || /^email only -/i.test(lowered)) flags.push('Email Only');
if (/can you deliver|delivery to [a-z0-9]|move.{0,20}(this car|it) to|transfer.{0,20} to |too far to travel/i.test(lowered)) flags.push('Delivery / Transfer');
if (/second request|third chaser/i.test(lowered)) flags.push('Repeat Request');
if (/call today|close a deal today/i.test(lowered)) flags.push('Urgent Today');
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
const WITHDRAWN_RE = /found (a|another|one)\b[^.|]{0,30}?\b(elsewhere|somewhere else|locally|at another (dealer|dealership|garage)|closer to (home|me)|nearer)\b|\balready (bought|purchased)\b|\bbought (a car|a vehicle|one|another( car)?) (elsewhere|somewhere else)\b|may now be sorted|decided to stick with|changed our minds|going to go for that/i;
const RESCHEDULE_RE = /\breschedule\b|alternative time|another date|move my (appointment|test drive)|make a new date|\brearrange\b|\brebook\b|rather than \d|change my appointment to/i;

// Recall, MOT and warranty count as aftersales only with aftersales intent:
// a recall notice or certificate, an MOT to book or due on their own car, a
// warranty claim or their own warranty. "Does it come with a warranty?",
// "how long is the MOT" and "I recall seeing this car" are sales questions.
const AFTERSALES_INTENT_RE = new RegExp([
'recall[_ ](notice|letter|work|campaign|appointment|certificate)', 'safety recall', 'takata', '\\brecalls? (on|for) my\\b', '\\bbeen recalled\\b', '\\bmy (car|vehicle|van)\\b[^.|?]{0,40}\\brecall',
'\\b(book|booking|booked|need|needs|arrange)\\b[^.|?]{0,25}\\bmot\\b', '\\bmot\\b[^.|?]{0,20}\\b(due|booking|appointment|expired|expires|reminder)\\b', '\\bmy mot\\b', '\\bmot (on|for) my\\b',
'warranty (claim|repair|work|issue|problem|department)', '\\bclaim\\b[^.|?]{0,20}\\bwarranty', '\\bmy warranty\\b', 'warranty (on|for) my\\b', '\\bmy (car|vehicle|van)\\b[^.|?]{0,40}\\bwarranty'
].join('|'), 'i');

// Section 7.12: agent note markers.
const AGENT_NOTE_RE = /\*\*\* priority acceptance required \*\*\*|please confirm provisional appointment with customer|customer requires further communication|customer is booked in|customer has been booked in|customer booked in for|provisionally booked in|customer is booked in|customer called in|\bvm left\b|rec customer to|explained online store process|please call customer|please can \w+ confirm|\bhot lead\b|customer said|i have advised|i had advised|i couldn'?t locate vehicle|^-\s*customer\b|contact centre sales event lead from inbound call|contact centre sales event lead from api|customer has called to confirm appointment|warm transferred|came through on live chat|email sent -|called cx\b|fao\s+[a-z]/i;
const AGENT_NOTE_THIRDPERSON_RE = /^customer (wants|has|is looking|is interested|interested)|they have a budget of/i;
// The hub's own shorthand, matched only in the form the hub writes it.
// "cx" for customer is lower case and a word of its own (a Mazda CX-5 or a
// Citroen CX is not); "no answer" opens the note or sits beside a call or a
// voicemail; initials close the note after a dash or "with", and are not a
// trim or body code ("Peugeot 208 - GT").
const AGENT_CX_RE = /\b[cC]x\b(?![-\s]?\d)|\bCX\s+(?:is|was|has|had|wants?|would|called|said|advised|asked|requested|will|booked|needs?|looking)\b/;
const AGENT_NO_ANSWER_RE = /^\s*no answer\b|\bcalled (the )?(cx|customer)\b[^.|]{0,30}\bno answer\b|\bno answer\b[\s,;:-]*(vm|voicemail|message left|no message|left (a )?(vm|voicemail|message)|x\s?\d)\b/i;
const AGENT_INITIALS_RE = /(?:\s-\s*|\bwith\s+)(?!(?:GT|GS|DS|EV|SE|SX|ST|RS|SR|GL|LX|EX|XL|XS|VR|PX|HP|UK|NI|TV|OK)\b)[A-Z]{2}\s*$/;

function looksLikeAgentNote(text) {
return AGENT_NOTE_RE.test(text) || AGENT_NOTE_THIRDPERSON_RE.test(text) || AGENT_CX_RE.test(text) || AGENT_NO_ANSWER_RE.test(text) || AGENT_INITIALS_RE.test(text);
}

// Section 8.1: source inference (only when Source is blank).
function inferSource(text, source) {
if (source) return source;
if (/Lead ID:\s*00Qa/i.test(text)) return 'Customer First';
if (/Comment Line #1:|Sourced from Robins & Day Website/i.test(text)) return 'Robins & Day Website';
if (/Misc:.*UniqueID/i.test(text)) return 'Autofunnel';
if (/Message from Consumer at/i.test(text)) return 'Autotrader';
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
// A reg or mileage box holding the word "test" is a test lead. Free text
// only counts when "test" is all it says: "I would like a test drive" is a
// customer.
const testWord = /\btest(ing)?\b(?!\s*-?\s*drive)|\bretest\b/i;
const onlyTest = /^\W*(this is (a|only a) )?test(ing)?( lead| enquiry| only| test)?\W*$/i;
if (testWord.test(partExVal) || testWord.test(partExMil) || onlyTest.test(anythingElse) || (/no reg/i.test(partExVal) && testWord.test(text))) return true;
const commentsOnly = (field(text, 'Customer Comments') || '').toLowerCase();
if (/^(qwerty|asdf|zxcv)$/i.test(lowered) || /^(.)\1{3,}$/.test(lowered.replace(/\s/g, ''))
|| /^(qwerty|asdf|zxcv)$/i.test(commentsOnly) || (commentsOnly && /^(.)\1{3,}$/.test(commentsOnly.replace(/\s/g, '')))) return true;
if (/\bseo\b|google maps.{0,20}marketing|whatsapp:\s*\+|noticed a few opportunities|\bsponsor\b|training offers|\btender\b|collaboration opportunities/i.test(lowered)) return true;
return false;
}

// Section 7.16: non-customer / admin.
function isNonCustomerAdmin(lowered) {
if (/apply for a job role|industry placement|work experience|\bcv\b|sales advisor position|t level industry placement|apprenticeship|\bapprentice\b|job vacanc|any vacancies|career opportunit/i.test(lowered)) return true;
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

// Section 7.11: finance override. Customer-typed text only, whole-word
// ("tech" must not fire inside PureTech), with a negation list
// ("no finance owned", "self financed").
function hasFinanceWording(lowered) {
if (/no finance|no outstanding finance|cleared and owned|self financed|self finance|arranged my own finance|finance paid off/i.test(lowered)) return false;
return /\bfinance\b|\bpcp\b|\bhp\b|\bquote\b|\bquotes\b|\bleasing\b|\b0%\b|\bbest price\b|\btechnical\b|\btech support\b/i.test(lowered);
}

// Main pipeline - Section 3's 13 steps, in order. Each step below
// either returns a result (stop) or null (continue to the next step).
function classifyLead(initialNotesRaw, opts) {
opts = opts || {};
let { campaign, source, hasAlreadyEngagedCallEntry } = opts;

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

// Step 5: our agent notes. Skipped for Live chat/marketplace sources,
// which are customer-originated even when third-person-shaped.
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
}
}

// Step 6: customer redirect/reschedule checks, in order.
if (!result) result = customerRedirectChecks(text0, lowered, camp, src, flagCtx);

// Mixed notes: a "no call" match on notes that also ask to visit or give
// a day or time is not filed as tier 6 by itself. The visit tier is put
// forward at low confidence, so a person decides in Needs Review.
if (result && result.tier === 6 && MIXED_REVIEW_CATEGORIES.has(result.subCategory)) {
const preferred = visitOrTimeResult(text0, lowered, camp, src, opts.leadRequest);
if (preferred) {
result = Object.assign({}, preferred, {
confidence: 'low',
reason: `${preferred.says} but also reads as ${result.subCategory}${result.matched ? ` ("${result.matched}")` : ''}: check which applies.`,
alternative: { tier: 6, subCategory: result.subCategory }
});
delete result.says;
}
}
if (result) delete result.matched;

// Step 7: system note templates.
if (!result) result = systemTemplates(text0, lowered, camp, src, flagCtx);

// Step 8: Customer First marketing codes.
if (!result) result = customerFirstMarketingCode(text0, lowered, camp, src, flagCtx);

// Step 9: free-text date/time.
if (!result) result = freeTextDateTime(text0);

// Step 10: campaign rules.
if (!result) result = campaignRules(text0, lowered, camp, src, flagCtx, opts.leadRequest);

// Step 11: fallback.
if (!result) result = R(5, 'Enquiry: Blank', 9, 'low', 'Nothing matched - fallback to Enquiry: Blank.');

// Step 12: flags.
const flags = computeFlags(text0, campaign, source, flagCtx);

// Step 13: Post Closure Processing.
const postClosureAction = src === 'post closure processing'
? (hasAlreadyEngagedCallEntry ? 'send back through' : 'check: needs contact?')
: null;

return Object.assign({}, result, { flags, dedupeKey: computeDedupeKey(text0, campaign, source), postClosureAction, source });
}

// The tier 6 results that are about a topic, not about the visit itself. A
// booking or cancellation note names a day by its nature, and spam markers
// are exact, so those are never treated as mixed.
const MIXED_REVIEW_CATEGORIES = new Set(['Aftersales', 'Send to Dealer (named exec)', 'Complaint', 'Existing Order', 'Fleet', 'Agreement Hand-back', 'Non-Customer / Admin']);
const VISIT_INTENT_RE = /\btest[\s-]?drive\b|\bcome (in|and|to|down|over|by)\b|\bpop (in|down|over)\b|\bview(ing)? (the|this|it|a|your)\b|\b(see|look at) (the|this) (car|vehicle|van)\b|\bbook (an? )?(appointment|viewing|visit)\b|\bvisit (you|the|your)\b|\barrange (a|an) (viewing|appointment|visit)\b/i;

// Pure. What the notes would be without the tier 6 match, when they ask to
// visit or give a day or time; null when they do neither. "says" is the
// start of the reason shown to the reviewer.
function visitOrTimeResult(text, lowered, camp, src, leadRequest) {
const scratch = {};
const rest = systemTemplates(text, lowered, camp, src, scratch) || customerFirstMarketingCode(text, lowered, camp, src, scratch)
|| freeTextDateTime(text) || campaignRules(text, lowered, camp, src, scratch, leadRequest);
const day = (lowered.match(new RegExp('\\b(' + WEEKDAYS.join('|') + '|today|tonight|tomorrow|this weekend|next week)\\b', 'i')) || [])[0];
if (rest && rest.tier <= 2) {
return Object.assign({}, rest, { says: rest.tier === 1 ? `Gives a day and time${day ? ` (${day})` : ''}` : `Gives a day${day ? ` (${day})` : ''}` });
}
const message = text.replace(/Message from Consumer at[^:]*\d{1,2}:\d{2}\s*[AP]M:/i, ' ');
const visit = VISIT_INTENT_RE.test(lowered);
if (!visit && !hasClockTime(message)) return null;
const base = rest && rest.tier === 3 ? rest : R(3, 'Visit or Time Mentioned', 10, 'low', '');
return Object.assign({}, base, { says: visit ? 'Asks to visit or test drive' : 'Gives a time' });
}

// False matches found in the 11 Nov 2026 audit: words that read as a day or
// time, tier 6 rules that caught sales questions, and mixed notes.
runSelfTest('tierSixAndDayTimeSelfTest', function tierSixAndDayTimeSelfTest() {
const failures = [];
let count = 0;
const check = (label, actual, expected) => { count++; if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
const website = (comment, campaign) => classifyLead(`Comment Line #1: ${comment}`, { campaign: campaign || 'Enquiry - Used', source: 'Robins & Day Website' });
const sub = (comment) => website(comment).subCategory;

check('"sat nav" is not a day', hasDayMention('Does this car have sat nav and parking sensors?'), false);
check('"sat-nav" is not a day', hasDayMention('Has it got sat-nav'), false);
check('"sun roof" is not a day', hasDayMention('Is there a sun roof on this one'), false);
check('"I sat in one" is not a day', hasDayMention('I sat in one last year and liked it'), false);
check('"sat afternoon" is still a day', hasDayMention('could do sat afternoon'), true);
check('"sun morning" is still a day', hasDayMention('sun morning is best'), true);
check('"50/50 finance" is not a date', hasDayMention('Do you offer 50/50 finance?'), false);
check('"24/7" is not a date', hasDayMention('I am available 24/7 by email'), false);
check('"12/11" is still a date', hasDayMention('I can come on 12/11'), true);
check('"12.50 a day" is not a time', hasClockTime('It works out at 12.50 a day, can I pop in tomorrow'), false);
check('a price after a pound sign is not a time', hasClockTime('Is the 208 still £12.50 a week'), false);
check('"9.30" is still a time', hasClockTime('tomorrow at 9.30 please'), true);
check('"10:30" is still a time', hasClockTime('I could do 10:30'), true);
check('a sat nav question is not a booking', website('Does this car have sat nav and parking sensors?').tier > 2, true);
check('a rate with "tomorrow" is a day, not a day and time', website('It works out at 12.50 a day on finance, can someone ring me tomorrow').tier, 2);

check('"could someone call me" names nobody', sub('Could someone call me about this car please') === 'Send to Dealer (named exec)', false);
check('"can you call me" names nobody', sub('Can you call me about the 208') === 'Send to Dealer (named exec)', false);
check('"can Dave call me" names an exec', sub('Can Dave call me back about the 208'), 'Send to Dealer (named exec)');
check('a car found on our website is not a withdrawal', sub("I have found a car on your website I'd like to know more about") === 'Cancelled / Withdrawn', false);
check('a car found elsewhere is a withdrawal', sub('Thanks but we have found a car elsewhere'), 'Cancelled / Withdrawn');
check('a car found at another dealer is a withdrawal', sub('No longer needed, found one at another dealer'), 'Cancelled / Withdrawn');
check('already bought is a withdrawal', sub('Please stop the emails, I have already bought one'), 'Cancelled / Withdrawn');
check('"does it come with a warranty" is a sales question', sub('Is this car still available and does it come with a warranty?') === 'Aftersales', false);
check('"how long is the MOT" is a sales question', sub('How long is the MOT on this one') === 'Aftersales', false);
check('"I recall seeing this car" is not a recall', sub('I recall seeing this car last month, has the price changed') === 'Aftersales', false);
check('an MOT to book on their own car is aftersales', sub('I need to book an MOT for my Corsa'), 'Aftersales');
check('a warranty claim is aftersales', sub('I want to make a warranty claim on the gearbox'), 'Aftersales');
check('a recall notice is aftersales', sub('I have had a recall notice through the post'), 'Aftersales');
check('"good reviews" is not spam', sub('You have good reviews so I thought I would ask about the 2008') === 'Spam / Test', false);
const mbMail = (anythingElse, extra) => classifyLead(`Misc: The following information was present in the lead: | Enquiry = Availability | Purchase = Within 3 Months | Part = No${extra || ''} | AnythingElse = ${anythingElse}`, { campaign: 'Peugeot - Enquiry - New', source: 'MB Mail' }).subCategory;
check('"I would like a test drive" is not a test lead', mbMail('I would like a test drive') === 'Spam / Test', false);
check('"test" by itself is a test lead', mbMail('test'), 'Spam / Test');
check('a reg box saying test is a test lead', mbMail('-', ' | PartExReg = TEST | PartExMileage = 1'), 'Spam / Test');
const phone = (notes) => classifyLead(notes, { campaign: 'Peugeot - Enquiry - New', source: 'Phone call' }).subCategory;
check('a trim after a dash is not agent initials', phone('Peugeot 208 - GT') === 'Inbound: Already Handled', false);
check('agent initials after a dash still are', phone('Peugeot 2008 GT new - TD'), 'Inbound: Already Handled');
check('a CX model is not the hub shorthand', [phone('Interested in the Mazda CX-5 you have') === 'Inbound: Already Handled', phone('Do you have a Citroen CX in stock') === 'Inbound: Already Handled'], [false, false]);
check('"cx" as the hub writes it still is', phone('cx wants a call back about the 3008'), 'Inbound: Already Handled');
check('a customer saying they got no answer is not a hub note', phone('I rang the showroom twice and there was no answer') === 'Inbound: Already Handled', false);
check('"No answer, vm left" is a hub note', phone('No answer, vm left'), 'Inbound: Already Handled');

const mixedWarranty = website('Can I come in on Saturday at 10am to see it? Also I need to ask about my warranty on the old car');
check('a day and time with a warranty mention goes to review at the visit tier', [mixedWarranty.tier, mixedWarranty.confidence, mixedWarranty.alternative], [1, 'low', { tier: 6, subCategory: 'Aftersales' }]);
check('the reason says both were found', /day and time \(saturday\) but also reads as Aftersales \("my warranty"\): check which applies\./.test(mixedWarranty.reason), true);
const mixedExec = website('Could Dave call me, I would like to test drive the 208');
check('visit intent with a named exec goes to review', [mixedExec.tier, mixedExec.confidence, mixedExec.alternative && mixedExec.alternative.subCategory], [3, 'low', 'Send to Dealer (named exec)']);
const onlyAftersales = website('I need to book an MOT for my Corsa');
check('notes with only the tier 6 match stay tier 6', [onlyAftersales.tier, onlyAftersales.confidence, onlyAftersales.alternative], [6, 'high', undefined]);
const cancelled = website('I booked a test drive for Tuesday at 9.30 am but I need to cancel');
check('a cancellation that names its day is not mixed', [cancelled.tier, cancelled.subCategory], [6, 'Cancelled / Withdrawn']);

if (failures.length) console.error('KonnectLeadChecker tier-six-and-day-time self-test FAILED:\n' + failures.join('\n'));
else console.info(`KonnectLeadChecker tier-six-and-day-time self-test passed (${count}/${count})`);
});

// Leads reviewed by hand on 10 Nov 2026 (fictional details).
runSelfTest('reviewedLeadsNov10SelfTest', function reviewedLeadsNov10SelfTest() {
const failures = [];
const cases = [
['apprenticeship request', 'Comment Line #1: I am 17 and looking to start an apprenticeship within a car dealership. Do you have any apprenticeship positions?', 'Enquiry - Used', 'Robins & Day Website', '', 6],
['monthly HP price with PX', 'Message from customer: Hi there id like to know what this works out a per month HP etc please\n(I have a part exchange)\nRegistration: AB12CDE', 'Enquiry - Used', 'VehicleVanTradeEnquiry', '', 4],
['finance questions on a stock car', 'Comment Line #1: I want to ask a few questions on the Peugeot you have in stock for finance availability', 'Enquiry - Used', 'Robins & Day Website', '', 4],
['Spoticar interest with a part exchange', 'Lead ID: 00Qa200000EXAMPLE | Marketing Code: SP-SPOTICAR | Customer Comments: I would be interested in the above vehicle. I would be looking to part ex my car.', 'Offer Request - Used', 'Customer First', '', 4],
['parts request', 'Lead ID: 00Qa200000EXAMPLE | Marketing Code: SP-SPOTICAR | Customer Comments: I would like to install the right door autodimming mirror and need a VIN', 'Offer Request - Used', 'Customer First', '', 6],
['certificate of conformity', 'Comment Line #1: We bought 5 new chassis and need a SOC for IVA testing. Where can I request copies of SOC?', 'DS - General', 'Robins & Day Website', '', 6],
['bare website lead with a Motability lead request', 'Sourced from Robins & Day Website.', 'Peugeot - Enquiry - New', 'Robins & Day Website', 'Motability', 3],
['blank affiliate form', 'Lead ID: 00Qa200000EXAMPLE | Marketing Code: Affiliates-TopGear-Q4-26 | Customer Comments: -', 'Peugeot - Enquiry - New', 'Customer First', '', 5],
['blank brand site quote', 'Lead ID: 00Qa200000EXAMPLE | Marketing Code: BrandSite-Quote | Customer Comments: -', 'Peugeot - Offer Request - New', 'Customer First', '', 5]
];
cases.forEach(([label, notes, campaign, source, leadRequest, want]) => {
const r = classifyLead(notes, { campaign, source, leadRequest });
if (r.tier !== want) failures.push(`${label}: expected tier ${want}, got ${r.tier} (${r.subCategory})`);
});
if (failures.length) console.error('KonnectLeadChecker reviewed-leads-10-Nov self-test FAILED:\n' + failures.join('\n'));
else console.info(`KonnectLeadChecker reviewed-leads-10-Nov self-test passed (${cases.length}/${cases.length})`);
});

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
const noNewSlotYet = /will be in touch to set up an alternative time|will call next week to rearrange|will rebook at some point next week/i.test(lowered);
const dayTime = noNewSlotYet ? null : freeTextDateTime(text);
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
return R(4, 'Existing Customer: Upgrade', 1, 'medium', 'Existing customer with car/finance with us wanting to change (Section 3.6.4).');
}

// Checked after 6.4 so a plain "change my car" upgrade still lands
// there, and kept to explicit hand-back wording only.
if (/hand (my|the) (current )?(vehicle|car) back|returning my current (vehicle|car)|no fee agreement/i.test(lowered)) {
return R(6, 'Agreement Hand-back', 8, 'medium', 'Customer asking to hand back/return their current car under an agreement - redirect, not a sales call (manual review).');
}

// 6.5: named exec contact, not a rebooking.
if (/(can|could)\s+(?!(?:someone|somebody|somone|anyone|anybody|you|u|one|i|we|they|he|she|it|a|an|the|your|my|this|that|please|pls|whoever|staff|sales)\b)[a-z]+\s+[a-z]*\s*call me|following up on discussion with|i have spoken to\s+[a-z]+ and|as discussed with|\bi met\s+[a-z]+\b/i.test(lowered) && !/reservation made for viewing|as discussed by phone, reservation/i.test(lowered)) {
flagCtx.execRequested = true;
return R(6, 'Send to Dealer (named exec)', 4, 'medium', 'Customer references an exec/prior conversation, not a rebooking (Section 3.6.5).');
}

// 6.6: fleet.
if (isFleet(text, camp, lowered)) {
return R(6, 'Fleet', 5, 'high', 'Fleet/multi-vehicle language (Section 7.17).');
}

// 6.7: complaint.
if (COMPLAINT_RE.test(lowered)) {
return Object.assign(R(6, 'Complaint', 6, 'high', 'Complaint keyword matched (Section 7.8).'), { matched: lowered.match(COMPLAINT_RE)[0] });
}

// 6.8: existing order.
if (/cancel my order|order id|order:\s*em|deposit refund|£99 reservation refund/i.test(lowered) && !/reservation made for viewing/i.test(lowered)) {
return R(6, 'Existing Order', 7, 'high', 'Order/reservation cancellation or admin (Section 3.6.8).');
}

// Narrow phrasing on purpose: "full service history" on a used-car
// enquiry must NOT match, nor a question about the advertised car's
// warranty or MOT (see AFTERSALES_INTENT_RE).
const aftersalesMatch = lowered.match(AFTERSALES_INTENT_RE) || lowered.match(/service plan|spare key|gap policy|courtesy car|rental car|direct debit|account login|\bpassword\b|record of (the|my) ['"]?service|certificates? of conformity|copies of (the )?soc\b|request a soc\b|\biva test|parts? department|part number|door mirror|wing mirror|autodimming/i);
if (aftersalesMatch) {
if (isMotabilityHandback(lowered) && !/next car|newer|replace/i.test(lowered)) flagCtx.motab = true;
return Object.assign(R(6, 'Aftersales', 8, 'high', 'Aftersales/recall/warranty/admin wording (Section 3.6.9).'), { matched: aftersalesMatch[0] });
}
// A day+time still wins over a plain Motability handback: a scheduled
// visit is a real appointment.
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

// Step 9: free-text date/time. Also used by the reschedule check to see
// if the request itself carries a new day/time.
function freeTextDateTime(text) {
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
function systemTemplates(text, lowered, camp, src, flagCtx) {
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

const sourceFieldMatch = text.match(/Comment Line #1:\s*Source:\s*([\s\S]*)$/i);
if (sourceFieldMatch) {
const formName = sourceFieldMatch[1];
// 7.9: a form name containing Motability goes to 3.6, not this rank.
if (isMotabilityText(low(formName))) {
flagCtx.motab = true;
return R(3, 'Motability: Information Only', 6, 'high', 'Comment Line #1: Source: template naming a Motability form (Section 7.9).');
}
// 8.2 v1.10: Register Interest / Keep Me Informed forms are a passive
// sign-up, not this phone-led rank.
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
if (/ds certified-trade in-(ads|generic)|bonus reprise/i.test(text)) { return R(5, 'Valuation Only / Sell Only', 6, 'high', 'DS Certified trade-in template (Section 7.3).'); }
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
// Day+time still wins: fall through to step 9.
if (hasDayMention(text) && hasClockTime(text)) return null;
if (/visit|test drive|order|view|come in|see the car/i.test(lowered)) {
return R(3, 'Motability Enquiry: Visit Intent', 5, 'medium', 'Motability wording + visit intent (Section 7.9).');
}
return R(3, 'Motability: Information Only', 6, 'medium', 'Motability wording, question only (Section 7.9).');
}

// 7.13: marketplace templates.
const marketplaceResult = marketplaceTemplates(text, lowered, camp, src, flagCtx);
if (marketplaceResult) return marketplaceResult;

// 7.14: live chat templates (Source = Live chat only; the same wording on
// any other source is an agent note, handled in step 5).
if (src === 'live chat') {
const liveChatResult = liveChatTemplates(text, lowered, flagCtx);
if (liveChatResult) return liveChatResult;
}

// 7.15: Spoticar templates.
const spoticarResult = spoticarTemplates(text, lowered, flagCtx);
if (spoticarResult) return spoticarResult;

// Section 5, Tier 4 rank 7: Used Stock Search. No specific car, but at
// least one concrete criterion alongside "looking for" (vague requests are 5.9).
if (/looking for a\b|i'?m looking for\b/i.test(lowered) && /\b20\d{2}\b|onwards|or newer|automatic|manual|hybrid|electric|petrol|diesel|\bblack\b|\bwhite\b|\bblue\b|\bred\b|\bseater\b/i.test(lowered)) {
return R(4, 'Used Stock Search', 7, 'medium', 'Concrete stock-search criteria, no specific car identified (Section 5, Tier 4 rank 7).');
}

// Section 5, Tier 4 rank 3: Detailed quote. Real terms on a model with no
// specific stock car.
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
if (/\/service\//i.test(path)) return R(5, 'Valuation: Service Page', 14, 'medium', 'Service-area valuation page (Section 7.2, confirmed by manual review).');
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
return R(6, 'Already Booked', 2, 'high', 'Vehicle URL comment references an existing booking (Section 5, Tier 3 rank 10).');
}
if (hasDayMention(comment) && hasClockTime(comment)) return R(1, 'Customer-Stated Slot', 3, 'high', 'Vehicle URL comment with day + time (Section 5, Tier 1 rank 3).');
if (hasDayMention(comment)) return R(2, 'Customer-Stated Day', 3, 'medium', 'Vehicle URL comment with a day only (Section 5, Tier 2 rank 3).');
if (/on pcp with yourselves|finance with (us|stellantis)|voluntarily terminate.{0,60}(change|reduce|newer|replace)/i.test(commentLower)) {
return R(4, 'Existing Customer: Upgrade', 1, 'medium', 'Vehicle URL comment: existing customer with car/finance with us (Section 3.6.4).');
}
if (/currently have|owe just under|wanting a.*pcp/i.test(commentLower) && hasFinanceWording(commentLower)) {
flagCtx.finance = true;
return R(3, 'Finance Quote Request: Specific Car', 9, 'high', 'Vehicle URL comment with finance terms on an identified car (Section 5, Tier 3 rank 9).');
}
return R(3, 'Vehicle URL / Video Request', 10, 'medium', 'Vehicle URL with spec/history question (Section 7.5).');
}

function autofunnelResult(text, lowered, flagCtx) {
return R(5, 'Email Campaign (Autofunnel)', 10, 'medium', 'Autofunnel template (Section 7.6).');
}

function mbMailResult(text, lowered, flagCtx) {
const findOutMore = (field(text, 'FindOutMore') || '').toLowerCase();
// Reviewers tiered on Purchase timeframe: ASAP / Within 3 Months = Warm
// Enquiry, Just Browsing = Nurture.
const enquiry = field(text, 'Enquiry');
if (!findOutMore && enquiry !== null) {
const purchase = (field(text, 'Purchase') || '').toLowerCase();
const part = (field(text, 'Part') || '').toLowerCase();
if (/finance/i.test(enquiry)) flagCtx.finance = true;
if (/^(asap|within 3 months)$/.test(purchase)) {
return R(4, 'MB Mail Enquiry: Near-term Purchase', 12, 'high', `MB Mail form, Purchase = ${field(text, 'Purchase')} (manual review).`);
}
if (/^just browsing$/.test(purchase)) {
// Part-Exchange as the only option was tiered both 5 and 6 by reviewers,
// so it stays low confidence (Needs Review).
if (/^part-exchange$/i.test(enquiry.trim())) {
return R(5, 'MB Mail Enquiry Form', 11, 'low', 'MB Mail form, Just Browsing with Part-Exchange as the only option - reviewers split 5/6 on this shape.');
}
return R(5, 'MB Mail Enquiry Form', 11, 'high', 'MB Mail form, Purchase = Just Browsing (manual review).');
}
}
if (/test drive/i.test(findOutMore)) return R(5, 'MB Mail Enquiry Form', 11, 'medium', 'MB Mail form, Test Drive ticked (Section 7.6, top of group).');
return R(5, 'MB Mail Enquiry Form', 11, 'low', 'MB Mail form (Section 7.6, bottom of group).');
}

function marketplaceTemplates(text, lowered, camp, src, flagCtx) {
if (src === 'autotrader' || src.startsWith('autotrader')) {
const tsMatch = text.match(/Message from Consumer at \w{3}, \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2}\s*[AP]M:/i);
if (tsMatch) {
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
if (/are you able to transfer this to|transfer this to/i.test(msgLower)) { return R(3, 'Used Enquiry: Specific Car', 7, 'medium', 'CarGurus transfer + view request (Section 5, Tier 3 rank 7).'); }
if (/i'?m interested in this.*and i'?d like to know if it'?s still available|i am interested in your.*you can reach me by/i.test(msgLower)) {
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'low', 'CarGurus bare enquiry template (Section 7.13, bottom).');
}
return R(4, 'Marketplace Enquiry (non-Autotrader)', 8, 'medium', 'CarGurus message (Section 7.13).');
}
}
if (src === 'aa cars') {
const m = text.match(/Reg:\s*(\S+)\s*\|\s*Message from customer:\s*([\s\S]*?)\s*\|?\s*$/i);
if (m) {
const msg = m[2];
const msgLower = msg.toLowerCase();
// Day/time check, as every sibling marketplace branch does before its
// generic fallback.
if (hasDayMention(msgLower) && hasClockTime(msgLower)) return R(1, 'Customer-Stated Slot', 3, 'high', 'AA Cars message with day+time (Section 5, Tier 1 rank 3).');
if (hasDayMention(msgLower)) return R(2, 'Customer-Stated Day', 3, 'high', 'AA Cars message with a day only (Section 5, Tier 2 rank 3).');
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
if (/transfer|move.*to/i.test(commentLower)) { return R(3, 'Used Enquiry: Specific Car', 7, 'medium', 'Spoticar form, transfer request (Section 7.15).'); }
if (hasFinanceWording(commentLower) && !/no finance owned/i.test(commentLower)) { flagCtx.finance = true; return R(3, 'Finance Quote Request: Specific Car', 9, 'medium', 'Spoticar form, finance terms (Section 7.15).'); }
if (/part ?ex|\bpx\b|trade ?in/i.test(commentLower) && !/purchase|\bbuy\b|straight swap|go ahead|ready to/i.test(commentLower)) { return R(4, 'Valuation + VOI Stated', 9, 'medium', 'Spoticar form, interest in the car with a part exchange (manual review).'); }
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
// Labelled first, falling back to segment 0 when it does not look like
// another known field.
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
if (/google-search-|google-pmaxsearch-|google-demandgen-/i.test(codeLower)) return R(5, 'Enquiry: Blank', 9, 'medium', 'Google search marketing code (Section 8.2).');
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
// Ahead of the generic fallback, which also covers other code families.
if (/^social-meta-/i.test(codeLower) && /\b(fb\.me|facebook\.com)\b/i.test(commentsLower)) {
return R(5, 'Quote / Offer Request: Blank', 4, 'high', "Social/Meta ad click-through - comment is just the ad's own vehicle/price blurb with a facebook tracking link, no free text (Section 8.2).");
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
if (/^affiliates-/i.test(codeLower) && (!comments || comments === '-')) return R(5, 'Enquiry: Blank', 9, 'medium', 'Affiliate marketing code, blank comment (manual review).');
if (/brandsite-quote/i.test(codeLower) && (!comments || comments === '-')) return R(5, 'Quote / Offer Request: Blank', 4, 'medium', 'BrandSite-Quote marketing code, blank comment (manual review).');
if (/brandsite-enquiry/i.test(codeLower)) {
if (!comments || comments === '-') return R(4, 'Brand Site Enquiry (blank)', 6, 'medium', 'BrandSite-Enquiry marketing code, blank comment (manual review).');
return null; // classify by comment
}
// Hyphenated Pop-in-Test-Drive-* is a different family from the underscore
// one above; reviewers tiered it as Warm Enquiry. Fiat/Abarth is caught earlier.
if (/^pop-in-test-drive-/i.test(codeLower)) {
if (!comments || comments === '-') return R(4, 'Pop-in Test Drive (CDP)', 6, 'high', 'Pop-in-Test-Drive-* marketing code, blank comment (manual review).');
return null;
}
if (/^pch offers pages$/i.test(codeLower)) {
if (!comments || comments === '-') return R(4, 'Offer Request: PCH Offers Page', 5, 'medium', 'PCH Offers Pages marketing code, blank comment (manual review).');
return null;
}
if (/register interest|keep me informed/i.test(codeLower)) return R(5, 'Enquiry: Blank', 9, 'medium', 'Register Interest/Keep Me Informed marketing code (Section 8.2, v1.10).');
if (/Event-\S*TestDrive/i.test(text) && /\d{4}-\d{2}-\d{2}\s*(Slot\s*\d+|Morning|Afternoon|Evening)/i.test(text)) {
return R(2, 'Event Slot', 4, 'high', 'Event test drive slot template (Section 8.2).');
}
if (/event-motability-/i.test(codeLower)) { flagCtx.motab = true; return R(3, 'Motability: Information Only', 6, 'high', 'Event-Motability marketing code (Section 8.2).'); }
return null;
}

// Step 10: campaign rules (Section 8.3).
function campaignRules(text, lowered, camp, src, flagCtx, leadRequest) {
// Reviewers tiered a bare website lead whose lead request is Motability
// as Likely Booking; the notes alone say nothing.
if (isMotabilityText(low(leadRequest)) && /^sourced from [^.]*\.?$/i.test(text.trim())) {
flagCtx.motab = true;
return R(3, 'Motability: Information Only', 6, 'medium', 'Bare website lead with a Motability lead request (manual review).');
}
// A finance or monthly price question about a car in stock or in the
// lead: Warm (manual review), below the Spoticar and template rules.
if (/per month|monthly|\bhp\b|\bpcp\b|finance/i.test(lowered) && /this car|the car|this vehicle|in stock|you have|registration:|\bthe peugeot|\bthe citroen|\bthe vauxhall|\bwhat this works out/i.test(lowered) && !/no finance|self financ/i.test(lowered)) {
flagCtx.finance = true;
return R(4, 'Quote / Offer Request: Detailed', 3, 'medium', 'Finance or monthly price question about a specific car (manual review).');
}
if (/reserve\s*-\s*(new|used)/i.test(camp)) {
if (hasDayMention(text) && hasClockTime(text)) return R(1, 'Reserve with Appointment', 5, 'high', 'Reserve campaign with day+time (Section 8.3).');
return R(3, 'Reserve Online', 3, 'medium', 'Reserve campaign (Section 8.3).');
}
// Leapmotor with nothing more specific matched is the "ID only" case
// (Section 5, Tier 3 rank 4).
if (/leapmotor/i.test(src) || /leapmotor/i.test(camp)) {
return R(3, 'Leapmotor (ID only)', 4, 'high', 'Leapmotor source/brand, only a Lead ID (Section 5, Tier 3 rank 4).');
}
return null;
}

// Section 9.1: dedupe key per row. null when no rule applies (the spec's
// known limit: cross-channel duplicates cannot be caught by text alone).
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

// Section 9.1: dedupe pass over already-classified results, since keys
// depend on Initial Notes read live. Accessors keep it shape-agnostic.
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

window.KonnectLeadChecker = window.KonnectLeadChecker || {};
window.KonnectLeadChecker.classifyLead = classifyLead;
window.KonnectLeadChecker.computeDedupeKey = computeDedupeKey;
window.KonnectLeadChecker.applyDedupe = applyDedupe;
window.KonnectLeadChecker.hasClockTime = hasClockTime;
window.KonnectLeadChecker.hasDayMention = hasDayMention;
window.KonnectLeadChecker.stripSystemSuffixes = stripSystemSuffixes;


// ===================================================================
// SEARCH (OPEN_SEARCH -> SET_SEARCH_TYPE -> ENTER_IDENTIFIER ->
// SUBMIT_SEARCH -> READ_RESULTS -> OPEN_CUSTOMER)
// ===================================================================

function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

// Angular's input/radio directives only react to real 'input'/'change'
// events, so those are dispatched after setting the value.
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

const SEARCH_TYPE_VALUES = { email: '4', phone: '3', name: '1', reg: '5' };

function findSearchTypeRadio(type) {
return document.querySelector(`input[name="bookingSearchBy"][value="${SEARCH_TYPE_VALUES[type]}"]`);
}

function findSearchInput() {
return document.querySelector('input[ng-model="uiSettings.searchText"]');
}

function findSearchButton() {
return document.getElementById('btnSearch');
}

function findRecordsFoundContainer() {
const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === 'Records Found:');
return label ? label.parentElement : null;
}

function findRecordsFoundValue() {
const container = findRecordsFoundContainer();
const span = container ? container.querySelector('span.ng-binding') : null;
return span ? span.textContent.trim() : null;
}

function findSearchSpinnerIcon() {
const container = findRecordsFoundContainer();
return container ? container.querySelector('i.fa-refresh') : null;
}

function isSearchSpinnerActive(icon) {
return !!icon && !icon.classList.contains('ng-hide');
}

function waitForElement(selector, timeout = 8000) {
return new Promise((resolve) => {
const existing = document.querySelector(selector);
if (existing) { resolve(existing); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, pageLimit(timeout));
const observer = new MutationObserver(() => {
const el = document.querySelector(selector);
if (el) { clearTimeout(timer); observer.disconnect(); resolve(el); return; }
// The page has jumped to the login screen: what is waited for will not
// come, so the wait ends now and the run can log in first.
if (/^#\/login/i.test(location.hash) && onLoginPage()) { clearTimeout(timer); observer.disconnect(); resolve(null); }
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

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

async function enterSearchIdentifier(value) {
const input = findSearchInput();
if (!input) return false;
setNativeValue(input, '');
input.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(20);
setNativeValue(input, value);
input.dispatchEvent(new Event('change', { bubbles: true }));
// The pause only gives the page time to take the value in. Where the page
// itself says it already has it, there is nothing to wait for.
if (!searchModelHolds(input, value)) await sleep(pagePause(150));
return input.value === value;
}

// True when the page's own model for this box already holds the value.
function searchModelHolds(input, value) {
try {
const model = window.angular && window.angular.element(input).controller('ngModel');
return !!model && model.$modelValue === value;
} catch (error) { return false; }
}

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

function isSafeCustomerLink(link) {
const href = (link.getAttribute('href') || '').trim().toLowerCase();
return !href.startsWith('mailto:') && !href.startsWith('tel:');
}

window.KonnectLeadChecker.openSearchPage = openSearchPage;
window.KonnectLeadChecker.selectSearchType = selectSearchType;
window.KonnectLeadChecker.enterSearchIdentifier = enterSearchIdentifier;
window.KonnectLeadChecker.readSearchResultRows = readSearchResultRows;
window.KonnectLeadChecker.isSafeCustomerLink = isSafeCustomerLink;

// ===================================================================
// TIMELINE READINESS (WAIT_FOR_TIMELINE)
//
// The route changes (~825ms) before the timeline finishes loading
// (~1000-1160ms), so readiness is route + both roots + spinner hidden +
// Refresh visible. Pink entries are not required: a customer can have
// zero sales leads and still be fully loaded.
// ===================================================================

const CONNECTED_CUSTOMER_ROUTE_PATTERN = /^#\/connectedCustomer\/\d+(?:\?|$)/;
const CUSTOMER_ROOT_SELECTOR = 'div[ng-view] > div.ng-scope:has(> .row.timeline-editing-header)';
const CUSTOMER_ROOT_FALLBACK_SELECTOR = 'div.ng-scope:has(> .row.timeline-editing-header)';
const TIMELINE_ROOT_SELECTOR = 'div[ng-view] > div.ng-scope:has(> .row.timeline-editing-header) > div[style="margin-top:80px;"]';
const TIMELINE_ROOT_FALLBACK_SELECTOR = '.row.timeline-editing-header + div[style="margin-top:80px;"]';
const TIMELINE_LOADING_SELECTOR = 'i[title="Refreshing..."][ng-show="loading"]';
const TIMELINE_REFRESH_READY_SELECTOR = 'i[title="Refresh"][ng-show="!loading"]';

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

// Pure. The readiness decision from what the page shows.
function timelineReadyStateFrom(seen) {
if (!seen.routeActive) return { state: 'NOT_READY', reason: 'Connected-customer route not active' };
if (!seen.hasRoots) return { state: 'NOT_READY', reason: 'Customer or timeline root absent' };
if (seen.loading || !seen.refreshReady) {
return { state: 'LOADING', reason: seen.loading ? 'Refreshing indicator is visibly rendered' : 'Refresh control is not yet visibly rendered' };
}
if (seen.pinkEntries > 0) {
return { state: 'READY_WITH_SALES_LEADS', reason: 'Loading indicator hidden, Refresh visible, eligible pink entries present', eligiblePinkEntries: seen.pinkEntries };
}
return { state: 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS', reason: 'Loading indicator hidden and Refresh visible; no eligible pink entries present', eligiblePinkEntries: 0 };
}

function getTimelineReadyState() {
const routeActive = CONNECTED_CUSTOMER_ROUTE_PATTERN.test(window.location.hash);
const timelineRoot = routeActive ? findTimelineRoot() : null;
const hasRoots = !!(routeActive && findCustomerRoot() && timelineRoot);
const state = timelineReadyStateFrom({
routeActive, hasRoots,
loading: hasRoots && isRendered(document.querySelector(TIMELINE_LOADING_SELECTOR)),
refreshReady: hasRoots && isRendered(document.querySelector(TIMELINE_REFRESH_READY_SELECTOR)),
pinkEntries: hasRoots ? timelineRoot.querySelectorAll('a.connected-customer-timeline-centre-pink').length : 0
});
if (state.eligiblePinkEntries !== undefined) state.timelineRoot = timelineRoot;
return state;
}

// How long a ready timeline must hold the same entries before it is read.
const TIMELINE_SETTLE_MS = 150;

function waitForTimelineReady(timeout = 10000) {
return new Promise((resolve) => {
const startedAt = Date.now();
const limit = pageLimit(timeout);
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
}, pagePause(TIMELINE_SETTLE_MS));
}

function check() {
if (settled) return true;
const state = getTimelineReadyState();
if (state.state === 'READY_WITH_SALES_LEADS' || state.state === 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS') {
if (!settleTimer || state.eligiblePinkEntries !== lastEntryCount) scheduleSettleCheck(state);
return false;
}
if (Date.now() - startedAt >= limit) {
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

async function openCustomerAndWaitForTimeline(customerResult, timeout = 10000) {
if (!customerResult || !customerResult.link || !isSafeCustomerLink(customerResult.link)) {
return { state: 'FAILED', reason: 'CUSTOMER_NOT_LINKED' };
}
customerResult.link.click();
return waitForTimelineReady(timeout);
}

window.KonnectLeadChecker.getTimelineReadyState = getTimelineReadyState;
window.KonnectLeadChecker.waitForTimelineReady = waitForTimelineReady;
window.KonnectLeadChecker.openCustomerAndWaitForTimeline = openCustomerAndWaitForTimeline;

runSelfTest('timelineReadinessSelfTest', function timelineReadinessSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

check('connected customer route matches', CONNECTED_CUSTOMER_ROUTE_PATTERN.test('#/connectedCustomer/3487237?redirectRoute=%2Fsearch'), true);
check('connected customer route matches with no query', CONNECTED_CUSTOMER_ROUTE_PATTERN.test('#/connectedCustomer/3487237'), true);
check('search route does not match', CONNECTED_CUSTOMER_ROUTE_PATTERN.test('#/search?redirectRoute=%2Fsearch'), false);
const seen = { routeActive: true, hasRoots: true, loading: false, refreshReady: true, pinkEntries: 2 };
const stateOf = (patch) => timelineReadyStateFrom({ ...seen, ...patch }).state;
check('ready with sales leads', stateOf({}), 'READY_WITH_SALES_LEADS');
check('ready with no sales leads is still ready', stateOf({ pinkEntries: 0 }), 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS');
check('the route alone is not ready', stateOf({ hasRoots: false }), 'NOT_READY');
check('another route is not ready', stateOf({ routeActive: false }), 'NOT_READY');
check('the refreshing icon means loading, whatever else shows', stateOf({ loading: true }), 'LOADING');
check('no Refresh control yet means loading', stateOf({ refreshReady: false }), 'LOADING');
check('entries are only counted once ready', timelineReadyStateFrom({ ...seen, loading: true }).eligiblePinkEntries, undefined);

if (failures.length > 0) {
console.error('KonnectLeadChecker timeline-readiness self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker timeline-readiness self-test passed (10/10)');
}
});

// ===================================================================
// TIMELINE (SCAN_LOADED_ENTRIES -> MATCH_CREATED_DATETIME ->
// OPEN_LEAD_MODAL -> WAIT_FOR_REQUIRED_FIELDS -> VALIDATE_LEAD ->
// EXTRACT_INITIAL_NOTES)
// ===================================================================

// Pink styling is not specific to leads (most pink entries are "Email
// sent" or "New Sales Event Opportunity Added"), so this heading-prefix
// allowlist is what identifies a genuine lead entry.
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

// Direct text nodes first (the Lead ID lives in its own child span), with
// a sanitized-clone fallback if that comes back empty.
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

// Never falls back to Date.parse(): these UK-ordered strings misparse.
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

// Pending Customers' Last Actioned value uses Konnect's convention: no
// year for the current year ("26 Sep 14:18"), a year for older ones.
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

const isoLike = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
if (isoLike) {
return { year: Number(isoLike[1]), month: Number(isoLike[2]) - 1, day: Number(isoLike[3]), hour: Number(isoLike[4]), minute: Number(isoLike[5]) };
}

return null;
}

// Reduced to the "D MMM YYYY HH:mm" shape parseTimelineTimestamp handles.
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

// Only an exact minute match is a candidate. Several at the same minute
// are all kept for the caller to validate through their modals.
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
// CALL-ENTRY FALLBACK
//
// Pending Customers leads export Last Actioned, not a created time. That
// runs 0 to 3 minutes AT OR AFTER the blue call entry's own time (a sync
// delay, not rounding), so the match is a one-directional window (see
// CALL_MATCH_TOLERANCE_MINUTES).
//
// DOM proximity is not reliable (an unrelated lead can sit between a call
// and its lead) and blue rows show no Lead ID. The call's Angular scope
// LeadID is the only reliable link, used only to pick which detected lead
// entry a call belongs to, not to detect lead-ness.
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

// Unlike the pink rows, there is no Lead ID span to strip here.
function extractCallHeadingText(row) {
const title = row.querySelector('.connected-customer-title-lightblue');
return title ? title.textContent.replace(/\s+/g, ' ').trim() : null;
}

// A call entry whose LeadID can't be read or doesn't match is never
// counted; if the target's LeadID can't be read, nothing counts. readScope
// is injectable so self-tests never touch the real `angular` global.
function anyCallEntryIndicatesAlreadyEngaged(callEntryRows, targetLeadId, readScope) {
const resolveScope = readScope || readTimelineItemScope;
if (!targetLeadId) return false;
return callEntryRows.some((row) => {
const item = resolveScope(row);
const rowLeadId = item && item.LeadID != null ? String(item.LeadID) : null;
if (rowLeadId !== targetLeadId) return false;
const heading = extractCallHeadingText(row);
if (heading == null) return false;
return /\bscheduled a call\b/i.test(heading) || /\bspoke to customer\b/i.test(heading);
});
}

function hasAlreadyEngagedCallEntry(targetLeadId) {
return anyCallEntryIndicatesAlreadyEngaged(getLoadedCallEntries(), targetLeadId);
}

// Read from each row's Angular scope, since these rows share no styling.
// TimelineItemType: 1 = lead created, 2 = sent to Enquiry Max, 3 = call,
// 9 = final outcome, 20 = Post Closure Note sent.
function getAllTimelineRows() {
return [...document.querySelectorAll('div.row.ng-scope[ng-repeat*="customerTimeLine"]')];
}

function anyTimelineRowIsLeadRejected(timelineRows, targetLeadId, readScope) {
const resolveScope = readScope || readTimelineItemScope;
if (!targetLeadId) return false;
return timelineRows.some((row) => {
const item = resolveScope(row);
if (!item || item.LeadID == null) return false;
if (String(item.LeadID) !== targetLeadId) return false;
if (Number(item.TimelineItemType) !== 9) return false;
return /\blead rejected\b/i.test(String(item.Description || ''));
});
}

function hasRejectedTimelineRow(targetLeadId) {
return anyTimelineRowIsLeadRejected(getAllTimelineRows(), targetLeadId);
}

function getDistinctLeadCreationIds(timelineRows, readScope) {
const resolveScope = readScope || readTimelineItemScope;
const ids = timelineRows
.map((row) => resolveScope(row))
.filter((item) => item && item.LeadID != null && Number(item.TimelineItemType) === 1)
.map((item) => String(item.LeadID));
return [...new Set(ids)];
}

function anyOtherLeadWasRejected(timelineRows, targetLeadId, readScope) {
const resolveScope = readScope || readTimelineItemScope;
if (!targetLeadId) return false;
const distinctLeadIds = getDistinctLeadCreationIds(timelineRows, resolveScope);
if (distinctLeadIds.length !== 2 || !distinctLeadIds.includes(targetLeadId)) return false;
const otherLeadId = distinctLeadIds.find((id) => id !== targetLeadId);
return anyTimelineRowIsLeadRejected(timelineRows, otherLeadId, resolveScope);
}

function hasOtherLeadRejected(targetLeadId) {
return anyOtherLeadWasRejected(getAllTimelineRows(), targetLeadId);
}

// For when row.created matched no lead or more than one: finds the Post
// Closure lead by heading instead, only when exactly one is on the page.
function findUnambiguousPostClosureLeadId() {
const postClosureEntries = getLoadedLeadEntries().filter((row) => {
const heading = row.querySelector('.connected-customer-title-pink');
return heading && /post closure processing/i.test(heading.textContent);
});
if (postClosureEntries.length !== 1) return null;
return extractVisibleLeadId(postClosureEntries[0]);
}

// Why a Post Closure lead goes back through. Returns { reason, evidence };
// an empty reason means it needs contact. notes is { sent, team }: what
// was sent through to Enquiry Max (Follow Up tab) and the team's own notes.
function postClosureSendBackReason(targetLeadId, notes) {
if (!targetLeadId) return { reason: '', evidence: '' };
const engagedOnLead = hasAlreadyEngagedCallEntry(targetLeadId) || hasRejectedTimelineRow(targetLeadId) || hasOtherLeadRejected(targetLeadId);
return postClosureDecision(readAllTimelineItems(), targetLeadId, engagedOnLead, notes);
}

const SEND_BACK_REASONS = { dealer: 'Actioned by dealership', emailOnly: 'Email only', inMarket: "In market won't commit" };
// The Konnect Notes shorthand typed in the Post Closure box for each reason:
// CAD when the dealership acted, CAH when the hub spoke to the customer or
// sent it as email only and the dealership did nothing.
const SEND_BACK_SHORTHAND = { 'Actioned by dealership': 'CAD', 'Email only': 'CAH', "In market won't commit": 'CAH' };
// Notes that only record failed contact (voicemails, max attempts) are not
// a conversation, so they never mean in market.
const NO_CONTACT_NOTES = /no answer|voicemail|\bvm\b|max(imum)? attempts|unable to (reach|contact|get hold)|not answering|no response/i;
const SPOKE_NOTES = /spoke|spoken|in market|won'?t commit|wont commit/i;
// The line Konnect itself writes for a send. It says nothing about the
// customer, so it never decides anything.
const BARE_SEND_LINE = /^\s*lead sent to enquiry ?max\.?\s*$/i;

// Pure. True when the text says email only and does not say it is not
// ("not email only", "isn't an email only lead").
function saysEmailOnly(text) {
const source = String(text || '');
const re = /email only/gi;
let m;
while ((m = re.exec(source))) {
const before = source.slice(Math.max(0, m.index - 24), m.index);
if (!/\b(not|isn'?t|is not|wasn'?t|was not|no longer|never)\s+(an?\s+|strictly\s+|just\s+)?$/i.test(before)) return true;
}
return false;
}

function describeTimelineEntry(item) {
const when = item.AboveLineTitleDate || String(item.EventTime || '').slice(0, 16).replace('T', ' ');
const what = [item.BelowLineTitle, item.Description].map((x) => String(x || '').trim()).filter(Boolean).join(': ');
return `${what}${when ? ` (${when})` : ''}`;
}

function notesSnippet(text) {
const flat = String(text || '').replace(/\s+/g, ' ').trim();
return flat.length > 90 ? flat.slice(0, 87) + '...' : flat;
}

// Pure. Every Post Closure send back rule, in order:
// 1. The dealership acted: an entry only a dealer makes on this lead or
//    the matching earlier lead, or one naming the dealership a lead was
//    sent to, after the send (dealers often log on another lead).
// 2. The notes sent through to Enquiry Max say email only, or anything
//    else sent after a hub call means in market but would not commit.
// 3. Without those notes, the team's notes or the hub's call outcomes.
function postClosureDecision(items, postClosureLeadId, engagedOnLead, notes) {
const decide = (reason, evidence) => ({ reason, evidence: evidence || '' });
const match = postClosureSourceLead(items, postClosureLeadId);
const leadIds = [String(postClosureLeadId)].concat(match ? [String(match.source.LeadID)] : []);
const ownSends = items.filter((i) => Number(i.TimelineItemType) === 2 && String(i.LeadID) === String(postClosureLeadId))
.map((i) => ({ dealer: emDealerOf(i).toLowerCase(), at: eventTimeMs(i.EventTime) }))
.filter((x) => x.dealer && x.at != null);
const allSends = ownSends.concat(match ? match.sends : []);
const onLead = items.find((i) => isDealerAction(i) && leadIds.includes(String(i.LeadID)));
if (onLead) return decide(SEND_BACK_REASONS.dealer, describeTimelineEntry(onLead));
const afterSend = dealerActionAfterSend(items, allSends);
if (afterSend) return decide(SEND_BACK_REASONS.dealer, describeTimelineEntry(afterSend));
if (engagedOnLead) return decide(SEND_BACK_REASONS.dealer, 'Scheduled call, Spoke To Customer or Lead Rejected on this lead');
const sent = String((notes && notes.sent) || '').split(' | ').filter((part) => part.trim() && !BARE_SEND_LINE.test(part)).join(' | ').trim();
if (sent) {
if (saysEmailOnly(sent)) return decide(SEND_BACK_REASONS.emailOnly, `Sent through: ${notesSnippet(sent)}`);
if (SPOKE_NOTES.test(sent) || !NO_CONTACT_NOTES.test(sent)) return decide(SEND_BACK_REASONS.inMarket, `Sent through: ${notesSnippet(sent)}`);
}
if (allSends.length === 0) return decide('');
const team = String((notes && notes.team) || '');
if (saysEmailOnly(team)) return decide(SEND_BACK_REASONS.emailOnly, `Team notes: ${notesSnippet(team)}`);
if (!match || match.sends.length === 0) return decide('');
const lastSend = Math.max(...match.sends.map((x) => x.at));
const hubCalls = items.filter((i) => Number(i.TimelineItemType) === 3 && String(i.LeadID) === String(match.source.LeadID)
&& i.IsContactCentreAgent !== false && (eventTimeMs(i.EventTime) || Infinity) <= lastSend);
const text = (i) => `${i.BelowLineTitle || ''} ${i.Description || ''}`;
const emailCall = hubCalls.find((i) => /email only|no phone number/i.test(text(i)));
if (emailCall) return decide(SEND_BACK_REASONS.emailOnly, describeTimelineEntry(emailCall));
const spokeCall = hubCalls.find((i) => /outcome of spoke to customer|won'?t commit|in market/i.test(text(i)));
if (spokeCall) return decide(SEND_BACK_REASONS.inMarket, describeTimelineEntry(spokeCall));
return decide('');
}

function parseFollowUpDate(text) {
const m = String(text || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
if (!m) return null;
const month = MONTH_NAMES[m[2].toLowerCase()];
return month == null ? null : new Date(+m[3], month, +m[1], +m[4], +m[5]).getTime();
}

// Pure. What the agent said when the lead was sent through to Enquiry Max,
// from the lead window's Follow Up tab: the comments made within a few
// minutes of the newest send (the agent's notes sit beside the system
// line, often a minute before it). The system line itself is left out.
const SENT_NOTES_WINDOW_MS = 5 * 60 * 1000;
function sentThroughNotes(followUp) {
const list = (followUp || []).map((c) => ({ ...c, at: parseFollowUpDate(c.CreatedDate) }));
// The hub's own Post Closure note to Enquiry Max is not a send.
const sends = list.filter((c) => /enquiry ?max/i.test(String(c.Comment || '')) && !/post closure/i.test(String(c.Comment || '')));
if (sends.length === 0) return '';
const newest = sends.reduce((a, b) => ((b.at || 0) > (a.at || 0) ? b : a));
return list.filter((c) => c !== newest && c.at != null && newest.at != null && Math.abs(c.at - newest.at) <= SENT_NOTES_WINDOW_MS)
.concat(BARE_SEND_LINE.test(String(newest.Comment || '')) ? [] : [newest])
.map((c) => String(c.Comment || '').trim())
.filter((text) => text && !BARE_SEND_LINE.test(text) && !/post closure/i.test(text)).join(' | ');
}

// Pure. The lead the Post Closure lead was made from is the latest earlier
// lead with the same request for the same dealership ("'Enquiry Request'
// for Preston" in the lead's description). When that lead was sent to a
// dealership via Enquiry Max and the same dealership has since scheduled
// a call, the customer is engaged. Dealers often log that call against
// another lead (a walk-in they create), so the call's lead ID is not
// compared, only its dealership and time.
function leadRequestKey(item) {
const m = String(item.Description || '').match(/'([^']+)'\s+for\s+(.+?)\s+Lead\b/i);
return m ? `${m[1].trim().toLowerCase()}|${m[2].trim().toLowerCase()}` : '';
}

// Pure. The matching earlier lead and its Enquiry Max sends, or null.
function postClosureSourceLead(items, postClosureLeadId) {
const leads = items.filter((i) => Number(i.TimelineItemType) === 1);
const postClosure = leads.find((i) => String(i.LeadID) === String(postClosureLeadId));
const key = postClosure ? leadRequestKey(postClosure) : '';
const createdAt = postClosure ? eventTimeMs(postClosure.EventTime) : null;
if (!key || createdAt == null) return null;
const source = leads
.filter((i) => String(i.LeadID) !== String(postClosureLeadId) && leadRequestKey(i) === key && (eventTimeMs(i.EventTime) || Infinity) < createdAt)
.sort((x, y) => eventTimeMs(y.EventTime) - eventTimeMs(x.EventTime))[0];
if (!source) return null;
const sends = items.filter((i) => Number(i.TimelineItemType) === 2 && String(i.LeadID) === String(source.LeadID))
.map((i) => ({ dealer: emDealerOf(i).toLowerCase(), at: eventTimeMs(i.EventTime) }))
.filter((x) => x.dealer && x.at != null);
return { source, sends };
}

// Pure. The dealerships a timeline entry names: "... at Preston" or
// "Offer Sent by X for Preston". A Description can run over several lines,
// so each line gives its last such phrase and any of them can match.
function dealersNamedIn(item) {
return String(item.Description || '').split(/[\r\n]+/).map((line) => {
const m = line.match(/^.*\b(?:at|for)\s+(.+?)\s*\.?\s*$/i);
return m ? m[1].trim().toLowerCase() : '';
}).filter(Boolean);
}

// Pure. Entries only a dealership creates: an offer sent, an advisor
// confirming, a final outcome it set (No Sale, Lead Rejected, Sale), or a
// call its staff scheduled, completed or held with the customer.
function isDealerAction(item) {
const type = Number(item.TimelineItemType);
const title = String(item.BelowLineTitle || '');
if (type === 13 || type === 16) return true;
if (type === 9) return item.IsContactCentreAgent !== true && /\bset by\b/i.test(String(item.Description || ''));
if (type === 3) {
if (/\bscheduled a call\b/i.test(title)) return true;
return item.IsContactCentreAgent === false && /\bcompleted a call\b|\bspoke to customer\b|\boffer\b/i.test(title);
}
return false;
}

// A dealer action from the dealership a send went to, after that send,
// on any lead (dealers often log against a walk-in lead they create).
function dealerActionAfterSend(items, sends) {
return items.find((i) => {
if (!isDealerAction(i)) return false;
const at = eventTimeMs(i.EventTime);
const named = dealersNamedIn(i);
return at != null && sends.some((x) => named.includes(x.dealer) && at >= x.at);
}) || null;
}

// ===================================================================
// Self-test for already-engaged detection (row text from live customers).
// ===================================================================
runSelfTest('alreadyEngagedDetectionSelfTest', function alreadyEngagedDetectionSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}
// leadId undefined means the scope reader cannot resolve the row. The
// fake reader is injected so no real `angular` global is touched.
function fakeCallRow(headingText, leadId) {
return {
querySelector: (sel) => sel === '.connected-customer-title-lightblue' ? { textContent: headingText } : null,
__fakeLeadId: leadId
};
}
function fakeReadScope(row) {
return row.__fakeLeadId !== undefined ? { LeadID: row.__fakeLeadId } : null;
}

check('extractCallHeadingText reads the real heading text, whitespace collapsed',
extractCallHeadingText({ querySelector: (sel) => sel === '.connected-customer-title-lightblue' ? { textContent: '\n                            Charles Harvey called the customer with an outcome of No Answer Message Left\n                            ' } : null }),
'Charles Harvey called the customer with an outcome of No Answer Message Left');
check('extractCallHeadingText returns null when the title element is missing', extractCallHeadingText({ querySelector: () => null }), null);

check('No target LeadID at all - never guesses, always false regardless of what the calls say', anyCallEntryIndicatesAlreadyEngaged([fakeCallRow('Amanullah Mirlashari Scheduled a call', '123')], null, fakeReadScope), false);
check('Empty call history', anyCallEntryIndicatesAlreadyEngaged([], '123', fakeReadScope), false);

const voicemailOnlyRows = [
fakeCallRow('Charles Harvey called the customer with an outcome of No Answer Message Left', '123'),
fakeCallRow('Wajih Jamil called the customer with an outcome of No Answer Message Left', '123'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left', '123'),
fakeCallRow('Adam Ali called the customer with an outcome of No Answer Message Left', '123')
];
check('Real "needs contact" example (Sylvia Lyddy) - voicemail only, no engagement signal', anyCallEntryIndicatesAlreadyEngaged(voicemailOnlyRows, '123', fakeReadScope), false);

// Voicemails before and after the Scheduled a call entry: the entry
// matters, not its position.
const scheduledCallMixedIn = [
fakeCallRow('Darryl Nwafor called the customer with an outcome of No Answer Message Left', '456'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left', '456'),
fakeCallRow('Wajih Jamil called the customer with an outcome of No Answer Message Left', '456'),
fakeCallRow('Amanullah Mirlashari Scheduled a call', '456'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left', '456')
];
check('Real "do not contact again" example (Kevin Hu) - Scheduled a call mixed in among voicemail-only calls', anyCallEntryIndicatesAlreadyEngaged(scheduledCallMixedIn, '456', fakeReadScope), true);

// "Spoke To Customer" mixed among voicemail-only calls.
const spokeToCustomerMixedIn = [
fakeCallRow('Omari Duporte- Clarke called the customer with an outcome of No Answer Message Left', '789'),
fakeCallRow('Jamario Belnavis called the customer with an outcome of Spoke To Customer', '789'),
fakeCallRow('Henry Marnell called the customer with an outcome of Spoke To Customer', '789'),
fakeCallRow('Lillian Ferrando Auberton called the customer with an outcome of No Answer No Message Left', '789')
];
check('Real "wrongly filtered as a warm lead" example - Spoke To Customer is also an already-engaged signal', anyCallEntryIndicatesAlreadyEngaged(spokeToCustomerMixedIn, '789', fakeReadScope), true);

// Two leads on one timeline: an earlier lead with a Scheduled call and the
// current Post Closure lead with only voicemails.
const bradyRows = [
fakeCallRow('Some Agent Scheduled a call', '111'),
fakeCallRow('Henry Marnell called the customer with an outcome of No Answer Message Left', '222'),
fakeCallRow('Adam Ali called the customer with an outcome of No Answer Message Left', '222')
];
check('The unrelated earlier lead\'s Scheduled-call entry (different LeadID) is correctly excluded', anyCallEntryIndicatesAlreadyEngaged(bradyRows, '222', fakeReadScope), false);
check('Checking against the OTHER lead\'s own LeadID correctly finds its own Scheduled-call entry', anyCallEntryIndicatesAlreadyEngaged(bradyRows, '111', fakeReadScope), true);

const bradyWithGenuineSignal = bradyRows.concat([fakeCallRow('Someone Scheduled a call', '222')]);
check('A genuine engagement signal sharing the target\'s own LeadID still counts', anyCallEntryIndicatesAlreadyEngaged(bradyWithGenuineSignal, '222', fakeReadScope), true);

// A row whose LeadID can't be resolved is dropped, not guessed.
const unresolvableRow = fakeCallRow('Someone Scheduled a call', undefined);
check('A row with an unreadable LeadID never counts, even with a genuine engagement heading', anyCallEntryIndicatesAlreadyEngaged([unresolvableRow], '222', fakeReadScope), false);

if (failures.length > 0) {
console.error('KonnectLeadChecker already-engaged-detection self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker already-engaged-detection self-test passed (12/12)');
}
});

// ===================================================================
// Self-test for Lead Rejected detection (Type 9), read via Angular scope.
// ===================================================================
runSelfTest('leadRejectedDetectionSelfTest', function leadRejectedDetectionSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected "${expected}", got "${actual}"`);
}
function fakeScopeRow(item) {
return { __fakeItem: item };
}
function fakeReadScope(row) { return row.__fakeItem; }

// An older lead rejected by the dealer, and a newer Post Closure lead
// with no rows of its own yet.
const realTimeline = [
fakeScopeRow({ EventTime: '2026-09-30T16:50:00', TimelineItemType: 1, LeadID: 1385403, Description: 'Manually Created Sales Lead from Customer First' }),
fakeScopeRow({ EventTime: '2026-09-30T16:56:00', TimelineItemType: 3, LeadID: 1385403, Description: 'No Answer, Message Left.\r\nNo Activity Outcome\r\n' }),
fakeScopeRow({ EventTime: '2026-10-01T10:04:00', TimelineItemType: 3, LeadID: 1385403, Description: 'No Answer, Message Left.\r\nMax Attempts Reached, Sent to Dealer\r\n' }),
fakeScopeRow({ EventTime: '2026-10-01T10:05:00', TimelineItemType: 2, LeadID: 1385403, Description: 'Lead sent to Enquiry Max' }),
fakeScopeRow({ EventTime: '2026-10-02T11:06:00', TimelineItemType: 1, LeadID: 1386301, Description: 'Manually Created Sales Lead from Post Closure Processing' }),
fakeScopeRow({ EventTime: '2026-10-02T11:11:00', TimelineItemType: 3, LeadID: 1385403, Description: 'No Answer, Message Left.\r\nMax Attempts Reached\r\nNo Activity Outcome\r\n' }),
fakeScopeRow({ EventTime: '2026-10-02T11:24:00', TimelineItemType: 20, LeadID: 0, Description: 'Post Closure Note sent to Enquiry Max' }),
fakeScopeRow({ EventTime: '2026-10-02T11:52:00', TimelineItemType: 9, LeadID: 1385403, Description: 'Lead Rejected, set by Daniel Folger at Liverpool' })
];

check('The rejection belongs to the OLDER lead (1385403) - matches against its own LeadID', anyTimelineRowIsLeadRejected(realTimeline, '1385403', fakeReadScope), true);
check('The newer Post Closure lead (1386301) has no rows of its own at all yet - not wrongly matched to the older lead\'s rejection', anyTimelineRowIsLeadRejected(realTimeline, '1386301', fakeReadScope), false);
check('No target LeadID - never guesses', anyTimelineRowIsLeadRejected(realTimeline, null, fakeReadScope), false);
check('Empty timeline', anyTimelineRowIsLeadRejected([], '1385403', fakeReadScope), false);

const nonRejectionType9 = [fakeScopeRow({ EventTime: '2026-10-02T11:52:00', TimelineItemType: 9, LeadID: '555', Description: 'Some other final outcome, not a rejection' })];
check('Type 9 rows that are not actually a rejection do not match', anyTimelineRowIsLeadRejected(nonRejectionType9, '555', fakeReadScope), false);

const wrongTypeSameWords = [fakeScopeRow({ EventTime: '2026-10-02T11:52:00', TimelineItemType: 3, LeadID: '555', Description: 'Mentions Lead Rejected in passing but is not actually a Type 9 row' })];
check('Lead Rejected wording on a non-Type-9 row does not match - the type must be 9, not just the text', anyTimelineRowIsLeadRejected(wrongTypeSameWords, '555', fakeReadScope), false);

check('getDistinctLeadCreationIds finds exactly the 2 real leads on this timeline', getDistinctLeadCreationIds(realTimeline, fakeReadScope).join(','), '1385403,1386301');
check('The OTHER lead (1385403) being rejected counts for the Post Closure lead (1386301) being classified', anyOtherLeadWasRejected(realTimeline, '1386301', fakeReadScope), true);
check('Checking the rejected lead itself (1385403) against "other lead" finds no OTHER lead rejected (it IS the rejected one)', anyOtherLeadWasRejected(realTimeline, '1385403', fakeReadScope), false);
check('No target LeadID - never guesses', anyOtherLeadWasRejected(realTimeline, null, fakeReadScope), false);

const threeLeadTimeline = realTimeline.concat([fakeScopeRow({ EventTime: '2026-10-03T09:00:00', TimelineItemType: 1, LeadID: 999, Description: 'Manually Created Sales Lead from Customer First' })]);
check('3+ distinct leads is deliberately left unhandled (ambiguous without comparing Initial Notes) - does not wrongly attribute the rejection', anyOtherLeadWasRejected(threeLeadTimeline, '1386301', fakeReadScope), false);

if (failures.length > 0) {
console.error('KonnectLeadChecker leadRejectedDetection self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker leadRejectedDetection self-test passed (10/10)');
}
});

function readTimelineItemScope(row) {
try {
if (typeof angular === 'undefined') return null;
const scope = angular.element(row).scope();
return (scope && scope.item) || null;
} catch (error) {
return null;
}
}

// Errs wide: a wider window risks more AMBIGUOUS_CALL_MATCH (safe), not
// wrong matches.
const CALL_MATCH_TOLERANCE_MINUTES = 5;

function minutesSinceEpoch(parsed) {
if (!parsed) return null;
return Math.floor(new Date(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute).getTime() / 60000);
}

// Several calls can fall in the window; what matters is whether they
// agree on which lead.
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

function findLeadEntryByLeadId(leadId) {
if (!leadId) return null;
return getLoadedLeadEntries().find((row) => extractVisibleLeadId(row) === leadId) || null;
}

// A call from before the initial load window needs the same "load older
// and rescan" loop as the direct pink match.
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

function findLeadClickTarget(row) {
return row.querySelector('a.connected-customer-timeline-centre-pink > i[ng-click^="showDetails("]');
}

function isVisible(element) {
if (!(element instanceof Element)) return false;
const rect = element.getBoundingClientRect();
const style = getComputedStyle(element);
return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function findActiveLeadModalState() {
const modal = Array.from(document.querySelectorAll('.modal[role="dialog"].in')).find(isVisible);
if (!modal) return null;
const panel = modal.querySelector('.tab-pane.active') || modal;
const notes = panel.querySelector('#txtInitialNotes');
if (!notes) return null;
// Date must have a real value, not just exist, before the modal is ready.
const dateValue = extractLabeledFooterField(panel, 'Date');
if (!dateValue) return null;
return { modal, panel, notes };
}

function waitForActiveLeadModal(timeout = 3000) {
return new Promise((resolve) => {
const existing = findActiveLeadModalState();
if (existing) { resolve(existing); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, pageLimit(timeout));
const observer = new MutationObserver(() => {
const state = findActiveLeadModalState();
if (state) { clearTimeout(timer); observer.disconnect(); resolve(state); }
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

// A slow-but-successful wait costs nothing.
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

function extractLabeledFooterField(panel, labelText) {
const labelDivs = Array.from(panel.querySelectorAll('div')).filter((el) => el.children.length === 0 && el.textContent.replace(/\s+/g, ' ').trim() === labelText);
for (const labelDiv of labelDivs) {
const container = labelDiv.parentElement;
const strong = container ? container.querySelector('footer strong.ng-binding') : null;
if (strong) return strong.textContent.replace(/\s+/g, ' ').trim();
}
return null;
}

function extractCampaignField(panel) {
const container = Array.from(panel.querySelectorAll('div')).find((el) => directText(el) === 'Campaign');
if (!container) return { primary: null, parenthetical: null };
const spans = Array.from(container.querySelectorAll(':scope > span'));
const primary = spans[0] ? spans[0].textContent.replace(/\s+/g, ' ').trim() : null;
const parenthetical = spans[1] ? spans[1].textContent.replace(/\s+/g, ' ').trim().replace(/^\(|\)$/g, '') : null;
return { primary, parenthetical };
}

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

// Keeps internal line breaks; only outer whitespace is trimmed.
function extractInitialNotes(panel) {
const el = panel.querySelector('#txtInitialNotes');
return el ? el.textContent.trim() : null;
}

function normalizeForCompare(value) {
return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Created date/time (already matched) is re-confirmed against the modal
// Date. Source and Campaign can reject a contradictory candidate but never
// redirect to a different lead.
function validateLeadCandidate(panelFields, candidateParsed, slaRow) {
const modalDateParsed = panelFields.date ? parseModalDate(panelFields.date) : null;
if (!datetimesMatchAtMinute(modalDateParsed, candidateParsed)) {
return { ok: false, reason: 'Modal Date does not match the candidate\'s own timeline minute.' };
}

if (slaRow.source && panelFields.source && normalizeForCompare(slaRow.source) !== normalizeForCompare(panelFields.source)) {
return { ok: false, reason: `Source contradicts: SLA="${slaRow.source}" modal="${panelFields.source}"` };
}

// Treating a mismatch here as a contradiction rejected correct leads, so
// it is a warning only.
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

window.KonnectLeadChecker.getLoadedLeadEntries = getLoadedLeadEntries;
window.KonnectLeadChecker.extractTimelineTimestamp = extractTimelineTimestamp;
window.KonnectLeadChecker.extractVisibleLeadId = extractVisibleLeadId;
window.KonnectLeadChecker.parseTimelineTimestamp = parseTimelineTimestamp;
window.KonnectLeadChecker.parseSlaCreated = parseSlaCreated;
window.KonnectLeadChecker.minutesSinceEpoch = minutesSinceEpoch;
window.KonnectLeadChecker.parseModalDate = parseModalDate;
window.KonnectLeadChecker.datetimesMatchAtMinute = datetimesMatchAtMinute;
window.KonnectLeadChecker.findMatchingLeadCandidates = findMatchingLeadCandidates;
window.KonnectLeadChecker.openLeadModal = openLeadModal;
window.KonnectLeadChecker.extractLeadPanelFields = extractLeadPanelFields;
window.KonnectLeadChecker.extractInitialNotes = extractInitialNotes;
window.KonnectLeadChecker.validateLeadCandidate = validateLeadCandidate;

function timelineEntryKey(row) {
const timestamp = extractTimelineTimestamp(row) || '';
const heading = row.querySelector('.connected-customer-title-pink')?.textContent.replace(/\s+/g, ' ').trim() || '';
const leadId = extractVisibleLeadId(row) || '';
return `${timestamp}||${heading}||${leadId}`;
}

function isAnyLeadModalVisible() {
return Array.from(document.querySelectorAll('.modal[role="dialog"].in')).some(isVisible);
}

function waitForLeadModalGone(timeout = 750) {
return new Promise((resolve) => {
if (!isAnyLeadModalVisible()) { resolve(true); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(!isAnyLeadModalVisible()); }, pageLimit(timeout));
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

// Progress is detected by diffing timelineEntryKey() sets, not by
// trusting the scroll call.
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

await sleep(pagePause(settleMs));
const afterKeys = getLoadedLeadEntries().map(timelineEntryKey);
if (afterKeys.some((key) => !beforeKeys.has(key))) {
return { status: 'OK', loadedNewEntries: true, scrollContainer: scrollTarget ? 'internal' : 'window' };
}
}

return { status: 'OK', loadedNewEntries: false, scrollContainer: scrollTarget ? 'internal' : 'window' };
}

// Email: trim + lowercase. Phone: digits only, +44 canonicalised to a
// leading 0. Registration is not part of the export.
function normalizeEmail(value) {
return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
// "+44 (0)7700 900123": the bracketed 0 is dropped with the country code.
const digits = String(value || '').replace(/\(0\)/g, '').replace(/\D+/g, '').replace(/^00(?=44)/, '');
if (digits.startsWith('44')) return '0' + digits.slice(2).replace(/^0/, '');
return digits;
}

// Matches the SLA-Manager.js "Copy for Lead Checker" export exactly.
const EXPECTED_BATCH_HEADER = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created'];

function parseBatchInput(rawText) {
const lines = String(rawText || '').split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
if (lines.length === 0) return { rows: [], headerOk: false, error: 'No input.' };

const header = lines[0].split('\t').map((h) => h.trim());
if (isNationalHeader(header)) return parseNationalBatch(lines);
if (isCustomerSearchHeader(header)) return parsePostClosureSearchBatch(header, lines);
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

// The agent desktop's customer search table, pasted to check Post Closure
// leads. It has no created time, so each customer's newest Post Closure
// Processing lead is the one checked.
const POST_CLOSURE_LIST_SOURCE = 'Post Closure Processing';
function isCustomerSearchHeader(header) {
return header[0] === 'Name' && header.includes('Magic Num') && header.includes('Best Number') && header.includes('Campaign');
}

function parsePostClosureSearchBatch(header, lines) {
const col = (name) => header.indexOf(name);
const rows = lines.slice(1).map((line, index) => {
const cells = line.split('\t');
const cell = (name) => (col(name) >= 0 ? (cells[col(name)] || '').trim() : '');
const name = cell('Name');
const phone = cell('Best Number');
const email = cell('Email');
const normalizedEmail = normalizeEmail(email);
const normalizedPhone = normalizePhone(phone);
const hasIdentifier = normalizedEmail.length > 0 || normalizedPhone.length > 0 || stripNameTitle(name).length > 0;
return {
inputIndex: index, mode: 'postClosureList',
name, phone, email, source: POST_CLOSURE_LIST_SOURCE, campaign: cell('Campaign'), created: '', dealer: cell('Dealer'),
normalizedEmail, normalizedPhone, parsedCreated: null,
groupKey: normalizedEmail || normalizedPhone || 'name:' + normalizeCustomerName(name),
status: hasIdentifier ? 'QUEUED' : 'INVALID_INPUT', exception: hasIdentifier ? null : 'NO_SEARCH_IDENTIFIER'
};
});
return { rows, headerOk: true, error: null, mode: 'postClosureList' };
}

// The newest Post Closure Processing lead entries loaded on the timeline,
// as lead candidates. More than one at the same minute stays ambiguous.
function findNewestPostClosureCandidates(referenceDate) {
const referenceNow = referenceDate || new Date();
const entries = getLoadedLeadEntries().filter((row) => {
const heading = row.querySelector('.connected-customer-title-pink');
return heading && /post closure processing/i.test(heading.textContent);
}).map((row) => {
const rawTimestamp = extractTimelineTimestamp(row);
const parsed = rawTimestamp ? parseTimelineTimestamp(rawTimestamp, referenceNow) : null;
return { row, rawTimestamp, parsed, leadId: extractVisibleLeadId(row) };
}).filter((c) => c.parsed);
if (entries.length === 0) return [];
const minutes = (c) => minutesSinceEpoch(c.parsed);
const newest = Math.max(...entries.map(minutes));
return entries.filter((c) => minutes(c) === newest);
}

// ===================================================================
// NATIONAL CHECK MODE
//
// Batch from SLA Manager's Customer Hub morning check, one row per lead.
// Each customer's timeline is read once and every lead gets a verdict
// (OK, Re setup, Check or Not found).
// ===================================================================

const NATIONAL_BATCH_HEADER = ['NationalCheck', 'Customer', 'Reg', 'ActivityID', 'LeadCreated', 'Campaign', 'Dealer', 'LastContact', 'State', 'ExportOutcome', 'Attempts', 'ManualReschedules', 'AutoReschedules', 'ExportHint'];
const NATIONAL_RESULT_HEADER = ['NationalResult', 'Customer', 'ActivityID', 'LeadID', 'Verdict', 'Reason', 'Attempts', 'FinalOutcome', 'EnquiryMaxDealer', 'FollowUpNotes', 'ResetCampaign', 'Reg'];
// "Re setup": set up again as a new lead. Older exports said "Reset".
const RE_SETUP = 'Re setup';
const NATIONAL_VERDICT_ORDER = [RE_SETUP, 'Check', 'Not found', 'OK'];
const NATIONAL_ADMIN_OUTCOMES = /test lead|duplicate record|invalid contact details|s&y invalid lead drop|multiple lead enq|gdpr restricted/i;
// HANDOVER: outcomes meant to pass the enquiry on; only these can be
// covered by a newer lead. DEAD_END: closures with nowhere to go unless
// also sent to a dealership through Enquiry Max.
const NATIONAL_HANDOVER_OUTCOMES = /sent direct to enquiry max|sent to dealer|closed - other activity/i;
const NATIONAL_DEAD_END_OUTCOMES = /email only|in market|not interested|just browsing|face to face|test drive|phone call|appointment|wont commit|won't commit|no answer|catch all|defer to site|video|sent direct to enquiry max|sent to dealer|closed - other activity|in progress with dealer|hub reservation|no appointment|no opportunity/i;

const NATIONAL_BOOKED_OUTCOMES = /face to face|test drive|phone call|appointment/i;
const NATIONAL_FULL_RUN_ATTEMPTS = 4;

function isNationalDealer(name) {
return /national/i.test(String(name || ''));
}

function isNationalHeader(header) {
return header.length === NATIONAL_BATCH_HEADER.length && header.every((h, i) => h === NATIONAL_BATCH_HEADER[i]);
}

// "dd/mm/yyyy HH:MM" from the Customer Hub export.
function parseNationalCreated(text) {
const m = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
if (!m) return null;
return { year: Number(m[3]), month: Number(m[2]) - 1, day: Number(m[1]), hour: Number(m[4]), minute: Number(m[5]) };
}

// Konnect's EventTime is its own wall clock, e.g. "2026-11-04T15:32:20.707+00:00"
// for a lead shown as "4 Nov 15:32". The digits are used as written.
function parseTimelineEventTime(text) {
const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
if (!m) return null;
return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) };
}

function eventTimeMs(text) {
const p = parseTimelineEventTime(text);
return p ? new Date(p.year, p.month, p.day, p.hour, p.minute).getTime() : null;
}

function normalizeCustomerName(value) {
return String(value || '').toLowerCase()
.replace(/\b(mr|mrs|miss|ms|mx|dr)\b\.?/g, ' ')
.replace(/[^a-z' -]/g, ' ')
.replace(/\s+/g, ' ')
.trim();
}

function normalizeReg(value) {
return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function parseNationalBatch(lines) {
const rows = lines.slice(1).map((line, index) => {
const c = line.split('\t').map((cell) => (cell || '').trim());
const row = {
inputIndex: index, mode: 'national',
name: c[1] || '', reg: c[2] || '', activityId: c[3] || '', created: c[4] || '',
campaign: c[5] || '', dealer: c[6] || '', lastContact: c[7] || '', state: c[8] || '',
exportOutcome: c[9] || '', attempts: c[10] || '', manualReschedules: c[11] || '',
autoReschedules: c[12] || '', exportHint: c[13] || '',
source: 'National', phone: '', email: '',
normalizedEmail: '', normalizedPhone: '',
parsedCreated: parseNationalCreated(c[4]),
groupKey: 'national:' + normalizeCustomerName(c[1]),
status: 'QUEUED', exception: null
};
if (c[0] !== 'national' || !row.name) { row.status = 'INVALID_INPUT'; row.exception = 'NO_SEARCH_IDENTIFIER'; }
else if (!row.parsedCreated) { row.status = 'INVALID_INPUT'; row.exception = 'INVALID_CREATED_DATETIME'; }
return row;
});
return { rows, headerOk: true, error: null, mode: 'national' };
}

// "Mr. Alex Sample" -> "Alex Sample": Konnect stores the title apart from
// the name, so searching with it finds nothing.
function stripNameTitle(name) {
return String(name || '').replace(/^\s*(mr|mrs|miss|ms|mx|dr)\b\.?\s+/i, '').replace(/\s+/g, ' ').trim();
}

// Pure. The distinct customer IDs a search could mean, best first. An
// exact name (titles ignored) wins outright: "Sam Buyer" must not pull in
// "Sam Buyerson". A looser "contains" match is only used when nothing is
// exact, and every linked row only when no name matches at all. Rows
// carrying one of the batch regs go first.
function nationalCandidateIds(rows, expectedName, regs) {
const withLinks = rows.filter((r) => r.link && r.customerId);
// Letters only: "O'Hara", "O Hara" and "OHara" are one name.
const key = (value) => normalizeCustomerName(value).replace(/[^a-z]/g, '');
const name = key(expectedName);
const exact = withLinks.filter((r) => name && key(r.customerName) === name);
const loose = withLinks.filter((r) => {
const candidate = key(r.customerName);
return candidate && name && (candidate.includes(name) || name.includes(candidate));
});
const pool = exact.length > 0 ? exact : (loose.length > 0 ? loose : withLinks);
const wanted = (regs || []).map(normalizeReg).filter(Boolean);
const ordered = wanted.length
? pool.filter((r) => wanted.includes(normalizeReg(r.registrationNumber))).concat(pool.filter((r) => !wanted.includes(normalizeReg(r.registrationNumber))))
: pool;
const ids = [];
ordered.forEach((r) => { if (!ids.includes(r.customerId)) ids.push(r.customerId); });
return ids.slice(0, 5);
}

// How often a running search is looked at, and how long its list must hold
// still to count as finished when no spinner was seen.
const SEARCH_POLL_MS = 50;
const SEARCH_SETTLE_MS = 300;

function searchGridSignature() {
return readSearchResultRows().map((r) => r.customerId || r.customerName).join('|') + '#' + (findRecordsFoundValue() || '');
}

// A search can finish before the spinner is ever seen, which would be
// reported as a timeout. This accepts either a full spinner cycle or,
// without one, a page that has changed and settled. Used by every search.
async function submitSearchAndSettle(timeout = 20000) {
const button = findSearchButton();
if (!button || button.disabled) return null;
const before = searchGridSignature();
// The spinner is watched as well as polled, so a search that starts and
// ends between two looks is still seen and is not waited out.
let sawSpinner = false;
const icon = findSearchSpinnerIcon();
const watcher = icon && typeof MutationObserver === 'function'
? new MutationObserver(() => { if (isSearchSpinnerActive(icon)) sawSpinner = true; }) : null;
if (watcher) watcher.observe(icon, { attributes: true, attributeFilter: ['class'] });
button.click();
const startedAt = Date.now();
const limit = pageLimit(timeout);
let lastSignature = before;
let stableSince = startedAt;
try {
while (Date.now() - startedAt < limit) {
await sleep(SEARCH_POLL_MS);
if (onLoginPage()) return null;
if (isSearchSpinnerActive(findSearchSpinnerIcon())) { sawSpinner = true; continue; }
const now = Date.now();
const elapsed = now - startedAt;
const signature = searchGridSignature();
if (signature !== lastSignature) { lastSignature = signature; stableSince = now; }
const settled = signature !== before && now - stableSince >= pagePause(SEARCH_SETTLE_MS);
if (sawSpinner || settled || elapsed > pageLimit(6000)) {
const raw = findRecordsFoundValue();
const count = raw !== null && raw !== '' && !isNaN(Number(raw)) ? Number(raw) : null;
// Records are counted before their rows are drawn: the rows are
// waited for, so a found customer is never read as an empty list.
if (count > 0 && readSearchResultRows().length === 0 && elapsed < pageLimit(6000)) continue;
return count !== null ? count : readSearchResultRows().length;
}
}
return null;
} finally {
if (watcher) watcher.disconnect();
}
}

// Opens one search result the way a person does: by clicking its row.
// The ID in a row's link is not always the one in the timeline address
// (Konnect resolves it on click), so the address is never built by hand.
// The search is run again first, so the rows clicked are always fresh.
async function openSearchResultById(searchFn, spec, customerId, session) {
const again = await searchFn(spec.type, spec.value, session);
if (again.status !== 'OK') return { state: 'FAILED' };
const row = again.rows.find((r) => r.customerId === customerId && r.link);
if (!row) return { state: 'FAILED' };
const state = await openCustomerAndWaitForTimeline(row, 15000);
if (state.state !== 'FAILED') await waitForTimelineItemsSettled();
return state;
}

// The timeline can still be filling in after it reports ready. Waits until
// the number of entries has stopped changing.
async function waitForTimelineItemsSettled(maxMs = 6000) {
const startedAt = Date.now();
const limit = pageLimit(maxMs);
let last = -1;
let stableSince = Date.now();
while (Date.now() - startedAt < limit) {
const n = getAllTimelineRows().length;
if (n !== last) { last = n; stableSince = Date.now(); }
else if (n > 0 && Date.now() - stableSince > pagePause(800)) return n;
await sleep(200);
}
return last;
}

// How many of this customer's batch leads are on the open timeline,
// loading older entries if some are missing.
async function countGroupLeadsOnTimeline(group, session, holdsLead) {
const check = holdsLead || ((row) => row.parsedCreated && findNationalLeadIds(readAllTimelineItems(), row.parsedCreated).length > 0);
const count = () => group.rows.filter((r) => check(r)).length;
let found = count();
for (let i = 0; found < group.rows.length && i < 3; i++) {
if (isCancelled(session)) break;
const scroll = await loadOlderTimelineEntries();
found = count();
if (scroll.status !== 'OK' || !scroll.loadedNewEntries) break;
}
return found;
}

// Opens each candidate record in turn and keeps the one whose timeline
// holds the most of this group's leads. Stops at the first that holds
// them all, which is the usual case: one person's search rows all open
// the same timeline. Returns null when none hold any of them.
async function openRecordHoldingLeads(ids, group, session, holdsLead, openById) {
let best = { id: null, found: 0 };
let openId = null;
for (const id of ids) {
if (isCancelled(session)) return null;
const state = await openById(id);
if (state.state === 'FAILED') continue;
openId = id;
const found = await countGroupLeadsOnTimeline(group, session, holdsLead);
if (found > best.found) best = { id, found };
if (found === group.rows.length) break;
}
if (!best.id) return null;
if (openId !== best.id) {
const state = await openById(best.id);
if (state.state === 'FAILED') return null;
}
return best.id;
}

// Pure. Konnect's name search loses names with an apostrophe, so those are
// also tried with a space in its place and as the part before it.
function nameSearchVariants(name) {
const clean = stripNameTitle(name);
const variants = [clean];
if (/['\u2019\u2018`]/.test(clean)) {
variants.push(clean.replace(/['\u2019\u2018`]/g, ' ').replace(/\s+/g, ' ').trim());
variants.push(clean.split(/['\u2019\u2018`]/)[0].trim());
}
return variants.filter((v, i) => v.length >= 3 && variants.indexOf(v) === i);
}

async function searchAndOpenNationalCustomer(group, session) {
const sample = group.rows[0];
const regs = group.rows.map((r) => r.reg).filter(Boolean);
const cancelled = { status: 'FAILED', exception: 'CANCELLED' };
const found = { status: 'OK', matchMethod: 'name', noEligibleEvents: false };
const tried = new Set();
// The first search that gave a record: where to land if no record holds
// the leads, so each lead can say "Not found" against a real timeline.
let fallback = null;
let lastStatus = 'SEARCH_NO_RESULTS';
// Every way in is tried until a record's timeline holds one of these
// leads: the name (titles off, apostrophes three ways), then each reg. A
// first match that is a namesake, or a second profile, does not end it.
const ways = nameSearchVariants(sample.name).map((value) => ({ type: 'name', value }))
.concat(regs.map((value) => ({ type: 'reg', value })));
for (const spec of ways) {
const search = await runCustomerSearch(spec.type, spec.value, session);
if (search.status === 'CANCELLED') return cancelled;
if (search.status !== 'OK') { lastStatus = search.status; continue; }
const all = nationalCandidateIds(search.rows, sample.name, spec.type === 'reg' ? [spec.value] : regs);
const ids = all.filter((id) => !tried.has(id));
if (!fallback && all.length) fallback = { spec, ids: all };
if (ids.length === 0) { if (all.length === 0) lastStatus = 'CUSTOMER_NOT_LINKED'; continue; }
ids.forEach((id) => tried.add(id));
const openById = (id) => openSearchResultById(runCustomerSearch, spec, id, session);
if (ids.length === 1) {
// One record: opened straight from these results, without searching again.
const row = search.rows.find((r) => r.customerId === ids[0]);
let state = await openCustomerAndWaitForTimeline(row);
if (isCancelled(session)) return cancelled;
// A timeline that did not load is given one more try.
if (state.state === 'FAILED') state = await openById(ids[0]);
if (isCancelled(session)) return cancelled;
if (state.state === 'FAILED') { lastStatus = 'TIMELINE_TIMEOUT'; continue; }
await waitForTimelineItemsSettled();
if (await countGroupLeadsOnTimeline(group, session) > 0) return found;
} else if (await openRecordHoldingLeads(ids, group, session, undefined, openById)) {
return found;
}
if (isCancelled(session)) return cancelled;
}
if (!fallback) return { status: 'FAILED', exception: lastStatus };
if (fallback.ids.length > 1) return { status: 'FAILED', exception: 'LEAD_NOT_ON_MATCHING_CUSTOMERS' };
const state = await openSearchResultById(runCustomerSearch, fallback.spec, fallback.ids[0], session);
if (isCancelled(session)) return cancelled;
if (state.state === 'FAILED') return { status: 'FAILED', exception: 'TIMELINE_TIMEOUT' };
return found;
}

runSelfTest('nationalSearchSelfTest', function nationalSearchSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
check('title removed with full stop', stripNameTitle('Mr. Alex Sample'), 'Alex Sample');
check('title removed without full stop', stripNameTitle('Miss Jo Example'), 'Jo Example');
check('name without a title is unchanged', stripNameTitle('Sam Buyer'), 'Sam Buyer');
check('a name starting with title letters is unchanged', stripNameTitle('Mrsa Smith'), 'Mrsa Smith');
const link = {};
const rows = [
{ link, customerId: '501', customerName: 'Alex Sample' },
{ link, customerId: '501', customerName: 'Alex Sample' },
{ link, customerId: '502', customerName: 'Mr Alex Sample' },
{ link, customerId: '503', customerName: 'Jo Example' }
];
check('duplicate rows for one record count once; other records with the name are candidates', nationalCandidateIds(rows, 'Mr. Alex Sample'), ['501', '502']);
check('no name match falls back to every linked record', nationalCandidateIds(rows, 'Unknown Person'), ['501', '502', '503']);
check('rows without a link are ignored', nationalCandidateIds([{ link: null, customerId: '9', customerName: 'Alex Sample' }], 'Alex Sample'), []);
const similar = [
{ link, customerId: '601', customerName: 'Sam Buyerson' },
{ link, customerId: '602', customerName: 'Sam Buyers' },
{ link, customerId: '603', customerName: 'Mr Sam Buyer', registrationNumber: 'AB12CDE' },
{ link, customerId: '604', customerName: 'Sam Buyer', registrationNumber: 'CD34EFG' }
];
check('an exact name shuts out longer names that contain it', nationalCandidateIds(similar, 'Sam Buyer'), ['603', '604']);
check('a row with a batch reg goes first', nationalCandidateIds(similar, 'Sam Buyer', ['CD34 EFG']), ['604', '603']);
check('with no exact name, names containing it are used', nationalCandidateIds(similar.slice(0, 2), 'Sam Buyer'), ['601', '602']);
if (failures.length > 0) {
console.error('KonnectLeadChecker national-search self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker national-search self-test passed');
}
});

function readAllTimelineItems(readScope) {
const resolveScope = readScope || readTimelineItemScope;
return getAllTimelineRows().map((row) => {
const item = resolveScope(row);
return item ? Object.assign({}, item, { __row: row }) : null;
}).filter(Boolean);
}

// Pure. The export and the timeline can disagree by a minute or so
// (14:15 vs 14:14 on a phone-call lead), so the closest lead within this
// many minutes is taken.
const NATIONAL_CREATED_TOLERANCE_MINUTES = 2;

// Pure. Fallback when no lead's created time matches: the lead whose call
// (type 3) is closest to the export's last contact, within the tolerance.
function findNationalLeadIdsByContact(items, parsedContact) {
const target = minutesSinceEpoch(parsedContact);
if (target === null) return [];
let bestDiff = Infinity;
let ids = [];
items.forEach((item) => {
if (Number(item.TimelineItemType) !== 3 || item.LeadID == null || !Number(item.LeadID)) return;
const minutes = minutesSinceEpoch(parseTimelineEventTime(item.EventTime));
if (minutes === null) return;
const diff = Math.abs(minutes - target);
if (diff > NATIONAL_CREATED_TOLERANCE_MINUTES) return;
const id = String(item.LeadID);
if (diff < bestDiff) { bestDiff = diff; ids = [id]; }
else if (diff === bestDiff && !ids.includes(id)) ids.push(id);
});
return ids;
}

// Pure. The lead-created times nearest a target, for a "Not found" reason.
function nearestLeadCreatedTimes(items, parsedCreated, limit = 3) {
const target = minutesSinceEpoch(parsedCreated);
return items
.filter((item) => Number(item.TimelineItemType) === 1 && item.LeadID != null && Number(item.LeadID))
.map((item) => ({ parsed: parseTimelineEventTime(item.EventTime) }))
.filter((x) => x.parsed)
.map((x) => ({ ...x, diff: target === null ? 0 : Math.abs(minutesSinceEpoch(x.parsed) - target) }))
.sort((a, b) => a.diff - b.diff)
.slice(0, limit)
.map(({ parsed: p }) => `${String(p.day).padStart(2, '0')}/${String(p.month + 1).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`);
}

function findNationalLeadIds(items, parsedCreated) {
const target = minutesSinceEpoch(parsedCreated);
if (target === null) return [];
let bestDiff = Infinity;
let ids = [];
items.forEach((item) => {
if (Number(item.TimelineItemType) !== 1 || item.LeadID == null) return;
const minutes = minutesSinceEpoch(parseTimelineEventTime(item.EventTime));
if (minutes === null) return;
const diff = Math.abs(minutes - target);
if (diff > NATIONAL_CREATED_TOLERANCE_MINUTES) return;
const id = String(item.LeadID);
if (diff < bestDiff) { bestDiff = diff; ids = [id]; }
else if (diff === bestDiff && !ids.includes(id)) ids.push(id);
});
return ids;
}

function emDealerOf(item) {
const m = String(item.Description || '').match(/received at\s+(.+?)\s*\.?\s*$/i);
return m ? m[1].replace(/\s+with\s+EMax confirmation$/i, '').trim() : '';
}

// A call covering several leads lists an outcome per lead under only one
// of them, so an outcome is only read when the entry has exactly one.
function outcomeFromCallDescription(description) {
const lines = String(description || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^sales\s*->/i.test(l));
if (lines.length !== 1) return null;
const last = lines[0].split('->').pop().trim();
return last.replace(/\s+at\s+[^>]+$/i, '').trim();
}

// Every outcome a call entry lists, one per "Sales -> ..." line.
function outcomeLinesOf(description) {
return String(description || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^sales\s*->/i.test(l))
.map((l) => l.split('->').pop().trim().replace(/\s+at\s+[^>]+$/i, '').trim());
}

// Pure. How a lead ended as its own timeline tells it: the outcomes on its
// last call, and how many real calls it had (an outcome update is not one).
function leadEndingFrom(items) {
const calls = items.filter((i) => Number(i.TimelineItemType) === 3).sort((a, b) => (eventTimeMs(a.EventTime) || 0) - (eventTimeMs(b.EventTime) || 0));
const last = calls[calls.length - 1];
const outcomes = last ? outcomeLinesOf(last.Description) : [];
return {
outcomes,
maxAttempts: outcomes.length > 0 && outcomes.every((o) => /max attempts/i.test(o)),
anyMaxAttempts: outcomes.some((o) => /max attempts/i.test(o)),
realCalls: calls.filter((i) => isAttemptItem(i) && !/outcome of update outcomes/i.test(String(i.BelowLineTitle || ''))).length
};
}

// Agreed standards for a Misdirected closure: the lead was never a sales
// enquiry. A Service Plan request, either named in the campaign's lead
// request or as the MB Mail aftersales notes ("Annual Mileage: ...
// Customer Number: ..."). Anything else stays for a person to check.
const NOT_SALES_LEAD_REQUEST_RE = /service plan/i;
const AFTERSALES_NOTES_RE = /annual mileage:[\s\S]*customer number:/i;

// Pure. Returns an OK verdict when the lead details confirm a Misdirected
// closure was right, otherwise null (the Check stands).
function resolveMisdirected(finalOutcome, details) {
if (!/misdirected/i.test(String(finalOutcome || '')) || !details) return null;
if (NOT_SALES_LEAD_REQUEST_RE.test(details.leadRequest || '')) {
return { verdict: 'OK', reason: `Misdirected correctly: not a sales lead (${details.leadRequest})` };
}
if (AFTERSALES_NOTES_RE.test(details.initialNotes || '')) {
return { verdict: 'OK', reason: 'Misdirected correctly: not a sales lead (Service Plan notes)' };
}
return null;
}

function parsedToMs(parsed) {
return parsed ? new Date(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute).getTime() : null;
}

function isAttemptItem(item) {
return Number(item.TimelineItemType) === 3 && item.IsContactCentreAgent !== false
&& /called the customer with an outcome of/i.test(String(item.BelowLineTitle || ''));
}

function formatShortTime(ms) {
if (ms == null) return '';
const d = new Date(ms);
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
return `${d.getDate()} ${months[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Pure. lead = { leadId, createdMs }. itemsForLead are this lead's own
// timeline items; allItems are the whole customer timeline; context.openLeadIds
// lists this customer's other leads that the export shows as still open.
function evaluateNationalLead(lead, itemsForLead, allItems, batchRow, context) {
const ctx = context || {};
const byTime = (a, b) => (eventTimeMs(a.EventTime) || 0) - (eventTimeMs(b.EventTime) || 0);
const own = [...itemsForLead].sort(byTime);
// The export records attempts, outcome and last call per lead. The
// timeline does not always: a call covering several leads is filed under
// one of them. So the export wins wherever it has a value.
const exportAttempts = parseInt(batchRow.attempts, 10);
const attempts = Number.isFinite(exportAttempts) && exportAttempts > 0 ? exportAttempts : own.filter(isAttemptItem).length;
// Only a send after the last call is what ended the lead. An earlier send
// (sent once, came back and was worked again) does not cover a later
// closure.
const exportLastCallMs = parsedToMs(parseNationalCreated(batchRow.lastContact));
const lastAttemptMs = exportLastCallMs || own.filter(isAttemptItem).reduce((max, i) => Math.max(max, eventTimeMs(i.EventTime) || 0), 0);
const sendItems = own.filter((i) => Number(i.TimelineItemType) === 2 && emDealerOf(i));
const currentSends = sendItems.filter((i) => (eventTimeMs(i.EventTime) || 0) >= lastAttemptMs - 2 * 60 * 1000).map(emDealerOf);
const earlierDealerSend = sendItems.filter((i) => (eventTimeMs(i.EventTime) || 0) < lastAttemptMs - 2 * 60 * 1000)
.map(emDealerOf).find((d) => !isNationalDealer(d));
const dealerSend = currentSends.find((d) => !isNationalDealer(d));
const nationalSend = currentSends.find((d) => isNationalDealer(d));
const latestOutcome = own.filter((i) => Number(i.TimelineItemType) === 3).map((i) => outcomeFromCallDescription(i.Description)).filter(Boolean).pop();
const finalOutcome = String(batchRow.exportOutcome || '').trim() || latestOutcome || '';
const base = { attempts, finalOutcome, enquiryMaxDealer: dealerSend || nationalSend || '' };
const verdict = (v, reason) => Object.assign({}, base, { verdict: v, reason });

// 1. Sent to a dealership.
if (dealerSend) return verdict('OK', `Sent to ${dealerSend} via Enquiry Max`);
const open = /in progress/i.test(String(batchRow.state || ''));
// 3 and 4. Acceptable closing outcomes.
if (!open && /max attempts/i.test(finalOutcome)) return verdict('OK', `Closed as ${finalOutcome} after ${attempts || batchRow.attempts || '?'} attempts`);
if (!open && NATIONAL_ADMIN_OUTCOMES.test(finalOutcome)) return verdict('OK', `Closed as ${finalOutcome}`);
// The export's outcome can lag behind the lead: when the last call on its
// own timeline lists only Max Attempts, that is how it ended.
const ownEnding = leadEndingFrom(own);
if (!open && ownEnding.maxAttempts) return verdict('OK', `Closed as ${ownEnding.outcomes[0]} on its last call`);
// 5. Still being worked.
if (open) {
// By the last attempt there is no next call to schedule by hand.
if (String(batchRow.exportHint || '') === 'open-auto' && attempts >= NATIONAL_FULL_RUN_ATTEMPTS) return verdict('OK', `On attempt ${attempts}, the last one`);
if (String(batchRow.exportHint || '') === 'open-auto') return verdict('Check', 'Automatic reschedule, should be manual');
return verdict('OK', 'Still being worked');
}
// 6. A hand-over closure whose enquiry a newer lead already carries.
const createdMs = lead.createdMs;
const newer = (allItems || []).filter((i) => String(i.LeadID) !== String(lead.leadId) && (eventTimeMs(i.EventTime) || 0) > (createdMs || 0));
const cover = newer.find((i) => {
const type = Number(i.TimelineItemType);
if (type === 2 && !isNationalDealer(emDealerOf(i))) return true;
if (type === 8) return true;
const walkIn = String(i.Description || '').match(/created in Enquiry Max at\s+(.+?)\s*$/i);
if (walkIn && !isNationalDealer(walkIn[1])) return true;
return type === 1 && (ctx.openLeadIds || []).map(String).includes(String(i.LeadID));
});
if (cover && NATIONAL_HANDOVER_OUTCOMES.test(finalOutcome)) return verdict('OK', `Covered by newer lead ${formatShortTime(eventTimeMs(cover.EventTime))}`);
// A lead made after this one's last call is this enquiry set up again
// (or the customer coming back), unless that one also went nowhere.
const sinceMs = lastAttemptMs || createdMs || 0;
const again = (allItems || []).filter((i) => Number(i.TimelineItemType) === 1 && Number(i.LeadID) && String(i.LeadID) !== String(lead.leadId)
&& (eventTimeMs(i.EventTime) || 0) > sinceMs && !/created in Enquiry Max/i.test(String(i.Description || ''))).sort(byTime).pop();
if (again) {
const theirs = (allItems || []).filter((i) => String(i.LeadID) === String(again.LeadID)).sort(byTime);
const theirOutcome = theirs.filter((i) => Number(i.TimelineItemType) === 3).map((i) => outcomeFromCallDescription(i.Description)).filter(Boolean).pop() || '';
const theirSend = theirs.some((i) => Number(i.TimelineItemType) === 2 && emDealerOf(i) && !isNationalDealer(emDealerOf(i)));
// The newer lead counts as properly worked when its last call says Max
// Attempts or it had the full run of calls, whatever an earlier call on it
// said (an Email Only set on the day it was made, say).
const theirEnding = leadEndingFrom(theirs);
const workedThrough = theirEnding.anyMaxAttempts || theirEnding.realCalls >= NATIONAL_FULL_RUN_ATTEMPTS;
const wentNowhere = !theirSend && !workedThrough && NATIONAL_DEAD_END_OUTCOMES.test(theirOutcome) && !/max attempts/i.test(theirOutcome);
if (!wentNowhere) return verdict('OK', `Already set up again as a new lead on ${formatShortTime(eventTimeMs(again.EventTime))}`);
}
// Booked and passed on: later calls (the customer ringing in, a follow
// up) do not undo a send made with the booking.
if (NATIONAL_BOOKED_OUTCOMES.test(finalOutcome) && !/no appointment/i.test(finalOutcome)) {
if (earlierDealerSend) return verdict('OK', `Booked and sent to ${earlierDealerSend} via Enquiry Max`);
const since = (allItems || []).filter((i) => (eventTimeMs(i.EventTime) || 0) >= (createdMs || 0) - 2 * 60 * 1000);
const bookings = since.filter((i) => Number(i.TimelineItemType) === 8).map((i) => eventTimeMs(i.EventTime) || 0);
const bookedSend = since.find((i) => {
if (Number(i.TimelineItemType) !== 2 || !emDealerOf(i) || isNationalDealer(emDealerOf(i))) return false;
const at = eventTimeMs(i.EventTime) || 0;
return bookings.some((b) => at - b >= -5 * 60 * 1000 && at - b <= 60 * 60 * 1000);
});
if (bookedSend) return verdict('OK', `Booked and sent to ${emDealerOf(bookedSend)} via Enquiry Max on ${formatShortTime(eventTimeMs(bookedSend.EventTime))}`);
}
// Spoken to and not interested: there is nothing to pass to a dealership.
// The conversation can be filed under another of the customer's leads.
if (/not interested/i.test(finalOutcome)) {
const spoke = (allItems || []).some((i) => Number(i.TimelineItemType) === 3 && (eventTimeMs(i.EventTime) || 0) >= (createdMs || 0) - 2 * 60 * 1000
&& /outcome of spoke to customer|took an inbound call/i.test(String(i.BelowLineTitle || '')));
if (spoke) return verdict('OK', `Closed as ${finalOutcome} after speaking to the customer`);
}
// Passed to Enquiry Max after the full run of calls is a normal close.
// The calls can be spread over this customer's other leads.
// Updating the outcomes without ringing is not an attempt.
const callsSince = (allItems || []).filter((i) => isAttemptItem(i) && !/outcome of update outcomes/i.test(String(i.BelowLineTitle || ''))
&& (eventTimeMs(i.EventTime) || 0) >= (createdMs || 0) - 2 * 60 * 1000).length;
const fullRun = Math.max(Number.isFinite(exportAttempts) && exportAttempts > 0 ? exportAttempts : 0, callsSince);
// The same goes for Email Only: rung the full number of times with no
// answer, the customer is left to email and there is nothing to set up.
if (/sent direct to enquiry max|email only/i.test(finalOutcome) && fullRun >= NATIONAL_FULL_RUN_ATTEMPTS) return verdict('OK', `Closed as ${finalOutcome} after ${fullRun} attempts`);
// Misdirected: the agent decided it was not a sales lead. Right only if
// the lead itself confirms that, which needs its window read (see
// resolveMisdirected), so it starts as Check.
if (/misdirected/i.test(finalOutcome)) return verdict('Check', 'Misdirected: check the lead was not for sales');
// 2. Sent, but only to National.
if (nationalSend) return verdict(RE_SETUP, 'Sent to Enquiry Max at National, went nowhere');
// 7. Closed with nowhere to go.
if (finalOutcome && NATIONAL_DEAD_END_OUTCOMES.test(finalOutcome)) {
const earlier = earlierDealerSend ? ` (it was sent to ${earlierDealerSend} earlier, but not after the last call)` : '';
return verdict(RE_SETUP, `Closed as ${finalOutcome} without being sent to a dealership${earlier}`);
}
// 8. Unknown.
return verdict('Check', `Outcome not seen before: ${finalOutcome || 'none recorded'}`);
}

function waitForRepeat(container, expr, timeout) {
return new Promise((resolve) => {
const find = () => container.querySelectorAll(`[ng-repeat^="${expr}"]`);
if (find().length) { resolve(true); return; }
const timer = setTimeout(() => { observer.disconnect(); resolve(find().length > 0); }, pageLimit(timeout));
const observer = new MutationObserver(() => { if (find().length) { clearTimeout(timer); observer.disconnect(); resolve(true); } });
observer.observe(container, { childList: true, subtree: true });
});
}

function scopeItemsFor(container, expr) {
return Array.from(container.querySelectorAll(`[ng-repeat^="${expr}"]`)).map((el) => {
try { return angular.element(el).scope().item || null; } catch (error) { return null; }
}).filter(Boolean);
}

// A list from the lead window. The window loads its lists with the lead, so
// one that already holds entries is read as it stands. Only an empty one
// has its tab opened and waited for, in case it was still loading.
async function readModalList(modal, tabLabel, expr) {
const ready = scopeItemsFor(modal, expr);
if (ready.length) return ready;
if (await clickModalTab(modal, tabLabel)) await waitForRepeat(modal, expr, 1500);
return scopeItemsFor(modal, expr);
}

async function clickModalTab(modal, label) {
const tab = Array.from(modal.querySelectorAll('a.nav-link')).find((a) => a.textContent.replace(/\s+/g, ' ').trim() === label);
if (!tab) return false;
tab.click();
await sleep(pagePause(250));
return true;
}

function formatFollowUpNotes(comments) {
const text = comments.map((c) => `${c.CreatedDate || ''} ${c.CreatedBy || ''}: ${String(c.Comment || '').replace(/\s+/g, ' ').trim()}`.trim()).join(' | ');
return text.length > 500 ? text.slice(0, 497) + '...' : text;
}


// Pure. The export and the lead window can word a campaign slightly
// differently, so one containing the other still counts. A blank side
// cannot be checked and is accepted.
function nationalCampaignsMatch(windowCampaign, exportCampaign) {
const a = normalizeForCompare(windowCampaign);
const b = normalizeForCompare(exportCampaign);
return !a || !b || a === b || a.includes(b) || b.includes(a);
}

// Opens one lead's window and reads what a reset needs. Returns null when
// the window could not be read; the verdict stands either way.
async function readNationalLeadDetails(leadId, items) {
const leadItem = items.find((i) => Number(i.TimelineItemType) === 1 && String(i.LeadID) === String(leadId));
if (!leadItem || !leadItem.__row) return null;
const state = await openLeadModal(leadItem.__row);
if (!state) return null;
try {
const { modal, panel } = state;
const details = { campaign: '', initialNotes: '', followUp: [], callHistory: [] };
const campaign = extractCampaignField(panel);
details.campaign = campaign.primary || '';
details.leadRequest = campaign.parenthetical || '';
details.initialNotes = extractInitialNotes(panel) || '';
details.followUp = await readModalList(modal, 'Follow Up', 'item in surveyDetailData');
details.callHistory = (await readModalList(modal, 'Call History', 'item in surveyAttemptData')).map((c) => ({ date: c.ContactDate, outcome: c.OutcomeDisplayText, type: c.ContactType }));
return details;
} catch (error) {
return null;
} finally {
await closeLeadModal();
}
}

async function processNationalRow(row, session, group) {
const result = Object.assign(makeResultBase(row), {
mode: 'national', activityId: row.activityId, reg: row.reg, leadId: null, verdict: null, verdictReason: null,
attempts: null, finalOutcome: null, enquiryMaxDealer: null, followUpNotes: '', callHistory: [],
resetCampaign: ''
});
let items = readAllTimelineItems();
let ids = findNationalLeadIds(items, row.parsedCreated);
for (let attempt = 0; ids.length === 0 && attempt < 5; attempt++) {
if (isCancelled(session)) return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
const scroll = await loadOlderTimelineEntries();
items = readAllTimelineItems();
ids = findNationalLeadIds(items, row.parsedCreated);
if (scroll.status !== 'OK' || !scroll.loadedNewEntries) break;
}
if (ids.length === 0) {
// The created time can differ between the export and Konnect Live, so
// try the lead's last contact against the calls on the timeline.
ids = findNationalLeadIdsByContact(items, parseNationalCreated(row.lastContact));
}
if (ids.length === 0) {
const nearest = nearestLeadCreatedTimes(items, row.parsedCreated);
const hint = nearest.length ? ` (nearest leads on the timeline: ${nearest.join(', ')})` : ' (no leads on the timeline)';
return finalizeResult(result, { status: 'CLASSIFIED', verdict: 'Not found', verdictReason: `No lead created at ${row.created} or contacted at ${row.lastContact || 'the last contact time'} on the timeline${hint}` });
}
if (ids.length > 1) {
return finalizeResult(result, { status: 'CLASSIFIED', verdict: 'Check', verdictReason: 'More than one lead created at that time' });
}
const leadId = ids[0];
const openLeadIds = group.rows
.filter((other) => other !== row && /in progress/i.test(other.state || ''))
.map((other) => findNationalLeadIds(items, other.parsedCreated)[0])
.filter(Boolean);
const leadCreated = items.find((i) => Number(i.TimelineItemType) === 1 && String(i.LeadID) === leadId);
const evaluation = evaluateNationalLead(
{ leadId, createdMs: leadCreated ? eventTimeMs(leadCreated.EventTime) : null },
items.filter((i) => String(i.LeadID) === leadId),
items, row, { openLeadIds }
);
const patch = {
status: 'CLASSIFIED', leadId, verdict: evaluation.verdict, verdictReason: evaluation.reason,
attempts: evaluation.attempts, finalOutcome: evaluation.finalOutcome, enquiryMaxDealer: evaluation.enquiryMaxDealer
};
if (evaluation.verdict === RE_SETUP || evaluation.verdict === 'Check') {
if (isCancelled(session)) return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
const read = await readNationalLeadDetails(leadId, items);
// A window for a different lead must not supply notes or reset details.
const details = read && nationalCampaignsMatch(read.campaign, row.campaign) ? read : null;
if (!details) {
patch.verdictReason = `${evaluation.reason}. ${read ? `The lead window showed ${read.campaign}, not ${row.campaign}, so its notes were not used` : 'Notes not read'}`;
if (evaluation.verdict === RE_SETUP) patch.resetCampaign = row.campaign;
} else {
patch.followUpNotes = formatFollowUpNotes(details.followUp);
patch.callHistory = details.callHistory;
patch.initialNotes = details.initialNotes;
const misdirected = resolveMisdirected(evaluation.finalOutcome, details);
if (misdirected) {
patch.verdict = misdirected.verdict;
patch.verdictReason = misdirected.reason;
}
if (evaluation.verdict === RE_SETUP) {
// The export's campaign is the lead's own; the window's may be worded differently.
patch.resetCampaign = row.campaign || details.campaign;
}
}
}
return finalizeResult(result, patch);
}

// Pure. The owner's own verdict for a lead the check got wrong. The first
// verdict is kept so the change can be undone and the reason still shows.
function applyNationalVerdictChange(result, verdict, why) {
const was = result.verdictChange || { verdict: nationalVerdictOf(result), reason: result.status === 'EXCEPTION' ? `Could not check: ${exceptionLabel(result.exception)}` : (result.verdictReason || ''), status: result.status, exception: result.exception, resetCampaign: result.resetCampaign || '' };
const note = String(why || '').trim();
return Object.assign({}, result, {
status: 'CLASSIFIED', exception: null, verdict,
verdictReason: `Changed by you from ${was.verdict}${note ? `: ${note}` : ''}. The check said: ${was.reason || 'nothing'}`,
resetCampaign: verdict === RE_SETUP ? (was.resetCampaign || result.campaign || '') : '',
verdictChange: was
});
}

function undoNationalVerdictChange(result) {
const was = result.verdictChange;
if (!was) return result;
const back = Object.assign({}, result, { status: was.status, exception: was.exception, verdict: was.verdict, verdictReason: was.reason, resetCampaign: was.resetCampaign });
delete back.verdictChange;
return back;
}

function nationalChangeHtml(r) {
const current = nationalVerdictOf(r);
const buttons = [RE_SETUP, 'Check', 'OK'].filter((v) => v !== current)
.map((v) => `<button type="button" class="btn" data-verdict="${escapeHtmlForUi(v)}">${escapeHtmlForUi(v === 'OK' ? 'It is OK' : v === RE_SETUP ? 'Needs Re setup' : 'Needs a check')}</button>`).join('');
const undo = r.verdictChange ? `<button type="button" class="btn" data-verdict-undo="1">Undo my change</button>` : '';
return `<details class="disagree national-change" data-key="${r.inputIndex}"><summary>${r.verdictChange ? 'Changed by you' : 'Wrong? Change it'}</summary>
<div class="review-actions" role="group" aria-label="Change the result for ${escapeHtmlForUi(r.name)}">${buttons}${undo}</div>
<input type="text" class="review-reason" aria-label="Why (optional)" placeholder="Why (optional): helps me add a rule">
</details>`;
}

function buildNationalResultsExport(session) {
const rows = orderedResults(session).map((r) => {
const exception = r.status === 'EXCEPTION';
const verdict = exception ? 'Check' : (r.verdict || 'Check');
const reason = exception ? `Could not check: ${exceptionLabel(r.exception)}` : (r.verdictReason || '');
const isReset = verdict === RE_SETUP;
return ['national', r.name, r.activityId, r.leadId, verdict, reason,
r.attempts != null ? String(r.attempts) : '', r.finalOutcome, r.enquiryMaxDealer, r.followUpNotes,
isReset ? r.resetCampaign : '', r.reg || ''
].map(tsvCell).join('\t');
});
return [NATIONAL_RESULT_HEADER.join('\t'), ...rows].join('\n');
}

const NATIONAL_VERDICT_COLORS = { [RE_SETUP]: '#d70015', Check: '#b45309', 'Not found': '#475569', OK: '#047857' };

function nationalVerdictOf(r) {
return r.status === 'EXCEPTION' ? 'Check' : (r.verdict || 'Check');
}

// ui gives the panel's open/closed state and avatar renderer, which live
// inside the panel code.
function renderNationalResultsHtml(results, nameFilter, ui) {
const filtered = results.filter((r) => !nameFilter || String(r.name || '').toLowerCase().includes(nameFilter));
if (filtered.length === 0) return '<div class="empty-state">No results yet. Press Start.</div>';
const reasonOf = (r) => (r.status === 'EXCEPTION' ? `Could not check: ${exceptionLabel(r.exception)}` : (r.verdictReason || ''));
const leadLines = (r) => {
const lines = [
['Reason', reasonOf(r)], ['Lead', `${r.activityId || '-'} (Konnect ${r.leadId || '-'})`], ['Created', r.created],
['Final outcome', r.finalOutcome], ['Attempts', r.attempts != null ? String(r.attempts) : ''],
['Enquiry Max', r.enquiryMaxDealer], ['Follow-up notes', r.followUpNotes]
];
if (nationalVerdictOf(r) === RE_SETUP) lines.push(['Campaign to set up again', r.resetCampaign]);
return kvHtml(lines.filter(([, v]) => v).map(([k, v]) => [k, escapeHtmlForUi(v)])) + nationalChangeHtml(r);
};
// The check is per lead, but a customer with several National leads is
// one person: they are shown once, under their most pressing verdict, with
// each lead inside.
const rank = (r) => NATIONAL_VERDICT_ORDER.indexOf(nationalVerdictOf(r));
const customers = [];
const byName = new Map();
filtered.forEach((r) => {
const key = normalizeCustomerName(r.name) || `row:${r.inputIndex}`;
if (!byName.has(key)) { byName.set(key, []); customers.push(byName.get(key)); }
byName.get(key).push(r);
});
return NATIONAL_VERDICT_ORDER.map((verdict, index) => {
const group = customers.filter((leads) => Math.min(...leads.map(rank)) === index);
if (group.length === 0) return '';
const color = NATIONAL_VERDICT_COLORS[verdict];
const key = 100 + index;
const rowsHtml = group.map((leads) => {
const lead = leads.find((r) => rank(r) === index);
const reason = reasonOf(lead);
const several = leads.length > 1;
const meta = several ? `${leads.length} National leads · ${reason}` : reason;
const body = several
// Each lead keeps its own initials button, which opens that lead.
? leads.map((r) => `<div class="reason" style="display: flex; align-items: center; gap: 8px; color: ${readableTextColor(NATIONAL_VERDICT_COLORS[nationalVerdictOf(r)])}; font-weight: 700;">${r === lead ? '' : ui.avatar(r, NATIONAL_VERDICT_COLORS[nationalVerdictOf(r)])}<span>${escapeHtmlForUi(nationalVerdictOf(r))} · lead created ${escapeHtmlForUi(r.created || '-')}</span></div>${leadLines(r)}`).join('')
: leadLines(lead);
// The group heading says the verdict once, so the rows carry the reason.
return resultRowHtml({
key: lead.inputIndex, open: ui.isCustomerOpen(lead.inputIndex), avatar: ui.avatar(lead, color), name: lead.name, title: reason, meta,
openTag: ui.openTag ? leads.map((r) => ui.openTag(r)).find(Boolean) || '' : '', note: ui.openNote ? leads.map((r) => ui.openNote(r)).find(Boolean) || '' : '',
body
});
}).join('');
return resultGroupHtml(key, verdict, color, group.length, ui.isTierOpen(key, verdict !== 'OK'), rowsHtml);
}).join('');
}

window.KonnectLeadChecker.evaluateNationalLead = evaluateNationalLead;
window.KonnectLeadChecker.applyNationalVerdictChange = applyNationalVerdictChange;
window.KonnectLeadChecker.undoNationalVerdictChange = undoNationalVerdictChange;
window.KonnectLeadChecker.buildNationalResultsExport = buildNationalResultsExport;

window.KonnectLeadChecker.timelineEntryKey = timelineEntryKey;
window.KonnectLeadChecker.reLogin = reLogin;
window.KonnectLeadChecker.closeLeadModal = closeLeadModal;
window.KonnectLeadChecker.loadOlderTimelineEntries = loadOlderTimelineEntries;
window.KonnectLeadChecker.normalizeEmail = normalizeEmail;
window.KonnectLeadChecker.normalizePhone = normalizePhone;
window.KonnectLeadChecker.parseBatchInput = parseBatchInput;

// ===================================================================
// Self-test for batch-input parsing and normalization.
// ===================================================================
runSelfTest('batchInputSelfTest', function batchInputSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

check('normalizeEmail trims+lowercases', normalizeEmail(' Foo@Bar.COM '), 'foo@bar.com');
check('normalizePhone +44 form', normalizePhone('+44 7700 900123'), '07700900123');
check('normalizePhone +44 (0) and 0044 forms', [normalizePhone('+44 (0)7700 900123'), normalizePhone('0044 7700 900123'), normalizePhone('+4407700900123')], ['07700900123', '07700900123', '07700900123']);
check('normalizePhone leading-0 form matches +44 form', normalizePhone('07700900123'), normalizePhone('+44 7700 900123'));

const goodBatch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Alex Sample\t07700900456\talex.sample@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05',
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
console.error('KonnectLeadChecker batch-input self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker batch-input self-test passed (7/7)');
}
});

// ===================================================================
// Self-test for timeline parsing and matching.
// ===================================================================
runSelfTest('timelineSelfTest', function timelineSelfTest() {
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
// Last Actioned omits the year for the current year.
check('parseSlaCreated without year (Last Actioned format)', parseSlaCreated('26 Sep 14:18', now2026), { year: 2026, month: 8, day: 26, hour: 14, minute: 18 });
check('parseSlaCreated with year still wins even when a referenceDate is also given', parseSlaCreated('Sat, 26 Sep 2020 17:48', now2026), { year: 2020, month: 8, day: 26, hour: 17, minute: 48 });
check('parseSlaCreated accepts the reporting export\'s ISO-like format', parseSlaCreated('2026-09-01 15:20:35'), { year: 2026, month: 8, day: 1, hour: 15, minute: 20 });
check('parseSlaCreated accepts the same format with a T separator, no seconds', parseSlaCreated('2026-09-01T15:20'), { year: 2026, month: 8, day: 1, hour: 15, minute: 20 });
check('parseModalDate', parseModalDate('Fri 5th May 2023 07:02'), { year: 2023, month: 4, day: 5, hour: 7, minute: 2, yearWasImplicit: false });

check('datetimesMatchAtMinute true', datetimesMatchAtMinute(parseModalDate('Fri 5th May 2023 07:02'), parseTimelineTimestamp('5 May 2023 07:02')), true);
check('datetimesMatchAtMinute false (different minute)', datetimesMatchAtMinute(parseTimelineTimestamp('5 May 2023 07:02'), parseTimelineTimestamp('5 May 2023 07:03')), false);

// A no-year entry must only match a target from the same year.
const impliedThisYear = parseTimelineTimestamp('26 Sep 22:10', now2026);
const targetSameYear = parseSlaCreated('Sat, 26 Sep 2026 22:10');
const targetDifferentYear = parseSlaCreated('Thu, 26 Sep 2024 22:10');
check('implicit-year entry matches same-year target', datetimesMatchAtMinute(impliedThisYear, targetSameYear), true);
check('implicit-year entry does not match a different-year target', datetimesMatchAtMinute(impliedThisYear, targetDifferentYear), false);

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
console.error('KonnectLeadChecker timeline self-test FAILED:\n' + failures.join('\n'));
} else {
console.info(`KonnectLeadChecker timeline self-test passed (${12 + REAL_MANAGER_VS_LIVE_PAIRS.length * 2}/${12 + REAL_MANAGER_VS_LIVE_PAIRS.length * 2})`);
}
});


// ===================================================================
// Self-test against the Section 12 worked cases of
// lead-classification-spec.md v1.10. Checks the tier only, which is all
// the spec commits to per case.
// ===================================================================
runSelfTest('classifyLeadSelfTest', function classifyLeadSelfTest() {
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
["T66", "Vehicle notes: *£16,981* Reg: AB19CDE | Message from customer: I would like to book a test drive for vehicle Audi Q2... | URL of vehicle of interest:", 'Enquiry - Used', 'AA Cars', 3],
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
['T99', 'Comment Line #1: Vehicle URL: https://example.com/used-vehicles/vauxhall-grandland-electric | Customer comment: Currently have AB23CDE... Owe just under £10900. Wanting a 4 year PCP, £0 deposit, 10k miles per year', 'Enquiry - Used', 'R&D', 3],
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
["T114", "Requesting Return of the Leapmotor B10 (AB26CDE) | Reasons for Requesting Return...", 'Leapmotor General', 'R&D', 6],
["T115", "I no longer wish to be contacted by yourselves in any way... appalling manner...", 'Alfa Romeo General', 'R&D', 6],
['T116', 'Subject: T Level Industry Placement Enquiry, 315 Hours...', 'Leapmotor General', 'R&D', 6],
['T117', 'Hello team. I am looking to join the motability scheme and weighing up mid size SUV options. Is there someone I can speak to about the Jeep Compass?', 'Jeep General', 'R&D', 3],
['T118', 'The customer was on the following website page, before completing the valuation: https://example.com/leapmotor/new/offers/c10-0-apr', 'Leapmotor P/X Valuation', 'R&D', 4],
['T119', 'The customer was on the following website page, before completing the valuation: https://example.com/leapmotor/new', 'Leapmotor P/X Valuation', 'R&D', 5],
// Abbreviated weekday ("sat").
['T120', 'Vehicle notes: *£5,584*    2015    42,025 miles    Petrol    Manual    Reg: AB15CDE | Message from customer: Could we please view this car sat afternoon. | URL of vehicle of interest: https://example.com/track/click/x', 'Enquiry - Used', 'AA Cars', 2],
// No day/time: the "would like to book a test drive" rule still wins.
['T121', 'Vehicle notes: *£14,129*    2025    4,182 miles    Petrol    Manual    Reg: AB25CDE | Message from customer: I would like to book a test drive for vehicle Vauxhall Corsa 1.2 Turbo GS | Hatchback 5dr Petrol Manual Euro 6 (s/s) (100 ps) (AB25CDE). | URL of vehicle of interest: https://example.com/track/click/x', 'Enquiry - Used', 'AA Cars', 3],
['T122', 'Lead ID: 00Qa200000EXAMPLE1 | Marketing Code: Social-Meta-Q4-PCH3 | Customer Comments: PCH Frontera Hybrid GS £339 - https://fb.me/adspreview/facebook/2bqthHxfokGg4VG', 'Vauxhall - Offer Request - New', 'Customer First', 5, 'high'],
['T123', "Comment Line #1: Hi, |  | I was hoping to get some information on returning my current vehicle and getting a new vehicle on finance. |  | I've been told that I may be eligible for a no fee agreement whereby I hand my current vehicle back to you.", 'Enquiry - Used', 'Robins & Day Website', 6, 'medium'],
['T124', "Comment Line #1: 1)My account email is already registered but I have no password for it ? | 2)Do you have a record of the 'service' on my car, unable to find details of it?", 'Enquiry - Used', 'Robins & Day Website', 6, 'high'],
['T125', 'Misc: The following information was present in the lead: | Full Dealer Name = Stellantis &You X | Franchise = Peugeot | Unsub Email = #N/A | Model = PEUGEOT 2008 | Enquiry = Availability,Stock Vehicles,Price List,Test Drive | Purchase = Just Browsing | Part = No', 'Peugeot - Enquiry - New', 'MB Mail', 5, 'high'],
['T126', 'Misc: The following information was present in the lead: | Full Dealer Name = Stellantis &You X | Franchise = Peugeot | Unsub Email = #N/A | Model = PEUGEOT 208 | Enquiry = Stock Vehicles,Finance Options | Purchase = ASAP | Part = No', 'Peugeot - Enquiry - New', 'MB Mail', 4, 'high'],
['T127', 'Misc: The following information was present in the lead: | Full Dealer Name = Stellantis &You X | Franchise = Peugeot | Unsub Email = #N/A | Model = PEUGEOT 5008 | Enquiry = Finance Options | Purchase = Within 3 Months | Part = No', 'Peugeot - Enquiry - New', 'MB Mail', 4, 'high'],
['T128', 'Misc: The following information was present in the lead: | Full Dealer Name = Stellantis &You X | Franchise = Peugeot | Unsub Email = #N/A | Model = New Vauxhall Astra,Vauxhall Mokka | Enquiry = Part-Exchange,Stock Vehicles,Finance Options | Purchase = Just Browsing | Part = Yes | Reg = Wg70 luf | Mileage = 22000', 'Vauxhall - Offer Request - New', 'MB Mail', 5, 'high'],
['T129', 'Misc: The following information was present in the lead: | Full Dealer Name = Stellantis &You X | Franchise = Peugeot | Unsub Email = #N/A | Model = NEW PEUGEOT 308 | Enquiry = Availability | Purchase = Just Browsing | Part = Possibly | Reg = Peugeot 3008 2015 | Mileage = 111100', 'Peugeot - Enquiry - New', 'MB Mail', 5, 'high'],
['T130', 'Lead ID: 00Qa200000EXAMPLE2 | Marketing Code: BrandSite-Enquiry | Customer Comments: -', 'Citroen - Enquiry - New', 'Customer First', 4, 'medium'],
['T131', 'Lead ID: 00Qa200000EXAMPLE3 | Marketing Code: Pop-in-Test-Drive-New_Users_CDP | Customer Comments: -', 'Peugeot - Enquiry - New', 'Customer First', 4, 'high'],
['T132', 'Lead ID: 00Qa200000EXAMPLE4 | Marketing Code: PCH Offers Pages | First Desired Schedule: 00:00 | Customer Comments: -', 'Fiat - Offer Request - New', 'Customer First', 4, 'medium'],
['T133', 'Lead ID: 00Qa200000EXAMPLE5 | Marketing Code: Google-DemandGen-Model | Customer Comments: -', 'Peugeot - Enquiry - New', 'Customer First', 5, 'medium'],
['T134', 'Comment Line #1: The customer was on the following website page, before completing the valuation: https://www.stellantisandyou.co.uk/citroen/service/offers/citroen-we-care', 'PX Valuation - Used', 'Robins & Day Website', 5, 'medium'],
// A service-history question on a used car stays a sales lead.
['T135', 'Comment Line #1: Does this car come with a full service history? Could I view it this Saturday at 11am?', 'Enquiry - Used', 'Robins & Day Website', 1]
];

const failures = [];
// An optional 6th element pins the confidence too, since confidence
// decides whether a lead goes to Needs Review.
cases.forEach(([id, notes, campaign, source, expectedTier, expectedConfidence]) => {
const result = classifyLead(notes, { campaign, source });
if (result.tier !== expectedTier) {
failures.push(`${id}: expected tier ${expectedTier}, got tier ${result.tier} (${result.subCategory}) - reason: ${result.reason}`);
}
if (expectedConfidence && result.confidence !== expectedConfidence) {
failures.push(`${id}: expected confidence ${expectedConfidence}, got ${result.confidence} - reason: ${result.reason}`);
}
});

// Reviewers split 5/6 on MB Mail leads with Part-Exchange as the only
// option, so these must keep going to Needs Review.
const mbPartExOnly = (dealer, reg) => `Misc: The following information was present in the lead: | Full Dealer Name = Stellantis &You ${dealer} | Unsub Email = #N/A | Model = Vauxhall Corsa | Enquiry = Part-Exchange | Purchase = Just Browsing | Part = Yes | Reg = ${reg} | Mileage = 25000`;
[['PX-only A', mbPartExOnly('Liverpool', 'AB72CDE'), 'Peugeot - Enquiry - New'], ['PX-only B', mbPartExOnly('Stockport', 'AB18CDE'), 'Vauxhall - Offer Request - New']].forEach(([id, notes, campaign]) => {
const result = classifyLead(notes, { campaign, source: 'MB Mail' });
if (result.confidence !== 'low') failures.push(`${id}: Part-Exchange-only MB Mail lead should stay low confidence (Needs Review), got ${result.confidence}`);
});

if (failures.length > 0) {
console.error('KonnectLeadChecker classifyLead spec self-test FAILED:\n' + failures.join('\n'));
} else {
console.info(`KonnectLeadChecker classifyLead spec self-test passed (${cases.length}/${cases.length})`);
}
});

// Section 9.1 dedupe, not covered by the tier-only cases above.
runSelfTest('dedupeSelfTest', function dedupeSelfTest() {
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
console.error('KonnectLeadChecker dedupe self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker dedupe self-test passed (8/8)');
}
});

runSelfTest('realReviewedLeadsSelfTest', function realReviewedLeadsSelfTest() {
const failures = [];
function check(label, actual, expected) {
if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

// Blank Source: only the "(CarGurus IMV: ...)" signature gives it away.
const carGurusResult = classifyLead(
"Message from customer: I am interested in your 2026 Peugeot 3008 1.2 Hybrid 145 Gt Premium 5dr E-dsc6. You can reach me by email at sam.buyer@example.com or phone at 07700 900789. Thank you! (CarGurus IMV: £28,354 / Deal rating: Fair Deal / Is from deliverable listing: No)",
{ campaign: 'Enquiry - Used', source: '' }
);
check('CarGurus lead with blank Source is now recognised as CarGurus (tier)', carGurusResult.tier, 4);
check('CarGurus lead with blank Source is now recognised as CarGurus (source inferred)', carGurusResult.source, 'Cargurus');

const leaseResult = classifyLead(
'Comment Line #1: interested in lease deals cheapest the best please 2 year contract 8000 miles no arrangement fee and low penalty charge',
{ campaign: 'Peugeot - General', source: '' }
);
check('Lease-quote-terms prose on a General campaign lands in Tier 4 (was 5.9 fallback)', leaseResult.tier, 4);
check('Lease-quote-terms result is flagged Finance', leaseResult.flags.includes('Finance'), true);

if (failures.length > 0) {
console.error('KonnectLeadChecker real-reviewed-leads self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker real-reviewed-leads self-test passed (4/4)');
}
});

// ===================================================================
// Self-test for classifyLead's Step 13 postClosureAction output.
// ===================================================================
runSelfTest('postClosureActionSelfTest', function postClosureActionSelfTest() {
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
console.error('KonnectLeadChecker postClosureAction self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker postClosureAction self-test passed (4/4)');
}
});

// ===================================================================
// ORCHESTRATION AND UI PANEL
//
// Cancel and pause are cooperative, checked between steps: the waits take
// no abort signal but are bounded to a few seconds.
// ===================================================================

const SESSION_STORAGE_KEY = 'konnectLeadChecker:session:v1';

// Bump CLASSIFIER_VERSION whenever classifyLead's rules change: results
// from an older version are re-checked rather than carried into a new
// paste. SESSION_SCHEMA changes when the stored session shape changes.
const CLASSIFIER_VERSION = '2026-11-11a';
const SESSION_SCHEMA = 2;
// The stored batch holds customer details, so it is dropped after a shift.
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
let lastSavedSessionJson = null;

function saveSession(session) {
// A cleared session is never written back, even by a check still finishing.
if (!session || session.discarded) return;
try {
session.schema = SESSION_SCHEMA;
session.classifierVersion = CLASSIFIER_VERSION;
session.savedAt = Date.now();
lastSavedSessionJson = JSON.stringify(session);
localStorage.setItem(SESSION_STORAGE_KEY, lastSavedSessionJson);
if (lcNotices.saveFailed) { lcNotices.saveFailed = false; notifyNoticesChanged(); }
} catch (error) {
if (!lcNotices.saveFailed) { lcNotices.saveFailed = true; notifyNoticesChanged(); }
}
}

function isValidStoredSession(value, now) {
if (!value || typeof value !== 'object') return false;
if (value.schema !== SESSION_SCHEMA) return false;
if (typeof value.savedAt !== 'number' || (now || Date.now()) - value.savedAt > SESSION_MAX_AGE_MS) return false;
if (typeof value.rawInput !== 'string' || !Array.isArray(value.rows) || !Array.isArray(value.groups)) return false;
if (!value.results || typeof value.results !== 'object') return false;
return typeof value.groupIndex === 'number';
}

function loadStoredSession() {
try {
const raw = localStorage.getItem(SESSION_STORAGE_KEY);
if (!raw) return null;
const parsed = JSON.parse(raw);
if (!isValidStoredSession(parsed)) { localStorage.removeItem(SESSION_STORAGE_KEY); return null; }
lastSavedSessionJson = raw;
return parsed;
} catch (error) { return null; }
}
function clearStoredSession() {
try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (error) { /* ignore */ }
}

const SETTINGS_STORAGE_KEY = 'konnectLeadChecker:settings:v1';

// The small window Work Tools opens for Konnect Live. Work-Tools.js uses
// the same names: the switch ('off' turns it off) and the window's last
// size and place.
const SMALL_WINDOW_NAME = 'workToolsLiveSmall';
const SMALL_WINDOW_KEY = '_klcSmallWindow';
const SMALL_WINDOW_BOX_KEY = '_klcSmallWindowBox';
// Running in the small window: say so every few seconds, so a later click
// of Work Tools finds this window rather than opening over it.
const SMALL_ALIVE_KEY = '_klcSmallAlive';
if (window.__workToolsManager && !window.__klcSmallAliveTimer) {
const beat = () => { try { localStorage.setItem(SMALL_ALIVE_KEY, String(Date.now())); } catch (error) { /* found by name the slow way */ } };
beat();
window.__klcSmallAliveTimer = setInterval(beat, 5000);
window.addEventListener('pagehide', () => { try { localStorage.removeItem(SMALL_ALIVE_KEY); } catch (error) { /* goes stale by itself */ } });
}

function smallWindowWanted() {
try { return localStorage.getItem(SMALL_WINDOW_KEY) !== 'off'; } catch (error) { return true; }
}

// The page's own width and height are kept, as those are what a new
// window is asked for.
function saveSmallWindowBox() {
if (window.name !== SMALL_WINDOW_NAME) return;
const box = { width: window.innerWidth, height: window.innerHeight, left: window.screenX, top: window.screenY };
if (!(box.width > 0 && box.height > 0)) return;
try { localStorage.setItem(SMALL_WINDOW_BOX_KEY, JSON.stringify(box)); } catch (error) { /* ignore */ }
}

function loadSettings() {
try {
const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
if (raw && typeof raw === 'object') return { autoStart: !!raw.autoStart, panelHeight: Number(raw.panelHeight) > 0 ? Number(raw.panelHeight) : 0 };
} catch (error) {
// ignore
}
return { autoStart: true, panelHeight: 0 };
}

function saveSettings(partial) {
try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...partial })); } catch (error) { /* ignore */ }
}

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

// The earliest group from fromIndex with any row still unresolved.
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
flags: [], dedupeKey: null, postClosureAction: null, postClosureReason: '', postClosureEvidence: '',
reason: null, confidence: null,
warnings: [], status: 'PROCESSING', exception: null,
processingTimestamp: null
};
}

function finalizeResult(result, patch) {
return postClosureOnly(Object.assign({}, result, patch, { processingTimestamp: new Date().toISOString(), classifierVersion: CLASSIFIER_VERSION }));
}

// Pure. Whether the lead being checked is a Post Closure lead: by the
// batch's source, the lead's own Source, or its timeline heading.
function isPostClosureEntry(row, panelFields, entryRow) {
if (/post closure processing/i.test(String((row && row.source) || ''))) return true;
if (/post closure processing/i.test(String((panelFields && panelFields.source) || ''))) return true;
const heading = entryRow && typeof entryRow.querySelector === 'function' ? entryRow.querySelector('.connected-customer-title-pink') : null;
return !!heading && /post closure processing/i.test(heading.textContent || '');
}

// Pure. A Post Closure lead is only ever "send back through" or "check:
// needs contact?", everywhere: its notes are not given a tier, and a low
// confidence tier guess is not a reason to review it. Real exceptions (lead
// not found, cancelled) stay as they are.
function postClosureOnly(r) {
const isPostClosure = !!r.postClosureAction || /^post closure processing$/i.test(String(r.source || '').trim());
if (!isPostClosure) return r;
if (r.status === 'EXCEPTION' && r.exception !== 'CLASSIFICATION_REVIEW_REQUIRED') return r;
if (r.status !== 'CLASSIFIED' && r.status !== 'EXCEPTION') return r;
const action = r.postClosureAction || 'check: needs contact?';
const sendBack = action === 'send back through';
return Object.assign({}, r, {
status: 'CLASSIFIED', exception: null,
tier: null, tierName: '', subCategory: '', subRank: null,
postClosureAction: action,
postClosureReason: sendBack ? (r.postClosureReason || '') : '',
postClosureEvidence: sendBack ? (r.postClosureEvidence || '') : '',
reason: sendBack
? `Send back through${r.postClosureReason ? ': ' + r.postClosureReason : ''}.`
: 'No dealership action or hub contact found, so the customer needs contacting.',
confidence: r.confidence === 'low' || !r.confidence ? 'medium' : r.confidence
});
}

// Identifies the same lead (not just customer) across two pastes, so a
// completed result can be carried over.
function rowIdentityKey(row) {
return [row.groupKey, row.campaign, row.source, row.created, row.activityId || ''].join('||');
}

// Only computes the starting state; how a row is processed is unchanged.
function newSession(rawInput, previousSession) {
const parsed = parseBatchInput(rawInput);
const rows = parsed.rows;
const results = {};

const carriedResultsByIdentity = new Map();
// National verdicts depend on what has happened since, so they are always
// checked again rather than carried into a new paste.
if (previousSession && previousSession.mode !== 'national' && parsed.mode !== 'national') {
previousSession.rows.forEach((prevRow) => {
const prevResult = previousSession.results[prevRow.inputIndex];
// A result from an older classifier is re-checked, not carried over.
if (prevResult && prevResult.classifierVersion === CLASSIFIER_VERSION && prevResult.exception !== 'CANCELLED') carriedResultsByIdentity.set(rowIdentityKey(prevRow), prevResult);
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

// Skip groups fully resolved by carried-over results.
const groupIndex = firstUnresolvedGroupIndex(groups, results, 0);

return {
rawInput, headerOk: parsed.headerOk, headerError: parsed.error, mode: parsed.mode || 'standard',
rows, groups, groupIndex, rowInGroupIndex: 0,
results, paused: false, cancelled: false,
done: !parsed.headerOk || groupIndex >= groups.length
};
}

function isCancelled(session) {
return !!(session && session.cancelled);
}

// Runs one search (with one retry) and returns {status, rows}. Used for
// every kind of batch.
async function runCustomerSearch(type, value, session) {
for (let attempt = 0; attempt < 2; attempt++) {
const opened = await openSearchPage();
if (isCancelled(session)) return { status: 'CANCELLED' };
if (!opened) continue;
if (!(await selectSearchType(type))) continue;
if (!(await enterSearchIdentifier(value))) continue;
const count = await submitSearchAndSettle();
if (isCancelled(session)) return { status: 'CANCELLED' };
if (count === null) continue;
if (count === 0) return { status: 'SEARCH_NO_RESULTS' };
return { status: 'OK', rows: readSearchResultRows() };
}
return { status: 'SEARCH_TIMEOUT' };
}

// True when the open timeline has a lead created at this row's time.
function timelineHoldsSlaLead(row) {
if (row.mode === 'postClosureList') return findNewestPostClosureCandidates(new Date()).length > 0;
return findMatchingLeadCandidates(row.created, new Date()).candidates.length > 0;
}

// Email first, then phone, then the name as a last resort. An attempt that
// finds no records moves on to the next; one that finds records without
// the lead ends the search. session is optional and checked between every
// awaited sub-step.
async function searchAndOpenCustomer(group, session, holdsLead = timelineHoldsSlaLead) {
const sample = group.rows[0];
if (sample.mode === 'national') return searchAndOpenNationalCustomer(group, session);
const attempts = [];
if (sample.normalizedEmail) attempts.push({ type: 'email', value: sample.email });
if (sample.normalizedPhone) attempts.push({ type: 'phone', value: sample.phone });
// Last resort: the name. A name can belong to someone else, so a record
// found this way is only used if its timeline holds the lead.
nameSearchVariants(sample.name).forEach((value) => attempts.push({ type: 'name', value, needsLeadProof: true }));
if (attempts.length === 0) return { status: 'FAILED', exception: 'NO_SEARCH_IDENTIFIER' };

let lastException = 'NO_SEARCH_IDENTIFIER';
for (const attempt of attempts) {
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
const search = await runCustomerSearch(attempt.type, attempt.value, session);
if (search.status === 'CANCELLED') return { status: 'FAILED', exception: 'CANCELLED' };
if (search.status !== 'OK') { lastException = search.status; continue; }

const linked = search.rows.filter((r) => r.link && r.customerId);
if (linked.length === 0) { lastException = 'CUSTOMER_NOT_LINKED'; continue; }
const ids = Array.from(new Set(linked.map((r) => r.customerId)));
const candidateIds = ids.length === 1 ? ids : nationalCandidateIds(linked, sample.name);

if (candidateIds.length === 1 && !attempt.needsLeadProof) {
const row = linked.find((r) => r.customerId === candidateIds[0]);
const timelineState = await openCustomerAndWaitForTimeline(row);
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (timelineState.state === 'FAILED') return { status: 'FAILED', exception: 'TIMELINE_TIMEOUT' };
if (timelineState.state === 'READY_WITH_ZERO_ELIGIBLE_SALES_LEADS') {
return { status: 'OK', matchMethod: attempt.type, noEligibleEvents: true };
}
return { status: 'OK', matchMethod: attempt.type, noEligibleEvents: false };
}

// Several records (or a name search): keep the one holding the lead.
const chosen = await openRecordHoldingLeads(candidateIds, group, session, holdsLead,
(id) => openSearchResultById(runCustomerSearch, { type: attempt.type, value: attempt.value }, id, session));
if (isCancelled(session)) return { status: 'FAILED', exception: 'CANCELLED' };
if (chosen) return { status: 'OK', matchMethod: attempt.type, noEligibleEvents: false };
lastException = attempt.needsLeadProof ? 'LEAD_NOT_ON_MATCHING_CUSTOMERS' : 'CUSTOMER_AMBIGUOUS';
// An email or phone that matched records without the lead is not worth
// a name search on top.
if (!attempt.needsLeadProof) return { status: 'FAILED', exception: lastException };
}

return { status: 'FAILED', exception: lastException };
}

// One SLA row against the already-open timeline: opens each exact-minute
// candidate, closes it either way, and classifies only when exactly one
// validates.
async function processLeadRow(row, session) {
const result = makeResultBase(row);
const referenceNow = new Date();
if (row.mode === 'postClosureList') return processPostClosureListRow(row, session, result, referenceNow);

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
// No direct match: try row.created as Last Actioned via the call-entry
// fallback. SLA rows always match above, so no row type is needed.
const callFallback = await findLeadCandidateViaCallFallback(row.created, session, referenceNow);
if (callFallback.status === 'CANCELLED') return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
if (callFallback.status === 'OK') {
workingCandidates = [callFallback.candidate];
} else if (callFallback.status === 'AMBIGUOUS_CALL_MATCH' && String(row.source || '').toLowerCase() === 'post closure processing') {
const fallbackLeadId = findUnambiguousPostClosureLeadId();
const decision = postClosureSendBackReason(fallbackLeadId);
const engaged = !!decision.reason;
return finalizeResult(result, {
status: 'CLASSIFIED', source: row.source,
postClosureAction: engaged ? 'send back through' : 'check: needs contact?',
postClosureReason: decision.reason, postClosureEvidence: decision.evidence,
reason: engaged
? 'Post Closure lead - which specific lead cycle this row belongs to was ambiguous by time, but it was identified directly by its own "Post Closure Processing" heading, and an engagement signal (Scheduled a call / Spoke To Customer / Lead Rejected) was found.'
: 'Post Closure lead, but which specific lead cycle this row belongs to was ambiguous (multiple leads had calls close together) - no engagement signal found, so defaulted to the safe "check" outcome rather than guessing.',
confidence: 'low'
});
} else if (callFallback.status !== 'NO_CALL_MATCH') {
debugLog('[KonnectLeadChecker] Call-entry fallback did not resolve to a lead for row.created=', JSON.stringify(row.created), '- status:', callFallback.status);
return finalizeResult(result, { status: 'EXCEPTION', exception: `CALL_FALLBACK_${callFallback.status}` });
}
}

if (workingCandidates.length === 0) {
// Log every loaded entry to tell a timestamp mismatch from an
// unrecognised raw-text shape.
debugLog('[KonnectLeadChecker] TARGET_CREATED_DATETIME_NOT_FOUND for row.created=', JSON.stringify(row.created), 'parsed target=', target, '- entries seen:', getLoadedLeadEntries().map((entryRow) => {
const raw = extractTimelineTimestamp(entryRow);
return { raw, parsed: raw ? parseTimelineTimestamp(raw, referenceNow) : null };
}));
if (String(row.source || '').toLowerCase() === 'post closure processing') {
const fallbackLeadId = findUnambiguousPostClosureLeadId();
const decision = postClosureSendBackReason(fallbackLeadId);
const engaged = !!decision.reason;
return finalizeResult(result, {
status: 'CLASSIFIED', source: row.source,
postClosureAction: engaged ? 'send back through' : 'check: needs contact?',
postClosureReason: decision.reason, postClosureEvidence: decision.evidence,
reason: engaged
? 'Post Closure lead - its Created/Last Actioned value didn\'t match any lead or call on the page, but it was identified directly by its own "Post Closure Processing" heading, and an engagement signal (Scheduled a call / Spoke To Customer / Lead Rejected) was found.'
: 'Post Closure lead, but its Created/Last Actioned value didn\'t match any lead or call on the page - no engagement signal found, so defaulted to the safe "check" outcome rather than guessing.',
confidence: 'low'
});
}
return finalizeResult(result, { status: 'EXCEPTION', exception: 'TARGET_CREATED_DATETIME_NOT_FOUND' });
}

return classifyCandidates(row, session, result, workingCandidates);
}

// Opens each candidate lead, keeps the one that validates and classifies
// its Initial Notes.
async function classifyCandidates(row, session, result, workingCandidates, retried) {
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
debugLog('[KonnectLeadChecker] click target not found for candidate at', candidate.rawTimestamp);
candidateFailures.push('LEAD_CLICK_TARGET_NOT_FOUND');
continue;
}
debugLog('[KonnectLeadChecker] clicking candidate at', candidate.rawTimestamp, 'visibleLeadId=', candidate.leadId);
const modalState = await openLeadModal(candidate.row);
if (isCancelled(session)) {
// The modal may have opened as Cancel was pressed: close it first.
if (modalState) await closeLeadModal();
candidateFailures.push('CANCELLED');
break;
}
if (!modalState) {
debugLog('[KonnectLeadChecker] modal did not become ready for candidate at', candidate.rawTimestamp);
candidateFailures.push('LEAD_MODAL_TIMEOUT');
continue;
}
// Empty Date/Source has been seen; logging the matched element shows
// whether it is a stale or hidden lookalike of the modal.
debugLog('[KonnectLeadChecker] modal element matched:', modalState.modal.className, '| panel used:', modalState.panel === modalState.modal ? '(fell back to whole modal - no .tab-pane.active found)' : modalState.panel.className, '| visible rect:', JSON.stringify(modalState.modal.getBoundingClientRect()));
debugLog('[KonnectLeadChecker] modal panel outerHTML (first 1500 chars):', modalState.panel.outerHTML.slice(0, 1500));
const panelFields = extractLeadPanelFields(modalState.panel);
debugLog('[KonnectLeadChecker] modal opened - extracted fields:', JSON.stringify(panelFields));
const validation = validateLeadCandidate(panelFields, candidate.parsed, row);
if (validation.ok) {
const initialNotes = extractInitialNotes(modalState.panel);
let followUp = [];
if (isPostClosureEntry(row, panelFields, candidate.row)) {
followUp = await readModalList(modalState.modal, 'Follow Up', 'item in surveyDetailData');
}
validated.push({ candidate, panelFields, initialNotes, followUp, warnings: validation.warnings || [] });
} else {
debugLog('[KonnectLeadChecker] validation rejected candidate:', validation.reason);
candidateFailures.push('LEAD_VALIDATION_FAILED');
// Both the candidate's time and the row's Created/Last Actioned are shown,
// since a call-fallback match differs between them.
candidateFailureDetails.push(`${validation.reason} (modal Date="${panelFields.date || ''}", candidate timeline entry="${candidate.rawTimestamp || ''}", modal Source="${panelFields.source || ''}", SLA/input Created="${row.created}", SLA Source="${row.source}")`);
}
await closeLeadModal();
}

// A call fallback can land on the earlier lead when the dealership's call
// was logged there. A Post Closure row then retries with the one Post
// Closure lead on the page, found by its heading.
if (validated.length === 0 && !retried && candidateFailures.every((f) => f === 'LEAD_VALIDATION_FAILED')
&& String(row.source || '').toLowerCase() === 'post closure processing') {
const leadId = findUnambiguousPostClosureLeadId();
const entry = leadId ? findLeadEntryByLeadId(leadId) : null;
if (entry && !workingCandidates.some((c) => c.row === entry)) {
const rawTimestamp = extractTimelineTimestamp(entry);
const parsed = rawTimestamp ? parseTimelineTimestamp(rawTimestamp, new Date()) : null;
return classifyCandidates(row, session, result, [{ row: entry, rawTimestamp, parsed, leadId }], true);
}
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

const { candidate, panelFields, initialNotes, followUp, warnings } = validated[0];
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

// Source falls back to the modal; campaign does not, because the modal
// Campaign is the marketing form name, not Konnect's SLA categorisation.
// A Post Closure lead that was called is listed in Pending under its new
// callback type (Auto Rescheduled), so it arrives with no source; its own
// timeline heading still says Post Closure Processing.
const resolvedSource = isPostClosureEntry(row, panelFields, candidate.row) ? POST_CLOSURE_LIST_SOURCE : (row.source || panelFields.source);
// Call entries are only scanned for Post Closure rows (Step 13).
const isPostClosureLead = String(resolvedSource || '').toLowerCase() === 'post closure processing';
const decision = isPostClosureLead
? postClosureSendBackReason(candidate.leadId, { sent: sentThroughNotes(followUp), team: initialNotes })
: { reason: '', evidence: '' };
const alreadyEngagedCallEntry = !!decision.reason;
const classification = classifyLead(initialNotes, { campaign: row.campaign, source: resolvedSource, hasAlreadyEngagedCallEntry: alreadyEngagedCallEntry, leadRequest: panelFields.campaign && panelFields.campaign.parenthetical });
if (classification.confidence === 'low') {
// Tentative tier and reasoning are kept on an EXCEPTION so a reviewer can
// see them; it is never auto-applied, and the export leaves the tier blank
// until it is reviewed.
return finalizeResult(result, {
status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', initialNotes,
source: classification.source,
tier: classification.tier, tierName: classification.tierName, subCategory: classification.subCategory, subRank: classification.subRank,
flags: classification.flags, dedupeKey: classification.dedupeKey, postClosureAction: classification.postClosureAction,
postClosureReason: classification.postClosureAction === 'send back through' ? decision.reason : '',
postClosureEvidence: classification.postClosureAction === 'send back through' ? decision.evidence : '',
reason: classification.reason, confidence: classification.confidence, alternative: classification.alternative || null, ...auditPatch
});
}

return finalizeResult(result, {
status: 'CLASSIFIED',
source: classification.source,
tier: classification.tier, tierName: classification.tierName, subCategory: classification.subCategory, subRank: classification.subRank,
flags: classification.flags, dedupeKey: classification.dedupeKey, postClosureAction: classification.postClosureAction,
postClosureReason: classification.postClosureAction === 'send back through' ? decision.reason : '',
postClosureEvidence: classification.postClosureAction === 'send back through' ? decision.evidence : '',
reason: classification.reason,
confidence: classification.confidence,
initialNotes,
...auditPatch
});
}

async function processPostClosureListRow(row, session, result, referenceNow) {
let candidates = findNewestPostClosureCandidates(referenceNow);
for (let attempt = 0; candidates.length === 0 && attempt < 5; attempt++) {
if (isCancelled(session)) return finalizeResult(result, { status: 'EXCEPTION', exception: 'CANCELLED' });
const scroll = await loadOlderTimelineEntries();
candidates = findNewestPostClosureCandidates(referenceNow);
if (scroll.status !== 'OK' || !scroll.loadedNewEntries) break;
}
if (candidates.length === 0) return finalizeResult(result, { status: 'EXCEPTION', exception: 'POST_CLOSURE_LEAD_NOT_FOUND' });
return classifyCandidates(row, session, result, candidates);
}

// ===================================================================
// OPEN A CUSTOMER BY HAND (the initials button on a result)
//
// Opens one result's customer and lead on the page for a person to read.
// It uses the run's own search and lead finding, records nothing and
// leaves the lead window open. token stands in for the session: only its
// cancelled flag is read.
// ===================================================================

// Set when a customer was opened by hand, so the next run step knows the
// page is no longer on its own customer.
let pageMovedByHand = false;

// Calls find() until it returns something, loading older timeline entries
// in between, as the run does.
async function findWithOlderEntries(find, token) {
let found = find();
for (let attempt = 0; found.length === 0 && attempt < 5; attempt++) {
if (isCancelled(token)) break;
const scroll = await loadOlderTimelineEntries();
found = find();
if (scroll.status !== 'OK' || !scroll.loadedNewEntries) break;
}
return found;
}

function leadCandidateFromEntry(entry, referenceNow) {
const rawTimestamp = extractTimelineTimestamp(entry);
return { row: entry, rawTimestamp, parsed: rawTimestamp ? parseTimelineTimestamp(rawTimestamp, referenceNow) : null, leadId: extractVisibleLeadId(entry) };
}

// Opens each candidate and keeps the window open only when exactly one is
// the row's lead, by the same check the run makes. Never settles for a
// lead that does not validate.
async function openOnlyValidLead(candidates, row, token) {
if (candidates.length === 0) return { status: 'NOT_FOUND', why: '' };
const valid = [];
let why = '';
for (const candidate of candidates) {
if (isCancelled(token)) return { status: 'CANCELLED' };
const modalState = await openLeadModal(candidate.row);
if (isCancelled(token)) { if (modalState) await closeLeadModal(); return { status: 'CANCELLED' }; }
if (!modalState) { why = 'the lead window did not open'; continue; }
const ok = validateLeadCandidate(extractLeadPanelFields(modalState.panel), candidate.parsed, row).ok;
if (ok) valid.push(candidate); else why = 'the lead window that opened did not match';
if (!ok || candidates.length > 1) await closeLeadModal();
}
if (valid.length > 1) return { status: 'NOT_FOUND', why: 'more than one lead matches' };
if (valid.length === 0) return { status: 'NOT_FOUND', why };
if (candidates.length > 1 && !(await openLeadModal(valid[0].row))) return { status: 'NOT_FOUND', why: 'the lead window did not open' };
return { status: 'OPEN' };
}

async function openNationalLeadForRow(row, result, token) {
let items = [];
const knownId = result && result.leadId ? String(result.leadId) : '';
const ids = await findWithOlderEntries(() => {
items = readAllTimelineItems();
if (knownId && items.some((i) => Number(i.TimelineItemType) === 1 && String(i.LeadID) === knownId)) return [knownId];
return findNationalLeadIds(items, row.parsedCreated);
}, token);
if (isCancelled(token)) return { status: 'CANCELLED' };
const found = ids.length > 0 ? ids : findNationalLeadIdsByContact(items, parseNationalCreated(row.lastContact));
if (found.length > 1) return { status: 'NOT_FOUND', why: 'more than one lead was created at that time' };
const leadItem = found.length === 1 ? items.find((i) => Number(i.TimelineItemType) === 1 && String(i.LeadID) === found[0]) : null;
if (!leadItem || !leadItem.__row) return { status: 'NOT_FOUND', why: '' };
const modalState = await openLeadModal(leadItem.__row);
if (isCancelled(token)) { if (modalState) await closeLeadModal(); return { status: 'CANCELLED' }; }
if (!modalState) return { status: 'NOT_FOUND', why: 'the lead window did not open' };
// As in the run: a window on another campaign is a different lead.
const campaign = extractCampaignField(modalState.panel).primary || '';
if (!nationalCampaignsMatch(campaign, row.campaign)) {
await closeLeadModal();
return { status: 'NOT_FOUND', why: 'the lead window that opened did not match' };
}
return { status: 'OPEN' };
}

// The lead a row is about, on the open timeline: the one the run recorded
// if it is there, else by created time, then the call fallback, then the
// Post Closure heading.
async function openLeadForRow(row, result, token) {
if (row.mode === 'national') return openNationalLeadForRow(row, result, token);
const referenceNow = new Date();
const knownId = result && result.visibleLeadId ? String(result.visibleLeadId) : '';
let candidates = await findWithOlderEntries(() => {
const known = knownId ? findLeadEntryByLeadId(knownId) : null;
if (known) return [leadCandidateFromEntry(known, referenceNow)];
if (row.mode === 'postClosureList') return findNewestPostClosureCandidates(referenceNow);
return findMatchingLeadCandidates(row.created, referenceNow).candidates;
}, token);
if (isCancelled(token)) return { status: 'CANCELLED' };
if (candidates.length === 0 && row.mode !== 'postClosureList') {
const callFallback = await findLeadCandidateViaCallFallback(row.created, token, referenceNow);
if (callFallback.status === 'CANCELLED') return { status: 'CANCELLED' };
if (callFallback.status === 'OK') candidates = [callFallback.candidate];
}
const postClosure = /post closure processing/i.test(String(row.source || ''));
const byHeading = () => {
const entry = postClosure ? findLeadEntryByLeadId(findUnambiguousPostClosureLeadId()) : null;
return entry && !candidates.some((c) => c.row === entry) ? [leadCandidateFromEntry(entry, referenceNow)] : [];
};
if (candidates.length === 0) candidates = byHeading();
let opened = await openOnlyValidLead(candidates, row, token);
if (opened.status === 'NOT_FOUND' && candidates.length > 0) {
const retry = byHeading();
if (retry.length > 0) opened = await openOnlyValidLead(retry, row, token);
}
return opened;
}

// Searches for the row's customer as the run does, opens the timeline, then
// the lead. group is the row's group in the batch.
async function openRowOnPage(group, row, result, token) {
const opened = await searchAndOpenCustomer(group, token);
if (isCancelled(token)) return { status: 'CANCELLED' };
if (opened.status !== 'OK') return { status: 'NO_CUSTOMER', exception: opened.exception };
if (opened.noEligibleEvents) return { status: 'TIMELINE_ONLY', why: 'there are no sales leads on the timeline' };
const lead = await openLeadForRow(row, result, token);
if (lead.status === 'OPEN' || lead.status === 'CANCELLED') return lead;
return { status: 'TIMELINE_ONLY', why: lead.why || '' };
}

// Pure. The state line for each outcome.
function openOutcomeText(row, outcome) {
const name = row.name || 'This customer';
if (outcome.status === 'OPEN') return `${name} is open: timeline and lead.`;
if (outcome.status === 'TIMELINE_ONLY') {
const created = String(row.created || '').replace(/^[A-Za-z]{3},\s*/, '');
const which = row.mode === 'postClosureList' ? 'the newest Post Closure lead' : (created ? `the lead for ${created}` : 'the lead');
return `${name} is open, timeline only: ${which} was not found${outcome.why ? ` (${outcome.why})` : ''}.`;
}
if (outcome.status === 'NO_CUSTOMER') {
if (!outcome.exception || outcome.exception === 'SEARCH_NO_RESULTS') return `No customer found for ${row.name || 'this lead'}.`;
return `${name} could not be opened: ${exceptionLabel(outcome.exception).toLowerCase()}.`;
}
return `${name} could not be opened: the tool hit an error.`;
}

runSelfTest('openOutcomeTextSelfTest', function openOutcomeTextSelfTest() {
const failures = [];
const check = (label, actual, expected) => { if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`); };
const row = { name: 'Sam Buyer', created: 'Tue, 10 Nov 2026 09:05' };
check('customer and lead', openOutcomeText(row, { status: 'OPEN' }), 'Sam Buyer is open: timeline and lead.');
check('timeline only', openOutcomeText(row, { status: 'TIMELINE_ONLY', why: '' }), 'Sam Buyer is open, timeline only: the lead for 10 Nov 2026 09:05 was not found.');
check('timeline only with a cause', openOutcomeText(row, { status: 'TIMELINE_ONLY', why: 'more than one lead matches' }), 'Sam Buyer is open, timeline only: the lead for 10 Nov 2026 09:05 was not found (more than one lead matches).');
check('Post Closure list has no time', openOutcomeText({ name: 'Sam Buyer', mode: 'postClosureList', created: '' }, { status: 'TIMELINE_ONLY' }), 'Sam Buyer is open, timeline only: the newest Post Closure lead was not found.');
check('nobody found', openOutcomeText(row, { status: 'NO_CUSTOMER', exception: 'SEARCH_NO_RESULTS' }), 'No customer found for Sam Buyer.');
if (failures.length > 0) console.error('KonnectLeadChecker open-outcome self-test FAILED:\n' + failures.join('\n'));
else console.info('KonnectLeadChecker open-outcome self-test passed');
});

// Pure. The three things a booking check reads from a customer's timeline
// items. since is when the booking was made (ISO). The appointment and its
// outcome count from the start of that day; the send to the dealership
// only from that minute on, as it follows Finished. EventTime carries no
// seconds worth trusting, so the send is compared to the minute.
function bookingCheckFrom(items, since) {
const sinceMs = Date.parse(String(since || ''));
const none = { appointment: false, outcome: false, sent: false };
if (isNaN(sinceMs)) return none;
const at = new Date(sinceMs);
const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
const minuteStart = Math.floor(sinceMs / 60000) * 60000;
(items || []).forEach((item) => {
const when = item ? eventTimeMs(item.EventTime) : null;
if (when == null || when < dayStart) return;
const heading = String(item.BelowLineTitle || '');
const description = String(item.Description || '');
if (/^\s*appointment created\b/i.test(heading)) none.appointment = true;
if (/->\s*Appointment\s*->/i.test(description)) none.outcome = true;
if (when >= minuteStart && /^\s*lead sent to enquiry max\b/i.test(heading) && /success\w* received/i.test(description)) none.sent = true;
});
return none;
}

// Pure. One line for the owner about what a booking check found.
function bookingCheckText(name, found) {
const parts = [
found.appointment ? 'in the diary' : 'not in the diary yet',
found.outcome ? 'outcome set' : 'no appointment outcome yet',
found.sent ? 'sent to the dealership' : 'not sent to the dealership yet'
];
return `${name || 'This booking'}: ${parts.join(', ')}.`;
}

runSelfTest('bookingCheckSelfTest', function bookingCheckSelfTest() {
const failures = [];
const check = (label, actual, expected) => {
if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const it = (time, below, desc) => ({ TimelineItemType: 0, LeadID: 1400300, EventTime: `2026-11-${time}+00:00`, BelowLineTitle: below, Description: desc });
// Booked at 10:05 on the 13th by the clock this runs on, as the page's times are.
const since = new Date(2026, 10, 13, 10, 5, 20).toISOString();
const appointment = it('13T10:05:02.113', 'Appointment Created', 'Appointment Created by Sam Tester of type Test Drive at Crawley');
const outcome = it('13T10:07:40', 'Sam Tester called the customer with an outcome of Spoke To Customer', 'Sales -> ART -> Appointment -> Test Drive at Crawley');
const sent = it('13T10:08:10', 'Lead sent to Enquiry Max', 'Lead sent by Sam Tester and successfuly received at Crawley');
const all = { appointment: true, outcome: true, sent: true };
check('all three present', bookingCheckFrom([sent, outcome, appointment], since), all);
check('not sent yet: the lead is not finished', bookingCheckFrom([outcome, appointment], since), { appointment: true, outcome: true, sent: false });
const oldAppointment = it('06T15:20:00', 'Appointment Created', 'Appointment Created by Sam Tester of type Test Drive at Crawley');
const oldOutcome = it('06T15:22:00', 'Sam Tester called the customer with an outcome of Spoke To Customer', 'Sales -> ART -> Appointment -> Test Drive at Crawley');
check('an appointment and outcome from an earlier day do not count', bookingCheckFrom([oldOutcome, oldAppointment], since), { appointment: false, outcome: false, sent: false });
const earlierSend = it('13T09:30:00', 'Lead sent to Enquiry Max', 'Lead sent by Sam Tester and successfuly received at Crawley');
check('a send from before the booking does not count', bookingCheckFrom([earlierSend, outcome, appointment], since), { appointment: true, outcome: true, sent: false });
check('a send in the minute of the booking counts', bookingCheckFrom([it('13T10:05:00', 'Lead sent to Enquiry Max', 'Lead sent by Sam Tester and successfully received at Crawley')], since).sent, true);
check('a send that was not received does not count', bookingCheckFrom([it('13T10:08:10', 'Lead sent to Enquiry Max', 'Lead sent by Sam Tester and failed at Crawley')], since).sent, false);
check('an appointment earlier on the day of the booking counts', bookingCheckFrom([it('13T08:00:00', 'Appointment Created', '')], since).appointment, true);
check('a call outcome that is not an appointment does not count', bookingCheckFrom([it('13T10:07:40', 'Sam Tester called the customer with an outcome of Spoke To Customer', 'Sales -> ART -> Ongoing -> Call Back')], since).outcome, false);
check('an entry with no time does not count', bookingCheckFrom([{ BelowLineTitle: 'Appointment Created', Description: '' }], since).appointment, false);
check('no booking time: nothing is confirmed', bookingCheckFrom([sent, outcome, appointment], ''), { appointment: false, outcome: false, sent: false });
check('text, all three', bookingCheckText('Casey Bookwell', all), 'Casey Bookwell: in the diary, outcome set, sent to the dealership.');
check('text, not sent', bookingCheckText('Casey Bookwell', { appointment: true, outcome: true, sent: false }), 'Casey Bookwell: in the diary, outcome set, not sent to the dealership yet.');
check('text, nothing yet', bookingCheckText('', { appointment: false, outcome: false, sent: false }), 'This booking: not in the diary yet, no appointment outcome yet, not sent to the dealership yet.');
if (failures.length > 0) console.error('KonnectLeadChecker booking-check self-test FAILED:\n' + failures.join('\n'));
else console.info('KonnectLeadChecker booking-check self-test passed');
});

// Searches for the customer as the run does and reads the booking check
// from their timeline. The lead window is never opened. A record found by
// name alone is only used if its timeline has something from that day on.
async function verifyBookingOnPage(group, since, token) {
const at = new Date(Date.parse(since));
const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
const hasEntrySince = () => readAllTimelineItems().some((item) => { const when = eventTimeMs(item.EventTime); return when != null && when >= dayStart; });
const opened = await searchAndOpenCustomer(group, token, hasEntrySince);
if (isCancelled(token)) return { status: 'CANCELLED' };
if (opened.status !== 'OK') return { status: 'NO_CUSTOMER', exception: opened.exception };
await waitForTimelineItemsSettled();
if (isCancelled(token)) return { status: 'CANCELLED' };
return Object.assign({ status: 'READ' }, bookingCheckFrom(readAllTimelineItems(), since));
}

// Pure. What kind of check a pasted batch is, shown above the status.
const CHECK_SCENARIOS = {
standard: { label: 'Normal check', detail: 'SLA and Pending leads, matched by created time', color: '#2563eb' },
national: { label: 'National check', detail: 'National leads, checked for a reschedule or a dealer send', color: '#7c3aed' },
postClosureList: { label: 'Post Closure check', detail: 'Newest Post Closure lead on each customer', color: '#b45309' }
};
// SLA Manager's Pending export leaves Source blank (Post Closure aside),
// while SLA rows always carry one, so the rows tell the two apart.
function checkScenarioOf(mode, rows) {
const scenario = CHECK_SCENARIOS[mode || 'standard'] || CHECK_SCENARIOS.standard;
if ((mode || 'standard') !== 'standard' || !rows || rows.length === 0) return scenario;
const pendingLike = rows.filter((r) => !r.source || /post closure processing/i.test(r.source)).length;
if (pendingLike === rows.length) return { ...scenario, label: 'Normal check: Pending', detail: 'Pending leads, matched by last actioned time' };
if (pendingLike === 0) return { ...scenario, label: 'Normal check: SLA', detail: 'SLA leads, matched by created time' };
return scenario;
}

// Pure. What the time beside each lead is: SLA rows carry the created
// time, Pending rows the last actioned time, and the customer search table
// carries none.
function leadTimeLabel(mode, rows) {
if (mode === 'postClosureList') return 'Lead';
if (mode === 'national') return 'Lead created';
const label = checkScenarioOf(mode, rows).label;
if (/Pending$/.test(label)) return 'Last actioned';
if (/SLA$/.test(label)) return 'Lead created';
return 'Created or last actioned';
}

runSelfTest('postClosureSearchBatchSelfTest', function postClosureSearchBatchSelfTest() {
const failures = [];
const check = (label, actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
const pasted = [
'Name\tDetails\tVehicles\tMagic Num\tDealer\tBrand\tCampaign\tBest Number\tEmail\tAddress\tConfirm',
'Alex Sample\tView\t\t\tPreston\tPeugeot\tPeugeot - Enquiry - New\t07700 900123\talex@example.com\t\t',
'Mr. Sam Buyer\tView\tAB12CDE\t\tWimbledon\tStellantis &You\tPX Valuation - Used\t07700900456\tsam@example.com\t\t',
'Jo Example\tView\t\t\tCrawley\tCitroen\tCitroen - Offer Request - New\t\t'
].join('\n');
const parsed = parseBatchInput(pasted);
check('customer search table accepted', [parsed.headerOk, parsed.mode, parsed.rows.length], [true, 'postClosureList', 3]);
const sam = parsed.rows[1];
check('columns read by name', [sam.name, sam.phone, sam.email, sam.campaign, sam.source, sam.created], ['Mr. Sam Buyer', '07700900456', 'sam@example.com', 'PX Valuation - Used', 'Post Closure Processing', '']);
check('rows are queued without a created time', parsed.rows.map((r) => r.status), ['QUEUED', 'QUEUED', 'QUEUED']);
check('a row with only a name is grouped by name', parsed.rows[2].groupKey, 'name:' + normalizeCustomerName('Jo Example'));
const t = (type, lead, time, below, desc, agent) => ({ TimelineItemType: type, LeadID: lead, EventTime: `2026-11-${time}:00+00:00`, BelowLineTitle: below, Description: desc, IsContactCentreAgent: agent });
const walkIn = [
t(1, 1400100, '08T10:25', 'Manually Created Sales Lead from Customer First', "New Sales Lead, 'Enquiry Request' for Preston Lead routed", false),
t(2, 1400100, '08T14:15', 'Lead sent to Enquiry Max', 'Lead sent by Agent A and successfuly received at Preston', false),
t(3, 1400101, '08T14:17', 'Dealer B Scheduled a call', 'New Enquiry at Preston', false),
t(1, 1400101, '08T14:18', '', 'Walk-in lead created in Enquiry Max at Preston', false),
t(1, 1400102, '09T15:15', 'Manually Created Sales Lead from Post Closure Processing', "New Sales Lead, 'Enquiry Request' for Preston Lead routed", false)
];
const edit = (list, type, patch) => list.map((i) => (i.TimelineItemType === type ? { ...i, ...patch } : i));
const dealerScheduledCallAfterSend = (items, leadId) => { const match = postClosureSourceLead(items, leadId); return !!match && !!dealerActionAfterSend(items, match.sends); };
check('matching lead was sent to the dealership, which then scheduled a call on another lead', dealerScheduledCallAfterSend(walkIn, 1400102), true);
check('a call scheduled by another dealership does not count', dealerScheduledCallAfterSend(edit(walkIn, 3, { Description: 'New Enquiry at Crawley' }), 1400102), false);
check('a call scheduled before the send does not count', dealerScheduledCallAfterSend(edit(walkIn, 3, { EventTime: '2026-11-08T09:00:00+00:00' }), 1400102), false);
check('an ordinary call is not a scheduled call', dealerScheduledCallAfterSend(edit(walkIn, 3, { BelowLineTitle: 'Agent A called the customer with an outcome of No Answer' }), 1400102), false);
check('a send from a lead that does not match the Post Closure lead does not count', dealerScheduledCallAfterSend(walkIn.map((i) => (i.LeadID === 1400100 && i.TimelineItemType === 1 ? { ...i, Description: "New Sales Lead, 'Offer Request' for Preston Lead routed" } : i)), 1400102), false);
check('a matching lead sent to another dealership does not count', dealerScheduledCallAfterSend(edit(walkIn, 2, { Description: 'Lead sent by Agent A and successfuly received at Crawley' }), 1400102), false);
check('the Post Closure lead must be known', dealerScheduledCallAfterSend(walkIn, 1499999), false);
check('a dealer action is the reason', postClosureDecision(walkIn, 1400102, false).reason, 'Actioned by dealership');
check('engagement on the lead itself is a dealer action', postClosureDecision([], 1400102, true).reason, 'Actioned by dealership');
check('an offer from the dealership counts', postClosureDecision(edit(walkIn, 3, { BelowLineTitle: 'Dealer B sent an offer' }), 1400102, false).reason, 'Actioned by dealership');
const hubSent = (below, desc) => walkIn.filter((i) => i.TimelineItemType !== 3).concat(t(3, 1400100, '08T14:10', below, desc, true));
check('email only lead sent through', postClosureDecision(hubSent('Agent A called the customer with an outcome of No Answer', 'Sales -> Customer Hub Team -> Ongoing -> Email Only Lead at Preston'), 1400102, false).reason, 'Email only');
check('sent through after speaking to the customer', postClosureDecision(hubSent('Agent A called the customer with an outcome of Spoke To Customer', 'New Enquiry at Preston'), 1400102, false).reason, "In market won't commit");
check('sent through with no hub contact or dealer action needs contact', postClosureDecision(hubSent('Agent A called the customer with an outcome of No Answer', 'No Activity Outcome at Preston'), 1400102, false).reason, '');
check('not sent through needs contact', postClosureDecision(hubSent('Agent A called the customer with an outcome of Spoke To Customer', '').filter((i) => i.TimelineItemType !== 2), 1400102, false).reason, '');
const offered = [
t(1, 1400200, '02T13:31', '', "New Sales Lead, 'Test Drive - New Request' for Preston Lead routed", false),
t(1, 1400201, '04T14:00', '', "New Sales Lead, 'Offer - New Request' for Preston Lead routed", false),
t(2, 1400201, '04T14:05', 'Lead sent to Enquiry Max', 'Lead sent by Agent A and successfuly received at Preston', false),
t(13, 1400202, '06T10:20', 'Offer Sent', 'Offer Sent by Dealer C for Preston', false)
];
check('an offer sent by the dealership after the checked lead was sent', postClosureDecision(offered, 1400201, false).reason, 'Actioned by dealership');
check('an offer from another dealership does not count', postClosureDecision(edit(offered, 13, { Description: 'Offer Sent by Dealer C for Crawley' }), 1400201, false).reason, '');
const noSale = offered.filter((i) => i.TimelineItemType !== 13).concat(t(9, 1400201, '07T14:24', 'No Sale', "Final Outcome 'No Sale' set by Dealer D at Preston", false));
check('a final outcome the dealership set on the lead', postClosureDecision(noSale, 1400201, false).reason, 'Actioned by dealership');
const earlierLeadCall = [
t(1, 1400300, '07T06:02', '', "New Sales Lead, 'Offer - New Request' for Preston Lead routed", false),
t(2, 1400300, '07T16:04', 'Lead sent to Enquiry Max', 'Lead sent by Agent A and successfuly received at Preston', false),
t(3, 1400300, '08T10:00', 'Dealer E Scheduled a call', 'New Enquiry at Preston', false),
t(1, 1400301, '09T09:04', 'Manually Created Sales Lead from Post Closure Processing', "New Sales Lead, 'Offer - New Request' for Preston Lead routed", false)
];
check('a call the dealership scheduled on the earlier lead itself', postClosureDecision(earlierLeadCall, 1400301, false).reason, 'Actioned by dealership');
check('an older lead with another request is not the matching lead', postClosureSourceLead(earlierLeadCall.concat(t(1, 1400299, '01T09:00', '', "New Sales Lead, 'Enquiry - New Request' for Preston Lead routed", false)), 1400301).source.LeadID, 1400300);
check('the deciding entry is given as evidence', postClosureDecision(offered, 1400201, false).evidence, 'Offer Sent: Offer Sent by Dealer C for Preston (2026-11-06 10:20)');
const sentOnly = walkIn.filter((i) => i.TimelineItemType !== 3);
check('notes sent through saying email only', postClosureDecision(sentOnly, 1400102, false, { sent: 'Lead sent to Enquiry Max | Email only lead, no number given' }).reason, 'Email only');
check('other notes sent through mean in market', postClosureDecision(sentOnly, 1400102, false, { sent: 'Lead sent to Enquiry Max | Booked test drive Saturday' }), { reason: "In market won't commit", evidence: 'Sent through: Booked test drive Saturday' });
check('voicemail notes sent through are not in market', postClosureDecision(sentOnly, 1400102, false, { sent: 'Lead sent to Enquiry Max | No answer, voicemail left x3, max attempts' }).reason, '');
check('spoke notes that mention a voicemail are in market', postClosureDecision(sentOnly, 1400102, false, { sent: 'Lead sent to Enquiry Max | Spoke to customer, left voicemail after' }).reason, "In market won't commit");
check('team notes saying email only when nothing was sent with notes', postClosureDecision(sentOnly, 1400102, false, { sent: '', team: 'Customer Comments: -\nEmail only lead' }).reason, 'Email only');
check('a dealer action outranks the notes', postClosureDecision(walkIn, 1400102, false, { sent: 'Email only lead' }).reason, 'Actioned by dealership');
const followUp = [
{ CreatedDate: 'Fri 6th Nov 2026 09:43', CreatedBy: 'System', Comment: 'Lead sent to Enquiry Max' },
{ CreatedDate: 'Fri 6th Nov 2026 09:43', CreatedBy: 'Agent A', Comment: 'Email only lead' },
{ CreatedDate: 'Fri 6th Nov 2026 09:42', CreatedBy: 'Agent A', Comment: 'Tried calling, no answer' },
{ CreatedDate: 'Sat 7th Nov 2026 10:00', CreatedBy: 'Agent B', Comment: 'Post Closure note sent to Enquiry Max' }
];
check('notes sent through are the comments within a few minutes of the newest send, without the system line', sentThroughNotes(followUp), 'Email only lead | Tried calling, no answer');
check('a send with no agent comment gives no notes', sentThroughNotes(followUp.slice(0, 1)), '');
check('a comment long before the send is not part of it', sentThroughNotes([followUp[0], { CreatedDate: 'Fri 6th Nov 2026 09:20', CreatedBy: 'Agent A', Comment: 'Spoke to customer' }]), '');
check('an agent comment that itself records the send is kept', sentThroughNotes([{ CreatedDate: 'Fri 6th Nov 2026 09:43', CreatedBy: 'Agent A', Comment: 'Spoke to customer, sent to Enquiry Max' }]), 'Spoke to customer, sent to Enquiry Max');
check('a bare send line alone decides nothing', postClosureDecision(sentOnly, 1400102, false, { sent: 'Lead sent to Enquiry Max' }).reason, '');
check('a no answer note a minute before the send is not in market', postClosureDecision(sentOnly, 1400102, false, { sent: sentThroughNotes([followUp[0], { CreatedDate: 'Fri 6th Nov 2026 09:42', CreatedBy: 'Agent A', Comment: 'No answer, max attempts' }]) }).reason, '');
check('"not email only" in the team notes is not email only', postClosureDecision(sentOnly, 1400102, false, { sent: '', team: 'Customer is not email only, please call' }).reason, '');
check('"not email only" sent through is not email only', postClosureDecision(sentOnly, 1400102, false, { sent: 'Spoke to customer, this is not an email only lead' }).reason, "In market won't commit");
check('email only wording', [saysEmailOnly('Email only lead'), saysEmailOnly('EMAIL ONLY - no number'), saysEmailOnly("isn't email only"), saysEmailOnly('Not email only. Later: email only please')], [true, true, false, true]);
check('the dealerships named in a Description that runs over several lines', [dealersNamedIn({ Description: 'New Enquiry at Preston\r\nCustomer asked for a call back' }), dealersNamedIn({ Description: 'No Answer, Message Left.\r\nMax Attempts Reached\r\n' })], [['preston', 'a call back'], []]);
check('a dealer action whose Description runs over several lines still matches the send', postClosureDecision(edit(walkIn, 3, { Description: 'New Enquiry at Preston\r\nCustomer asked for a call back' }), 1400102, false).reason, 'Actioned by dealership');
check('no send in Follow Up means no sent notes', sentThroughNotes(followUp.slice(2)), '');
check('Follow Up dates read', parseFollowUpDate('Fri 6th Nov 2026 09:43'), new Date(2026, 10, 6, 9, 43).getTime());
check('dealer entries are recognised', [
isDealerAction(t(16, 1, '01T09:00', 'Advisor Confirmed', 'Advisor Confirmed appointment by Dealer B', false)),
isDealerAction(t(3, 1, '01T09:00', 'Dealer B Completed a call', 'Unknown reason for call at Preston', false)),
isDealerAction(t(3, 1, '01T09:00', 'Agent A called the customer with an outcome of No Answer', 'New Enquiry at Preston', true)),
isDealerAction(t(9, 1, '01T09:00', 'Sale (Offer Accepted)', "Final Outcome 'Sale (Offer Accepted)' set by Dealer B at Preston", false))
], [true, true, false, true]);
check('the dealership named in an entry', [dealersNamedIn({ Description: 'Offer Sent by Dealer C for Preston' }), dealersNamedIn({ Description: "Final Outcome 'No Sale' set by Dealer D at Preston" })], [['preston'], ['preston']]);
const pcResult = { inputIndex: 0, status: 'CLASSIFIED', tier: 5, postClosureAction: 'check: needs contact?', postClosureReason: '', postClosureEvidence: '' };
const decidedPc = applyPostClosureDecision(pcResult, 'send back through', 'Email only', 'email only in follow up');
check('a hand Post Closure decision', [decidedPc.postClosureAction, decidedPc.postClosureReason, decidedPc.manualOverride, decidedPc.tentative.postClosureAction], ['send back through', 'Email only', true, 'check: needs contact?']);
check('undo restores the checker decision', undoManualReviewDecision(decidedPc).postClosureAction, 'check: needs contact?');
check('reason shown with the action', postClosureLabel({ postClosureAction: 'send back through', postClosureReason: 'Email only' }), 'send back through: Email only (CAH)');
check('dealer reason shows CAD', postClosureLabel({ postClosureAction: 'send back through', postClosureReason: 'Actioned by dealership' }), 'send back through: Actioned by dealership (CAD)');
check('SLA and Pending batches told apart', [
checkScenarioOf('standard', [{ source: 'Customer First' }, { source: 'Autotrader' }]).label,
checkScenarioOf('standard', [{ source: '' }, { source: 'Post Closure Processing' }]).label,
checkScenarioOf('standard', [{ source: 'Customer First' }, { source: '' }]).label
], ['Normal check: SLA', 'Normal check: Pending', 'Normal check']);
check('scenario labels', ['standard', 'national', 'postClosureList', undefined].map((m) => checkScenarioOf(m).label), ['Normal check', 'National check', 'Post Closure check', 'Normal check']);
check('the usual batch header still works', parseBatchInput('Name\tPhone\tEmail\tSource\tCampaign\tCreated\nA\t07700900123\t\tX\tY\tSat, 26 Sep 2026 18:05').headerOk, true);
if (failures.length) console.error('KonnectLeadChecker post-closure-search self-test FAILED:\n' + failures.join('\n'));
else console.info('KonnectLeadChecker post-closure-search self-test passed');
});

// Codes that are a normal outcome, not a sign the page has changed.
const STREAK_IGNORED_EXCEPTIONS = new Set(['CLASSIFICATION_REVIEW_REQUIRED', 'CANCELLED', 'INVALID_INPUT']);
const REPEATED_FAILURE_LIMIT = 3;

// Pauses the run when several customers in a row fail with the same
// code: one site change would otherwise fail every remaining lead, each
// after its own timeout.
function noteGroupOutcome(session, group) {
if (!group) return;
const codes = group.rows.map((row) => {
const r = session.results[row.inputIndex];
return r && r.status === 'EXCEPTION' ? r.exception : null;
});
const code = codes[0];
const sameFailure = code && !STREAK_IGNORED_EXCEPTIONS.has(code) && codes.every((c) => c === code);
if (!sameFailure) { session.failureStreak = null; return; }
const streak = session.failureStreak && session.failureStreak.code === code ? session.failureStreak.count + 1 : 1;
session.failureStreak = { code, count: streak };
if (streak >= REPEATED_FAILURE_LIMIT) {
session.paused = true;
session.failureStreak = null;
lcNotices.stopped = `Stopped: the last ${REPEATED_FAILURE_LIMIT} leads all failed the same way (${exceptionLabel(code)}). Konnect may have changed or be slow. Check the page, then press Resume to continue.`;
notifyNoticesChanged();
}
}

function advanceToNextGroup(session) {
noteGroupOutcome(session, session.groups[session.groupIndex]);
session.groupIndex++;
session.rowInGroupIndex = 0;
if (session.groupIndex >= session.groups.length) session.done = true;
}

// Reuses newSession's resume logic: rewind groupIndex to the earliest
// group with any unresolved row.
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

// In memory only: shows what just finished, since the live status line
// changes too fast to read. Capped at 5, reset when a session is cleared.
let recentCompletions = [];
function recordResult(session, inputIndex, result) {
session.results[inputIndex] = result;
recentCompletions.unshift(result);
if (recentCompletions.length > 5) recentCompletions.length = 5;
}

// The group the last step worked on. stepOnce can skip past groups that
// already have results, so the index from before the step is not it.
let lastStepGroupIndex = -1;

// Where a run's time went, in whole numbers only: no customer data.
const runTiming = { leads: 0, findMs: 0, readMs: 0, startedAt: 0 };
function resetRunTiming() { runTiming.leads = 0; runTiming.findMs = 0; runTiming.readMs = 0; runTiming.startedAt = Date.now(); }
// Pure. "1.1 s a lead (finding 0.3, reading 0.6, other 0.2)", or '' with no leads.
function runTimingText(timing, now) {
if (!timing.leads || !timing.startedAt) return '';
const per = (ms) => (ms / timing.leads / 1000).toFixed(1);
const total = Math.max(now - timing.startedAt, timing.findMs + timing.readMs);
return `${per(total)} s a lead (finding ${per(timing.findMs)}, reading ${per(timing.readMs)}, other ${per(total - timing.findMs - timing.readMs)})`;
}
window.KonnectLeadChecker.runTimingText = () => runTimingText(runTiming, Date.now());

async function stepOnce(session, uiHandle) {
if (session.done || session.cancelled) return false;
// Re-checked on every call: after retryExceptions rewinds to an earlier
// group, a plain +1 advance would reprocess every good group after it.
session.groupIndex = firstUnresolvedGroupIndex(session.groups, session.results, session.groupIndex);
if (session.groupIndex >= session.groups.length) { session.done = true; return false; }
lastStepGroupIndex = session.groupIndex;

const group = session.groups[session.groupIndex];

// rowInGroupIndex above 0 means this customer's timeline is open. It is
// set back to 0 on load and on resume, when the page may have moved.
if (session.rowInGroupIndex === 0) {
uiHandle.setState(`Searching for ${group.rows[0].name}...`, group.rows[0].name, null);
const findStarted = Date.now();
const openResult = await searchAndOpenCustomer(group, session);
runTiming.findMs += Date.now() - findStarted;
if (openResult.status !== 'OK' || openResult.noEligibleEvents) {
const exception = openResult.status !== 'OK' ? openResult.exception : 'NO_ELIGIBLE_LEAD_EVENTS';
group.rows.forEach((row) => {
if (!session.results[row.inputIndex]) recordResult(session, row.inputIndex, finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception }));
});
advanceToNextGroup(session);
saveSession(session);
return true;
}
group.customerMatchMethod = openResult.matchMethod;
}

// The first row still without a result, so a reopened customer's finished
// rows are not checked again.
const rowIndex = group.rows.findIndex((r) => !session.results[r.inputIndex]);
const row = group.rows[rowIndex];
uiHandle.setState(row.created ? `Reading lead at ${row.created}...` : 'Reading the lead...', group.rows[0].name, row.created || (row.mode === 'postClosureList' ? 'newest Post Closure lead' : ''));
const readStarted = Date.now();
const result = row.mode === 'national' ? await processNationalRow(row, session, group) : await processLeadRow(row, session);
runTiming.readMs += Date.now() - readStarted;
runTiming.leads++;
result.customerMatchMethod = group.customerMatchMethod;
recordResult(session, row.inputIndex, result);

session.rowInGroupIndex = rowIndex + 1;
if (group.rows.every((r) => session.results[r.inputIndex])) advanceToNextGroup(session);
saveSession(session);
return true;
}

let isRunning = false;

// One lead at a time on the page, whoever asks: the run, Check one lead, or
// an earlier copy of this tool still finishing its last lead.
async function runStep(session, uiHandle) {
while (klcShared.stepBusy) await sleep(100);
klcShared.stepBusy = true;
try {
// A customer opened by hand since the last step: its lead window is
// closed and this run's own customer is opened again.
if (pageMovedByHand) {
pageMovedByHand = false;
session.rowInGroupIndex = 0;
await closeLeadModal();
}
return await stepOnce(session, uiHandle);
} finally {
klcShared.stepBusy = false;
}
}

function startTitleFlash(text) {
const title = document.title;
let on = false;
const timer = setInterval(() => { on = !on; document.title = on ? text : title; }, 1000);
return () => { clearInterval(timer); document.title = title; };
}

// A held Web Lock is one of the things that stops the browser freezing a
// hidden tab outright. Returns the function that lets it go.
function holdRunLock() {
let release = null;
let finished = false;
try {
if (navigator.locks && navigator.locks.request) {
Promise.resolve(navigator.locks.request('konnectLeadChecker:run', () => new Promise((resolve) => {
if (finished) resolve(); else release = resolve;
}))).catch(() => {});
}
} catch (error) { /* locks not available */ }
return () => { finished = true; if (release) release(); };
}

// Konnect Live logs out after 15 idle minutes. Browsers hide a saved
// password from page scripts until the agent touches the page, so one
// press of Login is tried (it works where the browser allows it) and the
// boxes are never written to. Otherwise the tab is flagged and the run
// waits for the agent's own Login press, then carries on by itself.
// Presses Login once the browser has put the saved password in the box.
// The boxes are announced to the page first: a browser fills them without
// telling Konnect, which then sends an empty form. Never pressed with the
// password box empty, and not more than once every few seconds.
let loginPressedAt = 0;
function pressLoginWhenFilled() {
if (!onLoginPage() || Date.now() - loginPressedAt < 4000) return false;
const password = document.querySelector('input[type="password"]');
if (!password || !password.value) return false;
const login = Array.from(document.querySelectorAll('button[ng-click="login()"], button.btn-login')).find((b) => b.offsetWidth || b.offsetHeight);
if (!login) return false;
const form = password.closest('form') || document;
Array.from(form.querySelectorAll('input')).filter((input) => input.value && /^(text|email|password|)$/i.test(input.getAttribute('type') || '')).forEach((input) => {
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
});
loginPressedAt = Date.now();
login.click();
return true;
}

// Konnect logs out after a spell of no use but leaves the old page showing:
// the login screen only appears when something next touches the page. So
// nothing is polled. Login is pressed at the two moments that matter: when
// the page jumps to the login screen, and when the owner touches that
// screen (which is when the browser releases the saved password).
const loginWatch = (window.__klcLoginWatch = {});
function tryLoginSoon() {
if (window.__klcLoginWatch !== loginWatch) return;
[300, 1200, 3000].forEach((ms) => setTimeout(() => { try { pressLoginWhenFilled(); } catch (error) { /* the next moment tries again */ } }, ms));
}
if (typeof window.addEventListener === 'function') {
window.addEventListener('hashchange', () => { if (/^#\/login/i.test(location.hash)) tryLoginSoon(); });
['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, () => { if (window.__klcLoginWatch === loginWatch && onLoginPage()) tryLoginSoon(); }, true));
}

async function reLogin(uiHandle, waitMs) {
lcNotices.loggedOut = true;
notifyNoticesChanged();
let stopFlash = null;
try {
await sleep(150);
const button = Array.from(document.querySelectorAll('button[ng-click="login()"], button.btn-login')).find((b) => b.offsetWidth || b.offsetHeight);
// Says what the page can see, so a failed press has a clear cause.
const password = document.querySelector('input[type="password"]');
let passwordSeen = !!(password && password.value);
// Clicking the bookmark lets the browser release the saved password, but a
// moment later, so Login is pressed again over a few seconds.
for (let attempt = 0; attempt < 6 && button; attempt++) {
passwordSeen = passwordSeen || !!(password && password.value);
button.click();
for (let waited = 0; waited < 800; waited += 200) {
await sleep(200);
if (!onLoginPage()) { await sleep(1500); return true; }
}
}
const why = !button ? 'the Login button was not found'
: passwordSeen ? 'Login was pressed with the password, but Konnect did not log in'
: 'Login was pressed, but the browser has not shown the saved password to the page yet';
const message = `Konnect Live logged out: ${why}. Press Login and the check carries on.`;
// The dark overlay would cover the Login button the agent has to press.
hidePageFlashOverlay();
if (typeof uiHandle.loggedOut === 'function') {
lcNotices.stopped = message;
notifyNoticesChanged();
uiHandle.loggedOut();
} else {
uiHandle.setState(message);
}
stopFlash = startTitleFlash('Press Login to carry on');
// The browser only hands the saved password to the page once the agent
// touches this window. So the wait keeps watching: as soon as the password
// is there (any click or key press on the page is enough), Login is pressed
// for them. It is never pressed again with the box still empty.
const startedAt = Date.now();
while (Date.now() - startedAt < (waitMs || 30 * 60 * 1000)) {
await sleep(500);
if (!onLoginPage()) { lcNotices.stopped = null; notifyNoticesChanged(); await sleep(1500); return true; }
pressLoginWhenFilled();
}
return false;
} finally {
if (stopFlash) stopFlash();
lcNotices.loggedOut = false;
notifyNoticesChanged();
}
}

// A lead that failed because the page logged out mid-check is checked
// again: its group's failures are cleared and the run steps back to it.
function redoGroupAfterLogout(session, groupIndex) {
const group = session.groups[groupIndex];
if (!group) return;
group.rows.forEach((row) => {
const result = session.results[row.inputIndex];
if (result && result.status === 'EXCEPTION' && result.exception !== 'CLASSIFICATION_REVIEW_REQUIRED') delete session.results[row.inputIndex];
});
session.groupIndex = Math.min(session.groupIndex, groupIndex);
session.rowInGroupIndex = 0;
session.done = false;
}

// A step that threw: its leads are marked as not checked and the run moves
// past them, so one bad lead cannot stop the same way on every retry.
function failGroupAfterError(session, groupIndex) {
const group = session.groups[groupIndex];
if (!group) return;
group.rows.forEach((row) => {
if (!session.results[row.inputIndex]) recordResult(session, row.inputIndex, finalizeResult(makeResultBase(row), { status: 'EXCEPTION', exception: 'TOOL_ERROR' }));
});
if (session.groupIndex === groupIndex) advanceToNextGroup(session);
else session.rowInGroupIndex = 0;
}

function errorText(error) {
return String((error && error.message) || error || 'unknown error').slice(0, 160);
}

async function runLoop(session, uiHandle) {
if (isRunning) return;
isRunning = true;
session.cancelled = false;
session.stoppedOnError = false;
const releaseLock = holdRunLock();
resetRunTiming();
let stopHiddenFlash = null;
let failure = null;
const endHiddenWait = () => {
if (!stopHiddenFlash) return;
stopHiddenFlash();
stopHiddenFlash = null;
lcNotices.hiddenWait = false;
notifyNoticesChanged();
};
try {
while (!session.done && !session.cancelled) {
if (session.paused) { endHiddenWait(); await sleep(200); continue; }
// Only where the timer worker could not start: a hidden tab's timers are
// then too slow to trust, and a wait could time out and misread a lead as
// failed. With the worker the run carries on hidden.
if (hiddenAndSlowed()) {
if (!stopHiddenFlash) {
stopHiddenFlash = startTitleFlash('Lead Checker is waiting');
lcNotices.hiddenWait = true;
hidePageFlashOverlay();
uiHandle.setState('Waiting: this tab is in the background and the browser is slowing it. Bring Konnect Live to the front to carry on.');
}
await sleep(500);
continue;
}
endHiddenWait();
if (lcNotices.stopped) { lcNotices.stopped = null; notifyNoticesChanged(); }
if (onLoginPage()) {
if (!await reLogin(uiHandle)) {
session.paused = true;
lcNotices.stopped = 'Konnect Live stayed logged out for 30 minutes, so the check paused. Log in, then press Resume to carry on.';
notifyNoticesChanged();
}
continue;
}
if (klcShared.stepBusy) { await sleep(100); continue; }
const remaining = session.rows.length - Object.keys(session.results).length;
showPageFlashOverlay(`Checking leads… (${remaining} left)`);
let advanced = false;
try {
advanced = await runStep(session, uiHandle);
} catch (error) {
if (!onLoginPage()) {
console.error('KonnectLeadChecker: a lead could not be checked:', error);
failGroupAfterError(session, lastStepGroupIndex);
session.paused = true;
saveSession(session);
lcNotices.stopped = `Stopped: the tool hit an error on the last lead (${errorText(error)}). It is marked as not checked. Press Resume to carry on with the next lead, or Report a problem.`;
notifyNoticesChanged();
continue;
}
advanced = true;
}
if (onLoginPage()) {
redoGroupAfterLogout(session, lastStepGroupIndex);
saveSession(session);
continue;
}
uiHandle.render();
if (typeof uiHandle.onProgress === 'function') uiHandle.onProgress(session);
if (!advanced) break;
}
} catch (error) {
failure = error;
console.error('KonnectLeadChecker: the check stopped on an error:', error);
session.stoppedOnError = true;
lcNotices.stopped = `Stopped: the tool hit an error (${errorText(error)}). Press Start to carry on, or Report a problem.`;
notifyNoticesChanged();
} finally {
isRunning = false;
releaseLock();
endHiddenWait();
hidePageFlashOverlay();
// Results and the ending go to SLA Manager before the state changes on
// screen, so it never hears "idle" about a batch it has not seen end.
const said = typeof uiHandle.onLoopExit === 'function' ? uiHandle.onLoopExit(session) : '';
const speed = runTimingText(runTiming, Date.now());
uiHandle.setState((said || (failure ? 'Stopped on an error' : (session.cancelled ? 'Cancelled' : (session.done ? 'Done' : 'Paused')))) + (speed && session.done ? ` · ${speed}` : ''));
}
}

runSelfTest('orchestrationSelfTest', function orchestrationSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

check('run timing reads per lead, and is blank with no leads', [runTimingText({ leads: 10, findMs: 3000, readMs: 6000, startedAt: 1000 }, 12000), runTimingText({ leads: 0, findMs: 0, readMs: 0, startedAt: 1 }, 5)], ['1.1 s a lead (finding 0.3, reading 0.6, other 0.2)', '']);

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

// The contract SLA-Manager.js's import parses (LEAD_CHECKER_IMPORT_HEADER).
// The two files cannot share a module, so this pins the header and that
// tier/subCategory/rank land in the right columns.
const rawExtractTsv = buildRawNotesTsvForExtract(fakeSession);
const rawExtractLines = rawExtractTsv.split('\n');
check('raw Extract export header shape', rawExtractLines[0], 'Name\tPhone\tEmail\tSource\tCampaign\tCreated\tInitialNotes\tTier\tTierName\tSubCategory\tSubRank\tFlags\tConfidence\tReason\tDedupeKey\tPostClosureAction\tPriorityRank\tPostClosureReason\tPostClosureEvidence');
const aliceAgainCells = rawExtractLines[2].split('\t');
check('raw Extract export: TierName column carries the computed tier name', aliceAgainCells[8], 'CONFIRMED DATE & TIME');
check('raw Extract export: Flags column carries the computed flags', aliceAgainCells[11], 'PX');
check('raw Extract export: PriorityRank column carries a real numeric rank', aliceAgainCells[16], String(bookingPriorityRankValue(fakeSession.results[1])));
const reviewTsv = buildRawNotesTsvForExtract({ rows: [{ inputIndex: 0 }], results: { 0: { name: 'Carol', status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', tier: 2, tierName: 'DATE ONLY', subCategory: 'Customer-Stated Day', flags: [], reason: 'guess' } } }).split('\n')[1].split('\t');
check('raw Extract export: a Needs review row carries no tier until reviewed', [reviewTsv[7], reviewTsv[8], reviewTsv[13]], ['', '', 'guess']);

if (failures.length > 0) {
console.error('KonnectLeadChecker orchestration self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker orchestration self-test passed (11/11)');
}
});

runSelfTest('retryExceptionsSelfTest', function retryExceptionsSelfTest() {
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
// Paused with a live runLoop holding this object, so mutation in place is
// what gets tested.
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

// After rewinding to Bob's group, Carol's still-valid result must not be
// reprocessed.
fakeSession.results[1] = { name: 'Bob', status: 'CLASSIFIED', tier: 4, tierName: 'WARM ENQUIRY' };
const nextIndex = firstUnresolvedGroupIndex(fakeSession.groups, fakeSession.results, 2);
check('Already-resolved Carol\'s group (index 2) is skipped, not reprocessed, once Bob\'s retry is done', nextIndex, 3);

if (failures.length > 0) {
console.error('KonnectLeadChecker retryExceptions self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker retryExceptions self-test passed (10/10)');
}
});

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

// Each button shows only when it would do something.
function computeButtonVisibility(s, loopAlive) {
const hasSession = !!s;
// isRunning stays true while paused; "running" means mid-step and unpaused.
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
retryExceptions: retryable,
copyRawForExtract: hasResults,
// Derived from its buttons so Start stays visible on a fresh page load.
runControls: start || pauseResume || processNext || cancel || retryable || hasResults
};
}

// One colour per tier, kept in lockstep with SLA-Manager.js
// LEAD_CHECKER_TIER_COLORS. Tier 2 avoids '#d97706', the Post Closure
// "check" and SLA urgency amber.
const TIER_COLORS = { 1: '#059669', 2: '#2563eb', 3: '#7c3aed', 4: '#9333ea', 5: '#64748b', 6: '#94a3b8' };

// Kept in lockstep with SLA-Manager.js's postClosureActionColor.
function postClosureColor(action) {
return action === 'send back through' ? '#0891b2' : '#d97706';
}

function hexToRgb(hex) {
const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
if (!m) return null;
const n = parseInt(m[1], 16);
return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relativeLuminance(rgb) {
const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a, b) {
const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
return (hi + 0.05) / (lo + 0.05);
}

// Category colours double as text on a light tint of themselves. This
// darkens a colour just enough to reach 4.5:1 against that tint on the
// panel's grey (the darkest place a pill sits), without changing the
// shared colour values. The panels always use the light palette.
function readableTextColor(hex) {
const rgb = hexToRgb(hex);
if (!rgb) return hex;
const panel = [242, 242, 247];
const background = rgb.map((v, i) => Math.round(panel[i] + (v - panel[i]) * (0x1a / 255)));
let current = rgb;
for (let step = 0; step <= 20 && contrastRatio(current, background) < 4.6; step++) {
current = rgb.map((v) => Math.round(v * (1 - step / 20)));
}
return '#' + current.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function categoryColor(r) {
if (!r) return '#1e293b';
if (r.exception) return '#dc2626';
if (r.postClosureAction) return postClosureColor(r.postClosureAction);
return TIER_COLORS[r.tier] || '#1e293b';
}

// Stable key for the stats bar and filter. Exceptions share one key; Post
// Closure leads get their own two, ahead of tier.
function categoryKey(r) {
if (!r) return 'PENDING';
if (r.exception) return 'EXCEPTION';
if (r.postClosureAction) return r.postClosureAction === 'send back through' ? 'POST CLOSURE: SEND BACK' : 'POST CLOSURE: CHECK';
return r.tierName || 'PENDING';
}

// Short primary pill plus a muted secondary label, which scans better than
// one long string.
const EXCEPTION_LABELS = {
POST_CLOSURE_LEAD_NOT_FOUND: 'No Post Closure lead on this customer',
CLASSIFICATION_REVIEW_REQUIRED: 'Needs review',
CANCELLED: 'Cancelled',
INVALID_INPUT: 'Row could not be read',
INVALID_CREATED_DATETIME: 'Created time could not be read',
NO_SEARCH_IDENTIFIER: 'No email or phone to search',
SEARCH_TIMEOUT: 'Search timed out',
SEARCH_NO_RESULTS: 'Customer not found',
CUSTOMER_NOT_LINKED: 'Customer result not linked',
CUSTOMER_AMBIGUOUS: 'More than one matching customer',
LEAD_NOT_ON_MATCHING_CUSTOMERS: 'Lead not on any customer with this name',
TIMELINE_TIMEOUT: 'Timeline did not load',
TIMELINE_SCROLL_CONTAINER_UNKNOWN: 'Could not scroll the timeline',
NO_ELIGIBLE_LEAD_EVENTS: 'No sales leads on the timeline',
TARGET_CREATED_DATETIME_NOT_FOUND: "Couldn't find a lead at that time",
AMBIGUOUS_LEAD: 'More than one lead at that time',
AMBIGUOUS_CALL_MATCH: 'More than one call at that time',
NO_CALL_MATCH: 'No call at that time',
LEAD_ENTRY_NOT_FOUND_FOR_CALL: 'No lead found for that call',
LEAD_ID_UNREADABLE: 'Lead ID could not be read',
LEAD_CLICK_TARGET_NOT_FOUND: 'Lead could not be opened',
LEAD_MODAL_TIMEOUT: 'Lead window did not open',
LEAD_VALIDATION_FAILED: 'Opened lead did not match',
INITIAL_NOTES_FIELD_NOT_FOUND: 'Initial Notes not found',
INITIAL_NOTES_EMPTY: 'Initial Notes are empty',
NO_TARGET: 'No lead time given',
TOOL_ERROR: 'The tool hit an error on this lead'
};

// Plain-English label for an exception code. The code itself stays in
// results, exports and title attributes.
function exceptionLabel(code) {
if (!code) return '';
if (EXCEPTION_LABELS[code]) return EXCEPTION_LABELS[code];
const callFallback = /^CALL_FALLBACK_(.+)$/.exec(code);
if (callFallback) return `Call match failed: ${exceptionLabel(callFallback[1]).toLowerCase()}`;
const words = code.toLowerCase().split('_').join(' ');
return words.charAt(0).toUpperCase() + words.slice(1);
}

function categoryBadge(r) {
const color = categoryColor(r);
if (r.exception) {
const icon = svgIcon('warning', 10, ' margin-right: 3px;');
return `<span class="category-badge" title="${escapeHtmlForUi(r.exception)}" style="background: ${color}1a; color: ${readableTextColor(color)};">${icon}${escapeHtmlForUi(exceptionLabel(r.exception))}</span>`;
}
if (r.postClosureAction) {
return `<span class="category-badge" title="${escapeHtmlForUi(postClosureLabel(r))}" style="background: ${color}1a; color: ${readableTextColor(color)};">${escapeHtmlForUi(postClosureLabel(r))}</span>`;
}
const tierPill = `<span class="category-badge" style="background: ${color}1a; color: ${readableTextColor(color)};">${escapeHtmlForUi(r.tierName || 'Pending')}</span>`;
const subcat = r.subCategory ? `<span class="subcat-label" title="${escapeHtmlForUi(r.subCategory)}">${escapeHtmlForUi(r.subCategory)}</span>` : '';
return tierPill + subcat;
}

// Short tier names for the panel only. What is exported, sent over the link
// and stored keeps TIER_NAMES.
const TIER_SHORT = { 1: 'Date and time', 2: 'Date only', 3: 'Likely booking', 4: 'Warm enquiry', 5: 'Nurture', 6: 'No call' };
function tierHeading(tier) {
return `Tier ${tier} · ${TIER_SHORT[tier] || ''}`;
}
// Keyed by categoryKey(r).
const CATEGORY_SHORT = { 'POST CLOSURE: SEND BACK': 'Send back', 'POST CLOSURE: CHECK': 'Check', EXCEPTION: 'Could not check' };
[1, 2, 3, 4, 5, 6].forEach((tier) => { CATEGORY_SHORT[TIER_NAMES[tier]] = TIER_SHORT[tier]; });

function tagHtml(text, color, title) {
return `<span class="tag" style="background: ${color}1a; color: ${readableTextColor(color)};"${title ? ` title="${escapeHtmlForUi(title)}"` : ''}>${escapeHtmlForUi(text)}</span>`;
}

// Two columns of label and value. Values are already HTML.
function kvHtml(pairs) {
return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${escapeHtmlForUi(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

// One result: the initials, the name with an optional tag, and one grey
// line. The two lines are the button that opens the details under them.
function resultRowHtml(o) {
return `
<div class="customer${o.open ? ' open' : ''}" data-key="${o.key}">
${o.avatar || ''}
<div class="customer-summary" role="button" tabindex="0" aria-expanded="${!!o.open}">
<span class="customer-line"><span class="customer-name" title="${escapeHtmlForUi(o.title || '')}">${escapeHtmlForUi(o.name)}</span>${o.tag || ''}${o.openTag || ''}</span>
${o.meta ? `<span class="customer-meta">${escapeHtmlForUi(o.meta)}</span>` : ''}${o.note || ''}
</div>
<div class="customer-body" style="display: ${o.open ? 'block' : 'none'};">${o.body}</div>
</div>`;
}

// A group of results under a heading tinted in the group's own colour.
function resultGroupHtml(key, label, color, count, open, rowsHtml) {
return `
<details class="tier" data-key="${key}" ${open ? 'open' : ''}>
<summary style="background: ${color}24; border-left-color: ${color}; color: ${readableTextColor(color)};"><span>${escapeHtmlForUi(label)}</span><span class="tier-count">${count}</span></summary>
<div class="tier-rows">${rowsHtml}</div>
</details>`;
}

// null while actively stepping, since setState owns the label then.
function deriveRestStateLabel(s, loopAlive, stepBusy) {
if (!s) return 'Idle';
if (s.headerOk === false && s.rawInput) return `This batch could not be read: ${s.headerError}`;
if (loopAlive && !s.paused) return null;
// Pause was pressed mid-lead: the label set then stays until it finishes.
if (stepBusy) return null;
if (s.paused) return 'Paused';
if (s.cancelled) return 'Cancelled';
if (s.done) return 'Done';
return 'Idle';
}

// Section 2 order: tier, subRank, (Tier 1-2) appointment date, received
// time. PriorityRank = tier*100 + subRank is what SLA-Manager.js sorts on.
// The appointment-date tie-break is not implemented (no parsed date value),
// so ties fall to received time.
function bookingPriorityRankValue(result) {
if (!result || result.status !== 'CLASSIFIED') return 700;
const tier = result.tier || 6;
const subRank = result.subRank != null ? result.subRank : 99;
return tier * 100 + subRank;
}

// Full comparator, tie-breaking on `created`.
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
// NEEDS REVIEW
//
// Manual triage for low-confidence results (notes read, but no confident
// rule). Decisions are exported as examples for new classifier rules.
// ===================================================================

const REVIEW_TIER_OPTIONS = [1, 2, 3, 4, 5, 6];

// These go to their own Post Closure section instead.
function isNeedsReview(r) {
return !!(r && r.status === 'EXCEPTION' && r.exception === 'CLASSIFICATION_REVIEW_REQUIRED' && !r.postClosureAction);
}

function applyManualReviewDecision(result, tier, subCategoryText, note) {
const { preDecision: _ignored, ...beforeDecision } = result;
return finalizeResult(result, {
tentative: { tier: result.tier, subCategory: result.subCategory, reason: result.reason, confidence: result.confidence },
preDecision: beforeDecision,
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

// Pure. A hand decision on a Post Closure lead: send back through with a
// reason, or a call is needed. Undo restores the checker's own decision.
function applyPostClosureDecision(result, action, reason, note) {
const { preDecision: _ignored, ...beforeDecision } = result;
return finalizeResult(result, {
tentative: { postClosureAction: result.postClosureAction, postClosureReason: result.postClosureReason, postClosureEvidence: result.postClosureEvidence, tier: result.tier, subCategory: result.subCategory, reason: result.reason, confidence: result.confidence },
preDecision: beforeDecision,
postClosureAction: action,
postClosureReason: action === 'send back through' ? reason : '',
postClosureEvidence: note ? `Decided by hand: ${note}` : 'Decided by hand',
manualOverride: true,
manualNote: note || ''
});
}

// Restores the row exactly as it was before the manual decision.
function undoManualReviewDecision(result) {
return result && result.manualOverride && result.preDecision ? result.preDecision : result;
}

// Two reviewed rows with the same fingerprint describe the same kind of
// lead, so different tiers on them are a conflict to resolve before
// writing a rule. MB Mail form leads compare their ticked fields;
// everything else compares notes with numbers, emails and regs removed.
function reviewFingerprint(r) {
const notes = String(r.initialNotes || '');
const enquiry = field(notes, 'Enquiry');
const purchase = field(notes, 'Purchase');
if (enquiry !== null && purchase !== null) {
return ['mb', enquiry, purchase, field(notes, 'Part') || ''].join('|').toLowerCase().replace(/\s+/g, '');
}
const cleaned = notes.toLowerCase()
.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, '')
.replace(/\b[a-z]{2}\d{2}\s?[a-z]{3}\b/g, '')
.replace(/[\d\s]+/g, '');
return [String(r.source || '').toLowerCase(), String(r.campaign || '').toLowerCase(), cleaned].join('|');
}

function tsvCell(value) {
return String(value == null ? '' : value).replace(/\t/g, ' ').replace(/\r?\n/g, ' | ');
}

// No personal details: only what a future rule would match on.
function buildManualReviewDecisionsExport(session) {
const rows = orderedResults(session).filter((r) => r.manualOverride);
const header = ['InitialNotes', 'Tier', 'TierName', 'SubCategory', 'Reason', 'Campaign', 'Source', 'Created', 'Flags', 'ClassifierTier', 'ClassifierSubCategory', 'ClassifierConfidence', 'ClassifierReason', 'Conflict', 'PostClosureDecision', 'ClassifierPostClosure', 'ClassifierPostClosureWhy'].join('\t');
const fingerprints = rows.map(reviewFingerprint);
const lines = rows.map((r, i) => {
const t = r.tentative || {};
const conflicts = rows
.map((other, j) => (j !== i && fingerprints[j] === fingerprints[i] && other.tier !== r.tier ? `row ${j + 1} (Tier ${other.tier})` : null))
.filter(Boolean);
return [
tsvCell(r.initialNotes),
String(r.tier || ''), r.tierName || '', tsvCell(r.subCategory),
tsvCell(r.manualNote),
r.campaign || '', r.source || '', r.created || '',
(r.flags || []).join(', '),
t.tier != null ? String(t.tier) : '', tsvCell(t.subCategory), t.confidence || '', tsvCell(t.reason),
conflicts.join('; '),
r.postClosureAction ? postClosureLabel(r) : '',
t.postClosureAction ? (t.postClosureReason ? `${t.postClosureAction}: ${t.postClosureReason}` : t.postClosureAction) : '',
tsvCell(t.postClosureEvidence)
].join('\t');
});
return [header, ...lines].join('\n');
}

// For the handoff back into SLA-Manager.js, e.g. "send back through: Email only".
function postClosureLabel(r) {
if (!r.postClosureReason) return r.postClosureAction;
const shorthand = SEND_BACK_SHORTHAND[r.postClosureReason];
return `${r.postClosureAction}: ${r.postClosureReason}${shorthand ? ` (${shorthand})` : ''}`;
}

function buildRawNotesTsvForExtract(session) {
const header = ['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created', 'InitialNotes', 'Tier', 'TierName', 'SubCategory', 'SubRank', 'Flags', 'Confidence', 'Reason', 'DedupeKey', 'PostClosureAction', 'PriorityRank', 'PostClosureReason', 'PostClosureEvidence'];
const lines = orderedResults(session).map((r) => [
r.name, r.phone, r.email, r.source, r.campaign, r.created,
(r.initialNotes || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
// A Needs review row's tier is only a suggestion until someone accepts it.
isNeedsReview(r) ? '' : String(r.tier || ''), isNeedsReview(r) ? '' : (r.tierName || ''), r.subCategory || '', String(r.subRank != null ? r.subRank : ''),
(r.flags || []).join(', '),
r.confidence || '',
(r.reason || r.exception || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' | '),
r.dedupeKey || '', r.postClosureAction || '',
String(bookingPriorityRankValue(r)),
r.postClosureReason || '',
String(r.postClosureEvidence || '').replace(/[\t\r\n]+/g, ' ')
].join('\t'));
return [header.join('\t'), ...lines].join('\n');
}

window.KonnectLeadChecker.buildProcessingGroups = buildProcessingGroups;
window.KonnectLeadChecker.firstUnresolvedGroupIndex = firstUnresolvedGroupIndex;
window.KonnectLeadChecker.newSession = newSession;
window.KonnectLeadChecker.retryExceptions = retryExceptions;
window.KonnectLeadChecker.rowIdentityKey = rowIdentityKey;
window.KonnectLeadChecker.isNeedsReview = isNeedsReview;
window.KonnectLeadChecker.applyManualReviewDecision = applyManualReviewDecision;
window.KonnectLeadChecker.undoManualReviewDecision = undoManualReviewDecision;
window.KonnectLeadChecker.exceptionLabel = exceptionLabel;
window.KonnectLeadChecker.buildManualReviewDecisionsExport = buildManualReviewDecisionsExport;
window.KonnectLeadChecker.stepOnce = stepOnce;
window.KonnectLeadChecker.runLoop = runLoop;
window.KonnectLeadChecker.orderedResults = orderedResults;
window.KonnectLeadChecker.bookingPriorityRankValue = bookingPriorityRankValue;
window.KonnectLeadChecker.compareByBookingPriority = compareByBookingPriority;
window.KonnectLeadChecker.buildRawNotesTsvForExtract = buildRawNotesTsvForExtract;

// ===================================================================
// Self-test for computeButtonVisibility in each session state.
// ===================================================================
runSelfTest('buttonVisibilitySelfTest', function buttonVisibilitySelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

const noSessionResult = computeButtonVisibility(null, false);
check('No session: only Start is visible', noSessionResult, {
start: true, pauseResume: false, processNext: false, cancel: false,
retryExceptions: false, copyRawForExtract: false, runControls: true
});

const freshSession = { rows: [{ inputIndex: 0, status: 'OK' }], results: {}, done: false, paused: false };
check('Fresh unstarted session: Start + Process next (single-stepping without ever clicking Start is a real, already-supported action) ', computeButtonVisibility(freshSession, false), {
start: true, pauseResume: false, processNext: true, cancel: false,
retryExceptions: false, copyRawForExtract: false, runControls: true
});

const runningSession = { rows: [{ inputIndex: 0, status: 'OK' }], results: {}, done: false, paused: false };
check('Actively running: Pause + Cancel only (no Start, no Process next)', computeButtonVisibility(runningSession, true), {
start: false, pauseResume: true, processNext: false, cancel: true,
retryExceptions: false, copyRawForExtract: false, runControls: true
});

const pausedWithException = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'EXCEPTION', exception: 'SEARCH_NO_RESULTS' } },
done: false, paused: true
};
check('Paused with a retryable exception: Resume + Process next + Cancel + Retry exceptions - Copy raw for Extract also shows since an exception is still a processed result (exported with its exception as the reason)', computeButtonVisibility(pausedWithException, true), {
start: false, pauseResume: true, processNext: true, cancel: true,
retryExceptions: true, copyRawForExtract: true, runControls: true
});

const pausedNoException = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'CLASSIFIED', tier: 4 } },
done: false, paused: true
};
check('Paused with no retryable exceptions: no Retry exceptions button, but Copy raw for Extract appears (has a real result)', computeButtonVisibility(pausedNoException, true), {
start: false, pauseResume: true, processNext: true, cancel: true,
retryExceptions: false, copyRawForExtract: true, runControls: true
});

const doneSession = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'CLASSIFIED', tier: 4 } },
done: true, paused: false
};
check('Done: only Copy results remains', computeButtonVisibility(doneSession, false), {
start: false, pauseResume: false, processNext: false, cancel: false,
retryExceptions: false, copyRawForExtract: true, runControls: true
});

const reviewOnlyException = {
rows: [{ inputIndex: 0, status: 'OK' }],
results: { 0: { status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED' } },
done: false, paused: true
};
check('CLASSIFICATION_REVIEW_REQUIRED is not retryable (own resolution flow, not a processing failure)', retryableExceptionCount(reviewOnlyException), 0);

if (failures.length > 0) {
console.error('KonnectLeadChecker button-visibility self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker button-visibility self-test passed (7/7)');
}
});

// ===================================================================
// Self-test for Post Closure display: postClosureAction, not tier, drives
// colour, key and badge.
// ===================================================================
runSelfTest('postClosureDisplaySelfTest', function postClosureDisplaySelfTest() {
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
check('categoryColor falls back to the real tier colour when there is no postClosureAction', categoryColor(normalLead), '#9333ea');

check('categoryKey groups a confident send-back separately from its underlying tier', categoryKey(sendBackLead), 'POST CLOSURE: SEND BACK');
check('categoryKey groups the uncertain check bucket separately too', categoryKey(checkLead), 'POST CLOSURE: CHECK');
check('categoryKey falls back to tierName when there is no postClosureAction', categoryKey(normalLead), 'WARM ENQUIRY');

check('categoryBadge shows only the Post Closure decision', categoryBadge(sendBackLead).includes('send back through') && !categoryBadge(sendBackLead).includes('WARM ENQUIRY'), true);
const pcLow = postClosureOnly({ status: 'EXCEPTION', exception: 'CLASSIFICATION_REVIEW_REQUIRED', source: 'Post Closure Processing', tier: 5, tierName: 'NURTURE', subCategory: 'Enquiry: Blank', confidence: 'low', postClosureAction: 'check: needs contact?' });
check('a low confidence Post Closure lead is not sent for review', [pcLow.status, pcLow.exception === null].join('|'), 'CLASSIFIED|true');
check('a Post Closure lead carries no tier', [pcLow.tier, pcLow.tierName, pcLow.subCategory].join('|'), '||');
const pcNoAction = postClosureOnly({ status: 'CLASSIFIED', source: 'Post Closure Processing', tier: 5, tierName: 'NURTURE' });
check('a Post Closure lead with no action is a check', pcNoAction.postClosureAction, 'check: needs contact?');
const pcSendBack = postClosureOnly({ status: 'CLASSIFIED', source: 'Post Closure Processing', tier: 5, tierName: 'NURTURE', postClosureAction: 'send back through', postClosureReason: 'Email only' });
check('the send back reason is kept', [pcSendBack.postClosureAction, pcSendBack.postClosureReason, pcSendBack.tierName].join('|'), 'send back through|Email only|');
check('a lead not found stays an exception', postClosureOnly({ status: 'EXCEPTION', exception: 'POST_CLOSURE_LEAD_NOT_FOUND', source: 'Post Closure Processing' }).status, 'EXCEPTION');
check('other leads keep their tier', postClosureOnly(normalLead).tierName, 'WARM ENQUIRY');
const pcHeading = { querySelector: (sel) => (sel === '.connected-customer-title-pink' ? { textContent: 'Manually Created Sales Lead from Post Closure Processing' } : null) };
const otherHeading = { querySelector: () => ({ textContent: 'Manually Created Sales Lead from AA Cars' }) };
check('a Pending row with no source is Post Closure by its heading', isPostClosureEntry({ source: '' }, { source: '' }, pcHeading), true);
check('or by the lead\'s own Source', isPostClosureEntry({ source: '' }, { source: 'Post Closure Processing' }, otherHeading), true);
check('another lead is not Post Closure', isPostClosureEntry({ source: '' }, { source: 'AA Cars' }, otherHeading), false);
check('categoryBadge for a normal lead still leads with the tier pill as before', categoryBadge(normalLead).indexOf('WARM ENQUIRY') < categoryBadge(normalLead).indexOf('Quote'), true);

if (failures.length > 0) {
console.error('KonnectLeadChecker postClosureDisplay self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker postClosureDisplay self-test passed');
}
});

// ===================================================================
// Self-test for deriveRestStateLabel: a reopened panel must not stay on
// its "Idle" placeholder.
// ===================================================================
runSelfTest('deriveRestStateLabelSelfTest', function deriveRestStateLabelSelfTest() {
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
console.error('KonnectLeadChecker deriveRestStateLabel self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker deriveRestStateLabel self-test passed (7/7)');
}
});

// ===================================================================
// Self-test for newSession merging a grown batch over one in progress.
// ===================================================================
runSelfTest('sessionMergeSelfTest', function sessionMergeSelfTest() {
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
// Both rows finished, in the shape stepOnce produces.
session1.results[0] = finalizeResult(makeResultBase(session1.rows[0]), { status: 'CLASSIFIED', tier: 2, tierName: 'DATE ONLY', initialNotes: 'Customer Comments: -' });
session1.results[1] = finalizeResult(makeResultBase(session1.rows[1]), { status: 'CLASSIFIED', tier: 1, tierName: 'CONFIRMED DATE & TIME', initialNotes: 'Customer Comments: 3pm works' });

// The same two rows (a re-export) plus one new one.
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

// An unrelated paste carries nothing over.
const unrelatedBatch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Dee\t\tdee@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 22:05'
].join('\n');
const session3 = newSession(unrelatedBatch, session1);
check('Unrelated batch: no carried-over results', session3.results[0], undefined);
check('Unrelated batch: cursor starts at the beginning as normal', session3.groupIndex, 0);

// Re-pasting a completed batch is done immediately.
const session4 = newSession(batch1, session1);
check('Re-pasting a fully-completed batch is immediately done', session4.done, true);

if (failures.length > 0) {
console.error('KonnectLeadChecker session-merge self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker session-merge self-test passed (8/8)');
}
});

runSelfTest('sessionVersioningSelfTest', function sessionVersioningSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}
const batch = [
'Name\tPhone\tEmail\tSource\tCampaign\tCreated',
'Alice\t\talice@example.com\tCustomer First\tCitroen - Enquiry - New\tSat, 26 Sep 2026 18:05'
].join('\n');
const first = newSession(batch);
first.results[0] = finalizeResult(makeResultBase(first.rows[0]), { status: 'CLASSIFIED', tier: 2, tierName: 'DATE ONLY' });
check('Classified results are stamped with the classifier version', first.results[0].classifierVersion, CLASSIFIER_VERSION);
check('Same-version results carry into a new paste', !!newSession(batch, first).results[0], true);
const nationalBatch = [NATIONAL_BATCH_HEADER.join('\t'), ['national', 'Alex Sample', 'AB12CDE', '70000001', '07/11/2026 09:00', 'Enquiry - Used', 'National', '07/11/2026 10:00', 'Completed', 'Email Only Lead', '2', '0', '0', 'closed'].join('\t')].join('\n');
const nationalFirst = newSession(nationalBatch);
nationalFirst.results[0] = finalizeResult(makeResultBase(nationalFirst.rows[0]), { status: 'CLASSIFIED', verdict: RE_SETUP });
check('National verdicts are never carried into a new paste', !!newSession(nationalBatch, nationalFirst).results[0], false);
// Skipped where the browser blocks storage; saving is then impossible anyway.
let storedBefore;
let storageReadable = true;
try { storedBefore = localStorage.getItem(SESSION_STORAGE_KEY); } catch (error) { storageReadable = false; }
if (storageReadable) {
saveSession({ ...nationalFirst, discarded: true });
check('A cleared session is never saved again', localStorage.getItem(SESSION_STORAGE_KEY), storedBefore);
}
first.results[0] = Object.assign({}, first.results[0], { classifierVersion: 'older' });
check('Results from an older classifier are re-checked, not carried', newSession(batch, first).results[0], undefined);
const now = Date.now();
const stored = Object.assign({}, newSession(batch), { schema: SESSION_SCHEMA, savedAt: now });
check('A fresh stored session is valid', isValidStoredSession(stored, now), true);
check('A session older than 12 hours is discarded', isValidStoredSession(stored, now + SESSION_MAX_AGE_MS + 1), false);
check('A session from an older schema is discarded', isValidStoredSession(Object.assign({}, stored, { schema: 1 }), now), false);
check('A malformed session is discarded', isValidStoredSession({ schema: SESSION_SCHEMA, savedAt: now, rawInput: 'x' }, now), false);
const streakSession = { results: {}, groups: [], failureStreak: null, paused: false };
const failedGroup = (i) => { streakSession.results[i] = { status: 'EXCEPTION', exception: 'SEARCH_TIMEOUT' }; return { rows: [{ inputIndex: i }] }; };
noteGroupOutcome(streakSession, failedGroup(0));
noteGroupOutcome(streakSession, failedGroup(1));
check('Two identical failures do not pause yet', streakSession.paused, false);
noteGroupOutcome(streakSession, failedGroup(2));
check('Three identical failures in a row pause the run', streakSession.paused, true);
check('The stop message names the failure in plain English', /Search timed out/.test(lcNotices.stopped || ''), true);
lcNotices.stopped = null;
const mixed = { results: { 0: { status: 'EXCEPTION', exception: 'SEARCH_TIMEOUT' }, 1: { status: 'CLASSIFIED' } }, failureStreak: { code: 'SEARCH_TIMEOUT', count: 2 }, paused: false };
noteGroupOutcome(mixed, { rows: [{ inputIndex: 1 }] });
check('A success resets the failure streak', mixed.failureStreak, null);
if (failures.length > 0) {
console.error('KonnectLeadChecker session-versioning self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker session-versioning self-test passed (11/11)');
}
});

runSelfTest('needsReviewSelfTest', function needsReviewSelfTest() {
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
check('Review-decisions export header has no name/phone/email columns', exportLines[0], 'InitialNotes\tTier\tTierName\tSubCategory\tReason\tCampaign\tSource\tCreated\tFlags\tClassifierTier\tClassifierSubCategory\tClassifierConfidence\tClassifierReason\tConflict\tPostClosureDecision\tClassifierPostClosure\tClassifierPostClosureWhy');
check('Review-decisions export includes only the manually-overridden row', exportLines.length, 2);
check('Review-decisions export row carries the chosen tier name', exportLines[1].split('\t')[2], 'WARM ENQUIRY');

const guessed = finalizeResult(lowConfidenceResult, { tier: 5, tierName: 'NURTURE', subCategory: 'MB Mail Enquiry Form', reason: 'tentative reason', confidence: 'low' });
const decidedFromGuess = applyManualReviewDecision(guessed, 6, '', 'redirect');
check('Manual decision keeps the classifier guess', decidedFromGuess.tentative, { tier: 5, subCategory: 'MB Mail Enquiry Form', reason: 'tentative reason', confidence: 'low' });
const undone = undoManualReviewDecision(decidedFromGuess);
check('Undo restores the pre-decision row', [undone.status, undone.exception, undone.tier, undone.manualOverride], ['EXCEPTION', 'CLASSIFICATION_REVIEW_REQUIRED', 5, undefined]);
check('Undo returns the row to Needs Review', isNeedsReview(undone), true);
const guessColumns = buildManualReviewDecisionsExport({ rows: [{ inputIndex: 0 }], results: { 0: decidedFromGuess } }).split('\n')[1].split('\t');
check('Export carries the classifier guess columns', [guessColumns[9], guessColumns[10], guessColumns[11], guessColumns[12]], ['5', 'MB Mail Enquiry Form', 'low', 'tentative reason']);

const mbNotes = (reg) => `Misc: x | Model = Vauxhall Corsa | Enquiry = Part-Exchange | Purchase = Just Browsing | Part = Yes | Reg = ${reg} | Mileage = 25000`;
const mbA = applyManualReviewDecision(finalizeResult(lowConfidenceResult, { inputIndex: 0, initialNotes: mbNotes('AB12CDE') }), 6, '', '');
const mbB = applyManualReviewDecision(finalizeResult(lowConfidenceResult, { inputIndex: 1, initialNotes: mbNotes('AB34CDE') }), 5, '', '');
const mbC = applyManualReviewDecision(finalizeResult(lowConfidenceResult, { inputIndex: 2, initialNotes: 'Customer Comments: totally different' }), 4, '', '');
const conflictLines = buildManualReviewDecisionsExport({ rows: [{ inputIndex: 0 }, { inputIndex: 1 }, { inputIndex: 2 }], results: { 0: mbA, 1: mbB, 2: mbC } }).split('\n');
check('Conflict column names the near-identical row with a different tier', [conflictLines[1].split('\t')[13], conflictLines[2].split('\t')[13], conflictLines[3].split('\t')[13]], ['row 2 (Tier 5)', 'row 1 (Tier 6)', '']);

if (failures.length > 0) {
console.error('KonnectLeadChecker needs-review self-test FAILED:\n' + failures.join('\n'));
} else {
console.info('KonnectLeadChecker needs-review self-test passed (20/20)');
}
});

// ===================================================================
// PAGE FLASH OVERLAY
//
// Hides Konnect Live re-rendering mid-navigation. Sits below the panel
// host (2147483000) so the panel stays visible on top.
// ===================================================================

const KLC_PAGE_FLASH_OVERLAY_ID = '_klcPageFlashOverlay';
let klcPageFlashOverlayPrevOverflow = null;

function showPageFlashOverlay(message) {
const existing = document.getElementById(KLC_PAGE_FLASH_OVERLAY_ID);
if (existing) {
const label = existing.querySelector('[data-overlay-label]');
if (label) label.textContent = message;
return;
}
if (!document.getElementById('_klcSpinKeyframes')) {
const style = document.createElement('style');
style.id = '_klcSpinKeyframes';
style.textContent = '@keyframes _klcSpin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);
}
const overlay = document.createElement('div');
overlay.id = KLC_PAGE_FLASH_OVERLAY_ID;
overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(20,20,22,0.92); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: white; font-size: 13px; font-weight: 600;';
overlay.innerHTML = `
<div style="width: 28px; height: 28px; border: 2.5px solid rgba(255,255,255,0.2); border-top-color: #C2CB42; border-radius: 50%; animation: _klcSpin 0.7s linear infinite;"></div>
<div data-overlay-label style="background: rgba(255,255,255,0.12); padding: 6px 14px; border-radius: 999px;">${message}</div>
`;
klcPageFlashOverlayPrevOverflow = document.documentElement.style.overflow;
document.documentElement.style.overflow = 'hidden';
document.documentElement.appendChild(overlay);
}

function hidePageFlashOverlay() {
document.getElementById(KLC_PAGE_FLASH_OVERLAY_ID)?.remove();
document.documentElement.style.overflow = klcPageFlashOverlayPrevOverflow || '';
klcPageFlashOverlayPrevOverflow = null;
}

// ===================================================================
// ICONS: inline SVG line icons matching SLA-Manager.js. Only the ones
// this panel uses.
// ===================================================================

const ICONS = {
clipboard: '<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>',
refresh: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/>',
copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
warning: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
minimize: '<line x1="5" y1="12" x2="19" y2="12"/>',
chevron: '<polyline points="6 9 12 15 18 9"/>',
play: '<polygon points="6 3 20 12 6 21 6 3"/>',
pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
flag: '<path d="M5 21V4h13l-2 4 2 4H5"/>',
shrink: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>'
};

function svgIcon(name, size, extraStyle) {
return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;${extraStyle || ''}">${ICONS[name]}</svg>`;
}

// Turned by a CSS rule on the open paste box, since native <details> has
// no state to pass in.
function detailsChevronIcon() {
return `<svg class="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;">${ICONS.chevron}</svg>`;
}

// ===================================================================
// UI PANEL: Shadow DOM, draggable. Browser only, so the self-tests run
// under Node.
// ===================================================================

// ===================================================================
// National check self-tests: batch parsing, lead mapping, customer
// choice, every verdict rule and the results export. Fictional data.
// ===================================================================
runSelfTest('nationalBatchSelfTest', function nationalBatchSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}
const header = NATIONAL_BATCH_HEADER.join('\t');
const batch = [
header,
['national', 'Mr. Alex Sample', '91000001SALESLEAD', '70000001', '04/11/2026 15:32', 'Enquiry - Used', 'Stellantis &You National Used Cars', '2026-11-06 09:40', 'Completed', 'Max Attempts Reached -  No Answer', '3', '2', '0', ''].join('\t'),
['national', 'Alex Sample', 'AB12CDE', '70000002', '06/11/2026 09:40', 'Enquiry - Used', 'National', '2026-11-06 09:40', 'In Progress', '', '1', '1', '0', 'open-manual'].join('\t'),
['wrong', 'Sam Buyer', '', '70000003', '06/11/2026 09:40', '', '', '', '', '', '', '', '', ''].join('\t'),
['national', 'Jo Example', '', '70000004', 'not a date', '', '', '', '', '', '', '', '', ''].join('\t')
].join('\n');
const parsed = parseBatchInput(batch);
check('national header is recognised', [parsed.headerOk, parsed.mode], [true, 'national']);
check('rows parsed', parsed.rows.length, 4);
check('first row fields', [parsed.rows[0].name, parsed.rows[0].activityId, parsed.rows[0].state, parsed.rows[0].exportOutcome], ['Mr. Alex Sample', '70000001', 'Completed', 'Max Attempts Reached -  No Answer']);
check('LeadCreated parsed', parsed.rows[0].parsedCreated, { year: 2026, month: 10, day: 4, hour: 15, minute: 32 });
check('titles ignored when grouping a customer', parsed.rows[0].groupKey === parsed.rows[1].groupKey, true);
check('row without the national marker is invalid', [parsed.rows[2].status, parsed.rows[2].exception], ['INVALID_INPUT', 'NO_SEARCH_IDENTIFIER']);
check('unreadable LeadCreated is invalid', parsed.rows[3].exception, 'INVALID_CREATED_DATETIME');
check('standard header still parses as standard', parseBatchInput('Name\tPhone\tEmail\tSource\tCampaign\tCreated\nA\t07700900123\t\tX\tY\tSat, 26 Sep 2026 18:05').mode, undefined);
const s = newSession(batch, null);
check('session mode', s.mode, 'national');
check('both Alex Sample leads are one customer group', s.groups[0].rows.length, 2);

const items = [
{ TimelineItemType: 1, LeadID: 1400001, EventTime: '2026-11-04T15:32:20.707+00:00' },
{ TimelineItemType: 1, LeadID: 1400002, EventTime: '2026-11-04T15:33:01+00:00' },
{ TimelineItemType: 3, LeadID: 1400001, EventTime: '2026-11-04T15:32:40+00:00' }
];
check('lead mapped by created minute', findNationalLeadIds(items, { year: 2026, month: 10, day: 4, hour: 15, minute: 32 }), ['1400001']);
check('no lead at that minute', findNationalLeadIds(items, { year: 2026, month: 10, day: 4, hour: 16, minute: 0 }), []);
const phoneLead = [{ TimelineItemType: 1, LeadID: 1400009, EventTime: '2026-11-08T14:14:50+00:00' }];
check('a lead a minute away is still found', findNationalLeadIds(phoneLead, { year: 2026, month: 10, day: 8, hour: 14, minute: 15 }), ['1400009']);
check('a lead three minutes away is not', findNationalLeadIds(phoneLead, { year: 2026, month: 10, day: 8, hour: 14, minute: 17 }), []);
check('the closest of two nearby leads wins', findNationalLeadIds(items, { year: 2026, month: 10, day: 4, hour: 15, minute: 33 }), ['1400002']);
const callItems = [
{ TimelineItemType: 1, LeadID: 1400010, EventTime: '2026-11-08T11:58:00+00:00' },
{ TimelineItemType: 3, LeadID: 1400010, EventTime: '2026-11-08T16:56:30+00:00' },
{ TimelineItemType: 3, LeadID: 0, EventTime: '2026-11-08T16:56:00+00:00' }
];
check('falls back to the call at the last contact time', findNationalLeadIdsByContact(callItems, { year: 2026, month: 10, day: 8, hour: 16, minute: 56 }), ['1400010']);
check('no call near the last contact', findNationalLeadIdsByContact(callItems, { year: 2026, month: 10, day: 8, hour: 18, minute: 0 }), []);
check('nearest lead created times are listed', nearestLeadCreatedTimes(callItems, { year: 2026, month: 10, day: 8, hour: 12, minute: 9 }), ['08/11 11:58']);


const exportSession = {
rows: [{ inputIndex: 0 }, { inputIndex: 1 }, { inputIndex: 2 }],
results: {
0: { inputIndex: 0, status: 'CLASSIFIED', name: 'Alex Sample', activityId: '70000001', leadId: '1400001', verdict: RE_SETUP, verdictReason: 'Closed as Email Only Lead without being sent to a dealership', attempts: 2, finalOutcome: 'Email Only Lead', enquiryMaxDealer: '', followUpNotes: 'Fri 6th Nov 2026 09:43 Agent A: no reply\tyet', resetCampaign: 'Enquiry - Used', reg: 'AB12CDE' },
1: { inputIndex: 1, status: 'CLASSIFIED', name: 'Sam Buyer', activityId: '70000002', leadId: '1400002', verdict: 'OK', verdictReason: 'Sent to Preston via Enquiry Max', attempts: 1, finalOutcome: 'Face to Face - National UCS', enquiryMaxDealer: 'Preston', followUpNotes: '', resetCampaign: 'should not export' },
2: { inputIndex: 2, status: 'EXCEPTION', exception: 'SEARCH_TIMEOUT', name: 'Jo Example', activityId: '70000003' }
}
};
const lines = buildNationalResultsExport(exportSession).split('\n');
check('results header', lines[0], NATIONAL_RESULT_HEADER.join('\t'));
check('every row has every column', lines.every((l) => l.split('\t').length === NATIONAL_RESULT_HEADER.length), true);
check('re setup row carries its campaign, tabs cleaned', lines[1].split('\t').slice(9, 11), ['Fri 6th Nov 2026 09:43 Agent A: no reply yet', 'Enquiry - Used']);
check('OK row leaves the campaign blank', lines[2].split('\t')[10], '');
check('reg travels with every row', lines[1].split('\t')[11], 'AB12CDE');
check('no notes or dropdown values are exported', NATIONAL_RESULT_HEADER.some((h) => /notes$|voi|px|fields/i.test(h) && h !== 'FollowUpNotes'), false);
check('lead window on the same campaign is trusted', nationalCampaignsMatch('Enquiry - Used', 'enquiry - used'), true);
check('lead window on another campaign is not', nationalCampaignsMatch('Peugeot - PX Valuation - New', 'Enquiry - Used'), false);
check('exception row exported as Check with a reason', lines[3].split('\t').slice(4, 6), ['Check', 'Could not check: Search timed out']);

const ui = { isCustomerOpen: () => false, isTierOpen: (k, d) => d, avatar: () => '' };
const html = renderNationalResultsHtml([
{ inputIndex: 0, status: 'CLASSIFIED', name: 'OK <b>Person</b>', verdict: 'OK', verdictReason: 'fine' },
{ inputIndex: 1, status: 'CLASSIFIED', name: 'Reset Person', verdict: RE_SETUP, verdictReason: 'nowhere' }
], '', ui);
check('names are escaped', html.includes('<b>Person</b>'), false);
check('Reset group comes before OK', html.indexOf('Reset Person') < html.indexOf('Person</span>') || html.indexOf('Reset Person') < html.indexOf('OK &lt;b&gt;'), true);

if (failures.length > 0) console.error('KonnectLeadChecker national-batch self-test FAILED:\n' + failures.join('\n'));
else console.info('KonnectLeadChecker national-batch self-test passed');
});

runSelfTest('evaluateNationalLeadSelfTest', function evaluateNationalLeadSelfTest() {
const failures = [];
function check(label, actual, expected) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}
const NAT = 'Stellantis &You National Used Cars';
const it = (type, leadId, time, below, desc, agent) => ({ TimelineItemType: type, LeadID: leadId, EventTime: `2026-11-${time}:00+00:00`, BelowLineTitle: below || '', Description: desc || '', IsContactCentreAgent: agent !== false });
const call = (leadId, time, outcome, desc) => it(3, leadId, time, `Agent A called the customer with an outcome of ${outcome}`, desc);
const created = (leadId, time, desc) => it(1, leadId, time, 'Manually Created Sales Lead from Robins & Day Website', desc || `New Sales Lead, 'Enquiry - Used Request' for ${NAT} Lead routed`, false);
const sent = (leadId, time, dealer) => it(2, leadId, time, 'Lead sent to Enquiry Max', `Lead sent by Agent A and successfuly received at ${dealer}`, false);
function run(leadId, items, batch, ctx) {
const lead = { leadId: String(leadId), createdMs: eventTimeMs(items.find((i) => i.TimelineItemType === 1 && i.LeadID === leadId).EventTime) };
return evaluateNationalLead(lead, items.filter((i) => i.LeadID === leadId), items, Object.assign({ state: 'Completed', exportOutcome: '', exportHint: '' }, batch), ctx);
}

// System closed at attempt 3 with Max Attempts: fine.
const sys = [created(1400001, '04T15:32'), call(1400001, '04T15:36', 'Manual Reschedule', `No Activity Outcome at ${NAT}`), call(1400001, '05T10:34', 'Manual Reschedule', `No Activity Outcome at ${NAT}`),
call(1400001, '05T15:37', 'Update Outcomes (No Call Made)', `Sales -> National Used Stock -> No Opportunity -> Max Attempts Reached -  No Answer at ${NAT}`)];
const r1 = run(1400001, sys, {});
check('system close at 3 with Max Attempts is OK', [r1.verdict, r1.attempts], ['OK', 3]);

// In Market, but sent to Liverpool.
const inMarket = [created(1400002, '06T09:40'), call(1400002, '06T09:40', 'Update Outcomes (No Call Made)', 'New Enquiry at Liverpool'), sent(1400002, '06T09:43', 'Liverpool')];
const r2 = run(1400002, inMarket, { exportOutcome: 'In Market - wont commit to appointment yet' });
check('In Market sent to Liverpool is OK', [r2.verdict, r2.enquiryMaxDealer], ['OK', 'Liverpool']);

// Email Only, last attempt no answer, nothing sent: reset.
const emailOnly = [created(1400003, '02T07:10'), call(1400003, '02T09:52', 'Update Outcomes (No Call Made)', `Sales -> Customer Hub Team -> Ongoing -> Email Only Lead at ${NAT}`), call(1400003, '07T13:07', 'No Answer - No Message Left', `No Activity Outcome at ${NAT}`)];
const r3 = run(1400003, emailOnly, {});
check('Email Only with no send is Reset', [r3.verdict, r3.finalOutcome], [RE_SETUP, 'Email Only Lead']);
// Even with a newer lead booked in at a dealership.
const emailOnlyWithNewer = emailOnly.concat([created(1400010, '07T07:52'), it(1, 1400011, '07T09:16', 'New Sales Lead from Phone Call', 'Walk-in lead created in Enquiry Max at Walton', false), it(8, 1400010, '07T09:21', 'Appointment Created', 'Appointment Created by Agent A of type Face To Face', false)]);
check('Email Only is still Reset when a newer lead exists', run(1400003, emailOnlyWithNewer, {}).verdict, RE_SETUP);
// Sent to a dealership once, came back, then closed with nothing sent: the
// old send does not cover the later closure.
const sentThenClosed = [created(1400012, '02T07:10'), call(1400012, '02T09:52', 'Update Outcomes (No Call Made)', 'New Enquiry at Walton'), sent(1400012, '02T09:53', 'Walton'),
call(1400012, '07T09:00', 'Manual Reschedule', `No Activity Outcome at ${NAT}`), call(1400012, '07T13:07', 'No Answer - No Message Left', `Sales -> Customer Hub Team -> Ongoing -> Email Only Lead at ${NAT}`)];
const r12 = run(1400012, sentThenClosed, {});
check('an earlier send does not cover a later dead-end closure', [r12.verdict, /Walton earlier/.test(r12.reason)], [RE_SETUP, true]);

// A call covering two leads is filed under one of them and lists both
// outcomes. The export's own outcome for this lead must win.
const shared = [created(1400020, '04T15:32'), call(1400020, '05T15:37', 'Update Outcomes (No Call Made)', `Sales -> National Used Stock -> No Opportunity -> Max Attempts Reached -  No Answer at ${NAT}`),
call(1400020, '06T09:40', 'Update Outcomes (No Call Made)', `Sales -> National Used Stock -> No Opportunity -> Max Attempts Reached -  No Answer at ${NAT}\r\nSales -> Customer Hub Team -> No Appointment -> In Market - wont commit to appointment yet at ${NAT}`)];
const r20 = run(1400020, shared, { exportOutcome: 'Max Attempts Reached -  No Answer', attempts: '3', lastContact: '06/11/2026 09:40' });
check('export outcome wins over a shared call entry', [r20.verdict, r20.finalOutcome, r20.attempts], ['OK', 'Max Attempts Reached -  No Answer', 3]);
check('a shared call entry gives no outcome of its own', outcomeFromCallDescription(`Sales -> A -> B at X\r\nSales -> C -> D at Y`), null);

// Live case: sent to Walton in October, back to National, closed Email Only
// in November with no new send.
const bouncedBack = [created(1400021, '02T07:10'), sent(1400021, '02T09:53', 'Walton with EMax confirmation')];
const r21 = run(1400021, bouncedBack, { exportOutcome: 'Email Only Lead', attempts: '1', lastContact: '07/11/2026 13:07' });
check('an old send does not cover a later Email Only closure (export times)', [r21.verdict, /Walton earlier/.test(r21.reason)], [RE_SETUP, true]);

// Live case: appointment and send minutes after the last call; later
// notification emails are not calls.
const booked = [created(1400022, '07T17:47'), sent(1400022, '08T10:05', 'Preston with EMax confirmation')];
const r22 = run(1400022, booked, { exportOutcome: 'Face to Face - National UCS', attempts: '1', lastContact: '08/11/2026 09:59' });
check('send after the last call is OK, dealer name without the confirmation note', [r22.verdict, r22.enquiryMaxDealer], ['OK', 'Preston']);

// Live cases from 13 Nov.
const setUpAgain = emailOnlyWithNewer.concat([created(1400030, '09T16:01'), call(1400030, '09T16:01', 'Manual Reschedule', `No Activity Outcome at ${NAT}`)]);
const r30 = run(1400003, setUpAgain, {});
check('a lead made after the last call means it is already set up again', [r30.verdict, /9 Nov 16:01/.test(r30.reason)], ['OK', true]);
const setUpAgainDead = emailOnly.concat([created(1400031, '09T16:01'), call(1400031, '09T16:05', 'Spoke to Customer', `Sales -> Customer Hub Team -> No Appointment -> Not Interested at ${NAT}`)]);
check('a newer lead that also went nowhere does not cover it', run(1400003, setUpAgainDead, {}).verdict, RE_SETUP);
const bookedThenRang = [created(1400032, '10T23:31'), it(8, 1400032, '11T10:06', 'Appointment Created', 'Appointment Created by Agent A of type Test Drive', false), sent(1400032, '11T10:08', 'Crawley')];
const r32 = run(1400032, bookedThenRang, { exportOutcome: 'Test Drive - National UCS', attempts: '1', lastContact: '11/11/2026 14:33' });
check('a booking sent on before later calls is OK', [r32.verdict, /Crawley/.test(r32.reason)], ['OK', true]);
const bookedOnOther = [created(1400033, '12T12:15'), created(1400034, '12T13:17'), it(8, 1400034, '12T13:26', 'Appointment Created', 'Appointment Created by Agent A of type Face To Face', false), sent(1400034, '12T13:29', 'Sale with EMax confirmation')];
check('a booking sent on under the customer\'s other lead is OK', run(1400033, bookedOnOther, { exportOutcome: 'Face To Face', attempts: '1', lastContact: '12/11/2026 13:47' }).verdict, 'OK');
check('a booking with no send anywhere is still Re setup', run(1400033, bookedOnOther.slice(0, 3), { exportOutcome: 'Face To Face', attempts: '1', lastContact: '12/11/2026 13:47' }).verdict, RE_SETUP);
const fourCalls = [created(1400035, '03T11:49'), created(1400036, '08T12:05'), call(1400035, '08T12:05', 'Manual Reschedule', `Sales -> Sent Direct to Enquiry Max at ${NAT}`), call(1400036, '08T15:58', 'Manual Reschedule', `No Activity Outcome at ${NAT}`),
call(1400036, '09T11:01', 'Manual Reschedule', `No Activity Outcome at ${NAT}`), call(1400035, '10T10:04', 'No Answer - No Message Left', `Sales -> Sent Direct to Enquiry Max at ${NAT}`)];
check('Sent Direct to Enquiry Max after four calls is OK', run(1400035, fourCalls, { exportOutcome: 'Sent Direct to Enquiry Max', attempts: '2', lastContact: '10/11/2026 10:04' }).verdict, 'OK');
check('Sent Direct to Enquiry Max after two calls is not', run(1400035, fourCalls.slice(0, 3).concat(fourCalls.slice(5)), { exportOutcome: 'Sent Direct to Enquiry Max', attempts: '2', lastContact: '10/11/2026 10:04' }).verdict, RE_SETUP);
check('apostrophe names are searched three ways', nameSearchVariants("Mr. Sam O'Buyer"), ["Sam O'Buyer", 'Sam O Buyer', 'Sam O']);
check('plain names are searched once', nameSearchVariants('Mr Sam Buyer'), ['Sam Buyer']);
check('an apostrophe or a space in its place is the same name', nationalCandidateIds([{ link: {}, customerId: '7', customerName: 'Mr Sam O Buyer' }, { link: {}, customerId: '8', customerName: 'Sam Oliver' }], "Sam O'Buyer"), ['7']);
const changed = applyNationalVerdictChange({ inputIndex: 0, status: 'CLASSIFIED', verdict: RE_SETUP, verdictReason: 'nowhere', resetCampaign: 'Vauxhall - Enquiry - Used', campaign: 'Vauxhall - Enquiry - Used' }, 'OK', 'already done');
check('a verdict changed by hand keeps what the check said', [changed.verdict, changed.resetCampaign, /already done/.test(changed.verdictReason), /nowhere/.test(changed.verdictReason)], ['OK', '', true, true]);
const undone = undoNationalVerdictChange(changed);
check('undo puts the check\'s verdict back', [undone.verdict, undone.verdictReason, undone.resetCampaign, undone.verdictChange], [RE_SETUP, 'nowhere', 'Vauxhall - Enquiry - Used', undefined]);
check('changing to Re setup fills the campaign', applyNationalVerdictChange({ status: 'CLASSIFIED', verdict: 'OK', verdictReason: 'x', campaign: 'Vauxhall - Enquiry - Used' }, RE_SETUP, '').resetCampaign, 'Vauxhall - Enquiry - Used');

const notInterested = [created(1400040, '10T09:00'), call(1400040, '10T09:30', 'Spoke to Customer', `Sales -> Customer Hub Team -> No Appointment -> Not Interested at ${NAT}`)];
check('spoken to and not interested is OK with no send', run(1400040, notInterested, { exportOutcome: 'Not Interested', attempts: '1', lastContact: '10/11/2026 09:30' }).verdict, 'OK');
const notSpoken = [created(1400041, '10T09:00'), call(1400041, '10T09:30', 'Update Outcomes (No Call Made)', `Sales -> Customer Hub Team -> No Appointment -> Not Interested at ${NAT}`)];
check('not interested without a conversation is still Re setup', run(1400041, notSpoken, { exportOutcome: 'Not Interested', attempts: '1', lastContact: '10/11/2026 09:30' }).verdict, RE_SETUP);
check('an automatic reschedule on the fourth attempt is OK, earlier is a Check', [run(1400040, notInterested, { state: 'In Progress', exportHint: 'open-auto', exportOutcome: 'In Market - wont commit to appointment yet', attempts: '4' }).verdict, run(1400040, notInterested, { state: 'In Progress', exportHint: 'open-auto', attempts: '2' }).verdict], ['OK', 'Check']);
const emailOnlyRun = [created(1400050, '09T16:01'), call(1400050, '09T16:01', 'Update Outcomes (No Call Made)', `No Activity Outcome at ${NAT}`), call(1400050, '10T16:03', 'Manual Reschedule', `No Activity Outcome at ${NAT}`), call(1400050, '11T12:34', 'Manual Reschedule', `No Activity Outcome at ${NAT}`),
call(1400050, '12T09:48', 'Manual Reschedule', `No Activity Outcome at ${NAT}`), call(1400050, '12T10:35', 'No Answer - No Message Left', `Sales -> Customer Hub Team -> Ongoing -> Email Only Lead at ${NAT}`)];
check('Email Only after four real calls is OK', run(1400050, emailOnlyRun, { exportOutcome: 'Email Only Lead', lastContact: '12/11/2026 10:35' }).verdict, 'OK');
check('Email Only after three real calls and an outcome update is still Re setup', run(1400050, emailOnlyRun.slice(0, 4).concat(emailOnlyRun.slice(5)), { exportOutcome: 'Email Only Lead', lastContact: '12/11/2026 10:35' }).verdict, RE_SETUP);
const twoLeadsHtml = renderNationalResultsHtml([
{ inputIndex: 0, status: 'CLASSIFIED', name: 'Mr Sam Buyer', verdict: 'OK', verdictReason: 'Sent to Preston', created: '01/11/2026 10:00' },
{ inputIndex: 1, status: 'CLASSIFIED', name: 'Sam Buyer', verdict: RE_SETUP, verdictReason: 'nowhere', created: '02/11/2026 10:00' },
{ inputIndex: 2, status: 'CLASSIFIED', name: 'Jo Example', verdict: 'OK', verdictReason: 'fine', created: '03/11/2026 10:00' }
], '', { isCustomerOpen: () => false, isTierOpen: (k, d) => d, avatar: () => '' });
check('a customer with two National leads is one row, under the worse verdict, with both leads inside', [(twoLeadsHtml.match(/class="customer[ "]/g) || []).length, /2 National leads · nowhere/.test(twoLeadsHtml), twoLeadsHtml.indexOf('nowhere') < twoLeadsHtml.indexOf('Jo Example'), /Sent to Preston/.test(twoLeadsHtml), (twoLeadsHtml.match(/national-change/g) || []).length], [2, true, true, true, 3]);

// Live case, 14 Nov: an old Email Only lead, set up again; the new lead had
// Email Only set on the day it was made and ended on Max Attempts.
const reSetUpThenMax = emailOnly.concat([created(1400060, '09T16:01'), call(1400060, '09T16:01', 'Update Outcomes (No Call Made)', `Sales -> Customer Hub Team -> Ongoing -> Email Only Lead at ${NAT}`),
call(1400060, '10T16:03', 'Manual Reschedule', `No Activity Outcome at ${NAT}`), call(1400060, '12T10:35', 'No Answer - No Message Left', `Sales -> National Used Stock -> No Opportunity -> Max Attempts Reached -  No Answer at ${NAT}\r\nSales -> Customer Hub Team -> Ongoing -> Email Only Lead at ${NAT}`)]);
check('a newer lead that ended on Max Attempts covers the old one, whatever was set on it first', run(1400003, reSetUpThenMax, {}).verdict, 'OK');
check('and that newer lead is OK itself even when the export still says Email Only', run(1400060, reSetUpThenMax.filter((i) => i.LeadID === 1400060).slice(0, 3).concat([call(1400060, '12T10:35', 'No Answer - No Message Left', `Sales -> National Used Stock -> No Opportunity -> Max Attempts Reached -  No Answer at ${NAT}`)]), { exportOutcome: 'Email Only Lead', attempts: '2', lastContact: '12/11/2026 10:35' }).verdict, 'OK');
check('how a lead ended: every outcome on its last call, and its real calls', (() => { const e = leadEndingFrom(reSetUpThenMax.filter((i) => i.LeadID === 1400060)); return [e.outcomes.length, e.maxAttempts, e.anyMaxAttempts, e.realCalls]; })(), [2, false, true, 2]);

// Misdirected starts as Check; the lead details decide it.
const misdirectedLead = [created(1400023, '08T20:24')];
check('Misdirected starts as Check', run(1400023, misdirectedLead, { exportOutcome: 'Misdirected - Created VR Message', attempts: '1', lastContact: '09/11/2026 12:52' }).verdict, 'Check');
check('Misdirected on a Service Plan request is OK', resolveMisdirected('Misdirected - Created VR Message', { leadRequest: 'Service Plan Request', initialNotes: '' }).verdict, 'OK');
check('Misdirected with aftersales notes is OK', resolveMisdirected('Misdirected - Created VR Message', { leadRequest: '', initialNotes: 'Annual Mileage: 5000 TO 6000 Customer Number: 10000001' }).verdict, 'OK');
check('Misdirected on a sales enquiry stays Check', resolveMisdirected('Misdirected - Created VR Message', { leadRequest: 'Enquiry Request', initialNotes: 'Can I test drive the 208 on Saturday?' }), null);
check('other outcomes are not touched', resolveMisdirected('Email Only Lead', { leadRequest: 'Service Plan Request', initialNotes: '' }), null);

// Face to Face National UCS, sent to Preston.
const f2f = [created(1400004, '07T17:47'), call(1400004, '08T10:04', 'Spoke to Customer', `Sales -> National Used Stock -> Reserve Appointment -> Face to Face - National UCS at ${NAT}`), it(8, 1400004, '08T10:05', 'Appointment Created', 'Appointment Created by Agent A of type Face To Face', false), sent(1400004, '08T10:05', 'Preston')];
check('Face to Face sent to Preston is OK', run(1400004, f2f, {}).verdict, 'OK');

// Inbound phone-call lead sent to Coventry.
const inbound = [created(1400005, '08T14:14'), it(3, 1400005, '08T14:14', 'Agent A took an inbound call with outcome of Inbound Booking Opportunity', 'Sales -> ART -> Appointment -> Phone Call at Coventry'), sent(1400005, '08T14:19', 'Coventry')];
const r5 = run(1400005, inbound, {});
check('inbound lead sent to Coventry is OK, inbound call not counted as an attempt', [r5.verdict, r5.attempts], ['OK', 0]);

// Older Max Attempts "Sent to Dealer" at National, newer lead walked in at Walton.
const oldMax = [created(1400006, '03T18:30'), call(1400006, '07T13:07', 'No Answer - No Message Left', `Sales -> Max Attempts Reached - Sent to Dealer at ${NAT}`), it(1, 1400012, '07T09:16', 'New Sales Lead from Phone Call', 'Walk-in lead created in Enquiry Max at Walton', false)];
check('older Max Attempts lead with a Walton walk-in is OK', run(1400006, oldMax, {}).verdict, 'OK');

// Old "Sent Direct to Enquiry Max" with no send, newer open lead.
const direct = [created(1400007, '03T11:49'), call(1400007, '08T12:05', 'Manual Reschedule', `Sales -> Sent Direct to Enquiry Max at ${NAT}`), created(1400008, '08T12:05')];
const r7 = run(1400007, direct, {}, { openLeadIds: ['1400008'] });
check('Sent Direct to Enquiry Max covered by a newer open lead is OK', [r7.verdict, r7.reason.startsWith('Covered by newer lead')], ['OK', true]);
check('the same without a newer open lead is Reset', run(1400007, direct, {}, { openLeadIds: [] }).verdict, RE_SETUP);

// Open leads.
const open = [created(1400009, '08T12:05'), call(1400009, '08T12:05', 'Manual Reschedule', `No Activity Outcome at ${NAT}`)];
check('open with manual reschedules is OK', run(1400009, open, { state: 'In Progress', exportHint: 'open-manual' }).reason, 'Still being worked');
check('open with an automatic reschedule is Check', run(1400009, open, { state: 'In Progress', exportHint: 'open-auto' }).verdict, 'Check');

// Sent only to National.
const toNational = [created(1400013, '05T10:00'), call(1400013, '05T10:05', 'Spoke to Customer', `Sales -> ART -> Appointment -> Face To Face at ${NAT}`), sent(1400013, '05T10:06', NAT)];
check('sent to Enquiry Max at National is Reset', run(1400013, toNational, {}).reason, 'Sent to Enquiry Max at National, went nowhere');

// Admin closure, export-only outcome and unknown outcome.
const admin = [created(1400014, '05T10:00'), call(1400014, '05T10:01', 'Update Outcomes (No Call Made)', `Sales -> Customer Hub Team -> No Opportunity -> Test Lead at ${NAT}`)];
check('Test Lead is OK', run(1400014, admin, {}).verdict, 'OK');
const bare = [created(1400015, '05T10:00')];
check('export outcome used when the timeline has none', run(1400015, bare, { exportOutcome: 'Duplicate Record' }).verdict, 'OK');
const unknown = [created(1400016, '05T10:00'), call(1400016, '05T10:01', 'Spoke to Customer', `Sales -> Something Brand New at ${NAT}`)];
const r16 = run(1400016, unknown, {});
check('unknown outcome is Check', [r16.verdict, r16.reason], ['Check', 'Outcome not seen before: Something Brand New']);

if (failures.length > 0) console.error('KonnectLeadChecker evaluate-national self-test FAILED:\n' + failures.join('\n'));
else console.info('KonnectLeadChecker evaluate-national self-test passed');
});

const KLC_NAV_ITEM_ID = '_klcNavItem';
const KLC_BADGE_ID = '_klcBadge';

// Whether an element has a box inside the window. Konnect's menu bar hides
// or folds away some of its items in a narrow window.
function inWindowView(element) {
if (!element || typeof element.getBoundingClientRect !== 'function') return false;
const rect = element.getBoundingClientRect();
return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
&& rect.left < window.innerWidth && rect.top < window.innerHeight;
}

// Matches Konnect Live's own nav item markup and text-konnect-live colour
// so it blends in as one of its icons.
function buildBadge() {
document.getElementById(KLC_NAV_ITEM_ID)?.remove();
document.getElementById(KLC_BADGE_ID)?.remove();

const nav = document.querySelector('nav.navbar.navbar-inverse.navbar-fixed-top');
// A module nav sibling confirms this is the real app nav, not a
// same-classed lookalike.
const hasModuleIcons = nav && !!nav.querySelector('ul.nav.navbar-right.top-nav');
if (nav && hasModuleIcons) {
const ul = document.createElement('ul');
ul.id = KLC_NAV_ITEM_ID;
ul.className = 'nav navbar-right top-nav';
ul.style.cssText = 'float:right;padding-right:3px;padding-left:3px';
const li = document.createElement('li');
li.className = 'dropdown hidden-sm';
const a = document.createElement('a');
a.href = 'javascript:void(0)';
a.title = 'Konnect Lead Checker';
const icon = document.createElement('i');
icon.className = 'fa fa-clipboard fa-fw text-konnect-live';
const label = document.createElement('span');
label.textContent = 'Check';
a.appendChild(icon);
a.appendChild(label);
li.appendChild(a);
ul.appendChild(li);
// Inserted before .navbar-collapse: a float cannot rise above a preceding
// block, so appending put it on its own row.
const collapseDiv = nav.querySelector('.navbar-collapse');
if (collapseDiv) nav.insertBefore(ul, collapseDiv); else nav.appendChild(ul);
// A narrow window can leave the item with no box or off the edge; the
// floating button is used there so the panel can always be opened.
if (inWindowView(a)) {
return {
inNav: true,
clickTarget: a,
show() { ul.style.display = ''; },
hide() { ul.style.display = 'none'; },
remove() { ul.remove(); },
setProgress() {}
};
}
ul.remove();
}

debugLog('KonnectLeadChecker: no visible navbar item, falling back to a fixed badge');
const badge = document.createElement('div');
badge.id = KLC_BADGE_ID;
Object.assign(badge.style, {
position: 'fixed', top: '16px', right: '16px', width: '48px', height: '48px',
background: '#222222', border: '2px solid #C2CB42', borderRadius: '50%',
boxShadow: '0 4px 12px rgba(194,203,66,0.35)', zIndex: 2147483000, cursor: 'pointer',
display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
fontWeight: 'bold', color: '#C2CB42', transition: 'transform 0.15s ease, box-shadow 0.15s ease',
fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
});
badge.innerHTML = svgIcon('clipboard', 22);
badge.title = 'Konnect Lead Checker';
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
inNav: false,
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

// The number only shows while work is left.
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
// Removed by ID right before creating a fresh host, whatever the guard says.
document.getElementById('_klcPanelHost')?.remove();
const host = document.createElement('div');
host.id = '_klcPanelHost';
Object.assign(host.style, { all: 'initial', position: 'fixed', top: '16px', right: '16px', zIndex: 2147483000, display: 'none' });
document.documentElement.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
const menuItem = (id, icon, text, extra) => `<button type="button" class="mi" role="menuitem"${id ? ` id="${id}"` : ''}${extra || ''}>${icon ? svgIcon(icon, 14) : ''}<span>${text}</span></button>`;
root.innerHTML = `
<style>
:host {
--wb-bg: #f2f2f7; --wb-surface: #ffffff; --wb-control: #e5e5ea; --wb-control-hover: #d8d8dd;
--wb-text: #1c1c1e; --wb-text-2: #334155; --wb-muted: #5b6577;
--wb-border: #e2e8f0; --wb-border-strong: #c5cbd6; --wb-border-soft: #eef0f5;
--wb-accent: #C2CB42; --wb-accent-ink: #4c5200; --wb-danger: #c62828; --wb-focus-inner: #1c1c1e; --wb-focus-outer: #C2CB42;
--wb-ok: #047857; --wb-ok-bg: #e3f4ec; --wb-info: #1d4ed8; --wb-warn: #92400e; --wb-warn-bg: #fdefd3;
--wb-review-bg: #fffbe8; --wb-review-border: #f1d98a;
--wb-copy-bg: #eef2ff; --wb-copy-text: #1e293b; --wb-notice-bg: #fde8e8; --wb-notice-text: #8f1d1d; --wb-notice-border: #efb4b4;
color-scheme: light;
}
/* Two-tone ring: visible on light surfaces, the dark header and the accent buttons. */
:focus-visible { outline: 2px solid var(--wb-focus-inner); outline-offset: 0; box-shadow: 0 0 0 4px var(--wb-focus-outer); }
.header :focus-visible { outline-color: var(--wb-focus-outer); box-shadow: none; }
/* Black and lime are the frame only (Konnect Live's own navbar colours); tier colours carry the meaning. */
.panel { position: relative; width: 440px; max-width: calc(100vw - 32px); display: flex; flex-direction: column; background: var(--wb-bg); border-radius: 16px; box-shadow: 0 20px 50px -12px rgba(0,0,0,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12.5px; line-height: 1.4; color: var(--wb-text); }
button { font-family: inherit; }
.header { flex-shrink: 0; background: #1c1c1e; color: white; padding: 9px 10px 9px 14px; display: flex; align-items: center; gap: 8px; border-radius: 16px 16px 0 0; cursor: move; user-select: none; }
.header-title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; white-space: nowrap; }
.header-title .name { font-weight: 700; font-size: 14px; }
.header-title .sub { color: #c7c7cc; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.header button { background: transparent; border: none; color: white; cursor: pointer; padding: 5px 9px; min-height: 26px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; font-size: 12.5px; font-weight: 600; }
.header button:hover, .header button[aria-expanded="true"] { background: rgba(255,255,255,0.16); }
.strip { flex-shrink: 0; display: flex; align-items: center; gap: 7px; padding: 6px 14px; background: var(--wb-surface); border-bottom: 1px solid var(--wb-border); color: var(--wb-muted); font-size: 12px; }
.strip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #9aa3b2; flex: none; }
.strip.ok::before { background: var(--wb-ok); }
.strip.busy::before { background: #2563eb; }
.strip.paused::before { background: #d97706; }
.strip.out { background: var(--wb-notice-bg); color: var(--wb-notice-text); font-weight: 700; }
.strip.out::before { background: var(--wb-danger); }
/* The list scrolls inside the panel. The height is the default below, or the one chosen with the grip or in More. */
.bodyEl { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; overflow-y: auto; max-height: min(470px, calc(100vh - 170px)); min-height: 60px; box-sizing: border-box; }
.bodyEl > * { flex-shrink: 0; }
.bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.grow { flex: 1; min-width: 0; }
.small { font-size: 11.5px; color: var(--wb-muted); }
.lbl { font-size: 11.5px; font-weight: 600; color: var(--wb-muted); }
button.btn { padding: 6px 11px; border: 1px solid var(--wb-border-strong); background: var(--wb-surface); color: var(--wb-text); border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 5px; white-space: nowrap; }
button.btn:hover { border-color: var(--wb-text); }
button.btn:disabled { opacity: 0.5; cursor: default; border-color: var(--wb-border-strong); }
button.btn.pri { background: var(--wb-accent); border-color: var(--wb-accent); color: #1c1c1e; font-weight: 700; padding: 7px 14px; }
button.btn.pri:hover { background: #aab238; border-color: #aab238; }
button.txt { align-self: flex-start; background: none; border: none; padding: 0; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--wb-accent-ink); text-decoration: underline; text-underline-offset: 2px; }
textarea { width: 100%; height: 64px; box-sizing: border-box; font-family: monospace; font-size: 11px; padding: 6px; border: 1px solid var(--wb-border-strong); border-radius: 8px; }
input[type="text"] { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--wb-border-strong); border-radius: 10px; font-size: 12px; font-family: inherit; }
textarea, input[type="text"] { background: var(--wb-surface); color: var(--wb-text); }
textarea:focus, input[type="text"]:focus { outline: none; border-color: var(--wb-accent-ink); }
/* !important: the button rules above set their own display. */
.hidden { display: none !important; }
.card, .status, .topSection { background: var(--wb-surface); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.topSection > summary { padding: 8px 10px; cursor: pointer; font-weight: 600; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 6px; border-radius: 12px; }
.topSection > summary::-webkit-details-marker { display: none; }
.topSection > summary .chev { transition: transform 0.15s ease; color: var(--wb-muted); }
.topSection[open] > summary .chev { transform: rotate(180deg); }
.topSection-content { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 6px; }
.row-error { color: var(--wb-danger); font-size: 11.5px; }
.status { padding: 10px; display: flex; flex-direction: column; gap: 7px; }
.status #statusHeadline { font-size: 13px; white-space: nowrap; flex: 1 0 auto; }
.status.nobatch > :not(#curState) { display: none; }
#curCustomer:not(.hidden) + #curTargetPart::before { content: "\\00b7"; margin: 0 5px; }
#curState.info { color: var(--wb-info); font-weight: 600; }
.hint-line { color: var(--wb-warn); font-size: 11.5px; }
.progress-track { height: 6px; background: var(--wb-border); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--wb-accent); transition: width 0.2s ease; border-radius: 3px; }
.progress-fill.waiting { background: #c9ccd3; }
.progress-fill.active { background-image: linear-gradient(135deg, rgba(255,255,255,0.4) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.4) 75%, transparent 75%, transparent); background-size: 14px 14px; animation: klcProgressStripes 0.6s linear infinite; }
@keyframes klcProgressStripes { from { background-position: 0 0; } to { background-position: 14px 0; } }
.stats-bar { display: flex; flex-wrap: wrap; gap: 5px; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--wb-border-strong); background: var(--wb-surface); color: var(--wb-text); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
button.chip { cursor: pointer; }
button.chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--tc, #64748b); flex: none; }
button.chip:hover { border-color: var(--wb-text); }
button.chip[aria-pressed="true"] { border-color: var(--wb-text); box-shadow: inset 0 0 0 1px var(--wb-text); }
.chip.warn { background: var(--wb-warn-bg); border-color: var(--wb-warn-bg); color: var(--wb-warn); }
.chip.bad { background: var(--wb-notice-bg); border-color: var(--wb-notice-bg); color: var(--wb-danger); }
.tag { font-size: 10.5px; font-weight: 700; border-radius: 6px; padding: 1px 6px; white-space: nowrap; flex: none; }
.tag.info { background: #dbe7ff; color: var(--wb-info); }
.tag.warn { background: var(--wb-warn-bg); color: var(--wb-warn); }
.tag.ok { background: var(--wb-ok-bg); color: var(--wb-ok); }
.recent-log { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--wb-muted); }
.recent-log-row { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tier { display: flex; flex-direction: column; }
.tier > summary { padding: 5px 9px; cursor: pointer; font-weight: 700; list-style: none; display: flex; align-items: baseline; justify-content: space-between; gap: 6px; border-left: 4px solid var(--wb-muted); border-radius: 8px; }
.tier > summary::-webkit-details-marker { display: none; }
.tier-rows { background: var(--wb-surface); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-top: 6px; }
#resultsBody { display: flex; flex-direction: column; gap: 8px; }
.customer { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 9px; align-items: center; padding: 8px 10px; }
.customer > .avatar-btn { align-self: start; margin-top: 1px; }
.customer + .customer { border-top: 1px solid var(--wb-border); }
.customer-summary { cursor: pointer; display: flex; flex-direction: column; gap: 1px; min-width: 0; border-radius: 6px; }
.customer-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.customer-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.customer-meta { font-size: 11.5px; color: var(--wb-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.customer.open .customer-meta { white-space: normal; }
.open-note { font-size: 11.5px; font-weight: 600; color: var(--wb-info); }
.customer-body { grid-column: 2; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--wb-border-strong); font-size: 12px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
.kv dt { color: var(--wb-muted); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.avatar-btn { width: 30px; height: 30px; font-size: 11px; border: none; padding: 0; margin: 0; border-radius: 50%; color: white; font-family: inherit; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; }
.avatar-btn:hover { filter: brightness(1.15); box-shadow: 0 0 0 2px var(--wb-surface), 0 0 0 4px var(--wb-border-strong); }
.avatar-btn.opening { cursor: progress; box-shadow: 0 0 0 2px var(--wb-surface), 0 0 0 4px var(--wb-accent); animation: klcAvatarPulse 0.9s ease-in-out infinite alternate; }
@keyframes klcAvatarPulse { from { opacity: 1; } to { opacity: 0.55; } }
.notes-block, .quote { white-space: pre-wrap; background: var(--wb-bg); border-radius: 8px; padding: 7px 9px; margin-top: 6px; font-size: 12px; overflow-wrap: anywhere; }
.reason { color: var(--wb-muted); margin-top: 4px; }
.empty-state { color: var(--wb-muted); padding: 8px 4px; }
.empty { text-align: center; color: var(--wb-muted); padding: 18px 10px; }
.empty b { display: block; color: var(--wb-text); font-size: 14px; }
.review-rows { display: flex; flex-direction: column; gap: 8px; }
.review-row { background: var(--wb-surface); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.review-row.open { background: var(--wb-review-bg); border: 1px solid var(--wb-review-border); box-shadow: none; }
.review-row.decided { background: var(--wb-ok-bg); border: 1px solid #9fdcc4; box-shadow: none; }
.review-row.folded { cursor: pointer; gap: 2px; }
.review-row.folded .customer-meta { margin-left: 39px; }
.review-row .quote { background: var(--wb-surface); margin-top: 0; }
.review-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.review-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.review-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.notice-bar { display: flex; flex-direction: column; gap: 6px; }
.notice { background: var(--wb-notice-bg); color: var(--wb-notice-text); border: 1px solid var(--wb-notice-border); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.notice button.txt { color: inherit; }
.klc-copyable { cursor: pointer; padding: 0 5px; border-radius: 6px; background: var(--wb-copy-bg); color: var(--wb-copy-text); display: inline-block; }
.undo-review { margin-top: 8px; }
.disagree { margin-top: 8px; }
.disagree > summary { cursor: pointer; font-size: 11.5px; color: var(--wb-muted); }
.disagree .review-actions { margin: 6px 0; }
.footer { flex-shrink: 0; padding: 6px 14px; background: var(--wb-surface); border-top: 1px solid var(--wb-border); display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; color: var(--wb-muted); white-space: nowrap; }
.footer #modeBanner { overflow: hidden; text-overflow: ellipsis; }
.version-line.newer { color: var(--wb-danger); font-weight: 700; }
.rz { display: flex; align-items: center; justify-content: center; width: 100%; height: 14px; padding: 0; background: var(--wb-surface); border: none; border-top: 1px solid var(--wb-border); border-radius: 0 0 16px 16px; cursor: ns-resize; touch-action: none; }
.rz::before { content: ""; width: 44px; height: 4px; border-radius: 2px; background: #b6bcc8; }
.rz:hover::before, .rz:focus-visible::before { background: var(--wb-text); }
/* Not inside the scrolling body, so a short panel never clips the menu. */
.pop { position: absolute; top: 44px; right: 8px; z-index: 9; min-width: 230px; max-width: calc(100% - 16px); box-sizing: border-box; overflow-y: auto; background: var(--wb-surface); border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,0.3), 0 0 0 1px rgba(15,23,42,0.08); padding: 5px; display: flex; flex-direction: column; }
.pop > * { flex-shrink: 0; }
.pop .ms { height: 1px; background: var(--wb-border); margin: 4px 0; }
.pop .mn { color: var(--wb-muted); font-size: 11.5px; padding: 4px 9px; }
.pop .mn:empty { display: none; }
.pop .mi { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border: none; background: none; border-radius: 8px; width: 100%; box-sizing: border-box; font-size: 12.5px; font-weight: 500; color: var(--wb-text); text-align: left; cursor: pointer; }
.pop .mi:hover, .pop .mi:focus-visible, .pop .mi:focus-within { background: var(--wb-border-soft); outline: none; box-shadow: none; }
.pop .mi.danger { color: var(--wb-danger); font-weight: 700; }
.pop .mi[aria-checked="true"] { font-weight: 700; }
.pop .mi input { margin: 0; width: 14px; height: 14px; accent-color: #1c1c1e; }
@media (prefers-reduced-motion: reduce) {
.progress-fill.active { animation: none; background-image: none; }
*, *::before, *::after { transition: none !important; animation: none !important; }
}
</style>
<div class="panel">
<div class="header" id="headerEl">
<div class="header-title"><span class="name">Lead Checker</span><span class="sub" id="headerSub">No batch</span></div>
<button type="button" id="moreBtn" title="More actions" aria-haspopup="menu" aria-expanded="false">${svgIcon('more', 14)}More</button>
</div>
<div class="strip" id="linkLine" role="status" aria-live="polite"></div>
<div class="bodyEl" id="bodyEl">
<div class="notice-bar hidden" id="noticeBar" role="status" aria-live="polite"></div>
<details class="topSection" id="topSection">
<summary title="Open or close the paste box"><span>Paste a batch by hand</span>${detailsChevronIcon()}</summary>
<div class="topSection-content">
<textarea id="pasteBox" aria-label="Batch to check, pasted from SLA Manager" placeholder="Paste a batch from SLA Manager, a National batch, or the customer search table for Post Closure leads"></textarea>
<div class="bar">
<button type="button" class="btn" id="btnPasteClipboard">${svgIcon('paste', 12)}Paste from clipboard</button>
<button type="button" class="btn" id="btnStartFold" disabled>${svgIcon('play', 11)}Start</button>
<span class="grow"></span>
<span class="chip" id="rowCount">0 rows</span>
</div>
<div class="row-error hidden" id="rowError"></div>
</div>
</details>
<div class="status hidden" id="statusCard">
<div class="bar" id="runControls">
<b class="grow" id="statusHeadline"></b>
<button type="button" class="btn hidden" id="btnReview" title="Opens the leads that need your decision"></button>
<button type="button" class="btn" id="btnStart">${svgIcon('play', 11)}Start</button>
<button type="button" class="btn" id="btnPauseResume">${svgIcon('pause', 11)}Pause</button>
<button type="button" class="btn" id="btnCancel">${svgIcon('x', 11)}Cancel</button>
<button type="button" class="btn" id="btnRetryExceptions" title="Checks again the leads that could not be checked"></button>
</div>
<div class="progress-track"><div class="progress-fill" id="progressFill" style="width: 0%;"></div></div>
<div class="small" id="curState">Idle</div>
<div class="small hidden" id="curLine"><span id="curCustomer">-</span><span id="curTargetPart"><span id="curTargetLabel">Lead created</span>: <span id="curTarget">-</span></span></div>
<div class="stats-bar hidden" id="statsBar"></div>
<div class="hint-line hidden" id="hintLine"></div>
<button type="button" class="txt hidden" id="btnRecent" aria-expanded="false">Recent activity</button>
<div class="recent-log hidden" id="recentLog"></div>
</div>
<div id="needsReviewSection"></div>
<div class="filter-bar hidden" id="filterBar">
<input type="text" class="search-input" id="searchInput" aria-label="Filter results by name" placeholder="Filter by name">
</div>
<div id="resultsBody"></div>
</div>
<div class="footer"><span id="modeBanner" role="status" aria-live="polite"></span><span class="version-line" id="versionLine" aria-live="polite"></span></div>
<button type="button" class="rz" id="resizeGrip" title="Drag to resize. Arrow keys also work" aria-label="Resize the panel height"></button>
<div class="pop hidden" id="moreMenu" role="menu" aria-label="More actions">
${menuItem('minBtn', 'minimize', 'Hide the panel', ' data-close')}
<div class="ms"></div>
${menuItem('menuPasteByHand', 'paste', 'Paste a batch by hand', ' data-close')}
${menuItem('btnClearPasteStart', 'trash', 'Clear and paste to start', ' title="Replaces this batch with the one on the clipboard and starts it"')}
${menuItem('btnProcessNext', 'play', 'Check one lead', ' data-close title="Checks the next lead, then stops"')}
${menuItem('menuRetry', 'refresh', 'Retry failed leads', ' title="Checks again the leads that could not be checked"')}
<label class="mi"><input type="checkbox" id="autoStartToggle"><span>Start by itself on paste</span></label>
<div class="ms"></div>
${menuItem('btnCopyRawForExtract', 'copy', 'Copy results for SLA Manager')}
${menuItem('btnCopyNationalResults', 'copy', 'Copy National results for SLA Manager')}
${menuItem('btnCopyReviewDecisions', 'copy', 'Copy review decisions', ' title="Copies the decisions made by hand, with no customer details, for writing new rules"')}
${menuItem('menuRecent', 'clock', 'Recent activity')}
<div class="ms"></div>
${menuItem('', 'shrink', 'Height: compact', ' data-height="300"')}
${menuItem('', 'list', 'Height: default', ' data-height="0"')}
${menuItem('', 'expand', 'Height: tall', ' data-height="700"')}
<div class="ms"></div>
${menuItem('menuSmallWindow', 'shrink', 'Small window: on', ' title="When on, Work Tools opens the Lead Checker in its own small window, which keeps a check running while you work in other tabs. Takes effect the next time Work Tools is clicked on Konnect Live."')}
${menuItem('btnReport', 'flag', 'Report a problem', ' data-close')}
<button type="button" class="mi danger" role="menuitem" id="btnClearStop" title="Stops the check, clears this Lead Checker's batch and results, and closes the panel. Nothing in SLA Manager or Lead Re setup is cleared.">${svgIcon('stop', 14)}<span>Clear &amp; Stop</span></button>
<div class="mn" id="menuVersion"></div>
</div>
</div>
`;
return { host, root };
}

function escapeHtmlForUi(value) {
return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Synchronous execCommand first; the async Clipboard API can be blocked.
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
// innerHTML, not textContent, so the icon survives.
const original = button.innerHTML;
const originalColor = button.style.color;
button.textContent = text;
button.style.color = readableTextColor(isError ? '#dc2626' : '#059669');
setTimeout(() => {
button.innerHTML = original;
button.style.color = originalColor;
}, 1500);
}

function initKonnectLeadCheckerUI() {
const { host, root } = buildPanelMarkup();

const pasteBox = root.getElementById('pasteBox');
const rowCountEl = root.getElementById('rowCount');
const rowErrorEl = root.getElementById('rowError');
const curCustomerEl = root.getElementById('curCustomer');
const curTargetEl = root.getElementById('curTarget');
const curStateEl = root.getElementById('curState');
const curLineEl = root.getElementById('curLine');
const curTargetPartEl = root.getElementById('curTargetPart');
const modeBannerEl = root.getElementById('modeBanner');
const versionLineEl = root.getElementById('versionLine');
const menuVersionEl = root.getElementById('menuVersion');
const versionState = startVersionWatch('Konnect-Lead-Checker.js', () => render());
const headerSubEl = root.getElementById('headerSub');
const bodyEl = root.getElementById('bodyEl');
const statusCardEl = root.getElementById('statusCard');
const statusHeadlineEl = root.getElementById('statusHeadline');
const progressFillEl = root.getElementById('progressFill');
const statsBarEl = root.getElementById('statsBar');
const filterBarEl = root.getElementById('filterBar');
const searchInputEl = root.getElementById('searchInput');
const resultsBody = root.getElementById('resultsBody');
const needsReviewSectionEl = root.getElementById('needsReviewSection');
const minBtn = root.getElementById('minBtn');
const moreBtn = root.getElementById('moreBtn');
const moreMenuEl = root.getElementById('moreMenu');
const headerEl = root.getElementById('headerEl');
const recentLogEl = root.getElementById('recentLog');
const btnRecentEl = root.getElementById('btnRecent');
const noticeBarEl = root.getElementById('noticeBar');
const autoStartToggle = root.getElementById('autoStartToggle');
autoStartToggle.checked = loadSettings().autoStart;

// The technical reason for a log out folds behind "Why am I seeing this?".
let loginWhyOpen = false;
let lastNoticesHtml = '';
function renderNotices() {
const messages = [];
const loggedOutWhy = lcNotices.loggedOut && lcNotices.stopped ? /^Konnect Live logged out: (.+)\. Press Login and the check carries on\.$/.exec(lcNotices.stopped) : null;
if (!loggedOutWhy) loginWhyOpen = false;
if (lcNotices.selfTestFailures.length > 0) messages.push('Self-test failed: classifications may be wrong. Check the console.');
if (lcNotices.stopped && !loggedOutWhy) messages.push(lcNotices.stopped);
if (lcNotices.saveFailed) messages.push("Progress could not be saved in this browser. Don't reload the page until this batch is finished.");
if (lcNotices.otherTab) messages.push('Another tab changed this batch. Use one Lead Checker tab at a time, then reopen this one to see its changes.');
if (versionState.newer) messages.push(versionLineText(versionState));
let html = messages.map((m) => `<div class="notice">${escapeHtmlForUi(m)}</div>`).join('');
if (loggedOutWhy) {
const why = loggedOutWhy[1].charAt(0).toUpperCase() + loggedOutWhy[1].slice(1);
html = `<div class="notice"><b>Press Login on Konnect Live</b><span>The check carries on by itself once you are back in. Nothing has been lost.</span><button type="button" class="txt" id="btnLoginWhy" aria-expanded="${loginWhyOpen}">Why am I seeing this?</button>${loginWhyOpen ? `<span>${escapeHtmlForUi(why)}.</span>` : ''}</div>` + html;
}
// Left alone when nothing changed, so focus on the Why button survives a redraw.
if (html !== lastNoticesHtml) {
lastNoticesHtml = html;
noticeBarEl.innerHTML = html;
}
noticeBarEl.classList.toggle('hidden', !html);
}
noticeBarEl.addEventListener('click', (event) => {
if (!event.target || event.target.id !== 'btnLoginWhy') return;
loginWhyOpen = !loginWhyOpen;
renderNotices();
const again = root.getElementById('btnLoginWhy');
if (again) again.focus();
});

lcNotices.onChange = () => {
if (lcNotices.stopped && session && session.paused) {
curStateEl.textContent = 'Stopped';
setPauseResumeLabel('Resume');
hidePageFlashOverlay();
}
render();
};

// Storage events only fire for changes made by another tab. The notice
// goes when a new batch is loaded here.
const onStorage = (event) => {
if (event.key === SESSION_STORAGE_KEY && event.newValue !== lastSavedSessionJson) {
lcNotices.otherTab = true;
notifyNoticesChanged();
}
};
window.addEventListener('storage', onStorage);
let destroyed = false;
let badgeTimer = null;
let batchWaitTimer = null;

const linkLineEl = root.getElementById('linkLine');
const hintLineEl = root.getElementById('hintLine');
const curTargetLabelEl = root.getElementById('curTargetLabel');
const btnStartEl = root.getElementById('btnStart');
const btnStartFoldEl = root.getElementById('btnStartFold');
const btnReviewEl = root.getElementById('btnReview');
const btnProcessNextEl = root.getElementById('btnProcessNext');
const btnCancelEl = root.getElementById('btnCancel');
const btnRetryExceptionsEl = root.getElementById('btnRetryExceptions');
const btnCopyRawForExtractEl = root.getElementById('btnCopyRawForExtract');
const btnCopyNationalResultsEl = root.getElementById('btnCopyNationalResults');
const pauseResumeBtn = root.getElementById('btnPauseResume');
const topSectionEl = root.getElementById('topSection');

function focusPanel() {
const shown = (el) => !el.classList.contains('hidden') && !statusCardEl.classList.contains('hidden');
const target = topSectionEl.open ? pasteBox : [btnStartEl, pauseResumeBtn, btnReviewEl].find(shown);
try { (target || moreBtn).focus(); } catch (error) { /* ignore */ }
}

function wireBadgeClick() {
badge.clickTarget.addEventListener('click', () => {
host.style.display = 'block';
badge.hide();
focusPanel();
});
}

let badge = buildBadge();
badge.show();
wireBadgeClick();

// Angular re-renders of the nav don't preserve an injected element.
let badgeNavState = '';
function ensureBadgeAttached() {
const panelCurrentlyOpen = host.style.display === 'block';
const navItem = document.getElementById(KLC_NAV_ITEM_ID);
// Work Tools' Alt+H hides the button on purpose.
if (document.getElementById('_workToolsHideStyle') && (navItem || document.getElementById(KLC_BADGE_ID))) return;
// The item is in the bar: it stays unless the bar has stopped showing it
// (the window was made narrow).
if (navItem && (panelCurrentlyOpen || inWindowView(badge.clickTarget))) return;
// A floating button moves into Konnect's menu bar once the bar appears
// or the window changes width. Tried once for each such change.
const fallback = document.getElementById(KLC_BADGE_ID);
const navState = `${konnectNavReady()}|${window.innerWidth}`;
if (fallback && (!konnectNavReady() || navState === badgeNavState)) return;
badgeNavState = navState;
badge = buildBadge();
wireBadgeClick();
if (panelCurrentlyOpen) badge.hide(); else badge.show();
if (session) updateBadgeProgress(badge, orderedResults(session), session);
}

// Empty set means no filter. The name filter is transient, so not persisted.
const activeCategoryFilters = new Set();
let nameFilterText = '';

let session = loadStoredSession();
// Shown until the batch is started or replaced.
let restoredNote = '';
if (session) {
pasteBox.value = session.rawInput || '';
// The page has reloaded, so no customer is open any more.
session.rowInGroupIndex = 0;
const checked = Object.keys(session.results).length;
if (session.headerOk && session.rows.length > 0) {
restoredNote = session.done
? `Restored after the page reloaded: all ${session.rows.length} leads were checked.`
: `Restored after the page reloaded: ${checked} of ${session.rows.length} checked. Press Start to carry on, or use Clear and paste to start (in More) for a new batch.`;
}
}

// Every group starts open, Could not check (7) included.
const detailsState = { tiers: new Set([-2, -1, 1, 2, 3, 4, 5, 6, 7]), customers: new Set() };
// Needs review takes the place of the results while it is open. One card
// is open at a time; a card decided on this visit stays, in green, so the
// Why can be added or the answer changed.
let reviewMode = false;
let reviewOpenKey = null;
const reviewTiersOpen = new Set();
const reviewDecided = new Set();
const reviewTyped = new Map();
let recentOpen = false;

// Opening a customer by hand from the initials on a result. openInFlight
// is the press being worked ({ key, token }); openNote is what the state
// line says about it. A refusal is shown for a few seconds (openNoteUntil),
// an outcome until the next run or batch.
let openInFlight = null;
let openNote = '';
// What the note is about: 'lead' (customer and lead open), 'timeline'
// (customer only) or '' (still opening, or not opened).
let openNoteOpened = '';
let openNoteUntil = 0;
// The result the note is about, so it also shows on that row or card: the
// state line can be scrolled out of sight.
let openNoteKey = null;
const LOGGED_OUT_NOTE = 'Konnect Live is logged out. Log in, then try again.';
const RUN_BUSY_NOTE = 'The Lead Checker is checking a batch. Pause it or wait, then try again.';
const LOGGING_IN_NOTE = 'Konnect Live is logged out. Logging in: click once on this window if it waits.';

function stopManualOpen() {
if (openInFlight) { openInFlight.token.cancelled = true; openInFlight = null; }
openNote = '';
openNoteOpened = '';
openNoteUntil = 0;
}

// Called at the end of every render, after the usual state label is set.
function showOpenNote() {
if (openNote && (openNoteUntil || (!(isRunning && !(session && session.paused)) && !manualStepBusy))) curStateEl.textContent = openNote;
}

// Why the page cannot be driven by hand just now, or '' when it can.
function pageBusyReason() {
if ((isRunning && !(session && session.paused)) || manualStepBusy || batchChangesWaiting > 0) return RUN_BUSY_NOTE;
if (klcShared.stepBusy && !openInFlight) return 'The lead being checked is still finishing. Try again in a moment.';
if (onLoginPage()) return LOGGED_OUT_NOTE;
return '';
}

function refuseManualOpen(text) {
openNote = text;
openNoteOpened = '';
openNoteUntil = Date.now() + 5000;
setTimeout(() => { if (!destroyed) render(); }, 5100);
render();
return { ok: false, lead: false, text };
}

// Opens one row's customer and lead on the page, for the initials button
// and for SLA Manager's request alike. Refused while a run or Check one
// lead is working. Holds the step lock while it drives the page, so it
// never runs beside a run step, and a newer request replaces this one
// rather than running with it. Changes no result and no position in the
// batch. Resolves to { ok, lead, text }; text is what the state line says.
// For a single request (open a customer, check a booking) that finds the
// page logged out: logs back in, giving the owner a short while to touch
// the window if the password is not there yet. True once the page is in.
async function logInForRequest() {
if (!onLoginPage()) return true;
openNote = LOGGING_IN_NOTE;
openNoteUntil = 0;
render();
const until = Date.now() + (klcShared.loginForRequestMs || 20000);
while (Date.now() < until && onLoginPage()) { pressLoginWhenFilled(); await sleep(500); }
if (onLoginPage()) return false;
await sleep(klcShared.loginForRequestMs ? 300 : 1500);
return true;
}

async function openRowByHand(key, row, group, result) {
let reply = await openRowByHandOnce(key, row, group, result);
// Logged out, often found only part way (the page shows it once it is
// used): log in, then open it again. One wait, then it says to log in.
if (reply.text === LOGGED_OUT_NOTE) {
if (await logInForRequest()) reply = await openRowByHandOnce(key, row, group, result);
else { openNote = LOGGED_OUT_NOTE; render(); }
}
return reply;
}
async function openRowByHandOnce(key, row, group, result) {
const s = session;
if (destroyed) return { ok: false, lead: false, text: '' };
openNoteKey = key;
const busy = pageBusyReason();
if (busy) return refuseManualOpen(busy);
if (openInFlight) { openInFlight.token.cancelled = true; openInFlight.token.replaced = true; }
const mine = { key, token: { cancelled: false, loggedOut: false, replaced: false } };
// Said when something else took the page before this one finished.
const gaveWay = () => ({ ok: false, lead: false, text: mine.token.loggedOut ? LOGGED_OUT_NOTE : (mine.token.replaced ? 'Another customer was opened instead.' : RUN_BUSY_NOTE) });
openInFlight = mine;
openNote = `Opening ${row.name || 'the customer'}...`;
openNoteOpened = '';
openNoteUntil = 0;
render();
while (klcShared.stepBusy) await sleep(50);
if (mine.token.cancelled || destroyed) return gaveWay();
klcShared.stepBusy = true;
pageMovedByHand = true;
// A search on the login page would wait out every time limit, so a log
// out ends the attempt and is said straight away.
const loginWatch = setInterval(() => {
if (!onLoginPage() || mine.token.cancelled) return;
mine.token.cancelled = true;
mine.token.loggedOut = true;
if (openInFlight === mine) { openInFlight = null; openNote = LOGGED_OUT_NOTE; render(); }
}, 300);
let outcome;
try {
// A lead window left open by an earlier request.
await closeLeadModal();
outcome = await openRowOnPage(group, row, result, mine.token);
} catch (error) {
console.error('KonnectLeadChecker: the customer could not be opened:', errorText(error));
outcome = { status: 'ERROR' };
} finally {
clearInterval(loginWatch);
klcShared.stepBusy = false;
}
if (mine.token.cancelled || destroyed) return gaveWay();
openInFlight = null;
const loggedOut = onLoginPage();
openNote = loggedOut ? LOGGED_OUT_NOTE : openOutcomeText(row, outcome);
openNoteOpened = loggedOut ? '' : (outcome.status === 'OPEN' ? 'lead' : (outcome.status === 'TIMELINE_ONLY' ? 'timeline' : ''));
render();
return { ok: !loggedOut && (outcome.status === 'OPEN' || outcome.status === 'TIMELINE_ONLY'), lead: !loggedOut && outcome.status === 'OPEN', text: openNote };
}

// The initials on a result. A second press on the same one while it is
// opening does nothing.
function openCustomerFromPanel(key) {
const s = session;
const row = s ? s.rows.find((r) => r.inputIndex === key) : null;
if (!row || (openInFlight && openInFlight.key === key)) return;
const group = s.groups.find((g) => g.rows.some((r) => r.inputIndex === key)) || { rows: [row] };
openRowByHand(key, row, group, s.results[key] || null);
}

// SLA Manager asking for one customer to be opened. The row has a batch
// row's fields and need not be in the batch loaded here. Answered once.
let linkOpenCount = 0;
function openCustomerFromLink(data) {
const given = data.row && typeof data.row === 'object' ? data.row : {};
const cell = (name) => String(given[name] == null ? '' : given[name]).replace(/[\t\r\n]+/g, ' ').trim();
const fields = ['name', 'phone', 'email', 'source', 'campaign', 'created'].map(cell);
const row = parseBatchInput(`${EXPECTED_BATCH_HEADER.join('\t')}\n${fields.join('\t')}`).rows[0];
const answer = (reply) => linkPost(Object.assign({ type: 'workTools:opened' }, data.id == null ? {} : { id: data.id }, reply));
if (!row || !fields.slice(0, 3).some(Boolean)) { answer({ ok: false, lead: false, text: 'No customer was given to open.' }); return; }
openRowByHand(`link:${++linkOpenCount}`, row, { rows: [row] }, null)
.then(answer, () => answer({ ok: false, lead: false, text: `${row.name || 'The customer'} could not be opened: the tool hit an error.` }));
}

// SLA Manager asking whether a booking is in the diary, has its outcome and
// has gone to the dealership. Refused as an open is, but without a word on
// the state line, since nobody pressed anything; a customer being opened
// by hand is not interrupted either. Holds the step lock and gives way to
// a run or an open like an open does. Changes no result. Answered once.
let linkVerifyCount = 0;
async function verifyBooking(row, since) {
let reply = await verifyBookingOnce(row, since);
if (reply.text === LOGGED_OUT_NOTE) {
if (await logInForRequest()) reply = await verifyBookingOnce(row, since);
else { openNote = LOGGED_OUT_NOTE; render(); }
}
return reply;
}
async function verifyBookingOnce(row, since) {
const no = (text) => ({ ok: false, found: false, appointment: false, outcome: false, sent: false, text });
if (destroyed) return no('');
const busy = pageBusyReason();
if (busy) return no(busy);
if (openInFlight || klcShared.stepBusy) return no('A customer is being opened on Konnect Live. Try again in a moment.');
const mine = { key: `verify:${++linkVerifyCount}`, token: { cancelled: false, loggedOut: false, replaced: false } };
const gaveWay = () => no(mine.token.loggedOut ? LOGGED_OUT_NOTE : (mine.token.replaced ? 'A customer was opened by hand instead. Try again in a moment.' : RUN_BUSY_NOTE));
openInFlight = mine;
openNoteKey = mine.key;
openNote = `Checking the booking for ${row.name || 'the customer'}...`;
openNoteOpened = '';
openNoteUntil = 0;
render();
klcShared.stepBusy = true;
pageMovedByHand = true;
const loginWatch = setInterval(() => {
if (!onLoginPage() || mine.token.cancelled) return;
mine.token.cancelled = true;
mine.token.loggedOut = true;
if (openInFlight === mine) { openInFlight = null; openNote = LOGGED_OUT_NOTE; render(); }
}, 300);
let outcome;
try {
await closeLeadModal();
outcome = await verifyBookingOnPage({ rows: [row] }, since, mine.token);
} catch (error) {
console.error('KonnectLeadChecker: the booking could not be checked:', errorText(error));
outcome = { status: 'ERROR' };
} finally {
clearInterval(loginWatch);
klcShared.stepBusy = false;
}
if (mine.token.cancelled || destroyed) return gaveWay();
openInFlight = null;
let reply;
if (onLoginPage()) reply = no(LOGGED_OUT_NOTE);
else if (outcome.status === 'READ') {
const found = { appointment: outcome.appointment, outcome: outcome.outcome, sent: outcome.sent };
reply = Object.assign({ ok: true, found: true }, found, { text: bookingCheckText(row.name, found) });
} else if (outcome.status === 'NO_CUSTOMER') reply = no(openOutcomeText(row, outcome).replace('could not be opened', 'could not be checked'));
else reply = no(`${row.name || 'The customer'} could not be checked: the tool hit an error.`);
// Shown briefly: it is not something the owner asked this page for.
openNote = reply.text;
openNoteUntil = Date.now() + 5000;
setTimeout(() => { if (!destroyed) render(); }, 5100);
render();
return reply;
}

function verifyBookingFromLink(data) {
const given = data.row && typeof data.row === 'object' ? data.row : {};
const cell = (name) => String(given[name] == null ? '' : given[name]).replace(/[\t\r\n]+/g, ' ').trim();
const fields = ['name', 'phone', 'email'].map(cell);
const row = parseBatchInput(`${EXPECTED_BATCH_HEADER.join('\t')}\n${fields.concat(['', '', '']).join('\t')}`).rows[0];
const answer = (reply) => linkPost(Object.assign({ type: 'workTools:verified' }, data.id == null ? {} : { id: data.id }, reply));
const no = (text) => answer({ ok: false, found: false, appointment: false, outcome: false, sent: false, text });
if (!row || !fields.some(Boolean)) { no('No customer was given to check.'); return; }
if (isNaN(Date.parse(String(data.since || '')))) { no('No booking time was given to check.'); return; }
verifyBooking(row, String(data.since)).then(answer, () => no(`${row.name || 'The customer'} could not be checked: the tool hit an error.`));
}

// Capture phase, so a press on the initials never reaches the row around
// them (which would fold it open or shut).
[resultsBody, needsReviewSectionEl].forEach((container) => {
container.addEventListener('click', (event) => {
const btn = event.target && event.target.closest ? event.target.closest('.avatar-btn') : null;
if (!btn) return;
event.stopPropagation();
openCustomerFromPanel(Number(btn.dataset.openKey));
}, true);
container.addEventListener('keydown', (event) => {
const onAvatar = event.target && event.target.closest && event.target.closest('.avatar-btn');
if (onAvatar && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation();
}, true);
});

function copyableField(value) {
if (!value) return '';
const display = escapeHtmlForUi(value);
return `<span class="klc-copyable" role="button" tabindex="0" aria-label="Copy ${display}" data-value="${display}">${display}</span>`;
}

function initialsForKlc(name) {
const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
if (parts.length === 0) return '?';
if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
return (parts[0][0] + parts[1][0]).toUpperCase();
}

// The initials are a button that opens the customer on the page, filled
// with categoryColor(r) so they agree with the group heading.
function avatarButton(r, colorHex) {
const label = escapeHtmlForUi(`Open ${r.name || 'this customer'} on Konnect Live`);
const busy = !!openInFlight && openInFlight.key === r.inputIndex;
return `<button type="button" class="avatar-btn${busy ? ' opening' : ''}" data-open-key="${r.inputIndex}" title="${label}" aria-label="${label}"${busy ? ' aria-busy="true"' : ''} style="background: ${readableTextColor(colorHex)};">${escapeHtmlForUi(initialsForKlc(r.name))}</button>`;
}

// A blue tag on the result whose customer is open on the page.
function openTagHtml(r) {
if (!openNote || openNoteKey !== r.inputIndex || !openNoteOpened) return '';
return '<span class="tag info">Open now</span>';
}

// The words under the name while it opens, when only the timeline opened,
// or when it could not be opened. A full open is said by the tag alone.
function openNoteHtml(r) {
if (!openNote || openNoteKey !== r.inputIndex || openNoteOpened === 'lead') return '';
return `<span class="open-note" role="status">${escapeHtmlForUi(openNote)}</span>`;
}

// Lets a checked lead be corrected by hand; the correction goes into
// Copy review decisions for writing new rules.
function disagreeHtml(r) {
const choices = r.postClosureAction
? [['send back through', 'Actioned by dealership'], ['send back through', 'Email only'], ['send back through', "In market won't commit"], ['check: needs contact?', '']]
.filter(([action, reason]) => !(action === r.postClosureAction && reason === (r.postClosureReason || '')))
.map(([action, reason]) => `<button type="button" class="btn" data-pc-action="${escapeHtmlForUi(action)}" data-pc-reason="${escapeHtmlForUi(reason)}">${escapeHtmlForUi(reason ? `Send back: ${reason}` : 'Needs a call')}</button>`).join('')
: REVIEW_TIER_OPTIONS.filter((tier) => tier !== r.tier).map(tierChipButton).join('');
return `<details class="disagree" data-key="${r.inputIndex}"><summary>Disagree</summary>
<div class="review-actions" role="group" aria-label="Correct the result for ${escapeHtmlForUi(r.name)}">${choices}</div>
<input type="text" class="review-reason" aria-label="Why (optional)" placeholder="Why (optional): helps me add a rule">
</details>`;
}

function tierChipButton(tier) {
return `<button type="button" class="chip" data-tier="${tier}" title="${escapeHtmlForUi(tierHeading(tier))}" style="--tc: ${TIER_COLORS[tier]};">${escapeHtmlForUi(TIER_SHORT[tier])}</button>`;
}

function customerBodyHtml(r) {
const pairs = [];
if (r.phone) pairs.push(['Phone', copyableField(r.phone)]);
if (r.email) pairs.push(['Email', copyableField(r.email)]);
pairs.push(['Campaign', escapeHtmlForUi(r.campaign || '-')]);
pairs.push(['Source', escapeHtmlForUi(r.source || '-')]);
pairs.push(['Created', escapeHtmlForUi(r.created || '-')]);
if (r.flags && r.flags.length > 0) pairs.push(['Flags', escapeHtmlForUi(r.flags.join(', '))]);
if (r.postClosureAction) {
pairs.push(['Post Closure', `<span style="color: ${readableTextColor(postClosureColor(r.postClosureAction))}; font-weight: 700;">${escapeHtmlForUi(postClosureLabel(r))}</span>`]);
if (r.postClosureEvidence) pairs.push(['Why', escapeHtmlForUi(r.postClosureEvidence)]);
} else if (r.tier) {
pairs.push(['Tier', escapeHtmlForUi(tierHeading(r.tier) + (r.subCategory ? `, ${r.subCategory}` : ''))]);
}
const parts = [kvHtml(pairs)];
if (r.reason) parts.push(`<div class="reason">${escapeHtmlForUi(r.reason)}</div>`);
if (r.initialNotes) parts.push(`<div class="notes-block">${escapeHtmlForUi(r.initialNotes)}</div>`);
if (r.manualOverride && r.preDecision) parts.push(`<button type="button" class="btn undo-review" data-undo-key="${r.inputIndex}">Undo review decision</button>`);
else if (r.status === 'CLASSIFIED' && (r.tier || r.postClosureAction)) parts.push(disagreeHtml(r));
else if (r.status === 'EXCEPTION') parts.push(`<div class="reason" title="${escapeHtmlForUi(r.exception || '')}">No Initial Notes read: ${escapeHtmlForUi(exceptionLabel(r.exception))}</div>`);
return parts.join('');
}

// One result in the normal and Post Closure checks. The group heading
// says the tier, so the row carries the sub-category or the reason.
function standardRowHtml(r) {
const color = categoryColor(r);
let tag = '';
let meta = r.subCategory || '';
if (r.exception) {
tag = tagHtml('Failed', color, r.exception);
meta = exceptionLabel(r.exception);
} else if (r.postClosureAction) {
const sendBack = r.postClosureAction === 'send back through';
const shorthand = SEND_BACK_SHORTHAND[r.postClosureReason];
tag = tagHtml(sendBack ? `Send back${shorthand ? ` · ${shorthand}` : ''}` : 'Check', color, postClosureLabel(r));
meta = [sendBack ? r.postClosureReason : 'Needs contact?', r.postClosureEvidence].filter(Boolean).join(' · ');
} else if (!r.tier) {
meta = meta || 'Pending';
}
return resultRowHtml({
key: r.inputIndex, open: detailsState.customers.has(r.inputIndex), avatar: avatarButton(r, color), name: r.name,
title: r.initialNotes || 'No Initial Notes read yet.', tag, meta, openTag: openTagHtml(r), note: openNoteHtml(r), body: customerBodyHtml(r)
});
}

// Same priority order as the groups.
const STATS_BAR_CATEGORY_ORDER = ['POST CLOSURE: SEND BACK', 'POST CLOSURE: CHECK'].concat([1, 2, 3, 4, 5, 6].map((t) => TIER_NAMES[t])).concat(['EXCEPTION']);

function decideReview(key, tier, subCategoryText, note) {
const result = session && session.results[key];
if (!result) return;
session.results[key] = applyManualReviewDecision(result, tier, subCategoryText, note);
saveSession(session);
linkResendAfterDecision();
}

function leaveReview() {
reviewMode = false;
reviewOpenKey = null;
reviewTiersOpen.clear();
reviewDecided.clear();
reviewTyped.clear();
}

// Returns true while the review view is showing.
function renderNeedsReviewSection(orderedAll) {
const list = reviewMode ? orderedAll.filter((r) => isNeedsReview(r) || (reviewDecided.has(r.inputIndex) && r.manualOverride)) : [];
if (list.length === 0) {
if (reviewMode) leaveReview();
needsReviewSectionEl.innerHTML = '';
return false;
}
// A redraw must not lose text typed in a card or the box being typed in.
const active = root.activeElement;
const typingIn = active && active.tagName === 'INPUT' && active.closest('.review-row')
? { key: active.closest('.review-row').dataset.key, cls: active.className, at: active.selectionStart } : null;
needsReviewSectionEl.querySelectorAll('.review-row').forEach((rowEl) => {
const kept = reviewTyped.get(rowEl.dataset.key) || {};
const sub = rowEl.querySelector('.review-subcategory');
const why = rowEl.querySelector('.review-reason');
if (sub) kept.sub = sub.value;
if (why) kept.why = why.value;
reviewTyped.set(rowEl.dataset.key, kept);
});
const waiting = list.filter(isNeedsReview);
if (!waiting.some((r) => r.inputIndex === reviewOpenKey)) reviewOpenKey = waiting.length > 0 ? waiting[0].inputIndex : null;
const rowsHtml = list.map((r) => {
const name = escapeHtmlForUi(r.name);
const head = (tag) => `<div class="review-head">${avatarButton(r, categoryColor({ tier: r.tier }))}<b class="review-name grow">${name}</b>${tag}</div>`;
if (!isNeedsReview(r)) {
const sub = r.subCategory && r.subCategory !== '(manually reviewed)' ? `, ${r.subCategory}` : '';
return `
<div class="review-row decided" data-key="${r.inputIndex}">
${head('<span class="tag ok">Decided</span>')}
${openNoteHtml(r)}
<b>Decided: ${escapeHtmlForUi(tierHeading(r.tier) + sub)}</b>
<input type="text" class="review-reason" aria-label="Why for ${name} (optional)" placeholder="Why (optional): helps refine the rules later">
<button type="button" class="txt" data-change-answer>Change my answer</button>
</div>`;
}
const needsTag = '<span class="tag warn">Needs review</span>';
if (r.inputIndex !== reviewOpenKey) {
return `
<div class="review-row folded" data-key="${r.inputIndex}" role="button" tabindex="0" aria-expanded="false">
${head(needsTag)}
${openNoteHtml(r)}
<span class="customer-meta">${escapeHtmlForUi(r.reason || 'Open to decide')}</span>
</div>`;
}
const tiersOpen = !r.tierName || reviewTiersOpen.has(r.inputIndex);
const choose = tiersOpen ? `
<span class="lbl">Change tier to</span>
<div class="review-actions review-tiers" role="group" aria-label="Choose a tier for ${name}">${REVIEW_TIER_OPTIONS.map(tierChipButton).join('')}</div>
<input type="text" class="review-subcategory" aria-label="Sub-category for ${name} (optional)" placeholder="Sub-category (optional), for example Website Test Drive">
${r.tierName ? '<button type="button" class="txt" data-hide-tiers>Back to the suggestion</button>' : ''}` : `
<div class="review-actions review-quick" role="group" aria-label="Quick decision for ${name}">
<button type="button" class="btn pri accept" data-tier="${r.tier}" data-subcategory="${escapeHtmlForUi(r.subCategory || '')}" title="Accept ${escapeHtmlForUi(tierHeading(r.tier))}">Accept</button>
<button type="button" class="btn" data-show-tiers>Change tier</button>
${r.alternative ? `<button type="button" class="btn" data-tier="${r.alternative.tier}" data-subcategory="${escapeHtmlForUi(r.alternative.subCategory || '')}" title="No call: ${escapeHtmlForUi(tierHeading(r.alternative.tier))}, ${escapeHtmlForUi(r.alternative.subCategory || '')}">No call</button>` : ''}
</div>`;
return `
<div class="review-row open" data-key="${r.inputIndex}">
${head(needsTag)}
${openNoteHtml(r)}
<div class="quote review-notes">${escapeHtmlForUi(r.initialNotes || '')}</div>
${r.tierName ? `<div class="small">Suggested: ${tagHtml(tierHeading(r.tier), TIER_COLORS[r.tier] || '#64748b')}${r.subCategory ? ` (${escapeHtmlForUi(r.subCategory)})` : ''}. ${escapeHtmlForUi(r.reason || '')}</div>` : ''}
${choose}
</div>`;
}).join('');
needsReviewSectionEl.innerHTML = `
<div class="bar"><b class="grow">Needs review</b><span class="chip warn">${waiting.length > 0 ? `${waiting.length} left` : 'All decided'}</span><button type="button" class="btn" id="btnBackToResults">Back to results</button></div>
<div class="review-rows">${rowsHtml}</div>
`;
needsReviewSectionEl.querySelector('#btnBackToResults').addEventListener('click', () => { leaveReview(); render(); });
needsReviewSectionEl.querySelectorAll('.review-row').forEach((rowEl) => {
const key = Number(rowEl.dataset.key);
const kept = reviewTyped.get(rowEl.dataset.key) || {};
const subCategoryInput = rowEl.querySelector('.review-subcategory');
const reasonInput = rowEl.querySelector('.review-reason');
if (subCategoryInput && kept.sub) subCategoryInput.value = kept.sub;
if (reasonInput) reasonInput.value = kept.why != null ? kept.why : ((session.results[key] && session.results[key].manualNote) || '');
if (rowEl.classList.contains('folded')) {
const open = () => { reviewOpenKey = key; render(); };
rowEl.addEventListener('click', open);
rowEl.addEventListener('keydown', (event) => {
if (event.target === rowEl && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); }
});
return;
}
rowEl.querySelectorAll('.review-actions button[data-tier]').forEach((btn) => {
btn.addEventListener('click', () => {
// A quick button carries its own sub-category; a typed one still wins.
decideReview(key, Number(btn.dataset.tier), (subCategoryInput ? subCategoryInput.value.trim() : '') || btn.dataset.subcategory || '', '');
reviewDecided.add(key);
reviewTiersOpen.delete(key);
reviewTyped.delete(rowEl.dataset.key);
reviewOpenKey = null;
render();
});
});
const showTiers = rowEl.querySelector('[data-show-tiers]');
if (showTiers) showTiers.addEventListener('click', () => { reviewTiersOpen.add(key); render(); });
const hideTiers = rowEl.querySelector('[data-hide-tiers]');
if (hideTiers) hideTiers.addEventListener('click', () => { reviewTiersOpen.delete(key); reviewTyped.delete(rowEl.dataset.key); render(); });
const changeAnswer = rowEl.querySelector('[data-change-answer]');
if (changeAnswer) {
changeAnswer.addEventListener('click', () => {
if (!session || !session.results[key]) return;
session.results[key] = undoManualReviewDecision(session.results[key]);
saveSession(session);
linkResendAfterDecision();
reviewDecided.delete(key);
reviewTyped.delete(rowEl.dataset.key);
reviewOpenKey = key;
render();
});
// The Why is taken when the box is left or Enter is pressed: the same
// decision is made again with the reason on it.
reasonInput.addEventListener('change', () => {
const current = session && session.results[key];
const why = reasonInput.value.trim();
if (!current || !current.manualOverride || (current.manualNote || '') === why) return;
const sub = current.subCategory === '(manually reviewed)' ? '' : current.subCategory;
session.results[key] = undoManualReviewDecision(current);
decideReview(key, current.tier, sub, why);
reviewTyped.set(rowEl.dataset.key, { why });
render();
});
}
});
if (typingIn) {
const again = needsReviewSectionEl.querySelector(`.review-row[data-key="${typingIn.key}"] input.${typingIn.cls.split(' ')[0]}`);
if (again) { again.focus({ preventScroll: true }); try { again.setSelectionRange(typingIn.at, typingIn.at); } catch (error) { /* ignore */ } }
}
return true;
}

function render() {
if (destroyed) return;
if (openNote && openNoteUntil && Date.now() >= openNoteUntil) { openNote = ''; openNoteUntil = 0; }
// The lists are rebuilt below, so the initials button that had focus is
// found again afterwards.
const active = root.activeElement;
const focusedAvatar = active && active.classList && active.classList.contains('avatar-btn')
? { key: active.dataset.openKey, scope: active.closest('.review-row') ? needsReviewSectionEl : resultsBody } : null;
ensureBadgeAttached();
renderNotices();
renderVersionLine();
renderModeBanner();
renderLinkLine();
hintLineEl.textContent = restoredNote;
hintLineEl.classList.toggle('hidden', !restoredNote);
curTargetLabelEl.textContent = session ? leadTimeLabel(session.mode, session.rows) : 'Lead created';
sayReady(false);
if (!session) {
headerSubEl.textContent = 'No batch';
rowCountEl.textContent = '0 rows';
rowErrorEl.classList.add('hidden');
if (reviewMode) leaveReview();
needsReviewSectionEl.innerHTML = '';
resultsBody.classList.remove('hidden');
resultsBody.innerHTML = '<div class="empty"><b>No batch loaded</b>Press Send in SLA Manager and the batch arrives here by itself.</div>';
progressFillEl.style.width = '0%';
statsBarEl.classList.add('hidden');
filterBarEl.classList.add('hidden');
updateBadgeProgress(badge, [], session);
curStateEl.textContent = deriveRestStateLabel(session, isRunning);
showOpenNote();
syncButtonStates(0);
renderStatusCard(0, false);
renderRecentLog();
return;
}
const rowTotal = session.rows.length;
headerSubEl.textContent = `${rowTotal} ${rowTotal === 1 ? 'lead' : 'leads'}`;
rowCountEl.textContent = `${rowTotal} ${rowTotal === 1 ? 'row' : 'rows'}`;
rowErrorEl.textContent = session.headerOk ? '' : session.headerError;
rowErrorEl.classList.toggle('hidden', session.headerOk);
const orderedAll = orderedResults(session);
const percent = rowTotal > 0 ? Math.round((100 * orderedAll.length) / rowTotal) : 0;
progressFillEl.style.width = `${percent}%`;
// Animated only while working, so it never reads as busy at rest.
progressFillEl.classList.toggle('active', isRunning && !session.done && !lcNotices.loggedOut);
progressFillEl.classList.toggle('waiting', lcNotices.loggedOut);
updateBadgeProgress(badge, orderedAll, session);
let needsReviewCount = 0;
let reviewing = false;
if (session.mode === 'national') {
if (reviewMode) leaveReview();
needsReviewSectionEl.innerHTML = '';
statsBarEl.classList.add('hidden');
filterBarEl.classList.toggle('hidden', orderedAll.length === 0);
resultsBody.innerHTML = renderNationalResultsHtml(orderedAll, nameFilterText, {
isCustomerOpen: (key) => detailsState.customers.has(key),
isTierOpen: (key, openByDefault) => detailsState.tiers.has(key) || openByDefault,
avatar: (r, color) => avatarButton(r, color),
openTag: openTagHtml,
openNote: openNoteHtml
});
} else {
// Run on every render (idempotent) so duplicates show mid-run.
applyDedupe(
orderedAll,
(r) => r,
(r) => { const p = parseSlaCreated(r.created); return p ? new Date(p.year, p.month, p.day, p.hour, p.minute).getTime() : null; },
(r) => String(r.source || '').toLowerCase() === 'post closure processing',
(r) => { if (!r.flags.includes('Duplicate')) r.flags = [...r.flags, 'Duplicate']; }
);
const needsReview = orderedAll.filter(isNeedsReview);
const ordered = orderedAll.filter((r) => !isNeedsReview(r));
needsReviewCount = needsReview.length;
reviewing = renderNeedsReviewSection(orderedAll);

// One row of chips: Needs review first, then a count for each group.
// Built from the unfiltered set, so it does not shrink with the filter.
const countsByKey = new Map();
ordered.forEach((r) => {
const key = categoryKey(r);
countsByKey.set(key, (countsByKey.get(key) || 0) + 1);
});
const chips = [];
if (needsReviewCount > 0) chips.push(`<button type="button" class="chip warn" data-review="1" aria-pressed="${reviewing}" title="Opens the leads that need your decision" style="--tc: #d97706;">Needs review ${needsReviewCount}</button>`);
STATS_BAR_CATEGORY_ORDER.filter((key) => countsByKey.has(key)).forEach((key) => {
const color = categoryColor(ordered.find((r) => categoryKey(r) === key));
const label = escapeHtmlForUi(CATEGORY_SHORT[key] || key);
chips.push(`<button type="button" class="chip stat-pill${key === 'EXCEPTION' ? ' bad' : ''}" aria-pressed="${activeCategoryFilters.has(key)}" aria-label="Filter: ${label}, ${countsByKey.get(key)}" data-key="${escapeHtmlForUi(key)}" style="--tc: ${color};">${label} ${countsByKey.get(key)}</button>`);
});
statsBarEl.innerHTML = chips.join('');
statsBarEl.classList.toggle('hidden', chips.length === 0);
statsBarEl.querySelectorAll('.stat-pill').forEach((el) => {
el.addEventListener('click', () => {
const key = el.dataset.key;
if (activeCategoryFilters.has(key)) activeCategoryFilters.delete(key);
else activeCategoryFilters.add(key);
if (reviewMode) leaveReview();
render();
});
});
const reviewChip = statsBarEl.querySelector('[data-review]');
if (reviewChip) reviewChip.addEventListener('click', () => { if (reviewMode) leaveReview(); else reviewMode = true; render(); });

filterBarEl.classList.toggle('hidden', ordered.length === 0);
if (ordered.length === 0) {
// If every processed row is in Needs review, "no results yet" would be wrong.
resultsBody.innerHTML = needsReviewCount > 0
? '<div class="empty-state">All results so far need review. Press Review.</div>'
: '<div class="empty-state">No results yet. Press Start.</div>';
} else {
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
// Leads that could not be checked have no tier, so they go to a
// trailing group (7).
const tier = r.postClosureAction ? (r.postClosureAction === 'send back through' ? -2 : -1) : (r.tier || 7);
if (!byTier.has(tier)) byTier.set(tier, []);
byTier.get(tier).push(r);
});
resultsBody.innerHTML = Array.from(byTier.keys()).sort((a, b) => a - b).map((tier) => {
const rows = [...byTier.get(tier)].sort(compareByBookingPriority);
const label = tier === -2 ? 'Post Closure · send back through'
: tier === -1 ? 'Post Closure · check: needs contact?'
: tier === 7 ? 'Could not check'
: tierHeading(tier);
const color = tier === -2 || tier === -1 ? postClosureColor(tier === -2 ? 'send back through' : 'check')
: tier === 7 ? '#dc2626' : TIER_COLORS[tier];
return resultGroupHtml(tier, label, color, rows.length, detailsState.tiers.has(tier), rows.map(standardRowHtml).join(''));
}).join('');
}
}
}
// The review view takes the place of the results while it is open.
resultsBody.classList.toggle('hidden', reviewing);
if (reviewing) filterBarEl.classList.add('hidden');

resultsBody.querySelectorAll('details.tier').forEach((el) => {
const key = Number(el.dataset.key);
el.addEventListener('toggle', () => { if (el.open) detailsState.tiers.add(key); else detailsState.tiers.delete(key); });
});
resultsBody.querySelectorAll('.customer').forEach((el) => {
const key = Number(el.dataset.key);
const summary = el.querySelector('.customer-summary');
const body = el.querySelector('.customer-body');
if (!summary || !body) return;
summary.addEventListener('click', () => {
const opening = body.style.display === 'none';
body.style.display = opening ? 'block' : 'none';
el.classList.toggle('open', opening);
summary.setAttribute('aria-expanded', String(opening));
if (opening) detailsState.customers.add(key); else detailsState.customers.delete(key);
});
summary.addEventListener('keydown', (event) => {
if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); summary.click(); }
});
});
resultsBody.querySelectorAll('details.disagree').forEach((box) => {
const key = Number(box.dataset.key);
const note = () => box.querySelector('.review-reason').value.trim();
const changeVerdict = (change) => {
if (!session || !session.results[key]) return;
session.results[key] = change(session.results[key]);
saveSession(session);
linkResendAfterDecision();
render();
};
box.querySelectorAll('button[data-verdict]').forEach((btn) => btn.addEventListener('click', () => changeVerdict((r) => applyNationalVerdictChange(r, btn.dataset.verdict, note()))));
box.querySelectorAll('button[data-verdict-undo]').forEach((btn) => btn.addEventListener('click', () => changeVerdict(undoNationalVerdictChange)));
box.querySelectorAll('button[data-tier]').forEach((btn) => btn.addEventListener('click', () => {
decideReview(key, Number(btn.dataset.tier), '', note());
render();
}));
box.querySelectorAll('button[data-pc-action]').forEach((btn) => btn.addEventListener('click', () => {
if (!session || !session.results[key]) return;
session.results[key] = applyPostClosureDecision(session.results[key], btn.dataset.pcAction, btn.dataset.pcReason, note());
saveSession(session);
linkResendAfterDecision();
render();
}));
});
resultsBody.querySelectorAll('.undo-review').forEach((btn) => {
btn.addEventListener('click', () => {
const key = Number(btn.dataset.undoKey);
if (!session || !session.results[key]) return;
session.results[key] = undoManualReviewDecision(session.results[key]);
saveSession(session);
linkResendAfterDecision();
render();
});
});
resultsBody.querySelectorAll('.klc-copyable').forEach((el) => {
el.addEventListener('keydown', (event) => {
if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); }
});
el.addEventListener('click', () => {
const original = el.textContent;
copyTextToClipboard(el.dataset.value)
.then(() => {
el.textContent = '✓ Copied!';
el.style.background = '#047857';
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

const restStateLabel = deriveRestStateLabel(session, isRunning, klcShared.stepBusy);
// "Done: results sent to SLA Manager" says more than "Done", so it stays.
if (restStateLabel !== null && !(restStateLabel === 'Done' && /^Done/.test(curStateEl.textContent))) curStateEl.textContent = restStateLabel;
showOpenNote();
if (focusedAvatar) {
const again = focusedAvatar.scope.querySelector(`.avatar-btn[data-open-key="${focusedAvatar.key}"]`);
if (again) again.focus({ preventScroll: true });
}
syncButtonStates(needsReviewCount);
renderStatusCard(orderedAll.length, reviewing);
renderRecentLog();
}

// The one status card: what the batch is doing, the bar, and the state
// line under it. The headline already says a plain Idle, Done or Paused.
function renderStatusCard(checked, reviewing) {
const state = curStateEl.textContent;
const plain = state === 'Idle' || state === 'Done' || state === 'Paused';
curStateEl.classList.toggle('hidden', plain);
curStateEl.classList.toggle('info', !!openNote && state === openNote);
statusCardEl.classList.toggle('nobatch', !session);
statusCardEl.classList.toggle('hidden', session ? (reviewing && !isRunning) : plain);
if (!session) return;
const total = session.rows.length;
const paused = isRunning && session.paused;
statusHeadlineEl.textContent = lcNotices.loggedOut ? `Waiting for Login · ${checked} of ${total}`
: paused ? `Paused · ${checked} of ${total}`
: isRunning ? `Checking ${checked} of ${total}`
: `${checked} of ${total} checked`;
// The customer and lead time show while working, unless the state line
// already says them.
const customer = curCustomerEl.textContent;
const target = curTargetEl.textContent;
const showCustomer = customer !== '-' && !state.includes(customer);
const showTarget = target !== '-' && !state.includes(target);
curCustomerEl.classList.toggle('hidden', !showCustomer);
curTargetPartEl.classList.toggle('hidden', !showTarget);
curLineEl.classList.toggle('hidden', !(isRunning || manualStepBusy) || !(showCustomer || showTarget));
}

let lastRetryCount = -1;
function syncButtonStates(needsReviewCount) {
const v = computeButtonVisibility(session, isRunning);
const startShown = v.start && !!session;
btnStartEl.classList.toggle('hidden', !startShown);
btnStartFoldEl.disabled = !v.start || !pasteBox.value.trim();
pauseResumeBtn.classList.toggle('hidden', !v.pauseResume);
btnProcessNextEl.classList.toggle('hidden', !v.processNext);
btnCancelEl.classList.toggle('hidden', !v.cancel);
btnRetryExceptionsEl.classList.toggle('hidden', !v.retryExceptions);
const retryCount = v.retryExceptions ? retryableExceptionCount(session) : 0;
// Only when the count changes, so the words shown after a press are not wiped.
if (retryCount !== lastRetryCount) {
lastRetryCount = retryCount;
btnRetryExceptionsEl.innerHTML = `${svgIcon('refresh', 11)}Retry ${retryCount} failed`;
}
// While a batch runs the Needs review chip opens the cards; the button
// comes once the run has stopped.
const reviewShown = needsReviewCount > 0 && !reviewMode && !v.pauseResume;
btnReviewEl.classList.toggle('hidden', !reviewShown);
btnReviewEl.textContent = `Review ${needsReviewCount}`;
// One filled button: what is left to press. None while logged out, as
// the thing to press is then on the Konnect Live page.
const pausePrimary = v.pauseResume && !lcNotices.loggedOut;
pauseResumeBtn.classList.toggle('pri', pausePrimary);
btnStartEl.classList.toggle('pri', startShown && !v.pauseResume);
btnReviewEl.classList.toggle('pri', reviewShown && !startShown);
const nationalMode = !!(session && session.mode === 'national');
btnCopyRawForExtractEl.classList.toggle('hidden', nationalMode);
btnCopyNationalResultsEl.classList.toggle('hidden', !nationalMode);
}

function renderVersionLine() {
const text = versionLineText(versionState);
versionLineEl.textContent = versionState.newer ? 'A newer version is out' : text;
versionLineEl.classList.toggle('newer', versionState.newer);
menuVersionEl.textContent = text;
}

// The footer says what kind of check is loaded, or the paste setting when
// nothing is.
function renderModeBanner() {
const scenario = session && session.headerOk ? checkScenarioOf(session.mode, session.rows) : null;
const text = scenario ? `${scenario.label} · ${scenario.detail}` : (autoStartToggle.checked ? 'Starts by itself on paste' : 'Does not start by itself on paste');
modeBannerEl.textContent = text;
modeBannerEl.title = text;
}

function renderLinkLine() {
linkLineEl.textContent = linkLineText();
const state = linkState();
linkLineEl.className = 'strip ' + (!managerWindow() ? 'off' : state === 'loggedOut' ? 'out' : state === 'paused' ? 'paused' : state === 'running' ? 'busy' : 'ok');
}

// Folded behind "Recent activity" on the status card.
function renderRecentLog() {
const any = recentCompletions.length > 0;
btnRecentEl.classList.toggle('hidden', !any);
btnRecentEl.setAttribute('aria-expanded', String(recentOpen));
recentLogEl.classList.toggle('hidden', !any || !recentOpen);
recentLogEl.innerHTML = recentCompletions.slice(0, 3).map((r) => {
const label = r.exception ? exceptionLabel(r.exception) : (r.verdict || CATEGORY_SHORT[categoryKey(r)] || 'Pending');
return `<span class="recent-log-row">${escapeHtmlForUi(r.name || '-')}: ${escapeHtmlForUi(label)}</span>`;
}).join('');
}

const uiHandle = {
setState(state, customer, target) {
if (destroyed) return;
curStateEl.textContent = state;
if (customer !== undefined) curCustomerEl.textContent = customer || '-';
if (target !== undefined) curTargetEl.textContent = target || '-';
render();
},
render,
loggedOut() { uiHandle.setState('Logged out: waiting for you to press Login'); },
onProgress(running) { linkProgress(running); },
onLoopExit(finished) { return linkLoopExit(finished); }
};

// Linked to SLA Manager when SLA Manager opened this tab: it sends the
// batch here and gets the results back without the clipboard. A tab opened
// by hand has no link, and copy and paste works as before.
const MANAGER_ORIGIN = 'https://konnectonlineservices.co.uk';
// In the small window Work Tools opens, the opener is the Konnect Live tab
// it was opened from, so Work Tools hands SLA Manager's window over.
function managerWindow() {
try {
const manager = window.__workToolsManager || window.opener;
return manager && !manager.closed ? manager : null;
} catch (error) { return null; }
}
function linkPost(message) {
const opener = managerWindow();
if (!opener) return false;
try { opener.postMessage(message, MANAGER_ORIGIN); return true; } catch (error) { return false; }
}
// The batch SLA Manager sent that has not ended yet, if that is what is loaded.
function linkedBatch() {
return session && session.fromManager && !session.linkEnded ? session : null;
}
function linkState() {
if (lcNotices.loggedOut) return 'loggedOut';
if (isRunning) return (session && session.paused) || lcNotices.hiddenWait ? 'paused' : 'running';
if (manualStepBusy) return 'running';
if (session && !session.done && !session.cancelled && (session.stoppedOnError || (linkedBatch() && session.paused))) return 'paused';
return 'idle';
}
function linkReadyMessage() {
const batch = linkedBatch();
return {
type: 'workTools:ready', url: location.origin + location.pathname, state: linkState(),
batchId: batch ? batch.linkId : null,
done: batch ? Object.keys(batch.results).length : 0,
total: batch ? batch.rows.length : 0
};
}
// Sent every 10 seconds, and straight away when the state or batch changes.
let lastReadyKey = '';
function sayReady(always) {
if (destroyed) return;
const message = linkReadyMessage();
const key = `${message.state}|${message.batchId}`;
if (!always && key === lastReadyKey) return;
lastReadyKey = key;
linkPost(message);
}
function linkResults(s, partial) {
const national = s.mode === 'national';
const count = Object.keys(s.results).length;
s.linkSentAt = count;
linkPost({
type: 'workTools:results', id: s.linkId == null ? null : s.linkId, partial: !!partial, done: count, total: s.rows.length,
kind: national ? 'national' : 'leads',
tsv: national ? buildNationalResultsExport(s) : buildRawNotesTsvForExtract(s)
});
}
// Said once for each batch received, when it stops for good.
function linkEnd(s, reason) {
if (!s || !s.fromManager || s.linkEnded) return;
s.linkEnded = reason;
linkPost({ type: 'workTools:ended', id: s.linkId == null ? null : s.linkId, reason });
saveSession(s);
}
// Results go back in step as the batch runs (every 5 leads, counted for
// this batch), so the lead cards fill in as it goes.
function linkProgress(s) {
if (linkedBatch() !== s || s.done) return;
if (Object.keys(s.results).length - (s.linkSentAt || 0) < 5) return;
linkResults(s, true);
}
function linkLoopExit(s) {
if (!s.fromManager) return '';
let said = '';
if (s.done && !s.cancelled) {
// Also after a retry on a batch that had already ended: the results go
// again, the ending is not said twice.
linkResults(s, false);
linkEnd(s, 'done');
if (managerWindow()) said = 'Done: results sent to SLA Manager';
} else if (s.cancelled && !s.linkEnded) {
if (Object.keys(s.results).length > (s.linkSentAt || 0)) linkResults(s, true);
linkEnd(s, 'cancelled');
}
return said;
}
// A decision made by hand on a finished linked batch changes its results,
// so the full set is sent again under the same id.
function linkResendAfterDecision() {
// The decisions made by hand go back too, for any batch: the same text as
// Copy review decisions.
if (session) linkPost({ type: 'workTools:review', tsv: buildManualReviewDecisionsExport(session) });
if (session && session.fromManager && session.linkEnded) linkResults(session, false);
}

function linkLineText() {
const state = linkState();
if (!managerWindow()) return 'Konnect Live: not linked. Press Open Konnect Live in SLA Manager.';
if (state === 'loggedOut') return 'Konnect Live: logged out, logging back in.';
if (state === 'paused') return 'Konnect Live: paused.';
if (state === 'running' && session) return `Konnect Live: checking ${Object.keys(session.results).length} of ${session.rows.length}.`;
return 'Konnect Live: linked, ready.';
}

// Stops the batch in hand for good and waits until its run has let go of
// the page, so a new batch never starts while the old one is mid-lead.
async function retireSession(reason) {
const old = session;
if (!old) return;
old.cancelled = true;
old.discarded = true;
stopManualOpen();
linkEnd(old, reason);
if (isRunning || manualStepBusy) {
uiHandle.setState('Stopping the current check...');
while (isRunning || manualStepBusy) await sleep(50);
}
}

// Every change of batch goes through here, one at a time.
let batchChanges = Promise.resolve();
let batchChangesWaiting = 0;
function loadBatch(text, options) {
batchChangesWaiting++;
const run = batchChanges.then(() => changeBatch(text, options || {}));
batchChanges = run.catch((error) => { console.error('KonnectLeadChecker: the batch could not be loaded:', error); }).then(() => { batchChangesWaiting--; });
return run;
}
async function changeBatch(text, options) {
if (destroyed) return null;
if (session && session.rawInput === text && !options.link && !options.fresh) return session;
const previous = session;
await retireSession('cleared');
if (destroyed) return null;
// A hand paste passes the old batch so finished results carry over to a
// grown batch. A batch from SLA Manager or Clear & paste starts clean.
session = newSession(text, options.link || options.fresh ? null : previous);
if (options.link || options.fresh) recentCompletions = [];
leaveReview();
if (options.link) { session.fromManager = true; session.linkId = options.link.id; }
restoredNote = '';
lcNotices.otherTab = false;
lcNotices.stopped = null;
if (pasteBox.value !== text && (options.link || options.fresh)) pasteBox.value = text;
setPauseResumeLabel('Pause');
hidePageFlashOverlay();
saveSession(session);
curCustomerEl.textContent = '-';
curTargetEl.textContent = '-';
render();
return session;
}
function loadFromPasteBox() {
return loadBatch(pasteBox.value);
}

// textContent would wipe the icon, so label and icon are set together.
function setPauseResumeLabel(text) {
pauseResumeBtn.innerHTML = svgIcon(text === 'Pause' ? 'pause' : 'play', 11) + text;
}

function beginRun(s) {
if (destroyed || !s || s !== session) return;
if (!s.headerOk) { uiHandle.setState(`This batch could not be read: ${s.headerError}`); return; }
stopManualOpen();
s.paused = false;
s.cancelled = false;
// The page may have moved since the last lead, so the customer is reopened.
if (!klcShared.stepBusy) s.rowInGroupIndex = 0;
restoredNote = '';
setPauseResumeLabel('Pause');
showPageFlashOverlay('Checking leads…');
topSectionEl.open = false;
runLoop(s, uiHandle);
}

async function startProcessing() {
beginRun(await loadFromPasteBox());
}

btnStartEl.addEventListener('click', startProcessing);
btnStartFoldEl.addEventListener('click', startProcessing);

// Check one lead. Waits for a lead already being checked (a run that was
// just paused) so two never run at once and none is skipped.
let manualStepBusy = false;
let manualStepAsked = false;
root.getElementById('btnProcessNext').addEventListener('click', async () => {
if (manualStepAsked) return;
manualStepAsked = true;
try {
const s = await loadFromPasteBox();
if (!s || destroyed) return;
if (!s.headerOk) { uiHandle.setState(`This batch could not be read: ${s.headerError}`); return; }
if (isRunning && !s.paused) return;
stopManualOpen();
if (klcShared.stepBusy) {
uiHandle.setState('Waiting for the lead being checked to finish...');
while (klcShared.stepBusy) await sleep(100);
}
if (s !== session || s.discarded) return;
manualStepBusy = true;
s.cancelled = false;
s.rowInGroupIndex = 0;
restoredNote = '';
showPageFlashOverlay('Checking lead…');
let problem = '';
try {
await runStep(s, uiHandle);
} catch (error) {
console.error('KonnectLeadChecker: a lead could not be checked:', error);
failGroupAfterError(s, lastStepGroupIndex);
saveSession(s);
problem = `Stopped on an error: ${errorText(error)}`;
} finally {
hidePageFlashOverlay();
}
manualStepBusy = false;
uiHandle.setState(problem || (s.done ? 'Done' : 'Paused after one lead'));
if (s.done && !isRunning) { const said = linkLoopExit(s); if (said) uiHandle.setState(said); }
} finally {
manualStepBusy = false;
manualStepAsked = false;
render();
}
});

function startManagerLink() {
if (!managerWindow()) return;
// One listener and one 10 second timer per page, held where every copy of
// this tool can reach them and pointed at the newest copy.
klcShared.onMessage = onLinkMessage;
klcShared.onTick = () => sayReady(true);
if (!klcShared.listening) {
klcShared.listening = (event) => { if (klcShared.onMessage) klcShared.onMessage(event); };
window.addEventListener('message', klcShared.listening);
}
if (klcShared.tickTimer == null) klcShared.tickTimer = setInterval(() => { if (klcShared.onTick) klcShared.onTick(); }, 10000);
sayReady(true);
const restored = session;
if (restored && restored.fromManager && !restored.linkEnded && restored.headerOk) {
// A reload in the middle of a batch from SLA Manager: it keeps its id
// and carries on by itself, unless the agent had paused it.
if (restored.done) linkLoopExit(restored);
else if (!restored.paused && !restored.cancelled) { host.style.display = 'block'; badge.hide(); beginRun(restored); }
return;
}
if (restored) return;
// Says so when the link is up but no batch follows (SLA Manager reloaded,
// or the batch went to an earlier copy of this page before it reloaded).
uiHandle.setState('Linked: waiting for the batch from SLA Manager or the agent desktop');
batchWaitTimer = setTimeout(() => {
if (!destroyed && !isRunning && !session) uiHandle.setState('Linked, but no batch came. Press Send (or Check my Parked Calls) again.');
}, 10000);
}

function onLinkMessage(event) {
const manager = managerWindow();
if (destroyed || !manager || event.origin !== MANAGER_ORIGIN || event.source !== manager) return;
const data = event.data;
if (data && data.type === 'workTools:open') { openCustomerFromLink(data); return; }
if (data && data.type === 'workTools:verify') { verifyBookingFromLink(data); return; }
if (!data || data.type !== 'workTools:batch' || typeof data.tsv !== 'string') return;
const id = data.id == null ? null : data.id;
const current = linkedBatch();
// The same batch sent twice (SLA Manager did not hear the first answer).
if (id != null && current && current.linkId === id) { linkPost({ type: 'workTools:received', id, rows: current.rows.length }); return; }
// A customer being opened by hand gives way to the batch (see retireSession).
if (isRunning || manualStepBusy || (klcShared.stepBusy && !openInFlight) || batchChangesWaiting > 0) {
linkPost({ type: 'workTools:busy', id, runningId: current ? current.linkId : null });
return;
}
clearTimeout(batchWaitTimer);
loadBatch(data.tsv, { link: { id } }).then((s) => {
if (!s) return;
linkPost({ type: 'workTools:received', id, rows: s.rows.length });
host.style.display = 'block';
badge.hide();
if (!s.headerOk) {
linkEnd(s, 'unreadable');
uiHandle.setState(`The batch sent over could not be read: ${s.headerError}`);
} else if (s.rows.length === 0) {
linkEnd(s, 'empty');
uiHandle.setState('The batch sent over had no leads to check.');
} else if (s.done) {
// Every row was unreadable: the results say so, and the batch is done.
uiHandle.setState(linkLoopExit(s) || 'Done');
} else {
beginRun(s);
}
sayReady(false);
});
}

autoStartToggle.addEventListener('change', () => {
saveSettings({ autoStart: autoStartToggle.checked });
render();
});

// Paste only, not typing, so a half-typed batch never starts a run. A paste
// over a running batch stops that one first, then starts the new one.
pasteBox.addEventListener('paste', () => {
if (!autoStartToggle.checked) return;
setTimeout(async () => {
const s = await loadFromPasteBox();
if (s && s.headerOk && s.rows.length > 0 && !s.done && !isRunning) beginRun(s);
}, 0);
});

// Debounced: each parse also writes the batch to localStorage.
let pasteBoxInputDebounce = null;
pasteBox.addEventListener('input', () => {
clearTimeout(pasteBoxInputDebounce);
pasteBoxInputDebounce = setTimeout(() => { loadFromPasteBox(); }, 300);
});

// Reads the clipboard directly. Setting pasteBox.value fires no paste
// event, so the batch is loaded here.
root.getElementById('btnPasteClipboard').addEventListener('click', async (event) => {
const btn = event.currentTarget; // read before any await: it is null afterwards
if (!navigator.clipboard || !navigator.clipboard.readText) {
showButtonFeedback(btn, 'Clipboard blocked: paste manually', true);
return;
}
try {
const text = await navigator.clipboard.readText();
pasteBox.value = text;
const s = await loadFromPasteBox();
if (!s) return;
if (autoStartToggle.checked && !isRunning && s.headerOk && s.rows.length > 0 && !s.done) {
beginRun(s);
} else {
showButtonFeedback(btn, `✓ Pasted ${s.rows.length}`, false);
}
} catch (error) {
showButtonFeedback(btn, 'Clipboard blocked: paste manually', true);
}
});

// Hiding the overlay on Pause keeps the real page usable while paused. A
// lead already being checked finishes first.
pauseResumeBtn.addEventListener('click', () => {
if (!session) return;
stopManualOpen();
if (session.paused) {
session.paused = false;
if (!klcShared.stepBusy) session.rowInGroupIndex = 0;
setPauseResumeLabel('Pause');
uiHandle.setState('Resuming...');
showPageFlashOverlay('Checking leads…');
runLoop(session, uiHandle);
} else {
session.paused = true;
setPauseResumeLabel('Resume');
uiHandle.setState(klcShared.stepBusy ? 'Pausing after this lead...' : 'Paused');
hidePageFlashOverlay();
}
});

root.getElementById('btnCancel').addEventListener('click', () => {
if (session) { session.cancelled = true; uiHandle.setState('Cancelling...'); }
});

// Only while paused or stopped. retryExceptions mutates in place so a
// paused runLoop holding this object picks the change up.
async function retryFailedLeads(event) {
const btn = event.currentTarget; // read before any await: it is null afterwards
const s = session;
if (!s) return;
if (isRunning && !s.paused) {
showButtonFeedback(btn, 'Pause first', true);
return;
}
const retryCount = retryableExceptionCount(s);
if (retryCount === 0) {
showButtonFeedback(btn, 'Nothing to retry', true);
return;
}
stopManualOpen();
// A lead still being checked after Pause would be skipped or doubled.
if (klcShared.stepBusy) {
uiHandle.setState('Waiting for the lead being checked to finish...');
while (klcShared.stepBusy) await sleep(100);
if (s !== session || s.discarded) return;
}
retryExceptions(s);
saveSession(s);
setPauseResumeLabel('Pause');
showPageFlashOverlay('Checking leads…');
if (isRunning) {
// A paused loop is still alive: clearing paused resumes it; calling
// runLoop again would start a duplicate.
s.paused = false;
uiHandle.setState('Resuming...');
} else {
beginRun(s);
}
showButtonFeedback(btn, `✓ Retrying ${retryCount}`, false);
}
btnRetryExceptionsEl.addEventListener('click', retryFailedLeads);
root.getElementById('menuRetry').addEventListener('click', retryFailedLeads);

// Clear + paste + start in one click, from More. Always
// starts, whatever the autoStart toggle (that governs paste-into-textarea).
root.getElementById('btnClearPasteStart').addEventListener('click', async (event) => {
const btn = event.currentTarget; // read before any await: it is null afterwards
if (!navigator.clipboard || !navigator.clipboard.readText) {
showButtonFeedback(btn, 'Clipboard blocked: paste manually', true);
return;
}
let text;
try {
text = await navigator.clipboard.readText();
} catch (error) {
showButtonFeedback(btn, 'Clipboard blocked: paste manually', true);
return;
}
const s = await loadBatch(text, { fresh: true });
if (!s) return;
if (s.headerOk && s.rows.length > 0 && !s.done) {
beginRun(s);
} else {
uiHandle.setState('Idle', '-', '-');
showButtonFeedback(btn, s.headerOk ? 'No leads found in the clipboard' : 'The clipboard is not a batch', true);
}
});

// No names are sent: only statuses, verdicts and counts.
root.getElementById('btnReport').addEventListener('click', () => {
const s = session;
const results = s ? orderedResults(s) : [];
const state = s ? `${checkScenarioOf(s.mode, s.rows).label}; ${results.length} of ${s.rows.length} done; ${curStateEl.textContent}; timers: ${klcTimers.mode}${document.hidden ? ', tab hidden' : ''}` : 'No batch loaded';
const lines = results.slice(-25).map((r, i) => [`row ${i + 1}`, r.status, r.exception ? exceptionLabel(r.exception) : '', r.verdict || r.tierName || '', r.postClosureAction ? `${r.postClosureAction}${r.postClosureReason ? ': ' + r.postClosureReason : ''}` : ''].filter(Boolean).join(' | '));
reportProblem('Lead Checker', state, lines);
});

// Full reset: stops the run and this copy's timers, wipes the stored batch
// (this tool's data only) and removes the panel.
root.getElementById('btnClearStop').addEventListener('click', () => {
if (session) { session.cancelled = true; session.discarded = true; linkEnd(session, 'cleared'); }
stopManualOpen();
destroyed = true;
clearInterval(badgeTimer);
clearInterval(smallBoxTimer);
clearTimeout(batchWaitTimer);
clearTimeout(pasteBoxInputDebounce);
if (versionState.stop) versionState.stop();
window.removeEventListener('storage', onStorage);
window.removeEventListener('mousedown', onPageMouseDown);
if (klcShared.listening) window.removeEventListener('message', klcShared.listening);
klcShared.listening = false;
klcShared.onMessage = null;
klcShared.onTick = null;
if (klcShared.tickTimer != null) { clearInterval(klcShared.tickTimer); klcShared.tickTimer = null; }
lcNotices.onChange = null;
hidePageFlashOverlay();
clearStoredSession();
session = null;
recentCompletions = [];
host.remove();
badge.remove();
window.__konnectLeadChecker = null;
console.info('Konnect Lead Checker stopped and cleared. Click the bookmarklet again to start fresh.');
});

function copyResults(btn, build) {
if (!session) { showButtonFeedback(btn, 'Nothing to copy yet', true); return; }
const count = orderedResults(session).length;
copyTextToClipboard(build(session))
.then(() => showButtonFeedback(btn, `✓ Copied ${count}`, false))
.catch(() => showButtonFeedback(btn, '✗ Copy failed', true));
}
root.getElementById('btnCopyRawForExtract').addEventListener('click', (event) => copyResults(event.currentTarget, buildRawNotesTsvForExtract));
root.getElementById('btnCopyNationalResults').addEventListener('click', (event) => copyResults(event.currentTarget, buildNationalResultsExport));

root.getElementById('btnCopyReviewDecisions').addEventListener('click', (event) => {
const btn = event.currentTarget; // read before any await: it is null afterwards
const count = session ? orderedResults(session).filter((r) => r.manualOverride).length : 0;
if (count === 0) {
showButtonFeedback(btn, 'No manual reviews yet', true);
return;
}
copyTextToClipboard(buildManualReviewDecisionsExport(session))
.then(() => showButtonFeedback(btn, `✓ Copied ${count}`, false))
.catch(() => showButtonFeedback(btn, '✗ Copy failed', true));
});

// The badge (mutually exclusive with the host, see its own click handler
// above) is the only way back once hidden.
minBtn.addEventListener('click', () => {
host.style.display = 'none';
badge.show();
});

// Work Tools reads this before it opens Konnect Live's small window.
const menuSmallWindowEl = root.getElementById('menuSmallWindow');
function syncSmallWindowMenu() {
const on = smallWindowWanted();
menuSmallWindowEl.querySelector('span').textContent = `Small window: ${on ? 'on' : 'off'}`;
menuSmallWindowEl.setAttribute('role', 'menuitemcheckbox');
menuSmallWindowEl.setAttribute('aria-checked', String(on));
}
menuSmallWindowEl.addEventListener('click', () => {
try { localStorage.setItem(SMALL_WINDOW_KEY, smallWindowWanted() ? 'off' : 'on'); } catch (error) { /* stays as it was */ }
syncSmallWindowMenu();
});
syncSmallWindowMenu();
// The small window remembers the size and place the owner gave it.
const smallBoxTimer = setInterval(saveSmallWindowBox, 5000);
window.addEventListener('resize', saveSmallWindowBox);
window.addEventListener('beforeunload', saveSmallWindowBox);

// The More menu. Items marked data-close shut it; the rest stay so the
// words that answer a press ("Copied 4") can be read.
function setMenuOpen(open) {
moreMenuEl.classList.toggle('hidden', !open);
moreBtn.setAttribute('aria-expanded', String(open));
if (!open) return;
syncHeightMenu();
syncSmallWindowMenu();
// Kept inside the window wherever the panel has been dragged to.
moreMenuEl.style.maxHeight = `${Math.max(160, window.innerHeight - moreBtn.getBoundingClientRect().bottom - 16)}px`;
moreMenuEl.scrollTop = 0;
}
const menuIsOpen = () => !moreMenuEl.classList.contains('hidden');
moreBtn.addEventListener('click', () => {
setMenuOpen(!menuIsOpen());
if (menuIsOpen()) minBtn.focus();
});
moreMenuEl.addEventListener('click', (event) => {
if (event.target && event.target.closest && event.target.closest('[data-close]')) setMenuOpen(false);
});
moreMenuEl.addEventListener('keydown', (event) => {
if (event.key === 'Escape') { setMenuOpen(false); moreBtn.focus(); return; }
if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
const items = Array.from(moreMenuEl.querySelectorAll('button.mi:not(.hidden), .mi input'));
const at = items.indexOf(root.activeElement);
const next = items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
if (next) { event.preventDefault(); next.focus(); }
});
// A press anywhere else, in the panel or on the page, shuts the menu.
root.addEventListener('mousedown', (event) => {
if (menuIsOpen() && !moreMenuEl.contains(event.target) && !moreBtn.contains(event.target)) setMenuOpen(false);
});
const onPageMouseDown = (event) => { if (event.target !== host && menuIsOpen()) setMenuOpen(false); };
window.addEventListener('mousedown', onPageMouseDown);

root.getElementById('menuPasteByHand').addEventListener('click', () => {
topSectionEl.open = true;
bodyEl.scrollTop = 0;
pasteBox.focus();
});
function showRecent(open) {
recentOpen = open;
renderRecentLog();
}
btnRecentEl.addEventListener('click', () => showRecent(!recentOpen));
root.getElementById('menuRecent').addEventListener('click', (event) => {
if (recentCompletions.length === 0 || statusCardEl.classList.contains('hidden')) { showButtonFeedback(event.currentTarget, 'No activity to show yet', true); return; }
setMenuOpen(false);
showRecent(true);
bodyEl.scrollTop = 0;
btnRecentEl.focus();
});
btnReviewEl.addEventListener('click', () => { reviewMode = true; bodyEl.scrollTop = 0; render(); });

// The panel's height: a default with the list scrolling inside, or the
// one last chosen with the grip or in More (0 means the default). Kept
// with this tool's settings.
let panelHeight = loadSettings().panelHeight;
const resizeGripEl = root.getElementById('resizeGrip');
const heightItems = Array.from(moreMenuEl.querySelectorAll('[data-height]'));
function syncHeightMenu() {
heightItems.forEach((item) => {
item.setAttribute('role', 'menuitemradio');
item.setAttribute('aria-checked', String(Number(item.dataset.height) === panelHeight));
});
}
function applyPanelHeight() {
bodyEl.style.height = panelHeight > 0 ? `min(${panelHeight}px, calc(100vh - 170px))` : '';
bodyEl.style.maxHeight = panelHeight > 0 ? 'none' : '';
syncHeightMenu();
}
function setPanelHeight(height, keep) {
panelHeight = height > 0 ? Math.max(140, Math.min(900, Math.round(height))) : 0;
applyPanelHeight();
if (keep) saveSettings({ panelHeight });
}
heightItems.forEach((item) => item.addEventListener('click', () => setPanelHeight(Number(item.dataset.height), true)));
let gripDrag = null;
resizeGripEl.addEventListener('pointerdown', (event) => {
gripDrag = { startY: event.clientY, startHeight: bodyEl.getBoundingClientRect().height };
try { resizeGripEl.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
event.preventDefault();
});
resizeGripEl.addEventListener('pointermove', (event) => {
if (gripDrag) setPanelHeight(gripDrag.startHeight + event.clientY - gripDrag.startY, false);
});
const endGripDrag = () => {
if (!gripDrag) return;
gripDrag = null;
saveSettings({ panelHeight });
};
resizeGripEl.addEventListener('pointerup', endGripDrag);
resizeGripEl.addEventListener('pointercancel', endGripDrag);
resizeGripEl.addEventListener('keydown', (event) => {
if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
event.preventDefault();
setPanelHeight(bodyEl.getBoundingClientRect().height + (event.key === 'ArrowDown' ? 20 : -20), true);
});
applyPanelHeight();

// Not rebuilt by render(), so typing never loses focus mid-run.
searchInputEl.addEventListener('input', () => {
nameFilterText = searchInputEl.value.trim().toLowerCase();
render();
});

let dragState = null;
headerEl.addEventListener('mousedown', (event) => {
if (event.target && event.target.closest && event.target.closest('button')) return;
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
startManagerLink();
// Keeps the button in Konnect's menu bar when the page redraws it.
badgeTimer = setInterval(ensureBadgeAttached, 3000);

window.__konnectLeadChecker = {
focus() {
host.style.display = 'block';
badge.hide();
focusPanel();
},
getSession: () => session
};
}

function startUi() {
try {
initKonnectLeadCheckerUI();
} catch (error) {
console.warn('KonnectLeadChecker UI did not initialize (expected outside a real browser):', error && error.message);
}
}

// Opened on the login page: wait for the logged-in page, then set up.
// A full page load after login ends this script, so the note says to
// click again if nothing appears.
if (onLoginPage()) {
// The browser fills the login box itself, so pressing Login is usually
// all that is needed; the wait below covers the rest.
const note = showLoginWaitNote();
reLogin({ setState(text) { if (note) { note.textContent = text; note.style.display = 'block'; } } });
window.__konnectLeadChecker = { focus() { if (note) note.style.display = 'block'; } };
const wait = setInterval(() => {
if (onLoginPage()) return;
clearInterval(wait);
if (note) note.remove();
window.__konnectLeadChecker = null;
startUi();
}, 1000);
} else {
startUi();
}

})();
