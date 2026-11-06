(function () {
  'use strict';

  /* Konnect Inspect: read-only page inspector for the Booking Builder.
     Finds the Vehicle of Interest and Part Exchange areas on a lead, and
     reports how they are built so the builder can pre-fill from them.
     It never changes the page. Customer names, emails, phone numbers and
     postcodes are not copied: only vehicle-type field values are kept. */

  const PANEL_ID = 'kn-inspect-panel';
  const old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  const VERSION = '1.0.0';
  const HEADING_RX = /^(vehicles?( of interest)?|vehicle details|voi|part ?exchange( vehicle| details)?|px|trade ?in|your vehicle|current vehicle|valuation)$/i;
  const VEHICLE_FIELD_RX = /^(registration( number)?|reg( no\.?| number)?|vrm|brand|make|model|derivative|variant|trim|version|mileage|miles|odometer|current mileage|fuel( type)?|transmission|gearbox|body( type| style)?|colou?r|year|age|engine( size)?|condition|new\/used|new or used|vehicle type|stock( number| no\.?)?|price|valuation|value|settlement( figure)?|finance( type| company)?|outstanding finance|vin)$/i;
  const EMAIL_RX = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
  const PHONE_RX = /(?:\+44\s?|\b0)\d(?:[\s-]?\d){8,10}\b/g;
  const POSTCODE_RX = /\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/gi;
  const MAX_SKELETON_NODES = 350;
  const WATCH_SECONDS = 60;

  function norm(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function labelKey(value) {
    return norm(value).replace(/[:*]+$/g, '').replace(/^[*\s]+/, '').trim();
  }

  function ownText(el) {
    let text = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    });
    return norm(text);
  }

  function redact(value) {
    return norm(value)
      .replace(EMAIL_RX, '[email]')
      .replace(PHONE_RX, '[phone]')
      .replace(POSTCODE_RX, '[postcode]');
  }

  function isVehicleLabel(text) {
    return VEHICLE_FIELD_RX.test(labelKey(text));
  }

  function safeValue(label, value) {
    const text = norm(value);
    if (!text) return '';
    if (isVehicleLabel(label)) return text.slice(0, 80);
    return `[hidden, ${text.length} chars]`;
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function describe(el) {
    if (!(el instanceof Element)) return '';
    let out = el.tagName.toLowerCase();
    if (el.id) out += `#${el.id}`;
    const classes = Array.from(el.classList).slice(0, 4);
    if (classes.length) out += `.${classes.join('.')}`;
    ['name', 'type', 'for', 'role', 'col-id', 'formcontrolname', 'ng-model', 'data-bind', 'data-field', 'aria-label', 'placeholder']
      .forEach((attr) => {
        const value = el.getAttribute(attr);
        if (value != null) out += `[${attr}="${redact(value).slice(0, 40)}"]`;
      });
    const dataAttrs = Array.from(el.attributes)
      .filter((a) => a.name.startsWith('data-') && !['data-bind', 'data-field'].includes(a.name))
      .slice(0, 2);
    dataAttrs.forEach((a) => { out += `[${a.name}="${redact(a.value).slice(0, 30)}"]`; });
    return out;
  }

  function path(el, depth) {
    const parts = [];
    for (let node = el, i = 0; node && node.nodeType === 1 && i < (depth || 7); node = node.parentElement, i += 1) {
      parts.unshift(describe(node));
    }
    return parts.join(' > ');
  }

  function rectOf(el) {
    if (!(el instanceof Element)) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }

  function controlFor(labelEl) {
    const forId = labelEl.getAttribute && labelEl.getAttribute('for');
    if (forId) {
      const byId = labelEl.ownerDocument.getElementById(forId);
      if (byId) return byId;
    }
    const inside = labelEl.querySelector && labelEl.querySelector('input,select,textarea');
    if (inside) return inside;
    let container = labelEl.parentElement;
    for (let i = 0; container && i < 3; i += 1, container = container.parentElement) {
      const node = container;
      const otherLabels = findLabelElements({ querySelectorAll: (sel) => node.querySelectorAll(sel) })
        .filter((entry) => entry.kind === 'field' && entry.el !== labelEl);
      if (otherLabels.length) break;
      const controls = container.querySelectorAll('input:not([type=hidden]),select,textarea');
      if (controls.length === 1) return controls[0];
      if (controls.length > 1) break;
    }
    return null;
  }

  function controlValue(control) {
    if (!control) return '';
    if (control.tagName === 'SELECT') {
      const option = control.options[control.selectedIndex];
      return option ? option.textContent : '';
    }
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked ? 'checked' : 'unchecked';
    return control.value;
  }

  function siblingValue(labelEl) {
    const next = labelEl.nextElementSibling;
    if (next) return norm(next.textContent);
    const parent = labelEl.parentElement;
    if (!parent) return '';
    return norm(parent.textContent.replace(labelEl.textContent, ''));
  }

  function frameworkHints(doc) {
    const hints = [];
    const root = doc.body || doc.documentElement;
    const sample = root.querySelectorAll('*');
    let ng = false;
    let knockout = false;
    let react = false;
    let vue = false;
    for (let i = 0; i < sample.length && i < 4000; i += 1) {
      const el = sample[i];
      if (!ng && Array.from(el.attributes).some((a) => a.name.startsWith('ng-') || a.name.startsWith('_ngcontent'))) ng = true;
      if (!knockout && el.hasAttribute('data-bind')) knockout = true;
      if (!react && Object.keys(el).some((k) => k.startsWith('__react'))) react = true;
      if (!vue && el.__vue__) vue = true;
    }
    if (ng) hints.push('angular');
    if (knockout) hints.push('knockout');
    if (react) hints.push('react');
    if (vue) hints.push('vue');
    if (typeof window.jQuery === 'function') hints.push(`jquery ${window.jQuery.fn && window.jQuery.fn.jquery}`);
    if (root.querySelector('.select2, .select2-container')) hints.push('select2');
    if (root.querySelector('.ag-root, [col-id]')) hints.push('ag-grid');
    return hints;
  }

  function documents() {
    const docs = [{ doc: document, where: 'top' }];
    document.querySelectorAll('iframe').forEach((frame, i) => {
      try {
        if (frame.contentDocument && frame.contentDocument.body) {
          docs.push({ doc: frame.contentDocument, where: `iframe ${i} ${describe(frame)}` });
        }
      } catch (e) {
        docs.push({ doc: null, where: `iframe ${i} (cross-origin, not readable)` });
      }
    });
    return docs;
  }

  function findLabelElements(doc) {
    const found = [];
    doc.querySelectorAll('label,legend,dt,th,td,span,strong,b,p,div,h1,h2,h3,h4,h5,h6,a,button,li').forEach((el) => {
      if (el.closest(`#${PANEL_ID}`)) return;
      const text = ownText(el);
      if (!text || text.length > 40) return;
      const key = labelKey(text);
      if (HEADING_RX.test(key)) found.push({ el, kind: 'heading', text: key });
      else if (VEHICLE_FIELD_RX.test(key)) found.push({ el, kind: 'field', text: key });
    });
    return found;
  }

  function sectionFor(el) {
    let best = el.parentElement;
    for (let node = el.parentElement, i = 0; node && i < 10; node = node.parentElement, i += 1) {
      const labels = findLabelElements({ querySelectorAll: (s) => node.querySelectorAll(s) })
        .filter((entry) => entry.kind === 'field').length;
      if (labels >= 2) { best = node; break; }
      best = node;
    }
    return best;
  }

  function ancestorChain(el) {
    const chain = [];
    for (let node = el.parentElement, i = 0; node && node.nodeType === 1 && i < 10; node = node.parentElement, i += 1) {
      chain.push({
        level: i + 1,
        el: describe(node),
        visible: isVisible(node),
        textLength: norm(node.textContent).length,
        fieldLabels: findLabelElements({ querySelectorAll: (s) => node.querySelectorAll(s) })
          .filter((entry) => entry.kind === 'field').map((entry) => entry.text).slice(0, 12)
      });
    }
    return chain;
  }

  function skeleton(root) {
    const lines = [];
    let count = 0;
    let lastLabel = '';
    function walk(node, depth) {
      if (count >= MAX_SKELETON_NODES || !(node instanceof Element)) return;
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT'].includes(node.tagName)) return;
      count += 1;
      const text = ownText(node);
      let note = '';
      if (text) {
        const key = labelKey(text);
        if (HEADING_RX.test(key) || VEHICLE_FIELD_RX.test(key) || (text.length <= 30 && /:$/.test(text))) {
          note = ` "${redact(text)}"`;
          lastLabel = key;
        } else {
          note = ` value=${JSON.stringify(safeValue(lastLabel, text))}`;
        }
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) {
        note += ` control=${JSON.stringify(safeValue(lastLabel || node.getAttribute('name') || '', controlValue(node)))}`;
        if (node.disabled) note += ' disabled';
        if (node.readOnly) note += ' readonly';
      }
      if (!isVisible(node)) note += ' (hidden)';
      lines.push(`${'  '.repeat(depth)}${describe(node)}${note}`);
      Array.from(node.children).forEach((child) => walk(child, depth + 1));
    }
    walk(root, 0);
    if (count >= MAX_SKELETON_NODES) lines.push(`... cut off at ${MAX_SKELETON_NODES} elements`);
    return lines.join('\n');
  }

  function findCallNotes(doc) {
    const labels = Array.from(doc.querySelectorAll('label,legend,dt,th,span,strong,b,p,div'))
      .filter((el) => isVisible(el) && ownText(el).toLowerCase() === 'call notes');
    const out = [];
    labels.forEach((label) => {
      let container = label.parentElement;
      for (let i = 0; container && i < 7; i += 1, container = container.parentElement) {
        const editor = container.querySelector('textarea');
        if (editor) { out.push({ label: describe(label), editor: path(editor, 5), rect: rectOf(editor) }); break; }
      }
    });
    return out;
  }

  function inspect() {
    const report = {
      tool: `Konnect Inspect ${VERSION}`,
      when: new Date().toISOString(),
      page: location.origin + location.pathname,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      frameworks: frameworkHints(document),
      layout: {},
      documents: []
    };

    const rail = document.querySelector('.userQuotesAffix');
    const launcher = document.getElementById('kn-notes-launcher-section');
    report.layout = {
      rail: rail ? { el: describe(rail), rect: rectOf(rail) } : 'not found',
      konnectNotesLauncher: launcher ? rectOf(launcher) : 'not loaded (open Konnect Notes first to include it)',
      callNotes: findCallNotes(document),
      tabPanes: Array.from(document.querySelectorAll('.tab-pane')).map((pane) => ({
        el: describe(pane), active: pane.classList.contains('active'), visible: isVisible(pane)
      })).slice(0, 10)
    };

    const sectionsSeen = new Set();
    documents().forEach(({ doc, where }) => {
      if (!doc) { report.documents.push({ where }); return; }
      const entries = findLabelElements(doc);
      const docReport = { where, labels: [], sections: [] };
      entries.forEach(({ el, kind, text }) => {
        const control = kind === 'field' ? controlFor(el) : null;
        docReport.labels.push({
          kind,
          text,
          visible: isVisible(el),
          el: path(el, 6),
          control: control ? describe(control) : null,
          controlValue: control ? safeValue(text, controlValue(control)) : null,
          nextValue: kind === 'field' ? safeValue(text, siblingValue(el)) : null,
          tabPane: el.closest('.tab-pane') ? describe(el.closest('.tab-pane')) : null
        });
        const section = sectionFor(el);
        if (section && !sectionsSeen.has(section)) {
          sectionsSeen.add(section);
          docReport.sections.push({
            foundFrom: `${kind}: ${text}`,
            section: path(section, 6),
            visible: isVisible(section),
            ancestors: ancestorChain(el),
            skeleton: skeleton(section)
          });
        }
      });
      report.documents.push(docReport);
    });
    return report;
  }

  /* Watch mode: logs which elements fire events and change while the
     agent edits the vehicle / PX boxes, so the builder knows what to
     listen to. Values are only kept for vehicle-type fields. */
  const watchLog = [];
  let watching = false;
  let watchTimer = null;
  let observer = null;
  let watchSections = [];
  let lastSecondsLeft = null;
  let summary = '';

  function guessLabel(el) {
    if (!(el instanceof Element)) return '';
    if (el.labels && el.labels[0]) return labelKey(el.labels[0].textContent);
    let node = el;
    for (let i = 0; node && i < 4; i += 1, node = node.parentElement) {
      const prev = node.previousElementSibling;
      if (prev && norm(prev.textContent).length <= 40) return labelKey(prev.textContent);
    }
    return el.getAttribute('name') || el.getAttribute('aria-label') || '';
  }

  function logEvent(event) {
    if (!watching || event.target.closest?.(`#${PANEL_ID}`)) return;
    const el = event.target;
    const label = guessLabel(el);
    watchLog.push({
      t: Math.round(performance.now()),
      event: event.type,
      label,
      el: path(el, 5),
      value: /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? safeValue(label, controlValue(el)) : null,
      inVehicleArea: watchSections.some((section) => section.contains(el)),
      isTrusted: event.isTrusted
    });
    if (watchLog.length > 300) watchLog.shift();
    updateStatus();
  }

  const EVENTS = ['input', 'change', 'focusout', 'keyup'];

  function startWatch() {
    if (watching) return;
    watching = true;
    watchLog.length = 0;
    EVENTS.forEach((type) => document.addEventListener(type, logEvent, true));
    watchSections = [];
    documents().forEach(({ doc }) => {
      if (!doc) return;
      findLabelElements(doc).forEach(({ el }) => {
        const section = sectionFor(el);
        if (section && !watchSections.includes(section)) watchSections.push(section);
      });
    });
    observer = new MutationObserver((mutations) => {
      let logged = false;
      mutations.forEach((m) => {
        const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!target || target.closest(`#${PANEL_ID}`)) return;
        if (!watchSections.some((section) => section.contains(target))) return;
        const label = guessLabel(target);
        watchLog.push({
          t: Math.round(performance.now()),
          event: `mutation:${m.type}${m.attributeName ? `:${m.attributeName}` : ''}`,
          label,
          el: path(target, 5),
          value: safeValue(label, target.textContent)
        });
        logged = true;
        if (watchLog.length > 300) watchLog.shift();
      });
      if (logged) updateStatus();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['value', 'class'] });
    let left = WATCH_SECONDS;
    watchTimer = setInterval(() => {
      left -= 1;
      updateStatus(left);
      if (left <= 0) stopWatch();
    }, 1000);
    updateStatus(left);
  }

  function stopWatch() {
    watching = false;
    EVENTS.forEach((type) => document.removeEventListener(type, logEvent, true));
    if (observer) observer.disconnect();
    observer = null;
    clearInterval(watchTimer);
    updateStatus();
  }

  function buildText() {
    const report = inspect();
    if (watchLog.length) report.watchLog = watchLog.slice();
    return JSON.stringify(report, null, 1);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      output.value = text;
      output.select();
      try { return document.execCommand('copy'); } catch (e2) { return false; }
    }
  }

  /* Panel */
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;top:12px;right:12px;width:320px;z-index:2147483646;background:#f2f2f7;color:#1c1c1e;border-radius:16px;box-shadow:0 20px 50px -12px rgba(0,0,0,.35);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden';
  panel.innerHTML = `
    <div style="background:#1c1c1e;color:#fff;padding:10px 14px;font-weight:600;display:flex;align-items:center">
      <span style="flex:1">Konnect Inspect</span>
      <button data-act="close" style="border:0;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:2px 9px;cursor:pointer">×</button>
    </div>
    <div style="padding:12px">
      <div data-role="status" style="margin-bottom:10px"></div>
      <button data-act="copy" style="width:100%;border:0;border-radius:10px;padding:9px;background:#0a84ff;color:#fff;font-weight:600;cursor:pointer;margin-bottom:8px">Copy report</button>
      <button data-act="watch" style="width:100%;border:0;border-radius:10px;padding:9px;background:#fff;color:#1c1c1e;font-weight:600;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.12)">Watch edits for ${WATCH_SECONDS}s</button>
      <div style="color:#6e6e73;font-size:12px;margin-top:8px">Read only. Only vehicle values (reg, make, model, mileage and similar) are copied. Names, emails, phone numbers and postcodes are left out.</div>
      <textarea data-role="output" readonly style="display:none;width:100%;height:90px;margin-top:8px;font:11px monospace"></textarea>
    </div>`;
  document.body.appendChild(panel);
  const statusEl = panel.querySelector('[data-role="status"]');
  const output = panel.querySelector('[data-role="output"]');

  function refreshSummary() {
    const report = inspect();
    const labelCount = report.documents.reduce((n, d) => n + (d.labels ? d.labels.length : 0), 0);
    const sectionCount = report.documents.reduce((n, d) => n + (d.sections ? d.sections.length : 0), 0);
    summary = `Found ${labelCount} vehicle/PX labels in ${sectionCount} area(s).`;
  }

  function updateStatus(secondsLeft) {
    if (secondsLeft != null) lastSecondsLeft = secondsLeft;
    let text = summary;
    if (watching) text += `<br><b>Watching: ${lastSecondsLeft}s left.</b> Type into the vehicle and PX boxes now. ${watchLog.length} events logged.`;
    else if (watchLog.length) text += `<br>Watch finished: ${watchLog.length} events logged. Press Copy report.`;
    statusEl.innerHTML = text;
  }

  panel.addEventListener('click', async (event) => {
    const act = event.target.getAttribute('data-act');
    if (act === 'close') { stopWatch(); panel.remove(); }
    if (act === 'watch') { if (watching) stopWatch(); else startWatch(); }
    if (act === 'copy') {
      const text = buildText();
      refreshSummary();
      const ok = await copy(text);
      output.style.display = 'block';
      output.value = text;
      statusEl.innerHTML = ok
        ? `Copied (${Math.round(text.length / 1024)} KB). Paste it back into the chat.`
        : 'Could not copy automatically. Select the text below and copy it.';
    }
  });

  refreshSummary();
  updateStatus();
})();
