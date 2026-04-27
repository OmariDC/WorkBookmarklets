(function () {
  if (window.LPAF && window.LPAF.listener) {
    document.removeEventListener("keydown", window.LPAF.listener, true);
  }

  const LPAF = window.LPAF = {};

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
    "vehicle to part exchange",
    "registration, make, model and mileage",
    "registration, make, model and current mileage",
    "current vehicle"
  ];

  const blockedNames = [
    "thank you", "thanks", "no thank you", "yes please", "no problem",
    "ok thanks", "okay thanks", "that is fine", "sounds good"
  ];

  function clean(t) {
    return String(t || "")
      .replace(/\u00a0/g, " ")
      .replace(/[|/]+/g, "\n")
      .replace(/\.{2,}/g, "\n")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .trim();
  }

  function isAgent(el) {
    const msg = el.closest(".message");
    return !!(msg && msg.classList.contains("assigned-agent"));
  }

  function getMessages() {
    return Array.from(document.querySelectorAll(".html-content.text-content"))
      .map((el, i) => ({
        i: i,
        text: clean(el.innerText || el.textContent || ""),
        agent: isAgent(el)
      }))
      .filter(m => m.text);
  }

  function textAfterLatestAgentAnchor(messages, anchors, fallbackAllCustomer) {
    let idx = -1;

    messages.forEach((m, i) => {
      if (!m.agent) return;
      const low = m.text.toLowerCase();
      if (anchors.some(a => low.includes(a))) idx = i;
    });

    if (idx >= 0) {
      return messages.slice(idx + 1).filter(m => !m.agent).map(m => m.text).join("\n");
    }

    return fallbackAllCustomer ? messages.filter(m => !m.agent).map(m => m.text).join("\n") : "";
  }

  function extractEmail(t) {
    const m = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : "";
  }

  function extractPhone(t) {
    const m = t.match(/(?:\+44\s?7\d{3}|07\d{3})[\s.-]?\d{3}[\s.-]?\d{3}/i);
    return m ? m[0].replace(/[^\d+]/g, "") : "";
  }

  function extractPostcode(t) {
    const m = t.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    return m ? m[0].replace(/\s+/g, "").replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2") : "";
  }

  function extractReg(t) {
    const m = t.toUpperCase().match(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/);
    return m ? m[0].replace(/\s+/g, "") : "";
  }

  function extractMileage(t) {
    const m = t.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:miles|mile|mi|mileage)?\b/i);
    if (!m) return "";
    const n = m[1].replace(/,/g, "");
    return Number(n) >= 1000 ? n : "";
  }

  function extractName(t, email, phone, postcode) {
    const lines = clean(t)
      .replace(email, "\n")
      .replace(phone, "\n")
      .replace(postcode, "\n")
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);

    const best = lines.find(line => {
      const low = line.toLowerCase().replace(/[.!?,]/g, "").trim();
      if (blockedNames.includes(low)) return false;
      if (/[0-9@]/.test(line)) return false;

      const words = line.split(/\s+/).filter(Boolean);
      if (words.length < 2 || words.length > 4) return false;

      return words.every(w => /^[A-Za-z'’-]+$/.test(w));
    }) || "";

    const parts = best.split(/\s+/).filter(Boolean);

    return {
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || ""
    };
  }

  function extractCustomer(t) {
    const email = extractEmail(t);
    const phone = extractPhone(t);
    const postcode = extractPostcode(t);
    const name = extractName(t, email, phone, postcode);

    return {
      firstName: name.firstName,
      lastName: name.lastName,
      email: email,
      phone: phone,
      postcode: postcode
    };
  }

  function extractPX(t) {
    const reg = extractReg(t);
    const mileage = extractMileage(t);

    const cleaned = clean(t)
      .replace(reg, " ")
      .replace(mileage, " ")
      .replace(/miles|mile|mi|mileage|registration|reg|make|model|current vehicle|part-exchange|part exchange/ig, " ")
      .replace(/[,:;-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const words = cleaned.split(/\s+/).filter(w => /^[A-Za-z0-9-]+$/.test(w));

    return {
      pxMake: words[0] || "",
      pxModel: words.slice(1, 4).join(" "),
      pxReg: reg,
      pxMileage: mileage
    };
  }

  function setVal(selector, val, overwrite) {
  if (!val) return;

  const matches = Array.from(document.querySelectorAll(selector));
  const el = matches.find(x => x.offsetParent !== null) || matches[0];

  if (!el || (!overwrite && el.value)) return;

  el.focus();

  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(el, "");

  el.dispatchEvent(new Event("input", { bubbles: true }));

  nativeSetter.call(el, val);

  el.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: val
  }));

  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Tab" }));
  el.blur();
}

  function buildData() {
    const messages = getMessages();

    const detailsText = textAfterLatestAgentAnchor(messages, detailAnchors, true);
    const pxText = textAfterLatestAgentAnchor(messages, pxAnchors, false);

    return {
      ...extractCustomer(detailsText),
      ...extractPX(pxText)
    };
  }

  function removePanel() {
    const old = document.getElementById("lpaf-panel");
    if (old) old.remove();
  }

  function showPreview(data) {
    removePanel();

    const panel = document.createElement("div");
    panel.id = "lpaf-panel";
    panel.style.cssText = "position:fixed;right:18px;top:90px;width:340px;background:#040134;color:white;z-index:100000;border:2px solid #000;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:Arial,sans-serif;padding:12px;";

    const title = document.createElement("div");
    title.textContent = "Auto-Fill Preview";
    title.style.cssText = "font-weight:bold;font-size:16px;margin-bottom:10px;";
    panel.appendChild(title);

    const rows = [
      ["firstName", "First Name"],
      ["lastName", "Last Name"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["postcode", "Postcode"],
      ["pxMake", "PX Make"],
      ["pxModel", "PX Model"],
      ["pxReg", "PX Reg"],
      ["pxMileage", "PX Mileage"]
    ];

    const inputs = {};

    rows.forEach(([key, label]) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:block;font-size:12px;margin-bottom:6px;";
      wrap.textContent = label;

      const input = document.createElement("input");
      input.value = data[key] || "";
      input.style.cssText = "width:100%;margin-top:2px;padding:6px;border-radius:4px;border:1px solid #aaa;color:#000;background:#fff;";

      wrap.appendChild(input);
      panel.appendChild(wrap);
      inputs[key] = input;
    });

    const overwriteWrap = document.createElement("label");
    overwriteWrap.style.cssText = "display:flex;gap:6px;align-items:center;font-size:12px;margin:8px 0;";

    const overwrite = document.createElement("input");
    overwrite.type = "checkbox";

    overwriteWrap.appendChild(overwrite);
    overwriteWrap.appendChild(document.createTextNode("Overwrite existing fields"));
    panel.appendChild(overwriteWrap);

    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:8px;margin-top:10px;";

    const fill = document.createElement("button");
    fill.textContent = "Fill";
    fill.style.cssText = "flex:1;padding:8px;border:0;border-radius:4px;background:#f9772e;color:#040134;font-weight:bold;cursor:pointer;";

    fill.onclick = function () {
      rows.forEach(([key]) => {
        setVal(fields[key], inputs[key].value.trim(), overwrite.checked);
      });
      removePanel();
    };

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText = "flex:1;padding:8px;border:1px solid #aaa;border-radius:4px;background:#34416a;color:white;cursor:pointer;";
    cancel.onclick = removePanel;

    buttons.appendChild(fill);
    buttons.appendChild(cancel);
    panel.appendChild(buttons);

    document.body.appendChild(panel);
  }

  function run() {
    const data = buildData();
    console.log("Auto-Fill extracted:", data);
    showPreview(data);
  }

  LPAF.listener = function (e) {
    if (e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  };

  document.addEventListener("keydown", LPAF.listener, true);

  alert("Auto-Fill installed.\n\nPress ALT + D to scan the current chat and preview details.");
})();
