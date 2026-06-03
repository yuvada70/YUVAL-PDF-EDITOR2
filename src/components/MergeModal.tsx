import { useCallback, useRef, useState } from 'react'
import { X, Upload, GripVertical, Trash2, Download, FileText } from 'lucide-react'
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
      if (file.type !== 'application/pdf') continue
      const buffer = await file.arrayBuffer()
      try {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.load(buffer)
        entries.push({
          id: Math.random().toString(36).slice(2),
          name: file.name,
          buffer,
          pageCount: doc.getPageCount(),
        })
      } catch {
        setError(`Failed to read "${file.name}". Skipped.`)
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

  const totalPages = files.reduce((s, f) => s + f.pageCount, 0)

  // Row drag-and-drop reorder
  const onRowDragStart = (id: string) => (e: React.DragEvent) => {
    dragIdRef.current = id
    e.dataTransfer.effectAllowed = 'move'
  }
  const onRowDragOver = (id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverId(id)
  }
  const onRowDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverId(null)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Merge PDFs</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* Drop zone */}
          <label
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload size={28} className="text-slate-400" />
            <span className="text-sm text-slate-600 font-medium">Add PDF files</span>
            <span className="text-xs text-slate-400">Drag & drop or click to browse</span>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => void addFiles(e.target.files)}
            />
          </label>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">{error}</p>
          )}

          {/* File list */}
          {files.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                Files — drag rows to reorder
              </p>
              {files.map((f, idx) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={onRowDragStart(f.id)}
                  onDragOver={onRowDragOver(f.id)}
                  onDrop={onRowDrop(f.id)}
                  onDragEnd={() => setDragOverId(null)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                    dragOverId === f.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <GripVertical size={16} className="text-slate-400 cursor-grab flex-shrink-0" />
                  <span className="text-xs font-semibold text-slate-500 w-5 flex-shrink-0">{idx + 1}</span>
                  <FileText size={16} className="text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 truncate">{f.name}</p>
                    <p className="text-xs text-slate-400">{f.pageCount} page{f.pageCount !== 1 ? 's' : ''}</p>
                  </div>
                  <button
                    onClick={() => remove(f.id)}
                    className="text-slate-400 hover:text-red-500 flex-shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <p className="text-xs text-slate-400 mt-1">
                Total: {files.length} files · {totalPages} pages
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleMerge()}
            disabled={files.length < 2 || loading}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={15} />
            {loading ? 'Merging…' : `Merge ${files.length} PDF${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
