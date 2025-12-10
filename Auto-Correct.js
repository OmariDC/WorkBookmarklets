// Auto-Correct Bookmarklet Engine
// Namespace initialization
const AC = window.AC = window.AC || {};

// ===================== Storage system =====================
AC.storage = {
  prefix: 'ac:',
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      // ignore
    }
  }
};

// ===================== AC.state initialisation =====================
AC.state = {
  enabled: AC.storage.read('enabled', true),
  customWords: AC.storage.read('customWords', {}),
  customPhrases: AC.storage.read('customPhrases', {}),
  logs: AC.storage.read('logs', []),
  stats: AC.storage.read('stats', { corrections: 0, lastCorrection: null }),
  recent: [],
  mergedWords: {},
  mergedPhrases: {},
  lastAction: null,
  editors: new WeakSet(),
  keyListeners: new WeakMap(),
  observer: null,
  ui: { root: null, overlay: null, open: false, tab: 'log' }
};

// ===================== Dictionary loading + merging =====================
AC.builtinWords = {
  teh: 'the',
  adn: 'and',
  seperate: 'separate',
  recieve: 'receive',
  adress: 'address',
  definate: 'definite',
  definately: 'definitely',
  ocurred: 'occurred',
  occured: 'occurred',
  occurence: 'occurrence',
  occurance: 'occurrence',
  embarass: 'embarrass',
  embarassed: 'embarrassed',
  goverment: 'government',
  enviroment: 'environment',
  responce: 'response',
  writting: 'writing',
  arguement: 'argument',
  beleive: 'believe',
  wierd: 'weird',
  existance: 'existence',
  firey: 'fiery',
  gratefull: 'grateful',
  independant: 'independent',
  liase: 'liaise',
  ocassion: 'occasion',
  ocasion: 'occasion',
  occassion: 'occasion',
  recieveing: 'receiving',
  recieveed: 'received',
  occurd: 'occurred',
  untill: 'until',
  wich: 'which',
  alot: 'a lot',
  kinda: 'kind of',
  sorta: 'sort of',
  cant: "can't",
  dont: "don't",
  wont: "won't",
  wouldnt: "wouldn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  wasnt: "wasn't",
  werent: "weren't",
  isnt: "isn't",
  im: "I'm",
  ive: "I've",
  ill: "I'll",
  id: "I'd",
  lets: "let's",
  youre: "you're",
  theyre: "they're",
  its: "it's",
  doesnt: "doesn't",
  didnt: "didn't",
  wouldntve: "wouldn't’ve",
  couldntve: "couldn’t’ve",
  shouldntve: "shouldn’t’ve"
};

AC.builtinPhrases = {
  infront: 'in front',
  eachother: 'each other',
  aswell: 'as well',
  atleast: 'at least',
  bytheway: 'by the way',
  thankyou: 'thank you',
  iloveyou: 'I love you',
  forsure: 'for sure',
  whatare: 'what are',
  dontknow: "don't know"
};

AC.mergeDictionaries = function () {
  AC.state.mergedWords = { ...AC.builtinWords, ...AC.state.customWords };
  AC.state.mergedPhrases = { ...AC.builtinPhrases, ...AC.state.customPhrases };
};
AC.mergeDictionaries();

// ===================== Time normalisation functions =====================
AC.toTwo = function (num) {
  return num.toString().padStart(2, '0');
};

AC.normalizeTime = function (word) {
  const lower = word.toLowerCase();
  const timeMatch = lower.match(/^(\d{1,2})(am|pm)$/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const suffix = timeMatch[2];
    if (suffix === 'pm' && h !== 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    return `${AC.toTwo(h)}:00`;
  }
  const colonMatch = lower.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = AC.toTwo(parseInt(colonMatch[1], 10));
    const m = AC.toTwo(parseInt(colonMatch[2], 10));
    if (parseInt(m, 10) >= 60 || parseInt(h, 10) >= 24) return null;
    return `${h}:${m}`;
  }
  return null;
};

AC.normalizeTimeLoose = function (word) {
  const compact = word.match(/^(\d{1,2})(am|pm)$/);
  if (compact) return AC.normalizeTime(word);
  const match = word.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const h = AC.toTwo(parseInt(match[1], 10));
    const m = AC.toTwo(parseInt(match[2], 10));
    if (parseInt(m, 10) >= 60 || parseInt(h, 10) >= 24) return null;
    return `${h}:${m}`;
  }
  return AC.normalizeTime(word);
};

AC.state.logs = AC.state.logs.filter(e => !/\d/.test(e.word) || AC.normalizeTimeLoose(e.word));

// ===================== Word + phrase correction functions =====================
AC.applyCapitalization = function (original, replacement) {
  if (!replacement) return replacement;
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

AC.correctWord = function (word) {
  const time = AC.normalizeTimeLoose(word);
  if (time) return time;

  const words = AC.state.mergedWords;
  const phrases = AC.state.mergedPhrases;

  const lower = word.toLowerCase();
  const phraseKeys = Object.keys(phrases).sort((a, b) => b.length - a.length);
  for (const p of phraseKeys) {
    if (lower.endsWith(p)) {
      return AC.applyCapitalization(word, phrases[p]);
    }
  }

  let correction = null;
  if (phrases[lower]) correction = AC.applyCapitalization(word, phrases[lower]);
  if (!correction && words[lower]) correction = AC.applyCapitalization(word, words[lower]);
  if (!correction && lower === 'i') correction = 'I';
  if (correction === word) {
    const cap = AC.applyCapitalization(word, correction);
    if (cap !== word) correction = cap; else return null;
  }
  return correction;
};

// ===================== Caret handling functions =====================
AC.getSelectionRange = function (el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { start: el.selectionStart || 0, end: el.selectionEnd || 0 };
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0);
};

AC.setSelectionRange = function (el, range) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setSelectionRange(range, range);
    return;
  }
  const sel = window.getSelection();
  if (!sel || typeof range === 'number') return;
  sel.removeAllRanges();
  sel.addRange(range);
};

AC.replaceRange = function (el, start, end, text) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const value = el.value;
    el.value = value.slice(0, start) + text + value.slice(end);
    AC.setSelectionRange(el, start + text.length);
    return;
  }
  const range = AC.createRangeForContentEditable(el, start, end);
  if (!range) return;
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  const newRange = document.createRange();
  newRange.setStart(range.endContainer, range.endOffset);
  newRange.collapse(true);
  AC.setSelectionRange(el, newRange);
};

AC.createRangeForContentEditable = function (el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let current = walker.nextNode();
  let index = 0;
  let range = document.createRange();
  while (current) {
    const nextIndex = index + current.textContent.length;
    if (start >= index && start <= nextIndex) {
      range.setStart(current, start - index);
    }
    if (end >= index && end <= nextIndex) {
      range.setEnd(current, end - index);
      break;
    }
    index = nextIndex;
    current = walker.nextNode();
  }
  return range;
};

AC.getTextAndCursor = function (el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { text: el.value, pos: el.selectionStart || 0 };
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { text: el.textContent || '', pos: 0 };
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.endContainer, range.endOffset);
  const pos = preRange.toString().length;
  return { text: el.textContent || '', pos };
};

// ===================== Logging engine =====================
AC.appendLog = function (word, snapshot) {
  const words = AC.state.mergedWords;
  const phrases = AC.state.mergedPhrases;
  const lower = word.toLowerCase();
  if (words[lower] || phrases[lower]) return;
  if (AC.normalizeTimeLoose(word)) return;
  if (/\d/.test(word) && !AC.normalizeTimeLoose(word)) return;
  if (phrases[word.toLowerCase()]) return;

  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const duplicate = AC.state.logs.find(l => l.word === word && l.day === dayKey);
  if (duplicate) return;

  const entry = { word, snapshot, timestamp: now.toISOString(), day: dayKey };
  AC.state.logs.push(entry);
  if (AC.state.logs.length > 500) {
    AC.state.logs.shift();
  }
  AC.storage.write('logs', AC.state.logs);
};

// ===================== Autocorrect processing engine =====================
AC.process = function (el, triggerChar) {
  if (!AC.state.enabled) return;
  const { text, pos } = AC.getTextAndCursor(el);
  const before = text.slice(0, pos);
  const match = before.match(/(\S+)(\s*)$/);
  if (!match) return;
  const word = match[1];
  const start = match.index || 0;
  const end = start + word.length;
  const correction = AC.correctWord(word);
  if (!correction) {
    AC.appendLog(word, text.slice(Math.max(0, start - 20), Math.min(text.length, end + 20)));
    return;
  }
  if (correction === word) return;

  const tail = text.slice(end, pos);
  const trailingSpaces = match[2] || '';
  const newText = correction + trailingSpaces + (word.match(/\s*$/)?.[0] || '') + tail;
  AC.state.lastAction = { el, start, replacementLength: newText.length, original: text.slice(start, pos) };
  AC.replaceRange(el, start, pos, newText);
  AC.state.stats.corrections += 1;
  AC.state.stats.lastCorrection = new Date().toISOString();
  AC.storage.write('stats', AC.state.stats);
  AC.state.recent.push({ from: word, to: correction, at: AC.state.stats.lastCorrection });
  if (AC.state.recent.length > 50) AC.state.recent.shift();
};

AC.handleKey = function (event) {
  const triggers = [' ', '.', ',', '?', '!', 'Enter'];
  const el = event.target;
  if (!triggers.includes(event.key)) return;
  setTimeout(() => {
    AC.process(el, event.key === 'Enter' ? '' : event.key);
  }, 0);
};

AC.undoLastCorrection = function () {
  const action = AC.state.lastAction;
  if (!action || !action.el) return;
  AC.replaceRange(action.el, action.start, action.start + action.replacementLength, action.original);
  AC.state.lastAction = null;
};

// ===================== Editor binding functions =====================
AC.isEditable = function (el) {
  if (!(el instanceof Element)) return false;
  if (el.dataset && el.dataset.acAttached) return false;
  if (el.matches('textarea, input[type="text"], input[type="search"], [contenteditable], .ql-editor, div[role="textbox"]')) {
    return true;
  }
  return false;
};

AC.bindEditor = function (el) {
  if (AC.state.editors.has(el)) return;
  if (AC.state.keyListeners.has(el)) return;
  el.dataset.acAttached = '1';
  const listener = AC.handleKey.bind(AC);
  el.addEventListener('keydown', listener);
  AC.state.editors.add(el);
  AC.state.keyListeners.set(el, listener);
};

AC.scanExisting = function () {
  const selectors = '.ql-editor, div[role="textbox"], [contenteditable], textarea, input[type="text"], input[type="search"]';
  document.querySelectorAll(selectors).forEach(el => {
    if (!AC.state.editors.has(el)) AC.bindEditor(el);
  });
};

// ===================== Mutation observer =====================
AC.startObserver = function () {
  if (AC.state.observer) return;
  AC.state.observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (AC.isEditable(node)) AC.bindEditor(node);
        node.querySelectorAll && node.querySelectorAll('.ql-editor, div[role="textbox"], [contenteditable], textarea, input[type="text"], input[type="search"]').forEach(el => {
          if (AC.isEditable(el)) AC.bindEditor(el);
        });
      });
    });
  });
  AC.state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
};

// ===================== UI sidebar + mapping panel =====================
AC.buildUI = function () {
  if (AC.state.ui.root) return;
  const style = document.createElement('style');
  style.textContent = `
    .ac-ui *, .ac-ui *::before, .ac-ui *::after { box-sizing: border-box; }
    .ac-sidebar-old { position: fixed; top: 0; left: 0; width: 280px; height: 100vh; background: #1e1d49; color: #fff; z-index: 99999; transform: translateX(-100%); transition: transform 0.25s ease, opacity 0.25s ease; opacity: 0; display: flex; flex-direction: column; font-family: Arial, sans-serif; box-shadow: 4px 0 10px rgba(0,0,0,0.4); }
    .ac-sidebar-old.ac-open { transform: translateX(0); opacity: 1; }
    .ac-header-old { padding: 12px 14px; background: #483a73; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    .ac-tabs-old { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 4px; border-bottom: 1px solid #bdbde3; }
    .ac-tab-old { background: #34416a; color: #fff; padding: 6px 10px; border: 1px solid #bdbde3; border-radius: 3px; cursor: pointer; font-size: 12px; transition: background 0.2s; }
    .ac-tab-old.ac-active { background: #483a73; border-color: #f9772e; }
    .ac-undo { margin: 0 12px 8px; padding: 6px 10px; background: #34416a; color: #fff; border: 1px solid #bdbde3; border-radius: 3px; cursor: pointer; }
    .ac-content-old { flex: 1; overflow: auto; padding: 10px 12px; }
    .ac-floating-old { position: fixed; bottom: 24px; left: 24px; width: 24px; height: 24px; aspect-ratio: 1 / 1; background: #f9772e; color: #1e1d49; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 6px 12px rgba(0,0,0,0.35); z-index: 100000; font-weight: bold; }
    .ac-list-old { list-style: none; padding: 0; margin: 0; }
    .ac-list-old li { padding: 6px 0; border-bottom: 1px solid #bdbde3; font-size: 12px; }
    .ac-input-old { width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid #bdbde3; background: #34416a; color: #fff; margin-bottom: 8px; }
    .ac-button-old { background: #34416a; color: #fff; border: 1px solid #bdbde3; padding: 6px 10px; border-radius: 4px; cursor: pointer; }
    .ac-row-old { display: flex; gap: 6px; margin-bottom: 8px; }
    .ac-mapping-panel { position: fixed; top: 0; right: 0; width: 320px; height: 100vh; background: #1e1d49; color: #fff; z-index: 99998; transform: translateX(100%); transition: transform 0.25s ease, opacity 0.25s ease; opacity: 0; padding: 12px; box-shadow: -4px 0 10px rgba(0,0,0,0.4); font-family: Arial, sans-serif; }
    .ac-mapping-panel.ac-open { transform: translateX(0); opacity: 1; }
    .ac-scrollbar-old::-webkit-scrollbar { width: 8px; }
    .ac-scrollbar-old::-webkit-scrollbar-thumb { background: #483a73; border-radius: 4px; }
    .ac-scrollbar-old::-webkit-scrollbar-track { background: #1e1d49; }
  `;
  document.head.appendChild(style);

  const sidebar = document.createElement('div');
  sidebar.className = 'ac-sidebar-old ac-ui ac-scrollbar-old';

  const header = document.createElement('div');
  header.className = 'ac-header-old';
  const title = document.createElement('div');
  title.textContent = 'Auto-Correct';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.className = 'ac-button-old';
  closeBtn.style.padding = '4px 8px';
  closeBtn.addEventListener('click', () => AC.toggleUI(false));
  header.appendChild(title);
  header.appendChild(closeBtn);

  const tabBar = document.createElement('div');
  tabBar.className = 'ac-tabs-old';
  const tabs = ['log', 'recent', 'stats', 'export', 'dictionary', 'settings'];
  tabs.forEach(id => {
    const btn = document.createElement('button');
    btn.className = 'ac-tab-old';
    btn.dataset.tab = id;
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.addEventListener('click', () => AC.switchTab(id));
    tabBar.appendChild(btn);
  });

  const undoBtn = document.createElement('button');
  undoBtn.className = 'ac-undo';
  undoBtn.textContent = 'Undo last correction';
  undoBtn.addEventListener('click', () => AC.undoLastCorrection());

  const content = document.createElement('div');
  content.className = 'ac-content-old ac-scrollbar-old';

  sidebar.appendChild(header);
  sidebar.appendChild(tabBar);
  sidebar.appendChild(undoBtn);
  sidebar.appendChild(content);

  const floating = document.createElement('div');
  floating.className = 'ac-floating-old';
  floating.textContent = 'AC';
  floating.addEventListener('click', () => AC.toggleUI());

  const mappingPanel = document.createElement('div');
  mappingPanel.className = 'ac-mapping-panel ac-scrollbar-old';

  document.body.appendChild(sidebar);
  document.body.appendChild(mappingPanel);
  document.body.appendChild(floating);

  AC.state.ui.root = sidebar;
  AC.state.ui.mapping = mappingPanel;
  AC.state.ui.content = content;
  AC.state.ui.tabs = tabBar.querySelectorAll('.ac-tab-old');

  AC.renderCurrentTab();
  AC.renderMappingPanel();

  document.addEventListener('keydown', e => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      AC.toggleUI();
    }
  });
};

AC.toggleUI = function (force) {
  const next = typeof force === 'boolean' ? force : !AC.state.ui.open;
  AC.state.ui.open = next;
  if (!AC.state.ui.root) return;
  AC.state.ui.root.classList.toggle('ac-open', next);
};

AC.switchTab = function (id) {
  AC.state.ui.tab = id;
  AC.renderCurrentTab();
};

AC.renderCurrentTab = function () {
  if (!AC.state.ui.root) return;
  AC.state.ui.tabs.forEach(tab => tab.classList.toggle('ac-active', tab.dataset.tab === AC.state.ui.tab));
  AC.state.ui.content.innerHTML = '';
  const tab = AC.state.ui.tab;
  if (tab === 'log') AC.renderLog();
  if (tab === 'recent') AC.renderRecent();
  if (tab === 'stats') AC.renderStats();
  if (tab === 'export') AC.renderExport();
  if (tab === 'dictionary') AC.renderDictionary();
  if (tab === 'settings') AC.renderSettings();
};

AC.renderLog = function () {
  const sec = AC.state.ui.content;
  const list = document.createElement('ul');
  list.className = 'ac-list-old';
  AC.state.logs.slice().reverse().forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.word} — ${new Date(entry.timestamp).toLocaleString('en-GB', { hour12: false })}`;
    list.appendChild(li);
  });
  sec.appendChild(list);
};

AC.renderRecent = function () {
  const sec = AC.state.ui.content;
  const list = document.createElement('ul');
  list.className = 'ac-list-old';
  AC.state.recent.slice().reverse().forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.from} → ${entry.to} — ${new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })}`;
    list.appendChild(li);
  });
  if (!list.childElementCount) {
    const empty = document.createElement('div');
    empty.textContent = 'No recent corrections yet.';
    sec.appendChild(empty);
  }
  sec.appendChild(list);
};

AC.renderStats = function () {
  const sec = AC.state.ui.content;
  const p = document.createElement('div');
  p.textContent = `Corrections: ${AC.state.stats.corrections}`;
  const last = document.createElement('div');
  last.textContent = `Last: ${AC.state.stats.lastCorrection ? new Date(AC.state.stats.lastCorrection).toLocaleString('en-GB', { hour12: false }) : 'N/A'}`;
  sec.appendChild(p);
  sec.appendChild(last);
};

AC.renderDictionary = function () {
  const sec = AC.state.ui.content;
  const words = AC.state.mergedWords;
  const phrases = AC.state.mergedPhrases;
  const wordsList = document.createElement('ul');
  wordsList.className = 'ac-list-old';
  Object.entries(words).forEach(([k, v]) => {
    if (AC.builtinWords[k] === v) return;
    const li = document.createElement('li');
    li.textContent = `${k} → ${v}`;
    const btn = document.createElement('button');
    btn.className = 'ac-button-old';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      delete AC.state.customWords[k];
      AC.storage.write('customWords', AC.state.customWords);
      AC.mergeDictionaries();
      AC.renderCurrentTab();
    });
    li.appendChild(btn);
    wordsList.appendChild(li);
  });

  const phrasesList = document.createElement('ul');
  phrasesList.className = 'ac-list-old';
  Object.entries(phrases).forEach(([k, v]) => {
    if (AC.builtinPhrases[k] === v) return;
    const li = document.createElement('li');
    li.textContent = `${k} → ${v}`;
    const btn = document.createElement('button');
    btn.className = 'ac-button-old';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      delete AC.state.customPhrases[k];
      AC.storage.write('customPhrases', AC.state.customPhrases);
      AC.mergeDictionaries();
      AC.renderCurrentTab();
    });
    li.appendChild(btn);
    phrasesList.appendChild(li);
  });

  const wordRow = document.createElement('div');
  wordRow.className = 'ac-row-old';
  const miss = document.createElement('input');
  miss.placeholder = 'misspelling';
  miss.className = 'ac-input-old';
  const corr = document.createElement('input');
  corr.placeholder = 'correction';
  corr.className = 'ac-input-old';
  const addBtn = document.createElement('button');
  addBtn.className = 'ac-button-old';
  addBtn.textContent = 'Add word';
  addBtn.addEventListener('click', () => {
    if (!miss.value || !corr.value) return;
    AC.state.customWords[miss.value.toLowerCase()] = corr.value;
    AC.storage.write('customWords', AC.state.customWords);
    AC.mergeDictionaries();
    miss.value = '';
    corr.value = '';
    AC.renderCurrentTab();
  });
  wordRow.appendChild(miss);
  wordRow.appendChild(corr);
  wordRow.appendChild(addBtn);

  const phraseRow = document.createElement('div');
  phraseRow.className = 'ac-row-old';
  const pmiss = document.createElement('input');
  pmiss.placeholder = 'phrase misspelling';
  pmiss.className = 'ac-input-old';
  const pcorr = document.createElement('input');
  pcorr.placeholder = 'phrase correction';
  pcorr.className = 'ac-input-old';
  const padd = document.createElement('button');
  padd.className = 'ac-button-old';
  padd.textContent = 'Add phrase';
  padd.addEventListener('click', () => {
    if (!pmiss.value || !pcorr.value) return;
    AC.state.customPhrases[pmiss.value.toLowerCase()] = pcorr.value;
    AC.storage.write('customPhrases', AC.state.customPhrases);
    AC.mergeDictionaries();
    pmiss.value = '';
    pcorr.value = '';
    AC.renderCurrentTab();
  });
  phraseRow.appendChild(pmiss);
  phraseRow.appendChild(pcorr);
  phraseRow.appendChild(padd);

  const mapBtn = document.createElement('button');
  mapBtn.className = 'ac-button-old';
  mapBtn.textContent = 'Open mapping panel';
  mapBtn.addEventListener('click', () => AC.toggleMapping(true));

  sec.appendChild(document.createTextNode('Custom words'));
  sec.appendChild(wordsList);
  sec.appendChild(wordRow);
  sec.appendChild(document.createElement('hr'));
  sec.appendChild(document.createTextNode('Custom phrases'));
  sec.appendChild(phrasesList);
  sec.appendChild(phraseRow);
  sec.appendChild(mapBtn);
};

AC.renderExport = function () {
  const sec = AC.state.ui.content;
  const data = {
    customWords: AC.state.customWords,
    customPhrases: AC.state.customPhrases,
    logs: AC.state.logs,
    stats: AC.state.stats
  };
  const textarea = document.createElement('textarea');
  textarea.className = 'ac-input-old ac-scrollbar-old';
  textarea.style.height = '200px';
  textarea.value = JSON.stringify(data, null, 2);
  sec.appendChild(textarea);
};

AC.renderSettings = function () {
  const sec = AC.state.ui.content;
  const toggle = document.createElement('button');
  toggle.className = 'ac-button-old';
  toggle.textContent = AC.state.enabled ? 'Disable autocorrect' : 'Enable autocorrect';
  toggle.addEventListener('click', () => {
    AC.state.enabled = !AC.state.enabled;
    AC.storage.write('enabled', AC.state.enabled);
    AC.renderCurrentTab();
  });
  sec.appendChild(toggle);
};

AC.renderMappingPanel = function () {
  if (!AC.state.ui.mapping) return;
  const panel = AC.state.ui.mapping;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.style.marginBottom = '8px';
  title.textContent = 'Mapping panel';

  const search = document.createElement('input');
  search.className = 'ac-input-old';
  search.placeholder = 'Search canonical word';

  const results = document.createElement('div');
  results.className = 'ac-scrollbar-old';
  results.style.maxHeight = '180px';
  results.style.overflow = 'auto';
  const renderResults = () => {
    results.innerHTML = '';
    const term = search.value.toLowerCase();
    const items = Object.entries(AC.state.mergedWords).filter(([k, v]) => k.includes(term) || v.toLowerCase().includes(term)).slice(0, 50);
    items.forEach(([k, v]) => {
      const div = document.createElement('div');
      div.textContent = `${k} → ${v}`;
      results.appendChild(div);
    });
  };
  search.addEventListener('input', renderResults);
  renderResults();

  const miss = document.createElement('input');
  miss.className = 'ac-input-old';
  miss.placeholder = 'Misspelling';
  const canon = document.createElement('input');
  canon.className = 'ac-input-old';
  canon.placeholder = 'Canonical';

  const addBtn = document.createElement('button');
  addBtn.className = 'ac-button-old';
  addBtn.textContent = 'Add mapping';
  addBtn.addEventListener('click', () => {
    if (!miss.value || !canon.value) return;
    AC.state.customWords[miss.value.toLowerCase()] = canon.value;
    AC.storage.write('customWords', AC.state.customWords);
    AC.mergeDictionaries();
    AC.renderCurrentTab();
    miss.value = '';
    canon.value = '';
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ac-button-old';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => AC.toggleMapping(false));

  panel.appendChild(title);
  panel.appendChild(search);
  panel.appendChild(results);
  panel.appendChild(miss);
  panel.appendChild(canon);
  panel.appendChild(addBtn);
  panel.appendChild(closeBtn);
};

AC.toggleMapping = function (force) {
  if (!AC.state.ui.mapping) return;
  const panel = AC.state.ui.mapping;
  const next = typeof force === 'boolean' ? force : !panel.classList.contains('ac-open');
  panel.classList.toggle('ac-open', next);
  if (next) AC.renderMappingPanel();
};

// ===================== AC.init =====================
AC.init = function () {
  AC.mergeDictionaries();
  AC.scanExisting();
  AC.startObserver();
  AC.buildUI();
};

AC.init();
