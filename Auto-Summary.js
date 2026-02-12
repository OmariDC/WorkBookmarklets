(function () {
  if (window._lpSumMini) return;
  window._lpSumMini = true;

  var OBSERVER_DELAY = 800;
  var OBSERVER_TIMER = null;

  /* ================= SYSTEM FILTER ================= */

  var SYSTEM_BLOCK = /you are now connected|we are transferring|welcome!|which department|rich content|connecting you/i;

  function isSystemText(text) {
    if (!text) return true;
    return SYSTEM_BLOCK.test(text.toLowerCase());
  }

  /* ================= HELPERS ================= */

  function norm(t) {
    return (t || "").replace(/\s+/g, " ").trim();
  }

  function titleCase(str) {
    return str.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  var GREETINGS = /^(hi|hello|hey|ok|okay|thanks|thank you)$/i;
  var HONORIFICS = /^(mr|mrs|ms|miss|dr)\.?$/i;

  function normalizeUKPhone(input) {
    if (!input) return "";
    var n = input.replace(/[^\d+]/g, "");
    if (n.indexOf("+44") === 0) n = "0" + n.substring(3);
    if (n.indexOf("0") !== 0) return "";
    if (n.length < 10 || n.length > 11) return "";
    return n;
  }

  function extractEmail(text) {
    var m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return m ? m[0].toLowerCase() : "";
  }

  function extractPhone(text) {
    var m = text.match(/(\+44\s?\d{9,11}|0\d{9,10})/);
    return m ? normalizeUKPhone(m[0]) : "";
  }

  function extractPostcode(text) {
    var m = text.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/i);
    return m ? m[0].toUpperCase() : "";
  }

  function extractName(text) {
    var cleaned = norm(text);
    if (GREETINGS.test(cleaned)) return "";

    var tokens = cleaned.split(/[\s,]+/);
    var parts = [];

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (/@/.test(t) || /\d/.test(t)) break;
      if (HONORIFICS.test(t)) continue;
      if (/^[A-Za-z][A-Za-z'’-]*$/.test(t)) parts.push(t);
      else break;
      if (parts.length === 3) break;
    }

    if (parts.length >= 2) return titleCase(parts.join(" "));
    return "";
  }

  function extractReg(text) {
    var m = text.match(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i);
    return m ? m[0].replace(/\s+/g, "").toUpperCase() : "";
  }

  function extractMileage(text) {
    var m = text.match(/\b\d{2,3}\s?k\b|\b\d{4,6}\b/i);
    if (!m) return "";
    if (m[0].toLowerCase().indexOf("k") !== -1) {
      return String(parseInt(m[0], 10) * 1000);
    }
    return m[0].replace(/\D/g, "");
  }

  function extractVehicle(text) {
    var m = text.match(/\b(peugeot|citroen|fiat|jeep|vauxhall|leapmotor)\s+([a-z0-9]+)/i);
    if (!m) return null;
    return { make: titleCase(m[1]), model: m[2].toUpperCase() };
  }

  /* ================= UI ================= */

  function injectStyles() {
    if (document.getElementById("lpSumMiniStyle")) return;
    var s = document.createElement("style");
    s.id = "lpSumMiniStyle";
    s.textContent =
      "#lpSumMiniBtn{position:fixed;right:48px;bottom:14px;width:14px;height:14px;border-radius:50%;background:#1e1d49;border:2px solid #000;cursor:pointer;z-index:100001}" +
      "#lpSumMiniPanel{position:fixed;top:0;right:0;width:300px;height:100vh;background:#1e1d49;color:#fff;font-family:Arial;font-size:13px;padding:16px;box-shadow:-5px 0 12px rgba(0,0,0,.4);transform:translateX(100%);opacity:0;pointer-events:none;transition:.25s;z-index:100000;overflow-y:auto}" +
      "#lpSumMiniPanel.open{transform:translateX(0);opacity:1;pointer-events:auto}" +
      ".lpRow{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;margin-bottom:6px;background:rgba(255,255,255,.08);border-radius:4px;cursor:pointer}" +
      ".lpLabel{font-weight:bold}" +
      ".lpValue{flex:1;text-align:right;word-break:break-word}";
    document.head.appendChild(s);
  }

  function row(label, key) {
    var r = document.createElement("div");
    r.className = "lpRow";
    r.dataset.key = key;

    var l = document.createElement("span");
    l.className = "lpLabel";
    l.textContent = label;

    var v = document.createElement("span");
    v.className = "lpValue";

    r.appendChild(l);
    r.appendChild(v);

    r.onclick = function () {
      if (v.textContent) navigator.clipboard.writeText(v.textContent);
    };

    r._v = v;
    return r;
  }

  function createUI() {
    injectStyles();

    var btn = document.createElement("div");
    btn.id = "lpSumMiniBtn";

    var panel = document.createElement("div");
    panel.id = "lpSumMiniPanel";

    btn.onclick = function () {
      panel.classList.toggle("open");
    };

    var fields = [
      ["Full Name", "fullName"],
      ["Email", "email"],
      ["Phone", "phone"],
      ["Postcode", "postcode"],
      ["PX Make", "pxMake"],
      ["PX Model", "pxModel"],
      ["PX Reg", "pxReg"],
      ["PX Mileage", "pxMileage"]
    ];

    for (var i = 0; i < fields.length; i++) {
      panel.appendChild(row(fields[i][0], fields[i][1]));
    }

    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  /* ================= MESSAGE COLLECTION ================= */

  function collectMessages() {
    var nodes = document.querySelectorAll(".html-content.text-content, .content, .lp_message, .lpChatLine, .chatLine, .msg_text");
    var out = [];
    var i = 0;

    for (var n = 0; n < nodes.length; n++) {
      var text = norm(nodes[n].innerText);
      if (!text) continue;
      if (isSystemText(text)) continue;

      var sender = "customer";
      var origin = nodes[n].closest(".originator");
      if (origin && origin.innerText.trim() === "Omari") sender = "agent";

      out.push({ sender: sender, text: text, index: i++ });
    }

    return out;
  }

  /* ================= PARSER ================= */

  function parse(msgs) {
    var data = {
      fullName: "",
      email: "",
      phone: "",
      postcode: "",
      pxMake: "",
      pxModel: "",
      pxReg: "",
      pxMileage: ""
    };

    var agent = [];
    var customer = [];

    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].sender === "agent") agent.push(msgs[i]);
      if (msgs[i].sender === "customer") customer.push(msgs[i]);
    }

    var idQ = -1;
    var pxQ = -1;

    for (i = 0; i < agent.length; i++) {
      if (/full name|confirm.*name|email address/i.test(agent[i].text)) idQ = agent[i].index;
      if (/part.?exchange|registration, make, model/i.test(agent[i].text)) pxQ = agent[i].index;
    }

    var idSource = idQ >= 0 ? customer.filter(function (m) { return m.index > idQ; }) : [];
    var pxSource = pxQ >= 0 ? customer.filter(function (m) { return m.index > pxQ; }) : [];

    for (i = 0; i < idSource.length; i++) {
      if (!data.fullName) data.fullName = extractName(idSource[i].text);
      if (!data.email) data.email = extractEmail(idSource[i].text);
      if (!data.phone) data.phone = extractPhone(idSource[i].text);
      if (!data.postcode) data.postcode = extractPostcode(idSource[i].text);
    }

    for (i = 0; i < pxSource.length; i++) {
      if (!data.pxReg) data.pxReg = extractReg(pxSource[i].text);
      if (!data.pxMileage) data.pxMileage = extractMileage(pxSource[i].text);
      var v = extractVehicle(pxSource[i].text);
      if (v) {
        if (!data.pxMake) data.pxMake = v.make;
        if (!data.pxModel) data.pxModel = v.model;
      }
    }

    return data;
  }

  function render() {
    var data = parse(collectMessages());
    var rows = document.querySelectorAll(".lpRow");
    for (var i = 0; i < rows.length; i++) {
      rows[i]._v.textContent = data[rows[i].dataset.key] || "";
    }
  }

  function initObserver() {
    var obs = new MutationObserver(function () {
      if (OBSERVER_TIMER) clearTimeout(OBSERVER_TIMER);
      OBSERVER_TIMER = setTimeout(render, OBSERVER_DELAY);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete") {
    createUI();
    render();
    initObserver();
  } else {
    window.addEventListener("load", function () {
      createUI();
      render();
      initObserver();
    }, { once: true });
  }

})();
