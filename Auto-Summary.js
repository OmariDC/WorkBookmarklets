(function () {
  if (window._lpSumMini) return;
  window._lpSumMini = true;

  /* ================= CONFIG ================= */

  const OBSERVER_DELAY = 800;
  let OBSERVER_TIMER = null;

  /* ================= HELPERS ================= */

  function normalizeText(t) {
    return (t || "").replace(/\s+/g, " ").trim();
  }

  function titleCase(str) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }

  function normalizeUKPhone(input) {
    if (!input) return "";
    let n = input.replace(/[^\d+]/g, "");
    if (n.startsWith("+44")) n = "0" + n.slice(3);
    if (!n.startsWith("0")) return "";
    if (n.length < 10 || n.length > 11) return "";
    return n;
  }

  /* ================= UI ================= */

  function injectStyles() {
    if (document.getElementById("lpSumMiniStyle")) return;

    const s = document.createElement("style");
    s.id = "lpSumMiniStyle";
    s.textContent = `
      #lpSumMiniBtn {
        position: fixed;
        right: 48px;
        bottom: 14px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #1e1d49;
        border: 2px solid #000;
        cursor: pointer;
        z-index: 100001;
      }
      #lpSumMiniPanel {
        position: fixed;
        top: 0;
        right: 0;
        width: 300px;
        height: 100vh;
        background: #1e1d49;
        color: #fff;
        font-family: Arial, sans-serif;
        font-size: 13px;
        padding: 16px;
        box-shadow: -5px 0 12px rgba(0,0,0,.4);
        transform: translateX(100%);
        opacity: 0;
        pointer-events: none;
        transition: .25s;
        z-index: 100000;
        overflow-y: auto;
      }
      #lpSumMiniPanel.open {
        transform: translateX(0);
        opacity: 1;
        pointer-events: auto;
      }
      .lpRow {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        margin-bottom: 6px;
        background: rgba(255,255,255,.08);
        border-radius: 4px;
        cursor: pointer;
      }
      .lpLabel {
        font-weight: bold;
      }
      .lpValue {
        flex: 1;
        text-align: right;
        word-break: break-word;
      }
    `;
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
      if (v.textContent) navigator.clipboard.writeText(v.textContent);
    };

    r._valueEl = v;
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
      ["Full Name", "fullName"],
      ["Email", "email"],
      ["Phone", "phone"],
      ["Address", "address"],
      ["PX Make", "pxMake"],
      ["PX Model", "pxModel"],
      ["PX Reg", "pxReg"],
      ["PX Mileage", "pxMileage"]
    ].forEach(([l, k]) => panel.appendChild(createRow(l, k)));

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    window._lpSumMiniPanel = panel;
  }

  /* ================= MESSAGE READER ================= */

  function collectMessages() {
    const nodes = Array.from(document.querySelectorAll(
      ".html-content.text-content, .content, .lp_message, .lpChatLine, .chatLine, .msg_text"
    ));

    const messages = [];
    let i = 0;

    nodes.forEach(n => {
      const text = normalizeText(n.innerText);
      if (!text) return;

      let sender = "customer";
      const o = n.closest(".originator");
      if (o && o.innerText.trim() === "Omari") sender = "agent";

      messages.push({ sender, text, index: i++ });
    });

    return messages;
  }

  /* ================= PARSER ================= */

  function parse(messages) {
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

    const agent = messages.filter(m => m.sender === "agent");
    const customer = messages.filter(m => m.sender === "customer");

    function afterPrompt(rx) {
      let idx = -1;
      agent.forEach(m => {
        if (rx.test(m.text)) idx = m.index;
      });
      return idx >= 0 ? customer.filter(m => m.index > idx) : [];
    }

    /* -------- NAME (FIXED) -------- */
    afterPrompt(/full name|your name/i).forEach(m => {
      if (data.fullName) return;

      const tokens = m.text.split(/\s+/);
      const nameParts = [];

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];

        // stop at email, numbers, postcode, etc.
        if (/@/.test(t) || /\d/.test(t)) break;

        if (/^[A-Za-z][A-Za-z'’-]*$/.test(t)) {
          nameParts.push(t);
        } else {
          break;
        }

        if (nameParts.length === 3) break;
      }

      if (nameParts.length >= 1 && nameParts.length <= 3) {
        data.fullName = titleCase(nameParts.join(" "));
      }
    });

    /* -------- EMAIL -------- */
    messages.forEach(m => {
      if (data.email) return;
      const e = m.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (e) data.email = e[0].toLowerCase();
    });

    /* -------- PHONE (UK NORMALISED) -------- */
    messages.forEach(m => {
      if (data.phone) return;
      const p = m.text.match(/(\+44\s?\d{9,11}|0\d{9,10})/);
      if (!p) return;
      const n = normalizeUKPhone(p[0]);
      if (n) data.phone = n;
    });

    /* -------- ADDRESS / POSTCODE -------- */
    afterPrompt(/postcode|address/i).forEach(m => {
      if (data.address) return;
      if (
        /[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}/i.test(m.text) &&
        !/[a-f0-9-]{30,}/i.test(m.text)
      ) {
        data.address = m.text.trim();
      }
    });

    /* -------- PART EXCHANGE -------- */
    afterPrompt(/part.?exchange|registration, make, model/i).forEach(m => {
      if (!data.pxReg) {
        const r = m.text.match(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i);
        if (r) data.pxReg = r[0].replace(/\s+/g, "").toUpperCase();
      }

      if (!data.pxMileage) {
        const mi = m.text.match(/\b\d{2,3}\s?k\b|\b\d{4,6}\b/i);
        if (mi) {
          data.pxMileage = mi[0].toLowerCase().includes("k")
            ? String(parseInt(mi[0], 10) * 1000)
            : mi[0].replace(/\D/g, "");
        }
      }

      const v = m.text.match(/\b(peugeot|citroen|fiat|jeep|vauxhall|leapmotor)\s+([a-z0-9]+)/i);
      if (v) {
        data.pxMake = titleCase(v[1]);
        data.pxModel = v[2].toUpperCase();
      }
    });

    return data;
  }

  /* ================= RENDER ================= */

  function render() {
    const messages = collectMessages();
    const data = parse(messages);

    document.querySelectorAll(".lpRow").forEach(r => {
      r._valueEl.textContent = data[r.dataset.key] || "";
    });
  }

  /* ================= OBSERVER ================= */

  function initObserver() {
    const obs = new MutationObserver(() => {
      if (OBSERVER_TIMER) clearTimeout(OBSERVER_TIMER);
      OBSERVER_TIMER = setTimeout(render, OBSERVER_DELAY);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ================= INIT ================= */

  if (document.readyState === "complete") {
    createUI();
    render();
    initObserver();
  } else {
    window.addEventListener(
      "load",
      () => {
        createUI();
        render();
        initObserver();
      },
      { once: true }
    );
  }
})();
