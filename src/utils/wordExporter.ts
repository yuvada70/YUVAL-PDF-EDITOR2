import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
import { loadPdfDocument } from './pdfRenderer';
import { RTL_RE } from './hebrewFont';

/**
 * Reconstruct a page's text as lines, using pdf.js's own end-of-line flags
 * rather than guessing from glyph positions.
 */
async function extractPageLines(doc: pdfjsLib.PDFDocumentProxy, pageIndex: number): Promise<string[]> {
  const page = await doc.getPage(pageIndex + 1);
  const textContent = await page.getTextContent();
  const lines: string[] = [];
  let current = '';
  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    current += item.str;
    if (item.hasEOL) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Convert a PDF's text content into a .docx file, one paragraph per line and
 * a page break between pages. This is a text-extraction based conversion —
 * it recovers editable text but can't reconstruct complex layouts, tables,
 * or images, and doesn't include drawn annotations (signatures, highlights,
 * freehand ink) since those aren't text.
 */
export async function exportToWord(
  pdfBuffer: ArrayBuffer,
  activePages: number[]
): Promise<Blob> {
  const doc = await loadPdfDocument(pdfBuffer);
  const children: Paragraph[] = [];

  for (let i = 0; i < activePages.length; i++) {
    const lines = await extractPageLines(doc, activePages[i]);
    const pageLines = lines.length > 0 ? lines : [''];
    pageLines.forEach((line, lineIdx) => {
      const text = line.trim();
      const rtl = RTL_RE.test(text);
      children.push(
        new Paragraph({
          pageBreakBefore: i > 0 && lineIdx === 0,
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, rightToLeft: rtl })],
        })
      );
    });
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: '' }));
  }

  const wordDoc = new Document({ sections: [{ children }] });
  return Packer.toBlob(wordDoc);
}
