(function () {
  if (window._lpAutoSummaryInit) return;
  window._lpAutoSummaryInit = true;

  const STYLE_ID = 'lp-auto-summary-style-v1';
  const BRAND_LIST = [
    'Abarth','Alfa Romeo','Audi','BMW','Citroen','Cupra','DS','DS Automobiles','Fiat','Ford','Honda','Hyundai','Jeep','Kia','Land Rover','Lexus','Mazda','Mercedes','MINI','Nissan','Peugeot','Renault','SEAT','Skoda','Suzuki','Toyota','Vauxhall','Volkswagen','Volvo','Tesla','Jaguar','Porsche','Ferrari','Lamborghini','Bentley','Rolls Royce','Maserati','Leapmotor'
  ];
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #lpSumButton {
        position: fixed;
        left: 16px;
        bottom: 16px;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: #f9772e;
        color: #fff;
        font-weight: 700;
        font-size: 12px;
        border: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        z-index: 999999;
        cursor: pointer;
      }
      #lpSumPanel {
        position: fixed;
        top: 0;
        left: -360px;
        width: 340px;
        height: 100vh;
        background: #1e1d49;
        color: #fff;
        font-size: 12px;
        font-family: Arial, sans-serif;
        box-shadow: 6px 0 14px rgba(0,0,0,0.35);
        z-index: 999998;
        display: flex;
        flex-direction: column;
        transition: left 0.3s ease;
      }
      #lpSumPanel.open { left: 0; }
      #lpSumPanel header {
        padding: 14px;
        background: #131237;
        color: #fff;
        font-weight: 700;
        letter-spacing: 0.3px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #lpSumContent { flex: 1; overflow-y: auto; padding: 10px 14px 18px; }
      .lp-block {
        margin-bottom: 12px;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        overflow: hidden;
      }
      .lp-block .lp-block-header {
        background: #131237;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
      }
      .lp-block .lp-block-header span { font-weight: 700; }
      .lp-block .lp-toggle { transform: rotate(0deg); transition: transform 0.25s ease; }
      .lp-block.collapsed .lp-toggle { transform: rotate(-90deg); }
      .lp-block .lp-body { max-height: 500px; transition: max-height 0.3s ease; overflow: hidden; }
      .lp-block.collapsed .lp-body { max-height: 0; }
      .lp-row { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid rgba(255,255,255,0.08); cursor: pointer; align-items: center; }
      .lp-row:first-child { border-top: none; }
      .lp-row:hover { background: rgba(249,119,46,0.15); }
      .lp-label { flex: 0 0 120px; color: #f6a97d; font-weight: 700; }
      .lp-value { flex: 1; word-break: break-word; }
      .lp-flash { color: #7CFFB2; font-weight: 700; margin-left: auto; }
      .lp-empty { padding: 8px 10px; }
    `;
    document.head.appendChild(style);
  }

  function createUI() {
    ensureStyles();

    const btn = document.createElement('button');
    btn.id = 'lpSumButton';
    btn.textContent = 'SUM';

    const panel = document.createElement('div');
    panel.id = 'lpSumPanel';
    panel.innerHTML = `
      <header>
        <span>Auto-Summary</span>
        <button id="lpClose" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;">×</button>
      </header>
      <div id="lpSumContent"></div>
    `;

    btn.onclick = () => panel.classList.toggle('open');
    panel.querySelector('#lpClose').onclick = () => panel.classList.remove('open');

    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  function getVisitorTexts() {
    const wrappers = Array.from(document.querySelectorAll('[data-testid="visitor-message"]'));
    const texts = [];
    wrappers.forEach(msg => {
      const contentNodes = msg.querySelectorAll('div[class*="bubble"] div[class*="content"] div[class*="text"], div[class*="bubble"] div[class*="content"] span, div[class*="bubble"] div[class*="content"] p');
      if (contentNodes.length) {
        contentNodes.forEach(n => {
          const val = (n.innerText || '').trim();
          if (val) texts.push(val);
        });
      } else {
        const val = (msg.innerText || '').trim();
        if (val) texts.push(val);
      }
    });
    return texts;
  }

  function normalizePhone(text) {
    const phoneMatch = text.replace(/[^0-9+]/g, ' ').match(/(?:\+?44|0)?7\d{9}/);
    if (!phoneMatch) return '';
    let digits = phoneMatch[0].replace(/\D/g, '');
    if (digits.startsWith('44')) digits = '0' + digits.slice(2);
    if (!digits.startsWith('0')) digits = '0' + digits;
    return digits.slice(0, 11);
  }

  function extractPostcode(text) {
    const regex = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
    const m = text.match(regex);
    return m ? m[1].replace(/\s+/g, '').replace(/(.{3})$/, ' $1').toUpperCase() : '';
  }

  function extractAddress(text, postcode) {
    if (!postcode) return '';
    const idx = text.toLowerCase().indexOf(postcode.toLowerCase());
    if (idx === -1) return '';
    const slice = text.slice(Math.max(0, idx - 120), idx).replace(/[\n,]+/g, ' ').trim();
    return slice || '';
  }

  function extractEmail(text) {
    const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    return m ? m[0] : '';
  }

  function extractName(text) {
    const simple = text.match(/(?:my name is|i'm|i am|its|it's|this is)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i);
    if (simple) return { first: simple[1], last: simple[2] || '' };

    const tokens = text.trim().split(/\s+/).filter(t => /^[A-Z][a-z]+/.test(t));
    if (tokens.length >= 2) return { first: tokens[0], last: tokens[1] };
    if (tokens.length === 1) return { first: tokens[0], last: '' };
    return { first: '', last: '' };
  }

  function extractRegs(text) {
    const regRegex = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/gi;
    const regs = [];
    let m;
    while ((m = regRegex.exec(text)) !== null) {
      const norm = m[1].replace(/\s+/g, '').toUpperCase();
      if (!regs.includes(norm)) regs.push(norm);
    }
    return regs;
  }

  function normalizeBrand(str) {
    if (!str) return '';
    if (['DS', 'BMW'].includes(str.toUpperCase())) return str.toUpperCase();
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function extractVehicles(text) {
    const findings = [];
    BRAND_LIST.forEach(brand => {
      const reg = new RegExp(`\\b(${brand})\\b\\s+([A-Za-z0-9-]+)(?:\\s+([A-Za-z0-9-]+))?`, 'gi');
      let m;
      while ((m = reg.exec(text)) !== null) {
        findings.push({
          make: normalizeBrand(m[1]),
          model: m[2] ? normalizeBrand(m[2]) : '',
          trim: m[3] ? m[3] : ''
        });
      }
    });
    return findings;
  }

  function extractMileage(text) {
    const m = text.match(/([\d,]{2,})\s*miles?/i);
    return m ? m[1].replace(/,/g, '') : '';
  }

  function detectBookingType(text) {
    const lc = text.toLowerCase();
    if (lc.includes('test drive')) return 'test drive';
    if (lc.includes('viewing') || lc.includes('view ')) return 'view';
    if (lc.includes('phone call') || lc.includes('call back') || lc.includes('call ')) return 'phone call';
    if (lc.includes('valuation') || lc.includes('px check') || lc.includes('part exchange check')) return 'valuation';
    if (lc.includes('motability')) return 'motability';
    if (lc.includes('online store')) return 'online store';
    if (lc.includes('national reserve')) return 'national reserve';
    return '';
  }

  function detectNewUsed(text, enquiryReg) {
    const lc = text.toLowerCase();
    if (lc.includes('motability')) return 'Motability';
    if (lc.includes('brand new') || lc.includes('new model') || lc.includes('new shape') || /\bnew\b/.test(lc)) return 'new';
    if (enquiryReg) return 'used';
    if (lc.includes('px') || lc.includes('part exchange') || lc.includes('finance')) return 'used';
    return '';
  }

  function normalizeDate(str, baseDate = new Date()) {
    const slash = str.match(/^(\d{1,2})[\/](\d{1,2})$/);
    if (slash) return `${slash[1].padStart(2, '0')}/${slash[2].padStart(2, '0')}`;

    const monthName = str.match(/^(\d{1,2})\s*([A-Za-z]+)/);
    if (monthName) {
      const day = monthName[1].padStart(2, '0');
      const idx = MONTHS.indexOf(monthName[2].toLowerCase());
      if (idx >= 0) return `${day}/${String(idx + 1).padStart(2, '0')}`;
    }

    const monthFirst = str.match(/^([A-Za-z]+)\s*(\d{1,2})$/);
    if (monthFirst) {
      const idx = MONTHS.indexOf(monthFirst[1].toLowerCase());
      if (idx >= 0) return `${monthFirst[2].padStart(2, '0')}/${String(idx + 1).padStart(2, '0')}`;
    }

    const dayOnly = str.match(/^(\d{1,2})(?:st|nd|rd|th)$/i);
    if (dayOnly) return `${dayOnly[1].padStart(2, '0')}/${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
    return str;
  }

  function nextWeekday(base, targetDay, preferNext = false) {
    const date = new Date(base.getTime());
    const currentDay = date.getDay();
    let delta = (targetDay + 7 - currentDay) % 7;
    if (preferNext || delta === 0) delta += 7;
    date.setDate(date.getDate() + delta);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function extractDate(texts) {
    const baseDate = new Date();
    const joined = texts.join(' ');
    const lc = joined.toLowerCase();

    if (/\btoday\b/.test(lc)) {
      return `${String(baseDate.getDate()).padStart(2, '0')}/${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
    }
    if (/\btomorrow\b/.test(lc)) {
      const tomorrow = new Date(baseDate.getTime());
      tomorrow.setDate(baseDate.getDate() + 1);
      return `${String(tomorrow.getDate()).padStart(2, '0')}/${String(tomorrow.getMonth() + 1).padStart(2, '0')}`;
    }

    const thisNext = lc.match(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (thisNext) {
      const target = WEEKDAYS.indexOf(thisNext[2]);
      const preferNext = thisNext[1] === 'next';
      return nextWeekday(baseDate, target, preferNext);
    }

    const regex = /\b(\d{1,2}[\/]\d{1,2}|\d{1,2}\s*[A-Za-z]+|[A-Za-z]+\s*\d{1,2}|\d{1,2}(?:st|nd|rd|th))\b/g;
    const matches = Array.from(joined.matchAll(regex)).map(m => normalizeDate(m[1], baseDate));
    if (!matches.length) return '';
    return matches[matches.length - 1];
  }

  function normalizeTimeToken(token) {
    token = token.trim().toLowerCase();
    if (token === 'midday' || token === 'noon') return '12:00';
    if (token === 'midnight') return '00:00';
    const half = token.match(/^half\s*(\d{1,2})$/);
    if (half) return `${String((Number(half[1]) % 12) || 12).padStart(2,'0')}:30`;
    const m = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return '';
    let hour = Number(m[1]);
    let minute = m[2] ? Number(m[2]) : 0;
    const mer = m[3];
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function extractTime(text) {
    const joined = text.join(' ').toLowerCase();
    const flexBetween = joined.match(/between\s+([^\s]+)\s+(?:and|-|to)\s+([^\s]+)/);
    if (flexBetween) {
      const start = normalizeTimeToken(flexBetween[1]);
      const end = normalizeTimeToken(flexBetween[2]);
      if (start && end) return { time: '', flexible: `between ${start}–${end}` };
    }
    const after = joined.match(/after\s+([^\s]+)/);
    if (after) {
      const val = normalizeTimeToken(after[1]);
      if (val) return { time: '', flexible: `after ${val}` };
    }
    if (joined.includes('asap')) return { time: '', flexible: 'ASAP' };
    if (joined.includes('anytime')) return { time: '', flexible: 'anytime' };

    const regex = /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|midday|midnight|half\s*\d{1,2})\b/gi;
    const matches = Array.from(joined.matchAll(regex)).map(m => m[0]);
    if (!matches.length) return { time: '', flexible: '' };
    const norm = normalizeTimeToken(matches[matches.length - 1]);
    return { time: norm, flexible: '' };
  }

  function extractIntent(text) {
    const intents = new Set();
    const lc = text.toLowerCase();
    const map = [
      ['finance', 'discuss finance'],
      ['pcp', 'discuss PCP'],
      ['0 percent apr', '0 percent APR'],
      ['negative equity', 'negative equity'],
      ['call before arrival', 'wants call before arrival'],
      ['call before arriving', 'wants call before arrival'],
      ['petrol', 'petrol preferred'],
      ['comparing', 'comparing models'],
      ['colour', 'colour preference'],
      ['extended test drive', 'extended test drive request'],
      ['delivery', 'delivery or collection enquiries'],
      ['collection', 'delivery or collection enquiries'],
      ['video', 'wants video walkthrough'],
    ];
    map.forEach(([needle, label]) => { if (lc.includes(needle)) intents.add(label); });
    return Array.from(intents);
  }

  function extractFlags(text) {
    const flags = new Set();
    const lc = text.toLowerCase();
    const defs = [
      ['already reserved', 'Customer already reserved vehicle'],
      ['online store', 'Online store vehicle + reg'],
      ['national reserve', 'National reserve'],
      ['not local', 'Customer not local'],
      ['whatsapp', 'Requires WhatsApp or message contact'],
      ['outside hours', 'Outside hours preference'],
      ['long distance', 'Travelling long distance'],
      ['call today', 'Needs call today'],
      ['follow-up', 'Needs follow-up'],
      ['vehicle needs transferring', 'Vehicle needs transferring'],
      ['delivery', 'Customer wants delivery'],
      ['finance checked', 'Customer wants finance checked beforehand'],
      ['familiar with vehicle', 'Customer familiar with vehicle'],
      ['urgent', 'Urgent purchase timeline'],
    ];
    defs.forEach(([needle, label]) => { if (lc.includes(needle)) flags.add(label); });

    const fao = lc.match(/fao\s+([a-z]+)/);
    if (fao) flags.add(`FAO ${fao[1][0].toUpperCase()}${fao[1].slice(1)}`);

    return Array.from(flags);
  }

  function findPXReg(regs, text) {
    if (regs.length <= 1) return regs[1] || '';
    const lc = text.toLowerCase();
    const pxReg = regs.find(r => lc.includes('px') && lc.includes(r.toLowerCase())) || regs[1];
    return pxReg || '';
  }

  function parse() {
    const texts = getVisitorTexts();
    const joined = texts.join(' ');

    const email = extractEmail(joined);
    const phone = normalizePhone(joined);
    const postcode = extractPostcode(joined);
    const address = extractAddress(joined, postcode);
    const name = extractName(joined);

    const regs = extractRegs(joined);
    const enquiryReg = regs[0] || '';
    const pxReg = findPXReg(regs, joined);

    const vehicles = extractVehicles(joined);
    const enquiryVehicle = vehicles[0] || { make: '', model: '', trim: '' };
    const pxVehicle = vehicles[1] || { make: '', model: '' };

    const pxMileage = extractMileage(joined);

    const bookingType = detectBookingType(joined);
    const newUsed = detectNewUsed(joined, enquiryReg);
    const date = extractDate(texts);
    const { time, flexible } = extractTime(texts);
    const intents = extractIntent(joined);
    const flags = extractFlags(joined);

    const notesOnly = /notes only/i.test(joined);

    return {
      customer: {
        firstName: name.first,
        lastName: name.last,
        fullName: [name.first, name.last].filter(Boolean).join(' '),
        email,
        phone,
        addressPostcode: [address, postcode].filter(Boolean).join(' ').trim()
      },
      enquiry: {
        make: enquiryVehicle.make,
        model: enquiryVehicle.model,
        trim: enquiryVehicle.trim,
        reg: enquiryReg
      },
      px: {
        make: pxVehicle.make || '',
        model: pxVehicle.model || '',
        reg: pxReg && pxReg !== enquiryReg ? pxReg : '',
        mileage: pxMileage
      },
      booking: {
        type: bookingType,
        status: newUsed,
        date,
        time,
        flexible
      },
      intents,
      flags,
      notesOnly
    };
  }

  function copyValue(value, row) {
    if (!value) return;
    navigator.clipboard.writeText(value).catch(() => {
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    });
    if (!row) return;
    let flash = row.querySelector('.lp-flash');
    if (!flash) {
      flash = document.createElement('span');
      flash.className = 'lp-flash';
      row.appendChild(flash);
    }
    flash.textContent = 'Copied!';
    setTimeout(() => { if (flash) flash.textContent = ''; }, 1000);
  }

  function createRow(label, value) {
    const row = document.createElement('div');
    row.className = 'lp-row';
    const l = document.createElement('div');
    l.className = 'lp-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'lp-value';
    v.textContent = value;
    row.appendChild(l); row.appendChild(v);
    row.onclick = () => copyValue(value, row);
    return row;
  }

  function render() {
    const data = parse();
    const root = document.getElementById('lpSumContent');
    if (!root) return;
    root.innerHTML = '';

    const seenValues = new Set();
    function pushRow(list, label, value) {
      if (!value) return;
      const key = `${label}-${value}`;
      if (seenValues.has(key)) return;
      seenValues.add(key);
      list.push(createRow(label, value));
    }

    function block(title, rows) {
      const wrap = document.createElement('div');
      wrap.className = 'lp-block';
      const header = document.createElement('div');
      header.className = 'lp-block-header';
      header.innerHTML = `<span>${title}</span><span class="lp-toggle">▼</span>`;
      const body = document.createElement('div');
      body.className = 'lp-body';
      if (!rows.length) wrap.classList.add('collapsed');
      rows.forEach(r => body.appendChild(r));
      header.onclick = () => wrap.classList.toggle('collapsed');
      wrap.appendChild(header); wrap.appendChild(body);
      return wrap;
    }

    const custRows = [];
    pushRow(custRows, 'First Name:', data.customer.firstName);
    pushRow(custRows, 'Last Name:', data.customer.lastName);
    pushRow(custRows, 'Full Name:', data.customer.fullName);
    pushRow(custRows, 'Email:', data.customer.email);
    pushRow(custRows, 'Phone:', data.customer.phone);
    pushRow(custRows, 'Address + Postcode:', data.customer.addressPostcode);
    root.appendChild(block('Customer Details', custRows));

    const pxRows = [];
    pushRow(pxRows, 'PX Make:', data.px.make);
    pushRow(pxRows, 'PX Model:', data.px.model);
    pushRow(pxRows, 'PX Reg:', data.px.reg);
    pushRow(pxRows, 'PX Mileage:', data.px.mileage);
    if (!pxRows.length) pxRows.push(createRow('PX:', 'No Part Exchange'));
    root.appendChild(block('Part Exchange', pxRows));

    const summaryRows = [];
    const enquiryVehicle = [data.enquiry.make, data.enquiry.model].filter(Boolean).join(' ');
    const vehicleSummary = data.enquiry.reg
      ? [enquiryVehicle || data.enquiry.reg, data.enquiry.reg && enquiryVehicle ? data.enquiry.reg : ''].filter(Boolean).join(', ')
      : (enquiryVehicle || '');
    const pxSummary = (data.px.reg || data.px.mileage || data.px.make || data.px.model)
      ? [data.px.reg, data.px.mileage ? `${data.px.mileage} miles` : ''].filter(Boolean).join(', ')
      : 'No PX';
    const intentSummary = data.intents.join('; ');
    const flagSummary = data.flags.join('; ');

    function summarizeDateTime() {
      if (!data.booking.date && !data.booking.time && !data.booking.flexible) return 'No date/time selected';
      if (data.booking.flexible) return data.booking.date ? `${data.booking.date} (${data.booking.flexible})` : data.booking.flexible;
      const datePart = data.booking.date || 'No date selected';
      const timePart = data.booking.time || 'No time selected';
      return `${datePart} at ${timePart}`;
    }

    if (data.notesOnly) {
      summaryRows.push(createRow('NOTES ONLY', 'NOTES ONLY'));
      if (vehicleSummary) pushRow(summaryRows, 'Vehicle:', vehicleSummary);
      if (intentSummary) pushRow(summaryRows, 'Intent:', intentSummary);
      if (flagSummary) pushRow(summaryRows, 'Flags:', flagSummary);
      pushRow(summaryRows, 'Date/Time:', summarizeDateTime());
    } else {
      pushRow(summaryRows, 'Booking Type:', data.booking.type);
      pushRow(summaryRows, 'New or Used:', data.booking.status);
      pushRow(summaryRows, 'Vehicle:', vehicleSummary || data.enquiry.reg);
      pushRow(summaryRows, 'Date/Time:', summarizeDateTime());
      pushRow(summaryRows, 'PX:', pxSummary);
      if (intentSummary) pushRow(summaryRows, 'Intent:', intentSummary);
      if (flagSummary) pushRow(summaryRows, 'Flags:', flagSummary);
    }

    root.appendChild(block('Summary', summaryRows));
  }

  function observe() {
    const obs = new MutationObserver(() => render());
    obs.observe(document.body, { childList: true, subtree: true });
    render();
  }

  createUI();
  observe();
})();
