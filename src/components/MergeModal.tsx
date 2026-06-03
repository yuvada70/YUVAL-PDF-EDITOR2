import { useCallback, useRef, useState } from 'react'
import { X, Upload, GripVertical, Trash2, Download, FileText, ChevronUp, ChevronDown } from 'lucide-react'
import { mergePdfs } from '../utils/pdfExporter'

interface PdfEntry {
  id: string
  name: string
  buffer: ArrayBuffer
  pageCount: number
}

interface Props {
  onClose: () => void
}

export function MergeModal({ onClose }: Props) {
  const [files, setFiles] = useState<PdfEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const addFiles = useCallback(async (picked: FileList | null) => {
    if (!picked) return
    setError(null)
    const entries: PdfEntry[] = []
    for (const file of Array.from(picked)) {
      if (file.type !== 'application/pdf') { setError(`"${file.name}" is not a PDF — skipped.`); continue }
      const buffer = await file.arrayBuffer()
      try {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.load(buffer)
        entries.push({ id: Math.random().toString(36).slice(2), name: file.name, buffer, pageCount: doc.getPageCount() })
      } catch {
        setError(`Failed to read "${file.name}" — skipped.`)
      }
    }
    setFiles((prev) => [...prev, ...entries])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    void addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleMerge = async () => {
    if (files.length < 2) return
    setLoading(true)
    setError(null)
    try {
      const bytes = await mergePdfs(files.map((f) => f.buffer))
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'merged.pdf'
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch {
      setError('Merge failed. One or more PDFs may be encrypted or corrupted.')
    } finally {
      setLoading(false)
    }
  }

  const remove = (id: string) => setFiles((f) => f.filter((e) => e.id !== id))

  const moveUp = (idx: number) => {
    if (idx === 0) return
    setFiles((prev) => { const n = [...prev]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n })
  }
  const moveDown = (idx: number) => {
    setFiles((prev) => { if (idx >= prev.length - 1) return prev; const n = [...prev]; [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]]; return n })
  }

  const totalPages = files.reduce((s, f) => s + f.pageCount, 0)

  const onRowDragStart = (id: string) => (e: React.DragEvent) => { dragIdRef.current = id; e.dataTransfer.effectAllowed = 'move' }
  const onRowDragOver = (id: string) => (e: React.DragEvent) => { e.preventDefault(); setDragOverId(id) }
  const onRowDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault(); setDragOverId(null)
    const fromId = dragIdRef.current
    if (!fromId || fromId === targetId) return
    setFiles((prev) => {
      const fromIdx = prev.findIndex((f) => f.id === fromId)
      const toIdx = prev.findIndex((f) => f.id === targetId)
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Merge PDFs</h2>
            <p className="text-xs text-slate-500 mt-0.5">Combine multiple PDF files into one document</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Step 1 */}
          <div>
            <StepLabel n={1} text="Add PDF files" />
            <label
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors mt-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload size={28} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Click or drag PDF files here</span>
              <span className="text-xs text-slate-400">You can add multiple files at once</span>
              <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden"
                onChange={(e) => void addFiles(e.target.files)} />
            </label>
          </div>

          {/* Step 2 */}
          {files.length > 0 && (
            <div>
              <StepLabel n={2} text="Set order (drag rows or use arrows)" />
              <div className="flex flex-col gap-1.5 mt-2">
                {files.map((f, idx) => (
                  <div
                    key={f.id}
                    draggable
                    onDragStart={onRowDragStart(f.id)}
                    onDragOver={onRowDragOver(f.id)}
                    onDrop={onRowDrop(f.id)}
                    onDragEnd={() => setDragOverId(null)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-colors ${
                      dragOverId === f.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <GripVertical size={16} className="text-slate-400 cursor-grab flex-shrink-0" />
                    <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <FileText size={16} className="text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{f.name}</p>
                      <p className="text-xs text-slate-400">{f.pageCount} page{f.pageCount !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button onClick={() => moveUp(idx)} disabled={idx === 0} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500">
                        <ChevronUp size={13} />
                      </button>
                      <button onClick={() => moveDown(idx)} disabled={idx === files.length - 1} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500">
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <button onClick={() => remove(f.id)} className="text-slate-400 hover:text-red-500 flex-shrink-0 p-1 rounded hover:bg-red-50">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                <span className="font-semibold text-slate-600">{files.length} files</span> · {totalPages} pages total
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 justify-between px-6 py-4 border-t border-slate-200 flex-shrink-0 bg-slate-50 rounded-b-2xl">
          <p className="text-xs text-slate-500">
            {files.length < 2 ? 'Add at least 2 PDF files to merge' : `Ready to merge ${files.length} files`}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition">
              Cancel
            </button>
            <button
              onClick={() => void handleMerge()}
              disabled={files.length < 2 || loading}
              className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-semibold disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <Download size={15} />
              {loading ? 'Merging…' : 'Merge & Download'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{n}</span>
      <span className="text-sm font-semibold text-slate-700">{text}</span>
    </div>
  )
}
