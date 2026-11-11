(function (root, factory) {
  'use strict';
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.KonnectBookingEngine = engine;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* Konnect Booking Engine
     Turns the Booking Builder's answers into the exact Call Notes text,
     following the Stellantis &You booking spec, with these house overrides
     taken from the agents' Excel template sheet:
       - Motability call: "...for a call to discuss and have video
         walkthroughs sent of a [MAKE MODEL] on the Motability scheme"
       - In-person valuation: "...for an in-person valuation appointment"
       - No full stops at the end of any line
       - Same make, different models: "Peugeot 3008 and 2008"
     No UI and no page access: pure input -> output, so it can be tested. */

  const VERSION = '1.0.0';

  const PRIORITY_LINES = [
    '*** PRIORITY ACCEPTANCE REQUIRED ***',
    'Please confirm provisional appointment with customer',
    'Once you have created a calendar event for an appointment the customer will receive a confirmation TEXT & EMAIL'
  ];

  const NATIONAL_LINES = [
    '*** PRIORITY ACCEPTANCE REQUIRED *** ONLINE STORE RESERVE',
    'Customer would like to view, and discuss the purchase on the used {{VEHICLE}} from the online store that customer has reserved.',
    'PLEASE FOLLOW THE ONLINE STORE PROCESS'
  ];

  const MAKES = {
    peugeot: 'Peugeot', citroen: 'Citroen', 'citroën': 'Citroen', vauxhall: 'Vauxhall', ds: 'DS',
    fiat: 'Fiat', abarth: 'Abarth', jeep: 'Jeep', 'alfa romeo': 'Alfa Romeo', alfa: 'Alfa Romeo',
    leapmotor: 'Leapmotor', ford: 'Ford', bmw: 'BMW', mini: 'Mini', mg: 'MG', kia: 'Kia',
    hyundai: 'Hyundai', toyota: 'Toyota', nissan: 'Nissan', honda: 'Honda', mazda: 'Mazda',
    volkswagen: 'Volkswagen', vw: 'Volkswagen', audi: 'Audi', skoda: 'Skoda', seat: 'Seat',
    cupra: 'Cupra', renault: 'Renault', dacia: 'Dacia', volvo: 'Volvo', mercedes: 'Mercedes',
    'mercedes-benz': 'Mercedes-Benz', tesla: 'Tesla', suzuki: 'Suzuki', mitsubishi: 'Mitsubishi',
    'land rover': 'Land Rover', jaguar: 'Jaguar', lexus: 'Lexus', polestar: 'Polestar', byd: 'BYD',
    smart: 'Smart', porsche: 'Porsche', subaru: 'Subaru', ssangyong: 'SsangYong', lancia: 'Lancia'
  };

  /* Kept in their standard capitalised form wherever they appear. */
  const ABBREVIATIONS = ['EV', 'BEV', 'MHEV', 'PHEV', 'HEV', 'PCP', 'HP', 'PCH', 'APR', 'SUV', 'SUVs',
    'GT', 'GTi', 'GTI', 'VTi', 'RS', 'ST', 'XL', 'LWB', 'SWB', 'DSG', 'CVT', 'TDI', 'TSI', 'BlueHDi',
    'PureTech', 'VAT', 'DWP', 'PX', 'VIN', 'MOT', 'UK', 'FAO'];
  const ABBREVIATION_MAP = ABBREVIATIONS.reduce((map, word) => {
    map[word.toLowerCase()] = word;
    return map;
  }, {});

  const CALL_TYPES = new Set(['call']);

  /* ---------- small text helpers ---------- */

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /* Lead boxes often hold a stand-in instead of nothing: "-", "n/a" etc. */
  const PLACEHOLDER_RX = /^(?:[-\u2013\u2014_.\/\\*\s]*|n\s*\/?\s*a|none|null|nil|unknown|not known|tbc|tba|undefined|0)$/i;

  function isPlaceholder(value) {
    return PLACEHOLDER_RX.test(clean(value));
  }

  /* Copy of a vehicle / PX object with every placeholder value blanked. */
  function withoutPlaceholders(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    Object.entries(obj).forEach(([key, value]) => {
      out[key] = typeof value === 'string' && isPlaceholder(value) ? '' : value;
    });
    return out;
  }

  /* A vehicle only counts when it has a make, model or reg. A fuel type
     or a "-" on its own is not a vehicle. */
  function hasVehicleDetails(v) {
    const item = withoutPlaceholders(v || {});
    return Boolean(clean(item.make) || clean(item.model) || clean(item.reg));
  }

  function stripFullStop(line) {
    return String(line).replace(/(?<!\.)\.\s*$/, '').trimEnd();
  }

  function capitalFirst(value) {
    const text = clean(value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function normaliseReg(value) {
    return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normaliseMake(value) {
    const text = clean(value);
    if (!text) return '';
    return MAKES[text.toLowerCase()] || titleWords(text);
  }

  function titleWord(word) {
    if (!word) return word;
    const known = ABBREVIATION_MAP[word.toLowerCase()];
    if (known) return known;
    if (/\d/.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  /* "c5 aircross" -> "C5 Aircross", "e-2008" -> "e-2008", "mercedes-benz" -> "Mercedes-Benz" */
  function titleWords(value) {
    return clean(value).split(' ').map((word) => {
      if (/^e-./i.test(word)) return `e-${word.slice(2).split('-').map(titleWord).join('-')}`;
      return word.split('-').map(titleWord).join('-');
    }).join(' ');
  }

  function normaliseModel(value) {
    return titleWords(value);
  }

  function plainWords(value) {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/-/g, ' ').split(' ').filter(Boolean);
  }

  /* Every spelling that means the same make, longest first:
     "Alfa Romeo" -> ["alfa romeo", "alfa"], "VW" -> ["volkswagen", "vw"]. */
  function makeSpellings(canonical, raw) {
    const target = canonical.toLowerCase();
    const spellings = new Set([plainWords(canonical).join(' '), plainWords(raw).join(' ')]);
    Object.entries(MAKES).forEach(([key, value]) => {
      const valueLower = value.toLowerCase();
      if (valueLower === target || target.startsWith(`${valueLower}-`) || valueLower.startsWith(`${target}-`)) {
        spellings.add(plainWords(key).join(' '));
      }
    });
    return Array.from(spellings).filter(Boolean).sort((a, b) => b.split(' ').length - a.split(' ').length);
  }

  /* Removes a make repeated at the start of the model ("Alfa Romeo" +
     "Alfa Romeo Junior" -> "Junior"), and pulls the make out of the model
     when the make box is empty. Returns { make, model } as raw text. */
  function splitMakeModel(makeRaw, modelRaw) {
    let make = clean(makeRaw);
    const modelText = clean(modelRaw);
    const modelWords = modelText.split(' ').filter(Boolean);
    const plainModel = plainWords(modelText);
    const strip = (spelling) => {
      const words = spelling.split(' ');
      if (plainModel.length <= words.length) return null;
      const hyphenParts = [];
      /* Count original words consumed (a hyphenated word counts as several plain words). */
      let consumed = 0;
      let matched = 0;
      while (matched < words.length && consumed < modelWords.length) {
        const parts = plainWords(modelWords[consumed]);
        hyphenParts.push(...parts);
        matched += parts.length;
        consumed += 1;
      }
      if (hyphenParts.slice(0, words.length).join(' ') !== spelling || hyphenParts.length !== words.length) return null;
      return modelWords.slice(consumed).join(' ');
    };
    if (make) {
      for (const spelling of makeSpellings(normaliseMake(make), make)) {
        const rest = strip(spelling);
        if (rest) return { make, model: rest };
      }
      return { make, model: modelText };
    }
    const keys = Object.keys(MAKES).sort((a, b) => b.split(' ').length - a.split(' ').length);
    for (const key of keys) {
      const rest = strip(plainWords(key).join(' '));
      if (rest) return { make: MAKES[key], model: rest };
    }
    return { make, model: modelText };
  }

  /* Fuel types, transmissions etc. Lower case, abbreviations kept. */
  function normaliseDescriptor(value) {
    return clean(value).split(' ').map((word) => ABBREVIATION_MAP[word.toLowerCase()] || word.toLowerCase()).join(' ');
  }

  function normaliseMileage(value) {
    const text = clean(value).toLowerCase().replace(/,/g, '').replace(/miles?$/, '').trim();
    if (!text) return '';
    const k = text.match(/^(\d+(?:\.\d+)?)\s*k$/);
    if (k) return String(Math.round(parseFloat(k[1]) * 1000));
    const digits = text.match(/^\d+$/);
    return digits ? digits[0] : '';
  }

  function money(value) {
    const text = clean(value).replace(/^£/, '').replace(/,/g, '');
    return text ? `£${text}` : '';
  }

  /* ---------- dates and times ---------- */

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /* Spec Section 13: a day with no month is this month if still to come,
     otherwise the next month that has that day. */
  function inferMonth(day, now) {
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    const today = now.getDate();
    if (day >= today && day <= daysInMonth(year, month)) return { day, month, year };
    for (let i = 0; i < 12; i += 1) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      if (day <= daysInMonth(year, month)) return { day, month, year };
    }
    return null;
  }

  function resolveDate(date, now) {
    if (!date || !date.day) return { error: 'Pick a day for the appointment' };
    const day = Number(date.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) return { error: 'Day must be between 1 and 31' };
    let resolved;
    if (date.month) {
      const month = Number(date.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) return { error: 'Month must be between 1 and 12' };
      let year = date.year ? Number(date.year) : now.getFullYear();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!date.year && new Date(year, month - 1, day) < startOfToday) year += 1;
      resolved = { day, month, year };
    } else {
      resolved = inferMonth(day, now);
    }
    if (!resolved || day > daysInMonth(resolved.year, resolved.month)) {
      return { error: `${day}/${pad(date.month || '')} is not a real date` };
    }
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const when = new Date(resolved.year, resolved.month - 1, resolved.day);
    if (when < startOfToday) return { error: 'That date is in the past' };
    return { ...resolved, text: `${pad(resolved.day)}/${pad(resolved.month)}`, dateObj: when };
  }

  function resolveTime(time) {
    const text = clean(time).toLowerCase();
    if (!text) return { error: 'Pick a time for the appointment' };
    const match = text.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
    if (!match) return { error: `"${time}" is not a time` };
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (match[3] === 'pm' && hour < 12) hour += 12;
    if (match[3] === 'am' && hour === 12) hour = 0;
    if (hour > 23) return { error: `"${time}" is not a time` };
    if (minute !== 0 && minute !== 30) return { error: 'Times must be on :00 or :30' };
    return { hour, minute, text: `${pad(hour)}:${pad(minute)}` };
  }

  /* Spec Section 13: no time given -> at least 2 hours ahead, rounded up
     to the next :00 or :30. */
  function defaultTime(now) {
    const t = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    let hour = t.getHours();
    let minute = t.getMinutes();
    if (t.getSeconds() || t.getMilliseconds()) minute += 1;
    if (minute === 0) minute = 0;
    else if (minute <= 30) minute = 30;
    else { minute = 0; hour += 1; }
    return { hour: hour % 24, minute, nextDay: hour >= 24, text: `${pad(hour % 24)}:${pad(minute)}` };
  }

  /* Spec Section 10: 6 working days from today, weekends excluded, 12:00. */
  function nationalReservationDate(now) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let added = 0;
    while (added < 6) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) added += 1;
    }
    return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(), text: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, time: '12:00' };
  }

  /* ---------- opening hours ---------- */

  /* Dealership hours by weekday (0 = Sunday). Appointments must finish by
     closing: calls last 30 minutes, face to face and test drives 1 hour. */
  const OPENING_HOURS = {
    0: { open: '10:00', close: '16:00' },
    1: { open: '09:00', close: '18:00' },
    2: { open: '09:00', close: '18:00' },
    3: { open: '09:00', close: '18:00' },
    4: { open: '09:00', close: '18:00' },
    5: { open: '09:00', close: '18:00' },
    6: { open: '09:00', close: '17:30' }
  };

  function toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  }

  function fromMinutes(total) {
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  /* England and Wales bank holidays, worked out from the year so no list
     needs updating. Site hours vary on these days, so a booking on one is
     only flagged. Returns the holiday's name, or ''. */
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function bankHolidays(year) {
    const at = (month, day) => new Date(year, month - 1, day);
    const firstMonday = (month) => { const d = at(month, 1); d.setDate(1 + ((8 - d.getDay()) % 7)); return d; };
    const lastMonday = (month) => { const d = new Date(year, month, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
    const shift = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
    const easter = easterSunday(year);
    const list = [];
    // A holiday on a weekend moves to the next weekday.
    const newYear = at(1, 1);
    list.push(['New Year\'s Day', newYear.getDay() === 6 ? shift(newYear, 2) : newYear.getDay() === 0 ? shift(newYear, 1) : newYear]);
    list.push(['Good Friday', shift(easter, -2)]);
    list.push(['Easter Monday', shift(easter, 1)]);
    list.push(['Early May bank holiday', firstMonday(5)]);
    list.push(['Spring bank holiday', lastMonday(5)]);
    list.push(['Summer bank holiday', lastMonday(8)]);
    const christmas = at(12, 25);
    const christmasDay = christmas.getDay() === 6 ? shift(christmas, 2) : christmas.getDay() === 0 ? shift(christmas, 2) : christmas;
    const boxing = at(12, 26);
    const boxingDay = boxing.getDay() === 6 || boxing.getDay() === 0 ? shift(boxing, 2) : boxing;
    list.push(['Christmas Day', christmasDay]);
    list.push(['Boxing Day', boxingDay]);
    return list;
  }

  function bankHolidayName(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return '';
    const found = bankHolidays(dateObj.getFullYear()).find(([, d]) =>
      d.getMonth() === dateObj.getMonth() && d.getDate() === dateObj.getDate());
    return found ? found[0] : '';
  }

  function appointmentLength(input) {
    return isCallBooking(input || {}) ? 30 : 60;
  }

  /* Bookable start times for a day: from opening until closing minus the
     appointment length, every 30 minutes. With options.now, times that
     have already passed today are left out. */
  function availableSlots(dateObj, input, options) {
    const hours = OPENING_HOURS[dateObj.getDay()];
    if (!hours) return [];
    const length = appointmentLength(input);
    const slots = [];
    const now = options && options.now ? new Date(options.now) : null;
    for (let t = toMinutes(hours.open); t + length <= toMinutes(hours.close); t += 30) {
      if (now) {
        const when = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), Math.floor(t / 60), t % 60);
        if (when <= now) continue;
      }
      slots.push(fromMinutes(t));
    }
    return slots;
  }

  /* ---------- requested date/time in the lead's Initial Notes ---------- */

  const MONTH_ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function to24(hour, minute, meridiem) {
    let h = Number(hour);
    const m = Number(minute || 0);
    const ap = String(meridiem || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { h, m };
  }

  /* Rounds up to the next :00 or :30 (spec Section 13). */
  function roundUpSlot(h, m) {
    if (m === 0 || m === 30) return { text: `${pad(h)}:${pad(m)}`, rounded: false };
    if (m < 30) return { text: `${pad(h)}:30`, rounded: true };
    return { text: `${pad(h + 1)}:00`, rounded: true };
  }

  function parseTimeToken(token) {
    const match = String(token || '').trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
    if (!match) return null;
    const { h, m } = to24(match[1], match[2], match[3]);
    if (h > 23 || m > 59) return null;
    return { h, m };
  }

  /* Finds a customer-requested date and time in web-form text such as
       Preferred Date/Time: 2026-09-25, 9:00 AM
       Date/Time: Sat Sep 05 2026 3:00PM
       First Appointment Date Desired: 25/09/2026 | Anytime between 1300 - 1600
       Date: 28/09/2026   Booking date: 2026-10-11   2026-09-17 Morning
     Returns null when nothing usable is found. */
  function parseRequestedSlot(text) {
    const source = String(text || '');
    if (!source.trim()) return null;
    let date = null;
    let time = null;
    let rounded = false;
    let match;

    if ((match = source.match(/Preferred Date\/Time:\s*(\d{4})-(\d{1,2})-(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*([AP]M)?/i))) {
      date = { year: +match[1], month: +match[2], day: +match[3] };
      time = to24(match[4], match[5], match[6]);
    } else if ((match = source.match(/Date\/Time:\s*[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i))) {
      date = { year: +match[3], month: MONTH_ABBR[match[1].toLowerCase()], day: +match[2] };
      time = to24(match[4], match[5], match[6]);
    } else {
      if ((match = source.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
        date = { year: +match[3], month: +match[2], day: +match[1] };
      } else if ((match = source.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) {
        date = { year: +match[1], month: +match[2], day: +match[3] };
      }
      const range = source.match(/between\s+(\d{1,2}(?::?\d{2})?\s*(?:am|pm)?)\s*(?:-|to|and)\s*(\d{1,2}(?::?\d{2})?\s*(?:am|pm)?)/i);
      if (range) {
        let start = range[1].trim();
        const end = range[2].trim();
        const endMeridiem = end.match(/(am|pm)$/i);
        if (!/(am|pm)$/i.test(start) && endMeridiem) start += endMeridiem[1];
        time = parseTimeToken(start);
      }
    }
    if (time && time.h === 0 && time.m === 0) time = null; /* "00:00" is a blank form value */
    if (!date && !time) return null;
    if (date && (!date.month || date.month > 12 || date.day > 31)) date = null;
    let timeText = '';
    if (time) {
      const slot = roundUpSlot(time.h, time.m);
      timeText = slot.text;
      rounded = slot.rounded;
    }
    const part = source.match(/\b(morning|afternoon|evening)\b/i);
    return {
      day: date ? pad(date.day) : '',
      month: date ? pad(date.month) : '',
      year: date ? date.year : null,
      time: timeText,
      rounded,
      partOfDay: part ? part[1].toLowerCase() : ''
    };
  }

  /* ---------- vehicles ---------- */

  function normaliseVehicle(v) {
    const reg = normaliseReg(v && v.reg);
    let condition = v && v.condition ? String(v.condition).toLowerCase() : '';
    if (condition === 'pre-registered' || condition === 'preregistered') condition = reg ? 'used' : 'new';
    if (reg) condition = 'used';
    if (!condition) condition = 'new';
    const split = splitMakeModel(v && v.make, v && v.model);
    return {
      make: normaliseMake(split.make),
      model: normaliseModel(split.model),
      descriptor: normaliseDescriptor(v && v.descriptor),
      reg,
      condition
    };
  }

  function baseName(v) {
    return [v.make, v.model].filter(Boolean).join(' ');
  }

  function withReg(text, v) {
    return v.reg ? `${text} (${v.reg})` : text;
  }

  /* Spec Section 7, with the house rule that a shared make is not repeated. */
  function vehicleGroup(vehicles) {
    const allSameDescriptor = vehicles.every((v) => v.descriptor === vehicles[0].descriptor);
    const sameBase = vehicles.every((v) => baseName(v).toLowerCase() === baseName(vehicles[0]).toLowerCase());

    if (sameBase) {
      const identical = allSameDescriptor && vehicles.every((v) => !v.reg);
      if (identical) {
        return { identical: true, text: `${vehicles.length} ${vehicles[0].condition} ${[baseName(vehicles[0]), vehicles[0].descriptor].filter(Boolean).join(' ')} vehicles` };
      }
      if (vehicles.every((v) => v.reg) && allSameDescriptor) {
        const regs = vehicles.map((v) => v.reg).join(' and ');
        return { text: `${[baseName(vehicles[0]), vehicles[0].descriptor].filter(Boolean).join(' ')} (${regs})` };
      }
      const variants = vehicles.map((v, i) => {
        const variant = v.descriptor || '';
        const label = i === 0 ? [baseName(v), variant].filter(Boolean).join(' ') : variant;
        return withReg(label, v);
      });
      return { text: joinAnd(variants) };
    }

    const sameMake = vehicles.every((v) => v.make && v.make === vehicles[0].make);
    const parts = vehicles.map((v, i) => {
      const name = sameMake && i > 0 ? v.model : baseName(v);
      const descriptor = allSameDescriptor ? '' : v.descriptor;
      return withReg([name, descriptor].filter(Boolean).join(' '), v);
    });
    let text = joinAnd(parts);
    if (allSameDescriptor && vehicles[0].descriptor) {
      /* Descriptor once, at the end of the group. Regs stay attached. */
      text = `${text} ${vehicles[0].descriptor}`;
    }
    return { text };
  }

  function joinAnd(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  function singleVehicleText(v) {
    return withReg([baseName(v), v.descriptor].filter(Boolean).join(' '), v);
  }

  /* "a new Peugeot 5008" / "a used Ford Puma (CD73EFG)" /
     "the used Peugeot 3008 and 2008 petrol automatic" / "used Peugeot 208s" */
  function voiPhrase(vehicles, category, warnings, options) {
    const motability = options && options.motability;
    if (!vehicles.length) {
      if (category) return clean(category);
      return '';
    }
    if (vehicles.length === 1) {
      const v = vehicles[0];
      if (motability) return `a ${singleVehicleText(v)}`;
      return `a ${v.condition} ${singleVehicleText(v)}`;
    }
    const conditions = new Set(vehicles.map((v) => v.condition));
    if (conditions.size > 1 && !motability) {
      warnings.push('Mixed new and used vehicles: check the booking sentence reads correctly');
      return joinAnd(vehicles.map((v) => `a ${v.condition} ${singleVehicleText(v)}`));
    }
    const group = vehicleGroup(vehicles);
    if (group.identical) return motability ? group.text.replace(/^(\d+) (new|used) /, '$1 ') : group.text;
    if (motability) return `the ${group.text}`;
    return `the ${vehicles[0].condition} ${group.text}`;
  }

  /* ---------- part exchange ---------- */

  function pxValuation(px) {
    if (!px || px.status !== 'yes' || !px.items || !px.items.length) return '';
    return px.items.length > 1 ? 'their cars' : 'their car';
  }

  function vehicleLineBody(item, unknownWhere) {
    const split = splitMakeModel(item.make, item.model);
    const name = [normaliseMake(split.make), normaliseModel(split.model)].filter(Boolean).join(' ');
    const reg = normaliseReg(item.reg);
    let text = name;
    if (reg) text = text ? `${text} (${reg})` : `(${reg})`;
    const mileage = normaliseMileage(item.mileage);
    const parts = [];
    if (mileage) {
      text += ` approx ${mileage} miles`;
    } else if (item.mileageUnknown) {
      text += ' approx miles unknown';
      const where = unknownWhere || item.mileageUnknown;
      if (where === 'call' || where === 'site') parts.push(`Mileage currently unknown will be confirmed on ${where}`);
    }
    return { text: text.trim(), parts, hasReg: !!reg, hasName: !!name };
  }

  function pxLine(item, warnings) {
    const body = vehicleLineBody(item);
    let line = `PX: ${body.text}`;
    if (item.roughVal) line += ` - Rough Val ${money(item.roughVal)}`;
    const extras = body.parts.slice();
    (item.details || []).map(capitalFirst).filter(Boolean).forEach((d) => extras.push(stripFullStop(d)));
    if (item.finance) extras.push(`Currently on ${clean(item.finance).replace(/^(pcp|hp|pch)$/i, (m) => m.toUpperCase())}`);
    if (item.financeEnds) extras.push(`Finance ends ${clean(item.financeEnds)}`);
    if (extras.length) line += ` | ${extras.join(' | ')}`;
    if (!body.hasReg) warnings.push('PX has no registration');
    if (!body.hasReg && !body.hasName) warnings.push('PX has no details');
    return line;
  }

  const NO_PX_LINES = {
    none: '-No PX',
    private: '-No PX | Customer is selling their vehicle privately',
    elsewhere: '-No PX | Customer is selling their vehicle elsewhere',
    taking: '-No PX | Customer is taking their vehicle elsewhere',
    leaseReturn: '-No PX | Customer is returning their current vehicle at the end of their lease'
  };

  /* ---------- payment ---------- */

  function paymentLines(payment) {
    if (!payment || !payment.kind || payment.kind === 'unmentioned') return [];
    if (payment.kind === 'cash') return ['-Cash purchase'];
    if (payment.kind === 'cashOffers') return ['-Cash purchase | Looking to discuss available offers and price movement'];
    const type = clean(payment.financeType) ? clean(payment.financeType).replace(/^(pcp|hp|pch)$/i, (m) => m.toUpperCase()) : 'Discuss options';
    const parts = [type];
    if (clean(payment.deposit) !== '') parts.push(`${money(payment.deposit)} deposit`);
    if (payment.term) parts.push(`${clean(payment.term).replace(/\s*(months?|m)$/i, '')} months`);
    if (payment.mpa) parts.push(`${normaliseMileage(payment.mpa) || clean(payment.mpa)} miles per annum`);
    if (payment.budget) parts.push(`Budget ${money(payment.budget)} per month`);
    (payment.extras || []).map((x) => stripFullStop(capitalFirst(x))).filter(Boolean).forEach((x) => parts.push(x));
    const lines = [`-Finance: ${parts.join(' | ')}`];
    if (payment.kind === 'both') lines.push('-Cash purchase also being considered');
    return lines;
  }

  /* ---------- notes ---------- */

  function noteLine(text) {
    const line = stripFullStop(clean(text));
    if (!line) return '';
    if (/^(PX|Vehicle):/i.test(line)) return line;
    if (/^-/.test(line)) return `-${capitalFirst(line.replace(/^-+\s*/, ''))}`;
    return `-${capitalFirst(line)}`;
  }

  /* ---------- the booking sentence ---------- */

  function sentenceTail(input, vehicles, warnings, errors) {
    const type = input.type;
    const sub = input.subtype || '';
    const px = input.px || {};
    const val = pxValuation(px);
    const andVal = val ? ` and have an accurate valuation of ${val}` : '';
    const needVoi = (phrase) => {
      if (!phrase) errors.push('Add the vehicle of interest');
      return phrase || '[VEHICLE]';
    };

    if (type === 'testdrive') {
      return `to test drive ${needVoi(voiPhrase(vehicles, null, warnings))}${andVal}`;
    }
    if (type === 'view') {
      return `to view ${needVoi(voiPhrase(vehicles, input.category, warnings))}${andVal}`;
    }
    if (type === 'call') {
      if (sub === 'valuation') return 'for a valuation call';
      const phrase = needVoi(voiPhrase(vehicles, input.category, warnings));
      return `for a call to discuss and have video walkthrough sent via email of ${phrase}${val ? ` and for an accurate valuation of ${val}` : ''}`;
    }
    if (type === 'motability') {
      const phrase = needVoi(voiPhrase(vehicles, input.category, warnings, { motability: true }));
      const tail = {
        testdrive: `to test drive ${phrase} on the Motability scheme`,
        view: `to view ${phrase} on the Motability scheme`,
        discuss: `to discuss ${phrase} on the Motability scheme`,
        call: `for a call to discuss and have video walkthroughs sent of ${phrase} on the Motability scheme`
      }[sub || 'testdrive'];
      if (!tail) errors.push('Pick a Motability appointment type');
      return `${tail || ''}${andVal}`;
    }
    if (type === 'onlinestore') {
      const v = vehicles[0];
      if (!v) errors.push('Add the online store vehicle');
      else if (!v.reg) warnings.push('Online store vehicle has no registration');
      const osv = v ? withReg(baseName(v), v) : '[MAKE MODEL (REG)]';
      if (sub === 'call') {
        return `for a call to discuss online store vehicle: ${osv} and have a video walkthrough sent via email${val ? ` and for an accurate valuation of ${val}` : ''}`;
      }
      if (sub === 'valuationcall') return `for a valuation call and discuss online store vehicle: ${osv}`;
      if (sub === 'similar') return `to test drive similar vehicles to online store ${osv}${andVal}`;
      return `to discuss online store vehicle: ${osv}${andVal}`;
    }
    if (type === 'valuation') {
      return sub === 'call' ? 'for a valuation call regarding their vehicle' : 'for an in-person valuation appointment';
    }
    errors.push('Pick an appointment type');
    return '';
  }

  function isCallBooking(input) {
    return CALL_TYPES.has(input.type) ||
      (input.type === 'motability' && input.subtype === 'call') ||
      (input.type === 'onlinestore' && (input.subtype === 'call' || input.subtype === 'valuationcall')) ||
      (input.type === 'valuation' && input.subtype === 'call');
  }

  /* ---------- main ---------- */

  function buildBooking(rawInput, options) {
    const input = rawInput || {};
    const now = (options && options.now) ? new Date(options.now) : new Date();
    const warnings = [];
    const errors = [];
    const lines = [];
    const agent = clean(input.agent);
    const vehicles = (input.vehicles || []).filter(hasVehicleDetails).map(withoutPlaceholders).map(normaliseVehicle);
    const px = input.px || { status: 'unmentioned' };
    const pxItems = (px.items || []).map(withoutPlaceholders)
      .filter((item) => item && (clean(item.make) || clean(item.model) || clean(item.reg) || clean(item.mileage)));
    const pxActive = px.status === 'yes' && pxItems.length > 0;
    const effectivePx = { ...px, items: pxItems, status: pxActive ? 'yes' : (px.status === 'yes' ? 'unmentioned' : px.status) };

    /* Contact header */
    const contact = input.contact || 'none';
    const email = clean(input.email);
    if (contact !== 'none') {
      if (!agent) errors.push('Set your agent name in Konnect Notes settings');
      if (contact === 'vm') lines.push(`VM left -- ${agent} - Please confirm provisional booking with customer`);
      else if (contact === 'engaged') lines.push(`Line engaged -- ${agent} - Please confirm provisional booking with customer`);
      else if (contact === 'email') {
        if (isCallBooking(input)) errors.push('Email only cannot be used on a call booking');
        if (!email) errors.push('Email only needs the customer email address');
        lines.push(`EMAIL ONLY LEAD: ${email || '[EMAIL]'} -- ${agent} - Please confirm provisional booking with customer`);
      }
    }
    if (clean(input.fao)) lines.push(`FAO ${titleWords(input.fao)}`);

    /* National Reservation: fixed block, date only used for the calendar */
    let meta = {};
    if (input.type === 'national') {
      const v = vehicles[0];
      if (!v || !v.make || !v.model || !v.reg) errors.push('National Reservation needs make, model and registration');
      const vehicleText = v ? withReg(baseName(v), v) : '[MAKE MODEL (REG)]';
      NATIONAL_LINES.forEach((line) => lines.push(line.replace('{{VEHICLE}}', vehicleText)));
      meta = { calendar: nationalReservationDate(now) };
    } else {
      PRIORITY_LINES.forEach((line) => lines.push(line));
      const date = resolveDate(input.date, now);
      if (date.error) errors.push(date.error);
      const time = resolveTime(input.time);
      if (time.error) errors.push(time.error);
      if (!date.error && !time.error && date.dateObj) {
        const when = new Date(date.year, date.month - 1, date.day, time.hour, time.minute);
        if (when < now) errors.push('That time has already passed today');
        else if (input.type) {
          const slots = availableSlots(date.dateObj, input);
          if (!slots.includes(time.text)) {
            const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.dateObj.getDay()];
            const kind = isCallBooking(input) ? 'calls' : 'appointments';
            errors.push(`Outside opening hours: ${dayName} ${kind} can start ${slots[0]} to ${slots[slots.length - 1]}`);
          }
        }
      }
      const holiday = date.dateObj ? bankHolidayName(date.dateObj) : '';
      if (holiday) warnings.push(`${date.text} is a bank holiday (${holiday}). Check the site is open at that time`);
      const qualifier = input.timeQualifier === 'before' ? ' or before' : input.timeQualifier === 'after' ? ' or after' : '';
      if (qualifier && !isCallBooking(input)) warnings.push('"or before / or after" is normally only used on calls');
      const tail = sentenceTail({ ...input, px: effectivePx }, vehicles, warnings, errors);
      lines.push(`Customer is booked in on ${date.text || 'DD/MM'} at ${time.text || 'HH:MM'}${qualifier} ${tail}`);
      meta = { date: date.text, time: time.text };
    }

    /* Structured lines and the spec's fixed first notes */
    const isValuationOnly = input.type === 'valuation';
    const anyUsed = vehicles.some((v) => v.condition === 'used');
    const resExempt = ['national', 'motability', 'valuation', 'onlinestore'].includes(input.type);

    if (isValuationOnly) {
      const item = pxItems[0] || (input.valuationVehicle ? withoutPlaceholders(input.valuationVehicle) : null);
      if (item) {
        const body = vehicleLineBody(item, input.subtype === 'call' ? 'call' : 'site');
        lines.push(`Vehicle: ${body.text}${body.parts.length ? ` | ${body.parts.join(' | ')}` : ''}`);
      } else {
        warnings.push('Add the customer\'s vehicle for the valuation');
      }
      if (input.sellingReason === 'sell') lines.push('-Customer is looking to sell their vehicle');
      if (input.sellingReason === 'boughtElsewhere') lines.push('-Customer is looking to sell their current vehicle after purchasing another vehicle');
    } else if (pxActive) {
      pxItems.forEach((item) => lines.push(pxLine(item, warnings)));
    } else if (NO_PX_LINES[effectivePx.status]) {
      lines.push(NO_PX_LINES[effectivePx.status]);
    }

    if (anyUsed && !resExempt) {
      lines.push(input.reserved ? '-Customer has already reserved the vehicle' : '-Recommended to res');
    } else if (input.reserved && input.type !== 'national') {
      lines.push('-Customer has already reserved the vehicle');
    }

    /* Free notes, then who it's for, then payment, then email */
    (input.notes || []).map(noteLine).filter(Boolean).forEach((line) => lines.push(line));
    if (clean(input.onBehalfOf)) lines.push(`-On behalf of ${clean(input.onBehalfOf).toLowerCase()}`);
    paymentLines(input.payment).forEach((line) => lines.push(line));

    const customerEmail = clean(input.customerEmail);
    if (customerEmail && contact !== 'email') {
      lines.push(clean(input.emailAction)
        ? `-Requested email to ${stripFullStop(clean(input.emailAction))} | ${customerEmail}`
        : `-Customer email: ${customerEmail}`);
    } else if (contact === 'email' && clean(input.emailAction)) {
      lines.push(`-Requested email to ${stripFullStop(clean(input.emailAction))}`);
    }

    /* No full stops, no blank lines, no duplicates */
    const seen = new Set();
    const finalLines = lines.map((line) => stripFullStop(line)).filter((line) => {
      if (!line.trim()) return false;
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      ok: errors.length === 0,
      text: finalLines.join('\n'),
      lines: finalLines,
      errors,
      warnings,
      title: titleFor(input, vehicles),
      meta
    };
  }

  /* Only used to label drafts inside the tool. Never inserted. */
  function titleFor(input, vehicles) {
    if (input.type === 'valuation') return 'Valuation Only';
    if (!vehicles.length) return input.category ? titleWords(input.category) : 'Booking';
    const group = vehicles.length > 1 ? vehicleGroup(vehicles).text : singleVehicleText(vehicles[0]).replace(/\s*\([A-Z0-9]+\)/, '');
    const text = titleWords(group.replace(/\s*\([A-Z0-9 and]+\)/g, ''));
    return input.type === 'national' ? `National Reservation ${text}` : text;
  }

  return {
    version: VERSION,
    buildBooking,
    resolveDate,
    resolveTime,
    defaultTime,
    nationalReservationDate,
    availableSlots,
    bankHolidayName,
    appointmentLength,
    isCallBooking,
    parseRequestedSlot,
    openingHours: OPENING_HOURS,
    normaliseReg,
    normaliseMake,
    normaliseModel,
    normaliseMileage,
    splitMakeModel,
    isPlaceholder,
    hasVehicleDetails
  };
});
