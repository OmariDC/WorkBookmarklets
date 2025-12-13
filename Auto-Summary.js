(function () {
  if (window._lpSumMini) return;

  const PREDEFINED_CONTENT = [
    // Insert all user-provided predefined content strings here
  ];

  // Ensure levenshtein exists for predefined filter
  if (typeof levenshtein !== "function") {
    function levenshtein(a, b) {
      const matrix = [];
      for (let i = 0; i <= b.length; i++) matrix[i] = [i];
      for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
      for (let i = 1; i <= b.length; i++)
        for (let j = 1; j <= a.length; j++)
          matrix[i][j] = b[i - 1] === a[j - 1]
            ? matrix[i - 1][j - 1]
            : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      return matrix[b.length][a.length];
    }
  }

  function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++)
      for (let j = 1; j <= a.length; j++)
        matrix[i][j] = b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    return matrix[b.length][a.length];
  }

  var app = {
    styleId: "lp-sum-mini-style",
    buttonId: "lpSumMiniBtn",
    panelId: "lpSumMiniPanel",
    copyBadgeId: "lpSumMiniCopyBadge",
    observer: null,
    data: {}
  };

  window._lpSumMini = app;

  function injectStyles() {
    if (document.getElementById(app.styleId)) return;

    var style = document.createElement("style");
    style.id = app.styleId;
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
      createRow("Address", "address"),
      createRow("Postcode", "postcode")
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
      "motability",
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
      return localStorage.getItem("lpSumMini.bookingOverride") || "auto-detect";
    } catch (e) {
      return "auto-detect";
    }
  }

  function setBookingOverride(value) {
    try {
      localStorage.setItem("lpSumMini.bookingOverride", value);
    } catch (e) {}
    render();
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
    var selectors = [
      '[data-testid="visitor-message"]',
      '[data-testid="agent-message"]',
      'div[class*="message"]',
      'div[class*="bubble"]'
    ];

    var nodes = Array.from(document.querySelectorAll(selectors.join(",")));
    var uniqueNodes = [];

    nodes.forEach(function (node) {
      for (var i = 0; i < uniqueNodes.length; i++) {
        if (uniqueNodes[i] === node || uniqueNodes[i].contains(node)) {
          return;
        }
      }
      uniqueNodes.push(node);
    });

    var list = [];
    uniqueNodes.forEach(function (node) {
      var parts = [];
      var innerSelectors = [
        '.html-content.text-content',
        '.text-content',
        'p',
        'span',
        'div'
      ];

      innerSelectors.forEach(function (sel) {
        node.querySelectorAll(sel).forEach(function (inner) {
          var t = (inner.textContent || "").trim();
          if (t) parts.push(t);
        });
      });

      var text = parts.join(" ").replace(/\s+/g, " ").trim();
      if (!text) {
        text = (node.innerText || "").replace(/\s+/g, " ").trim();
      }

      if (!text) return;
      if (!/[A-Za-z0-9]/.test(text)) return;

      var lower = text.toLowerCase();
      if (lower.indexOf("connected to") !== -1) return;
      if (lower.indexOf("automated") !== -1) return;
      if (lower.indexOf("is typing") !== -1) return;

      if (/^(?:\d|:|\s)+$/.test(text)) return;

      // PREDEFINED CONTENT FILTER
      let normalised = text.replace(/\s+/g, " ").trim().toLowerCase();

      for (let template of PREDEFINED_CONTENT) {
        let normTemplate = template.replace(/\s+/g, " ").trim().toLowerCase();

        if (
          normalised === normTemplate ||
          normalised.startsWith(normTemplate.split(" ").slice(0, 6).join(" ")) ||
          (normalised.length > 12 && levenshtein(normalised, normTemplate) < 5)
        ) {
          list.push("__PREDEFINED__:" + text);
          return;
        }
      }

      list.push(text);
    });

    return {
      list: list,
      combined: list.join(" ").trim()
    };
  }

  function parseMessages(messagesObj) {
    var list = messagesObj.list || [];
    var realMessages = list.filter(function (t) { return !t.startsWith("__PREDEFINED__:"); });
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
      intent: "",
      flags: ""
    };

    if (!realMessages.length) {
      return data;
    }

    // PRIORITY ORDER
    // 1) Filter predefined content
    // 2) Identify corrected reg after agent rejection
    // 3) Activate PX mode only after PX question
    // 4) Assign enquiry reg vs pxReg based on PX_MODE
    // 5) Detect booking type (agent-confirmed overrides keyword detection)
    // 6) Date/time
    // 7) Make/model + vehicle assembly
    // 8) Intent
    // 9) Flags

    var nameMatch = findName(realMessages);
    if (nameMatch) {
      data.fullName = nameMatch.fullName;
      data.firstName = nameMatch.firstName;
      data.lastName = nameMatch.lastName;
    }

    var emailMatch = (combinedText || "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (emailMatch) {
      data.email = emailMatch[0];
    }

    var phoneMatch = findPhone(realMessages);
    if (phoneMatch) {
      data.phone = phoneMatch;
    }

    var postcodeInfo = findPostcode(realMessages);
    if (postcodeInfo) {
      data.postcode = postcodeInfo.postcode;
      data.address = postcodeInfo.address;
    }

    var userRegs = realMessages.flatMap(function (msg) { return findRegs([msg]); });

    // ACTIVATE PX MODE WHEN AGENT ASKS FOR PX DETAILS
    let PX_MODE = list.some(function (t) {
      return /part[- ]?exchange|px details|registration, make, model and mileage|vehicle to part/i.test(t);
    });

    // REG CORRECTION LOGIC
    let correctionTriggered = list.some(function (t) {
      return /cannot find|cannot see|please confirm the registration|confirm the reg/i.test(t);
    });

    if (correctionTriggered && userRegs.length > 1) {
      data.reg = userRegs[userRegs.length - 1];
      data.pxReg = "";
    }

    if (!PX_MODE) {
      data.reg = data.reg || (userRegs.length ? userRegs[userRegs.length - 1] : "");
      data.pxReg = "";
    } else {
      if (!data.reg && userRegs.length) {
        data.reg = userRegs[0];
      }
      if (userRegs.length > 1) {
        data.pxReg = userRegs[userRegs.length - 1];
      }
    }

    var mileage = findMileage(realMessages);
    if (mileage) {
      data.pxMileage = mileage;
    }

    var vehicleInfo = findVehicle(realMessages);
    var baseVehicle = "";
    if (vehicleInfo) {
      data.make = vehicleInfo.make;
      data.model = vehicleInfo.model;
      data.trim = vehicleInfo.trim;
      baseVehicle = (vehicleInfo.make + " " + vehicleInfo.model).trim();
    } else if (data.make && data.model) {
      baseVehicle = (data.make + " " + data.model).trim();
    }

    if (data.reg && baseVehicle) {
      data.vehicle = baseVehicle + ", " + data.reg;
    } else if (data.reg && !baseVehicle) {
      data.vehicle = data.reg;
    } else {
      data.vehicle = baseVehicle;
    }

    var bookingDetected = detectBookingType(combinedLower);
    var override = getBookingOverride();
    if (override && override !== "auto-detect") {
      data.bookingType = override;
    } else {
      data.bookingType = bookingDetected;
    }

    // PHONE CALL DETECTION OVERRIDE
    let agentCallRequest = list.some(function (t) {
      return /request contact|request a call|schedule a call|arrange a phone call|call from/i.test(t);
    });
    let customerAcceptance = list.some(function (t) {
      return /\bok\b|yes\b|that works|please\b|sure\b/i.test(t);
    });

    if (agentCallRequest && customerAcceptance) {
      data.bookingType = "phone call";
    }

    if (data.bookingType === "test drive") {
      let noConfirmation = !/at \d{1,2}:\d{2}/.test(list.join(" ").toLowerCase());
      if (noConfirmation) data.bookingType = "";
    }

    data.newUsed = detectNewUsed(combinedLower, data, bookingDetected);

    var dateInfo = detectDateTime(realMessages);
    if (dateInfo) {
      data.date = dateInfo.date;
      data.time = dateInfo.time;
      data.flexible = dateInfo.flexible;
      data.dateTime = dateInfo.dateTime;
    }

    // IF time but no date AND context implies "today"
    if (!data.date && dateInfo && dateInfo.time &&
      realMessages.some(function (t) { return /later today|today|this afternoon/i.test(t); })) {
      var d = new Date();
      var dd = String(d.getDate()).padStart(2, "0");
      var mm = String(d.getMonth() + 1).padStart(2, "0");
      data.date = dd + "/" + mm;
    }

    var intent = detectIntent(combinedLower);
    if (intent.length) {
      data.intent = intent.join(", ");
    }

    var flags = detectFlags(realMessages);
    if (flags.length) {
      data.flags = flags.join(", ");
    }

    if (override === "motability") {
      data.newUsed = "";
    }
    if (override === "notes only") {
      data.dateTime = "";
      data.date = "";
      data.time = "";
      data.flexible = "";
      data.newUsed = "";
    }

    data.pxSummary = buildPxSummary(data);

    return data;
  }

  function findName(list) {
    for (var i = 0; i < list.length; i++) {
      var txt = list[i];
      var m = txt.match(/(?:my name is|i am|i'm|im|this is)\s+([a-zA-Z][a-zA-Z\-']*(?:\s+[a-zA-Z][a-zA-Z\-']*)+)/i);
      if (m) {
        var full = m[1].trim();
        var parts = full.split(/\s+/);
        return {
          fullName: full,
          firstName: parts[0],
          lastName: parts.slice(1).join(" ")
        };
      }

      var standalone = txt.trim().match(/^[a-zA-Z][a-zA-Z\-']*(?:\s+[a-zA-Z][a-zA-Z\-']*)+$/);
      if (standalone) {
        var fullStandalone = standalone[0];
        var partsStandalone = fullStandalone.split(/\s+/);
        return {
          fullName: fullStandalone,
          firstName: partsStandalone[0],
          lastName: partsStandalone.slice(1).join(" ")
        };
      }
    }
    return null;
  }

  function findPhone(list) {
    var re = /(\+447\d{9}|07\d{9}|0\d{9,10})/g;

    for (var i = 0; i < list.length; i++) {
      var txt = list[i];
      var m;
      while ((m = re.exec(txt))) {
        var num = m[1];

        if (num.indexOf("+447") === 0) {
          num = "07" + num.slice(4);
        }

        if (num.indexOf("0") !== 0) continue;

        return num.replace(/\D/g, "");
      }
    }
    return "";
  }

  function findPostcode(messages) {
    var re = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      var m = re.exec(txt);
      if (m) {
        var cleaned = m[1].replace(/\s+/g, "").toUpperCase();
        var postcode = cleaned.slice(0, cleaned.length - 3) + " " + cleaned.slice(-3);
        var upperTxt = txt.toUpperCase();
        var idx = upperTxt.indexOf(cleaned);
        var address = "";
        if (idx > 0) {
          address = txt.slice(0, idx).trim();
        }
        return { postcode: postcode, address: address };
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
    var re = /(\d{1,3}(?:,\d{3})+|\d{4,}|\d+(?:\s?[kK]))/;
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
      "alfa-romeo"
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

  function detectBookingType(text) {
    if (!text) return "";

    var stockCentre = containsAny(text, [
      "central used stock centre",
      "national used stock centre",
      "preparation centre",
      "stored at our central",
      "stored at the used stock centre"
    ]);
    var onlineProcess = containsAny(text, [
      "£99 reservation moves it",
      "reservation moves it",
      "guide you through reserving",
      "click & collect",
      "5-6 working days",
      "5–6 working days",
      "5 – 6 working days"
    ]);

    if (stockCentre && onlineProcess) {
      return "online store";
    }

    if (text.indexOf("motability") !== -1) return "motability";
    if (text.indexOf("test drive") !== -1) return "test drive";
    if (text.indexOf("viewing") !== -1 || text.indexOf("view ") !== -1) return "view";
    if (text.indexOf("phone call") !== -1 || text.indexOf("call me") !== -1 || text.indexOf("call back") !== -1)
      return "phone call";
    if (text.indexOf("valuation") !== -1 || text.indexOf("px") !== -1 || text.indexOf("p/x") !== -1)
      return "valuation";

    return "";
  }

  function detectNewUsed(text, data, bookingDetected) {
    if (text.indexOf("motability") !== -1 || data.bookingType === "motability" || bookingDetected === "motability") {
      return "";
    }

    if (containsAny(text, ["brand new", "new shape", "new model", "new "])) return "new";
    if (data.reg) return "used";
    if (containsAny(text, ["px", "p/x", "part exchange", "finance", "pcp", "hp", "apr"])) return "used";

    return "";
  }

  function detectDateTime(messages) {
    var date = "";
    var time = "";
    var flexible = "";

    var monthNames = "january february march april may june july august september october november december".split(" ");
    var monthPattern = monthNames.join("|");

    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      var lower = txt.toLowerCase();

      if (!date) {
        var m1 = lower.match(/\b(\d{1,2}\/\d{1,2})\b/);
        var m2 = lower.match(new RegExp("\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+(" + monthPattern + "))\\b"));
        var m3 = lower.match(new RegExp("\\b(" + monthPattern + ")\\s+\\d{1,2}(?:st|nd|rd|th)?\\b"));
        var m4 = lower.match(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week)\b/);
        var m5 = lower.match(/\b(today|tomorrow)\b/);
        if (m1) date = m1[1];
        else if (m2) date = m2[1];
        else if (m3) date = m3[0];
        else if (m4) date = m4[0];
        else if (m5) date = m5[1];
      }

      if (!time) {
        var t1 = lower.match(/\b(\d{1,2}:\d{2}\s?(?:am|pm)?)\b/);
        var t2 = lower.match(/\b(\d{1,2}\s?(?:am|pm))\b/);
        var t3 = lower.match(/\bhalf\s*3\b/);
        if (t1) time = t1[1];
        else if (t2) time = t2[1];
        else if (t3) time = "3:30";
        else if (lower.indexOf("midday") !== -1) time = "12:00";
        else if (lower.indexOf("midnight") !== -1) time = "00:00";
      }

      if (!flexible) {
        var flex1 = lower.match(/\bbetween\s+\d{1,2}\s*[-to]*\s*\d{1,2}/);
        var flex2 = lower.match(/\bafter\s+\d{1,2}/);
        if (flex1) flexible = flex1[0];
        else if (flex2) flexible = flex2[0];
        else if (lower.indexOf("asap") !== -1) flexible = "asap";
        else if (lower.indexOf("anytime") !== -1) flexible = "anytime";
      }
    }

    if (!date && !time && !flexible) return null;

    var parts = [];
    if (date) parts.push(date);
    if (time) parts.push(time);
    if (flexible) parts.push(flexible);

    return {
      date: date,
      time: time,
      flexible: flexible,
      dateTime: parts.join(" ").trim()
    };
  }

  function detectIntent(text) {
    var intents = [];
    var map = [
      { key: "finance", terms: ["finance", "pcp"] },
      { key: "negative equity", terms: ["negative equity"] },
      { key: "petrol preferred", terms: ["petrol preferred", "prefer petrol"] },
      { key: "video walkthrough", terms: ["video walkthrough", "video walk", "walkaround"] },
      { key: "extended test drive", terms: ["extended test drive", "longer drive"] },
      { key: "comparing models", terms: ["compare", "comparing", "versus"] },
      { key: "delivery/collection", terms: ["delivery", "collection", "deliver"] }
    ];
    map.forEach(function (item) {
      if (containsAny(text, item.terms)) {
        intents.push(item.key);
      }
    });
    if (containsAny(text, ["home delivery", "deliver to me", "dealer to dealer"])) intents.push("delivery enquiry");
    if (containsAny(text, ["warranty", "12 months", "14 day money back"])) intents.push("warranty clarification");
    if (containsAny(text, ["test a similar", "similar vehicle"])) intents.push("local test-drive alternative");
    if (containsAny(text, ["80 miles", "far away", "distance"])) intents.push("distance concerns");
    return intents;
  }

  function detectFlags(messages) {
    var flags = [];

    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      var lower = txt.toLowerCase();
      var fao = txt.match(/fao\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
      if (fao) {
        flags.push("FAO " + fao[1]);
      }
      if (containsAny(lower, ["not local", "far away", "long distance", "travelling", "traveling"])) {
        flags.push("not local");
      }
      if (lower.indexOf("urgent") !== -1 || lower.indexOf("asap") !== -1) {
        flags.push("urgent");
      }
      if (containsAny(lower, ["wants delivery", "want delivery", "deliver", "delivery"])) {
        flags.push("wants delivery");
      }
      if (containsAny(lower, ["far away", "80 miles", "north east", "not local"])) {
        flags.push("not local");
      }
      if (containsAny(lower, ["today", "later today", "asap"])) {
        flags.push("needs call today");
      }
    }

    return flags.filter(function (item, idx) {
      return flags.indexOf(item) === idx;
    });
  }

  function buildPxSummary(data) {
    var parts = [];
    if (data.pxReg) parts.push("Reg: " + data.pxReg);
    if (data.pxMileage) parts.push("Miles: " + data.pxMileage);
    if (data.pxModel || data.pxMake) {
      parts.push("Model: " + (data.pxMake ? data.pxMake + " " : "") + (data.pxModel || ""));
    }
    return parts.join(" | ");
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
    var messagesObj = collectMessages();
    app.data = parseMessages(messagesObj);

    if (app.bookingOverrideSelect) {
      app.bookingOverrideSelect.value = getBookingOverride();
    }

    var rows = app.panel ? app.panel.querySelectorAll('.lpSumMiniRow[data-key]') : [];
    rows.forEach(function (row) {
      var keyName = row.dataset.key;
      var value = app.data[keyName] || "";
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
  }

  window._lpSumMini_forceRender = render;
  window._lpSumMini_setBookingType = function (type) {
    setBookingOverride(type);
  };

  function initObserver() {
    if (app.observer) return;
    app.observer = new MutationObserver(render);
    app.observer.observe(document.body, { childList: true, subtree: true });
  }

  createUI();
  render();
  initObserver();
})();
