(function () {
  if (window._lpSumMini) return;

  let RENDER_LOCK = false;
  let LAST_RENDER = 0;
  const MIN_RENDER_GAP = 300; // milliseconds
  let RENDER_SCHEDULED = false;
  let OBSERVER_DEBOUNCE = null;
  const OBSERVER_DELAY = 800;

  function safeRender(fn) {
    const now = Date.now();
    if (now - LAST_RENDER < MIN_RENDER_GAP) {
      if (!RENDER_SCHEDULED) {
        RENDER_SCHEDULED = true;
        setTimeout(function () {
          RENDER_SCHEDULED = false;
          safeRender(fn);
        }, MIN_RENDER_GAP);
      }
      return;
    }

    if (RENDER_LOCK) {
      if (!RENDER_SCHEDULED) {
        RENDER_SCHEDULED = true;
        setTimeout(function () {
          RENDER_SCHEDULED = false;
          safeRender(fn);
        }, 80);
      }
      return;
    }
    RENDER_LOCK = true;
    try {
      fn();
    } catch (e) {
      console.error("LP Summary error:", e);
    }
    LAST_RENDER = Date.now();
    RENDER_LOCK = false;
  }

  const PREDEFINED_CONTENT = [
    "Hello, you're speaking with $!{operator.displayname} from Stellantis &You UK.",
    "Hello, you're speaking with $!{operator.displayname} from Stellantis &You UK. How can I help you today?",
    "Thanks for chatting with Stellantis &You UK. How can I assist you today?",
    "You're speaking with $!{operator.displayname} from Stellantis &You UK.",
    "Hello, you are speaking with $!{operator.displayname} from Stellantis &You UK.",
    "Thank you for contacting Stellantis &You UK.",
    "Thanks for your enquiry. A member of the team will be with you shortly.",
    "I can help with your enquiry today.",
    "Please can you provide registration, make, model and mileage.",
    "Please can you provide the registration, make, model and mileage so I can value your part exchange.",
    "We can guide you through reserving the vehicle for £99.",
    "You are connected to Stellantis &You UK.",
    "This chat may be recorded for quality and training purposes.",
    "We are connecting you to an agent.",
    "The agent is typing.",
    "Transferring you to another agent.",
    "Your chat has been transferred.",
    "Thanks for waiting, I will be with you shortly.",
    "We have received your message and will reply soon.",
    "Stellantis &You UK availability confirmation."
  ];

  const PREDEFINED_OS_CONFIRMATIONS = [
    "reservation moves it to your chosen dealership",
    "stored at our central used stock centre",
    "stored at our central used stock center",
    "fully refundable £99 reservation moves it to your chosen stellantis &you dealership",
    "up to 5-6 working days for click & collect",
    "delivered for you once intention to purchase is confirmed"
  ];

  var DEBUG_OVERLAY_ENABLED = false;

  if (typeof levenshtein !== "function") {
    function levenshtein(a, b) {
      const matrix = [];
      for (let i = 0; i <= b.length; i++) matrix[i] = [i];
      for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          matrix[i][j] = b[i - 1] === a[j - 1]
            ? matrix[i - 1][j - 1]
            : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
      }
      return matrix[b.length][a.length];
    }
  }

  function normalizeMessageForTemplate(text) {
    return (text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/you'?re speaking with [^.,]+ from stellantis &you uk\.?/, "")
      .trim();
  }

  var app = {
    styleId: "lp-sum-mini-style",
    buttonId: "lpSumMiniBtn",
    panelId: "lpSumMiniPanel",
    copyBadgeId: "lpSumMiniCopyBadge",
    debugOverlayId: "lpSumMiniDebugOverlay",
    observer: null,
    data: {},
    renderCount: 0,
    debugOverlay: null
  };

  window._lpSumMini = app;

  function injectStyles() {
    if (document.getElementById(app.styleId)) return;

    var style = document.createElement("style");
    style.id = app.styleId;
    style.setAttribute("data-lp-ignore", "true");
    style.textContent =
      "#" + app.buttonId + " {" +
      " position: fixed;" +
      " right: 48px;" +
      " bottom: 12px;" +
      " width: 14px;" +
      " height: 14px;" +
      " border-radius: 50%;" +
      " background: #1e1d49;" +
      " border: 2px solid #000;" +
      " box-shadow: 0 0 4px rgba(0,0,0,0.4);" +
      " cursor: pointer;" +
      " z-index: 100001;" +
      " display: block;" +
      " padding: 0;" +
      "}" +
      "#" + app.panelId + " {" +
      " position: fixed;" +
      " top: 0;" +
      " right: 0;" +
      " width: 300px;" +
      " height: 100vh;" +
      " background: #1e1d49;" +
      " color: #ffffff;" +
      " font-family: Arial, sans-serif;" +
      " font-size: 14px;" +
      " padding: 20px;" +
      " box-shadow: -5px 0 12px rgba(0,0,0,0.35);" +
      " transform: translateX(100%);" +
      " opacity: 0;" +
      " pointer-events: none;" +
      " transition: transform 0.25s ease, opacity 0.25s ease;" +
      " z-index: 100000;" +
      " box-sizing: border-box;" +
      " overflow-y: auto;" +
      "}" +
      "#" + app.panelId + ".open {" +
      " transform: translateX(0);" +
      " opacity: 1;" +
      " pointer-events: auto;" +
      "}" +
      "#" + app.panelId + " h3 {" +
      " margin: 0 0 8px 0;" +
      " font-size: 16px;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniSection {" +
      " margin-bottom: 16px;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniRow {" +
      " display: flex;" +
      " justify-content: space-between;" +
      " align-items: center;" +
      " padding: 6px 8px;" +
      " margin-bottom: 6px;" +
      " background: rgba(255,255,255,0.06);" +
      " border-radius: 4px;" +
      " cursor: pointer;" +
      " position: relative;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniLabel {" +
      " font-weight: bold;" +
      " margin-right: 8px;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniValue {" +
      " word-break: break-word;" +
      " text-align: right;" +
      " flex: 1;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniCopyHints {" +
      " display: none;" +
      " position: absolute;" +
      " top: 2px;" +
      " right: 2px;" +
      " gap: 4px;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniRow:hover .lpSumMiniCopyHints {" +
      " display: flex;" +
      "}" +
      "#" + app.panelId + " .lpSumMiniCopyHint {" +
      " background: #2f2f6b;" +
      " border-radius: 2px;" +
      " padding: 2px 4px;" +
      " font-size: 11px;" +
      " cursor: pointer;" +
      "}" +
      "#" + app.copyBadgeId + " {" +
      " position: fixed;" +
      " top: 16px;" +
      " right: 16px;" +
      " background: #28a745;" +
      " color: #ffffff;" +
      " padding: 6px 10px;" +
      " border-radius: 4px;" +
      " font-size: 12px;" +
      " z-index: 100002;" +
      " opacity: 0;" +
      " transition: opacity 0.2s ease;" +
      "}" +
      "#" + app.copyBadgeId + ".show {" +
      " opacity: 1;" +
      "}" +
      "#" + app.debugOverlayId + " {" +
      " position: fixed;" +
      " bottom: 8px;" +
      " left: 50%;" +
      " transform: translateX(-50%);" +
      " background: rgba(0, 0, 0, 0.7);" +
      " color: #fff;" +
      " padding: 6px 10px;" +
      " border-radius: 4px;" +
      " font-size: 12px;" +
      " z-index: 100003;" +
      " pointer-events: none;" +
      "}";
    document.head.appendChild(style);
  }

  function createUI() {
    injectStyles();

    var btn = document.createElement("button");
    btn.id = app.buttonId;
    btn.type = "button";
    btn.setAttribute("aria-label", "Auto Summary");

    var panel = document.createElement("div");
    panel.id = app.panelId;

    var badge = document.createElement("div");
    badge.id = app.copyBadgeId;
    badge.textContent = "Copied!";

    panel.appendChild(buildSection("Customer Details", [
      createRow("Full Name", "fullName", true),
      createRow("Email", "email"),
      createRow("Phone", "phone"),
      createRow("Address", "address")
    ]));

    panel.appendChild(buildSection("Part Exchange", [
      createRow("Make", "pxMake"),
      createRow("Model", "pxModel"),
      createRow("Reg", "pxReg"),
      createRow("Mileage", "pxMileage")
    ]));

    var summarySection = buildSection("Summary", []);
    summarySection.appendChild(createBookingOverrideControl());
    [
      createRow("Booking Type", "bookingType"),
      createRow("New/Used", "newUsed"),
      createRow("Vehicle", "vehicle"),
      createRow("Preferences", "preferences"),
      createRow("Date/Time", "dateTime"),
      createRow("PX Summary", "pxSummary"),
      createRow("Customer Requests", "customerRequests"),
      createRow("Intent", "intent"),
      createRow("Flags", "flags")
    ].forEach(function (row) {
      summarySection.appendChild(row);
    });

    panel.appendChild(summarySection);

    btn.onclick = function () {
      panel.classList.toggle("open");
    };

    document.body.appendChild(btn);
    document.body.appendChild(panel);
    document.body.appendChild(badge);

    app.button = btn;
    app.panel = panel;
    app.badge = badge;
    installSummaryCopyAllV2();
  }

  function updateDebugOverlay(messagesObj) {
    if (!DEBUG_OVERLAY_ENABLED) {
      if (app.debugOverlay) {
        app.debugOverlay.style.display = "none";
      }
      return;
    }

    if (!messagesObj || !messagesObj.raw) return;

    if (!app.debugOverlay) {
      var overlay = document.getElementById(app.debugOverlayId);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = app.debugOverlayId;
        document.body.appendChild(overlay);
      }
      app.debugOverlay = overlay;
    }

    app.debugOverlay.style.display = "block";
    app.renderCount = (app.renderCount || 0) + 1;

    var totalMessages = messagesObj.raw.length;
    var agentMessages = messagesObj.raw.filter(function (msg) {
      return msg.sender === "agent";
    }).length;
    var customerMessages = messagesObj.raw.filter(function (msg) {
      return msg.sender === "customer";
    }).length;
    var combinedLength = (messagesObj.combinedAll || "").length;
    var hash = totalMessages + ":" + combinedLength;

    app.debugOverlay.textContent =
      "renders: " +
      app.renderCount +
      " | messages: " +
      totalMessages +
      " (agent: " +
      agentMessages +
      ", customer: " +
      customerMessages +
      ") | hash: " +
      hash;
  }

  function buildSection(title, rows) {
    var section = document.createElement("div");
    section.className = "lpSumMiniSection";
    var heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);
    rows.forEach(function (row) {
      section.appendChild(row);
    });
    return section;
  }

  function createRow(label, key, isName) {
    var row = document.createElement("div");
    row.className = "lpSumMiniRow";
    row.dataset.key = key;

    var labelEl = document.createElement("span");
    labelEl.className = "lpSumMiniLabel";
    labelEl.textContent = label;

    var valueEl = document.createElement("span");
    valueEl.className = "lpSumMiniValue";
    valueEl.textContent = "";

    row.appendChild(labelEl);
    row.appendChild(valueEl);

    if (isName) {
      var hints = document.createElement("div");
      hints.className = "lpSumMiniCopyHints";

      var firstHint = document.createElement("span");
      firstHint.className = "lpSumMiniCopyHint";
      firstHint.textContent = "First";
      firstHint.onclick = function (ev) {
        ev.stopPropagation();
        copyValue(app.data.firstName || "");
      };

      var lastHint = document.createElement("span");
      lastHint.className = "lpSumMiniCopyHint";
      lastHint.textContent = "Last";
      lastHint.onclick = function (ev) {
        ev.stopPropagation();
        copyValue(app.data.lastName || "");
      };

      hints.appendChild(firstHint);
      hints.appendChild(lastHint);
      row.appendChild(hints);
    }

    row.onclick = function () {
      var keyName = row.dataset.key;
      var val = app.data[keyName] || "";
      copyValue(val);
    };

    row._valueEl = valueEl;
    return row;
  }

  function createBookingOverrideControl() {
    var row = document.createElement("div");
    row.className = "lpSumMiniRow lpSumMiniControl";

    var labelEl = document.createElement("span");
    labelEl.className = "lpSumMiniLabel";
    labelEl.textContent = "Booking Type Override";

    var select = document.createElement("select");
    select.className = "lpSumMiniValue";
    var options = [
      "auto-detect",
      "notes only",
      "test drive",
      "view",
      "phone call",
      "valuation",
      "online store"
    ];

    options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });

    select.value = getBookingOverride();
    select.onchange = function (ev) {
      ev.stopPropagation();
      setBookingOverride(select.value);
    };

    row.appendChild(labelEl);
    row.appendChild(select);

    app.bookingOverrideSelect = select;

    return row;
  }

  function getBookingOverride() {
    try {
      var stored = localStorage.getItem("lpSumMini.bookingOverride") || "auto-detect";
      return stored === "motability" ? "auto-detect" : stored;
    } catch (e) {
      return "auto-detect";
    }
  }

  function setBookingOverride(value) {
    try {
      localStorage.setItem("lpSumMini.bookingOverride", value);
    } catch (e) {}
    scheduleRender();
  }

  function copyValue(value) {
    if (!value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(showCopied).catch(function () {
        fallbackCopy(value);
      });
    } else {
      fallbackCopy(value);
    }
  }

  function fallbackCopy(value) {
    var area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
    showCopied();
  }

  function installSummaryCopyAllV2() {
    var panel = document.getElementById(window._lpSumMini.panelId);
    if (!panel) return;

    var heading = Array.from(panel.querySelectorAll("h3")).find(function (h) {
      return h.textContent.trim().toLowerCase() === "summary";
    });
    if (!heading) return;

    heading.style.cursor = "pointer";

    heading.onclick = function (ev) {
      ev.stopPropagation();
      var data = window._lpSumMini.data || {};

      var lines = [
        "Summary",
        "------------------",
        "Booking Type: " + (data.bookingType || ""),
        "New/Used: " + (data.newUsed || ""),
        "Vehicle: " + (data.vehicle || ""),
        "Preferences: " + (data.preferences || ""),
        "Date/Time: " + (function () {
          if (data.dateTime) return data.dateTime;
          var parts = [];
          if (data.date) parts.push(data.date);
          if (data.time) parts.push(data.time);
          if (data.flexible) parts.push(data.flexible);
          return parts.join(" ").trim();
        })(),
        "PX Summary: " + (data.pxSummary || "")
      ];

      var requests = Array.isArray(data.customerRequests) ? data.customerRequests : [];
      lines.push("Customer Requests:");
      if (requests.length) {
        requests.forEach(function (request) {
          lines.push(" - " + request);
        });
      }
      lines.push("Intent: " + (data.intent || ""));
      lines.push("Flags: " + (data.flags || ""));

      navigator.clipboard.writeText(lines.join("\n").trim()).then(showCopied);
    };
  }

  function showCopied() {
    if (!app.badge) return;
    app.badge.classList.add("show");
    setTimeout(function () {
      app.badge.classList.remove("show");
    }, 1000);
  }

  function collectMessages() {
    var nodes = Array.from(document.querySelectorAll(".html-content.text-content"));
    var raw = [];
    var cleanCustomer = [];
    var cleanAgent = [];
    var messageIndex = 0;
    var nonSystemCount = 0;
    var history = { agentConfirmed: {} };

    function isPredefined(text) {
      return PREDEFINED_CONTENT.indexOf(text) !== -1 || PREDEFINED_OS_CONFIRMATIONS.indexOf(text) !== -1;
    }

    function isPredefinedDeep(text) {
      var normalized = normalizeMessageForTemplate(text);
      return PREDEFINED_CONTENT.concat(PREDEFINED_OS_CONFIRMATIONS).some(function (template) {
        return levenshtein(normalizeMessageForTemplate(template), normalized) < 3;
      });
    }

    function isNameRequest(txt) {
      var lower = (txt || "").toLowerCase();
      return /may i take your full name|just to confirm, could i have your full name|can i confirm your full name|your full name please|could i take your name|may i take your name/.test(lower);
    }

    function isTimestampOrigin(origin) {
      return !origin || /^[\d:\s]+$/.test(origin);
    }

    function requestedInfo(msg) {
      if (!msg || msg.sender !== "agent") return false;
      var lower = (msg.text || "").toLowerCase();
      return /full name|name|registration|reg|make|model|mileage|part exchange|px|finance|deposit|monthly|date|time|appointment|test drive|viewing|phone call/.test(lower);
    }

    function recordAgentConfirmed(text) {
      var lower = (text || "").toLowerCase();
      var regMatch = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/i.exec(text || "");
      if (regMatch) history.agentConfirmed.reg = regMatch[1].replace(/\s+/g, "").toUpperCase();

      var vehicle = detectBrandAndModel(text) || detectKnownModelOnly(text);
      if (vehicle) history.agentConfirmed.vehicle = vehicle;

      if (/pcp|hp|pch|lease|finance|deposit|monthly/.test(lower)) {
        history.agentConfirmed.finance = text;
      }

      var timeMatch = /(\d{1,2}[:.]\d{2})/i.exec(text);
      if (timeMatch) history.agentConfirmed.time = timeMatch[1];

      var dateMatch = /(\d{1,2})[\/\-](\d{1,2})/i.exec(text);
      if (dateMatch) history.agentConfirmed.date = dateMatch[1] + "/" + dateMatch[2];
    }

    nodes.forEach(function (node) {
      if (app.panel && app.panel.contains(node)) return;
      var text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      if (!/[A-Za-z0-9]/.test(text)) return;
      if (node.closest(".chips-item")) return;

      var originatorEl = node.nextElementSibling &&
                         node.nextElementSibling.classList.contains("originator")
                         ? node.nextElementSibling
                         : null;

      if (!originatorEl && node.parentElement) {
        const ori = node.parentElement.querySelectorAll(".originator");
        if (ori.length === 1) originatorEl = ori[0];
      }

      let sender = "customer";
      let origin = originatorEl ? (originatorEl.innerText || "").trim().toLowerCase() : "";
      let lowerText = text.toLowerCase();

      if (origin === "omari") sender = "agent";
      else if (origin === "visitor") sender = "customer";
      else if (origin === "welcome message") sender = "system";
      else if (origin.indexOf("stellantis &you uk") !== -1) sender = "system";
      else if (origin.startsWith("sms")) sender = "customer";

      if (isTimestampOrigin(origin)) {
        if (/^hello, you are speaking with omari/.test(text)) sender = "agent";
        else if (/^welcome!|^you are now connected/.test(lowerText)) sender = "system";
        else if (raw.length === 0) sender = "customer";
      }

      function askedName(msg) {
        return /may i take your full name|just to confirm.*full name|can i confirm your full name/.test(
          (msg.text || "").toLowerCase()
        );
      }
      if (raw.length > 0 && (askedName(raw[raw.length - 1]) || requestedInfo(raw[raw.length - 1]))) sender = "customer";

      if (isPredefined(text) || isPredefinedDeep(text)) return;
      if (/is typing/i.test(lowerText)) return;

      var currentIndex = messageIndex++;
      raw.push({ sender: sender, text: text, index: currentIndex, lower: lowerText });
      if (sender === "agent") recordAgentConfirmed(text);
      if (sender === "customer") cleanCustomer.push(text);
      if (sender === "agent") cleanAgent.push(text);
      if (sender !== "system") nonSystemCount++;
    });

    return {
      raw: raw,
      cleanCustomer: cleanCustomer,
      cleanAgent: cleanAgent,
      history: history,
      combinedCustomer: cleanCustomer.join(" ").toLowerCase(),
      combinedAll: raw.map(function (r) { return r.text; }).join(" ").toLowerCase()
    };
  }

  function autoCapName(str) {
    if (!str) return "";
    return str
      .trim()
      .split(/\s+/)
      .map(function (p) {
        return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function parseMessages(messagesObj) {
    var raw = (messagesObj && messagesObj.raw) || [];
    var customerMessages = raw.filter(function (m) { return m.sender === "customer"; });
    var agentMessages = raw.filter(function (m) { return m.sender === "agent"; });
    var history = (messagesObj && messagesObj.history) || {};
    var data = {
      fullName: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      postcode: "",
      make: "",
      model: "",
      trim: "",
      reg: "",
      bookingType: "",
      newUsed: "",
      vehicle: "",
      dateTime: "",
      date: "",
      time: "",
      flexible: "",
      pxSummary: "",
      pxMake: "",
      pxModel: "",
      pxReg: "",
      pxMileage: "",
      intent: "",
      preferences: "",
      flags: "",
      customerRequests: [],
      placeholderVOI: ""
    };

    var nameInfo = detectNameV5(raw, agentMessages, customerMessages);
    if (nameInfo) {
      data.fullName = nameInfo.fullName;
      data.firstName = nameInfo.firstName;
      data.lastName = nameInfo.lastName;
    }

    var email = detectEmail(customerMessages);
    if (email) data.email = email;

    var phone = detectPhoneV2(customerMessages);
    if (phone) data.phone = phone;

    var addressInfo = detectAddressAndPostcode(customerMessages);
    if (addressInfo) {
      data.address = addressInfo.address;
      data.postcode = addressInfo.postcode;
    }

    var pxAskIndex = detectPxRequestIndex(agentMessages);
    var pxData = detectPXv6(raw, agentMessages, pxAskIndex);
    if (pxData) {
      data.pxReg = pxData.pxReg || "";
      data.pxMake = pxData.pxMake || "";
      data.pxModel = pxData.pxModel || "";
      data.pxMileage = pxData.pxMileage || "";
    }

    var voiData = detectVOIv4(raw, agentMessages, pxData, history, pxAskIndex);
    if (voiData) {
      data.make = voiData.make || data.make;
      data.model = voiData.model || data.model;
      data.trim = voiData.trim || data.trim;
      data.reg = voiData.reg || data.reg;
    }
    if (voiData && voiData.placeholder) {
      data.placeholderVOI = voiData.placeholder;
    }

    if (history.agentConfirmed && history.agentConfirmed.reg) data.reg = history.agentConfirmed.reg;

    if (data.reg && data.make && data.model) {
      data.vehicle = (data.make + " " + data.model + " (" + data.reg + ")").trim();
    } else if (data.make && data.model) {
      data.vehicle = (data.make + " " + data.model).trim();
    } else if (data.reg) {
      data.vehicle = data.reg;
    }

    data.customerRequests = detectCustomerRequestsV3(raw, agentMessages);

    var intents = detectIntentV9(raw, data, pxAskIndex);
    if (intents.length) data.intent = intents.join(", ");

    var preferences = detectPreferencesV4(raw);
    if (preferences.length) data.preferences = preferences.join(", ");

    var finance = detectFinanceV3(raw);
    if (finance) {
      if (!data.intent) data.intent = "finance discussion";
      else if (data.intent.indexOf("finance discussion") === -1) data.intent += ", finance discussion";

      if (data.customerRequests.indexOf(finance) === -1) {
        data.customerRequests.push(finance);
      }
    }

    var dateInfo = detectDateTimeV9(raw, agentMessages, history);
    if (dateInfo) {
      data.date = dateInfo.date;
      data.time = dateInfo.time;
      data.flexible = dateInfo.flexible;
      data.dateTime = dateInfo.dateTime;
    }
    if (history.agentConfirmed) {
      if (history.agentConfirmed.date) data.date = history.agentConfirmed.date;
      if (history.agentConfirmed.time) data.time = history.agentConfirmed.time;
    }
    if (data.date && data.time) data.dateTime = data.date + " " + data.time;
    else if (data.date && data.flexible) data.dateTime = data.date + " " + data.flexible;
    else if (data.date) data.dateTime = data.date;
    else if (data.time) data.dateTime = data.time;

    var newUsed = detectNewUsedV4(data, raw, history);
    if (newUsed) data.newUsed = newUsed;

    data.bookingType = detectBookingTypeV6(raw, data, agentMessages, customerMessages);

    var flags = detectFlagsV10(raw, data, pxAskIndex);
    if (flags.length) data.flags = flags.join(", ");

    data.pxSummary = buildPxSummary(data);

    return data;
  }

  function detectNameV5(raw, agentMessages, customerMessages) {
    var selfIdRegex = /(my name is|this is|i am|i'm|im|speaking[, ]?)(.+)$/i;
    var askRegex = /(full name|confirm your name|your name please|could i have your name|can i confirm your full name|may i take your full name|could i take your name|may i take your name)/i;
    var strictReg = /\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i;
    var blockedPhrases = /(i'?m looking for|i'?m after|i'?m looking at|i'?m interested in|i'?m not sure)/i;
    var blockedTokens = /(looking|after|for|wanting|needing|similar|interested|view|test|drive|finance|deposit|mileage|reg)/i;

    function cleanNameCandidate(fragment) {
      if (!fragment) return "";
      return fragment
        .replace(/[0-9]/g, "")
        .replace(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/gi, "")
        .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function looksLikeName(str) {
      if (!str) return false;
      if (/@/.test(str)) return false;
      if (strictReg.test(str)) return false;
      if (detectKnownModelOnly(str) || detectBrandAndModel(str)) return false;
      if (blockedTokens.test(str.toLowerCase())) return false;
      var parts = str.split(/\s+/);
      if (parts.length < 1 || parts.length > 4) return false;
      return parts.every(function (p) { return /^[A-Za-z][A-Za-z\-']*$/.test(p); });
    }

    function buildNameObject(firstName, lastName) {
      var fullName = "";
      if (firstName && lastName) fullName = autoCapName(firstName + " " + lastName);
      else if (firstName) fullName = autoCapName(firstName);
      return {
        fullName: fullName,
        firstName: autoCapName(firstName || ""),
        lastName: autoCapName(lastName || "")
      };
    }

    var result = { fullName: "", firstName: "", lastName: "" };

    customerMessages.forEach(function (msg) {
      var text = (msg.text || "").trim();
      if (blockedPhrases.test(text)) return;
      var match = selfIdRegex.exec(text);
      if (!match) return;
      var candidate = cleanNameCandidate(match[2]);
      if (!looksLikeName(candidate)) return;
      var parts = candidate.split(/\s+/);
      if (parts.length >= 2) {
        result = buildNameObject(parts[0], parts.slice(1).join(" "));
      } else if (parts.length === 1) {
        result.firstName = autoCapName(parts[0]);
        result.fullName = result.firstName;
      }
    });

    var askIndex = -1;
    agentMessages.forEach(function (msg) {
      if (askIndex !== -1) return;
      if (askRegex.test((msg.text || "").toLowerCase())) askIndex = msg.index;
    });

    if (askIndex >= 0) {
      for (var r = 0; r < raw.length; r++) {
        var item = raw[r];
        if (item.index <= askIndex || item.sender !== "customer") continue;
        var candidateText = cleanNameCandidate(item.text || "");
        if (!looksLikeName(candidateText)) break;
        var partsAfter = candidateText.split(/\s+/);
        if (partsAfter.length >= 2) {
          result = buildNameObject(partsAfter[0], partsAfter.slice(1).join(" "));
        } else if (partsAfter.length === 1) {
          result.firstName = autoCapName(partsAfter[0]);
          result.fullName = result.firstName;
        }
        break;
      }
    }

    customerMessages.forEach(function (msg) {
      var candidate = cleanNameCandidate((msg.text || "").trim());
      if (!looksLikeName(candidate)) return;
      var parts = candidate.split(/\s+/);
      if (parts.length >= 2) {
        result = buildNameObject(parts[0], parts.slice(1).join(" "));
      }
    });

    customerMessages.forEach(function (msg) {
      var text = (msg.text || "").trim();
      var surnameMatch = /(surname|last name)\s+([A-Za-z\-']+)/i.exec(text);
      if (surnameMatch && result.firstName && !result.lastName) {
        result = buildNameObject(result.firstName, surnameMatch[2]);
      }
    });

    return result.fullName || result.firstName ? result : null;
  }

  function detectPXv6(raw, agentMessages, pxAskIndex) {
    var px = { pxReg: "", pxMake: "", pxModel: "", pxMileage: "" };
    var strictReg = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;

    function extractReg(text) {
      var match = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/i.exec(text || "");
      if (!match) return "";
      var candidate = match[1].replace(/\s+/g, "").toUpperCase();
      if (!strictReg.test(candidate)) return "";
      if (/finance|deposit|monthly|pm|pcp|hp|pch/i.test(text)) return "";
      return candidate;
    }

    function extractMileage(text) {
      if (/finance|deposit|monthly|pm|pcp|hp|pch/i.test(text)) return "";
      var match = /(\d{2,3}\s?k|\d{4,6})\s*(miles|mi)?/i.exec(text || "");
      if (!match) return "";
      var rawVal = match[1];
      var num = rawVal.replace(/[^\d]/g, "");
      if (/k/i.test(rawVal)) return String(parseInt(num, 10) * 1000);
      if (parseInt(num, 10) < 1000 && !/miles|mi/i.test(text)) return "";
      return num;
    }

    function shouldReset(text) {
      return /(that's wrong|actually|correction|ignore that reg)/i.test(text || "");
    }

    raw.forEach(function (item) {
      if (item.sender !== "customer") return;
      var text = item.text || "";
      var selfIdentified = isSelfIdentifyingVehicle(text);
      var afterAsk = pxAskIndex >= 0 && item.index > pxAskIndex;
      if (!afterAsk && !selfIdentified) return;
      if (/similar to my/i.test(text)) return;

      if (shouldReset(text)) {
        px = { pxReg: "", pxMake: "", pxModel: "", pxMileage: "" };
        return;
      }

      var reg = extractReg(text);
      var mileage = extractMileage(text);
      var model = detectKnownModelOnly(text);
      var makeModel = detectBrandAndModel(text);

      if (reg) px.pxReg = reg;
      if (mileage) px.pxMileage = mileage;
      if (makeModel) {
        px.pxMake = makeModel.make;
        px.pxModel = makeModel.model;
      } else if (model) {
        px.pxMake = model.make;
        px.pxModel = model.model;
      }
    });

    return px;
  }

  function detectVOIv4(raw, agentMessages, pxData, history, pxAskIndex) {
    var voi = null;
    var candidates = [];
    var interestRegex = /(looking for|looking at|interested in|want a|do you have|the \w+\s+\d{3,4})/i;

    function pushCandidate(source, text, priority) {
      var vehicle = detectBrandAndModel(text) || detectKnownModelOnly(text);
      if (!vehicle) return;
      candidates.push({ vehicle: vehicle, priority: priority, source: source, text: text });
    }

    if (history && history.agentConfirmed && history.agentConfirmed.vehicle) {
      voi = history.agentConfirmed.vehicle;
    }

    if (!voi) {
      raw.forEach(function (item) {
        var text = item.text || "";
        if (item.sender === "customer" && interestRegex.test(text) && !isSelfIdentifyingVehicle(text)) {
          pushCandidate("interest", text, 1);
        }
      });
    }

    if (!voi && pxData && pxData.pxMake && pxData.pxModel) {
      raw.forEach(function (item) {
        var text = item.text || "";
        if (item.sender === "customer" && /similar to my/i.test(text)) {
          voi = { placeholder: "Similar to: " + pxData.pxMake + " " + pxData.pxModel };
        }
      });
    }

    if (!voi && candidates.length === 0) {
      raw.forEach(function (item) {
        var text = item.text || "";
        if (item.sender === "customer" && !isSelfIdentifyingVehicle(text)) {
          pushCandidate("mention", text, 2);
        }
      });
    }

    if (!voi && candidates.length === 0) {
      raw.forEach(function (item) {
        var text = item.text || "";
        if (item.sender === "customer" && !isSelfIdentifyingVehicle(text) && pxAskIndex >= 0 && item.index < pxAskIndex) {
          var regMatch = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/i.exec(text);
          if (regMatch) {
            candidates.push({ vehicle: { make: "", model: "", trim: "", reg: regMatch[1].replace(/\s+/g, "").toUpperCase() }, priority: 3 });
          }
        }
      });
    }

    if (!voi && candidates.length) {
      candidates.sort(function (a, b) { return a.priority - b.priority; });
      voi = candidates[candidates.length - 1].vehicle;
    }

    if (voi && !voi.placeholder && pxData && pxData.pxModel && detectKnownModelOnly(pxData.pxModel)) {
      if (voi.model === pxData.pxModel && voi.make === pxData.pxMake) {
        voi = null;
      }
    }

    if (voi && voi.placeholder) {
      return voi;
    }

    return voi;
  }

  function detectBrandAndModel(text) {
    var brandList = ["peugeot", "citroen", "citroën", "ds", "fiat", "abarth", "alfa romeo", "jeep", "vauxhall", "leapmotor"];
    var trimList = ["gt", "allure", "active", "premium", "ultra", "sport", "la premiere", "s line", "lounge"];
    var lower = (text || "").toLowerCase();
    var tokens = lower.split(/\s+/);

    for (var b = 0; b < brandList.length; b++) {
      var brand = brandList[b];
      for (var t = 0; t < tokens.length; t++) {
        if (tokens[t] === brand || tokens[t].replace(/[^a-z]/g, "") === brand.replace(/\s+/g, "")) {
          var following = tokens.slice(t + 1, t + 4).filter(function (tok) { return tok && !/^[^a-z0-9]+$/i.test(tok); });
          if (!following.length) continue;
          var modelTokens = following.slice(0, 2);
          var trim = "";
          var lastToken = following[following.length - 1];
          if (trimList.indexOf(lastToken.replace(/[^a-z]/g, "")) !== -1) {
            trim = lastToken.replace(/[^a-z]/g, "");
            modelTokens = following.slice(0, following.length - 1);
          }
          var model = modelTokens.join(" ").trim();
          if (model) {
            return {
              make: toTitleCase(brand),
              model: model.toUpperCase() === model ? model : toTitleCase(model),
              trim: trim ? toTitleCase(trim) : "",
              reg: ""
            };
          }
        }
      }
    }
    return null;
  }

  function detectKnownModelOnly(text) {
    var models = [
      { make: "Peugeot", model: "208" },
      { make: "Peugeot", model: "2008" },
      { make: "Peugeot", model: "308" },
      { make: "Peugeot", model: "3008" },
      { make: "Peugeot", model: "5008" },
      { make: "Peugeot", model: "508" },
      { make: "Citroen", model: "C3" },
      { make: "Citroen", model: "C4" },
      { make: "Citroen", model: "C5" },
      { make: "Citroen", model: "C5 X" },
      { make: "Citroen", model: "Berlingo" },
      { make: "DS", model: "DS3" },
      { make: "DS", model: "DS4" },
      { make: "DS", model: "DS7" },
      { make: "Fiat", model: "500" },
      { make: "Fiat", model: "500e" },
      { make: "Fiat", model: "Panda" },
      { make: "Fiat", model: "Tipo" },
      { make: "Abarth", model: "595" },
      { make: "Abarth", model: "695" },
      { make: "Alfa Romeo", model: "Giulia" },
      { make: "Alfa Romeo", model: "Giulietta" },
      { make: "Alfa Romeo", model: "Stelvio" },
      { make: "Jeep", model: "Avenger" },
      { make: "Jeep", model: "Compass" },
      { make: "Jeep", model: "Renegade" },
      { make: "Vauxhall", model: "Corsa" },
      { make: "Vauxhall", model: "Astra" },
      { make: "Vauxhall", model: "Mokka" },
      { make: "Vauxhall", model: "Grandland" },
      { make: "Leapmotor", model: "T03" },
      { make: "Leapmotor", model: "C10" }
    ];
    var lower = (text || "").toLowerCase();
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      if (lower.indexOf(m.model.toLowerCase()) !== -1) {
        return { make: m.make, model: m.model, trim: "", reg: "" };
      }
    }
    return null;
  }

  function detectEmail(messages) {
    var emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    for (var i = 0; i < messages.length; i++) {
      var text = messages[i].text || "";
      var match = emailRegex.exec(text);
      if (match) return match[0].toLowerCase();
    }
    return "";
  }

  function detectPhoneV2(messages) {
    var digitsRegex = /(\+?\d[\d\s]{7,})/;
    for (var i = 0; i < messages.length; i++) {
      var text = messages[i].text || "";
      var match = digitsRegex.exec(text);
      if (match) {
        var cleaned = match[1].replace(/\D/g, "");
        if (cleaned.length >= 9 && cleaned.length <= 13) return cleaned;
      }
    }
    return "";
  }

  function detectAddressAndPostcode(messages) {
    var postcodeRegex = /([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})/i;
    var address = "";
    var postcode = "";
    messages.forEach(function (msg) {
      var text = msg.text || "";
      if (!address && /\d+\s+\w+/.test(text)) {
        address = text;
      }
      var match = postcodeRegex.exec(text);
      if (match) {
        postcode = (match[1] + " " + match[2]).toUpperCase();
      }
    });
    return address || postcode ? { address: address, postcode: postcode } : null;
  }

  function detectPxRequestIndex(agentMessages) {
    var idx = -1;
    agentMessages.forEach(function (msg) {
      var lower = (msg.text || "").toLowerCase();
      if (/part exchange|px|trade[- ]?in/.test(lower)) idx = msg.index;
    });
    return idx;
  }

  function isSelfIdentifyingVehicle(text) {
    return /my car|my vehicle|i have|i've got|i currently drive/.test((text || "").toLowerCase());
  }

  function detectNewUsedV4(data, raw, history) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    if (/new car|brand new/.test(combined)) return "New";
    if (/used|second hand|pre-owned|approved used/.test(combined)) return "Used";
    if (history.agentConfirmed && history.agentConfirmed.vehicle) return "Used";
    if (data.reg) return "Used";
    return "";
  }

  function detectBookingTypeV6(raw, data, agentMessages, customerMessages) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    if (/test drive/.test(combined)) return "Test Drive";
    if (/viewing|view|see (the )?car/.test(combined)) return "View";
    if (/phone call|call me|phone me/.test(combined)) return "Phone Call";
    if (/valuation/.test(combined)) return "Valuation";
    if (/online store|reserve|reservation/.test(combined)) return "Online Store";
    return "";
  }

  function detectDateTimeV9(raw, agentMessages, history) {
    var today = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    var todayStr = pad(today.getDate()) + "/" + pad(today.getMonth() + 1);
    var tomorrow = new Date(today.getTime() + 86400000);
    var tomorrowStr = pad(tomorrow.getDate()) + "/" + pad(tomorrow.getMonth() + 1);

    var date = "";
    var time = "";
    var flexible = "";
    var agentContext = agentMessages.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var agentAskedToday = /today|tomorrow|this week|next week/.test(agentContext);

    function getLastTimeMention(messages) {
      var last = "";
      messages.forEach(function (msg) {
        var text = msg.text || "";
        var match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
        if (!match) return;
        var hour = parseInt(match[1], 10);
        var mins = match[2] ? parseInt(match[2], 10) : 0;
        if (match[3]) {
          if (match[3].toLowerCase() === "pm" && hour < 12) hour += 12;
          if (match[3].toLowerCase() === "am" && hour === 12) hour = 0;
        } else {
          hour = hour < 9 ? hour + 12 : hour + 12;
        }
        last = clampTimeSlot(hour, mins);
      });
      return last;
    }

    function parseTime(token) {
      var hm = /(\d{1,2})[:.](\d{2})/i.exec(token);
      if (hm) return clampTimeSlot(parseInt(hm[1], 10), parseInt(hm[2], 10));
      var plain = /\bat\s*(\d{1,2})\s*(am|pm)?\b/i.exec(token);
      if (plain) {
        var pHour = parseInt(plain[1], 10);
        if (plain[2] && plain[2].toLowerCase() === "pm" && pHour < 12) pHour += 12;
        if (plain[2] && plain[2].toLowerCase() === "am" && pHour === 12) pHour = 0;
        if (!plain[2]) {
          if (/morning/.test(agentContext)) pHour = 10;
          else if (/afternoon/.test(agentContext)) pHour = 14;
          else if (/evening/.test(agentContext)) pHour = 17;
          else pHour = pHour < 9 ? pHour + 12 : pHour + 12;
        }
        return clampTimeSlot(pHour < 9 ? pHour + 12 : pHour, 0);
      }
      if (/after\s+\d{1,2}/i.test(token)) {
        flexible = "Flexible";
        var afterMatch = /after\s+(\d{1,2})/i.exec(token);
        if (afterMatch) {
          var afterHour = parseInt(afterMatch[1], 10);
          return clampTimeSlot(afterHour < 9 ? afterHour + 12 : afterHour, 0);
        }
      }
      if (/before\s+\d{1,2}/i.test(token)) {
        flexible = "Flexible";
        var beforeMatch = /before\s+(\d{1,2})/i.exec(token);
        if (beforeMatch) {
          var beforeHour = parseInt(beforeMatch[1], 10);
          return clampTimeSlot(beforeHour < 9 ? beforeHour + 12 : beforeHour, 0);
        }
      }
      if (/morning/.test(token)) return "10:00";
      if (/afternoon/.test(token)) return "14:00";
      if (/evening/.test(token)) return "17:00";
      return "";
    }

    function parseDate(token) {
      var numeric = /(\d{1,2})[\/\-](\d{1,2})/i.exec(token);
      if (numeric) return pad(parseInt(numeric[1], 10)) + "/" + pad(parseInt(numeric[2], 10));
      if (/today/i.test(token)) return todayStr;
      if (/tomorrow/i.test(token)) return tomorrowStr;
      var weekdayRe = /(this|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(token);
      if (weekdayRe) {
        var dayName = weekdayRe[2];
        var isNext = (weekdayRe[1] || "").toLowerCase() === "next";
        return findNextWeekdayDate(dayName, isNext ? 7 : 0);
      }
      return "";
    }

    raw.forEach(function (item) {
      var txt = item.text || "";
      var lower = txt.toLowerCase();
      if (!date) date = parseDate(lower);
      if (!time) time = parseTime(lower);
      if (!flexible && /flexible|any time/i.test(lower)) flexible = "Flexible";
    });

    if (!time) {
      var last = getLastTimeMention(raw);
      if (last) time = last;
    }

    if (!date && time && agentAskedToday) {
      date = todayStr;
    }

    var dateTime = "";
    if (date && time) dateTime = date + " " + time;
    else if (date) dateTime = date;
    else if (time) dateTime = time;

    return { date: date, time: time, flexible: flexible, dateTime: dateTime };
  }

  function clampTimeSlot(hour, minute) {
    var h = Math.min(Math.max(hour, 9), 18);
    var m = minute;
    if (m % 30 !== 0) m = Math.min(30, m + (30 - (m % 30)));
    if (m === 60) {
      h = Math.min(h + 1, 18);
      m = 0;
    }
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(h) + ":" + pad(m);
  }

  function findNextWeekdayDate(dayName, extraDays) {
    var today = new Date();
    var target = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(dayName.toLowerCase());
    var current = today.getDay();
    var diff = (target - current + 7) % 7;
    if (diff === 0) diff = 7;
    var offset = diff + (extraDays || 0);
    var next = new Date(today.getTime() + offset * 86400000);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(next.getDate()) + "/" + pad(next.getMonth() + 1);
  }

  function detectFinanceV3(raw) {
    var type = "";
    var deposit = "";
    var monthly = "";
    var mileage = "";

    raw.forEach(function (m) {
      var text = (m.text || "");
      var lower = text.toLowerCase();
      if (/(pcp|hp|pch|lease|finance)/i.test(text)) {
        if (/pcp/i.test(text)) type = "PCP";
        else if (/hp/i.test(text)) type = "HP";
        else if (/pch/i.test(text) || /lease/i.test(text)) type = "PCH";
        else type = "Finance";
      }
      var depMatch = /(?:deposit|dep)\s*£?(\d{2,6})/i.exec(text);
      if (depMatch) deposit = depMatch[1];
      var monthMatch = /£?(\d{2,4})\s*(pm|per month|monthly)/i.exec(text);
      if (monthMatch) monthly = monthMatch[1];
      var mileageMatch = /(\d{2,3}k|\d{4,6})\s*(miles|mi|pa)?/i.exec(text);
      if (mileageMatch) mileage = mileageMatch[1].toLowerCase().replace("k", "000");
    });

    if (!type && !deposit && !monthly && !mileage) return "";
    var parts = [type || "Finance"];
    if (deposit) parts.push("Deposit: £" + deposit);
    if (monthly) parts.push("Monthly: £" + monthly);
    if (mileage) parts.push("Mileage PA: " + mileage);
    return parts.join(" | ");
  }

  function detectPreferencesV4(raw) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var prefs = [];
    var fuels = ["petrol", "diesel", "hybrid", "electric", "ev"];
    fuels.forEach(function (f) {
      if (combined.indexOf(f) !== -1) {
        var label = f === "ev" ? "Fuel: electric" : "Fuel: " + f;
        if (prefs.indexOf(label) === -1) prefs.push(label);
      }
    });

    if (combined.indexOf("automatic") !== -1 || combined.indexOf("auto gearbox") !== -1) prefs.push("Transmission: automatic");
    if (combined.indexOf("manual") !== -1) prefs.push("Transmission: manual");

    var budgetMatch = /£\s?(\d{2,3}(?:[,\s]?\d{3})?)(?:\s?k)?\s*(?:budget|spend|price|max)/i.exec(combined);
    if (budgetMatch) {
      var val = budgetMatch[1].replace(/\D/g, "");
      if (/k/i.test(budgetMatch[0]) && val.length <= 3) val += "000";
      prefs.push("Budget: £" + val);
    }

    var useCases = [
      { key: "Use-case: family", terms: ["family", "kids"] },
      { key: "Use-case: space", terms: ["boot", "luggage", "space"] },
      { key: "Use-case: luggage", terms: ["suitcase", "bags"] }
    ];
    useCases.forEach(function (u) {
      if (u.terms.some(function (term) { return combined.indexOf(term) !== -1; })) {
        if (prefs.indexOf(u.key) === -1) prefs.push(u.key);
      }
    });

    return prefs;
  }

  function detectCustomerRequestsV3(raw, agentMessages) {
    var requests = [];
    var resolvedFilters = /(what'?s your number|postcode|what time do you open|opening hours)/i;

    function isAnswered(text, idx) {
      var lower = (text || "").toLowerCase();
      var keywords = [
        "delivery", "deliver", "collection", "transfer", "finance", "pcp", "hp", "pch",
        "warranty", "service history", "mot", "documentation", "spec", "colour", "ulez",
        "video", "photo", "photos", "pictures", "urgent", "asap"
      ];
      var hit = keywords.find(function (k) { return lower.indexOf(k) !== -1; });
      if (!hit) return false;
      for (var i = 0; i < agentMessages.length; i++) {
        if (agentMessages[i].index <= idx) continue;
        if ((agentMessages[i].text || "").toLowerCase().indexOf(hit) !== -1) return true;
      }
      return false;
    }

    raw.forEach(function (item) {
      if (item.sender !== "customer") return;
      var text = item.text || "";
      var lower = text.toLowerCase();
      if (resolvedFilters.test(text)) return;
      if (/^(yes|no|ok|thanks|thank you)\b/i.test(text)) return;
      if (!/(delivery|deliver|collection|transfer|finance|pcp|hp|pch|deposit|monthly|warranty|service history|mot|documentation|spec|colour|ulez|urgent|asap|video|photo|photos|pictures|similar to)/i.test(text)) {
        return;
      }
      if (isAnswered(text, item.index)) return;
      text.split(/[.!?]\s+/).forEach(function (segment) {
        var trimmed = segment.trim();
        if (!trimmed) return;
        if (requests.indexOf(trimmed) === -1) requests.push(trimmed);
      });
    });

    return requests;
  }

  function detectIntentV9(raw, data, pxAskIndex) {
    var intents = [];
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var bookingSignal = data.dateTime || /book|appointment|test drive|viewing|view/.test(combined);
    var financeSignal = raw.some(function (m) {
      if (m.sender !== "customer") return false;
      return /finance|pcp|hp|pch|monthly|deposit/.test((m.text || "").toLowerCase());
    });
    if (bookingSignal) intents.push("booking request");
    if (financeSignal) intents.push("finance discussion");
    if (/motability/.test(combined)) intents.push("motability discussion");
    if (/delivery|collect|collection/.test(combined)) intents.push("delivery enquiry");
    if (/compare|versus|vs|another model/.test(combined)) intents.push("compare models");
    if (/px only|sell.*px|part exchange only/.test(combined)) intents.push("PX-only enquiry");
    if (/cancel/.test(combined)) intents.push("cancellation request");
    return intents.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
  }

  function detectFlagsV10(raw, data, pxAskIndex) {
    var flags = [];
    function add(label, priority) {
      if (!flags.some(function (f) { return f.label === label; })) {
        flags.push({ label: label, priority: priority });
      }
    }

    if (pxAskIndex >= 0 && !data.pxReg) add("Missing PX details", 1);
    if (!data.fullName) add("Missing customer name", 2);
    if (data.firstName && !data.lastName && (pxAskIndex >= 0 || data.bookingType)) add("Missing surname", 3);
    raw.forEach(function (item) {
      var lower = (item.text || "").toLowerCase();
      if (/asap|urgent|soon|right away|straight away/.test(lower)) {
        add("Customer urgency", 2);
      }
    });

    var modelMentions = raw.filter(function (item) {
      return detectKnownModelOnly(item.text || "") || detectBrandAndModel(item.text || "");
    });
    if (modelMentions.length > 1) add("Ambiguous vehicle of interest", 4);

    flags.sort(function (a, b) { return a.priority - b.priority; });
    return flags.slice(0, 3).map(function (f) { return f.label; });
  }

  function buildPxSummary(data) {
    var out = [];
    if (data.pxReg) out.push("Reg: " + data.pxReg);
    if (data.pxMake || data.pxModel) {
      out.push("Model: " + (data.pxMake ? data.pxMake + " " : "") + (data.pxModel || ""));
    }
    if (data.pxMileage) out.push("Miles: " + data.pxMileage);
    if (!out.length) return "No PX";
    return out.join(" | ");
  }

  function toTitleCase(str) {
    return str
      .split(/\s+/)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  }

  function renderV2() {
    if (Date.now() - LAST_RENDER < 500) return;
    var messagesObj = collectMessages();
    var data = parseMessages(messagesObj);
    window._lpSumMini.data = data;

    var override = getBookingOverride();
    if (override && override !== "auto-detect") {
      if (override === "notes only") {
        data.bookingType = "";
        data.date = "";
        data.time = "";
        data.dateTime = "";
        data.flexible = "";
      } else if (override === "online store") {
        data.bookingType = "Online Store";
      } else {
        data.bookingType = toTitleCase(override);
      }
    }

    updateDebugOverlay(messagesObj);

    if (/@/.test(data.fullName || "")) {
      data.fullName = "";
      data.firstName = "";
      data.lastName = "";
    }
    if (data.pxReg && data.phone && data.pxReg === data.phone) data.pxReg = "";
    if (data.dateTime && !/^\d{2}\/\d{2}(\s+\d{2}:\d{2})?$/.test(data.dateTime)) {
      data.date = "";
      data.time = "";
      data.dateTime = "";
      data.flexible = "";
    }

    var rows = document.querySelectorAll('.lpSumMiniRow[data-key]');
    rows.forEach(function (row) {
      var key = row.dataset.key;
      var value = data[key] || "";

      if (key === "fullName" && value === "" && data.firstName) {
        value = data.firstName + (data.lastName ? " " + data.lastName : "");
      }
      if (key === "dateTime" && !value) {
        var parts = [];
        if (data.date) parts.push(data.date);
        if (data.time) parts.push(data.time);
        if (data.flexible) parts.push(data.flexible);
        value = parts.join(" ").trim();
      }
      if (key === "vehicle") {
        if (data.vehicle === "" && data.make === "" && data.model === "" && data.reg === "" && data.placeholderVOI) {
          value = data.placeholderVOI;
        }
        if (data.make || data.model) {
          if (data.reg) value = (data.make + " " + data.model + " (" + data.reg + ")").trim();
          else value = (data.make + " " + data.model).trim();
        }
      }
      if (key === "pxSummary") value = data.pxSummary;
      if (key === "customerRequests") {
        value = Array.isArray(data.customerRequests) ? data.customerRequests.join(" • ") : "";
      }

      var valueEl = row.querySelector(".lpSumMiniValue");
      if (valueEl) valueEl.textContent = value;
    });

    var overrideSelect = window._lpSumMini.bookingOverrideSelect;
    if (overrideSelect) {
      overrideSelect.value = getBookingOverride();
    }
  }

  function scheduleRender() {
    if (window._lpSumMini._renderTimeout) {
      clearTimeout(window._lpSumMini._renderTimeout);
    }
    window._lpSumMini._renderTimeout = setTimeout(renderV2, 120);
  }

  window._lpSumMini_forceRender = renderV2;
  window._lpSumMini_setBookingType = function (type) {
    setBookingOverride(type);
  };

  function initObserver() {
    if (app.observer) return;
    app.observer = new MutationObserver(function () {
      if (OBSERVER_DEBOUNCE) clearTimeout(OBSERVER_DEBOUNCE);
      OBSERVER_DEBOUNCE = setTimeout(function () {
        scheduleRender();
      }, OBSERVER_DELAY);
    });
    app.observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete") {
    createUI();
    renderV2();
    initObserver();
  } else {
    window.addEventListener(
      "load",
      function () {
        createUI();
        renderV2();
        initObserver();
      },
      { once: true }
    );
  }
})();
