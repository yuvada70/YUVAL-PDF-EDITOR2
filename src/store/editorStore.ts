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

  deletePage: (pageIndex) =>
    set((s) => {
      const next = new Set(s.deletedPages);
      next.add(pageIndex);
      const activePagesCount = s.totalPages - next.size;
      const newPage = Math.min(s.currentPage, activePagesCount - 1);
      return { deletedPages: next, currentPage: Math.max(0, newPage) };
    }),

  rotatePage: (pageIndex, direction) =>
    set((s) => {
      const rotations = new Map(s.pageRotations);
      const current = rotations.get(pageIndex) ?? 0;
      const delta = direction === 'left' ? -90 : 90;
      rotations.set(pageIndex, (current + delta + 360) % 360);
      return { pageRotations: rotations };
    }),

  setPendingSignature: (dataUrl) => set({ pendingSignatureDataUrl: dataUrl }),
  setDrawColor: (color) => set({ drawColor: color }),
  setDrawLineWidth: (width) => set({ drawLineWidth: width }),
  setTextColor: (color) => set({ textColor: color }),
  setTextFontSize: (size) => set({ textFontSize: size }),
}));

// helper: get visible page list (excluding deleted)
export function getActivePages(state: EditorState): number[] {
  const pages: number[] = [];
  for (let i = 0; i < state.totalPages; i++) {
    if (!state.deletedPages.has(i)) pages.push(i);
  }
  return pages;
}
