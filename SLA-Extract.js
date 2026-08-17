(function() {
const BADGE_ID = '_slaBadge';
const BADGE_COLOR = '#2c3e50';
const BADGE_BORDER_COLOR = '#27ae60';
const PANEL_ID = '_slaPanel';
const PANEL_BOX_ID = '_slaPanelBox';
const PANEL_STATE_KEY = '_slaPanelState';
const PANEL_SIZE_KEY = '_slaPanelSize';

let badge = null;
let panelElement = null;
let extracting = false;
let currentCustomers = [];

function categorizeTier(campaign, source) {
const camp = campaign.toLowerCase();
const src = source.toLowerCase();

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

function findDetailModal() {
return document.querySelector('[role="alertdialog"]') || document.querySelector('.modal');
}

function waitForModal(timeout = 3000) {
return new Promise((resolve) => {
const existing = findDetailModal();
if (existing) {
resolve(existing);
return;
}

const timer = setTimeout(() => {
observer.disconnect();
resolve(null);
}, timeout);

const observer = new MutationObserver(() => {
const modal = findDetailModal();
if (modal) {
clearTimeout(timer);
observer.disconnect();
resolve(modal);
}
});
observer.observe(document.body, { childList: true, subtree: true });
});
}

async function extractCustomerDetails(customerElement) {
const nameLink = customerElement.querySelector('a');
if (!nameLink) {
return { phone: '', email: '' };
}

nameLink.click();

const modal = await waitForModal();
if (!modal) {
return { phone: '', email: '' };
}

// Give the modal's async content a brief moment to render after it mounts.
await new Promise(resolve => setTimeout(resolve, 150));

try {
const modalText = modal.innerText || modal.textContent;

const phoneMatch = modalText.match(/\b(07\d{9}|0\d{3}\s?\d{3}\s?\d{3,4}|0\d{10})\b/);
const phone = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : '';

const emailMatch = modalText.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
const email = emailMatch ? emailMatch[1] : '';

const closeBtn = modal.querySelector('.close, [aria-label*="close"], [aria-label*="Close"]')
|| modal.querySelector('button:last-child');
if (closeBtn) {
closeBtn.click();
} else {
const escEvent = new KeyboardEvent('keydown', {
key: 'Escape',
code: 'Escape',
keyCode: 27,
which: 27,
bubbles: true
});
document.dispatchEvent(escEvent);
}

return { phone, email };
} catch (error) {
console.warn('Detail extraction error:', error);
return { phone: '', email: '' };
}
}

function copyToClipboard(text, element) {
const originalText = element.textContent;
navigator.clipboard.writeText(text).then(() => {
element.textContent = '✓ Copied!';
element.style.background = '#27ae60';
element.style.color = 'white';
setTimeout(() => {
element.textContent = originalText;
element.style.background = '';
element.style.color = '';
}, 1500);
}).catch((error) => {
console.warn('Copy failed:', error);
element.textContent = '✗ Failed';
element.style.background = '#e74c3c';
element.style.color = 'white';
setTimeout(() => {
element.textContent = originalText;
element.style.background = '';
element.style.color = '';
}, 1500);
});
}

function escapeHtml(value) {
return String(value).replace(/[&<>"']/g, (c) => ({
'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
}

function stripTitle(name) {
return name.replace(/^(mr|mrs|miss|ms|mx|dr|prof|rev|sir|lady)\.?\s+/i, '').trim();
}

function renderCopyableField(value) {
if (!value) {
return `<span style="padding: 4px 6px; border-radius: 4px; background: #ecf0f1; color: #95a5a6; display: inline-block; font-size: 13px;">N/A</span>`;
}
const display = escapeHtml(value);
return `<span class="sla-copyable" data-value="${display}" style="cursor: pointer; padding: 4px 6px; border-radius: 4px; background: #e8f4f8; color: #2c3e50; display: inline-block; font-size: 13px;">${display}</span>`;
}

function resetBookmarklet() {
currentCustomers = [];
extracting = false;

if (panelElement) {
panelElement.remove();
panelElement = null;
}

if (badge) {
badge.remove();
badge = null;
}

console.info('🔄 SLA Extractor stopped - click bookmarklet again to run');
}

function displayPanel(customers, newCount = 0, removedCount = 0) {
currentCustomers = customers;
const tiered = {
tier1: customers.filter(c => c.tier === 1),
tier2: customers.filter(c => c.tier === 2),
tier3: customers.filter(c => c.tier === 3),
tier4: customers.filter(c => c.tier === 4)
};

const panelSize = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
const isFull = panelSize === 'full';
const positionStyle = isFull
? 'top: 0; right: 0; bottom: 0; height: 100vh; width: 450px; border-radius: 0;'
: 'bottom: 20px; right: 20px; width: 400px; height: min(560px, calc(100vh - 90px)); border-radius: 16px;';

const panelHTML = `
<div id="${PANEL_BOX_ID}" style="position: fixed; ${positionStyle}
background: #f8f9fa; box-shadow: 0 8px 30px rgba(0,0,0,0.25);
z-index: 100000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
display: flex; flex-direction: column; transition: transform 0.3s ease;">

<div style="position: sticky; top: 0; background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 20px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #27ae60;
flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
<div style="display: flex; align-items: center; gap: 12px;">
<h2 style="margin: 0; font-size: 18px; font-weight: 700;">SLA Report</h2>
<span style="background: #27ae60; color: white; padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 600;">${customers.length}</span>
${newCount > 0 ? `<span style="background: #f39c12; color: white; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 600;">+${newCount}</span>` : ''}
${removedCount > 0 ? `<span style="background: #7f8c8d; color: white; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 600;">−${removedCount}</span>` : ''}
</div>
<div style="display: flex; gap: 8px;">
<button onclick="window._toggleSlaPanelSize();"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;"
title="${isFull ? 'Shrink to box' : 'Expand to full height'}">${isFull ? '⤡' : '⤢'}</button>
<button onclick="document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0;"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;"
title="Top">↑</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_BOX_ID}'); if (!panel) return; const btn = event.target; const isHidden = panel.style.transform === 'translateX(150%)'; panel.style.transform = isHidden ? '' : 'translateX(150%)'; btn.textContent = isHidden ? '−' : '□'; localStorage.setItem('${PANEL_STATE_KEY}', isHidden ? 'visible' : 'hidden'); })();"
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;"
title="Minimize">−</button>
</div>
</div>

<div class="panelContent" style="flex: 1; overflow-y: auto; padding: 20px; padding-right: 12px;">
${customers.length === 0 ? `
<div style="padding: 40px 20px; text-align: center;">
<div style="font-size: 56px; margin-bottom: 16px;">📭</div>
<h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">No Leads in Queue</h3>
<p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.6;">The SLA queue is empty. Check back when new leads arrive.</p>
</div>
` : `
${renderTierSection('Tier 1 - Priority', tiered.tier1, '#e74c3c', 'tier1')}
${renderTierSection('Tier 2 - High', tiered.tier2, '#f39c12', 'tier2')}
${renderTierSection('Tier 3 - Medium', tiered.tier3, '#3498db', 'tier3')}
${renderTierSection('Tier 4 - Standard', tiered.tier4, '#95a5a6', 'tier4')}
`}
</div>

<div style="border-top: 1px solid #ddd; padding: 14px; background: white; flex-shrink: 0; display: flex; gap: 10px; box-shadow: 0 -2px 8px rgba(0,0,0,0.05);">
<button onclick="(function() { if (confirm('Clear all data and stop?')) { window._slaResetBookmarklet(); } })();"
style="flex: 1; padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Clear & Stop</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_ID}'); if (!panel) return; const content = panel.querySelector('.panelContent'); content.scrollTop = 0; })();"
style="flex: 1; padding: 10px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Top</button>
</div>
</div>
`;

if (panelElement) panelElement.remove();
panelElement = document.createElement('div');
panelElement.id = PANEL_ID;
panelElement.innerHTML = panelHTML;
document.documentElement.appendChild(panelElement);

const contentArea = panelElement.querySelector('.panelContent');
if (contentArea) {
contentArea.addEventListener('scroll', () => {
localStorage.setItem('_slaPanelScroll', contentArea.scrollTop);
});
}

panelElement.querySelectorAll('.sla-copyable').forEach(el => {
el.addEventListener('click', function() {
copyToClipboard(this.dataset.value, this);
});
});
}

function renderTierSection(tierName, customers, color, tierId) {
if (customers.length === 0) {
return `<div style="margin-bottom: 20px; padding: 16px; background: white; border-radius: 8px;
border-left: 4px solid ${color}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
<h3 style="margin: 0; color: ${color}; font-size: 14px; font-weight: 600;">${tierName}</h3>
<p style="margin: 8px 0 0 0; color: #95a5a6; font-size: 13px;">No customers</p>
</div>`;
}

return `<div style="margin-bottom: 20px;">
<div onclick="window._toggleTier('${tierId}')" style="cursor: pointer; padding: 14px; background: white; border-radius: 8px 8px 0 0;
display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${color};
border-bottom: 2px solid #ecf0f1;">
<div>
<span style="font-weight: 700; color: #2c3e50; font-size: 14px;">${tierName}</span>
<span style="font-size: 12px; color: #95a5a6; margin-left: 10px;">${customers.length}</span>
</div>
<span id="toggle-${tierId}" style="font-size: 14px; color: ${color};">▼</span>
</div>
<div id="${tierId}" style="display: grid; gap: 12px; padding: 12px; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
${customers.map(c => `<div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; background: #fafbfc;">
<div style="font-weight: 700; color: #2c3e50; margin-bottom: 10px; font-size: 14px;">
<span class="sla-copyable" data-value="${escapeHtml(stripTitle(c.name))}" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: #ecf0f1; color: #2c3e50;">${escapeHtml(c.name)}</span>
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">PHONE</div>
${renderCopyableField(c.phone)}
</div>
<div>
<div style="color: #7f8c8d; font-size: 11px; font-weight: 700; margin-bottom: 4px;">EMAIL</div>
${renderCopyableField(c.email)}
</div>
</div>
<div style="padding-top: 10px; border-top: 1px solid #ecf0f1; display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px;">
<span style="background: #ecf0f1; color: #2c3e50; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.source)}</span>
<span style="background: #e8f5e9; color: #27ae60; padding: 4px 8px; border-radius: 4px;">${escapeHtml(c.campaign)}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

async function extractAndExport() {
if (extracting) return;
extracting = true;

try {
const table = document.querySelector('table');
if (!table) {
console.error('SLA Table not found');
return;
}

const previousByKey = new Map(currentCustomers.map(c => [c.key, c]));
const seenKeys = new Set();
const customers = [];
let addedCount = 0;
const rows = table.querySelectorAll('tbody tr');

const rowDescriptors = [];
for (const row of rows) {
const cells = row.querySelectorAll('td');
const name = cells[0]?.textContent?.trim();
const registration = cells[1]?.textContent?.trim();
const source = cells[2]?.textContent?.trim();
const campaign = cells[3]?.textContent?.trim();

if (!name || !campaign) continue;

// Registration is folded into the key (not displayed) so same-name
// leads from the same source/campaign don't collide with each other.
const key = `${name}||${registration}||${source}||${campaign}`;
seenKeys.add(key);
rowDescriptors.push({ cells, name, source, campaign, key });
}

const pendingCount = rowDescriptors.filter(d => !previousByKey.has(d.key)).length;
let remaining = pendingCount;
setBadgeProgress(remaining);

for (const d of rowDescriptors) {
const existing = previousByKey.get(d.key);
if (existing) {
customers.push(existing);
continue;
}

try {
const tierInfo = categorizeTier(d.campaign, d.source);
const details = await extractCustomerDetails(d.cells[0]);

customers.push({
key: d.key,
name: d.name,
campaign: d.campaign,
source: d.source,
tier: tierInfo.tier,
reason: tierInfo.reason,
phone: details.phone,
email: details.email
});
addedCount++;
} catch (error) {
console.warn('Error processing row:', error);
} finally {
remaining--;
setBadgeProgress(remaining);
}
}

const removedCount = currentCustomers.filter(c => !seenKeys.has(c.key)).length;

const startTime = Date.now();
displayPanel(customers, addedCount, removedCount);
const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
console.info(`✅ SLA Report generated in ${totalTime}s (${customers.length} customers, +${addedCount}/-${removedCount})`);
} catch (error) {
console.error('SLA Export Error:', error);
} finally {
const panelBox = document.getElementById(PANEL_BOX_ID);
if (panelBox) panelBox.style.transform = '';
setBadgeProgress(0);
extracting = false;
}
}

function setBadgeProgress(remaining) {
if (!badge) return;
if (remaining > 0) {
badge.textContent = String(remaining);
badge.style.fontSize = '18px';
} else {
badge.textContent = '📋';
badge.style.fontSize = '22px';
}
}

function createBadge() {
badge = document.getElementById(BADGE_ID);
if (badge) badge.remove();
badge = document.createElement('div');
badge.id = BADGE_ID;
badge.onclick = extractAndExport;
document.documentElement.appendChild(badge);
Object.assign(badge.style, {
position: 'fixed', right: '12px', top: '12px', width: '48px', height: '48px',
background: BADGE_COLOR, border: `2px solid ${BADGE_BORDER_COLOR}`, borderRadius: '50%',
boxShadow: '0 4px 12px rgba(39, 174, 96, 0.3)', zIndex: 99999, cursor: 'pointer',
display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
fontWeight: 'bold', color: BADGE_BORDER_COLOR, transition: 'all 0.3s ease'
});
badge.textContent = '📋';
badge.title = 'Extract SLA customers';
badge.addEventListener('mouseenter', () => {
badge.style.transform = 'scale(1.15)';
badge.style.boxShadow = '0 6px 16px rgba(39, 174, 96, 0.5)';
});
badge.addEventListener('mouseleave', () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.3)';
});
}

window._slaResetBookmarklet = resetBookmarklet;
window._toggleSlaPanelSize = function() {
const current = localStorage.getItem(PANEL_SIZE_KEY) || 'compact';
localStorage.setItem(PANEL_SIZE_KEY, current === 'full' ? 'compact' : 'full');
displayPanel(currentCustomers);
};
window._toggleTier = function(tierId) {
const tierContent = document.getElementById(tierId);
const toggle = document.getElementById('toggle-' + tierId);
if (tierContent && toggle) {
const isHidden = tierContent.style.display === 'none';
tierContent.style.display = isHidden ? 'grid' : 'none';
toggle.textContent = isHidden ? '▼' : '▶';
}
};

createBadge();
console.info('✅ SLA Extractor ready');
})();
