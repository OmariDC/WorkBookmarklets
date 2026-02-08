(function () {
  if (window._lpCustomerPxCapture) return;
  window._lpCustomerPxCapture = true;

  /* =========================
     CONFIG
  ========================= */

  const AGENT_NAME = "Omari";

  const INFO_PROMPTS = {
    customerDetails: /(
      may i take your full name|
      just to confirm.*full name|
      full name.*contact number|
      contact number.*email|
      email address.*postcode
    )/ix,

    pxDetails: /(
      vehicle to part[\s-]?exchange|
      registration.*make.*model.*mileage|
      take the registration.*model.*mileage
    )/ix
  };

  /* =========================
     DOM MESSAGE COLLECTION
  ========================= */

  function collectMessages() {
    const nodes = Array.from(
      document.querySelectorAll(".html-content, .text-content, .lp_message, .chatLine, .msg_text")
    );

    const raw = [];
    let index = 0;

    nodes.forEach(node => {
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) return;

      let sender = "customer";

      const originator = node.closest("[class*=originator]");
      if (originator && originator.innerText.trim() === AGENT_NAME) sender = "agent";

      raw.push({ sender, text, index: index++ });
    });

    return raw;
  }

  /* =========================
     CAPTURE WINDOW
  ========================= */

  function getRepliesAfterPrompt(messages, promptRegex) {
    let lastPromptIndex = -1;

    messages.forEach(m => {
      if (m.sender === "agent" && promptRegex.test(m.text)) {
        lastPromptIndex = m.index;
      }
    });

    if (lastPromptIndex < 0) return [];

    return messages.filter(m =>
      m.sender === "customer" &&
      m.index > lastPromptIndex &&
      !messages.some(a =>
        a.sender === "agent" &&
        a.index > lastPromptIndex &&
        a.index < m.index
      )
    );
  }

  /* =========================
     NORMALISATION
  ========================= */

  function explodeToLines(replies) {
    return replies
      .map(r => r.text)
      .join("\n")
      .split(/\r?\n|[,;]/)
      .map(l => l.trim())
      .filter(Boolean);
  }

  /* =========================
     FIELD EXTRACTORS
  ========================= */

  function extractEmail(lines) {
    let out = "";
    const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    lines.forEach(l => {
      const m = re.exec(l);
      if (m) out = m[0].toLowerCase();
    });
    return out;
  }

  function extractPhone(lines) {
    let out = "";
    const re = /\b(?:\+44\s?\d{2,4}|0\d{2,4})\s?\d{3,4}\s?\d{3,4}\b/;
    lines.forEach(l => {
      const m = re.exec(l);
      if (m) out = m[0].replace(/\D/g, "");
    });
    return out;
  }

  function extractPostcode(lines) {
    let out = "";
    const re = /([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})/i;
    lines.forEach(l => {
      const m = re.exec(l);
      if (m) out = (m[1] + " " + m[2]).toUpperCase();
    });
    return out;
  }

  function extractName(lines) {
    for (let l of lines) {
      if (/@|\d/.test(l)) continue;
      if (/[A-Z]{2}\d{2}\s?[A-Z]{3}/i.test(l)) continue;

      const clean = l.replace(/[^A-Za-z\s'-]/g, "").trim();
      const parts = clean.split(/\s+/);

      if (parts.length >= 1 && parts.length <= 4) {
        if (parts.every(p => /^[A-Za-z'-]+$/.test(p))) {
          return parts.map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
        }
      }
    }
    return "";
  }

  function extractPX(lines) {
    let px = {
      reg: "",
      make: "",
      model: "",
      mileage: "",
      summary: ""
    };

    if (lines.some(l => /no px|no part exchange/i.test(l))) {
      px.summary = "No PX";
      return px;
    }

    lines.forEach(l => {
      const reg = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/i.exec(l);
      if (reg) px.reg = reg[1].replace(/\s+/g, "").toUpperCase();

      const miles = /(\b\d{2,3}\s?k\b|\b\d{4,6}\b)/i.exec(l);
      if (miles) {
        let m = miles[0].toLowerCase().replace(/\s+/g, "");
        px.mileage = m.includes("k") ? String(parseInt(m) * 1000) : m.replace(/\D/g, "");
      }

      const car = /(peugeot|citroen|ds|fiat|abarth|alfa romeo|jeep|vauxhall|leapmotor)\s+([a-z0-9]+)/i.exec(l);
      if (car) {
        px.make = car[1][0].toUpperCase() + car[1].slice(1).toLowerCase();
        px.model = car[2].toUpperCase();
      }
    });

    const parts = [];
    if (px.reg) parts.push("Reg: " + px.reg);
    if (px.make || px.model) parts.push("Vehicle: " + [px.make, px.model].filter(Boolean).join(" "));
    if (px.mileage) parts.push("Mileage: " + px.mileage);

    px.summary = parts.length ? parts.join(" | ") : "";

    return px;
  }

  /* =========================
     RENDER + COPY
  ========================= */

  function buildOutput(data) {
    const lines = [];

    lines.push("Customer Details");
    lines.push("------------------");
    if (data.name) lines.push("Name: " + data.name);
    if (data.phone) lines.push("Phone: " + data.phone);
    if (data.email) lines.push("Email: " + data.email);
    if (data.postcode) lines.push("Postcode: " + data.postcode);

    lines.push("");
    lines.push("Part Exchange");
    lines.push("------------------");
    lines.push(data.px.summary || "No PX");

    return lines.join("\n").trim();
  }

  function run() {
    const messages = collectMessages();

    const customerReplies = getRepliesAfterPrompt(messages, INFO_PROMPTS.customerDetails);
    const pxReplies = getRepliesAfterPrompt(messages, INFO_PROMPTS.pxDetails);

    const customerLines = explodeToLines(customerReplies);
    const pxLines = explodeToLines(pxReplies);

    const data = {
      name: extractName(customerLines),
      phone: extractPhone(customerLines),
      email: extractEmail(customerLines),
      postcode: extractPostcode(customerLines),
      px: extractPX(pxLines)
    };

    const output = buildOutput({
      name: data.name,
      phone: data.phone,
      email: data.email,
      postcode: data.postcode,
      px: data.px
    });

    navigator.clipboard.writeText(output);
    alert("Customer + PX copied");
  }

  run();
})();
