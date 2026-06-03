import { useEffect, useRef, useState } from 'react'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { loadPdfDocument, renderPageToDataUrl } from '../utils/pdfRenderer'

export function Sidebar() {
  const store = useEditorStore()
  const activePages = getActivePages(store) // slot indices
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const renderingRef = useRef(false)

  useEffect(() => {
    if (!store.pdfFile || renderingRef.current) return
    renderingRef.current = true

    void (async () => {
      const doc = await loadPdfDocument(store.pdfFile!)
      const newThumbs = new Map<string, string>()
      for (const slotIdx of activePages) {
        const origIdx = store.pageOrder[slotIdx] ?? slotIdx
        const rotation = store.pageRotations.get(origIdx) ?? 0
        const key = `${slotIdx}-${origIdx}`
        const url = await renderPageToDataUrl(doc, origIdx, 0.2, rotation)
        newThumbs.set(key, url)
      }
      setThumbs(newThumbs)
      renderingRef.current = false
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.pdfFile, store.pageOrder, store.pageRotations])

  return (
    <div className="w-28 flex-shrink-0 bg-slate-200 border-r border-slate-300 overflow-y-auto flex flex-col gap-2 py-2 px-1">
      {activePages.map((slotIdx, visibleIdx) => {
        const origIdx = store.pageOrder[slotIdx] ?? slotIdx
        const key = `${slotIdx}-${origIdx}`
        return (
          <button
            key={key}
            onClick={() => store.setCurrentPage(slotIdx)}
            className={`flex flex-col items-center gap-1 rounded p-1 transition-colors ${
              store.currentPage === slotIdx
                ? 'ring-2 ring-blue-500 bg-white'
                : 'hover:bg-slate-300 bg-white/60'
            }`}
          >
            {thumbs.get(key) ? (
              <img
                src={thumbs.get(key)}
                alt={`Page ${visibleIdx + 1}`}
                className="w-full rounded shadow"
              />
            ) : (
              <div className="w-full h-20 bg-slate-300 rounded animate-pulse" />
            )}
            <span className="text-xs text-slate-500">{visibleIdx + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
