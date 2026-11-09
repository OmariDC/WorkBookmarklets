#!/usr/bin/env node
// Runs every built-in self-test in the main tools outside the browser,
// then checks the values the files must share. Exit 1 on any failure.
//
//   node tests/run-self-tests.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = ['Konnect-Lead-Checker.js', 'SLA-Manager.js', 'Lead-Reset.js'];
let failed = false;

// Just enough DOM for the scripts to load and run their self-tests. The UI
// itself is not exercised here: that needs a real browser on Konnect.
function fakeElement() {
  const el = {
    style: {}, dataset: {}, children: [], childNodes: [], innerHTML: '', textContent: '', value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild: (c) => c, append() {}, prepend() {}, insertBefore: (c) => c, removeChild: (c) => c, remove() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    attachShadow: () => fakeElement(),
  };
  el.ownerDocument = null;
  return el;
}

function runTool(file) {
  const store = {};
  const counts = { passed: 0, failed: 0 };
  const lines = [];
  const record = (level, args) => {
    const text = args.map(String).join(' ');
    if (level === 'error') { counts.failed++; lines.push('FAIL ' + text.slice(0, 2000)); }
    else if (/self-test passed/i.test(text)) { counts.passed++; lines.push('pass ' + text); }
  };
  const doc = {
    head: fakeElement(), body: fakeElement(), documentElement: fakeElement(), readyState: 'complete',
    createElement: () => fakeElement(), createTextNode: (t) => ({ textContent: t }),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    getElementsByTagName: () => [], getElementsByClassName: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
  };
  const ctx = {
    console: { info: (...a) => record('info', a), log: (...a) => record('log', a), warn: (...a) => record('warn', a), error: (...a) => record('error', a), debug() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: doc, navigator: { clipboard: {} }, location: { href: 'https://example.com/', pathname: '/', hostname: 'example.com', search: '' },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ overflowY: 'visible', display: 'block', visibility: 'visible' }),
    requestAnimationFrame: (f) => setTimeout(f, 0), alert() {}, confirm: () => false,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Promise, Date, URL, Event: class {},
  };
  ctx.window = ctx;
  ctx.self = ctx;
  try {
    vm.runInNewContext(readFileSync(join(root, file), 'utf8'), ctx, { filename: file });
  } catch (error) {
    counts.failed++;
    lines.push('FAIL script threw while loading: ' + (error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error));
  }
  return { counts, lines };
}

// Values both files hard-code. If one side changes without the other, the
// handoff between the tools breaks or a colour/label silently disagrees.
function sharedContractChecks() {
  const lc = readFileSync(join(root, 'Konnect-Lead-Checker.js'), 'utf8');
  const sla = readFileSync(join(root, 'SLA-Manager.js'), 'utf8');
  const reset = readFileSync(join(root, 'Lead-Reset.js'), 'utf8');
  const problems = [];
  const grab = (src, re, what) => {
    const m = src.match(re);
    if (!m) { problems.push(`could not find ${what}`); return null; }
    return m[1].replace(/\s+/g, ' ').trim();
  };
  const pairs = [
    ['Lead Checker batch header vs SLA Manager export headers',
      grab(lc, /const EXPECTED_BATCH_HEADER = (\[[^\]]*\])/, 'EXPECTED_BATCH_HEADER'),
      [...sla.matchAll(/const header = (\['Name', 'Phone', 'Email', 'Source', 'Campaign', 'Created'[^\]]*\])\.join/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())],
    ['Lead Checker results export header vs SLA Manager import header',
      grab(lc, /function buildRawNotesTsvForExtract[\s\S]*?const header = (\[[^\]]*\])/, 'results export header'),
      [grab(sla, /const LEAD_CHECKER_IMPORT_HEADER = (\[[^\]]*\])/, 'LEAD_CHECKER_IMPORT_HEADER')]],
    ['National check batch header',
      grab(lc, /const NATIONAL_BATCH_HEADER = (\[[^\]]*\])/, 'NATIONAL_BATCH_HEADER (Lead Checker)'),
      [grab(sla, /const NATIONAL_BATCH_HEADER = (\[[^\]]*\])/, 'NATIONAL_BATCH_HEADER (SLA Manager)')]],
    ['National check results header',
      grab(lc, /const NATIONAL_RESULT_HEADER = (\[[^\]]*\])/, 'NATIONAL_RESULT_HEADER (Lead Checker)'),
      [grab(sla, /const NATIONAL_RESULT_HEADER = (\[[^\]]*\])/, 'NATIONAL_RESULT_HEADER (SLA Manager)'),
        grab(reset, /const NATIONAL_RESULT_HEADER = (\[[^\]]*\])/, 'NATIONAL_RESULT_HEADER (Lead Reset)')]],
    ['National results storage key',
      grab(sla, /const NATIONAL_RESULTS_KEY = ('[^']*')/, 'NATIONAL_RESULTS_KEY (SLA Manager)'),
      [grab(reset, /const NATIONAL_RESULTS_KEY = ('[^']*')/, 'NATIONAL_RESULTS_KEY (Lead Reset)')]],
    ['Tier colours',
      grab(lc, /const TIER_COLORS = (\{[^}]*\})/, 'TIER_COLORS'),
      [grab(sla, /const LEAD_CHECKER_TIER_COLORS = (\{[^}]*\})/, 'LEAD_CHECKER_TIER_COLORS')]],
    ['Post Closure colours',
      grab(lc, /function postClosureColor\(action\) \{\s*return ([^;]*);/, 'postClosureColor'),
      [grab(sla, /function postClosureActionColor\(action\) \{\s*return ([^;]*);/, 'postClosureActionColor')]],
  ];
  for (const [label, a, others] of pairs) {
    if (a == null) continue;
    if (!others.length) problems.push(`${label}: nothing found on the other side`);
    for (const b of others) if (b != null && a !== b) problems.push(`${label} differ:\n    ${a}\n    ${b}`);
  }
  for (const value of ["'send back through'", "'check: needs contact?'", "'Post Closure Processing'"]) {
    if (!lc.includes(value) || !sla.includes(value)) problems.push(`shared value ${value} is missing from one file`);
  }
  return problems;
}

for (const file of TOOLS) {
  const { counts, lines } = runTool(file);
  console.log(`\n${file}: ${counts.passed} suites passed, ${counts.failed} failures`);
  for (const line of lines) console.log('  ' + line);
  if (counts.failed > 0 || counts.passed === 0) failed = true;
}

const contract = sharedContractChecks();
console.log(`\nShared contract: ${contract.length ? contract.length + ' problem(s)' : 'all values match'}`);
for (const p of contract) console.log('  FAIL ' + p);
if (contract.length) failed = true;

// Self-tests with async parts report a moment after load.
setTimeout(() => process.exit(failed ? 1 : 0), 300);
