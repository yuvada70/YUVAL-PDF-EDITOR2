import { create } from 'zustand';
import { Annotation, ToolMode } from '../types';

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
    }),

  setCurrentPage: (page) =>
    set({ currentPage: page, selectedAnnotationId: null, editingAnnotationId: null }),
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
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
      selectedAnnotationId: s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
      editingAnnotationId: s.editingAnnotationId === id ? null : s.editingAnnotationId,
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
      return { deletedPages: next, currentPage: newPage };
    }),

  rotatePages: (pageIndices, direction) =>
    set((s) => {
      const rotations = new Map(s.pageRotations);
      const delta = direction === 'left' ? -90 : 90;
      for (const pageIndex of pageIndices) {
        const current = rotations.get(pageIndex) ?? 0;
        rotations.set(pageIndex, (current + delta + 360) % 360);
      }
      return { pageRotations: rotations };
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
      return { pageOrder: order };
    }),

  setPendingSignature: (dataUrl) => set({ pendingSignatureDataUrl: dataUrl }),
  setDrawColor: (color) => set({ drawColor: color }),
  setDrawLineWidth: (width) => set({ drawLineWidth: width }),
  setTextColor: (color) => set({ textColor: color }),
  setTextFontSize: (size) => set({ textFontSize: size }),
  setWhiteoutColor: (color) => set({ whiteoutColor: color }),
}));

// helper: get visible page list (excluding deleted), in the user's chosen display order
export function getActivePages(state: EditorState): number[] {
  return state.pageOrder.filter((i) => !state.deletedPages.has(i));
}
