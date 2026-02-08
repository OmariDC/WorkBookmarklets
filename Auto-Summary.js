/* ============================================================
   LOGIC OVERRIDES PATCH
   - engine, UI, observers untouched
   - booking summary logic disabled
   ============================================================ */

(function () {
  if (!window._lpSumMini) return;

  /* =========================
     HELPER: prompt index
     ========================= */

  function lastPromptIndex(agentMessages, regex) {
    var idx = -1;
    agentMessages.forEach(function (m) {
      if (regex.test(m.text || "")) idx = m.index;
    });
    return idx;
  }

  /* =========================
     OVERRIDE: NAME
     ========================= */

  window.detectCustomerName = function (customerMessages, agentMessages) {
    var promptIdx = lastPromptIndex(
      agentMessages,
      /(may i take your full name|confirm your full name|could i take your name)/i
    );

    var latest = "";
    customerMessages.forEach(function (m) {
      if (promptIdx >= 0 && m.index <= promptIdx) return;
      var t = (m.text || "").trim();
      if (!t) return;
      if (/@|\d/.test(t)) return;
      if (t.split(/\s+/).length > 4) return;
      latest = t;
    });

    if (!latest) return null;

    var parts = latest.split(/\s+/);
    return {
      fullName: parts.join(" "),
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
      afterPromptSingleOnly: parts.length === 1
    };
  };

  /* =========================
     OVERRIDE: PHONE
     ========================= */

  window.detectPhone = function (customerMessages, agentMessages) {
    var promptIdx = lastPromptIndex(
      agentMessages,
      /(contact number|phone|mobile|telephone)/i
    );

    var phone = "";
    customerMessages.forEach(function (m) {
      if (promptIdx >= 0 && m.index <= promptIdx) return;
      var match = (m.text || "").match(/(?:\+44|0)\d{9,11}/);
      if (match) phone = match[0].replace(/\D/g, "");
    });

    return phone;
  };

  /* =========================
     OVERRIDE: EMAIL
     ========================= */

  window.detectEmail = function (customerMessages, agentMessages) {
    var promptIdx = lastPromptIndex(
      agentMessages,
      /(email address|email)/i
    );

    var email = "";
    customerMessages.forEach(function (m) {
      if (promptIdx >= 0 && m.index <= promptIdx) return;
      var match = (m.text || "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (match) email = match[0].toLowerCase();
    });

    return email;
  };

  /* =========================
     OVERRIDE: ADDRESS
     ========================= */

  window.detectAddress = function (customerMessages, agentMessages) {
    var promptIdx = lastPromptIndex(
      agentMessages,
      /(postcode|post code|address)/i
    );

    var lines = [];
    var postcode = "";

    customerMessages.forEach(function (m) {
      if (promptIdx >= 0 && m.index <= promptIdx) return;
      var t = (m.text || "").trim();
      if (!t) return;

      var pc = t.match(/([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})/i);
      if (pc) postcode = (pc[1] + " " + pc[2]).toUpperCase();

      if (/\d+/.test(t)) lines.push(t);
    });

    if (!lines.length && !postcode) return null;
    return { address: lines.join(", "), postcode: postcode };
  };

  /* =========================
     OVERRIDE: PX
     ========================= */

  window.detectPX = function (customerMessages, agentMessages) {
    var promptIdx = lastPromptIndex(
      agentMessages,
      /(vehicle to part[- ]?exchange|registration, make, model and mileage|take the registration, make, model and mileage)/i
    );
    if (promptIdx < 0) return null;

    var px = {
      pxReg: "",
      pxMake: "",
      pxModel: "",
      pxMileage: "",
      pxSummary: ""
    };

    customerMessages.forEach(function (m) {
      if (m.index <= promptIdx) return;
      var t = m.text || "";

      if (/no px|no part exchange/i.test(t)) {
        px.pxSummary = "No PX";
        return;
      }

      var reg = t.match(/[A-Z]{2}\d{2}\s?[A-Z]{3}/i);
      if (reg) px.pxReg = reg[0].replace(/\s+/g, "").toUpperCase();

      var miles = t.match(/\b\d{2,3}\s?k\b|\b\d{4,6}\b/i);
      if (miles) {
        var raw = miles[0].toLowerCase();
        px.pxMileage = raw.indexOf("k") !== -1
          ? String(parseInt(raw, 10) * 1000)
          : raw.replace(/\D/g, "");
      }

      var veh = window.detectVehicleFromText && window.detectVehicleFromText(t);
      if (veh) {
        px.pxMake = veh.make || px.pxMake;
        px.pxModel = veh.model || px.pxModel;
      }
    });

    if (px.pxSummary === "No PX") return px;

    if (px.pxReg || px.pxMake || px.pxModel || px.pxMileage) {
      px.pxSummary = window.buildPxSummary(px);
    }

    return px;
  };

  /* =========================
     DISABLE BOOKING SUMMARY LOGIC
     ========================= */

  window.detectBookingType = function () { return ""; };
  window.detectDateTime = function () { return { date: "", time: "", dateTime: "" }; };
  window.detectIntent = function () { return []; };
  window.detectCustomerRequests = function () { return []; };
  window.detectFlags = function () { return []; };

})();

