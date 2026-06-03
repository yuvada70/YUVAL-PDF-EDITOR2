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
      } else return null
    }
    return [...indices].sort((a, b) => a - b)
  }

  const handleSplit = async () => {
    if (!store.pdfFile) return
    setError(null)
    setLoading(true)
    try {
      if (mode === 'all') {
        for (let pos = 0; pos < pageCount; pos++) {
          const origIdx = store.pageOrder[pos]
          const bytes = await extractPages(store.pdfFile, [origIdx])
          downloadBytes(bytes, `${baseName}_page_${pos + 1}.pdf`)
        }
      } else if (mode === 'selected') {
        if (selected.size === 0) { setError('Select at least one page.'); setLoading(false); return }
        const positions = [...selected].sort((a, b) => a - b)
        const origIndices = positions.map((pos) => store.pageOrder[pos])
        const bytes = await extractPages(store.pdfFile, origIndices)
        downloadBytes(bytes, `${baseName}_pages_${positions.map(p => p + 1).join('-')}.pdf`)
      } else {
        const positions = parseRange(rangeInput)
        if (!positions || positions.length === 0) {
          setError(`Invalid range. Use format like: 1-3, 5, 7-9 (max page: ${pageCount})`)
          setLoading(false)
          return
        }
        const origIndices = positions.map((pos) => store.pageOrder[pos])
        const bytes = await extractPages(store.pdfFile, origIndices)
        downloadBytes(bytes, `${baseName}_extract.pdf`)
      }
      onClose()
    } catch {
      setError('Operation failed. The PDF may be encrypted or corrupted.')
    } finally {
      setLoading(false)
    }
  }

  const modeConfig: { id: SplitMode; label: string; desc: string }[] = [
    { id: 'selected', label: 'Select Pages', desc: 'Click to choose specific pages → one PDF' },
    { id: 'range', label: 'Page Range', desc: 'Enter a range like 1-3, 5 → one PDF' },
    { id: 'all', label: 'Each Page Separately', desc: `Save all ${pageCount} pages as individual PDFs` },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Split PDF</h2>
            <p className="text-xs text-slate-500 mt-0.5">Extract pages from "{store.pdfName}" ({pageCount} pages)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Mode selector */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Choose export mode:</p>
            <div className="flex flex-col gap-2">
              {modeConfig.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-colors ${
                    mode === m.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 ${
                    mode === m.id ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                  }`}>
                    {mode === m.id && <div className="w-full h-full rounded-full bg-white scale-[0.4]" />}
                  </div>
                  <div>
                    <span className={`text-sm font-semibold ${mode === m.id ? 'text-blue-700' : 'text-slate-700'}`}>{m.label}</span>
                    <span className="text-xs text-slate-500 block mt-0.5">{m.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Range input */}
          {mode === 'range' && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700">Enter page range:</label>
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder={`e.g.  1-3, 5, 8-${Math.min(10, pageCount)}`}
                className="border-2 border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 font-mono"
              />
              <p className="text-xs text-slate-400">
                Separate ranges with commas. Pages are numbered 1 to {pageCount}.
              </p>
            </div>
          )}

          {/* Page picker */}
          {mode === 'selected' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Click pages to select:
                  {selected.size > 0 && <span className="ml-2 text-blue-600 font-bold">{selected.size} selected</span>}
                </p>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-xs text-blue-600 hover:underline font-medium">Select All</button>
                  <button onClick={clearAll} className="text-xs text-slate-500 hover:underline">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto pr-1">
                {store.pageOrder.map((_, pos) => {
                  const isSel = selected.has(pos)
                  return (
                    <button
                      key={pos}
                      onClick={() => togglePage(pos)}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border-2 transition-colors ${
                        isSel ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-400 bg-white'
                      }`}
                    >
                      {thumbs[pos] ? (
                        <img src={thumbs[pos]} alt={`Page ${pos + 1}`} className="w-full rounded" />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-slate-200 rounded animate-pulse flex items-center justify-center">
                          <FileText size={16} className="text-slate-400" />
                        </div>
                      )}
                      <span className={`text-xs font-bold ${isSel ? 'text-blue-600' : 'text-slate-500'}`}>{pos + 1}</span>
                      {isSel && <span className="text-[9px] text-blue-500 font-semibold">✓ Selected</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {mode === 'all' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">
                {pageCount} separate PDF files will be downloaded
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Your browser will download each page as its own file. Allow multiple downloads if prompted.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 justify-between px-6 py-4 border-t border-slate-200 flex-shrink-0 bg-slate-50 rounded-b-2xl">
          <p className="text-xs text-slate-500">
            {mode === 'selected' && selected.size === 0 && 'Select at least one page'}
            {mode === 'selected' && selected.size > 0 && `${selected.size} page${selected.size !== 1 ? 's' : ''} will be saved as one PDF`}
            {mode === 'range' && 'Specified pages will be saved as one PDF'}
            {mode === 'all' && `${pageCount} separate PDF files`}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition">
              Cancel
            </button>
            <button
              onClick={() => void handleSplit()}
              disabled={loading || (mode === 'selected' && selected.size === 0)}
              className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-semibold disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <Download size={15} />
              {loading ? 'Processing…' : 'Split & Download'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
