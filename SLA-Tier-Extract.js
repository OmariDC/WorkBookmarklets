(function() {
const BADGE_ID = '_slaBadge';
const BADGE_COLOR = '#2c3e50';
const BADGE_BORDER_COLOR = '#27ae60';
const PANEL_ID = '_slaPanel';
const PANEL_STATE_KEY = '_slaPanelState';
const EXTRACTED_LEADS_KEY = '_slaExtractedLeads';

let badge = null;
let panelElement = null;
let extracting = false;
let currentCustomers = [];
let extractedLeadIds = new Set();

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

async function extractCustomerDetails(customerElement) {
return new Promise((resolve) => {
const nameLink = customerElement.querySelector('a');
if (!nameLink) {
resolve({ phone: '', email: '' });
return;
}

nameLink.click();

setTimeout(() => {
try {
const modal = document.querySelector('[role="alertdialog"]') || document.querySelector('.modal');
if (modal) {
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

resolve({ phone, email });
} else {
resolve({ phone: '', email: '' });
}
} catch (error) {
console.warn('Detail extraction error:', error);
resolve({ phone: '', email: '' });
}
}, 800);
});
}

function copyToClipboard(text, element) {
navigator.clipboard.writeText(text).then(() => {
const originalText = element.textContent;
element.textContent = '✓ Copied!';
element.style.background = '#27ae60';
element.style.color = 'white';
setTimeout(() => {
element.textContent = originalText;
element.style.background = '';
element.style.color = '';
}, 1500);
});
}

function resetBookmarklet() {
currentCustomers = [];
extractedLeadIds.clear();
extracting = false;
localStorage.removeItem('_slaPanelScroll');
localStorage.removeItem(PANEL_STATE_KEY);
localStorage.removeItem(EXTRACTED_LEADS_KEY);

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

function displayPanel(customers, newCount = 0) {
currentCustomers = customers;
const tiered = {
tier1: customers.filter(c => c.tier === 1),
tier2: customers.filter(c => c.tier === 2),
tier3: customers.filter(c => c.tier === 3),
tier4: customers.filter(c => c.tier === 4)
};

const panelHTML = `
<div style="position: fixed; top: 0; right: 0; width: 450px; height: 100vh;
background: #f8f9fa; box-shadow: -2px 0 12px rgba(0,0,0,0.15);
z-index: 10000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
display: flex; flex-direction: column; transition: transform 0.3s ease;">

<!-- Header -->
<div style="position: sticky; top: 0; background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 20px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #27ae60;
flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
<div style="display: flex; align-items: center; gap: 12px;">
<h2 style="margin: 0; font-size: 18px; font-weight: 700;">SLA Report</h2>
<span style="background: #27ae60; color: white; padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 600;">${customers.length}</span>
${newCount > 0 ? `<span style="background: #f39c12; color: white; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 600;">+${newCount} new</span>` : ''}
</div>
<div style="display: flex; gap: 8px;">
<button onclick="document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0;" 
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;" 
title="Scroll to top" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">↑</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_ID}'); if (!panel) return; const btn = event.target; const isHidden = panel.style.transform === 'translateX(100%)'; panel.style.transform = isHidden ? 'translateX(0)' : 'translateX(100%)'; btn.textContent = isHidden ? '−' : '□'; localStorage.setItem('${PANEL_STATE_KEY}', isHidden ? 'visible' : 'hidden'); })();" 
style="background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer; padding: 6px 10px; font-size: 16px; border-radius: 4px; transition: all 0.2s;" 
title="Minimize" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">−</button>
</div>
</div>

<!-- Content Area -->
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

<!-- Footer -->
<div style="border-top: 1px solid #ddd; padding: 14px; background: white; flex-shrink: 0; display: flex; gap: 10px; box-shadow: 0 -2px 8px rgba(0,0,0,0.05);">
<button onclick="(function() { if (confirm('Clear all extracted data and stop bookmarklet?')) { window._slaResetBookmarklet(); } })();"
style="flex: 1; padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" 
onmouseover="this.style.background='#c0392b'" onmouseout="this.style.background='#e74c3c'">
Clear & Stop
</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_ID}'); if (!panel) return; const content = panel.querySelector('.panelContent'); content.scrollTop = 0; })();"
style="flex: 1; padding: 10px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" 
onmouseover="this.style.background='#2980b9'" onmouseout="this.style.background='#3498db'">
Top
</button>
</div>
</div>
`;

if (panelElement) {
panelElement.remove();
}

panelElement = document.createElement('div');
panelElement.id = PANEL_ID;
panelElement.innerHTML = panelHTML;
document.body.appendChild(panelElement);

const savedScroll = localStorage.getItem('_slaPanelScroll');
if (savedScroll) {
setTimeout(() => {
const content = panelElement.querySelector('.panelContent');
if (content) content.scrollTop = parseInt(savedScroll);
}, 100);
}

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
display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; border-left: 4px solid ${color};
border-bottom: 2px solid #ecf0f1;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='white'">
<div style="display: flex; flex-direction: column; flex: 1;">
<span style="font-weight: 700; color: #2c3e50; font-size: 14px;">${tierName}</span>
<span style="font-size: 12px; color: #95a5a6; margin-top: 3px;">${customers.length} customer${customers.length !== 1 ? 's' : ''}</span>
</div>
<span id="toggle-${tierId}" style="font-size: 14px; color: ${color}; font-weight: 600;">▼</span>
</div>
<div id="${tierId}" style="display: grid; gap: 12px; padding: 12px; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
${customers.map(c => `<div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; background: #fafbfc; transition: all 0.2s;" onmouseover="this.style.background='#f0f2f5'; this.style.boxShadow='0 2px 6px rgba(0,0,0,0.08)'" onmouseout="this.style.background='#fafbfc'; this.style.boxShadow='none'">
<div style="font-weight: 700; color: #2c3e50; margin-bottom: 10px; font-size: 14px;">
<span class="sla-copyable" data-value="${c.name}" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: all 0.2s; background: #ecf0f1; color: #2c3e50;" 
onmouseover="this.style.background='#d5dbdb'; this.style.color='#1a252f'" onmouseout="this.style.background='#ecf0f1'; this.style.color='#2c3e50'">${c.name}</span>
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
<div>
<div style="color: #7f8c8d; font-size: 11px; text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Phone</div>
<span class="sla-copyable" data-value="${c.phone || 'N/A'}" style="cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: all 0.2s; background: #e8f4f8; color: #2c3e50; display: inline-block; word-break: break-all; font-size: 13px;" 
onmouseover="this.style.background='#d1e9f1'" onmouseout="this.style.background='#e8f4f8'">${c.phone || 'N/A'}</span>
</div>
<div>
<div style="color: #7f8c8d; font-size: 11px; text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Email</div>
<span class="sla-copyable" data-value="${c.email || 'N/A'}" style="cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: all 0.2s; background: #e8f4f8; color: #2c3e50; display: inline-block; word-break: break-all; font-size: 13px;" 
onmouseover="this.style.background='#d1e9f1'" onmouseout="this.style.background='#e8f4f8'">${c.email || 'N/A'}</span>
</div>
</div>
<div style="padding-top: 10px; border-top: 1px solid #ecf0f1; display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px;">
<span style="background: #ecf0f1; color: #2c3e50; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${c.source}</span>
<span style="background: #e8f5e9; color: #27ae60; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${c.campaign}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

async function extractAndExport() {
if (extracting) return;
extracting = true;

const startTime = Date.now();
const newCustomers = [];
let newCount = 0;

try {
const table = document.querySelector('table');
if (!table) {
console.error('SLA Table not found');
extracting = false;
return;
}

const allRows = table.querySelectorAll('tbody tr');
console.info(`📊 Scanning ${allRows.length} rows...`);

for (let i = 0; i < allRows.length; i++) {
const row = allRows[i];
const cells = row.children;

if (cells.length < 4) continue;

const name = cells[0].textContent.trim();
const source = cells[2].textContent.trim();
const campaign = cells[3].textContent.trim();
const leadId = name + '|' + source + '|' + campaign;

if (name === 'Customer' || !name) {
continue;
}

// Skip if already extracted
if (extractedLeadIds.has(leadId)) {
continue;
}

const details = await extractCustomerDetails(row);
newCustomers.push({
name,
source,
campaign,
phone: details.phone,
email: details.email,
tier: null,
tierReason: ''
});
extractedLeadIds.add(leadId);
newCount++;
console.info(`✓ ${name} (NEW)`);

await new Promise(setTimeout, 600);
}

// Combine with existing customers
const allCustomers = [...currentCustomers, ...newCustomers];

// Categorize all customers
allCustomers.forEach(customer => {
const tierInfo = categorizeTier(customer.campaign, customer.source);
customer.tier = tierInfo.tier;
customer.tierReason = tierInfo.reason;
});

// Save extracted lead IDs
localStorage.setItem(EXTRACTED_LEADS_KEY, JSON.stringify(Array.from(extractedLeadIds)));

displayPanel(allCustomers, newCount);

const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
if (newCount > 0) {
console.info(`✅ Added ${newCount} new customer${newCount !== 1 ? 's' : ''} in ${totalTime}s`);
} else {
console.info(`ℹ️ No new leads found in ${totalTime}s`);
}
} catch (error) {
console.error('SLA Export Error:', error);
} finally {
if (panelElement) {
panelElement.style.transform = 'translateX(0)';
}
extracting = false;
}
}

function createBadge() {
badge = document.getElementById(BADGE_ID);
if (badge) badge.remove();

badge = document.createElement('div');
badge.id = BADGE_ID;
badge.onclick = extractAndExport;
document.body.appendChild(badge);

Object.assign(badge.style, {
position: 'fixed',
right: '12px',
top: '12px',
width: '48px',
height: '48px',
background: BADGE_COLOR,
border: `2px solid ${BADGE_BORDER_COLOR}`,
borderRadius: '50%',
boxShadow: '0 4px 12px rgba(39, 174, 96, 0.3)',
zIndex: 99999,
cursor: 'pointer',
display: 'flex',
alignItems: 'center',
justifyContent: 'center',
fontSize: '22px',
fontWeight: 'bold',
color: BADGE_BORDER_COLOR,
transition: 'all 0.3s ease'
});

badge.textContent = '📋';
badge.title = 'Click to extract/update SLA customers';

badge.addEventListener('mouseenter', () => {
badge.style.transform = 'scale(1.15)';
badge.style.boxShadow = '0 6px 16px rgba(39, 174, 96, 0.5)';
});

badge.addEventListener('mouseleave', () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.3)';
});
}

// Load previously extracted lead IDs
const savedLeads = localStorage.getItem(EXTRACTED_LEADS_KEY);
if (savedLeads) {
try {
extractedLeadIds = new Set(JSON.parse(savedLeads));
} catch (e) {
extractedLeadIds = new Set();
}
}

window._slaResetBookmarklet = resetBookmarklet;
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
console.info('✅ SLA Tier Extractor ready - click green badge to extract');
})();
