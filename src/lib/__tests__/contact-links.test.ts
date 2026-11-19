import test from "node:test";
import assert from "node:assert/strict";
import { httpUrl, isValidContactEmail, mailtoHref, pickCallNumber } from "../contact-links.ts";

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);

test("a plain address becomes a mailto link", () => {
  assert.equal(mailtoHref("a@b.co"), "mailto:a@b.co");
  assert.equal(mailtoHref("  first.last@sub.example.com  "), "mailto:first.last@sub.example.com");
});

test("the local part is encoded in the link", () => {
  // "+" is legal in an address; it is encoded so it cannot be read as a space.
  assert.equal(mailtoHref("a+tag@b.co"), "mailto:a%2Btag@b.co");
  // The apostrophe is legal and safe in a link, so it stays as it is.
  assert.equal(mailtoHref("o'brien@b.co"), "mailto:o'brien@b.co");
  // "%" is encoded to %25, so it cannot be read back as an escape sequence.
  assert.equal(mailtoHref("50%25@b.co"), "mailto:50%2525@b.co");
});

test("ordinary real-world addresses are valid and linked", () => {
  const valid: [string, string][] = [
    ["o'neil@x.co.uk", "mailto:o'neil@x.co.uk"],
    ["o'brien@b.co", "mailto:o'brien@b.co"],
    ["first.last+tag@sub.example.co.uk", "mailto:first.last%2Btag@sub.example.co.uk"],
    ["a.b.c@d-e.example.com", "mailto:a.b.c@d-e.example.com"],
    ["John.Smith@Example.COM", "mailto:John.Smith@Example.COM"],
    ["x_y-z@a.b.io", "mailto:x_y-z@a.b.io"],
  ];
  for (const [email, href] of valid) {
    assert.equal(isValidContactEmail(email), true, email);
    assert.equal(mailtoHref(email), href, email);
  }
});

test("double quotes, backticks and backslashes are still refused", () => {
  for (const v of ["a`b@c.co", "a" + String.fromCharCode(92) + "b@c.co", '"a"@b.co']) {
    assert.equal(isValidContactEmail(v), false, v);
  }
});

test("header injection through ? and & gives no link", () => {
  const hostile = [
    "a@b.co?bcc=evil@x.com",
    "a@b.co?subject=hi&body=hello",
    "a@b.co&bcc=evil@x.com",
    "a?bcc=evil@x.com@b.co",
  ];
  for (const v of hostile) {
    assert.equal(mailtoHref(v), null, v);
    assert.equal(isValidContactEmail(v), false, v);
  }
});

test("two addresses, separators, brackets and quotes give no link", () => {
  const hostile = [
    "a@b.co,c@d.co",
    "a@b.co;c@d.co",
    "a@b.co c@d.co",
    "a@b.co " + "c@d.co",
    "<a@b.co>",
    "Name <a@b.co>",
    '"a"@b.co',
    "a@b@c.co",
    "a@@b.co",
  ];
  for (const v of hostile) assert.equal(mailtoHref(v), null, v);
});

test("newlines, tabs and control characters give no link", () => {
  const hostile = [
    `a@b.co${NL}bcc: evil@x.com`,
    `a@b.co${CR}${NL}Bcc: evil@x.com`,
    `a${NL}@b.co`,
    `a@b.co${TAB}`.replace(TAB, `${TAB}x`),
    `a${NUL}@b.co`,
    `a@b.co${String.fromCharCode(127)}`,
  ];
  for (const v of hostile) assert.equal(mailtoHref(v), null, JSON.stringify(v));
});

test("missing parts give no link", () => {
  for (const v of ["", "   ", null, undefined, "no-at-sign", "@b.co", "a@", "a@b", "a@.co", "a@b.", "a@b..co", "a@-b.co"]) {
    assert.equal(mailtoHref(v as string | null | undefined), null, String(v));
  }
});

test("a very long address gives no link", () => {
  assert.equal(mailtoHref(`${"a".repeat(65)}@b.co`), null);
  assert.equal(mailtoHref(`a@${"b".repeat(250)}.co`), null);
});

test("isValidContactEmail trims, and an empty value is simply not valid", () => {
  assert.equal(isValidContactEmail(" a@b.co "), true);
  assert.equal(isValidContactEmail(""), false);
});

test("pickCallNumber drops the (0) after +44 before stripping", () => {
  assert.deepEqual(pickCallNumber(null, "+44 (0)20 7123 4567"), {
    display: "+44 (0)20 7123 4567",
    href: "tel:+442071234567",
  });
  assert.equal(pickCallNumber("+44(0)7700 900123", null)?.href, "tel:+447700900123");
  assert.equal(pickCallNumber("+44 ( 0 ) 20 7123 4567", null)?.href, "tel:+442071234567");
});

test("pickCallNumber leaves other numbers alone", () => {
  assert.equal(pickCallNumber("07700 900123", "020 7946 0000")?.href, "tel:07700900123");
  assert.equal(pickCallNumber(null, "+44 20 7946 0000")?.href, "tel:+442079460000");
  // A (0) that does not follow +44 is not the trunk prefix: digits stay.
  assert.equal(pickCallNumber("020 (0) 7946", null)?.href, "tel:02007946");
  assert.equal(pickCallNumber("  ", "020 7946 0000")?.href, "tel:02079460000");
  assert.equal(pickCallNumber(null, null), null);
  assert.equal(pickCallNumber("n/a", ""), null);
});

test("pickCallNumber only ever puts digits and one leading plus in the href", () => {
  const out = pickCallNumber(`+44;ext=1${NL}2 3+4`, null);
  assert.match(out?.href ?? "", /^tel:\+?[0-9]+$/);
});

test("httpUrl links http and https only", () => {
  assert.equal(httpUrl("https://example.com"), "https://example.com/");
  assert.equal(httpUrl(" http://example.com/path?q=1 "), "http://example.com/path?q=1");
  for (const v of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>1</script>",
    "mailto:a@b.co",
    "ftp://example.com",
    "file:///etc/passwd",
    "example.com",
    "//example.com",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.equal(httpUrl(v as string | null | undefined), null, String(v));
  }
});
