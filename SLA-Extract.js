(function() {
const BADGE_ID = '_slaBadge';
const BADGE_COLOR = '#2c3e50';
const BADGE_BORDER_COLOR = '#27ae60';

let badge = null;
let extracting = false;

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

function displayPanel(customers) {
const tiered = {
tier1: customers.filter(c => c.tier === 1),
tier2: customers.filter(c => c.tier === 2),
tier3: customers.filter(c => c.tier === 3),
tier4: customers.filter(c => c.tier === 4)
};

const panelHTML = `
<div style="position: fixed; bottom: 0; right: 0; width: 600px; max-height: 80vh; background: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 9999; display: flex; flex-direction: column; font-family: Arial, sans-serif; margin: 10px; overflow: hidden;">
  <div style="background: #2c3e50; color: white; padding: 15px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
    <h2 style="margin: 0; font-size: 18px;">SLA Report</h2>
    <button id="closePanel" style="background: #e74c3c; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px; font-weight: bold;">✕</button>
  </div>
  
  <div style="flex: 1; overflow-y: auto; padding: 15px;">
    ${tiered.tier1.length > 0 ? `
      <div style="margin-bottom: 15px;">
        <h3 style="background: #e74c3c; color: white; padding: 10px; margin: 0 0 10px 0; border-radius: 4px;">Tier 1 - Priority (${tiered.tier1.length})</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          ${tiered.tier1.map(c => `
            <div style="border: 1px solid #ecf8f1; padding: 10px; border-radius: 4px;">
              <div style="font-weight: bold; margin-bottom: 5px;">${c.name}</div>
              <div style="color: #7f8c8d; font-size: 12px; margin-bottom: 3px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.phone || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.phone}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Phone</span>
              </div>
              <div style="color: #7f8c8d; font-size: 12px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.email || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.email}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Email</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    
    ${tiered.tier2.length > 0 ? `
      <div style="margin-bottom: 15px;">
        <h3 style="background: #f39c12; color: white; padding: 10px; margin: 0 0 10px 0; border-radius: 4px;">Tier 2 - High (${tiered.tier2.length})</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          ${tiered.tier2.map(c => `
            <div style="border: 1px solid #ecf8f1; padding: 10px; border-radius: 4px;">
              <div style="font-weight: bold; margin-bottom: 5px;">${c.name}</div>
              <div style="color: #7f8c8d; font-size: 12px; margin-bottom: 3px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.phone || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.phone}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Phone</span>
              </div>
              <div style="color: #7f8c8d; font-size: 12px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.email || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.email}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Email</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    
    ${tiered.tier3.length > 0 ? `
      <div style="margin-bottom: 15px;">
        <h3 style="background: #3498db; color: white; padding: 10px; margin: 0 0 10px 0; border-radius: 4px;">Tier 3 - Medium (${tiered.tier3.length})</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          ${tiered.tier3.map(c => `
            <div style="border: 1px solid #ecf8f1; padding: 10px; border-radius: 4px;">
              <div style="font-weight: bold; margin-bottom: 5px;">${c.name}</div>
              <div style="color: #7f8c8d; font-size: 12px; margin-bottom: 3px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.phone || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.phone}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Phone</span>
              </div>
              <div style="color: #7f8c8d; font-size: 12px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.email || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.email}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Email</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    
    ${tiered.tier4.length > 0 ? `
      <div style="margin-bottom: 15px;">
        <h3 style="background: #95a5a6; color: white; padding: 10px; margin: 0 0 10px 0; border-radius: 4px;">Tier 4 - Standard (${tiered.tier4.length})</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          ${tiered.tier4.map(c => `
            <div style="border: 1px solid #ecf8f1; padding: 10px; border-radius: 4px;">
              <div style="font-weight: bold; margin-bottom: 5px;">${c.name}</div>
              <div style="color: #7f8c8d; font-size: 12px; margin-bottom: 3px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.phone || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.phone}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Phone</span>
              </div>
              <div style="color: #7f8c8d; font-size: 12px;">
                <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">${c.email || '-'}</span><br/>
                <span class="sla-copyable" data-value="${c.email}" style="cursor: pointer; padding: 2px 6px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='#ecf8f1'" onmouseout="this.style.background=''">Copy Email</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  </div>
</div>
`;

const panelDiv = document.createElement('div');
panelDiv.innerHTML = panelHTML;
document.body.appendChild(panelDiv);

document.getElementById('closePanel').onclick = () => {
panelDiv.remove();
};

document.querySelectorAll('.sla-copyable').forEach(el => {
el.onclick = () => copyToClipboard(el.getAttribute('data-value'), el);
});
}

async function extractAndExport() {
if (extracting) return;
extracting = true;
badge.textContent = 'Extracting...';

try {
const table = document.querySelector('table');
if (!table) {
console.error('SLA Table not found');
extracting = false;
return;
}

const customers = [];
const rows = table.querySelectorAll('tbody tr');

for (const row of rows) {
try {
const cells = row.querySelectorAll('td');
const name = cells[0]?.textContent?.trim();
const source = cells[2]?.textContent?.trim();
const campaign = cells[3]?.textContent?.trim();

if (!name || !campaign) continue;

const tierInfo = categorizeTier(campaign, source);
const details = await extractCustomerDetails(cells[0]);

customers.push({
name,
campaign,
source,
tier: tierInfo.tier,
reason: tierInfo.reason,
phone: details.phone,
email: details.email
});
} catch (error) {
console.warn('Error processing row:', error);
}
}

const startTime = Date.now();
displayPanel(customers);
const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
console.info(`✅ SLA Report generated in ${totalTime}s`);
badge.textContent = customers.length;
} catch (error) {
console.error('SLA Export Error:', error);
}
extracting = false;
}

function createBadge() {
badge = document.createElement('button');
badge.id = BADGE_ID;
badge.textContent = 'Extract SLA';
badge.style.cssText = `
position: fixed;
top: 20px;
right: 20px;
width: 70px;
height: 70px;
background: ${BADGE_COLOR};
color: white;
border: 3px solid ${BADGE_BORDER_COLOR};
border-radius: 50%;
cursor: pointer;
z-index: 9998;
font-weight: bold;
font-size: 12px;
padding: 0;
box-shadow: 0 4px 8px rgba(0,0,0,0.2);
transition: all 0.3s;
font-family: Arial, sans-serif;
`;

badge.onmouseover = () => {
badge.style.transform = 'scale(1.15)';
badge.style.boxShadow = '0 6px 12px rgba(0,0,0,0.3)';
};

badge.onmouseout = () => {
badge.style.transform = 'scale(1)';
badge.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
};

badge.onclick = extractAndExport;
document.body.appendChild(badge);
}

createBadge();
})();
