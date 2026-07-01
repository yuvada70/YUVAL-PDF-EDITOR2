import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Files, SplitSquareHorizontal, ListChecks } from 'lucide-react'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { loadPdfDocument, getPageThumbnail, THUMB_SCALE } from '../utils/pdfRenderer'
import { exportPdf } from '../utils/pdfExporter'
import { parseRangeGroups, downloadPdfBytes } from '../utils/pageOps'

interface Props {
  onClose: () => void
}

type Mode = 'each' | 'ranges' | 'extract'

// Small delay between sequential downloads so browsers don't drop any of them.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function SplitModal({ onClose }: Props) {
  const store = useEditorStore()
  const activePages = getActivePages(store)
  const [mode, setMode] = useState<Mode>('each')
  const [busy, setBusy] = useState(false)
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map())
  const [rangesInput, setRangesInput] = useState('')
  const [rangesError, setRangesError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const loadedThumbs = useRef(false)

  useEffect(() => {
    if (!store.pdfFile || loadedThumbs.current) return
    loadedThumbs.current = true
    void (async () => {
      const doc = await loadPdfDocument(store.pdfFile!)
      const next = new Map<number, string>()
      for (const idx of activePages) {
        const rotation = store.pageRotations.get(idx) ?? 0
        next.set(idx, await getPageThumbnail(doc, idx, THUMB_SCALE, rotation))
      }
      setThumbs(next)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const baseName = store.pdfName.replace(/\.pdf$/i, '')

  const handleSplitEach = useCallback(async () => {
    if (!store.pdfFile) return
    setBusy(true)
    try {
      for (let i = 0; i < activePages.length; i++) {
        const bytes = await exportPdf(store.pdfFile, store.annotations, store.deletedPages, store.pageRotations, [activePages[i]])
        downloadPdfBytes(bytes, `${baseName}_page${i + 1}.pdf`)
        await sleep(120)
      }
      onClose()
    } catch (err) {
      console.error('Split failed', err)
      alert('Split failed. See console for details.')
    } finally {
      setBusy(false)
    }
  }, [store, activePages, baseName, onClose])

  const handleSplitRanges = useCallback(async () => {
    if (!store.pdfFile) return
    const groups = parseRangeGroups(rangesInput, activePages.length)
    if (!groups) {
      setRangesError('Could not understand the ranges. Try something like "1-3, 4-6".')
      return
    }
    setRangesError(null)
    setBusy(true)
    try {
      for (let i = 0; i < groups.length; i++) {
        const origIndices = groups[i].map((v) => activePages[v])
        const bytes = await exportPdf(store.pdfFile, store.annotations, store.deletedPages, store.pageRotations, origIndices)
        const first = groups[i][0] + 1
        const last = groups[i][groups[i].length - 1] + 1
        const label = first === last ? `${first}` : `${first}-${last}`
        downloadPdfBytes(bytes, `${baseName}_pages_${label}.pdf`)
        await sleep(120)
      }
      onClose()
    } catch (err) {
      console.error('Split failed', err)
      alert('Split failed. See console for details.')
    } finally {
      setBusy(false)
    }
  }, [store, activePages, rangesInput, baseName, onClose])

  const toggleSelected = (pageIdx: number) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(pageIdx)) next.delete(pageIdx)
      else next.add(pageIdx)
      return next
    })
  }

  const handleExtract = useCallback(async () => {
    if (!store.pdfFile) return
    if (selected.size === 0) {
      alert('Select at least one page to extract.')
      return
    }
    setBusy(true)
    try {
      const origIndices = activePages.filter((p) => selected.has(p))
      const bytes = await exportPdf(store.pdfFile, store.annotations, store.deletedPages, store.pageRotations, origIndices)
      downloadPdfBytes(bytes, `${baseName}_extracted.pdf`)
      onClose()
    } catch (err) {
      console.error('Extract failed', err)
      alert('Extract failed. See console for details.')
    } finally {
      setBusy(false)
    }
  }, [store, activePages, selected, baseName, onClose])

  const modes: { key: Mode; icon: React.ReactNode; label: string; desc: string }[] = [
    { key: 'each', icon: <Files size={16} />, label: 'Each page separate', desc: 'Every page becomes its own PDF file.' },
    { key: 'ranges', icon: <SplitSquareHorizontal size={16} />, label: 'By page ranges', desc: 'Define ranges like "1-3, 4-6" — each range becomes a file.' },
    { key: 'extract', icon: <ListChecks size={16} />, label: 'Extract specific pages', desc: 'Pick which pages to pull into a single new PDF.' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[560px] max-w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Split PDF</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-3 text-center transition-colors ${
                mode === m.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {m.icon}
              <span className="text-xs font-medium leading-tight">{m.label}</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 mb-3">{modes.find((m) => m.key === mode)!.desc}</p>

        <div className="flex-1 overflow-y-auto min-h-0">
          {mode === 'each' && (
            <p className="text-sm text-slate-600">
              This will download <strong>{activePages.length}</strong> separate PDF files, one per page.
            </p>
          )}

          {mode === 'ranges' && (
            <div>
              <input
                autoFocus
                type="text"
                placeholder={`e.g. 1-3, 4-6 (1-${activePages.length})`}
                value={rangesInput}
                onChange={(e) => { setRangesInput(e.target.value); setRangesError(null) }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {rangesError && <p className="text-xs text-red-500 mt-1">{rangesError}</p>}
            </div>
          )}

          {mode === 'extract' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">{selected.size} of {activePages.length} selected</span>
                <div className="flex gap-2">
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => setSelected(new Set(activePages))}>Select all</button>
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {activePages.map((pageIdx, visibleIdx) => (
                  <button
                    key={pageIdx}
                    onClick={() => toggleSelected(pageIdx)}
                    className={`relative flex flex-col items-center gap-1 rounded p-1 border-2 transition-colors ${
                      selected.has(pageIdx) ? 'border-blue-500 bg-blue-50' : 'border-transparent bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    {thumbs.get(pageIdx) ? (
                      <img src={thumbs.get(pageIdx)} alt={`Page ${visibleIdx + 1}`} className="w-full rounded shadow" />
                    ) : (
                      <div className="w-full h-16 bg-slate-300 rounded animate-pulse" />
                    )}
                    <span className="text-xs text-slate-500">{visibleIdx + 1}</span>
                    <input
                      type="checkbox"
                      readOnly
                      checked={selected.has(pageIdx)}
                      className="absolute top-1 right-1 pointer-events-none"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-4 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition">Cancel</button>
          {mode === 'each' && (
            <button disabled={busy} onClick={handleSplitEach} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium disabled:opacity-50">
              {busy ? 'Splitting…' : 'Split'}
            </button>
          )}
          {mode === 'ranges' && (
            <button disabled={busy || !rangesInput.trim()} onClick={handleSplitRanges} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium disabled:opacity-50">
              {busy ? 'Splitting…' : 'Split'}
            </button>
          )}
          {mode === 'extract' && (
            <button disabled={busy} onClick={handleExtract} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium disabled:opacity-50">
              {busy ? 'Extracting…' : 'Extract'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
