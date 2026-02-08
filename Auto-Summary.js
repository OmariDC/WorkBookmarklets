(function () {
  if (window._lpCustomerPxCapture) return;
  window._lpCustomerPxCapture = true;

  /* =========================
     CONFIG
  ========================= */

  var AGENT_NAME = "Omari";

  var INFO_PROMPTS = {
    customerDetails: new RegExp(
      "may i take your full name|" +
      "just to confirm.*full name|" +
      "full name.*contact number|" +
      "contact number.*email|" +
      "email address.*postcode",
      "i"
    ),
    pxDetails: new RegExp(
      "vehicle to part[\\s-]?exchange|" +
      "registration.*make.*model.*mileage|" +
      "take the registration.*model.*mileage",
      "i"
    )
  };

  /* =========================
     MESSAGE COLLECTION
  ========================= */

  function collectMessages() {
    var nodes = document.querySelectorAll(
      ".html-content, .text-content, .lp_message, .chatLine, .msg_text"
    );

    var out = [];
    var index = 0;

    nodes.forEach(function (node) {
      var text = (node.innerText || "")
        .replace(new RegExp("\\s+", "g"), " ")
        .trim();

      if (!text) return;

      var sender = "customer";
      var origin = node.closest("[class*=originator]");
      if (origin && origin.innerText.trim() === AGENT_NAME) {
        sender = "agent";
      }

      out.push({ sender: sender, text: text, index: index++ });
    });

    return out;
  }

  /* =========================
     CAPTURE WINDOW
  ========================= */

  function getRepliesAfterPrompt(messages, promptRegex) {
    var lastPrompt = -1;

    messages.forEach(function (m) {
      if (m.sender === "agent" && promptRegex.test(m.text)) {
        lastPrompt = m.index;
      }
    });

    if (lastPrompt < 0) return [];

    return messages.filter(function (m) {
      if (m.sender !== "customer") return false;
      if (m.index <= lastPrompt) return false;

      return !messages.some(function (a) {
        return (
          a.sender === "agent" &&
          a.index > lastPrompt &&
          a.index < m.index
        );
      });
    });
  }

  /* =========================
     NORMALISATION
  ========================= */

  function explodeToLines(replies) {
    return replies
      .map(function (r) { return r.text; })
      .join("\n")
      .split(new RegExp("[\\n,;]"))
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /* =========================
     FIELD EXTRACTORS
  ========================= */

  function extractName(lines) {
    var regPattern = new RegExp("[A-Z]{2}\\d{2}\\s?[A-Z]{3}", "i");
    var digitPattern = new RegExp("\\d");
    var emailPattern = new RegExp("@");

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];

      if (emailPattern.test(l)) continue;
      if (digitPattern.test(l)) continue;
      if (regPattern.test(l)) continue;

      var clean = l.replace(new RegExp("[^A-Za-z\\s'-]", "g"), "").trim();
      if (!clean) continue;

      var parts = clean.split(new RegExp("\\s+"));
      if (parts.length < 1 || parts.length > 4) continue;

      return parts
        .map(function (p) {
          return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
        })
        .join(" ");
    }

    return "";
  }

  function extractPhone(lines) {
    var re = new RegExp("(?:\\+44\\s?\\d{2,4}|0\\d{2,4})\\s?\\d{3,4}\\s?\\d{3,4}");
    var out = "";

    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m) out = m[0].replace(new RegExp("\\D", "g"), "");
    });

    return out;
  }

  function extractEmail(lines) {
    var re = new RegExp("[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}", "i");
    var out = "";

    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m) out = m[0].toLowerCase();
    });

    return out;
  }

  function extractPostcode(lines) {
    var re = new RegExp("([A-Z]{1,2}\\d{1,2}[A-Z]?)\\s?(\\d[A-Z]{2})", "i");
    var out = "";

    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m) out = (m[1] + " " + m[2]).toUpperCase();
    });

    return out;
  }

  function extractPX(lines) {
    var px = { reg: "", make: "", model: "", mileage: "", summary: "" };

    var noPxRe = new RegExp("no px|no part exchange", "i");
    if (lines.some(function (l) { return noPxRe.test(l); })) {
      px.summary = "No PX";
      return px;
    }

    var regRe = new RegExp("([A-Z]{2}\\d{2}\\s?[A-Z]{3})", "i");
    var milesRe = new RegExp("(\\b\\d{2,3}\\s?k\\b|\\b\\d{4,6}\\b)", "i");
    var carRe = new RegExp(
      "(peugeot|citroen|ds|fiat|abarth|alfa romeo|jeep|vauxhall|leapmotor)\\s+([a-z0-9]+)",
      "i"
    );

    lines.forEach(function (l) {
      var m;

      m = regRe.exec(l);
      if (m) px.reg = m[1].replace(new RegExp("\\s+", "g"), "").toUpperCase();

      m = milesRe.exec(l);
      if (m) {
        var v = m[0].toLowerCase().replace(new RegExp("\\s+", "g"), "");
        px.mileage = v.indexOf("k") !== -1
          ? String(parseInt(v, 10) * 1000)
          : v.replace(new RegExp("\\D", "g"), "");
      }

      m = carRe.exec(l);
      if (m) {
        px.make = m[1].replace(new RegExp("\\b\\w", "g"), function (c) {
          return c.toUpperCase();
        });
        px.model = m[2].toUpperCase();
      }
    });

    var parts = [];
    if (px.reg) parts.push("Reg: " + px.reg);
    if (px.make || px.model) {
      parts.push("Vehicle: " + [px.make, px.model].filter(Boolean).join(" "));
    }
    if (px.mileage) parts.push("Mileage: " + px.mileage);

    px.summary = parts.length ? parts.join(" | ") : "";
    return px;
  }

  /* =========================
     RUN + COPY
  ========================= */

  function run() {
    var messages = collectMessages();

    var customerReplies = getRepliesAfterPrompt(messages, INFO_PROMPTS.customerDetails);
    var pxReplies = getRepliesAfterPrompt(messages, INFO_PROMPTS.pxDetails);

    var customerLines = explodeToLines(customerReplies);
    var pxLines = explodeToLines(pxReplies);

    var output = [
      "Customer Details",
      "------------------",
      extractName(customerLines) && "Name: " + extractName(customerLines),
      extractPhone(customerLines) && "Phone: " + extractPhone(customerLines),
      extractEmail(customerLines) && "Email: " + extractEmail(customerLines),
      extractPostcode(customerLines) && "Postcode: " + extractPostcode(customerLines),
      "",
      "Part Exchange",
      "------------------",
      extractPX(pxLines).summary || "No PX"
    ]
      .filter(Boolean)
      .join("\n");

    navigator.clipboard.writeText(output);
    alert("Customer + PX copied");
  }

  run();
})();
