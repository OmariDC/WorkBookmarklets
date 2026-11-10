// One bookmark for the work tools: loads the right one for the page, always
// from main. Separate from the Konnect Tools bookmark (Konnect Notes and Reg
// Check) that other agents use.
(async function () {
const BASE = 'https://raw.githubusercontent.com/OmariDC/WorkBookmarklets/main/';

// Pure. Which tool belongs on this page, or null.
function toolForPage(host, path) {
const h = String(host || '').toLowerCase();
const p = String(path || '').toLowerCase();
if (/(^|\.)carbot\.ai$/.test(h)) return { file: 'Konnect-Lead-Checker.js', name: 'Lead Checker' };
if (/(^|\.)konnectonlineservices\.co\.uk$/.test(h)) {
if (p.includes('agent-desktop')) return { file: 'Lead-Reset.js', name: 'Lead Re setup' };
return { file: 'SLA-Manager.js', name: 'SLA Manager' };
}
return null;
}
window.WorkTools = { toolForPage };

const tool = toolForPage(location.hostname, location.pathname);
if (!tool) {
alert('Work Tools runs on Konnect Live, Konnect Manager or the agent desktop.');
return;
}
try {
const response = await fetch(`${BASE}${tool.file}?_=${Date.now()}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
Function(await response.text())();
} catch (error) {
alert(`Could not load ${tool.name}: ${error && error.message}`);
}
})();
