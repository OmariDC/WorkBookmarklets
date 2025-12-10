(function () {
  // Prevent installing the hotkey twice
  if (window._regCheckHotkeyInstalled) return;
  window._regCheckHotkeyInstalled = true;

  const CHECKER_BASE =
    "https://www.stellantisandyou.co.uk/used-vehicles/results?maxPayment=1900&registration=";

  document.addEventListener("keydown", function (e) {
    if (!e.altKey || e.key.toLowerCase() !== "r") return;

    const sel = window.getSelection().toString().trim();
    if (!sel) {
      alert("Highlight a registration first.");
      return;
    }

    const reg = sel.replace(/\s+/g, "");
    const url = CHECKER_BASE + encodeURIComponent(reg);

    window.open(url, "_blank");
  });

  alert("REG Hotkey installed.\n\nHighlight a reg and press ALT + R");
})();
