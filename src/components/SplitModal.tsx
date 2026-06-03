import { useEffect, useRef, useState } from 'react'
import { X, Download, FileText } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { loadPdfDocument, renderPageToDataUrl } from '../utils/pdfRenderer'
import { extractPages } from '../utils/pdfExporter'

interface Props {
  onClose: () => void
}

type SplitMode = 'selected' | 'range' | 'all'

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function SplitModal({ onClose }: Props) {
  const store = useEditorStore()
  const [thumbs, setThumbs] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rangeInput, setRangeInput] = useState('')
  const [mode, setMode] = useState<SplitMode>('selected')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const renderingRef = useRef(false)

  const pageCount = store.pageOrder.length
  const baseName = store.pdfName.replace(/\.pdf$/i, '')

  useEffect(() => {
    if (!store.pdfFile || renderingRef.current) return
    renderingRef.current = true
    void (async () => {
      const doc = await loadPdfDocument(store.pdfFile!)
      const urls: string[] = []
      for (let pos = 0; pos < store.pageOrder.length; pos++) {
        const origIdx = store.pageOrder[pos]
        const rotation = store.pageRotations.get(pos) ?? 0
        urls.push(await renderPageToDataUrl(doc, origIdx, 0.15, rotation))
      }
      setThumbs(urls)
      renderingRef.current = false
    })()
  }, [store.pdfFile, store.pageOrder, store.pageRotations])

  const togglePage = (pos: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pos)) next.delete(pos); else next.add(pos)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(Array.from({ length: pageCount }, (_, i) => i)))
  const clearAll = () => setSelected(new Set())

  // Parse range string like "1-3, 5, 7-9" → 0-based sorted unique indices
  function parseRange(input: string): number[] | null {
    const parts = input.split(',').map((s) => s.trim()).filter(Boolean)
    const indices = new Set<number>()
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        const n = parseInt(part) - 1
        if (n < 0 || n >= pageCount) return null
        indices.add(n)
      } else if (/^\d+-\d+$/.test(part)) {
        const [a, b] = part.split('-').map(Number)
        if (a < 1 || b > pageCount || a > b) return null
        for (let i = a - 1; i < b; i++) indices.add(i)
      } else {
        return null
      }
    }
    return [...indices].sort((a, b) => a - b)
  }

  const handleSplit = async () => {
    if (!store.pdfFile) return
    setError(null)
    setLoading(true)
    try {
      if (mode === 'all') {
        // Download each page as a separate PDF
        for (let pos = 0; pos < pageCount; pos++) {
          const origIdx = store.pageOrder[pos]
          const bytes = await extractPages(store.pdfFile, [origIdx])
          downloadBytes(bytes, `${baseName}_page_${pos + 1}.pdf`)
        }
      } else if (mode === 'selected') {
        if (selected.size === 0) { setError('Select at least one page.'); setLoading(false); return }
        const indices = [...selected].sort((a, b) => a - b).map((pos) => store.pageOrder[pos])
        const bytes = await extractPages(store.pdfFile, indices)
        downloadBytes(bytes, `${baseName}_pages_${[...selected].sort((a,b)=>a-b).map(p=>p+1).join('-')}.pdf`)
      } else {
        const positions = parseRange(rangeInput)
        if (!positions || positions.length === 0) {
          setError('Invalid range. Use format: 1-3, 5, 7-9')
          setLoading(false)
          return
        }
        const indices = positions.map((pos) => store.pageOrder[pos])
        const bytes = await extractPages(store.pdfFile, indices)
        downloadBytes(bytes, `${baseName}_extract.pdf`)
      }
      onClose()
    } catch {
      setError('Split failed. The PDF may be encrypted or corrupted.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Split PDF</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          {/* Mode selector */}
          <div className="flex gap-2">
            {(['selected', 'range', 'all'] as SplitMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                  mode === m
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {m === 'selected' ? 'Selected Pages' : m === 'range' ? 'Page Range' : 'Each Page'}
              </button>
            ))}
          </div>

          {mode === 'range' && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">
                Page range <span className="text-slate-400 font-normal">(e.g. 1-3, 5, 7-9)</span>
              </label>
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder={`1-${pageCount}`}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400">
                Extracts the specified pages into a single new PDF.
              </p>
            </div>
          )}

          {mode === 'all' && (
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-4 py-3 border border-slate-200">
              Each of the <strong>{pageCount}</strong> pages will be downloaded as a separate PDF file.
            </p>
          )}

          {mode === 'selected' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  Select pages to extract
                </span>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-xs text-blue-600 hover:underline">All</button>
                  <button onClick={clearAll} className="text-xs text-slate-500 hover:underline">None</button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto pr-1">
                {store.pageOrder.map((_, pos) => {
                  const isSelected = selected.has(pos)
                  return (
                    <button
                      key={pos}
                      onClick={() => togglePage(pos)}
                      className={`flex flex-col items-center gap-1 p-1 rounded-lg border-2 transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {thumbs[pos] ? (
                        <img src={thumbs[pos]} alt={`Page ${pos + 1}`} className="w-full rounded" />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-slate-200 rounded animate-pulse flex items-center justify-center">
                          <FileText size={16} className="text-slate-400" />
                        </div>
                      )}
                      <span className={`text-xs font-medium ${isSelected ? 'text-blue-600' : 'text-slate-500'}`}>
                        {pos + 1}
                      </span>
                    </button>
                  )
                })}
              </div>
              {selected.size > 0 && (
                <p className="text-xs text-slate-500">
                  {selected.size} page{selected.size !== 1 ? 's' : ''} selected → saved as one PDF
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">{error}</p>
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
            onClick={() => void handleSplit()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={15} />
            {loading ? 'Processing…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  )
}
