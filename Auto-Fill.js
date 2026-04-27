(function () {
  console.log("AUTO-FILL V2 LOADED - OLD LOGIC + DEEP FILL");

  if (window.LPAF && window.LPAF.listener) {
    document.removeEventListener("keydown", window.LPAF.listener, true);
  }

  if (window.LPAF2 && window.LPAF2.listener) {
    document.removeEventListener("keydown", window.LPAF2.listener, true);
  }

  const LPAF2 = window.LPAF2 = {};

  const fieldMap = {
    firstName: {
      label: "First Name",
      names: ["firstName"],
      placeholders: ["First Name"]
    },
    lastName: {
      label: "Last Name",
      names: ["lastName"],
      placeholders: ["Last Name"]
    },
    email: {
      label: "Email",
      names: ["email"],
      placeholders: ["Email"]
    },
    phone: {
      label: "Phone",
      names: ["phone"],
      placeholders: ["Phone"]
    },
    postcode: {
      label: "Postcode",
      names: [],
      placeholders: ["Customer's Postcode", "Postcode"]
    },
    pxMake: {
      label: "PX Make",
      names: [],
      placeholders: ["Customer Vehicle Make"]
    },
    pxModel: {
      label: "PX Model",
      names: [],
      placeholders: ["Customer Vehicle Model"]
    },
    pxReg: {
      label: "PX Reg",
      names: [],
      placeholders: ["Customer Vehicle Registration Number", "Registration Number"]
    },
    pxMileage: {
      label: "PX Mileage",
      names: [],
      placeholders: ["Customer Vehicle Mileage", "Mileage"]
    }
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

  const blockedNameLines = [
    "thank you",
    "thanks",
    "no thank you",
    "yes please",
    "no problem",
    "ok thanks",
    "okay thanks",
    "that is fine",
    "sounds good",
    "i have a question",
    "i already have a",
    "just need to",
    "no",
    "yes"
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
        i,
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
      if (anchors.some(a => low.includes(a.toLowerCase()))) idx = i;
    });

    if (idx >= 0) {
      return messages.slice(idx + 1).filter(m => !m.agent).map(m => m.text).join("\n");
    }

    return fallbackAllCustomer
      ? messages.filter(m => !m.agent).map(m => m.text).join("\n")
      : "";
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
      if (blockedNameLines.includes(low)) return false;
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
      email,
      phone,
      postcode
    };
  }

  function extractPX(t) {
    const reg = extractReg(t);
    const mileage = extractMileage(t);

    if (!reg && !mileage) {
      return {
        pxMake: "",
        pxModel: "",
        pxReg: "",
        pxMileage: ""
      };
    }

    const cleaned = clean(t)
      .replace(reg, " ")
      .replace(mileage, " ")
      .replace(/miles|mile|mi|mileage|registration|reg|make|model|current vehicle|part-exchange|part exchange/ig, " ")
      .replace(/[,:;-]/g, " ")
      .replace(/\b(no|yes|i|already|have|a|just|need|to|question)\b/ig, " ")
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

  function buildData() {
    const messages = getMessages();

    const detailsText = textAfterLatestAgentAnchor(messages, detailAnchors, true);
    const pxText = textAfterLatestAgentAnchor(messages, pxAnchors, false);

    return {
      ...extractCustomer(detailsText),
      ...extractPX(pxText)
    };
  }

  function allRoots(root) {
    const roots = [root];

    Array.from(root.querySelectorAll("*")).forEach(el => {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    });

    Array.from(root.querySelectorAll("iframe")).forEach(frame => {
      try {
        if (frame.contentDocument) roots.push(frame.contentDocument);
      } catch (e) {}
    });

    return roots;
  }

  function allFields() {
    let found = [];

    allRoots(document).forEach(root => {
      try {
        found = found.concat(Array.from(root.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='textbox']")));
      } catch (e) {}
    });

    return found;
  }

  function findField(key) {
    const cfg = fieldMap[key];
    const fields = allFields();

    let el = fields.find(f => cfg.names.some(n => f.name === n));
    if (el) return el;

    el = fields.find(f => cfg.placeholders.some(p => (f.placeholder || "").trim() === p));
    if (el) return el;

    el = fields.find(f => cfg.placeholders.some(p => (f.placeholder || "").includes(p)));
    if (el) return el;

    el = fields.find(f => {
      const label = (f.getAttribute("aria-label") || f.getAttribute("data-validate-message") || "").toLowerCase();
      return cfg.placeholders.some(p => label.includes(p.toLowerCase()));
    });

    return el || null;
  }

  function setFieldValue(el, value) {
    if (!el) return false;

    el.focus();
    el.click();

    if (el.tagName === "SELECT") {
      const option = Array.from(el.options).find(o =>
        o.text.trim().toLowerCase() === value.toLowerCase() ||
        o.value.trim().toLowerCase() === value.toLowerCase()
      );

      if (option) {
        el.value = option.value;
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return true;
      }

      return false;
    }

    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return true;
    }

    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
    el.blur();

    return true;
  }

  function fillField(key, value, overwrite) {
    if (!value) return true;

    const el = findField(key);

    console.log("AUTO-FILL V2 FIELD:", key, el, value);

    if (!el) return false;
    if (!overwrite && el.value) return true;

    return setFieldValue(el, value);
  }

  function fillAll(data, overwrite, attempt) {
    attempt = attempt || 0;

    let success = 0;
    const keys = Object.keys(data);

    keys.forEach(key => {
      if (fillField(key, data[key], overwrite)) success++;
    });

    if (success < keys.filter(k => data[k]).length && attempt < 12) {
      console.log("AUTO-FILL V2 RETRY:", attempt);
      setTimeout(() => fillAll(data, overwrite, attempt + 1), 200);
    }
  }

  function removePanel() {
    const old = document.getElementById("lpaf2-panel");
    if (old) old.remove();
  }

  function showPanel(data) {
    removePanel();

    const panel = document.createElement("div");
    panel.id = "lpaf2-panel";
    panel.style.cssText = "position:fixed;right:20px;top:100px;width:340px;background:#040134;color:#fff;padding:12px;z-index:999999;border-radius:8px;font-family:Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);";

    const title = document.createElement("div");
    title.textContent = "Auto-Fill V2 Preview";
    title.style.cssText = "font-weight:bold;font-size:16px;margin-bottom:8px;";
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
      wrap.style.cssText = "display:block;font-size:12px;margin-top:7px;";
      wrap.textContent = label;

      const input = document.createElement("input");
      input.value = data[key] || "";
      input.style.cssText = "width:100%;padding:6px;margin-top:2px;color:#000;background:#fff;border:1px solid #aaa;border-radius:4px;";

      wrap.appendChild(input);
      panel.appendChild(wrap);
      inputs[key] = input;
    });

    const overwriteLabel = document.createElement("label");
    overwriteLabel.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:10px;font-size:12px;";

    const overwrite = document.createElement("input");
    overwrite.type = "checkbox";
    overwrite.checked = true;

    overwriteLabel.appendChild(overwrite);
    overwriteLabel.appendChild(document.createTextNode("Overwrite existing fields"));
    panel.appendChild(overwriteLabel);

    const fillBtn = document.createElement("button");
    fillBtn.textContent = "Fill";
    fillBtn.style.cssText = "width:100%;padding:8px;background:#f9772e;border:0;margin-top:10px;cursor:pointer;font-weight:bold;";

    fillBtn.onclick = function () {
      const finalData = {};
      rows.forEach(([key]) => {
        finalData[key] = inputs[key].value.trim();
      });

      console.log("AUTO-FILL V2 FINAL DATA:", finalData);
      console.log("AUTO-FILL V2 AVAILABLE FIELDS:", allFields().map(i => ({
        tag: i.tagName,
        role: i.getAttribute("role"),
        name: i.name,
        placeholder: i.placeholder,
        aria: i.getAttribute("aria-label"),
        value: i.value
      })));

      fillAll(finalData, overwrite.checked, 0);
      removePanel();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Cancel";
    closeBtn.style.cssText = "width:100%;padding:8px;background:#34416a;color:#fff;border:0;margin-top:6px;cursor:pointer;";
    closeBtn.onclick = removePanel;

    panel.appendChild(fillBtn);
    panel.appendChild(closeBtn);

    document.body.appendChild(panel);
  }

  function run() {
    console.log("AUTO-FILL V2 RUNNING");

    const data = buildData();
    console.log("AUTO-FILL V2 EXTRACTED:", data);

    showPanel(data);
  }

  LPAF2.listener = function (e) {
    if (e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  };

  document.addEventListener("keydown", LPAF2.listener, true);

  alert("Auto-Fill V2 installed. Press ALT + F to run.");
})();
