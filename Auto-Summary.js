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
      " right: 32px;" +
      " bottom: 12px;" +
      " width: 14px;" +
      " height: 14px;" +
      " border-radius: 50%;" +
      " background: #f9772e;" +
      " color: #ffffff;" +
      " font-weight: bold;" +
      " font-size: 9px;" +
      " border: 2px solid #000;" +
      " box-shadow: 0 0 4px rgba(0,0,0,0.4);" +
      " cursor: pointer;" +
      " z-index: 99999;" +
      " display: flex;" +
      " align-items: center;" +
      " justify-content: center;" +
      "}" +
      "#lpSumMiniPanel {" +
      " position: fixed;" +
      " top: 0;" +
      " right: -280px;" +
      " width: 280px;" +
      " height: 100vh;" +
      " background: #1e1d49;" +
      " color: #ffffff;" +
      " font-family: Arial, sans-serif;" +
      " font-size: 14px;" +
      " padding: 20px;" +
      " box-shadow: -5px 0 12px rgba(0,0,0,0.35);" +
      " transition: right 0.3s ease;" +
      " z-index: 99998;" +
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
