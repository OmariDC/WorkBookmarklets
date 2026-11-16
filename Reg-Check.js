(function () {
  // Prevent installing the hotkey twice
  if (window._regCheckHotkeyInstalled) return;
  window._regCheckHotkeyInstalled = true;

  const CHECKER_BASE =
    "https://www.stellantisandyou.co.uk/used-vehicles/results?maxPayment=1900&registration=";
  const NOTICE_ID = "_regCheckNotice";
  const GREEN = "#34c38f";
  const AMBER = "#f0a020";

  // A whole registration or part of one: letters and digits only, up to the
  // length of a registration. Part of one is searched as it stands, for a
  // customer who does not know all of theirs.
  const REG_OR_PART = /^[A-Z0-9]{2,8}$/;

  // What is highlighted, in the page or inside a box being typed in (a
  // box's highlighted text is not part of the page's own selection).
  function highlighted() {
    const box = document.activeElement;
    if (box && (box.tagName === "TEXTAREA" || (box.tagName === "INPUT" && /^(text|search|tel|)$/i.test(box.type || "")))) {
      try {
        const inBox = String(box.value || "").slice(box.selectionStart, box.selectionEnd);
        if (inBox) return inBox;
      } catch (error) { /* this kind of box has no selection */ }
    }
    const selection = window.getSelection();
    return String(selection ? selection.toString() : "");
  }

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

    const reg = highlighted().toUpperCase().replace(/\s+/g, "");
    if (!reg) {
      notice("Reg Check:", "highlight a registration first.", AMBER);
      return;
    }
    if (!REG_OR_PART.test(reg)) {
      notice("Reg Check:", "highlight just the registration, or part of it (letters and numbers only).", AMBER);
      return;
    }

    window.open(CHECKER_BASE + encodeURIComponent(reg), "_blank");
  });

  notice("Reg Check is on.", "Highlight a registration, or part of one, and press Alt+R.", GREEN);
})();
