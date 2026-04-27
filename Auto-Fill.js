(function () {
  if (window.LPAF && window.LPAF.listener) {
    document.removeEventListener("keydown", window.LPAF.listener, true);
  }

  const LPAF = window.LPAF = {};

  const selectors = {
    firstName: () => document.querySelector('input[name="firstName"]'),
    lastName: () => document.querySelector('input[name="lastName"]'),
    email: () => document.querySelector('input[name="email"]'),
    phone: () => document.querySelector('input[name="phone"]'),
    postcode: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder?.includes("Postcode")),
    pxMake: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder?.includes("Make")),
    pxModel: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder?.includes("Model")),
    pxReg: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder?.includes("Registration")),
    pxMileage: () => Array.from(document.querySelectorAll("input")).find(i => i.placeholder?.includes("Mileage"))
  };

  function setReactValue(el, value) {
    if (!el) return;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;

    nativeSetter.call(el, value);

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillField(key, value, overwrite) {
    if (!value) return;

    const el = selectors[key]();

    console.log("FILL ATTEMPT:", key, el, value);

    if (!el) return false;
    if (!overwrite && el.value) return true;

    el.focus();
    setReactValue(el, value);

    return true;
  }

  function fillAll(data, overwrite, attempt = 0) {
    let successCount = 0;

    Object.keys(data).forEach(key => {
      if (fillField(key, data[key], overwrite)) {
        successCount++;
      }
    });

    // retry if fields missing (Vue render delay)
    if (successCount < 3 && attempt < 10) {
      console.log("Retrying fill...", attempt);
      setTimeout(() => fillAll(data, overwrite, attempt + 1), 200);
    }
  }

  function extract() {
    const text = Array.from(document.querySelectorAll(".html-content.text-content"))
      .map(el => el.innerText)
      .join("\n");

    const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];
    const phone = (text.match(/07\d{9}/) || [""])[0];
    const postcode = (text.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i) || [""])[0];

    const nameMatch = text.match(/\b([A-Z][a-z]+)\s([A-Z][a-z]+)/);
    const firstName = nameMatch ? nameMatch[1] : "";
    const lastName = nameMatch ? nameMatch[2] : "";

    return {
      firstName,
      lastName,
      email,
      phone,
      postcode
    };
  }

  function showPanel(data) {
    const panel = document.createElement("div");
    panel.style.cssText = "position:fixed;right:20px;top:100px;width:300px;background:#040134;color:#fff;padding:12px;z-index:99999;border-radius:8px;";

    const fillBtn = document.createElement("button");
    fillBtn.textContent = "Fill";
    fillBtn.style.cssText = "width:100%;padding:8px;background:#f9772e;border:0;margin-top:10px;cursor:pointer;";

    fillBtn.onclick = () => {
      fillAll(data, true);
      panel.remove();
    };

    panel.innerHTML = "<b>Auto-Fill Ready</b>";
    panel.appendChild(fillBtn);

    document.body.appendChild(panel);
  }

  function run() {
    const chatArea = document.querySelector(".html-content.text-content");
    if (chatArea) {
      chatArea.click();
    }

    setTimeout(() => {
      const data = extract();
      console.log("EXTRACTED:", data);
      showPanel(data);
    }, 150);
  }

  LPAF.listener = function (e) {
    if (e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  };

  document.addEventListener("keydown", LPAF.listener, true);

  alert("Auto-Fill installed. ALT + D to run.");
})();
