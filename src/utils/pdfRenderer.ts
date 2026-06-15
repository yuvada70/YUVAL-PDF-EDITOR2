import * as pdfjsLib from 'pdfjs-dist';

// Use CDN worker URL to avoid bundling/MIME-type issues on static hosts like Vercel
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

let cachedDoc: pdfjsLib.PDFDocumentProxy | null = null;
let cachedBuffer: ArrayBuffer | null = null;

export async function loadPdfDocument(
  buffer: ArrayBuffer
): Promise<pdfjsLib.PDFDocumentProxy> {
  if (cachedBuffer === buffer && cachedDoc) return cachedDoc;
  const copy = buffer.slice(0);
  const doc = await pdfjsLib.getDocument({ data: copy }).promise;
  cachedDoc = doc;
  cachedBuffer = buffer;
  return doc;
}

export async function renderPageToCanvas(
  doc: pdfjsLib.PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number
): Promise<void> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale, rotation });
  const ctx = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
}

export async function renderPageToDataUrl(
  doc: pdfjsLib.PDFDocumentProxy,
  pageIndex: number,
  scale: number,
  rotation: number
): Promise<string> {
  const canvas = document.createElement('canvas');
  await renderPageToCanvas(doc, pageIndex, canvas, scale, rotation);
  return canvas.toDataURL('image/png');
}
