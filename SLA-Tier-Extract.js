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
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                  width: 90%; max-width: 1000px; max-height: 85vh; background: white; 
                  border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); 
                  z-index: 10000; overflow-y: auto; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        
        <div style="position: sticky; top: 0; background: #2c3e50; color: white; padding: 20px; 
                    display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #27ae60;">
          <h2 style="margin: 0; font-size: 20px;">SLA Customer Priority Report</h2>
          <button onclick="this.closest('div').parentElement.remove()" style="background: none; border: none; 
                           color: white; font-size: 24px; cursor: pointer; padding: 0;">×</button>
        </div>

        <div style="padding: 20px;">
          ${renderTierSection('Tier 1 - Check First', tiered.tier1, '#e74c3c')}
          ${renderTierSection('Tier 2 - Check Second', tiered.tier2, '#3498db')}
          ${renderTierSection('Tier 3 - Check Third', tiered.tier3, '#27ae60')}
          ${renderTierSection('Tier 4 - Check Fourth', tiered.tier4, '#f39c12')}
        </div>
      </div>
    `;

    const panelContainer = document.createElement('div');
    panelContainer.innerHTML = panelHTML;
    document.body.appendChild(panelContainer);

    document.querySelectorAll('.sla-copyable').forEach(el => {
      el.addEventListener('click', function() {
        copyToClipboard(this.dataset.value, this);
      });
    });
  }

  function renderTierSection(tierName, customers, color) {
    if (customers.length === 0) {
      return `<div style="margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 6px; 
                           border-left: 4px solid ${color};">
                <h3 style="margin: 0; color: ${color}; font-size: 16px;">${tierName}</h3>
                <p style="margin: 5px 0 0 0; color: #999; font-size: 14px;">(No customers)</p>
              </div>`;
    }

    return `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 10px 0; padding: 10px 15px; background: ${color}; color: white; 
                   border-radius: 6px; font-size: 14px; font-weight: 600;">
          ${tierName} - ${customers.length} customer${customers.length !== 1 ? 's' : ''}
        </h3>
        <div style="display: grid; gap: 10px;">
          ${customers.map(c => `
            <div style="border: 1px solid #ecf0f1; border-radius: 6px; padding: 12px; background: #fafafa;">
              <div style="font-weight: 600; color: #2c3e50; margin-bottom: 8px; font-size: 15px;">
                <span class="sla-copyable" data-value="${c.name}" style="cursor: pointer; padding: 2px 6px; 
                      border-radius: 3px; transition: all 0.2s;" 
                      onmouseover="this.style.background='#ecf0f1'" 
                      onmouseout="this.style.background=''">${c.name}</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
                <div style="color: #555;">
                  <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">Phone</span><br>
                  <span class="sla-copyable" data-value="${c.phone}" style="cursor: pointer; padding: 2px 6px; 
                        border-radius: 3px; transition: all 0.2s; display: inline-block;" 
                        onmouseover="this.style.background='#ecf0f1'" 
                        onmouseout="this.style.background=''">${c.phone || '—'}</span>
                </div>
                <div style="color: #555;">
                  <span style="color: #7f8c8d; font-size: 11px; text-transform: uppercase;">Email</span><br>
                  <span class="sla-copyable" data-value="${c.email}" style="cursor: pointer; padding: 2px 6px; 
                        border-radius: 3px; transition: all 0.2s; display: inline-block; word-break: break-all;" 
                        onmouseover="this.style.background='#ecf0f1'" 
                        onmouseout="this.style.background=''">${c.email || '—'}</span>
                </div>
              </div>
              <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ecf0f1; font-size: 12px; color: #7f8c8d;">
                <span style="background: #ecf0f1; padding: 2px 6px; border-radius: 3px;">${c.source}</span>
                <span style="margin-left: 8px; background: #d5f4e6; padding: 2px 6px; border-radius: 3px; color: #27ae60;">
                  ${c.campaign}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
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

        if (cells.length >= 4) {
          const name = cells[0]?.textContent?.trim() || '';
          const source = cells[2]?.textContent?.trim() || '';
          const campaign = cells[3]?.textContent?.trim() || '';

          if (name && !name.includes('Customer')) {
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

            console.info(`  ✓ ${name}`);
            await new Promise(r => setTimeout(r, 600));
          }
        }
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
    }

    if (badge) badge.remove();
    extracting = false;
  }

  function createBadge() {
    badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.onclick = extractAndExport;
      document.body.appendChild(badge);
    }

    Object.assign(badge.style, {
      position: 'fixed',
      right: '12px',
      top: '12px',
      width: '14px',
      height: '14px',
      background: BADGE_COLOR,
      border: `2px solid ${BADGE_BORDER_COLOR}`,
      borderRadius: '50%',
      boxShadow: '0 0 6px rgba(39, 174, 96, 0.6)',
      zIndex: 99999,
      cursor: 'pointer'
    });
    badge.title = 'Click to extract SLA customers';
  }

  createBadge();
  console.info('SLA Tier Extractor ready - click green badge to extract');
})();
