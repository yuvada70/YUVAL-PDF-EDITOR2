import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import {
  Annotation, TextAnnotation, SignatureAnnotation,
  DrawAnnotation, HighlightAnnotation,
} from '../types';
import { loadPdfDocument } from './pdfRenderer';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b];
}

// annotations are stored with pageIndex = position in pageOrder at the time
// they were created. We pass pageOrder so we know which original page each
// position maps to, but annotations already use position-based indices.
export async function exportPdf(
  originalBuffer: ArrayBuffer,
  annotations: Annotation[],
  pageOrder: number[],
  pageRotations: Map<number, number>
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(originalBuffer);

  const outDoc = await PDFDocument.create();

  // Copy pages in pageOrder sequence
  // pageOrder may contain duplicates (duplicated pages)
  const copiedPages = await outDoc.copyPages(srcDoc, pageOrder);
  copiedPages.forEach((p) => outDoc.addPage(p));

  // Apply per-position rotations
  for (let pos = 0; pos < pageOrder.length; pos++) {
    const rot = pageRotations.get(pos) ?? 0;
    if (rot !== 0) {
      const page = outDoc.getPage(pos);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + rot) % 360));
    }
  }

  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const pdfJsDoc = await loadPdfDocument(originalBuffer);

  for (let pos = 0; pos < pageOrder.length; pos++) {
    const origIdx = pageOrder[pos];
    const page = outDoc.getPage(pos);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const pageAnnotations = annotations.filter((a) => a.pageIndex === pos);

    if (pageAnnotations.length === 0) continue;

    const renderScale = 1.5;
    const pdfJsPage = await pdfJsDoc.getPage(origIdx + 1);
    const viewport = pdfJsPage.getViewport({ scale: renderScale, rotation: 0 });
    const scaleX = pageWidth / viewport.width;
    const scaleY = pageHeight / viewport.height;

    for (const ann of pageAnnotations) {
      if (ann.type === 'text') {
        const t = ann as TextAnnotation;
        const [r, g, b] = hexToRgb(t.color);
        page.drawText(t.text, {
          x: t.x * scaleX,
          y: Math.max(0, pageHeight - t.y * scaleY - t.fontSize),
          size: t.fontSize * scaleX,
          font,
          color: rgb(r, g, b),
        });
      } else if (ann.type === 'signature') {
        const s = ann as SignatureAnnotation;
        try {
          const imgBytes = await fetch(s.dataUrl).then((r) => r.arrayBuffer());
          const img = await outDoc.embedPng(imgBytes);
          page.drawImage(img, {
            x: s.x * scaleX,
            y: pageHeight - (s.y + s.height) * scaleY,
            width: s.width * scaleX,
            height: s.height * scaleY,
          });
        } catch { /* skip */ }
      } else if (ann.type === 'draw') {
        const d = ann as DrawAnnotation;
        const [r, g, b] = hexToRgb(d.color);
        for (const path of d.paths) {
          if (path.length < 2) continue;
          for (let pi = 0; pi < path.length - 1; pi++) {
            page.drawLine({
              start: { x: path[pi].x * scaleX, y: pageHeight - path[pi].y * scaleY },
              end: { x: path[pi + 1].x * scaleX, y: pageHeight - path[pi + 1].y * scaleY },
              thickness: d.lineWidth * scaleX,
              color: rgb(r, g, b),
            });
          }
        }
      } else if (ann.type === 'highlight') {
        const h = ann as HighlightAnnotation;
        const [r, g, b] = hexToRgb(h.color);
        page.drawRectangle({
          x: h.x * scaleX,
          y: pageHeight - (h.y + h.height) * scaleY,
          width: h.width * scaleX,
          height: h.height * scaleY,
          color: rgb(r, g, b),
          opacity: 0.4,
        });
      }
    }
  }

  return outDoc.save();
}

export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const outDoc = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await outDoc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => outDoc.addPage(p));
  }
  return outDoc.save();
}

export async function extractPages(
  originalBuffer: ArrayBuffer,
  pageIndices: number[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(originalBuffer);
  const outDoc = await PDFDocument.create();
  const pages = await outDoc.copyPages(srcDoc, pageIndices);
  pages.forEach((p) => outDoc.addPage(p));
  return outDoc.save();
}
