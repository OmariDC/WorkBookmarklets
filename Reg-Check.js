(function () {
  // Prevent installing the hotkey twice
  if (window._regCheckHotkeyInstalled) return;
  window._regCheckHotkeyInstalled = true;

  const CHECKER_BASE =
    "https://www.stellantisandyou.co.uk/used-vehicles/results?maxPayment=1900&registration=";
  const NOTICE_ID = "_regCheckNotice";
  const GREEN = "#34c38f";
  const AMBER = "#f0a020";

  // UK registrations: current (AB12CDE), prefix (A123BCD), suffix (ABC123D),
  // and dateless or Northern Irish (letters then digits, or digits then
  // letters).
  const UK_REG =
    /^(?:[A-Z]{2}\d{2}[A-Z]{3}|[A-Z]\d{1,3}[A-Z]{3}|[A-Z]{3}\d{1,3}[A-Z]|[A-Z]{1,3}\d{1,4}|\d{1,4}[A-Z]{1,3})$/;

  // A short notice that goes by itself, so nothing waits on a click (a
  // pop up would hold up the automatic runs on the page). The dot is green
  // for "on" and amber when the highlighted text cannot be used.
  function notice(lead, text, dotColour) {
    const old = document.getElementById(NOTICE_ID);
    if (old) old.remove();
    if (!document.body) return;
    const box = document.createElement("div");
    box.id = NOTICE_ID;
    box.setAttribute("role", "status");
    box.style.cssText =
      "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483000;" +
      "display:flex;align-items:center;gap:8px;" +
      "max-width:calc(100vw - 32px);padding:9px 14px;border-radius:12px;background:#2b3038;color:#fff;" +
      'font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      "box-shadow:0 10px 30px rgba(0,0,0,0.3);pointer-events:none";
    const dot = document.createElement("span");
    dot.style.cssText = "flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:" + dotColour;
    const words = document.createElement("span");
    const strong = document.createElement("b");
    strong.style.fontWeight = "700";
    strong.textContent = lead;
    words.appendChild(strong);
    if (text) words.appendChild(document.createTextNode(" " + text));
    box.appendChild(dot);
    box.appendChild(words);
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3500);
  }

  document.addEventListener("keydown", function (e) {
    // Some key events (autofill, for one) carry no key at all.
    if (!e.altKey || typeof e.key !== "string" || e.key.toLowerCase() !== "r") return;

    const selection = window.getSelection();
    const reg = String(selection ? selection.toString() : "").toUpperCase().replace(/\s+/g, "");
    if (!reg) {
      notice("Reg Check:", "highlight a registration first.", AMBER);
      return;
    }
    if (!UK_REG.test(reg)) {
      notice("Reg Check:", "that does not look like a registration. Highlight just the registration.", AMBER);
      return;
    }

    window.open(CHECKER_BASE + encodeURIComponent(reg), "_blank");
  });

  notice("Reg Check is on.", "", GREEN);
})();
