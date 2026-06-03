import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen, Type, PenLine, Highlighter, Pencil,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  RotateCcw, RotateCw, Trash2, Download, Eraser,
  ChevronDown, FileStack, Scissors, Copy, FileOutput, LayoutGrid
} from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { ToolMode } from '../types'
import { exportPdf } from '../utils/pdfExporter'

interface Props {
  onToolSelect: (tool: ToolMode) => void
  onFileOpen: (file: File) => void
}

export function Toolbar({ onToolSelect, onFileOpen }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const mergeFileRef = useRef<HTMLInputElement>(null)
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
        store.pageRotations,
        store.pageOrder
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
    <div className="flex items-center gap-1 px-3 py-2 bg-slate-800 text-white shadow-lg z-10 overflow-x-auto">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
      <input ref={mergeFileRef} type="file" accept="application/pdf" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0]
        if (!file || !store.pdfFile) return
        e.target.value = ''
        try {
          const incoming = await file.arrayBuffer()
          const baseDoc = await PDFDocument.load(store.pdfFile)
          const addDoc = await PDFDocument.load(incoming)
          const addCount = addDoc.getPageCount()
          const indices = Array.from({ length: addCount }, (_, i) => i)
          const copied = await baseDoc.copyPages(addDoc, indices)
          copied.forEach(p => baseDoc.addPage(p))
          const merged = await baseDoc.save()
          const totalPages = baseDoc.getPageCount()
          store.setPdfFile(merged.buffer as ArrayBuffer, store.pdfName, totalPages)
          alert(`Merged ${addCount} page(s) from "${file.name}".`)
        } catch (err) {
          console.error('Merge failed', err)
          alert('Merge failed. See console for details.')
        }
      }} />

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

      <Divider />

      <PagesMenu
        disabled={!store.pdfFile}
        onMerge={() => mergeFileRef.current?.click()}
        onSplit={async () => {
          if (!store.pdfFile) return
          const order = store.pageOrder
          if (order.length === 0) return
          if (!confirm(`Split into ${order.length} separate PDF file(s)? Each page will be downloaded.`)) return
          try {
            for (let slot = 0; slot < order.length; slot++) {
              const bytes = await exportPdf(
                store.pdfFile,
                store.annotations,
                store.deletedPages,
                store.pageRotations,
                [order[slot]]
              )
              const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = store.pdfName.replace(/\.pdf$/i, '') + `_page${slot + 1}.pdf`
              a.click()
              URL.revokeObjectURL(url)
            }
          } catch (err) {
            console.error('Split failed', err)
            alert('Split failed. See console for details.')
          }
        }}
        onDuplicate={() => {
          if (!store.pdfFile) return
          store.duplicatePage(store.currentPage)
        }}
        onExportSelected={async () => {
          if (!store.pdfFile) return
          const total = store.pageOrder.length
          const input = prompt(`Enter page numbers to export (e.g. 1,3,5-7). Total pages: ${total}`)
          if (!input) return
          const selectedSlots = parsePageRange(input, total)
          if (selectedSlots.length === 0) { alert('No valid pages specified.'); return }
          try {
            const selectedOriginals = selectedSlots.map(s => store.pageOrder[s])
            const bytes = await exportPdf(
              store.pdfFile,
              store.annotations,
              store.deletedPages,
              store.pageRotations,
              selectedOriginals
            )
            const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = store.pdfName.replace(/\.pdf$/i, '') + '_selected.pdf'
            a.click()
            URL.revokeObjectURL(url)
          } catch (err) {
            console.error('Export selected failed', err)
            alert('Export failed. See console for details.')
          }
        }}
      />

      <div className="ml-auto flex-shrink-0">
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

function parsePageRange(input: string, total: number): number[] {
  const slots = new Set<number>()
  const parts = input.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10) - 1
      const to = parseInt(rangeMatch[2], 10) - 1
      for (let i = Math.max(0, from); i <= Math.min(total - 1, to); i++) slots.add(i)
    } else {
      const n = parseInt(trimmed, 10) - 1
      if (n >= 0 && n < total) slots.add(n)
    }
  }
  return Array.from(slots).sort((a, b) => a - b)
}

interface PagesMenuProps {
  disabled: boolean
  onMerge: () => void
  onSplit: () => void
  onDuplicate: () => void
  onExportSelected: () => void
}

function PagesMenu({ disabled, onMerge, onSplit, onDuplicate, onExportSelected }: PagesMenuProps) {
  const [open, setOpen] = useState(false)
  const [showOrganizer, setShowOrganizer] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const item = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button
      key={label}
      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-slate-200 hover:bg-slate-600 transition-colors whitespace-nowrap"
      onClick={() => { setOpen(false); onClick() }}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <>
      <div ref={ref} className="relative flex-shrink-0">
        <button
          className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-xs font-medium transition-colors select-none ${
            disabled
              ? 'opacity-30 cursor-not-allowed text-slate-400'
              : open
              ? 'bg-blue-600 text-white cursor-pointer'
              : 'hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'
          }`}
          onClick={() => !disabled && setOpen(o => !o)}
          title="Pages"
        >
          <div className="flex items-center gap-1">
            <LayoutGrid size={18} />
            <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
          <span className="hidden sm:block">Pages</span>
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 bg-slate-700 rounded shadow-xl border border-slate-600 z-50 min-w-max">
            {item(<FileStack size={15} />, 'Merge PDFs', onMerge)}
            {item(<Scissors size={15} />, 'Split PDF', onSplit)}
            {item(<Copy size={15} />, 'Duplicate Page', onDuplicate)}
            {item(<FileOutput size={15} />, 'Export Selected Pages', onExportSelected)}
            {item(<LayoutGrid size={15} />, 'Page Organizer', () => setShowOrganizer(true))}
          </div>
        )}
      </div>

      {showOrganizer && (
        <PageOrganizerModal onClose={() => setShowOrganizer(false)} />
      )}
    </>
  )
}

function PageOrganizerModal({ onClose }: { onClose: () => void }) {
  const store = useEditorStore()
  const [order, setOrder] = useState<number[]>([...store.pageOrder])
  const dragIdx = useRef<number | null>(null)

  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setOrder(next)
  }

  const apply = () => {
    store.reorderPages(order)
    store.setCurrentPage(0)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 rounded-lg shadow-2xl p-4 w-80 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-3">Page Organizer</h2>
        <p className="text-slate-400 text-xs mb-3">Drag pages to reorder them.</p>
        <div className="flex-1 overflow-y-auto space-y-1">
          {order.map((origIdx, slot) => (
            <div
              key={`${slot}-${origIdx}`}
              draggable
              onDragStart={() => { dragIdx.current = slot }}
              onDragOver={e => { e.preventDefault() }}
              onDrop={() => { if (dragIdx.current !== null) move(dragIdx.current, slot); dragIdx.current = null }}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 rounded px-3 py-2 cursor-grab text-sm text-slate-200 select-none"
            >
              <span className="text-slate-400 w-6 text-center">{slot + 1}</span>
              <span>Page {origIdx + 1}</span>
              <div className="ml-auto flex gap-1">
                <button
                  className="text-slate-400 hover:text-white px-1"
                  onClick={() => move(slot, Math.max(0, slot - 1))}
                  title="Move up"
                  disabled={slot === 0}
                >▲</button>
                <button
                  className="text-slate-400 hover:text-white px-1"
                  onClick={() => move(slot, Math.min(order.length - 1, slot + 1))}
                  title="Move down"
                  disabled={slot === order.length - 1}
                >▼</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded py-2 text-sm font-medium" onClick={apply}>Apply</button>
          <button className="flex-1 bg-slate-600 hover:bg-slate-500 text-white rounded py-2 text-sm font-medium" onClick={onClose}>Cancel</button>
        </div>
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
  const base = 'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-xs font-medium transition-colors select-none flex-shrink-0'
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
