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
  clearButton.onclick = () => {
    resetBookmarklet();
    panelElement.remove();
  };

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
  topButton.onclick = () => {
    contentScroller.scrollTop = 0;
  };

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
