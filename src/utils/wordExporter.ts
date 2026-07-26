import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
import { loadPdfDocument } from './pdfRenderer';
import { RTL_RE } from './hebrewFont';

interface Line {
  text: string;
  y: number;
  fontSize: number;
}

/**
 * Reconstruct a page's text as lines, grouping text items by their Y
 * position rather than relying on pdf.js's hasEOL flag, which is a rough
 * heuristic that many PDF producers trip up (e.g. justified text, tables,
 * or unusual line spacing can make it miss or over-report line breaks).
 * Each line also tracks its dominant font size so headings can be detected.
 */
async function extractPageLines(doc: pdfjsLib.PDFDocumentProxy, pageIndex: number): Promise<Line[]> {
  const page = await doc.getPage(pageIndex + 1);
  const textContent = await page.getTextContent();

  type Item = { text: string; x: number; y: number; height: number };
  const items: Item[] = [];
  for (const raw of textContent.items) {
    if (!('str' in raw) || raw.str === '') continue;
    const height = Math.hypot(raw.transform[2], raw.transform[3]) || Math.abs(raw.transform[3]) || 10;
    items.push({ text: raw.str, x: raw.transform[4], y: raw.transform[5], height });
  }
  if (items.length === 0) return [];

  // Reading order: top to bottom (pdf.js y grows upward, so sort descending), then left to right.
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const Y_TOLERANCE = 2;
  const rows: Item[][] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= Y_TOLERANCE) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const text = row.map((it) => it.text).join('').replace(/\s+/g, ' ').trim();
    const fontSize = row.reduce((sum, it) => sum + it.height, 0) / row.length;
    return { text, y: row[0].y, fontSize };
  }).filter((line) => line.text.length > 0);
}

/** Group lines into paragraphs: a vertical gap much larger than the page's
 * typical line spacing (or a change in font size, e.g. a heading) starts a
 * new paragraph; otherwise consecutive lines are folded into one flowing
 * paragraph so the result reads naturally instead of breaking at every
 * PDF line-wrap. */
function groupIntoParagraphs(lines: Line[]): { text: string; fontSize: number; isHeading: boolean }[] {
  if (lines.length === 0) return [];

  // The smallest recurring gap is the most reliable proxy for "spacing
  // between two lines of the same paragraph" — the median can accidentally
  // land on a paragraph-transition gap when a page only has a few lines.
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0);
  const typicalGap = gaps.length > 0 ? Math.min(...gaps) : 0;
  const bodyFontSize = [...lines.map((l) => l.fontSize)].sort((a, b) => a - b)[Math.floor(lines.length / 2)];

  const paragraphs: { text: string; fontSize: number; isHeading: boolean }[] = [];
  let current: Line[] = [lines[0]];

  const flush = () => {
    if (current.length === 0) return;
    const maxFont = Math.max(...current.map((l) => l.fontSize));
    paragraphs.push({
      text: current.map((l) => l.text).join(' '),
      fontSize: maxFont,
      isHeading: maxFont > bodyFontSize * 1.15,
    });
    current = [];
  };

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const gap = prev.y - line.y;
    // A relative threshold avoids false paragraph breaks from the sub-pixel
    // font-size jitter that's common between lines of genuinely the same size.
    const fontChanged = Math.abs(line.fontSize - prev.fontSize) > Math.max(prev.fontSize, line.fontSize) * 0.15;
    const bigGap = typicalGap > 0 && gap > typicalGap * 1.6;
    if (bigGap || fontChanged) {
      flush();
    }
    current.push(line);
  }
  flush();

  return paragraphs;
}

/**
 * Convert a PDF's text content into a .docx file: paragraphs are
 * reconstructed from the page geometry (not just raw line breaks), headings
 * are detected from relative font size and rendered bold, and a page break
 * separates each PDF page. This is a text-extraction based conversion — it
 * recovers editable text but can't reconstruct complex layouts, tables, or
 * images, and doesn't include drawn annotations (signatures, highlights,
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
    const paragraphs = groupIntoParagraphs(lines);

    if (paragraphs.length === 0) {
      children.push(new Paragraph({ pageBreakBefore: i > 0, text: '' }));
      continue;
    }

    paragraphs.forEach((p, pIdx) => {
      const rtl = RTL_RE.test(p.text);
      children.push(
        new Paragraph({
          pageBreakBefore: i > 0 && pIdx === 0,
          heading: p.isHeading ? HeadingLevel.HEADING_2 : undefined,
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { after: 160 },
          children: [
            new TextRun({ text: p.text, rightToLeft: rtl, bold: p.isHeading }),
          ],
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
