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
    "You are connected to Stellantis &You UK.",
    "This chat may be recorded for quality and training purposes.",
    "We are connecting you to an agent.",
    "The agent is typing.",
    "Transferring you to another agent.",
    "Your chat has been transferred.",
    "Thanks for waiting, I will be with you shortly.",
    "We have received your message and will reply soon."
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
    const nodes = Array.from(
      document.querySelectorAll(".html-content.text-content, .content, .lp_message, .lpChatLine, .chatLine, .msg_text")
    );
    const raw = [];
    const cleanCustomer = [];
    const cleanAgent = [];
    let index = 0;

    function isExactPredefined(text) {
      return PREDEFINED_CONTENT.includes(text);
    }

    function isOsConfirmation(text) {
      var lower = (text || "").toLowerCase();
      return PREDEFINED_OS_CONFIRMATIONS.some(function (message) {
        return lower.indexOf(message.toLowerCase()) !== -1;
      });
    }

    nodes.forEach(node => {
      if (app.panel && app.panel.contains(node)) return;

      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      if (!/[A-Za-z0-9]/.test(text)) return;
      if (node.closest(".chips-item")) return;

      let originatorEl = null;

      // Look directly after node
      if (node.nextElementSibling && node.nextElementSibling.classList.contains("originator")) {
        originatorEl = node.nextElementSibling;
      }

      // Look inside container if needed
      if (!originatorEl && node.parentElement) {
        const ori = node.parentElement.querySelectorAll(".originator");
        if (ori.length === 1) originatorEl = ori[0];
      }

      let origin = originatorEl ? (originatorEl.innerText || "").trim() : "";
      let sender = "customer";

      if (origin === "Omari") sender = "agent";
      else if (origin === "Visitor") sender = "customer";
      else if (/^sms/i.test(origin)) sender = "customer";
      else if (/\+44|07\d{9}/.test(origin)) sender = "customer";

      if (!origin) {
        if (/(how can i help|how may i help|how can i assist|dealership|booking|test drive|viewing|appointment|we can|we are|i will|i can help|please provide|registration|make, model and mileage|can i take your|may i take your|could i take your|confirm your|provide your|reservation)/i.test(text)) {
          sender = "agent";
        } else {
          sender = "customer";
        }
      }

      if (isExactPredefined(text) || isOsConfirmation(text)) sender = "system";

      const msg = { sender, text, index: index++ };
      raw.push(msg);

      if (sender === "customer") cleanCustomer.push(text);
      if (sender === "agent") cleanAgent.push(text);
    });

    return {
      raw,
      cleanCustomer,
      cleanAgent
    };
  }

  function parseMessages(messagesObj) {
    var raw = (messagesObj && messagesObj.raw) || [];
    var parsingMessages = raw.filter(function (m) {
      return m.sender !== "system" && m.type !== "predefined-content";
    });
    var customerMessages = parsingMessages.filter(function (m) { return m.sender === "customer"; });
    var agentMessages = parsingMessages.filter(function (m) { return m.sender === "agent"; });
    var systemMessages = raw.filter(function (m) { return m.sender === "system"; });

    var data = {
      fullName: "",
      firstName: "",
      lastName: "",
      nameAfterPromptSingleOnly: false,
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
      customerRequests: []
    };

    var nameResult = detectCustomerName(customerMessages, agentMessages);
    if (nameResult) {
      data.fullName = nameResult.fullName;
      data.firstName = nameResult.firstName;
      data.lastName = nameResult.lastName;
      data.nameAfterPromptSingleOnly = nameResult.afterPromptSingleOnly;
    }

    var phoneResult = detectPhone(customerMessages, agentMessages);
    if (phoneResult) data.phone = phoneResult;

    var emailResult = detectEmail(customerMessages, agentMessages);
    if (emailResult) data.email = emailResult;

    var addressResult = detectAddress(customerMessages, agentMessages);
    if (addressResult) {
      data.address = addressResult.address;
      data.postcode = addressResult.postcode;
    }

    var pxResult = detectPX(customerMessages, agentMessages);
    if (pxResult) {
      data.pxReg = pxResult.pxReg || "";
      data.pxMake = pxResult.pxMake || "";
      data.pxModel = pxResult.pxModel || "";
      data.pxMileage = pxResult.pxMileage || "";
      data.pxSummary = pxResult.pxSummary || "";
    }

    var voiResult = detectVOI(customerMessages, agentMessages, pxResult);
    if (voiResult) {
      data.make = voiResult.make || "";
      data.model = voiResult.model || "";
      data.reg = voiResult.reg || "";
      if (voiResult.placeholder) data.vehicle = voiResult.placeholder;
    }

    if (!data.vehicle) {
      if (data.reg && data.make && data.model) {
        data.vehicle = (data.make + " " + data.model + " (" + data.reg + ")").trim();
      } else if (data.make || data.model) {
        data.vehicle = (data.make + " " + data.model).trim();
      } else if (data.reg) {
        data.vehicle = data.reg;
      }
    }

    var requests = detectCustomerRequests(customerMessages, agentMessages);
    data.customerRequests = requests;

    var intents = detectIntent(customerMessages, data);
    if (intents.length) data.intent = intents.join(", ");

    var dateInfo = detectDateTime(customerMessages, agentMessages);
    if (dateInfo) {
      data.date = dateInfo.date;
      data.time = dateInfo.time;
      data.dateTime = dateInfo.dateTime;
    }

    data.bookingType = detectBookingType(agentMessages, customerMessages, systemMessages);
    data.newUsed = detectNewUsed(customerMessages, data.reg);

    var flags = detectFlags(customerMessages, agentMessages, data, pxResult, voiResult);
    if (flags.length) data.flags = flags.join(", ");

    if (pxResult && !data.pxSummary) data.pxSummary = buildPxSummary(data);
    if (data.bookingType === "Online Store") data.newUsed = "Used";

    if (data.address && data.postcode) {
      data.address = data.address + ", " + data.postcode;
    } else if (data.address) {
      data.address = data.address.trim();
    } else if (data.postcode) {
      data.address = data.postcode;
    }

    return data;
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function toTitleCase(str) {
    return str
      .split(/\s+/)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function getBrandList() {
    return ["peugeot", "citroen", "citroën", "ds", "fiat", "abarth", "alfa romeo", "jeep", "vauxhall", "leapmotor"];
  }

  function getModelList() {
    return [
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
  }

  function extractReg(text) {
    var match = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/i.exec(text || "");
    if (!match) return "";
    return match[1].replace(/\s+/g, "").toUpperCase();
  }

  function isFinanceMessage(text) {
    return /(finance|pcp|hp|pch|deposit|monthly|apr|payment)/i.test(text || "");
  }

  function containsMileage(text) {
    return /(\b\d{2,3}\s?k\b|\b\d{4,6}\b).*?(miles|mi)/i.test(text || "");
  }

  function detectCustomerName(customerMessages, agentMessages) {
    var namePrompts = /(may i take your full name|just to confirm, could i have your full name|can i confirm your full name|could i take your name|may i take your name)/i;
    var selfId = /(my name is|this is|i am|i'm|im)\s+(.+)/i;
    var financeWords = /(finance|pcp|hp|pch|deposit|monthly|apr|payment)/i;
    var regRegex = /\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i;
    var greetings = ["hi", "hello", "hey", "ok", "okay", "asap", "thanks", "thank you", "cheers"];

    function isGreetingOnly(text) {
      var normalized = normalizeWhitespace(text).toLowerCase();
      return greetings.indexOf(normalized) !== -1;
    }

    function isNameCandidate(text, afterNamePrompt) {
      var cleaned = normalizeWhitespace(text).replace(/[0-9]/g, "");
      if (!cleaned) return "";
      if (isGreetingOnly(text)) return "";
      if (/@/.test(text)) return "";
      if (regRegex.test(text)) return "";
      if (financeWords.test(text)) return "";
      if (containsMileage(text)) return "";
      if (detectModelInText(text) && !afterNamePrompt) return "";
      var parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length < 1 || parts.length > 4) return "";
      if (!parts.every(function (p) { return /^[A-Za-z][A-Za-z\-']*$/.test(p); })) return "";
      return parts.map(toTitleCase).join(" ");
    }

    function getFirstNonEmptyLine(text) {
      return (text || "")
        .split(/\r?\n/)
        .map(function (line) { return line.trim(); })
        .find(function (line) { return line.length > 0; }) || "";
    }

    for (var j = 0; j < customerMessages.length; j++) {
      var text = customerMessages[j].text || "";
      if (customerMessages[j].sender === "system") continue;
      var match = selfId.exec(text);
      if (match) {
        var candidate = isNameCandidate(getFirstNonEmptyLine(match[2]), false);
        if (candidate) return buildNameParts(candidate, false);
      }
    }

    var promptIndex = -1;
    agentMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      if (namePrompts.test(msg.text || "")) promptIndex = msg.index;
    });

    if (promptIndex >= 0) {
      for (var i = 0; i < customerMessages.length; i++) {
        var msg = customerMessages[i];
        if (msg.sender === "system") continue;
        if (msg.index <= promptIndex) continue;
        var candidate = isNameCandidate(getFirstNonEmptyLine(msg.text || ""), true);
        if (!candidate) continue;
        return buildNameParts(candidate, candidate.split(/\s+/).length === 1);
      }
    }

    for (var k = 0; k < customerMessages.length; k++) {
      var signature = customerMessages[k].text || "";
      if (customerMessages[k].sender === "system") continue;
      var sigMatch = /(thanks|kind regards|regards|cheers),?\s*([A-Za-z\-' ]{2,40})$/i.exec(signature.trim());
      if (sigMatch) {
        var sigCandidate = isNameCandidate(sigMatch[2], false);
        if (sigCandidate) return buildNameParts(sigCandidate, false);
      }
    }

    return null;
  }

  function buildNameParts(fullName, afterPromptSingleOnly) {
    var parts = fullName.split(/\s+/).filter(Boolean);
    var firstName = parts[0] || "";
    var lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
    return {
      fullName: (firstName + (lastName ? " " + lastName : "")).trim(),
      firstName: firstName,
      lastName: lastName,
      afterPromptSingleOnly: !!afterPromptSingleOnly
    };
  }

  function detectPhone(customerMessages, agentMessages) {
    var phoneRequest = /(phone|contact number|mobile|telephone|call you)/i;
    var requestIndex = -1;
    agentMessages.forEach(function (msg) {
      if (phoneRequest.test(msg.text || "")) requestIndex = msg.index;
    });

    var phoneRegex = /\b(?:\+44\s?\d{2,4}|0\d{2,4})\s?\d{3,4}\s?\d{3,4}\b/;
    var latest = "";

    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      var text = msg.text || "";
      if (requestIndex >= 0 && msg.index <= requestIndex) return;
      if (/\bmiles\b|\bmi\b/i.test(text)) return;
      var match = phoneRegex.exec(text);
      if (!match) return;
      var cleaned = match[0].replace(/\D/g, "");
      if (cleaned.length < 9 || cleaned.length > 13) return;
      latest = cleaned;
    });

    if (latest) return latest;

    if (requestIndex < 0) {
      for (var i = 0; i < customerMessages.length; i++) {
        if (customerMessages[i].sender === "system") continue;
        var textFallback = customerMessages[i].text || "";
        if (/\bmiles\b|\bmi\b/i.test(textFallback)) continue;
        var matchFallback = phoneRegex.exec(textFallback);
        if (matchFallback) return matchFallback[0].replace(/\D/g, "");
      }
    }

    return "";
  }

  function detectEmail(customerMessages, agentMessages) {
    var emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    var emailRequest = /(email address|email)/i;
    var requestIndex = -1;
    agentMessages.forEach(function (msg) {
      if (emailRequest.test(msg.text || "")) requestIndex = msg.index;
    });

    var latestAfterRequest = "";
    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      var match = emailRegex.exec(msg.text || "");
      if (!match) return;
      if (requestIndex >= 0 && msg.index > requestIndex) {
        latestAfterRequest = match[0].toLowerCase();
      }
    });

    if (latestAfterRequest) return latestAfterRequest;

    if (requestIndex < 0) {
      for (var i = 0; i < customerMessages.length; i++) {
        if (customerMessages[i].sender === "system") continue;
        var match = emailRegex.exec(customerMessages[i].text || "");
        if (match) return match[0].toLowerCase();
      }
    }

    return "";
  }

  function detectAddress(customerMessages, agentMessages) {
    var postcodeRegex = /([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})/i;
    var addressTokens = /(road|rd|street|st|avenue|ave|lane|ln|drive|dr|close|cl|court|ct|place|pl|crescent|cres|way|terrace|ter|boulevard|blvd|park)/i;
    var addressRequest = /(address|postcode|post code|house number|street)/i;
    var blockWords = /(booking|branch|team|call|what time)/i;
    var requestIndex = -1;

    agentMessages.forEach(function (msg) {
      if (addressRequest.test(msg.text || "")) requestIndex = msg.index;
    });

    if (requestIndex < 0) return null;

    var parts = [];
    var postcode = "";

    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      if (msg.index <= requestIndex) return;
      var text = normalizeWhitespace(msg.text || "");
      if (!text) return;
      if (blockWords.test(text)) return;

      var postMatch = postcodeRegex.exec(text);
      var hasPostcode = false;
      if (postMatch) {
        postcode = (postMatch[1] + " " + postMatch[2]).toUpperCase();
        hasPostcode = true;
      }

      var hasHouseNumber = /\d+\s+\w+/.test(text) && addressTokens.test(text);
      if (text.split(/\s+/).length === 1 && !hasPostcode) return;

      if (hasPostcode || hasHouseNumber) {
        if (parts.indexOf(text) === -1) parts.push(text);
      }
    });

    var address = parts.join("\n");
    return address || postcode ? { address: address, postcode: postcode } : null;
  }

  function detectPX(customerMessages, agentMessages) {
    var pxPrompt = /(do you have a vehicle to part exchange|do you have a vehicle to part-exchange|please provide registration, make, model and mileage|can i please take the registration, make, model and mileage)/i;
    var requestIndex = -1;
    agentMessages.forEach(function (msg) {
      if (pxPrompt.test(msg.text || "")) requestIndex = msg.index;
    });

    if (requestIndex < 0) return null;

    var px = { pxReg: "", pxMake: "", pxModel: "", pxMileage: "", pxSummary: "" };
    var noPx = false;

    function isOsConfirmationText(text) {
      var lower = (text || "").toLowerCase();
      return PREDEFINED_OS_CONFIRMATIONS.some(function (message) {
        return lower.indexOf(message.toLowerCase()) !== -1;
      });
    }

    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      if (msg.index <= requestIndex) return;
      var text = msg.text || "";
      if (isOsConfirmationText(text)) return;
      if (noPx) return;
      if (/no px|no part exchange|don't have a px|dont have a px|no part-exchange/i.test(text)) {
        noPx = true;
        px = { pxReg: "", pxMake: "", pxModel: "", pxMileage: "", pxSummary: "No PX" };
        return;
      }
      if (/(that's wrong|actually ignore that reg|correction|ignore that reg)/i.test(text)) {
        px = { pxReg: "", pxMake: "", pxModel: "", pxMileage: "", pxSummary: "" };
        return;
      }
      if (isFinanceMessage(text)) return;

      var reg = extractReg(text);
      if (reg) px.pxReg = reg;

      var mileageMatch = /(\b\d{2,3}\s?k\b|\b\d{4,6}\b)/i.exec(text);
      if (mileageMatch) {
        var rawMiles = mileageMatch[0].toLowerCase().replace(/\s+/g, "");
        var digits = rawMiles.replace(/\D/g, "");
        if (digits.length === 10 || digits.length === 11) return;
        if (rawMiles.indexOf("k") !== -1) {
          rawMiles = String(parseInt(digits, 10) * 1000);
        } else {
          rawMiles = digits;
        }
        if (rawMiles.length >= 4 && rawMiles.length <= 6) px.pxMileage = rawMiles;
      }

      var vehicle = detectVehicleFromText(text);
      if (vehicle && !vehicle.placeholder) {
        px.pxMake = vehicle.make || px.pxMake;
        px.pxModel = vehicle.model || px.pxModel;
      }
    });

    if (noPx) return px;

    if (px.pxReg || px.pxMake || px.pxModel || px.pxMileage) {
      px.pxSummary = buildPxSummary({
        pxReg: px.pxReg,
        pxMake: px.pxMake,
        pxModel: px.pxModel,
        pxMileage: px.pxMileage
      });
    }

    return px;
  }

  function detectVOI(customerMessages, agentMessages, pxResult) {
    var pxReg = pxResult ? pxResult.pxReg : "";
    var pxModel = pxResult ? pxResult.pxModel : "";
    var pxMake = pxResult ? pxResult.pxMake : "";
    function isSelfIdentifyingVehicle(text) {
      return /\bmy\b/i.test(text || "") && !!detectVehicleFromText(text || "");
    }

    function isPxMessage(text) {
      return /(part exchange|part-exchange|px|my car|my vehicle)/i.test(text || "") || isSelfIdentifyingVehicle(text);
    }

    function isOsConfirmationText(text) {
      var lower = (text || "").toLowerCase();
      return PREDEFINED_OS_CONFIRMATIONS.some(function (message) {
        return lower.indexOf(message.toLowerCase()) !== -1;
      });
    }

    var voiRequest = /(which vehicle are you looking for|what vehicle are you interested in|what car are you interested in)/i;
    var voiRequestIndex = -1;
    agentMessages.forEach(function (msg) {
      if (voiRequest.test(msg.text || "")) voiRequestIndex = msg.index;
    });

    var agentConfirmed = null;
    agentMessages.forEach(function (msg) {
      if (voiRequestIndex >= 0 && msg.index <= voiRequestIndex) return;
      var text = msg.text || "";
      var reg = extractReg(text);
      var vehicle = detectVehicleFromText(text);
      if (reg || (vehicle && vehicle.model)) {
        agentConfirmed = {
          make: vehicle ? vehicle.make : "",
          model: vehicle ? vehicle.model : "",
          reg: reg || (vehicle ? vehicle.reg : "")
        };
      }
    });
    if (agentConfirmed) return agentConfirmed;

    var lastMake = "";
    var lastModel = "";
    var lastReg = "";
    var uniqueVehicles = [];

    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      var text = msg.text || "";
      if (voiRequestIndex >= 0 && msg.index <= voiRequestIndex) return;
      if (isOsConfirmationText(text)) return;
      if (isPxMessage(text)) return;
      if (isFinanceMessage(text)) return;

      var reg = extractReg(text);
      if (reg && reg !== pxReg) {
        lastReg = reg;
      }

      var vehicle = detectVehicleFromText(text);
      if (vehicle && vehicle.model) {
        lastMake = vehicle.make || lastMake;
        lastModel = vehicle.model || lastModel;
      }

      if (vehicle && vehicle.model) {
        var key = (vehicle.make || "") + "|" + (vehicle.model || "") + "|" + (reg || "");
        if (uniqueVehicles.indexOf(key) === -1) uniqueVehicles.push(key);
      }
    });

    if (lastReg && lastReg !== pxReg && lastMake && lastModel) {
      return { make: lastMake, model: lastModel, reg: lastReg };
    }

    if (lastMake || lastModel || lastReg) {
      if (!(lastMake === pxMake && lastModel === pxModel)) {
        return { make: lastMake, model: lastModel, reg: lastReg };
      }
    }

    return null;
  }

  function detectVehicleFromText(text) {
    var lower = (text || "").toLowerCase();
    var reg = extractReg(text);
    var models = getModelList();
    for (var i = 0; i < models.length; i++) {
      if (lower.indexOf(models[i].model.toLowerCase()) !== -1) {
        return { make: models[i].make, model: models[i].model, reg: reg };
      }
    }

    var brands = getBrandList();
    var tokens = lower.split(/\s+/);
    for (var b = 0; b < brands.length; b++) {
      var brand = brands[b];
      for (var t = 0; t < tokens.length; t++) {
        if (tokens[t] === brand || tokens[t].replace(/[^a-z]/g, "") === brand.replace(/\s+/g, "")) {
          var following = tokens.slice(t + 1, t + 3).filter(Boolean);
          if (following.length) {
            var model = following.join(" ");
            return { make: toTitleCase(brand), model: toTitleCase(model), reg: reg };
          }
        }
      }
    }

    return null;
  }

  function detectModelInText(text) {
    return !!detectVehicleFromText(text);
  }

  function detectCustomerRequests(customerMessages, agentMessages) {
    var requests = [];
    var keywordRegex = /(delivery|transfer|finance|deposit|monthly|warranty|service history|mot|colour|color|spec|photo|photos|picture|pictures|video|viewing|view|similar)/i;
    var initiativeRegex = /(\?|\bcan\b|\bcould\b|\bwould\b|\bwhat\b|\bwhen\b|\bwhere\b|\bhow\b|\bplease\b|\bneed\b|is it possible|are you able|do you know|looking for|any chance|do you\b|should i|can we|could we)/i;
    var greetings = /^(hi|hello|hey|ok|okay|thanks|thank you|cheers)$/i;
    var confirmationRegex = /^(yes|yep|yeah|ok|okay|perfect|that works|that's fine|sounds good|fine|works for me|no problem|sure)\b/i;
    var dateTimeOnlyRegex = /^(today|tomorrow|this (morning|afternoon|evening)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/-]\d{1,2}|\d{1,2}(:\d{2})?\s?(am|pm)?)$/i;
    var urgencyOnlyRegex = /\b(asap|urgent)\b/i;

    function isOsConfirmationText(text) {
      var lower = (text || "").toLowerCase();
      return PREDEFINED_OS_CONFIRMATIONS.some(function (message) {
        return lower.indexOf(message.toLowerCase()) !== -1;
      });
    }

    function addRequest(text) {
      var trimmed = text.trim();
      if (!trimmed) return;
      var normalized = normalizeRequest(trimmed);
      for (var i = 0; i < requests.length; i++) {
        var existing = requests[i];
        var normalizedExisting = normalizeRequest(existing);
        if (normalizedExisting.indexOf(normalized) !== -1) return;
        if (normalized.indexOf(normalizedExisting) !== -1) {
          requests[i] = trimmed;
          return;
        }
      }
      requests.push(trimmed);
    }

    function normalizeRequest(text) {
      return (text || "")
        .toLowerCase()
        .replace(/[.!?]/g, "")
        .trim();
    }

    function hasActionableRequest(text) {
      if (!keywordRegex.test(text)) return false;
      return initiativeRegex.test(text);
    }

    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      var text = normalizeWhitespace(msg.text || "");
      if (!text) return;
      if (greetings.test(text)) return;
      if (urgencyOnlyRegex.test(text)) return;
      if (confirmationRegex.test(text)) return;
      if (dateTimeOnlyRegex.test(text.toLowerCase())) return;
      if (isOsConfirmationText(text)) return;

      if (/similar to my/i.test(text)) {
        var vehicle = detectVehicleFromText(text);
        if (vehicle && vehicle.model) {
          addRequest("similar to: " + vehicle.make + " " + vehicle.model);
          return;
        }
      }
      if (!keywordRegex.test(text) || !initiativeRegex.test(text)) return;

      text.split(/[.!?]/).forEach(function (segment) {
        var trimmed = segment.trim();
        if (!trimmed) return;
        if (!hasActionableRequest(trimmed)) return;
        addRequest(trimmed);
      });
    });

    return requests;
  }

  function detectIntent(customerMessages, data) {
    var intents = [];
    var combined = customerMessages
      .filter(function (m) { return m.sender !== "system"; })
      .map(function (m) { return (m.text || "").toLowerCase(); })
      .join(" ");
    if ((data.date && data.time) || /book|appointment|test drive|viewing|view/.test(combined)) intents.push("booking request");
    if (/motability/.test(combined)) intents.push("motability inquiry");
    if (/finance|pcp|hp|pch|monthly|deposit/.test(combined)) intents.push("finance discussion");
    if (/delivery|transfer|home delivery/.test(combined)) intents.push("delivery enquiry");
    if (/sell.*part exchange|px only|just want to sell/.test(combined)) intents.push("px-only enquiry");
    if (/compare|\bvs\b/.test(combined)) intents.push("model comparison");
    return intents.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
  }

  function detectFlags(customerMessages, agentMessages, data, pxResult, voiResult) {
    var flags = [];
    var nameAsked = agentMessages.some(function (m) {
      return /full name|confirm your name|your name please|could i have your name|may i take your name/i.test(m.text || "");
    });

    if (nameAsked && data.nameAfterPromptSingleOnly) flags.push("Missing surname");

    var pxAsked = agentMessages.some(function (m) {
      return /part exchange|part-exchange|registration, make, model and mileage/i.test(m.text || "");
    });
    if (pxAsked && (!pxResult || (!pxResult.pxReg && !pxResult.pxMake && !pxResult.pxModel && !pxResult.pxMileage)) && (!pxResult || pxResult.pxSummary !== "No PX")) {
      flags.push("Missing PX details");
    }

    if (customerMessages.some(function (m) {
      return m.sender !== "system" && /urgent|asap/i.test(m.text || "");
    })) {
      flags.push("Customer urgency");
    }

    var vehicleMentions = [];
    customerMessages.forEach(function (m) {
      if (m.sender === "system") return;
      var text = m.text || "";
      if (/(part exchange|part-exchange|px|my car|my vehicle)/i.test(text)) return;
      var vehicle = detectVehicleFromText(text);
      if (vehicle && vehicle.model) {
        var key = vehicle.make + " " + vehicle.model;
        if (vehicleMentions.indexOf(key) === -1) vehicleMentions.push(key);
      }
    });
    if (vehicleMentions.length > 1) flags.push("Ambiguous vehicle of interest");

    return flags;
  }

  function detectDateTime(customerMessages, agentMessages) {
    var today = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    var todayStr = pad(today.getDate()) + "/" + pad(today.getMonth() + 1);
    var tomorrow = new Date(today.getTime() + 86400000);
    var tomorrowStr = pad(tomorrow.getDate()) + "/" + pad(tomorrow.getMonth() + 1);

    var date = "";
    var time = "";

    function parseTime(text) {
      if (/asap|urgent|soon/i.test(text)) return "";
      if (/midday|noon/.test(text)) return "12:00";
      if (/morning/.test(text)) return "10:00";
      if (/afternoon/.test(text)) return "14:00";
      if (/evening/.test(text)) return "17:00";
      var hm = /(\d{1,2})[:.](\d{2})/.exec(text);
      if (hm) return clampTimeSlot(parseInt(hm[1], 10), parseInt(hm[2], 10));
      var h = /\b(\d{1,2})\s*(am|pm)?\b/.exec(text);
      if (h) {
        var hour = parseInt(h[1], 10);
        var mer = (h[2] || "").toLowerCase();
        if (mer === "pm" && hour < 12) hour += 12;
        if (mer === "am" && hour === 12) hour = 0;
        return clampTimeSlot(hour, 0);
      }
      return "";
    }

    function parseDate(text) {
      if (/tomorrow/.test(text)) return tomorrowStr;
      if (/today/.test(text)) return todayStr;
      if (/this (morning|afternoon|evening)/.test(text)) return todayStr;
      var numeric = /(\d{1,2})[\/\-](\d{1,2})/.exec(text);
      if (numeric) return pad(parseInt(numeric[1], 10)) + "/" + pad(parseInt(numeric[2], 10));
      var weekdayRe = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(text);
      if (weekdayRe) {
        return findNextWeekdayDate(weekdayRe[1], 0);
      }
      return "";
    }

    var lastAgentDate = "";
    var lastAgentTime = "";
    agentMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      var lower = (msg.text || "").toLowerCase();
      var newDate = parseDate(lower);
      var newTime = parseTime(lower);
      if (newDate) lastAgentDate = newDate;
      if (newTime) lastAgentTime = newTime;
    });

    customerMessages.forEach(function (msg) {
      if (msg.sender === "system") return;
      var lower = (msg.text || "").toLowerCase();
      var newDate = parseDate(lower);
      var newTime = parseTime(lower);
      if (newDate) date = newDate;
      if (newTime) time = newTime;

      if (!newDate && !newTime && /(yes|that works|that's fine|ok|perfect|sounds good)/i.test(lower)) {
        if (!date && lastAgentDate) date = lastAgentDate;
        if (!time && lastAgentTime) time = lastAgentTime;
      }
    });

    if (!date && time && agentMessages.some(function (m) {
      return m.sender !== "system" && /today or tomorrow/i.test(m.text || "");
    })) {
      date = tomorrowStr;
    }

    if (!date && time && lastAgentDate) {
      date = lastAgentDate;
    }

    if (!date || !/^\d{2}\/\d{2}$/.test(date)) return { date: "", time: "", dateTime: "" };
    if (time && !/^\d{2}:\d{2}$/.test(time)) time = "";

    var dateTime = time ? date + " " + time : date + "";
    return { date: date, time: time, dateTime: dateTime };
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

  function detectBookingType(agentMessages, customerMessages, systemMessages) {
    var combinedAgent = agentMessages.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var combinedCustomer = customerMessages.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var osSystemText = (systemMessages || [])
      .map(function (m) { return (m.text || "").toLowerCase(); })
      .filter(function (text) {
        return PREDEFINED_OS_CONFIRMATIONS.some(function (msg) {
          return text.indexOf(msg.toLowerCase()) !== -1;
        });
      })
      .join(" ");
    var combinedAgentWithSystem = combinedAgent + " " + osSystemText;
    var combined = combinedAgent + " " + combinedCustomer;
    var combinedAll = combined + " " + osSystemText;

    if (/motability/.test(combinedAll)) return "Motability";

    var osConfirmation = PREDEFINED_OS_CONFIRMATIONS.some(function (msg) {
      return combinedAll.indexOf(msg.toLowerCase()) !== -1;
    });
    if (osConfirmation) return "Online Store";
    if (/test drive/.test(combinedAll)) return "Test Drive";
    if (/\b(viewing|view)\b|come to view|arrange viewing/.test(combinedAll)) return "View";
    if (/valuation/.test(combinedAll)) return "Valuation";
    if (/\bcall\b|phone call|arrange a call|book a call/.test(combinedAll)) return "Phone Call";
    return "";
  }

  function detectNewUsed(customerMessages, reg) {
    if (reg) return "Used";
    var combined = customerMessages.map(function (m) { return (m.text || "").toLowerCase(); }).join(" ");
    var brandDetected = getBrandList().some(function (brand) { return combined.indexOf(brand) !== -1; });
    if (brandDetected) return "New";
    return "";
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
    if (data.reg && data.pxReg && data.reg === data.pxReg) data.reg = "";
    if (data.time && !data.date) {
      data.dateTime = "";
    } else if (!data.date && !data.time) {
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
        if (!data.date) {
          value = "";
        } else {
          var parts = [];
          if (data.date) parts.push(data.date);
          if (data.time) parts.push(data.time);
          if (data.flexible) parts.push(data.flexible);
          value = parts.join(" ").trim();
        }
      }
      if (key === "vehicle") {
        if (data.make || data.model) {
          if (data.reg) value = (data.make + " " + data.model + " (" + data.reg + ")").trim();
          else value = (data.make + " " + data.model).trim();
        }
      }
      if (key === "pxSummary") value = data.pxSummary;
      if (key === "customerRequests") {
        if (Array.isArray(data.customerRequests) && data.customerRequests.length) {
          value = data.customerRequests.map(function (request) { return "• " + request; }).join("\n");
        } else {
          value = "";
        }
      }

      var valueEl = row.querySelector(".lpSumMiniValue");
      if (valueEl) {
        if (key === "customerRequests") valueEl.style.whiteSpace = "pre-line";
        else valueEl.style.whiteSpace = "";
        valueEl.textContent = value;
      }
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
