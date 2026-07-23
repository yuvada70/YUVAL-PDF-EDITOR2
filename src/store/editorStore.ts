import { create } from 'zustand';
import { Annotation, ToolMode } from '../types';

// The subset of state that "undo" restores — editing tools, zoom, selection
// etc. are deliberately excluded since undoing shouldn't fight the user's
// current UI context.
interface DocSnapshot {
  pdfFile: ArrayBuffer | null;
  pdfName: string;
  totalPages: number;
  currentPage: number;
  annotations: Annotation[];
  deletedPages: Set<number>;
  pageRotations: Map<number, number>;
  pageOrder: number[];
}

const MAX_HISTORY = 50;

interface EditorState {
  pdfFile: ArrayBuffer | null;
  pdfName: string;
  totalPages: number;
  currentPage: number;
  zoom: number;
  tool: ToolMode;
  annotations: Annotation[];
  deletedPages: Set<number>;
  pageRotations: Map<number, number>;
  pageOrder: number[];
  pendingSignatureDataUrl: string | null;
  drawColor: string;
  drawLineWidth: number;
  textColor: string;
  textFontSize: number;
  whiteoutColor: string;
  selectedAnnotationId: string | null;
  editingAnnotationId: string | null;
  past: DocSnapshot[];
  future: DocSnapshot[];

  setPdfFile: (buffer: ArrayBuffer, name: string, pages: number) => void;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: ToolMode) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  selectAnnotation: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  deletePage: (pageIndex: number) => void;
  rotatePages: (pageIndices: number[], direction: 'left' | 'right') => void;
  reorderPages: (draggedOrigIdx: number, targetOrigIdx: number) => void;
  setPendingSignature: (dataUrl: string | null) => void;
  setDrawColor: (color: string) => void;
  setDrawLineWidth: (width: number) => void;
  setTextColor: (color: string) => void;
  setTextFontSize: (size: number) => void;
  setWhiteoutColor: (color: string) => void;
  /**
   * Pushes the current document state onto the undo stack. Call this once,
   * right before a mutation (or right before the first mutation of a
   * multi-step gesture like a drag or a freehand stroke) — not on every
   * intermediate update, or every mouse-move would become its own undo step.
   */
  commit: () => void;
  undo: () => void;
  redo: () => void;
}

function snapshotOf(s: EditorState): DocSnapshot {
  return {
    pdfFile: s.pdfFile,
    pdfName: s.pdfName,
    totalPages: s.totalPages,
    currentPage: s.currentPage,
    annotations: s.annotations,
    deletedPages: s.deletedPages,
    pageRotations: s.pageRotations,
    pageOrder: s.pageOrder,
  };
}

function pushPast(s: EditorState): DocSnapshot[] {
  const past = [...s.past, snapshotOf(s)];
  if (past.length > MAX_HISTORY) past.shift();
  return past;
}

export const useEditorStore = create<EditorState>((set) => ({
  pdfFile: null,
  pdfName: '',
  totalPages: 0,
  currentPage: 0,
  zoom: 1,
  tool: 'none',
  annotations: [],
  deletedPages: new Set(),
  pageRotations: new Map(),
  pageOrder: [],
  pendingSignatureDataUrl: null,
  drawColor: '#e11d48',
  drawLineWidth: 3,
  textColor: '#1e293b',
  textFontSize: 16,
  whiteoutColor: '#ffffff',
  selectedAnnotationId: null,
  editingAnnotationId: null,
  past: [],
  future: [],

  setPdfFile: (buffer, name, pages) =>
    set({
      pdfFile: buffer,
      pdfName: name,
      totalPages: pages,
      currentPage: 0,
      annotations: [],
      deletedPages: new Set(),
      pageRotations: new Map(),
      pageOrder: Array.from({ length: pages }, (_, i) => i),
      tool: 'none',
      zoom: 1,
      selectedAnnotationId: null,
      editingAnnotationId: null,
      // A newly-opened document starts a fresh history; the previous
      // document's undo stack doesn't apply to it.
      past: [],
      future: [],
    }),

  setCurrentPage: (page) =>
    set({ currentPage: page, selectedAnnotationId: null, editingAnnotationId: null }),
  setZoom: (zoom) => set({ zoom }),
  setTool: (tool) => set({ tool }),

  addAnnotation: (annotation) =>
    set((s) => ({ annotations: [...s.annotations, annotation], past: pushPast(s), future: [] })),

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? ({ ...a, ...patch } as Annotation) : a
      ),
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
      selectedAnnotationId: s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
      editingAnnotationId: s.editingAnnotationId === id ? null : s.editingAnnotationId,
      past: pushPast(s),
      future: [],
    })),

  selectAnnotation: (id) => set({ selectedAnnotationId: id }),
  setEditing: (id) => set({ editingAnnotationId: id, selectedAnnotationId: id }),

  deletePage: (pageIndex) =>
    set((s) => {
      const next = new Set(s.deletedPages);
      next.add(pageIndex);
      // Find nearest active page after deletion
      const active: number[] = [];
      for (let i = 0; i < s.totalPages; i++) {
        if (!next.has(i)) active.push(i);
      }
      // prefer the page after the deleted one, else the one before
      const newPage = active.find(p => p > pageIndex) ?? active[active.length - 1] ?? 0;
      return { deletedPages: next, currentPage: newPage, past: pushPast(s), future: [] };
    }),

  rotatePages: (pageIndices, direction) =>
    set((s) => {
      const rotations = new Map(s.pageRotations);
      const delta = direction === 'left' ? -90 : 90;
      for (const pageIndex of pageIndices) {
        const current = rotations.get(pageIndex) ?? 0;
        rotations.set(pageIndex, (current + delta + 360) % 360);
      }
      return { pageRotations: rotations, past: pushPast(s), future: [] };
    }),

  reorderPages: (draggedOrigIdx, targetOrigIdx) =>
    set((s) => {
      if (draggedOrigIdx === targetOrigIdx) return {};
      const order = [...s.pageOrder];
      const from = order.indexOf(draggedOrigIdx);
      const to = order.indexOf(targetOrigIdx);
      if (from === -1 || to === -1) return {};
      order.splice(from, 1);
      order.splice(to, 0, draggedOrigIdx);
      return { pageOrder: order, past: pushPast(s), future: [] };
    }),

  setPendingSignature: (dataUrl) => set({ pendingSignatureDataUrl: dataUrl }),
  setDrawColor: (color) => set({ drawColor: color }),
  setDrawLineWidth: (width) => set({ drawLineWidth: width }),
  setTextColor: (color) => set({ textColor: color }),
  setTextFontSize: (size) => set({ textFontSize: size }),
  setWhiteoutColor: (color) => set({ whiteoutColor: color }),

  commit: () => set((s) => ({ past: pushPast(s), future: [] })),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const previous = s.past[s.past.length - 1];
      return {
        ...previous,
        past: s.past.slice(0, -1),
        future: [...s.future, snapshotOf(s)],
        selectedAnnotationId: null,
        editingAnnotationId: null,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[s.future.length - 1];
      return {
        ...next,
        past: [...s.past, snapshotOf(s)],
        future: s.future.slice(0, -1),
        selectedAnnotationId: null,
        editingAnnotationId: null,
      };
    }),
}));

// helper: get visible page list (excluding deleted), in the user's chosen display order
export function getActivePages(state: EditorState): number[] {
  return state.pageOrder.filter((i) => !state.deletedPages.has(i));
}
