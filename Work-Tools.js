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
// Pure. Where Konnect Live's small window goes: the size and place it was
// last left in, kept on the screen, or 520 by 420 in the bottom left.
function smallWindowBox(saved, area) {
const num = (value, fallback) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback);
const s = saved && typeof saved === 'object' ? saved : {};
const a = area || {};
const areaLeft = num(a.availLeft, 0);
const areaTop = num(a.availTop, 0);
const areaWidth = Math.max(200, num(a.availWidth, 1280));
const areaHeight = Math.max(200, num(a.availHeight, 800));
const clamp = (value, low, high) => Math.round(Math.max(low, Math.min(high, value)));
const width = clamp(num(s.width, 520), Math.min(360, areaWidth), areaWidth);
const height = clamp(num(s.height, 420), Math.min(300, areaHeight), areaHeight);
return {
width, height,
left: clamp(num(s.left, areaLeft), areaLeft, areaLeft + areaWidth - width),
top: clamp(num(s.top, areaTop + areaHeight - height), areaTop, areaTop + areaHeight - height)
};
}
window.WorkTools = { toolsForPage, toolForPage, smallWindowBox };

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

// THE SMALL WINDOW. Konnect Live stops drawing, and a check stalls, when its
// tab sits behind another. So on the tab SLA Manager opened, the Lead
// Checker is put into a small window of its own (a pop-up has no bookmarks
// bar to click Work Tools on), which is given SLA Manager's window for the
// link, and this tab closes. The Lead Checker's More menu turns this off.
const SMALL_NAME = 'workToolsLiveSmall';
const SMALL_KEY = '_klcSmallWindow';
const SMALL_BOX_KEY = '_klcSmallWindowBox';
const stored = (key) => { try { return localStorage.getItem(key); } catch (error) { return null; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function smallNote(text, stay) {
const old = document.getElementById('_workToolsSmallNote');
if (old) old.remove();
const note = document.createElement('div');
note.id = '_workToolsSmallNote';
note.setAttribute('role', 'status');
note.textContent = text;
note.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;max-width:min(420px,90vw);padding:10px 16px;border-radius:12px;background:#1c1c1e;color:#fff;border:2px solid #C2CB42;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 6px 16px rgba(15,23,42,.25);';
document.body.appendChild(note);
if (!stay) setTimeout(() => note.remove(), 9000);
}
// SLA Manager's window: this tab's opener, on another site. A Konnect Live
// tab opened by hand has none, and one opened from Konnect Live itself has
// an opener this page can read, which is not SLA Manager.
function managerOpener() {
let opener = null;
try { opener = window.opener && !window.opener.closed ? window.opener : null; } catch (error) { return null; }
if (!opener) return null;
try { return opener.location.href ? null : opener; } catch (error) { return opener; }
}
const leadChecker = tools.find((t) => t.file === 'Konnect-Lead-Checker.js');
const manager = leadChecker && stored(SMALL_KEY) !== 'off' && window.name !== SMALL_NAME && !window.__konnectLeadChecker ? managerOpener() : null;
let small = null;
let smallProblem = '';
if (manager) {
// A click while the small window is still being set up shows it.
if (window.__workToolsSmall && !window.__workToolsSmall.closed) {
try { window.__workToolsSmall.focus(); } catch (error) { /* still there */ }
return;
}
// Opened now, before anything is waited for, while the click still lets
// a window open. An empty address finds a small window that is already
// open without reloading it.
let box = null;
try { box = JSON.parse(stored(SMALL_BOX_KEY)); } catch (error) { /* the default is used */ }
box = smallWindowBox(box, window.screen);
try {
const win = window.open('', SMALL_NAME, `popup=yes,width=${box.width},height=${box.height},left=${box.left},top=${box.top}`);
if (!win) smallProblem = 'Allow pop-ups for Konnect Live to use the small window. The Lead Checker is running in this tab for now.';
else {
small = { win, fresh: win.location.href === 'about:blank' };
if (small.fresh) win.location.replace(location.href);
}
} catch (error) {
small = null;
smallProblem = 'The small window could not be reached, so the Lead Checker is running in this tab.';
}
}
// Whether the small window has finished loading Konnect Live: the same
// address twice running, and the menu bar or the login box drawn (or eight
// seconds gone, for a page that has neither).
function smallLooksReady(win, seen) {
const href = win.location.href;
if (!href || href === 'about:blank' || win.location.origin !== location.origin) return false;
const doc = win.document;
if (doc.readyState !== 'complete' || !doc.body) return false;
if (seen.href !== href) { seen.href = href; seen.at = Date.now(); return false; }
const drawn = !!doc.querySelector('nav.navbar.navbar-inverse.navbar-fixed-top ul.nav.navbar-right.top-nav, input[type="password"]');
return drawn || Date.now() - seen.at > 8000;
}
// Puts the Lead Checker into the small window and stays until it is running
// there. On the login page the Lead Checker waits for the login itself; if
// that reloads the page it is put in again from here. Returns false when
// this tab should run the Lead Checker after all.
async function runInSmallWindow() {
const win = small.win;
const giveUp = (why) => {
smallProblem = why;
if (small.fresh) { try { win.close(); } catch (error) { /* left open */ } }
return false;
};
const fetched = fetch(`${BASE}${leadChecker.file}?_=${Date.now()}`)
.then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
.then((code) => ({ code }), (error) => ({ error }));
smallNote('Opening the Lead Checker in the small window.', true);
const startedAt = Date.now();
const seen = { href: '', at: 0 };
let putIn = 0;
// The page the Lead Checker was last put into: once is enough for each.
let putInto = null;
let steered = false;
for (;;) {
await sleep(250);
let state = 'wait';
try {
if (win.closed) state = 'closed';
else if (win.__konnectLeadChecker) state = win.__konnectLeadChecker.getSession ? 'running' : 'login';
else if (win.document !== putInto && smallLooksReady(win, seen)) state = 'ready';
// A new window still blank after three seconds is sent the address again.
else if (small.fresh && !steered && Date.now() - startedAt > 3000 && win.location.href === 'about:blank') { steered = true; win.location.href = location.href; }
} catch (error) { /* between pages: looked at again */ }
if (state === 'running') {
try { win.__konnectLeadChecker.focus(); win.focus(); } catch (error) { /* it is running all the same */ }
smallNote('The Lead Checker is running in the small window.', true);
// This tab was opened by SLA Manager, so it may close itself. A second
// click that only found the window leaves the tab alone.
if (putIn > 0) setTimeout(() => { try { window.close(); } catch (error) { /* the note stays */ } }, 700);
return true;
}
if (state === 'closed') {
if (putIn === 0) return giveUp('The small window was closed, so the Lead Checker is running in this tab.');
smallNote('The small window was closed. Click Work Tools to open it again.', true);
return true;
}
if (state === 'ready') {
const got = await fetched;
if (got.error) {
if (putIn === 0) return giveUp('');
smallNote(`Could not load the Lead Checker again: ${got.error.message}. Click Work Tools to try again.`, true);
return true;
}
try {
win.__workToolsManager = manager;
putInto = win.document;
win.Function(got.code)();
putIn++;
} catch (error) {
if (putIn === 0) return giveUp('The small window could not be reached, so the Lead Checker is running in this tab.');
}
continue;
}
if (state === 'login') smallNote('Log in on the small window. The Lead Checker opens there once you are in.', true);
if (putIn === 0 && Date.now() - startedAt > 60000) return giveUp('The small window did not load, so the Lead Checker is running in this tab.');
if (Date.now() - startedAt > 30 * 60 * 1000) {
smallNote('Still waiting for the small window. Click Work Tools again once you are logged in.', true);
return true;
}
}
}

window.__workToolsLoadingAt = Date.now();
try {
if (small) {
window.__workToolsSmall = small.win;
let moved = false;
try { moved = await runInSmallWindow(); } finally { window.__workToolsSmall = null; }
if (moved) return;
}
// The booking system in Konnect Notes is for the owner only for now, so only
// this bookmark switches it on; the Konnect Tools bookmark gives call notes only.
if (tools.some((t) => t.file === 'Konnect-Notes.js')) window.KonnectNotesOwner = true;
// Lead Re setup starts as its button, not an open panel, on its first load.
window.WorkToolsStartTucked = true;
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
if (smallProblem) smallNote(smallProblem);
else if (small) document.getElementById('_workToolsSmallNote')?.remove();
} finally {
window.__workToolsLoadingAt = 0;
}
})();
