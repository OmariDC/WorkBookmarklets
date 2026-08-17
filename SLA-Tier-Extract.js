(function() {
const BADGE_ID = '_slaBadge';
const BADGE_COLOR = '#2c3e50';
const BADGE_BORDER_COLOR = '#27ae60';
const PANEL_ID = '_slaPanel';
const PANEL_STATE_KEY = '_slaPanelState';

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
// Clear all variables
currentCustomers = [];
extracting = false;
localStorage.removeItem('_slaPanelScroll');
localStorage.removeItem(PANEL_STATE_KEY);

// Remove panel
if (panelElement) {
panelElement.remove();
panelElement = null;
}

// Reset badge to initial state
if (badge) {
badge.style.transform = 'scale(1)';
badge.style.opacity = '1';
}

console.info('🔄 SLA Extractor reset - ready to run again');
}

function displayPanel(customers) {
currentCustomers = customers;
const tiered = {
tier1: customers.filter(c => c.tier === 1),
tier2: customers.filter(c => c.tier === 2),
tier3: customers.filter(c => c.tier === 3),
tier4: customers.filter(c => c.tier === 4)
};

const panelHTML = `
<div style="position: fixed; top: 0; right: 0; width: 420px; height: 100vh;
background: white; box-shadow: -2px 0 8px rgba(0,0,0,0.15);
z-index: 10000; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
display: flex; flex-direction: column; transition: transform 0.3s ease;">

<!-- Header -->
<div style="position: sticky; top: 0; background: #2c3e50; color: white; padding: 16px;
display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #27ae60;
flex-shrink: 0;">
<div style="display: flex; align-items: center; gap: 8px;">
<h2 style="margin: 0; font-size: 16px; font-weight: 600;">SLA Report</h2>
<span style="background: #27ae60; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">${customers.length}</span>
</div>
<div style="display: flex; gap: 8px;">
<button onclick="document.getElementById('${PANEL_ID}').querySelector('.panelContent').scrollTop = 0;" 
style="background: none; border: none; color: white; cursor: pointer; padding: 4px 8px; font-size: 18px; display: flex; align-items: center;" 
title="Top">↑</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_ID}'); if (!panel) return; const btn = event.target; const isHidden = panel.style.transform === 'translateX(100%)'; panel.style.transform = isHidden ? 'translateX(0)' : 'translateX(100%)'; btn.textContent = isHidden ? '−' : '□'; localStorage.setItem('${PANEL_STATE_KEY}', isHidden ? 'visible' : 'hidden'); })();" 
style="background: none; border: none; color: white; cursor: pointer; padding: 4px 8px; font-size: 18px;" 
title="Minimize">−</button>
</div>
</div>

<!-- Content Area -->
<div class="panelContent" style="flex: 1; overflow-y: auto; padding: 16px; padding-right: 12px;">
${renderTierSection('Tier 1 - Check First', tiered.tier1, '#e74c3c')}
${renderTierSection('Tier 2 - Check Second', tiered.tier2, '#3498db')}
${renderTierSection('Tier 3 - Check Third', tiered.tier3, '#27ae60')}
${renderTierSection('Tier 4 - Check Fourth', tiered.tier4, '#f39c12')}
</div>

<!-- Footer -->
<div style="border-top: 1px solid #ecf0f1; padding: 12px; background: #f8f9fa; flex-shrink: 0; display: flex; gap: 8px;">
<button onclick="(function() { if (confirm('Clear all extracted data and reset?')) { window._slaResetBookmarklet(); } })();"
style="flex: 1; padding: 8px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
Clear Data
</button>
<button onclick="(function() { const panel = document.getElementById('${PANEL_ID}'); if (!panel) return; const content = panel.querySelector('.panelContent'); content.scrollTop = 0; })();"
style="flex: 1; padding: 8px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
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

// Restore scroll position
const savedScroll = localStorage.getItem('_slaPanelScroll');
if (savedScroll) {
setTimeout(() => {
const content = panelElement.querySelector('.panelContent');
if (content) content.scrollTop = parseInt(savedScroll);
}, 100);
}

// Save scroll position on scroll
const contentArea = panelElement.querySelector('.panelContent');
if (contentArea) {
contentArea.addEventListener('scroll', () => {
localStorage.setItem('_slaPanelScroll', contentArea.scrollTop);
});
}

// Add copy listeners
panelElement.querySelectorAll('.sla-copyable').forEach(el => {
el.addEventListener('click', function() {
copyToClipboard(this.dataset.value, this);
});
});
}

function renderTierSection(tierName, customers, color) {
if (customers.length === 0) {
return `<div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 6px;
border-left: 4px solid ${color};">
<h3 style="margin: 0; color: ${color}; font-size: 14px; font-weight: 600;">${tierName}</h3>
<p style="margin: 5px 0 0 0; color: #999; font-size: 12px;">(No customers)</p>
</div>`;
}

return `<div style="margin-bottom: 16px;">
<h3 style="margin: 0 0 10px 0; padding: 8px 12px; background: ${color}; color: white;
border-radius: 6px; font-size: 13px; font-weight: 600;">${tierName} - ${customers.length} customer${customers.length !== 1 ? 's' : ''}</h3>
<div style="display: grid; gap: 8px;">
${customers.map(c => `<div style="border: 1px solid #ecf0f1; border-radius: 6px; padding: 10px; background: #fafafa; transition: all 0.2s;">
<div style="font-weight: 600; color: #2c3e50; margin-bottom: 6px; font-size: 14px;">
<span class="sla-copyable" data-value="${c.name}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" 
onmouseover="this.style.background='#ecf0f1'" onmouseout="this.style.background='';">${c.name}</span>
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
<div style="color: #555;">
<span style="color: #7f8c8d; font-size: 10px; text-transform: uppercase; font-weight: 600;">Phone</span><br>
<span class="sla-copyable" data-value="${c.phone || '—'}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s; display: inline-block; word-break: break-all;" 
onmouseover="this.style.background='#ecf0f1'" onmouseout="this.style.background='';">${c.phone || '—'}</span>
</div>
<div style="color: #555;">
<span style="color: #7f8c8d; font-size: 10px; text-transform: uppercase; font-weight: 600;">Email</span><br>
<span class="sla-copyable" data-value="${c.email || '—'}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s; display: inline-block; word-break: break-all;" 
onmouseover="this.style.background='#ecf0f1'" onmouseout="this.style.background='';">${c.email || '—'}</span>
</div>
</div>
<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #ecf0f1; font-size: 11px; color: #666;">
<span style="background: #ecf0f1; padding: 2px 5px; border-radius: 3px; display: inline-block; margin-bottom: 4px;">${c.source}</span>
<span style="margin-left: 6px; background: #d5f4e6; padding: 2px 5px; border-radius: 3px; color: #27ae60; display: inline-block; font-size: 10px;">${c.campaign}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

async function extractAndExport() {
if (extracting) return;
extracting = true;

const startTime = Date.now();
const customers = [];

try {
const table = document.querySelector('table');
if (!table) {
console.error('SLA Table not found');
extracting = false;
return;
}

const allRows = table.querySelectorAll('tbody tr');
console.info(`📊 Found ${allRows.length} customers, extracting details...`);

for (let i = 0; i < allRows.length; i++) {
const row = allRows[i];
const cells = row.children;

if (cells.length < 4) continue;

const name = cells[0].textContent.trim();
const source = cells[2].textContent.trim();
const campaign = cells[3].textContent.trim();

if (!name || name.includes('Customer')) {
const details = await extractCustomerDetails(row);
customers.push({
name,
source,
campaign,
phone: details.phone,
email: details.email,
tier: null,
tierReason: ''
});
console.info(`✓ ${name}`);
}

await new Promise(setTimeout, 600);
}

if (customers.length === 0) {
console.warn('No customers found in SLA queue');
extracting = false;
return;
}

customers.forEach(customer => {
const tierInfo = categorizeTier(customer.campaign, customer.source);
customer.tier = tierInfo.tier;
customer.tierReason = tierInfo.reason;
});

displayPanel(customers);

const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
console.info(`✅ SLA Report Generated in ${totalTime}s`);
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
width: '44px',
height: '44px',
background: BADGE_COLOR,
border: `2px solid ${BADGE_BORDER_COLOR}`,
borderRadius: '50%',
boxShadow: '0 0 10px rgba(39, 174, 96, 0.7)',
zIndex: 99999,
cursor: 'pointer',
display: 'flex',
alignItems: 'center',
justifyContent: 'center',
fontSize: '20px',
fontWeight: 'bold',
color: BADGE_BORDER_COLOR,
transition: 'all 0.2s ease'
});

badge.textContent = '📋';
badge.title = 'Click to extract SLA customers';

badge.addEventListener('mouseenter', () => {
badge.style.transform = 'scale(1.1)';
badge.style.boxShadow = '0 0 15px rgba(39, 174, 96, 1)';
});

badge.addEventListener('mouseleave', () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 0 10px rgba(39, 174, 96, 0.7)';
});
}

// Expose reset function globally
window._slaResetBookmarklet = resetBookmarklet;

createBadge();
console.info('✅ SLA Tier Extractor ready - click green badge to extract');
})();
