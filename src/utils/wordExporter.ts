import {
  Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun,
  Header, Footer, LevelFormat, LevelSuffix,
} from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
import { loadPdfDocument } from './pdfRenderer';
import { RTL_RE } from './hebrewFont';

/** Pre-extracted branding to use instead of (or when) auto-detection from the
 * PDF doesn't find anything — e.g. a letterhead built from vector graphics
 * that also happens to sit too close to the body text to crop safely. */
export interface WordExportAssets {
  headerImage?: { dataUrl: string; width: number; height: number };
  footerImage?: { dataUrl: string; width: number; height: number };
}

interface Line {
  text: string;
  x0: number;
  x1: number;
  y: number;
  fontSize: number;
  rtl: boolean;
}

const NUMBERING_REFERENCE = 'pdf-extracted-clauses';
// Matches a leading list marker in either order a source PDF may store it in
// — "1. " (typed normally) or ".1 " (the period placed before the digit,
// which happens when an RTL document's own author typed the marker as
// literal characters rather than using real list numbering).
const NUMBER_MARKER_RE = /^\.?(\d+)\.?\s+/;
const SUBJECT_LINE_RE = /^הנדון\s*[:：]/;

/**
 * Reconstruct a page's text as lines, grouping text items by their Y
 * position rather than relying on pdf.js's hasEOL flag, which is a rough
 * heuristic that many PDF producers trip up (e.g. justified text, tables,
 * or unusual line spacing can make it miss or over-report line breaks).
 */
async function extractPageLines(
  doc: pdfjsLib.PDFDocumentProxy,
  pageIndex: number
): Promise<{ lines: Line[]; pageWidth: number; pageHeight: number }> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  type Item = { text: string; x: number; y: number; width: number; height: number };
  const items: Item[] = [];
  for (const raw of textContent.items) {
    if (!('str' in raw) || raw.str === '') continue;
    const height = Math.hypot(raw.transform[2], raw.transform[3]) || Math.abs(raw.transform[3]) || 10;
    items.push({ text: raw.str, x: raw.transform[4], y: raw.transform[5], width: raw.width, height });
  }
  if (items.length === 0) return { lines: [], pageWidth: viewport.width, pageHeight: viewport.height };

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

  const lines = rows.map((row) => buildLine(row)).filter((line): line is Line => line !== null);
  return { lines, pageWidth: viewport.width, pageHeight: viewport.height };
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
function buildLine(row: { text: string; x: number; y: number; width: number; height: number }[]): Line | null {
  const content = row
    .filter((it) => it.text.trim() !== '')
    .sort((a, b) => a.x - b.x);
  if (content.length === 0) return null;

  const rtl = RTL_RE.test(content.map((it) => it.text).join(''));
  const fontSize = content.reduce((sum, it) => sum + it.height, 0) / content.length;
  const x0 = Math.min(...content.map((it) => it.x));
  const x1 = Math.max(...content.map((it) => it.x + it.width));

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

  return { text: text.replace(/\s+/g, ' ').trim(), x0, x1, y: content[0].y, fontSize, rtl };
}

/** A line whose bounding box is centered on the page and clearly narrower
 * than a full paragraph line — the geometric signature of a letterhead
 * title or a subject line, as opposed to a justified body line that
 * happens to also average out to the page's midpoint. */
function isCenteredLine(line: Line, pageWidth: number): boolean {
  const mid = (line.x0 + line.x1) / 2;
  const width = line.x1 - line.x0;
  return Math.abs(mid - pageWidth / 2) < pageWidth * 0.04 && width < pageWidth * 0.7;
}

// ---------------------------------------------------------------------------
// Image extraction: the letterhead emblem is typically vector art (no
// embeddable XObject to pull out), so it's captured by rendering the page
// and cropping the band above the first line of text. The footer logo is
// usually a real raster image, found by walking the page's operator list
// for paintImageXObject calls and computing each one's placement from the
// accumulated transform matrix — the same math pdf.js's own renderer uses.
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

interface PlacedImage {
  /** Bounding box in PDF user-space (points, y-up) — used for classification. */
  pdfX0: number;
  pdfY0: number;
  pdfX1: number;
  pdfY1: number;
  /** Bounding box in the rendered canvas's device pixels — used for cropping. */
  devX0: number;
  devY0: number;
  devX1: number;
  devY1: number;
}

async function findPlacedImages(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport
): Promise<PlacedImage[]> {
  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const vt = viewport.transform as unknown as Matrix;

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const placed: PlacedImage[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = multiplyMatrix(opList.argsArray[i] as Matrix, ctm);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([ux, uy]) => [ctm[0] * ux + ctm[2] * uy + ctm[4], ctm[1] * ux + ctm[3] * uy + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const devCorners = corners.map(([x, y]) => [vt[0] * x + vt[2] * y + vt[4], vt[1] * x + vt[3] * y + vt[5]]);
      const devXs = devCorners.map((c) => c[0]);
      const devYs = devCorners.map((c) => c[1]);
      placed.push({
        pdfX0: Math.min(...xs), pdfX1: Math.max(...xs),
        pdfY0: Math.min(...ys), pdfY1: Math.max(...ys),
        devX0: Math.min(...devXs), devX1: Math.max(...devXs),
        devY0: Math.min(...devYs), devY1: Math.max(...devYs),
      });
    }
  }
  return placed;
}

function cropCanvas(source: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(x1 - x0));
  const h = Math.max(1, Math.round(y1 - y0));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  return canvas;
}

/** Trims uniform white/transparent margins and reports whether anything
 * meaningful was left — used to skip embedding a header crop when a
 * document has no letterhead art at all. */
function autoTrim(canvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; blank: boolean } {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, width, height).data;
  const isBackground = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i + 3] < 10 || (data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248);
  };
  const rowHasContent = (y: number) => {
    for (let x = 0; x < width; x++) if (!isBackground(x, y)) return true;
    return false;
  };
  const colHasContent = (x: number) => {
    for (let y = 0; y < height; y++) if (!isBackground(x, y)) return true;
    return false;
  };

  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  while (top < height && !rowHasContent(top)) top++;
  while (bottom > top && !rowHasContent(bottom)) bottom--;
  while (left < width && !colHasContent(left)) left++;
  while (right > left && !colHasContent(right)) right--;

  if (top >= bottom || left >= right) return { canvas, blank: true };
  return { canvas: cropCanvas(canvas, left, top, right + 1, bottom + 1), blank: false };
}

function canvasToPng(canvas: HTMLCanvasElement): { dataUrl: string; width: number; height: number } {
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Best-effort extraction of a header emblem (rendered from the page area
 * above the first line of text, since letterhead art is frequently vector
 * graphics with no embeddable image object) and a footer logo (a real
 * embedded image, found via the operator list, that's wide and sits in the
 * bottom band of the page — the geometric signature of a footer banner as
 * opposed to e.g. an inline signature graphic elsewhere on the page).
 */
async function detectHeaderFooterImages(
  doc: pdfjsLib.PDFDocumentProxy,
  pageIndex: number,
  firstLine: { y: number; fontSize: number } | null
): Promise<{ header?: { dataUrl: string; width: number; height: number }; footer?: { dataUrl: string; width: number; height: number } }> {
  const page = await doc.getPage(pageIndex + 1);
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;

  const placed = await findPlacedImages(page, viewport);
  const pageWidthPt = page.getViewport({ scale: 1 }).width;
  const pageHeightPt = page.getViewport({ scale: 1 }).height;

  let footer: { dataUrl: string; width: number; height: number } | undefined;
  const footerCandidate = placed.find(
    (img) => img.pdfY1 < pageHeightPt * 0.25 && img.pdfX1 - img.pdfX0 > pageWidthPt * 0.5
  );
  if (footerCandidate) {
    const cropped = cropCanvas(canvas, footerCandidate.devX0, footerCandidate.devY0, footerCandidate.devX1, footerCandidate.devY1);
    footer = canvasToPng(cropped);
  }

  let header: { dataUrl: string; width: number; height: number } | undefined;
  if (firstLine !== null) {
    // Stop the crop above the *top* of the first line's glyphs, not just
    // below its baseline — text extends upward from the baseline by
    // roughly its font size, and cropping only a few points below the
    // baseline still captures the ascenders of large letterhead titles.
    const topOfFirstLine = firstLine.y + firstLine.fontSize * 0.85;
    const bottomDev = (pageHeightPt - topOfFirstLine) * scale;
    if (bottomDev > 10) {
      const { canvas: trimmed, blank } = autoTrim(cropCanvas(canvas, 0, 0, viewport.width, bottomDev));
      if (!blank) header = canvasToPng(trimmed);
    }
  }

  return { header, footer };
}

/**
 * Convert a PDF's text content into a .docx file, reconstructing as much of
 * the original formatting as text-extraction allows:
 *
 *  - Centered, short lines (a letterhead title, a "הנדון:" subject line) are
 *    detected geometrically and rendered centered and bold; a subject line
 *    is additionally underlined.
 *  - A line that starts with a list marker (either "1." or the reversed
 *    ".1" a right-to-left document sometimes stores it as) is turned into a
 *    real Word numbered-list paragraph instead of keeping the literal
 *    marker text, so the number and period always render in the right
 *    order regardless of how the source PDF encoded it.
 *  - Everything else is a plain right-aligned, fully bidirectional
 *    paragraph.
 *  - A letterhead emblem and footer logo are extracted from the first page
 *    (see detectHeaderFooterImages) and embedded as a repeating page header
 *    and footer; `assets` can supply either image directly to skip or
 *    override auto-detection.
 *
 * This is still a text-extraction based conversion, not a layout engine:
 * it recovers editable text and the elements above, but doesn't reconstruct
 * tables, multi-column layouts, or non-letterhead inline images.
 */
export async function exportToWord(
  pdfBuffer: ArrayBuffer,
  activePages: number[],
  assets?: WordExportAssets
): Promise<Blob> {
  const doc = await loadPdfDocument(pdfBuffer);
  const children: Paragraph[] = [];

  const numbering = {
    config: [
      {
        reference: NUMBERING_REFERENCE,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            suffix: LevelSuffix.SPACE,
            alignment: AlignmentType.RIGHT,
          },
        ],
      },
    ],
  };

  for (let i = 0; i < activePages.length; i++) {
    const { lines, pageWidth } = await extractPageLines(doc, activePages[i]);

    if (lines.length === 0) {
      children.push(new Paragraph({ pageBreakBefore: i > 0, text: '' }));
      continue;
    }

    lines.forEach((line, lineIdx) => {
      const centered = isCenteredLine(line, pageWidth);
      const isSubject = SUBJECT_LINE_RE.test(line.text);
      // Only treat a leading "N." as a list marker on a full paragraph
      // line — a short, indented line (e.g. a date like "7 ביולי 2026")
      // can also start with a bare digit and must not be mistaken for one.
      const isWideLine = line.x1 - line.x0 > pageWidth * 0.5;
      const numberMatch = !centered && isWideLine ? line.text.match(NUMBER_MARKER_RE) : null;
      const text = numberMatch ? line.text.slice(numberMatch[0].length) : line.text;
      const emphasize = centered || isSubject;

      children.push(
        new Paragraph({
          pageBreakBefore: i > 0 && lineIdx === 0,
          bidirectional: line.rtl,
          alignment: emphasize ? AlignmentType.CENTER : line.rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          numbering: numberMatch ? { reference: NUMBERING_REFERENCE, level: 0 } : undefined,
          spacing: { after: 120, before: numberMatch ? 160 : 0 },
          children: [
            new TextRun({ text, rightToLeft: line.rtl, bold: emphasize, underline: isSubject ? {} : undefined }),
          ],
        })
      );
    });
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: '' }));
  }

  // Letterhead header/footer: prefer explicitly supplied assets, otherwise
  // try to auto-detect them from the first page.
  let headerImage = assets?.headerImage;
  let footerImage = assets?.footerImage;
  if ((!headerImage || !footerImage) && activePages.length > 0) {
    const { lines } = await extractPageLines(doc, activePages[0]);
    const topLine = lines.reduce<Line | null>((top, l) => (!top || l.y > top.y ? l : top), null);
    const detected = await detectHeaderFooterImages(
      doc,
      activePages[0],
      topLine ? { y: topLine.y, fontSize: topLine.fontSize } : null
    );
    headerImage = headerImage ?? detected.header;
    footerImage = footerImage ?? detected.footer;
  }

  const toImageRun = (img: { dataUrl: string; width: number; height: number }, maxWidthPx: number) => {
    const scale = Math.min(1, maxWidthPx / img.width);
    return new ImageRun({
      type: 'png',
      data: dataUrlToUint8Array(img.dataUrl),
      transformation: { width: img.width * scale, height: img.height * scale },
    });
  };

  const header = headerImage
    ? new Header({
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [toImageRun(headerImage, 200)] }),
        ],
      })
    : undefined;

  const footer = footerImage
    ? new Footer({
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [toImageRun(footerImage, 500)] }),
        ],
      })
    : undefined;

  const wordDoc = new Document({
    numbering,
    sections: [
      {
        headers: header ? { default: header } : undefined,
        footers: footer ? { default: footer } : undefined,
        children,
      },
    ],
  });
  return Packer.toBlob(wordDoc);
}
