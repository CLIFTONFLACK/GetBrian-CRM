import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEntityDocPath,
  displayFileName,
  entityDocPrefix,
  isOurEntityDocUrl,
  isValidEntityDocPath,
  sanitiseFileName,
} from "../entity-docs.ts";

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const OTHER = "11111111-2222-4333-8444-555555555555";
const BS = String.fromCharCode(92);
const HOST = "https://abc123.public.blob.vercel-storage.com";

test("sanitiseFileName keeps a normal name", () => {
  assert.equal(sanitiseFileName("Lease Heads of Terms.pdf"), "Lease_Heads_of_Terms.pdf");
  assert.equal(sanitiseFileName("report-v2_final.pdf"), "report-v2_final.pdf");
});

test("sanitiseFileName removes path separators and keeps only the last segment", () => {
  assert.equal(sanitiseFileName("a/b/c.pdf"), "c.pdf");
  assert.equal(sanitiseFileName(`C:${BS}Users${BS}me${BS}c.pdf`), "c.pdf");
  assert.equal(sanitiseFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitiseFileName(`..${BS}..${BS}boot.ini`), "boot.ini");
});

test("sanitiseFileName never leaves dot-dot or a leading dot", () => {
  for (const raw of ["..", "...", "a..b.pdf", ".htaccess", "..pdf", "a....b", "-.-rf.pdf"]) {
    const out = sanitiseFileName(raw);
    assert.ok(!out.includes(".."), `${raw} -> ${out}`);
    assert.ok(!out.startsWith("."), `${raw} -> ${out}`);
    assert.ok(out.length > 0, raw);
  }
  assert.equal(sanitiseFileName(".."), "file");
});

test("sanitiseFileName turns control characters and unicode into underscores", () => {
  const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(10)}c${String.fromCharCode(127)}d.pdf`;
  const out = sanitiseFileName(withControls);
  assert.equal(out, "a_b_c_d.pdf");
  for (const ch of out) assert.ok(ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127);
  assert.equal(sanitiseFileName("café 中文.pdf"), "caf____.pdf");
  assert.match(sanitiseFileName("‮gnp.pdf"), /^[A-Za-z0-9._-]+$/);
});

test("sanitiseFileName caps the length and keeps a short extension", () => {
  const out = sanitiseFileName("x".repeat(500) + ".pdf");
  assert.equal(out.length, 100);
  assert.ok(out.endsWith(".pdf"));
  const noExt = sanitiseFileName("y".repeat(500));
  assert.equal(noExt.length, 100);
});

test("sanitiseFileName never returns an empty name", () => {
  for (const raw of ["", "   ", "/", BS, "////", "...", "___"]) {
    assert.ok(sanitiseFileName(raw).length > 0, JSON.stringify(raw));
  }
  assert.equal(sanitiseFileName(undefined as unknown as string), "file");
});

test("buildEntityDocPath lives in the record's own folder and passes validation", () => {
  const p = buildEntityDocPath("company", ID.toUpperCase(), "../../x y.pdf", 1731900000000);
  assert.equal(p, `entity-docs/company/${ID}/1731900000000-x_y.pdf`);
  assert.ok(isValidEntityDocPath(p, "company", ID));
  assert.equal(entityDocPrefix("contact", ID), `entity-docs/contact/${ID}/`);
});

test("buildEntityDocPath output is valid for hostile names", () => {
  const hostile = [
    "../../../x.pdf",
    `..${BS}..${BS}x.pdf`,
    "a".repeat(1000),
    "\u0000\u0001.pdf",
    "%2e%2e%2fx.pdf",
    "x.pdf/../../y",
  ];
  for (const name of hostile) {
    const p = buildEntityDocPath("contact", ID, name, 1731900000000);
    assert.ok(isValidEntityDocPath(p, "contact", ID), `${name} -> ${p}`);
  }
});

test("isValidEntityDocPath rejects another record, another type and extra segments", () => {
  const good = `entity-docs/company/${ID}/1731900000000-a.pdf`;
  assert.ok(isValidEntityDocPath(good, "company", ID));
  assert.ok(!isValidEntityDocPath(good, "company", OTHER)); // another record
  assert.ok(!isValidEntityDocPath(good, "contact", ID)); // another type
  const bad = [
    `entity-docs/company/${ID}/sub/1731900000000-a.pdf`, // extra segment
    `entity-docs/company/${ID}/1731900000000-..`, // dot-dot name
    `entity-docs/company/${ID}/1731900000000-a..b.pdf`,
    `entity-docs/company/${ID}/../${OTHER}/1731900000000-a.pdf`,
    `entity-docs/company/${ID}/1731900000000-`, // empty name
    `entity-docs/company/${ID}/x-a.pdf`, // no timestamp
    `entity-docs/company/${ID}/1731900000000-a b.pdf`, // space
    `${ID}/1731900000000-a.pdf`, // the requirement folder shape
    `entity-docs/company/${ID}/1731900000000-${"a".repeat(101)}`, // too long
    `/entity-docs/company/${ID}/1731900000000-a.pdf`, // leading slash
    `entity-docs/company/${ID}/1731900000000-a.pdf\n`, // trailing newline
  ];
  for (const p of bad) assert.ok(!isValidEntityDocPath(p, "company", ID), JSON.stringify(p));
  assert.ok(!isValidEntityDocPath(good, "company", "not-a-uuid"));
  assert.ok(!isValidEntityDocPath(good, "requirement", ID));
  assert.ok(!isValidEntityDocPath(null, "company", ID));
  assert.ok(!isValidEntityDocPath(good, "company", null));
});

test("isOurEntityDocUrl accepts only a Blob URL in the record's own folder", () => {
  const path = `entity-docs/company/${ID}/1731900000000-a.pdf`;
  assert.ok(isOurEntityDocUrl(`${HOST}/${path}`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`${HOST}/${path}`, "company", OTHER));
  assert.ok(!isOurEntityDocUrl(`${HOST}/${path}`, "contact", ID));
  assert.ok(!isOurEntityDocUrl(`http://abc123.public.blob.vercel-storage.com/${path}`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`https://evil.example.com/${path}`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`https://abc123.public.blob.vercel-storage.com.evil.com/${path}`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`https://user:pw@abc123.public.blob.vercel-storage.com/${path}`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`${HOST}/${path}?x=1`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`${HOST}/${path}#frag`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`${HOST}/${ID}/1731900000000-a.pdf`, "company", ID));
  assert.ok(!isOurEntityDocUrl(`${HOST}/entity-docs/company/${ID}/%2e%2e/x`, "company", ID));
  assert.ok(!isOurEntityDocUrl("not a url", "company", ID));
  assert.ok(!isOurEntityDocUrl(undefined, "company", ID));
});

test("displayFileName strips control characters and caps the length", () => {
  assert.equal(displayFileName(`  a${String.fromCharCode(0)}b${String.fromCharCode(7)}.pdf  `), "ab.pdf");
  assert.equal(displayFileName("x".repeat(500)).length, 200);
  assert.equal(displayFileName("Café plan.pdf"), "Café plan.pdf");
  assert.equal(displayFileName(undefined), "");
});
