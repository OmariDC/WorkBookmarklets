(function () {
  if (window._lpSumMini) return;

  let RENDER_LOCK = false;
  let LAST_RENDER = 0;
  const MIN_RENDER_GAP = 300; // milliseconds
  let RENDER_SCHEDULED = false;
  let OBSERVER_DEBOUNCE = null;
  const OBSERVER_DELAY = 500;

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

  // Ensure levenshtein exists for predefined filter
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
      var rows = heading.parentElement.querySelectorAll('.lpSumMiniRow[data-key]');
      var data = window._lpSumMini.data || {};

      var output = "Summary\n------------------\n";
      rows.forEach(function (row) {
        var label = row.querySelector(".lpSumMiniLabel").textContent.trim();
        var key = row.dataset.key;
        if (!key || key === "bookingTypeOverride") return;
        var val = data[key] || "";
        if (key === "dateTime" && !val) {
          var parts = [];
          if (data.date) parts.push(data.date);
          if (data.time) parts.push(data.time);
          if (data.flexible) parts.push(data.flexible);
          val = parts.join(" ").trim();
        }
        if (key === "pxSummary") {
          val = data.pxSummary || "";
        }
        output += label + ": " + val + "\n";
      });

      navigator.clipboard.writeText(output.trim()).then(showCopied);
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

    function isPredefined(text) {
      return PREDEFINED_CONTENT.indexOf(text) !== -1 || PREDEFINED_OS_CONFIRMATIONS.indexOf(text) !== -1;
    }

    function askedForFullName(message) {
      var lower = message.toLowerCase();
      return lower.indexOf("may i take your full name") !== -1 ||
        lower.indexOf("just to confirm, could i have your full name") !== -1 ||
        lower.indexOf("can i confirm your full name") !== -1;
    }

    nodes.forEach(function (node) {
      if (app.panel && app.panel.contains(node)) return;
      var text = (node.innerText || "").trim();
      if (!text) return;
      if (!/[A-Za-z0-9]/.test(text)) return;
      if (node.closest(".chips-item")) return;
      if (isPredefined(text)) return;

      // Try to get explicit originator div
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

      // 1. Explicit labels
      if (origin === "omari") sender = "agent";
      else if (origin === "visitor") sender = "customer";
      else if (origin === "welcome message") sender = "system";
      else if (origin.indexOf("stellantis &you uk") !== -1) sender = "system";
      else if (origin.startsWith("sms")) sender = "customer";

      // 2. No originator → infer
      if (!origin) {
        if (/^welcome!|^you are now connected/.test(lowerText)) sender = "system";
        else if (/^hello, you are speaking with omari/.test(lowerText)) sender = "agent";
        else if (raw.length === 0) sender = "customer"; // first customer message
      }

      // 3. If the previous message was agent asking for name → next must be customer
      function askedName(msg) {
        return msg.sender === "agent" && /may i take your full name|just to confirm.*full name|can i confirm your full name/.test(
          (msg.text || "").toLowerCase()
        );
      }
      if (raw.length > 0 && askedName(raw[raw.length - 1])) sender = "customer";

      // Block predefined content
      if (isPredefined(text)) return;

      if (/^hey$/i.test(text) && origin === "welcome message") return;

      var currentIndex = messageIndex++;
      raw.push({ sender, text, index: currentIndex });
      if (sender === "customer") cleanCustomer.push(text);
      if (sender === "agent") cleanAgent.push(text);
    });

    return {
      raw: raw,
      cleanCustomer: cleanCustomer,
      cleanAgent: cleanAgent,
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
      finance: "",
      intent: "",
      preferences: "",
      flags: ""
    };

    var nameInfo = detectNameV3(customerMessages, agentMessages, raw);
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
    var regInfo = detectRegistrationsV3(raw, pxAskIndex);
    if (regInfo.reg) data.reg = regInfo.reg;
    if (regInfo.pxReg) data.pxReg = regInfo.pxReg;

    var pxInfo = detectPxDetails(raw, pxAskIndex, regInfo);
    if (pxInfo.pxReg) data.pxReg = data.pxReg || pxInfo.pxReg;
    if (pxInfo.pxMileage) data.pxMileage = pxInfo.pxMileage;
    if (pxInfo.pxMake) data.pxMake = pxInfo.pxMake;
    if (pxInfo.pxModel) data.pxModel = pxInfo.pxModel;

    var vehicleInfo = detectVehicleV4(customerMessages, agentMessages, regInfo.agentOverride);
    if (vehicleInfo) {
      data.make = vehicleInfo.make;
      data.model = vehicleInfo.model;
      data.trim = vehicleInfo.trim;
    }

    if (data.reg && data.make && data.model) {
      data.vehicle = (data.make + " " + data.model + " (" + data.reg + ")").trim();
    } else if (data.make && data.model) {
      data.vehicle = (data.make + " " + data.model).trim();
    } else if (data.reg) {
      data.vehicle = data.reg;
    }

    var newUsed = detectNewUsedV3(data, raw);
    if (newUsed) data.newUsed = newUsed;

    data.bookingType = detectBookingTypeV4(raw, data, agentMessages, customerMessages);

    var bookingOverride = typeof getBookingOverride === "function" ? getBookingOverride() : "auto-detect";
    if (bookingOverride && bookingOverride !== "auto-detect") {
      if (bookingOverride === "notes only") {
        data.bookingType = "";
        data.date = "";
        data.time = "";
        data.dateTime = "";
        data.flexible = "";
      } else {
        data.bookingType = toTitleCase(bookingOverride);
      }
    }

    var dateInfo = detectDateTimeV7(raw, agentMessages);
    if (dateInfo) {
      data.date = dateInfo.date;
      data.time = dateInfo.time;
      data.flexible = dateInfo.flexible;
      data.dateTime = dateInfo.dateTime;
    }

    var finance = detectFinanceV2(raw);
    if (finance) data.finance = finance;

    var preferences = detectPreferencesV4(raw);
    if (preferences.length) data.preferences = preferences.join(", ");

    var intents = detectIntentV6(raw);
    if (intents.length) data.intent = intents.join(", ");

    var flags = detectFlagsV6(raw, data, pxAskIndex);
    if (flags.length) data.flags = flags.join(", ");

    data.pxSummary = buildPxSummary(data);

    return data;
  }

  function detectNameV3(customerMessages, agentMessages, raw) {
    var askRegex = /(full name|confirm your name|your name please|could i have your name|can i confirm your full name|may i take your full name)/i;
    var selfIdRegex = /(?:my name is|this is|i am|i'm|im)\s+(.+)/i;

    function cleanNameCandidate(fragment) {
      if (!fragment) return "";
      var cut = fragment.split(/[@\d]|[,.;!]/)[0];
      return cut.trim();
    }

    function looksLikeName(str) {
      if (!str) return false;
      if (/\d/.test(str)) return false;
      if (/reg|registration|road|street|avenue|postcode|email|phone|mileage/i.test(str)) return false;
      var parts = str.split(/\s+/);
      if (!parts.length) return false;
      return parts.every(function (p) { return /^[A-Za-z][A-Za-z\-']*$/.test(p); });
    }

    function buildNameObject(candidate) {
      var tokens = candidate.split(/\s+/);
      return {
        fullName: autoCapName(candidate),
        firstName: autoCapName(tokens[0] || ""),
        lastName: autoCapName(tokens.slice(1).join(" "))
      };
    }

    for (var i = 0; i < customerMessages.length; i++) {
      var txt = (customerMessages[i].text || "").trim();
      var match = selfIdRegex.exec(txt);
      if (match) {
        var candidate = cleanNameCandidate(match[1]);
        if (looksLikeName(candidate)) return buildNameObject(candidate);
      }
    }

    var askIndex = -1;
    for (var a = 0; a < agentMessages.length; a++) {
      if (askRegex.test((agentMessages[a].text || "").toLowerCase())) {
        askIndex = agentMessages[a].index;
        break;
      }
    }

    if (askIndex >= 0) {
      for (var r = 0; r < raw.length; r++) {
        var item = raw[r];
        if (item.index <= askIndex || item.sender !== "customer") continue;
        var candidateText = cleanNameCandidate(item.text || "");
        if (looksLikeName(candidateText)) return buildNameObject(candidateText);
        break;
      }
    }

    for (var c = 0; c < customerMessages.length; c++) {
      var msg = (customerMessages[c].text || "").trim();
      if (looksLikeName(msg)) {
        return buildNameObject(msg);
      }
    }

    return null;
  }

  function detectEmail(customerMessages) {
    var emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    for (var i = 0; i < customerMessages.length; i++) {
      var match = emailRe.exec(customerMessages[i].text || "");
      if (match) return match[0];
    }
    return "";
  }

  function detectPhoneV2(customerMessages) {
    var phoneRe = /(\+44[\d\s]{9,12}|0[\d\s]{9,11})/g;
    for (var i = 0; i < customerMessages.length; i++) {
      var txt = customerMessages[i].text || "";
      var matches = txt.match(phoneRe);
      if (!matches) continue;
      for (var m = 0; m < matches.length; m++) {
        var raw = matches[m].replace(/\s+/g, "");
        if (/^(2008|3008|5008)$/.test(raw)) continue;
        if (raw.indexOf("+44") === 0) {
          if (raw.charAt(3) !== "7") continue;
          raw = "0" + raw.slice(3);
        }
        raw = raw.replace(/\D/g, "");
        if (raw.length >= 10 && raw.length <= 11 && raw.charAt(0) === "0") {
          return raw;
        }
      }
    }
    return "";
  }

  function detectAddressAndPostcode(customerMessages) {
    var postcodeRe = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;
    for (var i = 0; i < customerMessages.length; i++) {
      var txt = customerMessages[i].text || "";
      var match = postcodeRe.exec(txt);
      if (match) {
        var cleaned = match[1].replace(/\s+/g, "").toUpperCase();
        var postcode = cleaned.slice(0, cleaned.length - 3) + " " + cleaned.slice(-3);
        var address = txt.replace(match[1], postcode).trim();
        return { address: address, postcode: postcode };
      }
    }
    return null;
  }

  function detectPxRequestIndex(agentMessages) {
    var triggerRe = /(registration, make, model and mileage|registration make model and mileage|px\b|part exchange)/i;
    for (var i = 0; i < agentMessages.length; i++) {
      if (triggerRe.test(agentMessages[i].text || "")) return agentMessages[i].index;
    }
    return -1;
  }

  function detectRegistrationsV3(raw, pxAskIndex) {
    var regRe = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/gi;
    var regs = [];
    var agentOverride = null;

    raw.forEach(function (item) {
      var txt = item.text || "";
      var match;
      while ((match = regRe.exec(txt))) {
        var reg = match[1].replace(/\s+/g, "").toUpperCase();
        regs.push({ reg: reg, index: item.index, sender: item.sender, text: txt });
        if (item.sender === "agent") {
          agentOverride = item.index;
        }
      }
      if (item.sender === "agent" && /please confirm reg|confirm the reg|confirm reg/i.test(txt)) {
        agentOverride = item.index;
      }
    });

    var reg = "";
    var pxReg = "";

    if (agentOverride !== null && regs.length) {
      reg = regs[regs.length - 1].reg;
    } else if (regs.length) {
      reg = regs[0].reg;
    }

    if (pxAskIndex >= 0) {
      var after = regs.filter(function (r) { return r.index > pxAskIndex; });
      if (after.length) pxReg = after[after.length - 1].reg;
    }

    return { reg: reg, pxReg: pxReg, all: regs, agentOverride: agentOverride };
  }

  function detectMileageValue(text) {
    var mileRe = /(\d{1,3}(?:[,\s]\d{3})+|\d{4,}|\d+\s?k)/i;
    var match = mileRe.exec(text);
    if (!match) return "";
    var raw = match[1];
    var num = raw.replace(/[^\d]/g, "");
    if (/k/i.test(raw) && parseInt(num, 10) < 1000) {
      num = String(parseInt(num, 10) * 1000);
    }
    return num;
  }

  function detectPxDetails(raw, pxAskIndex, regInfo) {
    var pxReg = regInfo.pxReg || "";
    var pxMileage = "";
    var pxMake = "";
    var pxModel = "";
    var knownModel = null;

    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      if (pxAskIndex >= 0 && item.index <= pxAskIndex) continue;
      var text = item.text || "";
      var regMatch = text.match(/\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/i);
      var mileageMatch = detectMileageValue(text);
      var modelMatch = detectKnownModelOnly(text);

      if (regMatch && !pxReg) {
        pxReg = regMatch[1].replace(/\s+/g, "").toUpperCase();
      }
      if (mileageMatch && !pxMileage) pxMileage = mileageMatch;
      if (modelMatch && !pxModel) {
        pxModel = modelMatch.model;
        pxMake = modelMatch.make;
        knownModel = modelMatch;
      }

      if (regMatch && mileageMatch && modelMatch) {
        break;
      }
    }

    if (!pxReg && pxAskIndex >= 0 && regInfo.all.length > 1) {
      var afterAsk = regInfo.all.filter(function (r) { return r.index > pxAskIndex; });
      if (afterAsk.length) pxReg = afterAsk[afterAsk.length - 1].reg;
    }

    if (!pxMake && knownModel) pxMake = knownModel.make;

    return { pxReg: pxReg, pxMileage: pxMileage, pxMake: pxMake, pxModel: pxModel };
  }

  function detectVehicleV4(customerMessages, agentMessages, agentOverrideIndex) {
    var combined = customerMessages.concat(agentMessages);
    var vehicle = null;

    for (var i = 0; i < combined.length; i++) {
      var found = detectBrandAndModel(combined[i].text || "");
      if (found) {
        vehicle = found;
        break;
      }
    }

    if (!vehicle) {
      for (var j = 0; j < combined.length; j++) {
        var modelOnly = detectKnownModelOnly(combined[j].text || "");
        if (modelOnly) {
          vehicle = modelOnly;
          break;
        }
      }
    }

    if (agentOverrideIndex !== null) {
      for (var k = 0; k < agentMessages.length; k++) {
        if (agentMessages[k].index < agentOverrideIndex) continue;
        var overrideVehicle = detectBrandAndModel(agentMessages[k].text || "") || detectKnownModelOnly(agentMessages[k].text || "");
        if (overrideVehicle) {
          vehicle = overrideVehicle;
          break;
        }
      }
    }

    return vehicle;
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
              trim: trim ? toTitleCase(trim) : ""
            };
          }
        }
      }
    }

    return null;
  }

  function detectKnownModelOnly(text) {
    var modelMap = [
      { pattern: /\b(2008|e-?2008)\b/i, make: "Peugeot" },
      { pattern: /\b(208|e-?208)\b/i, make: "Peugeot" },
      { pattern: /\b(3008|308)\b/i, make: "Peugeot" },
      { pattern: /\b(408)\b/i, make: "Peugeot" },
      { pattern: /\b(508)\b/i, make: "Peugeot" },
      { pattern: /\b(5008)\b/i, make: "Peugeot" },
      { pattern: /\b(c1)\b/i, make: "Citroen" },
      { pattern: /\b(c3 aircross|c3\s*x)\b/i, make: "Citroen" },
      { pattern: /\b(c4 picasso|c4\b)\b/i, make: "Citroen" },
      { pattern: /\b(c4 x|c4\b|e-?c4)\b/i, make: "Citroen" },
      { pattern: /\b(c5 aircross|c5\s*x)\b/i, make: "Citroen" },
      { pattern: /\b(ds3|ds 3)\b/i, make: "DS" },
      { pattern: /\b(ds4|ds 4)\b/i, make: "DS" },
      { pattern: /\b(ds7|ds 7)\b/i, make: "DS" },
      { pattern: /\b(ds9|ds 9)\b/i, make: "DS" },
      { pattern: /\b(500x|500e|500)\b/i, make: "Fiat" },
      { pattern: /\b(panda)\b/i, make: "Fiat" },
      { pattern: /\b(tipo)\b/i, make: "Fiat" },
      { pattern: /\b(600|600e)\b/i, make: "Fiat" },
      { pattern: /\b(595|695|500e)\b/i, make: "Abarth" },
      { pattern: /\b(junior)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(tonale)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(giulia)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(stelvio)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(avenger)\b/i, make: "Jeep" },
      { pattern: /\b(compass)\b/i, make: "Jeep" },
      { pattern: /\b(renegade)\b/i, make: "Jeep" },
      { pattern: /\b(corsa)\b/i, make: "Vauxhall" },
      { pattern: /\b(mokka)\b/i, make: "Vauxhall" },
      { pattern: /\b(astra)\b/i, make: "Vauxhall" },
      { pattern: /\b(grandland)\b/i, make: "Vauxhall" },
      { pattern: /\b(c10)\b/i, make: "Leapmotor" },
      { pattern: /\b(b10)\b/i, make: "Leapmotor" }
    ];

    for (var i = 0; i < modelMap.length; i++) {
      var match = modelMap[i].pattern.exec(text || "");
      if (match) {
        var modelName = match[1] || match[0];
        return { make: modelMap[i].make, model: modelName, trim: "" };
      }
    }
    return null;
  }

  function detectNewUsedV3(data, raw) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    if (/motability|mot scheme|pip|dla/.test(combined)) return "motability";
    if (data.reg) return "used";
    if (combined.indexOf("used") !== -1 || combined.indexOf("pre-owned") !== -1) return "used";
    if ((data.make && /peugeot|citroen|ds|fiat|abarth|alfa romeo|jeep|vauxhall|leapmotor/i.test(data.make)) || /peugeot|citroen|ds|fiat|abarth|alfa romeo|jeep|vauxhall|leapmotor/.test(combined)) {
      return "new";
    }
    return "";
  }

  function detectBookingTypeV4(raw, data, agentMessages, customerMessages) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var hasMotability = combined.indexOf("motability") !== -1;
    if (hasMotability) return "Motability";

    var wantsTestDrive = combined.indexOf("test drive") !== -1;
    var wantsView = combined.indexOf("view") !== -1 || combined.indexOf("come in") !== -1;
    var wantsCall = combined.indexOf("call") !== -1 || combined.indexOf("phone") !== -1;
    var valuation = (data.pxReg || data.pxMileage) && combined.indexOf("valuation") !== -1;

    var baseBooking = "";
    if (wantsTestDrive) baseBooking = "Test Drive";
    else if (wantsView) baseBooking = "View Appointment";
    else if (wantsCall) baseBooking = "Phone Call";
    else if (valuation) baseBooking = "Valuation";

    var agentOsPhrases = PREDEFINED_OS_CONFIRMATIONS.map(function (p) { return p.toLowerCase(); }).concat([
      "central stock",
      "online store",
      "collection after purchase"
    ]);
    var agentCombined = agentMessages.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var agentOsConfirmed = agentOsPhrases.some(function (p) { return agentCombined.indexOf(p) !== -1; });
    var osEligible = agentOsConfirmed && data.pxReg && data.newUsed === "used" && (wantsCall || wantsTestDrive || wantsView);

    if (osEligible && baseBooking) {
      return "Online Store - " + baseBooking;
    }

    return baseBooking;
  }

  function detectDateTimeV7(raw, agentMessages) {
    var today = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    var todayStr = pad(today.getDate()) + "/" + pad(today.getMonth() + 1);
    var tomorrow = new Date(today.getTime() + 86400000);
    var tomorrowStr = pad(tomorrow.getDate()) + "/" + pad(tomorrow.getMonth() + 1);

    var date = "";
    var time = "";
    var flexible = "";
    var agentAskedToday = agentMessages.some(function (m) { return /today\??/i.test(m.text || ""); });

    function parseTime(token) {
      var half = /half\s*(\d{1,2})/i.exec(token);
      if (half) return clampTimeSlot(parseInt(half[1], 10), 30);
      var hm = /(\d{1,2})[:.](\d{2})/i.exec(token);
      if (hm) return clampTimeSlot(parseInt(hm[1], 10), parseInt(hm[2], 10));
      var mer = /(\d{1,2})\s*(am|pm)/i.exec(token);
      if (mer) {
        var h = parseInt(mer[1], 10);
        if (mer[2].toLowerCase() === "pm" && h < 12) h += 12;
        if (mer[2].toLowerCase() === "am" && h === 12) h = 0;
        return clampTimeSlot(h, 0);
      }
      var plain = /(^|\s)(\d{1,2})(\s|$)/.exec(token);
      if (plain) {
        var pHour = parseInt(plain[2], 10);
        return clampTimeSlot(pHour < 9 ? pHour + 12 : pHour, 0);
      }
      return "";
    }

    function parseDate(token) {
      var numeric = /(\d{1,2})[\/\-](\d{1,2})/i.exec(token);
      if (numeric) return pad(parseInt(numeric[1], 10)) + "/" + pad(parseInt(numeric[2], 10));
      if (/today/i.test(token)) return todayStr;
      if (/tomorrow/i.test(token)) return tomorrowStr;
      var monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
      var monthRe = /(\d{1,2})(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i.exec(token);
      if (monthRe) {
        var monthIdx = monthNames.indexOf(monthRe[3].toLowerCase());
        if (monthIdx >= 0) return pad(parseInt(monthRe[1], 10)) + "/" + pad(monthIdx + 1);
      }
      var weekdayRe = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(token);
      if (weekdayRe) return findNextWeekdayDate(weekdayRe[1]);
      return "";
    }

    raw.forEach(function (item) {
      var txt = item.text || "";
      var lower = txt.toLowerCase();
      if (!date) date = parseDate(lower);
      if (!time) time = parseTime(lower);
      if (!flexible && /flexible|any time/i.test(lower)) flexible = "Flexible";
    });

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

  function findNextWeekdayDate(dayName) {
    var today = new Date();
    var target = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(dayName.toLowerCase());
    var current = today.getDay();
    var diff = (target - current + 7) % 7;
    if (diff === 0) diff = 7;
    var next = new Date(today.getTime() + diff * 86400000);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(next.getDate()) + "/" + pad(next.getMonth() + 1);
  }

  function detectFinanceV2(raw) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var financeTerms = ["pcp", "p c p", "hp", "h p", "pch", "p c h", "lease", "leasing", "finance"];
    var hasFinance = financeTerms.some(function (t) { return combined.indexOf(t) !== -1; });
    if (!hasFinance) return "";

    var type = "";
    if (combined.indexOf("pcp") !== -1 || combined.indexOf("p c p") !== -1) type = "PCP";
    else if (combined.indexOf("hp") !== -1 || combined.indexOf("h p") !== -1) type = "HP";
    else if (combined.indexOf("pch") !== -1 || combined.indexOf("p c h") !== -1 || combined.indexOf("lease") !== -1) type = "PCH";
    else type = "Finance discussion";

    var depositMatch = /(?:deposit\s*£?|£)\s*(\d{2,5})/.exec(combined);
    var monthlyMatch = /£?\s?(\d{2,4})\s*(?:pm|p\/m|per month|a month|monthly)/.exec(combined);
    var mileageMatch = /(\d{1,3}(?:[ ,]?\d{3})|\d{2,3}\s*k)\s*(?:miles?|mi)?\s*(?:pa|per annum)?/i.exec(combined);

    var parts = [type];
    if (depositMatch) parts.push("Deposit: £" + depositMatch[1]);
    if (monthlyMatch) parts.push("Monthly: £" + monthlyMatch[1]);
    if (mileageMatch) {
      var mileageVal = mileageMatch[1];
      if (/k$/i.test(mileageVal)) mileageVal = String(parseInt(mileageVal, 10) * 1000);
      else mileageVal = mileageVal.replace(/\D/g, "");
      parts.push("Mileage PA: " + mileageVal);
    }

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

  function detectIntentV6(raw) {
    var combined = raw.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var intents = [];
    if (/finance/.test(combined) || /pcp|hp|lease|pch/.test(combined)) intents.push("finance discussion");
    if (/delivery|deliver|collection|collect/.test(combined)) intents.push("delivery enquiry");
    if (/warranty|guarantee/.test(combined)) intents.push("warranty clarification");
    if (/extended test drive|24 hour test/.test(combined)) intents.push("extended test drive");
    if (/similar vehicle|another vehicle/.test(combined)) intents.push("local test-drive alternative");
    if (/cancel/.test(combined)) intents.push("cancellation");
    return intents.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
  }

  function detectFlagsV6(raw, data, pxAskIndex) {
    var flags = [];
    function add(label, priority) {
      if (!flags.some(function (f) { return f.label === label; })) {
        flags.push({ label: label, priority: priority });
      }
    }

    if (data.fullName) add("Name confirmed", 1);
    if (pxAskIndex >= 0 && !data.pxReg) add("PX required before booking", 2);

    raw.forEach(function (item) {
      var lower = (item.text || "").toLowerCase();
      if (/[?]/.test(item.text || "") && (lower.indexOf("parking") !== -1 || lower.indexOf("accessibility") !== -1 || lower.indexOf("availability") !== -1)) {
        add("Unanswered logistical questions", 3);
      }
      if (/asap|urgent|soon|right away|straight away/.test(lower)) {
        add("Customer urgency", 2);
      }
      var deliveryMatch = /delivery to ([a-z\s]+)/i.exec(item.text || "");
      if (deliveryMatch) {
        add("Discuss delivery to " + autoCapName(deliveryMatch[1].trim()), 4);
      }
    });

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
    var messagesObj = collectMessages();
    var data = parseMessages(messagesObj);
    window._lpSumMini.data = data;

    updateDebugOverlay(messagesObj);

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
        if (data.make || data.model) {
          if (data.reg) value = (data.make + " " + data.model + " (" + data.reg + ")").trim();
          else value = (data.make + " " + data.model).trim();
        }
      }
      if (key === "pxSummary") value = data.pxSummary;

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
