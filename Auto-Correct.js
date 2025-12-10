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

AC.getDictionaries = function () {
  const words = { ...AC.builtinWords, ...AC.state.customWords };
  const phrases = { ...AC.builtinPhrases, ...AC.state.customPhrases };
  return { words, phrases };
};

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
  const { words, phrases } = AC.getDictionaries();
  const normalizedTime = AC.normalizeTimeLoose(word);
  if (normalizedTime) return normalizedTime;

  const lower = word.toLowerCase();
  if (phrases[lower]) return AC.applyCapitalization(word, phrases[lower]);
  if (words[lower]) return AC.applyCapitalization(word, words[lower]);
  if (lower === 'i') return 'I';
  return null;
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
  if (!selection || selection.rangeCount === 0) return { text: el.innerText || '', pos: 0 };
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.endContainer, range.endOffset);
  const pos = preRange.toString().length;
  return { text: el.innerText || '', pos };
};

// ===================== Logging engine =====================
AC.appendLog = function (word, snapshot) {
  const { words, phrases } = AC.getDictionaries();
  const lower = word.toLowerCase();
  if (words[lower] || phrases[lower]) return;
  if (AC.normalizeTimeLoose(word)) return;

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
  const match = before.match(/([^\s]+)\s*$/);
  if (!match) return;
  const word = match[1];
  const start = match.index || 0;
  const end = start + word.length;
  const correction = AC.correctWord(word);
  if (!correction || correction === word) {
    AC.appendLog(word, text.slice(Math.max(0, start - 20), Math.min(text.length, end + 20)));
    return;
  }

  const tail = text.slice(end, pos);
  const newText = correction + tail;
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

// ===================== Editor binding functions =====================
AC.isEditable = function (el) {
  if (!(el instanceof Element)) return false;
  if (el.dataset && el.dataset.acAttached) return false;
  if (el.matches('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [contenteditable=""], .ql-editor, div[role="textbox"]')) {
    return true;
  }
  return false;
};

AC.bindEditor = function (el) {
  if (AC.state.editors.has(el)) return;
  el.dataset.acAttached = '1';
  const listener = AC.handleKey.bind(AC);
  el.addEventListener('keydown', listener);
  AC.state.editors.add(el);
  AC.state.keyListeners.set(el, listener);
};

AC.scanExisting = function () {
  const selectors = '.ql-editor, div[role="textbox"], [contenteditable="true"], [contenteditable=""], textarea, input[type="text"], input[type="search"]';
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
        node.querySelectorAll && node.querySelectorAll('.ql-editor, div[role="textbox"], [contenteditable="true"], [contenteditable=""], textarea, input[type="text"], input[type="search"]').forEach(el => {
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
    .ac-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 99998; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
    .ac-overlay.ac-open { opacity: 1; pointer-events: auto; }
    .ac-sidebar { position: fixed; top: 0; left: 0; width: 360px; height: 100vh; background: #1e1d49; color: #fff; z-index: 99999; transform: translateX(-100%); transition: transform 0.25s ease; box-shadow: 3px 0 12px rgba(0,0,0,0.4); display: flex; flex-direction: column; font-family: Arial, sans-serif; }
    .ac-sidebar.ac-open { transform: translateX(0); }
    .ac-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #483a73; }
    .ac-tabs { display: flex; gap: 8px; padding: 8px 12px; flex-wrap: wrap; }
    .ac-tab { background: #34416a; border: 1px solid #bdbde3; color: #fff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .ac-tab.ac-active { background: #bdbde3; color: #1e1d49; }
    .ac-content { flex: 1; overflow: auto; padding: 12px; }
    .ac-section { display: none; }
    .ac-section.ac-active { display: block; }
    .ac-close { cursor: pointer; background: transparent; border: none; color: #fff; font-size: 16px; }
    .ac-floating { position: fixed; bottom: 24px; left: 24px; width: 48px; height: 48px; background: #483a73; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 6px 12px rgba(0,0,0,0.35); z-index: 100000; }
    .ac-list { list-style: none; padding: 0; margin: 0; }
    .ac-list li { padding: 6px 0; border-bottom: 1px solid #bdbde3; font-size: 12px; }
    .ac-input { width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid #bdbde3; background: #34416a; color: #fff; margin-bottom: 8px; }
    .ac-button { background: #34416a; color: #fff; border: 1px solid #bdbde3; padding: 6px 10px; border-radius: 4px; cursor: pointer; }
    .ac-row { display: flex; gap: 6px; margin-bottom: 8px; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'ac-overlay';
  overlay.addEventListener('click', () => AC.toggleUI(false));

  const sidebar = document.createElement('div');
  sidebar.className = 'ac-sidebar';

  const header = document.createElement('div');
  header.className = 'ac-header';
  const title = document.createElement('div');
  title.textContent = 'Auto-Correct';
  const close = document.createElement('button');
  close.className = 'ac-close';
  close.textContent = '×';
  close.addEventListener('click', () => AC.toggleUI(false));
  header.appendChild(title);
  header.appendChild(close);

  const tabs = ['log', 'recent', 'stats', 'export', 'dictionary', 'settings'];
  const tabBar = document.createElement('div');
  tabBar.className = 'ac-tabs';
  const content = document.createElement('div');
  content.className = 'ac-content';
  const sections = {};

  tabs.forEach(id => {
    const btn = document.createElement('div');
    btn.className = 'ac-tab';
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.addEventListener('click', () => AC.switchTab(id));
    btn.dataset.tab = id;
    tabBar.appendChild(btn);

    const section = document.createElement('div');
    section.className = 'ac-section';
    section.dataset.tab = id;
    sections[id] = section;
    content.appendChild(section);
  });

  sidebar.appendChild(header);
  sidebar.appendChild(tabBar);
  sidebar.appendChild(content);

  const floating = document.createElement('div');
  floating.className = 'ac-floating';
  floating.textContent = 'AC';
  floating.addEventListener('click', () => AC.toggleUI());

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);
  document.body.appendChild(floating);

  AC.state.ui.root = sidebar;
  AC.state.ui.overlay = overlay;
  AC.state.ui.sections = sections;
  AC.state.ui.tabs = tabBar.querySelectorAll('.ac-tab');

  AC.renderTabs();
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
  AC.state.ui.overlay.classList.toggle('ac-open', next);
  AC.renderTabs();
};

AC.switchTab = function (id) {
  AC.state.ui.tab = id;
  AC.renderTabs();
};

AC.renderTabs = function () {
  if (!AC.state.ui.root) return;
  AC.state.ui.tabs.forEach(tab => {
    tab.classList.toggle('ac-active', tab.dataset.tab === AC.state.ui.tab);
  });
  Object.entries(AC.state.ui.sections).forEach(([id, section]) => {
    section.classList.toggle('ac-active', id === AC.state.ui.tab);
  });
  AC.renderLog();
  AC.renderRecent();
  AC.renderStats();
  AC.renderDictionary();
  AC.renderExport();
  AC.renderSettings();
};

AC.renderLog = function () {
  const sec = AC.state.ui.sections.log;
  if (!sec) return;
  sec.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'ac-list';
  AC.state.logs.slice().reverse().forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.word} — ${new Date(entry.timestamp).toLocaleString()}`;
    list.appendChild(li);
  });
  sec.appendChild(list);
};

AC.renderRecent = function () {
  const sec = AC.state.ui.sections.recent;
  if (!sec) return;
  sec.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'ac-list';
  AC.state.recent.slice().reverse().forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.from} → ${entry.to} — ${new Date(entry.at).toLocaleTimeString()}`;
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
  const sec = AC.state.ui.sections.stats;
  if (!sec) return;
  sec.innerHTML = '';
  const p = document.createElement('div');
  p.textContent = `Corrections: ${AC.state.stats.corrections}`;
  const last = document.createElement('div');
  last.textContent = `Last: ${AC.state.stats.lastCorrection ? new Date(AC.state.stats.lastCorrection).toLocaleString() : 'N/A'}`;
  sec.appendChild(p);
  sec.appendChild(last);
};

AC.renderDictionary = function () {
  const sec = AC.state.ui.sections.dictionary;
  if (!sec) return;
  sec.innerHTML = '';
  const wordsList = document.createElement('ul');
  wordsList.className = 'ac-list';
  const { words, phrases } = AC.getDictionaries();
  Object.entries(words).forEach(([k, v]) => {
    if (AC.builtinWords[k] === v) return; // skip builtin
    const li = document.createElement('li');
    li.textContent = `${k} → ${v}`;
    const btn = document.createElement('button');
    btn.className = 'ac-button';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      delete AC.state.customWords[k];
      AC.storage.write('customWords', AC.state.customWords);
      AC.renderDictionary();
    });
    li.appendChild(btn);
    wordsList.appendChild(li);
  });

  const phrasesList = document.createElement('ul');
  phrasesList.className = 'ac-list';
  Object.entries(phrases).forEach(([k, v]) => {
    if (AC.builtinPhrases[k] === v) return;
    const li = document.createElement('li');
    li.textContent = `${k} → ${v}`;
    const btn = document.createElement('button');
    btn.className = 'ac-button';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      delete AC.state.customPhrases[k];
      AC.storage.write('customPhrases', AC.state.customPhrases);
      AC.renderDictionary();
    });
    li.appendChild(btn);
    phrasesList.appendChild(li);
  });

  const wordRow = document.createElement('div');
  wordRow.className = 'ac-row';
  const miss = document.createElement('input');
  miss.placeholder = 'misspelling';
  miss.className = 'ac-input';
  const corr = document.createElement('input');
  corr.placeholder = 'correction';
  corr.className = 'ac-input';
  const addBtn = document.createElement('button');
  addBtn.className = 'ac-button';
  addBtn.textContent = 'Add word';
  addBtn.addEventListener('click', () => {
    if (!miss.value || !corr.value) return;
    AC.state.customWords[miss.value.toLowerCase()] = corr.value;
    AC.storage.write('customWords', AC.state.customWords);
    miss.value = '';
    corr.value = '';
    AC.renderDictionary();
  });
  wordRow.appendChild(miss);
  wordRow.appendChild(corr);
  wordRow.appendChild(addBtn);

  const phraseRow = document.createElement('div');
  phraseRow.className = 'ac-row';
  const pmiss = document.createElement('input');
  pmiss.placeholder = 'phrase misspelling';
  pmiss.className = 'ac-input';
  const pcorr = document.createElement('input');
  pcorr.placeholder = 'phrase correction';
  pcorr.className = 'ac-input';
  const padd = document.createElement('button');
  padd.className = 'ac-button';
  padd.textContent = 'Add phrase';
  padd.addEventListener('click', () => {
    if (!pmiss.value || !pcorr.value) return;
    AC.state.customPhrases[pmiss.value.toLowerCase()] = pcorr.value;
    AC.storage.write('customPhrases', AC.state.customPhrases);
    pmiss.value = '';
    pcorr.value = '';
    AC.renderDictionary();
  });
  phraseRow.appendChild(pmiss);
  phraseRow.appendChild(pcorr);
  phraseRow.appendChild(padd);

  sec.appendChild(document.createTextNode('Custom words'));
  sec.appendChild(wordsList);
  sec.appendChild(wordRow);
  sec.appendChild(document.createElement('hr'));
  sec.appendChild(document.createTextNode('Custom phrases'));
  sec.appendChild(phrasesList);
  sec.appendChild(phraseRow);
};

AC.renderExport = function () {
  const sec = AC.state.ui.sections.export;
  if (!sec) return;
  sec.innerHTML = '';
  const data = {
    customWords: AC.state.customWords,
    customPhrases: AC.state.customPhrases,
    logs: AC.state.logs,
    stats: AC.state.stats
  };
  const textarea = document.createElement('textarea');
  textarea.className = 'ac-input';
  textarea.style.height = '200px';
  textarea.value = JSON.stringify(data, null, 2);
  sec.appendChild(textarea);
};

AC.renderSettings = function () {
  const sec = AC.state.ui.sections.settings;
  if (!sec) return;
  sec.innerHTML = '';
  const toggle = document.createElement('button');
  toggle.className = 'ac-button';
  toggle.textContent = AC.state.enabled ? 'Disable autocorrect' : 'Enable autocorrect';
  toggle.addEventListener('click', () => {
    AC.state.enabled = !AC.state.enabled;
    AC.storage.write('enabled', AC.state.enabled);
    AC.renderSettings();
  });
  sec.appendChild(toggle);
};

// ===================== AC.init =====================
AC.init = function () {
  AC.scanExisting();
  AC.startObserver();
  AC.buildUI();
};

AC.init();
