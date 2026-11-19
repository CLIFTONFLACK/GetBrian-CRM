// Plain module (not "use client"): server pages, server actions and client
// components all import it. Builds mailto:, tel: and website links from values
// that are free text in the database (contact email, phone, company website),
// so every value is checked before it goes into an href.

// Characters that must not appear in an address we put in a mailto: link.
// "?" and "&" start extra header fields (mailto:a@b.co?bcc=...), "," and ";"
// add recipients, double quotes and angle brackets build display-name forms, and
// whitespace and control characters (a newline above all) split the value.
// The apostrophe is a legal local-part character (o'neil@x.co.uk) and safe in a
// mailto: link, so it is allowed. "%" is allowed too: mailtoHref percent-encodes
// the whole local part, so "%" becomes "%25" and cannot be read back as an escape.
const BAD_EMAIL_CHARS = /[\s\u0000-\u001f\u007f?&,;<>"`\\]/;
const DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * True for one plain address: no whitespace or control characters, none of
 * ? & , ; < > double quotes backtick backslash, exactly one @, a non-empty local part,
 * and a domain of dotted ASCII labels with at least one dot. Not a full RFC check on purpose:
 * it only has to be safe to put in a link and to catch typing mistakes.
 */
export function isValidContactEmail(value: string | null | undefined): boolean {
  const e = value?.trim();
  if (!e || e.length > 254) return false;
  if (BAD_EMAIL_CHARS.test(e)) return false;
  const parts = e.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && local.length <= 64 && DOMAIN.test(domain);
}

/** mailto: href with the local part encoded, or null when the value is not one
 *  plain address. The caller shows the text without a link when this is null. */
export function mailtoHref(email: string | null | undefined): string | null {
  if (!isValidContactEmail(email)) return null;
  const [local, domain] = (email as string).trim().split("@");
  return `mailto:${encodeURIComponent(local)}@${domain}`;
}

/** Number to ring: mobile first, then phone, else null. Returns a tel: href too. */
export function pickCallNumber(
  mobile: string | null | undefined,
  phone: string | null | undefined,
): { display: string; href: string } | null {
  for (const raw of [mobile, phone]) {
    const display = raw?.trim();
    if (!display) continue;
    // "+44 (0)20 7123 4567" is written for readers: the (0) is not dialled
    // after a +44 prefix. Drop it before the punctuation is stripped.
    const noTrunk = display.replace(/^(\+\s*44[\s.-]*)\(\s*0\s*\)/, "$1");
    const digits = noTrunk.replace(/\D/g, "");
    if (digits.length === 0) continue;
    const dial = (noTrunk.startsWith("+") ? "+" : "") + digits;
    return { display, href: `tel:${dial}` };
  }
  return null;
}

/** The URL itself when it is an absolute http: or https: URL, else null. A
 *  javascript:, data: or mailto: value, or a bare "example.com", is not linked. */
export function httpUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
