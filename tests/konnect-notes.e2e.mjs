#!/usr/bin/env node
// Browser tests for Konnect-Notes.js against the mock agent desktop in
// tests/konnect-notes-mock/index.html. The real script is loaded the way
// the bookmarks load it, with window.KonnectNotesBaseUrl pointed at a local
// server for this repo, so no network is needed. Needs Playwright with
// Chromium. Run from the repo root:
//
//   node tests/konnect-notes.e2e.mjs
//
// Exit 1 on any failure.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const mockPage = join(here, 'konnect-notes-mock', 'index.html');
const phrases = JSON.parse(readFileSync(join(repo, 'Konnect-Notes-Phrases.json'), 'utf8'));

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return createRequire(join(globalRoot, 'noop.js'))('playwright');
}
const { chromium } = await loadPlaywright();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log(`pass  ${name}`); }
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const served = ['Konnect-Notes.js', 'Konnect-Booking-Engine.js', 'Konnect-Notes-Phrases.json'];
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\//, '');
  const file = name === 'index.html' ? mockPage : name === 'two-leads.html' ? join(here, 'konnect-notes-mock', name) : served.includes(name) ? normalize(join(repo, name)) : '';
  if (file && existsSync(file) && statSync(file).isFile()) {
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : 'text/plain');
    res.end(readFileSync(file));
  } else { res.statusCode = 404; res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const CAD = '**** Catch All Return Lead **** Lead has been **actioned by dealer**';

// A fresh page with the real script loaded. options.booking (or owner) loads
// it the way Work Tools does, with the owner flag; without it, the way the
// Konnect Tools bookmark other staff use does.
async function fresh(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.consoleText = [];
  page.on('console', (m) => page.consoleText.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${base}${options.page || 'index.html'}${options.hash || ''}`);
  await page.evaluate(([b, o]) => {
    localStorage.setItem('konnectNotes:agentName:v1', 'Sam Tester');
    if (o.stored) localStorage.setItem('konnectNotes:workingConfig:v1', JSON.stringify(o.stored));
    window.KonnectNotesBaseUrl = b;
    if (o.booking || o.owner) window.KonnectNotesOwner = true;
    // The copied text is kept here, so the tests need no clipboard permission.
    window.copied = [];
    try { navigator.clipboard.writeText = async (text) => { window.copied.push(text); }; } catch (e) {}
  }, [base, { stored: options.stored || null, booking: !!options.booking, owner: !!options.owner }]);
  if (options.before) await page.evaluate(options.before);
  await page.addScriptTag({ url: `${base}Konnect-Notes.js` });
  await page.waitForFunction(() => window.KonnectNotes && window.KonnectNotes.state.config, null, { timeout: 5000 });
  await sleep(200);
  return page;
}

// What Lead-Reset.js typeShorthand does: the word at the end of the box (on
// a new line unless the box is empty or ends in white space), then a
// keydown of space it dispatches itself.
function leadResetTypes(page, selector, word) {
  return page.evaluate(async ([sel, w]) => {
    const box = document.querySelector(sel);
    const before = box.value;
    const text = (before && !/\s$/.test(before) ? '\n' : '') + w;
    box.focus();
    box.setSelectionRange(before.length, before.length);
    document.execCommand('insertText', false, text);
    box.setSelectionRange(box.value.length, box.value.length);
    await new Promise((r) => setTimeout(r, 200));
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    box.dispatchEvent(space);
    await new Promise((r) => setTimeout(r, 300));
    return { prevented: space.defaultPrevented, value: box.value };
  }, [selector, word]);
}

// A person typing the shorthand on its own line in Post Closure Notes.
async function typeCad(page) {
  await page.click('#pcA');
  await page.keyboard.type('cad ');
  await sleep(150);
  return page.inputValue('#pcA');
}
const toastText = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.kn-toast')).map((n) => n.textContent).join(' | '));

async function notesCorrectness() {
  // Item 1: Initial Notes are only taken out of Call Notes as whole lines.
  let page = await fresh();
  await page.fill('#initA', 'Finance');
  await page.fill('#callA', 'Customer wants to refinance and discuss finance options\n2 - VM left -- Sam Tester');
  check('1 a word from Initial Notes is not cut out of a Call Notes sentence', await typeCad(page) ===
    `Finance\nCustomer wants to refinance and discuss finance options\n2 - VM left -- Sam Tester\n${CAD}`, await page.inputValue('#pcA'));
  check('1 Call Notes is left as typed', await page.inputValue('#callA') === 'Customer wants to refinance and discuss finance options\n2 - VM left -- Sam Tester');

  page = await fresh();
  await page.fill('#initA', 'Web enquiry: used 208\nCallback after 5pm');
  await page.fill('#callA', 'Web enquiry: used 208\nCallback after 5pm\n1 - VM left -- Sam Tester');
  check('1 Initial Notes copied into Call Notes as whole lines appear once', await typeCad(page) ===
    `Web enquiry: used 208\nCallback after 5pm\n1 - VM left -- Sam Tester\n${CAD}`, await page.inputValue('#pcA'));

  // Item 2: repeats inside one box are kept; repeats between boxes are not.
  page = await fresh();
  await page.fill('#initA', 'Part exchange:\nNo\nFinance:\nNo\nTest drive:\nYes');
  await page.fill('#callA', '1 - VM left -- Sam Tester\nNo answer\n1 - VM left -- Sam Tester');
  const repeated = await typeCad(page);
  check('2 repeated lines inside Initial Notes and Call Notes are kept', repeated ===
    `Part exchange:\nNo\nFinance:\nNo\nTest drive:\nYes\n1 - VM left -- Sam Tester\nNo answer\n1 - VM left -- Sam Tester\n${CAD}`, repeated);
  await page.keyboard.press('Enter');
  await page.keyboard.type('cad ');
  await sleep(150);
  check('2 running it again adds nothing twice', (await page.inputValue('#pcA')).trim() === repeated, await page.inputValue('#pcA'));

  // Item 3: another tab with the same Initial Notes is not this lead.
  const twoLeads = async (leadA, leadB) => {
    const p = await fresh({ before: `(() => {
      ${leadA ? `document.querySelector('#paneA').dataset.leadId = '${leadA}';` : ''}
      ${leadB ? `document.querySelector('#paneB').dataset.leadId = '${leadB}';` : ''}
      document.querySelector('#initB').value = 'Web enquiry: used 208, callback please';
      document.querySelector('#callB').value = 'LEAD B: 1 - VM left -- Other Agent';
      document.querySelector('#pcWrapB').style.display = 'none';
    })()` });
    await p.fill('#initA', 'Web enquiry: used 208, callback please');
    await p.fill('#callA', 'LEAD A: spoke to customer');
    const pc = await typeCad(p);
    return { p, pc, callA: await p.inputValue('#callA'), callB: await p.inputValue('#callB') };
  };
  let r = await twoLeads('', '');
  check('3 no lead ID on the page: Call Notes untouched', r.callA === 'LEAD A: spoke to customer' && !/LEAD B/.test(r.pc) && r.callB === 'LEAD B: 1 - VM left -- Other Agent', r);
  r = await twoLeads('77000001', '77000002');
  check('3 a different lead ID: Call Notes untouched', r.callA === 'LEAD A: spoke to customer' && !/LEAD B/.test(r.pc), r);
  r = await twoLeads('77000001', '77000001');
  check('3 the same lead ID: the second mount of this lead is still used', r.callA === 'LEAD B: 1 - VM left -- Other Agent' && /LEAD B/.test(r.pc) && /LEAD A/.test(r.pc), r);
  await r.p.keyboard.press('Control+z');
  check('3 Ctrl+Z puts both boxes back', await r.p.inputValue('#callA') === 'LEAD A: spoke to customer' && await r.p.inputValue('#pcA') === '', [await r.p.inputValue('#callA'), await r.p.inputValue('#pcA')]);

  // Item 4: a shorthand that writes nothing says so on the page.
  page = await fresh();
  await page.click('#pcA');
  await page.keyboard.type('cad ');
  await sleep(150);
  check('4 empty Initial Notes: nothing is written', await page.inputValue('#pcA') === 'cad', await page.inputValue('#pcA'));
  check('4 empty Initial Notes: a notice is shown on the page', /Initial Notes is empty/.test(await toastText(page)), await toastText(page));
  check('4 the palette stays closed', await page.evaluate(() => !KonnectNotes.state.open));

  // Item 5: undo with no Call Notes box on the lead.
  page = await fresh({ before: () => document.querySelector('#callWrapA').remove() });
  check('5 no Call Notes box: Post Closure is still the target', await page.evaluate(() => !KonnectNotes.state.target && !!KonnectNotes.state.postClosureTarget));
  await page.fill('#initA', 'Web enquiry');
  await page.evaluate(() => { document.querySelector('#pcA').value = 'earlier note\n'; });
  const written = await leadResetTypes(page, '#pcA', 'cad');
  await page.focus('#pcA');
  await page.keyboard.press('Control+z');
  await sleep(100);
  check('5 Ctrl+Z with no Call Notes box undoes without an error', written.value.includes(CAD) && await page.inputValue('#pcA') === 'earlier note\n' && page.errors.length === 0, [written, await page.inputValue('#pcA'), page.errors]);
}

async function typing() {
  // Item 6: only a shorthand alone on its line expands.
  let page = await fresh();
  await page.click('#callA');
  await page.keyboard.type('Customer wants to book a test drive');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Spoke to customer, not sure on fin yet, said he would book later');
  check('6 words inside a sentence are left alone', await page.inputValue('#callA') ===
    'Customer wants to book a test drive\nSpoke to customer, not sure on fin yet, said he would book later', await page.inputValue('#callA'));
  // A numbered shorthand is never an ordinary word: after other words it goes onto its own line.
  await page.keyboard.type(' vm1 ');
  check('6 a numbered shorthand after other words expands on a new line', await page.inputValue('#callA') ===
    'Customer wants to book a test drive\nSpoke to customer, not sure on fin yet, said he would book later \n1 - VM left -- Sam Tester\n', await page.inputValue('#callA'));
  await page.fill('#callA', '');
  await page.click('#callA');
  await page.keyboard.type('Customer wants to book a test drive');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Spoke to customer, not sure on fin yet, said he would book later');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ni ');
  check('6 a shorthand alone on a new line expands', (await page.inputValue('#callA')).endsWith('\nNot interested -- Sam Tester\n'), await page.inputValue('#callA'));
  await page.keyboard.type('  vm2');
  await page.keyboard.press('Enter');
  check('6 leading spaces and Enter are allowed', (await page.inputValue('#callA')).includes('2 - VM left -- Sam Tester'), await page.inputValue('#callA'));
  page = await fresh();
  await page.click('#callA');
  await page.keyboard.type('ni ');
  check('6 a shorthand at the start of an empty box expands', await page.inputValue('#callA') === 'Not interested -- Sam Tester\n', await page.inputValue('#callA'));
  await page.fill('#callA', ' later text');
  await page.focus('#callA');
  await page.evaluate(() => document.querySelector('#callA').setSelectionRange(0, 0));
  await page.keyboard.type('ni ');
  check('6 not when more text follows on the same line', await page.inputValue('#callA') === 'ni  later text', await page.inputValue('#callA'));

  // Item 7: palette keys never take what is typed into another field.
  page = await fresh();
  await page.click('#callA');
  await page.keyboard.press('Alt+n');
  await sleep(150);
  const dialog = await page.evaluate(() => {
    const palette = document.getElementById('kn-notes-palette');
    return { role: palette.getAttribute('role'), label: palette.getAttribute('aria-label'), focused: palette.contains(document.activeElement),
      unnamed: Array.from(palette.querySelectorAll('.kn-icon-button')).filter((b) => !b.getAttribute('aria-label')).length,
      stopInHeader: /stop/i.test(palette.querySelector('.kn-header').textContent) };
  });
  check('13 the palette is a named dialog and takes focus when opened', dialog.role === 'dialog' && !!dialog.label && dialog.focused && dialog.unnamed === 0 && !dialog.stopInHeader, dialog);
  await page.click('#other');
  await page.keyboard.type('45000b');
  check('7 digits and "b" typed in another field go to that field', await page.inputValue('#other') === '45000b' && await page.inputValue('#callA') === '' &&
    await page.evaluate(() => KonnectNotes.state.open && KonnectNotes.state.view === 'main'), [await page.inputValue('#other'), await page.inputValue('#callA')]);
  await page.keyboard.press('Escape');
  await page.fill('#callA', 'first line');
  await page.click('#callA');
  await page.keyboard.press('Alt+n');
  await sleep(150);
  await page.keyboard.press('1');
  await sleep(100);
  await page.keyboard.press('2');
  await sleep(150);
  check('7 keys still work from the palette: 1 then attempt 2', await page.inputValue('#callA') === 'first line\n2 - VM left -- Sam Tester\n', await page.inputValue('#callA'));
  await page.keyboard.press('Alt+n');
  await sleep(100);
  await page.keyboard.press('Escape');
  await page.keyboard.type('x');
  check('7 Escape hands the caret back to Call Notes', await page.inputValue('#callA') === 'first line\n2 - VM left -- Sam Tester\nx', await page.inputValue('#callA'));

  // Item 8: a page that never stops changing is still scanned.
  page = await fresh({ before: () => {
    document.querySelector('#paneA').classList.remove('active');
    const noise = document.createElement('div');
    document.body.appendChild(noise);
    setInterval(() => { noise.style.width = `${Math.random() * 100}px`; }, 60);
  } });
  await page.evaluate(() => document.querySelector('#paneA').classList.add('active'));
  await sleep(1200);
  check('8 the scan runs while the page keeps changing', await page.evaluate(() => KonnectNotes.state.target === document.querySelector('#callA') && !!document.getElementById('kn-notes-launcher-section')));
  // And the box is looked up again when a shorthand is typed straight after a tab switch.
  page = await fresh();
  const switched = await page.evaluate(() => {
    document.querySelector('#initB').value = 'Lead B enquiry';
    document.querySelector('#paneA').classList.remove('active');
    document.querySelector('#paneB').classList.add('active');
    const box = document.querySelector('#pcB');
    box.focus(); box.value = 'cad'; box.setSelectionRange(3, 3);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    box.dispatchEvent(space);
    return { prevented: space.defaultPrevented, value: box.value };
  });
  check('8 a shorthand typed straight after a tab switch finds the new box', switched.prevented && switched.value === `Lead B enquiry\n${CAD}`, switched);
}

async function leadResetContract() {
  const page = await fresh();
  await page.fill('#initA', 'Customer wants a callback about a used 208');
  await page.fill('#callA', '1 - VM left -- Sam Tester');
  const cad = await leadResetTypes(page, '#pcA', 'cad');
  check('contract: cad at the end of Post Closure Notes', cad.prevented && /actioned by dealer/i.test(cad.value) && !/\bcad\b/.test(cad.value), cad);
  const cah = await leadResetTypes(page, '#pcA', 'cah');
  check('contract: cah after existing Post Closure text', cah.prevented && /customer hub will not contact/i.test(cah.value) && !/\bcah\b/.test(cah.value), cah);
  const eo = await leadResetTypes(page, '#callA', 'eo');
  check('contract: eo at the end of Call Notes', eo.prevented && /email only lead: jo@example\.com/i.test(eo.value) && eo.value.startsWith('1 - VM left -- Sam Tester\n'), eo);
  const wrongBox = await leadResetTypes(page, '#callA', 'cad');
  check('contract: cad in Call Notes is not taken', !wrongBox.prevented && wrongBox.value.endsWith('cad'), wrongBox);

  // Lead Re setup adds no new line when the box already ends in a space.
  const spaced = await fresh();
  await spaced.fill('#initA', 'Web enquiry');
  await spaced.fill('#pcA', 'earlier note ');
  const afterSpace = await leadResetTypes(spaced, '#pcA', 'cad');
  check('contract: cad after a trailing space still expands for Lead Re setup', afterSpace.prevented && /actioned by dealer/i.test(afterSpace.value), afterSpace);

  // With the palette or the Booking Builder open.
  const open = await fresh({ booking: true });
  await open.fill('#initA', 'Web enquiry');
  await open.click('#callA');
  await open.keyboard.press('Alt+b');
  await open.waitForFunction(() => window.KonnectBookingEngine, null, { timeout: 5000 });
  const withBooking = await leadResetTypes(open, '#pcA', 'cad');
  check('contract: cad with the Booking Builder open', withBooking.prevented && /actioned by dealer/i.test(withBooking.value), withBooking);
}

async function bookingAndRoutes() {
  // The Konnect Tools route: no booking.
  let page = await fresh();
  await page.click('#callA');
  await page.keyboard.press('Alt+b');
  await sleep(200);
  check('Konnect Tools route: Alt+B opens nothing', await page.evaluate(() => !KonnectNotes.state.open && !window.KonnectBookingEngine));
  await page.keyboard.press('Alt+n');
  await sleep(150);
  check('Konnect Tools route: no Booking button, quick phrases shown', await page.evaluate(() => {
    const palette = document.getElementById('kn-notes-palette');
    return !/booking/i.test(palette.textContent) && palette.querySelectorAll('.kn-quick').length === 5 && /Keys 1 to 5/.test(palette.textContent);
  }));
  check('Konnect Tools route: version is kept', /^\d+\.\d+\.\d+$/.test(await page.evaluate(() => KonnectNotes.version)));
  await page.click('[aria-label="Phrase settings"]');
  await page.click('text=Stop Konnect Notes');
  await sleep(100);
  await page.click('#callA');
  await page.keyboard.type('ni ');
  check('Stop (now under settings) unloads everything', await page.inputValue('#callA') === 'ni ' &&
    await page.evaluate(() => typeof window.KonnectNotes === 'undefined' && !document.getElementById('kn-notes-palette') && !document.getElementById('kn-notes-style')));
  check('no page errors on the Konnect Tools route', page.errors.length === 0, page.errors);

  // The Work Tools route.
  page = await fresh({ booking: true });
  await page.click('#callA');
  await page.keyboard.press('Alt+b');
  await page.waitForFunction(() => window.KonnectBookingEngine && document.querySelector('.kn-bk-chips .kn-chip'), null, { timeout: 5000 });
  await page.click('.kn-bk-chips .kn-chip:has-text("Test drive")');
  await sleep(200);
  const blocked = await page.evaluate(() => Array.from(document.querySelectorAll('.kn-bk-actions .kn-button')).map((b) => [b.textContent, b.disabled]));
  check('13 booking buttons are disabled while something is missing', blocked.slice(0, 3).every((b) => b[1] === true) && blocked[3][1] === false, blocked);
  check('12 Clear says what it clears', /Clear notes and form/.test(blocked[3][0]), blocked[3]);

  // Item 10: yesterday is an error until the year is confirmed.
  const dates = await page.evaluate(() => {
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { day: String(y.getDate()), month: String(y.getMonth() + 1), nextYear: y.getFullYear() + 1 };
  });
  await page.evaluate(() => { KonnectNotes.state.booking.openSection = 'when'; KonnectNotes.openBooking(); });
  await sleep(200);
  await page.fill('.kn-bk-content input[placeholder="DD"]', dates.day);
  await page.fill('.kn-bk-content input[placeholder="MM"]', dates.month);
  await sleep(200);
  const readout = () => page.evaluate(() => { const n = document.querySelector('[data-role="date-readout"]'); return n ? { text: n.textContent, error: n.classList.contains('kn-bk-error') } : null; });
  let shown = await readout();
  check('10 yesterday is an error that names the year it would mean', !!shown && shown.error && /already passed this year/.test(shown.text) && shown.text.includes(String(dates.nextYear)), shown);
  await page.click('.kn-bk-confirm-year');
  await sleep(200);
  shown = await readout();
  check('10 once confirmed the readout shows the year', !!shown && !shown.error && shown.text.includes(String(dates.nextYear)), shown);

  // Item 11: drafts belong to a lead and last one shift.
  const keyNow = await page.evaluate(() => KonnectNotes.state.booking.key);
  await page.evaluate(() => { KonnectNotes.closePalette(); document.querySelector('#custName').textContent = 'Sam Sample'; document.querySelector('#custEmail').textContent = 'sam@example.com'; });
  await sleep(2200);
  await page.keyboard.press('Alt+b');
  await sleep(300);
  const next = await page.evaluate(() => ({ key: KonnectNotes.state.booking.key, type: KonnectNotes.state.booking.data.type }));
  check('11 the next customer on the same tab gets a clean draft', next.key !== keyNow && next.type === '' && !/Example|Sample|@/.test(next.key), [keyNow, next]);
  await page.evaluate(() => {
    const drafts = JSON.parse(localStorage.getItem('konnectNotes:bookingDrafts:v1'));
    Object.values(drafts).forEach((d) => { d.updated = Date.now() - 13 * 60 * 60 * 1000; });
    localStorage.setItem('konnectNotes:bookingDrafts:v1', JSON.stringify(drafts));
    KonnectNotes.state.booking.data.type = 'view';
    KonnectNotes.closePalette();
  });
  const kept = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('konnectNotes:bookingDrafts:v1'))).length);
  check('11 drafts older than a shift are dropped', kept === 1, kept);
  await page.evaluate(() => { document.querySelector('#paneA').dataset.leadId = '77000009'; });
  await sleep(2200);
  check('11 the lead ID is the key when the page gives one', await page.evaluate(() => { KonnectNotes.openBooking(); return KonnectNotes.state.booking.key; }) === 'lead-77000009');
  check('no page errors on the Work Tools route', page.errors.length === 0, page.errors);

  // Item 9: the inbound launcher does not keep the observer firing.
  page = await fresh({ booking: true, hash: '#!/present-inbound-call', before: () => {
    document.querySelector('.tab-content').remove();
    const phone = document.createElement('button');
    phone.setAttribute('ng-click', 'manualCallClick()');
    phone.className = 'btn btn-success';
    phone.textContent = 'Manual';
    document.body.appendChild(phone);
  } });
  await sleep(500);
  const idle = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver((records) => { count += records.length; });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    await new Promise((r) => setTimeout(r, 1500));
    return { count, launcher: !!document.getElementById('kn-inbound-launcher') };
  });
  check('9 the inbound launcher is shown and the page then stays still', idle.launcher && idle.count === 0, idle);
}

async function pureBuilders() {
  const page = await fresh();
  const plan = await page.evaluate(() => KonnectNotes.buildPostClosurePlan({
    initialText: 'Finance\nNo',
    activeCallText: 'Refinance wanted\nNo\nNo',
    existingPostText: 'Finance\nNo\nRefinance wanted\nNo\nNo\nmy own note\nmy own note',
    selectedText: 'CATCH ALL LINE',
    ignoredLines: ['cad']
  }));
  check('plan: whole lines only, repeats kept inside a box, dropped between boxes', plan.postClosureValue === 'Finance\nNo\nRefinance wanted\nmy own note\nmy own note\nCATCH ALL LINE' && plan.shouldCleanCall === false, plan);
  check('plan: no Initial Notes gives no plan', await page.evaluate(() => KonnectNotes.buildPostClosurePlan({ initialText: ' \n', activeCallText: 'x', selectedText: 'y' })) === null);

  // Item 14: standard phrase updates reach a locally edited list.
  const merged = await page.evaluate((standard) => {
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const base = copy(standard);
    const local = copy(standard);
    local.phrases.find((p) => p.id === 'not-interested').text = 'My own wording -- {{agent}}';
    local.phrases = local.phrases.filter((p) => p.id !== 'line-engaged');
    local.phrases.push({ id: 'mine', label: 'Mine', category: 'calls', text: 'Mine', aliases: ['mine'], requiresAttempt: false });
    const remote = copy(standard);
    remote.phrases.find((p) => p.id === 'vm-left').text = '{{attempt}} - Voicemail left -- {{agent}}';
    remote.phrases.find((p) => p.id === 'not-interested').text = 'Standard changed';
    remote.phrases = remote.phrases.filter((p) => p.id !== 'line-rang-then-failed');
    remote.phrases.push({ id: 'brand-new', label: 'New', category: 'calls', text: 'New', aliases: ['bn'], requiresAttempt: false });
    const out = KonnectNotes.mergeRemoteConfig(local, remote, base);
    const text = (id) => (out.phrases.find((p) => p.id === id) || {}).text;
    return { changed: text('vm-left'), edited: text('not-interested'), deleted: text('line-engaged'), removed: text('line-rang-then-failed'), added: text('brand-new'), own: text('mine') };
  }, phrases);
  const ids = phrases.phrases.map((p) => p.id);
  check('merge test uses real phrase ids', ['not-interested', 'line-engaged', 'vm-left', 'line-rang-then-failed'].every((id) => ids.includes(id)), ids);
  check('14 a changed standard phrase arrives, own edits and deletions stay', merged.changed === '{{attempt}} - Voicemail left -- {{agent}}' &&
    merged.edited === 'My own wording -- {{agent}}' && merged.deleted === undefined && merged.removed === undefined && merged.added === 'New' && merged.own === 'Mine', merged);

  // The same, through a stored local list at load.
  const edited = JSON.parse(JSON.stringify(phrases));
  edited.phrases.find((p) => p.id === 'not-interested').text = 'My own wording -- {{agent}}';
  const older = JSON.parse(JSON.stringify(phrases));
  older.phrases = older.phrases.filter((p) => !p.aliases.includes('cad'));
  edited.phrases = edited.phrases.filter((p) => !p.aliases.includes('cad'));
  const stored = await fresh({ stored: { config: edited, dirty: true, remoteSignature: JSON.stringify(older) } });
  await stored.waitForFunction(() => /own phrase changes/.test(KonnectNotes.state.configStatus), null, { timeout: 5000 }).catch(() => {});
  await stored.fill('#initA', 'Web enquiry');
  const cad = await leadResetTypes(stored, '#pcA', 'cad');
  await stored.click('#callA');
  await stored.keyboard.type('ni ');
  check('14 a locally edited list still gets a new standard phrase, and keeps the edit', cad.prevented && /actioned by dealer/i.test(cad.value) &&
    await stored.inputValue('#callA') === 'My own wording -- Sam Tester\n', [cad, await stored.inputValue('#callA'), await stored.evaluate(() => KonnectNotes.state.configStatus)]);
}

// The look of the buttons and panels: navy buttons the size of Konnect's own,
// nothing outside the shape, and the Customer step's seven fields.
async function layout() {
  console.log('\nLayout');
  let page = await fresh({ booking: true });
  const rail = await page.evaluate(() => {
    const button = document.querySelector('#kn-notes-launcher-section .kn-launcher');
    const tick = document.querySelector('.userQuotesAffix a.btn-call-nav').getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const bolt = button.querySelector('.kn-launcher-bolt').getBoundingClientRect();
    return { colour: style.backgroundColor, shadow: style.boxShadow, title: button.title, text: button.textContent.trim().length,
      sameSize: Math.round(box.width) === Math.round(tick.width) && Math.round(box.height) === Math.round(tick.height),
      boltInside: bolt.left >= box.left && bolt.right <= box.right && bolt.top >= box.top && bolt.bottom <= box.bottom };
  });
  check('the rail button is navy, the size of the Konnect button, with nothing outside it',
    rail.colour === 'rgb(30, 29, 73)' && rail.shadow === 'none' && rail.sameSize && rail.boltInside && rail.title === 'Konnect Notes (Alt+N)' && rail.text <= 2, rail);
  await page.click('#callA');
  await page.keyboard.press('Alt+n');
  await sleep(150);
  const main = await page.evaluate(() => {
    const palette = document.getElementById('kn-notes-palette');
    return { open: document.querySelector('.kn-launcher').classList.contains('kn-launcher-open'),
      header: Array.from(palette.querySelectorAll('.kn-header .kn-icon-button')).map((b) => `${b.title}|${b.textContent}`),
      booking: palette.querySelector('.kn-main-booking').textContent, search: /Search all phrases/.test(palette.textContent) };
  });
  check('the phrase list names its header buttons and marks the rail button as open',
    main.open && main.header.join() === 'Phrase settings|Settings,Close|Close' && main.booking === 'BookingB' && main.search, main);
  await page.keyboard.press('Escape');
  await sleep(100);
  check('closing takes the mark off the rail button', await page.evaluate(() => !document.querySelector('.kn-launcher').classList.contains('kn-launcher-open')));
  await page.fill('#initA', '');
  await typeCad(page);
  check('the notice says first that nothing was written', /^Nothing was written\. Initial Notes is empty/.test(await toastText(page)), await toastText(page));

  // No lead open: the Phone column button and the Customer step.
  page = await fresh({ booking: true, hash: '#!/present-inbound-call', before: () => {
    document.querySelector('.tab-content').remove();
    const phone = document.createElement('button');
    phone.setAttribute('ng-click', 'manualCallClick()');
    phone.className = 'btn btn-success';
    phone.style.cssText = 'position:fixed;right:14px;bottom:60px;width:64px;height:37px';
    phone.textContent = 'Call';
    document.body.appendChild(phone);
  } });
  await sleep(400);
  const phone = await page.evaluate(() => {
    const button = document.getElementById('kn-inbound-launcher');
    const call = document.querySelector('button[ng-click="manualCallClick()"]');
    const style = getComputedStyle(button);
    return { colour: style.backgroundColor, shadow: style.boxShadow, text: button.textContent, classes: button.className, beforeCall: button.nextElementSibling === call,
      size: [button.offsetWidth, button.offsetHeight], callSize: [call.offsetWidth, call.offsetHeight] };
  });
  check('the Phone column button is navy, symbol only and the size of the button beside it',
    phone.colour === 'rgb(30, 29, 73)' && phone.shadow === 'none' && phone.text === '⚡' && phone.beforeCall && phone.classes === 'btn kn-ui kn-phone-launcher' && phone.size.join() === phone.callSize.join(), phone);
  await page.click('#kn-inbound-launcher');
  await page.waitForSelector('.kn-bk-content', { timeout: 5000 });
  await sleep(200);
  const customer = await page.evaluate(() => {
    const content = document.querySelector('.kn-bk-content');
    const body = document.querySelector('.kn-bk-body').getBoundingClientRect();
    const fields = Array.from(content.querySelectorAll('.kn-bk-field'));
    const inView = fields.every((f) => { const r = f.getBoundingClientRect(); return r.top >= body.top && r.bottom <= body.bottom; });
    const selects = content.querySelectorAll('select');
    const row = (n) => Math.round(n.getBoundingClientRect().top);
    return { labels: fields.map((f) => f.querySelector('.kn-bk-label').textContent), inView, sideBySide: row(selects[0]) === row(selects[1]),
      brands: Array.from(selects[1].options).map((o) => o.textContent), open: document.getElementById('kn-inbound-launcher').classList.contains('kn-launcher-open'),
      create: !!Array.from(content.querySelectorAll('button')).find((b) => b.textContent === 'Create new customer') };
  });
  check('the Customer step shows all seven fields without scrolling, Dealer and Brand side by side',
    customer.labels.join() === 'Mobile,Name,Email,Postcode,Address line 1,Dealer,Brand' && customer.inView && customer.sideBySide && customer.create && customer.open, customer);
  check('Brand offers Auto and the same eleven brands', customer.brands.length === 12 && customer.brands[0] === 'Auto (vehicle make)' && customer.brands.includes('Peugeot'), customer.brands);
  await page.selectOption('.kn-bk-content select >> nth=1', 'Peugeot');
  await sleep(200);
  check('a Brand choice is kept when the step is drawn again', await page.evaluate(() => document.querySelectorAll('.kn-bk-content select')[1].value) === 'Peugeot');
  await page.fill('.kn-bk-content input[placeholder="07700 900123"]', '07700 900123');
  await page.press('.kn-bk-content input[placeholder="07700 900123"]', 'Enter');
  await sleep(300);
  check('Enter in Mobile still searches', /Accept the call first, then search|Searched Konnect|search/i.test(await toastText(page)), await toastText(page));
  check('no page errors on the layout pages', page.errors.length === 0, page.errors);
}

// Loaded without the owner flag, as the Konnect Tools bookmark loads it.
async function otherStaff() {
  console.log('\nother staff: call notes only');
  const bookingThings = (page) => page.evaluate(() => ({
    launcher: !!document.getElementById('kn-inbound-launcher'),
    sheet: !!document.getElementById('kn-sheet-row-toast'),
    buttons: Array.from(document.querySelectorAll('button')).filter((b) => /booking|diary/i.test(`${b.textContent} ${b.title} ${b.getAttribute('aria-label') || ''}`)).map((b) => b.textContent),
    engine: !!window.KonnectBookingEngine,
    storage: Object.keys(localStorage).filter((k) => /booking|draft|owner|inbound|diary/i.test(k)),
    state: !!KonnectNotes.state.booking
  }));
  const nothing = (t) => !t.launcher && !t.sheet && t.buttons.length === 0 && !t.engine && t.storage.length === 0 && !t.state;
  const altB = (page) => page.evaluate(() => {
    const key = new KeyboardEvent('keydown', { key: 'b', altKey: true, bubbles: true, cancelable: true });
    (document.activeElement || document.body).dispatchEvent(key);
    return key.defaultPrevented;
  });

  // On a lead, with the switch an earlier version stored still in the browser.
  let page = await fresh({ before: () => localStorage.setItem('konnectNotes:bookingAccess:v1', 'on') });
  await page.fill('#initA', 'Web enquiry');
  await page.click('#callA');
  await page.keyboard.type('vm1 ');
  await page.keyboard.type('ni ');
  check('shorthand expands in Call Notes', await page.inputValue('#callA') === '1 - VM left -- Sam Tester\nNot interested -- Sam Tester\n', await page.inputValue('#callA'));
  const eo = await leadResetTypes(page, '#callA', 'eo');
  const cad = await leadResetTypes(page, '#pcA', 'cad');
  check('the words Lead Re setup types still expand', eo.prevented && /EMAIL ONLY LEAD: jo@example\.com/.test(eo.value) && cad.prevented && /actioned by dealer/i.test(cad.value), [eo, cad]);
  check('the call outcome follows the note for other staff too', await page.evaluate(() => /message left/i.test(document.querySelector('#callOutcome').selectedOptions[0].textContent) && window.outcomeChanges === 1), await page.evaluate(() => [document.querySelector('#callOutcome').selectedOptions[0].textContent, window.outcomeChanges]));
  await page.click('#callA');
  check('Alt+B does nothing and is left to the page', await altB(page) === false && await page.evaluate(() => !KonnectNotes.state.open));
  await page.click('#kn-notes-launcher-section .kn-launcher');
  await sleep(150);
  const panel = await page.evaluate(() => {
    const palette = document.getElementById('kn-notes-palette');
    return { open: KonnectNotes.state.open, view: KonnectNotes.state.view, booking: /booking/i.test(palette.textContent), quick: palette.querySelectorAll('.kn-quick').length, search: /Search all phrases/.test(palette.textContent) };
  });
  check('the rail button opens the phrases, with no booking entry', panel.open && panel.view === 'main' && !panel.booking && panel.quick === 5 && panel.search, panel);
  await page.keyboard.press('b');
  await sleep(150);
  check('the B key in the panel opens nothing', await page.evaluate(() => KonnectNotes.state.view === 'main'));
  await page.keyboard.press('2');
  await sleep(100);
  await page.keyboard.press('3');
  await sleep(150);
  check('a phrase picked from the list is written', (await page.inputValue('#callA')).includes('3 - Line ringing -- Sam Tester'), await page.inputValue('#callA'));
  await page.keyboard.press('Alt+n');
  await sleep(150);
  await page.click('[aria-label="Phrase settings"]');
  await sleep(150);
  const settings = await page.evaluate(() => {
    const palette = document.getElementById('kn-notes-palette');
    return { names: Array.from(palette.querySelectorAll('.kn-settings-actions .kn-button')).map((b) => b.textContent), booking: Array.from(palette.querySelectorAll('*')).filter((n) => !n.closest('.kn-phrase-list')).some((n) => /booking|diary/i.test(`${n.title || ''} ${n.children.length ? '' : n.textContent}`)) };
  });
  check('phrase settings are all there and say nothing about booking', settings.names.join() === 'Change name,Add phrase,Export,Import,Reset to standard phrases,Stop Konnect Notes' && !settings.booking, settings);
  await page.keyboard.press('Escape');
  await sleep(2000);
  let things = await bookingThings(page);
  check('on a lead: no booking button, engine, draft or stored booking data (the old stored switch is cleared)', nothing(things), things);
  check('KonnectNotes.openBooking() does nothing either', await page.evaluate(() => { KonnectNotes.openBooking(); return !KonnectNotes.state.open && !KonnectNotes.state.booking; }));
  check('no page errors on a lead', page.errors.length === 0, page.errors);

  // The inbound screens, with and without the Phone column button.
  for (const withPhone of [true, false]) {
    page = await fresh({ hash: '#!/present-inbound-call', before: `(() => {
      document.querySelector('.tab-content').remove();
      if (${withPhone}) {
        const phone = document.createElement('button');
        phone.setAttribute('ng-click', 'manualCallClick()');
        phone.className = 'btn btn-success';
        phone.textContent = 'Call';
        document.body.appendChild(phone);
      }
    })()` });
    await sleep(700);
    const prevented = await altB(page);
    await sleep(300);
    things = await bookingThings(page);
    check(`inbound screen ${withPhone ? 'with' : 'without'} the Phone column: no booking button, Alt+B does nothing, nothing stored`,
      prevented === false && nothing(things) && await page.evaluate(() => !KonnectNotes.state.open), things);
    check('no page errors on the inbound screen', page.errors.length === 0, page.errors);
  }

  // The flag is read live and never stored: set, the builder is there; gone, it is not.
  page = await fresh();
  await page.click('#callA');
  await page.evaluate(() => { window.KonnectNotesOwner = true; });
  await page.keyboard.press('Alt+b');
  await page.waitForFunction(() => window.KonnectBookingEngine && document.querySelector('.kn-bk-actions'), null, { timeout: 5000 });
  await page.evaluate(() => { KonnectNotes.closePalette(); delete window.KonnectNotesOwner; });
  check('the flag is not stored anywhere', await page.evaluate(() => Object.keys(localStorage).every((k) => !/owner|bookingAccess/i.test(k))));
  await page.click('#callA');
  check('with the flag gone again Alt+B does nothing', await altB(page) === false && await page.evaluate(() => !KonnectNotes.state.open));
}

// The owner's helpers: on only when Work Tools has set KonnectNotesOwner.
async function ownerHelpers() {
  console.log('\nOwner helpers');
  const outcome = (page) => page.evaluate(() => {
    const select = document.querySelector('#callOutcome');
    return { text: select ? select.options[select.selectedIndex].textContent : null, changes: window.outcomeChanges };
  });
  const typeNote = async (page, word) => {
    await page.click('#callA');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`${word} `);
    await sleep(150);
  };
  // A weekday at least a week ahead, so the booking has no date problems.
  const when = new Date();
  when.setDate(when.getDate() + 7);
  while (when.getDay() !== 2) when.setDate(when.getDate() + 1);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const sheetDate = `${when.getDate()} ${months[when.getMonth()]} ${when.getFullYear()}`;
  const appointment = { day: String(when.getDate()).padStart(2, '0'), month: String(when.getMonth() + 1).padStart(2, '0') };
  // The lead's dealer and Vehicle of Interest, as the real lead pane has them.
  const addLeadDetails = (dealer, purchase) => `(() => {
    const pane = document.querySelector('#paneA');
    pane.insertAdjacentHTML('afterbegin', '<div class="form-group"><label>Dealer</label><select ng-model="theActivity.SalesLead.DealerID"><option>(Select a Dealer)</option>${dealer ? `<option selected>${dealer}</option>` : ''}</select></div>' +
      '<div class="panel"><div class="panel-heading">Vehicle of Interest</div><select><option>(Select)</option>${purchase ? `<option selected>${purchase}</option>` : ''}</select></div>');
  })()`;
  const fillBooking = (page, type) => page.evaluate(([a, t]) => {
    const data = KonnectNotes.state.booking.data;
    Object.assign(data, { type: t, day: a.day, month: a.month, year: '', time: '14:00' });
    data.vehicles[0] = { make: 'Peugeot', model: '208', reg: '', descriptor: '', condition: 'used' };
    KonnectNotes.openBooking();
  }, [appointment, type]);
  const openBuilder = async (page) => {
    await page.click('#callA');
    await page.keyboard.press('Alt+b');
    await page.waitForFunction(() => window.KonnectBookingEngine && document.querySelector('.kn-bk-actions'), null, { timeout: 5000 });
  };
  const notesOnly = async (page) => {
    await page.click('.kn-bk-actions .kn-button:has-text("Notes only")');
    await sleep(300);
  };
  const sheetButtons = (page) => page.evaluate(() => ({
    toast: !!document.getElementById('kn-sheet-row-toast'),
    builder: !!document.querySelector('.kn-bk-sheet-row'),
    anywhere: Array.from(document.querySelectorAll('button')).some((b) => /booking sheet/i.test(b.textContent))
  }));

  let page;
  let now;
  let shown;
  // Helper 1: the call outcome follows the note.
  page = await fresh({ owner: true });
  await typeNote(page, 'vm1');
  now = await outcome(page);
  check('owner: vm sets No Answer Message Left through a change event', now.text === 'No Answer - Message Left' && now.changes === 1, now);
  check('owner: the toast says what was set', /Call outcome set: No Answer Message Left/.test(await toastText(page)), await toastText(page));
  await typeNote(page, 'cnr2');
  now = await outcome(page);
  check('owner: an outcome already chosen is not overwritten', now.text === 'No Answer - Message Left' && now.changes === 1 && /Call outcome left as No Answer - Message Left/.test(await toastText(page)), [now, await toastText(page)]);
  await page.click('.kn-toast button:has-text("Change to No Answer No Message Left")');
  await sleep(150);
  now = await outcome(page);
  check('owner: the toast button changes it', now.text === 'No Answer - No Message Left' && now.changes === 2 && /Call outcome set: No Answer No Message Left/.test(await toastText(page)), [now, await toastText(page)]);
  await sleep(4600);
  await typeNote(page, 'vm3');
  check('owner: left alone again without a press', (await outcome(page)).changes === 2 && /Call outcome left as/.test(await toastText(page)), await toastText(page));
  await page.evaluate(() => { document.querySelectorAll('.kn-toast').forEach((n) => n.remove()); document.querySelector('#callOutcome').selectedIndex = 2; window.outcomeChanges = 1; });
  await sleep(4600);
  await typeNote(page, 'vm3');
  check('owner: the same outcome again says nothing', !/Call outcome/.test(await toastText(page)) && (await outcome(page)).changes === 1, await toastText(page));

  page = await fresh({ owner: true });
  await page.click('#callA');
  await page.keyboard.press('Alt+n');
  await sleep(150);
  await page.keyboard.press('3');
  await sleep(100);
  await page.keyboard.press('1');
  await sleep(150);
  now = await outcome(page);
  check('owner: Could not reach lead picked from the list sets No Answer No Message Left',
    (await page.inputValue('#callA')).includes('1 - Could not reach lead -- Sam Tester') && now.text === 'No Answer - No Message Left' && now.changes === 1, [now, await page.inputValue('#callA')]);

  for (const [word, want] of [['ring1', 'No Answer - No Message Left'], ['eng1', 'No Answer - No Message Left'], ['rf1', 'No Answer - No Message Left'],
    ['mbf1', 'No Answer - No Message Left'], ['dvm1', 'No Answer - No Message Left'], ['lfe', 'No Answer - No Message Left'], ['book', 'No Answer - Message Left'],
    ['ni', '(Select a Call Outcome)'], ['eo', '(Select a Call Outcome)'], ['ec', '(Select a Call Outcome)'], ['es', '(Select a Call Outcome)']]) {
    page = await fresh({ owner: true });
    await typeNote(page, word);
    now = await outcome(page);
    check(`owner: "${word}" gives ${want}`, now.text === want && (await page.inputValue('#callA')).trim() !== word, [now, await page.inputValue('#callA')]);
  }
  check('owner: Update Outcomes (No Call Made) is never chosen by a note', now.text !== 'Update Outcomes (No Call Made)');

  page = await fresh({ owner: true, before: () => {
    const select = document.querySelector('#callOutcome');
    select.selectedIndex = 1;
  } });
  await typeNote(page, 'vm1');
  now = await outcome(page);
  check('owner: Spoke to Customer is kept and said', now.text === 'Spoke to Customer' && now.changes === 0 && /Call outcome left as Spoke to Customer/.test(await toastText(page)), [now, await toastText(page)]);

  page = await fresh({ owner: true, before: () => document.querySelector('#callOutcome').closest('.row').remove() });
  await typeNote(page, 'vm1');
  check('owner: no call outcome box on the page does nothing', (await page.inputValue('#callA')).includes('1 - VM left') && !/Call outcome/.test(await toastText(page)) && page.errors.length === 0, [await toastText(page), page.errors]);

  page = await fresh({ owner: true, before: () => {
    document.querySelectorAll('#callOutcome option').forEach((o) => { if (/No Answer/.test(o.textContent)) o.remove(); });
  } });
  await typeNote(page, 'vm1');
  now = await outcome(page);
  check('owner: an outcome the box does not offer is not set', now.text === '(Select a Call Outcome)' && now.changes === 0 && !/Call outcome/.test(await toastText(page)), now);
  await page.evaluate(() => { document.querySelector('#callOutcome').selectedIndex = 1; });
  await typeNote(page, 'vm2');
  check('owner: no Change button for an outcome the box does not offer', /Call outcome left as Spoke to Customer/.test(await toastText(page)) && await page.evaluate(() => !document.querySelector('.kn-toast button')), await toastText(page));

  page = await fresh({ owner: true });
  await page.fill('#initA', 'Web enquiry');
  await page.fill('#callA', '1 - VM left -- Sam Tester');
  await page.click('#pcA');
  await page.keyboard.type('ca1 ');
  await sleep(150);
  now = await outcome(page);
  check('owner: a Post Closure phrase leaves the call outcome alone', /Attempt 1/.test(await page.inputValue('#pcA')) && now.text === '(Select a Call Outcome)' && now.changes === 0, now);

  // Helper 2: the booking sheet row, on a lead.
  const failures = await page.evaluate(() => KonnectNotes.sheetRowSelfTest());
  check('the sheet row self-test passes', Array.isArray(failures) && failures.length === 0, failures);
  check('the owner example row', await page.evaluate(() => KonnectNotes.buildSheetRow({ dealer: 'Stellantis &You Preston', name: 'Jo Example', year: 2026, month: 11, day: 14,
    diaryType: 'Face To Face', condition: 'used', inDiary: true })) === 'Preston\tJo Example\t14 November 2026\tFace to Face\tOutbound lead\tUsed\t\tY');

  page = await fresh({ booking: true, owner: true, before: addLeadDetails('Stellantis &You Preston', 'Used') });
  await openBuilder(page);
  await fillBooking(page, 'view');
  shown = await sheetButtons(page);
  check('row: no button before the booking is written', !shown.toast && !shown.builder, shown);
  await notesOnly(page);
  shown = await sheetButtons(page);
  check('row: the button is offered once the booking is in Call Notes', /Customer is booked in on/.test(await page.inputValue('#callA')) && shown.toast, [shown, await page.inputValue('#callA')]);
  check('row: nothing is copied until the button is pressed', await page.evaluate(() => window.copied.length === 0));
  await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
  await sleep(200);
  let copied = await page.evaluate(() => window.copied);
  check('row: in lead booking, not in the diary', copied.length === 1 && copied[0] === `Preston\tJo Example\t${sheetDate}\tFace to Face\tOutbound lead\tUsed\t\tN`, copied);
  check('row: one line, eight cells, no header', copied.length === 1 && !/\n/.test(copied[0]) && copied[0].split('\t').length === 8, copied);
  check('row: the button says it was copied', /Copied/.test(await page.evaluate(() => document.querySelector('#kn-sheet-row-toast')?.textContent || '')));
  check('row: the Source switch starts on what the tool worked out', /Source: Outbound lead/.test(await page.evaluate(() => document.querySelector('#kn-sheet-row-toast [role="switch"]')?.textContent || '')));
  // The diary itself is not mocked: the draft is marked the way a diary run marks it.
  await page.evaluate(([a, year]) => {
    KonnectNotes.state.booking.diaryBooked = `${year}-${Number(a.month)}-${Number(a.day)} 14:00 Face To Face`;
  }, [appointment, when.getFullYear()]);
  await openBuilder(page);
  shown = await sheetButtons(page);
  await page.click('.kn-bk-sheet-row');
  await sleep(200);
  check('row: the builder button brings the toast back without copying', shown.builder && (await sheetButtons(page)).toast && await page.evaluate(() => window.copied.length === 1));
  await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
  await sleep(200);
  copied = await page.evaluate(() => window.copied);
  check('row: a booking the tool put in the diary says Y', copied.length === 2 &&
    copied[1] === `Preston\tJo Example\t${sheetDate}\tFace to Face\tOutbound lead\tUsed\t\tY`, copied);
  await page.click('.kn-bk-sheet-row');
  await page.click('#kn-sheet-row-toast [role="switch"]');
  await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
  await sleep(200);
  copied = await page.evaluate(() => window.copied);
  check('row: the Source switch flips the cell and is remembered', copied.length === 3 && copied[2].split('\t')[4] === 'Inbound Call' &&
    await page.evaluate(() => KonnectNotes.state.booking.fromInbound === true), copied);
  await page.evaluate(() => KonnectNotes.stop());
  check('row: Stop takes the button away', !(await sheetButtons(page)).toast);
  check('row: never written to the console', !page.consoleText.some((t) => /Jo Example|Preston\t/.test(t)), page.consoleText);
  check('no page errors on the lead flow', page.errors.length === 0, page.errors);

  // Motability wins, a dealer not on the sheet is left empty.
  page = await fresh({ booking: true, owner: true, before: addLeadDetails('Stellantis &You Brentford', 'Motability') });
  await openBuilder(page);
  await fillBooking(page, 'testdrive');
  await notesOnly(page);
  await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
  await sleep(200);
  copied = await page.evaluate(() => window.copied);
  check('row: Motability lead, unknown dealer left empty, test drive', copied[0] === `\tJo Example\t${sheetDate}\tTest Drive\tOutbound lead\tMotability\t\tN`, copied);

  // A title on the name, the lead's purchase type over a registration, and
  // the dealers a booking is never made for.
  for (const [dealer, message] of [['Stellantis &You Brentford', 'Brentford is service only. Change the lead\'s dealer first.'],
    ['National', 'National is not a dealership. Change the lead\'s dealer first.'], ['Stellantis &You General Sales', 'General Sales is not a dealership. Change the lead\'s dealer first.']]) {
    page = await fresh({ booking: true, owner: true, before: addLeadDetails(dealer, 'New') });
    await page.evaluate(() => {
      document.querySelector('#custName').textContent = 'Mrs. Jo Example';
      window.diaryClicks = 0;
      const open = document.createElement('button');
      open.setAttribute('ng-click', 'manageSalesEventBookings(theActivity)');
      open.textContent = 'Manage Appointments';
      open.addEventListener('click', () => { window.diaryClicks += 1; });
      document.querySelector('#paneA').appendChild(open);
    });
    await openBuilder(page);
    await fillBooking(page, 'view');
    await page.evaluate(() => { KonnectNotes.state.booking.data.vehicles[0].reg = 'AB12CDE'; KonnectNotes.openBooking(); });
    await page.click('.kn-bk-actions .kn-button.kn-primary');
    await sleep(500);
    const status = await page.evaluate(() => ({ text: document.querySelector('.kn-bk-status-error')?.textContent || '', clicks: window.diaryClicks, booked: KonnectNotes.state.booking.diaryBooked || null }));
    check(`guard: ${dealer} is stopped before the diary, with the reason`, status.text.includes(message) && status.clicks === 0 && !status.booked && /Customer is booked in on/.test(await page.inputValue('#callA')), status);
    await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
    await sleep(300);
    check(`guard: ${dealer} is stopped on Diary only too`, await page.evaluate(() => window.diaryClicks === 0 && /Change the lead's dealer first/.test(document.querySelector('.kn-bk-status-error')?.textContent || '')));
    if (/Brentford/.test(dealer)) {
      await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
      await sleep(200);
      copied = await page.evaluate(() => window.copied);
      check('row: title taken off the name, the lead says New although the car has a reg', copied[0] === `\tJo Example\t${sheetDate}\tFace to Face\tOutbound lead\tNew\t\tN`, copied);
    }
  }
  // A National Reservation on a National dealer keeps its own message.
  page = await fresh({ booking: true, owner: true, before: addLeadDetails('National', 'New') });
  await openBuilder(page);
  await fillBooking(page, 'national');
  await page.evaluate(() => { KonnectNotes.state.booking.data.vehicles[0].reg = 'AB12CDE'; KonnectNotes.openBooking(); });
  await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
  await sleep(300);
  let national = await page.evaluate(() => document.querySelector('.kn-bk-status-error')?.textContent || '');
  check('guard: a National Reservation on National still asks for the dealer to be changed', /The lead's dealer is "National"\. Change it in the lead's dealer drop down first/.test(national), national);
  await page.evaluate(() => { const o = document.querySelector('#paneA select[ng-model*="Dealer"] option[selected]'); o.textContent = 'Stellantis &You Brentford'; });
  await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
  await sleep(300);
  national = await page.evaluate(() => document.querySelector('.kn-bk-status')?.textContent || '');
  check('guard: a National Reservation moved to Brentford is stopped, not offered for confirmation', /Brentford is service only/.test(national) && !/Press again to confirm/.test(national), national);
  await page.evaluate(() => { const o = document.querySelector('#paneA select[ng-model*="Dealer"] option[selected]'); o.textContent = 'Stellantis &You Preston'; });
  await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
  await sleep(300);
  national = await page.evaluate(() => document.querySelector('.kn-bk-status')?.textContent || '');
  check('guard: a National Reservation moved to a real dealer goes on to its confirmation', /National Reservation: book it at Stellantis &You Preston/.test(national), national);
  // An inbound call carried on in a lead the customer already had: the
  // builder was opened on the inbound screen, then an existing lead opened.
  page = await fresh({ booking: true, owner: true, hash: '#!/present-inbound-call', before: `(() => {
    ${addLeadDetails('Stellantis &You Preston', 'Used')};
    window.heldTabs = document.querySelector('.tab-content').parentElement;
    window.heldTabs.remove();
    const phone = document.createElement('button');
    phone.setAttribute('ng-click', 'manualCallClick()');
    phone.className = 'btn btn-success';
    phone.textContent = 'Call';
    document.body.appendChild(phone);
  })()` });
  await sleep(400);
  await page.click('#kn-inbound-launcher');
  await page.waitForSelector('.kn-bk-content', { timeout: 5000 });
  await page.evaluate(() => KonnectNotes.closePalette());
  await page.evaluate(() => { document.body.appendChild(window.heldTabs); location.hash = '#!/call/1'; });
  await sleep(1200);
  await openBuilder(page);
  await fillBooking(page, 'view');
  await notesOnly(page);
  check('existing lead after an inbound: the switch starts on Inbound Call', /Source: Inbound Call/.test(await page.evaluate(() => document.querySelector('#kn-sheet-row-toast [role="switch"]')?.textContent || '')));
  await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
  await sleep(200);
  copied = await page.evaluate(() => window.copied);
  check('row: an inbound call carried on in an existing lead says Inbound Call', copied[0] === `Preston\tJo Example\t${sheetDate}\tFace to Face\tInbound Call\tUsed\t\tN`, copied);
  // The next customer on that tab is an ordinary outbound lead again.
  await page.evaluate(() => { KonnectNotes.closePalette(); document.querySelector('#custName').textContent = 'Sam Sample'; document.querySelector('#custEmail').textContent = 'sam@example.com'; document.querySelector('#callA').value = ''; });
  await sleep(2200);
  await openBuilder(page);
  await fillBooking(page, 'view');
  await notesOnly(page);
  check('the lead after that is outbound again', /Source: Outbound lead/.test(await page.evaluate(() => document.querySelector('#kn-sheet-row-toast [role="switch"]')?.textContent || '')));

  // The inbound flow: built with no lead open, carried onto the new lead.
  page = await fresh({ booking: true, owner: true, hash: '#!/present-inbound-call', before: `(() => {
    window.heldTabs = document.querySelector('.tab-content').parentElement;
    window.heldTabs.remove();
    const phone = document.createElement('button');
    phone.setAttribute('ng-click', 'manualCallClick()');
    phone.className = 'btn btn-success';
    phone.textContent = 'Call';
    document.body.appendChild(phone);
  })()` });
  await sleep(400);
  await page.click('#kn-inbound-launcher');
  await page.waitForSelector('.kn-bk-content', { timeout: 5000 });
  await page.fill('.kn-bk-content input[placeholder="07700 900123"]', '07700 900123');
  await page.selectOption('.kn-bk-content select >> nth=0', { label: 'Preston' }).catch(() => page.selectOption('.kn-bk-content select >> nth=0', { index: 1 }));
  await fillBooking(page, 'testdrive');
  await sleep(500);
  const inboundDealer = await page.evaluate(() => document.querySelectorAll('.kn-bk-content select')[0]?.selectedOptions[0]?.textContent || '');
  await page.evaluate(() => KonnectNotes.closePalette());
  check('inbound: no sheet row button while there is no lead', !(await sheetButtons(page)).anywhere);
  await page.evaluate(() => { document.body.appendChild(window.heldTabs); location.hash = '#!/call/1'; });
  await sleep(1200);
  await openBuilder(page);
  const carried = await page.evaluate(() => ({ key: KonnectNotes.state.booking.key, type: KonnectNotes.state.booking.data.type, from: KonnectNotes.state.booking.fromInbound }));
  check('inbound: the booking is carried onto the new lead', carried.key !== 'inbound' && carried.type === 'testdrive' && carried.from === true, carried);
  await notesOnly(page);
  await page.click('#kn-sheet-row-toast button:has-text("Copy booking sheet row")');
  await sleep(200);
  copied = await page.evaluate(() => window.copied);
  const wantDealer = /Birmingham Central/.test(inboundDealer) ? 'Birmingham Central' : 'Preston';
  check('row: inbound booking says Inbound Call, dealer from the Customer step', copied.length === 1 &&
    copied[0] === `${wantDealer}\tJo Example\t${sheetDate}\tTest Drive\tInbound Call\tUsed\t\tN`, [copied, inboundDealer]);
  await page.reload();
  await page.evaluate((b) => { window.KonnectNotesBaseUrl = b; window.KonnectNotesOwner = true; }, base);
  await page.addScriptTag({ url: `${base}Konnect-Notes.js` });
  await page.waitForFunction(() => window.KonnectNotes && window.KonnectNotes.state.config, null, { timeout: 5000 });
  await sleep(300);
  await openBuilder(page);
  check('inbound: the source is remembered with the draft', await page.evaluate(() => KonnectNotes.state.booking.fromInbound === true && !!KonnectNotes.state.booking.inserted));
  check('no page errors on the inbound flow', page.errors.length === 0, page.errors);

  // The booking check: a booking the tool put in the diary is noted for SLA
  // Manager. The mock page has no diary, so the smallest stand-in is added
  // here: the lead's scope with its contact details, Manage Appointments, one
  // free box at 14:00 on the right day, the appointment form and the outcome lists.
  const CHECKS_KEY = '_workToolsBookingChecks';
  const diaryLabel = `Tuesday ${months[when.getMonth()].slice(0, 3)} ${when.getDate()}th`;
  const addDiary = `(() => {
    ${addLeadDetails('Stellantis &You Preston', 'Used')};
    const pane = document.querySelector('#paneA');
    window.mockActivity = { ID: 4242, SalesAppointmentID: 0, SalesLead: { CustomerName: 'Jo Example', EmailAddress: 'jo.lead@example.com', MobileNumber: '07700 900123', LandlineNumber: '' } };
    window.angular = { element: (node) => ({ scope: () => (node && node.closest && node.closest('#paneA') ? { theActivity: window.mockActivity } : undefined), controller: () => null }) };
    const lists = [['Customer Hub Team'], ['Appointment'], ['Face To Face', 'Test Drive', 'Phone Call']];
    pane.insertAdjacentHTML('beforeend', lists.map((names, i) => '<select ng-model="theActivity.SelectedOutcomeLevel' + (i + 1) + '"><option>(Select)</option>' +
      names.map((n) => '<option>' + n + '</option>').join('') + '</select>').join('') +
      '<button ng-click="manageSalesEventBookings(theActivity)" id="openDiary">Manage Appointments</button>');
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'none';
    const form = '<button ng-click="makingAppointment=true" id="make">Make Appointment</button><div id="apptForm" style="display:none">' +
      '<div><button>Time Span</button><button class="dropdown-toggle">v</button><a ng-click="setAppointmentLength(30)">30 minutes</a> <a ng-click="setAppointmentLength(60)">60 minutes</a></div>' +
      '<div><button>Type</button><button class="dropdown-toggle">v</button><a ng-click="setAppointmentType(1)">Face To Face</a> <a ng-click="setAppointmentType(2)">Test Drive</a></div>' +
      '<button ng-click="createAppointment()" id="confirm">Confirm</button></div>';
    modal.innerHTML = '<button ng-click="openStartDate($event)">${diaryLabel}</button>' +
      '<table><thead><tr><th>Name</th><th>14:00</th></tr></thead><tbody><tr><td>Alex Advisor</td><td ng-click="SelectTimeSlot(1)" id="slot" style="width:60px;height:24px;border:1px solid #999"></td></tr></tbody></table>' +
      '<div id="apptArea"></div><button ng-click="cancel()">Close</button>';
    document.body.appendChild(modal);
    window.diaryMade = 0;
    document.querySelector('#openDiary').addEventListener('click', () => { modal.querySelector('#apptArea').innerHTML = ''; modal.style.display = 'block'; });
    modal.addEventListener('click', (event) => {
      const id = event.target.id;
      if (id === 'slot') modal.querySelector('#apptArea').innerHTML = form;
      if (id === 'make') modal.querySelector('#apptForm').style.display = 'block';
      if (id === 'confirm') { modal.querySelector('#apptArea').innerHTML = ''; window.diaryMade += 1; window.mockActivity.SalesAppointmentID = 9000 + window.diaryMade; }
      if (event.target.getAttribute('ng-click') === 'cancel()') modal.style.display = 'none';
    });
  })()`;
  const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), CHECKS_KEY);
  const booked = (page, count) => page.waitForFunction((n) => window.diaryMade === n && Array.from(document.querySelectorAll('.kn-toast')).some((t) => /Diary booked/.test(t.textContent)) &&
    !Array.from(document.querySelectorAll('.modal')).some((m) => m.style.display !== 'none'), count, { timeout: 30000 });
  const rowWanted = `Preston\tJo Example\t${sheetDate}\tFace to Face\tOutbound lead\tUsed\t\tY`;

  const checkFailures = await page.evaluate(() => KonnectNotes.bookingCheckSelfTest());
  check('the booking check self-test passes', Array.isArray(checkFailures) && checkFailures.length === 0, checkFailures);

  page = await fresh({ booking: true, owner: true, before: addDiary });
  // Another booking SLA Manager has already checked, with a field this tool does not know.
  const earlier = { id: 'bk-earlier', bookingKey: 'lead-1 2026-11-14 10:00 Test Drive', name: 'Sam Sample', bookedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), state: 'checked', sent: true, later: 'kept' };
  await page.evaluate(([key, e]) => localStorage.setItem(key, JSON.stringify({ savedAt: 'then', bookings: [e, { id: 'bk-old', bookedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() }] })), [CHECKS_KEY, earlier]);
  await openBuilder(page);
  await fillBooking(page, 'view');
  check('check: nothing is noted before the diary is booked', (await stored(page)).bookings.length === 2);
  const beforeBooking = Date.now();
  await page.click('.kn-bk-actions .kn-button.kn-primary');
  await booked(page, 1);
  await sleep(300);
  let checks = await stored(page);
  let entry = checks.bookings.find((b) => !/^bk-(earlier|old)$/.test(b.id)) || {};
  check('check: the diary run finished with the outcome set', await page.evaluate(() => !!KonnectNotes.state.booking.diaryBooked) && /Diary booked and outcome set: Face To Face with Alex Advisor/.test(await toastText(page)), await toastText(page));
  check('check: one entry is written for the booking', checks.bookings.length === 2 && /^bk-\d+-[a-z0-9]+$/.test(entry.id), checks);
  check('check: the customer as the sheet row has them, contact details from the lead', entry.name === 'Jo Example' && entry.email === 'jo.lead@example.com' && entry.phone === '07700 900123', entry);
  check('check: dealer, type and date in the sheet spelling', entry.dealer === 'Preston' && entry.apptType === 'Face to Face' && entry.apptDate === sheetDate, entry);
  check('check: the row is the sheet row, eight cells, the seventh (Checked on kL) empty', entry.row === rowWanted && entry.row.split('\t').length === 8 && entry.row.split('\t')[6] === '', entry.row);
  check('check: it waits to be checked', entry.state === 'waiting' && entry.tries === 0 && entry.appointment === null && entry.outcome === null && entry.sent === null, entry);
  check('check: the booked time is now', Date.parse(entry.bookedAt) >= beforeBooking - 1000 && Date.parse(entry.bookedAt) <= Date.now() + 1000, entry.bookedAt);
  check('check: another entry is kept whole, an old one is dropped', JSON.stringify(checks.bookings[0]) === JSON.stringify(earlier) && !checks.bookings.some((b) => b.id === 'bk-old'), checks);
  check('check: the toast says Konnect Live will be checked', (await toastText(page)).includes('Konnect Live will be checked in a few minutes (see Bookings in SLA Manager).'), await toastText(page));
  // The same booking again (Diary only, pressed twice to confirm a second appointment).
  const firstId = entry.id;
  await page.evaluate(([key, id]) => {
    const value = JSON.parse(localStorage.getItem(key));
    Object.assign(value.bookings.find((b) => b.id === id), { state: 'checked', tries: 2, sent: true });
    localStorage.setItem(key, JSON.stringify(value));
    document.querySelectorAll('.kn-toast').forEach((n) => n.remove());
  }, [CHECKS_KEY, firstId]);
  await openBuilder(page);
  await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
  await sleep(300);
  check('check: a repeat is asked about first, and nothing changes yet', /already in the diary/.test(await page.evaluate(() => document.querySelector('.kn-bk-status')?.textContent || '')) && (await stored(page)).bookings.some((b) => b.id === firstId));
  await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
  await booked(page, 2);
  await sleep(300);
  checks = await stored(page);
  entry = checks.bookings[checks.bookings.length - 1];
  check('check: the same booking again replaces its entry', checks.bookings.length === 2 && entry.id !== firstId && !checks.bookings.some((b) => b.id === firstId) && entry.state === 'waiting' && entry.sent === null && entry.row === rowWanted, checks);
  // A different time on the same lead is a new booking.
  await page.evaluate(() => { document.querySelector('.modal thead th:last-child').textContent = '15:00'; document.querySelectorAll('.kn-toast').forEach((n) => n.remove()); });
  // Diary only leaves the builder open.
  await page.evaluate(() => { KonnectNotes.state.booking.data.time = '15:00'; KonnectNotes.openBooking(); });
  await page.click('.kn-bk-actions .kn-button:has-text("Diary only")');
  await booked(page, 3);
  await sleep(300);
  checks = await stored(page);
  check('check: another time on the same lead adds an entry', checks.bookings.length === 3 && new Set(checks.bookings.map((b) => b.bookingKey)).size === 3, checks.bookings.map((b) => b.bookingKey));
  check('check: no customer details in the key that tells bookings apart', checks.bookings.slice(1).every((b) => /^lead-4242 /.test(b.bookingKey) && !/example|07700|Jo/i.test(b.bookingKey)), checks.bookings.map((b) => b.bookingKey));
  check('check: nothing about the customer in the console', !page.consoleText.some((t) => /Jo Example|example\.com|07700/.test(t)), page.consoleText);
  check('no page errors on the booking check', page.errors.length === 0, page.errors);

  // Storage that is full: the booking carries on, without the line about the check.
  page = await fresh({ booking: true, owner: true, before: addDiary });
  await page.evaluate((key) => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return real.call(this, name, value);
    };
  }, CHECKS_KEY);
  await openBuilder(page);
  await fillBooking(page, 'view');
  await page.click('.kn-bk-actions .kn-button.kn-primary');
  await booked(page, 1);
  await sleep(300);
  const full = await page.evaluate((key) => ({ booked: KonnectNotes.state.booking.diaryBooked || null, stored: localStorage.getItem(key), outcome: document.querySelector('#paneA select[ng-model$="Level3"]').value,
    sheet: !!document.getElementById('kn-sheet-row-toast') }), CHECKS_KEY);
  check('full storage: the diary is booked, the outcome set and the sheet row offered', !!full.booked && full.outcome === 'Face To Face' && full.sheet && full.stored === null &&
    /Diary booked and outcome set: Face To Face with Alex Advisor/.test(await toastText(page)), [full, await toastText(page)]);
  check('full storage: the toast does not promise a check', !/Konnect Live/.test(await toastText(page)), await toastText(page));
  check('full storage: no page errors', page.errors.length === 0, page.errors);

  // Other staff: the same page and the same call, with no owner flag.
  page = await fresh({ before: addDiary });
  const staff = await page.evaluate((key) => {
    const result = KonnectNotes.recordBookingCheck({ key: 'lead-4242', data: { type: 'view' }, inserted: true }, { year: 2026, month: 11, day: 14, time: '14:00', type: 'Face To Face' });
    return { result, stored: localStorage.getItem(key) };
  }, CHECKS_KEY);
  check('other staff: a booking is never noted', staff.result === false && staff.stored === null && page.errors.length === 0, [staff, page.errors]);

  // Work Tools sets the flag before Konnect Notes loads.
  const workTools = readFileSync(join(repo, 'Work-Tools.js'), 'utf8');
  const flagAt = workTools.indexOf('window.KonnectNotesOwner = true');
  check('Work Tools sets the owner flag before it loads the tools, and no other switch', flagAt > 0 && flagAt < workTools.indexOf('for (const tool of tools)') && !/KonnectNotesBooking/.test(workTools));
}

// A customer whose part exchange sits on its own PX valuation lead.
async function pxOnAnotherLead() {
  console.log('\nPart exchange on another lead');
  const pxLead = (extra = {}) => ({ id: 77000001, campaign: 'Leapmotor - P/X Valuation - New', request: 'PX Valuation - New', created: '2026-11-12T21:30:00',
    px: { on: true, make: 'Ford', model: 'Fiesta', reg: 'AB12CDE', mileage: '45000', val: '3500' }, ...extra });
  const bookingLead = (extra = {}) => ({ id: 77000002, campaign: 'Leapmotor - Test Drive Request - New', request: 'Test Drive Request - New', active: true, ...extra });
  const thirdLead = { id: 77000003, campaign: 'Leapmotor - Brochure Request - New', request: 'Brochure Request' };
  const NOTICE = 'This customer\'s part exchange is on another lead (PX Valuation - New, 12 Nov 21:30).';
  const PRESS = '.kn-bk-other-px .kn-button:has-text("Use it and close that lead as duplicate")';
  const DONE = 'Part exchange copied from the other lead. That lead is set to Duplicate Lead.';
  const start = async (leads, options = {}) => {
    const page = await fresh({ owner: options.owner !== false, page: 'two-leads.html', before: `window.buildLeads(${JSON.stringify(leads)})` });
    await page.click(`#call-${options.on || 77000002}`);
    await page.keyboard.press('Alt+b');
    if (options.owner !== false) await page.waitForFunction(() => window.KonnectBookingEngine && document.querySelector('.kn-bk-actions'), null, { timeout: 5000 });
    else await sleep(400);
    return page;
  };
  const cards = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.kn-bk-other-px')).map((card) => ({
    text: card.querySelector('.kn-bk-notice-text').textContent,
    buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent)
  })));
  const status = (page) => page.evaluate(() => document.querySelector('.kn-bk-status')?.textContent || '');
  const finished = (page) => page.waitForFunction(() => /outcome yourself|set to Duplicate Lead\.|Nothing was copied/.test(document.querySelector('.kn-bk-status')?.textContent || ''), null, { timeout: 15000 });
  const after = (page) => page.evaluate(() => ({
    draftPx: KonnectNotes.state.booking.data.px,
    key: KonnectNotes.state.booking.key,
    preview: document.querySelector('.kn-bk-preview')?.textContent || '',
    px: window.leadState(77000001),
    booking: window.leadState(77000002),
    activeTab: document.querySelector('#tabs li.active').id,
    callOutcome: document.querySelector('#callOutcome').selectedIndex,
    callOutcomeChanges: window.outcomeChanges,
    finished: window.finishedPresses,
    changedLeads: Array.from(new Set(window.leadOutcomeChanges)),
    storageKeys: Object.keys(localStorage).sort(),
    draftKeys: Object.keys(JSON.parse(Object.entries(localStorage).find(([k]) => /draft/i.test(k))?.[1] || '{}'))
  }));

  let page = await start([pxLead(), bookingLead()], { owner: false });
  check('other staff: no notice and no builder', await page.evaluate(() => !document.querySelector('.kn-bk-other-px') && !/another lead/.test(document.body.textContent)));

  page = await start([pxLead(), bookingLead(), thirdLead]);
  let shown = await cards(page);
  check('owner: the notice names the other lead and has one button', shown.length === 1 && shown[0].text === NOTICE && shown[0].buttons.join('|') === 'Use it and close that lead as duplicate', shown);
  await page.evaluate(() => { KonnectNotes.state.booking.openSection = 'px'; KonnectNotes.openBooking(); });
  shown = await cards(page);
  check('owner: the notice is also in the Part exchange step', shown.length === 2 && await page.evaluate(() => !!document.querySelector('.kn-bk-content .kn-bk-other-px')), shown);
  let now = await after(page);
  check('nothing happens before the press', now.px.outcome.join('') === '' && now.draftPx.status === 'unmentioned' && !now.booking.pxOn && now.changedLeads.length === 0, now);
  await page.click(PRESS);
  await finished(page);
  await sleep(400);
  now = await after(page);
  const item = now.draftPx.items[0];
  check('press: the details are in the draft with part exchange on', now.draftPx.status === 'yes' && item.make === 'Ford' && item.model === 'Fiesta' && item.reg === 'AB12CDE' && item.mileage === '45000' && item.roughVal === '3500', now.draftPx);
  check('press: the booking text shows the part exchange', /Fiesta/.test(now.preview) && /AB12\s?CDE/.test(now.preview), now.preview);
  check('press: the booking lead has the PX boxes filled and its switch on', now.booking.pxOn === true && now.booking.px.Brand === 'Ford' && now.booking.px.Model === 'Fiesta' && /AB12\s?CDE/.test(now.booking.px.Reg) && now.booking.px.Mileage.replace(/\D/g, '') === '45000', now.booking);
  check('press: the PX lead is set to Customer Hub Team > No Opportunity > Duplicate Lead', now.px.outcome.join(' > ') === 'Customer Hub Team > No Opportunity > Duplicate Lead', now.px.outcome);
  check('press: only the PX lead\'s outcome was touched', now.changedLeads.join() === '77000001' && now.booking.outcome.join('') === '' && (await page.evaluate(() => window.leadState(77000003).outcome.join(''))) === '', now.changedLeads);
  check('press: back on the booking lead with its own draft', now.activeTab === 'salesTab-77000002' && now.key === 'lead-77000002', [now.activeTab, now.key]);
  check('press: the status line says what was done', (await status(page)) === DONE, await status(page));
  check('press: Finished is not pressed and the call outcome is left alone', now.finished === 0 && now.callOutcome === 0 && now.callOutcomeChanges === 0, now);
  check('press: nothing new is stored and no draft is made for the PX lead', now.storageKeys.join() === 'konnectNotes:agentName:v1,konnectNotes:bookingDrafts:v1,konnectNotes:workingConfig:v1' && now.draftKeys.join() === 'lead-77000002', [now.storageKeys, now.draftKeys]);
  check('press: the notice is not offered again', (await cards(page)).length === 0, await cards(page));
  check('no page errors', page.errors.length === 0, page.errors);

  page = await start([pxLead({ noDuplicate: true }), bookingLead()]);
  await page.click(PRESS);
  await finished(page);
  await sleep(400);
  now = await after(page);
  check('missing third option: stops with the message', (await status(page)) === 'The duplicate lead outcome was not found under No Opportunity. Set that lead\'s outcome yourself.', await status(page));
  check('missing third option: the details are still copied', now.draftPx.status === 'yes' && now.draftPx.items[0].reg === 'AB12CDE' && now.booking.px.Brand === 'Ford' && now.booking.pxOn === true && now.px.outcome[2] === '', now);
  check('missing third option: back on the booking lead', now.activeTab === 'salesTab-77000002' && now.key === 'lead-77000002', now.activeTab);

  page = await start([pxLead(), bookingLead()]);
  await page.evaluate(() => {
    const px = KonnectNotes.state.booking.data.px;
    px.status = 'yes';
    px.items[0].make = 'Vauxhall';
    KonnectNotes.openBooking();
  });
  await page.click(PRESS);
  await finished(page);
  await sleep(400);
  now = await after(page);
  const notices = () => page.evaluate(() => Array.from(document.querySelectorAll('.kn-bk-notice:not(.kn-bk-other-px)')).map((card) => card.textContent));
  check('typed value: it is kept and the rest is filled', now.draftPx.items[0].make === 'Vauxhall' && now.draftPx.items[0].model === 'Fiesta' && now.booking.px.Brand === 'Vauxhall', now.draftPx);
  check('typed value: the other lead\'s value is offered with Use it / Keep mine', (await notices()).some((text) => /PX brand on the other lead is "Ford"/.test(text) && /Use it/.test(text) && /Keep mine/.test(text)), await notices());
  check('typed value: the status line points at the notices', (await status(page)).startsWith(DONE) && /were kept/.test(await status(page)), await status(page));
  await page.click('.kn-bk-notice:not(.kn-bk-other-px) .kn-button:has-text("Use it")');
  await sleep(200);
  check('typed value: Use it takes the other lead\'s value', await page.evaluate(() => KonnectNotes.state.booking.data.px.items[0].make === 'Ford'));

  page = await start([pxLead({ hierarchy: 'Sales -> ART -> Appointment -> Phone Call' }), bookingLead()]);
  check('a closed PX lead is ignored', (await cards(page)).length === 0, await cards(page));
  page = await start([{ ...thirdLead, px: { on: true, make: 'Ford', model: 'Fiesta' } }, bookingLead()]);
  check('an open lead that is not a PX valuation lead is ignored', (await cards(page)).length === 0, await cards(page));
  page = await start([pxLead({ active: true }), bookingLead({ active: false, id: 77000004, campaign: 'Leapmotor - PX Valuation - Used', request: 'PX Valuation - Used' })], { on: 77000001 });
  check('no notice when the lead being booked is itself a PX valuation lead', (await cards(page)).length === 0, await cards(page));

  page = await start([pxLead(), pxLead({ id: 77000005, request: 'PX Valuation - Used', campaign: 'Leapmotor - PX Valuation - Used', created: '2026-11-13T09:05:00', px: { on: true, make: 'Kia', model: 'Rio', reg: 'CD34EFG', mileage: '60000' } }), bookingLead()]);
  shown = await cards(page);
  check('two PX leads: both are listed to pick from', shown.length === 1 && /2 other part exchange leads/.test(shown[0].text) && shown[0].buttons.join('|') === 'PX Valuation - New, 12 Nov 21:30|PX Valuation - Used, 13 Nov 09:05', shown);
  await page.click('.kn-bk-other-px .kn-button:has-text("PX Valuation - Used")');
  await finished(page);
  await sleep(400);
  now = await after(page);
  check('two PX leads: only the picked one is copied and closed', now.draftPx.items[0].make === 'Kia' && now.px.outcome.join('') === '' && now.changedLeads.join() === '77000005' &&
    (await page.evaluate(() => window.leadState(77000005).outcome[2])) === 'Duplicate Lead', now);
  shown = await cards(page);
  check('two PX leads: the other one is still offered afterwards', shown.length > 0 && shown.every((card) => card.text === NOTICE), shown);

  page = await start([pxLead({ lazyPx: true }), bookingLead()]);
  await page.click(PRESS);
  await finished(page);
  await sleep(400);
  now = await after(page);
  check('boxes not on the page yet: that tab is opened, read and left again', now.draftPx.items[0].reg === 'AB12CDE' && now.px.outcome[2] === 'Duplicate Lead' && now.activeTab === 'salesTab-77000002' && (await status(page)) === DONE, [now.draftPx, await status(page)]);
  check('no page errors on the part exchange runs', page.errors.length === 0, page.errors);
}

const started = Date.now();
try {
  await layout();
  await notesCorrectness();
  await typing();
  await leadResetContract();
  await bookingAndRoutes();
  await pureBuilders();
  await otherStaff();
  await ownerHelpers();
  await pxOnAnotherLead();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passes} passed, ${failures} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
