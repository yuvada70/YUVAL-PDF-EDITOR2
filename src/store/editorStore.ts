import { create } from 'zustand';
import { Annotation, ToolMode } from '../types';

// pageOrder holds the sequence of original page indices (0-based) as they
// appear in the current document. Deletion = remove from array.
// Duplication = insert a copy entry. Reorder = splice.

export interface EditorState {
  pdfFile: ArrayBuffer | null;
  pdfName: string;
  totalPages: number;         // original page count
  pageOrder: number[];        // ordered list of original page indices
  currentPage: number;        // index into pageOrder (visible position)
  selectedPages: Set<number>; // indices into pageOrder
  zoom: number;
  tool: ToolMode;
  annotations: Annotation[];
  pageRotations: Map<number, number>; // keyed by position in pageOrder
  pendingSignatureDataUrl: string | null;
  drawColor: string;
  drawLineWidth: number;
  textColor: string;
  textFontSize: number;

  setPdfFile: (buffer: ArrayBuffer, name: string, pages: number) => void;
  setCurrentPage: (pos: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: ToolMode) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  deletePage: (pos: number) => void;
  deleteSelectedPages: () => void;
  rotatePage: (pos: number, direction: 'left' | 'right') => void;
  reorderPages: (fromPos: number, toPos: number) => void;
  duplicatePage: (pos: number) => void;
  toggleSelectPage: (pos: number, multi: boolean) => void;
  clearSelection: () => void;
  setPendingSignature: (dataUrl: string | null) => void;
  setDrawColor: (color: string) => void;
  setDrawLineWidth: (width: number) => void;
  setTextColor: (color: string) => void;
  setTextFontSize: (size: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  pdfFile: null,
  pdfName: '',
  totalPages: 0,
  pageOrder: [],
  currentPage: 0,
  selectedPages: new Set(),
  zoom: 1,
  tool: 'none',
  annotations: [],
  pageRotations: new Map(),
  pendingSignatureDataUrl: null,
  drawColor: '#e11d48',
  drawLineWidth: 3,
  textColor: '#1e293b',
  textFontSize: 16,

  setPdfFile: (buffer, name, pages) =>
    set({
      pdfFile: buffer,
      pdfName: name,
      totalPages: pages,
      pageOrder: Array.from({ length: pages }, (_, i) => i),
      currentPage: 0,
      selectedPages: new Set(),
      annotations: [],
      pageRotations: new Map(),
      tool: 'none',
      zoom: 1,
    }),

  setCurrentPage: (pos) => set({ currentPage: pos }),
  setZoom: (zoom) => set({ zoom }),
  setTool: (tool) => set({ tool }),

  addAnnotation: (annotation) =>
    set((s) => ({ annotations: [...s.annotations, annotation] })),

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? ({ ...a, ...patch } as Annotation) : a
      ),
    })),

  removeAnnotation: (id) =>
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

  deletePage: (pos) =>
    set((s) => {
      if (s.pageOrder.length <= 1) return s;
      const newOrder = s.pageOrder.filter((_, i) => i !== pos);
      const newRotations = remapRotations(s.pageRotations, s.pageOrder.length, (i) =>
        i === pos ? null : i < pos ? i : i - 1
      );
      const newCurrent = Math.min(s.currentPage, newOrder.length - 1);
      const newSelected = new Set<number>();
      s.selectedPages.forEach((p) => {
        if (p !== pos) newSelected.add(p > pos ? p - 1 : p);
      });
      return { pageOrder: newOrder, currentPage: Math.max(0, newCurrent), pageRotations: newRotations, selectedPages: newSelected };
    }),

  deleteSelectedPages: () =>
    set((s) => {
      const toDelete = s.selectedPages;
      if (toDelete.size === 0 || s.pageOrder.length - toDelete.size < 1) return s;
      const newOrder = s.pageOrder.filter((_, i) => !toDelete.has(i));
      const newRotations = new Map<number, number>();
      let newIdx = 0;
      for (let i = 0; i < s.pageOrder.length; i++) {
        if (!toDelete.has(i)) {
          const r = s.pageRotations.get(i);
          if (r !== undefined) newRotations.set(newIdx, r);
          newIdx++;
        }
      }
      const newCurrent = Math.min(s.currentPage, newOrder.length - 1);
      return { pageOrder: newOrder, currentPage: Math.max(0, newCurrent), pageRotations: newRotations, selectedPages: new Set() };
    }),

  rotatePage: (pos, direction) =>
    set((s) => {
      const rotations = new Map(s.pageRotations);
      const current = rotations.get(pos) ?? 0;
      const delta = direction === 'left' ? -90 : 90;
      rotations.set(pos, (current + delta + 360) % 360);
      return { pageRotations: rotations };
    }),

  reorderPages: (fromPos, toPos) =>
    set((s) => {
      if (fromPos === toPos) return s;
      const newOrder = [...s.pageOrder];
      const [moved] = newOrder.splice(fromPos, 1);
      newOrder.splice(toPos, 0, moved);
      // remap rotations to follow the moved item
      const newRotations = new Map<number, number>();
      for (let i = 0; i < s.pageOrder.length; i++) {
        const origPageIdx = s.pageOrder[i];
        const newPos = newOrder.indexOf(origPageIdx);
        const r = s.pageRotations.get(i);
        if (r !== undefined) newRotations.set(newPos, r);
      }
      const newCurrent =
        s.currentPage === fromPos ? toPos
        : s.currentPage > fromPos && s.currentPage <= toPos ? s.currentPage - 1
        : s.currentPage < fromPos && s.currentPage >= toPos ? s.currentPage + 1
        : s.currentPage;
      return { pageOrder: newOrder, pageRotations: newRotations, currentPage: newCurrent };
    }),

  duplicatePage: (pos) =>
    set((s) => {
      const origIdx = s.pageOrder[pos];
      const newOrder = [...s.pageOrder];
      newOrder.splice(pos + 1, 0, origIdx);
      // shift all rotations after pos up by 1, copy rotation of pos to pos+1
      const newRotations = new Map<number, number>();
      s.pageRotations.forEach((r, i) => {
        if (i <= pos) newRotations.set(i, r);
        else newRotations.set(i + 1, r);
      });
      const sourceRot = s.pageRotations.get(pos);
      if (sourceRot !== undefined) newRotations.set(pos + 1, sourceRot);
      return { pageOrder: newOrder, pageRotations: newRotations };
    }),

  toggleSelectPage: (pos, multi) =>
    set((s) => {
      const next = multi ? new Set(s.selectedPages) : new Set<number>();
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return { selectedPages: next };
    }),

  clearSelection: () => set({ selectedPages: new Set() }),

  setPendingSignature: (dataUrl) => set({ pendingSignatureDataUrl: dataUrl }),
  setDrawColor: (color) => set({ drawColor: color }),
  setDrawLineWidth: (width) => set({ drawLineWidth: width }),
  setTextColor: (color) => set({ textColor: color }),
  setTextFontSize: (size) => set({ textFontSize: size }),
}));

function remapRotations(
  rotations: Map<number, number>,
  length: number,
  mapper: (i: number) => number | null
): Map<number, number> {
  const next = new Map<number, number>();
  for (let i = 0; i < length; i++) {
    const r = rotations.get(i);
    if (r === undefined) continue;
    const newI = mapper(i);
    if (newI !== null) next.set(newI, r);
  }
  return next;
}
