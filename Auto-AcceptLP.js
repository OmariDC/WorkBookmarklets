// Prevent double installation
if (window._autoAcceptInstalled) return;
window._autoAcceptInstalled = true;

// CONFIG
const BUTTON_SELECTOR =
  '#agent-workspace-app > div.main-layout.le-theme-background > div:nth-child(5) > div > div.manual-queue-area > div > button';

const BADGE_ID = '_lpBadge';
const BADGE_COLOR = '#040134';
const BADGE_BORDER_COLOR = '#000';

let observer = null;

// Delay generator
function getDelay() {
  return 500 + Math.random() * 1100;
}

// Enable auto-accept
function enable() {
  if (observer) return;

  observer = new MutationObserver(() => {
    const b = document.querySelector(BUTTON_SELECTOR);
    if (b && !b.disabled && !b.dataset.clicked) {
      setTimeout(() => {
        b.click();
        b.dataset.clicked = '1';
      }, getDelay());
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Badge
  let badge = document.getElementById(BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.onclick = toggle;
    document.body.appendChild(badge);
  }

  Object.assign(badge.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    width: '14px',
    height: '14px',
    background: BADGE_COLOR,
    border: `2px solid ${BADGE_BORDER_COLOR}`,
    borderRadius: '50%',
    boxShadow: '0 0 4px rgba(0, 0, 0, 0.4)',
    zIndex: 99999,
    cursor: 'pointer'
  });

  badge.title = 'Auto-accept ON – click to disable';
  console.info('Auto-accept ON');
}

// Disable auto-accept
function disable() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  const badge = document.getElementById(BADGE_ID);
  if (badge) badge.remove();

  console.info('Auto-accept OFF');
}

// Toggle state
function toggle() {
  if (observer) disable();
  else enable();
}

// Register hotkey
if (!window._autoAcceptHotkey) {
  window._autoAcceptHotkey = true;

  window.addEventListener('keydown', e => {
    if (e.altKey && e.code === 'KeyX') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  });
}

// Auto-start ON
enable();
