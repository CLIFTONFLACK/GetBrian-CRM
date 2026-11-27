// Draws page 1 of a PDF as a JPEG. Pure: bytes in, bytes out, no network and no
// database, so it can be tested. mupdf is a WebAssembly build of MuPDF, so it
// needs no native libraries on Vercel.

import * as mupdf from "mupdf";

/** Output is this wide (pixels). Enough for a panel thumbnail on a sharp screen. */
export const PREVIEW_WIDTH = 720;
const MAX_HEIGHT = 1400;
const JPEG_QUALITY = 78;

export class PdfRenderError extends Error {}

/**
 * Page 1 as a JPEG, `PREVIEW_WIDTH` pixels wide (less tall than MAX_HEIGHT).
 * Throws PdfRenderError when the bytes are not a PDF, the PDF has no pages, the
 * file needs a password, or the page has no usable size.
 */
export function renderFirstPageJpeg(bytes: Uint8Array): Uint8Array {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new PdfRenderError("The file is not a readable PDF.");
  }
  try {
    if (doc.needsPassword()) throw new PdfRenderError("The PDF needs a password.");
    if (doc.countPages() < 1) throw new PdfRenderError("The PDF has no pages.");
    const page = doc.loadPage(0);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const w = x1 - x0;
      const h = y1 - y0;
      if (!(w > 0 && h > 0)) throw new PdfRenderError("The first page has no size.");
      // Fit the width, but never exceed the height cap (a very tall page).
      const scale = Math.min(PREVIEW_WIDTH / w, MAX_HEIGHT / h);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
      try {
        return pixmap.asJPEG(JPEG_QUALITY);
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } catch (err) {
    if (err instanceof PdfRenderError) throw err;
    throw new PdfRenderError("The first page could not be drawn.");
  } finally {
    doc.destroy();
  }
}
