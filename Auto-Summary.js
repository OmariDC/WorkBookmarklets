(function () {
  if (window._lpCustomerPxUI) return;
  window._lpCustomerPxUI = true;

  /* =========================
     CONFIG
  ========================= */

  var AGENT_NAME = "Omari";

  var INFO_PROMPTS = {
    customerDetails: new RegExp(
      "may i take your full name|" +
      "just to confirm.*full name|" +
      "full name.*contact number|" +
      "contact number.*email|" +
      "email address.*postcode",
      "i"
    ),
    pxDetails: new RegExp(
      "vehicle to part[\\s-]?exchange|" +
      "registration.*make.*model.*mileage|" +
      "take the registration.*model.*mileage",
      "i"
    )
  };

  /* =========================
     UTIL
  ========================= */

  function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* =========================
     STYLES
  ========================= */

  var style = el("style");
  style.textContent =
    "#lpPxToggle{" +
    "position:fixed;bottom:12px;right:64px;width:14px;height:14px;" +
    "border-radius:50%;background:#1e1d49;border:2px solid #000;" +
    "box-shadow:0 0 4px rgba(0,0,0,.4);cursor:pointer;z-index:100001}" +

    "#lpPxPanel{" +
    "position:fixed;top:0;right:0;width:280px;height:100vh;" +
    "background:#1e1d49;color:#fff;font-family:Arial;font-size:13px;" +
    "padding:16px;box-shadow:-4px 0 10px rgba(0,0,0,.4);" +
    "transform:translateX(100%);opacity:0;pointer-events:none;" +
    "transition:transform .25s ease,opacity .25s ease;" +
    "z-index:100000}" +

    "#lpPxPanel.open{transform:translateX(0);opacity:1;pointer-events:auto}" +

    "#lpPxPanel h3{margin:12px 0 6px;font-size:15px}" +

    ".lpPxRow{background:rgba(255,255,255,.08);padding:6px 8px;" +
    "border-radius:4px;margin-bottom:6px;cursor:pointer}" +

    ".lpPxRow span{font-weight:bold;display:block;font-size:11px;opacity:.8}" +

    ".lpPxRow:hover{background:rgba(255,255,255,.18)}";

  document.head.appendChild(style);

  /* =========================
     UI
  ========================= */

  var toggleBtn = el("div");
  toggleBtn.id = "lpPxToggle";

  var panel = el("div");
  panel.id = "lpPxPanel";

  toggleBtn.onclick = function () {
    panel.classList.toggle("open");
  };

  function addRow(label) {
    var row = el("div", "lpPxRow");
    var l = el("span", null, label);
    var v = el("div");

    row.appendChild(l);
    row.appendChild(v);

    row.onclick = function () {
      copyText(v.textContent);
    };

    panel.appendChild(row);

    return function (value) {
      v.textContent = value || "";
    };
  }

  var setName = addRow("Name");
  var setPhone = addRow("Phone");
  var setEmail = addRow("Email");
  var setPostcode = addRow("Postcode");

  panel.appendChild(el("h3", null, "Part Exchange"));

  var setPxReg = addRow("PX Reg");
  var setPxVehicle = addRow("PX Vehicle");
  var setPxMileage = addRow("PX Mileage");

  document.body.appendChild(toggleBtn);
  document.body.appendChild(panel);

  /* =========================
     MESSAGE COLLECTION (FIXED)
  ========================= */

  function collectMessages() {
    var nodes = document.querySelectorAll(
      ".html-content.text-content," +
      ".content," +
      ".lp_message," +
      ".lpChatLine," +
      ".chatLine," +
      ".msg_text"
    );

    var out = [];
    var idx = 0;

    nodes.forEach(function (n) {
      if (panel.contains(n)) return;

      var text = (n.innerText || "")
        .replace(new RegExp("\\s+", "g"), " ")
        .trim();

      if (!text) return;
      if (!new RegExp("[A-Za-z0-9]").test(text)) return;

      var sender = "customer";

      // Explicit originator
      var origin = n.parentElement
        ? n.parentElement.querySelector(".originator")
        : null;

      if (origin) {
        var o = origin.innerText || "";
        if (o === AGENT_NAME) sender = "agent";
        else if (o === "Visitor") sender = "customer";
      } else {
        // Heuristic fallback
        if (
          new RegExp(
            "how can i help|how may i help|i can help|please provide|can i take your|may i take your",
            "i"
          ).test(text)
        ) {
          sender = "agent";
        }
      }

      out.push({ sender: sender, text: text, index: idx++ });
    });

    return out;
  }

  /* =========================
     CAPTURE WINDOWS
  ========================= */

  function repliesAfter(messages, promptRe) {
    var last = -1;

    messages.forEach(function (m) {
      if (m.sender === "agent" && promptRe.test(m.text)) last = m.index;
    });

    if (last < 0) return [];

    return messages.filter(function (m) {
      return (
        m.sender === "customer" &&
        m.index > last &&
        !messages.some(function (a) {
          return a.sender === "agent" && a.index > last && a.index < m.index;
        })
      );
    });
  }

  function explode(replies) {
    return replies
      .map(function (r) { return r.text; })
      .join("\n")
      .split(new RegExp("[\\n,;]"))
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /* =========================
     EXTRACTORS
  ========================= */

  function findName(lines) {
    var digit = new RegExp("\\d");
    var email = new RegExp("@");
    var reg = new RegExp("[A-Z]{2}\\d{2}\\s?[A-Z]{3}", "i");

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (digit.test(l) || email.test(l) || reg.test(l)) continue;

      var c = l.replace(new RegExp("[^A-Za-z\\s'-]", "g"), "").trim();
      if (!c) continue;

      var p = c.split(new RegExp("\\s+"));
      if (p.length > 0 && p.length <= 4) {
        return p.map(function (x) {
          return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
        }).join(" ");
      }
    }
    return "";
  }

  function findPhone(lines) {
    var re = new RegExp("(?:\\+44\\s?\\d{2,4}|0\\d{2,4})\\s?\\d{3,4}\\s?\\d{3,4}");
    var v = "";
    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m) v = m[0].replace(new RegExp("\\D", "g"), "");
    });
    return v;
  }

  function findEmail(lines) {
    var re = new RegExp("[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}", "i");
    var v = "";
    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m) v = m[0].toLowerCase();
    });
    return v;
  }

  function findPostcode(lines) {
    var re = new RegExp("([A-Z]{1,2}\\d{1,2}[A-Z]?)\\s?(\\d[A-Z]{2})", "i");
    var v = "";
    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m) v = (m[1] + " " + m[2]).toUpperCase();
    });
    return v;
  }

  function findPX(lines) {
    var px = { reg: "", make: "", model: "", mileage: "" };

    var noPx = new RegExp("no px|no part exchange", "i");
    if (lines.some(function (l) { return noPx.test(l); })) {
      return { reg: "", make: "No PX", model: "", mileage: "" };
    }

    var regRe = new RegExp("([A-Z]{2}\\d{2}\\s?[A-Z]{3})", "i");
    var milesRe = new RegExp("(\\b\\d{2,3}\\s?k\\b|\\b\\d{4,6}\\b)", "i");
    var carRe = new RegExp(
      "(peugeot|citroen|ds|fiat|abarth|alfa romeo|jeep|vauxhall|leapmotor)\\s+([a-z0-9]+)",
      "i"
    );

    lines.forEach(function (l) {
      var m;

      m = regRe.exec(l);
      if (m) px.reg = m[1].replace(new RegExp("\\s+", "g"), "").toUpperCase();

      m = milesRe.exec(l);
      if (m) {
        var t = m[0].toLowerCase().replace(new RegExp("\\s+", "g"), "");
        px.mileage = t.indexOf("k") !== -1
          ? String(parseInt(t, 10) * 1000)
          : t.replace(new RegExp("\\D", "g"), "");
      }

      m = carRe.exec(l);
      if (m) {
        px.make = m[1].replace(new RegExp("\\b\\w", "g"), function (c) {
          return c.toUpperCase();
        });
        px.model = m[2].toUpperCase();
      }
    });

    return px;
  }

  /* =========================
     RENDER LOOP
  ========================= */

  function render() {
    var msgs = collectMessages();

    var custLines = explode(repliesAfter(msgs, INFO_PROMPTS.customerDetails));
    var pxLines = explode(repliesAfter(msgs, INFO_PROMPTS.pxDetails));

    setName(findName(custLines));
    setPhone(findPhone(custLines));
    setEmail(findEmail(custLines));
    setPostcode(findPostcode(custLines));

    var px = findPX(pxLines);
    setPxReg(px.reg);
    setPxVehicle([px.make, px.model].filter(Boolean).join(" "));
    setPxMileage(px.mileage);
  }

  render();

  new MutationObserver(function () {
    render();
  }).observe(document.body, { childList: true, subtree: true });

})();
