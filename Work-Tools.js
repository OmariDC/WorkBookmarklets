// One bookmark for the work tools: loads the right ones for the page, always
// from main. The Konnect Tools bookmark other staff use is separate and
// unchanged; this one loads the same Konnect Notes and Reg Check files.
(async function () {
const BASE = 'https://raw.githubusercontent.com/OmariDC/WorkBookmarklets/main/';

// Pure. The tools that belong on this page, in load order. main marks the
// page's own work tool; loaded says a tool is on the page already, and show
// brings such a tool back into view in place of a second copy.
function toolsForPage(host, path) {
const h = String(host || '').toLowerCase();
const p = String(path || '').toLowerCase();
if (/(^|\.)carbot\.ai$/.test(h)) return [{ file: 'Konnect-Lead-Checker.js', name: 'Lead Checker', main: true }];
if (/(^|\.)konnectonlineservices\.co\.uk$/.test(h)) {
if (p.includes('agent-desktop')) {
const leadReSetup = () => window._leadResetInstance;
return [
// A second load of Konnect Notes opens or closes its phrase list, so
// it is only loaded when it is not on the page yet.
{ file: 'Konnect-Notes.js', name: 'Konnect Notes', loaded: () => !!(window.KonnectNotes && window.KonnectNotes.version) },
// Reg Check is loaded by Work Tools on the agent desktop only;
// elsewhere it has its own bookmark.
{ file: 'Reg-Check.js', name: 'Reg Check', loaded: () => !!window._regCheckHotkeyInstalled },
// A run may be going or paused in Lead Re setup, so a second click
// shows the panel that is there. It is only fetched again when it
// says a newer version can take over (never during a run).
{ file: 'Lead-Reset.js', name: 'Lead Re setup', main: true,
loaded: () => !!(leadReSetup() && !leadReSetup().replaceable()),
show: () => leadReSetup().show() }
];
}
return [{ file: 'SLA-Manager.js', name: 'SLA Manager', main: true }];
}
return [];
}
// The page's own work tool (not Konnect Notes or Reg Check).
function toolForPage(host, path) {
return toolsForPage(host, path).find((t) => t.main) || null;
}
window.WorkTools = { toolsForPage, toolForPage };

const tools = toolsForPage(location.hostname, location.pathname);
if (tools.length === 0) {
alert('Work Tools runs on Konnect Live, Konnect Manager or the agent desktop.');
return;
}
// A fast double click must not load anything twice: the second click is
// dropped while the first is still fetching.
if (Date.now() - (window.__workToolsLoadingAt || 0) < 15000) return;
window.__workToolsLoadingAt = Date.now();
try {
// The Booking Builder in Konnect Notes is still being tested, so only this
// bookmark switches it on; the Konnect Tools bookmark leaves it off.
if (tools.some((t) => t.file === 'Konnect-Notes.js')) window.KonnectNotesBooking = true;
for (const tool of tools) {
try {
if (tool.loaded && tool.loaded()) {
if (tool.show) tool.show();
continue;
}
const response = await fetch(`${BASE}${tool.file}?_=${Date.now()}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
Function(await response.text())();
} catch (error) {
alert(`Could not load ${tool.name}: ${error && error.message}`);
}
}
} finally {
window.__workToolsLoadingAt = 0;
}
})();
