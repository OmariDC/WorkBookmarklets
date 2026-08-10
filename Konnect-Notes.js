(function () {
  'use strict';

  const existing = window.KonnectNotes;
  if (existing && existing.version) {
    if (typeof existing.refreshRemote === 'function') existing.refreshRemote();
    if (typeof existing.togglePalette === 'function') existing.togglePalette();
    return;
  }

  const KN = window.KonnectNotes = {
    version: '1.5.0'
  };

  const CONFIG_URL = 'https://raw.githubusercontent.com/OmariDC/WorkBookmarklets/main/Konnect-Notes-Phrases.json';
  const STORAGE_KEY = 'konnectNotes:workingConfig:v1';
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
    lastPostClosureTransaction: null
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
    }
    updateLauncher();
    if (!state.target && state.open) closePalette();
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
    style.textContent = `
      .kn-launcher-section { height: 75px; text-align: center; }
      .kn-launcher { position: relative; display: inline-flex !important; align-items: center; justify-content: center; width: 60px !important; height: 60px !important; border-radius: 30px !important; background: #1e1d49 !important; color: #fff !important; box-shadow: 5px 5px 3px #888 !important; border: 1px solid transparent !important; text-decoration: none !important; }
      .kn-launcher:hover, .kn-launcher:focus { background: #34416a !important; color: #fff !important; }
      .kn-launcher-clipboard { position: relative; width: 24px; height: 29px; border: 3px solid #fff; border-radius: 3px; display: block; }
      .kn-launcher-clipboard::before { content: ''; position: absolute; width: 12px; height: 5px; border: 2px solid #fff; border-radius: 3px; background: #1e1d49; top: -7px; left: 3px; }
      .kn-launcher-bolt { position: absolute; right: -10px; bottom: -8px; display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border-radius: 50%; background: #f9772e; color: #fff; font: 900 14px/1 Arial, sans-serif; }
      .kn-ui, .kn-ui * { box-sizing: border-box; font-family: Arial, sans-serif; }
      #${PALETTE_ID} { position: fixed; top: 0; left: 0; width: 230px; max-height: 360px; z-index: 2147483000; display: none; flex-direction: column; overflow: hidden; color: #fff; background: #1e1d49; border: 2px solid #040134; border-radius: 9px; box-shadow: 0 12px 34px rgba(0,0,0,.42); }
      #${PALETTE_ID}.kn-open { display: flex; }
      .kn-header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 11px 12px; background: #483a73; }
      .kn-title { flex: 1; font-size: 16px; font-weight: 700; }
      .kn-body { flex: 1 1 auto; min-height: 0; padding: 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
      .kn-icon-button, .kn-button, .kn-chip, .kn-result, .kn-quick, .kn-attempt { border: 1px solid #bdbde3; border-radius: 5px; cursor: pointer; }
      .kn-icon-button { min-width: 32px; height: 30px; padding: 3px 8px; background: #34416a; color: #fff; font-weight: 700; }
      .kn-button { padding: 7px 10px; background: #34416a; color: #fff; }
      .kn-button.kn-primary { background: #f9772e; border-color: #f9772e; color: #1e1d49; font-weight: 700; }
      .kn-button.kn-danger { background: #8d3344; border-color: #b95a6d; }
      .kn-search, .kn-input, .kn-textarea, .kn-select { width: 100%; padding: 8px 9px; color: #fff; background: #34416a; border: 1px solid #bdbde3; border-radius: 5px; }
      .kn-search { margin-bottom: 10px; font-size: 14px; }
      .kn-search::placeholder, .kn-input::placeholder, .kn-textarea::placeholder { color: #d9daf3; }
      .kn-quick-grid { display: grid; grid-template-columns: 1fr; gap: 7px; margin-bottom: 10px; }
      .kn-quick { position: relative; min-height: 48px; padding: 8px 9px 8px 33px; background: #34416a; color: #fff; text-align: left; }
      .kn-quick-key { position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; background: #f9772e; color: #1e1d49; font-weight: 700; }
      .kn-categories { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 3px; }
      .kn-chip { flex: 0 0 auto; padding: 5px 8px; color: #fff; background: #34416a; font-size: 12px; }
      .kn-chip.kn-active { background: #f9772e; border-color: #f9772e; color: #1e1d49; font-weight: 700; }
      .kn-results { display: flex; flex-direction: column; gap: 5px; }
      .kn-result { padding: 8px 9px; background: #292c55; color: #fff; text-align: left; }
      .kn-result.kn-selected, .kn-result:hover { border-color: #f9772e; background: #3b3f70; }
      .kn-result-label { display: block; font-size: 14px; font-weight: 700; }
      .kn-result-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; color: #c9cae7; font-size: 10px; }
      .kn-result-shortcut { display: inline-flex; padding: 2px 6px; border-radius: 3px; background: #f9772e; color: #1e1d49; font-weight: 800; }
      .kn-result-preview { display: -webkit-box; margin-top: 5px; color: #e1e2f5; font-size: 11px; line-height: 1.35; white-space: normal; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .kn-alias { display: inline-block; margin: 4px 4px 0 0; padding: 1px 4px; border-radius: 3px; background: #483a73; color: #eee; font-size: 10px; }
      .kn-browse-controls { position: sticky; top: -12px; z-index: 2; margin-top: -12px; padding-top: 12px; background: #1e1d49; }
      .kn-muted { color: #d9daf3; font-size: 12px; }
      .kn-status { margin: 0 0 9px; padding: 7px 8px; background: rgba(255,255,255,.08); border-radius: 5px; color: #d9daf3; font-size: 12px; }
      .kn-attempt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
      .kn-attempt { min-height: 52px; background: #34416a; color: #fff; font-size: 16px; font-weight: 700; }
      .kn-settings-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
      .kn-phrase-list { display: flex; flex-direction: column; gap: 6px; }
      .kn-phrase-row { padding: 8px; border: 1px solid #575d8f; border-radius: 5px; background: #292c55; }
      .kn-phrase-row-top { display: flex; align-items: flex-start; gap: 8px; }
      .kn-phrase-row-title { flex: 1; font-weight: 700; }
      .kn-row-actions { display: flex; gap: 5px; }
      .kn-row-actions .kn-button { padding: 4px 7px; font-size: 11px; }
      .kn-field { display: block; margin-bottom: 10px; }
      .kn-field-label { display: block; margin-bottom: 4px; font-weight: 700; font-size: 12px; }
      .kn-textarea { min-height: 105px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .kn-check-row { display: flex; align-items: center; gap: 7px; margin: 8px 0; }
      .kn-form-actions { display: flex; gap: 7px; margin-top: 12px; }
      .kn-export { min-height: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .kn-browse-button { width: 100%; margin-bottom: 8px; }
      .kn-shortcut-hint { text-align: center; }
      @media (max-width: 720px) {
        #${PALETTE_ID} { width: 190px; }
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
    if (!state.palette || !state.launcherSection?.isConnected || !state.target) return;
    const rail = state.launcherSection.closest('.userQuotesAffix');
    const anchorRect = state.launcherSection.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect() || anchorRect;
    const targetRect = state.target.getBoundingClientRect();
    const isContext = state.view !== 'main';
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
      const viewportBottom = window.innerHeight - 10;
      const turquoiseCar = findTurquoiseCar(rail);
      const contextAnchor = turquoiseCar?.closest('section.cassini-section') || turquoiseCar;
      const contextRect = contextAnchor?.getBoundingClientRect() || anchorRect;
      left = Math.max(8, Math.round(anchorRect.right + 12));
      width = Math.max(320, Math.min(540, window.innerWidth - left - 12));
      top = Math.max(8, Math.min(Math.round(contextRect.top), viewportBottom - 240));
      maxHeight = Math.max(240, Math.min(460, viewportBottom - top));
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

    const actions = element('div', 'kn-settings-actions');
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
    error.style.display = 'none';
    body.appendChild(error);

    const formActions = element('div', 'kn-form-actions');
    formActions.appendChild(button('Save phrase', 'kn-primary', () => {
      const label = labelInput.value.trim();
      const text = textInput.value;
      if (!label || !text.trim()) {
        error.textContent = 'Name and phrase text are required.';
        error.style.display = 'block';
        return;
      }
      if (attemptCheck.checked && !text.includes('{{attempt}}')) {
        error.textContent = 'Attempt phrases must include {{attempt}}.';
        error.style.display = 'block';
        return;
      }
      if (emailCheck.checked && !text.includes('{{email}}')) {
        error.textContent = 'Top-email phrases must include {{email}}.';
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

  function meaningfulNoteLines(value) {
    const labelKeys = new Set(['initial notes', 'call notes', 'post closure notes']);
    return cleanNoteLines(value)
      .flatMap(splitEmbeddedCatchAll)
      .filter((line) => !labelKeys.has(noteLineKey(line)));
  }

  function buildPostClosurePlan(input) {
    const initialText = String(input?.initialText || '');
    const initialLines = cleanNoteLines(initialText);
    if (!initialLines.length) return null;

    const activeCallText = String(input?.activeCallText || '');
    const hasCanonicalCall = input?.canonicalCallText != null;
    const canonicalCallText = hasCanonicalCall ? String(input.canonicalCallText) : activeCallText;
    const canonicalCallLines = meaningfulNoteLines(
      removeKnownNoteBlocks(canonicalCallText, [initialText])
    );
    const knownBlocks = [initialText];
    if (hasCanonicalCall) knownBlocks.push(canonicalCallText);

    const migratedCallLines = hasCanonicalCall
      ? meaningfulNoteLines(removeKnownNoteBlocks(activeCallText, knownBlocks))
      : [];
    const existingLines = meaningfulNoteLines(
      removeKnownNoteBlocks(String(input?.existingPostText || ''), knownBlocks)
    );
    const selectedLines = meaningfulNoteLines(input?.selectedText || '');

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

  function buildPostClosureNotes(selectedText) {
    const activePanel = state.target?.closest('.tab-pane') || state.postClosureTarget?.closest('.tab-pane');
    const activeNotes = panelNoteSet(activePanel);
    const duplicateNotes = findMountedDuplicateNoteSet(activeNotes);
    return buildPostClosurePlan({
      initialText: activeNotes?.initial?.editor?.value || readInitialNotes(),
      activeCallText: state.target?.value || '',
      canonicalCallText: duplicateNotes?.call?.editor
        ? duplicateNotes.call.editor.value
        : null,
      existingPostText: state.postClosureTarget?.value || '',
      selectedText
    });
  }

  function setNativeValue(target, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
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
      const plan = buildPostClosureNotes(text);
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
        postBefore: String(target.value || ''),
        postAfter: plan.postClosureValue
      };
      if (plan.shouldCleanCall && state.target instanceof HTMLTextAreaElement) {
        replaceTextUndoably(
          state.target,
          0,
          state.target.value.length,
          plan.cleanCallValue,
          plan.cleanCallValue
        );
      }
      replaceTextUndoably(
        target,
        0,
        target.value.length,
        plan.postClosureValue,
        plan.postClosureValue
      );
      target.setSelectionRange(plan.postClosureValue.length, plan.postClosureValue.length);
      state.targetHadFocus = true;
      state.lastSelection = {
        target,
        start: plan.postClosureValue.length,
        end: plan.postClosureValue.length
      };
      state.lastPostClosureTransaction = plan.shouldCleanCall ? transaction : null;
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
        (event.target === undo.callTarget || event.target === undo.postTarget) &&
        undo.callTarget?.value === undo.callAfter && undo.postTarget?.value === undo.postAfter) {
      event.preventDefault();
      event.stopPropagation();
      setNativeValue(undo.callTarget, undo.callBefore);
      undo.callTarget.dispatchEvent(new Event('input', { bubbles: true }));
      setNativeValue(undo.postTarget, undo.postBefore);
      undo.postTarget.dispatchEvent(new Event('input', { bubbles: true }));
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
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
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
  }

  KN.togglePalette = togglePalette;
  KN.openPalette = openPalette;
  KN.closePalette = closePalette;
  KN.refreshRemote = refreshRemoteConfig;
  KN.scanPage = scanPage;
  KN.findTopEmail = findTopEmail;
  KN.state = state;

  init();
})();
