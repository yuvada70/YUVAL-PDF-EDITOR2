import { useCallback, useRef } from 'react'
import {
  FolderOpen, Type, PenLine, Highlighter, Pencil,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  RotateCcw, RotateCw, Trash2, Download, Eraser
} from 'lucide-react'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { ToolMode } from '../types'
import { exportPdf } from '../utils/pdfExporter'
import { PagesMenu } from './PagesMenu'

interface Props {
  onToolSelect: (tool: ToolMode) => void
  onFileOpen: (file: File) => void
  onMerge: (file: File) => void
}

export function Toolbar({ onToolSelect, onFileOpen, onMerge }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const store = useEditorStore()
  const activePages = getActivePages(store)
  const currentVisibleIdx = activePages.indexOf(store.currentPage)

  const canPrev = currentVisibleIdx > 0
  const canNext = currentVisibleIdx < activePages.length - 1

  const goPage = useCallback((dir: -1 | 1) => {
    const newIdx = currentVisibleIdx + dir
    if (newIdx >= 0 && newIdx < activePages.length) {
      store.setCurrentPage(activePages[newIdx])
    }
  }, [currentVisibleIdx, activePages, store])

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
        store.deletedPages,
        store.pageRotations
      )
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = store.pdfName.replace(/\.pdf$/i, '') + '_edited.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed', err)
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
        if (store.tool === tool) { store.setTool('none') }
        else { onToolSelect(tool) }
      }}
      disabled={!store.pdfFile}
    />
  )

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-slate-800 text-white shadow-lg flex-wrap z-10">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
      <ToolButton icon={<FolderOpen size={18} />} label="Open PDF" onClick={() => fileRef.current?.click()} />

      <Divider />

      <ToolButton icon={<ChevronLeft size={18} />} label="Prev" onClick={() => goPage(-1)} disabled={!canPrev} />
      <span className="text-xs text-slate-300 px-1 whitespace-nowrap">
        {store.pdfFile ? `${currentVisibleIdx + 1} / ${activePages.length}` : '—'}
      </span>
      <ToolButton icon={<ChevronRight size={18} />} label="Next" onClick={() => goPage(1)} disabled={!canNext} />

      <Divider />

      <ToolButton icon={<ZoomOut size={18} />} label="Zoom Out" onClick={zoomOut} disabled={!store.pdfFile} />
      <span className="text-xs text-slate-300 px-1">{Math.round(store.zoom * 100)}%</span>
      <ToolButton icon={<ZoomIn size={18} />} label="Zoom In" onClick={zoomIn} disabled={!store.pdfFile} />
      <ToolButton icon={<Maximize2 size={18} />} label="Fit" onClick={zoomFit} disabled={!store.pdfFile} />

      <Divider />

      {toolBtn('text', <Type size={18} />, 'Add Text')}
      {toolBtn('signature', <PenLine size={18} />, 'Signature')}
      {toolBtn('draw', <Pencil size={18} />, 'Draw')}
      {toolBtn('highlight', <Highlighter size={18} />, 'Highlight')}

      {store.tool === 'draw' && <DrawOptions />}
      {store.tool === 'text' && <TextOptions />}

      <Divider />

      <ToolButton
        icon={<RotateCcw size={18} />}
        label="Rotate Left"
        onClick={() => store.rotatePage(store.currentPage, 'left')}
        disabled={!store.pdfFile}
      />
      <ToolButton
        icon={<RotateCw size={18} />}
        label="Rotate Right"
        onClick={() => store.rotatePage(store.currentPage, 'right')}
        disabled={!store.pdfFile}
      />
      <ToolButton
        icon={<Trash2 size={18} />}
        label="Delete Page"
        onClick={() => activePages.length > 1 && store.deletePage(store.currentPage)}
        disabled={!store.pdfFile || activePages.length <= 1}
        danger
      />

      <Divider />

      <PagesMenu onMerge={onMerge} />

      <Divider />

      <ToolButton
        icon={<Eraser size={18} />}
        label="Clear Annotations"
        onClick={() => {
          if (confirm('Clear all annotations on all pages?')) {
            useEditorStore.setState({ annotations: [] })
          }
        }}
        disabled={!store.pdfFile}
      />

      <div className="ml-auto">
        <ToolButton
          icon={<Download size={18} />}
          label="Save PDF"
          onClick={handleSave}
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
  return <div className="w-px h-6 bg-slate-600 mx-1 flex-shrink-0" />
}

interface BtnProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  primary?: boolean
  danger?: boolean
}

function ToolButton({ icon, label, onClick, active, disabled, primary, danger }: BtnProps) {
  const base = 'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-xs font-medium transition-colors select-none'
  const variant = disabled
    ? 'opacity-30 cursor-not-allowed text-slate-400'
    : primary
    ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
    : danger
    ? 'hover:bg-red-700 text-red-400 hover:text-white cursor-pointer'
    : active
    ? 'bg-blue-600 text-white cursor-pointer'
    : 'hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'

  return (
    <button
      className={`${base} ${variant}`}
      onClick={disabled ? undefined : onClick}
      title={label}
    >
      {icon}
      <span className="hidden sm:block">{label}</span>
    </button>
  )
}
