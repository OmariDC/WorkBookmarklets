(function () {
  if (window._lpSumMini) return;

  let RENDER_LOCK = false;
  let LAST_RENDER = 0;
  const MIN_RENDER_GAP = 300;
  let RENDER_SCHEDULED = false;
  let OBSERVER_DEBOUNCE = null;
  const OBSERVER_DELAY = 800;

  function safeRender(fn) {
    const now = Date.now();
    if (now - LAST_RENDER < MIN_RENDER_GAP) {
      if (!RENDER_SCHEDULED) {
        RENDER_SCHEDULED = true;
        setTimeout(() => {
          RENDER_SCHEDULED = false;
          safeRender(fn);
        }, MIN_RENDER_GAP);
      }
      return;
    }
    if (RENDER_LOCK) {
      if (!RENDER_SCHEDULED) {
        RENDER_SCHEDULED = true;
        setTimeout(() => {
          RENDER_SCHEDULED = false;
          safeRender(fn);
        }, 80);
      }
      return;
    }
    RENDER_LOCK = true;
    try { fn(); } catch (e) { console.error(e); }
    LAST_RENDER = Date.now();
    RENDER_LOCK = false;
  }

  const app = {
    styleId: "lpSumMiniStyle",
    buttonId: "lpSumMiniBtn",
    panelId: "lpSumMiniPanel",
    observer: null,
    data: {}
  };

  window._lpSumMini = app;

  function injectStyles() {
    if (document.getElementById(app.styleId)) return;
    const s = document.createElement("style");
    s.id = app.styleId;
    s.textContent =
      "#" + app.buttonId + "{position:fixed;right:48px;bottom:12px;width:14px;height:14px;border-radius:50%;background:#1e1d49;border:2px solid #000;cursor:pointer;z-index:100001}" +
      "#" + app.panelId + "{position:fixed;top:0;right:0;width:300px;height:100vh;background:#1e1d49;color:#fff;font-family:Arial;font-size:14px;padding:20px;transform:translateX(100%);opacity:0;pointer-events:none;transition:.25s;z-index:100000;overflow-y:auto}" +
      "#" + app.panelId + ".open{transform:translateX(0);opacity:1;pointer-events:auto}" +
      ".lpRow{display:flex;justify-content:space-between;padding:6px 8px;margin-bottom:6px;background:rgba(255,255,255,.08);border-radius:4px;cursor:pointer}" +
      ".lpLabel{font-weight:bold;margin-right:8px}" +
      ".lpValue{word-break:break-word;text-align:right;flex:1}";
    document.head.appendChild(s);
  }

  function createRow(label, key) {
    const r = document.createElement("div");
    r.className = "lpRow";
    r.dataset.key = key;

    const l = document.createElement("span");
    l.className = "lpLabel";
    l.textContent = label;

    const v = document.createElement("span");
    v.className = "lpValue";

    r.appendChild(l);
    r.appendChild(v);

    r.onclick = () => {
      if (!v.textContent) return;
      navigator.clipboard.writeText(v.textContent);
    };

    r._valueEl = v;
    return r;
  }

  function createUI() {
    injectStyles();

    const btn = document.createElement("div");
    btn.id = app.buttonId;

    const panel = document.createElement("div");
    panel.id = app.panelId;

    btn.onclick = () => panel.classList.toggle("open");

    panel.appendChild(createRow("Full Name", "fullName"));
    panel.appendChild(createRow("Email", "email"));
    panel.appendChild(createRow("Phone", "phone"));
    panel.appendChild(createRow("Address", "address"));

    panel.appendChild(document.createElement("hr"));

    panel.appendChild(createRow("PX Make", "pxMake"));
    panel.appendChild(createRow("PX Model", "pxModel"));
    panel.appendChild(createRow("PX Reg", "pxReg"));
    panel.appendChild(createRow("PX Mileage", "pxMileage"));

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    app.button = btn;
    app.panel = panel;
  }

  function collectMessages() {
    const nodes = Array.from(
      document.querySelectorAll(
        ".html-content.text-content, .content, .lp_message, .lpChatLine, .chatLine, .msg_text"
      )
    );

    const raw = [];
    let index = 0;

    nodes.forEach(node => {
      if (app.panel && app.panel.contains(node)) return;

      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || !/[A-Za-z0-9]/.test(text)) return;

      let originatorEl = null;

      if (node.nextElementSibling?.classList.contains("originator")) {
        originatorEl = node.nextElementSibling;
      } else if (node.parentElement) {
        const found = node.parentElement.querySelector(".originator");
        if (found) originatorEl = found;
      }

      let origin = originatorEl ? originatorEl.innerText.trim() : "";
      let sender = "customer";

      if (origin === "Omari") sender = "agent";
      else if (origin === "Visitor") sender = "customer";
      else if (/^sms/i.test(origin)) sender = "customer";
      else if (/\+44|07\d{9}/.test(origin)) sender = "customer";

      if (!origin) {
        if (/(may i take|could i take|please provide|can i take|registration|make, model and mileage|part exchange|email address|contact number)/i.test(text)) {
          sender = "agent";
        }
      }

      raw.push({ sender, text, index: index++ });
    });

    return raw;
  }

  function parseMessages(raw) {
    const agent = raw.filter(m => m.sender === "agent");
    const customer = raw.filter(m => m.sender === "customer");

    const data = {
      fullName: "",
      email: "",
      phone: "",
      address: "",
      pxMake: "",
      pxModel: "",
      pxReg: "",
      pxMileage: ""
    };

    function afterPrompt(regex) {
      let idx = -1;
      agent.forEach(m => { if (regex.test(m.text)) idx = m.index; });
      return idx >= 0 ? customer.filter(m => m.index > idx) : [];
    }

    afterPrompt(/full name|your name/i).forEach(m => {
      if (!/@|\d/.test(m.text) && m.text.split(/\s+/).length <= 4) {
        data.fullName = m.text.trim();
      }
    });

    afterPrompt(/email/i).forEach(m => {
      const e = m.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (e) data.email = e[0].toLowerCase();
    });

    afterPrompt(/phone|contact number/i).forEach(m => {
      const p = m.text.match(/(?:\+44|0)\d{9,11}/);
      if (p) data.phone = p[0].replace(/\D/g, "");
    });

    afterPrompt(/address|postcode/i).forEach(m => {
      if (/\d+/.test(m.text)) data.address = m.text.trim();
    });

    afterPrompt(/part exchange|registration, make, model/i).forEach(m => {
      const t = m.text;

      const r = t.match(/[A-Z]{2}\d{2}\s?[A-Z]{3}/i);
      if (r) data.pxReg = r[0].replace(/\s+/g, "").toUpperCase();

      const mi = t.match(/\b\d{2,3}\s?k\b|\b\d{4,6}\b/i);
      if (mi) {
        data.pxMileage = mi[0].toLowerCase().includes("k")
          ? String(parseInt(mi[0]) * 1000)
          : mi[0].replace(/\D/g, "");
      }

      const v = t.match(/\b(peugeot|citroen|fiat|jeep|vauxhall|leapmotor)\s+(\w+)/i);
      if (v) {
        data.pxMake = v[1];
        data.pxModel = v[2];
      }
    });

    return data;
  }

  function render() {
    const raw = collectMessages();
    app.data = parseMessages(raw);

    document.querySelectorAll(".lpRow").forEach(row => {
      const key = row.dataset.key;
      row._valueEl.textContent = app.data[key] || "";
    });
  }

  function scheduleRender() {
    safeRender(render);
  }

  function initObserver() {
    if (app.observer) return;
    app.observer = new MutationObserver(() => {
      if (OBSERVER_DEBOUNCE) clearTimeout(OBSERVER_DEBOUNCE);
      OBSERVER_DEBOUNCE = setTimeout(scheduleRender, OBSERVER_DELAY);
    });
    app.observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete") {
    createUI();
    scheduleRender();
    initObserver();
  } else {
    window.addEventListener("load", () => {
      createUI();
      scheduleRender();
      initObserver();
    }, { once: true });
  }
})();
