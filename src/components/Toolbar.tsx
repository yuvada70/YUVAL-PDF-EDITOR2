import { useCallback, useRef, useState, useEffect } from 'react'
import {
  FolderOpen, Type, PenLine, Highlighter, Pencil,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  RotateCcw, RotateCw, Trash2, Download, Eraser,
  Merge, Scissors, Copy, FileOutput, LayoutDashboard, ChevronDown,
} from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { ToolMode } from '../types'
import { exportPdf, extractPages } from '../utils/pdfExporter'

interface Props {
  onToolSelect: (tool: ToolMode) => void
  onFileOpen: (file: File) => void
  onMerge: () => void
  onSplit: () => void
  onToggleSidebar: () => void
  sidebarVisible: boolean
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

export function Toolbar({ onToolSelect, onFileOpen, onMerge, onSplit, onToggleSidebar, sidebarVisible }: Props) {
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
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-slate-800 text-white shadow-lg z-10 min-h-[52px] flex-shrink-0 overflow-visible">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />

      {/* ── File ── */}
      <SectionLabel>File</SectionLabel>
      <ToolButton icon={<FolderOpen size={16} />} label="Open PDF" onClick={() => fileRef.current?.click()} />

      <Divider />

      {/* ── Pages dropdown ── */}
      <SectionLabel>Pages</SectionLabel>
      <PagesDropdown
        hasPdf={!!store.pdfFile}
        selectedCount={selectedCount}
        sidebarVisible={sidebarVisible}
        currentPage={store.currentPage}
        total={total}
        onMerge={onMerge}
        onSplit={onSplit}
        onDuplicate={() => store.duplicatePage(store.currentPage)}
        onExportSelected={() => void handleExportSelected()}
        onToggleSidebar={onToggleSidebar}
      />

      <Divider />

      {/* ── Pages actions ── */}
      <SectionLabel>Page</SectionLabel>
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

      <ToolButton
        icon={<Eraser size={16} />}
        label="Clear Ann."
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

interface PagesDropdownProps {
  hasPdf: boolean
  selectedCount: number
  sidebarVisible: boolean
  currentPage: number
  total: number
  onMerge: () => void
  onSplit: () => void
  onDuplicate: () => void
  onExportSelected: () => void
  onToggleSidebar: () => void
}

function PagesDropdown({
  hasPdf, selectedCount, sidebarVisible,
  onMerge, onSplit, onDuplicate, onExportSelected, onToggleSidebar,
}: PagesDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    disabled = false,
    badge?: string,
  ) => (
    <button
      onClick={() => { if (!disabled) { onClick(); setOpen(false) } }}
      disabled={disabled}
      className={`flex items-center gap-3 w-full px-3 py-2 text-sm text-left transition-colors rounded ${
        disabled
          ? 'text-slate-400 cursor-not-allowed'
          : 'text-slate-800 hover:bg-blue-50 hover:text-blue-700 cursor-pointer'
      }`}
    >
      <span className={`flex-shrink-0 ${disabled ? 'text-slate-300' : 'text-slate-500'}`}>{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {badge && <span className="text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-semibold">{badge}</span>}
    </button>
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[11px] font-medium transition-colors select-none whitespace-nowrap cursor-pointer ${
          open ? 'bg-blue-600 text-white' : 'bg-slate-600 hover:bg-slate-500 text-slate-100'
        }`}
      >
        <div className="flex items-center gap-1">
          <LayoutDashboard size={16} />
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
        <span>Pages ▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 py-1.5 overflow-hidden">
          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100 mb-1">
            Page Actions
          </div>
          {item(<Merge size={15} />, 'Merge PDFs', onMerge)}
          {item(<Scissors size={15} />, 'Split PDF', onSplit, !hasPdf)}
          {item(<Copy size={15} />, 'Duplicate Page', onDuplicate, !hasPdf)}
          {item(
            <FileOutput size={15} />,
            'Export Selected',
            onExportSelected,
            !hasPdf || selectedCount === 0,
            selectedCount > 0 ? `${selectedCount} page${selectedCount !== 1 ? 's' : ''}` : undefined,
          )}
          <div className="border-t border-slate-100 mt-1 pt-1">
            {item(
              <LayoutDashboard size={15} />,
              sidebarVisible ? 'Hide Page Organizer' : 'Show Page Organizer',
              onToggleSidebar,
              !hasPdf,
              sidebarVisible ? 'ON' : undefined,
            )}
          </div>
        </div>
      )}
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
