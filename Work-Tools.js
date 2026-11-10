// One bookmark for the work tools: loads the right ones for the page, always
// from main. The Konnect Tools bookmark other staff use is separate and
// unchanged; this one loads the same Konnect Notes and Reg Check files.
(async function () {
const BASE = 'https://raw.githubusercontent.com/OmariDC/WorkBookmarklets/main/';

// Pure. The tools that belong on this page, in load order.
function toolsForPage(host, path) {
const h = String(host || '').toLowerCase();
const p = String(path || '').toLowerCase();
const regCheck = { file: 'Reg-Check.js', name: 'Reg Check', loaded: () => !!window._regCheckHotkeyInstalled };
if (/(^|\.)carbot\.ai$/.test(h)) return [{ file: 'Konnect-Lead-Checker.js', name: 'Lead Checker' }, regCheck];
if (/(^|\.)konnectonlineservices\.co\.uk$/.test(h)) {
if (p.includes('agent-desktop')) {
return [
// A second load of Konnect Notes opens or closes its phrase list, so
// it is only loaded when it is not on the page yet.
{ file: 'Konnect-Notes.js', name: 'Konnect Notes', loaded: () => !!(window.KonnectNotes && window.KonnectNotes.version) },
regCheck,
{ file: 'Lead-Reset.js', name: 'Lead Re setup' }
];
}
return [{ file: 'SLA-Manager.js', name: 'SLA Manager' }, regCheck];
}
return [];
}
// The page's own work tool (not Konnect Notes or Reg Check).
function toolForPage(host, path) {
return toolsForPage(host, path).find((t) => !t.loaded) || null;
}
window.WorkTools = { toolsForPage, toolForPage };

const tools = toolsForPage(location.hostname, location.pathname);
if (tools.length === 0) {
alert('Work Tools runs on Konnect Live, Konnect Manager or the agent desktop.');
return;
}
for (const tool of tools) {
if (tool.loaded && tool.loaded()) continue;
try {
const response = await fetch(`${BASE}${tool.file}?_=${Date.now()}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
Function(await response.text())();
} catch (error) {
alert(`Could not load ${tool.name}: ${error && error.message}`);
}
}
})();
