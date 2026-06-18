# PDF Editor

A fully client-side PDF editor built with React 19, Vite, TypeScript, and Tailwind CSS.

## Features

- **Open PDF** – Upload from disk or drag & drop
- **Multi-page navigation** – Previous / Next with page counter
- **Zoom** – In, Out, and Fit to page
- **Page thumbnails** – Sidebar with live thumbnails
- **Add Text** – Click anywhere to drop a text box that opens for typing immediately; drag to move, double-click or the ✎ button to re-edit, and press **Delete** to remove the selected box (empty boxes are discarded automatically)
- **Erase / Cover Existing Content** – Drag a box over existing PDF text or images to cover ("white-out") it. Pick any cover color (white, black, …); the cover is draggable, resizable, and baked into the exported PDF
- **Signature** – Draw a signature in a modal, then click to place it; resizable
- **Freehand Drawing** – Pen tool with color and size selection; mouse and touch support
- **Highlight** – Drag to draw yellow highlight rectangles (50% opacity)
- **Delete Page** – Remove the current page
- **Rotate Page** – Rotate left or right
- **Page operations** (the **Pages** menu):
  - **Merge PDFs** – Append another PDF's pages to the end of the current one
  - **Split PDF** – Split the document at the current page into two downloaded files
  - **Duplicate Page** – Insert a copy of the current page (annotations included) right after it
  - **Export Selected Pages** – Export a chosen page range (e.g. `1-3, 5`) to a new PDF
- **Clear Annotations** – Remove all annotations at once
- **Save / Export PDF** – Embeds all annotations into the PDF and downloads it

All processing happens in the browser — no backend, no uploads.

## Tech Stack

| Library | Purpose |
|---|---|
| React 19 | UI framework |
| Vite | Build tool |
| TypeScript (strict) | Type safety |
| Tailwind CSS | Styling |
| pdfjs-dist | PDF rendering |
| pdf-lib | PDF editing & export |
| react-signature-canvas | Signature pad |
| zustand | State management |
| lucide-react | Icons |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

1. Click **Open PDF** or drag a PDF onto the drop zone.
2. Navigate pages with the **‹ ›** buttons or click thumbnails.
3. Use the toolbar tools:
   - **Add Text** → click PDF → start typing right away → drag to move → double-click (or ✎) to re-edit → **Delete** to remove
   - **Erase Content** → drag a box over existing text/images to cover it → choose the cover color → drag / resize / **Delete**
   - **Signature** → draw in modal → Save → click PDF to place → drag / resize
   - **Draw** → freehand drawing directly on the page
   - **Highlight** → drag to draw a highlight box; double-click to remove
4. Use **Rotate Left / Right** and **Delete Page** for page management.
5. Click **Save PDF** to download the edited file.

## Build for Production

```bash
npm run build
npm run preview
```
