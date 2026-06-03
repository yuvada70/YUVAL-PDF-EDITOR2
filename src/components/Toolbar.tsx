import { useCallback, useRef } from 'react'
import {
  FolderOpen, Type, PenLine, Highlighter, Pencil,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  RotateCcw, RotateCw, Trash2, Download, Eraser,
  Merge, Scissors, Copy, FileOutput, LayoutDashboard,
} from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { ToolMode } from '../types'
import { exportPdf, extractPages } from '../utils/pdfExporter'

interface Props {
  onToolSelect: (tool: ToolMode) => void
  onFileOpen: (file: File) => void
  onMerge: () => void
  onSplit: () => void
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function Toolbar({ onToolSelect, onFileOpen, onMerge, onSplit }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const store = useEditorStore()
  const total = store.pageOrder.length
  const selectedCount = store.selectedPages.size

  const canPrev = store.currentPage > 0
  const canNext = store.currentPage < total - 1

  const goPage = useCallback((dir: -1 | 1) => {
    const next = store.currentPage + dir
    if (next >= 0 && next < total) store.setCurrentPage(next)
  }, [store, total])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { onFileOpen(file); e.target.value = '' }
  }, [onFileOpen])

  const handleSave = useCallback(async () => {
    if (!store.pdfFile) return
    try {
      const bytes = await exportPdf(
        store.pdfFile,
        store.annotations,
        store.pageOrder,
        store.pageRotations
      )
      downloadBytes(bytes, store.pdfName.replace(/\.pdf$/i, '') + '_edited.pdf')
    } catch (err) {
      console.error('Export failed', err)
      alert('Export failed. See console for details.')
    }
  }, [store])

  const handleExportSelected = useCallback(async () => {
    if (!store.pdfFile || store.selectedPages.size === 0) return
    try {
      const positions = [...store.selectedPages].sort((a, b) => a - b)
      const origIndices = positions.map((pos) => store.pageOrder[pos])
      const bytes = await extractPages(store.pdfFile, origIndices)
      const pages = positions.map((p) => p + 1).join('-')
      downloadBytes(bytes, store.pdfName.replace(/\.pdf$/i, '') + `_pages_${pages}.pdf`)
    } catch (err) {
      console.error('Export selected failed', err)
      alert('Export failed. See console for details.')
    }
  }, [store])

  const zoomIn = () => store.setZoom(Math.min(3, store.zoom + 0.2))
  const zoomOut = () => store.setZoom(Math.max(0.3, store.zoom - 0.2))
  const zoomFit = () => store.setZoom(1)

  const toolBtn = (tool: ToolMode, icon: React.ReactNode, label: string) => (
    <ToolButton
      icon={icon}
      label={label}
      active={store.tool === tool}
      onClick={() => {
        if (store.tool === tool) store.setTool('none')
        else onToolSelect(tool)
      }}
      disabled={!store.pdfFile}
    />
  )

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-slate-800 text-white shadow-lg flex-wrap z-10 min-h-[52px]">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />

      {/* ── File ── */}
      <SectionLabel>File</SectionLabel>
      <ToolButton icon={<FolderOpen size={16} />} label="Open PDF" onClick={() => fileRef.current?.click()} />

      <Divider />

      {/* ── Pages ── */}
      <SectionLabel>Pages</SectionLabel>
      <ToolButton icon={<Merge size={16} />} label="Merge PDFs" onClick={onMerge} highlight />
      <ToolButton icon={<Scissors size={16} />} label="Split PDF" onClick={onSplit} disabled={!store.pdfFile} highlight />
      <ToolButton
        icon={<Copy size={16} />}
        label="Duplicate Page"
        onClick={() => store.duplicatePage(store.currentPage)}
        disabled={!store.pdfFile}
      />
      <ToolButton
        icon={<RotateCcw size={16} />}
        label="Rotate Left"
        onClick={() => store.rotatePage(store.currentPage, 'left')}
        disabled={!store.pdfFile}
      />
      <ToolButton
        icon={<RotateCw size={16} />}
        label="Rotate Right"
        onClick={() => store.rotatePage(store.currentPage, 'right')}
        disabled={!store.pdfFile}
      />
      <ToolButton
        icon={<Trash2 size={16} />}
        label="Delete Page"
        onClick={() => total > 1 && store.deletePage(store.currentPage)}
        disabled={!store.pdfFile || total <= 1}
        danger
      />

      <Divider />

      {/* ── Navigate ── */}
      <SectionLabel>Navigate</SectionLabel>
      <ToolButton icon={<ChevronLeft size={16} />} label="Prev" onClick={() => goPage(-1)} disabled={!canPrev} />
      <span className="text-xs text-slate-300 px-1 whitespace-nowrap tabular-nums">
        {store.pdfFile ? `${store.currentPage + 1} / ${total}` : '— / —'}
      </span>
      <ToolButton icon={<ChevronRight size={16} />} label="Next" onClick={() => goPage(1)} disabled={!canNext} />

      <Divider />

      {/* ── Zoom ── */}
      <SectionLabel>Zoom</SectionLabel>
      <ToolButton icon={<ZoomOut size={16} />} label="Zoom Out" onClick={zoomOut} disabled={!store.pdfFile} />
      <span className="text-xs text-slate-300 px-1 tabular-nums">{Math.round(store.zoom * 100)}%</span>
      <ToolButton icon={<ZoomIn size={16} />} label="Zoom In" onClick={zoomIn} disabled={!store.pdfFile} />
      <ToolButton icon={<Maximize2 size={16} />} label="Fit Page" onClick={zoomFit} disabled={!store.pdfFile} />

      <Divider />

      {/* ── Annotate ── */}
      <SectionLabel>Annotate</SectionLabel>
      {toolBtn('text', <Type size={16} />, 'Add Text')}
      {toolBtn('signature', <PenLine size={16} />, 'Signature')}
      {toolBtn('draw', <Pencil size={16} />, 'Draw')}
      {toolBtn('highlight', <Highlighter size={16} />, 'Highlight')}

      {store.tool === 'draw' && <DrawOptions />}
      {store.tool === 'text' && <TextOptions />}

      <Divider />

      {/* ── Organize ── */}
      <SectionLabel>Organize</SectionLabel>
      <div className="flex items-center gap-0.5 bg-slate-700/60 rounded px-1 py-0.5">
        <LayoutDashboard size={14} className="text-slate-400 mr-1" />
        <span className="text-[10px] text-slate-400 mr-1">Page Organizer:</span>
        <span className="text-[10px] text-slate-300">Drag thumbnails · Ctrl+click to select</span>
      </div>

      {selectedCount > 0 && (
        <>
          <div className="flex items-center gap-1 ml-1 bg-blue-600/80 rounded px-2 py-1">
            <span className="text-xs font-semibold">{selectedCount} page{selectedCount !== 1 ? 's' : ''} selected</span>
            <button
              onClick={() => void handleExportSelected()}
              className="flex items-center gap-1 ml-1 bg-white/20 hover:bg-white/30 rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
              title="Export selected pages as new PDF"
            >
              <FileOutput size={13} />
              Export Selected
            </button>
            <button
              onClick={() => {
                if (store.pageOrder.length - selectedCount >= 1) store.deleteSelectedPages()
              }}
              className="flex items-center gap-1 ml-0.5 bg-red-500/70 hover:bg-red-500 rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
              title="Delete selected pages"
            >
              <Trash2 size={13} />
              Delete
            </button>
            <button
              onClick={() => store.clearSelection()}
              className="ml-0.5 text-slate-300 hover:text-white text-xs"
              title="Clear selection"
            >✕</button>
          </div>
        </>
      )}

      <Divider />

      <ToolButton
        icon={<Eraser size={16} />}
        label="Clear Annotations"
        onClick={() => {
          if (confirm('Clear all annotations on all pages?')) {
            useEditorStore.setState({ annotations: [] })
          }
        }}
        disabled={!store.pdfFile}
      />

      <div className="ml-auto pl-2">
        <ToolButton
          icon={<Download size={16} />}
          label="Save PDF"
          onClick={() => void handleSave()}
          disabled={!store.pdfFile}
          primary
        />
      </div>
    </div>
  )
}

function DrawOptions() {
  const { drawColor, drawLineWidth, setDrawColor, setDrawLineWidth } = useEditorStore()
  return (
    <div className="flex items-center gap-2 ml-1 bg-slate-700 rounded px-2 py-1">
      <label className="text-xs text-slate-300">Color</label>
      <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
      <label className="text-xs text-slate-300">Size</label>
      <input type="range" min={1} max={20} value={drawLineWidth} onChange={(e) => setDrawLineWidth(Number(e.target.value))} className="w-20" />
      <span className="text-xs text-slate-300">{drawLineWidth}px</span>
    </div>
  )
}

function TextOptions() {
  const { textColor, textFontSize, setTextColor, setTextFontSize } = useEditorStore()
  return (
    <div className="flex items-center gap-2 ml-1 bg-slate-700 rounded px-2 py-1">
      <label className="text-xs text-slate-300">Color</label>
      <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
      <label className="text-xs text-slate-300">Size</label>
      <input type="range" min={8} max={72} value={textFontSize} onChange={(e) => setTextFontSize(Number(e.target.value))} className="w-20" />
      <span className="text-xs text-slate-300">{textFontSize}px</span>
    </div>
  )
}

function Divider() {
  return <div className="w-px h-7 bg-slate-600 mx-1 flex-shrink-0" />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-1 select-none whitespace-nowrap">
      {children}
    </span>
  )
}

interface BtnProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  highlight?: boolean
}

export function ToolButton({ icon, label, onClick, active, disabled, primary, danger, highlight }: BtnProps) {
  const base = 'flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[11px] font-medium transition-colors select-none whitespace-nowrap'
  const variant = disabled
    ? 'opacity-30 cursor-not-allowed text-slate-400'
    : primary
    ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
    : danger
    ? 'hover:bg-red-700 text-red-400 hover:text-white cursor-pointer'
    : active
    ? 'bg-blue-600 text-white cursor-pointer'
    : highlight
    ? 'bg-slate-600 hover:bg-slate-500 text-slate-100 cursor-pointer'
    : 'hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'

  return (
    <button className={`${base} ${variant}`} onClick={disabled ? undefined : onClick} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  )
}
