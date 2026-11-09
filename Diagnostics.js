// Page diagnostics for building the National leads check.
//
// Run it on a Konnect page and it collects the page's structure (buttons,
// links, table headers, search options, field labels, Angular data keys)
// so a new automated step can be written against the real page. Customer
// data is masked: names, emails, phone numbers and note text are reduced
// to their length or shape. Look over the output before sharing it.

(function () {
if (window.__wbDiagnostics) { window.__wbDiagnostics.remove(); }

const MAX = 60;
const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Keeps labels readable but strips anything that looks like customer data.
function mask(s) {
return clean(s)
.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi, '<email>')
.replace(/(\+44\s?|\b0)7\d{3}\s?\d{3}\s?\d{3}\b/g, '<phone>')
.replace(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/g, '<reg>')
.slice(0, MAX);
}
const maskDigits = (s) => clean(s).replace(/\d+/g, '9');
// Shape only: "Mr John Smith" becomes "Aa Aaaa Aaaaa".
const shape = (s) => clean(s).replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9').slice(0, 30);
function attrs(el) {
const out = {};
for (const name of ['id', 'class', 'href', 'ng-click', 'ng-href', 'ng-model', 'ng-repeat', 'ng-if', 'ng-show', 'ui-sref', 'title', 'type', 'name', 'value', 'download', 'role', 'col-id', 'data-toggle', 'aria-label']) {
const v = el.getAttribute && el.getAttribute(name);
if (v) out[name] = maskDigits(v).slice(0, 140);
}
return out;
}

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
const text = mask(el.textContent || el.value || el.getAttribute('title') || el.getAttribute('aria-label'));
return { tag: el.tagName.toLowerCase(), text, relevant: KEY.test(text + ' ' + (el.getAttribute('ng-click') || '')), ...attrs(el) };
})
.filter((c) => c.text || c['ng-click'])
.slice(0, 300);

// Radio buttons and selects: the Konnect Live search type options live here.
report.radios = Array.from(document.querySelectorAll('input[type="radio"]')).map((r) => ({
name: r.name, value: r.value, checked: r.checked,
label: mask((r.closest('label') || document.querySelector(`label[for="${r.id}"]`) || r.parentElement || {}).textContent)
}));
report.selects = Array.from(document.querySelectorAll('select')).filter(vis).map((s) => ({
...attrs(s), options: Array.from(s.options).slice(0, 40).map((o) => mask(o.textContent))
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
function describeCell(cell) {
const link = cell.querySelector('a, [ng-click]');
return {
textShape: shape(cell.textContent),
link: link ? { tag: link.tagName.toLowerCase(), ...attrs(link) } : null,
buttons: Array.from(cell.querySelectorAll('button, i[class*="fa-"]')).slice(0, 4).map((b) => ({ tag: b.tagName.toLowerCase(), text: mask(b.textContent), ...attrs(b) }))
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

const json = JSON.stringify(report, null, 1);

const host = document.createElement('div');
host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:min(420px,calc(100vw - 32px));background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:13px system-ui,sans-serif;padding:14px;';
host.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>Page diagnostics</strong><button type="button" aria-label="Close" data-close style="border:none;background:none;font-size:18px;cursor:pointer;">×</button></div>'
+ '<p style="margin:0 0 8px;color:#5b6577;">Structure of this page, with customer details masked. Copy it and paste it back into the chat.</p>'
+ '<textarea readonly aria-label="Diagnostics output" style="width:100%;height:180px;font:11px ui-monospace,monospace;box-sizing:border-box;"></textarea>'
+ '<button type="button" data-copy style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;background:#1e293b;color:#fff;cursor:pointer;font-weight:600;">Copy</button> <span data-status style="color:#5b6577;"></span>';
host.querySelector('textarea').value = json;
host.querySelector('[data-close]').addEventListener('click', () => host.remove());
host.querySelector('[data-copy]').addEventListener('click', async () => {
const status = host.querySelector('[data-status]');
try { await navigator.clipboard.writeText(json); status.textContent = `Copied (${Math.round(json.length / 1024)} KB)`; }
catch (e) { host.querySelector('textarea').select(); status.textContent = 'Clipboard blocked: press Ctrl+C'; }
});
document.body.appendChild(host);
window.__wbDiagnostics = host;
})();
