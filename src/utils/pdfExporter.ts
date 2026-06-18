import { PDFDocument, rgb, StandardFonts, degrees, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Annotation, TextAnnotation, SignatureAnnotation, DrawAnnotation, HighlightAnnotation, WhiteoutAnnotation } from '../types';
import { loadPdfDocument } from './pdfRenderer';
import { loadUnicodeFontBytes, toVisualOrder } from './hebrewFont';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b];
}

export async function exportPdf(
  originalBuffer: ArrayBuffer,
  annotations: Annotation[],
  deletedPages: Set<number>,
  pageRotations: Map<number, number>,
  onlyOrigIndices?: number[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(originalBuffer);
  const totalPages = srcDoc.getPageCount();

  const outDoc = await PDFDocument.create();
  // Base set of pages to consider (all pages, or a caller-supplied subset),
  // always excluding pages the user deleted.
  const base = onlyOrigIndices ?? Array.from({ length: totalPages }, (_, i) => i);
  const keepIndices = base.filter((i) => i >= 0 && i < totalPages && !deletedPages.has(i));

  const copiedPages = await outDoc.copyPages(srcDoc, keepIndices);
  copiedPages.forEach((p) => outDoc.addPage(p));

  for (let newIdx = 0; newIdx < keepIndices.length; newIdx++) {
    const origIdx = keepIndices[newIdx];
    const rot = pageRotations.get(origIdx) ?? 0;
    if (rot !== 0) {
      const page = outDoc.getPage(newIdx);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + rot) % 360));
    }
  }

  // Prefer an embedded Unicode font so Hebrew (and other non-Latin) text
  // exports correctly; fall back to Helvetica if the font can't be fetched.
  let font: PDFFont;
  let fontSupportsUnicode = false;
  const unicodeBytes = await loadUnicodeFontBytes();
  if (unicodeBytes) {
    outDoc.registerFontkit(fontkit);
    font = await outDoc.embedFont(unicodeBytes, { subset: true });
    fontSupportsUnicode = true;
  } else {
    font = await outDoc.embedFont(StandardFonts.Helvetica);
  }
  const pdfJsDoc = await loadPdfDocument(originalBuffer);

  for (let newIdx = 0; newIdx < keepIndices.length; newIdx++) {
    const origIdx = keepIndices[newIdx];
    const page = outDoc.getPage(newIdx);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    // Draw in the same stacking order as on screen: highlight < whiteout < everything else,
    // so a whiteout covers existing content but text/signatures placed on top stay visible.
    const zRank = (t: Annotation['type']) => (t === 'highlight' ? 0 : t === 'whiteout' ? 1 : 2);
    const pageAnnotations = annotations
      .filter((a) => a.pageIndex === origIdx)
      .slice()
      .sort((a, b) => zRank(a.type) - zRank(b.type));

    const renderScale = 1.5;
    const pdfJsPage = await pdfJsDoc.getPage(origIdx + 1);
    const viewport = pdfJsPage.getViewport({ scale: renderScale, rotation: 0 });
    const canvasWidth = viewport.width;
    const canvasHeight = viewport.height;

    const scaleX = pageWidth / canvasWidth;
    const scaleY = pageHeight / canvasHeight;

    for (const ann of pageAnnotations) {
      if (ann.type === 'text') {
        const t = ann as TextAnnotation;
        const pdfX = t.x * scaleX;
        const pdfY = pageHeight - t.y * scaleY - t.fontSize;
        const [r, g, b] = hexToRgb(t.color);
        // Reorder right-to-left text into visual order when we have a font that
        // can actually render it; otherwise keep logical order.
        const drawText = fontSupportsUnicode ? toVisualOrder(t.text) : t.text;
        try {
          page.drawText(drawText, {
            x: pdfX,
            y: Math.max(0, pdfY),
            size: t.fontSize * scaleX,
            font,
            color: rgb(r, g, b),
            lineHeight: t.fontSize * scaleX,
          });
        } catch (err) {
          // Helvetica fallback can't encode some characters — drop the
          // unsupported ones rather than failing the whole export.
          const safe = drawText.replace(/[^\x00-\xFF]/g, '');
          if (safe) {
            page.drawText(safe, {
              x: pdfX,
              y: Math.max(0, pdfY),
              size: t.fontSize * scaleX,
              font,
              color: rgb(r, g, b),
              lineHeight: t.fontSize * scaleX,
            });
          } else {
            console.warn('Skipped text annotation that the export font cannot render', err);
          }
        }
      } else if (ann.type === 'signature') {
        const s = ann as SignatureAnnotation;
        try {
          const imgBytes = await fetch(s.dataUrl).then((r) => r.arrayBuffer());
          const img = await outDoc.embedPng(imgBytes);
          const pdfX = s.x * scaleX;
          const pdfY = pageHeight - (s.y + s.height) * scaleY;
          page.drawImage(img, {
            x: pdfX,
            y: pdfY,
            width: s.width * scaleX,
            height: s.height * scaleY,
          });
        } catch {
          // skip invalid signature
        }
      } else if (ann.type === 'draw') {
        const d = ann as DrawAnnotation;
        const [r, g, b] = hexToRgb(d.color);
        for (const path of d.paths) {
          if (path.length < 2) continue;
          for (let pi = 0; pi < path.length - 1; pi++) {
            const x1 = path[pi].x * scaleX;
            const y1 = pageHeight - path[pi].y * scaleY;
            const x2 = path[pi + 1].x * scaleX;
            const y2 = pageHeight - path[pi + 1].y * scaleY;
            page.drawLine({
              start: { x: x1, y: y1 },
              end: { x: x2, y: y2 },
              thickness: d.lineWidth * scaleX,
              color: rgb(r, g, b),
            });
          }
        }
      } else if (ann.type === 'highlight') {
        const h = ann as HighlightAnnotation;
        const [r, g, b] = hexToRgb(h.color);
        const pdfX = h.x * scaleX;
        const pdfY = pageHeight - (h.y + h.height) * scaleY;
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: h.width * scaleX,
          height: h.height * scaleY,
          color: rgb(r, g, b),
          opacity: 0.4,
        });
      } else if (ann.type === 'whiteout') {
        const w = ann as WhiteoutAnnotation;
        const [r, g, b] = hexToRgb(w.color);
        const pdfX = w.x * scaleX;
        const pdfY = pageHeight - (w.y + w.height) * scaleY;
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: w.width * scaleX,
          height: w.height * scaleY,
          color: rgb(r, g, b),
        });
      }
    }
  }

  return outDoc.save();
}
