import { useCallback, useRef, useState } from 'react'
import { ChevronDown, FilePlus2, Scissors, Copy, FileOutput, LayoutGrid } from 'lucide-react'
import { PDFDocument, degrees } from 'pdf-lib'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { loadPdfDocument } from '../utils/pdfRenderer'

// ─── helpers ──────────────────────────────────────────────────────────────────

function downloadPdf(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page Organizer Modal ─────────────────────────────────────────────────────

interface PageOrganizerProps {
  onClose: () => void
}

function PageOrganizerModal({ onClose }: PageOrganizerProps) {
  const store = useEditorStore()
  const activePages = getActivePages(store)
  const [order, setOrder] = useState<number[]>(activePages) // original page indices
  const [busy, setBusy] = useState(false)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setOrder(next)
  }

  const apply = useCallback(async () => {
    if (!store.pdfFile) return
    setBusy(true)
    try {
      const src = await PDFDocument.load(store.pdfFile)
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, order)
      for (const p of copied) out.addPage(p)

      // carry over rotations for the reordered pages
      const buf = await out.save()
      const doc = await loadPdfDocument(buf.buffer as ArrayBuffer)
      store.setPdfFile(buf.buffer as ArrayBuffer, store.pdfName, doc.numPages)
      onClose()
    } finally {
      setBusy(false)
    }
  }, [order, store, onClose])

  return (
    <Modal title="Page Organizer" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-3">
        Use the arrows to reorder pages. Click <strong>Apply</strong> to rebuild the PDF.<br />
        <em>Note: annotations will be cleared.</em>
      </p>
      <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
        {order.map((origIdx, pos) => (
          <div key={`${pos}-${origIdx}`} className="flex items-center gap-2 bg-slate-100 rounded px-3 py-2">
            <span className="text-sm font-medium text-slate-600 w-6 text-center">{pos + 1}</span>
            <span className="flex-1 text-sm text-slate-700">Page {origIdx + 1}</span>
            <button
              className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
              onClick={() => move(pos, pos - 1)}
              disabled={pos === 0}
              title="Move up"
            >▲</button>
            <button
              className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
              onClick={() => move(pos, pos + 1)}
              disabled={pos === order.length - 1}
              title="Move down"
            >▼</button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="px-4 py-2 text-sm rounded bg-slate-200 hover:bg-slate-300" onClick={onClose}>Cancel</button>
        <button
          className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          onClick={apply}
          disabled={busy}
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Export Selected Pages Modal ──────────────────────────────────────────────

interface ExportPagesProps {
  onClose: () => void
}

function ExportPagesModal({ onClose }: ExportPagesProps) {
  const store = useEditorStore()
  const activePages = getActivePages(store)
  const [selected, setSelected] = useState<Set<number>>(new Set(activePages))
  const [busy, setBusy] = useState(false)

  const toggle = (idx: number) =>
    setSelected(prev => {
      const s = new Set(prev)
      s.has(idx) ? s.delete(idx) : s.add(idx)
      return s
    })

  const exportSelected = useCallback(async () => {
    if (!store.pdfFile || selected.size === 0) return
    setBusy(true)
    try {
      const src = await PDFDocument.load(store.pdfFile)
      const out = await PDFDocument.create()
      const indices = activePages.filter(i => selected.has(i))
      const copied = await out.copyPages(src, indices)

      // apply rotations
      indices.forEach((origIdx, pos) => {
        const rot = store.pageRotations.get(origIdx) ?? 0
        if (rot !== 0) {
          const page = out.getPage(pos)
          const current = page.getRotation().angle
          page.setRotation(degrees((current + rot) % 360))
        }
      })

      for (const p of copied) out.addPage(p)
      const bytes = await out.save()
      downloadPdf(bytes, store.pdfName.replace(/\.pdf$/i, '') + '_selected.pdf')
      onClose()
    } finally {
      setBusy(false)
    }
  }, [selected, activePages, store, onClose])

  return (
    <Modal title="Export Selected Pages" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-3">Choose pages to include in the exported PDF.</p>
      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {activePages.map((origIdx) => (
          <label key={origIdx} className="flex items-center gap-3 bg-slate-100 rounded px-3 py-2 cursor-pointer hover:bg-slate-200">
            <input
              type="checkbox"
              checked={selected.has(origIdx)}
              onChange={() => toggle(origIdx)}
              className="w-4 h-4"
            />
            <span className="text-sm text-slate-700">Page {origIdx + 1}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="px-4 py-2 text-sm rounded bg-slate-200 hover:bg-slate-300" onClick={onClose}>Cancel</button>
        <button
          className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          onClick={exportSelected}
          disabled={busy || selected.size === 0}
        >
          {busy ? 'Exporting…' : `Export ${selected.size} page${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </Modal>
  )
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Main PagesMenu component ─────────────────────────────────────────────────

type ModalType = 'organizer' | 'export' | null

export function PagesMenu({ onMerge }: { onMerge: (file: File) => void }) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<ModalType>(null)
  const mergeRef = useRef<HTMLInputElement>(null)
  const store = useEditorStore()
  const activePages = getActivePages(store)

  const close = () => setOpen(false)

  const handleMergeFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    onMerge(file)
  }, [onMerge])

  const splitPdf = useCallback(async () => {
    if (!store.pdfFile) return
    close()
    const currentVisibleIdx = activePages.indexOf(store.currentPage)
    if (activePages.length < 2) {
      alert('Need at least 2 pages to split.')
      return
    }
    if (currentVisibleIdx === 0) {
      alert('Navigate to a page other than the first to set the split point.')
      return
    }

    try {
      const src = await PDFDocument.load(store.pdfFile)
      const splitAt = currentVisibleIdx // pages before current page = part 1

      const part1 = await PDFDocument.create()
      const c1 = await part1.copyPages(src, activePages.slice(0, splitAt))
      for (const p of c1) part1.addPage(p)

      const part2 = await PDFDocument.create()
      const c2 = await part2.copyPages(src, activePages.slice(splitAt))
      for (const p of c2) part2.addPage(p)

      const base = store.pdfName.replace(/\.pdf$/i, '')
      downloadPdf(await part1.save(), `${base}_part1.pdf`)
      downloadPdf(await part2.save(), `${base}_part2.pdf`)
    } catch (err) {
      console.error(err)
      alert('Split failed. See console for details.')
    }
  }, [store, activePages])

  const duplicatePage = useCallback(async () => {
    if (!store.pdfFile) return
    close()
    try {
      const src = await PDFDocument.load(store.pdfFile)
      const out = await PDFDocument.create()
      const allPages = activePages

      // build new page order: insert duplicate of currentPage after its position
      const insertAfter = activePages.indexOf(store.currentPage)
      const newOrder = [
        ...allPages.slice(0, insertAfter + 1),
        store.currentPage,        // duplicate
        ...allPages.slice(insertAfter + 1),
      ]

      const copied = await out.copyPages(src, newOrder)
      for (const p of copied) out.addPage(p)

      const bytes = await out.save()
      const doc = await loadPdfDocument(bytes.buffer as ArrayBuffer)
      store.setPdfFile(bytes.buffer as ArrayBuffer, store.pdfName, doc.numPages)
    } catch (err) {
      console.error(err)
      alert('Duplicate failed. See console for details.')
    }
  }, [store, activePages])

  if (!store.pdfFile) return null

  return (
    <>
      <input ref={mergeRef} type="file" accept="application/pdf" className="hidden" onChange={handleMergeFile} />

      <div className="relative">
        <button
          className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-xs font-medium transition-colors select-none hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
          onClick={() => setOpen(v => !v)}
          title="Pages"
        >
          <span className="flex items-center gap-1">
            <LayoutGrid size={18} />
            <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
          <span className="hidden sm:block">Pages</span>
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={close} />
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-slate-200 w-52 z-30 overflow-hidden">
              <MenuItem
                icon={<FilePlus2 size={16} />}
                label="Merge PDFs"
                desc="Append another PDF"
                onClick={() => { close(); mergeRef.current?.click() }}
              />
              <MenuItem
                icon={<Scissors size={16} />}
                label="Split PDF"
                desc="Split at current page"
                onClick={splitPdf}
              />
              <MenuItem
                icon={<Copy size={16} />}
                label="Duplicate Current Page"
                desc="Insert a copy after this page"
                onClick={duplicatePage}
              />
              <MenuItem
                icon={<FileOutput size={16} />}
                label="Export Selected Pages"
                desc="Choose pages to export"
                onClick={() => { close(); setModal('export') }}
              />
              <MenuItem
                icon={<LayoutGrid size={16} />}
                label="Page Organizer"
                desc="Reorder pages"
                onClick={() => { close(); setModal('organizer') }}
              />
            </div>
          </>
        )}
      </div>

      {modal === 'organizer' && <PageOrganizerModal onClose={() => setModal(null)} />}
      {modal === 'export' && <ExportPagesModal onClose={() => setModal(null)} />}
    </>
  )
}

function MenuItem({ icon, label, desc, onClick }: { icon: React.ReactNode; label: string; desc: string; onClick: () => void }) {
  return (
    <button
      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors border-b border-slate-100 last:border-0"
      onClick={onClick}
    >
      <span className="text-slate-500 mt-0.5 flex-shrink-0">{icon}</span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
    </button>
  )
}
