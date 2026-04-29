(function () {
  if (window.LPAF3 && window.LPAF3.listener) {
    document.removeEventListener("keydown", window.LPAF3.listener, true);
  }

  const LPAF3 = window.LPAF3 = {};

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

  function forceInput(el, value) {
    if (!el || !value) return;

    el.focus();
    el.click();
    el.select && el.select();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);

    el.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: value
    }));

    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  function findInForm(form, matcher) {
    return Array.from(form.querySelectorAll("input"))
      .find(input => matcher(input));
  }

  function fillFromActiveField() {
    const active = document.activeElement;

    if (!active || active.tagName !== "INPUT") {
      alert("Click inside the First Name box first, then press ALT + F.");
      return;
    }

    const form = active.closest("form") || active.closest("#vue-app") || document;

    const data = extract();
    console.log("AUTO-FILL ACTIVE-FORM DATA:", data);

    const targets = {
      firstName: active.name === "firstName" ? active : findInForm(form, i => i.name === "firstName" || i.placeholder === "First Name"),
      lastName: findInForm(form, i => i.name === "lastName" || i.placeholder === "Last Name"),
      email: findInForm(form, i => i.name === "email" || i.placeholder === "Email"),
      phone: findInForm(form, i => i.name === "phone" || i.placeholder === "Phone"),
      postcode: findInForm(form, i => (i.placeholder || "").includes("Postcode"))
    };

    console.log("AUTO-FILL ACTIVE-FORM TARGETS:", targets);

    forceInput(targets.firstName, data.firstName);
    forceInput(targets.lastName, data.lastName);
    forceInput(targets.email, data.email);
    forceInput(targets.phone, data.phone);
    forceInput(targets.postcode, data.postcode);
  }

  LPAF3.listener = function (e) {
    if (e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      fillFromActiveField();
    }
  };

  document.addEventListener("keydown", LPAF3.listener, true);

  alert("Auto-Fill V3 installed.\n\nClick First Name, then press ALT + F.");
})();
