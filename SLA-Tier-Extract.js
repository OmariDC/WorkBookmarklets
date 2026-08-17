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

// Get all current lead IDs in the table
const currentTableLeadIds = new Set();
const tableLeadMap = {};

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

currentTableLeadIds.add(leadId);
tableLeadMap[leadId] = { name, source, campaign };
}

// Remove leads that are no longer in the table
extractedLeadIds.forEach(leadId => {
if (!currentTableLeadIds.has(leadId)) {
extractedLeadIds.delete(leadId);
console.info(`🗑️ Removed: ${leadId.split('|')[0]} (no longer in queue)`);
}
});

// Filter current customers to only keep those still in the table
const validCustomers = currentCustomers.filter(customer => {
const leadId = customer.name + '|' + customer.source + '|' + customer.campaign;
return currentTableLeadIds.has(leadId);
});

// Extract new leads
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

// Combine valid existing customers with new ones
const allCustomers = [...validCustomers, ...newCustomers];

// Categorize all customers
allCustomers.forEach(customer => {
const tierInfo = categorizeTier(customer.campaign, customer.source);
customer.tier = tierInfo.tier;
customer.tierReason = tierInfo.reason;
});

// Update current customers to only include valid ones
currentCustomers = allCustomers;

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
