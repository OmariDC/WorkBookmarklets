(function () {
  if (window._lpSumMini) return;
  window._lpSumMini = true;

  /* ================= CONFIG ================= */

  const OBSERVER_DELAY = 800;
  let OBSERVER_TIMER = null;

  /* ================= HELPERS ================= */

  function norm(t) {
    return (t || "").replace(/\s+/g, " ").trim();
  }

  function titleCase(str) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }

  const GREETINGS = /^(hi|hello|hey|ok|okay|thanks|thank you)$/i;

  function normalizeUKPhone(input) {
    if (!input) return "";
    let n = input.replace(/[^\d+]/g, "");
    if (n.startsWith("+44")) n = "0" + n.slice(3);
    if (!n.startsWith("0")) return "";
    if (n.length < 10 || n.length > 11) return "";
    return n;
  }

  function extractEmail(text) {
    const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return m ? m[0].toLowerCase() : "";
  }

  function extractPhone(text) {
    const m = text.match(/(\+44\s?\d{9,11}|0\d{9,10})/);
    return m ? normalizeUKPhone(m[0]) : "";
  }

  function extractPostcode(text) {
    const m = text.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/i);
    return m ? m[0].toUpperCase() : "";
  }

  function extractName(text) {
    const cleaned = norm(text);
    if (GREETINGS.test(cleaned)) return "";

    const tokens = cleaned.split(/\s+/);
    const parts = [];

    for (let t of tokens) {
      if (/@/.test(t) || /\d/.test(t)) break;
      if (/^[A-Za-z][A-Za-z'’-]*$/.test(t)) parts.push(t);
      else break;
      if (parts.length === 3) break;
    }

    return parts.length >= 2 ? titleCase(parts.join(" ")) : "";
  }

  function extractReg(text) {
    const m = text.match(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i);
    return m ? m[0].replace(/\s+/g, "").toUpperCase() : "";
  }

  function extractMileage(text) {
    const m = text.match(/\b\d{2,3}\s?k\b|\b\d{4,6}\b/i);
    if (!m) return "";
    return m[0].toLowerCase().includes("k")
      ? String(parseInt(m[0], 10) * 1000)
      : m[0].replace(/\D/g, "");
  }

  function extractVehicle(text) {
    const m = text.match(/\b(peugeot|citroen|fiat|jeep|vauxhall|leapmotor)\s+([a-z0-9]+)/i);
    return m ? { make: titleCase(m[1]), model: m[2].toUpperCase() } : null;
  }

  /* ================= UI ================= */

  function injectStyles() {
    if (document.getElementById("lpSumMiniStyle")) return;
    const s = document.createElement("style");
    s.id = "lpSumMiniStyle";
    s.textContent = `
      #lpSumMiniBtn{position:fixed;right:48px;bottom:14px;width:14px;height:14px;border-radius:50%;background:#1e1d49;border:2px solid #000;cursor:pointer;z-index:100001}
      #lpSumMiniPanel{position:fixed;top:0;right:0;width:300px;height:100vh;background:#1e1d49;color:#fff;font-family:Arial;font-size:13px;padding:16px;box-shadow:-5px 0 12px rgba(0,0,0,.4);transform:translateX(100%);opacity:0;pointer-events:none;transition:.25s;z-index:100000;overflow-y:auto}
      #lpSumMiniPanel.open{transform:translateX(0);opacity:1;pointer-events:auto}
      .lpRow{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;margin-bottom:6px;background:rgba(255,255,255,.08);border-radius:4px;cursor:pointer}
      .lpLabel{font-weight:bold}
      .lpValue{flex:1;text-align:right;word-break:break-word}
    `;
    document.head.appendChild(s);
  }

  function row(label, key) {
    const r = document.createElement("div");
    r.className = "lpRow";
    r.dataset.key = key;
    const l = document.createElement("span");
    l.className = "lpLabel";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "lpValue";
    r.append(l, v);
    r.onclick = () => v.textContent && navigator.clipboard.writeText(v.textContent);
    r._v = v;
    return r;
  }

  function createUI() {
    injectStyles();
    const btn = document.createElement("div");
    btn.id = "lpSumMiniBtn";
    const panel = document.createElement("div");
    panel.id = "lpSumMiniPanel";
    btn.onclick = () => panel.classList.toggle("open");

    [
      ["Full Name","fullName"],
      ["Email","email"],
      ["Phone","phone"],
      ["Postcode","postcode"],
      ["PX Make","pxMake"],
      ["PX Model","pxModel"],
      ["PX Reg","pxReg"],
      ["PX Mileage","pxMileage"]
    ].forEach(([l,k]) => panel.appendChild(row(l,k)));

    document.body.append(btn, panel);
  }

  /* ================= MESSAGE COLLECTION ================= */

  function collectMessages() {
    const nodes = document.querySelectorAll(".html-content.text-content, .content, .lp_message, .lpChatLine, .chatLine, .msg_text");
    const out = [];
    let i = 0;

    nodes.forEach(n => {
      const text = norm(n.innerText);
      if (!text) return;
      let sender = "customer";
      const o = n.closest(".originator");
      if (o && o.innerText.trim() === "Omari") sender = "agent";
      out.push({ sender, text, index: i++ });
    });
    return out;
  }

  /* ================= PARSER ================= */

  function parse(msgs) {
    const data = { fullName:"", email:"", phone:"", postcode:"", pxMake:"", pxModel:"", pxReg:"", pxMileage:"" };

    const agent = msgs.filter(m => m.sender === "agent");
    const customer = msgs.filter(m => m.sender === "customer");

    let idQ = -1, pxQ = -1;

    agent.forEach(m => {
      if (/full name|confirm.*name|email address/i.test(m.text)) idQ = m.index;
      if (/part.?exchange|registration, make, model/i.test(m.text)) pxQ = m.index;
    });

    // Identity: ONLY after question if asked
    const idSource = idQ >= 0 ? customer.filter(m => m.index > idQ) : customer;

    idSource.forEach(m => {
      if (!data.fullName) data.fullName = extractName(m.text);
      if (!data.email) data.email = extractEmail(m.text);
      if (!data.phone) data.phone = extractPhone(m.text);
      if (!data.postcode) data.postcode = extractPostcode(m.text);
    });

    // PX: ONLY after PX question if asked
    const pxSource = pxQ >= 0 ? customer.filter(m => m.index > pxQ) : [];

    pxSource.forEach(m => {
      if (!data.pxReg) data.pxReg = extractReg(m.text);
      if (!data.pxMileage) data.pxMileage = extractMileage(m.text);
      const v = extractVehicle(m.text);
      if (v) {
        if (!data.pxMake) data.pxMake = v.make;
        if (!data.pxModel) data.pxModel = v.model;
      }
    });

    return data;
  }

  /* ================= RENDER ================= */

  function render() {
    const data = parse(collectMessages());
    document.querySelectorAll(".lpRow").forEach(r => {
      r._v.textContent = data[r.dataset.key] || "";
    });
  }

  /* ================= OBSERVER ================= */

  function initObserver() {
    const obs = new MutationObserver(() => {
      if (OBSERVER_TIMER) clearTimeout(OBSERVER_TIMER);
      OBSERVER_TIMER = setTimeout(render, OBSERVER_DELAY);
    });
    obs.observe(document.body, { childList:true, subtree:true });
  }

  /* ================= INIT ================= */

  if (document.readyState === "complete") {
    createUI(); render(); initObserver();
  } else {
    window.addEventListener("load", () => { createUI(); render(); initObserver(); }, { once:true });
  }
})();
