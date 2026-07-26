import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
import { loadPdfDocument } from './pdfRenderer';
import { RTL_RE } from './hebrewFont';

interface Line {
  text: string;
  fontSize: number;
  rtl: boolean;
}

/**
 * Reconstruct a page's text as lines, grouping text items by their Y
 * position rather than relying on pdf.js's hasEOL flag, which is a rough
 * heuristic that many PDF producers trip up (e.g. justified text, tables,
 * or unusual line spacing can make it miss or over-report line breaks).
 *
 * Within a line, items are ordered left-to-right for LTR text but
 * right-to-left for RTL (Hebrew) text: a PDF's content stream places each
 * run at its own visual X position, and for an RTL line the run that reads
 * first sits at the *highest* X (closest to the right margin). Sorting
 * purely by ascending X — as if every line were LTR — scrambles word order
 * for any Hebrew line built from more than one run (dates, mixed
 * Hebrew/number text, multi-styled text, etc).
 */
async function extractPageLines(doc: pdfjsLib.PDFDocumentProxy, pageIndex: number): Promise<Line[]> {
  const page = await doc.getPage(pageIndex + 1);
  const textContent = await page.getTextContent();

  type Item = { text: string; x: number; y: number; width: number; height: number };
  const items: Item[] = [];
  for (const raw of textContent.items) {
    if (!('str' in raw) || raw.str === '') continue;
    const height = Math.hypot(raw.transform[2], raw.transform[3]) || Math.abs(raw.transform[3]) || 10;
    items.push({ text: raw.str, x: raw.transform[4], y: raw.transform[5], width: raw.width, height });
  }
  if (items.length === 0) return [];

  // Group into rows by Y position first (order within a row is fixed up below).
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

  return rows.map((row) => buildLine(row)).filter((line): line is Line => line !== null);
}

/**
 * Reconstruct one line's text from its items, handling two things a plain
 * left-to-right join gets wrong for RTL content:
 *
 *  - Bidi run order: within an RTL line, a PDF places the run that reads
 *    first at the *highest* X. But an embedded LTR run (a date, a contract
 *    number) must keep its own internal left-to-right order — only the
 *    runs themselves get reversed, not the characters inside an LTR run.
 *  - Word spacing: PDFs don't reliably emit a literal space character
 *    between runs; a real gap between two items' bounding boxes is treated
 *    as a space instead, regardless of whether pdf.js happened to insert
 *    an explicit " " item there.
 */
function buildLine(row: { text: string; x: number; width: number; height: number }[]): Line | null {
  const content = row
    .filter((it) => it.text.trim() !== '')
    .sort((a, b) => a.x - b.x);
  if (content.length === 0) return null;

  const rtl = RTL_RE.test(content.map((it) => it.text).join(''));
  const fontSize = content.reduce((sum, it) => sum + it.height, 0) / content.length;

  // Group physically-adjacent items of the same direction into runs.
  type Run = { dir: 'R' | 'L'; items: typeof content };
  const runs: Run[] = [];
  for (const item of content) {
    const dir: 'R' | 'L' = RTL_RE.test(item.text) ? 'R' : 'L';
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) last.items.push(item);
    else runs.push({ dir, items: [item] });
  }

  const orderedRuns = rtl ? [...runs].reverse() : runs;
  const ordered = orderedRuns.flatMap((run) => (run.dir === 'R' ? [...run.items].reverse() : run.items));

  const SPACE_GAP_RATIO = 0.2;
  let text = '';
  for (let i = 0; i < ordered.length; i++) {
    if (i > 0) {
      const a = ordered[i - 1];
      const b = ordered[i];
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const gap = right.x - (left.x + left.width);
      if (gap > Math.max(left.height, right.height) * SPACE_GAP_RATIO) text += ' ';
    }
    text += ordered[i].text;
  }

  return { text: text.replace(/\s+/g, ' ').trim(), fontSize, rtl };
}

/**
 * Convert a PDF's text content into a .docx file. Each PDF line becomes its
 * own Word paragraph — this keeps the source document's line structure
 * intact (important for letters, forms, and anything with headers,
 * salutations, or numbered clauses, where merging lines into flowing
 * prose would scramble the layout) at the cost of long wrapped paragraphs
 * looking a little more segmented than in the original. Lines whose font is
 * meaningfully larger than the page's body text are detected as headings
 * and rendered bold. A page break separates each PDF page.
 *
 * This is a text-extraction based conversion, not a layout engine: it
 * recovers editable text but can't reconstruct tables, images, columns, or
 * drawn annotations (signatures, highlights, freehand ink).
 */
export async function exportToWord(
  pdfBuffer: ArrayBuffer,
  activePages: number[]
): Promise<Blob> {
  const doc = await loadPdfDocument(pdfBuffer);
  const children: Paragraph[] = [];

  for (let i = 0; i < activePages.length; i++) {
    const lines = await extractPageLines(doc, activePages[i]);

    if (lines.length === 0) {
      children.push(new Paragraph({ pageBreakBefore: i > 0, text: '' }));
      continue;
    }

    const bodyFontSize = [...lines.map((l) => l.fontSize)].sort((a, b) => a - b)[Math.floor(lines.length / 2)];

    lines.forEach((line, lineIdx) => {
      const isHeading = line.fontSize > bodyFontSize * 1.15;
      children.push(
        new Paragraph({
          pageBreakBefore: i > 0 && lineIdx === 0,
          heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
          bidirectional: line.rtl,
          alignment: line.rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { after: 120 },
          children: [
            new TextRun({ text: line.text, rightToLeft: line.rtl, bold: isHeading }),
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
