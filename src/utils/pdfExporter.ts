import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { Annotation, TextAnnotation, SignatureAnnotation, DrawAnnotation, HighlightAnnotation } from '../types';
import { loadPdfDocument } from './pdfRenderer';

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
  pageOrder?: number[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(originalBuffer);
  const totalPages = srcDoc.getPageCount();

  const outDoc = await PDFDocument.create();
  let keepIndices: number[];
  if (pageOrder && pageOrder.length > 0) {
    keepIndices = pageOrder;
  } else {
    keepIndices = [];
    for (let i = 0; i < totalPages; i++) {
      if (!deletedPages.has(i)) keepIndices.push(i);
    }
  }

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

  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const pdfJsDoc = await loadPdfDocument(originalBuffer);

  for (let newIdx = 0; newIdx < keepIndices.length; newIdx++) {
    const origIdx = keepIndices[newIdx];
    const page = outDoc.getPage(newIdx);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const pageAnnotations = annotations.filter((a) => a.pageIndex === origIdx);

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
        page.drawText(t.text, {
          x: pdfX,
          y: Math.max(0, pdfY),
          size: t.fontSize * scaleX,
          font,
          color: rgb(r, g, b),
        });
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
      }
    }
  }

  return outDoc.save();
}
