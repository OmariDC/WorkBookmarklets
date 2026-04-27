function cleanPossibleName(text) {
  return text
    .replace(/\b(thank you|thanks|thankyou|hi|hello|hey|morning|afternoon|evening|cheers|regards|kind regards|please|my number is|my email is|email|phone|mobile|contact)\b/gi, " ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNameFromContactMessage(messageText) {
  let text = messageText;

  // Remove email
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");

  // Remove phone numbers
  text = text.replace(/(?:\+44|0)\s?\d(?:[\s-]?\d){8,10}/g, " ");

  // Remove registrations
  text = text.replace(/\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/gi, " ");

  // Remove postcodes
  text = text.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, " ");

  text = cleanPossibleName(text);

  const words = text.split(" ").filter(w =>
    /^[A-Za-z'-]{2,}$/.test(w)
  );

  if (words.length >= 2) {
    return {
      firstName: words[0],
      lastName: words[1]
    };
  }

  return {
    firstName: "",
    lastName: ""
  };
}
