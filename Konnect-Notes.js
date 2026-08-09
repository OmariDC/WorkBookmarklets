(function () {
  'use strict';

  const existing = window.KonnectNotes;
  if (existing && existing.version) {
    if (typeof existing.refreshRemote === 'function') existing.refreshRemote();
    if (typeof existing.togglePalette === 'function') existing.togglePalette();
    return;
  }

  const KN = window.KonnectNotes = {
    version: '1.0.0'
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
    statusMessage: ''
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

  function rememberSelection(target) {
    if (!(target instanceof HTMLTextAreaElement) || target !== state.target) return;
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
      if (state.target) rememberSelection(state.target);
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
    const nextTarget = found?.editor || null;
    if (nextTarget !== state.target) {
      state.target = nextTarget;
      state.targetLabel = found?.label || null;
      state.targetHadFocus = false;
      state.lastSelection = null;
    }
    updateLauncher();
    if (!state.target && state.open) closePalette();
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
      #${PALETTE_ID} { position: fixed; top: 86px; left: 245px; width: min(470px, calc(100vw - 270px)); max-height: calc(100vh - 120px); z-index: 2147483000; display: none; flex-direction: column; overflow: hidden; color: #fff; background: #1e1d49; border: 2px solid #040134; border-radius: 9px; box-shadow: 0 12px 34px rgba(0,0,0,.42); }
      #${PALETTE_ID}.kn-open { display: flex; }
      .kn-header { display: flex; align-items: center; gap: 8px; padding: 11px 12px; background: #483a73; }
      .kn-title { flex: 1; font-size: 16px; font-weight: 700; }
      .kn-body { padding: 12px; overflow-y: auto; }
      .kn-icon-button, .kn-button, .kn-chip, .kn-result, .kn-quick, .kn-attempt { border: 1px solid #bdbde3; border-radius: 5px; cursor: pointer; }
      .kn-icon-button { min-width: 32px; height: 30px; padding: 3px 8px; background: #34416a; color: #fff; font-weight: 700; }
      .kn-button { padding: 7px 10px; background: #34416a; color: #fff; }
      .kn-button.kn-primary { background: #f9772e; border-color: #f9772e; color: #1e1d49; font-weight: 700; }
      .kn-button.kn-danger { background: #8d3344; border-color: #b95a6d; }
      .kn-search, .kn-input, .kn-textarea, .kn-select { width: 100%; padding: 8px 9px; color: #fff; background: #34416a; border: 1px solid #bdbde3; border-radius: 5px; }
      .kn-search { margin-bottom: 10px; font-size: 14px; }
      .kn-search::placeholder, .kn-input::placeholder, .kn-textarea::placeholder { color: #d9daf3; }
      .kn-quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 10px; }
      .kn-quick { position: relative; min-height: 48px; padding: 8px 9px 8px 33px; background: #34416a; color: #fff; text-align: left; }
      .kn-quick-key { position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; background: #f9772e; color: #1e1d49; font-weight: 700; }
      .kn-categories { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 3px; }
      .kn-chip { flex: 0 0 auto; padding: 5px 8px; color: #fff; background: #34416a; font-size: 12px; }
      .kn-chip.kn-active { background: #f9772e; border-color: #f9772e; color: #1e1d49; font-weight: 700; }
      .kn-results { display: flex; flex-direction: column; gap: 5px; }
      .kn-result { padding: 8px 9px; background: #292c55; color: #fff; text-align: left; }
      .kn-result.kn-selected, .kn-result:hover { border-color: #f9772e; background: #3b3f70; }
      .kn-result-label { display: block; font-weight: 700; }
      .kn-result-preview { display: block; margin-top: 3px; color: #d9daf3; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .kn-alias { display: inline-block; margin: 4px 4px 0 0; padding: 1px 4px; border-radius: 3px; background: #483a73; color: #eee; font-size: 10px; }
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
      @media (max-width: 720px) {
        #${PALETTE_ID} { left: 12px; right: 12px; top: 70px; width: auto; }
        .kn-quick-grid { grid-template-columns: 1fr; }
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
    return state.config.phrases
      .filter((phrase) => state.activeCategory === 'all' || phrase.category === state.activeCategory)
      .filter((phrase) => {
        if (!terms.length) return true;
        const haystack = `${phrase.label} ${phrase.text} ${(phrase.aliases || []).join(' ')}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => {
        const aQuick = a.quickOrder || 99;
        const bQuick = b.quickOrder || 99;
        return aQuick - bQuick || a.label.localeCompare(b.label);
      });
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
      row.appendChild(element('span', 'kn-result-preview', phrasePreview(phrase)));
      (phrase.aliases || []).forEach((alias) => {
        const suffix = phrase.requiresAttempt ? '[number]' : '';
        row.appendChild(element('span', 'kn-alias', `${alias}${suffix}`));
      });
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
    if (state.configStatus) body.appendChild(element('div', 'kn-status', state.configStatus));

    const search = element('input', 'kn-search');
    search.type = 'search';
    search.placeholder = 'Search phrases or use an abbreviation...';
    search.value = state.searchQuery;
    body.appendChild(search);

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
      body.appendChild(categories);
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
      if (!state.searchQuery && /^[1-5]$/.test(event.key)) {
        const phrase = state.config?.phrases.find((item) => item.quickOrder === Number(event.key));
        if (phrase) {
          event.preventDefault();
          choosePhrase(phrase);
        }
        return;
      }
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
    if (state.view === 'attempt') renderAttempt();
    else if (state.view === 'settings') renderSettings();
    else if (state.view === 'edit') renderEditor();
    else if (state.view === 'export') renderExport();
    else if (state.view === 'import') renderImport();
    else renderMain();
  }

  function openPalette() {
    scanPage();
    if (!state.target) return;
    if (document.activeElement === state.target) rememberSelection(state.target);
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

  function findTopEmail() {
    const labels = Array.from(document.querySelectorAll('b'))
      .filter((node) => isVisible(node) && ownText(node).toLowerCase() === 'email')
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    for (const label of labels) {
      const row = label.closest('.row') || label.parentElement;
      if (!row) continue;
      const candidates = row.querySelectorAll('a,span,input');
      for (const candidate of candidates) {
        if (candidate === label) continue;
        const raw = candidate instanceof HTMLInputElement ? candidate.value : candidate.textContent;
        const match = String(raw || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        if (match) return match[0];
      }
    }
    return '';
  }

  function setNativeValue(target, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
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
    const target = state.target;
    if (!(target instanceof HTMLTextAreaElement) || !phrase) return;

    let text = String(phrase.text || '');
    if (phrase.requiresAttempt) {
      const number = Number(attempt);
      if (!Number.isInteger(number) || number < 1) return;
      text = text.replaceAll('{{attempt}}', String(number));
    }

    let emailMissing = false;
    if (phrase.emailSource === 'top' || text.includes('{{email}}')) {
      const email = findTopEmail();
      emailMissing = !email;
      text = text.replaceAll('{{email}}', email ? ` ${email}` : '');
    }

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

    setNativeValue(target, nextValue);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
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
    if (event.target !== state.target || !(state.target instanceof HTMLTextAreaElement)) return;
    const target = state.target;
    if (target.selectionStart !== target.selectionEnd) return;
    const before = target.value.slice(0, target.selectionStart);
    const match = before.match(/(^|\s)([a-z][a-z0-9_-]*)$/i);
    if (!match) return;
    const found = abbreviationMatch(match[2]);
    if (!found) return;
    event.preventDefault();
    const end = target.selectionStart;
    const start = end - match[2].length;
    insertPhrase(found.phrase, found.attempt, { start, end });
  }

  function handleGlobalKey(event) {
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
    if (event.target === state.target) rememberSelection(state.target);
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
  }

  KN.togglePalette = togglePalette;
  KN.openPalette = openPalette;
  KN.closePalette = closePalette;
  KN.refreshRemote = refreshRemoteConfig;
  KN.scanPage = scanPage;
  KN.state = state;

  init();
})();
