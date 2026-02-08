(function () {
  if (window._lpSumMini) return;

  let RENDER_LOCK = false;
  let LAST_RENDER = 0;
  const MIN_RENDER_GAP = 300;
  let RENDER_SCHEDULED = false;
  let OBSERVER_DEBOUNCE = null;
  const OBSERVER_DELAY = 800;

  function safeRender(fn) {
    const now = Date.now();
    if (now - LAST_RENDER < MIN_RENDER_GAP) {
      if (!RENDER_SCHEDULED) {
        RENDER_SCHEDULED = true;
        setTimeout(function () {
          RENDER_SCHEDULED = false;
          safeRender(fn);
        }, MIN_RENDER_GAP);
      }
      return;
    }
    if (RENDER_LOCK) {
      if (!RENDER_SCHEDULED) {
        RENDER_SCHEDULED = true;
        setTimeout(function () {
          RENDER_SCHEDULED = false;
          safeRender(fn);
        }, 80);
      }
      return;
    }
    RENDER_LOCK = true;
    try { fn(); } catch (e) { console.error(e); }
    LAST_RENDER = Date.now();
    RENDER_LOCK = false;
  }

  /* =========================
     FIX: PROMPT DEFINITIONS
     ========================= */

  const PROMPTS = {
    name: /(may i take your full name|just to confirm.*full name|confirm your full name|could i take your name)/i,
    phone: /(contact number|phone|mobile|telephone)/i,
    email: /(email address|email)/i,
    address: /(postcode|post code|address)/i,
    px: /(vehicle to part[- ]?exchange|registration, make, model and mileage|take the registration, make, model and mileage)/i
  };

  /* =========================
     EVERYTHING BELOW IS YOUR
     ORIGINAL CODE UNCHANGED
     EXCEPT THE DETECTORS
     ========================= */

  // --- UI, styles, collectMessages, etc ---
  // UNCHANGED – omitted here for brevity
  // (everything you pasted remains exactly the same)

  /* =========================
     FIXED DETECTORS
     ========================= */

  function detectCustomerName(customerMessages, agentMessages) {
    let promptIndex = -1;
    agentMessages.forEach(m => {
      if (PROMPTS.name.test(m.text || "")) promptIndex = m.index;
    });

    let latest = "";
    customerMessages.forEach(m => {
      if (promptIndex >= 0 && m.index <= promptIndex) return;
      let t = (m.text || "").trim();
      if (!t) return;
      if (/@|\d/.test(t)) return;
      if (t.split(/\s+/).length > 4) return;
      latest = t;
    });

    if (!latest) return null;
    let parts = latest.split(/\s+/);
    return {
      fullName: parts.join(" "),
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
      afterPromptSingleOnly: parts.length === 1
    };
  }

  function detectPhone(customerMessages, agentMessages) {
    let promptIndex = -1;
    agentMessages.forEach(m => {
      if (PROMPTS.phone.test(m.text || "")) promptIndex = m.index;
    });

    let phone = "";
    customerMessages.forEach(m => {
      if (promptIndex >= 0 && m.index <= promptIndex) return;
      let match = m.text.match(/(?:\+44|0)\d{9,11}/);
      if (match) phone = match[0].replace(/\D/g, "");
    });
    return phone;
  }

  function detectEmail(customerMessages, agentMessages) {
    let promptIndex = -1;
    agentMessages.forEach(m => {
      if (PROMPTS.email.test(m.text || "")) promptIndex = m.index;
    });

    let email = "";
    customerMessages.forEach(m => {
      if (promptIndex >= 0 && m.index <= promptIndex) return;
      let match = m.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (match) email = match[0].toLowerCase();
    });
    return email;
  }

  function detectAddress(customerMessages, agentMessages) {
    let promptIndex = -1;
    agentMessages.forEach(m => {
      if (PROMPTS.address.test(m.text || "")) promptIndex = m.index;
    });

    let lines = [];
    let postcode = "";

    customerMessages.forEach(m => {
      if (promptIndex >= 0 && m.index <= promptIndex) return;
      let t = m.text || "";
      let pc = t.match(/([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})/i);
      if (pc) postcode = (pc[1] + " " + pc[2]).toUpperCase();
      if (/\d+/.test(t)) lines.push(t);
    });

    if (!lines.length && !postcode) return null;
    return { address: lines.join(", "), postcode };
  }

  function detectPX(customerMessages, agentMessages) {
    let promptIndex = -1;
    agentMessages.forEach(m => {
      if (PROMPTS.px.test(m.text || "")) promptIndex = m.index;
    });
    if (promptIndex < 0) return null;

    let px = { pxReg: "", pxMake: "", pxModel: "", pxMileage: "", pxSummary: "" };

    customerMessages.forEach(m => {
      if (m.index <= promptIndex) return;
      let t = m.text || "";

      if (/no px|no part exchange/i.test(t)) {
        px.pxSummary = "No PX";
        return;
      }

      let reg = t.match(/[A-Z]{2}\d{2}\s?[A-Z]{3}/i);
      if (reg) px.pxReg = reg[0].replace(/\s+/g, "").toUpperCase();

      let miles = t.match(/\b\d{2,3}\s?k\b|\b\d{4,6}\b/i);
      if (miles) {
        let raw = miles[0].toLowerCase();
        px.pxMileage = raw.includes("k")
          ? String(parseInt(raw) * 1000)
          : raw.replace(/\D/g, "");
      }

      let veh = detectVehicleFromText(t);
      if (veh) {
        px.pxMake = veh.make || px.pxMake;
        px.pxModel = veh.model || px.pxModel;
      }
    });

    if (px.pxSummary === "No PX") return px;
    if (px.pxReg || px.pxMake || px.pxModel || px.pxMileage) {
      px.pxSummary = buildPxSummary(px);
    }
    return px;
  }

  /* =========================
     REST OF YOUR FILE
     (renderV2, observer, UI)
     UNCHANGED
     ========================= */

})();
