(function () {
  console.log("AUTO-FILL V2 LOADED");

  if (window.LPAF && window.LPAF.listener) {
    document.removeEventListener("keydown", window.LPAF.listener, true);
  }

  if (window.LPAF2 && window.LPAF2.listener) {
    document.removeEventListener("keydown", window.LPAF2.listener, true);
  }

  const LPAF2 = window.LPAF2 = {};

  const selectors = {
    firstName: () => document.querySelector('input[name="firstName"]'),
    lastName: () => document.querySelector('input[name="lastName"]'),
    email: () => document.querySelector('input[name="email"]'),
    phone: () => document.querySelector('input[name="phone"]'),
    postcode: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder && i.placeholder.includes("Postcode")),
    pxMake: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder === "Customer Vehicle Make"),
    pxModel: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder === "Customer Vehicle Model"),
    pxReg: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder === "Customer Vehicle Registration Number"),
    pxMileage: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder === "Customer Vehicle Mileage")
  };

  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function fillField(key, value, overwrite) {
    if (!value) return true;

    const el = selectors[key]();

    console.log("AUTO-FILL V2 FIELD:", key, el, value);

    if (!el) return false;
    if (!overwrite && el.value) return true;

    setValue(el, value);
    return true;
  }

  function fillAll(data, overwrite, attempt) {
    attempt = attempt || 0;

    let success = 0;
    Object.keys(data).forEach(key => {
      if (fillField(key, data[key], overwrite)) success++;
    });

    if (success < 5 && attempt < 15) {
      console.log("AUTO-FILL V2 RETRY:", attempt);
      setTimeout(() => fillAll(data, overwrite, attempt + 1), 200);
    }
  }

  function clean(t) {
    return String(t || "")
      .replace(/\u00a0/g, " ")
      .replace(/[|/]+/g, "\n")
      .replace(/\.{2,}/g, "\n")
      .trim();
  }

  function isAgent(el) {
    const msg = el.closest(".message");
    return !!(msg && msg.classList.contains("assigned-agent"));
  }

  function getCustomerText() {
    const messages = Array.from(document.querySelectorAll(".html-content.text-content"))
      .map(el => ({
        text: clean(el.innerText || el.textContent || ""),
        agent: isAgent(el)
      }))
      .filter(m => m.text);

    return messages.filter(m => !m.agent).map(m => m.text).join("\n");
  }

  function extract() {
    const text = getCustomerText();

    const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];
    const phone = (text.match(/(?:\+44\s?7\d{3}|07\d{3})[\s.-]?\d{3}[\s.-]?\d{3}/i) || [""])[0].replace(/[^\d+]/g, "");
    const postcode = (text.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [""])[0]
      .replace(/\s+/g, "")
      .replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");

    const cleaned = clean(text)
      .replace(email, "\n")
      .replace(phone, "\n")
      .replace(postcode, "\n");

    const nameLine = cleaned.split(/\n+/).map(x => x.trim()).find(line => {
      if (!line) return false;
      if (/[0-9@]/.test(line)) return false;
      const low = line.toLowerCase().replace(/[.!?,]/g, "");
      if (["thank you", "thanks", "no thank you", "yes please", "no problem"].includes(low)) return false;
      const words = line.split(/\s+/);
      return words.length >= 2 && words.length <= 4;
    }) || "";

    const nameParts = nameLine.split(/\s+/).filter(Boolean);

    return {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      email,
      phone,
      postcode
    };
  }

  function removePanel() {
    const old = document.getElementById("lpaf2-panel");
    if (old) old.remove();
  }

  function showPanel(data) {
    removePanel();

    const panel = document.createElement("div");
    panel.id = "lpaf2-panel";
    panel.style.cssText = "position:fixed;right:20px;top:100px;width:330px;background:#040134;color:#fff;padding:12px;z-index:999999;border-radius:8px;font-family:Arial,sans-serif;";

    panel.innerHTML = "<b>Auto-Fill V2 Preview</b>";

    const rows = [
      ["firstName", "First Name"],
      ["lastName", "Last Name"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["postcode", "Postcode"]
    ];

    const inputs = {};

    rows.forEach(([key, label]) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:block;font-size:12px;margin-top:8px;";
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
      rows.forEach(([key]) => finalData[key] = inputs[key].value.trim());

      console.log("AUTO-FILL V2 FINAL DATA:", finalData);
      console.log("AUTO-FILL V2 AVAILABLE INPUTS:", Array.from(document.querySelectorAll("input")).map(i => ({
        name: i.name,
        placeholder: i.placeholder,
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

    const data = extract();
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
