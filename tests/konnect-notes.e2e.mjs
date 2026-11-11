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
  const file = name === 'index.html' ? mockPage : served.includes(name) ? normalize(join(repo, name)) : '';
  if (file && existsSync(file) && statSync(file).isFile()) {
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : 'text/plain');
    res.end(readFileSync(file));
  } else { res.statusCode = 404; res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const CAD = '**** Catch All Return Lead **** Lead has been **actioned by dealer**';

// A fresh page with the real script loaded. options.booking loads it the way
// Work Tools does; without it, the way the Konnect Tools bookmark does.
async function fresh(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${base}index.html${options.hash || ''}`);
  await page.evaluate(([b, o]) => {
    localStorage.setItem('konnectNotes:agentName:v1', 'Sam Tester');
    if (o.stored) localStorage.setItem('konnectNotes:workingConfig:v1', JSON.stringify(o.stored));
    window.KonnectNotesBaseUrl = b;
    if (o.booking) window.KonnectNotesBooking = true;
  }, [base, { stored: options.stored || null, booking: !!options.booking }]);
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
  await page.keyboard.type('Spoke to customer, not sure on fin yet, said vm1 was not heard');
  check('6 words inside a sentence are left alone', await page.inputValue('#callA') ===
    'Customer wants to book a test drive\nSpoke to customer, not sure on fin yet, said vm1 was not heard', await page.inputValue('#callA'));
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
  check('12 Clear says what it clears', /Clear notes \+ form/.test(blocked[3][0]), blocked[3]);

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

const started = Date.now();
try {
  await notesCorrectness();
  await typing();
  await leadResetContract();
  await bookingAndRoutes();
  await pureBuilders();
} catch (e) {
  failures++;
  console.log(`FAIL  test crashed: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passes} passed, ${failures} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
