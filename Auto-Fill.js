(function () {
  if (window.LPAF4 && window.LPAF4.cleanup) {
    window.LPAF4.cleanup();
  }

  const LPAF4 = window.LPAF4 = {};
  let lastInput = null;

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
    return Array.from(document.querySelectorAll(".html-content.text-content"))
      .map(el => ({
        text: clean(el.innerText || el.textContent || ""),
        agent: isAgent(el)
      }))
      .filter(m => m.text && !m.agent)
      .map(m => m.text)
      .join("\n");
  }

  function extract() {
    const text = getCustomerText();

    const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];

    const phone = ((text.match(/(?:\+44\s?7\d{3}|07\d{3})[\s.-]?\d{3}[\s.-]?\d{3}/i) || [""])[0])
      .replace(/[^\d+]/g, "");

    const postcode = ((text.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [""])[0])
      .replace(/\s+/g, "")
      .replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");

    const nameText = clean(text)
      .replace(email, "\n")
      .replace(phone, "\n")
      .replace(postcode, "\n");

    const nameLine = nameText.split(/\n+/).map(x => x.trim()).find(line => {
      if (!line || /[0-9@]/.test(line)) return false;
      const low = line.toLowerCase().replace(/[.!?,]/g, "").trim();
      if (["thank you", "thanks", "no thank you", "yes please", "no problem"].includes(low)) return false;
      const words = line.split(/\s+/);
      return words.length >= 2 && words.length <= 4;
    }) || "";

    const parts = nameLine.split(/\s+/).filter(Boolean);

    return {
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || "",
      email,
      phone,
      postcode
    };
  }

  function rememberInput(e) {
    const el = e.target;
    if (el && el.tagName === "INPUT") {
      lastInput = el;
      console.log("AF remembered input:", el);
    }
  }

  function setInput(el, value) {
    if (!el || !value) return;

    el.focus();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function findInput(form, matcher) {
    return Array.from(form.querySelectorAll("input")).find(matcher);
  }

  function fill() {
    if (!lastInput) {
      alert("Click inside the First Name box first.");
      return;
    }

    const form = lastInput.closest("form") || lastInput.closest("#vue-app") || document;
    const data = extract();

    const targets = {
      firstName: findInput(form, i => i.name === "firstName" || i.placeholder === "First Name"),
      lastName: findInput(form, i => i.name === "lastName" || i.placeholder === "Last Name"),
      email: findInput(form, i => i.name === "email" || i.placeholder === "Email"),
      phone: findInput(form, i => i.name === "phone" || i.placeholder === "Phone"),
      postcode: findInput(form, i => (i.placeholder || "").includes("Postcode"))
    };

    console.log("AF data:", data);
    console.log("AF targets:", targets);

    setInput(targets.firstName, data.firstName);
    setInput(targets.lastName, data.lastName);
    setInput(targets.email, data.email);
    setInput(targets.phone, data.phone);
    setInput(targets.postcode, data.postcode);
  }

  document.addEventListener("mousedown", rememberInput, true);

  const btn = document.createElement("button");
  btn.id = "lpaf4-btn";
  btn.textContent = "AF";
  btn.title = "Auto-Fill";
  btn.style.cssText = "position:fixed;right:18px;bottom:54px;width:34px;height:34px;border-radius:50%;background:#f9772e;color:#040134;border:2px solid #000;z-index:999999;font-weight:bold;cursor:pointer;";
  btn.onclick = fill;
  document.body.appendChild(btn);

  LPAF4.cleanup = function () {
    document.removeEventListener("mousedown", rememberInput, true);
    const old = document.getElementById("lpaf4-btn");
    if (old) old.remove();
  };

  alert("Auto-Fill V4 installed.\n\nClick First Name, then click the AF button.");
})();
