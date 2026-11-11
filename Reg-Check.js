(function () {
  // Prevent installing the hotkey twice
  if (window._regCheckHotkeyInstalled) return;
  window._regCheckHotkeyInstalled = true;

  const CHECKER_BASE =
    "https://www.stellantisandyou.co.uk/used-vehicles/results?maxPayment=1900&registration=";
  const NOTICE_ID = "_regCheckNotice";

  // UK registrations: current (AB12CDE), prefix (A123BCD), suffix (ABC123D),
  // and dateless or Northern Irish (letters then digits, or digits then
  // letters).
  const UK_REG =
    /^(?:[A-Z]{2}\d{2}[A-Z]{3}|[A-Z]\d{1,3}[A-Z]{3}|[A-Z]{3}\d{1,3}[A-Z]|[A-Z]{1,3}\d{1,4}|\d{1,4}[A-Z]{1,3})$/;

  // A short notice that goes by itself, so nothing waits on a click (a
  // pop up would hold up the automatic runs on the page).
  function notice(text) {
    const old = document.getElementById(NOTICE_ID);
    if (old) old.remove();
    if (!document.body) return;
    const box = document.createElement("div");
    box.id = NOTICE_ID;
    box.setAttribute("role", "status");
    box.textContent = text;
    box.style.cssText =
      "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483000;" +
      "max-width:calc(100vw - 32px);padding:10px 16px;border-radius:12px;background:#1c1c1e;color:#fff;" +
      'font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      "box-shadow:0 10px 30px rgba(0,0,0,0.3);pointer-events:none";
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3500);
  }

  document.addEventListener("keydown", function (e) {
    // Some key events (autofill, for one) carry no key at all.
    if (!e.altKey || typeof e.key !== "string" || e.key.toLowerCase() !== "r") return;

    const selection = window.getSelection();
    const reg = String(selection ? selection.toString() : "").toUpperCase().replace(/\s+/g, "");
    if (!reg) {
      notice("Reg Check: highlight a registration first.");
      return;
    }
    if (!UK_REG.test(reg)) {
      notice("Reg Check: that does not look like a registration. Highlight just the reg.");
      return;
    }

    window.open(CHECKER_BASE + encodeURIComponent(reg), "_blank");
  });

  notice("Reg Check is on. Highlight a reg and press Alt + R.");
})();
