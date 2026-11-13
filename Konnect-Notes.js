(function () {
  'use strict';

  const existing = window.KonnectNotes;
  if (existing && existing.version) {
    if (typeof existing.refreshRemote === 'function') existing.refreshRemote();
    if (typeof existing.togglePalette === 'function') existing.togglePalette();
    return;
  }

  const KN = window.KonnectNotes = {
    version: '1.21.0'
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
  /* Other staff get the call notes only: the phrase list, the shorthand and
     their settings. The whole booking system (the Booking Builder and its
     buttons and keys, the inbound Customer step, the diary, drafts, the
     booking sheet row) is for the owner for now,
     and is on only while this flag is set on the page. The Work Tools
     bookmark sets it before loading; the Konnect Tools bookmark does not.
     Nothing is stored, so it cannot stay on by accident. To give someone
     else the booking system, their bookmark must set
     window.KonnectNotesOwner = true before it loads this file. */
  function ownerTools() {
    return window.KonnectNotesOwner === true;
  }
  // The stored switch earlier versions used is no longer read, so it is cleared.
  try { localStorage.removeItem('konnectNotes:bookingAccess:v1'); } catch (error) { /* storage blocked */ }

  /* The call outcome each Call Notes phrase stands for, by phrase id
     (shorthand in the comment). A phrase not listed here sets nothing.
     "Update Outcomes (No Call Made)" is only ever set from the Email Only
     notes in NO_CALL_PHRASES, as no call is made on those. */
  const MESSAGE_LEFT = 'No Answer Message Left';
  const NO_MESSAGE_LEFT = 'No Answer No Message Left';
  const CALL_OUTCOME_FOR_PHRASE = {
    'vm-left': MESSAGE_LEFT, // vm
    'confirm-provisional-booking': MESSAGE_LEFT, // book
    'line-ringing': NO_MESSAGE_LEFT, // ring, ringing
    'could-not-reach': NO_MESSAGE_LEFT, // cnr
    'line-engaged': NO_MESSAGE_LEFT, // eng, engaged
    'line-rang-then-failed': NO_MESSAGE_LEFT, // rf, failed
    'mail-box-full': NO_MESSAGE_LEFT, // mbf
    'precall-declined-vm': NO_MESSAGE_LEFT, // dvm, pdvm
    'line-failed-email-only': NO_MESSAGE_LEFT // lfe
  };
  const NO_CALL_MADE = 'Update Outcomes (No Call Made)';
  const NO_CALL_PHRASES = ['email-only-lead-short', 'email-only-full']; // eo

  /* The lead outcome a Call Notes phrase stands for, by phrase id. It is only
     set for a note a person wrote (a real key press or a pick from the phrase
     list). Lead Re setup presses the key itself and sets its own outcomes. */
  const EMAIL_ONLY_OUTCOME = ['Customer Hub Team', 'Ongoing', 'Email Only Lead'];
  const LEAD_OUTCOME_FOR_PHRASE = {
    'email-only-lead-short': EMAIL_ONLY_OUTCOME, // eo
    'email-only-full': EMAIL_ONLY_OUTCOME,
    'line-failed-email-only': EMAIL_ONLY_OUTCOME // lfe
  };

  /* Owner only: the dealer names as the booking sheet spells them. */
  const SHEET_DEALERS = ['Birmingham Central', 'Birmingham North', 'Birmingham South', 'Bristol Cribbs', 'Chingford',
    'Coventry', 'Crawley', 'Croydon', 'Edgware', 'Guildford', 'Hatfield', 'Leicester', 'Liverpool', 'Maidstone',
    'Manchester', 'Newport', 'Nottingham', 'Preston', 'Redditch', 'Romford', 'Sale', 'Sheffield', 'Stockport',
    'Walton', 'West London', 'Wimbledon'];
  const SHEET_TOAST_ID = 'kn-sheet-row-toast';
  const NAME_TITLES = /^(?:(?:mr|mrs|miss|ms|mx|dr|prof|sir|lady|rev)\.?\s+)+(?=\S)/i;

  /* Dealers a booking is never made for. */
  const NO_BOOKING_DEALERS = [
    { match: /brentford/i, name: 'Brentford', why: 'is service only' },
    { match: /general sales/i, name: 'General Sales', why: 'is not a dealership' },
    { match: /national/i, name: 'National', why: 'is not a dealership' }
  ];

  /* Owner only: a customer's part exchange can sit on its own PX valuation
     lead. That lead is closed with this outcome once its details are copied
     onto the lead being booked. Options are matched on letters only. */
  const DUPLICATE_LEAD_OUTCOME = ['Customer Hub Team', 'No Opportunity', 'Duplicate Lead'];
  const PX_VALUATION_LEAD = /p\s*\/?\s*x\s+valuation/i;
  const OUTCOME_LISTS = 'select[ng-model^="theActivity.SelectedOutcomeLevel"]';

  const OWN_PHRASES_STATUS = 'Your own phrase changes are in use on this computer only.';
  const STYLE_ID = 'kn-notes-style';
  const PALETTE_ID = 'kn-notes-palette';
  const LAUNCHER_SECTION_ID = 'kn-notes-launcher-section';

  const state = {
    config: null,
    dirty: false,
    remoteSignature: '',
    configStatus: 'Loading phrases...',
    target: null,
    postClosureTarget: null,
    targetHadFocus: false,
    lastSelection: null,
    launcherSection: null,
    launcherButton: null,
    palette: null,
    observer: null,
    scanTimer: null,
    scanDueBy: 0,
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
    if (!input || typeof input !== 'object') throw new Error('The phrase list must be an object.');
    if (!Array.isArray(input.categories) || !Array.isArray(input.phrases)) {
      throw new Error('The phrase list must contain categories and phrases.');
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

    if (!categories.length || !phrases.length) throw new Error('The phrase list contains no usable phrases.');
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
    state.configStatus = message || (state.dirty ? OWN_PHRASES_STATUS : 'Using the standard phrases.');
    writeStored();
    if (state.open) renderPalette();
  }

  async function fetchRemoteConfig() {
    const response = await fetch(`${CONFIG_URL}?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Phrase download failed (${response.status}).`);
    return validateConfig(await response.json());
  }

  /* Brings new and changed standard phrases into a phrase list the user has
     edited, by phrase id. "base" is the standard list as it was last seen:
     a phrase the user changed or added keeps their version, a phrase they
     deleted stays deleted, and everything they left alone follows the
     standard list (including removals). Pure. */
  function mergeRemoteConfig(local, remote, base) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const byId = (config) => new Map(((config && config.phrases) || []).map((phrase) => [phrase.id, phrase]));
    const localById = byId(local);
    const remoteById = byId(remote);
    const baseById = byId(base);
    const phrases = [];
    local.phrases.forEach((phrase) => {
      const was = baseById.get(phrase.id);
      const now = remoteById.get(phrase.id);
      const untouched = was && same(was, phrase);
      if (untouched && !now) return;
      phrases.push(clone(untouched && now ? now : phrase));
    });
    remote.phrases.forEach((phrase) => {
      if (!localById.has(phrase.id) && !baseById.has(phrase.id)) phrases.push(clone(phrase));
    });
    const categoryIds = new Set(remote.categories.map((category) => category.id));
    const categories = clone(remote.categories)
      .concat(clone(local.categories.filter((category) => !categoryIds.has(category.id))));
    return { schemaVersion: 1, name: remote.name || local.name, categories, phrases };
  }

  async function refreshRemoteConfig(options) {
    const settings = options || {};
    try {
      const remote = await fetchRemoteConfig();
      const remoteSig = signature(remote);

      let base = null;
      try { base = state.remoteSignature ? JSON.parse(state.remoteSignature) : null; } catch (error) { base = null; }
      state.remoteSignature = remoteSig;

      if (settings.force || !state.config || !state.dirty) {
        setWorkingConfig(remote, false, 'Using the latest standard phrases.');
      } else {
        const merged = validateConfig(mergeRemoteConfig(state.config, remote, base));
        if (signature(merged) === remoteSig) setWorkingConfig(merged, false, 'Using the latest standard phrases.');
        else setWorkingConfig(merged, true, OWN_PHRASES_STATUS);
      }
      return remote;
    } catch (error) {
      state.configStatus = state.config
        ? 'Could not check for phrase updates. Your saved phrases are still in use.'
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
          ? OWN_PHRASES_STATUS
          : 'Using your saved phrases while checking for updates.';
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

  /* The lead a notes pane belongs to, from the page's own data. Empty when
     the page does not say, and then nothing is assumed about the pane. */
  function paneLeadId(notes) {
    const node = notes?.call?.editor || notes?.initial?.editor || notes?.panel;
    const activity = node ? leadScopeActivity(node) : null;
    return activity && activity.ID != null ? String(activity.ID) : '';
  }

  /* Konnect can mount the same lead twice. A second pane only counts as this
     lead when the page gives both the same lead ID: matching Initial Notes
     is not proof, as two leads can carry the same web enquiry text. */
  function findMountedDuplicateNoteSet(activeNotes) {
    if (!activeNotes?.panel || !activeNotes.initial?.editor) return null;
    const tabContent = activeNotes.panel.parentElement;
    if (!tabContent?.classList?.contains('tab-content')) return null;

    const activeLeadId = paneLeadId(activeNotes);
    const activeInitialKey = noteValueKey(activeNotes.initial.editor.value);
    if (!activeLeadId || !activeInitialKey) return null;

    const candidates = Array.from(tabContent.children)
      .filter((panel) => panel !== activeNotes.panel && panel.classList?.contains('tab-pane'))
      .map(panelNoteSet)
      .filter((notes) => notes?.initial?.editor && notes.call?.editor)
      .filter((notes) => paneLeadId(notes) === activeLeadId)
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
    button.title = 'Konnect Notes (Alt+N)';
    button.setAttribute('aria-label', 'Open Konnect Notes');
    /* Exactly the size of Konnect's own rail button beside it. */
    const tickSize = greenTick.getBoundingClientRect();
    if (tickSize.width > 20 && tickSize.height > 20) {
      button.style.setProperty('width', `${Math.round(tickSize.width)}px`, 'important');
      button.style.setProperty('height', `${Math.round(tickSize.height)}px`, 'important');
    }

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
    clearTimeout(state.scanTimer);
    /* While the other lead's tab is brought forward, the booking stays on its own lead. */
    if (pxMoveRun || noteOutcomeRun) {
      state.scanTimer = setTimeout(scanPage, 300);
      return;
    }
    state.scanDueBy = 0;
    const found = findCallNotesTarget();
    const postClosure = findPostClosureNotesTarget();
    const nextTarget = found?.editor || null;
    const nextPostClosureTarget = postClosure?.editor || null;
    const targetChanged = nextTarget !== state.target;
    const postClosureChanged = nextPostClosureTarget !== state.postClosureTarget;
    if (targetChanged || postClosureChanged) {
      state.target = nextTarget;
      state.postClosureTarget = nextPostClosureTarget;
      state.targetHadFocus = false;
      state.lastSelection = null;
      state.lastPostClosureTransaction = null;
    }
    claimInboundCall();
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

  /* Waits for the page to settle, but never longer than SCAN_MAX_WAIT: a
     page that keeps changing would otherwise never be scanned. */
  const SCAN_SETTLE = 120;
  const SCAN_MAX_WAIT = 600;
  function scheduleScan() {
    const now = Date.now();
    if (!state.scanDueBy) state.scanDueBy = now + SCAN_MAX_WAIT;
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scanPage, Math.max(0, Math.min(SCAN_SETTLE, state.scanDueBy - now)));
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .kn-launcher-section { height: 75px; text-align: center; }
      /* Navy, the size of Konnect's own rail buttons, with nothing outside the circle. */
      .kn-launcher { position: relative; display: inline-flex !important; align-items: center; justify-content: center; width: 60px !important; height: 60px !important; border-radius: 50% !important; background: #1e1d49 !important; color: #fff !important; box-shadow: none !important; border: none !important; text-decoration: none !important; overflow: hidden; }
      .kn-launcher:hover, .kn-launcher:focus, .kn-launcher.kn-launcher-open { background: #1e1d49 !important; color: #fff !important; box-shadow: inset 0 0 0 3px #f9772e !important; }
      .kn-launcher-clipboard { position: relative; width: 24px; height: 29px; border: 3px solid #fff; border-radius: 3px; display: block; }
      .kn-launcher-clipboard::before { content: ''; position: absolute; width: 12px; height: 5px; border: 2px solid #fff; border-radius: 3px; background: #1e1d49; top: -7px; left: 3px; }
      .kn-launcher-bolt { position: absolute; right: -10px; bottom: -8px; display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border-radius: 50%; background: #f9772e; color: #1c1c1e; font: 900 14px/1 -apple-system, sans-serif; }
      .kn-ui, .kn-ui * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .kn-ui svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      #${PALETTE_ID} { position: fixed; top: 0; left: 0; width: 240px; max-height: 380px; z-index: 2147483000; display: none; flex-direction: column; overflow: hidden; color: #1c1c1e; background: #f2f2f7; border: none; border-radius: 16px; box-shadow: 0 20px 50px -12px rgba(0,0,0,0.3); font-size: 13px; line-height: 1.35; container-type: inline-size; }
      #${PALETTE_ID}.kn-open { display: flex; }
      #${PALETTE_ID}:focus { outline: none; }
      .kn-header { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: #1c1c1e; border-radius: 16px 16px 0 0; }
      .kn-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .kn-body { flex: 1 1 auto; min-height: 0; padding: 10px 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
      .kn-icon-button, .kn-button, .kn-chip, .kn-result, .kn-quick, .kn-attempt { border: none; cursor: pointer; }
      .kn-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 28px; height: 28px; padding: 5px 9px; border-radius: 8px; background: rgba(255,255,255,0.14); color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; }
      .kn-icon-button:hover { background: rgba(255,255,255,0.24); }
      /* The words go when the panel is too narrow for them; the name stays in the tooltip. */
      @container (max-width: 279px) { .kn-icon-label { display: none; } .kn-icon-button { padding: 5px 7px; } }
      .kn-button { padding: 7px 13px; border-radius: 999px; background: #fff; color: #1c1c1e; font-size: 12.5px; font-weight: 600; box-shadow: inset 0 0 0 1px #c9cbd3; }
      .kn-button:hover:not(:disabled) { box-shadow: inset 0 0 0 1.5px #f9772e; }
      .kn-button.kn-primary { background: #f9772e; color: #1c1c1e; font-weight: 700; box-shadow: none; }
      .kn-button.kn-primary:hover:not(:disabled) { box-shadow: none; filter: brightness(1.06); }
      .kn-button.kn-outline-accent { box-shadow: inset 0 0 0 1.5px #f9772e; }
      .kn-button:disabled, .kn-button.kn-primary:disabled { background: #d9dce3; color: #636366; box-shadow: none; cursor: not-allowed; filter: none; }
      .kn-ui button:focus-visible, .kn-ui a:focus-visible { outline: 2px solid #1c1c1e; outline-offset: 2px; }
      .kn-header button:focus-visible { outline-color: #fff; }
      .kn-button.kn-danger { background: transparent; color: #c62828; box-shadow: none; padding: 7px 4px; font-weight: 700; }
      .kn-button.kn-danger:hover:not(:disabled) { box-shadow: none; text-decoration: underline; }
      .kn-search, .kn-input, .kn-textarea, .kn-select { width: 100%; padding: 7px 10px; color: #1c1c1e; background: #fff; border: none; border-radius: 10px; box-shadow: inset 0 0 0 1px #d6d8de; font-size: 13px; }
      .kn-search:focus, .kn-input:focus, .kn-textarea:focus, .kn-select:focus { outline: none; box-shadow: inset 0 0 0 2px #f9772e; }
      .kn-search { margin-bottom: 10px; }
      .kn-search::placeholder, .kn-input::placeholder, .kn-textarea::placeholder { color: #6e6e73; }
      .kn-quick-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; margin-bottom: 7px; }
      .kn-quick { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 38px; padding: 8px 10px; border-radius: 10px; background: #fff; color: #1c1c1e; font-size: 13px; font-weight: 500; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-quick:hover { box-shadow: 0 0 0 1.5px #f9772e; }
      .kn-quick-key { flex: 0 0 auto; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: #ffe9dc; color: #b24a0d; font-weight: 700; font-size: 11px; }
      .kn-key { margin-left: 6px; opacity: 0.7; font: inherit; }
      .kn-categories { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 3px; }
      .kn-chip { flex: 0 0 auto; padding: 4px 10px; border-radius: 999px; color: #1c1c1e; background: #fff; font-size: 12px; font-weight: 600; box-shadow: inset 0 0 0 1px #d6d8de; }
      .kn-chip:hover:not(:disabled):not(.kn-active) { box-shadow: inset 0 0 0 1.5px #f9772e; }
      .kn-chip.kn-active { background: #f9772e; color: #1c1c1e; font-weight: 700; box-shadow: none; }
      .kn-results { display: flex; flex-direction: column; gap: 6px; }
      .kn-result { padding: 9px 11px; border-radius: 10px; background: #fff; color: #1c1c1e; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-result.kn-selected, .kn-result:hover { background: #fff3ea; box-shadow: 0 0 0 1.5px #f9772e; }
      .kn-result-label { display: block; font-size: 13.5px; font-weight: 600; }
      .kn-result-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; color: #6e6e73; font-size: 11.5px; }
      .kn-result-shortcut { display: inline-flex; padding: 1px 7px; border-radius: 6px; background: #ffe9dc; color: #b24a0d; font-weight: 700; }
      .kn-result-preview { display: -webkit-box; margin-top: 4px; color: #6e6e73; font-size: 11.5px; line-height: 1.35; white-space: normal; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .kn-alias { display: inline-block; margin: 4px 4px 0 0; padding: 1px 6px; border-radius: 999px; background: #f2f2f7; color: #636366; font-size: 11px; }
      .kn-browse-controls { position: sticky; top: -10px; z-index: 2; margin-top: -10px; padding-top: 10px; background: #f2f2f7; }
      .kn-muted { color: #6e6e73; font-size: 11.5px; }
      .kn-status { margin: 0 0 8px; color: #6e6e73; font-size: 11.5px; }
      .kn-status.kn-status-error { padding: 8px 10px; border-radius: 10px; background: #fde8e8; box-shadow: inset 0 0 0 1px #efb4b4; color: #8f1d1d; font-weight: 600; }
      .kn-status.kn-status-warn { padding: 8px 10px; border-radius: 10px; background: #fff8e6; box-shadow: inset 0 0 0 1px #f1d98a; color: #7a3d00; font-weight: 600; }
      .kn-attempt-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
      .kn-attempt { min-height: 48px; border-radius: 10px; background: #fff; color: #1c1c1e; font-size: 16px; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-attempt:hover { box-shadow: 0 0 0 1.5px #f9772e; }
      .kn-settings-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
      .kn-settings-actions .kn-grow { flex: 1 1 auto; }
      .kn-settings-actions .kn-danger { margin-left: auto; }
      .kn-signed b { color: #1c1c1e; }
      .kn-phrase-list { display: flex; flex-direction: column; border-radius: 10px; background: #fff; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-phrase-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: 1px solid #ececf1; }
      .kn-phrase-row:first-child { border-top: none; }
      .kn-phrase-row-text { flex: 1; min-width: 0; }
      .kn-phrase-row-title { font-size: 13px; font-weight: 600; }
      .kn-phrase-row .kn-result-preview { margin-top: 1px; }
      .kn-row-actions { flex: 0 0 auto; display: flex; gap: 10px; }
      .kn-row-actions .kn-button { padding: 2px 0; font-size: 12px; font-weight: 700; box-shadow: none; background: transparent; border-radius: 4px; color: #b24a0d; text-decoration: underline; }
      .kn-row-actions .kn-button.kn-danger { color: #c62828; text-decoration: none; }
      .kn-row-actions .kn-button:hover { box-shadow: none; text-decoration: underline; }
      .kn-field { display: block; margin-bottom: 10px; }
      .kn-field-label { display: block; margin-bottom: 4px; font-weight: 600; font-size: 12px; color: #4b5565; }
      .kn-textarea { min-height: 105px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .kn-check-row { display: flex; align-items: center; gap: 7px; margin: 8px 0; }
      .kn-ui input[type="checkbox"] { accent-color: #b24a0d; }
      .kn-form-actions { display: flex; gap: 7px; margin-top: 12px; }
      .kn-export { min-height: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .kn-browse-button { width: 100%; margin-bottom: 7px; }
      .kn-main-booking { padding: 10px 14px; font-size: 13.5px; }
      .kn-foot { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 2px 10px; padding: 7px 12px; background: #fff; border-top: 1px solid #e2e2e8; border-radius: 0 0 16px 16px; font-size: 11.5px; color: #6e6e73; }
      .kn-foot-links { display: inline-flex; gap: 10px; margin-left: auto; }
      .kn-bk-body { padding: 9px 10px; background: #f2f2f7; }
      .kn-bk-section { margin-bottom: 7px; background: #fff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; border-left: 3px solid transparent; }
      .kn-bk-section.kn-bk-open { border-left-color: #f9772e; }
      .kn-bk-head { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 11px 9px 8px; border: none; background: transparent; color: #1c1c1e; cursor: pointer; text-align: left; }
      .kn-bk-head-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .kn-bk-badge { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 11px; font-weight: 700; }
      .kn-bk-badge-done { background: #1f7a35; color: #fff; }
      .kn-bk-badge-needed { background: #ffe9dc; color: #b24a0d; }
      .kn-bk-open .kn-bk-badge-needed, .kn-bk-open .kn-bk-badge-optional { background: #f9772e; color: #1c1c1e; }
      .kn-bk-badge-optional { background: #ffe9dc; color: #b24a0d; }
      .kn-bk-optional { margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: #e9ebf0; color: #4b5565; font-size: 10.5px; font-weight: 700; vertical-align: 1px; }
      .kn-bk-prompt { margin-bottom: 9px; font-size: 13px; font-weight: 700; color: #b24a0d; }
      .kn-bk-needed { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 8px; padding: 1px 0; }
      .kn-bk-needed.kn-bk-ready { padding: 9px 10px; border-radius: 12px; background: #dff3e6; }
      .kn-bk-needed-title { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: #1c1c1e; margin-right: 2px; }
      .kn-bk-ready .kn-bk-needed-title { color: #1f7a35; }
      .kn-bk-needed-chip { border: none; cursor: pointer; padding: 3px 10px; border-radius: 999px; background: #ffe9dc; color: #b24a0d; font-size: 11.5px; font-weight: 700; }
      .kn-bk-needed-chip:hover { box-shadow: inset 0 0 0 1.5px #f9772e; }
      .kn-bk-head:hover { background: #fafafb; }
      .kn-bk-head-top { display: flex; align-items: center; justify-content: space-between; }
      .kn-bk-head-title { font-size: 13.5px; font-weight: 700; color: #1c1c1e; }
      .kn-bk-chevron { flex: 0 0 auto; display: inline-flex; color: #6e6e73; }
      .kn-bk-head-summary { margin-top: 1px; font-size: 12px; font-weight: 400; color: #6e6e73; line-height: 1.35; }
      .kn-bk-head-summary.kn-bk-missing { color: #6e6e73; }
      .kn-bk-content { padding: 0 11px 10px 8px; }
      .kn-bk-group { margin: 4px 0 6px; font-size: 12px; font-weight: 700; color: #4b5565; }
      .kn-bk-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
      .kn-bk-chips .kn-chip { max-width: 100%; white-space: normal; text-align: left; padding: 4px 10px; font-size: 12px; }
      .kn-bk-chips .kn-chip:disabled { opacity: 0.4; cursor: default; }
      .kn-bk-sub .kn-chip { font-size: 11.5px; padding: 3px 9px; }
      .kn-bk-field { display: block; flex: 1 1 0; min-width: 0; margin-bottom: 7px; }
      .kn-bk-label { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; font-size: 12px; font-weight: 600; color: #4b5565; }
      .kn-bk-tag { padding: 1px 6px; border-radius: 6px; background: #dff3e6; color: #1f7a35; font-size: 10.5px; font-weight: 700; }
      .kn-bk-field .kn-input { padding: 6px 10px; font-size: 13px; }
      .kn-bk-notes { min-height: 90px; resize: vertical; font-family: inherit; }
      .kn-bk-row { display: flex; gap: 8px; }
      .kn-bk-small { flex: 1 1 0; }
      .kn-bk-narrow { flex: 0 0 96px; }
      .kn-bk-days { display: flex; gap: 5px; overflow-x: auto; padding: 1px 1px 6px; margin-bottom: 6px; }
      .kn-bk-day { display: flex !important; flex-direction: column; align-items: center; min-width: 42px; padding: 5px 6px !important; border-radius: 10px !important; }
      .kn-bk-day:disabled { opacity: 0.35; cursor: default; }
      .kn-bk-day-name { font-size: 10.5px; font-weight: 600; }
      .kn-bk-day-num { font-size: 14px; font-weight: 700; }
      .kn-bk-readout { margin: 2px 0 8px; color: #6e6e73; font-size: 12px; font-weight: 600; }
      /* A date that cannot be booked yet: a light red notice in place of the plain line. */
      .kn-bk-readout.kn-bk-error { padding: 9px 10px; border-radius: 12px; background: #fde8e8; box-shadow: inset 0 0 0 1px #efb4b4; color: #8f1d1d; font-size: 12.5px; }
      .kn-bk-confirm-year { display: block; margin-top: 7px; padding: 5px 12px; font-size: 12px; }
      .kn-bk-times { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 8px; }
      .kn-bk-times .kn-chip { padding: 5px 0; font-size: 12px; text-align: center; }
      .kn-bk-card { margin-bottom: 8px; padding: 10px; border-radius: 10px; background: #f7f7f9; box-shadow: inset 0 0 0 1px #e5e5ea; }
      .kn-bk-card-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12.5px; font-weight: 700; color: #1c1c1e; }
      .kn-bk-remove { border: none; background: none; color: #c62828; font-size: 11.5px; font-weight: 700; cursor: pointer; }
      .kn-bk-add { width: 100%; margin-bottom: 8px; font-size: 12.5px; }
      .kn-bk-gap { margin-bottom: 8px; }
      .kn-bk-error { color: #c62828; font-size: 12px; font-weight: 600; }
      .kn-bk-warn { color: #8a4b00; font-size: 12px; }
      .kn-bk-notice { margin-bottom: 8px; padding: 9px 10px; border-radius: 12px; background: #fff8e6; box-shadow: inset 0 0 0 1px #f1d98a; color: #7a3d00; }
      .kn-bk-notice-text { font-size: 12.5px; margin-bottom: 7px; }
      .kn-bk-notice-text b { color: #5c2c00; }
      .kn-bk-notice-actions { display: flex; gap: 6px; }
      .kn-bk-notice-actions .kn-button { padding: 5px 11px; font-size: 12px; }
      .kn-bk-other-px .kn-bk-notice-actions { flex-wrap: wrap; }
      .kn-bk-footer { flex: 0 0 auto; padding: 0 10px 9px; background: #f2f2f7; }
      .kn-bk-preview-card { margin-bottom: 8px; padding: 9px 10px; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .kn-bk-preview-label { margin-bottom: 5px; font-size: 11.5px; font-weight: 700; color: #4b5565; }
      .kn-bk-preview { max-height: 96px; margin: 0; padding: 8px; overflow: auto; border-radius: 8px; background: #f2f2f7; color: #1c1c1e; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
      /* With no lead nothing can be inserted yet, so on a short screen the preview gives its room to the Customer step. */
      @media (max-height: 960px) { .kn-bk-inbound .kn-bk-preview { max-height: 60px; } }
      .kn-bk-issues:empty { display: none; }
      .kn-bk-issues { margin-bottom: 8px; }
      .kn-bk-issue-box { padding: 9px 10px; border-radius: 12px; background: #fde8e8; box-shadow: inset 0 0 0 1px #efb4b4; color: #8f1d1d; }
      .kn-bk-issue-box + .kn-bk-issue-box { margin-top: 6px; }
      .kn-bk-issue-box.kn-bk-issue-warn { background: #fff8e6; box-shadow: inset 0 0 0 1px #f1d98a; color: #7a3d00; }
      .kn-bk-issue-title { margin-bottom: 4px; font-size: 12.5px; font-weight: 700; }
      .kn-bk-issue-box .kn-bk-error, .kn-bk-issue-box .kn-bk-warn { display: flex; align-items: flex-start; gap: 7px; padding: 1px 0; color: inherit; font-size: 12.5px; font-weight: 400; }
      .kn-bk-issue-box svg { margin-top: 2px; }
      .kn-bk-status { margin-bottom: 7px; font-size: 12px; font-weight: 600; }
      .kn-bk-status-ok { color: #1f7a35; }
      .kn-bk-status-warn { color: #8a4b00; }
      .kn-bk-status-error { color: #c62828; }
      /* The main action has a row to itself; the others sit under it and wrap as whole buttons when narrow. */
      .kn-bk-actions { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
      .kn-bk-actions .kn-button { white-space: nowrap; }
      .kn-bk-actions .kn-primary { flex: 1 0 100%; padding: 10px 14px; font-size: 13.5px; font-weight: 700; }
      .kn-bk-actions .kn-bk-small { flex: 0 1 auto; padding: 6px 12px; font-size: 12.5px; }
      .kn-bk-actions .kn-danger { margin-left: auto; padding: 6px 0; }
      /* Used only when Konnect's Phone column cannot be found. */
      .kn-inbound-launcher { position: fixed; left: 20px; bottom: 20px; z-index: 2147482999; padding: 10px 16px; border: none; border-radius: 999px; background: #1e1d49; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: none; }
      .kn-inbound-launcher:hover, .kn-inbound-launcher.kn-launcher-open { box-shadow: inset 0 0 0 2px #f9772e; }
      .kn-phone-launcher { display: block; background: #1e1d49 !important; color: #fff !important; border: none !important; box-shadow: none !important; font-size: 18px; font-weight: 900; line-height: 1; cursor: pointer; }
      .kn-phone-launcher:hover { background: #f9772e !important; color: #1c1c1e !important; }
      .kn-phone-launcher.kn-launcher-open { box-shadow: inset 0 0 0 2px #f9772e !important; }
      .kn-bk-search-row { align-items: flex-end; }
      .kn-bk-search-button { flex: 0 0 auto; margin-bottom: 7px; padding: 7px 14px; }
      .kn-bk-report { border: none; background: none; padding: 0; color: #b24a0d; font-size: 11.5px; font-weight: 600; text-decoration: none; cursor: pointer; }
      .kn-bk-report:hover { text-decoration: underline; }
      .kn-update { margin: 0 0 8px; padding: 9px 10px; border-radius: 12px; background: #e8f0fe; color: #1c1c1e; font-size: 12px; font-weight: 600; }
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

  const ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    tick: '<path d="M20 6L9 17l-5-5"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    up: '<path d="M18 15l-6-6-6 6"/>'
  };

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  /* A header button: a symbol with its name beside it. */
  function headerButton(iconName, label, title, onClick) {
    const node = element('button', 'kn-icon-button');
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    node.appendChild(icon(iconName));
    node.appendChild(element('span', 'kn-icon-label', label));
    node.addEventListener('click', onClick);
    return node;
  }

  /* The strip under a panel: a note on the left, links on the right. */
  function footLink(text, title, onClick) {
    const link = element('button', 'kn-bk-report', text);
    link.type = 'button';
    if (title) link.title = title;
    link.addEventListener('click', (event) => { event.preventDefault(); onClick(); });
    return link;
  }

  /* The launcher shows an orange ring inside its edge while its panel is
     open. Only a change is written, as the page observer sees each write. */
  function markLaunchers() {
    const mark = (node, on) => { if (node && node.classList.contains('kn-launcher-open') !== on) node.classList.toggle('kn-launcher-open', on); };
    mark(state.launcherButton, state.open && !(state.view === 'booking' && inboundContext()));
    mark(document.getElementById(INBOUND_LAUNCHER_ID), state.open && state.view === 'booking' && inboundContext());
  }

  function ensurePalette() {
    if (state.palette && state.palette.isConnected) return state.palette;
    const palette = element('div', 'kn-ui');
    palette.id = PALETTE_ID;
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', 'Konnect Notes');
    palette.tabIndex = -1;
    document.body.appendChild(palette);
    state.palette = palette;
    return palette;
  }

  function positionPalette() {
    if (state.palette && state.view === 'booking' && inboundContext()) {
      /* No lead screen yet: dock bottom left and grow upwards, clear of the
         Phone column on the right. */
      const anchor = phoneColumnAnchor();
      const rightEdge = anchor ? Math.round(anchor.getBoundingClientRect().left) - 12 : window.innerWidth - 16;
      const width = Math.max(280, Math.min(400, rightEdge - 16));
      state.palette.style.left = '16px';
      state.palette.style.top = 'auto';
      state.palette.style.bottom = '16px';
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
      const preferredWidth = 300;
      left = Math.max(8, Math.min(Math.round(railRect.left) - 18, safeRight - preferredWidth));
      width = Math.max(120, Math.min(preferredWidth, safeRight - left));
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
    state.palette.style.bottom = '';
  }

  function renderHeader(title, backAction, showSettings) {
    const header = element('div', 'kn-header');
    if (backAction) header.appendChild(headerButton('back', 'Back', 'Back', backAction));
    header.appendChild(element('div', 'kn-title', title));
    if (showSettings) {
      header.appendChild(headerButton('settings', 'Settings', 'Phrase settings', () => {
        state.view = 'settings';
        state.statusMessage = '';
        renderPalette();
      }));
    }
    header.appendChild(headerButton('close', 'Close', 'Close', closePalette));
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
    let foot = null;
    renderUpdateNotice(body);
    if (ownerTools()) {
      const booking = button('Booking', 'kn-primary kn-browse-button kn-main-booking', openBooking);
      booking.appendChild(element('span', 'kn-key', 'B'));
      body.appendChild(booking);
    }
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
      const browse = button('Search all phrases', 'kn-browse-button', () => {
        state.view = 'browse';
        state.selectedResult = 0;
        renderPalette();
      });
      body.appendChild(browse);
      foot = element('div', 'kn-foot');
      foot.appendChild(element('span', '', 'Keys 1 to 5 pick a quick phrase'));
      const links = element('span', 'kn-foot-links');
      links.appendChild(footLink('Report a problem', '', reportProblem));
      foot.appendChild(links);
    } else {
      if (state.configStatus) body.appendChild(element('div', 'kn-status', state.configStatus));
      body.appendChild(element('div', 'kn-muted', 'Phrases have not loaded yet.'));
    }

    palette.appendChild(body);
    if (foot) palette.appendChild(foot);
  }

  function renderBrowse() {
    const palette = ensurePalette();
    palette.appendChild(renderHeader('Search all phrases', () => {
      state.view = 'main';
      renderPalette();
    }, false));
    const body = element('div', 'kn-body');
    if (state.statusMessage) body.appendChild(element('div', 'kn-status kn-status-warn', state.statusMessage));
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
      body.appendChild(element('div', 'kn-muted', 'Phrases have not loaded yet.'));
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
    const nameRow = element('div', 'kn-settings-actions');
    const signed = element('span', 'kn-muted kn-grow kn-signed', 'Notes are signed as: ');
    signed.appendChild(element('b', '', getAgentName() || 'not set'));
    nameRow.appendChild(signed);
    body.appendChild(nameRow);

    const actions = element('div', 'kn-settings-actions');
    const lastRow = element('div', 'kn-settings-actions');
    nameRow.appendChild(button('Change name', '', () => {
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
    lastRow.appendChild(button('Reset to standard phrases', '', async () => {
      if (!confirm('Remove your own phrase changes on this computer and go back to the standard phrases?')) return;
      state.configStatus = 'Loading the standard phrases...';
      renderPalette();
      const remote = await refreshRemoteConfig({ force: true });
      state.statusMessage = remote ? 'Standard phrases are back in use.' : 'The standard phrases could not be loaded.';
      renderPalette();
    }));
    const stop = button('Stop Konnect Notes', 'kn-danger', () => stopKonnectNotes());
    stop.title = `Stops Konnect Notes without refreshing the page. Click the bookmark again to load the latest version.${ownerTools() ? ' Booking drafts are kept.' : ''}`;
    lastRow.appendChild(stop);
    body.appendChild(actions);
    body.appendChild(lastRow);

    const list = element('div', 'kn-phrase-list');
    (state.config?.phrases || []).forEach((phrase) => {
      const row = element('div', 'kn-phrase-row');
      const text = element('div', 'kn-phrase-row-text');
      text.appendChild(element('div', 'kn-phrase-row-title', phrase.label));
      text.appendChild(element('div', 'kn-result-preview', `${getCategoryLabel(phrase.category)} · ${phrasePreview(phrase)}`));
      row.appendChild(text);
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
        state.configStatus = OWN_PHRASES_STATUS;
        writeStored();
        renderPalette();
      }));
      row.appendChild(rowActions);
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
      state.configStatus = OWN_PHRASES_STATUS;
      writeStored();
      state.statusMessage = 'Phrase saved on this computer.';
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
    body.appendChild(element('div', 'kn-muted', 'For whoever looks after the standard phrases: this is the full phrase list, ready to copy into Konnect-Notes-Phrases.json.'));
    const output = element('textarea', 'kn-textarea kn-export');
    output.readOnly = true;
    output.value = JSON.stringify(state.config, null, 2);
    body.appendChild(output);
    const status = element('div', 'kn-status', 'Local customer or lead data is never included.');
    body.appendChild(status);
    body.appendChild(button('Copy phrase list', 'kn-primary', () => copyText(output.value, status)));
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
    input.placeholder = 'Paste an exported Konnect Notes phrase list';
    body.appendChild(input);
    const status = element('div', 'kn-status', 'Imported phrases are saved on this computer only.');
    body.appendChild(status);
    body.appendChild(button('Import phrase list', 'kn-primary', () => {
      try {
        const parsed = JSON.parse(input.value);
        setWorkingConfig(parsed, true, 'Imported phrases are in use on this computer only.');
        state.statusMessage = 'Phrase list imported.';
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
  /* One shift, the same rule the other tools use for customer data. */
  const BOOKING_DRAFT_MAX_AGE = 12 * 60 * 60 * 1000;
  /* Shared with SLA Manager, which checks each booking on Konnect Live. */
  const BOOKING_CHECKS_KEY = '_workToolsBookingChecks';

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
      year: '',
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

  function shortHash(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  }

  /* Text beside a "Name" label at the top of the page, for telling one
     customer from the next. */
  function findTopName() {
    const label = Array.from(document.querySelectorAll('b,strong,label,th'))
      .find((node) => isVisible(node) && !node.closest(`#${PALETTE_ID}`) && /^(customer )?name:?$/i.test(ownText(node)));
    if (!label) return '';
    const row = label.closest('.row') || label.parentElement;
    return normaliseText((row?.textContent || '').replace(label.textContent, '')).slice(0, 80);
  }

  /* A draft belongs to one lead. Tab ids such as "salesTab-1" come round
     again for the next customer, so the key is the lead's own ID where the
     page gives it, and otherwise the tab plus a fingerprint of the customer
     shown (never the name itself, as the key is stored). */
  let leadKeyCache = null;
  function leadKey() {
    if (!state.target && (inboundScreen() || inbound.pending)) return INBOUND_KEY;
    const activity = leadScopeActivity(state.target);
    if (activity && activity.ID != null) return `lead-${activity.ID}`;
    if (leadKeyCache && leadKeyCache.target === state.target && Date.now() - leadKeyCache.at < 2000) return leadKeyCache.key;
    const pane = activeLeadPane();
    const tabs = pane?.closest('.tab-content')?.parentElement;
    const active = tabs?.querySelector('li.active[id^="salesTab-"]') ||
      document.querySelector('li.active[id^="salesTab-"]');
    const who = normaliseText(`${findTopName()} ${findTopEmail()}`).toLowerCase();
    const key = `${active?.id || 'lead'}${who ? `:${shortHash(who)}` : ''}`;
    leadKeyCache = { target: state.target, key, at: Date.now() };
    return key;
  }

  function currentDraft() {
    const draft = draftForLead();
    if (draft.key !== INBOUND_KEY && draft.key === inbound.callLead && !draft.fromInbound) {
      draft.fromInbound = true;
      inbound.callLead = '';
    }
    return draft;
  }

  function draftForLead() {
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
      diaryBooked: stored.diaryBooked || null,
      leadRequestUsed: !!stored.leadRequestUsed,
      typedUsed: Array.isArray(stored.typedUsed) ? stored.typedUsed : [],
      typedIgnored: stored.typedIgnored || '',
      fromInbound: !!stored.fromInbound,
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
      diaryBooked: draft.diaryBooked || null,
      leadRequestUsed: !!draft.leadRequestUsed,
      typedUsed: draft.typedUsed || [],
      typedIgnored: draft.typedIgnored || '',
      fromInbound: !!draft.fromInbound,
      openSection: draft.openSection,
      updated: draft.updated
    };
    writeDrafts(drafts);
  }

  /* ---------- reading the lead (Vehicle of Interest / Part Exchange) ---------- */

  function leadPanel(pane, headingText) {
    if (!pane) return null;
    const heading = Array.from((pane.querySelector('a.accordion-toggle') ? pane : document).querySelectorAll('.sales-lead-accordion-heading, .panel-heading'))
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

  const PX_BOXES = {
    'px.make': 'Vehicle Brand',
    'px.model': 'Vehicle Model',
    'px.reg': 'Reg Number',
    'px.mileage': 'Mileage',
    'px.roughVal': 'Valuation'
  };

  function readPxBoxes(panel) {
    const fields = {};
    Object.entries(PX_BOXES).forEach(([path, placeholder]) => { fields[path] = inputByPlaceholder(panel, placeholder); });
    return fields;
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
      /* Fuel only describes a car the lead actually names, and only when there is no reg. */
      const named = fields['v.make'] || fields['v.model'];
      fields['v.descriptor'] = named && !fields['v.reg'] ? inputByPlaceholder(voi, 'Fuel Type') : '';
      const purchase = selectedText(voi.querySelector('select')).toLowerCase();
      if (purchase === 'motability') fields.type = 'motability';
      else if (purchase === 'new' || purchase === 'used' || purchase === 'pre-registered') fields['v.condition'] = purchase;
    }
    const pxOn = px ? pxSwitchOn(px) : null;
    const pxFields = px ? readPxBoxes(px) : {};
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

  /* The lead's Lead Request picks the appointment type once, on a booking
     with no type yet. It is tagged "from lead", and clicking any other type
     replaces it as normal. */
  function leadRequestType(text) {
    const t = String(text || '').toLowerCase();
    if (!t || /^\(?select/.test(t)) return '';
    if (/motability/.test(t)) return 'motability';
    if (/test ?drive/.test(t)) return 'testdrive';
    if (/video|call ?back|phone call/.test(t)) return 'call';
    return '';
  }

  function preselectFromLeadRequest(draft) {
    if (draft.data.type || draft.leadRequestUsed) return false;
    const type = leadRequestType(draft.leadHints?.leadRequest);
    if (!type) return false;
    draft.leadRequestUsed = true;
    draft.data.type = type;
    draft.data.subtype = BOOKING_SUBTYPE_DEFAULT[type] || '';
    draft.fromLead.type = true;
    if (!draft.openSection || draft.openSection === 'type') draft.openSection = nextMissingSection(draft);
    logActivity(`Type ${type} picked from the Lead Request`);
    return true;
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

    // The lead often repeats the brand in the model box ("Abarth" and
    // "Abarth 500e"), so the model is taken without it.
    const withoutBrand = (fields, makePath, modelPath) => {
      const engine = bookingEngine();
      if (!engine || !fields[makePath] || !fields[modelPath]) return;
      const split = engine.splitMakeModel(fields[makePath], fields[modelPath]);
      if (split.model) fields[modelPath] = split.model;
    };
    withoutBrand(lead.fields, 'v.make', 'v.model');
    withoutBrand(lead.pxFields, 'px.make', 'px.model');

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
    if (preselectFromLeadRequest(draft)) changed = true;
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
    /* A date that is only far ahead has not passed. */
    return Boolean(date.error) && !(date.needsYear && !date.passed);
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
      d.year = request.year ? String(request.year) : '';
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
      date: { day: d.day, month: d.month, year: d.year },
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

  function insertBooking(draft, options) {
    const keepOpen = !!(options && options.keepOpen);
    const target = draft.key === INBOUND_KEY ? null : callNotesBox();
    const result = buildCurrentBooking(draft);
    if (!(target instanceof HTMLTextAreaElement)) {
      state.bookingStatus = { kind: 'warn', text: 'Create the lead first. This booking moves onto it when its Call Notes box appears.' };
      renderPalette();
      return false;
    }
    if (!result) return false;
    if (result.errors.length) {
      state.bookingStatus = { kind: 'error', text: 'Fix the items in red first.' };
      renderPalette();
      return false;
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
    let nextValue = value.slice(0, start) + replacement + value.slice(end);
    const moved = withoutTypedLines(nextValue, draft.typedUsed, text);
    if (moved !== nextValue) {
      // The typed lines now live in the booking, so the originals go and the
      // whole box is replaced in one edit (Ctrl+Z still undoes it).
      nextValue = moved;
      start = 0;
      end = value.length;
      replacement = nextValue;
    }
    replaceTextUndoably(target, start, end, replacement, nextValue);
    draft.inserted = text;
    draft.typedUsed = [];
    saveDraftNow();
    writeBookingToLead(draft).then((updated) => {
      if (updated.length) showToast(`Lead updated: ${updated.join(', ')}`);
    });
    if (note) {
      state.bookingStatus = { kind: 'warn', text: note };
      renderPalette();
      return true;
    }
    state.bookingStatus = null;
    if (!keepOpen) closePalette();
    return true;
  }

  /* ---------- notes typed straight into Call Notes ----------
     Lines the agent typed during the call are offered to the booking's notes,
     where the engine tidies them. Attempt lines ("2 - VM left -- Omari"),
     earlier booking blocks and lines with an agent signature are left out. */
  function typedLines(draft) {
    const target = callNotesBox();
    if (!(target instanceof HTMLTextAreaElement)) return [];
    let value = target.value;
    if (draft.inserted && value.includes(draft.inserted)) value = value.replace(draft.inserted, '');
    const existing = String(draft.data.notesText || '').toLowerCase();
    return value.split('\n').map((line) => line.trim()).filter((line) => line &&
      !/^\d+\s*-\s/.test(line) && !/\s--\s/.test(line) &&
      !/priority acceptance|booked in on|confirm provisional|calendar event for an appointment|^(PX|Vehicle):/i.test(line) &&
      !existing.includes(line.replace(/^-+\s*/, '').toLowerCase()));
  }

  function offerTypedNotes(draft) {
    if (draft.key === INBOUND_KEY) { state.typedOffer = null; return; }
    const lines = typedLines(draft);
    const signature = lines.join('\n');
    state.typedOffer = lines.length && draft.typedIgnored !== signature ? { lines, signature } : null;
  }

  function useTypedNotes(draft, use) {
    const offer = state.typedOffer;
    state.typedOffer = null;
    if (!offer) return;
    if (!use) {
      draft.typedIgnored = offer.signature;
    } else {
      const d = draft.data;
      d.notesText = [String(d.notesText || '').trim(), ...offer.lines].filter(Boolean).join('\n');
      draft.typedUsed = offer.lines;
      logActivity(`Moved ${offer.lines.length} typed line(s) into the booking notes`);
      changed(draft, true);
    }
    saveDraftNow();
    renderPalette();
  }

  /* Removes each moved line once, outside the new booking block. */
  function withoutTypedLines(value, lines, block) {
    if (!lines || !lines.length) return value;
    const at = value.indexOf(block);
    const before = at >= 0 ? value.slice(0, at) : value;
    const after = at >= 0 ? value.slice(at) : '';
    const kept = before.split('\n');
    lines.forEach((line) => {
      const index = kept.findIndex((item) => item.trim() === line);
      if (index >= 0) kept.splice(index, 1);
    });
    const head = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    return head && after && !head.endsWith('\n') ? `${head}\n${after}` : head + after;
  }

  /* The main button: notes into Call Notes, then the diary and outcome.
     A booking already in the diary at the same day, time and type is not
     booked again, so pressing it after an edit only updates the notes. */
  async function insertAndBook(draft) {
    const plan = diaryPlan(draft);
    if (!plan || diaryAlreadyBooked(draft, plan)) {
      if (insertBooking(draft)) offerSheetRow(draft);
      return;
    }
    if (!insertBooking(draft, { keepOpen: true })) return;
    const booked = await bookInDiary(draft);
    offerSheetRow(draft);
    if (booked) closePalette();
  }

  /* ---------- owner only: a row for the booking sheet ---------- */

  function sheetDealer(dealer) {
    const text = normaliseText(dealer).toLowerCase();
    if (!text) return '';
    // Longest first, so "Sale" is never taken from a longer name.
    return SHEET_DEALERS.slice().sort((a, b) => b.length - a.length)
      .find((name) => new RegExp(`(^|[^a-z])${name.toLowerCase()}([^a-z]|$)`).test(text)) || '';
  }

  /* Motability wins whatever the car. Then the lead's own purchase type,
     which beats a registration (a new car can have one). Then the car in the
     booking, then the campaign wording. Pre-registered counts as New. */
  function sheetLeadType(facts) {
    const campaign = normaliseText(facts.campaign).toLowerCase();
    const purchase = normaliseText(facts.purchaseType).toLowerCase();
    const condition = normaliseText(facts.condition).toLowerCase();
    if (facts.motability || purchase === 'motability' || /motability/.test(campaign)) return 'Motability';
    if (purchase === 'used') return 'Used';
    if (purchase === 'new' || purchase === 'pre-registered') return 'New';
    if (facts.hasReg || condition === 'used') return 'Used';
    if (condition === 'new' || condition === 'pre-registered') return 'New';
    if (/\bused\b/.test(campaign)) return 'Used';
    if (/\bnew\b/.test(campaign)) return 'New';
    return '';
  }

  function blockedDiaryDealer(dealer) {
    const found = NO_BOOKING_DEALERS.find((item) => item.match.test(normaliseText(dealer)));
    return found ? `${found.name} ${found.why}. Change the lead's dealer first.` : '';
  }

  /* Pure. One tab separated line for the booking sheet: Dealer, Customer
     Full Name (no title), Date of Appt, Type of Appointment, Source, Lead
     Type, Checked on kL (always empty, it is checked by hand later), Gone
     into Diary. */
  function buildSheetRow(facts) {
    const f = facts || {};
    const day = Number(f.day);
    const month = MONTHS_LONG[Number(f.month) - 1];
    const year = Number(f.year);
    const date = day >= 1 && day <= 31 && month && year > 999 ? `${day} ${month} ${year}` : '';
    const type = { 'face to face': 'Face to Face', 'test drive': 'Test Drive', 'phone call': 'Phone Call' }[normaliseText(f.diaryType).toLowerCase()] || '';
    return [
      sheetDealer(f.dealer),
      normaliseText(f.name).replace(NAME_TITLES, ''),
      date,
      type,
      f.inbound ? 'Inbound Call' : 'Outbound lead',
      sheetLeadType(f),
      '',
      f.inDiary ? 'Y' : 'N'
    ].join('\t');
  }

  function sheetFactsFor(draft) {
    const engine = bookingEngine();
    if (!engine) return null;
    const input = bookingInput(draft);
    const date = engine.resolveDate(input.date, new Date());
    const plan = diaryPlan(draft);
    const lead = readLead();
    const vehicle = input.vehicles[0] || {};
    return {
      dealer: leadDealer() || (draft.fromInbound ? inbound.dealer : ''),
      // The page's Name row is not always found; the lead holds the name too.
      name: findTopName() || normaliseText((leadScopeActivity(state.target) || {}).SalesLead?.CustomerName || ''),
      year: date.error ? '' : date.year,
      month: date.error ? '' : date.month,
      day: date.error ? '' : date.day,
      diaryType: input.type ? diaryType(input) : '',
      inbound: !!draft.fromInbound,
      motability: input.type === 'motability' || lead.fields.type === 'motability',
      hasReg: !!realText(vehicle.reg),
      condition: vehicle.condition,
      purchaseType: lead.fields['v.condition'],
      campaign: `${lead.leadRequest} ${lead.source}`,
      inDiary: diaryAlreadyBooked(draft, plan)
    };
  }

  /* Copying is always the owner's own click, as the clipboard may hold
     something they still need. The row itself is never logged or shown.
     The facts are read now, while this lead is still the one on the page;
     only the Source can be switched before copying, as the tool cannot
     always know a call came in. */
  function offerSheetRow(draft) {
    if (!ownerTools() || !draft || !draft.inserted || draft.key === INBOUND_KEY) return;
    const facts = sheetFactsFor(draft);
    if (!facts) return;
    document.getElementById(SHEET_TOAST_ID)?.remove();
    const toast = document.createElement('div');
    toast.id = SHEET_TOAST_ID;
    toast.setAttribute('role', 'status');
    toast.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:12px;background:#1c1c1e;color:#fff;' +
      'font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.3)';
    const buttonCss = 'border:0;border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer;';
    const source = document.createElement('button');
    source.type = 'button';
    source.setAttribute('role', 'switch');
    source.title = 'Switch the Source cell between Inbound Call and Outbound lead';
    source.style.cssText = `${buttonCss}background:#3a3a3c;color:#fff;font-weight:500`;
    const showSource = () => {
      source.textContent = `Source: ${facts.inbound ? 'Inbound Call' : 'Outbound lead'}`;
      source.setAttribute('aria-checked', String(!!facts.inbound));
    };
    showSource();
    source.addEventListener('click', () => {
      facts.inbound = !facts.inbound;
      draft.fromInbound = facts.inbound;
      if (state.booking === draft) saveDraftNow();
      showSource();
    });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy booking sheet row';
    copy.style.cssText = `${buttonCss}background:#fff;color:#1c1c1e`;
    copy.addEventListener('click', async () => {
      const copied = await copyText(buildSheetRow(facts));
      copy.textContent = copied ? 'Copied' : 'Copy was blocked';
      if (copied) setTimeout(() => toast.remove(), 1500);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.style.cssText = `${buttonCss}background:transparent;color:#fff;font-weight:500`;
    dismiss.addEventListener('click', () => toast.remove());
    toast.appendChild(source);
    toast.appendChild(copy);
    toast.appendChild(dismiss);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2 * 60 * 1000);
  }

  function sheetRowSelfTest() {
    const failures = [];
    const check = (name, got, want) => { if (got !== want) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    const base = { dealer: 'Stellantis &You Preston', name: 'Jo Example', year: 2026, month: 11, day: 14, diaryType: 'Face To Face', condition: 'used', inDiary: true };
    check('outbound used row', buildSheetRow(base), 'Preston\tJo Example\t14 November 2026\tFace to Face\tOutbound lead\tUsed\t\tY');
    check('inbound, not in the diary', buildSheetRow({ ...base, inbound: true, inDiary: false, diaryType: 'Test Drive', condition: 'new', day: '05', month: '01', year: 2027 }),
      'Preston\tJo Example\t5 January 2027\tTest Drive\tInbound Call\tNew\t\tN');
    check('always eight cells', buildSheetRow({}).split('\t').length, 8);
    check('nothing known', buildSheetRow({}), '\t\t\t\tOutbound lead\t\t\tN');
    check('a tab in a name cannot add a cell', buildSheetRow({ ...base, name: 'Jo\tExample\n' }).split('\t').length, 8);
    check('phone call', buildSheetRow({ ...base, diaryType: 'Phone Call' }).split('\t')[3], 'Phone Call');
    check('unknown appointment type', buildSheetRow({ ...base, diaryType: 'Video' }).split('\t')[3], '');
    check('dealer by short name', sheetDealer('Birmingham North'), 'Birmingham North');
    check('dealer with a brand after it', sheetDealer('Stellantis &You West London Peugeot'), 'West London');
    check('Sale', sheetDealer('Stellantis &You Sale'), 'Sale');
    check('General Sales is not Sale', sheetDealer('Stellantis &You General Sales'), '');
    check('National is not on the sheet', sheetDealer('National'), '');
    check('no dealer', sheetDealer(''), '');
    check('Motability wins', sheetLeadType({ motability: true, condition: 'used' }), 'Motability');
    check('Motability from the lead', sheetLeadType({ purchaseType: 'Motability', condition: 'new' }), 'Motability');
    check('Motability from the campaign', sheetLeadType({ campaign: 'Motability Enquiry' }), 'Motability');
    check('Motability whatever the car', sheetLeadType({ purchaseType: 'Motability', hasReg: true, condition: 'used' }), 'Motability');
    check('the lead beats a registration', sheetLeadType({ hasReg: true, purchaseType: 'New' }), 'New');
    check('the lead beats the booking', sheetLeadType({ condition: 'new', purchaseType: 'used' }), 'Used');
    check('a reg means used when the lead does not say', sheetLeadType({ hasReg: true, condition: 'new' }), 'Used');
    check('the booking when the lead does not say', sheetLeadType({ condition: 'new' }), 'New');
    check('Checked on kL is empty', buildSheetRow(base).split('\t')[6], '');
    check('title taken off', buildSheetRow({ ...base, name: 'Mr Jo Example' }).split('\t')[1], 'Jo Example');
    check('title with a full stop, any case', buildSheetRow({ ...base, name: 'DR. Jo Example' }).split('\t')[1], 'Jo Example');
    check('two titles', buildSheetRow({ ...base, name: 'Prof Sir Jo Example' }).split('\t')[1], 'Jo Example');
    check('each title', ['Mrs', 'Miss', 'Ms', 'Mx', 'Lady', 'Rev'].map((t) => buildSheetRow({ ...base, name: `${t} Jo Example` }).split('\t')[1]).join(), Array(6).fill('Jo Example').join());
    check('a name that starts like a title', buildSheetRow({ ...base, name: 'Drew Missen' }).split('\t')[1], 'Drew Missen');
    check('a title alone is kept', buildSheetRow({ ...base, name: 'Mr' }).split('\t')[1], 'Mr');
    check('pre-registered counts as New', sheetLeadType({ purchaseType: 'Pre-Registered' }), 'New');
    check('campaign wording last', sheetLeadType({ campaign: 'Used Car Enquiry Website' }), 'Used');
    check('cannot be told', sheetLeadType({ campaign: 'Website' }), '');
    check('vm is message left', CALL_OUTCOME_FOR_PHRASE['vm-left'], 'No Answer Message Left');
    check('cnr is no message left', CALL_OUTCOME_FOR_PHRASE['could-not-reach'], 'No Answer No Message Left');
    check('line failed, email only is no message left', CALL_OUTCOME_FOR_PHRASE['line-failed-email-only'], 'No Answer No Message Left');
    check('email only sets nothing', CALL_OUTCOME_FOR_PHRASE['email-only-lead-short'], undefined);
    check('no call made is never set', Object.values(CALL_OUTCOME_FOR_PHRASE).some((v) => /no call made/i.test(v)), false);
    check('same letters', outcomeKey('No Answer - Message Left'), outcomeKey(MESSAGE_LEFT));
    check('eo sets the Email Only lead outcome', (LEAD_OUTCOME_FOR_PHRASE['email-only-lead-short'] || []).join(' > '), 'Customer Hub Team > Ongoing > Email Only Lead');
    check('lfe and the full note set it too', [LEAD_OUTCOME_FOR_PHRASE['line-failed-email-only'], LEAD_OUTCOME_FOR_PHRASE['email-only-full']].every((path) => path === EMAIL_ONLY_OUTCOME), true);
    check('a voicemail note sets no lead outcome', LEAD_OUTCOME_FOR_PHRASE['vm-left'], undefined);
    check('no call made only for notes with a lead outcome and no call', NO_CALL_PHRASES.every((id) => LEAD_OUTCOME_FOR_PHRASE[id] && !CALL_OUTCOME_FOR_PHRASE[id]), true);
    return failures;
  }

  /* ---------- owner only: noting a booking for the Konnect Live check ---------- */

  /* Pure. One entry for the shared list, from the facts the sheet row is
     built from. bookingKey (the lead with the day, time and type) only tells
     a repeat of the same booking from a new one; it holds no customer data. */
  function buildBookingCheck(facts, contact, bookingKey, now, suffix) {
    const row = buildSheetRow(facts);
    const cells = row.split('\t');
    const who = contact || {};
    return {
      id: `bk-${now}-${suffix || Math.random().toString(36).slice(2, 8)}`,
      bookingKey: String(bookingKey || ''),
      name: cells[1],
      email: normaliseText(who.email),
      phone: normaliseText(who.phone),
      dealer: cells[0],
      apptType: cells[3],
      apptDate: cells[2],
      row,
      bookedAt: new Date(now).toISOString(),
      state: 'waiting',
      checkedAt: null,
      tries: 0,
      appointment: null,
      outcome: null,
      sent: null,
      text: ''
    };
  }

  /* Pure. The stored value with the entry added. The same booking again
     replaces its earlier entry, entries over a shift old are dropped (one
     with no readable time cannot be aged, so it goes too) and fields this
     tool does not know are kept as they are. */
  function mergeBookingChecks(stored, entry, now) {
    const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const kept = (Array.isArray(base.bookings) ? base.bookings : []).filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const age = now - Date.parse(item.bookedAt);
      if (!(age < BOOKING_DRAFT_MAX_AGE)) return false;
      return !(entry && entry.bookingKey && item.bookingKey === entry.bookingKey);
    });
    return { ...base, savedAt: new Date(now).toISOString(), bookings: entry ? kept.concat([entry]) : kept };
  }

  /* The lead's own record first, as the top of the page shows one customer
     whichever lead tab is open. */
  function leadContact() {
    const lead = (leadScopeActivity(callNotesBox()) || {}).SalesLead || {};
    return {
      email: normaliseText(lead.EmailAddress) || findTopEmail(),
      phone: normaliseText(lead.MobileNumber) || normaliseText(lead.LandlineNumber)
    };
  }

  /* Notes a booking the tool has just put in the diary. Storage can be full
     or blocked, and that must never stop the booking, so any failure only
     means there is no automatic check. Returns whether it was noted. */
  function recordBookingCheck(draft, plan) {
    if (!ownerTools() || !draft || !plan || draft.key === INBOUND_KEY) return false;
    try {
      const facts = sheetFactsFor(draft);
      if (!facts) return false;
      const now = Date.now();
      const entry = buildBookingCheck(facts, leadContact(), `${draft.key} ${diaryKey(plan)}`, now);
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(BOOKING_CHECKS_KEY)); } catch (error) { /* unreadable, so started again */ }
      localStorage.setItem(BOOKING_CHECKS_KEY, JSON.stringify(mergeBookingChecks(stored, entry, now)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function bookingCheckSelfTest() {
    const failures = [];
    const check = (name, got, want) => { if (got !== want) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    const now = Date.parse('2026-11-13T10:00:00Z');
    const hour = 60 * 60 * 1000;
    const facts = { dealer: 'Stellantis &You Preston', name: 'Mr Jo Example', year: 2026, month: 11, day: 14, diaryType: 'Face To Face', condition: 'used', inDiary: true };
    const entry = buildBookingCheck(facts, { email: ' jo@example.com ', phone: '07700 900123' }, 'lead-1 2026-11-14 14:00 Face To Face', now, 'abc');
    check('id', entry.id, `bk-${now}-abc`);
    check('a random id when none is given', /^bk-\d+-[a-z0-9]+$/.test(buildBookingCheck(facts, {}, 'k', now).id), true);
    check('name without the title', entry.name, 'Jo Example');
    check('email', entry.email, 'jo@example.com');
    check('phone', entry.phone, '07700 900123');
    check('sheet spellings', [entry.dealer, entry.apptType, entry.apptDate].join('|'), 'Preston|Face to Face|14 November 2026');
    check('the row is the sheet row', entry.row, buildSheetRow(facts));
    check('eight cells', entry.row.split('\t').length, 8);
    check('Checked on kL is empty', entry.row.split('\t')[6], '');
    check('booked time', entry.bookedAt, '2026-11-13T10:00:00.000Z');
    check('starts waiting', [entry.state, entry.tries, entry.checkedAt, entry.appointment, entry.outcome, entry.sent, entry.text].join('|'), 'waiting|0|||||');
    check('no contact details', [buildBookingCheck(facts, null, 'k', now).email, buildBookingCheck(facts, null, 'k', now).phone].join('|'), '|');

    const at = (hours) => new Date(now - hours * hour).toISOString();
    const other = { id: 'bk-1', bookingKey: 'lead-2 2026-11-14 10:00 Test Drive', bookedAt: at(1), state: 'checked', sent: true, extra: { kept: 1 } };
    const same = { id: 'bk-2', bookingKey: entry.bookingKey, bookedAt: at(2), state: 'failed', tries: 6 };
    const sameLeadOtherTime = { id: 'bk-3', bookingKey: 'lead-1 2026-11-14 15:00 Face To Face', bookedAt: at(2) };
    const old = { id: 'bk-4', bookingKey: 'lead-3 x', bookedAt: at(13) };
    const merged = mergeBookingChecks({ savedAt: 'then', later: 'kept', bookings: [other, same, sameLeadOtherTime, old, null, { id: 'bk-5' }] }, entry, now);
    check('ids after a merge', merged.bookings.map((b) => b.id).join(), `bk-1,bk-3,${entry.id}`);
    check('another entry is kept whole', JSON.stringify(merged.bookings[0]), JSON.stringify(other));
    check('the repeat starts waiting again', merged.bookings[2].state, 'waiting');
    check('unknown top level fields are kept', merged.later, 'kept');
    check('saved time', merged.savedAt, '2026-11-13T10:00:00.000Z');
    check('just inside a shift is kept', mergeBookingChecks({ bookings: [{ id: 'a', bookedAt: at(11.9) }] }, entry, now).bookings.length, 2);
    check('nothing stored', mergeBookingChecks(null, entry, now).bookings.length, 1);
    check('a stored value of the wrong shape', mergeBookingChecks('x', entry, now).bookings.length, 1);
    check('bookings of the wrong shape', mergeBookingChecks({ bookings: 'x' }, entry, now).bookings.length, 1);
    check('the stored value is not changed', [other.state, same.state].join(), 'checked,failed');
    return failures;
  }

  function diaryKey(plan) {
    return plan ? `${plan.year}-${plan.month}-${plan.day} ${plan.time} ${plan.type}` : '';
  }

  function diaryAlreadyBooked(draft, plan) {
    return !!plan && draft.diaryBooked === diaryKey(plan);
  }

  /* ---------- booking the appointment in the Konnect diary ---------- */

  let diaryRun = null;
  const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /* The diary only offers Face To Face, Test Drive and Phone Call for us. */
  function diaryType(input) {
    const engine = bookingEngine();
    if (engine && engine.isCallBooking(input)) return 'Phone Call';
    if (input.type === 'testdrive') return 'Test Drive';
    if (input.type === 'motability' && (!input.subtype || input.subtype === 'testdrive')) return 'Test Drive';
    if (input.type === 'onlinestore' && input.subtype === 'similar') return 'Test Drive';
    return 'Face To Face';
  }

  function diaryPlan(draft) {
    const engine = bookingEngine();
    if (!engine || draft.key === INBOUND_KEY) return null;
    const input = bookingInput(draft);
    if (!input.type) return null;
    const date = engine.resolveDate(input.date, new Date());
    const time = engine.resolveTime(input.time || (input.type === 'national' ? '12:00' : ''));
    if (date.error || time.error) return null;
    return {
      year: date.year, month: date.month, day: date.day, time: time.text, label: `${date.text} at ${time.text}`,
      length: engine.appointmentLength(input) === 30 ? '30 minutes' : '60 minutes',
      type: diaryType(input)
    };
  }

  /* A National Reservation goes in the diary 6 working days ahead at 12:00
     as Face To Face. Choosing the type sets that day and time; changing them
     in the When step afterwards is kept. */
  function setNationalDefaults(d) {
    const engine = bookingEngine();
    if (!engine) return;
    const at = engine.nationalReservationDate(new Date());
    d.day = String(at.day).padStart(2, '0');
    d.month = String(at.month).padStart(2, '0');
    d.year = '';
    d.time = at.time || '12:00';
    d.timeQualifier = '';
  }

  /* The open lead's dealer. The lead's own drop downs are matched to the
     lead the same way Lead Re setup does it (through its Angular scope),
     so another lead's tab is never read. A drop down choice not saved yet
     is read before the stored dealer name. */
  function leadScopeActivity(node) {
    try {
      for (let scope = window.angular?.element(node).scope(), depth = 0; scope && depth < 8; scope = scope.$parent, depth += 1) {
        if (scope.theActivity) return scope.theActivity;
      }
    } catch (error) { /* not an Angular page */ }
    return null;
  }

  function leadDealer() {
    const pane = callNotesBox()?.closest('.tab-pane') || document.querySelector('.tab-pane.active');
    if (!pane) return '';
    const activity = leadScopeActivity(pane.querySelector('button[ng-click^="manageSalesEventBookings"]') || callNotesBox());
    const select = Array.from(pane.querySelectorAll('select[ng-model]')).find((node) =>
      /dealer/i.test(node.getAttribute('ng-model')) && !/badge|brand/i.test(node.getAttribute('ng-model')) &&
      (!activity || leadScopeActivity(node) === activity));
    const chosen = select ? normaliseText(select.options[select.selectedIndex]?.textContent) : '';
    if (chosen && !/^\(?select/i.test(chosen)) return chosen;
    return normaliseText(activity?.SalesLead?.DealerName || '');
  }

  function diaryModal() {
    return Array.from(document.querySelectorAll('.modal')).find((modal) => isVisible(modal) &&
      modal.querySelector('button[ng-click="openStartDate($event)"], td[ng-click^="SelectTimeSlot"]')) || null;
  }

  function diarySlotCells(modal) {
    return Array.from(modal.querySelectorAll('td[ng-click^="SelectTimeSlot"]')).filter(isVisible);
  }

  /* The date button reads like "Tuesday Nov 10th". */
  function diaryShowsDate(modal, plan) {
    const label = modal.querySelector('button[ng-click="openStartDate($event)"]');
    const match = normaliseText(label?.textContent).toLowerCase().match(/([a-z]{3})[a-z]*\s+(\d{1,2})/);
    return !!match && MONTHS_SHORT.indexOf(match[1]) === plan.month - 1 && Number(match[2]) === plan.day;
  }

  /* Opens the date picker, moves to the right month and clicks the day.
     Days from the next or previous month are shown greyed and skipped. */
  async function diaryPickDate(modal, plan) {
    if (diaryShowsDate(modal, plan)) return true;
    modal.querySelector('button[ng-click="openStartDate($event)"]').click();
    // The picker may redraw itself, so the month title is looked up fresh each time.
    const titleText = () => normaliseText(Array.from(document.querySelectorAll('button[id$="-title"], button[ng-click="toggleMode()"], .uib-title')).find(isVisible)?.textContent);
    if (!(await waitFor(titleText, 3000))) return false;
    const target = plan.year * 12 + plan.month - 1;
    for (let step = 0; step < 24; step += 1) {
      const match = titleText().match(/([A-Za-z]+)\s+(\d{4})/);
      if (!match) return false;
      const shown = Number(match[2]) * 12 + MONTHS_SHORT.indexOf(match[1].slice(0, 3).toLowerCase());
      if (shown === target) break;
      const move = Array.from(document.querySelectorAll(`button[ng-click="move(${shown < target ? 1 : -1})"]`)).find(isVisible);
      if (!move) return false;
      move.click();
      await waitFor(() => titleText() && !titleText().includes(match[0]), 1500);
    }
    const day = Array.from(document.querySelectorAll('button[ng-click="select(dt.date)"]')).find((node) => isVisible(node) &&
      !node.querySelector('.text-muted') && !node.disabled && Number(normaliseText(node.textContent)) === plan.day);
    if (!day) return false;
    // The old day's boxes stay on screen for a moment after the date changes.
    const oldCell = diarySlotCells(modal)[0];
    day.click();
    if (!(await waitFor(() => diaryShowsDate(modal, plan), 5000))) return false;
    await waitFor(() => !oldCell || !oldCell.isConnected, 8000);
    return !!(await diaryReady(modal));
  }

  /* Waits until the diary's boxes have been on screen unchanged for a moment. */
  async function diaryReady(modal) {
    let last = '';
    let steady = 0;
    return waitFor(() => {
      const cells = diarySlotCells(modal);
      const now = `${cells.length}|${cells[0]?.innerText || ''}|${cells[cells.length - 1]?.innerText || ''}`;
      steady = cells.length && now === last ? steady + 1 : 0;
      last = now;
      return steady >= 6 ? modal : null;
    }, 15000);
  }

  /* A free box: no name in it, not blocked and not in the past. */
  function diaryFreeCell(modal, plan) {
    const table = Array.from(modal.querySelectorAll('table')).find((t) => t.querySelector('td[ng-click^="SelectTimeSlot"]'));
    if (!table) return { error: 'the diary table was not found' };
    const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map((th) => normaliseText(th.textContent));
    const column = headers.indexOf(plan.time);
    if (column < 0) return { error: `there is no ${plan.time} column in the diary` };
    const rows = Array.from(table.querySelectorAll('tbody tr')).filter(isVisible);
    // A greyed "very soon" box can still be booked, so it is used when no
    // one has a clear box at that time. Past and blocked boxes never are.
    for (const refuse of [/past|soon|blocked/i, /past|blocked/i])
    for (const row of rows) {
      const cells = Array.from(row.children);
      const slots = cells.filter((cell) => cell.matches('td[ng-click^="SelectTimeSlot"]'));
      const cell = cells.length === headers.length ? cells[column] : slots[column - (headers.length - slots.length)];
      if (!cell || !cell.matches('td[ng-click^="SelectTimeSlot"]')) continue;
      // Every box holds a hidden "BLOCKED" and a hidden name button, so only
      // what is actually shown counts.
      const text = normaliseText(cell.innerText);
      const titles = [cell, ...Array.from(cell.querySelectorAll('[title]')).filter(isVisible)].map((node) => node.getAttribute('title') || '').join(' ');
      // A booked box keeps the customer's name in its button even when
      // Konnect hides the button, so the name counts whether shown or not.
      const booked = Array.from(cell.querySelectorAll('button')).some((b) => normaliseText(b.textContent));
      if (text || booked || refuse.test(titles)) continue;
      // The name cell also lists the person's brand letters on a second line.
      const nameText = cells[0] && cells[0] !== cell ? String(cells[0].innerText || '').split('\n')[0] : '';
      return { cell, person: normaliseText(nameText).replace(/(\s+[A-Z],)+\s*[A-Z]$/, '').replace(/\s+[A-Z](,\s*[A-Z])+$/, '') };
    }
    return { error: `no one is free at ${plan.time} on that day` };
  }

  /* Opens a Time Span or Type list with its arrow and picks the option.
     The options are only added to the page once the list is open. Before a
     choice the button reads "Time Span" or "Type"; after one it shows the choice. */
  async function diaryChoose(modal, label, optionSelector, wanted) {
    const findOption = () => Array.from(modal.querySelectorAll(optionSelector))
      .find((node) => isVisible(node) && normaliseText(node.textContent).toLowerCase() === wanted.toLowerCase());
    const labelButton = Array.from(modal.querySelectorAll('button'))
      .find((node) => isVisible(node) && normaliseText(node.textContent).toLowerCase() === label.toLowerCase());
    const groups = Array.from(modal.querySelectorAll('.dropdown-toggle')).filter(isVisible);
    let toggle = labelButton?.parentElement?.querySelector('.dropdown-toggle');
    if (!toggle) toggle = groups[label === 'Time Span' ? 0 : 1];
    if (!toggle) return false;
    let option = findOption();
    for (let attempt = 0; !option && attempt < 2; attempt += 1) {
      toggle.click();
      option = await waitFor(findOption, 2500);
    }
    if (!option) return false;
    option.click();
    return true;
  }

  /* Each lead on the customer has its own Manage Appointments button, and
     the open lead is not always the first or newest. The right one is in the
     same lead tab as the Call Notes box being written in. If that lead's
     Outcomes section is folded shut, it is opened first. */
  async function leadDiaryButton() {
    const selector = 'button[ng-click^="manageSalesEventBookings"]';
    const notes = callNotesBox();
    const pane = notes?.closest('.tab-pane') || document.querySelector('.tab-pane.active');
    if (pane) {
      const inPane = pane.querySelector(selector);
      if (inPane) {
        if (!isVisible(inPane)) {
          const toggle = Array.from(pane.querySelectorAll('a.accordion-toggle, .accordion-toggle'))
            .find((node) => /^outcomes$/i.test(normaliseText(node.textContent)));
          toggle?.click();
          await waitFor(() => isVisible(inPane), 2000);
        }
        return isVisible(inPane) ? inPane : null;
      }
    }
    // No lead tabs on this page: only use the button if there is exactly one shown.
    const shown = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    return shown.length === 1 ? shown[0] : null;
  }

  /* Sets the open lead's outcome to match the appointment. The call outcome
     follows the contact header and brings up the lead's outcome lists, which
     are then picked in order. A call outcome already chosen is left alone. */
  const CALL_OUTCOME_FOR_CONTACT = {
    none: 'Spoke to Customer',
    vm: 'No Answer - Message Left',
    engaged: 'No Answer - No Message Left',
    email: 'Update Outcomes (No Call Made)'
  };
  async function setLeadOutcome(draft, plan) {
    const callOutcome = Array.from(document.querySelectorAll('select[ng-model="selected.CallOutcome"]')).find(isVisible);
    if (!callOutcome) return 'the call outcome box was not found';
    const current = normaliseText(callOutcome.options[callOutcome.selectedIndex]?.textContent);
    if (!current || /^\(select/i.test(current)) {
      const wantedCall = CALL_OUTCOME_FOR_CONTACT[draft.data.contact || 'none'];
      if (!wantedCall) return 'choose the call outcome yourself, then the lead outcome';
      if (!setLeadControl(callOutcome, wantedCall)) return `could not choose the call outcome "${wantedCall}"`;
    }
    const pane = callNotesBox()?.closest('.tab-pane') || document.querySelector('.tab-pane.active') || document;
    const path = ['Customer Hub Team', 'Appointment', plan.type];
    // The Outcomes section may be folded shut, which hides the lists.
    const outcomeLists = () => Array.from(pane.querySelectorAll('select[ng-model^="theActivity.SelectedOutcomeLevel"]')).filter(isVisible);
    if (!outcomeLists().length) {
      const heading = Array.from((pane.querySelector('a.accordion-toggle') ? pane : document).querySelectorAll('a.accordion-toggle, a[ng-click="toggleOpen()"]')).find((a) => isVisible(a) && /^outcomes$/i.test(normaliseText(a.textContent)));
      if (heading) { heading.click(); await waitFor(() => outcomeLists().length > 0 || null, 3000); }
    }
    for (let level = 0; level < path.length; level += 1) {
      const wanted = path[level];
      const select = await waitFor(() => {
        const selector = 'select[ng-model^="theActivity.SelectedOutcomeLevel"]';
        let shown = Array.from(pane.querySelectorAll(selector)).filter(isVisible);
        if (!shown.length) shown = Array.from(document.querySelectorAll(selector)).filter(isVisible);
        const box = shown[level];
        return box && Array.from(box.options).some((o) => normaliseText(o.textContent).toLowerCase() === wanted.toLowerCase()) ? box : null;
      }, 8000);
      if (!select) return `the "${wanted}" outcome was not offered`;
      setLeadControl(select, wanted);
      if (normaliseText(select.options[select.selectedIndex]?.textContent).toLowerCase() !== wanted.toLowerCase()) return `could not choose the "${wanted}" outcome`;
    }
    return '';
  }

  async function bookInDiary(draft) {
    const plan = diaryPlan(draft);
    const result = buildCurrentBooking(draft);
    if (!plan || !result || result.errors.length) {
      state.bookingStatus = { kind: 'error', text: 'Finish the booking first (type, day and time).' };
      renderPalette();
      return false;
    }
    if (diaryRun) return false;
    if (draft.data.type === 'national') {
      const dealer = leadDealer();
      if (!dealer || /national/i.test(dealer)) {
        state.bookingStatus = { kind: 'error', text: `The lead's dealer is ${dealer ? `"${dealer}"` : 'not set'}. Change it in the lead's dealer drop down first (the diary follows it), then press again.` };
        draft.nationalDealerOk = '';
        renderPalette();
        return false;
      }
    }
    // A National Reservation still on a National dealer has had its own
    // message above; every other booking at a dealer that takes none stops here.
    const blocked = blockedDiaryDealer(leadDealer());
    if (blocked) {
      state.bookingStatus = { kind: 'error', text: `${blocked} Nothing was put in the diary.` };
      draft.nationalDealerOk = '';
      renderPalette();
      return false;
    }
    if (draft.data.type === 'national') {
      const dealer = leadDealer();
      if (draft.nationalDealerOk !== dealer) {
        draft.nationalDealerOk = dealer;
        state.bookingStatus = { kind: 'warn', text: `National Reservation: book it at ${dealer} on ${plan.label}? Press again to confirm.` };
        renderPalette();
        return false;
      }
    }
    if (diaryAlreadyBooked(draft, plan) && !draft.diaryRepeat) {
      draft.diaryRepeat = true;
      state.bookingStatus = { kind: 'warn', text: `This booking is already in the diary for ${plan.label}. Press Diary only again to add a second appointment.` };
      renderPalette();
      return false;
    }
    draft.diaryRepeat = false;
    const moved = draft.diaryBooked && draft.diaryBooked !== diaryKey(plan)
      ? ' The earlier diary appointment for this booking is still there, so remove it by hand.' : '';
    const run = { stopped: false };
    diaryRun = run;
    const say = (kind, text) => {
      state.bookingStatus = { kind, text };
      if (state.open && state.view === 'booking') renderPalette();
    };
    const fail = (text) => {
      say('error', `Diary booking stopped: ${text}. Finish it by hand in the diary.`);
      showToast(`Diary booking stopped: ${text}`);
    };
    try {
      say('ok', `Booking the diary for ${plan.label}...`);
      let modal = diaryModal();
      if (!modal) {
        const open = await leadDiaryButton();
        if (!open) return fail('the Manage Appointments button for this lead was not found');
        open.click();
      }
      // The diary can load instantly or take a few seconds.
      modal = await waitFor(() => { const m = diaryModal(); return m && diarySlotCells(m).length ? m : null; }, 15000);
      if (run.stopped) return;
      if (!modal || !(await diaryReady(modal))) return fail('the diary did not load');
      if (!(await diaryPickDate(modal, plan))) return fail(`could not change the diary to ${plan.label.slice(0, 5)}`);
      if (run.stopped) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const free = diaryFreeCell(modal, plan);
      if (free.error) return fail(free.error);
      free.cell.click();
      const make = await waitFor(() => Array.from(modal.querySelectorAll('button[ng-click="makingAppointment=true"]')).find((b) => isVisible(b) && !b.disabled), 4000);
      if (run.stopped) return;
      if (!make) return fail('Make Appointment did not appear after picking the time');
      make.click();
      if (!(await diaryChoose(modal, 'Time Span', 'a[ng-click^="setAppointmentLength"]', plan.length))) return fail(`the ${plan.length} time span was not offered`);
      if (!(await diaryChoose(modal, 'Type', 'a[ng-click^="setAppointmentType"]', plan.type))) return fail(`the ${plan.type} type was not offered`);
      if (run.stopped) return;
      const confirm = await waitFor(() => Array.from(modal.querySelectorAll('button[ng-click="createAppointment()"]')).find((b) => isVisible(b) && !b.disabled), 3000);
      if (!confirm) return fail('the Confirm button was not ready');
      // Konnect closes the form whether it took the appointment or refused
      // it, so a refusal is read from its own message.
      const refusal = () => Array.from(document.querySelectorAll('.toast-error, .toast-warning')).filter(isVisible).map((t) => normaliseText(t.textContent)).filter(Boolean)[0] || '';
      const refusedBefore = refusal();
      const appointmentBefore = (leadScopeActivity(state.target) || {}).SalesAppointmentID || 0;
      confirm.click();
      const done = await waitFor(() => (refusal() && refusal() !== refusedBefore) || !isVisible(confirm) || !confirm.isConnected, 10000);
      if (!done) return fail('Konnect did not confirm the appointment');
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (refusal() && refusal() !== refusedBefore) return fail(`Konnect refused it ("${refusal().slice(0, 80)}"). Nothing was booked`);
      // The diary stays open after Confirm, so close it before the outcome.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const close = Array.from(modal.querySelectorAll('button[ng-click="cancel()"]')).filter(isVisible)
        .sort((a, b) => (/close/i.test(b.textContent) ? 1 : 0) - (/close/i.test(a.textContent) ? 1 : 0))[0];
      close?.click();
      const closed = await waitFor(() => !diaryModal(), 6000);
      const who = free.person ? ` with ${free.person}` : '';
      // Konnect shows a green tick on the lead's tab once the appointment
      // is really in the diary, and gives the lead an appointment number.
      // Either can take a moment, so their absence is only a warning.
      const tabTick = () => {
        const tab = document.querySelector('[ng-repeat^="tab in tabs"].active');
        return !!tab && Array.from(tab.querySelectorAll('i, span')).some((n) => isVisible(n) && /check|tick|success/i.test(String(n.className)));
      };
      const inDiary = await waitFor(() => {
        const now = (leadScopeActivity(state.target) || {}).SalesAppointmentID || 0;
        return (now && now !== appointmentBefore) || tabTick() || null;
      }, 6000);
      const unconfirmed = inDiary ? '' : ' The green tick has not shown on the lead\'s tab yet: check it is in the diary.';
      draft.diaryBooked = diaryKey(plan);
      saveDraftNow();
      const toCheck = recordBookingCheck(draft, plan)
        ? ' Konnect Live will be checked in a few minutes (see Bookings in SLA Manager).' : '';
      // Which outcome a National Reservation takes is not confirmed yet, so it is left to the agent.
      const outcomeProblem = !closed ? 'the diary did not close'
        : draft.data.type === 'national' ? 'National Reservations have their outcome set by hand for now'
          : await setLeadOutcome(draft, plan);
      if (outcomeProblem) {
        say('warn', `Diary booked: ${plan.label}, ${plan.type}${who}. Outcome not set: ${outcomeProblem}.${moved}${unconfirmed}`);
        showToast(`Diary booked. Set the outcome by hand: ${outcomeProblem}${toCheck && '.'}${toCheck}`);
        return false;
      }
      say(moved || unconfirmed ? 'warn' : 'ok', `Diary booked: ${plan.label}, ${plan.type}, ${plan.length}${who}. Outcome set to Customer Hub Team, Appointment, ${plan.type}.${moved}${unconfirmed}`);
      showToast(`Diary booked and outcome set: ${plan.type}${who}${toCheck && '.'}${toCheck}`);
      return !moved;
    } finally {
      if (diaryRun === run) diaryRun = null;
    }
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

  /* Recent steps for Report a problem. Only the tool's own messages go in,
     and Diagnostics masks emails, phones and regs again before showing them. */
  const activityLog = [];
  function logActivity(text) {
    const line = normaliseText(text);
    if (!line || activityLog[activityLog.length - 1]?.endsWith(line)) return;
    activityLog.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
    if (activityLog.length > 60) activityLog.shift();
  }

  async function reportProblem() {
    const draft = state.booking;
    window.__wbDiagnosticsExtra = {
      tool: `Konnect Notes v${KN.version}`,
      state: `view ${state.view}; type ${draft?.data?.type || 'none'}; section ${draft?.openSection || 'none'}; inserted ${draft?.inserted ? 'yes' : 'no'}; diary ${draft?.diaryBooked ? 'booked' : 'no'}`,
      log: activityLog.slice()
    };
    try {
      const response = await fetch(`${BASE_URL}Diagnostics.js?_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      Function(await response.text())();
    } catch (error) {
      showToast(`Could not open Diagnostics: ${error.message}`);
    }
  }

  /* Styled in place, as it must still show after Stop has removed the style
     sheet. "lead" is what happened, said first with an amber dot. "action"
     ({ label, run }, or a list of them) adds a button for each and keeps the
     toast up a little longer. */
  function showToast(text, lead, action) {
    logActivity(text);
    const toast = document.createElement('div');
    toast.className = 'kn-toast';
    toast.setAttribute('role', 'status');
    toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;align-items:center;gap:8px;' +
      'max-width:80vw;padding:9px 14px;border-radius:12px;background:#1c1c1e;color:#fff;' +
      'font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.3);pointer-events:none';
    if (lead) {
      const dot = document.createElement('span');
      dot.style.cssText = 'flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#f0a020';
      toast.appendChild(dot);
      const words = document.createElement('span');
      const strong = document.createElement('b');
      strong.textContent = lead;
      strong.style.fontWeight = '700';
      const why = document.createElement('span');
      why.style.fontWeight = '500';
      why.textContent = ` ${text}`;
      words.appendChild(strong);
      words.appendChild(why);
      toast.appendChild(words);
    } else {
      toast.textContent = text;
    }
    const actions = [].concat(action || []);
    actions.forEach((item) => {
      toast.style.pointerEvents = 'auto';
      const act = document.createElement('button');
      act.type = 'button';
      act.textContent = item.label;
      act.style.cssText = 'border:0;border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer;background:#fff;color:#1c1c1e';
      act.addEventListener('click', () => { toast.remove(); item.run(); });
      toast.appendChild(act);
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), actions.length ? 10000 : 4500);
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
  function writeBookingToLead(draft, options) {
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
    if (voi && vehicle && !options?.pxOnly) {
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

  /* ---------- part exchange held on another lead ---------- */

  function lettersOnly(text) {
    return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  /* The lead a pane belongs to, read from one of its own boxes. */
  function paneActivity(pane) {
    const node = pane?.querySelector('[ng-model^="theActivity."]');
    return node ? leadScopeActivity(node) : null;
  }

  function leadRequestText(pane) {
    return selectedText(pane?.querySelector('select[ng-model$="LeadDetails.LeadRequestID"]') || labelledSelect(pane, 'lead request'));
  }

  function isPxValuationLead(pane, activity) {
    return PX_VALUATION_LEAD.test(String(activity?.CampaignName || '')) || PX_VALUATION_LEAD.test(leadRequestText(pane));
  }

  function leadTabLinks(pane) {
    const content = pane?.parentElement;
    const panes = Array.from(content?.children || []).filter((node) => node.classList.contains('tab-pane'));
    const links = Array.from(content?.parentElement?.querySelectorAll('a[ng-click="select()"]') || [])
      .filter((link) => !content.contains(link));
    return { panes, links: links.length === panes.length ? links : [] };
  }

  function otherLeadWhen(activity) {
    const raw = [activity.CreatedDate, activity.DateCreated, activity.SalesLead?.CreatedDate, activity.SalesLead?.DateCreated,
      activity.SalesLead?.LeadDetails?.CreatedDate].find(Boolean);
    const stamp = /^\/Date\((\d+)/.exec(String(raw || ''));
    const date = raw ? new Date(stamp ? Number(stamp[1]) : raw) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const month = MONTHS_SHORT[date.getMonth()];
    return `${date.getDate()} ${month[0].toUpperCase()}${month.slice(1)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  /* The customer's other open leads that are PX valuation leads. Nothing is
     offered when the lead in view is itself one, or cannot be told apart. */
  const pxMoveDone = new WeakSet();
  let pxMoveRun = false;
  function otherPxLeads() {
    if (!ownerTools() || !state.target) return [];
    const home = activeLeadPane();
    const mine = leadScopeActivity(state.target);
    if (!home || !mine || isPxValuationLead(home, mine)) return [];
    const found = [];
    leadTabLinks(home).panes.forEach((pane) => {
      if (pane === home) return;
      const activity = paneActivity(pane);
      if (!activity || activity === mine || pxMoveDone.has(activity) || found.some((lead) => lead.activity === activity)) return;
      if (lettersOnly(activity.OutcomeFullHierarchy) !== 'none' || !isPxValuationLead(pane, activity)) return;
      const name = leadRequestText(pane) || normaliseText(activity.CampaignName);
      found.push({ pane, activity, label: [name, otherLeadWhen(activity)].filter(Boolean).join(', ') });
    });
    return found;
  }

  function renderOtherPxLead(draft, body) {
    if (pxMoveRun || draft.key === INBOUND_KEY) return;
    const leads = otherPxLeads();
    if (!leads.length) return;
    const card = element('div', 'kn-bk-notice kn-bk-other-px');
    const actions = element('div', 'kn-bk-notice-actions');
    if (leads.length === 1) {
      card.appendChild(element('div', 'kn-bk-notice-text', `This customer's part exchange is on another lead (${leads[0].label}).`));
      actions.appendChild(button('Use it and close that lead as duplicate', 'kn-primary', () => usePxFromOtherLead(draft, leads[0])));
    } else {
      card.appendChild(element('div', 'kn-bk-notice-text', `This customer has ${leads.length} other part exchange leads. Pick the one to use. Only that lead is closed as duplicate.`));
      leads.forEach((lead) => actions.appendChild(button(lead.label, 'kn-primary', () => usePxFromOtherLead(draft, lead))));
    }
    card.appendChild(actions);
    body.appendChild(card);
  }

  async function showLeadTab(pane) {
    const shown = () => pane.classList.contains('active') && isVisible(pane);
    if (shown()) return true;
    const tabs = leadTabLinks(pane);
    const link = tabs.links[tabs.panes.indexOf(pane)];
    if (!link) return false;
    link.click();
    return !!(await waitFor(shown, 3000));
  }

  async function openLeadSection(pane, title) {
    const heading = Array.from(pane.querySelectorAll('a.accordion-toggle, a[ng-click="toggleOpen()"]'))
      .find((a) => isVisible(a) && normaliseText(a.textContent).toLowerCase() === title);
    if (heading) heading.click();
    return !!heading;
  }

  /* A box's value as Konnect holds it, which is there even when the pane is
     hidden or the section is folded; the box itself is the fallback. */
  function scopeBoxValue(input) {
    try {
      const model = input.getAttribute('ng-model');
      const value = model ? window.angular.element(input).scope().$eval(model) : null;
      if (typeof value === 'string' || typeof value === 'number') return realText(value);
    } catch (error) { /* read the box instead */ }
    return realText(input.value);
  }

  async function readOtherLeadPx(lead, home) {
    const boxes = (panel) => Object.values(PX_BOXES).some((placeholder) => panel?.querySelector(`input[placeholder="${placeholder}"]`));
    let panel = leadPanel(lead.pane, 'part exchange');
    if (boxes(panel)) {
      const fields = {};
      Object.entries(PX_BOXES).forEach(([path, placeholder]) => {
        const input = panel.querySelector(`input[placeholder="${placeholder}"]`);
        fields[path] = input ? scopeBoxValue(input) : '';
      });
      return fields;
    }
    /* The boxes are not on the page yet: look at that lead, then come back. */
    if (!(await showLeadTab(lead.pane))) return null;
    panel = leadPanel(lead.pane, 'part exchange');
    if (!boxes(panel)) {
      await openLeadSection(lead.pane, 'part exchange');
      await waitFor(() => boxes(leadPanel(lead.pane, 'part exchange')), 3000);
      panel = leadPanel(lead.pane, 'part exchange');
    }
    const fields = boxes(panel) ? readPxBoxes(panel) : null;
    return (await showLeadTab(home)) ? fields : null;
  }

  /* Empty booking boxes are filled. A value already in the booking is kept
     and the other lead's value is offered as a notice. Returns how many were kept. */
  function copyPxIntoDraft(draft, fields) {
    const engine = bookingEngine();
    if (engine && fields['px.make'] && fields['px.model']) {
      const split = engine.splitMakeModel(fields['px.make'], fields['px.model']);
      if (split.model) fields['px.model'] = split.model;
    }
    let kept = 0;
    draft.data.px.status = 'yes';
    Object.entries(fields).forEach(([path, value]) => {
      if (!value) return;
      const current = realText(getBookingField(draft.data, path));
      if (!current) {
        setBookingField(draft.data, path, value);
        draft.fromLead[path] = true;
      } else if (!sameValue(current, value)) {
        addNotice(draft, { path, value, label: `${LEAD_FIELD_LABELS[path] || path} on the other lead is "${value}"` });
        kept += 1;
      }
    });
    return kept;
  }

  /* Picks the outcome lists in order on the lead in view, as setLeadOutcome
     does, but only on lists that belong to that lead. Returns the level that
     could not be chosen, or -1 when all were. */
  async function chooseLeadOutcome(pane, activity, path) {
    const lists = () => Array.from(pane.querySelectorAll(OUTCOME_LISTS))
      .filter((node) => isVisible(node) && leadScopeActivity(node) === activity);
    if (!lists().length && (await openLeadSection(pane, 'outcomes'))) await waitFor(() => lists().length > 0, 3000);
    for (let level = 0; level < path.length; level += 1) {
      const wanted = lettersOnly(path[level]);
      const found = await waitFor(() => {
        const box = lists()[level];
        const option = box && Array.from(box.options).find((item) => lettersOnly(item.textContent) === wanted);
        return option ? { box, option } : null;
      }, 4000);
      if (!found) return level;
      if (found.box.value !== found.option.value) {
        found.box.value = found.option.value;
        found.box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const chosen = await waitFor(() => {
        const box = lists()[level];
        return box && lettersOnly(box.options[box.selectedIndex]?.textContent) === wanted;
      }, 1500);
      if (!chosen) return level;
    }
    return -1;
  }

  /* Copies the other lead's part exchange into the booking and its lead, then
     sets that lead to Duplicate Lead. Finished is never pressed and the call
     outcome is left alone. */
  async function usePxFromOtherLead(draft, lead) {
    if (pxMoveRun || diaryRun) return;
    const home = activeLeadPane();
    if (!home || !lead.pane.isConnected) return;
    const say = (kind, text) => {
      state.bookingStatus = { kind, text };
      if (state.open && state.view === 'booking') renderPalette();
    };
    pxMoveRun = true;
    let last = null;
    const finish = (kind, text) => { last = { kind, text }; };
    try {
      say('ok', 'Reading the part exchange on the other lead...');
      const fields = await readOtherLeadPx(lead, home);
      if (!fields) return finish('error', 'The part exchange on the other lead could not be read. Nothing was copied, and that lead was left as it is. Check which lead tab is in view.');
      if (!Object.values(fields).some(Boolean)) return finish('error', 'The other lead has no part exchange details. Nothing was copied, and that lead was left as it is.');

      say('ok', 'Copying the part exchange into this booking and lead...');
      const kept = copyPxIntoDraft(draft, fields);
      draft.openSection = 'px';
      saveDraftNow();
      await writeBookingToLead(draft, { pxOnly: true });

      say('ok', 'Setting the other lead to Duplicate Lead...');
      const copied = 'Part exchange copied from the other lead.';
      const yourself = 'Set that lead\'s outcome yourself.';
      if (!(await showLeadTab(lead.pane))) return finish('error', `${copied} The other lead's tab could not be opened. ${yourself}`);
      const missed = await chooseLeadOutcome(lead.pane, lead.activity, DUPLICATE_LEAD_OUTCOME);
      const back = await showLeadTab(home);
      const goBack = back ? '' : ' Go back to the lead you are booking.';
      if (missed === DUPLICATE_LEAD_OUTCOME.length - 1) return finish('error', `The duplicate lead outcome was not found under ${DUPLICATE_LEAD_OUTCOME[1]}. ${yourself}${goBack}`);
      if (missed >= 0) return finish('error', `${copied} The "${DUPLICATE_LEAD_OUTCOME[missed]}" outcome was not offered on the other lead. ${yourself}${goBack}`);
      pxMoveDone.add(lead.activity);
      finish(back ? 'ok' : 'warn', `${copied} That lead is set to Duplicate Lead.${kept ? ' Your own part exchange details were kept: see the notices at the top.' : ''}${goBack}`);
    } finally {
      pxMoveRun = false;
      if (last) say(last.kind, last.text);
      scanPage();
    }
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
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      // Typing stays inside the box, except Ctrl+Enter, which presses the main button.
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        bookingRefs?.insert?.click();
      }
    });
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
      if (!d.day) return { text: `Diary: ${cal.text} at ${cal.time} (6 working days)`, error: false };
      const text = `${String(d.day).padStart(2, '0')}/${String(d.month || cal.month).padStart(2, '0')} at ${d.time || '12:00'}`;
      const isDefault = Number(d.day) === cal.day && Number(d.month) === cal.month && (d.time || '12:00') === '12:00';
      return { text: `Diary: ${text}${isDefault ? ' (6 working days)' : ' (changed by you)'}`, error: false };
    }
    if (!d.day && !d.time) return { text: 'Pick a day and time', error: false };
    const parts = [];
    let error = false;
    let confirmYear = 0;
    if (d.day) {
      const date = engine.resolveDate({ day: d.day, month: d.month, year: d.year }, new Date());
      if (date.error) {
        parts.push(date.error);
        error = true;
        if (date.needsYear) confirmYear = date.needsYear;
      } else {
        /* The year is only shown when it is not this year, so a booking a
           year out cannot be mistaken for this month. */
        const otherYear = date.year !== new Date().getFullYear();
        parts.push(`${WEEKDAYS_LONG[date.dateObj.getDay()]} ${date.day} ${MONTHS_LONG[date.month - 1]}${otherYear ? ` ${date.year}` : ''}`);
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
    return { text: parts.join(' '), error, confirmYear };
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
    if (hint && d.type && draft.fromLead.type) {
      const note = element('div', 'kn-muted kn-bk-gap', `Picked from the Lead Request (${hint}). Click another to change it. `);
      note.appendChild(element('span', 'kn-bk-tag', 'from lead'));
      body.appendChild(note);
    }
    body.appendChild(bkChips(BOOKING_TYPES, d.type, (value) => {
      d.type = value;
      d.subtype = BOOKING_SUBTYPE_DEFAULT[value] || '';
      untag(draft, 'type');
      if (value === 'onlinestore' || value === 'national') d.vehicles = d.vehicles.slice(0, 1);
      if (value === 'national') setNationalDefaults(d);
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
      body.appendChild(element('div', 'kn-muted kn-bk-gap', 'National Reservation: the diary date is 6 working days ahead at 12:00, Face To Face. Change the day or time below if needed. It is not in the notes.'));
      if (!d.day) setNationalDefaults(d);
    }
    const request = d.type === 'national' ? null : draft.leadHints?.request;
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
      const holiday = engine.bankHolidayName ? engine.bankHolidayName(day) : '';
      chip.appendChild(element('span', 'kn-bk-day-name', holiday ? 'Bank hol' : i === 0 ? 'Today' : WEEKDAYS[day.getDay()]));
      if (holiday && !chip.disabled) chip.title = `${holiday}: site hours may differ`;
      chip.appendChild(element('span', 'kn-bk-day-num', String(day.getDate())));
      chip.addEventListener('click', () => {
        d.day = String(day.getDate()).padStart(2, '0');
        d.month = String(day.getMonth() + 1).padStart(2, '0');
        d.year = '';
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
      d.year = '';
      untag(draft, 'when');
      changed(draft);
    }, { placeholder: 'DD', maxLength: 5, inputMode: 'numeric', className: 'kn-bk-small', fromLead: draft.fromLead.when });
    const monthField = bkInput('Month', d.month, (value) => {
      d.month = value.replace(/\D/g, '').slice(0, 2);
      d.year = '';
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

    const chosen = d.day ? engine.resolveDate({ day: d.day, month: d.month, year: d.year }, new Date()) : null;
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
    if (engine.isCallBooking({ type: d.type, subtype: d.subtype })) {
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
    renderOtherPxLead(draft, body);
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

  /* A green tick for a finished step, its number otherwise. */
  function setBadge(badge, status, number) {
    const done = status === 'done';
    if (badge.dataset.shows === (done ? 'tick' : String(number))) return;
    badge.dataset.shows = done ? 'tick' : String(number);
    badge.textContent = done ? '' : String(number);
    if (done) badge.appendChild(icon('tick'));
  }

  /* The engine's reasons as short lists: what stops the insert, then what to check. */
  function renderIssues(box, draft, result) {
    box.textContent = '';
    const readout = dateReadout(draft);
    const d = draft.data;
    const list = (title, items, itemClass, boxClass) => {
      if (!items.length) return;
      const card = element('div', `kn-bk-issue-box ${boxClass}`.trim());
      card.appendChild(element('div', 'kn-bk-issue-title', title));
      items.forEach((text) => {
        const line = element('div', itemClass);
        line.appendChild(icon('close'));
        line.appendChild(element('span', '', text));
        card.appendChild(line);
      });
      box.appendChild(card);
    };
    /* The date warning is already shown in full under When, so here it is one short line. */
    const dated = readout.confirmYear
      ? `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${readout.confirmYear}` : '';
    const errors = result.errors.map((text) => (dated && text.includes(dated) ? `Confirm the date ${dated}` : text));
    list('Before you can insert:', errors, 'kn-bk-error', '');
    list('Check:', result.warnings, 'kn-bk-warn', 'kn-bk-issue-warn');
  }

  function renderNeededBar(draft, body) {
    const d = draft.data;
    const missing = visibleSections(d).filter((section) => sectionRequired(section, d) && sectionMissing(draft, section.id));
    const bar = element('div', missing.length ? 'kn-bk-needed' : 'kn-bk-needed kn-bk-ready');
    bookingRefs.needed = bar;
    if (!missing.length) {
      const ready = element('span', 'kn-bk-needed-title');
      ready.appendChild(icon('tick'));
      ready.appendChild(document.createTextNode('Ready to insert'));
      bar.appendChild(ready);
    } else {
      bar.appendChild(element('span', 'kn-bk-needed-title', 'Still needed'));
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
      setBadge(ref.badge, status, ref.number);
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
      if (readout.confirmYear) {
        const d = draft.data;
        const dated = `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${readout.confirmYear}`;
        const confirmYear = button(`Yes, book ${dated}`, 'kn-bk-small kn-bk-confirm-year', () => {
          d.year = String(readout.confirmYear);
          changed(draft, true);
        });
        bookingRefs.readout.appendChild(confirmYear);
      }
    }
    bookingRefs.preview.textContent = result.text;
    renderIssues(bookingRefs.issues, draft, result);
    const waitingForLead = draft.key === INBOUND_KEY;
    const plan = bookingRefs.diary ? diaryPlan(draft) : null;
    const withDiary = !!plan && !diaryAlreadyBooked(draft, plan);
    bookingRefs.insert.textContent = waitingForLead ? 'Insert after the lead is created'
      : withDiary ? (draft.inserted ? 'Update notes and book diary' : 'Insert and book diary')
      : draft.inserted ? 'Update Call Notes' : 'Insert into Call Notes';
    const why = result.errors.length ? `Fix first: ${result.errors[0]}` : '';
    const block = (node, blocked, reason) => {
      if (!node) return;
      if (node.dataset.title == null) node.dataset.title = node.title;
      node.disabled = blocked;
      node.title = blocked ? reason : node.dataset.title;
    };
    block(bookingRefs.notesOnly, result.errors.length > 0, why);
    block(bookingRefs.insert, waitingForLead || result.errors.length > 0, why || 'Create the lead first');
    block(bookingRefs.diary, !!diaryRun || result.errors.length > 0 || !plan,
      why || (diaryRun ? 'A diary booking is running' : 'Needs a date and time first'));
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

    if (state.typedOffer) {
      const card = element('div', 'kn-bk-notice');
      card.appendChild(element('div', 'kn-bk-notice-text', `Found ${state.typedOffer.lines.length} line${state.typedOffer.lines.length === 1 ? '' : 's'} you typed in Call Notes. Move into the booking notes? They are tidied, and the originals are replaced when you insert.`));
      const preview = element('div', 'kn-muted kn-bk-gap', state.typedOffer.lines.slice(0, 6).join(' / ') + (state.typedOffer.lines.length > 6 ? ' / ...' : ''));
      card.appendChild(preview);
      const actions = element('div', 'kn-bk-notice-actions');
      actions.appendChild(button('Use these', 'kn-primary', () => useTypedNotes(draft, true)));
      actions.appendChild(button('Ignore', '', () => useTypedNotes(draft, false)));
      card.appendChild(actions);
      body.appendChild(card);
    }
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

    renderOtherPxLead(draft, body);

    bookingRefs = { summaries: {}, badges: {}, needed: null, readout: null, preview: null, issues: null, insert: null };
    renderUpdateNotice(body);
    renderMobileCard(draft, body);
    renderNeededBar(draft, body);
    visibleSections(d).forEach((section, index) => {
      const open = draft.openSection === section.id;
      const status = sectionStatus(draft, section);
      const wrap = element('div', `kn-bk-section kn-bk-s-${status}${open ? ' kn-bk-open' : ''}`);
      const head = element('button', 'kn-bk-head');
      head.type = 'button';
      const badge = element('span', `kn-bk-badge kn-bk-badge-${status}`);
      setBadge(badge, status, index + 1);
      bookingRefs.badges[section.id] = { badge, wrap, section, number: index + 1 };
      head.appendChild(badge);
      const textCol = element('span', 'kn-bk-head-text');
      const top = element('span', 'kn-bk-head-top');
      const titleNode = element('span', 'kn-bk-head-title', section.titleFor ? section.titleFor(d) : section.title);
      if (!sectionRequired(section, d)) titleNode.appendChild(element('span', 'kn-bk-optional', 'optional'));
      top.appendChild(titleNode);
      textCol.appendChild(top);
      const summary = element('span', 'kn-bk-head-summary', sectionSummary(draft, section.id));
      bookingRefs.summaries[section.id] = summary;
      textCol.appendChild(summary);
      head.appendChild(textCol);
      const chevron = element('span', 'kn-bk-chevron');
      chevron.appendChild(icon(open ? 'up' : 'down'));
      head.appendChild(chevron);
      head.setAttribute('aria-expanded', String(open));
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

    const footer = element('div', draft.key === INBOUND_KEY ? 'kn-bk-footer kn-bk-inbound' : 'kn-bk-footer');
    const previewCard = element('div', 'kn-bk-preview-card');
    previewCard.appendChild(element('div', 'kn-bk-preview-label', 'Goes into Call Notes'));
    const preview = element('pre', 'kn-bk-preview');
    bookingRefs.preview = preview;
    previewCard.appendChild(preview);
    footer.appendChild(previewCard);
    const issues = element('div', 'kn-bk-issues');
    bookingRefs.issues = issues;
    footer.appendChild(issues);
    if (state.bookingStatus) {
      if (!state.bookingStatus.private) logActivity(state.bookingStatus.text);
      footer.appendChild(element('div', `kn-bk-status kn-bk-status-${state.bookingStatus.kind}`, state.bookingStatus.text));
    }
    const actions = element('div', 'kn-bk-actions');
    const canDiary = draft.key !== INBOUND_KEY;
    const insert = button('Insert into Call Notes', 'kn-primary', () => (canDiary ? insertAndBook(draft) : insertBooking(draft)));
    insert.title = canDiary ? 'Puts the booking into Call Notes, books it in the diary and sets the outcome' : '';
    bookingRefs.insert = insert;
    actions.appendChild(insert);
    if (canDiary) {
      const notesOnly = button('Notes only', 'kn-bk-small', () => { if (insertBooking(draft)) offerSheetRow(draft); });
      notesOnly.title = 'Only puts the booking into Call Notes';
      bookingRefs.notesOnly = notesOnly;
      actions.appendChild(notesOnly);
      const diary = button(diaryRun ? 'Booking...' : 'Diary only', 'kn-bk-small', async () => {
        await bookInDiary(draft);
        offerSheetRow(draft);
      });
      diary.title = 'Only books the open lead in the diary (first free person at the booking time) and sets its outcome';
      bookingRefs.diary = diary;
      actions.appendChild(diary);
    }
    const clearsNotes = draft.key !== INBOUND_KEY;
    const clear = button(clearsNotes ? 'Clear notes and form' : 'Clear form', 'kn-danger kn-bk-small', () => {
      const notesLength = clearsNotes ? String(callNotesBox()?.value || '').length : 0;
      if (notesLength && !confirm(`Empty the whole Call Notes box (${notesLength} characters, not only the booking) and reset this booking form?`)) return;
      const removed = draft.key === INBOUND_KEY ? 0 : clearCallNotes();
      if (draft.key === INBOUND_KEY) {
        forgetInboundCustomer();
        inbound.pending = false;
      }
      const isInbound = draft.key === INBOUND_KEY;
      state.booking = { ...draft, data: blankBooking(), fromLead: {}, notices: [], inserted: null, diaryBooked: null, diaryRepeat: false, typedUsed: [], leadRequestUsed: true, leadSeen: {}, openSection: isInbound ? 'customer' : 'type' };
      syncLead(state.booking);
      saveDraftNow();
      state.bookingStatus = isInbound ? { kind: 'ok', text: 'Booking and customer details cleared.' } : removed < 0
        ? { kind: 'error', text: 'Couldn\'t find the Call Notes box, so it was not cleared. The booking form was reset.' }
        : { kind: 'ok', text: removed ? `Cleared Call Notes (${removed} characters). Ctrl+Z in Call Notes undoes it.` : 'Call Notes was already empty. Booking form reset.' };
      renderPalette();
    });
    clear.title = clearsNotes
      ? 'Empties the whole Call Notes box and resets this booking form. Asks first; Ctrl+Z in Call Notes undoes it.'
      : 'Resets this booking form and the customer details typed here';
    actions.appendChild(clear);
    if (ownerTools() && canDiary && draft.inserted) {
      const sheet = button('Booking sheet row', 'kn-bk-small kn-bk-sheet-row', () => offerSheetRow(draft));
      sheet.title = 'Brings back the Copy booking sheet row button. Nothing is copied until you press that.';
      actions.appendChild(sheet);
    }
    footer.appendChild(actions);
    palette.appendChild(footer);
    const versionRow = element('div', 'kn-foot kn-bk-version');
    versionRow.appendChild(element('span', '', `Konnect Notes v${KN.version}`));
    const links = element('span', 'kn-foot-links');
    links.appendChild(footLink('Report a problem', '', reportProblem));
    links.appendChild(footLink('Stop Konnect Notes', 'Stops Konnect Notes without refreshing the page. Booking drafts are kept.', () => stopKonnectNotes()));
    versionRow.appendChild(links);
    palette.appendChild(versionRow);

    updateBookingLive(draft);
    if (state.bookingScroll) body.scrollTop = state.bookingScroll;
    body.addEventListener('scroll', () => { state.bookingScroll = body.scrollTop; });
  }

  function openBooking() {
    if (!ownerTools()) return;
    checkForUpdate(false);
    scanPage();
    if (!state.target && !inboundContext()) return;
    if (!state.target) noteInboundCall();
    state.open = true;
    state.view = 'booking';
    state.bookingStatus = null;
    state.bookingScroll = 0;
    const draft = currentDraft();
    if (!draft.openSection && bookingEngine()) draft.openSection = nextMissingSection(draft);
    offerTypedNotes(draft);
    if (bookingEngine()) {
      syncLead(draft);
    } else {
      loadBookingEngine().then(() => {
        syncLead(currentDraft());
        if (state.open && state.view === 'booking') renderPalette();
      }).catch(() => {});
    }
    renderPalette();
    focusPalette();
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
    dealer: '',
    callAt: 0,
    callLead: ''
  };

  /* Owner only. The builder was opened, or the customer searched, on the
     inbound screens: the next lead whose Call Notes appears is that call's
     lead, whether it is new or one the customer already had. */
  function noteInboundCall() {
    if (ownerTools()) inbound.callAt = Date.now();
  }
  function claimInboundCall() {
    if (!inbound.callAt || !state.target) return;
    if (Date.now() - inbound.callAt <= INBOUND_MAX_AGE) inbound.callLead = leadKey();
    inbound.callAt = 0;
  }

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

  /* Konnect's customer search box: by its field name, else the text box
     closest to the Search button. */
  function findSearchBox(button) {
    const candidates = Array.from(document.querySelectorAll('input'))
      .filter((input) => isVisible(input) && !input.closest(`#${PALETTE_ID}`) && !input.closest('.modal') &&
        /^(text|search|tel|)$/i.test(input.getAttribute('type') || ''));
    const named = candidates.find((input) => /search/i.test(`${input.getAttribute('ng-model') || ''} ${input.id} ${input.name} ${input.placeholder}`));
    if (named) return named;
    const target = button.getBoundingClientRect();
    const distance = (input) => {
      const rect = input.getBoundingClientRect();
      return Math.hypot(rect.right - target.left, (rect.top + rect.height / 2) - (target.top + target.height / 2));
    };
    return candidates.sort((a, b) => distance(a) - distance(b))[0] || null;
  }

  /* What the customer search results currently show, to tell whether a
     search actually ran. */
  function searchResultsSnapshot() {
    const table = Array.from(document.querySelectorAll('table'))
      .find((node) => /best number/i.test(node.tHead?.textContent || node.textContent.slice(0, 400)));
    if (!table) return 'no-table';
    return `${table.tBodies[0]?.rows.length || 0}:${normaliseText(table.tBodies[0]?.textContent || '').length}:${normaliseText(table.tBodies[0]?.textContent || '').slice(0, 200)}`;
  }

  /* Puts the query in Konnect's search box and runs the search. */
  async function runKonnectSearch(input, button, query) {
    setLeadControl(input, query);
    const ng = window.angular;
    try {
      /* Make Konnect's model take the number now, even if the box waits for a pause or blur. */
      const model = ng ? ng.element(input).controller('ngModel') : null;
      if (model) {
        model.$setViewValue(query);
        if (typeof model.$commitViewValue === 'function') model.$commitViewValue();
        const scope = ng.element(input).scope();
        if (scope && !scope.$$phase && !scope.$root?.$$phase) scope.$apply();
      }
    } catch (error) {
      // The input/change events from setLeadControl still apply.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      /* Run the same function the Search button runs, with the number. */
      const scope = ng ? ng.element(button).scope() : null;
      if (scope && typeof scope.searchCustomers === 'function') {
        scope.$apply(() => scope.searchCustomers(query));
        return;
      }
    } catch (error) {
      // Fall back to the button below.
    }
    await waitFor(() => !button.disabled && !button.classList.contains('disabled'), 1500);
    button.click();
    ['keydown', 'keypress', 'keyup'].forEach((type) =>
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
  }

  /* Presses Customer Call first when needed, then searches by mobile (or name). */
  async function searchKonnect() {
    const c = inbound.customer;
    const query = realText(c.mobile).replace(/[^\d+]/g, '').replace(/^\+44/, '0') || realText(c.name);
    if (!query) {
      showToast('Add a mobile or name first');
      return;
    }
    noteInboundCall();
    const visibleSearch = () => {
      const button = document.getElementById('btnSearchCustomers');
      return button && isVisible(button) ? button : null;
    };
    let button = visibleSearch();
    if (!button) {
      const customerCall = Array.from(document.querySelectorAll('button[ng-click="setCallType(\'Customer\')"]')).find(isVisible);
      if (!customerCall) {
        showToast('Accept the call first, then search');
        return;
      }
      customerCall.click();
      button = await waitFor(visibleSearch, 3000);
      /* Give the customer search a moment to finish appearing. */
      if (button) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!button) {
      showToast('The customer search did not open');
      return;
    }
    const input = await waitFor(() => findSearchBox(button), 1500);
    if (!input) {
      showToast('Could not find the search box');
      return;
    }
    const before = searchResultsSnapshot();
    await runKonnectSearch(input, button, query);
    /* If the results did not change, the search was dropped: run it once more. */
    const changed = await waitFor(() => searchResultsSnapshot() !== before, 1500);
    if (!changed) {
      const freshButton = document.getElementById('btnSearchCustomers') || button;
      const freshInput = findSearchBox(freshButton) || input;
      await runKonnectSearch(freshInput, freshButton, query);
    }
    showToast(`Searched Konnect for ${query}`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const matches = searchMatches();
    if (matches) {
      state.bookingStatus = matchesStatus(matches);
      if (state.open && state.view === 'booking') renderPalette();
    }
  }

  /* The customers Konnect found, as "Name (Dealer)". One number can belong to
     several customers under different names or dealers, so every match is
     listed for the agent to check rather than one being picked. */
  function searchMatches() {
    const table = Array.from(document.querySelectorAll('table'))
      .find((node) => isVisible(node) && /best number/i.test(node.tHead?.textContent || node.textContent.slice(0, 400)));
    if (!table) return null;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => normaliseText(th.textContent).toLowerCase());
    const col = (pattern) => headers.findIndex((h) => pattern.test(h));
    const nameCol = col(/name/);
    const dealerCol = col(/dealer|site/);
    return Array.from(table.tBodies[0]?.rows || []).filter(isVisible).map((row) => {
      const cells = Array.from(row.cells).map((cell) => normaliseText(cell.innerText));
      const name = (nameCol >= 0 ? cells[nameCol] : cells.find((c) => c && !/\d{5,}/.test(c))) || 'Unnamed';
      const dealer = dealerCol >= 0 ? cells[dealerCol] : '';
      return dealer ? `${name} (${dealer})` : name;
    }).filter(Boolean);
  }

  function matchesStatus(matches) {
    if (!matches.length) return { kind: 'ok', text: 'No existing customer has this number. Create a new customer.' };
    const unique = Array.from(new Set(matches));
    const list = unique.slice(0, 5).join(', ') + (unique.length > 5 ? ` and ${unique.length - 5} more` : '');
    if (matches.length === 1) return { kind: 'warn', private: true, text: `1 existing customer has this number: ${list}. Check it is the same person and dealer before using it.` };
    return { kind: 'warn', private: true, text: `${matches.length} existing customers have this number: ${list}. Check the name and dealer before picking one.` };
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
    /* Saved straight away: anything wrong can be changed later in Edit Customer Details. */
    const saved = await saveCustomerModal(modal);
    showToast(saved
      ? `New customer saved (${filled.join(', ') || 'no changes'})`
      : `Filled ${filled.join(', ') || 'nothing new'} but it did not save. Check the form and press Save.`);
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
    const saved = await saveCustomerModal(modal);
    if (saved) {
      showToast(`Mobile added back and saved${filled.length ? ` (${filled.join(', ')})` : ''}`);
      forgetInboundCustomer();
      if (state.open && state.view === 'booking') renderPalette();
    } else {
      showToast('Filled the form but it did not save. Check it and press Save.');
    }
  }

  /* Presses Save on the customer form once Konnect allows it, and reports
     whether the form closed. */
  async function saveCustomerModal(modal) {
    const save = Array.from(modal.querySelectorAll('button[ng-click="ok()"]')).find(isVisible) ||
      Array.from(modal.querySelectorAll('button')).find((node) => isVisible(node) && normaliseText(node.textContent).toLowerCase() === 'save');
    if (!save) return false;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const ready = await waitFor(() => !save.disabled && !save.classList.contains('disabled'), 2500);
    if (!ready) return false;
    save.click();
    const closed = await waitFor(() => !modal.isConnected || !isVisible(modal), 4000);
    return Boolean(closed);
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
      fromInbound: true,
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
    searchRow.appendChild(button('Search', 'kn-bk-search-button', searchKonnect));
    body.appendChild(element('div', 'kn-bk-group', 'Contact'));
    body.appendChild(searchRow);
    body.appendChild(element('div', 'kn-muted kn-bk-gap', 'New customer? Add their details below and press Create new customer.'));
    body.appendChild(bkInput('Name', c.name, update('name')));
    body.appendChild(bkInput('Email', c.email, update('email')));
    body.appendChild(element('div', 'kn-bk-group', 'Address'));
    const row2 = element('div', 'kn-bk-row');
    row2.appendChild(bkInput('Postcode', c.postcode, update('postcode'), { className: 'kn-bk-narrow' }));
    row2.appendChild(bkInput('Address line 1', c.address1, update('address1')));
    body.appendChild(row2);

    /* Dealer and Brand share a row, so all seven fields fit without scrolling. */
    body.appendChild(element('div', 'kn-bk-group', 'Dealer and brand'));
    const row3 = element('div', 'kn-bk-row');
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
    row3.appendChild(dealerWrap);

    const brandWrap = element('label', 'kn-bk-field');
    brandWrap.appendChild(element('span', 'kn-bk-label', 'Brand'));
    const brand = element('select', 'kn-input');
    [['', 'Auto (vehicle make)'], ...KONNECT_BRANDS.map((name) => [name, name])].forEach(([value, label]) => {
      const option = element('option', '', label);
      option.value = value;
      if (value === c.brand) option.selected = true;
      brand.appendChild(option);
    });
    brand.addEventListener('change', () => { c.brand = brand.value; inbound.pending = true; changed(draft, true); });
    brand.addEventListener('keydown', (event) => event.stopPropagation());
    brandWrap.appendChild(brand);
    row3.appendChild(brandWrap);
    body.appendChild(row3);

    body.appendChild(button('Create new customer', 'kn-bk-add', fillCustomerForm));
    body.appendChild(element('div', 'kn-muted', 'Customer details stay in this page only and are wiped when the booking moves onto the new lead.'));
  }

  function renderMobileCard(draft, body) {
    if (!inbound.mobile || draft.key !== inbound.mobileLead) return;
    const card = element('div', 'kn-bk-notice');
    const text = element('div', 'kn-bk-notice-text', 'Mobile from the inbound call: ');
    text.appendChild(element('b', '', inbound.mobile));
    card.appendChild(text);
    const actions = element('div', 'kn-bk-notice-actions');
    actions.appendChild(button('Re-add mobile', 'kn-outline-accent', readdMobile));
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
    if (!inboundContext() || !ownerTools()) {
      if (launcher && launcher.style.display !== 'none') launcher.style.display = 'none';
      return;
    }
    const anchor = phoneColumnAnchor();
    /* Only what differs is written: every write here is seen by the page
       observer, which would otherwise scan again and loop for good. */
    const openHere = state.open && state.view === 'booking';
    const look = (baseClass, text, width, height) => {
      const className = openHere ? `${baseClass} kn-launcher-open` : baseClass;
      if (launcher.className !== className) launcher.className = className;
      if (launcher.textContent !== text) launcher.textContent = text;
      if (launcher.style.width !== width) launcher.style.width = width;
      if (launcher.style.height !== height) launcher.style.height = height;
      if (launcher.style.display !== '') launcher.style.display = '';
    };
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
      const size = anchor.getBoundingClientRect();
      look(`${keep.join(' ')} kn-ui kn-phone-launcher`, '\u26A1', `${Math.round(size.width)}px`, `${Math.round(size.height)}px`);
    } else {
      if (launcher.parentElement !== document.body) document.body.appendChild(launcher);
      look('kn-ui kn-inbound-launcher', '\u26A1 Booking', '', '');
    }
  }

  function renderPalette() {
    const palette = ensurePalette();
    palette.textContent = '';
    palette.classList.toggle('kn-open', state.open);
    markLaunchers();
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
    checkForUpdate(false);
    scanPage();
    if (!state.target) return;
    const active = document.activeElement;
    if (active === state.target || active === state.postClosureTarget) rememberSelection(active);
    state.open = true;
    state.view = 'main';
    state.attemptPhrase = null;
    state.otherAttemptOpen = false;
    renderPalette();
    focusPalette();
  }

  /* Focus moves into the palette when it opens, so its keys (1 to 5, B,
     Escape) are typed at the palette and never into a box on the page. */
  function focusPalette() {
    const palette = state.palette;
    if (!palette || !state.open || palette.contains(document.activeElement)) return;
    palette.focus({ preventScroll: true });
  }

  function closePalette() {
    if (state.booking) saveDraftNow();
    const hadFocus = !!state.palette && state.palette.contains(document.activeElement);
    state.open = false;
    state.attemptPhrase = null;
    state.otherAttemptOpen = false;
    if (state.palette) state.palette.classList.remove('kn-open');
    markLaunchers();
    /* Hand the caret back to the notes box it came from. */
    const last = state.lastSelection;
    if (hadFocus && last && last.target.isConnected && isVisible(last.target)) {
      last.target.focus({ preventScroll: true });
      last.target.setSelectionRange(last.start, last.end);
    }
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

  /* Takes a known block (the Initial Notes, say) out of other notes only
     where it appears as the same whole lines in the same order. Words inside
     a longer line are never touched. */
  function removeKnownNoteBlocks(value, knownValues) {
    let lines = cleanNoteLines(value);
    knownValues.forEach((known) => {
      const knownKeys = cleanNoteLines(known).map(noteLineKey);
      if (!knownKeys.length) return;
      const kept = [];
      for (let index = 0; index < lines.length;) {
        const matches = index + knownKeys.length <= lines.length &&
          knownKeys.every((key, offset) => noteLineKey(lines[index + offset]) === key);
        if (matches) index += knownKeys.length;
        else { kept.push(lines[index]); index += 1; }
      }
      lines = kept;
    });
    return lines.join('\n');
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

    /* A line is dropped only when an earlier box already gave it. Lines
       repeated inside one box ("No" under two questions, the same attempt
       twice) are real and stay. */
    const output = [];
    const seen = new Set();
    [initialLines, canonicalCallLines, existingLines, migratedCallLines, selectedLines].forEach((source) => {
      const keys = [];
      source.forEach((line) => {
        const key = noteLineKey(line);
        if (!key || seen.has(key)) return;
        keys.push(key);
        output.push(line);
      });
      keys.forEach((key) => seen.add(key));
    });
    return {
      postClosureValue: output.join('\n'),
      cleanCallValue: canonicalCallLines.join('\n'),
      shouldCleanCall: hasCanonicalCall &&
        noteValueKey(activeCallText) !== noteValueKey(canonicalCallLines.join('\n'))
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

  /* Nothing was written: say why where the agent is looking, as the
     palette is usually closed when a shorthand is typed. */
  function notWritten(message) {
    state.statusMessage = message;
    showToast(message, 'Nothing was written.');
    if (state.open) {
      state.view = 'browse';
      renderPalette();
    }
    return false;
  }

  /* Konnect's option wording may carry a dash, so only letters are compared. */
  function outcomeKey(text) {
    return normaliseText(text).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* Sets the call outcome when none is chosen yet. Returns { set: true },
     { left, change } for a different one already chosen (change sets it and
     is missing when the box does not offer it), or {} with nothing to say. */
  function applyCallOutcome(wanted) {
    const select = Array.from(document.querySelectorAll('select[ng-model="selected.CallOutcome"]')).find(isVisible);
    if (!wanted || !select) return {};
    const current = selectedText(select);
    const option = Array.from(select.options).find((item) => outcomeKey(item.textContent) === outcomeKey(wanted));
    const choose = () => !!(option && select.isConnected && setLeadControl(select, normaliseText(option.textContent)));
    if (!current) return choose() ? { set: true } : {};
    if (outcomeKey(current) === outcomeKey(wanted)) return {};
    return { left: current, change: option ? choose : null };
  }

  function callOutcomeChange(wanted, change) {
    return change ? { label: `Change to ${wanted}`, run: () => { if (change()) showToast(`Call outcome set: ${wanted}`); } } : null;
  }

  /* For everyone, as part of the call notes. Sets the call outcome a Call
     Notes phrase stands for. One already chosen is left alone unless the
     agent presses the button in the toast. Nothing else on the lead is
     touched. */
  function setCallOutcomeForNote(phrase) {
    const wanted = CALL_OUTCOME_FOR_PHRASE[phrase.id];
    const done = applyCallOutcome(wanted);
    if (done.set) showToast(`Call outcome set: ${wanted}`);
    else if (done.left) showToast(`Call outcome left as ${done.left}`, '', callOutcomeChange(wanted, done.change));
  }

  function leadSectionHeading(pane, title) {
    return Array.from(pane.querySelectorAll('a.accordion-toggle, a[ng-click="toggleOpen()"]'))
      .find((a) => isVisible(a) && normaliseText(a.textContent).toLowerCase() === title) || null;
  }

  /* Only one of the lead's sections is open at a time, so opening Outcomes
     folds Call Notes away. This opens Details again if it has to, and puts
     the typing position back where it was. */
  async function backToCallNotes(pane, target, caret) {
    const box = target.isConnected ? target : pane.querySelector('textarea[ng-model$="LeadDetails.Notes"]');
    if (!box) return false;
    if (!isVisible(box)) {
      leadSectionHeading(pane, 'details')?.click();
      await waitFor(() => isVisible(box), 3000);
    }
    if (!isVisible(box)) return false;
    box.focus({ preventScroll: true });
    const at = Math.min(caret, box.value.length);
    box.setSelectionRange(at, at);
    box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return box;
  }

  /* For everyone, as part of the call notes. After an Email Only note a
     person wrote: the call outcome, then the lead outcome on that note's
     lead, then back to Call Notes, with one toast for all of it. An outcome
     already chosen is left alone unless the agent presses the button in the
     toast ("force" is that press, which only sets the lead outcome). */
  let noteOutcomeRun = false;
  async function setOutcomesForNote(phrase, target, force) {
    const path = LEAD_OUTCOME_FOR_PHRASE[phrase.id];
    if (noteOutcomeRun || pxMoveRun || diaryRun) {
      if (!force) setCallOutcomeForNote(phrase);
      return;
    }
    noteOutcomeRun = true;
    const name = path[path.length - 1];
    const caret = target.selectionStart;
    const pane = target.closest('.tab-pane') || document;
    const said = [];
    const actions = [];
    let callSet = false;
    let leadSet = false;
    let box = null;
    const wantedCall = CALL_OUTCOME_FOR_PHRASE[phrase.id] || (NO_CALL_PHRASES.includes(phrase.id) ? NO_CALL_MADE : '');
    try {
      const call = force ? {} : applyCallOutcome(wantedCall);
      callSet = !!call.set;
      if (call.left) {
        said.push(`Call outcome left as ${call.left}`);
        const change = callOutcomeChange(wantedCall, call.change);
        if (change) actions.push(change);
      }
      const activity = leadScopeActivity(target);
      const lists = () => Array.from(pane.querySelectorAll(OUTCOME_LISTS))
        .filter((node) => isVisible(node) && leadScopeActivity(node) === activity);
      if (!lists().length) {
        /* A section that is open but still loading is not clicked, as that would fold it. */
        const heading = leadSectionHeading(pane, 'outcomes');
        const body = heading?.closest('.panel, .accordion-group')?.querySelector('.panel-collapse, .accordion-body');
        if (heading && !(body && body.classList.contains('in'))) heading.click();
      }
      const shown = await waitFor(() => (lists().length ? lists() : null), 3000);
      const current = (shown || []).map(selectedText);
      const differs = current.some((text, level) => text && lettersOnly(text) !== lettersOnly(path[level]));
      const complete = path.every((wanted, level) => lettersOnly(current[level]) === lettersOnly(wanted));
      if (!shown) {
        said.push('Lead outcome not set: the lead outcome lists did not appear');
      } else if (differs && !force) {
        said.push(`Lead outcome left as ${current.filter(Boolean).join(' > ')}`);
        actions.push({ label: `Change to ${name}`, run: () => setOutcomesForNote(phrase, target, true) });
      } else if (!complete) {
        const missed = await chooseLeadOutcome(pane, activity, path);
        /* The page redraws the lists after each choice, so they are read once more. */
        const stayed = missed < 0 && await waitFor(() => path.every((wanted, level) => lettersOnly(selectedText(lists()[level])) === lettersOnly(wanted)), 1500);
        if (missed >= 0) said.push(`Lead outcome not set: "${path[missed]}" could not be chosen`);
        else if (!stayed) said.push(`Lead outcome not set: it did not stay as ${name}`);
        else leadSet = true;
      }
    } catch (error) {
      said.push('Lead outcome not set: the page did not respond as expected');
    } finally {
      try { box = await backToCallNotes(pane, target, caret); } catch (error) { /* said below */ }
      noteOutcomeRun = false;
    }
    scanPage();
    if (box && box === state.target) {
      state.targetHadFocus = true;
      state.lastSelection = { target: box, start: box.selectionStart, end: box.selectionEnd };
    }
    if (callSet && leadSet) said.unshift(`Call outcome and lead outcome set: ${name}`);
    else if (callSet) said.unshift(`Call outcome set: ${wantedCall}`);
    else if (leadSet) said.push(`Lead outcome set: ${name}`);
    if (!box) said.push('Open Details yourself to get back to Call Notes');
    if (said.length) showToast(said.join('. '), '', actions);
  }

  /* Returns true when the phrase was written. "pressedByTool" is a key press
     another tool made, which sets no lead outcome. */
  function insertPhrase(phrase, attempt, rangeOverride, pressedByTool) {
    scanPage();
    const isCatchAll = phrase?.category === 'catch-all';
    const target = isCatchAll ? state.postClosureTarget : state.target;
    if (isCatchAll && !(target instanceof HTMLTextAreaElement)) {
      return notWritten('Post Closure Notes is not available on this lead.');
    }
    if (!(target instanceof HTMLTextAreaElement) || !phrase) return false;
    state.statusMessage = '';

    let text = String(phrase.text || '');
    if (phrase.requiresAttempt) {
      const number = Number(attempt);
      if (!Number.isInteger(number) || number < 1) return false;
      text = text.replaceAll('{{attempt}}', String(number));
    }

    if (text.includes('{{agent}}')) {
      const agent = ensureAgentName();
      if (!agent) return notWritten('No name is saved for signing notes, so nothing was written.');
      text = text.replaceAll('{{agent}}', agent);
    }

    let emailMissing = false;
    const usesTopEmail = phrase.emailSource === 'top' || text.includes('{{email}}');
    if (usesTopEmail) {
      const email = findTopEmail();
      emailMissing = !email;
      text = text.replaceAll('{{email}}', email ? ` ${email}` : '');
    }

    if (isCatchAll) {
      const postBefore = valueWithoutRange(target.value, rangeOverride);
      const plan = buildPostClosureNotes(text, postBefore);
      if (plan == null) {
        return notWritten('Initial Notes is empty or could not be read, so Post Closure Notes was not changed.');
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
      return true;
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
    if (LEAD_OUTCOME_FOR_PHRASE[phrase.id] && !pressedByTool) setOutcomesForNote(phrase, target);
    else setCallOutcomeForNote(phrase);
    return true;
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
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (target.selectionStart !== target.selectionEnd) return;
    const before = target.value.slice(0, target.selectionStart);
    /* A plain word shorthand only counts when it is the only thing on its
       line, so an ordinary word in a sentence ("book", "fin") is left alone.
       One with an attempt number ("vm1", "cnr2") is never an ordinary word,
       so it also counts at the end of a line after other words, and goes
       onto a line of its own. Lead Re setup presses the key itself after
       putting the word at the end of the box, which can follow a trailing
       space: its key presses (not trusted by the browser) keep the looser
       rule. */
    const loose = before.match(/(^|\s)([a-z][a-z0-9_-]*)$/i);
    const lineEndsHere = /^[ \t]*(?:\n|$)/.test(target.value.slice(target.selectionStart));
    const alone = lineEndsHere ? before.match(/(^|\n)[ \t]*([a-z][a-z0-9_-]*)$/i) : null;
    let match = event.isTrusted ? alone : loose;
    let found = match ? abbreviationMatch(match[2]) : null;
    if (!found && event.isTrusted && lineEndsHere && loose) {
      const numbered = abbreviationMatch(loose[2]);
      if (numbered && numbered.attempt !== null) { match = loose; found = numbered; }
    }
    if (!match || !found) return;
    /* The page may have changed lead since the last scan. */
    scanPage();
    if (target !== state.target && target !== state.postClosureTarget) return;
    const expectedTarget = found.phrase.category === 'catch-all'
      ? state.postClosureTarget
      : state.target;
    if (target !== expectedTarget) return;
    event.preventDefault();
    const end = target.selectionStart;
    const start = end - match[2].length;
    insertPhrase(found.phrase, found.attempt, { start, end }, !event.isTrusted);
  }

  function typingOutsidePalette(node) {
    if (!(node instanceof Element) || state.palette?.contains(node)) return false;
    return node.isContentEditable || /^(input|textarea|select)$/i.test(node.tagName);
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
        if (undo.callTarget instanceof HTMLTextAreaElement && undo.callTarget.value !== undo.callBefore) {
          setValueAndNotify(undo.callTarget, undo.callBefore);
        }
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
    if (ownerTools() && event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      if (state.open && state.view === 'booking') closePalette();
      else openBooking();
      return;
    }
    if (!state.open) return;
    if (state.view === 'booking' && (event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter') {
      event.preventDefault();
      bookingRefs?.insert?.click();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    /* The single-key shortcuts below must never take a character typed into
       a field on the page while the palette happens to be open. */
    if (typingOutsidePalette(event.target)) return;
    if (ownerTools() && state.view === 'main' && event.key.toLowerCase() === 'b' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openBooking();
      return;
    }
    if (state.view === 'main' && /^[1-5]$/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
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

  /* ---------- update notice ----------
     The page keeps running whichever version was loaded, so a newer one on
     main is announced instead of going unnoticed. The check revalidates the
     browser's cached copy, so an unchanged file costs a short "not modified"
     reply and not the whole script. */
  const UPDATE_CHECK_EVERY = 60 * 60 * 1000;
  const UPDATE_CHECK_ON_OPEN = 15 * 60 * 1000;
  let updateTimer = null;
  let firstUpdateCheck = null;
  let lastUpdateCheck = 0;
  function newerVersion(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }
  async function checkForUpdate(force) {
    if (state.updateAvailable || document.hidden) return;
    if (!force && Date.now() - lastUpdateCheck < UPDATE_CHECK_ON_OPEN) return;
    lastUpdateCheck = Date.now();
    try {
      const response = await fetch(`${BASE_URL}Konnect-Notes.js`, { cache: 'no-cache' });
      if (!response.ok) return;
      const match = (await response.text()).slice(0, 4000).match(/version:\s*'([\d.]+)'/);
      if (match && newerVersion(match[1], KN.version)) {
        state.updateAvailable = match[1];
        if (state.open) renderPalette();
      }
    } catch (error) {
      // Offline or blocked: try again at the next check.
    }
  }
  function renderUpdateNotice(body) {
    if (!state.updateAvailable) return;
    const card = element('div', 'kn-update', `Konnect Notes v${state.updateAvailable} is out (you have v${KN.version}). Stop it here, then press your bookmark to load the new one.`);
    const stop = button('Stop now', 'kn-bk-small', () => {
      stopKonnectNotes(`Konnect Notes stopped. Press your bookmark to load v${state.updateAvailable}`);
    });
    stop.style.marginTop = '6px';
    card.appendChild(element('div', '', ''));
    card.appendChild(stop);
    body.appendChild(card);
  }

  /* Fully unloads Konnect Notes from the page (UI, listeners, observer and
     the cached booking engine) so the bookmark can load a fresh copy
     without a page refresh. Drafts and settings stay in localStorage. */
  function stopKonnectNotes(message) {
    clearInterval(updateTimer);
    clearTimeout(firstUpdateCheck);
    try { if (state.booking) saveDraftNow(); } catch (error) { /* keep going */ }
    clearTimeout(state.scanTimer);
    clearTimeout(bookingSaveTimer);
    clearTimeout(bookingSyncTimer);
    if (diaryRun) diaryRun.stopped = true;
    if (state.observer) state.observer.disconnect();
    document.removeEventListener('keydown', handleAbbreviation, true);
    document.removeEventListener('keydown', handleGlobalKey, false);
    ['focusin', 'keyup', 'click', 'select', 'input'].forEach((type) =>
      document.removeEventListener(type, handleTargetActivity, true));
    ['change', 'focusout', 'click'].forEach((type) =>
      document.removeEventListener(type, onLeadActivity, true));
    window.removeEventListener('resize', positionPalette);
    forgetInboundCustomer();
    [PALETTE_ID, STYLE_ID, LAUNCHER_SECTION_ID, INBOUND_LAUNCHER_ID, SHEET_TOAST_ID].forEach((id) => document.getElementById(id)?.remove());
    try { delete window.KonnectNotes; } catch (error) { window.KonnectNotes = undefined; }
    showToast(typeof message === 'string' && message
      ? message : 'Konnect Notes stopped. Click the bookmark to load the latest version.');
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
  /* Pure builders, exposed for the tests. */
  KN.buildPostClosurePlan = buildPostClosurePlan;
  KN.mergeRemoteConfig = mergeRemoteConfig;
  KN.buildSheetRow = buildSheetRow;
  KN.sheetRowSelfTest = sheetRowSelfTest;
  KN.buildBookingCheck = buildBookingCheck;
  KN.mergeBookingChecks = mergeBookingChecks;
  KN.bookingCheckSelfTest = bookingCheckSelfTest;
  KN.recordBookingCheck = recordBookingCheck;

  init();
  updateTimer = setInterval(() => checkForUpdate(true), UPDATE_CHECK_EVERY);
  firstUpdateCheck = setTimeout(() => checkForUpdate(true), 20000);
})();
