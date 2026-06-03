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
  // pageOrder maps visible slot index → original page index (supports duplicates/reorder)
  pageOrder: number[];
  pendingSignatureDataUrl: string | null;
  drawColor: string;
  drawLineWidth: number;
  textColor: string;
  textFontSize: number;

  setPdfFile: (buffer: ArrayBuffer, name: string, pages: number) => void;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: ToolMode) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  deletePage: (pageIndex: number) => void;
  rotatePage: (pageIndex: number, direction: 'left' | 'right') => void;
  duplicatePage: (slotIndex: number) => void;
  reorderPages: (newOrder: number[]) => void;
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
    }),

  setCurrentPage: (page) => set({ currentPage: page }),
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

  deletePage: (slotIndex) =>
    set((s) => {
      const newOrder = s.pageOrder.filter((_, i) => i !== slotIndex);
      const newCurrent = Math.min(s.currentPage, newOrder.length - 1);
      return { pageOrder: newOrder, currentPage: Math.max(0, newCurrent) };
    }),

  rotatePage: (slotIndex, direction) =>
    set((s) => {
      const origIdx = s.pageOrder[slotIndex] ?? slotIndex;
      const rotations = new Map(s.pageRotations);
      const current = rotations.get(origIdx) ?? 0;
      const delta = direction === 'left' ? -90 : 90;
      rotations.set(origIdx, (current + delta + 360) % 360);
      return { pageRotations: rotations };
    }),

  duplicatePage: (slotIndex) =>
    set((s) => {
      const origIdx = s.pageOrder[slotIndex] ?? slotIndex;
      const newOrder = [...s.pageOrder];
      newOrder.splice(slotIndex + 1, 0, origIdx);
      return { pageOrder: newOrder, currentPage: slotIndex + 1 };
    }),

  reorderPages: (newOrder) => set({ pageOrder: newOrder }),

  setPendingSignature: (dataUrl) => set({ pendingSignatureDataUrl: dataUrl }),
  setDrawColor: (color) => set({ drawColor: color }),
  setDrawLineWidth: (width) => set({ drawLineWidth: width }),
  setTextColor: (color) => set({ textColor: color }),
  setTextFontSize: (size) => set({ textFontSize: size }),
}));

// helper: get visible slot indices (pageOrder indices that haven't been deleted)
export function getActivePages(state: EditorState): number[] {
  // Now that deletePage removes from pageOrder directly, all slot indices are active.
  // We return slot indices (0..pageOrder.length-1).
  return state.pageOrder.map((_, i) => i);
}

// helper: get original page index for a slot
export function getOriginalPageIndex(state: EditorState, slotIndex: number): number {
  return state.pageOrder[slotIndex] ?? slotIndex;
}
