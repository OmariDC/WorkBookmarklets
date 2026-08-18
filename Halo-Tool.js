/*!
 * HALO Assistant — Prospect Reallocator
 * ---------------------------------------------------------------------------
 * WHAT THIS SCRIPT DOES
 *   Runs entirely inside the current browser tab. It only reads and
 *   interacts with the page's own DOM (search boxes, checkboxes, buttons,
 *   the native <select> dropdown). It makes no network requests of its own
 *   and stores no data outside this page — every action it performs is the
 *   same click/type/change that a person could do by hand, just automated.
 *
 * HOW IT'S LOADED
 *   This file is fetched by a tiny bookmarklet (see halo-bookmarklet.txt)
 *   via a <script src> tag pointed at the raw GitHub URL, so re-running the
 *   bookmarklet always pulls whatever is currently published here.
 *
 * PAGE RECOGNITION
 *   PAGE_MODULES below is a small registry. Each entry knows how to detect
 *   one page (by URL pattern) and how to mount its own tool. Only the
 *   module whose `matches()` returns true for the current page is used.
 *   Part 1 (this file) implements the Prospect Manager page. A second
 *   entry can be added later for part 2 without touching this one.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // Re-running the bookmarklet on the same page should just reopen the
  // panel instead of injecting a second copy of everything.
  if (window.__haloAssistant && window.__haloAssistant.toggle) {
    window.__haloAssistant.toggle();
    return;
  }

  // ===========================================================================
  // Small cancellable-async utilities
  // ===========================================================================
  // Every wait in this script goes through `sleep`/`waitFor`, and both check
  // `state.cancelled` and are backed by timers registered in `state.timers`.
  // Hitting Cancel flips the flag, clears every pending timer/observer, and
  // any in-flight `await` unwinds immediately via the rejected promise — so
  // nothing keeps running in the background after Cancel is pressed.
  const state = {
    running: false,
    cancelled: false,
    timers: new Set(),
    observers: new Set(),
  };

  function clearAllTimers() {
    state.timers.forEach((id) => clearTimeout(id));
    state.timers.clear();
  }

  function clearAllObservers() {
    state.observers.forEach((o) => {
      try { o.disconnect(); } catch (e) { /* noop */ }
    });
    state.observers.clear();
  }

  function sleep(ms) {
    return new Promise((resolve, reject) => {
      if (state.cancelled) { reject(new Error('cancelled')); return; }
      const id = setTimeout(() => {
        state.timers.delete(id);
        if (state.cancelled) reject(new Error('cancelled'));
        else resolve();
      }, ms);
      state.timers.add(id);
    });
  }

  async function waitFor(predicate, { timeout = 6000, interval = 150 } = {}) {
    const start = Date.now();
    while (true) {
      if (state.cancelled) throw new Error('cancelled');
      let value;
      try { value = predicate(); } catch (e) { value = null; }
      if (value) return value;
      if (Date.now() - start > timeout) throw new Error('Timed out waiting for the page to respond.');
      await sleep(interval);
    }
  }

  // ===========================================================================
  // DOM helpers that dispatch real, user-shaped events
  // ===========================================================================
  // These never touch anything outside this tab's DOM. Text inputs use the
  // native property setter + 'input' event (the standard way to drive a
  // framework-controlled field), Enter is a full keydown/keypress/keyup
  // sequence, and the owner <select> is changed the same way a real
  // selection changes it: set value, fire 'input' + 'change'. Buttons are
  // triggered with the native .click() method (works fine for these).

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Plain checkbox.click() does NOT toggle this app's checkboxes — confirmed
  // live: calling .click() on the row checkbox leaves .checked === false and
  // the "Allocate (N)" button never appears, so the automation hangs waiting
  // for a button that will never show up. Something on the checkbox (or an
  // ancestor) intercepts the click and blocks the native default toggle
  // behaviour. Setting `checked` via the native property setter and firing
  // 'input' + 'change' ourselves — the same pattern already used for text
  // inputs above — reliably ticks the box and updates the Allocate count.
  function setNativeChecked(el, checked) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'checked');
    if (desc && desc.set) desc.set.call(el, checked);
    else el.checked = checked;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function selectOptionByText(selectEl, text) {
    const opt = Array.from(selectEl.options).find((o) => o.textContent.trim() === text);
    if (!opt) return false;
    const proto = Object.getPrototypeOf(selectEl);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(selectEl, opt.value);
    else selectEl.value = opt.value;
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function extractEmail(text) {
    const m = (text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0] : '';
  }

  function isValidEmail(text) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  }

  // ===========================================================================
  // Prospect Manager module (Part 1)
  // ===========================================================================
  const TARGET_OWNER = 'Sharon Helt';

  function findHeading(text) {
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .find((h) => h.textContent.trim() === text) || null;
  }

  // Walks the DOM in document order from `startEl` and returns the first
  // element after it that matches `selector`. Used to pair each "Search..."
  // box and <table> with the section heading immediately above it, since
  // the Unallocated and Allocated tables each have their own independent
  // search box.
  function findNextMatching(startEl, selector) {
    if (!startEl) return null;
    const all = document.body.querySelectorAll('*');
    let passed = false;
    for (const el of all) {
      if (el === startEl) { passed = true; continue; }
      if (passed && el.matches && el.matches(selector)) return el;
    }
    return null;
  }

  function getSearchInput(headingText) {
    const heading = findHeading(headingText);
    return heading ? findNextMatching(heading, 'input[placeholder="Search..."]') : null;
  }

  function getTable(headingText) {
    const heading = findHeading(headingText);
    return heading ? findNextMatching(heading, 'table') : null;
  }

  function getColumnIndex(table, headerName) {
    const cells = Array.from(table.querySelectorAll('thead th, thead td'));
    return cells.findIndex((c) => c.textContent.trim().toLowerCase() === headerName.toLowerCase());
  }

  // Each cell wraps its value in a <label> that also contains a visually-
  // hidden (ui-sr-only) column-name label sitting directly next to the value
  // with no separator — e.g. cell.textContent reads as
  // "Emailfinleydoodle25@outlook.com" instead of "finleydoodle25@outlook.com".
  // This strips those sr-only nodes out first so we read only the real value.
  function getCellValueText(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('[class*="sr-only"]').forEach((el) => el.remove());
    return clone.textContent.trim();
  }

  // Only ever looks at the FIRST body row, and requires an exact
  // (case-insensitive) email match — matching the requirement that
  // multiple fuzzy results may appear but only the first row counts.
  function findExactFirstRowMatch(table, email) {
    const emailIdx = getColumnIndex(table, 'Email');
    if (emailIdx === -1) return null;
    const row = table.querySelector('tbody tr');
    if (!row) return null;
    const cell = row.children[emailIdx];
    if (!cell) return null;
    const cellEmail = extractEmail(getCellValueText(cell)).toLowerCase();
    return cellEmail && cellEmail === email.toLowerCase() ? row : null;
  }

  // Polls the table's tbody text until it changes from `previousText` and
  // then holds steady for `requiredStable` consecutive polls in a row.
  // Requiring several stable polls (not just two) makes it much less likely
  // that a transient re-render — e.g. the table briefly redrawing for an
  // unrelated reason — gets mistaken for the real, settled search result.
  async function waitForTableUpdate(headingText, previousText, { timeout = 7000, requiredStable = 3, interval = 200 } = {}) {
    const start = Date.now();
    let lastText = null;
    let stableCount = 0;
    while (Date.now() - start < timeout) {
      if (state.cancelled) throw new Error('cancelled');
      const table = getTable(headingText);
      const tbody = table ? table.querySelector('tbody') : null;
      const current = tbody ? tbody.textContent : '';
      if (current !== previousText) {
        if (current === lastText) {
          stableCount++;
          if (stableCount >= requiredStable) return;
        } else {
          stableCount = 0;
          lastText = current;
        }
      }
      await sleep(interval);
    }
    // Timed out — proceed with whatever is currently on screen rather than
    // hanging forever; the exact-match check afterwards protects us from
    // acting on stale/incomplete results.
  }

  async function searchAndCheck(headingText, email) {
    const searchInput = getSearchInput(headingText);
    const tableBefore = getTable(headingText);
    if (!searchInput || !tableBefore) return null;
    const prevText = tableBefore.querySelector('tbody') ? tableBefore.querySelector('tbody').textContent : '';

    setNativeValue(searchInput, email);
    await sleep(60);
    pressEnter(searchInput);

    await waitForTableUpdate(headingText, prevText);

    const tableAfter = getTable(headingText); // re-read fresh in case React replaced the node
    const row = tableAfter ? findExactFirstRowMatch(tableAfter, email) : null;
    return row ? { row } : null;
  }

  function findPanelRoot(selectEl) {
    let node = selectEl;
    for (let i = 0; i < 10 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const buttons = Array.from(node.querySelectorAll('button'));
      if (buttons.some((b) => b.textContent.trim().toLowerCase() === 'back')) return node;
    }
    return selectEl.closest('div');
  }

  function findConfirmButton(panelRoot) {
    const buttons = Array.from(panelRoot.querySelectorAll('button'));
    return buttons.find((b) => {
      const t = b.textContent.trim().toLowerCase();
      return t && t !== 'back' && b.offsetParent !== null;
    });
  }

  async function allocateRow(row, actionPrefix) {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) throw new Error('Could not find the row checkbox.');
    if (!checkbox.checked) setNativeChecked(checkbox, true);
    await sleep(200);

    const btnRegex = new RegExp('^' + actionPrefix + '\\s*\\(\\d+\\)$', 'i');
    const actionBtn = await waitFor(
      () => Array.from(document.querySelectorAll('button'))
        .find((b) => btnRegex.test(b.textContent.trim()) && b.offsetParent !== null),
      { timeout: 4000 }
    );
    actionBtn.click();

    const selectEl = await waitFor(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      return selects.find((s) => s.offsetParent !== null
        && Array.from(s.options).some((o) => o.textContent.trim() === TARGET_OWNER));
    }, { timeout: 6000 });

    if (!selectOptionByText(selectEl, TARGET_OWNER)) {
      throw new Error('"' + TARGET_OWNER + '" was not found in the owner dropdown.');
    }
    await sleep(250);

    const panelRoot = findPanelRoot(selectEl);
    const confirmBtn = findConfirmButton(panelRoot);
    if (!confirmBtn) throw new Error('Could not find the confirm button on the panel.');
    confirmBtn.click();

    // The panel closing (its <select> leaving the DOM / becoming hidden) is
    // our success signal.
    await waitFor(() => !document.body.contains(selectEl) || selectEl.offsetParent === null, { timeout: 8000 });
    await sleep(400); // let the table settle before the next email
  }

  async function processEmail(email) {
    let match = await searchAndCheck('Unallocated Prospects', email);
    let actionPrefix = 'Allocate';
    if (!match) {
      match = await searchAndCheck('Allocated Prospects', email);
      actionPrefix = 'Reallocate';
    }
    if (!match) return { email, status: 'not-found' };
    await allocateRow(match.row, actionPrefix);
    return { email, status: 'success' };
  }

  // ===========================================================================
  // UI — floating button + panel, isolated in a shadow root
  // ===========================================================================
  function mountProspectReallocator() {
    const host = document.createElement('div');
    host.id = 'halo-assistant-host';
    host.style.all = 'initial';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, sans-serif; }
      .fab {
        position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
        background: #FACC15; color: #000; border: none; border-radius: 999px;
        padding: 12px 18px; font-weight: 600; font-size: 14px; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25); display: flex; align-items: center; gap: 8px;
      }
      .fab:hover { filter: brightness(0.96); }
      .panel {
        position: fixed; right: 24px; bottom: 88px; z-index: 2147483000;
        width: 380px; max-height: 70vh; background: #fff; border: 1px solid #e4e4e7;
        border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.25);
        display: none; flex-direction: column; overflow: hidden;
      }
      .panel.open { display: flex; }
      .panel-header {
        background: #18181b; color: #fff; padding: 12px 14px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .panel-header h2 { margin: 0; font-size: 14px; font-weight: 600; }
      .panel-header button {
        background: transparent; border: none; color: #fff; font-size: 16px;
        cursor: pointer; line-height: 1; padding: 2px 6px;
      }
      .panel-body { padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
      .panel-body label { font-size: 12px; font-weight: 600; color: #3f3f46; }
      textarea {
        width: 100%; min-height: 100px; resize: vertical; border: 1px solid #d4d4d8;
        border-radius: 6px; padding: 8px; font-size: 13px; font-family: inherit;
      }
      .owner-line { font-size: 12px; color: #52525b; }
      .owner-line b { color: #18181b; }
      .row { display: flex; gap: 8px; }
      button.primary {
        flex: 1; background: #FACC15; color: #000; border: none; border-radius: 6px;
        padding: 8px 12px; font-weight: 600; font-size: 13px; cursor: pointer;
      }
      button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
      button.cancel {
        flex: 1; background: #fff; color: #b91c1c; border: 1px solid #b91c1c; border-radius: 6px;
        padding: 8px 12px; font-weight: 600; font-size: 13px; cursor: pointer;
      }
      .hint { font-size: 11px; color: #71717a; }
      .progress { font-size: 12px; color: #3f3f46; }
      .log {
        background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px;
        font-family: ui-monospace, Menlo, monospace; font-size: 11px; line-height: 1.5;
        max-height: 160px; overflow-y: auto; white-space: pre-wrap;
      }
    `;
    root.appendChild(style);

    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.type = 'button';
    fab.innerHTML = '&#8646; Reallocate';
    root.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h2>Prospect Reallocator</h2>
        <button type="button" class="close" title="Hide panel (does not stop a running job)">&times;</button>
      </div>
      <div class="panel-body">
        <div>
          <label>Emails (one per line)</label>
          <textarea placeholder="jane@example.com&#10;john@example.com"></textarea>
        </div>
        <div class="owner-line">Reallocating to: <b>${TARGET_OWNER}</b></div>
        <div class="row">
          <button type="button" class="primary start">Start</button>
          <button type="button" class="cancel stop">Cancel</button>
        </div>
        <div class="hint">Cancel stops immediately, clears all pending steps, and leaves nothing running in the background.</div>
        <div class="progress"></div>
        <div class="log"></div>
      </div>
    `;
    root.appendChild(panel);

    const els = {
      textarea: panel.querySelector('textarea'),
      start: panel.querySelector('.start'),
      stop: panel.querySelector('.stop'),
      close: panel.querySelector('.close'),
      progress: panel.querySelector('.progress'),
      log: panel.querySelector('.log'),
    };

    function log(line) {
      const time = new Date().toLocaleTimeString();
      els.log.textContent += `[${time}] ${line}\n`;
      els.log.scrollTop = els.log.scrollHeight;
    }

    function setProgress(done, total) {
      els.progress.textContent = total ? `Progress: ${done} / ${total}` : '';
    }

    function setRunning(running) {
      els.start.disabled = running;
      els.textarea.disabled = running;
    }

    function togglePanel() {
      panel.classList.toggle('open');
    }

    fab.addEventListener('click', togglePanel);
    els.close.addEventListener('click', togglePanel);

    els.stop.addEventListener('click', () => {
      state.cancelled = true;
      clearAllTimers();
      clearAllObservers();
      state.running = false;
      setRunning(false);
      log('— Cancelled by user. Nothing further will run. —');
    });

    els.start.addEventListener('click', async () => {
      const lines = els.textarea.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const emails = [];
      lines.forEach((line) => {
        if (isValidEmail(line)) emails.push(line);
        else log(`Skipping invalid line: "${line}"`);
      });
      if (!emails.length) { log('No valid emails to process.'); return; }

      state.cancelled = false;
      state.running = true;
      setRunning(true);
      els.log.textContent = '';
      setProgress(0, emails.length);

      let success = 0, notFound = 0, failed = 0;
      for (let i = 0; i < emails.length; i++) {
        if (state.cancelled) break;
        const email = emails[i];
        log(`[${i + 1}/${emails.length}] ${email}`);
        try {
          const result = await processEmail(email);
          if (result.status === 'success') { success++; log(`  Reallocated to ${TARGET_OWNER}.`); }
          else { notFound++; log('  No exact match found in either table — skipped.'); }
        } catch (err) {
          if (state.cancelled || (err && err.message === 'cancelled')) break;
          failed++;
          log(`  Error: ${err && err.message ? err.message : err}`);
        }
        setProgress(i + 1, emails.length);
        if (state.cancelled) break;
        await sleep(400).catch(() => {});
      }

      state.running = false;
      setRunning(false);
      if (state.cancelled) log('Stopped.');
      else log(`Done. ${success} reallocated, ${notFound} not found, ${failed} failed.`);
    });

    window.__haloAssistant = { toggle: togglePanel };
    togglePanel(); // open on first injection
  }

  // ===========================================================================
  // Page registry — add the part 2 handler here later
  // ===========================================================================
  const PAGE_MODULES = [
    {
      id: 'prospect-manager',
      matches: () => /\/events\/\d+\/manager\/prospects\/?($|[/?#])/i.test(location.pathname + location.search),
      mount: mountProspectReallocator,
    },
    // {
    //   id: 'part-2',
    //   matches: () => /YOUR-PART-2-URL-PATTERN/i.test(location.pathname),
    //   mount: mountPart2Tool,
    // },
  ];

  const mod = PAGE_MODULES.find((m) => {
    try { return m.matches(); } catch (e) { return false; }
  });

  if (!mod) {
    console.info('[HALO Assistant] No automation configured for this page.');
    return;
  }

  mod.mount();
})();
