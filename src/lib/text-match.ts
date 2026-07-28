/**
 * Whole-word text matching shared by the location matcher and the use-class
 * parser. Both compare short targets against messy free text ("Cafe (A1) /
 * Restaurant", "12 St. Albans Way"), where a raw `includes()` gives false hits.
 */

/**
 * Collapse punctuation to single spaces and pad with a space either side, so a
 * plain `includes()` on the result is a whole-word test: " ash " is not found
 * in " ashford road ", but " st albans " is found in " 12 st. albans way ".
 * Multi-word and hyphenated targets survive ("stoke-on-trent" → "stoke on
 * trent"); the caller lowercases both sides first.
 *
 * Accents are stripped first, otherwise "café" would collapse to "caf" and stop
 * matching the "cafe" spelling the data actually uses.
 */
export function wordPad(s: string): string {
  const plain = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ` ${plain.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Whole-word containment — see {@link wordPad}. Empty targets never match. */
export function containsWord(haystack: string, needle: string): boolean {
  const n = wordPad(needle);
  if (n.trim() === "") return false;
  return wordPad(haystack).includes(n);
}
