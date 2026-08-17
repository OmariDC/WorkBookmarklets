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
  // Remove existing panel if present
  const existingPanel = document.getElementById(PANEL_ID);
  if (existingPanel) {
    existingPanel.remove();
  }

  // Create the fixed bottom panel container
  panelElement = document.createElement('div');
  panelElement.id = PANEL_ID;
  panelElement.setAttribute('style', `
    position: fixed;
    bottom: 0;
    right: 0;
    left: 0;
    width: 100%;
    height: 35vh;
    max-height: 35vh;
    background: white;
    border-top: 3px solid #2c3e50;
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    font-family: Arial, sans-serif;
    overflow: hidden;
  `);

  // Create header section (non-scrollable)
  const headerSection = document.createElement('div');
  headerSection.setAttribute('style', `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 15px;
    background: #f5f5f5;
    border-bottom: 1px solid #ddd;
    flex-shrink: 0;
  `);

  const headerTitle = document.createElement('h3');
  headerTitle.setAttribute('style', `
    margin: 0;
    font-size: 16px;
    color: #2c3e50;
    font-weight: 600;
  `);
  headerTitle.textContent = 'SLA Report';

  const headerControls = document.createElement('div');
  headerControls.setAttribute('style', `
    display: flex;
    gap: 8px;
  `);

  const topButton = document.createElement('button');
  topButton.textContent = 'Top';
  topButton.setAttribute('style', `
    padding: 6px 12px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  `);

  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear & Stop';
  clearButton.setAttribute('style', `
    padding: 6px 12px;
    background: #e74c3c;
    color: white;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  `);

  headerControls.appendChild(topButton);
  headerControls.appendChild(clearButton);
  headerSection.appendChild(headerTitle);
  headerSection.appendChild(headerControls);

  // Create scrollable content section
  const contentScroller = document.createElement('div');
  contentScroller.setAttribute('style', `
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px 15px;
  `);

  // Add tier sections to scrollable content
  for (let tier = 1; tier <= 4; tier++) {
    renderTierSection(contentScroller, tier);
  }

  // Assemble panel
  panelElement.appendChild(headerSection);
  panelElement.appendChild(contentScroller);
  document.body.appendChild(panelElement);

  // Setup button event listeners
  topButton.onclick = () => {
    contentScroller.scrollTop = 0;
  };

  clearButton.onclick = () => {
    resetBookmarklet();
    panelElement.remove();
    badge.remove();
  };

  // Adjust main content area to prevent overlap
  const mainContent = document.querySelector('[role="main"], main, .main-content, .content, .ng-scope') ||
                      document.querySelector('table') ||
                      document.body;
  
  if (mainContent && mainContent !== document.body) {
    mainContent.style.paddingBottom = '35vh';
    mainContent.style.boxSizing = 'border-box';
  }

  // Save panel state
  localStorage.setItem(PANEL_STATE_KEY, 'visible');
}

function renderTierSection(container, tier) {
  const tierData = currentCustomers.filter(c => c.tier === tier);
  
  const tierSection = document.createElement('div');
  tierSection.setAttribute('style', `
    margin-bottom: 15px;
    border: 1px solid #ddd;
    border-radius: 4px;
    overflow: hidden;
  `);

  const tierHeader = document.createElement('div');
  tierHeader.setAttribute('style', `
    background: ${getTierColor(tier)};
    color: white;
    padding: 10px;
    cursor: pointer;
    font-weight: bold;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `);
  tierHeader.innerHTML = `Tier ${tier} (${tierData.length})`;

  const tierContent = document.createElement('div');
  tierContent.setAttribute('style', `
    display: ${tier === 4 ? 'block' : 'none'};
    max-height: 200px;
    overflow-y: auto;
    background: white;
  `);

  tierData.forEach(customer => {
    const customerDiv = document.createElement('div');
    customerDiv.setAttribute('style', `
      padding: 10px;
      border-bottom: 1px solid #eee;
      font-size: 12px;
    `);
    customerDiv.innerHTML = `
      <strong>${customer.name}</strong><br/>
      ${customer.phone ? `Phone: ${customer.phone}<br/>` : ''}
      ${customer.email ? `Email: ${customer.email}<br/>` : ''}
      <small>${customer.source}</small>
    `;
    tierContent.appendChild(customerDiv);
  });

  tierHeader.onclick = () => {
    tierContent.style.display = tierContent.style.display === 'none' ? 'block' : 'none';
  };

  tierSection.appendChild(tierHeader);
  tierSection.appendChild(tierContent);
  container.appendChild(tierSection);
}

function getTierColor(tier) {
  const colors = {
    1: '#e74c3c',
    2: '#f39c12',
    3: '#3498db',
    4: '#95a5a6'
  };
  return colors[tier] || '#95a5a6';
}

async function extractAndExport() {
  if (extracting) return;
  extracting = true;
  badge.textContent = 'Extracting...';

  const table = document.querySelector('table');
  if (!table) {
    alert('No leads table found');
    extracting = false;
    return;
  }

  const rows = table.querySelectorAll('tbody tr');
  
  for (const row of rows) {
    try {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      const nameCell = cells[0];
      const campaignCell = cells[3];
      const sourceCell = cells[2];

      const name = nameCell.textContent.trim();
      const campaign = campaignCell.textContent.trim();
      const source = sourceCell.textContent.trim();

      if (extractedLeadIds.has(name)) continue;

      const tierInfo = categorizeTier(campaign, source);
      const details = await extractCustomerDetails(nameCell);

      const customer = {
        name,
        campaign,
        source,
        tier: tierInfo.tier,
        reason: tierInfo.reason,
        phone: details.phone,
        email: details.email
      };

      currentCustomers.push(customer);
      extractedLeadIds.add(name);

      badge.textContent = `Extracted: ${extractedLeadIds.size}`;
      badge.style.background = getTierColor(tierInfo.tier);
    } catch (error) {
      console.warn('Error processing row:', error);
    }
  }

  displayPanel();
  extracting = false;
  badge.textContent = `Done (${extractedLeadIds.size})`;
}

function createBadge() {
  badge = document.createElement('button');
  badge.id = BADGE_ID;
  badge.textContent = 'Extract SLA';
  badge.setAttribute('style', `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 15px;
    background: ${BADGE_COLOR};
    color: white;
    border: 3px solid ${BADGE_BORDER_COLOR};
    border-radius: 50%;
    cursor: pointer;
    z-index: 9999;
    font-weight: bold;
    font-size: 12px;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  `);

  badge.onclick = extractAndExport;
  document.body.appendChild(badge);
}

// Initialize
createBadge();
})();
