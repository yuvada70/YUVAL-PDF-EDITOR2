import { PDFDocument } from 'pdf-lib';

/** Trigger a browser download for raw PDF bytes. */
export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Append every page of `otherBuffer` after the pages of `currentBuffer`.
 * Existing page indices are preserved, so the caller's annotations stay valid.
 */
export async function appendPdf(
  currentBuffer: ArrayBuffer,
  otherBuffer: ArrayBuffer
): Promise<{ buffer: ArrayBuffer; addedCount: number }> {
  const a = await PDFDocument.load(currentBuffer.slice(0));
  const b = await PDFDocument.load(otherBuffer.slice(0));
  const out = await PDFDocument.create();

  const aPages = await out.copyPages(a, a.getPageIndices());
  aPages.forEach((p) => out.addPage(p));
  const bPages = await out.copyPages(b, b.getPageIndices());
  bPages.forEach((p) => out.addPage(p));

  const bytes = await out.save();
  return { buffer: bytes.buffer as ArrayBuffer, addedCount: b.getPageCount() };
}

/**
 * Insert a copy of `pageIndex` directly after it. Returns a new PDF buffer
 * whose page at `pageIndex + 1` is the duplicate.
 */
export async function duplicatePageInPdf(
  currentBuffer: ArrayBuffer,
  pageIndex: number
): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(currentBuffer.slice(0));
  const out = await PDFDocument.create();
  const indices = src.getPageIndices();

  const copied = await out.copyPages(src, indices);
  const [dup] = await out.copyPages(src, [pageIndex]);
  copied.forEach((p, i) => {
    out.addPage(p);
    if (i === pageIndex) out.addPage(dup);
  });

  const bytes = await out.save();
  return bytes.buffer as ArrayBuffer;
}

/**
 * Parse a 1-based page-range string like "1-3, 5, 8-9" into a sorted, unique
 * list of 0-based indices, bounded to [0, max). Returns null on invalid input.
 */
export function parsePageRanges(input: string, max: number): number[] | null {
  const out = new Set<number>();
  for (const partRaw of input.split(',')) {
    const part = partRaw.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const single = part.match(/^(\d+)$/);
    if (range) {
      let from = parseInt(range[1], 10);
      let to = parseInt(range[2], 10);
      if (from > to) [from, to] = [to, from];
      for (let n = from; n <= to; n++) {
        if (n >= 1 && n <= max) out.add(n - 1);
      }
    } else if (single) {
      const n = parseInt(single[1], 10);
      if (n >= 1 && n <= max) out.add(n - 1);
    } else {
      return null;
    }
  }
  return out.size ? Array.from(out).sort((a, b) => a - b) : null;
}
