/* Run with: node tests/booking-engine.test.js
   Expected outputs come from Omari's real call examples, the agents'
   Excel template sheet and the Stellantis &You booking spec. */
'use strict';

const assert = require('assert');
const E = require('../Konnect-Booking-Engine.js');

const NOW = new Date(2026, 10, 6, 12, 0); // Fri 06/11/2026 12:00
const P = [
  '*** PRIORITY ACCEPTANCE REQUIRED ***',
  'Please confirm provisional appointment with customer',
  'Once you have created a calendar event for an appointment the customer will receive a confirmation TEXT & EMAIL'
];
const VM = 'VM left -- Omari - Please confirm provisional booking with customer';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n${e.message}\n`);
  }
}
function build(input) {
  return E.buildBooking({ agent: 'Omari', ...input }, { now: NOW });
}
function expectLines(input, expected) {
  const result = build(input);
  assert.deepStrictEqual(result.lines, expected, `\nGot:\n${result.text}\nErrors: ${result.errors.join('; ')}`);
  assert.deepStrictEqual(result.errors, []);
  return result;
}
function sentence(input) {
  const result = build(input);
  return result.lines.find((l) => l.startsWith('Customer is booked in on'));
}

/* ---------- Omari's examples ---------- */

test('Example 1: two used Peugeots, petrol automatic, PX by reg and mileage', () => {
  const r = expectLines({
    type: 'testdrive', date: { day: 9 }, time: '16:00',
    vehicles: [
      { make: 'peugeot', model: '3008', condition: 'used', descriptor: 'petrol automatic' },
      { make: 'peugeot', model: '2008', condition: 'used', descriptor: 'petrol automatic' }
    ],
    px: { status: 'yes', items: [{ reg: 'AB70CDE', mileage: '44100' }] },
    notes: ['looking to explore options']
  }, [...P,
    'Customer is booked in on 09/11 at 16:00 to test drive the used Peugeot 3008 and 2008 petrol automatic and have an accurate valuation of their car',
    'PX: (AB70CDE) approx 44100 miles',
    '-Recommended to res',
    '-Looking to explore options']);
  assert.strictEqual(r.title, 'Peugeot 3008 And 2008 Petrol Automatic');
});

test('Example 2: Ford Puma from the lead, FAO Lee', () => {
  expectLines({
    type: 'testdrive', fao: 'lee', date: { day: 15, month: 11 }, time: '11:00AM',
    vehicles: [{ make: 'Ford', model: 'Puma', reg: 'CD73EFG' }]
  }, ['FAO Lee', ...P,
    'Customer is booked in on 15/11 at 11:00 to test drive a used Ford Puma (CD73EFG)',
    '-Recommended to res']);
});

test('Example 3: VM left, Citroen C5 Aircross', () => {
  expectLines({
    type: 'testdrive', contact: 'vm', date: { day: 8, month: 11 }, time: '11:00AM',
    vehicles: [{ make: 'Citroen', model: 'C5 Aircross', reg: 'EF68GHJ' }]
  }, [VM, ...P,
    'Customer is booked in on 08/11 at 11:00 to test drive a used Citroen C5 Aircross (EF68GHJ)',
    '-Recommended to res']);
});

test('Example 4: Motability test drive, not decided yet', () => {
  expectLines({
    type: 'motability', subtype: 'testdrive', date: { day: 8 }, time: '13:30',
    vehicles: [{ make: 'peugeot', model: '5008', descriptor: 'Petrol Hybrid' }],
    notes: ['not yet decided on vehicle']
  }, [...P,
    'Customer is booked in on 08/11 at 13:30 to test drive a Peugeot 5008 petrol hybrid on the Motability scheme',
    '-Not yet decided on vehicle']);
});

test('Example 5: VM left, new Peugeot 5008, 9:00 AM', () => {
  expectLines({
    type: 'testdrive', contact: 'vm', date: { day: 7, month: 11, year: 2026 }, time: '9:00 AM',
    vehicles: [{ make: 'Peugeot', model: '5008', condition: 'new' }]
  }, [VM, ...P,
    'Customer is booked in on 07/11 at 09:00 to test drive a new Peugeot 5008']);
});

test('Partner example: test drive with call beforehand, no PX, cash', () => {
  expectLines({
    type: 'testdrive', date: { day: 7 }, time: '11:00',
    vehicles: [{ make: 'Peugeot', model: 'Partner', reg: 'GH21 JKL' }],
    px: { status: 'none' },
    payment: { kind: 'cash' },
    notes: ['Send video walkthrough today and call customer beforehand to confirm availability.', 'Open to other models | Short or long wheelbase']
  }, [...P,
    'Customer is booked in on 07/11 at 11:00 to test drive a used Peugeot Partner (GH21JKL)',
    '-No PX',
    '-Recommended to res',
    '-Send video walkthrough today and call customer beforehand to confirm availability',
    '-Open to other models | Short or long wheelbase',
    '-Cash purchase']);
});

/* ---------- Template sheet and spec wording ---------- */

const D = { date: { day: 10, month: 11 }, time: '10:00' };
const NEW_MM = [{ make: 'Peugeot', model: '208' }];
const USED_MM = [{ make: 'Peugeot', model: '208', reg: 'AB12CDE' }];
const PX1 = { status: 'yes', items: [{ make: 'mini', model: 'countryman', reg: 'jk64 lmn', mileage: '83,737' }] };

test('Test drive new / used with PX (sheet)', () => {
  assert.strictEqual(sentence({ ...D, type: 'testdrive', vehicles: NEW_MM, px: PX1 }),
    'Customer is booked in on 10/11 at 10:00 to test drive a new Peugeot 208 and have an accurate valuation of their car');
  assert.strictEqual(sentence({ ...D, type: 'testdrive', vehicles: USED_MM, px: PX1 }),
    'Customer is booked in on 10/11 at 10:00 to test drive a used Peugeot 208 (AB12CDE) and have an accurate valuation of their car');
});

test('PX line casing, reg and mileage normalised', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: USED_MM, px: PX1 });
  assert.strictEqual(r.lines[4], 'PX: Mini Countryman (JK64LMN) approx 83737 miles');
  assert.strictEqual(r.lines[5], '-Recommended to res');
});

test('Phone call new / used with and without PX', () => {
  assert.strictEqual(sentence({ ...D, type: 'call', vehicles: NEW_MM, px: PX1 }),
    'Customer is booked in on 10/11 at 10:00 for a call to discuss and have video walkthrough sent via email of a new Peugeot 208 and for an accurate valuation of their car');
  assert.strictEqual(sentence({ ...D, type: 'call', vehicles: USED_MM }),
    'Customer is booked in on 10/11 at 10:00 for a call to discuss and have video walkthrough sent via email of a used Peugeot 208 (AB12CDE)');
  assert.strictEqual(sentence({ ...D, type: 'call', subtype: 'valuation' }),
    'Customer is booked in on 10/11 at 10:00 for a valuation call');
});

test('Call "or before" / "or after"', () => {
  assert.strictEqual(sentence({ ...D, type: 'call', vehicles: NEW_MM, timeQualifier: 'before' }),
    'Customer is booked in on 10/11 at 10:00 or before for a call to discuss and have video walkthrough sent via email of a new Peugeot 208');
});

test('Viewing: vehicle or category, never "vehicle(s)"', () => {
  assert.strictEqual(sentence({ ...D, type: 'view', vehicles: USED_MM, px: PX1 }),
    'Customer is booked in on 10/11 at 10:00 to view a used Peugeot 208 (AB12CDE) and have an accurate valuation of their car');
  assert.strictEqual(sentence({ ...D, type: 'view', category: 'used petrol hybrid SUVs' }),
    'Customer is booked in on 10/11 at 10:00 to view used petrol hybrid SUVs');
  assert.ok(build({ ...D, type: 'view' }).errors.includes('Add the vehicle of interest'));
});

test('Motability: test drive, view, onsite discuss, call (sheet wording)', () => {
  const m = (subtype) => sentence({ ...D, type: 'motability', subtype, vehicles: NEW_MM });
  assert.strictEqual(m('testdrive'), 'Customer is booked in on 10/11 at 10:00 to test drive a Peugeot 208 on the Motability scheme');
  assert.strictEqual(m('view'), 'Customer is booked in on 10/11 at 10:00 to view a Peugeot 208 on the Motability scheme');
  assert.strictEqual(m('discuss'), 'Customer is booked in on 10/11 at 10:00 to discuss a Peugeot 208 on the Motability scheme');
  assert.strictEqual(m('call'), 'Customer is booked in on 10/11 at 10:00 for a call to discuss and have video walkthroughs sent of a Peugeot 208 on the Motability scheme');
  const r = build({ ...D, type: 'motability', subtype: 'testdrive', vehicles: USED_MM });
  assert.ok(!r.lines.includes('-Recommended to res'), 'Motability never gets Recommended to res');
});

test('Online Store templates', () => {
  const os = (subtype, px) => sentence({ ...D, type: 'onlinestore', subtype, vehicles: USED_MM, px });
  assert.strictEqual(os('valuationcall'), 'Customer is booked in on 10/11 at 10:00 for a valuation call and discuss online store vehicle: Peugeot 208 (AB12CDE)');
  assert.strictEqual(os('discuss', PX1), 'Customer is booked in on 10/11 at 10:00 to discuss online store vehicle: Peugeot 208 (AB12CDE) and have an accurate valuation of their car');
  assert.strictEqual(os('discuss'), 'Customer is booked in on 10/11 at 10:00 to discuss online store vehicle: Peugeot 208 (AB12CDE)');
  assert.strictEqual(os('similar', PX1), 'Customer is booked in on 10/11 at 10:00 to test drive similar vehicles to online store Peugeot 208 (AB12CDE) and have an accurate valuation of their car');
  assert.strictEqual(os('call', PX1), 'Customer is booked in on 10/11 at 10:00 for a call to discuss online store vehicle: Peugeot 208 (AB12CDE) and have a video walkthrough sent via email and for an accurate valuation of their car');
  assert.strictEqual(os('call'), 'Customer is booked in on 10/11 at 10:00 for a call to discuss online store vehicle: Peugeot 208 (AB12CDE) and have a video walkthrough sent via email');
  const r = build({ ...D, type: 'onlinestore', subtype: 'discuss', vehicles: USED_MM });
  assert.ok(!r.lines.includes('-Recommended to res'), 'Online Store never gets Recommended to res');
});

test('National Reservation block (sheet), no booking sentence, needs reg', () => {
  const r = expectLines({ type: 'national', vehicles: USED_MM }, [
    '*** PRIORITY ACCEPTANCE REQUIRED *** ONLINE STORE RESERVE',
    'Customer would like to view, and discuss the purchase on the used Peugeot 208 (AB12CDE) from the online store that customer has reserved',
    'PLEASE FOLLOW THE ONLINE STORE PROCESS']);
  assert.strictEqual(r.meta.calendar.text, '16/11'); // Fri 06/11 + 6 working days
  assert.strictEqual(r.meta.calendar.time, '12:00');
  assert.strictEqual(r.title, 'National Reservation Peugeot 208');
  assert.ok(build({ type: 'national', vehicles: NEW_MM }).errors.length > 0);
});

test('Valuation only: in-person (sheet) and call (spec), Vehicle line', () => {
  expectLines({ ...D, type: 'valuation', subtype: 'onsite',
    px: { status: 'yes', items: [{ make: 'Ford', model: 'Focus', reg: 'AB12CDE', mileage: '60k' }] },
    sellingReason: 'sell' }, [...P,
    'Customer is booked in on 10/11 at 10:00 for an in-person valuation appointment',
    'Vehicle: Ford Focus (AB12CDE) approx 60000 miles',
    '-Customer is looking to sell their vehicle']);
  assert.strictEqual(sentence({ ...D, type: 'valuation', subtype: 'call' }),
    'Customer is booked in on 10/11 at 10:00 for a valuation call regarding their vehicle');
});

/* ---------- Spec rules ---------- */

test('Two PX: "their cars"', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: NEW_MM,
    px: { status: 'yes', items: [{ reg: 'AA11AAA', mileage: 1000 }, { reg: 'BB22BBB', mileage: 2000 }] } });
  assert.ok(r.lines[3].endsWith('and have an accurate valuation of their cars'));
  assert.strictEqual(r.lines[4], 'PX: (AA11AAA) approx 1000 miles');
  assert.strictEqual(r.lines[5], 'PX: (BB22BBB) approx 2000 miles');
});

test('PX extras: unknown mileage, finance, rough val, details', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: NEW_MM, px: { status: 'yes', items: [{
    make: 'vauxhall', model: 'corsa', reg: 'cd34efg', mileageUnknown: 'call', roughVal: '4,500',
    finance: 'pcp', financeEnds: 'March 2027', details: ['full service history.'] }] } });
  assert.strictEqual(r.lines[4], 'PX: Vauxhall Corsa (CD34EFG) approx miles unknown - Rough Val £4500 | Mileage currently unknown will be confirmed on call | Full service history | Currently on PCP | Finance ends March 2027');
});

test('PX switch on but empty boxes = not mentioned, no -No PX', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: NEW_MM, px: { status: 'yes', items: [{ make: '', reg: '' }] } });
  assert.ok(!r.text.includes('valuation'));
  assert.ok(!r.text.includes('No PX'));
});

test('No PX variants (private / elsewhere / taking)', () => {
  const first = (status) => build({ ...D, type: 'testdrive', vehicles: USED_MM, px: { status } }).lines[4];
  assert.strictEqual(first('private'), '-No PX | Customer is selling their vehicle privately');
  assert.strictEqual(first('elsewhere'), '-No PX | Customer is selling their vehicle elsewhere');
  assert.strictEqual(first('taking'), '-No PX | Customer is taking their vehicle elsewhere');
  assert.strictEqual(first('leaseReturn'), '-No PX | Customer is returning their current vehicle at the end of their lease');
  const lease = build({ ...D, type: 'testdrive', vehicles: USED_MM, px: { status: 'leaseReturn' } });
  assert.ok(!lease.lines[3].includes('valuation'));
  assert.strictEqual(lease.lines[5], '-Recommended to res');
});

test('Already reserved replaces Recommended to res', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: USED_MM, reserved: true });
  assert.ok(r.lines.includes('-Customer has already reserved the vehicle'));
  assert.ok(!r.lines.includes('-Recommended to res'));
});

test('Mixed new and used: per-vehicle wording with a warning', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: [{ make: 'Peugeot', model: '3008' }, { make: 'Peugeot', model: '2008', reg: 'AB12CDE' }] });
  assert.strictEqual(r.lines[3], 'Customer is booked in on 10/11 at 10:00 to test drive a new Peugeot 3008 and a used Peugeot 2008 (AB12CDE)');
  assert.ok(r.warnings.some((w) => /Mixed new and used/.test(w)));
});

test('Multiple vehicles: same model variants, identical, different makes', () => {
  assert.strictEqual(sentence({ ...D, type: 'testdrive', vehicles: [
    { make: 'Peugeot', model: '2008', descriptor: 'MHEV' }, { make: 'Peugeot', model: '2008', descriptor: 'phev' }] }),
  'Customer is booked in on 10/11 at 10:00 to test drive the new Peugeot 2008 MHEV and PHEV');
  assert.strictEqual(sentence({ ...D, type: 'testdrive', vehicles: [
    { make: 'Peugeot', model: '208' }, { make: 'Peugeot', model: '208' }] }),
  'Customer is booked in on 10/11 at 10:00 to test drive 2 new Peugeot 208 vehicles');
  assert.strictEqual(sentence({ ...D, type: 'view', vehicles: [
    { make: 'Peugeot', model: 'Rifter', descriptor: 'electric' }, { make: 'Citroen', model: 'Berlingo XL', descriptor: 'electric' }] }),
  'Customer is booked in on 10/11 at 10:00 to view the new Peugeot Rifter and Citroen Berlingo XL electric');
  assert.strictEqual(sentence({ ...D, type: 'testdrive', vehicles: [
    { make: 'Peugeot', model: '208', reg: 'AA11AAA' }, { make: 'Peugeot', model: '208', reg: 'BB22BBB' }] }),
  'Customer is booked in on 10/11 at 10:00 to test drive the used Peugeot 208 (AA11AAA and BB22BBB)');
});

test('Finance: one line, defaults to Discuss options, cash + finance', () => {
  const lastLines = (payment) => build({ ...D, type: 'testdrive', vehicles: NEW_MM, payment }).lines.slice(4);
  assert.deepStrictEqual(lastLines({ kind: 'finance', financeType: 'pcp', deposit: '0', term: '48', mpa: '10k', budget: '300' }),
    ['-Finance: PCP | £0 deposit | 48 months | 10000 miles per annum | Budget £300 per month']);
  assert.deepStrictEqual(lastLines({ kind: 'finance', budget: '250' }), ['-Finance: Discuss options | Budget £250 per month']);
  assert.deepStrictEqual(lastLines({ kind: 'both' }), ['-Finance: Discuss options', '-Cash purchase also being considered']);
  assert.deepStrictEqual(lastLines({ kind: 'cashOffers' }), ['-Cash purchase | Looking to discuss available offers and price movement']);
});

test('Email: customer email note, requested action, email only header', () => {
  let r = build({ ...D, type: 'testdrive', vehicles: NEW_MM, customerEmail: 'a@b.com' });
  assert.ok(r.lines.includes('-Customer email: a@b.com'));
  r = build({ ...D, type: 'testdrive', vehicles: NEW_MM, customerEmail: 'a@b.com', emailAction: 'send brochure' });
  assert.ok(r.lines.includes('-Requested email to send brochure | a@b.com'));
  r = build({ ...D, type: 'testdrive', vehicles: NEW_MM, contact: 'email', email: 'a@b.com', customerEmail: 'a@b.com' });
  assert.strictEqual(r.lines[0], 'EMAIL ONLY LEAD: a@b.com -- Omari - Please confirm provisional booking with customer');
  assert.strictEqual((r.text.match(/a@b\.com/g) || []).length, 1, 'email appears exactly once');
  assert.ok(build({ ...D, type: 'call', vehicles: NEW_MM, contact: 'email', email: 'a@b.com' }).errors
    .includes('Email only cannot be used on a call booking'));
  assert.ok(build({ ...D, type: 'testdrive', vehicles: NEW_MM, contact: 'email' }).errors
    .includes('Email only needs the customer email address'));
});

test('On behalf of', () => {
  assert.ok(build({ ...D, type: 'testdrive', vehicles: NEW_MM, onBehalfOf: 'Son' }).lines.includes('-On behalf of son'));
});

test('No full stops anywhere', () => {
  const r = build({ ...D, type: 'testdrive', vehicles: USED_MM, notes: ['Wants a tow bar.', '-likes blue.'] });
  r.lines.forEach((line) => assert.ok(!/\.$/.test(line), `Line ends with a full stop: ${line}`));
  assert.ok(r.lines.includes('-Likes blue'));
});

/* ---------- Dates and times ---------- */

test('Day only: this month if still to come, else next month', () => {
  assert.strictEqual(E.resolveDate({ day: 20 }, NOW).text, '20/11');
  assert.strictEqual(E.resolveDate({ day: 6 }, NOW).text, '06/11');
  assert.strictEqual(E.resolveDate({ day: 1 }, NOW).text, '01/12');
  assert.strictEqual(E.resolveDate({ day: 31 }, NOW).text, '31/12');
  const dec31 = new Date(2026, 11, 31, 9, 0);
  const jan = E.resolveDate({ day: 1 }, dec31);
  assert.strictEqual(jan.text, '01/01');
  assert.strictEqual(jan.year, 2027);
});

test('Day and month: rolls to next year only when not given a year', () => {
  assert.strictEqual(E.resolveDate({ day: 3, month: 1 }, NOW).year, 2027);
  assert.ok(E.resolveDate({ day: 3, month: 11, year: 2026 }, NOW).error);
  assert.ok(E.resolveDate({ day: 31, month: 11 }, NOW).error);
});

test('A day and month just passed is an error, not next year', () => {
  const yesterday = E.resolveDate({ day: 5, month: 11 }, NOW);
  assert.ok(/already passed this year/.test(yesterday.error), yesterday.error);
  assert.ok(/05\/11\/2027/.test(yesterday.error), yesterday.error);
  assert.strictEqual(yesterday.needsYear, 2027);
  assert.strictEqual(yesterday.passed, true);
  assert.strictEqual(yesterday.dateObj, undefined);
});

test('More than 60 days ahead needs the year confirmed', () => {
  const near = E.resolveDate({ day: 5, month: 1 }, NOW); // 60 days ahead
  assert.strictEqual(near.error, undefined);
  assert.strictEqual(near.year, 2027);
  const far = E.resolveDate({ day: 6, month: 1 }, NOW); // 61 days ahead
  assert.ok(/more than 60 days away/.test(far.error), far.error);
  assert.strictEqual(far.needsYear, 2027);
  assert.strictEqual(far.passed, false);
  const sameYear = E.resolveDate({ day: 20, month: 6 }, new Date(2026, 0, 10, 9, 0));
  assert.ok(/20\/06\/2026 is more than 60 days away/.test(sameYear.error), sameYear.error);
  assert.strictEqual(sameYear.passed, false);
});

test('A confirmed year is taken as given', () => {
  const confirmed = E.resolveDate({ day: 5, month: 11, year: 2027 }, NOW);
  assert.strictEqual(confirmed.error, undefined);
  assert.strictEqual(confirmed.year, 2027);
  assert.strictEqual(confirmed.text, '05/11');
  assert.ok(E.resolveDate({ day: 5, month: 11, year: 2026 }, NOW).error);
});

test('A far date blocks the booking until the year is confirmed', () => {
  const vehicles = [{ make: 'Peugeot', model: '208', reg: 'AB12CDE' }];
  const blocked = build({ type: 'testdrive', date: { day: 5, month: 11 }, time: '11:00', vehicles });
  assert.ok(blocked.errors.some((e) => /already passed this year/.test(e)), blocked.errors.join(' / '));
  const ok = build({ type: 'testdrive', date: { day: 5, month: 11, year: 2027 }, time: '11:00', vehicles });
  assert.ok(!ok.errors.some((e) => /passed|days away/.test(e)), ok.errors.join(' / '));
});

test('Times: 24h, am/pm, only :00 or :30', () => {
  assert.strictEqual(E.resolveTime('11:00AM').text, '11:00');
  assert.strictEqual(E.resolveTime('9:00 AM').text, '09:00');
  assert.strictEqual(E.resolveTime('2pm').text, '14:00');
  assert.strictEqual(E.resolveTime('1330').text, '13:30');
  assert.ok(E.resolveTime('13:15').error);
  assert.ok(build({ type: 'testdrive', vehicles: NEW_MM, date: { day: 6 }, time: '09:00' }).errors
    .includes('That time has already passed today'));
});

test('Default time: 2 hours ahead, rounded up to :00 or :30', () => {
  assert.strictEqual(E.defaultTime(new Date(2026, 10, 6, 12, 0)).text, '14:00');
  assert.strictEqual(E.defaultTime(new Date(2026, 10, 6, 12, 10)).text, '14:30');
  assert.strictEqual(E.defaultTime(new Date(2026, 10, 6, 12, 40)).text, '15:00');
});

test('Pre-Registered with reg is used, without reg is new', () => {
  assert.ok(sentence({ ...D, type: 'testdrive', vehicles: [{ make: 'Peugeot', model: '208', reg: 'AB12CDE', condition: 'Pre-Registered' }] }).includes('a used Peugeot 208 (AB12CDE)'));
  assert.ok(sentence({ ...D, type: 'testdrive', vehicles: [{ make: 'Peugeot', model: '208', condition: 'Pre-Registered' }] }).includes('a new Peugeot 208'));
});

test('Model casing', () => {
  assert.strictEqual(E.normaliseModel('c5 aircross'), 'C5 Aircross');
  assert.strictEqual(E.normaliseModel('E-2008'), 'e-2008');
  assert.strictEqual(E.normaliseModel('BERLINGO xl'), 'Berlingo XL');
  assert.strictEqual(E.normaliseMake('DS'), 'DS');
});

/* ---------- Opening hours ---------- */

test('Slots: Mon-Fri 09:00-18:00, Sat to 17:30, Sun 10:00-16:00; calls 30 min, others 1 hour', () => {
  const mon = new Date(2026, 10, 9);
  const sat = new Date(2026, 10, 7);
  const sun = new Date(2026, 10, 8);
  const td = { type: 'testdrive' };
  const call = { type: 'call' };
  const ends = (list) => `${list[0]}-${list[list.length - 1]}`;
  assert.strictEqual(ends(E.availableSlots(mon, td)), '09:00-17:00');
  assert.strictEqual(ends(E.availableSlots(mon, call)), '09:00-17:30');
  assert.strictEqual(ends(E.availableSlots(sat, td)), '09:00-16:30');
  assert.strictEqual(ends(E.availableSlots(sat, call)), '09:00-17:00');
  assert.strictEqual(ends(E.availableSlots(sun, td)), '10:00-15:00');
  assert.strictEqual(ends(E.availableSlots(sun, call)), '10:00-15:30');
  assert.strictEqual(ends(E.availableSlots(sun, { type: 'motability', subtype: 'call' })), '10:00-15:30');
  assert.strictEqual(E.availableSlots(new Date(2026, 10, 6), td, { now: NOW })[0], '12:30');
});

test('Booking outside opening hours is blocked', () => {
  const r = build({ type: 'testdrive', vehicles: NEW_MM, date: { day: 8, month: 11 }, time: '15:30' });
  assert.ok(r.errors.includes('Outside opening hours: Sunday appointments can start 10:00 to 15:00'), r.errors.join('; '));
  assert.deepStrictEqual(build({ type: 'call', vehicles: NEW_MM, date: { day: 8, month: 11 }, time: '15:30' }).errors, []);
  assert.ok(build({ type: 'testdrive', vehicles: NEW_MM, date: { day: 9, month: 11 }, time: '08:30' }).errors.length);
});

/* ---------- Requested date/time in Initial Notes ---------- */

test('Initial notes: website forms', () => {
  const p = (text) => { const r = E.parseRequestedSlot(text); return r && `${r.day}/${r.month} ${r.time}`.trim(); };
  assert.strictEqual(p('Preferred Date/Time: 2026-09-25, 9:00 AM'), '25/09 09:00');
  assert.strictEqual(p('Comment Line #1: Vehicle URL: x | Customer comment: | Date/Time: Sat Sep 05 2026 3:00PM'), '05/09 15:00');
  assert.strictEqual(p('BrandSite-Test_Drive | First Appointment Date Desired: 25/09/2026 | Anytime between 1300 - 1600'), '25/09 13:00');
  assert.strictEqual(p('BrandSite-Test_Drive | Date: 28/09/2026 | Test drive e-5008'), '28/09');
  assert.strictEqual(p('Booking date: 2026-10-11'), '11/10');
  assert.strictEqual(p('Would like to test drive a 3008 hybrid, between 10am and 11am'), '/ 10:00');
  assert.strictEqual(p('Fiat - Test Drive | First Desired Schedule: 00:00 | -'), null);
  assert.strictEqual(p('Pop-in-Test_Drive_New_Users | -'), null);
  const morning = E.parseRequestedSlot('Customer Comments: 2026-09-17 Morning');
  assert.strictEqual(morning.partOfDay, 'morning');
  const odd = E.parseRequestedSlot('Date/Time: Sat Sep 05 2026 3:15PM');
  assert.strictEqual(odd.time, '15:30');
  assert.ok(odd.rounded);
});

test('Make repeated in the model is removed', () => {
  const mm = (make, model) => { const r = E.splitMakeModel(make, model); return `${r.make}|${r.model}`; };
  assert.strictEqual(mm('aLFA rOMEO', 'ALFA ROMEO JUNIOR'), 'aLFA rOMEO|JUNIOR');
  assert.strictEqual(mm('Alfa Romeo', 'Alfa Junior'), 'Alfa Romeo|Junior');
  assert.strictEqual(mm('Peugeot', 'Peugeot 2008'), 'Peugeot|2008');
  assert.strictEqual(mm('Citroen', 'Citroën C5 Aircross'), 'Citroen|C5 Aircross');
  assert.strictEqual(mm('VW', 'Volkswagen Golf'), 'VW|Golf');
  assert.strictEqual(mm('Mercedes-Benz', 'Mercedes A-Class'), 'Mercedes-Benz|A-Class');
  assert.strictEqual(mm('', 'Alfa Romeo Junior'), 'Alfa Romeo|Junior');
  assert.strictEqual(mm('Peugeot', 'Peugeot'), 'Peugeot|Peugeot');
  assert.strictEqual(mm('Mini', 'Countryman'), 'Mini|Countryman');
  assert.strictEqual(mm('Land Rover', 'Range Rover Evoque'), 'Land Rover|Range Rover Evoque');
  assert.strictEqual(sentence({ ...D, type: 'testdrive', vehicles: [{ make: 'aLFA rOMEO', model: 'ALFA ROMEO JUNIOR' }] }),
    'Customer is booked in on 10/11 at 10:00 to test drive a new Alfa Romeo Junior');
  const r = build({ ...D, type: 'testdrive', vehicles: NEW_MM, px: { status: 'yes', items: [{ make: 'FORD', model: 'ford fiesta', reg: 'ab12cde', mileage: '40000' }] } });
  assert.strictEqual(r.lines[4], 'PX: Ford Fiesta (AB12CDE) approx 40000 miles');
});

test('Placeholder values such as "-" are not a vehicle or PX', () => {
  ['-', ' - ', '--', 'n/a', 'N/A', 'none', 'null', 'unknown', 'TBC', '\u2014'].forEach((v) => assert.ok(E.isPlaceholder(v), v));
  ['Peugeot', '2008', 'AB12CDE', 'Petrol'].forEach((v) => assert.ok(!E.isPlaceholder(v), v));
  assert.ok(!E.hasVehicleDetails({ make: '-', model: '-', reg: '-', descriptor: 'Petrol' }));
  assert.ok(!E.hasVehicleDetails({ make: '', model: '', reg: '', descriptor: 'Diesel' }));
  assert.ok(E.hasVehicleDetails({ make: '-', model: '208', reg: '-' }));
  const r = build({ ...D, type: 'testdrive', vehicles: [{ make: '-', model: '-', reg: '-', descriptor: 'Petrol' }],
    px: { status: 'yes', items: [{ make: '-', model: '-', reg: '-', mileage: '-' }] } });
  assert.ok(r.errors.includes('Add the vehicle of interest'));
  assert.ok(!r.text.includes('PX:'));
  assert.ok(!r.text.includes('valuation'));
  const r2 = build({ ...D, type: 'testdrive', vehicles: [{ make: 'Peugeot', model: '208', reg: '-' }],
    px: { status: 'yes', items: [{ make: 'Ford', model: 'Focus', reg: 'n/a', mileage: '-' }] } });
  assert.ok(r2.lines[3].includes('a new Peugeot 208 and have an accurate valuation'), r2.lines[3]);
  assert.strictEqual(r2.lines[4], 'PX: Ford Focus');
});

test('bank holidays are worked out for any year', () => {
  const name = (y, m, d) => E.bankHolidayName(new Date(y, m - 1, d));
  assert.strictEqual(name(2026, 12, 25), 'Christmas Day');
  assert.strictEqual(name(2026, 12, 28), 'Boxing Day'); // 26th is a Saturday
  assert.strictEqual(name(2027, 3, 26), 'Good Friday');
  assert.strictEqual(name(2027, 3, 29), 'Easter Monday');
  assert.strictEqual(name(2027, 5, 3), 'Early May bank holiday');
  assert.strictEqual(name(2027, 5, 31), 'Spring bank holiday');
  assert.strictEqual(name(2027, 8, 30), 'Summer bank holiday');
  assert.strictEqual(name(2027, 12, 27), 'Christmas Day'); // 25th is a Saturday
  assert.strictEqual(name(2027, 12, 28), 'Boxing Day');
  assert.strictEqual(name(2028, 1, 3), "New Year's Day"); // 1st is a Saturday
  assert.strictEqual(name(2026, 11, 10), '');
});

test('a booking on a bank holiday is flagged, not blocked', () => {
  const r = build({ type: 'testdrive', date: { day: 28, month: 12 }, time: '11:00', vehicles: [{ make: 'Peugeot', model: '208', reg: 'AB12CDE' }] });
  assert.ok(r.warnings.some((w) => /bank holiday \(Boxing Day\)/.test(w)), r.warnings.join(' / '));
  assert.ok(!r.errors.some((e) => /holiday/i.test(e)));
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
