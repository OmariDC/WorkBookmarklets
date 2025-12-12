(function () {
  if (window._lpSumMini) return;
  window._lpSumMini = true;

  var STYLE_ID = "lp-sum-mini-style";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#lpSumMiniBtn {" +
      " position: fixed;" +
      " right: 16px;" +
      " bottom: 90px;" +
      " width: 40px;" +
      " height: 40px;" +
      " border-radius: 50%;" +
      " background: #f9772e;" +
      " color: #ffffff;" +
      " font-weight: bold;" +
      " font-size: 11px;" +
      " border: none;" +
      " box-shadow: 0 4px 12px rgba(0,0,0,0.35);" +
      " cursor: pointer;" +
      " z-index: 999999;" +
      "}" +
      "#lpSumMiniPanel {" +
      " position: fixed;" +
      " top: 0;" +
      " right: -300px;" +
      " width: 280px;" +
      " height: 100vh;" +
      " background: #1e1d49;" +
      " color: #ffffff;" +
      " font-family: Arial, sans-serif;" +
      " font-size: 14px;" +
      " padding: 20px;" +
      " box-shadow: -5px 0 12px rgba(0,0,0,0.35);" +
      " transition: right 0.3s ease;" +
      " z-index: 999998;" +
      "}" +
      "#lpSumMiniPanel.open {" +
      " right: 0;" +
      "}";
    document.head.appendChild(style);
  }

  function createUI() {
    injectStyles();

    var btn = document.createElement("button");
    btn.id = "lpSumMiniBtn";
    btn.textContent = "SUM";

    var panel = document.createElement("div");
    panel.id = "lpSumMiniPanel";
    panel.textContent = "Auto-Summary - Ready";

    btn.onclick = function () {
      panel.classList.toggle("open");
    };

    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  createUI();
})();
