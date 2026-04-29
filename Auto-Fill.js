(function () {
  if (window.LPAF_FINAL && window.LPAF_FINAL.listener) {
    document.removeEventListener("keydown", window.LPAF_FINAL.listener, true);
  }

  const LPAF_FINAL = window.LPAF_FINAL = {};

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
    "thank you", "thanks", "no thank you", "yes please", "no problem",
    "ok thanks", "okay thanks", "that is fine", "sounds good",
    "i have a question", "i already have a", "just need to", "no", "yes"
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

  function textAfterAnchor(messages, anchors, fallbackAllCustomer) {
    let idx = -1;

    messages.forEach((m, i) => {
      if (!m.agent) return;
      const low = m.text.toLowerCase();
      if (anchors.some(a => low.includes(a))) idx = i;
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
      return { pxMake: "", pxModel: "", pxReg: "", pxMileage: "" };
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
    const detailsText = textAfterAnchor(messages, detailAnchors, true);
    const pxText = textAfterAnchor(messages, pxAnchors, false);

    return {
      ...extractCustomer(detailsText),
      ...extractPX(pxText)
    };
  }

  function setInput(el, value) {
    if (!el || !value) return false;

    el.focus();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
  }

  function findTargetsFresh() {
    const inputs = Array.from(document.querySelectorAll("input"));

    return {
      firstName: document.querySelector('input[name="firstName"]'),
      lastName: document.querySelector('input[name="lastName"]'),
      email: document.querySelector('input[name="email"]'),
      phone: document.querySelector('input[name="phone"]'),
      postcode: inputs.find(i => (i.placeholder || "").includes("Postcode")),
      pxMake: inputs.find(i => i.placeholder === "Customer Vehicle Make"),
      pxModel: inputs.find(i => i.placeholder === "Customer Vehicle Model"),
      pxReg: inputs.find(i => i.placeholder === "Customer Vehicle Registration Number"),
      pxMileage: inputs.find(i => i.placeholder === "Customer Vehicle Mileage")
    };
  }

  function removePanel() {
    const old = document.getElementById("lpaf-final-panel");
    if (old) old.remove();
  }

  function showPanel(data) {
    removePanel();

    const panel = document.createElement("div");
    panel.id = "lpaf-final-panel";
    panel.style.cssText = "position:fixed;right:20px;top:100px;width:340px;background:#040134;color:#fff;padding:12px;z-index:999999;border-radius:8px;font-family:Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);";

    const title = document.createElement("div");
    title.textContent = "Auto-Fill Preview";
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

    const previewInputs = {};

    rows.forEach(([key, label]) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:block;font-size:12px;margin-top:7px;";
      wrap.textContent = label;

      const input = document.createElement("input");
      input.value = data[key] || "";
      input.style.cssText = "width:100%;padding:6px;margin-top:2px;color:#000;background:#fff;border:1px solid #aaa;border-radius:4px;";

      wrap.appendChild(input);
      panel.appendChild(wrap);
      previewInputs[key] = input;
    });

    const fillBtn = document.createElement("button");
    fillBtn.textContent = "Fill";
    fillBtn.style.cssText = "width:100%;padding:8px;background:#f9772e;color:#040134;border:0;margin-top:10px;cursor:pointer;font-weight:bold;border-radius:4px;";

    fillBtn.onclick = function () {
      const finalData = {};
      rows.forEach(([key]) => {
        finalData[key] = previewInputs[key].value.trim();
      });

      const targets = findTargetsFresh();

      console.log("AUTO-FILL FINAL DATA:", finalData);
      console.log("AUTO-FILL TARGETS:", targets);

      setInput(targets.firstName, finalData.firstName);
      setInput(targets.lastName, finalData.lastName);
      setInput(targets.email, finalData.email);
      setInput(targets.phone, finalData.phone);
      setInput(targets.postcode, finalData.postcode);
      setInput(targets.pxMake, finalData.pxMake);
      setInput(targets.pxModel, finalData.pxModel);
      setInput(targets.pxReg, finalData.pxReg);
      setInput(targets.pxMileage, finalData.pxMileage);

      removePanel();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Cancel";
    closeBtn.style.cssText = "width:100%;padding:8px;background:#34416a;color:#fff;border:0;margin-top:6px;cursor:pointer;border-radius:4px;";
    closeBtn.onclick = removePanel;

    panel.appendChild(fillBtn);
    panel.appendChild(closeBtn);
    document.body.appendChild(panel);
  }

  function run() {
    const data = buildData();
    console.log("AUTO-FILL EXTRACTED:", data);
    showPanel(data);
  }

  LPAF_FINAL.listener = function (e) {
    if (e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  };

  document.addEventListener("keydown", LPAF_FINAL.listener, true);

  alert("Auto-Fill installed.\n\nPress ALT + F to preview, then click Fill.");
})();
