(function () {
  if (window._lpCustomerPxCapture) return;
  window._lpCustomerPxCapture = true;

  const AGENT_NAME = "Omari";

  const INFO_PROMPTS = {
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

  function collectMessages() {
    const nodes = document.querySelectorAll(
      ".html-content, .text-content, .lp_message, .chatLine, .msg_text"
    );
    const out = [];
    let i = 0;

    nodes.forEach(n => {
      const text = (n.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) return;

      let sender = "customer";
      const origin = n.closest("[class*=originator]");
      if (origin && origin.innerText.trim() === AGENT_NAME) sender = "agent";

      out.push({ sender, text, index: i++ });
    });

    return out;
  }

  function getRepliesAfterPrompt(messages, promptRegex) {
    let lastPrompt = -1;

    messages.forEach(m => {
      if (m.sender === "agent" && promptRegex.test(m.text)) {
        lastPrompt = m.index;
      }
    });

    if (lastPrompt < 0) return [];

    return messages.filter(m =>
      m.sender === "customer" &&
      m.index > lastPrompt &&
      !messages.some(a =>
        a.sender === "agent" &&
        a.index > lastPrompt &&
        a.index < m.index
      )
    );
  }

  function explodeToLines(replies) {
    return replies
      .map(r => r.text)
      .join("\n")
      .split(/[\n,;]/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function extractName(lines) {
    const regPattern = new RegExp("[A-Z]{2}\\d{2}\\s?[A-Z]{3}", "i");

    for (let l of lines) {
      if (l.indexOf("@") !== -1) continue;
      if (/\d/.test(l)) continue;
      if (regPattern.test(l)) continue;

      const clean = l.replace(/[^A-Za-z\s'-]/g, "").trim();
      const parts = clean.split(/\s+/);

      if (parts.length >= 1 && parts.length <= 4) {
        return parts.map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
      }
    }
    return "";
  }

  function extractPhone(lines) {
    const re = new RegExp("(?:\\+44\\s?\\d{2,4}|0\\d{2,4})\\s?\\d{3,4}\\s?\\d{3,4}");
    let out = "";

    lines.forEach(l => {
      const m = re.exec(l);
      if (m) out = m[0].replace(/\D/g, "");
    });

    return out;
  }

  function extractEmail(lines) {
    const re = new RegExp("[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}", "i");
    let out = "";

    lines.forEach(l => {
      const m = re.exec(l);
      if (m) out = m[0].toLowerCase();
    });

    return out;
  }

  function extractPostcode(lines) {
    const re = new RegExp("([A-Z]{1,2}\\d{1,2}[A-Z]?)\\s?(\\d[A-Z]{2})", "i");
    let out = "";

    lines.forEach(l => {
      const m = re.exec(l);
      if (m) out = (m[1] + " " + m[2]).toUpperCase();
    });

    return out;
  }

  function extractPX(lines) {
    const px = { reg: "", make: "", model: "", mileage: "", summary: "" };

    if (lines.some(l => /no px|no part exchange/i.test(l))) {
      px.summary = "No PX";
      return px;
    }

    const regRe = new RegExp("([A-Z]{2}\\d{2}\\s?[A-Z]{3})", "i");
    const milesRe = new RegExp("(\\b\\d{2,3}\\s?k\\b|\\b\\d{4,6}\\b)", "i");
    const carRe = new RegExp(
      "(peugeot|citroen|ds|fiat|abarth|alfaromeo|alfa romeo|jeep|vauxhall|leapmotor)\\s+([a-z0-9]+)",
      "i"
    );

    lines.forEach(l => {
      let m;

      m = regRe.exec(l);
      if (m) px.reg = m[1].replace(/\s+/g, "").toUpperCase();

      m = milesRe.exec(l);
      if (m) {
        let v = m[0].toLowerCase().replace(/\s+/g, "");
        px.mileage = v.indexOf("k") !== -1 ? String(parseInt(v, 10) * 1000) : v.replace(/\D/g, "");
      }

      m = carRe.exec(l);
      if (m) {
        px.make = m[1].replace(/\s+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        px.model = m[2].toUpperCase();
      }
    });

    const parts = [];
    if (px.reg) parts.push("Reg: " + px.reg);
    if (px.make || px.model) parts.push("Vehicle: " + [px.make, px.model].filter(Boolean).join(" "));
    if (px.mileage) parts.push("Mileage: " + px.mileage);

    px.summary = parts.length ? parts.join(" | ") : "";
    return px;
  }

  function run() {
    const messages = collectMessages();

    const customerReplies = getRepliesAfterPrompt(messages, INFO_PROMPTS.customerDetails);
    const pxReplies = getRepliesAfterPrompt(messages, INFO_PROMPTS.pxDetails);

    const customerLines = explodeToLines(customerReplies);
    const pxLines = explodeToLines(pxReplies);

    const output = [
      "Customer Details",
      "------------------",
      extractName(customerLines) && "Name: " + extractName(customerLines),
      extractPhone(customerLines) && "Phone: " + extractPhone(customerLines),
      extractEmail(customerLines) && "Email: " + extractEmail(customerLines),
      extractPostcode(customerLines) && "Postcode: " + extractPostcode(customerLines),
      "",
      "Part Exchange",
      "------------------",
      extractPX(pxLines).summary || "No PX"
    ].filter(Boolean).join("\n");

    navigator.clipboard.writeText(output);
    alert("Customer + PX copied");
  }

  run();
})();
