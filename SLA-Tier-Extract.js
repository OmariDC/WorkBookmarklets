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
}

function displayPanel() {
  const existingPanel = document.getElementById(PANEL_ID);
  if (existingPanel) {
    existingPanel.remove();
  }

  panelElement = document.createElement('div');
  panelElement.id = PANEL_ID;
  panelElement.style.cssText = `position: fixed; bottom: 0; right: 0; width: 350px; max-height: 60vh; background: white; border: 2px solid #2c3e50; border-radius: 5px; box-shadow: -2px -2px 10px rgba(0,0,0,0.3); z-index: 10000; display: flex; flex-direction: column; font-family: Arial, sans-serif; overflow: hidden; margin: 10px;`;

  const header = document.createElement('div');
  header.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: linear-gradient(to right, #2c3e50, #34495e); color: white; border-bottom: 1px solid #1a252f; flex-shrink: 0;`;
  
  const title = document.createElement('h3');
  title.textContent = 'SLA Report';
  title.style.cssText = `margin: 0; font-size: 15px; font-weight: bold; letter-spacing: 0.5px;`;
  
  const controls = document.createElement('div');
  controls.style.cssText = `display: flex; gap: 8px;`;

  const topBtn = document.createElement('button');
  topBtn.textContent = '⬆';
  topBtn.style.cssText = `padding: 4px 10px; background: #27ae60; color: white; border: none; cursor: pointer; font-size: 12px; font-weight: bold; border-radius: 3px; transition: background 0.2s;`;
  topBtn.onmouseover = () => topBtn.style.background = '#229954';
  topBtn.onmouseout = () => topBtn.style.background = '#27ae60';
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `padding: 4px 10px; background: #e74c3c; color: white; border: none; cursor: pointer; font-size: 16px; font-weight: bold; border-radius: 3px; transition: background 0.2s;`;
  closeBtn.onmouseover = () => closeBtn.style.background = '#c0392b';
  closeBtn.onmouseout = () => closeBtn.style.background = '#e74c3c';

  controls.appendChild(topBtn);
  controls.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(controls);

  const content = document.createElement('div');
  content.style.cssText = `flex: 1; overflow-y: auto; padding: 10px; background: #ecf0f1;`;

  for (let tier = 1; tier <= 4; tier++) {
    renderTierSection(content, tier);
  }

  panelElement.appendChild(header);
  panelElement.appendChild(content);
  document.body.appendChild(panelElement);

  topBtn.onclick = () => {
    content.scrollTop = 0;
  };

  closeBtn.onclick = () => {
    resetBookmarklet();
    panelElement.remove();
  };

  localStorage.setItem(PANEL_STATE_KEY, 'visible');
}

function renderTierSection(container, tier) {
  const tierCustomers = currentCustomers.filter(c => c.tier === tier);
  
  const tierDiv = document.createElement('div');
  tierDiv.style.cssText = `margin-bottom: 12px; border: 1px solid #bdc3c7; border-radius: 4px; overflow: hidden; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);`;

  const tierColors = { 1: '#e74c3c', 2: '#f39c12', 3: '#3498db', 4: '#95a5a6' };
  const tierHeader = document.createElement('div');
  tierHeader.style.cssText = `background: ${tierColors[tier]}; color: white; padding: 10px 12px; cursor: pointer; font-weight: bold; user-select: none; display: flex; justify-content: space-between; align-items: center;`;
  tierHeader.innerHTML = `<span>Tier ${tier}</span><span style="font-size: 12px; opacity: 0.9;">${tierCustomers.length}</span>`;

  const tierContent = document.createElement('div');
  tierContent.style.cssText = `display: none; max-height: 200px; overflow-y: auto; background: #f8f9fa; border-top: 1px solid #e0e0e0;`;

  tierCustomers.forEach((customer, idx) => {
    const custDiv = document.createElement('div');
    custDiv.style.cssText = `padding: 10px 12px; border-bottom: ${idx < tierCustomers.length - 1 ? '1px solid #ecf0f1' : 'none'}; font-size: 11px; cursor: pointer; background: white; transition: background 0.2s;`;
    custDiv.onmouseover = () => custDiv.style.background = '#f0f0f0';
    custDiv.onmouseout = () => custDiv.style.background = 'white';
    
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = `font-weight: bold; color: #2c3e50; margin-bottom: 3px;`;
    nameDiv.textContent = customer.name;
    
    const detailsDiv = document.createElement('div');
    detailsDiv.style.cssText = `color: #7f8c8d; font-size: 10px;`;
    detailsDiv.textContent = `${customer.phone || 'N/A'} | ${customer.campaign.substring(0, 20)}...`;
    
    custDiv.appendChild(nameDiv);
    custDiv.appendChild(detailsDiv);
    tierContent.appendChild(custDiv);
  });

  tierHeader.onclick = () => {
    tierContent.style.display = tierContent.style.display === 'none' ? 'block' : 'none';
  };

  tierDiv.appendChild(tierHeader);
  tierDiv.appendChild(tierContent);
  container.appendChild(tierDiv);
}

async function extractAndExport() {
  if (extracting) return;
  extracting = true;
  badge.textContent = 'Extracting...';
  badge.style.fontSize = '10px';

  const table = document.querySelector('table');
  if (!table) {
    alert('No table found');
    extracting = false;
    badge.textContent = 'Error';
    return;
  }

  const rows = table.querySelectorAll('tbody tr');
  
  for (const row of rows) {
    try {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      const name = cells[0].textContent.trim();
      const source = cells[2].textContent.trim();
      const campaign = cells[3].textContent.trim();

      if (extractedLeadIds.has(name)) continue;

      const { tier, reason } = categorizeTier(campaign, source);
      const { phone, email } = await extractCustomerDetails(cells[0]);

      currentCustomers.push({
        name,
        campaign,
        source,
        tier,
        reason,
        phone,
        email
      });

      extractedLeadIds.add(name);
      badge.textContent = extractedLeadIds.size;
      badge.style.fontSize = '16px';
    } catch (error) {
      console.warn('Error:', error);
    }
  }

  displayPanel();
  extracting = false;
}

function createBadge() {
  badge = document.createElement('button');
  badge.id = BADGE_ID;
  badge.textContent = 'Extract SLA';
  badge.style.cssText = `position: fixed; top: 20px; right: 20px; width: 70px; height: 70px; background: ${BADGE_COLOR}; color: white; border: 3px solid ${BADGE_BORDER_COLOR}; border-radius: 50%; cursor: pointer; z-index: 9999; font-weight: bold; font-size: 12px; padding: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.3); transition: all 0.3s; font-family: Arial, sans-serif;`;
  
  badge.onmouseover = () => {
    badge.style.transform = 'scale(1.1)';
    badge.style.boxShadow = '0 6px 12px rgba(0,0,0,0.4)';
  };
  
  badge.onmouseout = () => {
    badge.style.transform = 'scale(1)';
    badge.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
  };
  
  badge.onclick = extractAndExport;
  document.body.appendChild(badge);
}

createBadge();
})();
