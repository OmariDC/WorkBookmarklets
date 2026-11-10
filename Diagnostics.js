// Page diagnostics for building and fixing the Konnect tools.
//
// Run it on a Konnect page and it collects the page's structure (buttons,
// links, table headers, search options, field labels, Angular data keys)
// so a new automated step can be written against the real page. Customer
// data is masked: names, emails, phone numbers and note text are reduced
// to their length or shape. Look over the output before sharing it.
//
// The panel stays open and keeps a history of snapshots. Alt+Shift+D takes
// one without clicking (so open dropdowns and popups are kept), and Watch
// takes one before every click on the page and after the page changes.

(function () {

const MAX = 60;
const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Keeps labels readable but strips anything that looks like customer data.
const scrub = (s) => clean(s)
.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi, '<email>')
.replace(/(\+44\s?|\b0)7\d{3}\s?\d{3}\s?\d{3}\b/g, '<phone>')
.replace(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/g, '<reg>')
.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, '<postcode>');
function mask(s) {
return scrub(s).slice(0, MAX);
}
const maskDigits = (s) => clean(s).replace(/\d+/g, '9');
// Shape only: "Mr John Smith" becomes "Aa Aaaa Aaaaa".
const shape = (s) => clean(s).replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9').slice(0, 30);
function attrs(el) {
const out = {};
for (const name of ['id', 'class', 'href', 'ng-click', 'ng-href', 'ng-model', 'ng-repeat', 'ng-if', 'ng-show', 'ui-sref', 'title', 'type', 'name', 'value', 'download', 'role', 'col-id', 'data-toggle', 'aria-label']) {
const v = el.getAttribute && el.getAttribute(name);
if (v) out[name] = maskDigits(scrub(v)).slice(0, 140);
}
if (el.disabled) out.disabled = true;
return out;
}

function collect() {
const report = {
capturedAt: new Date().toISOString(),
page: { origin: location.origin, hash: maskDigits(location.hash), path: maskDigits(location.pathname), title: clean(document.title) },
angular: typeof angular !== 'undefined'
};

// Navigation menu entries, to find routes like Data > Customer Hub.
report.nav = Array.from(document.querySelectorAll('nav a, .navbar a, .sidebar a, [role="menu"] a, ul.dropdown-menu a'))
.map((a) => ({ text: mask(a.textContent), ...attrs(a) }))
.filter((a) => a.text)
.slice(0, 150);

// Every visible clickable control with its label. Ones that look relevant
// to this check are flagged so they are easy to find.
const KEY = /recreate|regenerat|refresh|download|export|excel|csv|report|customer hub|all|search|timeline|notes?|follow|callback|reschedul|outcome|enquiry max|reset|reopen/i;
report.controls = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [ng-click], [role="button"]'))
.filter(vis)
.map((el) => {
let text = mask(el.textContent || el.value || el.getAttribute('title') || el.getAttribute('aria-label'));
const out = { tag: el.tagName.toLowerCase(), text, relevant: KEY.test(text + ' ' + (el.getAttribute('ng-click') || '')), ...attrs(el) };
// Inside table rows (diary boxes, history) the text is usually a person's
// name, so only its shape is kept unless it is a status word or a time.
if (el.closest('tbody')) {
if (!/^(BLOCKED|[A-Z][a-z]+( [A-Z][a-z]+)? Appointment|\d{1,2}:\d{2}|\d{1,2})$/.test(text)) out.text = shape(text);
if (out.title) out.title = out.title.replace(/^[^:]+:/, '<name>:');
}
return out;
})
.filter((c) => c.text || c['ng-click'])
// Identical controls (one icon per timeline row) are listed once with a count.
.reduce((list, c) => {
const sig = JSON.stringify(c);
const found = list.find((x) => x.sig === sig);
if (found) found.count++; else list.push({ sig, count: 1, c });
return list;
}, [])
.map(({ count, c }) => (count > 1 ? { ...c, count } : c))
.slice(0, 200);

// Radio buttons and selects: the Konnect Live search type options live here.
report.radios = Array.from(document.querySelectorAll('input[type="radio"]')).map((r) => ({
name: r.name, value: r.value, checked: r.checked,
label: mask((r.closest('label') || document.querySelector(`label[for="${r.id}"]`) || r.parentElement || {}).textContent)
}));
report.selects = Array.from(document.querySelectorAll('select')).filter(vis).map((s) => ({
...attrs(s), selected: mask((s.options[s.selectedIndex] || {}).textContent), options: Array.from(s.options).slice(0, 40).map((o) => mask(o.textContent))
}));

// Text that looks like a status or a date/time (for "has it finished
// updating?"). Dates and times are kept; anything around them is masked.
const DATEISH = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})(\s+\d{1,2}:\d{2}(:\d{2})?)?|\b\d{1,2}:\d{2}\b/;
const STATUS = /updat|generat|creat|processing|pending|complete|ready|queued|running|last run|refreshed/i;
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
const statusTexts = [];
let node;
while ((node = walker.nextNode()) && statusTexts.length < 80) {
const t = clean(node.textContent);
if (!t || t.length > 160 || !vis(node.parentElement)) continue;
if (STATUS.test(t) || (DATEISH.test(t) && t.length < 60)) {
statusTexts.push({ text: mask(t), parent: node.parentElement.tagName.toLowerCase(), ...attrs(node.parentElement) });
}
}
report.statusTexts = statusTexts;

// Tables: header labels, and the first three rows as structure only.
// Titles in table cells often start with a person's name ("Name: Phone Call Appointment").
function cellAttrs(el) {
const out = attrs(el);
if (out.title) out.title = out.title.replace(/^[^:]+:/, '<name>:');
return out;
}
function describeCell(cell) {
const link = cell.querySelector('a, [ng-click]');
return {
textShape: shape(cell.textContent),
link: link ? { tag: link.tagName.toLowerCase(), ...cellAttrs(link) } : null,
buttons: Array.from(cell.querySelectorAll('button, i[class*="fa-"]')).slice(0, 4).map((b) => ({ tag: b.tagName.toLowerCase(), text: shape(b.textContent), ...cellAttrs(b) }))
};
}
report.tables = Array.from(document.querySelectorAll('table')).filter(vis).slice(0, 8).map((t) => {
const headers = Array.from(t.querySelectorAll('thead th, tr:first-child th')).map((th) => mask(th.textContent));
const rows = Array.from(t.querySelectorAll('tbody tr')).filter(vis);
return {
...attrs(t), headers, rowCount: rows.length,
rowRepeat: rows[0] ? maskDigits(rows[0].getAttribute('ng-repeat') || '') : '',
sampleRows: rows.slice(0, 3).map((r) => Array.from(r.children).map(describeCell))
};
});
// ag-grid (used for Konnect Live search results).
report.grids = Array.from(document.querySelectorAll('[role="grid"], .ag-root')).slice(0, 3).map((g) => ({
...attrs(g),
columns: Array.from(g.querySelectorAll('[role="columnheader"]')).map((h) => ({ colId: h.getAttribute('col-id'), text: mask(h.textContent) })),
rowCount: g.querySelectorAll('[role="row"][row-index]').length
}));

// Angular repeats on the page, with how many items each renders.
const repeats = {};
document.querySelectorAll('[ng-repeat]').forEach((el) => {
const k = maskDigits(el.getAttribute('ng-repeat')).slice(0, 120);
repeats[k] = (repeats[k] || 0) + 1;
});
report.repeats = repeats;

// Konnect Live timeline: the data keys on each item and the outcome text,
// grouped by item type. Descriptions are cut to their first line.
if (report.angular) {
const rows = Array.from(document.querySelectorAll('div.row.ng-scope[ng-repeat*="customerTimeLine"]'));
const byType = {};
rows.forEach((row) => {
let item = null;
try { item = angular.element(row).scope().item; } catch (e) { /* not an Angular row */ }
if (!item) return;
const type = String(item.TimelineItemType);
const bucket = byType[type] || (byType[type] = { count: 0, keys: {}, descriptions: {}, headings: {} });
bucket.count++;
Object.keys(item).filter((k) => !k.startsWith('$')).forEach((k) => {
const v = item[k];
const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
bucket.keys[k] = kind + (kind === 'string' ? `(${String(v).length})` : '');
});
const firstLine = mask(String(item.Description || '').split(/\r?\n/)[0]);
bucket.descriptions[firstLine] = (bucket.descriptions[firstLine] || 0) + 1;
const heading = mask((row.querySelector('[class*="connected-customer-title"]') || {}).textContent);
bucket.headings[heading] = (bucket.headings[heading] || 0) + 1;
});
report.timeline = { rows: rows.length, byType };
}

// An open lead modal: field labels, tabs and the size of each notes field.
const modal = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).find(vis);
if (modal) {
report.modal = {
...attrs(modal),
tabs: Array.from(modal.querySelectorAll('.nav-tabs a, [role="tab"]')).map((a) => ({ text: mask(a.textContent), ...attrs(a) })),
labels: Array.from(modal.querySelectorAll('label, th, td:first-child, dt, .control-label, footer strong'))
.map((l) => clean(l.textContent)).filter((t) => t && t.length < 40 && !/@|\d{5,}/.test(t)).slice(0, 120),
fields: Array.from(modal.querySelectorAll('textarea, input, [id^="txt"], [contenteditable="true"]')).map((f) => ({
tag: f.tagName.toLowerCase(), ...attrs(f), value: undefined, contentLength: clean(f.value || f.textContent).length
})),
controls: Array.from(modal.querySelectorAll('button, a[ng-click]')).filter(vis).map((b) => ({ text: mask(b.textContent), ...attrs(b) }))
};
}

// Angular data behind the screens this check needs: Call History
// (surveyAttemptData), Follow Up (surveyDetailData), the export file list,
// the agent desktop's live activities and an open lead's own record.
// Values are kept only for fields that describe the process (outcomes,
// types, states, dates, dealers, campaigns, IDs); anything that could be
// customer data is reduced to its type and length.
const SAFE_KEY = /outcome|type|state|status|date|time|dealer|campaign|source|attempt|brand|module|agent|advisor|severity|enquiry|request|created|completed|recreating|sent|id$/i;
const UNSAFE_KEY = /name|email|phone|mobile|landline|reg|note|comment|description|address|postcode|content|token|url|href|message|text/i;
// Dealer, campaign, source and outcome values are what the check is about,
// so they are kept even when the key also says "Name".
const PROCESS_KEY = /^(?!.*customer).*(dealer|campaign|source|brand|outcome|status|state)/i;
const keepValue = (key) => PROCESS_KEY.test(key) || (SAFE_KEY.test(key) && !UNSAFE_KEY.test(key));
function safeValue(key, v, depth) {
if (v === null || v === undefined) return v;
if (Array.isArray(v)) return depth > 0 ? v.slice(0, 3).map((x) => safeValue(key, x, depth - 1)).concat(v.length > 3 ? [`(+${v.length - 3} more)`] : []) : `array(${v.length})`;
if (typeof v === 'object') return depth > 0 ? safeObject(v, depth - 1) : 'object';
if (typeof v === 'string') return keepValue(key) ? mask(v) : `string(${v.length})`;
return keepValue(key) ? v : typeof v;
}
function safeObject(obj, depth) {
const out = {};
Object.keys(obj || {}).filter((k) => !k.startsWith('$')).slice(0, 80).forEach((k) => { out[k] = safeValue(k, obj[k], depth); });
return out;
}
if (report.angular) {
const scopeData = {};
const WANTED = /surveyAttemptData|surveyDetailData|exportFiles|liveActivities|Call\.RecentHistory|customerTimeLine/;
document.querySelectorAll('[ng-repeat]').forEach((el) => {
const expr = el.getAttribute('ng-repeat') || '';
if (!WANTED.test(expr)) return;
const key = expr.split(' in ')[0].trim();
let item = null;
try { item = angular.element(el).scope()[key]; } catch (e) { /* no scope */ }
if (!item || typeof item !== 'object') return;
const bucket = scopeData[maskDigits(expr).slice(0, 80)] || (scopeData[maskDigits(expr).slice(0, 80)] = []);
if (bucket.length < 6) bucket.push(safeObject(item, 1));
});
report.scopeData = scopeData;
// The open modal's own record (lead details, outcomes, dealer, next action).
const openModal = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).find(vis);
if (openModal) {
try {
const scope = angular.element(openModal.querySelector('.modal-content') || openModal).scope();
const records = {};
['results', 'survey', 'selected', 'lead', 'activity', 'theActivity'].forEach((name) => {
if (scope && scope[name] && typeof scope[name] === 'object') records[name] = safeObject(scope[name], 2);
});
report.modalRecord = records;
} catch (e) { report.modalRecord = 'unreadable'; }
}
}

// Short-lived things: open dropdowns, date pickers, popups, alerts and
// validation messages, plus the focused field. Most vanish on the next
// click, so the hotkey and the before-click snapshots are what catch them.
const TRANSIENT = '.dropdown-menu, .popover, .tooltip, .alert, .toast, .growl, .notification, [role="alert"], [role="tooltip"], [role="listbox"], .uib-datepicker-popup, .help-block, .has-error, .validation-message, .ng-invalid.ng-touched';
report.transient = Array.from(document.querySelectorAll(TRANSIENT)).filter(vis).slice(0, 40).map((el) => ({
tag: el.tagName.toLowerCase(), text: mask(el.textContent), ...attrs(el),
items: [...new Set(Array.from(el.querySelectorAll('a, li, button')).filter(vis).map((i) => mask(i.textContent)).filter(Boolean))].slice(0, 25)
}));
const active = document.activeElement;
report.focused = active && active !== document.body && !(window.__wbDiagnostics && window.__wbDiagnostics.contains(active)) ? { tag: active.tagName.toLowerCase(), ...attrs(active), contentLength: clean(active.value || '').length } : null;
return report;
}

const VERSION = 2;
// A tool's Report a problem button passes its own recent activity here,
// with customer names already replaced; emails, phones and regs are masked too.
function takeExtra() {
const extra = window.__wbDiagnosticsExtra;
window.__wbDiagnosticsExtra = null;
if (!extra || typeof extra !== 'object') return null;
const cleanLine = (t) => clean(t)
.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi, '<email>')
.replace(/(\+44\s?|\b0)7\d{3}\s?\d{3}\s?\d{3}\b/g, '<phone>')
.replace(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/g, '<reg>')
.slice(0, 200);
return { name: cleanLine(extra.tool), state: cleanLine(extra.state || ''), log: (Array.isArray(extra.log) ? extra.log : []).slice(-40).map(cleanLine) };
}

// Running the bookmarklet again while the panel is open takes a new
// snapshot in the same panel instead of starting over.
const existing = window.__wbDiagnostics;
if (existing && existing.wbApi && existing.wbApi.version === VERSION && document.body.contains(existing)) {
existing.wbApi.snap('bookmarklet run', takeExtra());
existing.wbApi.expand();
return;
}
if (existing) { if (existing.wbApi) existing.wbApi.destroy(); else existing.remove(); }

const HISTORY_MAX = 30;
const history = [];
const events = [];
let selected = -1;
let watching = false;
let collapsed = false;
let corner = 0;

// Short text lines per area of the page, used to say what changed between snapshots.
function signature(r) {
return {
page: [r.page.hash + ' ' + r.page.title],
controls: r.controls.map((c) => [c.tag, c.text, c['ng-click'] || '', c.disabled ? 'disabled' : ''].join(' | ')),
status: r.statusTexts.map((s) => s.text),
transient: r.transient.map((t) => `${t.class || t.tag}: ${t.text}`),
selects: r.selects.map((s) => `${s['ng-model'] || s.name || s.id || 'select'} = ${s.selected}`),
tables: r.tables.map((t) => `${t.class || 'table'}: ${t.headers.slice(0, 6).join(', ')} (${t.rowCount} rows)`),
modal: r.modal ? [`open: ${r.modal.class || ''}`] : [],
focused: r.focused ? [`${r.focused.tag} ${r.focused['ng-model'] || r.focused.id || r.focused.placeholder || ''}`] : []
};
}
function diff(a, b) {
const out = {};
Object.keys(b).forEach((k) => {
const before = new Set(a ? a[k] : []);
const after = new Set(b[k]);
const added = b[k].filter((x) => !before.has(x));
const removed = (a ? a[k] : []).filter((x) => !after.has(x));
if (added.length || removed.length) out[k] = { added: [...new Set(added)].slice(0, 40), removed: [...new Set(removed)].slice(0, 40) };
});
return out;
}
const countChanges = (changes) => Object.values(changes).reduce((n, c) => n + c.added.length + c.removed.length, 0);

const host = document.createElement('div');
const btn = 'padding:6px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;color:#1e293b;cursor:pointer;font:600 12px system-ui,sans-serif;';
host.innerHTML = '<div data-head style="display:flex;gap:6px;align-items:center;">'
+ '<strong style="flex:1;">Page diagnostics <span data-count style="font-weight:400;color:#5b6577;"></span></strong>'
+ '<button type="button" data-move title="Move to another corner" style="border:none;background:none;cursor:pointer;font-size:14px;">⇆</button>'
+ '<button type="button" data-collapse title="Shrink" style="border:none;background:none;cursor:pointer;font-size:16px;">–</button>'
+ '<button type="button" data-close aria-label="Close" style="border:none;background:none;font-size:18px;cursor:pointer;">×</button></div>'
+ '<div data-bodywrap>'
+ '<p style="margin:6px 0 8px;color:#5b6577;">Customer details are masked. <b>Alt+Shift+D</b> takes a snapshot without clicking, so open menus and popups are kept. <b>Watch</b> takes one before each click and after the page changes.</p>'
+ `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"><button type="button" data-snap style="${btn}background:#1e293b;color:#fff;border-color:#1e293b;">Snapshot now</button><button type="button" data-watch style="${btn}">Watch: off</button><button type="button" data-clear style="${btn}">Clear history</button></div>`
+ '<select data-list size="6" aria-label="Snapshots" style="width:100%;font:11px ui-monospace,monospace;box-sizing:border-box;"></select>'
+ '<textarea readonly aria-label="Diagnostics output" style="width:100%;height:150px;margin-top:6px;font:11px ui-monospace,monospace;box-sizing:border-box;"></textarea>'
+ `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;"><button type="button" data-copy="one" style="${btn}">Copy this</button><button type="button" data-copy="changes" style="${btn}" title="The first snapshot in full, then only what changed">Copy changes</button><button type="button" data-copy="all" style="${btn}">Copy all</button><span data-status style="color:#5b6577;"></span></div>`
+ '</div>';
const $ = (sel) => host.querySelector(sel);
const list = $('[data-list]');
const output = $('textarea');
const statusEl = $('[data-status]');
const CORNERS = ['top:16px;right:16px;', 'bottom:16px;right:16px;', 'bottom:16px;left:16px;', 'top:16px;left:16px;'];
function place() {
host.style.cssText = `position:fixed;${CORNERS[corner]}z-index:2147483647;width:${collapsed ? 'auto' : 'min(440px,calc(100vw - 32px))'};background:#fff;color:#1e293b;border:1px solid ${watching ? '#16a34a' : '#cbd5e1'};border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:13px system-ui,sans-serif;padding:${collapsed ? '6px 10px' : '12px 14px'};`;
$('[data-bodywrap]').style.display = collapsed ? 'none' : '';
$('[data-collapse]').textContent = collapsed ? '+' : '–';
$('[data-collapse]').title = collapsed ? 'Expand' : 'Shrink';
}

function label(i) {
const s = history[i];
const n = countChanges(s.changes);
const time = s.at.slice(11, 19);
return `${time}  ${s.label}${i === 0 ? '  (first)' : n ? `  · ${n} change${n === 1 ? '' : 's'}` : '  · no change'}`;
}
function render() {
list.innerHTML = '';
history.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = label(i); list.appendChild(o); });
if (selected >= history.length) selected = history.length - 1;
list.selectedIndex = selected;
const s = history[selected];
output.value = s ? JSON.stringify({ label: s.label, at: s.at, changes: s.changes, report: s.report }, null, 1) : '';
$('[data-count]').textContent = `· ${history.length} snapshot${history.length === 1 ? '' : 's'}${watching ? ' · watching' : ''}`;
$('[data-watch]').textContent = watching ? 'Watch: on' : 'Watch: off';
$('[data-watch]').style.background = watching ? '#dcfce7' : '#f8fafc';
place();
}

// The panel is hidden while the page is read so its own buttons are not listed.
function snap(why, tool, onlyIfChanged) {
const shown = host.style.display;
host.style.display = 'none';
let report;
try { report = collect(); } catch (e) { report = { error: String(e && e.message || e) }; }
host.style.display = shown;
if (tool) report.tool = tool;
const sig = report.controls ? signature(report) : null;
const prev = history[history.length - 1];
const changes = sig ? diff(prev && prev.sig, sig) : {};
if (onlyIfChanged && prev && !countChanges(changes)) return false;
history.push({ label: why, at: new Date().toISOString(), report, sig, changes: prev ? changes : {} });
while (history.length > HISTORY_MAX) history.shift();
selected = history.length - 1;
render();
return true;
}

function describe(el) {
const target = el.closest ? el.closest('button, a, [ng-click], td, th, li, label, input, select, textarea') || el : el;
const text = mask(target.textContent || target.value || target.getAttribute('title') || target.getAttribute('placeholder') || '');
return `${target.tagName.toLowerCase()}${target.getAttribute('ng-click') ? ` [${maskDigits(target.getAttribute('ng-click')).slice(0, 50)}]` : ''}${text ? ` "${text.slice(0, 40)}"` : ''}`;
}
function logEvent(text) {
events.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
if (events.length > 200) events.shift();
}

// Watch mode: a snapshot just before each click (the page state the click
// would wipe), then one when the page settles afterwards.
let settleTimer = null;
let lastAuto = 0;
const observer = new MutationObserver((records) => {
if (!watching || records.every((r) => host.contains(r.target))) return;
clearTimeout(settleTimer);
const wait = Math.max(500, 1000 - (Date.now() - lastAuto));
settleTimer = setTimeout(() => { lastAuto = Date.now(); snap('page changed', null, true); }, wait);
});
function onPointerDown(e) {
if (!watching || host.contains(e.target)) return;
const what = describe(e.target);
logEvent(`click ${what}`);
snap(`before click ${what}`);
}
function onHash() { logEvent(`page ${maskDigits(location.hash)}`); }
function onKey(e) {
if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD')) {
e.preventDefault();
e.stopPropagation();
logEvent('hotkey snapshot');
snap('hotkey');
}
}
function setWatch(on) {
watching = on;
if (on) {
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled', 'hidden'] });
logEvent('watch on');
} else {
observer.disconnect();
clearTimeout(settleTimer);
logEvent('watch off');
}
render();
}
document.addEventListener('pointerdown', onPointerDown, true);
window.addEventListener('keydown', onKey, true);
window.addEventListener('hashchange', onHash);

// Clicks on the panel stay in the panel, so the page does not close its
// open menus or date pickers and keeps focus where it was.
['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) => host.addEventListener(type, (e) => {
if (type === 'mousedown' && e.target.closest('button')) e.preventDefault();
e.stopPropagation();
}));

async function copy(kind) {
let data;
const base = { tool: 'Page diagnostics', copiedAt: new Date().toISOString(), page: location.origin, events };
if (kind === 'one') { const s = history[selected]; data = s ? { label: s.label, at: s.at, changes: s.changes, report: s.report } : {}; }
else if (kind === 'changes') data = { ...base, snapshots: history.map((s, i) => (i === 0 ? { label: s.label, at: s.at, report: s.report } : { label: s.label, at: s.at, changes: s.changes, transient: s.report.transient, focused: s.report.focused, tool: s.report.tool })) };
else data = { ...base, snapshots: history.map((s) => ({ label: s.label, at: s.at, changes: s.changes, report: s.report })) };
const text = JSON.stringify(data, null, 1);
try { await navigator.clipboard.writeText(text); statusEl.textContent = `Copied (${Math.round(text.length / 1024)} KB)`; }
catch (e) { output.value = text; output.select(); statusEl.textContent = 'Clipboard blocked: press Ctrl+C'; }
}

function destroy() {
observer.disconnect();
clearTimeout(settleTimer);
document.removeEventListener('pointerdown', onPointerDown, true);
window.removeEventListener('keydown', onKey, true);
window.removeEventListener('hashchange', onHash);
host.remove();
if (window.__wbDiagnostics === host) window.__wbDiagnostics = null;
}

$('[data-close]').addEventListener('click', destroy);
$('[data-snap]').addEventListener('click', () => { logEvent('manual snapshot'); snap('manual'); });
$('[data-watch]').addEventListener('click', () => setWatch(!watching));
$('[data-clear]').addEventListener('click', () => { history.length = 0; events.length = 0; selected = -1; statusEl.textContent = ''; render(); });
$('[data-collapse]').addEventListener('click', () => { collapsed = !collapsed; place(); });
$('[data-move]').addEventListener('click', () => { corner = (corner + 1) % CORNERS.length; place(); });
list.addEventListener('change', () => { selected = list.selectedIndex; render(); });
host.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.getAttribute('data-copy'))));

host.wbApi = { version: VERSION, snap, destroy, expand: () => { collapsed = false; place(); } };
place();
document.body.appendChild(host);
window.__wbDiagnostics = host;
snap('opened', takeExtra());
})();
