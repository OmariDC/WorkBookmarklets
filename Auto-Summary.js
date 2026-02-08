/* =========================
   UI ADDON – ENGINE UNCHANGED
   ========================= */

(function () {
  if (!window._lpSumMini || window._lpSumMini._uiAddonLoaded) return;
  window._lpSumMini._uiAddonLoaded = true;

  function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- Styles ---------- */

  var style = el("style");
  style.textContent =
    "#lpMiniToggle{" +
    "position:fixed;bottom:12px;right:64px;width:14px;height:14px;" +
    "border-radius:50%;background:#1e1d49;border:2px solid #000;" +
    "box-shadow:0 0 4px rgba(0,0,0,.4);cursor:pointer;z-index:100001}" +

    "#lpMiniPanel{" +
    "position:fixed;top:0;right:0;width:280px;height:100vh;" +
    "background:#1e1d49;color:#fff;font-family:Arial;font-size:13px;" +
    "padding:16px;box-shadow:-4px 0 10px rgba(0,0,0,.4);" +
    "transform:translateX(100%);opacity:0;pointer-events:none;" +
    "transition:transform .25s ease,opacity .25s ease;" +
    "z-index:100000}" +

    "#lpMiniPanel.open{transform:translateX(0);opacity:1;pointer-events:auto}" +

    ".lpMiniRow{background:rgba(255,255,255,.08);padding:6px 8px;" +
    "border-radius:4px;margin-bottom:6px;cursor:pointer}" +

    ".lpMiniRow span{font-weight:bold;display:block;font-size:11px;opacity:.8}" +

    ".lpMiniRow:hover{background:rgba(255,255,255,.18)}";

  document.head.appendChild(style);

  /* ---------- UI ---------- */

  var toggle = el("div");
  toggle.id = "lpMiniToggle";

  var panel = el("div");
  panel.id = "lpMiniPanel";

  toggle.onclick = function () {
    panel.classList.toggle("open");
  };

  function addRow(label) {
    var row = el("div", "lpMiniRow");
    var l = el("span", null, label);
    var v = el("div");

    row.appendChild(l);
    row.appendChild(v);

    row.onclick = function () {
      copyText(v.textContent);
    };

    panel.appendChild(row);

    return function (value) {
      v.textContent = value || "";
    };
  }

  var setName = addRow("Name");
  var setEmail = addRow("Email");
  var setPhone = addRow("Phone");
  var setAddress = addRow("Address");

  panel.appendChild(el("h3", null, "Part Exchange"));

  var setPxReg = addRow("PX Reg");
  var setPxVehicle = addRow("PX Vehicle");
  var setPxMileage = addRow("PX Mileage");

  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  /* ---------- Bind to EXISTING engine data ---------- */

  function refreshFromEngine() {
    var d = window._lpSumMini.data || {};

    setName(d.fullName || "");
    setEmail(d.email || "");
    setPhone(d.phone || "");
    setAddress(d.address || "");

    setPxReg(d.pxReg || "");
    setPxVehicle([d.pxMake, d.pxModel].filter(Boolean).join(" "));
    setPxMileage(d.pxMileage || "");
  }

  // Hook safely into the existing render cycle
  var originalForceRender = window._lpSumMini_forceRender;
  window._lpSumMini_forceRender = function () {
    if (originalForceRender) originalForceRender();
    refreshFromEngine();
  };

  refreshFromEngine();
})();
