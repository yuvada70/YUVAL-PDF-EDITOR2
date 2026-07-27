import {
  Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun,
  Header, Footer, LevelFormat, LevelSuffix, LineRuleType,
  Table, TableRow, TableCell, WidthType,
} from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
import { loadPdfDocument } from './pdfRenderer';
import { RTL_RE } from './hebrewFont';
import { mapFontFamily } from './wordFonts';

/** Pre-extracted branding to use instead of (or when) auto-detection from the
 * PDF doesn't find anything — e.g. a letterhead built from vector graphics
 * that also happens to sit too close to the body text to crop safely. */
export interface WordExportAssets {
  headerImage?: { dataUrl: string; width: number; height: number };
  footerImage?: { dataUrl: string; width: number; height: number };
}

// ===========================================================================
// Shared geometry types
// ===========================================================================

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

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** pdf.js exposes getOperatorList()'s return shape as PDFOperatorList, but
 * doesn't re-export that type from its top-level module — this mirrors it
 * locally. */
interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

// ===========================================================================
// Feature 3/4/5: per-span style (bold/italic/font-size/color) extraction
// ===========================================================================

interface FontInfo {
  bold: boolean;
  italic: boolean;
  name: string;
}

// pdf.js's own `bold`/`italic` fields on a resolved font object are only
// ever populated when it fell back to a system font (missing/unparseable
// embedded font data) — for a normally-embedded font, which is the common
// case, both fields are simply `undefined`, and pdf.js does not expose the
// embedded font's actual weight/style through its public API at all (the
// converted font binary that would let something like fontkit inspect the
// OS/2 table isn't included in the object it hands to the main thread).
// The resolved PostScript name (e.g. the subsetted "BCDFEE+David-Bold") is
// therefore the only per-font signal available, and in practice PDF
// producers name a font's actual embedded weight/style variant accurately
// (a resource named "...-Bold" *is* the bold cut of the typeface, embedded
// specifically because that run needed to be bold) — it just needs to be
// read directly instead of relying on pdf.js's own name check, which only
// runs on the fallback path and therefore never fires for embedded fonts.
const BOLD_NAME_RE = /bold|black|heavy|semibold|extrabold|[-,_ ]bd$/i;
const ITALIC_NAME_RE = /italic|oblique|[-,_ ]it$/i;

function inferStyleFromFontName(name: string): { bold: boolean; italic: boolean } {
  // Strip the 6-letter ABCDEF+ subset tag PDF producers prepend to embedded
  // font names so it can't accidentally match one of the style keywords.
  const stripped = name.replace(/^[A-Z]{6}\+/, '');
  return { bold: BOLD_NAME_RE.test(stripped), italic: ITALIC_NAME_RE.test(stripped) };
}

/** Reads bold/italic/name for a font used on the page. Must only be called
 * after page.getOperatorList() has resolved, since that's what populates
 * page.commonObjs. */
function getFontInfo(page: pdfjsLib.PDFPageProxy, fontName: string, cache: Map<string, FontInfo>): FontInfo {
  const cached = cache.get(fontName);
  if (cached) return cached;
  let info: FontInfo = { bold: false, italic: false, name: fontName };
  try {
    if (page.commonObjs.has(fontName)) {
      const obj = page.commonObjs.get(fontName) as { bold?: boolean; italic?: boolean; name?: string; fallbackName?: string };
      const resolvedName = obj.name || obj.fallbackName || fontName;
      const inferred = inferStyleFromFontName(resolvedName);
      info = { bold: !!obj.bold || inferred.bold, italic: !!obj.italic || inferred.italic, name: resolvedName };
    }
  } catch {
    // Font object not resolved yet — fall back to the default (regular) style.
  }
  cache.set(fontName, info);
  return info;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => clamp255(v).toString(16).padStart(2, '0');
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function cmykToHex(c: number, m: number, y: number, k: number): string {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  return rgbToHex(r, g, b);
}

const BLACK = '000000';

/**
 * Color isn't exposed by getTextContent(), so it's recovered by walking the
 * page's content-stream operator list, tracking the active fill color and
 * font, and recording the color in effect at each showText call — keyed by
 * font token, in call order. extractPageSpans() later "replays" this queue
 * while walking getTextContent()'s items, popping one color per non-blank
 * text item for that item's font.
 */
function buildColorQueues(opList: OperatorList): Map<string, string[]> {
  const OPS = pdfjsLib.OPS;
  const queues = new Map<string, string[]>();
  let currentColor = BLACK;
  let currentFontToken: string | null = null;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.setFillRGBColor) {
      const a = args as unknown as Record<number, number>;
      currentColor = rgbToHex(a[0], a[1], a[2]);
    } else if (fn === OPS.setFillGray) {
      const gray = (args as number[])[0] * 255;
      currentColor = rgbToHex(gray, gray, gray);
    } else if (fn === OPS.setFillCMYKColor) {
      const a = args as number[];
      currentColor = cmykToHex(a[0], a[1], a[2], a[3]);
    } else if (fn === OPS.setFont) {
      currentFontToken = (args as [string, number])[0];
    } else if (fn === OPS.showText) {
      if (currentFontToken) {
        const q = queues.get(currentFontToken);
        if (q) q.push(currentColor);
        else queues.set(currentFontToken, [currentColor]);
      }
    }
  }
  return queues;
}

// ===========================================================================
// Text extraction: spans -> lines (Features 1-5)
// ===========================================================================

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  fontSize: number;
  fontFamily: string;
}

interface Line {
  runs: Run[];
  text: string;
  x0: number;
  x1: number;
  y: number;
  fontSize: number;
  rtl: boolean;
}

interface Span {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  fontFamily: string;
}

interface PageContent {
  lines: Line[];
  gridBoundaries: GridBoundaries | null;
  pageWidth: number;
  pageHeight: number;
}

// ===========================================================================
// Feature 9: ruled-table detection (line segments -> grid -> cells)
// ===========================================================================

interface LineSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Extract straight, *stroked* line segments from the page's content-stream
 * operator list — the geometric signature of a ruled table's borders. Only
 * segments that are actually painted with a stroke are kept: a
 * constructPath call not followed by a stroke op is typically a clip region
 * (e.g. the rectangle pdf.js draws around every embedded image) rather than
 * a visible border, and counting those would produce false-positive grids
 * on almost any PDF with images.
 */
function extractLineSegments(opList: OperatorList, viewport: pdfjsLib.PageViewport): LineSegment[] {
  void viewport;
  const OPS = pdfjsLib.OPS;
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const segments: LineSegment[] = [];
  const STROKE_OPS = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke]);

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = multiplyMatrix(opList.argsArray[i] as Matrix, ctm);
    } else if (fn === OPS.constructPath) {
      const [opCodes, coords] = opList.argsArray[i] as [number[], number[], number[]];
      const isStroked = STROKE_OPS.has(opList.fnArray[i + 1]);
      if (!isStroked) continue;
      let cx = 0;
      let cy = 0;
      let ci = 0;
      for (const code of opCodes) {
        if (code === OPS.moveTo) {
          cx = coords[ci++];
          cy = coords[ci++];
        } else if (code === OPS.lineTo) {
          const nx = coords[ci++];
          const ny = coords[ci++];
          const [x0, y0] = applyMatrix(ctm, cx, cy);
          const [x1, y1] = applyMatrix(ctm, nx, ny);
          segments.push({ x0, y0, x1, y1 });
          cx = nx;
          cy = ny;
        } else if (code === OPS.rectangle) {
          const rx = coords[ci++];
          const ry = coords[ci++];
          const rw = coords[ci++];
          const rh = coords[ci++];
          const corners: [number, number][] = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh], [rx, ry]];
          for (let k = 0; k < 4; k++) {
            const [x0, y0] = applyMatrix(ctm, corners[k][0], corners[k][1]);
            const [x1, y1] = applyMatrix(ctm, corners[k + 1][0], corners[k + 1][1]);
            segments.push({ x0, y0, x1, y1 });
          }
          cx = rx;
          cy = ry;
        } else if (code === OPS.curveTo) {
          ci += 6; // skip control + end points — curves aren't table borders
        }
      }
    }
  }
  return segments;
}

const UNDERLINE_RECT_MAX_HEIGHT = 3; // pt

/**
 * Underline decorations are very commonly drawn as a single thin *filled*
 * rectangle rather than a stroked line (PDF producers do this so the bar's
 * thickness is exact regardless of viewer line-width rounding) — a shape
 * extractLineSegments deliberately ignores, since accepting any filled path
 * there would also pull in filled glyph outlines and clip regions. This
 * narrowly matches only a lone rectangle op that's actually painted (filled
 * or stroked) and geometrically thin, which glyph outlines (built from
 * curves) and clip rectangles (never painted) don't satisfy.
 */
function extractUnderlineRects(opList: OperatorList, viewport: pdfjsLib.PageViewport): LineSegment[] {
  void viewport;
  const OPS = pdfjsLib.OPS;
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const rects: LineSegment[] = [];
  const PAINT_OPS = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke]);

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = multiplyMatrix(opList.argsArray[i] as Matrix, ctm);
    } else if (fn === OPS.constructPath) {
      const [opCodes, coords] = opList.argsArray[i] as [number[], number[], number[]];
      if (opCodes.length !== 1 || opCodes[0] !== OPS.rectangle || !PAINT_OPS.has(opList.fnArray[i + 1])) continue;
      const [rx, ry, rw, rh] = coords;
      const corners = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]].map(([x, y]) => applyMatrix(ctm, x, y));
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      if (height > 0 && height <= UNDERLINE_RECT_MAX_HEIGHT && width > height) {
        const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
        rects.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: midY, y1: midY });
      }
    }
  }
  return rects;
}

const SEGMENT_MIN_LENGTH = 20; // pt — ignores tick marks / short decorative rules
const GRID_CLUSTER_TOLERANCE = 3; // pt

function clusterValues(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last[last.length - 1] <= tolerance) last.push(v);
    else clusters.push([v]);
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

interface GridBoundaries {
  rowBoundaries: number[]; // y, descending (top row first)
  colBoundaries: number[]; // x, ascending
}

/** Computes just the row/column ruling positions from stroked segments,
 * independently of any text — this has to run *before* text is grouped
 * into lines, so that a table row's cells (which sit at the same Y as each
 * other) can be kept as separate lines instead of being merged into one
 * blob of "A1 B1 C1" text by the ordinary same-row clustering. */
function computeGridBoundaries(segments: LineSegment[]): GridBoundaries | null {
  const horizontals = segments.filter((s) => Math.abs(s.y0 - s.y1) < 1 && Math.abs(s.x0 - s.x1) > SEGMENT_MIN_LENGTH);
  const verticals = segments.filter((s) => Math.abs(s.x0 - s.x1) < 1 && Math.abs(s.y0 - s.y1) > SEGMENT_MIN_LENGTH);
  if (horizontals.length < 2 || verticals.length < 2) return null;

  const rowBoundaries = clusterValues(horizontals.map((s) => s.y0), GRID_CLUSTER_TOLERANCE).sort((a, b) => b - a);
  const colBoundaries = clusterValues(verticals.map((s) => s.x0), GRID_CLUSTER_TOLERANCE).sort((a, b) => a - b);
  if (rowBoundaries.length < 2 || colBoundaries.length < 2) return null;
  return { rowBoundaries, colBoundaries };
}

/** Which column band (index into colBoundaries) an x position falls into,
 * or -1 if it's outside every band. */
function columnBandOf(x: number, colBoundaries: number[]): number {
  for (let c = 0; c < colBoundaries.length - 1; c++) {
    if (x >= colBoundaries[c] - GRID_CLUSTER_TOLERANCE && x <= colBoundaries[c + 1] + GRID_CLUSTER_TOLERANCE) return c;
  }
  return -1;
}

interface TableGrid {
  rowBoundaries: number[]; // y, descending (top row first)
  colBoundaries: number[]; // x, ascending
  cells: Line[][][]; // [row][col]
  consumed: Set<Line>;
}

function detectTableGrid(grid: GridBoundaries, lines: Line[]): TableGrid | null {
  const { rowBoundaries, colBoundaries } = grid;
  const numRows = rowBoundaries.length - 1;
  const numCols = colBoundaries.length - 1;
  const minY = rowBoundaries[rowBoundaries.length - 1];
  const maxY = rowBoundaries[0];
  const minX = colBoundaries[0];
  const maxX = colBoundaries[colBoundaries.length - 1];

  const cells: Line[][][] = Array.from({ length: numRows }, () => Array.from({ length: numCols }, () => [] as Line[]));
  const consumed = new Set<Line>();

  for (const line of lines) {
    const midX = (line.x0 + line.x1) / 2;
    const midY = line.y;
    if (midX < minX - GRID_CLUSTER_TOLERANCE || midX > maxX + GRID_CLUSTER_TOLERANCE) continue;
    if (midY < minY - GRID_CLUSTER_TOLERANCE || midY > maxY + GRID_CLUSTER_TOLERANCE) continue;
    let row = -1;
    for (let r = 0; r < numRows; r++) {
      if (midY <= rowBoundaries[r] + GRID_CLUSTER_TOLERANCE && midY >= rowBoundaries[r + 1] - GRID_CLUSTER_TOLERANCE) { row = r; break; }
    }
    let col = -1;
    for (let c = 0; c < numCols; c++) {
      if (midX >= colBoundaries[c] - GRID_CLUSTER_TOLERANCE && midX <= colBoundaries[c + 1] + GRID_CLUSTER_TOLERANCE) { col = c; break; }
    }
    if (row === -1 || col === -1) continue;
    cells[row][col].push(line);
    consumed.add(line);
  }
  if (consumed.size === 0) return null;
  return { rowBoundaries, colBoundaries, cells, consumed };
}

function buildDocxTable(grid: TableGrid, docRtl: boolean): Table {
  const numCols = grid.colBoundaries.length - 1;
  const colWidthsTwips = Array.from({ length: numCols }, (_, c) =>
    Math.max(200, Math.round((grid.colBoundaries[c + 1] - grid.colBoundaries[c]) * PT_TO_TWIPS))
  );

  const rows = grid.cells.map((rowCells) => {
    const tableCells = rowCells.map((cellLines, colIdx) => {
      const cellParagraphs =
        cellLines.length > 0
          ? cellLines
              .sort((a, b) => b.y - a.y)
              .map(
                (line) =>
                  new Paragraph({
                    bidirectional: line.rtl,
                    alignment: line.rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
                    children: line.runs.length > 0 ? line.runs.map((r) => runToTextRun(r, line.rtl)) : [new TextRun({ text: '' })],
                  })
              )
          : [new Paragraph({ text: '' })];
      return new TableCell({
        width: { size: colWidthsTwips[colIdx], type: WidthType.DXA },
        children: cellParagraphs,
      });
    });
    return new TableRow({ children: tableCells });
  });

  return new Table({
    rows,
    columnWidths: colWidthsTwips,
    visuallyRightToLeft: docRtl,
  });
}

function runToTextRun(run: Run, rtl: boolean): TextRun {
  const isHebrew = RTL_RE.test(run.text);
  return new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    color: run.color,
    size: Math.max(2, Math.round(run.fontSize * 2)),
    font: mapFontFamily(run.fontFamily, isHebrew),
    rightToLeft: rtl,
    underline: run.underline ? {} : undefined,
  });
}

async function extractPageSpans(
  doc: pdfjsLib.PDFDocumentProxy,
  pageIndex: number
): Promise<{ spans: Span[]; page: pdfjsLib.PDFPageProxy; viewport: pdfjsLib.PageViewport; opList: OperatorList }> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  // getOperatorList() must run before commonObjs/font lookups or color-queue
  // extraction can work — it's what actually resolves fonts and images.
  const opList = await page.getOperatorList();
  const textContent = await page.getTextContent();
  const colorQueues = buildColorQueues(opList);
  const colorPointers = new Map<string, number>();
  const fontInfoCache = new Map<string, FontInfo>();

  const spans: Span[] = [];
  for (const raw of textContent.items) {
    if (!('str' in raw) || raw.str === '') continue;
    const height = Math.hypot(raw.transform[2], raw.transform[3]) || Math.abs(raw.transform[3]) || 10;
    const fontToken = raw.fontName;
    const fontInfo = getFontInfo(page, fontToken, fontInfoCache);
    let color = BLACK;
    if (raw.str.trim() !== '') {
      const queue = colorQueues.get(fontToken);
      if (queue) {
        const ptr = colorPointers.get(fontToken) ?? 0;
        color = queue[Math.min(ptr, queue.length - 1)] ?? BLACK;
        colorPointers.set(fontToken, ptr + 1);
      }
    }
    spans.push({
      text: raw.str,
      x: raw.transform[4],
      y: raw.transform[5],
      width: raw.width,
      height,
      bold: fontInfo.bold,
      italic: fontInfo.italic,
      underline: false,
      color,
      fontFamily: fontInfo.name,
    });
  }
  const underlineCandidates = [...extractLineSegments(opList, viewport), ...extractUnderlineRects(opList, viewport)];
  applyUnderlinesToSpans(spans, underlineCandidates);
  return { spans, page, viewport, opList };
}

function sameRunStyle(a: Span, b: Span): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.color === b.color &&
    Math.abs(a.height - b.height) < 0.5 &&
    a.fontFamily === b.fontFamily
  );
}

/**
 * Reconstruct one line's text and style-runs from its spans, handling two
 * things a plain left-to-right join gets wrong for RTL content:
 *
 *  - Bidi run order: within an RTL line, a PDF places the run that reads
 *    first at the *highest* X. But an embedded LTR run (a date, a contract
 *    number) must keep its own internal left-to-right order — only the
 *    runs themselves get reversed, not the characters inside an LTR run.
 *  - Word spacing: PDFs don't reliably emit a literal space character
 *    between items; a real gap between two items' bounding boxes is treated
 *    as a space instead.
 *
 * Consecutive spans that share bold/italic/color/size/font are merged into a
 * single Word run so styling doesn't get needlessly fragmented per glyph run.
 */
function buildLine(row: Span[]): Line | null {
  const content = row.filter((it) => it.text.trim() !== '').sort((a, b) => a.x - b.x);
  if (content.length === 0) return null;

  const rtl = RTL_RE.test(content.map((it) => it.text).join(''));
  const fontSize = content.reduce((sum, it) => sum + it.height, 0) / content.length;
  const x0 = Math.min(...content.map((it) => it.x));
  const x1 = Math.max(...content.map((it) => it.x + it.width));

  type BidiRun = { dir: 'R' | 'L'; items: Span[] };
  const bidiRuns: BidiRun[] = [];
  for (const item of content) {
    const dir: 'R' | 'L' = RTL_RE.test(item.text) ? 'R' : 'L';
    const last = bidiRuns[bidiRuns.length - 1];
    if (last && last.dir === dir) last.items.push(item);
    else bidiRuns.push({ dir, items: [item] });
  }
  const orderedBidiRuns = rtl ? [...bidiRuns].reverse() : bidiRuns;
  const ordered = orderedBidiRuns.flatMap((run) => (run.dir === 'R' ? [...run.items].reverse() : run.items));

  const SPACE_GAP_RATIO = 0.2;
  const runs: Run[] = [];
  let text = '';
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    let prefix = '';
    if (i > 0) {
      const a = ordered[i - 1];
      const b = item;
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const gap = right.x - (left.x + left.width);
      if (gap > Math.max(left.height, right.height) * SPACE_GAP_RATIO) prefix = ' ';
    }
    text += prefix + item.text;

    const last = runs[runs.length - 1];
    if (last && !prefix.includes('\n') && i > 0 && sameRunStyle(ordered[i - 1], item)) {
      last.text += prefix + item.text;
    } else {
      runs.push({
        text: prefix + item.text,
        bold: item.bold,
        italic: item.italic,
        underline: item.underline,
        color: item.color,
        fontSize: item.height,
        fontFamily: item.fontFamily,
      });
    }
  }

  return {
    runs,
    text: text.replace(/\s+/g, ' ').trim(),
    x0,
    x1,
    y: content[0].y,
    fontSize,
    rtl,
  };
}

const UNDERLINE_OVERLAP_RATIO = 0.6;

/**
 * pdf.js's font flags don't include underline — like PyMuPDF, which recovers
 * it by looking for a stroke beneath the text rather than a font property —
 * this looks for a thin, mostly-horizontal segment (stroked line or thin
 * filled bar; see extractLineSegments / extractUnderlineRects) sitting just
 * below a span's baseline and spanning most of its width. Run per span,
 * before spans are merged into style runs, so an underlined portion of a
 * line (e.g. just the linked text of a "Subject: ..." line, not the label)
 * doesn't get merged together with a non-underlined neighbor that happens
 * to share the same font/bold/color.
 */
function applyUnderlinesToSpans(spans: Span[], segments: LineSegment[]): void {
  const horizontals = segments.filter((s) => Math.abs(s.y0 - s.y1) < 1);
  if (horizontals.length === 0) return;
  for (const span of spans) {
    if (span.text.trim() === '') continue;
    const candidates = horizontals.filter((s) => s.y0 <= span.y + 1 && s.y0 >= span.y - span.height * 0.35);
    for (const seg of candidates) {
      const segX0 = Math.min(seg.x0, seg.x1);
      const segX1 = Math.max(seg.x0, seg.x1);
      const overlap = Math.min(span.x + span.width, segX1) - Math.max(span.x, segX0);
      if (overlap / span.width >= UNDERLINE_OVERLAP_RATIO) {
        span.underline = true;
        break;
      }
    }
  }
}

async function extractPageLines(doc: pdfjsLib.PDFDocumentProxy, pageIndex: number): Promise<PageContent> {
  const { spans, page, viewport, opList } = await extractPageSpans(doc, pageIndex);
  const segments = extractLineSegments(opList, viewport);
  const gridBoundaries = computeGridBoundaries(segments);

  if (spans.length === 0) {
    return { lines: [], gridBoundaries, pageWidth: viewport.width, pageHeight: viewport.height };
  }
  spans.sort((a, b) => b.y - a.y || a.x - b.x);
  const Y_TOLERANCE = 2;
  const rows: Span[][] = [];
  for (const item of spans) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= Y_TOLERANCE) last.push(item);
    else rows.push([item]);
  }

  // A table row's cells sit at the same Y as each other, so the ordinary
  // same-row clustering above would otherwise merge "A1", "B1", "C1" into
  // one line of text ("A1 B1 C1") before table detection ever gets a
  // chance to separate them by column. Whenever a row falls inside a
  // detected grid, split it by column band first so each cell stays its
  // own line.
  const subRows: Span[][] = [];
  for (const row of rows) {
    const gb = gridBoundaries;
    const inGridRange =
      gb && row.length > 0 && row[0].y <= gb.rowBoundaries[0] + GRID_CLUSTER_TOLERANCE && row[0].y >= gb.rowBoundaries[gb.rowBoundaries.length - 1] - GRID_CLUSTER_TOLERANCE;
    if (!inGridRange || !gb) {
      subRows.push(row);
      continue;
    }
    const byBand = new Map<number, Span[]>();
    for (const item of row) {
      const band = columnBandOf(item.x + item.width / 2, gb.colBoundaries);
      const key = band === -1 ? -1 : band;
      const bucket = byBand.get(key);
      if (bucket) bucket.push(item);
      else byBand.set(key, [item]);
    }
    for (const bucket of byBand.values()) subRows.push(bucket);
  }

  const lines = subRows.map((row) => buildLine(row)).filter((line): line is Line => line !== null);
  void page;
  return { lines, gridBoundaries, pageWidth: viewport.width, pageHeight: viewport.height };
}

// ===========================================================================
// Feature 1: alignment classification from geometry
// ===========================================================================

type Alignment = 'left' | 'right' | 'center' | 'justify';

interface Margins {
  left: number;
  right: number;
}

const MARGIN_TOLERANCE = 6;

function computeMargins(lines: Line[]): Margins {
  if (lines.length === 0) return { left: 0, right: 0 };
  return {
    left: Math.min(...lines.map((l) => l.x0)),
    right: Math.max(...lines.map((l) => l.x1)),
  };
}

function touchesLeft(line: Line, margins: Margins): boolean {
  return line.x0 - margins.left <= MARGIN_TOLERANCE;
}

function touchesRight(line: Line, margins: Margins): boolean {
  return margins.right - line.x1 <= MARGIN_TOLERANCE;
}

/** A line whose bounding box is centered on the page and clearly narrower
 * than a full paragraph line is the geometric signature of a title or
 * subject line, as opposed to a justified body line that happens to also
 * average out to the page's midpoint. */
function isGeometricallyCentered(line: Line, pageWidth: number): boolean {
  const mid = (line.x0 + line.x1) / 2;
  const width = line.x1 - line.x0;
  return Math.abs(mid - pageWidth / 2) < pageWidth * 0.04 && width < pageWidth * 0.7;
}

function classifyAlignment(line: Line, margins: Margins, pageWidth: number): Alignment {
  if (isGeometricallyCentered(line, pageWidth)) return 'center';
  const left = touchesLeft(line, margins);
  const right = touchesRight(line, margins);
  if (left && right) return 'justify';
  if (right) return 'right';
  if (left) return 'left';
  // Short block touching neither margin (a date stamp, a signature block,
  // an indented list item) — these are frequently placed in their own local
  // text frame that doesn't share the body paragraphs' margins at all, so
  // "which global margin is numerically closer" is not a meaningful signal
  // (a right-anchored signature block can easily sit left-of-center on the
  // page). What *is* meaningful is the paragraph's own reading direction:
  // RTL content rests naturally against the right, LTR content against the
  // left, unless something already flagged it otherwise above.
  return line.rtl ? 'right' : 'left';
}

const ALIGNMENT_MAP: Record<Alignment, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
  justify: AlignmentType.JUSTIFIED,
};

// ===========================================================================
// Feature 2: per-paragraph RTL/LTR from majority character content
// ===========================================================================

const LATIN_RE = /[A-Za-z]/g;

function isParagraphRtl(text: string): boolean {
  const hebrewCount = (text.match(RTL_RE) || []).length;
  const latinCount = (text.match(LATIN_RE) || []).length;
  if (hebrewCount === 0 && latinCount === 0) return false;
  return hebrewCount >= latinCount;
}

// ===========================================================================
// Feature 8: list marker detection (numbers and bullets)
// ===========================================================================

// Matches a leading list marker in either order a source PDF may store it in
// — "1. " (typed normally) or ".1 " (the period placed before the digit,
// which happens when an RTL document's own author typed the marker as
// literal characters rather than using real list numbering).
const NUMBER_MARKER_RE = /^\.?(\d+)\.?\s+/;
const BULLET_MARKER_RE = /^[•\-–●○■◦‣∙·]\s+/;

interface ListMarker {
  kind: 'decimal' | 'bullet';
  strippedText: string;
}

function detectListMarker(line: Line, pageWidth: number): ListMarker | null {
  // A centered, short line is a title/heading, never a list item, even if
  // it happens to start with a digit (e.g. a year).
  if (isGeometricallyCentered(line, pageWidth)) return null;
  // A leading bare digit is only trusted as a list marker on a full
  // paragraph-width line — a short, indented line (a date like
  // "7 ביולי 2026") can also start with a digit and must not be mistaken
  // for one.
  const isWideLine = line.x1 - line.x0 > pageWidth * 0.5;
  if (isWideLine) {
    const m = line.text.match(NUMBER_MARKER_RE);
    if (m) return { kind: 'decimal', strippedText: line.text.slice(m[0].length) };
  }
  const b = line.text.match(BULLET_MARKER_RE);
  if (b) return { kind: 'bullet', strippedText: line.text.slice(b[0].length) };
  return null;
}

function stripLeadingMarkerFromRuns(runs: Run[], markerLength: number): Run[] {
  if (markerLength <= 0) return runs;
  const out: Run[] = [];
  let remaining = markerLength;
  for (const run of runs) {
    if (remaining <= 0) {
      out.push(run);
      continue;
    }
    if (run.text.length <= remaining) {
      remaining -= run.text.length;
      continue;
    }
    out.push({ ...run, text: run.text.slice(remaining) });
    remaining = 0;
  }
  return out;
}

const NUM_REF_DECIMAL_RTL = 'pdf-num-decimal-rtl';
const NUM_REF_DECIMAL_LTR = 'pdf-num-decimal-ltr';
const NUM_REF_BULLET_RTL = 'pdf-num-bullet-rtl';
const NUM_REF_BULLET_LTR = 'pdf-num-bullet-ltr';

const NUMBERING_CONFIG = {
  config: [
    { reference: NUM_REF_DECIMAL_RTL, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', suffix: LevelSuffix.SPACE, alignment: AlignmentType.RIGHT }] },
    { reference: NUM_REF_DECIMAL_LTR, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', suffix: LevelSuffix.SPACE, alignment: AlignmentType.LEFT }] },
    { reference: NUM_REF_BULLET_RTL, levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', suffix: LevelSuffix.SPACE, alignment: AlignmentType.RIGHT }] },
    { reference: NUM_REF_BULLET_LTR, levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', suffix: LevelSuffix.SPACE, alignment: AlignmentType.LEFT }] },
  ],
};

function numberingReferenceFor(marker: ListMarker, rtl: boolean): string {
  if (marker.kind === 'decimal') return rtl ? NUM_REF_DECIMAL_RTL : NUM_REF_DECIMAL_LTR;
  return rtl ? NUM_REF_BULLET_RTL : NUM_REF_BULLET_LTR;
}

// ===========================================================================
// Paragraph grouping (conservative line merging) + Feature 11: spacing
// ===========================================================================

interface ParagraphData {
  runs: Run[];
  alignment: Alignment;
  rtl: boolean;
  fontSize: number;
  marker: ListMarker | null;
  lineSpacingTwips: number | null;
  spacingAfterTwips: number;
}

const PT_TO_TWIPS = 20;

function joinRunsWithSpace(runs: Run[]): Run[] {
  if (runs.length === 0) return runs;
  const out = [...runs];
  out[0] = { ...out[0], text: ' ' + out[0].text };
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const BIG_GAP_MULTIPLIER = 1.6;

/**
 * Merge consecutive lines into one flowing paragraph unless something marks
 * a genuine new block: a centered line (a title/subject sits alone, and
 * body text never continues directly into or out of one), a new list
 * marker, or a vertical gap significantly larger than this page's normal
 * line spacing. Two lines sharing ordinary single-line-spacing are treated
 * as the same paragraph even when their *individual* geometric alignment
 * differs — e.g. a wrapped paragraph's justified body lines followed by its
 * shorter final line, which naturally doesn't reach the far margin and so
 * classifies as plain left/right on its own.
 */
function groupIntoParagraphs(lines: Line[], margins: Margins, pageWidth: number): ParagraphData[] {
  if (lines.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  const typicalGap = median(gaps);

  interface Group {
    memberLines: Line[];
    alignments: Alignment[];
    marker: ListMarker | null;
  }
  const groups: Group[] = [];

  for (const line of lines) {
    const alignment = classifyAlignment(line, margins, pageWidth);
    const marker = detectListMarker(line, pageWidth);
    const prevGroup = groups[groups.length - 1];
    const prevLine = prevGroup ? prevGroup.memberLines[prevGroup.memberLines.length - 1] : undefined;
    const prevAlignment = prevGroup ? prevGroup.alignments[prevGroup.alignments.length - 1] : undefined;

    const gapFromPrev = prevLine ? prevLine.y - line.y : Infinity;
    const isBigGap = typicalGap > 0 && gapFromPrev > typicalGap * BIG_GAP_MULTIPLIER;
    const isFontSizeJump = prevLine ? Math.abs(line.fontSize - prevLine.fontSize) >= prevLine.fontSize * 0.15 : false;

    const canMerge =
      prevGroup !== undefined &&
      marker === null &&
      prevGroup.marker === null &&
      alignment !== 'center' &&
      prevAlignment !== 'center' &&
      !isBigGap &&
      !isFontSizeJump;

    if (canMerge && prevGroup) {
      prevGroup.memberLines.push(line);
      prevGroup.alignments.push(alignment);
    } else {
      groups.push({ memberLines: [line], alignments: [alignment], marker });
    }
  }

  return groups.map((group, idx) => {
    let runs: Run[] = [];
    group.memberLines.forEach((line, i) => {
      let lineRuns = line.runs;
      if (i === 0 && group.marker) {
        const markerLen = line.text.length - group.marker.strippedText.length;
        lineRuns = stripLeadingMarkerFromRuns(lineRuns, markerLen);
      } else if (i > 0) {
        lineRuns = joinRunsWithSpace(lineRuns);
      }
      runs = runs.concat(lineRuns);
    });

    const fullText = group.memberLines.map((l) => l.text).join(' ');
    const avgFontSize = group.memberLines.reduce((s, l) => s + l.fontSize, 0) / group.memberLines.length;
    // A multi-line block where any line reached both margins reads as a
    // justified paragraph overall, even though its last (short) line can't
    // itself touch the far margin. A single-line block just keeps its own
    // classification (right/left/center).
    const alignment: Alignment =
      group.memberLines.length > 1 && group.alignments.includes('justify') ? 'justify' : group.alignments[0];

    let lineSpacingTwips: number | null = null;
    if (group.memberLines.length > 1) {
      const innerGaps: number[] = [];
      for (let i = 1; i < group.memberLines.length; i++) {
        innerGaps.push(group.memberLines[i - 1].y - group.memberLines[i].y);
      }
      const avgGap = innerGaps.reduce((a, b) => a + b, 0) / innerGaps.length;
      lineSpacingTwips = Math.round(avgGap * PT_TO_TWIPS);
    }

    const nextGroup = groups[idx + 1];
    let spacingAfterTwips = 120;
    if (nextGroup) {
      const gapToNext = group.memberLines[group.memberLines.length - 1].y - nextGroup.memberLines[0].y;
      if (gapToNext > 0) spacingAfterTwips = Math.max(40, Math.min(400, Math.round(gapToNext * PT_TO_TWIPS * 0.5)));
    }

    return {
      runs,
      alignment,
      rtl: isParagraphRtl(fullText),
      fontSize: avgFontSize,
      marker: group.marker,
      lineSpacingTwips,
      spacingAfterTwips,
    };
  });
}

// ===========================================================================
// Feature 6: image extraction and placement (header/footer/inline)
// ===========================================================================

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

async function findPlacedImages(page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<PlacedImage[]> {
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
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([ux, uy]) => applyMatrix(ctm, ux, uy));
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const devCorners = corners.map(([x, y]) => applyMatrix(vt, x, y));
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
 *
 * Certain detection of "this is the header" isn't possible from geometry
 * alone, so this deliberately stays a heuristic; callers can always
 * override it via the `assets` parameter of exportToWord.
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
    const topOfFirstLine = firstLine.y + firstLine.fontSize * 0.85;
    const bottomDev = (pageHeightPt - topOfFirstLine) * scale;
    if (bottomDev > 10) {
      const { canvas: trimmed, blank } = autoTrim(cropCanvas(canvas, 0, 0, viewport.width, bottomDev));
      if (!blank) header = canvasToPng(trimmed);
    }
  }

  return { header, footer };
}

function toImageRun(img: { dataUrl: string; width: number; height: number }, maxWidthPx: number): ImageRun {
  const scale = Math.min(1, maxWidthPx / img.width);
  return new ImageRun({
    type: 'png',
    data: dataUrlToUint8Array(img.dataUrl),
    transformation: { width: img.width * scale, height: img.height * scale },
  });
}

// ===========================================================================
// Feature 7: header/footer detection — repeating text across pages, with a
// single-page fallback based on position alone (top/bottom ~10% band).
// ===========================================================================

function normalizeForRepeat(text: string): string {
  return text.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

function bandLines(lines: Line[], pageHeight: number, band: 'top' | 'bottom'): Line[] {
  const threshold = pageHeight * 0.1;
  return lines.filter((l) => (band === 'top' ? l.y > pageHeight - threshold : l.y < threshold));
}

function signature(lines: Line[]): string {
  return lines.map((l) => normalizeForRepeat(l.text)).join('|');
}

interface RepeatingBand {
  representative: Line[];
  pageIndex: number;
  excluded: Set<Line>;
}

/** Content repeating at the same top/bottom position across most pages
 * (e.g. a running title or a "Page N" footer) is real header/footer
 * material, not body text — this only fires for multi-page documents,
 * since a single page gives no basis to tell "repeats" from "just happens
 * to be near the top". */
function detectRepeatingBand(pagesLines: Line[][], pageHeights: number[], band: 'top' | 'bottom'): RepeatingBand | null {
  if (pagesLines.length < 2) return null;
  const perPage = pagesLines.map((lines, i) => bandLines(lines, pageHeights[i], band));
  const sigCount = new Map<string, number>();
  const sigFirst = new Map<string, { lines: Line[]; pageIndex: number }>();
  perPage.forEach((bl, pageIndex) => {
    if (bl.length === 0) return;
    const sig = signature(bl);
    if (!sig) return;
    sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1);
    if (!sigFirst.has(sig)) sigFirst.set(sig, { lines: bl, pageIndex });
  });
  let bestSig: string | null = null;
  let bestCount = 0;
  for (const [sig, count] of sigCount) {
    if (count > bestCount) { bestSig = sig; bestCount = count; }
  }
  const threshold = Math.max(2, Math.ceil(pagesLines.length * 0.6));
  if (!bestSig || bestCount < threshold) return null;

  const excluded = new Set<Line>();
  perPage.forEach((bl) => {
    if (bl.length > 0 && signature(bl) === bestSig) bl.forEach((l) => excluded.add(l));
  });
  const rep = sigFirst.get(bestSig)!;
  return { representative: rep.lines, pageIndex: rep.pageIndex, excluded };
}

function buildBandParagraph(line: Line, margins: Margins, pageWidth: number): Paragraph {
  const alignment = classifyAlignment(line, margins, pageWidth);
  return new Paragraph({
    bidirectional: line.rtl,
    alignment: ALIGNMENT_MAP[alignment],
    children: line.runs.length > 0 ? line.runs.map((r) => runToTextRun(r, line.rtl)) : [new TextRun({ text: '' })],
  });
}

// ===========================================================================
// Paragraph -> docx.Paragraph
// ===========================================================================

function buildParagraph(p: ParagraphData, pageBreakBefore: boolean): Paragraph {
  const numbering = p.marker ? { reference: numberingReferenceFor(p.marker, p.rtl), level: 0 } : undefined;
  const spacing: { after: number; before?: number; line?: number; lineRule?: (typeof LineRuleType)[keyof typeof LineRuleType] } = {
    after: p.spacingAfterTwips,
  };
  if (p.marker) spacing.before = 160;
  if (p.lineSpacingTwips) {
    spacing.line = p.lineSpacingTwips;
    spacing.lineRule = LineRuleType.AT_LEAST;
  }
  return new Paragraph({
    pageBreakBefore,
    bidirectional: p.rtl,
    alignment: ALIGNMENT_MAP[p.alignment],
    numbering,
    spacing,
    children: p.runs.length > 0 ? p.runs.map((r) => runToTextRun(r, p.rtl)) : [new TextRun({ text: '' })],
  });
}

// ===========================================================================
// Orchestration
// ===========================================================================

/**
 * Convert a PDF's content into a .docx file, reconstructing as much of the
 * original formatting as span-level extraction allows: per-paragraph
 * alignment and RTL/LTR direction, bold/italic/size/color read from actual
 * font and paint state (never forced document-wide), real numbered/bulleted
 * lists, best-effort ruled-table reconstruction, header/footer images and
 * repeating header/footer text, font-family fallback by language, and
 * approximate paragraph/line spacing.
 *
 * This is still a text-extraction based conversion, not a layout engine —
 * multi-column layouts and borderless ("ghost-grid") tables aren't
 * reconstructed. Where certain detection isn't possible (e.g. whether a
 * given image is really a header logo), a reasonable heuristic is used;
 * `assets` lets a caller override the auto-detected header/footer image.
 */
export async function exportToWord(
  pdfBuffer: ArrayBuffer,
  activePages: number[],
  assets?: WordExportAssets
): Promise<Blob> {
  const doc = await loadPdfDocument(pdfBuffer);
  const children: (Paragraph | Table)[] = [];

  const pageContents: PageContent[] = [];
  for (const pageIndex of activePages) {
    pageContents.push(await extractPageLines(doc, pageIndex));
  }

  const repeatingHeader = detectRepeatingBand(pageContents.map((pc) => pc.lines), pageContents.map((pc) => pc.pageHeight), 'top');
  const repeatingFooter = detectRepeatingBand(pageContents.map((pc) => pc.lines), pageContents.map((pc) => pc.pageHeight), 'bottom');

  if (pageContents.length === 0) {
    children.push(new Paragraph({ text: '' }));
  }

  for (let i = 0; i < pageContents.length; i++) {
    const pc = pageContents[i];
    let lines = pc.lines;
    if (repeatingHeader) lines = lines.filter((l) => !repeatingHeader.excluded.has(l));
    if (repeatingFooter) lines = lines.filter((l) => !repeatingFooter.excluded.has(l));

    const grid = pc.gridBoundaries ? detectTableGrid(pc.gridBoundaries, lines) : null;
    const docRtl = isParagraphRtl(lines.map((l) => l.text).join(' '));

    let needsPageBreak = i > 0;
    if (lines.length === 0 && !grid) {
      children.push(new Paragraph({ pageBreakBefore: needsPageBreak, text: '' }));
      continue;
    }

    const margins = computeMargins(lines);
    let pending: Line[] = [];
    let tableEmitted = false;

    const flushPending = () => {
      if (pending.length === 0) return;
      const paragraphs = groupIntoParagraphs(pending, margins, pc.pageWidth);
      paragraphs.forEach((p) => {
        children.push(buildParagraph(p, needsPageBreak));
        needsPageBreak = false;
      });
      pending = [];
    };

    for (const line of lines) {
      if (grid && grid.consumed.has(line)) {
        if (!tableEmitted) {
          flushPending();
          if (needsPageBreak) {
            children.push(new Paragraph({ pageBreakBefore: true, text: '' }));
            needsPageBreak = false;
          }
          children.push(buildDocxTable(grid, docRtl));
          tableEmitted = true;
        }
        continue;
      }
      pending.push(line);
    }
    flushPending();
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: '' }));
  }

  // Header/footer images: prefer explicitly supplied assets, otherwise try
  // to auto-detect them from the first page.
  let headerImage = assets?.headerImage;
  let footerImage = assets?.footerImage;
  if ((!headerImage || !footerImage) && activePages.length > 0) {
    const firstPageLines = pageContents[0]?.lines ?? [];
    const topLine = firstPageLines.reduce<Line | null>((top, l) => (!top || l.y > top.y ? l : top), null);
    const detected = await detectHeaderFooterImages(
      doc,
      activePages[0],
      topLine ? { y: topLine.y, fontSize: topLine.fontSize } : null
    );
    headerImage = headerImage ?? detected.header;
    footerImage = footerImage ?? detected.footer;
  }

  const headerParagraphs: Paragraph[] = [];
  if (headerImage) headerParagraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [toImageRun(headerImage, 200)] }));
  if (repeatingHeader) {
    const repMargins = computeMargins(pageContents[repeatingHeader.pageIndex].lines);
    const repWidth = pageContents[repeatingHeader.pageIndex].pageWidth;
    repeatingHeader.representative.forEach((l) => headerParagraphs.push(buildBandParagraph(l, repMargins, repWidth)));
  }

  const footerParagraphs: Paragraph[] = [];
  if (repeatingFooter) {
    const repMargins = computeMargins(pageContents[repeatingFooter.pageIndex].lines);
    const repWidth = pageContents[repeatingFooter.pageIndex].pageWidth;
    repeatingFooter.representative.forEach((l) => footerParagraphs.push(buildBandParagraph(l, repMargins, repWidth)));
  }
  if (footerImage) footerParagraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [toImageRun(footerImage, 500)] }));

  const header = headerParagraphs.length > 0 ? new Header({ children: headerParagraphs }) : undefined;
  const footer = footerParagraphs.length > 0 ? new Footer({ children: footerParagraphs }) : undefined;

  const wordDoc = new Document({
    numbering: NUMBERING_CONFIG,
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
