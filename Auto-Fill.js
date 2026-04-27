function extractName(t, email, phone, postcode) {
  const blocked = [
    "thank you",
    "thanks",
    "no thank you",
    "yes please",
    "no problem",
    "that is fine",
    "sounds good",
    "ok thanks",
    "okay thanks"
  ];

  let txt = clean(t)
    .replace(/[\/|]+/g, "\n")
    .replace(email, "\n")
    .replace(phone, "\n")
    .replace(postcode, "\n");

  let lines = txt
    .split(/\n+/)
    .map(x => x.trim())
    .filter(Boolean);

  lines = lines.filter(l => {
    const low = l.toLowerCase().replace(/[.!?,]/g, "").trim();
    if (blocked.includes(low)) return false;
    if (/[0-9@]/.test(l)) return false;

    const words = l.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return false;

    return words.every(w => /^[A-Za-z'’-]+$/.test(w));
  });

  const best = lines[0] || "";
  const parts = best.split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || ""
  };
}
