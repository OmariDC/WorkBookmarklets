(function () {
  if (window._lpSumMini) return;

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
      " transition: transform 0.25s ease;" +
      " z-index: 100000;" +
      " box-sizing: border-box;" +
      " overflow-y: auto;" +
      "}" +
      "#" + app.panelId + ".open {" +
      " transform: translateX(0);" +
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

    panel.appendChild(buildSection("Summary", [
      createRow("Booking Type", "bookingType"),
      createRow("New/Used", "newUsed"),
      createRow("Vehicle", "vehicle"),
      createRow("Date/Time", "dateTime"),
      createRow("PX Summary", "pxSummary"),
      createRow("Intent", "intent"),
      createRow("Flags", "flags")
    ]));

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
    var nodes = document.querySelectorAll('[data-testid="visitor-message"]');
    var texts = [];
    var ignoreSelectors = [
      '[data-testid="agent-message"]',
      '[data-testid="system-message"]',
      '[data-testid="predefined-content"]',
      'div[class*="agent"]',
      'div[class*="rich-content"]',
      'div[class*="agent-typing"]'
    ];

    function isIgnored(el) {
      for (var i = 0; i < ignoreSelectors.length; i++) {
        if (el.matches(ignoreSelectors[i]) || el.querySelector(ignoreSelectors[i])) {
          return true;
        }
      }
      return false;
    }

    var contentSelectors = [
      'div[class*="bubble"] div[class*="content"] div[class*="text"]',
      'div[class*="bubble"] div[class*="content"] span',
      'div[class*="bubble"] div[class*="content"] p'
    ];

    nodes.forEach(function (node) {
      if (isIgnored(node)) return;
      var parts = [];
      for (var i = 0; i < contentSelectors.length; i++) {
        var found = node.querySelectorAll(contentSelectors[i]);
        found.forEach(function (el) {
          var t = (el.textContent || "").trim();
          if (t) {
            parts.push(t);
          }
        });
      }
      if (!parts.length) {
        var fallback = (node.innerText || "").trim();
        if (fallback) {
          parts.push(fallback);
        }
      }
      var combined = parts.join(" ").trim();
      if (combined && /[A-Za-z0-9]/.test(combined)) {
        texts.push(combined);
      }
    });

    return texts;
  }

  function parseMessages(messages) {
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
      pxSummary: "",
      pxMake: "",
      pxModel: "",
      pxReg: "",
      pxMileage: "",
      intent: "",
      flags: ""
    };

    if (!messages.length) {
      return data;
    }

    var combinedLower = messages.join(" \n ").toLowerCase();

    var nameMatch = findName(messages);
    if (nameMatch) {
      data.fullName = nameMatch.full;
      data.firstName = nameMatch.first;
      data.lastName = nameMatch.last;
    }

    var emailMatch = combinedLower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (emailMatch) {
      data.email = emailMatch[0];
    }

    var phoneMatch = findPhone(messages);
    if (phoneMatch) {
      data.phone = phoneMatch;
    }

    var postcodeInfo = findPostcode(messages);
    if (postcodeInfo) {
      data.postcode = postcodeInfo.postcode;
      data.address = postcodeInfo.address;
    }

    var regInfo = findRegs(messages);
    if (regInfo.primary) {
      data.reg = regInfo.primary;
    }
    if (regInfo.secondary) {
      data.pxReg = regInfo.secondary;
    }

    var mileage = findMileage(messages);
    if (mileage) {
      data.pxMileage = mileage;
    }

    var booking = detectBookingType(combinedLower);
    if (booking) {
      data.bookingType = booking;
    }

    var newUsed = detectNewUsed(combinedLower);
    if (newUsed) {
      data.newUsed = newUsed;
    }

    var intent = detectIntent(combinedLower);
    if (intent.length) {
      data.intent = intent.join(", ");
    }

    var flags = detectFlags(combinedLower);
    if (flags.length) {
      data.flags = flags.join(", ");
    }

    if (data.reg) {
      data.vehicle = data.reg;
    }
    data.pxSummary = buildPxSummary(data);

    return data;
  }

  function findName(messages) {
    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      var match = txt.match(/(?:my name is|i am|i'm|im|this is)\s+([a-zA-Z'-]+(?:\s+[a-zA-Z'-]+)+)/i);
      if (match) {
        var full = match[1].trim();
        var parts = full.split(/\s+/);
        var first = parts[0];
        var last = parts.slice(1).join(" ");
        return { full: full, first: first, last: last };
      }
    }
    return null;
  }

  function findPhone(messages) {
    var phoneRegex = /(\+447\d{9}|07\d{9}|0\d{10})/g;
    for (var i = 0; i < messages.length; i++) {
      var txt = messages[i];
      var m;
      while ((m = phoneRegex.exec(txt))) {
        var num = m[1];
        if (num.indexOf("+447") === 0) {
          num = "07" + num.slice(4);
        }
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
        var postcode = m[1].toUpperCase().replace(/\s+/, " ");
        var idx = txt.toUpperCase().indexOf(postcode);
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
        regs.push(m[1].replace(/\s+/, ""));
      }
    });
    return { primary: regs[0] || "", secondary: regs[1] || "" };
  }

  function findMileage(messages) {
    var re = /(\d{1,3}(?:,\d{3})+|\d{4,})\s*(?:miles?|mi)\b/i;
    for (var i = 0; i < messages.length; i++) {
      var m = re.exec(messages[i]);
      if (m) {
        return m[1].replace(/,/g, "");
      }
    }
    return "";
  }

  function detectBookingType(text) {
    if (!text) return "";
    if (text.indexOf("notes only") !== -1) return "notes only";

    var onlineStore = containsAny(text, ["online store", "online-store", "bought online", "ordered online"]);
    var stockCentre = containsAny(text, ["stock centre", "stock center", "stock location", "stock site"]);
    if (onlineStore && stockCentre) {
      return "online store";
    }

    if (text.indexOf("test drive") !== -1 || text.indexOf("test-drive") !== -1) return "test drive";
    if (text.indexOf("viewing") !== -1 || text.indexOf("view ") !== -1) return "view";
    if (text.indexOf("phone call") !== -1 || text.indexOf("call me") !== -1) return "phone call";
    if (text.indexOf("valuation") !== -1 || text.indexOf("px") !== -1) return "valuation";
    if (text.indexOf("motability") !== -1) return "motability";
    if (text.indexOf("national reserve") !== -1) return "national reserve";
    return "";
  }

  function detectNewUsed(text) {
    if (text.indexOf("motability") !== -1) return "";
    if (text.indexOf("brand new") !== -1 || text.indexOf("new ") !== -1) return "new";
    if (text.indexOf("used") !== -1 || text.indexOf("pre owned") !== -1 || text.indexOf("pre-owned") !== -1) return "used";
    return "";
  }

  function detectIntent(text) {
    var intents = [];
    var map = [
      { key: "finance", terms: ["finance", "pcp", "hp", "apr"] },
      { key: "delivery", terms: ["delivery", "deliver"] },
      { key: "video", terms: ["video", "walkaround"] },
      { key: "color", terms: ["colour", "color", "paint"] },
      { key: "extended test drive", terms: ["extended test drive", "longer drive"] }
    ];
    map.forEach(function (item) {
      if (containsAny(text, item.terms)) {
        intents.push(item.key);
      }
    });
    return intents;
  }

  function detectFlags(text) {
    var flags = [];
    var map = [
      { key: "FAO", terms: ["fao"] },
      { key: "not local", terms: ["not local", "far away", "long distance", "traveling", "travelling"] },
      { key: "urgent", terms: ["urgent", "asap", "soon as possible"] }
    ];
    map.forEach(function (item) {
      if (containsAny(text, item.terms)) {
        flags.push(item.key);
      }
    });
    return flags;
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

  function render() {
    var messages = collectMessages();
    app.data = parseMessages(messages);

    var rows = app.panel ? app.panel.querySelectorAll('.lpSumMiniRow') : [];
    rows.forEach(function (row) {
      var keyName = row.dataset.key;
      var value = app.data[keyName] || "";
      if (keyName === "fullName" && !value && app.data.firstName) {
        value = app.data.firstName + (app.data.lastName ? " " + app.data.lastName : "");
      }
      row._valueEl.textContent = value;
    });
  }

  function initObserver() {
    if (app.observer) return;
    app.observer = new MutationObserver(render);
    app.observer.observe(document.body, { childList: true, subtree: true });
  }

  createUI();
  render();
  initObserver();
})();
