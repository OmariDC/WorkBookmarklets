(function () {
  if (window._lpSumMini) return;

  let RENDER_LOCK = false;
  let LAST_RENDER = 0;
  const MIN_RENDER_GAP = 250; // milliseconds
  let RENDER_SCHEDULED = false;
  let OBSERVER_DEBOUNCE = null;
  const OBSERVER_DELAY = 350;
  let _cache_message_nodes = null;
  let _cache_message_nodes_time = 0;
  const CACHE_LIFETIME = 300; // milliseconds
  let MESSAGE_BUFFER = [];
  let LAST_NODE_COUNT = 0;

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
    enableSummaryCopyAll();
  }

  function enableSummaryCopyAll() {
    var panel = document.getElementById(app.panelId);
    if (!panel) return;

    var headings = panel.querySelectorAll(".lpSumMiniSection h3");
    var summaryHeading = null;
    headings.forEach(function (h) {
      if (h.textContent.trim().toLowerCase() === "summary") summaryHeading = h;
    });
    if (!summaryHeading) return;

    summaryHeading.style.cursor = "pointer";

    summaryHeading.addEventListener("click", function (ev) {
      ev.stopPropagation();

      var section = summaryHeading.parentElement;
      var rows = section.querySelectorAll('.lpSumMiniRow[data-key]');

      var out = [];
      rows.forEach(function (row) {
        var key = row.dataset.key;
        if (!key || key === "bookingTypeOverride") return;
        var label = row.querySelector(".lpSumMiniLabel").innerText.trim();
        var value = row.querySelector(".lpSumMiniValue").innerText.trim();
        out.push(label + ": " + (value || ""));
      });

      var finalText = out.join("\n");

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(finalText).then(showCopied);
      } else {
        var t = document.createElement("textarea");
        t.value = finalText;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        t.remove();
        showCopied();
      }
    });
  }

  function updateDebugOverlay(messagesObj) {
    if (!DEBUG_OVERLAY_ENABLED) {
      if (app.debugOverlay) {
        app.debugOverlay.style.display = "none";
      }
      return;
    }

    if (!messagesObj || !messagesObj.list) return;

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

    var totalMessages = messagesObj.list.length;
    var agentMessages = messagesObj.list.filter(function (txt) {
      return txt.indexOf("__AGENT__:") === 0;
    }).length;
    var customerMessages = totalMessages - agentMessages;
    var combinedLength = (messagesObj.combined || "").length;
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
    safeRender(render);
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

  function showCopied() {
    if (!app.badge) return;
    app.badge.classList.add("show");
    setTimeout(function () {
      app.badge.classList.remove("show");
    }, 1000);
  }

  function collectMessages() {
    const now = Date.now();
    if (_cache_message_nodes && now - _cache_message_nodes_time < CACHE_LIFETIME) {
      return _cache_message_nodes;
    }

    const containerSelectors = [
      ".html-content.text-content",
      "[data-testid=\"agent-message\"]",
      "[data-testid=\"visitor-message\"]",
      "[data-testid=\"system-message\"]"
    ];

    var nodes = Array.from(document.querySelectorAll(containerSelectors.join(",")));

    var originatorSiblings = document.querySelectorAll("div + .originator");
    originatorSiblings.forEach(function (orig) {
      if (orig.previousElementSibling) {
        nodes.push(orig.previousElementSibling);
      }
    });

    var filteredNodes = nodes.filter(function (node) {
      return !(app.panel && app.panel.contains(node));
    });

    var list = [];

    filteredNodes.forEach(function (node) {
      var text = (node.innerText || "").trim();
      if (!text) return;
      if (!/[A-Za-z0-9]/.test(text)) return;
      if (text === "Hey") return;

      var sender = detectSenderFromDOM(node);
      var lower = text.toLowerCase();
      if (lower.indexOf("is typing") !== -1) return;
      if (lower.indexOf("automated") !== -1) return;
      if (lower.indexOf("connected to") !== -1) return;
      if (/^\d[:\s]*$/.test(text)) return;

      var normalised = normalizeMessageForTemplate(text);
      for (var i = 0; i < PREDEFINED_OS_CONFIRMATIONS.length; i++) {
        var normOs = normalizeMessageForTemplate(PREDEFINED_OS_CONFIRMATIONS[i]);
        var fwOs = normOs.split(" ").slice(0, 5).join(" ");
        if (levenshtein(normalised, normOs) < 8 || normalised.indexOf(fwOs) === 0) {
          list.push(sender === "agent" ? "__AGENT__:__PREDEFINED_OS__:" + text : "__PREDEFINED_OS__:" + text);
          return;
        }
      }

      for (var j = 0; j < PREDEFINED_CONTENT.length; j++) {
        var norm = normalizeMessageForTemplate(PREDEFINED_CONTENT[j]);
        var fw = norm.split(" ").slice(0, 5).join(" ");
        if (levenshtein(normalised, norm) < 8 || normalised.indexOf(fw) === 0) {
          list.push(sender === "agent" ? "__AGENT__:__PREDEFINED__:" + text : "__PREDEFINED__:" + text);
          return;
        }
      }

      if (sender === "agent") {
        list.push("__AGENT__:" + text);
      } else if (sender === "customer") {
        list.push(text);
      }
    });

    _cache_message_nodes = {
      list: list,
      combined: list.join(" ").trim()
    };
    _cache_message_nodes_time = Date.now();

    return _cache_message_nodes;
  }

  function detectSenderFromDOM(node) {
    try {
      var originatorEl = null;

      var next = node.nextElementSibling;
      if (next && next.classList.contains("originator")) {
        originatorEl = next;
      }

      if (!originatorEl) {
        var sibs = node.parentElement ? node.parentElement.querySelectorAll(".originator") : [];
        if (sibs.length === 1) originatorEl = sibs[0];
      }

      if (!originatorEl) {
        var fallback = node.closest("[data-testid], .message-container");
        if (fallback) originatorEl = fallback.querySelector(".originator");
      }

      var name = originatorEl ? (originatorEl.innerText || "").trim().toLowerCase() : "";
      if (name) {
        if (name === "omari") return "agent";
        if (name === "visitor") return "customer";
        if (name === "welcome message") return "system";
        if (name.indexOf("stellantis &you uk") !== -1) return "system";
        if (name.indexOf("sms") === 0) return "customer";
      }

      var bubbleText = (node.innerText || "").toLowerCase();
      if (bubbleText.indexOf("hello, you are speaking with omari") !== -1 || bubbleText.indexOf("hello, you're speaking with omari") !== -1) return "agent";

      return "customer";
    } catch (e) {
      return "customer";
    }
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
    var rawList = messagesObj.list || [];
    var entries = rawList.map(function (text, idx) {
      var isAgent = text.indexOf("__AGENT__:") === 0;
      var clean = isAgent ? text.replace("__AGENT__:", "") : text;

      var isPreOs = clean.indexOf("__PREDEFINED_OS__:") === 0;
      var isPre = clean.indexOf("__PREDEFINED__:") === 0;
      if (isPreOs) clean = clean.replace("__PREDEFINED_OS__:", "");
      else if (isPre) clean = clean.replace("__PREDEFINED__:", "");
      return {
        text: text,
        cleanText: clean,
        index: idx,
        isPredefined: isPre,
        isPredefinedOs: isPreOs,
        isAgent: isAgent
      };
    });

    var realEntries = entries.filter(function (e) { return !e.isPredefined && !e.isPredefinedOs; });
    var realMessages = realEntries.map(function (e) { return e.cleanText; });
    var combinedLower = (realMessages.join(" ") || "").toLowerCase();
    var combinedText = realMessages.join(" ");

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
      flags: "",
      _osEligible: false
    };

    if (!realMessages.length) {
      return data;
    }

    var nameMatch = findName(realMessages);
    if (nameMatch) {
      data.fullName = nameMatch.fullName;
      data.firstName = nameMatch.firstName;
      data.lastName = nameMatch.lastName;
      if (data.fullName) {
        data.fullName = autoCapName(data.fullName);
        data.firstName = autoCapName(data.firstName);
        data.lastName = autoCapName(data.lastName);
      }
    }

    var emailMatch = (combinedText || "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (emailMatch) {
      data.email = emailMatch[0].replace(/[.,;]+$/, "");
    }

    var phoneMatch = findPhone(realMessages);
    if (phoneMatch) {
      data.phone = phoneMatch;
    }

    var addressCandidate = "";
    for (var ai = 0; ai < realMessages.length; ai++) {
      var addrTxt = realMessages[ai];
      if (!addressCandidate && /\d/.test(addrTxt) && /(street|st\b|road|rd\b|avenue|ave\b|lane|ln\b|close|cl\b|drive|dr\b|house|flat)/i.test(addrTxt)) {
        addressCandidate = addrTxt.trim();
      }
    }
    if (addressCandidate && !data.address) {
      data.address = addressCandidate;
    }

    var postcodeInfo = findPostcode(realMessages);
    if (postcodeInfo) {
      data.postcode = postcodeInfo.postcode;
      var mergedAddress = data.address || "";
      if (postcodeInfo.addressPart) {
        mergedAddress = (mergedAddress ? mergedAddress + " " + postcodeInfo.addressPart : postcodeInfo.addressPart).trim();
      } else if (!mergedAddress) {
        mergedAddress = postcodeInfo.address;
      }
      var upperMerged = (mergedAddress || "").toUpperCase();
      if (postcodeInfo.postcode && upperMerged.indexOf(postcodeInfo.postcode) === -1) {
        mergedAddress = (mergedAddress + " " + postcodeInfo.postcode).trim();
      }
      if (!mergedAddress) mergedAddress = postcodeInfo.postcode;
      data.address = mergedAddress.trim();
    }

    var baseVehicle = "";
    var vehicleInfo = null;
    var vehicleInfoSource = "";

    var vehicleScope = entries.map(function (e) { return e.cleanText; });
    vehicleInfo = findVehicle(vehicleScope);
    if (vehicleInfo) vehicleInfoSource = "brand";
    if (!vehicleInfo) {
      var modelOnly = findModelOnly(vehicleScope);
      if (modelOnly) {
        vehicleInfo = modelOnly;
        vehicleInfoSource = "model-only";
      }
    }

    var agentVehicle = findAgentConfirmedVehicle(entries);
    if (agentVehicle && vehicleInfoSource !== "brand") {
      vehicleInfo = agentVehicle;
      vehicleInfoSource = "agent";
    }

    // --- PX FIX LOGIC ---
    var pxQuestionIdx = -1;
    var pxQuestionRe = /(part[- ]?exchange|px details|registration, make, model and mileage|vehicle to part)/i;

    entries.forEach(function (entry) {
      if (pxQuestionIdx === -1 && pxQuestionRe.test(entry.cleanText)) {
        // Only treat as a question if it is from agent or is phrased as request
        if (entry.isPredefined || /please|can you|could you|would you|provide/i.test(entry.cleanText)) {
          pxQuestionIdx = entry.index;
        }
      }
    });

    // Track all detected regs with message index
    var userRegEntries = [];
    realEntries.forEach(function (entry) {
      var regs = findRegs([entry.cleanText]);
      regs.forEach(function (r) {
        userRegEntries.push({ reg: r, index: entry.index });
      });
    });

    var mileageEntries = [];
    realEntries.forEach(function (entry) {
      var mileageVal = findMileage([entry.cleanText]);
      if (mileageVal) {
        mileageEntries.push({ mileage: mileageVal, index: entry.index });
      }
    });

    // Find PX reg AFTER PX question but allow valuation-first flows
    var pxRegEntry = null;
    userRegEntries.forEach(function (entry) {
      if (pxQuestionIdx >= 0 && entry.index > pxQuestionIdx) {
        pxRegEntry = entry;
      }
    });

    var PX_MODE = pxQuestionIdx >= 0 && !!pxRegEntry;

    if (!PX_MODE && userRegEntries.length && mileageEntries.length) {
      var pxKeywordPresent = realEntries.some(function (entry) {
        return /(\bpx\b|p\/x|part exchange|vehicle to part exchange|swap my car)/i.test(entry.cleanText);
      });

      var hasVehicleContext = !!vehicleInfo || !!baseVehicle;
      var nearReg = mileageEntries.some(function (m) {
        return userRegEntries.some(function (r) {
          return Math.abs(r.index - m.index) <= 2;
        });
      });

      if ((pxKeywordPresent || hasVehicleContext) && nearReg) {
        PX_MODE = true;
        data.pxReg = userRegEntries[userRegEntries.length - 1].reg;
      }
    }

    // Fix for corrected reg flows (e.g., AP22...)
    var correctionTriggered = entries.some(function (e) {
      return /cannot find|cannot see|please confirm the reg|confirm the registration/i.test(e.cleanText);
    });

    // Allocate reg + pxReg cleanly
    if (correctionTriggered && userRegEntries.length > 1) {
      data.reg = userRegEntries[userRegEntries.length - 1].reg;
      data.pxReg = "";
    } else {
      if (!PX_MODE) {
        if (!data.reg && userRegEntries.length) {
          data.reg = userRegEntries[userRegEntries.length - 1].reg;
        }
        data.pxReg = "";
      } else {
        if (pxRegEntry && pxRegEntry.reg !== data.reg) data.pxReg = pxRegEntry.reg;

        var enquiryEntry = null;
        for (var i = 0; i < userRegEntries.length; i++) {
          if (userRegEntries[i].index <= pxQuestionIdx) enquiryEntry = userRegEntries[i];
        }

        if (!data.reg && enquiryEntry) data.reg = enquiryEntry.reg;
        else if (!data.reg && userRegEntries.length) data.reg = userRegEntries[0].reg;
      }
    }

    // PX make/model extraction scoped to PX context only
    var pxContextRe = /(\bpx\b|p\/x|part exchange|vehicle to part exchange)/i;
    var pxContextEntries = realEntries.filter(function (entry) {
      return pxContextRe.test(entry.cleanText);
    });
    var pxAfterQuestionEntries = realEntries.filter(function (entry) {
      return pxQuestionIdx >= 0 && entry.index > pxQuestionIdx;
    });

    var pxVehicle = findVehicle(pxContextEntries.map(function (e) { return e.cleanText; }));
    if (!pxVehicle && pxAfterQuestionEntries.length) {
      pxVehicle = findVehicle(pxAfterQuestionEntries.map(function (e) { return e.cleanText; }));
    }

    if (pxVehicle) {
      data.pxMake = pxVehicle.make;
      data.pxModel = pxVehicle.model;
    }

    var pxMileage = "";
    var pxContextMessages = pxContextEntries.map(function (e) { return e.cleanText; });
    if (pxContextMessages.length) {
      pxMileage = findMileage(pxContextMessages);
    }

    if (!pxMileage && pxAfterQuestionEntries.length) {
      pxMileage = findMileage(pxAfterQuestionEntries.map(function (e) { return e.cleanText; }));
    }

    if (!pxMileage && pxRegEntry && mileageEntries.length) {
      var nearMileage = mileageEntries.find(function (m) { return Math.abs(m.index - pxRegEntry.index) <= 2; });
      if (nearMileage) {
        pxMileage = nearMileage.mileage;
      }
    }

    if (!pxMileage && data.pxReg) {
      pxMileage = findMileage(realMessages);
    }

    if (pxMileage) {
      data.pxMileage = pxMileage;
    }

    if (vehicleInfo) {
      data.make = vehicleInfo.make;
      data.model = vehicleInfo.model;
      data.trim = vehicleInfo.trim;
      baseVehicle = (vehicleInfo.make + " " + vehicleInfo.model).trim();
    } else if (data.make && data.model) {
      baseVehicle = (data.make + " " + data.model).trim();
    }

    if (data.reg && baseVehicle) {
      data.vehicle = baseVehicle + " (" + data.reg + ")";
    } else if (data.reg && !baseVehicle) {
      data.vehicle = data.reg;
    } else {
      data.vehicle = baseVehicle;
    }

    var bookingDetectedRaw = detectBookingType(combinedLower, data, entries, PX_MODE);
    if (bookingDetectedRaw === "motability") {
      data.newUsed = "motability";
      bookingDetectedRaw = "";
    }
    if (bookingDetectedRaw && bookingDetectedRaw.indexOf("os") === 0) {
      data.bookingType = formatBookingType(bookingDetectedRaw);
    }

    var override = getBookingOverride();
    var finalBooking = bookingDetectedRaw;

    if (override && override !== "auto-detect") {
      if (override === "online store") {
        if (data._osEligible) {
          finalBooking = "os phone call";
        } else if (!finalBooking) {
          finalBooking = bookingDetectedRaw;
        }
      } else {
        finalBooking = override;
      }
    }

    if (!finalBooking) {
      finalBooking = bookingDetectedRaw;
    }

    data.bookingType = formatBookingType(finalBooking);

    var resolvedStatus = detectNewUsed(combinedLower, data);
    if (resolvedStatus) {
      data.newUsed = resolvedStatus;
    }

    var dateInfo = detectDateTime(realMessages, entries);
    if (dateInfo) {
      data.date = dateInfo.date;
      data.time = dateInfo.time;
      data.flexible = dateInfo.flexible;
      data.dateTime = dateInfo.dateTime;
    }

    var preferences = detectPreferences(realMessages, combinedLower);
    if (preferences.length) {
      data.preferences = preferences.join(", ");
    }

    // --- Finance Extraction ---
    var financeWords = [
      "pcp",
      "p c p",
      "personal contract purchase",
      "hp",
      "h p",
      "hire purchase",
      "pch",
      "p c h",
      "personal contract hire",
      "lease",
      "leasing",
      "finance",
      "finance options"
    ];

    data.finance = "";

    var financeFound = financeWords.some(function (w) {
      return combinedLower.indexOf(w) !== -1;
    });
    if (financeFound) {
      var detectedType = "";

      if (containsAny(combinedLower, ["pcp", "p c p"])) detectedType = "PCP";
      else if (containsAny(combinedLower, ["hp", "h p"])) detectedType = "HP";
      else if (containsAny(combinedLower, ["pch", "p c h", "lease", "leasing"])) detectedType = "PCH";
      else detectedType = "Finance discussion";

      var depositMatch = combinedLower.match(/(?:deposit\s*£?|£)\s*(\d{2,5})/);
      var monthlyMatch = combinedLower.match(/£?\s?(\d{2,4})\s*(?:pm|p\/m|per month|a month|monthly)/);
      var mileageMatch = combinedLower.match(/(\d{1,3}(?:[ ,]?\d{3})|\d{2,3}\s*k)\s*(?:miles?|mi)?\s*(?:pa|per annum)?/i);

      var f = detectedType;
      if (depositMatch) f += " | Deposit: £" + depositMatch[1];
      if (monthlyMatch) f += " | Monthly: £" + monthlyMatch[1];
      if (mileageMatch) {
        var mileageVal = mileageMatch[1];
        if (/k$/i.test(mileageVal)) {
          mileageVal = String(parseInt(mileageVal, 10) * 1000);
        } else {
          mileageVal = mileageVal.replace(/\D/g, "");
        }
        f += " | Mileage PA: " + mileageVal;
      }

      data.finance = f;
    }

    var intentList = detectIntent(combinedLower).filter(function (v, idx, arr) {
      return arr.indexOf(v) === idx;
    });

    var extraFlagList = [];
    if (dateInfo && dateInfo.flags) extraFlagList = extraFlagList.concat(dateInfo.flags);
    if ((pxQuestionIdx >= 0 || pxKeywordPresent) && !data.pxReg) {
      extraFlagList.push("PX required before booking");
    }
    var flags = detectFlags(entries, extraFlagList, data);
    if (flags.length) {
      flags = flags.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
    }

    if (flags.some(function (f) { return /^Discuss (delivery|transfer) to /i.test(f); })) {
      intentList = intentList.filter(function (val) {
        return val !== "delivery enquiry" && val !== "delivery/collection";
      });
    }

    if (data.finance) {
      if (intentList.indexOf("finance discussion") === -1) intentList.push("finance discussion");
    }

    if (intentList.length) {
      data.intent = intentList.join(", ");
    }

    if (flags.length) {
      data.flags = flags.join(", ");
    }

    if (override === "notes only") {
      data.dateTime = "";
      data.date = "";
      data.time = "";
      data.flexible = "";
    }

    data.pxSummary = buildPxSummary(data);

    return data;
  }

  function findName(messages) {
    function buildName(str) {
      var trimmed = (str || "").trim().replace(/\s+/g, " ");
      if (!trimmed) return null;
      var parts = trimmed.split(/\s+/);
      return {
        fullName: trimmed,
        firstName: parts[0],
        lastName: parts.slice(1).join(" ")
      };
    }

    function cleanAfterPhrase(fragment) {
      var cutIdx = fragment.search(/[@\d]|[,.;!]/);
      if (cutIdx !== -1) fragment = fragment.slice(0, cutIdx);
      return fragment.trim();
    }

    var askRe = /(full name|confirm your name|may i take your name|could i have your full name|can i confirm your name)/i;
    var requestIdx = -1;

    for (var i = 0; i < messages.length; i++) {
      var txt = (messages[i] || "").trim();
      if (askRe.test(txt.toLowerCase())) requestIdx = i;
      var m = txt.match(/(?:my name is|i am|i'm|im|this is)\s+(.+)/i);
      if (m) {
        var candidate = cleanAfterPhrase(m[1]);
        if (candidate && /^[A-Za-z][A-Za-z\s\-']+$/.test(candidate)) {
          return buildName(candidate);
        }
      }
    }

    if (requestIdx >= 0 && requestIdx + 1 < messages.length) {
      var nextMsg = (messages[requestIdx + 1] || "").trim();
      var stripped = cleanAfterPhrase(nextMsg);
      if (stripped && /^[A-Za-z][A-Za-z\s\-']+$/.test(stripped)) {
        return buildName(stripped);
      }
    }

    var narrativeBlock = /(looking for|need sorted|good morning|good afternoon|good evening|away in|appointment|test drive|viewing|delivery|address|postcode|reg\b|registration)/i;
    var postcodeRe = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

    for (var j = 0; j < messages.length; j++) {
      var msg = (messages[j] || "").trim();
      if (!msg) continue;
      if (postcodeRe.test(msg)) continue;
      if (/\d/.test(msg)) continue;
      if (narrativeBlock.test(msg.toLowerCase())) continue;
      if (/make|model|trim|engine/i.test(msg)) continue;
      if (/address/i.test(msg)) continue;
      if (/good morning|good afternoon|good evening/i.test(msg.toLowerCase())) continue;
      if (/^[A-Za-z][A-Za-z\s\-']+$/.test(msg)) {
        return buildName(msg);
      }
    }

    return null;
  }

  function findPhone(list) {
    for (var i = 0; i < list.length; i++) {
      var txt = list[i];
      var matches = txt.match(/(\+44[\d\s]{9,12}|0[\d\s]{9,11})/g);
      if (!matches) continue;

      for (var j = 0; j < matches.length; j++) {
        var raw = matches[j].replace(/\s+/g, "");
        if (raw.indexOf("0044") === 0) continue;
        if (raw.indexOf("+44") === 0) {
          if (raw.charAt(3) !== "7") continue;
          raw = "0" + raw.slice(3);
        }
        if (raw.charAt(0) !== "0") continue;
        var normalized = raw.replace(/\D/g, "");
        if (normalized === "2008" || normalized === "3008" || normalized === "5008") continue;
        if (normalized.length >= 10 && normalized.length <= 11) {
          return normalized;
        }
      }
    }
    return "";
  }

  function findPostcode(messages) {
    var re = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
    for (var i = messages.length - 1; i >= 0; i--) {
      var txt = messages[i];
      var m = re.exec(txt);
      if (m) {
        var cleaned = m[1].replace(/\s+/g, "").toUpperCase();
        var postcode = cleaned.slice(0, cleaned.length - 3) + " " + cleaned.slice(-3);
        var upperTxt = txt.toUpperCase();
        var idx = upperTxt.indexOf(cleaned);
        var addressPart = "";
        if (idx > 0) {
          addressPart = txt.slice(0, idx).trim();
        }
        var combined = (addressPart + " " + postcode).trim();
        return { postcode: postcode, address: combined, addressPart: addressPart };
      }
    }
    return null;
  }

  function findRegs(messages) {
    var re = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/gi;
    var regs = [];
    messages.forEach(function (txt) {
      var m;
      while ((m = re.exec(txt))) {
        var reg = m[1].replace(/\s+/g, "").toUpperCase();
        if (regs.indexOf(reg) === -1) {
          regs.push(reg);
        }
      }
    });
    if (regs[1] === regs[0]) {
      regs[1] = "";
    }
    return regs;
  }

  function findMileage(messages) {
    var re = /(\d{1,3}(?:[\s,]\d{3})+|\d{4,}|\d+(?:\s?[kK]))/;
    for (var i = 0; i < messages.length; i++) {
      var m = re.exec(messages[i]);
      if (m) {
        var raw = m[1];
        if (/k$/i.test(raw)) {
          var num = parseFloat(raw.replace(/[^\d.]/g, "")) * 1000;
          return String(Math.round(num));
        }
        return raw.replace(/\D/g, "");
      }
    }
    return "";
  }

  function findVehicle(messages) {
    var brands = [
      "audi",
      "bmw",
      "ford",
      "vauxhall",
      "volkswagen",
      "vw",
      "mercedes",
      "mercedes-benz",
      "mercedes benz",
      "toyota",
      "nissan",
      "honda",
      "mazda",
      "hyundai",
      "kia",
      "volvo",
      "skoda",
      "seat",
      "renault",
      "peugeot",
      "citroen",
      "jaguar",
      "land rover",
      "range rover",
      "mini",
      "fiat",
      "tesla",
      "lexus",
      "suzuki",
      "subaru",
      "jeep",
      "dacia",
      "alfa romeo",
      "alfa-romeo",
      "abarth",
      "ds",
      "leapmotor"
    ];

    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      for (var b = 0; b < brands.length; b++) {
        var brand = brands[b];
        var brandPattern = brand.replace(/\s+/, "\\s+");
        var re = new RegExp("\\b" + brandPattern + "\\s+([a-z0-9][a-z0-9\-]*(?:\\s+[a-z0-9][a-z0-9\-]*)?)", "i");
        var m = re.exec(txt);
        if (m) {
          var make = toTitleCase(brand.replace(/-/g, " "));
          var model = m[1].trim();
          return {
            make: make,
            model: model,
            trim: "",
            vehicle: (make + " " + model).trim()
          };
        }
      }
    }
    return null;
  }

  function findModelOnly(messages) {
    var modelMap = [
      { pattern: /\b(mokka)\b/i, make: "Vauxhall" },
      { pattern: /\b(corsa)\b/i, make: "Vauxhall" },
      { pattern: /\b(astra)\b/i, make: "Vauxhall" },
      { pattern: /\b(grandland)\b/i, make: "Vauxhall" },
      { pattern: /\b(crossland)\b/i, make: "Vauxhall" },
      { pattern: /\b(combo|combo life)\b/i, make: "Vauxhall" },
      { pattern: /\b(c3 aircross|c3\b)\b/i, make: "Citroen" },
      { pattern: /\b(c4 x|c4\b|e-?c4)\b/i, make: "Citroen" },
      { pattern: /\b(c5 aircross|c5\s*x)\b/i, make: "Citroen" },
      { pattern: /\b(berlingo|e-?berlingo)\b/i, make: "Citroen" },
      { pattern: /\b(2008|e-?2008)\b/i, make: "Peugeot" },
      { pattern: /\b(208|e-?208)\b/i, make: "Peugeot" },
      { pattern: /\b(3008|308)\b/i, make: "Peugeot" },
      { pattern: /\b(408)\b/i, make: "Peugeot" },
      { pattern: /\b(508)\b/i, make: "Peugeot" },
      { pattern: /\b(5008)\b/i, make: "Peugeot" },
      { pattern: /\b(500x|500e|500)\b/i, make: "Fiat" },
      { pattern: /\b(panda)\b/i, make: "Fiat" },
      { pattern: /\b(tipo)\b/i, make: "Fiat" },
      { pattern: /\b(600|600e)\b/i, make: "Fiat" },
      { pattern: /\b(junior)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(tonale)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(giulia)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(stelvio)\b/i, make: "Alfa Romeo" },
      { pattern: /\b(595|695|500e)\b/i, make: "Abarth" },
      { pattern: /\b(ds3|ds 3)\b/i, make: "DS" },
      { pattern: /\b(ds4|ds 4)\b/i, make: "DS" },
      { pattern: /\b(ds7|ds 7)\b/i, make: "DS" },
      { pattern: /\b(ds9|ds 9)\b/i, make: "DS" },
      { pattern: /\b(avenger)\b/i, make: "Jeep" },
      { pattern: /\b(compass)\b/i, make: "Jeep" },
      { pattern: /\b(renegade)\b/i, make: "Jeep" },
      { pattern: /\b(c10)\b/i, make: "Leapmotor" },
      { pattern: /\b(b10)\b/i, make: "Leapmotor" }
    ];

    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      for (var j = 0; j < modelMap.length; j++) {
        var match = modelMap[j].pattern.exec(txt);
        if (match) {
          var modelName = match[1] || match[0];
          var makeName = modelMap[j].make;
          return {
            make: makeName,
            model: modelName,
            trim: "",
            vehicle: (makeName + " " + modelName).trim()
          };
        }
      }
    }

    return null;
  }

  function findAgentConfirmedVehicle(entries) {
    var agentMessages = entries
      .filter(function (e) { return e.isAgent; })
      .map(function (e) { return e.cleanText; });

    if (!agentMessages.length) return null;

    var fromBrand = findVehicle(agentMessages);
    if (fromBrand) return fromBrand;

    var fromModelOnly = findModelOnly(agentMessages);
    if (fromModelOnly) return fromModelOnly;

    return null;
  }

  function detectBookingType(text, data, entries, pxMode) {
    data._osEligible = false;
    if (!text) return "";

    var lower = text;
    var agentCombined = entries
      .filter(function (e) { return e.isAgent; })
      .map(function (e) { return e.cleanText.toLowerCase(); })
      .join(" ");
    var agentOsPhrases = [
      "stored at our central used stock centre",
      "stored at our central used stock center",
      "central stock",
      "moved once reserved",
      "reservation moves it to your chosen stellantis &you dealership",
      "reservation moves it to your chosen dealership",
      "up to 5-6 working days for click & collect",
      "click & collect from central",
      "delivered for you once intention to purchase is confirmed",
      "collection after purchase"
    ];

    function agentConfirmedOS() {
      return entries.some(function (entry) {
        var txt = entry.cleanText.toLowerCase();
        if (!entry.isAgent && !entry.isPredefinedOs) return false;
        return containsAny(txt, agentOsPhrases);
      });
    }

    var osVehicleConfirmed = agentConfirmedOS();
    var hasPx = !!data.pxReg;

    var wantsCall = containsAny(lower, ["arrange a call", "request contact", "call from", "schedule a call", "call me", "request a call"]) ||
      containsAny(agentCombined, ["arrange a call", "request contact", "call from", "schedule a call", "call me", "request a call"]);
    var wantsTestDrive = /test drive/.test(lower) || /test drive/.test(agentCombined);
    var wantsView = containsAny(lower, ["view", "come in", "look at the car", "in person", "face to face", "see someone"]) ||
      containsAny(agentCombined, ["view", "come in", "look at the car", "in person", "face to face", "see someone"]);
    var bookingIntentPresent = wantsCall || wantsTestDrive || wantsView;

    if (lower.indexOf("call appointment") !== -1) return "phone call";
    if (lower.indexOf("general appointment") !== -1) return "";

    var motabilityInText = /motability|mot scheme|motability scheme|disability allowance|\bpip\b|\bdla\b/.test(lower);
    var usedContext = data.reg || containsAny(lower, ["used", "pre-owned", "previous keeper"]);
    var osEligible = osVehicleConfirmed && hasPx && bookingIntentPresent && usedContext && !motabilityInText;
    data._osEligible = osEligible;

    // OS logic applies only if agent confirmed + PX exists and vehicle is used
    if (osEligible) {
      if (wantsTestDrive) return "os test drive";
      if (wantsView) return "os view";
      if (wantsCall) return "os phone call";
    }

    if (wantsCall) return "phone call";
    if (wantsView) return "view";
    if (wantsTestDrive) return "test drive";

    var valuationMention = /valuation|value my car|accurate valuation/i.test(lower);
    var virtualValuation = /virtual valuation|remote valuation/.test(lower);
    var distanceConcern = /far|not local|distance|travel|journey/i.test(lower);

    if (valuationMention && data.pxReg) {
      if (virtualValuation || distanceConcern) return "valuation call";
      return "valuation";
    }

    if (data.bookingType && data.bookingType.startsWith("Online Store")) {
      return data.bookingType.toLowerCase().replace("online store - ", "os ");
    }

    return "";
  }

  function formatBookingType(type) {
    if (!type) return "";

    // Online Store types always get the OS prefix
    if (type === "os phone call") {
      return "Online Store - Phone Call";
    }
    if (type === "os test drive") {
      return "Online Store - Test Drive";
    }
    if (type === "os view") {
      return "Online Store - View";
    }

    // Standard types remain unchanged
    switch (type) {
      case "phone call":
        return "Phone Call";
      case "test drive":
        return "Test Drive";
      case "view":
        return "View Appointment";
      case "valuation":
        return "Valuation";
      case "valuation call":
        return "Valuation Call";
      default:
        return type;
    }
  }

  function detectNewUsed(text, data) {
    var lower = text || "";

    if (data.newUsed === "motability") return "motability";
    if (/motability|mot scheme|motability scheme|disability allowance|\bpip\b|\bdla\b/.test(lower)) {
      return "motability";
    }

    if (data.reg) return "used";
    if (containsAny(lower, ["used", "pre-owned", "previous keeper"])) return "used";

    if (containsAny(lower, ["brand new", "new shape", "new model", "new "])) return "new";

    // Stellantis brands assumed NEW if no reg and no explicit used context
    var stellantisBrands = ["alfa romeo", "abarth", "citroen", "ds", "fiat", "jeep", "leapmotor", "peugeot", "vauxhall"];
    var isStellantis = false;
    for (var i = 0; i < stellantisBrands.length; i++) {
      if ((data.make || "").toLowerCase().indexOf(stellantisBrands[i]) !== -1) {
        isStellantis = true;
        break;
      }
    }

    if (isStellantis && !data.reg && !containsAny(lower, ["used", "pre-owned", "previous keeper"])) {
      return "new";
    }

    return "";
  }



  function detectDateTime(messages, entries) {
    var date = "";
    var time = "";
    var flexible = "";
    var extraFlags = [];

    var monthNames = "january february march april may june july august september october november december".split(" ");
    var monthPattern = monthNames.join("|");
    var weekdayPattern = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

    var now = new Date();

    function formatDate(d) {
      return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function nextWeekday(day) {
      var target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(day);
      var result = new Date();
      var diff = (target + 7 - result.getDay()) % 7;
      if (diff === 0) diff = 7;
      result.setDate(result.getDate() + diff);
      return formatDate(result);
    }

    function normalizeTime(val) {
      if (!val) return "";
      var lower = val.toLowerCase().trim();
      var match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      if (!match) return val;
      var hour = parseInt(match[1], 10);
      var mins = match[2] ? parseInt(match[2], 10) : 0;
      var mer = match[3];
      if (mer === "pm" && hour < 12) hour += 12;
      if (mer === "am" && hour === 12) hour = 0;
      return String(hour).padStart(2, "0") + ":" + String(mins).padStart(2, "0");
    }

    function parseDateTimeFromText(txt) {
      var lower = (txt || "").toLowerCase();
      var localDate = "";
      var localTime = "";
      var localFlexible = "";

      var m1 = lower.match(/\b(\d{1,2}\/\d{1,2})\b/);
      var m2 = lower.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(" + monthPattern + ")\\b"));
      var m3 = lower.match(new RegExp("\\b(" + monthPattern + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b"));
      var m4 = lower.match(new RegExp("\\b(this|next)\\s+(" + weekdayPattern + ")\\b"));
      var m5 = lower.match(/\b(today|tomorrow)\b/);

      if (m1) {
        var parts = m1[1].split("/");
        var day = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10);
        localDate = String(day).padStart(2, "0") + "/" + String(month).padStart(2, "0");
      } else if (m2) {
        var dayNum = parseInt(m2[1], 10);
        var monthIdx = monthNames.indexOf(m2[2]);
        if (monthIdx !== -1) {
          var dRef = new Date();
          dRef.setMonth(monthIdx);
          dRef.setDate(dayNum);
          localDate = formatDate(dRef);
        }
      } else if (m3) {
        var monthIdx2 = monthNames.indexOf(m3[1]);
        var dayNum2 = parseInt(m3[2], 10);
        if (monthIdx2 !== -1) {
          var dRef2 = new Date();
          dRef2.setMonth(monthIdx2);
          dRef2.setDate(dayNum2);
          localDate = formatDate(dRef2);
        }
      } else if (m4) {
        var d = new Date();
        var weekday = m4[2];
        if (m4[1] === "next") {
          d.setDate(d.getDate() + 7);
        }
        localDate = nextWeekday(weekday);
      } else if (m5) {
        var d2 = new Date();
        if (m5[1] === "tomorrow") d2.setDate(d2.getDate() + 1);
        localDate = formatDate(d2);
      }

      var t1 = lower.match(/\b(\d{1,2}:\d{2}\s?(?:am|pm)?)\b/);
      var t2 = lower.match(/\b(\d{1,2}\s?(?:am|pm))\b/);
      var t3 = lower.match(/\bhalf\s*3\b/);
      var range = lower.match(/between\s+(\d{1,2})\s*(?:and|to|-)\s*(\d{1,2})/);
      var afterTime = lower.match(/after\s+(\d{1,2})/);

      if (t1) localTime = t1[1];
      else if (t2) localTime = t2[1];
      else if (t3) localTime = "15:30";
      else if (range) {
        localTime = String(range[1]).padStart(2, "0") + ":00";
        localFlexible = range[0];
      }
      else if (afterTime) {
        localTime = String(afterTime[1]).padStart(2, "0") + ":00";
        localFlexible = afterTime[0];
      }
      else if (lower.indexOf("midday") !== -1) localTime = "12:00";
      else if (lower.indexOf("midnight") !== -1) localTime = "00:00";

      if (!localTime) {
        if (lower.indexOf("morning") !== -1) localTime = "10:00";
        else if (lower.indexOf("afternoon") !== -1) localTime = "14:00";
        else if (lower.indexOf("evening") !== -1) localTime = "17:00";
      }

      if (!localFlexible) {
        if (lower.indexOf("asap") !== -1) localFlexible = "asap";
        else if (lower.indexOf("anytime") !== -1) localFlexible = "anytime";
      }

      localTime = normalizeTime(localTime);

      return { date: localDate, time: localTime, flexible: localFlexible, flags: [] };
    }

    var locked = false;

    entries.forEach(function (entry) {
      if (locked) return;
      if (!entry.isAgent) return;
      var lower = entry.cleanText.toLowerCase();
      if (/booked in|that has been booked|confirmed for|we can do/.test(lower)) {
        var parsed = parseDateTimeFromText(entry.cleanText);
        if (parsed.date || parsed.time) {
          date = parsed.date;
          time = parsed.time;
          flexible = parsed.flexible;
          locked = true;
        }
      }
    });

    var ordered = entries.slice().sort(function (a, b) {
      if (a.isAgent === b.isAgent) return a.index - b.index;
      return a.isAgent ? -1 : 1;
    });

    ordered.forEach(function (entry) {
      if (locked) return;
      var parsed = parseDateTimeFromText(entry.cleanText);
      if (!parsed) return;
      if (!date && parsed.date) date = parsed.date;
      if (!time && parsed.time) time = parsed.time;
      if (!flexible && parsed.flexible) flexible = parsed.flexible;
    });

    if (date && !time) {
      var temp = new Date();
      temp.setHours(temp.getHours() + 2, 0, 0, 0);
      var minutes = temp.getMinutes();
      if (minutes >= 30) {
        temp.setHours(temp.getHours() + 1, 0, 0, 0);
      } else {
        temp.setMinutes(30, 0, 0);
      }
      var hour = temp.getHours();
      if (hour < 9) {
        hour = 9;
        extraFlags.push("outside-hours preference");
      }
      if (hour > 18) {
        hour = 18;
        extraFlags.push("outside-hours preference");
      }
      time = String(hour).padStart(2, "0") + ":" + (temp.getMinutes() === 0 ? "00" : String(temp.getMinutes()).padStart(2, "0"));
    }

    if (!date && time) {
      if (messages.some(function (t) { return /\btoday\b/i.test(t); })) {
        date = formatDate(new Date());
      } else if (messages.some(function (t) { return /\btomorrow\b/i.test(t); })) {
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        date = formatDate(tomorrow);
      } else {
        time = "";
      }
    }

    if (!date && !time && !flexible) return null;

    var dateTime = "";
    if (date && time) {
      dateTime = date + " " + time;
    } else if (date) {
      dateTime = date + (time ? " " + time : "");
    } else if (time) {
      dateTime = time;
    }

    return {
      date: date,
      time: time,
      flexible: flexible,
      dateTime: dateTime.trim(),
      flags: extraFlags
    };
  }
  function detectIntent(text) {
    var intents = [];
    var map = [
      { key: "finance", terms: ["finance", "pcp"] },
      { key: "negative equity", terms: ["negative equity"] },
      { key: "petrol preferred", terms: ["petrol preferred", "prefer petrol"] },
      { key: "extended test drive", terms: ["extended test drive", "longer drive"] },
      { key: "comparing models", terms: ["compare", "comparing", "versus"] },
      { key: "delivery/collection", terms: ["delivery", "collection", "deliver"] },
      { key: "information first", terms: ["information first", "know a few things", "questions first"] },
      { key: "distance concerns", terms: ["80 miles", "far away", "distance", "not local"] },
      { key: "vehicle confirmation questions", terms: ["confirm the vehicle", "vehicle confirmation", "is this the"] },
      { key: "delivery enquiry", terms: ["home delivery", "dealer to dealer", "delivery from", "moved to branch"] },
      { key: "cancellation request", terms: ["cancel my appointment", "cancel the booking", "cancel reservation", "no longer attending", "not coming"] },
      { key: "enquiry-only", terms: ["just looking", "enquiry only", "looking for information", "not ready to book"] },
      { key: "renewal", terms: ["renew", "swap in", "replacement in", "renewal"] },
      { key: "wants-options-before-booking", terms: ["options before booking", "quote before booking", "information before booking", "need options first"] }
    ];
    map.forEach(function (item) {
      if (containsAny(text, item.terms)) {
        intents.push(item.key);
      }
    });
    if (containsAny(text, ["warranty", "12 months", "14 day money back"])) intents.push("warranty clarification");
    if (containsAny(text, ["test a similar", "similar vehicle"])) intents.push("local test-drive alternative");
    if (containsAny(text, ["finance only if", "only if 0%", "0% apr"])) intents.push("finance deal dependent");
    if (containsAny(text, ["car spotless", "spotless"])) intents.push("PX condition note");
    if (containsAny(text, ["test drive after discussion", "after discussion", "after we speak"])) intents.push("test drive after discussion");
    if (containsAny(text, ["delivery/transfer", "transfer concerns"])) intents.push("delivery/transfer concerns");
    return intents;
  }

  function detectPreferences(messages, combinedLower) {
    var prefs = [];

    function addPref(val) {
      if (val && prefs.indexOf(val) === -1) {
        prefs.push(val);
      }
    }

    var fuelMap = [
      { key: "Fuel: petrol", terms: ["petrol"] },
      { key: "Fuel: diesel", terms: ["diesel"] },
      { key: "Fuel: hybrid", terms: ["hybrid"] },
      { key: "Fuel: electric", terms: ["electric", "ev"] }
    ];
    fuelMap.forEach(function (item) {
      if (containsAny(combinedLower, item.terms)) addPref(item.key);
    });

    if (containsAny(combinedLower, ["automatic", "auto gearbox"])) addPref("Transmission: automatic");
    if (containsAny(combinedLower, ["manual"])) addPref("Transmission: manual");

    var budget = combinedLower.match(/£?\s?(\d{2,3}(?:[,\s]?\d{3})?)(?:\s?k)?\s*(?:budget|spend|price|max)/);
    if (budget) {
      var val = budget[1].replace(/\D/g, "");
      if (combinedLower.indexOf("k") !== -1 && val.length <= 3) {
        val = String(parseInt(val, 10) * 1000);
      }
      addPref("Budget: £" + val);
    }

    var useCaseTerms = [
      { key: "Use: family", terms: ["family", "children", "kids"] },
      { key: "Use: space", terms: ["space", "boot", "luggage"] }
    ];
    useCaseTerms.forEach(function (item) {
      if (containsAny(combinedLower, item.terms)) addPref(item.key);
    });

    messages.forEach(function (msg) {
      var lower = (msg || "").toLowerCase();
      var mileagePref = lower.match(/\b(\d{1,2})k\s*miles?\b/);
      if (mileagePref) {
        addPref("Mileage pref: " + mileagePref[1] + "k");
      }
    });

    return prefs;
  }

  function detectFlags(entries, extraFlags, data) {
    var list = Array.isArray(entries) ? entries : [];
    var agentEntries = list.filter(function (e) { return e.isAgent; });
    var customerEntries = list.filter(function (e) { return !e.isAgent && !e.isPredefined && !e.isPredefinedOs; });
    var flags = [];

    function addFlag(label, priority) {
      if (!label) return;
      if (flags.some(function (f) { return f.label === label; })) return;
      flags.push({ label: label, priority: priority });
    }

    function agentResponded(keywords, afterIndex) {
      return agentEntries.some(function (entry) {
        if (entry.index <= afterIndex) return false;
        var lower = entry.cleanText.toLowerCase();
        var keywordHit = keywords.some(function (k) { return lower.indexOf(k) !== -1; });
        if (!keywordHit) return false;
        return /yes|confirm|available|arranged|booked|sorted|there is|we have|i have/.test(lower);
      });
    }

    var logisticTopics = [
      { keywords: ["parking"], unanswered: "Site to confirm parking", deferral: "Site to confirm parking" },
      { keywords: ["disabled access", "wheelchair", "accessibility"], unanswered: "Site to confirm accessibility", deferral: "Site to confirm accessibility" },
      { keywords: ["vehicle availability", "availability onsite", "car available", "vehicle available", "onsite"], unanswered: "Site to confirm vehicle availability", deferral: "Site to confirm vehicle availability" }
    ];

    var conditionalRe = /(only if|depending on|as long as|subject to)/i;
    customerEntries.forEach(function (entry) {
      var lower = entry.cleanText.toLowerCase();
      if (!conditionalRe.test(lower)) return;
      var topic = "";
      if (containsAny(lower, ["delivery", "collection", "deliver"])) topic = "delivery";
      else if (containsAny(lower, ["finance", "pcp", "hp", "0%", "0 percent"])) topic = "finance";
      else if (containsAny(lower, ["px", "p/x", "part exchange", "valuation", "value"])) topic = "px value";
      else if (containsAny(lower, ["family", "kids", "practical", "space"])) topic = "practicality";
      if (topic) addFlag("Decision dependent on " + topic, 1);
    });

    customerEntries.forEach(function (entry) {
      var lower = entry.cleanText.toLowerCase();
      if (/cancel/.test(lower) && containsAny(lower, ["appointment", "booking", "reservation", "test drive", "view"])) {
        addFlag("Cancellation request", 1);
      }
    });

    customerEntries.forEach(function (entry) {
      var txt = entry.cleanText || "";
      var lower = txt.toLowerCase();
      if (/\burgent\b|\basap\b|as soon as possible/.test(lower)) {
        addFlag("Customer urgency", 2);
      }
      var hasPartner = /(partner|wife|husband)\b/.test(lower);
      var hasFamily = /(son|daughter|child|children|kid)\b/.test(lower);
      var attendanceHint = /(attend|come|coming|be there|join)/.test(lower);
      var conditionalHint = /(only if|depending on|as long as|subject to|if they can|if (?:he|she|they) can)/.test(lower);
      var practicalityHint = containsAny(lower, ["practical", "practicality", "space", "fit", "assess"]);

      if (hasPartner && conditionalHint) {
        addFlag("Attendance conditional on partner availability", 1);
      } else if (hasPartner && attendanceHint) {
        addFlag("Customer attending with partner", 2);
      } else if (hasFamily && conditionalHint) {
        addFlag("Attendance conditional on family availability", 1);
      } else if (hasFamily && attendanceHint && practicalityHint) {
        addFlag("Customer bringing children to assess practicality", 2);
      }
    });

    customerEntries.forEach(function (entry) {
      var lower = entry.cleanText.toLowerCase();
      var isQuestion = /\?/.test(entry.cleanText) || /(can|do|does|is|are|will|would|could|any)/.test(lower);
      if (!isQuestion) return;
      logisticTopics.forEach(function (topic) {
        var hit = topic.keywords.some(function (k) { return lower.indexOf(k) !== -1; });
        if (!hit) return;
        if (!agentResponded(topic.keywords, entry.index)) {
          addFlag(topic.unanswered, 2);
        }
      });
    });

    var deferralRe = /(sales team can confirm|they'll check|they will check|this can be discussed on the day|that will be confirmed onsite|i'll ask them|the team can|dealership can confirm|site can confirm)/i;
    agentEntries.forEach(function (entry) {
      var lower = entry.cleanText.toLowerCase();
      if (!deferralRe.test(lower)) return;
      var matchedTopic = null;
      for (var i = 0; i < logisticTopics.length; i++) {
        if (logisticTopics[i].keywords.some(function (k) { return lower.indexOf(k) !== -1; })) {
          matchedTopic = logisticTopics[i];
          break;
        }
      }
      if (matchedTopic) addFlag(matchedTopic.deferral, 3);
      else addFlag("Site to confirm delivery details", 3);
    });

    customerEntries.forEach(function (entry) {
      var txt = entry.cleanText || "";
      var lower = txt.toLowerCase();
      if (!containsAny(lower, ["delivery", "deliver", "transfer", "move the vehicle", "move vehicle"])) return;

      var locationMatch =
        txt.match(/(?:deliver|delivery|transfer|move)[^\n]*?\bto\b\s+([^.?\n]+)/i) ||
        txt.match(/\bto\b\s+([A-Za-z]{1,2}\d{1,2}[A-Za-z]?\s?\d[A-Za-z]{2})/i);

      var location = locationMatch ? locationMatch[1].trim().replace(/[.,;]+$/, "") : "";
      if (!location) return;
      if (agentResponded(["deliver", "delivery", "transfer", "move"], entry.index)) return;

      var labelPrefix = lower.indexOf("transfer") !== -1 ? "Discuss transfer to " : "Discuss delivery to ";
      addFlag(labelPrefix + location, 2);
    });

    if (Array.isArray(extraFlags)) {
      extraFlags.forEach(function (ef) {
        var label = String(ef || "").trim();
        if (!label) return;
        if (label.toLowerCase().indexOf("outside-hours") !== -1) return;
        addFlag(label, 4);
      });
    }

    if (data && data.fullName) {
      addFlag("Name confirmed", 3);
    }

    flags.sort(function (a, b) { return a.priority - b.priority; });
    flags = flags.slice(0, 3);
    return flags.map(function (f) { return f.label; });
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

  function containsAny(text, terms) {
    for (var i = 0; i < terms.length; i++) {
      if (text.indexOf(terms[i]) !== -1) return true;
    }
    return false;
  }

  function toTitleCase(str) {
    return str
      .split(/\s+/)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  }

  function render() {
    safeRender(function () {
      var messagesObj = collectMessages();
      app.data = parseMessages(messagesObj);

      updateDebugOverlay(messagesObj);

      if (app.bookingOverrideSelect) {
        app.bookingOverrideSelect.value = getBookingOverride();
      }

      var rows = app.panel ? app.panel.querySelectorAll('.lpSumMiniRow[data-key]') : [];
      rows.forEach(function (row) {
        var keyName = row.dataset.key;
        var value = app.data[keyName] || "";
        if (keyName === "pxSummary") value = app.data.pxSummary || "";
        if (keyName === "fullName" && !value && app.data.firstName) {
          value = app.data.firstName + (app.data.lastName ? " " + app.data.lastName : "");
        }
        if (keyName === "dateTime" && !value) {
          var parts = [];
          if (app.data.date) parts.push(app.data.date);
          if (app.data.time) parts.push(app.data.time);
          if (app.data.flexible) parts.push(app.data.flexible);
          value = parts.join(" ").trim();
        }
        row._valueEl.textContent = value;
      });
    });
  }

  window._lpSumMini_forceRender = function () {
    safeRender(render);
  };
  window._lpSumMini_setBookingType = function (type) {
    setBookingOverride(type);
  };

  function initObserver() {
    if (app.observer) return;
    app.observer = new MutationObserver(function () {
      if (OBSERVER_DEBOUNCE) clearTimeout(OBSERVER_DEBOUNCE);
      OBSERVER_DEBOUNCE = setTimeout(function () {
        safeRender(render);
      }, OBSERVER_DELAY);
    });
    app.observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete") {
    createUI();
    safeRender(render);
    initObserver();
  } else {
    window.addEventListener(
      "load",
      function () {
        createUI();
        safeRender(render);
        initObserver();
      },
      { once: true }
    );
  }
})();
