(function () {
  if (window.LPAF && window.LPAF.installed) {
    alert("Auto-Fill already installed.\nPress ALT + D to run.");
    return;
  }

  const LPAF = window.LPAF = window.LPAF || {};
  LPAF.installed = true;

  const fields = {
    firstName: 'input[name="firstName"],input[placeholder="First Name"]',
    lastName: 'input[name="lastName"],input[placeholder="Last Name"]',
    email: 'input[name="email"],input[placeholder="Email"]',
    phone: 'input[name="phone"],input[placeholder="Phone"]',
    postcode: 'input[placeholder="Customer\'s Postcode"]',
    pxMake: 'input[placeholder="Customer Vehicle Make"]',
    pxModel: 'input[placeholder="Customer Vehicle Model"]',
    pxReg: 'input[placeholder="Customer Vehicle Registration Number"]',
    pxMileage: 'input[placeholder="Customer Vehicle Mileage"]'
  };

  const detailAnchors = [
    "full name, contact number, email address and postcode",
    "full name, contact number and email address"
  ];

  const pxAnchors = [
    "vehicle to part-exchange",
    "registration, make, model and mileage",
    "registration, make, model and current mileage",
    "current vehicle"
  ];

  function clean(t) {
    return String(t || "")
      .replace(/\u00a0/g, " ")
      .replace(/[|]+/g, "\n")
      .replace(/\.{2,}/g, "\n")
      .trim();
  }

  function isAgent(el) {
    const msg = el.closest(".message");
    return msg && msg.classList.contains("assigned-agent");
  }

  function getMessages() {
    return Array.from(document.querySelectorAll(".html-content.text-content"))
      .map((el, i) => ({
        i,
        el,
        text: clean(el.innerText || ""),
        agent: isAgent(el)
      }))
      .filter(m => m.text);
  }

  function getAfterAnchor(messages, anchors) {
    let idx = -1;
    messages.forEach((m, i) => {
      if (m.agent) {
        const low = m.text.toLowerCase();
        if (anchors.some(a => low.includes(a))) idx = i;
      }
    });
    if (idx >= 0) {
      return messages.slice(idx + 1).filter(m => !m.agent).map(m => m.text).join("\n");
    }
    return messages.filter(m => !m.agent).map(m => m.text).join("\n");
  }

  function extractEmail(t) {
    const m = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : "";
  }

  function extractPhone(t) {
    const m = t.match(/(\+44\s?7\d{3}|\(?07\d{3}\)?)[\s.-]?\d{3}[\s.-]?\d{3}/);
    return m ? m[0].replace(/[^\d+]/g, "") : "";
  }

  function extractPostcode(t) {
    const m = t.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    return m ? m[0].replace(/\s+/g, "").replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2") : "";
  }

  function extractReg(t) {
    const m = t.toUpperCase().match(/\b[A-Z]{2}\d{2}[A-Z]{3}\b/);
    return m ? m[0] : "";
  }

  function extractMileage(t) {
    const m = t.match(/\b(\d{4,6})\b/);
    return m ? m[1] : "";
  }

  function extractName(t, email, phone, postcode) {
    let txt = t.replace(email, "").replace(phone, "").replace(postcode, "");
    const m = txt.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
    return m ? { firstName: m[1], lastName: m[2] } : { firstName: "", lastName: "" };
  }

  function extractCustomer(t) {
    const email = extractEmail(t);
    const phone = extractPhone(t);
    const postcode = extractPostcode(t);
    const name = extractName(t, email, phone, postcode);
    return { ...name, email, phone, postcode };
  }

  function extractPX(t) {
    const reg = extractReg(t);
    const mileage = extractMileage(t);
    const cleaned = t.replace(reg, "").replace(mileage, "");
    const words = cleaned.split(/\s+/).filter(w => /^[A-Za-z0-9-]+$/.test(w));
    return {
      pxMake: words[0] || "",
      pxModel: words.slice(1, 3).join(" "),
      pxReg: reg,
      pxMileage: mileage
    };
  }

  function setVal(selector, val, overwrite) {
    const el = document.querySelector(selector);
    if (!el || (!overwrite && el.value)) return;
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function run() {
    const messages = getMessages();
    const detailsText = getAfterAnchor(messages, detailAnchors);
    const pxText = getAfterAnchor(messages, pxAnchors);

    const data = {
      ...extractCustomer(detailsText),
      ...extractPX(pxText)
    };

    const overwrite = confirm("Auto-Fill ready.\n\nPress OK to overwrite existing fields, or Cancel to only fill blanks.");

    setVal(fields.firstName, data.firstName, overwrite);
    setVal(fields.lastName, data.lastName, overwrite);
    setVal(fields.email, data.email, overwrite);
    setVal(fields.phone, data.phone, overwrite);
    setVal(fields.postcode, data.postcode, overwrite);

    setVal(fields.pxMake, data.pxMake, overwrite);
    setVal(fields.pxModel, data.pxModel, overwrite);
    setVal(fields.pxReg, data.pxReg, overwrite);
    setVal(fields.pxMileage, data.pxMileage, overwrite);
  }

  document.addEventListener("keydown", function (e) {
    if (e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      run();
    }
  });

  alert("Auto-Fill installed.\n\nPress ALT + D to run.");
})();
