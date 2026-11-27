import test from "node:test";
import assert from "node:assert/strict";

import { isPrivateAddress, publicHttpsUrl } from "../disposals/public-url.ts";
import { previewIsCurrent, RETRY_AFTER_MS } from "../disposals/brochure-preview-state.ts";
import { PdfRenderError, renderFirstPageJpeg } from "../disposals/brochure-render.ts";

/** A valid one-page PDF with a filled rectangle, built with correct xref offsets. */
function tinyPdf(pageW = 200, pageH = 300, draw = true): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << >> >>`,
  ];
  const content = draw ? "1 0 0 rg 20 20 160 260 re f" : " ";
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

test("a real PDF is drawn as a JPEG of the set width", () => {
  const jpeg = renderFirstPageJpeg(tinyPdf());
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8); // JPEG start marker
  assert.ok(jpeg.length > 500);
});

test("the page content is drawn: a page with a rectangle differs from a blank page", () => {
  const withBox = renderFirstPageJpeg(tinyPdf(200, 300, true));
  const blank = renderFirstPageJpeg(tinyPdf(200, 300, false));
  assert.notEqual(withBox.length, blank.length);
});

test("a very tall page is capped in height, so the image stays small", () => {
  const wide = renderFirstPageJpeg(tinyPdf(200, 300));
  const tall = renderFirstPageJpeg(tinyPdf(100, 100000, false));
  assert.ok(tall.length < 200_000, `tall image ${tall.length} bytes`);
  assert.ok(wide.length > 0);
});

test("bytes that are not a PDF are refused with a PdfRenderError", () => {
  assert.throws(() => renderFirstPageJpeg(new TextEncoder().encode("hello, this is text")), PdfRenderError);
  assert.throws(() => renderFirstPageJpeg(new Uint8Array(0)), PdfRenderError);
});

test("private, loopback, link-local and reserved addresses are refused", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "999.1.1.1",
    "not-an-ip",
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "52.95.148.1", "172.15.0.1", "172.32.0.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("only plain public https links are fetched", () => {
  assert.ok(publicHttpsUrl("https://s3-eu-west-1.amazonaws.com/bucket/brochure.pdf"));
  assert.ok(publicHttpsUrl("https://www.lewiscraig.co.uk/files/a.pdf"));
  for (const bad of [
    "http://example.com/a.pdf",
    "ftp://example.com/a.pdf",
    "file:///etc/passwd",
    "https://localhost/a.pdf",
    "https://127.0.0.1/a.pdf",
    "https://[::1]/a.pdf",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@example.com/a.pdf",
    "https://example.com:8443/a.pdf",
    "https://intranet/a.pdf",
    "https://printer.local/a.pdf",
    "https://db.internal/a.pdf",
    "not a url",
    "",
  ]) {
    assert.equal(publicHttpsUrl(bad), null, bad);
  }
});

test("a stored preview counts only for the link it was drawn from", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const row = (over = {}) => ({
    source_url: "https://x.example/a.pdf",
    preview_url: "https://blob/p.jpg",
    checked_at: "2026-11-26T11:00:00Z",
    ...over,
  });
  assert.equal(previewIsCurrent(row(), "https://x.example/a.pdf", now), "ready");
  assert.equal(previewIsCurrent(row(), "https://x.example/b.pdf", now), "needed"); // link changed
  assert.equal(previewIsCurrent(null, "https://x.example/a.pdf", now), "needed");
  assert.equal(previewIsCurrent(row(), null, now), "needed");
});

test("a failed try is not repeated for a day, then it is", () => {
  const link = "https://x.example/a.pdf";
  const failed = (checked_at: string) => ({ source_url: link, preview_url: null, checked_at });
  const now = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(previewIsCurrent(failed(new Date(now - 1000).toISOString()), link, now), "recent-failure");
  assert.equal(
    previewIsCurrent(failed(new Date(now - RETRY_AFTER_MS - 1000).toISOString()), link, now),
    "needed",
  );
  assert.equal(previewIsCurrent(failed("garbage"), link, now), "needed");
});
