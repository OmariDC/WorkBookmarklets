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
// HIDE AND SHOW. Alt+H takes every tool's buttons and panels off the screen
// and brings them back. Nothing is stopped: runs, the link and shortcuts
// carry on. Kept for the tab in sessionStorage, as the tools redraw their
// buttons when the page changes. A tool that needs the agent calls
// WorkTools.show(), so a hidden pause is never missed.
const HIDE_KEY = '_workToolsHidden';
const HIDE_STYLE_ID = '_workToolsHideStyle';
const HIDE_SELECTOR = ['#_slaBadge', '#_slaBadgeNavItem', '#_slaPanel', '#_slaAvatarAssignPopover', '#_slaLinkToast',
'#_klcNavItem', '#_klcBadge', '#_klcPanelHost',
'#_leadResetPanel', '#_leadResetButton', '#_leadResetRailSection', '#_leadResetNotice',
'[id^="kn-"]:not(style)', '.kn-ui', '.kn-launcher', '.kn-launcher-section', '.kn-phone-launcher', '.kn-inbound-launcher', '#_regCheckNotice'].join(', ');
function toolsHidden() {
try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch (error) { return !!document.getElementById(HIDE_STYLE_ID); }
}
function hideNote(text) {
const old = document.getElementById('_workToolsHideNote');
if (old) old.remove();
const note = document.createElement('div');
note.id = '_workToolsHideNote';
note.setAttribute('role', 'status');
note.textContent = text;
note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;background:#1c1c1e;color:#fff;font:600 12.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 6px 16px rgba(15,23,42,.25);';
document.body.appendChild(note);
setTimeout(() => note.remove(), 2500);
}
function setToolsHidden(hidden, quiet) {
try { sessionStorage.setItem(HIDE_KEY, hidden ? '1' : '0'); } catch (error) { /* Still hidden for now, just not remembered. */ }
let style = document.getElementById(HIDE_STYLE_ID);
if (hidden && !style) {
style = document.createElement('style');
style.id = HIDE_STYLE_ID;
// The two :not() parts only add weight, so this beats a tool's own
// "display: ... !important" rule for its button.
style.textContent = `:is(${HIDE_SELECTOR}):not(#_wtA):not(#_wtB) { display: none !important; visibility: hidden !important; }`;
document.head.appendChild(style);
} else if (!hidden && style) style.remove();
if (!quiet) hideNote(hidden ? 'Work Tools hidden. Still running. Alt+H brings them back.' : 'Work Tools showing.');
}
window.WorkTools.hidden = toolsHidden;
window.WorkTools.hide = () => setToolsHidden(true);
window.WorkTools.show = (why) => { if (toolsHidden()) { setToolsHidden(false, true); hideNote(why || 'Work Tools showing.'); } };
window.__workToolsToggleHide = () => setToolsHidden(!toolsHidden());
if (!window.__workToolsHideKey) {
window.__workToolsHideKey = true;
document.addEventListener('keydown', (event) => {
if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.code === 'KeyH' || String(event.key).toLowerCase() === 'h')) {
event.preventDefault();
window.__workToolsToggleHide();
}
}, true);
}
// Clicking the bookmark again always brings the tools back.
if (toolsHidden()) setToolsHidden(false, true);

// A fast double click must not load anything twice: the second click is
// dropped while the first is still fetching.
if (Date.now() - (window.__workToolsLoadingAt || 0) < 15000) return;
window.__workToolsLoadingAt = Date.now();
try {
// The booking system in Konnect Notes is for the owner only for now, so only
// this bookmark switches it on; the Konnect Tools bookmark gives call notes only.
if (tools.some((t) => t.file === 'Konnect-Notes.js')) window.KonnectNotesOwner = true;
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
