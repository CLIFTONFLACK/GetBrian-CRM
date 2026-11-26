import { mailtoHref } from "../contact-links.ts";

/**
 * The verification link comes from the provider's reply and ends up in an href
 * and in an email, so only an https URL is accepted. Anything else gives null.
 */
export function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * A mailto: link that opens a draft with the verification link in the body.
 * Null when the contact has no single plain address (see mailtoHref).
 */
export function emailLinkHref(email: string | null | undefined, url: string): string | null {
  const base = mailtoHref(email);
  if (!base) return null;
  const subject = "Please verify your identity";
  const body = ["Please open this link to verify your identity:", "", url].join("\n");
  return `${base}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
