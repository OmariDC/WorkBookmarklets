(function () {
  'use strict';

  const existing = window.KonnectNotes;
  if (existing && existing.version) {
    if (typeof existing.refreshRemote === 'function') existing.refreshRemote();
    if (typeof existing.togglePalette === 'function') existing.togglePalette();
    return;
  }

  const KN = window.KonnectNotes = {
    version: '1.8.2'
  };

  /* Where the phrases and booking engine are fetched from. A test
     bookmarklet can point this at a branch by setting
     window.KonnectNotesBaseUrl before loading this script. */
  const BASE_URL = String(window.KonnectNotesBaseUrl ||
    'https://raw.githubusercontent.com/OmariDC/WorkBookmarklets/main/').replace(/\/?$/, '/');
  const CONFIG_URL = `${BASE_URL}Konnect-Notes-Phrases.json`;
  const ENGINE_URL = `${BASE_URL}Konnect-Booking-Engine.js`;
  const STORAGE_KEY = 'konnectNotes:workingConfig:v1';
  const AGENT_NAME_KEY = 'konnectNotes:agentName:v1';
  const STYLE_ID = 'kn-notes-style';
  const PALETTE_ID = 'kn-notes-palette';
  const LAUNCHER_SECTION_ID = 'kn-notes-launcher-section';
  const UI_PREFIX = 'kn-';

  const state = {
    config: null,
    dirty: false,
    remoteSignature: '',
    configStatus: 'Loading phrases...',
    target: null,
    targetLabel: null,
    postClosureTarget: null,
    postClosureLabel: null,
    targetHadFocus: false,
    lastSelection: null,
    launcherSection: null,
    launcherButton: null,
    palette: null,
    observer: null,
    scanTimer: null,
    open: false,
    view: 'main',
    activeCategory: 'all',
    searchQuery: '',
    selectedResult: 0,
    attemptPhrase: null,
    otherAttemptOpen: false,
    editingPhraseId: null,
    statusMessage: '',
    lastPostClosureTransaction: null,
    booking: null,
    bookingStatus: null,
    bookingError: '',
    bookingScroll: 0,
    applyingPostClosureTransaction: false
  };

  function normaliseText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function ownText(element) {
    if (!element) return '';
    return normaliseText(
      Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.nodeValue)
        .join(' ')
    );
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStored() {
    if (!state.config) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        config: state.config,
        dirty: state.dirty,
        remoteSignature: state.remoteSignature
      }));
    } catch (error) {
      state.configStatus = 'Chrome could not save local phrase settings.';
    }
  }

  function getAgentName() {
    try {
      return normaliseText(localStorage.getItem(AGENT_NAME_KEY));
    } catch (error) {
      return '';
    }
  }

  function askAgentName() {
    const current = getAgentName();
    const answer = window.prompt('Konnect Notes: enter your name as it should appear in notes.', current);
    const name = normaliseText(answer);
    if (!name) return current;
    try {
      localStorage.setItem(AGENT_NAME_KEY, name);
    } catch (error) {
      state.configStatus = 'Chrome could not save your name.';
    }
    return name;
  }

  function ensureAgentName() {
    return getAgentName() || askAgentName();
  }

  function signature(config) {
    return JSON.stringify(config || null);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slug(value) {
    const base = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return base || `phrase-${Date.now()}`;
  }

  function validateConfig(input) {
    if (!input || typeof input !== 'object') throw new Error('Configuration must be an object.');
    if (!Array.isArray(input.categories) || !Array.isArray(input.phrases)) {
      throw new Error('Configuration must contain categories and phrases.');
    }

    const categories = input.categories
      .filter((category) => category && category.id && category.label)
      .map((category, index) => ({
        id: String(category.id),
        label: String(category.label),
        order: Number.isFinite(Number(category.order)) ? Number(category.order) : index + 1
      }))
      .sort((a, b) => a.order - b.order);

    const categoryIds = new Set(categories.map((category) => category.id));
    const seenIds = new Set();
    const phrases = [];

    input.phrases.forEach((source, index) => {
      if (!source || typeof source !== 'object') return;
      let id = String(source.id || slug(source.label || `phrase-${index + 1}`));
      while (seenIds.has(id)) id = `${id}-${index + 1}`;
      seenIds.add(id);

      const label = String(source.label || '').trim();
      const text = String(source.text || '');
      if (!label || !text) return;

      const category = categoryIds.has(String(source.category))
        ? String(source.category)
        : categories[0]?.id || 'calls';
      const aliases = Array.from(new Set(
        (Array.isArray(source.aliases) ? source.aliases : [])
          .map((alias) => String(alias).trim().toLowerCase())
          .filter(Boolean)
      ));
      const quick = Number(source.quickOrder);
      const phrase = {
        id,
        label,
        category,
        text,
        aliases,
        requiresAttempt: Boolean(source.requiresAttempt)
      };
      if (quick >= 1 && quick <= 5) phrase.quickOrder = quick;
      if (source.emailSource === 'top') phrase.emailSource = 'top';
      phrases.push(phrase);
    });

    const usedQuickOrders = new Set();
    const usedAliases = new Set();
    phrases.forEach((phrase) => {
      if (phrase.quickOrder) {
        if (usedQuickOrders.has(phrase.quickOrder)) delete phrase.quickOrder;
        else usedQuickOrders.add(phrase.quickOrder);
      }
      phrase.aliases = phrase.aliases.filter((alias) => {
        if (usedAliases.has(alias)) return false;
        usedAliases.add(alias);
        return true;
      });
    });

    if (!categories.length || !phrases.length) throw new Error('Configuration contains no usable phrases.');
    return {
      schemaVersion: 1,
      name: String(input.name || 'Konnect Notes'),
      categories,
      phrases
    };
  }

  function setWorkingConfig(config, dirty, message) {
    state.config = validateConfig(config);
    state.dirty = Boolean(dirty);
    state.configStatus = message || (state.dirty ? 'Local changes not yet published.' : 'Using GitHub phrases.');
    writeStored();
    if (state.open) renderPalette();
  }

  async function fetchRemoteConfig() {
    const response = await fetch(`${CONFIG_URL}?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Phrase download failed (${response.status}).`);
    return validateConfig(await response.json());
  }

  async function refreshRemoteConfig(options) {
    const settings = options || {};
    try {
      const remote = await fetchRemoteConfig();
      const remoteSig = signature(remote);
      state.remoteSignature = remoteSig;

      if (settings.force || !state.config || !state.dirty) {
        setWorkingConfig(remote, false, 'Using the latest GitHub phrases.');
      } else if (signature(state.config) === remoteSig) {
        setWorkingConfig(state.config, false, 'Local phrases now match GitHub.');
      } else {
        state.configStatus = 'Local changes are active and have not yet been published.';
        writeStored();
        if (state.open) renderPalette();
      }
      return remote;
    } catch (error) {
      state.configStatus = state.config
        ? 'Could not check GitHub; cached/local phrases remain active.'
        : `Could not load phrases: ${error.message}`;
      if (state.open) renderPalette();
      return null;
    }
  }

  function loadInitialConfig() {
    const stored = readStored();
    if (stored && stored.config) {
      try {
        state.config = validateConfig(stored.config);
        state.dirty = Boolean(stored.dirty);
        state.remoteSignature = String(stored.remoteSignature || '');
        state.configStatus = state.dirty
          ? 'Local changes are active and have not yet been published.'
          : 'Using cached GitHub phrases while checking for updates.';
      } catch (error) {
        state.config = null;
      }
    }
    refreshRemoteConfig();
  }

  function exactCallNotesLabels() {
    const candidates = document.querySelectorAll('label,legend,dt,th,span,strong,b,p,div');
    return Array.from(candidates).filter((element) =>
      isVisible(element) && ownText(element).toLowerCase() === 'call notes'
    );
  }

  function findEditorForLabel(label) {
    if (!label) return null;
    const labelRect = label.getBoundingClientRect();
    let container = label;
    const candidates = new Set();

    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      container.querySelectorAll('footer.text-primary textarea.form-control').forEach((editor) => {
        if (isVisible(editor)) candidates.add(editor);
      });
      if (candidates.size) break;
    }

    return Array.from(candidates)
      .filter((editor) => editor.closest('footer.text-primary'))
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const aPenalty = aRect.top + 8 < labelRect.top ? 10000 : 0;
        const bPenalty = bRect.top + 8 < labelRect.top ? 10000 : 0;
        return (aPenalty + Math.abs(aRect.top - labelRect.bottom)) -
          (bPenalty + Math.abs(bRect.top - labelRect.bottom));
      })[0] || null;
  }

  function findCallNotesTarget() {
    const matches = exactCallNotesLabels()
      .map((label) => ({ label, editor: findEditorForLabel(label) }))
      .filter((entry) => entry.editor && isVisible(entry.editor));
    matches.sort((a, b) =>
      a.editor.getBoundingClientRect().top - b.editor.getBoundingClientRect().top
    );
    return matches[0] || null;
  }

  function findPostClosureNotesTarget() {
    const labels = Array.from(document.querySelectorAll('label,legend,dt,th,span,strong,b,p,div'))
      .filter((element) => isVisible(element) && ownText(element).toLowerCase() === 'post closure notes');
    const matches = [];

    labels.forEach((label) => {
      const labelRect = label.getBoundingClientRect();
      let container = label.parentElement;
      const candidates = new Set();
      for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
        container.querySelectorAll('textarea.form-control, textarea').forEach((editor) => {
          if (isVisible(editor)) candidates.add(editor);
        });
        const below = Array.from(candidates).filter((editor) =>
          editor.getBoundingClientRect().top >= labelRect.top - 4
        );
        if (below.length) break;
      }

      const editor = Array.from(candidates)
        .filter((candidate) => candidate.getBoundingClientRect().top >= labelRect.top - 4)
        .sort((a, b) =>
          Math.abs(a.getBoundingClientRect().top - labelRect.bottom) -
          Math.abs(b.getBoundingClientRect().top - labelRect.bottom)
        )[0];
      if (editor) matches.push({ label, editor });
    });

    matches.sort((a, b) =>
      a.editor.getBoundingClientRect().top - b.editor.getBoundingClientRect().top
    );
    return matches[0] || null;
  }

  function findPanelNoteField(panel, labelText) {
    if (!(panel instanceof Element)) return null;
    const expected = String(labelText || '').toLowerCase();
    const labels = Array.from(panel.querySelectorAll('label,legend,dt,th,span,strong,b,p,div'))
      .filter((element) => ownText(element).toLowerCase() === expected);

    for (const label of labels) {
      let container = label.parentElement;
      for (let depth = 0; container && container !== panel.parentElement && depth < 7;
        depth += 1, container = container.parentElement) {
        const editors = Array.from(container.querySelectorAll(
          'footer.text-primary textarea.form-control, footer textarea, textarea.form-control, textarea'
        ));
        if (editors.length === 1) return { label, editor: editors[0], container };
      }
    }
    return null;
  }

  function panelNoteSet(panel) {
    if (!(panel instanceof Element)) return null;
    return {
      panel,
      initial: findPanelNoteField(panel, 'initial notes'),
      call: findPanelNoteField(panel, 'call notes'),
      postClosure: findPanelNoteField(panel, 'post closure notes')
    };
  }

  function noteValueKey(value) {
    return noteLineKey(normaliseText(value));
  }

  function postClosureFieldIsHidden(field) {
    if (!field?.editor) return true;
    let container = field.container;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      if (container.classList?.contains('ng-hide') || getComputedStyle(container).display === 'none') {
        return true;
      }
    }
    return false;
  }

  function findMountedDuplicateNoteSet(activeNotes) {
    if (!activeNotes?.panel || !activeNotes.initial?.editor) return null;
    const tabContent = activeNotes.panel.parentElement;
    if (!tabContent?.classList?.contains('tab-content')) return null;

    const activeInitialKey = noteValueKey(activeNotes.initial.editor.value);
    if (!activeInitialKey) return null;

    const candidates = Array.from(tabContent.children)
      .filter((panel) => panel !== activeNotes.panel && panel.classList?.contains('tab-pane'))
      .map(panelNoteSet)
      .filter((notes) => notes?.initial?.editor && notes.call?.editor)
      .filter((notes) => noteValueKey(notes.initial.editor.value) === activeInitialKey);

    candidates.sort((a, b) => {
      const score = (notes) => {
        const callValue = String(notes.call.editor.value || '');
        const catchAllCount = (callValue.match(/catch\s+all\s+return\s+lead/ig) || []).length;
        return (postClosureFieldIsHidden(notes.postClosure) ? 0 : 100000) +
          (catchAllCount * 10000) + callValue.length;
      };
      return score(a) - score(b);
    });
    return candidates[0] || null;
  }

  function isGreen(element) {
    const parts = String(getComputedStyle(element).backgroundColor).match(/[\d.]+/g);
    if (!parts) return false;
    const [red, green, blue] = parts.slice(0, 3).map(Number);
    return green > 85 && green > red * 1.12 && green > blue * 1.08;
  }

  function findGreenTick(rail) {
    if (!rail) return null;
    const controls = Array.from(rail.querySelectorAll('a.btn.btn-circle.btn-lgr.btn-call-nav'));
    return controls.find((control) => isVisible(control) && isGreen(control)) || null;
  }

  function findTurquoiseCar(rail) {
    if (!rail) return null;
    const controls = Array.from(rail.querySelectorAll('a.btn.btn-circle.btn-lgr.btn-call-nav'));
    return controls.find((control) => {
      if (!isVisible(control)) return false;
      const parts = String(getComputedStyle(control).backgroundColor).match(/[\d.]+/g);
      if (!parts) return false;
      const [red, green, blue] = parts.slice(0, 3).map(Number);
      return green > 120 && blue > 120 && red < green * 0.86 && Math.abs(green - blue) < 55;
    }) || null;
  }

  function rememberSelection(target) {
    if (!(target instanceof HTMLTextAreaElement) ||
        (target !== state.target && target !== state.postClosureTarget)) return;
    state.targetHadFocus = true;
    state.lastSelection = {
      target,
      start: Number.isFinite(target.selectionStart) ? target.selectionStart : target.value.length,
      end: Number.isFinite(target.selectionEnd) ? target.selectionEnd : target.value.length
    };
  }

  function createLauncher(rail, greenTick) {
    const existingSection = document.getElementById(LAUNCHER_SECTION_ID);
    if (existingSection) existingSection.remove();

    const section = document.createElement('section');
    section.id = LAUNCHER_SECTION_ID;
    section.className = 'cassini-section kn-launcher-section';

    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-circle btn-lgr btn-call-nav kn-launcher';
    button.title = 'Call-note phrases (Alt+N)';
    button.setAttribute('aria-label', 'Open Call-note phrases');

    const clipboard = document.createElement('span');
    clipboard.className = 'kn-launcher-clipboard';
    const bolt = document.createElement('span');
    bolt.className = 'kn-launcher-bolt';
    bolt.textContent = '\u26A1';
    clipboard.appendChild(bolt);
    button.appendChild(clipboard);

    button.addEventListener('mousedown', () => {
      const active = document.activeElement;
      if (active === state.target || active === state.postClosureTarget) rememberSelection(active);
      else if (state.target) rememberSelection(state.target);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      togglePalette();
    });

    section.appendChild(button);
    const greenSection = greenTick.closest('section.cassini-section');
    if (greenSection && greenSection.parentElement === rail) {
      greenSection.insertAdjacentElement('afterend', section);
    } else {
      rail.appendChild(section);
    }
    state.launcherSection = section;
    state.launcherButton = button;
  }

  function updateLauncher() {
    const active = Boolean(state.target && isVisible(state.target));
    const rail = document.querySelector('.userQuotesAffix');
    const greenTick = findGreenTick(rail);

    if (active && rail && greenTick && (!state.launcherSection || !state.launcherSection.isConnected)) {
      createLauncher(rail, greenTick);
    }
    if (state.launcherSection && state.launcherSection.isConnected) {
      const desired = active ? '' : 'none';
      if (state.launcherSection.style.display !== desired) {
        state.launcherSection.style.display = desired;
      }
    }
  }

  function scanPage() {
    const found = findCallNotesTarget();
    const postClosure = findPostClosureNotesTarget();
    const nextTarget = found?.editor || null;
    const nextPostClosureTarget = postClosure?.editor || null;
    const targetChanged = nextTarget !== state.target;
    const postClosureChanged = nextPostClosureTarget !== state.postClosureTarget;
    if (targetChanged || postClosureChanged) {
      state.target = nextTarget;
      state.targetLabel = found?.label || null;
      state.postClosureTarget = nextPostClosureTarget;
      state.postClosureLabel = postClosure?.label || null;
      state.targetHadFocus = false;
      state.lastSelection = null;
      state.lastPostClosureTransaction = null;
    }
    updateLauncher();
    updateInboundLauncher();
    if (!state.target && state.open && !(state.view === 'booking' && inboundContext())) closePalette();
    else if (state.open && targetChanged && state.view === 'booking') {
      /* The lead's Call Notes just appeared (or changed): pick up its draft and read its boxes. */
      if (state.target && bookingEngine()) syncLead(currentDraft());
      renderPalette();
    }
    else if (state.open && targetChanged) positionPalette();
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scanPage, 120);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    /* Same visual language as SLA-Manager.js/Konnect-Lead-Checker.js's
    own redesign this session - dark #1c1c1e header, light #f2f2f7 body,
    white cards with soft shadows instead of 1px borders, fully-rounded
    pills for small interactive elements, destructive actions as plain
    colored text. Every class name below is unchanged from before, only
    restyled - none of the render* functions needed to change. */
    style.textContent = `
      .kn-launcher-section { height: 75px; text-align: center; }
      .kn-launcher { position: relative; display: inline-flex !important; align-items: center; justify-content: center; width: 60px !important; height: 60px !important; border-radius: 30px !important; background: #1c1c1e !important; color: #fff !important; box-shadow: 0 4px 14px rgba(0,0,0,0.3) !important; border: none !important; text-decoration: none !important; }
      .kn-launcher:hover, .kn-launcher:focus { background: #2c2c2e !important; color: #fff !important; }
      .kn-launcher-clipboard { position: relative; width: 24px; height: 29px; border: 3px solid #fff; border-radius: 3px; display: block; }
      .kn-launcher-clipboard::before { content: ''; position: absolute; width: 12px; height: 5px; border: 2px solid #fff; border-radius: 3px; background: #1c1c1e; top: -7px; left: 3px; }
      .kn-launcher-bolt { position: absolute; right: -10px; bottom: -8px; display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border-radius: 50%; background: #f9772e; color: #fff; font: 900 14px/1 -apple-system, sans-serif; }
      .kn-ui, .kn-ui * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      #${PALETTE_ID} { position: fixed; top: 0; left: 0; width: 240px; max-height: 380px; z-index: 2147483000; display: none; flex-direction: column; overflow: hidden; color: #1c1c1e; background: #f2f2f7; border: none; border-radius: 20px; box-shadow: 0 20px 50px -12px rgba(0,0,0,0.3); }
      #${PALETTE_ID}.kn-open { display: flex; }
      .kn-header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 11px 14px; background: #1c1c1e; border-radius: 20px 20px 0 0; }
      .kn-title { flex: 1; font-size: 15px; font-weight: 600; color: #fff; letter-spacing: -0.1px; }
      .kn-body { flex: 1 1 auto; min-height: 0; padding: 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
      .kn-icon-button, .kn-button, .kn-chip, .kn-result, .kn-quick, .kn-attempt { border: none; cursor: pointer; }
      .kn-icon-button { min-width: 30px; height: 30px; padding: 3px 8px; border-radius: 8px; background: rgba(255,255,255,0.12); color: #fff; font-weight: 600; }
      .kn-icon-button:hover { background: rgba(255,255,255,0.2); }
      .kn-button { padding: 8px 12px; border-radius: 999px; background: white; color: #1c1c1e; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
      .kn-button.kn-primary { background: #f9772e; color: #fff; }
      .kn-button.kn-danger { background: transparent; color: #ff3b30; box-shadow: none; padding: 8px 6px; }
      .kn-search, .kn-input, .kn-textarea, .kn-select { width: 100%; padding: 8px 10px; color: #1c1c1e; background: #fff; border: none; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-search { margin-bottom: 10px; font-size: 14px; }
      .kn-search::placeholder, .kn-input::placeholder, .kn-textarea::placeholder { color: #8e8e93; }
      .kn-quick-grid { display: grid; grid-template-columns: 1fr; gap: 7px; margin-bottom: 10px; }
      .kn-quick { position: relative; min-height: 48px; padding: 8px 9px 8px 33px; border-radius: 12px; background: #fff; color: #1c1c1e; text-align: left; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03); }
      .kn-quick-key { position: absolute; top: 50%; left: 8px; transform: translateY(-50%); width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: #f9772e; color: #fff; font-weight: 700; font-size: 10.5px; }
      .kn-categories { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 3px; }
      .kn-chip { flex: 0 0 auto; padding: 5px 10px; border-radius: 999px; color: #1c1c1e; background: #fff; font-size: 12px; font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-chip.kn-active { background: #f9772e; color: #fff; font-weight: 600; box-shadow: none; }
      .kn-results { display: flex; flex-direction: column; gap: 6px; }
      .kn-result { padding: 10px 12px; border-radius: 12px; background: #fff; color: #1c1c1e; text-align: left; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03); }
      .kn-result.kn-selected, .kn-result:hover { background: #fff3ea; box-shadow: 0 0 0 1.5px #f9772e; }
      .kn-result-label { display: block; font-size: 14px; font-weight: 600; }
      .kn-result-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; color: #8e8e93; font-size: 10px; }
      .kn-result-shortcut { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: #f9772e18; color: #f9772e; font-weight: 700; }
      .kn-result-preview { display: -webkit-box; margin-top: 5px; color: #6e6e73; font-size: 11px; line-height: 1.35; white-space: normal; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .kn-alias { display: inline-block; margin: 4px 4px 0 0; padding: 1px 6px; border-radius: 999px; background: #f2f2f7; color: #6e6e73; font-size: 10px; }
      .kn-browse-controls { position: sticky; top: -12px; z-index: 2; margin-top: -12px; padding-top: 12px; background: #f2f2f7; }
      .kn-muted { color: #6e6e73; font-size: 12px; }
      .kn-status { margin: 0 0 9px; padding: 8px 10px; background: #fff; border-radius: 10px; color: #6e6e73; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      .kn-status.kn-status-error { background: #ff3b3012; color: #ff3b30; font-weight: 600; }
      .kn-attempt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
      .kn-attempt { min-height: 52px; border-radius: 12px; background: #fff; color: #1c1c1e; font-size: 16px; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03); }
      .kn-settings-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
      .kn-phrase-list { display: flex; flex-direction: column; gap: 6px; }
      .kn-phrase-row { padding: 10px; border-radius: 12px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.03); }
      .kn-phrase-row-top { display: flex; align-items: flex-start; gap: 8px; }
      .kn-phrase-row-title { flex: 1; font-weight: 600; }
      .kn-row-actions { display: flex; gap: 5px; }
      .kn-row-actions .kn-button { padding: 4px 8px; font-size: 11px; box-shadow: none; background: #f2f2f7; }
      .kn-row-actions .kn-button.kn-danger { background: transparent; }
      .kn-field { display: block; margin-bottom: 10px; }
      .kn-field-label { display: block; margin-bottom: 4px; font-weight: 600; font-size: 12px; color: #3a3a3c; }
      .kn-textarea { min-height: 105px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .kn-check-row { display: flex; align-items: center; gap: 7px; margin: 8px 0; }
      .kn-form-actions { display: flex; gap: 7px; margin-top: 12px; }
      .kn-export { min-height: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .kn-browse-button { width: 100%; margin-bottom: 8px; }
      .kn-shortcut-hint { text-align: center; }
      .kn-stop-button { padding: 3px 10px !important; font-size: 12px; font-weight: 700 !important; background: #ff3b30 !important; color: #fff !important; }
      .kn-stop-button:hover { background: #d70015 !important; }
      .kn-bk-body { padding: 10px; background: #e9e9ee; }
      .kn-bk-section { margin-bottom: 8px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; border-left: 4px solid transparent; }
      .kn-bk-section.kn-bk-open { border-left-color: #f9772e; box-shadow: 0 2px 10px rgba(0,0,0,0.12); }
      .kn-bk-head { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px 12px; border: none; background: transparent; cursor: pointer; text-align: left; }
      .kn-bk-head-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .kn-bk-badge { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-top: 1px; border-radius: 50%; font-size: 12px; font-weight: 800; }
      .kn-bk-badge-done { background: #34c759; color: #fff; }
      .kn-bk-badge-needed { background: #f9772e; color: #fff; }
      .kn-bk-badge-optional { background: #e5e5ea; color: #6e6e73; }
      .kn-bk-optional { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #f2f2f7; color: #8e8e93; font-size: 10px; font-weight: 600; vertical-align: 2px; }
      .kn-bk-prompt { margin-bottom: 9px; font-size: 13px; font-weight: 700; color: #c2410c; }
      .kn-bk-needed { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 8px; padding: 8px 10px; border-radius: 12px; background: #fff4ec; box-shadow: inset 0 0 0 1.5px #f9772e; }
      .kn-bk-needed.kn-bk-ready { background: #eafaf0; box-shadow: inset 0 0 0 1.5px #34c759; }
      .kn-bk-needed-title { font-size: 12.5px; font-weight: 800; color: #1c1c1e; margin-right: 2px; }
      .kn-bk-ready .kn-bk-needed-title { color: #248a3d; }
      .kn-bk-needed-chip { border: none; cursor: pointer; padding: 4px 10px; border-radius: 999px; background: #f9772e; color: #fff; font-size: 12px; font-weight: 700; }
      .kn-bk-head:hover { background: #fafafa; }
      .kn-bk-head-top { display: flex; align-items: center; justify-content: space-between; }
      .kn-bk-head-title { font-size: 14px; font-weight: 700; color: #1c1c1e; }
      .kn-bk-chevron { font-size: 13px; color: #8e8e93; }
      .kn-bk-head-summary { margin-top: 2px; font-size: 12.5px; font-weight: 500; color: #3a3a3c; line-height: 1.35; }
      .kn-bk-head-summary.kn-bk-missing { color: #c2410c; font-weight: 600; }
      .kn-bk-open .kn-bk-head { background: #fff3ea; border-bottom: 1px solid #fde0cc; }
      .kn-bk-content { padding: 10px 12px 12px; }
      .kn-bk-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
      .kn-bk-chips .kn-chip { max-width: 100%; white-space: normal; text-align: left; padding: 6px 11px; font-size: 12.5px; background: #fff; box-shadow: inset 0 0 0 1px #d1d1d6; }
      .kn-bk-chips .kn-chip.kn-active { background: #f9772e; color: #fff; box-shadow: none; font-weight: 600; }
      .kn-bk-chips .kn-chip:disabled { opacity: 0.4; cursor: default; }
      .kn-bk-sub .kn-chip { font-size: 11px; padding: 4px 9px; }
      .kn-bk-field { display: block; flex: 1 1 0; min-width: 0; margin-bottom: 7px; }
      .kn-bk-label { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; font-size: 12px; font-weight: 700; color: #1c1c1e; }
      .kn-bk-tag { padding: 0 6px; border-radius: 999px; background: #34c75922; color: #248a3d; font-size: 9.5px; font-weight: 700; }
      .kn-bk-field .kn-input { padding: 7px 9px; font-size: 13.5px; background: #fff; box-shadow: inset 0 0 0 1px #c7c7cc; }
      .kn-bk-field .kn-input:focus { outline: none; box-shadow: inset 0 0 0 2px #f9772e; }
      .kn-bk-notes { min-height: 90px; resize: vertical; font-family: inherit; }
      .kn-bk-row { display: flex; gap: 6px; }
      .kn-bk-small { flex: 1 1 0; }
      .kn-bk-days { display: flex; gap: 5px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 6px; }
      .kn-bk-day { display: flex !important; flex-direction: column; align-items: center; min-width: 42px; padding: 5px 6px !important; background: #fff !important; box-shadow: inset 0 0 0 1px #d1d1d6 !important; }
      .kn-bk-day.kn-active { background: #f9772e !important; color: #fff !important; box-shadow: none !important; }
      .kn-bk-day:disabled { opacity: 0.35; cursor: default; }
      .kn-bk-day-name { font-size: 9.5px; font-weight: 600; opacity: 0.8; }
      .kn-bk-day-num { font-size: 14px; font-weight: 700; }
      .kn-bk-readout { margin: 2px 0 8px; padding: 7px 9px; border-radius: 10px; background: #1c1c1e; color: #fff; font-size: 13px; font-weight: 700; }
      .kn-bk-readout.kn-bk-error { background: #ff3b30; color: #fff; }
      .kn-bk-times { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
      .kn-bk-times .kn-chip { padding: 6px 0; font-size: 12.5px; font-weight: 600; background: #fff; box-shadow: inset 0 0 0 1px #d1d1d6; text-align: center; }
      .kn-bk-times .kn-chip.kn-active { background: #f9772e; color: #fff; }
      .kn-bk-card { margin-bottom: 8px; padding: 10px; border-radius: 10px; background: #f7f7f9; box-shadow: inset 0 0 0 1px #e5e5ea; }
      .kn-bk-card-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12.5px; font-weight: 700; color: #1c1c1e; }
      .kn-bk-remove { border: none; background: none; color: #ff3b30; font-size: 11px; font-weight: 600; cursor: pointer; }
      .kn-bk-add { width: 100%; margin-bottom: 8px; font-size: 12px; background: #f2f2f7; box-shadow: none; }
      .kn-bk-gap { margin-bottom: 8px; }
      .kn-bk-error { color: #ff3b30; font-size: 12px; font-weight: 600; }
      .kn-bk-warn { color: #b25000; font-size: 12px; }
      .kn-bk-notice { margin-bottom: 8px; padding: 9px 10px; border-radius: 12px; background: #fff4d6; box-shadow: 0 0 0 1.5px #ffcc00; }
      .kn-bk-notice-text { font-size: 12.5px; font-weight: 600; margin-bottom: 6px; }
      .kn-bk-notice-actions { display: flex; gap: 6px; }
      .kn-bk-notice-actions .kn-button { padding: 5px 10px; font-size: 12px; }
      .kn-bk-footer { flex: 0 0 auto; padding: 8px 10px 10px; background: #fff; border-top: 1px solid #e5e5ea; border-radius: 0 0 20px 20px; }
      .kn-bk-preview-label { margin-bottom: 4px; font-size: 11px; font-weight: 700; color: #6e6e73; text-transform: uppercase; letter-spacing: 0.3px; }
      .kn-bk-preview { max-height: 150px; margin: 0 0 6px; padding: 7px 8px; overflow: auto; border-radius: 8px; background: #f2f2f7; color: #1c1c1e; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
      .kn-bk-issues { margin-bottom: 6px; }
      .kn-bk-status { margin-bottom: 6px; font-size: 12px; font-weight: 600; }
      .kn-bk-status-ok { color: #248a3d; }
      .kn-bk-status-warn { color: #b25000; }
      .kn-bk-status-error { color: #ff3b30; }
      .kn-bk-actions { display: flex; gap: 6px; align-items: center; }
      .kn-bk-actions .kn-primary { flex: 1; }
      .kn-bk-blocked { opacity: 0.55; }
      .kn-inbound-launcher { position: fixed; left: 20px; bottom: 20px; z-index: 2147482999; padding: 10px 16px; border: none; border-radius: 999px; background: #1c1c1e; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.3); }
      .kn-inbound-launcher:hover { background: #2c2c2e; }
      .kn-phone-launcher { display: block; background: #1c1c1e !important; color: #fff !important; border: none !important; font-size: 18px; font-weight: 900; line-height: 1; cursor: pointer; }
      .kn-phone-launcher:hover { background: #f9772e !important; }
      .kn-bk-search-row { align-items: flex-end; }
      .kn-bk-search-button { flex: 0 0 auto; margin-bottom: 7px; padding: 7px 16px; }
      .kn-bk-version { margin-top: 6px; text-align: right; font-size: 10px; color: #aeaeb2; }
      @media (max-width: 720px) {
        #${PALETTE_ID} { width: 200px; }
      }
    `;
    document.head.appendChild(style);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    const node = element('button', `kn-button ${className || ''}`.trim(), text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function ensurePalette() {
    if (state.palette && state.palette.isConnected) return state.palette;
    const palette = element('div', 'kn-ui');
    palette.id = PALETTE_ID;
    document.body.appendChild(palette);
    state.palette = palette;
    return palette;
  }

  function positionPalette() {
    if (state.palette && state.view === 'booking' && inboundContext()) {
      /* No lead screen yet: dock on the right so the inbound screens stay usable. */
      /* Sit just left of Konnect's Phone column so Hang Up and Hold stay reachable. */
      const anchor = phoneColumnAnchor();
      const rightEdge = anchor ? Math.round(anchor.getBoundingClientRect().left) - 12 : window.innerWidth - 16;
      const width = Math.min(400, rightEdge - 8);
      state.palette.style.left = `${Math.max(8, rightEdge - width)}px`;
      state.palette.style.top = '16px';
      state.palette.style.width = `${width}px`;
      state.palette.style.maxHeight = `${Math.max(320, window.innerHeight - 32)}px`;
      return;
    }
    if (!state.palette || !state.launcherSection?.isConnected || !state.target) return;
    const rail = state.launcherSection.closest('.userQuotesAffix');
    const anchorRect = state.launcherSection.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect() || anchorRect;
    const targetRect = state.target.getBoundingClientRect();
    const isContext = state.view !== 'main';
    const isBooking = state.view === 'booking';
    let left;
    let top;
    let width;
    let maxHeight;

    if (!isContext) {
      const safeRight = Math.max(128, Math.round(targetRect.left) - 18);
      const preferredWidth = 240;
      left = Math.max(8, Math.min(Math.round(railRect.left) - 18, safeRight - preferredWidth));
      width = Math.max(120, Math.min(260, safeRight - left));
      top = Math.max(8, Math.round(anchorRect.bottom + 6));
      maxHeight = Math.max(160, Math.min(440, window.innerHeight - top - 10));
    } else {
      /* Pop-out beside the rail, level with the turquoise car button (the
         same spot as the VM attempt picker). The booking panel uses the
         same spot but is allowed to be taller. */
      const viewportBottom = window.innerHeight - 10;
      const turquoiseCar = findTurquoiseCar(rail);
      const contextAnchor = turquoiseCar?.closest('section.cassini-section') || turquoiseCar;
      const contextRect = contextAnchor?.getBoundingClientRect() || anchorRect;
      left = Math.max(8, Math.round(anchorRect.right + 12));
      if (isBooking) {
        width = Math.max(320, Math.min(400, window.innerWidth - left - 12));
        top = Math.max(8, Math.min(Math.round(contextRect.top), viewportBottom - 520));
        maxHeight = Math.max(320, Math.min(1000, viewportBottom - top));
      } else {
        width = Math.max(320, Math.min(540, window.innerWidth - left - 12));
        top = Math.max(8, Math.min(Math.round(contextRect.top), viewportBottom - 240));
        maxHeight = Math.max(240, Math.min(460, viewportBottom - top));
      }
    }

    state.palette.style.left = `${left}px`;
    state.palette.style.top = `${top}px`;
    state.palette.style.width = `${width}px`;
    state.palette.style.maxHeight = `${maxHeight}px`;
  }

  function renderHeader(title, backAction, showSettings) {
    const header = element('div', 'kn-header');
    if (backAction) {
      const back = element('button', 'kn-icon-button', '‹');
      back.type = 'button';
      back.title = 'Back';
      back.addEventListener('click', backAction);
      header.appendChild(back);
    }
    header.appendChild(element('div', 'kn-title', title));
    if (showSettings) {
      const settings = element('button', 'kn-icon-button', '⚙');
      settings.type = 'button';
      settings.title = 'Phrase settings';
      settings.addEventListener('click', () => {
        state.view = 'settings';
        state.statusMessage = '';
        renderPalette();
      });
      header.appendChild(settings);
    }
    const stop = element('button', 'kn-icon-button kn-stop-button', '■ Stop');
    stop.type = 'button';
    stop.title = 'Stop Konnect Notes without refreshing the page. Click the bookmark again to load the latest version. Booking drafts are kept.';
    stop.addEventListener('click', stopKonnectNotes);
    header.appendChild(stop);
    const close = element('button', 'kn-icon-button', '×');
    close.type = 'button';
    close.title = 'Close';
    close.addEventListener('click', closePalette);
    header.appendChild(close);
    return header;
  }

  function getCategoryLabel(id) {
    return state.config?.categories.find((category) => category.id === id)?.label || id;
  }

  function searchPhrases(query) {
    if (!state.config) return [];
    const terms = normaliseText(query).toLowerCase().split(' ').filter(Boolean);
    const configuredOrder = new Map(state.config.phrases.map((phrase, index) => [phrase.id, index]));
    return state.config.phrases
      .filter((phrase) => state.activeCategory === 'all' || phrase.category === state.activeCategory)
      .filter((phrase) => {
        if (!terms.length) return true;
        const haystack = `${phrase.label} ${phrase.text} ${(phrase.aliases || []).join(' ')}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => configuredOrder.get(a.id) - configuredOrder.get(b.id));
  }

  function phrasePreview(phrase) {
    return phrase.text
      .replace('{{attempt}}', '[attempt]')
      .replace('{{email}}', ' [top email]')
      .replaceAll('{{agent}}', getAgentName() || '[your name]')
      .replace(/\n/g, ' · ');
  }

  function renderResults(container, searchInput) {
    const old = container.querySelector('.kn-results');
    if (old) old.remove();
    const results = searchPhrases(state.searchQuery);
    if (state.selectedResult >= results.length) state.selectedResult = Math.max(0, results.length - 1);
    const list = element('div', 'kn-results');
    if (!results.length) {
      list.appendChild(element('div', 'kn-muted', 'No matching phrases.'));
    }
    results.forEach((phrase, index) => {
      const row = element('button', `kn-result${index === state.selectedResult ? ' kn-selected' : ''}`);
      row.type = 'button';
      row.appendChild(element('span', 'kn-result-label', phrase.label));
      const meta = element('span', 'kn-result-meta');
      meta.appendChild(element('span', '', getCategoryLabel(phrase.category)));
      const preferredAlias = (phrase.aliases || [])[0];
      if (preferredAlias) {
        const example = `${preferredAlias}${phrase.requiresAttempt ? '1' : ''}`;
        meta.appendChild(element('span', 'kn-result-shortcut', example));
      }
      row.appendChild(meta);
      row.appendChild(element('span', 'kn-result-preview', phrasePreview(phrase)));
      row.addEventListener('mouseenter', () => {
        state.selectedResult = index;
        list.querySelectorAll('.kn-result').forEach((item, itemIndex) =>
          item.classList.toggle('kn-selected', itemIndex === index)
        );
      });
      row.addEventListener('click', () => choosePhrase(phrase));
      list.appendChild(row);
    });
    container.appendChild(list);
    searchInput._results = results;
  }

  function renderMain() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Konnect Notes', null, true));
    const body = element('div', 'kn-body');

    body.appendChild(button('Booking  (B)', 'kn-primary kn-browse-button', openBooking));
    if (state.config) {
      const quickGrid = element('div', 'kn-quick-grid');
      state.config.phrases
        .filter((phrase) => phrase.quickOrder >= 1 && phrase.quickOrder <= 5)
        .sort((a, b) => a.quickOrder - b.quickOrder)
        .forEach((phrase) => {
          const quick = element('button', 'kn-quick');
          quick.type = 'button';
          quick.appendChild(element('span', 'kn-quick-key', String(phrase.quickOrder)));
          quick.appendChild(document.createTextNode(phrase.label));
          quick.addEventListener('click', () => choosePhrase(phrase));
          quickGrid.appendChild(quick);
        });
      body.appendChild(quickGrid);
      const browse = button('Search / browse all phrases', 'kn-primary kn-browse-button', () => {
        state.view = 'browse';
        state.selectedResult = 0;
        renderPalette();
      });
      body.appendChild(browse);
      body.appendChild(element('div', 'kn-muted kn-shortcut-hint', 'Keys 1–5 select a quick option'));
    } else {
      if (state.configStatus) body.appendChild(element('div', 'kn-status', state.configStatus));
      body.appendChild(element('div', 'kn-muted', 'Phrase configuration has not loaded yet.'));
    }

    palette.appendChild(body);
  }

  function renderBrowse() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Search all phrases', () => {
      state.view = 'main';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body');
    if (state.statusMessage) body.appendChild(element('div', 'kn-status', state.statusMessage));
    const controls = element('div', 'kn-browse-controls');
    body.appendChild(controls);
    const search = element('input', 'kn-search');
    search.type = 'search';
    search.placeholder = 'Search phrases or use an abbreviation...';
    search.value = state.searchQuery;
    controls.appendChild(search);

    if (state.config) {
      const categories = element('div', 'kn-categories');
      const categoryItems = [{ id: 'all', label: 'All' }].concat(state.config.categories);
      categoryItems.forEach((category) => {
        const chip = element(
          'button',
          `kn-chip${state.activeCategory === category.id ? ' kn-active' : ''}`,
          category.label
        );
        chip.type = 'button';
        chip.addEventListener('click', () => {
          state.activeCategory = category.id;
          state.selectedResult = 0;
          renderPalette();
        });
        categories.appendChild(chip);
      });
      controls.appendChild(categories);
      renderResults(body, search);
    } else {
      body.appendChild(element('div', 'kn-muted', 'Phrase configuration has not loaded yet.'));
    }

    search.addEventListener('input', () => {
      state.searchQuery = search.value;
      state.selectedResult = 0;
      renderResults(body, search);
    });
    search.addEventListener('keydown', (event) => {
      const results = search._results || [];
      if (event.key === 'ArrowDown' && results.length) {
        event.preventDefault();
        state.selectedResult = (state.selectedResult + 1) % results.length;
        renderResults(body, search);
      } else if (event.key === 'ArrowUp' && results.length) {
        event.preventDefault();
        state.selectedResult = (state.selectedResult - 1 + results.length) % results.length;
        renderResults(body, search);
      } else if (event.key === 'Enter' && results[state.selectedResult]) {
        event.preventDefault();
        choosePhrase(results[state.selectedResult]);
      }
    });

    palette.appendChild(body);
    requestAnimationFrame(() => {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    });
  }

  function renderAttempt() {
    const palette = ensurePalette();
    const phrase = state.attemptPhrase;
    palette.appendChild(renderHeader(
      phrase ? phrase.label : 'Choose attempt',
      () => {
        state.view = 'main';
        state.attemptPhrase = null;
        state.otherAttemptOpen = false;
        renderPalette();
      },
      false
    ));
    const body = element('div', 'kn-body');
    body.appendChild(element('div', 'kn-muted', 'Choose attempt 1, 2, 3, or enter another number.'));
    const grid = element('div', 'kn-attempt-grid');
    [1, 2, 3].forEach((attempt) => {
      const choice = element('button', 'kn-attempt', String(attempt));
      choice.type = 'button';
      choice.addEventListener('click', () => insertPhrase(phrase, attempt));
      grid.appendChild(choice);
    });
    const other = element('button', 'kn-attempt', 'Other');
    other.type = 'button';
    other.addEventListener('click', () => {
      state.otherAttemptOpen = true;
      renderPalette();
    });
    grid.appendChild(other);
    body.appendChild(grid);

    if (state.otherAttemptOpen) {
      const input = element('input', 'kn-input');
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.placeholder = 'Attempt number';
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const attempt = Number(input.value);
          if (Number.isInteger(attempt) && attempt > 0) insertPhrase(phrase, attempt);
        }
      });
      body.appendChild(input);
      requestAnimationFrame(() => input.focus());
    }
    palette.appendChild(body);
  }

  function renderSettings() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Phrase settings', () => {
      state.view = 'main';
      state.statusMessage = '';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body');
    body.appendChild(element('div', 'kn-status', state.statusMessage || state.configStatus));
    body.appendChild(element('div', 'kn-muted', `Notes are signed as: ${getAgentName() || 'not set'}`));

    const actions = element('div', 'kn-settings-actions');
    actions.appendChild(button('Change name', '', () => {
      const name = askAgentName();
      state.statusMessage = name ? `Notes will be signed as ${name}.` : 'No name saved.';
      renderPalette();
    }));
    actions.appendChild(button('Add phrase', 'kn-primary', () => {
      state.editingPhraseId = null;
      state.view = 'edit';
      renderPalette();
    }));
    actions.appendChild(button('Export', '', () => {
      state.view = 'export';
      renderPalette();
    }));
    actions.appendChild(button('Import', '', () => {
      state.view = 'import';
      renderPalette();
    }));
    actions.appendChild(button('Restore GitHub', '', async () => {
      if (!confirm('Replace local phrase changes with the current GitHub configuration?')) return;
      state.configStatus = 'Restoring GitHub phrases...';
      renderPalette();
      const remote = await refreshRemoteConfig({ force: true });
      state.statusMessage = remote ? 'GitHub phrases restored.' : 'GitHub phrases could not be loaded.';
      renderPalette();
    }));
    body.appendChild(actions);

    const list = element('div', 'kn-phrase-list');
    (state.config?.phrases || []).forEach((phrase) => {
      const row = element('div', 'kn-phrase-row');
      const top = element('div', 'kn-phrase-row-top');
      const title = element('div', 'kn-phrase-row-title');
      title.appendChild(document.createTextNode(phrase.label));
      title.appendChild(element('div', 'kn-muted', getCategoryLabel(phrase.category)));
      top.appendChild(title);
      const rowActions = element('div', 'kn-row-actions');
      rowActions.appendChild(button('Edit', '', () => {
        state.editingPhraseId = phrase.id;
        state.view = 'edit';
        renderPalette();
      }));
      rowActions.appendChild(button('Delete', 'kn-danger', () => {
        if (!confirm(`Delete “${phrase.label}” from local settings?`)) return;
        state.config.phrases = state.config.phrases.filter((item) => item.id !== phrase.id);
        state.dirty = true;
        state.configStatus = 'Local changes are active and have not yet been published.';
        writeStored();
        renderPalette();
      }));
      top.appendChild(rowActions);
      row.appendChild(top);
      row.appendChild(element('div', 'kn-result-preview', phrasePreview(phrase)));
      list.appendChild(row);
    });
    body.appendChild(list);
    palette.appendChild(body);
  }

  function labelledField(labelText, control) {
    const wrapper = element('label', 'kn-field');
    wrapper.appendChild(element('span', 'kn-field-label', labelText));
    wrapper.appendChild(control);
    return wrapper;
  }

  function renderEditor() {
    const palette = ensurePalette();
    const current = state.config?.phrases.find((phrase) => phrase.id === state.editingPhraseId) || null;
    palette.appendChild(renderHeader(current ? 'Edit phrase' : 'Add phrase', () => {
      state.view = 'settings';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body');
    const labelInput = element('input', 'kn-input');
    labelInput.value = current?.label || '';
    labelInput.placeholder = 'Display name';
    body.appendChild(labelledField('Name', labelInput));

    const categorySelect = element('select', 'kn-select');
    (state.config?.categories || []).forEach((category) => {
      const option = element('option', '', category.label);
      option.value = category.id;
      option.selected = category.id === (current?.category || state.config.categories[0]?.id);
      categorySelect.appendChild(option);
    });
    body.appendChild(labelledField('Category', categorySelect));

    const textInput = element('textarea', 'kn-textarea');
    textInput.value = current?.text || '';
    textInput.placeholder = 'Exact phrase text';
    body.appendChild(labelledField('Phrase', textInput));
    body.appendChild(element('div', 'kn-muted', 'Use {{agent}} where your name should go.'));

    const aliasesInput = element('input', 'kn-input');
    aliasesInput.value = (current?.aliases || []).join(', ');
    aliasesInput.placeholder = 'vm, another-shortcut';
    body.appendChild(labelledField('Abbreviations (comma separated)', aliasesInput));

    const quickSelect = element('select', 'kn-select');
    [{ value: '', label: 'Not a quick button' }, 1, 2, 3, 4, 5].forEach((item) => {
      const value = typeof item === 'number' ? String(item) : item.value;
      const label = typeof item === 'number' ? `Quick button ${item}` : item.label;
      const option = element('option', '', label);
      option.value = value;
      option.selected = value === String(current?.quickOrder || '');
      quickSelect.appendChild(option);
    });
    body.appendChild(labelledField('Quick button', quickSelect));

    const attemptRow = element('label', 'kn-check-row');
    const attemptCheck = element('input');
    attemptCheck.type = 'checkbox';
    attemptCheck.checked = Boolean(current?.requiresAttempt);
    attemptRow.appendChild(attemptCheck);
    attemptRow.appendChild(document.createTextNode('Ask for attempt number (phrase must contain {{attempt}})'));
    body.appendChild(attemptRow);

    const emailRow = element('label', 'kn-check-row');
    const emailCheck = element('input');
    emailCheck.type = 'checkbox';
    emailCheck.checked = current?.emailSource === 'top';
    emailRow.appendChild(emailCheck);
    emailRow.appendChild(document.createTextNode('Use top email (phrase must contain {{email}})'));
    body.appendChild(emailRow);

    const error = element('div', 'kn-status');
    error.classList.remove('kn-status-error');
    error.style.display = 'none';
    body.appendChild(error);

    const formActions = element('div', 'kn-form-actions');
    formActions.appendChild(button('Save phrase', 'kn-primary', () => {
      const label = labelInput.value.trim();
      const text = textInput.value;
      if (!label || !text.trim()) {
        error.textContent = 'Name and phrase text are required.';
        error.classList.add('kn-status-error');
        error.style.display = 'block';
        return;
      }
      if (attemptCheck.checked && !text.includes('{{attempt}}')) {
        error.textContent = 'Attempt phrases must include {{attempt}}.';
        error.classList.add('kn-status-error');
        error.style.display = 'block';
        return;
      }
      if (emailCheck.checked && !text.includes('{{email}}')) {
        error.textContent = 'Top-email phrases must include {{email}}.';
        error.classList.add('kn-status-error');
        error.style.display = 'block';
        return;
      }

      const aliases = Array.from(new Set(
        aliasesInput.value.split(',').map((alias) => alias.trim().toLowerCase()).filter(Boolean)
      ));
      const conflict = state.config.phrases.find((item) =>
        item.id !== current?.id && aliases.some((alias) => (item.aliases || []).includes(alias))
      );
      if (conflict) {
        error.textContent = `An abbreviation is already used by “${conflict.label}”.`;
        error.classList.add('kn-status-error');
        error.style.display = 'block';
        return;
      }

      const phrase = {
        id: current?.id || `${slug(label)}-${Date.now().toString(36)}`,
        label,
        category: categorySelect.value,
        text,
        aliases,
        requiresAttempt: attemptCheck.checked
      };
      const quick = Number(quickSelect.value);
      if (quick >= 1 && quick <= 5) {
        phrase.quickOrder = quick;
        state.config.phrases.forEach((item) => {
          if (item.id !== phrase.id && item.quickOrder === quick) delete item.quickOrder;
        });
      }
      if (emailCheck.checked) phrase.emailSource = 'top';

      const index = state.config.phrases.findIndex((item) => item.id === phrase.id);
      if (index >= 0) state.config.phrases[index] = phrase;
      else state.config.phrases.push(phrase);
      state.config = validateConfig(state.config);
      state.dirty = true;
      state.configStatus = 'Local changes are active and have not yet been published.';
      writeStored();
      state.statusMessage = 'Phrase saved locally.';
      state.view = 'settings';
      renderPalette();
    }));
    formActions.appendChild(button('Cancel', '', () => {
      state.view = 'settings';
      renderPalette();
    }));
    body.appendChild(formActions);
    palette.appendChild(body);
  }

  async function copyText(text, statusNode) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      textarea.remove();
    }
    if (statusNode) statusNode.textContent = copied ? 'Copied to clipboard.' : 'Copy was blocked; select and copy the text manually.';
    return copied;
  }

  function renderExport() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Export phrases', () => {
      state.view = 'settings';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body');
    body.appendChild(element('div', 'kn-muted', 'Copy this complete configuration into Konnect-Notes-Phrases.json on GitHub.'));
    const output = element('textarea', 'kn-textarea kn-export');
    output.readOnly = true;
    output.value = JSON.stringify(state.config, null, 2);
    body.appendChild(output);
    const status = element('div', 'kn-status', 'Local customer or lead data is never included.');
    body.appendChild(status);
    body.appendChild(button('Copy configuration', 'kn-primary', () => copyText(output.value, status)));
    palette.appendChild(body);
    requestAnimationFrame(() => output.setSelectionRange(0, 0));
  }

  function renderImport() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Import phrases', () => {
      state.view = 'settings';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body');
    const input = element('textarea', 'kn-textarea kn-export');
    input.placeholder = 'Paste a Konnect Notes JSON configuration';
    body.appendChild(input);
    const status = element('div', 'kn-status', 'Imported phrases will be saved locally first.');
    body.appendChild(status);
    body.appendChild(button('Import configuration', 'kn-primary', () => {
      try {
        const parsed = JSON.parse(input.value);
        setWorkingConfig(parsed, true, 'Imported configuration saved locally.');
        state.statusMessage = 'Configuration imported successfully.';
        state.view = 'settings';
        renderPalette();
      } catch (error) {
        status.textContent = `Import failed: ${error.message}`;
      }
    }));
    palette.appendChild(body);
    requestAnimationFrame(() => input.focus());
  }

  /* ======================================================================
     Booking Builder
     Builds the booking block for Call Notes with tap-only options plus
     optional typing. Wording comes from Konnect-Booking-Engine.js.
     Lead values (Vehicle of Interest / Part Exchange) only fill empty
     booking fields; anything already entered is never changed without
     the agent tapping "Use it".
     ====================================================================== */

  const BOOKING_DRAFTS_KEY = 'konnectNotes:bookingDrafts:v1';
  const BOOKING_DRAFT_MAX_AGE = 3 * 24 * 60 * 60 * 1000;

  const BOOKING_TYPES = [
    { value: 'testdrive', label: 'Test drive' },
    { value: 'call', label: 'Call' },
    { value: 'view', label: 'View' },
    { value: 'motability', label: 'Motability' },
    { value: 'onlinestore', label: 'Online Store' },
    { value: 'valuation', label: 'Valuation only' },
    { value: 'national', label: 'National Res' }
  ];
  const BOOKING_SUBTYPES = {
    call: [{ value: '', label: 'Discuss + video' }, { value: 'valuation', label: 'Valuation call' }],
    motability: [{ value: 'testdrive', label: 'Test drive' }, { value: 'view', label: 'View' },
      { value: 'discuss', label: 'Onsite discuss' }, { value: 'call', label: 'Call' }],
    onlinestore: [{ value: 'discuss', label: 'Discuss' }, { value: 'call', label: 'Call' },
      { value: 'similar', label: 'TD similar' }, { value: 'valuationcall', label: 'Valuation call' }],
    valuation: [{ value: 'onsite', label: 'In person' }, { value: 'call', label: 'Call' }]
  };
  const BOOKING_SUBTYPE_DEFAULT = { motability: 'testdrive', onlinestore: 'discuss', valuation: 'onsite', call: '' };
  const PX_STATUSES = [
    { value: 'unmentioned', label: 'Not mentioned' },
    { value: 'yes', label: 'Has PX' },
    { value: 'none', label: 'No PX' },
    { value: 'private', label: 'Selling privately' },
    { value: 'elsewhere', label: 'Selling elsewhere' },
    { value: 'taking', label: 'Taking elsewhere' },
    { value: 'leaseReturn', label: 'Lease ending' }
  ];
  const PAYMENT_KINDS = [
    { value: 'unmentioned', label: 'Not mentioned' },
    { value: 'cash', label: 'Cash' },
    { value: 'cashOffers', label: 'Cash + offers' },
    { value: 'finance', label: 'Finance' },
    { value: 'both', label: 'Finance or cash' }
  ];
  const QUICK_NOTES = [
    'Call customer beforehand to confirm availability',
    'Discuss finance options',
    'Discuss delivery options',
    'Discuss lead times',
    'Discuss settlement figure',
    'Discuss insurance'
  ];
  const LEAD_FIELD_LABELS = {
    'v.reg': 'Vehicle reg',
    'v.make': 'Vehicle brand',
    'v.model': 'Vehicle model',
    'v.descriptor': 'Vehicle fuel type',
    'v.condition': 'Purchase type',
    'type': 'Purchase type',
    'px.make': 'PX brand',
    'px.model': 'PX model',
    'px.reg': 'PX reg',
    'px.mileage': 'PX mileage',
    'px.roughVal': 'PX valuation'
  };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  let engineLoading = null;
  let bookingSaveTimer = null;
  let bookingSyncTimer = null;
  let bookingRefs = null;

  function bookingEngine() {
    return window.KonnectBookingEngine || null;
  }

  function loadBookingEngine() {
    if (bookingEngine()) return Promise.resolve(bookingEngine());
    if (!engineLoading) {
      engineLoading = fetch(`${ENGINE_URL}?_=${Date.now()}`, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then((code) => {
          Function(code)();
          if (!bookingEngine()) throw new Error('engine did not start');
          return bookingEngine();
        })
        .catch((error) => {
          engineLoading = null;
          state.bookingError = `Could not load the booking engine (${error.message}).`;
          throw error;
        });
    }
    return engineLoading;
  }

  function blankBooking() {
    return {
      contact: 'none',
      fao: '',
      type: '',
      subtype: '',
      day: '',
      month: '',
      time: '',
      timeQualifier: '',
      vehicles: [{ make: '', model: '', reg: '', descriptor: '', condition: '' }],
      category: '',
      px: { status: 'unmentioned', items: [{ make: '', model: '', reg: '', mileage: '', mileageUnknown: '', roughVal: '', finance: '', financeEnds: '', details: '' }] },
      sellingReason: '',
      payment: { kind: 'unmentioned', financeType: '', deposit: '', term: '', mpa: '', budget: '', extra: '' },
      reserved: false,
      onBehalfOf: '',
      notesText: '',
      emailNote: false,
      emailAction: '',
      td24: false
    };
  }

  function readDrafts() {
    try {
      const raw = localStorage.getItem(BOOKING_DRAFTS_KEY);
      const drafts = raw ? JSON.parse(raw) : {};
      return drafts && typeof drafts === 'object' ? drafts : {};
    } catch (error) {
      return {};
    }
  }

  function writeDrafts(drafts) {
    const now = Date.now();
    const kept = Object.entries(drafts)
      .filter(([, draft]) => draft && now - (draft.updated || 0) < BOOKING_DRAFT_MAX_AGE)
      .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0))
      .slice(0, 30);
    try {
      localStorage.setItem(BOOKING_DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch (error) {
      // Drafts are a convenience; the booking still works without them.
    }
  }

  function activeLeadPane() {
    return state.target?.closest('.tab-pane') || null;
  }

  function leadKey() {
    if (!state.target && (inboundScreen() || inbound.pending)) return INBOUND_KEY;
    const pane = activeLeadPane();
    const tabs = pane?.closest('.tab-content')?.parentElement;
    const active = tabs?.querySelector('li.active[id^="salesTab-"]') ||
      document.querySelector('li.active[id^="salesTab-"]');
    return active?.id || 'lead';
  }

  function currentDraft() {
    const key = leadKey();
    if (state.booking && state.booking.key === key) return state.booking;
    if (inbound.mobileLead && key !== inbound.mobileLead && key !== INBOUND_KEY) forgetInboundCustomer();
    const adopted = adoptInboundDraft(key);
    if (adopted) {
      state.booking = adopted;
      saveDraftNow();
      return state.booking;
    }
    const stored = readDrafts()[key];
    state.booking = stored && stored.data ? {
      key,
      data: { ...blankBooking(), ...stored.data },
      leadSeen: stored.leadSeen || {},
      fromLead: stored.fromLead || {},
      notices: stored.notices || [],
      inserted: stored.inserted || null,
      openSection: stored.openSection || 'type',
      updated: stored.updated || Date.now()
    } : {
      key,
      data: blankBooking(),
      leadSeen: {},
      fromLead: {},
      notices: [],
      inserted: null,
      openSection: key === INBOUND_KEY ? 'customer' : 'type',
      updated: Date.now()
    };
    return state.booking;
  }

  function saveDraftSoon() {
    clearTimeout(bookingSaveTimer);
    bookingSaveTimer = setTimeout(saveDraftNow, 250);
  }

  function saveDraftNow() {
    const draft = state.booking;
    if (!draft) return;
    draft.updated = Date.now();
    const drafts = readDrafts();
    drafts[draft.key] = {
      data: draft.data,
      leadSeen: draft.leadSeen,
      fromLead: draft.fromLead,
      notices: draft.notices,
      inserted: draft.inserted,
      openSection: draft.openSection,
      updated: draft.updated
    };
    writeDrafts(drafts);
  }

  /* ---------- reading the lead (Vehicle of Interest / Part Exchange) ---------- */

  function leadPanel(pane, headingText) {
    if (!pane) return null;
    const heading = Array.from(pane.querySelectorAll('.sales-lead-accordion-heading, .panel-heading'))
      .find((node) => normaliseText(node.textContent).toLowerCase() === headingText);
    return heading?.closest('.panel') || null;
  }

  /* "-", "n/a", "none" and similar stand-ins in a lead box count as empty. */
  function isPlaceholderValue(value) {
    const engine = bookingEngine();
    if (engine && engine.isPlaceholder) return engine.isPlaceholder(value);
    return /^[-\s.]*$/.test(normaliseText(value));
  }

  function realText(value) {
    return isPlaceholderValue(value) ? '' : normaliseText(value);
  }

  function inputByPlaceholder(panel, placeholder) {
    const input = panel?.querySelector(`input[placeholder="${placeholder}"]`);
    return input ? realText(input.value) : '';
  }

  function selectedText(select) {
    if (!(select instanceof HTMLSelectElement)) return '';
    const option = select.options[select.selectedIndex];
    const text = normaliseText(option?.textContent);
    return /^\(?select/i.test(text) ? '' : text;
  }

  function labelledSelect(pane, labelText) {
    const label = Array.from(pane?.querySelectorAll('label') || [])
      .find((node) => normaliseText(node.textContent).toLowerCase() === labelText);
    return label?.closest('.form-group, .row')?.querySelector('select') || null;
  }

  function pxSwitchOn(panel) {
    const toggle = panel?.querySelector('toggle');
    if (!toggle) return null;
    try {
      const ng = window.angular;
      const model = toggle.getAttribute('ng-model');
      if (ng && model) {
        const scope = ng.element(toggle).scope();
        if (scope) {
          const value = scope.$eval(model);
          if (typeof value === 'boolean') return value;
        }
      }
    } catch (error) {
      // Fall back to the toggle's classes below.
    }
    const control = toggle.querySelector('.toggle');
    if (!control) return null;
    return !control.classList.contains('off');
  }

  function readLead() {
    const pane = activeLeadPane();
    const voi = leadPanel(pane, 'vehicle of interest');
    const px = leadPanel(pane, 'part exchange');
    const fields = {};
    if (voi) {
      fields['v.reg'] = inputByPlaceholder(voi, 'Reg Number');
      fields['v.make'] = inputByPlaceholder(voi, 'Vehicle Brand');
      fields['v.model'] = inputByPlaceholder(voi, 'Vehicle Model');
      /* Fuel type only matters for cars without a reg; a reg already pins the car down. */
      /* Fuel only describes a car the lead actually names, and only when there is no reg. */
      const named = fields['v.make'] || fields['v.model'];
      fields['v.descriptor'] = named && !fields['v.reg'] ? inputByPlaceholder(voi, 'Fuel Type') : '';
      const purchase = selectedText(voi.querySelector('select')).toLowerCase();
      if (purchase === 'motability') fields.type = 'motability';
      else if (purchase === 'new' || purchase === 'used' || purchase === 'pre-registered') fields['v.condition'] = purchase;
    }
    const pxOn = px ? pxSwitchOn(px) : null;
    const pxFields = {};
    if (px) {
      pxFields['px.make'] = inputByPlaceholder(px, 'Vehicle Brand');
      pxFields['px.model'] = inputByPlaceholder(px, 'Vehicle Model');
      pxFields['px.reg'] = inputByPlaceholder(px, 'Reg Number');
      pxFields['px.mileage'] = inputByPlaceholder(px, 'Mileage');
      pxFields['px.roughVal'] = inputByPlaceholder(px, 'Valuation');
    }
    const engine = bookingEngine();
    const request = engine ? engine.parseRequestedSlot(readInitialNotes()) : null;
    return {
      found: Boolean(voi || px || request),
      request,
      fields,
      pxOn,
      pxFields,
      pxHasValues: Boolean(pxFields['px.make'] || pxFields['px.model'] || pxFields['px.reg'] || pxFields['px.mileage']),
      leadRequest: selectedText(labelledSelect(pane, 'lead request')),
      source: selectedText(labelledSelect(pane, 'source of enquiry'))
    };
  }

  function getBookingField(data, path) {
    if (path === 'type') return data.type;
    const [group, key] = path.split('.');
    if (group === 'v') return data.vehicles[0]?.[key] || '';
    if (group === 'px') return data.px.items[0]?.[key] || '';
    return '';
  }

  function setBookingField(data, path, value) {
    if (path === 'type') {
      data.type = value;
      data.subtype = BOOKING_SUBTYPE_DEFAULT[value] || '';
      return;
    }
    const [group, key] = path.split('.');
    if (group === 'v') {
      if (!data.vehicles[0]) data.vehicles[0] = blankBooking().vehicles[0];
      data.vehicles[0][key] = value;
    } else if (group === 'px') {
      if (!data.px.items[0]) data.px.items[0] = blankBooking().px.items[0];
      data.px.items[0][key] = value;
    }
  }

  function sameValue(a, b) {
    return normaliseText(a).toLowerCase().replace(/\s+/g, '') === normaliseText(b).toLowerCase().replace(/\s+/g, '');
  }

  function addNotice(draft, notice) {
    draft.notices = draft.notices.filter((item) => item.path !== notice.path);
    draft.notices.push(notice);
  }

  /* Empty booking fields are filled from the lead (and tagged "from lead").
     A lead value that differs from something already in the booking only
     raises a notice; the agent decides with Use it / Keep mine. */
  function syncLead(draft) {
    const lead = readLead();
    let changed = false;
    if (!lead.found) return false;
    const data = draft.data;

    const consider = (path, value) => {
      const seen = draft.leadSeen[path];
      draft.leadSeen[path] = value;
      if (seen === value || !value) return;
      const current = getBookingField(data, path);
      if (!current) {
        setBookingField(data, path, value);
        draft.fromLead[path] = true;
        changed = true;
      } else if (!sameValue(current, value)) {
        addNotice(draft, { path, value, label: `${LEAD_FIELD_LABELS[path] || path} on the lead is now "${value}"` });
        changed = true;
      }
    };

    Object.entries(lead.fields).forEach(([path, value]) => consider(path, value));

    const switchState = lead.pxOn === null ? null : (lead.pxOn ? 'on' : 'off');
    const seenSwitch = draft.leadSeen['px.on'];
    draft.leadSeen['px.on'] = switchState;
    if (data.type !== 'valuation' && switchState && switchState !== seenSwitch) {
      if (switchState === 'on' && !lead.pxHasValues) {
        /* Switch on but only blanks or "-" in the boxes: nothing to use yet. */
        draft.leadSeen['px.on'] = seenSwitch;
      } else if (switchState === 'on' && data.px.status === 'unmentioned') {
        data.px.status = 'yes';
        draft.fromLead['px.status'] = true;
        changed = true;
      } else if (switchState === 'on' && data.px.status !== 'yes') {
        addNotice(draft, { path: 'px.on', value: 'on', label: 'The lead\'s Part Exchange switch is on' });
        changed = true;
      } else if (switchState === 'off' && data.px.status === 'yes' && seenSwitch === 'on') {
        addNotice(draft, { path: 'px.on', value: 'off', label: 'The lead\'s Part Exchange switch is now off' });
        changed = true;
      } else if (switchState === 'off' && lead.pxHasValues && data.px.status === 'unmentioned') {
        addNotice(draft, { path: 'px.on', value: 'on', label: 'PX details are on the lead but its switch is off' });
        changed = true;
      }
    }

    if (lead.pxOn || data.type === 'valuation' || data.px.status === 'yes') {
      Object.entries(lead.pxFields).forEach(([path, value]) => consider(path, value));
    } else {
      Object.entries(lead.pxFields).forEach(([path, value]) => { draft.leadSeen[path] = value; });
    }

    draft.leadHints = { leadRequest: lead.leadRequest, source: lead.source, request: lead.request };
    if (syncRequestedSlot(draft, lead.request)) changed = true;
    if (changed) saveDraftSoon();
    return changed;
  }

  function requestKey(request) {
    return request ? `${request.day}/${request.month}/${request.year || ''} ${request.time}`.trim() : '';
  }

  function requestIsPast(request) {
    const engine = bookingEngine();
    if (!engine || !request || !request.day) return false;
    const date = engine.resolveDate({ day: request.day, month: request.month, year: request.year }, new Date());
    return Boolean(date.error);
  }

  function describeRequest(request) {
    if (!request) return '';
    const parts = [];
    if (request.day) {
      const when = new Date(request.year || new Date().getFullYear(), Number(request.month) - 1, Number(request.day));
      parts.push(`${WEEKDAYS[when.getDay()]} ${Number(request.day)} ${MONTHS_LONG[Number(request.month) - 1]}`);
    }
    if (request.time) parts.push(`at ${request.time}`);
    if (request.partOfDay) parts.push(`(${request.partOfDay})`);
    return parts.join(' ');
  }

  function applyRequest(draft, request) {
    const d = draft.data;
    if (request.day) {
      d.day = request.day;
      d.month = request.month;
    }
    if (request.time) d.time = request.time;
    draft.fromLead.when = true;
  }

  /* A date/time the customer asked for in the Initial Notes fills an empty
     When section. If the agent has already picked something different,
     it only raises a notice. Dates that have passed are never filled. */
  function syncRequestedSlot(draft, request) {
    const key = requestKey(request);
    const seen = draft.leadSeen.when;
    draft.leadSeen.when = key;
    if (!key || key === seen || requestIsPast(request)) return false;
    const d = draft.data;
    if (!d.day && !d.time) {
      applyRequest(draft, request);
      return true;
    }
    const sameDay = !request.day || (Number(d.day) === Number(request.day) && Number(d.month) === Number(request.month));
    const sameTime = !request.time || d.time === request.time;
    if (sameDay && sameTime) return false;
    addNotice(draft, { path: 'when', value: key, request, label: `Initial notes ask for ${describeRequest(request)}` });
    return true;
  }

  function applyNotice(draft, notice, use) {
    draft.notices = draft.notices.filter((item) => item !== notice);
    if (use) {
      if (notice.path === 'when') {
        applyRequest(draft, notice.request);
      } else if (notice.path === 'px.on') {
        draft.data.px.status = notice.value === 'on' ? 'yes' : 'unmentioned';
        if (notice.value === 'on') {
          const lead = readLead();
          Object.entries(lead.pxFields).forEach(([path, value]) => {
            if (value && !getBookingField(draft.data, path)) {
              setBookingField(draft.data, path, value);
              draft.fromLead[path] = true;
            }
          });
        }
      } else {
        setBookingField(draft.data, notice.path, notice.value);
        draft.fromLead[notice.path] = true;
      }
    }
    saveDraftNow();
    renderPalette();
  }

  function onLeadActivity(event) {
    if (!state.open || state.view !== 'booking' || !state.booking) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(`#${PALETTE_ID}`)) return;
    if (!target.closest('.panel')) return;
    clearTimeout(bookingSyncTimer);
    bookingSyncTimer = setTimeout(() => {
      if (state.booking && syncLead(state.booking)) renderPalette();
    }, 200);
  }

  /* ---------- building ---------- */

  function bookingInput(draft) {
    const d = draft.data;
    const email = (d.contact === 'email' || d.emailNote) ? findTopEmail() : '';
    return {
      agent: getAgentName(),
      contact: d.contact,
      email,
      fao: d.fao,
      type: d.type,
      subtype: d.subtype,
      date: { day: d.day, month: d.month },
      time: d.time,
      timeQualifier: d.timeQualifier,
      vehicles: d.type === 'valuation' ? [] : d.vehicles,
      category: d.category,
      px: {
        status: d.type === 'valuation' ? 'yes' : d.px.status,
        items: d.px.items.map((item) => ({
          ...item,
          details: normaliseText(item.details) ? String(item.details).split(/\s*[|\n]\s*/) : []
        }))
      },
      sellingReason: d.sellingReason,
      payment: { ...d.payment, extras: d.payment.extra ? String(d.payment.extra).split(/\s*[|\n]\s*/) : [] },
      reserved: d.reserved,
      onBehalfOf: d.onBehalfOf,
      notes: [...(d.td24 ? [td24Note(d)] : []), ...String(d.notesText || '').split('\n')],
      customerEmail: d.emailNote ? email : '',
      emailAction: d.emailAction
    };
  }

  /* With a contact header the customer has not confirmed yet, so the
     24 hour request is only potential. */
  function td24Note(d) {
    return d.contact && d.contact !== 'none' ? 'Potential 24 hour test drive request' : '24 hour test drive request';
  }

  function buildCurrentBooking(draft) {
    const engine = bookingEngine();
    if (!engine) return null;
    const result = engine.buildBooking(bookingInput(draft));
    const d = draft.data;
    if (d.contact === 'email' && !findTopEmail()) result.errors.push('No email address found at the top of the lead');
    if (d.emailNote && !findTopEmail()) result.warnings.push('No email address found at the top of the lead');
    return result;
  }

  function insertBooking(draft) {
    const target = draft.key === INBOUND_KEY ? null : callNotesBox();
    const result = buildCurrentBooking(draft);
    if (!(target instanceof HTMLTextAreaElement)) {
      state.bookingStatus = { kind: 'warn', text: 'Create the lead first. This booking moves onto it when its Call Notes box appears.' };
      renderPalette();
      return;
    }
    if (!result) return;
    if (result.errors.length) {
      state.bookingStatus = { kind: 'error', text: 'Fix the items in red first.' };
      renderPalette();
      return;
    }
    const value = target.value;
    const text = result.text;
    let start;
    let end;
    let replacement;
    let note = '';
    const previous = draft.inserted;
    const at = previous ? value.indexOf(previous) : -1;
    if (at >= 0) {
      start = at;
      end = at + previous.length;
      replacement = text;
    } else {
      start = value.length;
      end = value.length;
      replacement = `${value && !value.endsWith('\n') ? '\n' : ''}${text}`;
      if (previous) note = 'The earlier booking in Call Notes was edited by hand, so the new one was added at the end. Delete the old one.';
    }
    const nextValue = value.slice(0, start) + replacement + value.slice(end);
    replaceTextUndoably(target, start, end, replacement, nextValue);
    draft.inserted = text;
    saveDraftNow();
    writeBookingToLead(draft).then((updated) => {
      if (updated.length) showToast(`Lead updated: ${updated.join(', ')}`);
    });
    if (note) {
      state.bookingStatus = { kind: 'warn', text: note };
      renderPalette();
      return;
    }
    state.bookingStatus = null;
    closePalette();
  }

  /* The Call Notes box for the open lead. Falls back to Konnect's own field
     name so it is still found when the section is folded shut. */
  function callNotesBox() {
    scanPage();
    if (state.target instanceof HTMLTextAreaElement && state.target.isConnected) return state.target;
    const selector = 'textarea[ng-model$="LeadDetails.Notes"]';
    const pane = document.querySelector('.tab-pane.active');
    return pane?.querySelector(selector) || document.querySelector(selector) || null;
  }

  /* Empties the whole Call Notes box as a normal edit, so Ctrl+Z in the
     box brings the text back, and clears Konnect's copy of the value too.
     Returns the number of characters removed, or -1 if the box was not found. */
  function clearCallNotes() {
    const target = callNotesBox();
    if (!(target instanceof HTMLTextAreaElement)) return -1;
    const removed = target.value.length;
    if (!removed) return 0;
    try {
      target.focus({ preventScroll: true });
      target.setSelectionRange(0, target.value.length);
      document.execCommand('delete', false);
    } catch (error) {
      // Fallback below.
    }
    if (target.value !== '') setNativeValue(target, '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const ng = window.angular;
      const model = ng ? ng.element(target).controller('ngModel') : null;
      if (model && model.$viewValue) {
        model.$setViewValue('');
        model.$render();
      }
    } catch (error) {
      // Konnect still gets the input/change events above.
    }
    state.lastSelection = { target, start: 0, end: 0 };
    return removed;
  }

  /* ---------- writing the booking's car details back to the lead ---------- */

  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'kn-toast';
    toast.textContent = text;
    toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;' +
      'max-width:80vw;padding:10px 16px;border-radius:12px;background:#1c1c1e;color:#fff;' +
      'font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.3);pointer-events:none';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  /* Sets a Konnect (AngularJS) box so its ng-model picks the value up. */
  function setLeadControl(control, value) {
    if (!control) return false;
    if (control instanceof HTMLSelectElement) {
      const option = Array.from(control.options).find((item) => normaliseText(item.textContent).toLowerCase() === value.toLowerCase());
      if (!option || control.value === option.value) return false;
      control.value = option.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (normaliseText(control.value) === value) return false;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    control.dispatchEvent(new Event('blur'));
    return true;
  }

  function fuelFromDescriptor(descriptor) {
    const match = String(descriptor || '').match(/\b(plug-?in hybrid|mild hybrid|petrol hybrid|diesel hybrid|petrol|diesel|hybrid|electric|phev|mhev|hev|bev|ev)\b/i);
    if (!match) return '';
    const word = match[1].toLowerCase();
    const upper = { phev: 'PHEV', mhev: 'MHEV', hev: 'HEV', bev: 'BEV', ev: 'EV' };
    return upper[word] || word.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function turnPxSwitchOn(panel) {
    const toggle = panel?.querySelector('toggle');
    if (!toggle || pxSwitchOn(panel) !== false) return false;
    try {
      const ng = window.angular;
      const model = toggle.getAttribute('ng-model');
      const scope = ng && model ? ng.element(toggle).scope() : null;
      if (scope) {
        scope.$apply(`${model} = true`);
        return true;
      }
    } catch (error) {
      // Fall back to clicking the switch.
    }
    (toggle.querySelector('.toggle') || toggle).click();
    return true;
  }

  /* Copies the booking's vehicle of interest and PX into the lead's boxes.
     Only fills or corrects: an empty booking value never clears a lead box.
     Returns the names of the boxes that changed. */
  function writeBookingToLead(draft) {
    const engine = bookingEngine();
    const pane = activeLeadPane();
    const d = draft.data;
    const updated = [];
    if (!engine || !pane) return Promise.resolve(updated);
    const tidy = (make, model) => {
      const split = engine.splitMakeModel(realText(make), realText(model));
      return { make: engine.normaliseMake(split.make), model: engine.normaliseModel(split.model) };
    };
    const put = (panel, placeholder, value, label, onlyIfEmpty) => {
      if (!value) return;
      const control = panel?.querySelector(`input[placeholder="${placeholder}"]`);
      if (!control) return;
      if (onlyIfEmpty && realText(control.value)) return;
      if (setLeadControl(control, value)) updated.push(label);
    };

    const voi = leadPanel(pane, 'vehicle of interest');
    const vehicle = d.type !== 'valuation' ? d.vehicles.find((v) => realText(v.make) || realText(v.model) || realText(v.reg)) : null;
    if (voi && vehicle) {
      const names = tidy(vehicle.make, vehicle.model);
      put(voi, 'Reg Number', engine.normaliseReg(realText(vehicle.reg)), 'Reg');
      put(voi, 'Vehicle Brand', names.make, 'Brand');
      put(voi, 'Vehicle Model', names.model, 'Model');
      put(voi, 'Fuel Type', fuelFromDescriptor(vehicle.descriptor), 'Fuel Type', true);
      const select = voi.querySelector('select');
      const current = selectedText(select);
      let purchase = '';
      if (d.type === 'motability') purchase = 'Motability';
      else if (!current) purchase = realText(vehicle.reg) || vehicle.condition === 'used' ? 'Used' : 'New';
      if (purchase && setLeadControl(select, purchase)) updated.push('Purchase Type');
      /* Record what was written as already seen, so it is not reported back as a lead change. */
      Object.entries(readLead().fields).forEach(([path, value]) => { draft.leadSeen[path] = value; });
    }

    const item = d.px.items[0];
    const wantPx = (d.type === 'valuation' || d.px.status === 'yes') && item &&
      (realText(item.make) || realText(item.model) || realText(item.reg) || realText(item.mileage));
    const pxPanel = leadPanel(pane, 'part exchange');
    if (!wantPx || !pxPanel) {
      saveDraftSoon();
      return Promise.resolve(updated);
    }
    const switched = turnPxSwitchOn(pxPanel);
    if (switched) updated.push('PX switch on');
    return new Promise((resolve) => {
      /* The PX boxes can be redrawn when the switch changes. */
      setTimeout(() => {
        const panel = leadPanel(activeLeadPane(), 'part exchange');
        const names = tidy(item.make, item.model);
        put(panel, 'Vehicle Brand', names.make, 'PX Brand');
        put(panel, 'Vehicle Model', names.model, 'PX Model');
        put(panel, 'Reg Number', engine.normaliseReg(realText(item.reg)), 'PX Reg');
        put(panel, 'Mileage', engine.normaliseMileage(realText(item.mileage)), 'PX Mileage');
        put(panel, 'Valuation', String(realText(item.roughVal)).replace(/[^\d.]/g, ''), 'PX Valuation');
        const lead = readLead();
        Object.entries(lead.pxFields).forEach(([path, value]) => { draft.leadSeen[path] = value; });
        if (lead.pxOn !== null) draft.leadSeen['px.on'] = lead.pxOn ? 'on' : 'off';
        saveDraftSoon();
        resolve(updated);
      }, switched ? 150 : 0);
    });
  }

  /* ---------- small UI helpers ---------- */

  function bkChips(options, current, onPick, extraClass) {
    const row = element('div', `kn-bk-chips ${extraClass || ''}`.trim());
    options.forEach((option) => {
      const chip = element('button', `kn-chip${option.value === current ? ' kn-active' : ''}`, option.label);
      chip.type = 'button';
      if (option.disabled) {
        chip.disabled = true;
        chip.title = option.disabled;
      }
      chip.addEventListener('click', () => onPick(option.value));
      row.appendChild(chip);
    });
    return row;
  }

  function bkInput(labelText, value, onInput, options) {
    const settings = options || {};
    const wrap = element('label', `kn-bk-field ${settings.className || ''}`.trim());
    if (labelText) {
      const label = element('span', 'kn-bk-label', labelText);
      if (settings.fromLead) label.appendChild(element('span', 'kn-bk-tag', 'from lead'));
      wrap.appendChild(label);
    }
    const input = element(settings.multiline ? 'textarea' : 'input', settings.multiline ? 'kn-input kn-bk-notes' : 'kn-input');
    if (!settings.multiline) input.type = 'text';
    input.value = value || '';
    if (settings.placeholder) input.placeholder = settings.placeholder;
    if (settings.maxLength) input.maxLength = settings.maxLength;
    if (settings.inputMode) input.inputMode = settings.inputMode;
    input.addEventListener('input', () => onInput(input.value, input));
    input.addEventListener('keydown', (event) => event.stopPropagation());
    wrap.appendChild(input);
    return wrap;
  }

  function changed(draft, rerender) {
    if (draft.key === INBOUND_KEY) inbound.pending = true;
    saveDraftSoon();
    state.bookingStatus = null;
    if (rerender) renderPalette();
    else updateBookingLive(draft);
  }

  function untag(draft, path) {
    if (draft.fromLead[path]) delete draft.fromLead[path];
  }

  function dateReadout(draft) {
    const engine = bookingEngine();
    const d = draft.data;
    if (draft.data.type === 'national') {
      const cal = engine.nationalReservationDate(new Date());
      return { text: `Calendar: ${cal.text} at ${cal.time} (6 working days)`, error: false };
    }
    if (!d.day && !d.time) return { text: 'Pick a day and time', error: false };
    const parts = [];
    let error = false;
    if (d.day) {
      const date = engine.resolveDate({ day: d.day, month: d.month }, new Date());
      if (date.error) { parts.push(date.error); error = true; } else {
        parts.push(`${WEEKDAYS_LONG[date.dateObj.getDay()]} ${date.day} ${MONTHS_LONG[date.month - 1]}`);
      }
    } else {
      parts.push('Day not set');
    }
    if (d.time) {
      const time = engine.resolveTime(d.time);
      if (time.error) { parts.push(time.error); error = true; } else {
        parts.push(`at ${time.text}${d.timeQualifier ? ` or ${d.timeQualifier}` : ''}`);
      }
    }
    return { text: parts.join(' '), error };
  }

  function vehicleDisplayName(rawMake, rawModel) {
    const make = realText(rawMake);
    const model = realText(rawModel);
    const engine = bookingEngine();
    if (!engine) return [make, model].map(normaliseText).filter(Boolean).join(' ');
    const split = engine.splitMakeModel(make, model);
    return [engine.normaliseMake(split.make), engine.normaliseModel(split.model)].filter(Boolean).join(' ');
  }

  function sectionSummary(draft, id) {
    const d = draft.data;
    const label = (list, value) => (list.find((item) => item.value === value) || {}).label || '';
    if (id === 'customer') {
      const c = inbound.customer;
      return [realText(c.name) || realText(c.mobile), c.dealer ? dealerLabel(c.dealer) : ''].filter(Boolean).join(' · ') || 'Search by number, or add a new customer';
    }
    if (id === 'contact') {
      const parts = [];
      parts.push({ none: 'No contact header', vm: 'VM left', engaged: 'Line engaged', email: 'Email only' }[d.contact]);
      if (normaliseText(d.fao)) parts.push(`FAO ${normaliseText(d.fao)}`);
      return parts.join(' · ');
    }
    if (id === 'type') {
      if (!d.type) return 'Pick a type';
      const sub = BOOKING_SUBTYPES[d.type] ? label(BOOKING_SUBTYPES[d.type], d.subtype) : '';
      return [label(BOOKING_TYPES, d.type), sub].filter(Boolean).join(' · ');
    }
    if (id === 'when') return dateReadout(draft).text;
    if (id === 'vehicle') {
      const names = d.vehicles
        .map((v) => vehicleDisplayName(v.make, v.model) + (realText(v.reg) ? ` (${realText(v.reg).toUpperCase()})` : ''))
        .filter((name) => name.trim());
      if (names.length) return names.join(', ');
      return realText(d.category) || 'Not set';
    }
    if (id === 'px') {
      if (d.type === 'valuation') {
        const item = d.px.items[0];
        const reg = realText(item.reg).toUpperCase();
        return [vehicleDisplayName(item.make, item.model), reg ? `(${reg})` : ''].filter(Boolean).join(' ') || 'Not set';
      }
      if (d.px.status === 'yes') {
        const item = d.px.items[0];
        const name = vehicleDisplayName(item.make, item.model);
        const reg = realText(item.reg).toUpperCase();
        const more = d.px.items.length > 1 ? ' + 1 more' : '';
        return `PX: ${[name, reg ? `(${reg})` : ''].filter(Boolean).join(' ') || 'details needed'}${more}`;
      }
      return label(PX_STATUSES, d.px.status);
    }
    if (id === 'payment') {
      if (d.payment.kind === 'finance' || d.payment.kind === 'both') {
        return [label(PAYMENT_KINDS, d.payment.kind), d.payment.financeType].filter(Boolean).join(' · ');
      }
      return label(PAYMENT_KINDS, d.payment.kind);
    }
    if (id === 'notes') {
      const count = String(d.notesText || '').split('\n').filter((line) => line.trim()).length;
      const extras = count ? [`${count} note${count > 1 ? 's' : ''}`] : [];
      if (d.reserved) extras.push('Reserved');
      if (normaliseText(d.onBehalfOf)) extras.push(`For ${normaliseText(d.onBehalfOf)}`);
      if (d.td24) extras.push(d.contact !== 'none' ? 'Potential 24 hr TD' : '24 hr TD');
      return extras.join(' · ') || 'No notes';
    }
    return '';
  }

  function sectionMissing(draft, id) {
    const d = draft.data;
    if (id === 'type') return !d.type;
    if (id === 'when') return d.type !== 'national' && (!d.day || !d.time);
    if (id === 'vehicle') return !d.vehicles.some((v) => realText(v.make) || realText(v.model) || realText(v.reg)) && !realText(d.category);
    if (id === 'px') return (d.type === 'valuation' || d.px.status === 'yes') && !d.px.items.some((item) => realText(item.reg) || realText(item.make) || realText(item.model));
    return false;
  }

  /* ---------- section bodies ---------- */

  function renderContactSection(draft, body) {
    const d = draft.data;
    body.appendChild(bkChips([
      { value: 'none', label: 'None' },
      { value: 'vm', label: 'VM left' },
      { value: 'engaged', label: 'Engaged' },
      { value: 'email', label: 'Email only' }
    ], d.contact, (value) => { d.contact = value; changed(draft, true); }));
    if (d.contact === 'email') {
      const email = findTopEmail();
      body.appendChild(element('div', email ? 'kn-muted kn-bk-gap' : 'kn-bk-error kn-bk-gap', email ? `Email: ${email}` : 'No email found at the top of the lead'));
    }
    body.appendChild(bkInput('FAO (optional)', d.fao, (value) => { d.fao = value; changed(draft); }, { placeholder: 'Name' }));
  }

  function renderTypeSection(draft, body) {
    const d = draft.data;
    const hint = draft.leadHints?.leadRequest;
    if (hint && !d.type) body.appendChild(element('div', 'kn-muted kn-bk-gap', `Lead request: ${hint}`));
    body.appendChild(bkChips(BOOKING_TYPES, d.type, (value) => {
      d.type = value;
      d.subtype = BOOKING_SUBTYPE_DEFAULT[value] || '';
      untag(draft, 'type');
      if (value === 'onlinestore' || value === 'national') d.vehicles = d.vehicles.slice(0, 1);
      if (!BOOKING_SUBTYPES[value]) advanceIfDone(draft, 'type');
      changed(draft, true);
    }));
    if (BOOKING_SUBTYPES[d.type]) {
      body.appendChild(element('div', 'kn-bk-label', 'Which kind?'));
      body.appendChild(bkChips(BOOKING_SUBTYPES[d.type], d.subtype, (value) => {
        d.subtype = value;
        advanceIfDone(draft, 'type');
        changed(draft, true);
      }, 'kn-bk-sub'));
    }
    if (/online store/i.test(draft.leadHints?.source || '') && d.type !== 'onlinestore' && d.type !== 'national') {
      body.appendChild(element('div', 'kn-muted kn-bk-gap', `Lead source: ${draft.leadHints.source}`));
    }
  }

  function renderWhenSection(draft, body) {
    const d = draft.data;
    if (d.type === 'national') {
      body.appendChild(element('div', 'kn-muted', 'National Reservation has no booking sentence. Create the calendar event for the date below.'));
      return;
    }
    const request = draft.leadHints?.request;
    if (request) {
      const past = requestIsPast(request);
      const text = `Initial notes: ${describeRequest(request)}${request.rounded ? ' (rounded up to a :00 or :30 slot)' : ''}${past ? ' (this date has passed)' : ''}`;
      body.appendChild(element('div', past ? 'kn-bk-warn kn-bk-gap' : 'kn-muted kn-bk-gap', text));
    }
    const engine = bookingEngine();
    const typeInput = { type: d.type || 'testdrive', subtype: d.subtype };
    const strip = element('div', 'kn-bk-days');
    const today = new Date();
    for (let i = 0; i < 14; i += 1) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const active = Number(d.day) === day.getDate() && Number(d.month) === day.getMonth() + 1;
      const chip = element('button', `kn-chip kn-bk-day${active ? ' kn-active' : ''}`);
      chip.type = 'button';
      if (!engine.availableSlots(day, typeInput, { now: new Date() }).length) {
        chip.disabled = true;
        chip.title = 'No times left today';
      }
      chip.appendChild(element('span', 'kn-bk-day-name', i === 0 ? 'Today' : WEEKDAYS[day.getDay()]));
      chip.appendChild(element('span', 'kn-bk-day-num', String(day.getDate())));
      chip.addEventListener('click', () => {
        d.day = String(day.getDate()).padStart(2, '0');
        d.month = String(day.getMonth() + 1).padStart(2, '0');
        untag(draft, 'when');
        changed(draft, true);
      });
      strip.appendChild(chip);
    }
    body.appendChild(strip);

    const row = element('div', 'kn-bk-row');
    let monthInput = null;
    const dayField = bkInput('Day', d.day, (value, input) => {
      const split = value.match(/^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})/);
      if (split) {
        d.day = split[1];
        d.month = split[2];
        input.value = d.day;
        if (monthInput) { monthInput.value = d.month; monthInput.focus(); }
      } else {
        d.day = value.replace(/\D/g, '').slice(0, 2);
        if (d.day.length === 2 && monthInput) monthInput.focus();
      }
      untag(draft, 'when');
      changed(draft);
    }, { placeholder: 'DD', maxLength: 5, inputMode: 'numeric', className: 'kn-bk-small', fromLead: draft.fromLead.when });
    const monthField = bkInput('Month', d.month, (value) => {
      d.month = value.replace(/\D/g, '').slice(0, 2);
      untag(draft, 'when');
      changed(draft);
    }, { placeholder: 'MM', maxLength: 2, inputMode: 'numeric', className: 'kn-bk-small' });
    monthInput = monthField.querySelector('input');
    const timeField = bkInput('Time', d.time, (value) => { d.time = value; untag(draft, 'when'); changed(draft); },
      { placeholder: 'HH:MM', maxLength: 8, className: 'kn-bk-small' });
    row.appendChild(dayField);
    row.appendChild(monthField);
    row.appendChild(timeField);
    body.appendChild(row);

    const readout = element('div', 'kn-bk-readout');
    readout.dataset.role = 'date-readout';
    body.appendChild(readout);

    const chosen = d.day ? engine.resolveDate({ day: d.day, month: d.month }, new Date()) : null;
    if (chosen && !chosen.error) {
      const hours = engine.openingHours[chosen.dateObj.getDay()];
      const length = engine.appointmentLength(typeInput);
      body.appendChild(element('div', 'kn-muted kn-bk-gap',
        `Open ${hours.open} to ${hours.close} · ${length === 30 ? '30 minute call' : '1 hour appointment'}`));
      const slots = engine.availableSlots(chosen.dateObj, typeInput, { now: new Date() });
      if (slots.length) {
        const times = element('div', 'kn-bk-times');
        slots.forEach((value) => {
          const chip = element('button', `kn-chip${d.time === value ? ' kn-active' : ''}`, value);
          chip.type = 'button';
          chip.addEventListener('click', () => { d.time = value; untag(draft, 'when'); advanceIfDone(draft, 'when'); changed(draft, true); });
          times.appendChild(chip);
        });
        body.appendChild(times);
      } else {
        body.appendChild(element('div', 'kn-bk-warn kn-bk-gap', 'No times left on this day'));
      }
    } else {
      body.appendChild(element('div', 'kn-muted kn-bk-gap', 'Pick a day to see the available times'));
    }
    const isCall = d.type === 'call' || (d.type === 'motability' && d.subtype === 'call') ||
      (d.type === 'onlinestore' && /call/.test(d.subtype)) || (d.type === 'valuation' && d.subtype === 'call');
    if (isCall) {
      body.appendChild(bkChips([
        { value: '', label: 'Exact time' },
        { value: 'before', label: 'or before' },
        { value: 'after', label: 'or after' }
      ], d.timeQualifier, (value) => { d.timeQualifier = value; changed(draft, true); }, 'kn-bk-sub'));
    }
  }

  function renderVehicleSection(draft, body) {
    const d = draft.data;
    const single = d.type === 'onlinestore' || d.type === 'national';
    d.vehicles.forEach((vehicle, index) => {
      const card = element('div', 'kn-bk-card');
      const head = element('div', 'kn-bk-card-head', d.vehicles.length > 1 ? `Vehicle ${index + 1}` : 'Vehicle of interest');
      if (index > 0) {
        const remove = element('button', 'kn-bk-remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', () => { d.vehicles.splice(index, 1); changed(draft, true); });
        head.appendChild(remove);
      }
      card.appendChild(head);
      const lead = (key) => index === 0 && draft.fromLead[`v.${key}`];
      const update = (key) => (value) => { vehicle[key] = value; if (index === 0) untag(draft, `v.${key}`); changed(draft); };
      const row = element('div', 'kn-bk-row');
      row.appendChild(bkInput('Make', vehicle.make, update('make'), { fromLead: lead('make'), placeholder: 'Peugeot' }));
      row.appendChild(bkInput('Model', vehicle.model, update('model'), { fromLead: lead('model'), placeholder: '2008' }));
      card.appendChild(row);
      const row2 = element('div', 'kn-bk-row');
      row2.appendChild(bkInput('Reg', vehicle.reg, update('reg'), { fromLead: lead('reg'), placeholder: 'Optional' }));
      row2.appendChild(bkInput('Fuel / extra', vehicle.descriptor, update('descriptor'), { fromLead: lead('descriptor'), placeholder: 'petrol hybrid' }));
      card.appendChild(row2);
      if (d.type !== 'motability') {
        const hasReg = normaliseText(vehicle.reg);
        const current = hasReg ? 'used' : (vehicle.condition === 'used' ? 'used' : 'new');
        card.appendChild(bkChips([
          { value: 'new', label: 'New', disabled: hasReg ? 'A reg means used' : '' },
          { value: 'used', label: hasReg ? 'Used (has reg)' : 'Used' }
        ], current, (value) => { vehicle.condition = value; if (index === 0) untag(draft, 'v.condition'); changed(draft, true); }, 'kn-bk-sub'));
      }
      body.appendChild(card);
    });
    if (!single) {
      body.appendChild(button('+ Add vehicle', 'kn-bk-add', () => {
        d.vehicles.push(blankBooking().vehicles[0]);
        changed(draft, true);
      }));
    }
    if (d.type === 'view' || d.type === 'call' || !d.type) {
      body.appendChild(bkInput('Or browsing a category', d.category, (value) => { d.category = value; changed(draft); },
        { placeholder: 'used petrol hybrid SUVs' }));
    }
  }

  function renderPxItem(draft, item, index, body) {
    const d = draft.data;
    const card = element('div', 'kn-bk-card');
    const head = element('div', 'kn-bk-card-head', d.type === 'valuation' ? 'Customer\'s vehicle' : (d.px.items.length > 1 ? `PX ${index + 1}` : 'Part exchange'));
    if (index > 0) {
      const remove = element('button', 'kn-bk-remove', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => { d.px.items.splice(index, 1); changed(draft, true); });
      head.appendChild(remove);
    }
    card.appendChild(head);
    const lead = (key) => index === 0 && draft.fromLead[`px.${key}`];
    const update = (key) => (value) => { item[key] = value; if (index === 0) untag(draft, `px.${key}`); changed(draft); };
    const row = element('div', 'kn-bk-row');
    row.appendChild(bkInput('Make', item.make, update('make'), { fromLead: lead('make') }));
    row.appendChild(bkInput('Model', item.model, update('model'), { fromLead: lead('model') }));
    card.appendChild(row);
    const row2 = element('div', 'kn-bk-row');
    row2.appendChild(bkInput('Reg', item.reg, update('reg'), { fromLead: lead('reg') }));
    row2.appendChild(bkInput('Mileage', item.mileage, update('mileage'), { fromLead: lead('mileage'), placeholder: '45000', inputMode: 'numeric' }));
    card.appendChild(row2);
    if (!normaliseText(item.mileage)) {
      card.appendChild(bkChips([
        { value: '', label: 'Mileage known' },
        { value: 'call', label: 'Unknown, on call' },
        { value: 'site', label: 'Unknown, on site' }
      ], item.mileageUnknown || '', (value) => { item.mileageUnknown = value; changed(draft, true); }, 'kn-bk-sub'));
    }
    if (d.type !== 'valuation') {
      const row3 = element('div', 'kn-bk-row');
      row3.appendChild(bkInput('Rough val £', item.roughVal, update('roughVal'), { fromLead: lead('roughVal'), inputMode: 'numeric' }));
      row3.appendChild(bkInput('Current finance', item.finance, update('finance'), { placeholder: 'PCP' }));
      card.appendChild(row3);
      card.appendChild(bkInput('Finance ends', item.financeEnds, update('financeEnds'), { placeholder: 'March 2027' }));
      card.appendChild(bkInput('Condition / extras', item.details, update('details'), { placeholder: 'Full service history | Warranty' }));
    }
    body.appendChild(card);
  }

  function renderPxSection(draft, body) {
    const d = draft.data;
    if (d.type === 'valuation') {
      renderPxItem(draft, d.px.items[0], 0, body);
      body.appendChild(element('div', 'kn-bk-label', 'Reason'));
      body.appendChild(bkChips([
        { value: '', label: 'Not said' },
        { value: 'sell', label: 'Looking to sell' },
        { value: 'boughtElsewhere', label: 'Bought another' }
      ], d.sellingReason, (value) => { d.sellingReason = value; changed(draft, true); }));
      return;
    }
    body.appendChild(bkChips(PX_STATUSES, d.px.status, (value) => {
      d.px.status = value;
      untag(draft, 'px.status');
      changed(draft, true);
    }));
    if (d.px.status === 'yes') {
      d.px.items.forEach((item, index) => renderPxItem(draft, item, index, body));
      if (d.px.items.length < 2) {
        body.appendChild(button('+ Add second PX', 'kn-bk-add', () => {
          d.px.items.push(blankBooking().px.items[0]);
          changed(draft, true);
        }));
      }
    }
  }

  function renderPaymentSection(draft, body) {
    const p = draft.data.payment;
    body.appendChild(bkChips(PAYMENT_KINDS, p.kind, (value) => { p.kind = value; changed(draft, true); }));
    if (p.kind === 'finance' || p.kind === 'both') {
      body.appendChild(bkChips([
        { value: '', label: 'Not sure' },
        { value: 'PCP', label: 'PCP' },
        { value: 'HP', label: 'HP' },
        { value: 'PCH', label: 'PCH' }
      ], p.financeType, (value) => { p.financeType = value; changed(draft, true); }, 'kn-bk-sub'));
      const row = element('div', 'kn-bk-row');
      row.appendChild(bkInput('Deposit £', p.deposit, (value) => { p.deposit = value; changed(draft); }, { inputMode: 'numeric' }));
      row.appendChild(bkInput('Months', p.term, (value) => { p.term = value; changed(draft); }, { inputMode: 'numeric' }));
      body.appendChild(row);
      const row2 = element('div', 'kn-bk-row');
      row2.appendChild(bkInput('Miles / year', p.mpa, (value) => { p.mpa = value; changed(draft); }, { placeholder: '10000' }));
      row2.appendChild(bkInput('Budget £ / month', p.budget, (value) => { p.budget = value; changed(draft); }, { inputMode: 'numeric' }));
      body.appendChild(row2);
      body.appendChild(bkInput('Other finance details', p.extra, (value) => { p.extra = value; changed(draft); }, { placeholder: 'Wants APR | Settlement figure' }));
    }
  }

  function renderNotesSection(draft, body) {
    const d = draft.data;
    body.appendChild(bkInput('Notes (one per line)', d.notesText, (value) => { d.notesText = value; changed(draft); },
      { multiline: true, placeholder: 'Open to other models\nShort or long wheelbase' }));
    const quick = element('div', 'kn-bk-chips');
    /* A plain option like the others: off until tapped. Its wording turns
       to "Potential ..." while a contact header is picked. */
    const td24 = element('button', `kn-chip${d.td24 ? ' kn-active' : ''}`, `${d.td24 ? '✓' : '+'} ${td24Note(d)}`);
    td24.type = 'button';
    td24.title = d.td24 ? 'Tap to remove' : 'Tap to add';
    td24.addEventListener('click', () => { d.td24 = !d.td24; changed(draft, true); });
    quick.appendChild(td24);
    QUICK_NOTES.forEach((text) => {
      const chip = element('button', 'kn-chip', `+ ${text}`);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        const lines = String(d.notesText || '').split('\n').filter((line) => line.trim());
        if (!lines.some((line) => line.toLowerCase() === text.toLowerCase())) lines.push(text);
        d.notesText = lines.join('\n');
        changed(draft, true);
      });
      quick.appendChild(chip);
    });
    body.appendChild(quick);
    body.appendChild(bkChips([
      { value: false, label: 'Not reserved' },
      { value: true, label: 'Already reserved' }
    ], d.reserved, (value) => { d.reserved = value; changed(draft, true); }, 'kn-bk-sub'));
    body.appendChild(bkInput('On behalf of (relation)', d.onBehalfOf, (value) => { d.onBehalfOf = value; changed(draft); }, { placeholder: 'son' }));
    if (d.contact !== 'email') {
      body.appendChild(bkChips([
        { value: false, label: 'No email note' },
        { value: true, label: 'Add customer email' }
      ], d.emailNote, (value) => { d.emailNote = value; changed(draft, true); }, 'kn-bk-sub'));
    }
    if (d.emailNote || d.contact === 'email') {
      body.appendChild(bkInput('Email them (optional)', d.emailAction, (value) => { d.emailAction = value; changed(draft); }, { placeholder: 'send brochure' }));
    }
  }

  /* Required sections first, in the order an agent usually fills them. */
  const BOOKING_SECTIONS = [
    { id: 'customer', title: 'Customer', render: (draft, body) => renderCustomerSection(draft, body),
      hidden: () => state.booking?.key !== INBOUND_KEY },
    { id: 'type', title: 'Appointment', required: true, prompt: 'What is the appointment?', render: renderTypeSection },
    { id: 'when', title: 'When', required: (d) => d.type !== 'national', prompt: 'Tap a day, then a time', render: renderWhenSection },
    { id: 'vehicle', title: 'Vehicle', required: true, prompt: 'Which car are they interested in?', render: renderVehicleSection, hidden: (d) => d.type === 'valuation' },
    { id: 'px', title: 'Part exchange', titleFor: (d) => (d.type === 'valuation' ? 'Customer\'s vehicle' : 'Part exchange'),
      required: (d) => d.type === 'valuation',
      prompt: 'Are they part-exchanging a car?', promptFor: (d) => (d.type === 'valuation' ? 'Which car is being valued?' : ''),
      render: renderPxSection, hidden: (d) => d.type === 'national' },
    { id: 'payment', title: 'Payment', prompt: 'How are they paying?', render: renderPaymentSection, hidden: (d) => d.type === 'valuation' || d.type === 'national' },
    { id: 'notes', title: 'Notes', prompt: 'Anything else the dealership should know?', render: renderNotesSection },
    { id: 'contact', title: 'Contact / FAO', prompt: 'Voicemail, line engaged or email only? Add FAO if asked.', render: renderContactSection }
  ];

  function visibleSections(d) {
    return BOOKING_SECTIONS.filter((section) => !(section.hidden && section.hidden(d)));
  }

  function sectionRequired(section, d) {
    return typeof section.required === 'function' ? section.required(d) : Boolean(section.required);
  }

  function sectionTouched(draft, id) {
    const d = draft.data;
    if (id === 'contact') return d.contact !== 'none' || Boolean(normaliseText(d.fao));
    if (id === 'customer') return Boolean(realText(inbound.customer.name) || realText(inbound.customer.mobile));
    if (id === 'px') return d.px.status !== 'unmentioned';
    if (id === 'payment') return d.payment.kind !== 'unmentioned';
    if (id === 'notes') return Boolean(normaliseText(d.notesText) || d.reserved || normaliseText(d.onBehalfOf) || d.emailNote || d.td24);
    return !sectionMissing(draft, id);
  }

  /* 'done', 'needed' or 'optional' for the step badge. */
  function sectionStatus(draft, section) {
    const d = draft.data;
    if (sectionRequired(section, d)) return sectionMissing(draft, section.id) ? 'needed' : 'done';
    if (sectionMissing(draft, section.id)) return 'needed';
    return sectionTouched(draft, section.id) ? 'done' : 'optional';
  }

  function nextMissingSection(draft) {
    const d = draft.data;
    const next = visibleSections(d).find((section) => sectionRequired(section, d) && sectionMissing(draft, section.id));
    return next ? next.id : '';
  }

  /* After a choice that completes a step, open the next step still needed. */
  function advanceIfDone(draft, id) {
    if (sectionMissing(draft, id)) return;
    draft.openSection = nextMissingSection(draft);
  }

  function renderNeededBar(draft, body) {
    const d = draft.data;
    const missing = visibleSections(d).filter((section) => sectionRequired(section, d) && sectionMissing(draft, section.id));
    const bar = element('div', missing.length ? 'kn-bk-needed' : 'kn-bk-needed kn-bk-ready');
    bookingRefs.needed = bar;
    if (!missing.length) {
      bar.appendChild(element('span', 'kn-bk-needed-title', '✓ Ready to insert'));
    } else {
      bar.appendChild(element('span', 'kn-bk-needed-title', 'Still needed:'));
      missing.forEach((section) => {
        const chip = element('button', 'kn-bk-needed-chip', section.titleFor ? section.titleFor(d) : section.title);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          draft.openSection = section.id;
          saveDraftSoon();
          renderPalette();
        });
        bar.appendChild(chip);
      });
    }
    body.appendChild(bar);
  }

  function updateBookingLive(draft) {
    if (!bookingRefs) return;
    const result = buildCurrentBooking(draft);
    if (!result) return;
    Object.entries(bookingRefs.summaries).forEach(([id, node]) => {
      node.textContent = sectionSummary(draft, id);
      node.classList.toggle('kn-bk-missing', sectionMissing(draft, id));
    });
    Object.values(bookingRefs.badges).forEach((ref) => {
      const status = sectionStatus(draft, ref.section);
      ref.badge.className = `kn-bk-badge kn-bk-badge-${status}`;
      ref.badge.textContent = status === 'done' ? '✓' : String(ref.number);
      ['done', 'needed', 'optional'].forEach((name) => ref.wrap.classList.toggle(`kn-bk-s-${name}`, name === status));
    });
    if (bookingRefs.needed) {
      const parent = bookingRefs.needed.parentNode;
      const marker = bookingRefs.needed.nextSibling;
      bookingRefs.needed.remove();
      const temp = document.createDocumentFragment();
      renderNeededBar(draft, temp);
      parent.insertBefore(temp, marker);
    }
    if (bookingRefs.readout) {
      const readout = dateReadout(draft);
      bookingRefs.readout.textContent = readout.text;
      bookingRefs.readout.classList.toggle('kn-bk-error', readout.error);
    }
    bookingRefs.preview.textContent = result.text;
    bookingRefs.issues.textContent = '';
    result.errors.forEach((text) => bookingRefs.issues.appendChild(element('div', 'kn-bk-error', text)));
    result.warnings.forEach((text) => bookingRefs.issues.appendChild(element('div', 'kn-bk-warn', text)));
    const waitingForLead = draft.key === INBOUND_KEY;
    bookingRefs.insert.textContent = waitingForLead ? 'Insert after the lead is created'
      : draft.inserted ? 'Update Call Notes' : 'Insert into Call Notes';
    bookingRefs.insert.classList.toggle('kn-bk-blocked', waitingForLead || result.errors.length > 0);
  }

  function renderBooking() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Booking', () => {
      state.view = 'main';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body kn-bk-body');
    palette.appendChild(body);

    if (!bookingEngine()) {
      body.appendChild(element('div', state.bookingError ? 'kn-status kn-status-error' : 'kn-status',
        state.bookingError || 'Loading the booking engine...'));
      loadBookingEngine().then(() => { state.bookingError = ''; if (state.open && state.view === 'booking') renderPalette(); })
        .catch(() => { if (state.open && state.view === 'booking') renderPalette(); });
      return;
    }

    const draft = currentDraft();
    const d = draft.data;

    draft.notices.forEach((notice) => {
      const card = element('div', 'kn-bk-notice');
      card.appendChild(element('div', 'kn-bk-notice-text', notice.label));
      const actions = element('div', 'kn-bk-notice-actions');
      const offLabel = notice.path === 'px.on' && notice.value === 'off';
      actions.appendChild(button(offLabel ? 'Remove PX' : 'Use it', 'kn-primary', () => applyNotice(draft, notice, true)));
      actions.appendChild(button(offLabel ? 'Keep PX' : 'Keep mine', '', () => applyNotice(draft, notice, false)));
      card.appendChild(actions);
      body.appendChild(card);
    });

    bookingRefs = { summaries: {}, badges: {}, needed: null, readout: null, preview: null, issues: null, insert: null };
    renderMobileCard(draft, body);
    renderNeededBar(draft, body);
    visibleSections(d).forEach((section, index) => {
      const open = draft.openSection === section.id;
      const status = sectionStatus(draft, section);
      const wrap = element('div', `kn-bk-section kn-bk-s-${status}${open ? ' kn-bk-open' : ''}`);
      const head = element('button', 'kn-bk-head');
      head.type = 'button';
      const badge = element('span', `kn-bk-badge kn-bk-badge-${status}`, status === 'done' ? '✓' : String(index + 1));
      bookingRefs.badges[section.id] = { badge, wrap, section, number: index + 1 };
      head.appendChild(badge);
      const textCol = element('span', 'kn-bk-head-text');
      const top = element('span', 'kn-bk-head-top');
      const titleNode = element('span', 'kn-bk-head-title', section.titleFor ? section.titleFor(d) : section.title);
      if (!sectionRequired(section, d)) titleNode.appendChild(element('span', 'kn-bk-optional', 'optional'));
      top.appendChild(titleNode);
      top.appendChild(element('span', 'kn-bk-chevron', open ? '▾' : '▸'));
      textCol.appendChild(top);
      const summary = element('span', 'kn-bk-head-summary', sectionSummary(draft, section.id));
      bookingRefs.summaries[section.id] = summary;
      textCol.appendChild(summary);
      head.appendChild(textCol);
      head.addEventListener('click', () => {
        draft.openSection = open ? '' : section.id;
        saveDraftSoon();
        renderPalette();
      });
      wrap.appendChild(head);
      if (open) {
        const content = element('div', 'kn-bk-content');
        section.render(draft, content);
        wrap.appendChild(content);
        const readout = content.querySelector('[data-role="date-readout"]');
        if (readout) bookingRefs.readout = readout;
      }
      body.appendChild(wrap);
    });

    const footer = element('div', 'kn-bk-footer');
    footer.appendChild(element('div', 'kn-bk-preview-label', 'Goes into Call Notes'));
    const preview = element('pre', 'kn-bk-preview');
    bookingRefs.preview = preview;
    footer.appendChild(preview);
    const issues = element('div', 'kn-bk-issues');
    bookingRefs.issues = issues;
    footer.appendChild(issues);
    if (state.bookingStatus) {
      footer.appendChild(element('div', `kn-bk-status kn-bk-status-${state.bookingStatus.kind}`, state.bookingStatus.text));
    }
    const actions = element('div', 'kn-bk-actions');
    const insert = button('Insert into Call Notes', 'kn-primary', () => insertBooking(draft));
    bookingRefs.insert = insert;
    actions.appendChild(insert);
    actions.appendChild(button('Copy', '', () => {
      const result = buildCurrentBooking(draft);
      if (result) copyText(result.text, null).then((ok) => {
        state.bookingStatus = ok ? { kind: 'ok', text: 'Copied.' } : { kind: 'warn', text: 'Copy was blocked.' };
        renderPalette();
      });
    }));
    const clear = button('Clear', 'kn-danger', () => {
      const removed = draft.key === INBOUND_KEY ? 0 : clearCallNotes();
      if (draft.key === INBOUND_KEY) {
        forgetInboundCustomer();
        inbound.pending = false;
      }
      const isInbound = draft.key === INBOUND_KEY;
      state.booking = { ...draft, data: blankBooking(), fromLead: {}, notices: [], inserted: null, leadSeen: {}, openSection: isInbound ? 'customer' : 'type' };
      syncLead(state.booking);
      saveDraftNow();
      state.bookingStatus = isInbound ? { kind: 'ok', text: 'Booking and customer details cleared.' } : removed < 0
        ? { kind: 'error', text: 'Couldn\'t find the Call Notes box, so it was not cleared. The booking form was reset.' }
        : { kind: 'ok', text: removed ? `Cleared Call Notes (${removed} characters). Ctrl+Z in Call Notes undoes it.` : 'Call Notes was already empty. Booking form reset.' };
      renderPalette();
    });
    clear.title = 'Empties the whole Call Notes box and resets this booking (Ctrl+Z in Call Notes undoes it)';
    actions.appendChild(clear);
    footer.appendChild(actions);
    footer.appendChild(element('div', 'kn-bk-version', `Konnect Notes v${KN.version}`));
    palette.appendChild(footer);

    updateBookingLive(draft);
    if (state.bookingScroll) body.scrollTop = state.bookingScroll;
    body.addEventListener('scroll', () => { state.bookingScroll = body.scrollTop; });
  }

  function openBooking() {
    scanPage();
    if (!state.target && !inboundContext()) return;
    state.open = true;
    state.view = 'booking';
    state.bookingStatus = null;
    state.bookingScroll = 0;
    const draft = currentDraft();
    if (!draft.openSection && bookingEngine()) draft.openSection = nextMissingSection(draft);
    if (bookingEngine()) {
      syncLead(draft);
    } else {
      loadBookingEngine().then(() => {
        syncLead(currentDraft());
        if (state.open && state.view === 'booking') renderPalette();
      }).catch(() => {});
    }
    renderPalette();
  }

  /* ---------- inbound calls ----------
     On the inbound screens (Accept, then Customer Call) there is no lead or
     Call Notes yet. The booking is built under the key "inbound" with a
     Customer step that can search Konnect and fill the New Customer form.
     When the new lead's Call Notes box appears, the booking moves onto that
     lead. Customer details are only held in memory, never in localStorage:
     everything except the mobile is dropped at the handover, and the mobile
     is kept so it can be added back if Konnect loses it on Save. */

  const INBOUND_KEY = 'inbound';
  const INBOUND_LAUNCHER_ID = 'kn-inbound-launcher';
  const INBOUND_MAX_AGE = 3 * 60 * 60 * 1000;
  const KONNECT_DEALERS = [
    'Stellantis &You Birmingham Central', 'Stellantis &You Birmingham North', 'Stellantis &You Birmingham South',
    'Stellantis &You Brentford', 'Stellantis &You Bristol Cribbs', 'Stellantis &You Chingford',
    'Stellantis &You Coventry', 'Stellantis &You Crawley', 'Stellantis &You Croydon', 'Stellantis &You Edgware',
    'Stellantis &You General Sales', 'Stellantis &You Service Bookings', 'Stellantis &You Guildford',
    'Stellantis &You Hatfield', 'Stellantis &You Leicester', 'Stellantis &You Liverpool', 'Stellantis &You Maidstone',
    'Stellantis &You Manchester', 'National', 'Stellantis &You Newport', 'Stellantis &You Nottingham',
    'Stellantis &You Preston', 'Stellantis &You Redditch', 'Stellantis &You Romford', 'Stellantis &You Sale',
    'Stellantis &You Sheffield', 'Stellantis &You National Used Cars', 'Stellantis &You Stockport',
    'Stellantis &You Walton', 'Stellantis &You West London', 'Stellantis &You Wimbledon'
  ];
  const KONNECT_BRANDS = ['Abarth', 'Alfa Romeo', 'Citroen', 'DS', 'Fiat', 'Jeep', 'Leapmotor', 'Peugeot',
    'Stellantis &You', 'Vauxhall', 'Other'];

  const inbound = {
    customer: blankCustomer(),
    pending: false,
    mobile: '',
    mobileLead: '',
    brand: '',
    dealer: ''
  };

  function blankCustomer() {
    return { name: '', mobile: '', email: '', postcode: '', address1: '', dealer: '', brand: '' };
  }

  function inboundScreen() {
    return /^#!\/(present-inbound-call|select-call-type\/calldirection\/inbound)/i.test(location.hash || '');
  }

  /* True while there is no Call Notes box but an inbound booking is under way. */
  function inboundContext() {
    if (state.target) return false;
    return inboundScreen() || inbound.pending;
  }

  function dealerLabel(option) {
    return String(option || '').replace(/^Stellantis &You\s+/, '');
  }

  function waitFor(check, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const found = check();
        if (found || Date.now() - started > (timeout || 2500)) resolve(found || null);
        else setTimeout(tick, 80);
      };
      tick();
    });
  }

  function visibleCustomerModal() {
    return Array.from(document.querySelectorAll('.modal'))
      .find((modal) => isVisible(modal) && modal.querySelector('input[ng-model="customer.FullName"]')) || null;
  }

  function findButtonByClick(selector, text) {
    return Array.from(document.querySelectorAll(selector))
      .find((node) => isVisible(node) && (!text || normaliseText(node.textContent).toLowerCase().includes(text))) || null;
  }

  /* The brand to pick: the agent's choice, else the vehicle of interest's
     make when this dealer offers it, else "Stellantis &You". */
  function brandFor(select, chosen) {
    const options = Array.from(select?.options || []).map((option) => normaliseText(option.textContent));
    const has = (name) => options.some((option) => option.toLowerCase() === String(name).toLowerCase());
    if (chosen && has(chosen)) return chosen;
    const make = realText(state.booking?.data?.vehicles?.[0]?.make);
    const engine = bookingEngine();
    const tidyMake = make && engine ? engine.normaliseMake(make) : make;
    if (tidyMake && has(tidyMake)) return tidyMake;
    return has('Stellantis &You') ? 'Stellantis &You' : '';
  }

  /* Sets Dealer (if given and not already set) then waits for the Brand list
     that loads for it and picks the brand. Returns the names of the fields set. */
  async function setDealerAndBrand(modal, dealer, brand) {
    const filled = [];
    const dealerSelect = modal.querySelector('select[ng-model="selected.dealer"]');
    if (dealerSelect && dealer && setLeadControl(dealerSelect, dealer)) filled.push('Dealer');
    const brandSelect = await waitFor(() => {
      const select = modal.querySelector('select[ng-model="customer.VehicleBadgeID"]');
      return select && select.options.length > 1 ? select : null;
    }, 3000);
    const pick = brandSelect ? brandFor(brandSelect, brand) : '';
    if (brandSelect && pick && setLeadControl(brandSelect, pick)) filled.push(`Brand (${pick})`);
    else if (brandSelect && pick && selectedText(brandSelect) === pick) filled.push(`Brand (${pick})`);
    return filled;
  }

  function searchKonnect() {
    const c = inbound.customer;
    const query = realText(c.mobile).replace(/[^\d+]/g, '').replace(/^\+44/, '0') || realText(c.name);
    const button = document.getElementById('btnSearchCustomers');
    if (!button || !query) {
      showToast(button ? 'Add a mobile or name first' : 'Open Customer Call first to search');
      return;
    }
    const scope = button.closest('form, .input-group, .form-group, .row, .panel-body') || button.parentElement;
    const input = scope?.querySelector('input[type="text"], input[type="search"], input:not([type])');
    if (!input) {
      showToast('Could not find the search box');
      return;
    }
    setLeadControl(input, query);
    button.click();
    showToast(`Searched Konnect for ${query}`);
  }

  async function fillCustomerForm() {
    const c = inbound.customer;
    let modal = visibleCustomerModal();
    if (!modal) {
      const newButton = findButtonByClick('button[ng-click^="showCustomerModal"]', 'new customer');
      if (!newButton) {
        showToast('Open Customer Call first, then try again');
        return;
      }
      newButton.click();
      modal = await waitFor(visibleCustomerModal, 3000);
    }
    if (!modal) {
      showToast('The New Customer form did not open');
      return;
    }
    const filled = [];
    const put = (selector, value, label) => {
      const control = modal.querySelector(selector);
      if (control && realText(value) && setLeadControl(control, normaliseText(value))) filled.push(label);
    };
    put('input[ng-model="customer.FullName"]', c.name, 'Name');
    put('input[ng-model^="customer.Address"]', c.address1, 'Address line 1');
    put('input[ng-model="customer.PostCode"]', String(c.postcode || '').toUpperCase(), 'Postcode');
    put('input[ng-model^="customer.Mobile"]', String(c.mobile || '').replace(/\s+/g, ''), 'Mobile 1');
    put('input[ng-model="customer.EmailAddress"]', c.email, 'Email');
    filled.push(...await setDealerAndBrand(modal, c.dealer, c.brand));
    inbound.pending = true;
    showToast(filled.length ? `Filled ${filled.join(', ')}. Check it and press Save.` : 'Nothing new to fill');
  }

  /* After the lead is created Konnect can lose the mobile. This opens Edit
     Customer Details, puts it back in Mobile 1 and reselects the brand,
     which resets every time the form opens. The agent presses Save. */
  async function readdMobile() {
    const mobile = inbound.mobile;
    if (!mobile) return;
    let modal = visibleCustomerModal();
    if (!modal) {
      const edit = findButtonByClick('a[ng-click^="showCustomerModal"], span[ng-click^="showCustomerModal"]', 'edit customer');
      if (!edit) {
        showToast('Could not find Edit Customer Details on this screen');
        return;
      }
      edit.click();
      modal = await waitFor(visibleCustomerModal, 3000);
    }
    if (!modal) {
      showToast('Edit Customer Details did not open');
      return;
    }
    const filled = [];
    const mobileBox = modal.querySelector('input[ng-model^="customer.Mobile"]');
    if (mobileBox && setLeadControl(mobileBox, mobile)) filled.push('Mobile 1');
    const dealerSelect = modal.querySelector('select[ng-model="selected.dealer"]');
    const dealer = dealerSelect && !selectedText(dealerSelect) ? inbound.dealer : '';
    filled.push(...await setDealerAndBrand(modal, dealer, inbound.brand));
    showToast(filled.length ? `Filled ${filled.join(', ')}. Press Save.` : 'Mobile is already there');
  }

  function forgetInboundCustomer() {
    inbound.customer = blankCustomer();
    inbound.mobile = '';
    inbound.mobileLead = '';
    inbound.brand = '';
    inbound.dealer = '';
  }

  /* Moves the inbound booking onto the lead whose Call Notes just appeared. */
  function adoptInboundDraft(key) {
    if (!inbound.pending || key === INBOUND_KEY) return null;
    const drafts = readDrafts();
    const source = drafts[INBOUND_KEY];
    if (!source || !source.data || Date.now() - (source.updated || 0) > INBOUND_MAX_AGE) return null;
    const existing = drafts[key];
    if (existing && existing.inserted) return null;
    delete drafts[INBOUND_KEY];
    writeDrafts(drafts);
    inbound.pending = false;
    inbound.mobile = String(inbound.customer.mobile || '').replace(/\s+/g, '');
    inbound.mobileLead = inbound.mobile ? key : '';
    inbound.brand = inbound.customer.brand;
    inbound.dealer = inbound.customer.dealer;
    inbound.customer = blankCustomer();
    state.bookingStatus = { kind: 'ok', text: 'Booking carried over from the inbound call.' };
    return {
      key,
      data: { ...blankBooking(), ...source.data },
      leadSeen: {},
      fromLead: {},
      notices: [],
      inserted: null,
      openSection: '',
      updated: Date.now()
    };
  }

  function renderCustomerSection(draft, body) {
    const c = inbound.customer;
    const update = (key) => (value) => { c[key] = value; inbound.pending = true; changed(draft); };
    /* Search by number first; nothing else is needed for this. */
    const searchRow = element('div', 'kn-bk-row kn-bk-search-row');
    const mobileField = bkInput('Mobile', c.mobile, update('mobile'), { inputMode: 'tel', placeholder: '07700 900123' });
    mobileField.querySelector('input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchKonnect();
      }
    });
    searchRow.appendChild(mobileField);
    searchRow.appendChild(button('Search', 'kn-primary kn-bk-search-button', searchKonnect));
    body.appendChild(searchRow);
    body.appendChild(element('div', 'kn-muted kn-bk-gap', 'New customer? Add their details below and fill the New Customer form.'));
    body.appendChild(bkInput('Name', c.name, update('name')));
    body.appendChild(bkInput('Email', c.email, update('email')));
    const row2 = element('div', 'kn-bk-row');
    row2.appendChild(bkInput('Postcode', c.postcode, update('postcode')));
    row2.appendChild(bkInput('Address line 1 (in person)', c.address1, update('address1')));
    body.appendChild(row2);

    const dealerWrap = element('label', 'kn-bk-field');
    dealerWrap.appendChild(element('span', 'kn-bk-label', 'Dealer'));
    const dealer = element('select', 'kn-input');
    [['', '(Select a dealer)'], ...KONNECT_DEALERS.map((option) => [option, dealerLabel(option)])].forEach(([value, label]) => {
      const option = element('option', '', label);
      option.value = value;
      if (value === c.dealer) option.selected = true;
      dealer.appendChild(option);
    });
    dealer.addEventListener('change', () => { c.dealer = dealer.value; inbound.pending = true; changed(draft, true); });
    dealer.addEventListener('keydown', (event) => event.stopPropagation());
    dealerWrap.appendChild(dealer);
    body.appendChild(dealerWrap);

    body.appendChild(element('div', 'kn-bk-label', 'Brand'));
    body.appendChild(bkChips([{ value: '', label: 'Auto (vehicle make)' }, ...KONNECT_BRANDS.map((name) => ({ value: name, label: name }))],
      c.brand, (value) => { c.brand = value; inbound.pending = true; changed(draft, true); }, 'kn-bk-sub'));

    body.appendChild(button('Fill new customer form', 'kn-primary kn-bk-add', fillCustomerForm));
    body.appendChild(element('div', 'kn-muted', 'Customer details stay in this page only and are wiped when the booking moves onto the new lead.'));
  }

  function renderMobileCard(draft, body) {
    if (!inbound.mobile || draft.key !== inbound.mobileLead) return;
    const card = element('div', 'kn-bk-notice');
    card.appendChild(element('div', 'kn-bk-notice-text', `Mobile from the inbound call: ${inbound.mobile}`));
    const actions = element('div', 'kn-bk-notice-actions');
    actions.appendChild(button('Re-add mobile', 'kn-primary', readdMobile));
    actions.appendChild(button('Forget', '', () => { forgetInboundCustomer(); renderPalette(); }));
    card.appendChild(actions);
    body.appendChild(card);
  }

  /* Konnect's Phone column (bottom right, on every screen) starts with the
     green Manual Call button. The Booking button goes directly above it,
     styled like its neighbours, and only shows while on the inbound screens. */
  function phoneColumnAnchor() {
    const find = (selector) => Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
    return find('button[ng-click="manualCallClick()"]') || find('button[ng-click="endCall()"]');
  }

  function updateInboundLauncher() {
    let launcher = document.getElementById(INBOUND_LAUNCHER_ID);
    if (!inboundContext()) {
      if (launcher) launcher.style.display = 'none';
      return;
    }
    const anchor = phoneColumnAnchor();
    if (!launcher) {
      launcher = element('button', 'kn-ui kn-inbound-launcher');
      launcher.id = INBOUND_LAUNCHER_ID;
      launcher.type = 'button';
      launcher.title = 'Booking (Alt+B)';
      launcher.setAttribute('aria-label', 'Open booking');
      launcher.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.open && state.view === 'booking') closePalette();
        else openBooking();
      });
    }
    if (anchor) {
      if (launcher.nextElementSibling !== anchor) anchor.insertAdjacentElement('beforebegin', launcher);
      /* Same size and shape as the Phone buttons, without their colour or actions. */
      const keep = Array.from(anchor.classList).filter((name) => !/^btn-(danger|success|info|warning|primary|default|switch)$/.test(name) && !/^ng-/.test(name));
      launcher.className = `${keep.join(' ')} kn-ui kn-phone-launcher`;
      launcher.textContent = '\u26A1';
      const size = anchor.getBoundingClientRect();
      launcher.style.width = `${Math.round(size.width)}px`;
      launcher.style.height = `${Math.round(size.height)}px`;
    } else {
      if (launcher.parentElement !== document.body) document.body.appendChild(launcher);
      launcher.className = 'kn-ui kn-inbound-launcher';
      launcher.textContent = '\u26A1 Booking';
      launcher.style.width = '';
      launcher.style.height = '';
    }
    launcher.style.display = '';
  }

  function renderPalette() {
    const palette = ensurePalette();
    palette.textContent = '';
    palette.classList.toggle('kn-open', state.open);
    if (!state.open) return;
    positionPalette();
    if (state.view === 'attempt') renderAttempt();
    else if (state.view === 'browse') renderBrowse();
    else if (state.view === 'settings') renderSettings();
    else if (state.view === 'edit') renderEditor();
    else if (state.view === 'export') renderExport();
    else if (state.view === 'import') renderImport();
    else if (state.view === 'booking') renderBooking();
    else renderMain();
  }

  function openPalette() {
    scanPage();
    if (!state.target) return;
    const active = document.activeElement;
    if (active === state.target || active === state.postClosureTarget) rememberSelection(active);
    state.open = true;
    state.view = 'main';
    state.attemptPhrase = null;
    state.otherAttemptOpen = false;
    renderPalette();
  }

  function closePalette() {
    if (state.booking) saveDraftNow();
    state.open = false;
    state.attemptPhrase = null;
    state.otherAttemptOpen = false;
    if (state.palette) state.palette.classList.remove('kn-open');
  }

  function togglePalette() {
    if (state.open) closePalette();
    else openPalette();
  }

  function choosePhrase(phrase) {
    if (!phrase) return;
    if (phrase.requiresAttempt) {
      state.attemptPhrase = phrase;
      state.otherAttemptOpen = false;
      state.view = 'attempt';
      renderPalette();
    } else {
      insertPhrase(phrase, null);
    }
  }

  function emailFromText(value) {
    const match = String(value || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return match ? match[0] : '';
  }

  function emailFromElement(candidate) {
    if (!(candidate instanceof Element)) return '';
    const parts = [];
    if (candidate instanceof HTMLInputElement) parts.push(candidate.value);
    parts.push(candidate.getAttribute('href') || '');
    parts.push(candidate.innerText || '');
    parts.push(candidate.textContent || '');
    return emailFromText(parts.join(' '));
  }

  function findTopEmail() {
    const labels = Array.from(document.querySelectorAll('b,strong,label,span,th,td'))
      .filter((node) => isVisible(node) && ownText(node).toLowerCase() === 'email')
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    for (const label of labels) {
      const row = label.closest('.row') || label.parentElement;
      const containers = [];
      let container = row;
      for (let depth = 0; container && depth < 5; depth += 1, container = container.parentElement) {
        if (!containers.includes(container)) containers.push(container);
      }

      for (const current of containers) {
        const candidates = Array.from(current.querySelectorAll(
          'a[href^="mailto:"],input[type="email"],span.ng-scope,a,input,span'
        )).filter((candidate) =>
          candidate !== label && isVisible(candidate) && !candidate.closest(`#${PALETTE_ID}`)
        );
        for (const candidate of candidates) {
          const email = emailFromElement(candidate);
          if (email) return email;
        }
        const containerEmail = emailFromText(current.innerText || current.textContent || '');
        if (containerEmail) return containerEmail;
      }
    }
    return '';
  }

  function cleanNoteLines(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function noteLineKey(value) {
    return normaliseText(value)
      .toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/\s*-\s*/g, ' - ');
  }

  function readInitialNotes() {
    const activePanel = state.target?.closest('.tab-pane') || state.postClosureTarget?.closest('.tab-pane');
    const activeInitial = findPanelNoteField(activePanel, 'initial notes')?.editor?.value;
    if (cleanNoteLines(activeInitial).length) return String(activeInitial);

    const labels = Array.from(document.querySelectorAll('label,legend,dt,th,span,strong,b,p,div'))
      .filter((element) => isVisible(element) && ownText(element).toLowerCase() === 'initial notes')
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const callLabels = exactCallNotesLabels()
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    for (const label of labels) {
      const endLabel = callLabels.find((candidate) =>
        candidate.getBoundingClientRect().top > label.getBoundingClientRect().top
      );
      if (!endLabel) continue;

      let container = label.parentElement;
      while (container && !container.contains(endLabel)) container = container.parentElement;
      if (!container) continue;

      const lines = cleanNoteLines(container.innerText || container.textContent || '');
      const start = lines.findIndex((line) => noteLineKey(line) === 'initial notes');
      const end = lines.findIndex((line, index) =>
        index > start && noteLineKey(line) === 'call notes'
      );
      if (start >= 0 && end > start + 1) return lines.slice(start + 1, end).join('\n');
    }
    return '';
  }

  function whitespaceFlexiblePattern(value) {
    const tokens = normaliseText(value).split(' ').filter(Boolean);
    if (!tokens.length) return null;
    return new RegExp(tokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+'), 'ig');
  }

  function removeKnownNoteBlocks(value, knownValues) {
    let output = String(value || '').replace(/\r\n?/g, '\n');
    knownValues.forEach((known) => {
      const pattern = whitespaceFlexiblePattern(known);
      if (pattern) output = output.replace(pattern, '\n');
    });
    return output;
  }

  function splitEmbeddedCatchAll(line) {
    const value = String(line || '').trim();
    if (!value) return [];
    const marker = /(?:\*+\s*)?catch\s+all\s+return\s+lead/ig;
    const indexes = Array.from(value.matchAll(marker), (match) => match.index);
    if (!indexes.length) return [value];

    const output = [];
    const prefix = value.slice(0, indexes[0]).trim();
    if (prefix) output.push(prefix);
    indexes.forEach((start, index) => {
      const end = indexes[index + 1] ?? value.length;
      const segment = value.slice(start, end).trim();
      if (segment) output.push(segment);
    });
    return output;
  }

  function meaningfulNoteLines(value, ignoredLineKeys) {
    const labelKeys = new Set(['initial notes', 'call notes', 'post closure notes']);
    const ignored = ignoredLineKeys instanceof Set ? ignoredLineKeys : new Set();
    return cleanNoteLines(value)
      .flatMap(splitEmbeddedCatchAll)
      .filter((line) => {
        const key = noteLineKey(line);
        return !labelKeys.has(key) && !ignored.has(key);
      });
  }

  function buildPostClosurePlan(input) {
    const initialText = String(input?.initialText || '');
    const initialLines = cleanNoteLines(initialText);
    if (!initialLines.length) return null;

    const activeCallText = String(input?.activeCallText || '');
    const ignoredLineKeys = new Set(
      (Array.isArray(input?.ignoredLines) ? input.ignoredLines : []).map(noteLineKey)
    );
    const hasCanonicalCall = input?.canonicalCallText != null;
    const canonicalCallText = hasCanonicalCall ? String(input.canonicalCallText) : activeCallText;
    const canonicalCallLines = meaningfulNoteLines(
      removeKnownNoteBlocks(canonicalCallText, [initialText]),
      ignoredLineKeys
    );
    const knownBlocks = [initialText];
    if (hasCanonicalCall) knownBlocks.push(canonicalCallText);

    const migratedCallLines = hasCanonicalCall
      ? meaningfulNoteLines(removeKnownNoteBlocks(activeCallText, knownBlocks), ignoredLineKeys)
      : [];
    const existingLines = meaningfulNoteLines(
      removeKnownNoteBlocks(String(input?.existingPostText || ''), knownBlocks),
      ignoredLineKeys
    );
    const selectedLines = meaningfulNoteLines(input?.selectedText || '', ignoredLineKeys);

    const output = [];
    const seen = new Set();

    [initialLines, canonicalCallLines, existingLines, migratedCallLines, selectedLines].forEach((source) => {
      source.forEach((line) => {
        const key = noteLineKey(line);
        if (!key || seen.has(key)) return;
        seen.add(key);
        output.push(line);
      });
    });
    return {
      postClosureValue: output.join('\n'),
      cleanCallValue: canonicalCallLines.join('\n'),
      shouldCleanCall: hasCanonicalCall &&
        noteValueKey(activeCallText) !== noteValueKey(canonicalCallLines.join('\n')),
      usedMountedDuplicate: hasCanonicalCall,
      migratedLineCount: migratedCallLines.length
    };
  }

  function buildPostClosureNotes(selectedText, existingPostText) {
    const activePanel = state.target?.closest('.tab-pane') || state.postClosureTarget?.closest('.tab-pane');
    const activeNotes = panelNoteSet(activePanel);
    const duplicateNotes = findMountedDuplicateNoteSet(activeNotes);
    const catchAllAliases = state.config?.phrases
      .filter((phrase) => phrase.category === 'catch-all')
      .flatMap((phrase) => phrase.aliases || []) || [];
    return buildPostClosurePlan({
      initialText: activeNotes?.initial?.editor?.value || readInitialNotes(),
      activeCallText: state.target?.value || '',
      canonicalCallText: duplicateNotes?.call?.editor
        ? duplicateNotes.call.editor.value
        : null,
      existingPostText: existingPostText == null
        ? state.postClosureTarget?.value || ''
        : existingPostText,
      selectedText,
      ignoredLines: catchAllAliases
    });
  }

  function valueWithoutRange(value, range) {
    const text = String(value || '');
    if (!range) return text;
    const start = Math.max(0, Math.min(Number(range.start) || 0, text.length));
    const end = Math.max(start, Math.min(Number(range.end) || start, text.length));
    return text.slice(0, start) + text.slice(end);
  }

  function setNativeValue(target, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
  }

  function setValueAndNotify(target, value) {
    setNativeValue(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function replaceTextUndoably(target, start, end, replacement, expectedValue) {
    let inputFired = false;
    const noteInput = () => { inputFired = true; };
    target.addEventListener('input', noteInput, { once: true });
    target.focus({ preventScroll: true });
    target.setSelectionRange(start, end);

    try {
      document.execCommand('insertText', false, replacement);
    } catch (error) {
      // The native-value fallback below keeps insertion working if Chrome blocks the command.
    }

    target.removeEventListener('input', noteInput);
    const usedFallback = target.value !== expectedValue;
    if (usedFallback) {
      setNativeValue(target, expectedValue);
    }
    if (usedFallback || !inputFired) {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function resolveRange(target, override) {
    if (override) return override;
    if (state.lastSelection && state.lastSelection.target === target && state.targetHadFocus) {
      return {
        start: state.lastSelection.start,
        end: state.lastSelection.end
      };
    }
    return { start: target.value.length, end: target.value.length };
  }

  function insertPhrase(phrase, attempt, rangeOverride) {
    scanPage();
    const isCatchAll = phrase?.category === 'catch-all';
    const target = isCatchAll ? state.postClosureTarget : state.target;
    if (isCatchAll && !(target instanceof HTMLTextAreaElement)) {
      state.statusMessage = 'Post Closure Notes is not available on this lead.';
      state.view = 'browse';
      renderPalette();
      return;
    }
    if (!(target instanceof HTMLTextAreaElement) || !phrase) return;
    state.statusMessage = '';

    let text = String(phrase.text || '');
    if (phrase.requiresAttempt) {
      const number = Number(attempt);
      if (!Number.isInteger(number) || number < 1) return;
      text = text.replaceAll('{{attempt}}', String(number));
    }

    if (text.includes('{{agent}}')) {
      const agent = ensureAgentName();
      if (!agent) return;
      text = text.replaceAll('{{agent}}', agent);
    }

    let emailMissing = false;
    const usesTopEmail = phrase.id === 'email-only-full' ||
      phrase.emailSource === 'top' || text.includes('{{email}}');
    if (usesTopEmail) {
      const email = findTopEmail();
      emailMissing = !email;
      if (text.includes('{{email}}')) {
        text = text.replaceAll('{{email}}', email ? ` ${email}` : '');
      } else if (phrase.id === 'email-only-full') {
        text = text.replace(/(EMAIL ADDRESS\s*-\s*)$/im, (line) =>
          `${line.trimEnd()}${email ? ` ${email}` : ''}`
        );
      }
    }

    if (isCatchAll) {
      const postBefore = valueWithoutRange(target.value, rangeOverride);
      const plan = buildPostClosureNotes(text, postBefore);
      if (plan == null) {
        state.statusMessage = 'Initial Notes could not be read, so Post Closure Notes was not changed.';
        state.view = 'browse';
        renderPalette();
        return;
      }

      const transaction = {
        callTarget: state.target,
        callBefore: String(state.target?.value || ''),
        callAfter: plan.shouldCleanCall ? plan.cleanCallValue : String(state.target?.value || ''),
        postTarget: target,
        postBefore,
        postAfter: plan.postClosureValue
      };
      state.applyingPostClosureTransaction = true;
      try {
        if (plan.shouldCleanCall && state.target instanceof HTMLTextAreaElement) {
          setValueAndNotify(state.target, plan.cleanCallValue);
        }
        setValueAndNotify(target, plan.postClosureValue);
      } finally {
        state.applyingPostClosureTransaction = false;
      }
      target.focus({ preventScroll: true });
      target.setSelectionRange(plan.postClosureValue.length, plan.postClosureValue.length);
      state.targetHadFocus = true;
      state.lastSelection = {
        target,
        start: plan.postClosureValue.length,
        end: plan.postClosureValue.length
      };
      state.lastPostClosureTransaction = transaction;
      closePalette();
      return;
    }

    state.lastPostClosureTransaction = null;

    const range = resolveRange(target, rangeOverride);
    const value = target.value;
    const start = Math.max(0, Math.min(range.start, value.length));
    const end = Math.max(start, Math.min(range.end, value.length));
    const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const existingNewline = value[end] === '\n';
    const suffix = existingNewline ? '' : '\n';
    const replacement = `${prefix}${text}${suffix}`;
    const nextValue = value.slice(0, start) + replacement + value.slice(end);
    const textEnd = start + prefix.length + text.length;
    const nextLinePosition = textEnd + (existingNewline ? 1 : suffix.length);
    const caret = emailMissing ? textEnd : nextLinePosition;

    replaceTextUndoably(target, start, end, replacement, nextValue);
    target.setSelectionRange(caret, caret);
    state.targetHadFocus = true;
    state.lastSelection = { target, start: caret, end: caret };
    closePalette();
  }

  function abbreviationMatch(token) {
    if (!state.config) return null;
    const lower = token.toLowerCase();
    for (const phrase of state.config.phrases) {
      for (const alias of phrase.aliases || []) {
        if (phrase.requiresAttempt) {
          const match = lower.match(new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
          if (match && Number(match[1]) > 0) return { phrase, attempt: Number(match[1]) };
        } else if (lower === alias) {
          return { phrase, attempt: null };
        }
      }
    }
    return null;
  }

  function handleAbbreviation(event) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) ||
        (target !== state.target && target !== state.postClosureTarget)) return;
    if (target.selectionStart !== target.selectionEnd) return;
    const before = target.value.slice(0, target.selectionStart);
    const match = before.match(/(^|\s)([a-z][a-z0-9_-]*)$/i);
    if (!match) return;
    const found = abbreviationMatch(match[2]);
    if (!found) return;
    const expectedTarget = found.phrase.category === 'catch-all'
      ? state.postClosureTarget
      : state.target;
    if (target !== expectedTarget) return;
    event.preventDefault();
    const end = target.selectionStart;
    const start = end - match[2].length;
    insertPhrase(found.phrase, found.attempt, { start, end });
  }

  function handleGlobalKey(event) {
    const undo = state.lastPostClosureTransaction;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
        event.key.toLowerCase() === 'z' && undo &&
        (event.target === undo.callTarget || event.target === undo.postTarget)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.applyingPostClosureTransaction = true;
      try {
        setValueAndNotify(undo.callTarget, undo.callBefore);
        setValueAndNotify(undo.postTarget, undo.postBefore);
      } finally {
        state.applyingPostClosureTransaction = false;
      }
      undo.postTarget.focus({ preventScroll: true });
      undo.postTarget.setSelectionRange(undo.postBefore.length, undo.postBefore.length);
      state.lastSelection = {
        target: undo.postTarget,
        start: undo.postBefore.length,
        end: undo.postBefore.length
      };
      state.lastPostClosureTransaction = null;
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      togglePalette();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      if (state.open && state.view === 'booking') closePalette();
      else openBooking();
      return;
    }
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    if (state.view === 'main' && event.key.toLowerCase() === 'b' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openBooking();
      return;
    }
    if (state.view === 'main' && /^[1-5]$/.test(event.key)) {
      const phrase = state.config?.phrases.find((item) => item.quickOrder === Number(event.key));
      if (phrase) {
        event.preventDefault();
        choosePhrase(phrase);
      }
      return;
    }
    if (state.view === 'attempt' && !state.otherAttemptOpen && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      if (event.key === '4') {
        state.otherAttemptOpen = true;
        renderPalette();
      } else {
        insertPhrase(state.attemptPhrase, Number(event.key));
      }
    }
  }

  function handleTargetActivity(event) {
    const undo = state.lastPostClosureTransaction;
    if (event.type === 'input' && !state.applyingPostClosureTransaction && undo &&
        (event.target === undo.callTarget || event.target === undo.postTarget)) {
      state.lastPostClosureTransaction = null;
    }
    if (event.target === state.target || event.target === state.postClosureTarget) {
      rememberSelection(event.target);
    }
  }

  function startObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(scheduleScan);
    state.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  function init() {
    injectStyles();
    ensurePalette();
    loadInitialConfig();
    if (!getAgentName()) askAgentName();
    scanPage();
    startObserver();
    document.addEventListener('keydown', handleAbbreviation, true);
    document.addEventListener('keydown', handleGlobalKey, false);
    document.addEventListener('focusin', handleTargetActivity, true);
    document.addEventListener('keyup', handleTargetActivity, true);
    document.addEventListener('click', handleTargetActivity, true);
    document.addEventListener('select', handleTargetActivity, true);
    document.addEventListener('input', handleTargetActivity, true);
    window.addEventListener('resize', positionPalette);
    document.addEventListener('change', onLeadActivity, true);
    document.addEventListener('focusout', onLeadActivity, true);
    document.addEventListener('click', onLeadActivity, true);
  }

  /* Fully unloads Konnect Notes from the page (UI, listeners, observer and
     the cached booking engine) so the bookmark can load a fresh copy
     without a page refresh. Drafts and settings stay in localStorage. */
  function stopKonnectNotes() {
    try { if (state.booking) saveDraftNow(); } catch (error) { /* keep going */ }
    clearTimeout(state.scanTimer);
    clearTimeout(bookingSaveTimer);
    clearTimeout(bookingSyncTimer);
    if (state.observer) state.observer.disconnect();
    document.removeEventListener('keydown', handleAbbreviation, true);
    document.removeEventListener('keydown', handleGlobalKey, false);
    ['focusin', 'keyup', 'click', 'select', 'input'].forEach((type) =>
      document.removeEventListener(type, handleTargetActivity, true));
    ['change', 'focusout', 'click'].forEach((type) =>
      document.removeEventListener(type, onLeadActivity, true));
    window.removeEventListener('resize', positionPalette);
    forgetInboundCustomer();
    [PALETTE_ID, STYLE_ID, LAUNCHER_SECTION_ID, INBOUND_LAUNCHER_ID].forEach((id) => document.getElementById(id)?.remove());
    try { delete window.KonnectNotes; } catch (error) { window.KonnectNotes = undefined; }
    /* Confirmation, styled inline because the stylesheet has just been removed. */
    const toast = document.createElement('div');
    toast.textContent = 'Konnect Notes stopped. Click the bookmark to load the latest version.';
    toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;' +
      'padding:10px 16px;border-radius:12px;background:#1c1c1e;color:#fff;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.3);pointer-events:none';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
    try { delete window.KonnectBookingEngine; } catch (error) { window.KonnectBookingEngine = undefined; }
  }

  KN.stop = stopKonnectNotes;
  KN.togglePalette = togglePalette;
  KN.openPalette = openPalette;
  KN.closePalette = closePalette;
  KN.refreshRemote = refreshRemoteConfig;
  KN.scanPage = scanPage;
  KN.findTopEmail = findTopEmail;
  KN.state = state;
  KN.openBooking = openBooking;
  KN.readLead = readLead;

  init();
})();
