import { useCallback, useRef, useState } from 'react'
import {
  FolderOpen, Type, Highlighter, Pencil, PenLine,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  RotateCcw, RotateCw, Trash2, Download, Eraser, ChevronDown,
  FilePlus2, Scissors, Copy, FileOutput, Ban
} from 'lucide-react'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { ToolMode, Annotation } from '../types'
import { exportPdf } from '../utils/pdfExporter'
import { appendPdf, duplicatePageInPdf, parsePageRanges, downloadPdfBytes } from '../utils/pageOps'
import { genId } from '../utils/id'
import { SplitModal } from './SplitModal'

interface Props {
  onToolSelect: (tool: ToolMode) => void
  onFileOpen: (file: File) => void
}

export function Toolbar({ onToolSelect, onFileOpen }: Props) {
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
        store.pageRotations,
        getActivePages(store)
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
      {toolBtn('whiteout', <Eraser size={18} />, 'Erase Content')}

      {store.tool === 'draw' && <DrawOptions />}
      {store.tool === 'text' && <TextOptions />}
      {store.tool === 'whiteout' && <WhiteoutOptions />}

      <Divider />

      <ToolButton
        icon={<RotateCcw size={18} />}
        label="Rotate Left"
        onClick={() => store.rotatePages([store.currentPage], 'left')}
        disabled={!store.pdfFile}
      />
      <ToolButton
        icon={<RotateCw size={18} />}
        label="Rotate Right"
        onClick={() => store.rotatePages([store.currentPage], 'right')}
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
        icon={<Ban size={18} />}
        label="Clear Annotations"
        onClick={() => {
          if (confirm('Clear all annotations on all pages?')) {
            useEditorStore.setState({ annotations: [] })
          }
        }}
        disabled={!store.pdfFile}
      />

      <PagesDropdown disabled={!store.pdfFile} />

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

function PagesDropdown({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)
  const mergeInputRef = useRef<HTMLInputElement>(null)

  // --- Merge: append another PDF's pages to the end of this document ---
  const handleMergeFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const s = useEditorStore.getState()
    if (!s.pdfFile) return
    setBusy(true)
    try {
      const otherBuffer = await file.arrayBuffer()
      const { buffer, addedCount } = await appendPdf(s.pdfFile, otherBuffer)
      const firstNew = s.totalPages
      const newPages = Array.from({ length: addedCount }, (_, i) => firstNew + i)
      useEditorStore.setState({
        pdfFile: buffer,
        totalPages: s.totalPages + addedCount,
        pageOrder: [...s.pageOrder, ...newPages],
        currentPage: firstNew,
      })
    } catch (err) {
      console.error('Merge failed', err)
      alert('Merge failed. Make sure the selected file is a valid PDF.')
    } finally {
      setBusy(false)
    }
  }, [])

  // --- Duplicate the current page (inserts a copy right after it) ---
  const handleDuplicate = useCallback(async () => {
    const s = useEditorStore.getState()
    if (!s.pdfFile) return
    const cur = s.currentPage
    setBusy(true)
    try {
      const buffer = await duplicatePageInPdf(s.pdfFile, cur)
      const shift = (i: number) => (i > cur ? i + 1 : i)

      // shift existing annotations down, then add copies on the new duplicate page
      const shifted: Annotation[] = s.annotations.map((a) => ({ ...a, pageIndex: shift(a.pageIndex) }))
      const dupes: Annotation[] = s.annotations
        .filter((a) => a.pageIndex === cur)
        .map((a) => ({ ...a, id: genId(), pageIndex: cur + 1 }))

      const deletedPages = new Set<number>()
      s.deletedPages.forEach((d) => deletedPages.add(shift(d)))

      const pageRotations = new Map<number, number>()
      s.pageRotations.forEach((v, k) => pageRotations.set(shift(k), v))
      const curRot = s.pageRotations.get(cur)
      if (curRot) pageRotations.set(cur + 1, curRot)

      const shiftedOrder = s.pageOrder.map(shift)
      const insertAt = shiftedOrder.indexOf(cur) + 1
      const pageOrder = [...shiftedOrder]
      pageOrder.splice(insertAt, 0, cur + 1)

      useEditorStore.setState({
        pdfFile: buffer,
        totalPages: s.totalPages + 1,
        annotations: [...shifted, ...dupes],
        deletedPages,
        pageRotations,
        pageOrder,
        currentPage: cur + 1,
      })
    } catch (err) {
      console.error('Duplicate failed', err)
      alert('Could not duplicate the page.')
    } finally {
      setBusy(false)
    }
  }, [])

  // --- Export an arbitrary selection of pages to a new PDF ---
  const handleExportSelected = useCallback(async () => {
    const s = useEditorStore.getState()
    if (!s.pdfFile) return
    const active = getActivePages(s)
    const input = prompt(
      `Which pages to export? (1-${active.length})\nExamples: 1-3, 5, 8`,
      `1-${active.length}`
    )
    if (input === null) return
    const visibleIdx = parsePageRanges(input, active.length)
    if (!visibleIdx) {
      alert('Could not understand the page selection. Try something like "1-3, 5".')
      return
    }
    const origIndices = visibleIdx.map((v) => active[v])
    setBusy(true)
    try {
      const baseName = s.pdfName.replace(/\.pdf$/i, '')
      const bytes = await exportPdf(s.pdfFile, s.annotations, s.deletedPages, s.pageRotations, origIndices)
      downloadPdfBytes(bytes, `${baseName}_pages.pdf`)
    } catch (err) {
      console.error('Export failed', err)
      alert('Export failed. See console for details.')
    } finally {
      setBusy(false)
    }
  }, [])

  const run = (fn: () => void | Promise<void>) => { setOpen(false); void fn() }

  const items = [
    { icon: <FilePlus2 size={15} />, label: 'Merge PDFs', onClick: () => run(() => mergeInputRef.current?.click()) },
    { icon: <Scissors size={15} />, label: 'Split PDF', onClick: () => run(() => setShowSplitModal(true)) },
    { icon: <Copy size={15} />, label: 'Duplicate Page', onClick: () => run(handleDuplicate) },
    { icon: <FileOutput size={15} />, label: 'Export Selected Pages', onClick: () => run(handleExportSelected) },
  ]

  return (
    <div className="relative">
      <input
        ref={mergeInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleMergeFile}
      />
      {showSplitModal && <SplitModal onClose={() => setShowSplitModal(false)} />}
      <button
        className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-xs font-medium transition-colors select-none ${
          disabled || busy
            ? 'opacity-30 cursor-not-allowed text-slate-400'
            : 'hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'
        }`}
        onClick={disabled || busy ? undefined : () => setOpen(v => !v)}
        title="Pages"
      >
        <span className="flex items-center gap-1">
          {busy ? 'Working…' : 'Pages'} <ChevronDown size={13} />
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-30 bg-slate-700 border border-slate-600 rounded shadow-lg min-w-max">
            {items.map(({ icon, label, onClick }) => (
              <button
                key={label}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-slate-200 hover:bg-slate-600 hover:text-white transition-colors"
                onClick={onClick}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </>
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

function WhiteoutOptions() {
  const { whiteoutColor, setWhiteoutColor } = useEditorStore()
  const swatches = ['#ffffff', '#000000', '#fde68a', '#cbd5e1']
  return (
    <div className="flex items-center gap-2 ml-1 bg-slate-700 rounded px-2 py-1">
      <span className="text-xs text-slate-300">Drag over content to cover it</span>
      <label className="text-xs text-slate-300">Color</label>
      <input
        type="color"
        value={whiteoutColor}
        onChange={(e) => setWhiteoutColor(e.target.value)}
        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
      />
      {swatches.map((c) => (
        <button
          key={c}
          onClick={() => setWhiteoutColor(c)}
          className={`w-4 h-4 rounded-sm border ${whiteoutColor === c ? 'ring-2 ring-blue-400' : 'border-slate-500'}`}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
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
