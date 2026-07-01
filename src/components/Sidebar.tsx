import { useEffect, useRef, useState } from 'react'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { loadPdfDocument, getPageThumbnail, THUMB_SCALE } from '../utils/pdfRenderer'

export function Sidebar() {
  const store = useEditorStore()
  const activePages = getActivePages(store)
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map())
  const renderingRef = useRef(false)
  const [draggedPage, setDraggedPage] = useState<number | null>(null)
  const [dragOverPage, setDragOverPage] = useState<number | null>(null)

  useEffect(() => {
    if (!store.pdfFile || renderingRef.current) return
    renderingRef.current = true

    void (async () => {
      const doc = await loadPdfDocument(store.pdfFile!)
      const newThumbs = new Map<number, string>()
      for (const idx of activePages) {
        const rotation = store.pageRotations.get(idx) ?? 0
        const url = await getPageThumbnail(doc, idx, THUMB_SCALE, rotation)
        newThumbs.set(idx, url)
      }
      setThumbs(newThumbs)
      renderingRef.current = false
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.pdfFile, store.deletedPages, store.pageRotations])

  return (
    <div className="w-28 flex-shrink-0 bg-slate-200 border-r border-slate-300 overflow-y-auto flex flex-col gap-2 py-2 px-1">
      {activePages.map((pageIdx, visibleIdx) => (
        <button
          key={pageIdx}
          draggable
          onClick={() => store.setCurrentPage(pageIdx)}
          onDragStart={(e) => {
            setDraggedPage(pageIdx)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (draggedPage !== null && draggedPage !== pageIdx) setDragOverPage(pageIdx)
          }}
          onDragLeave={() => setDragOverPage((p) => (p === pageIdx ? null : p))}
          onDrop={(e) => {
            e.preventDefault()
            if (draggedPage !== null && draggedPage !== pageIdx) {
              store.reorderPages(draggedPage, pageIdx)
            }
            setDraggedPage(null)
            setDragOverPage(null)
          }}
          onDragEnd={() => {
            setDraggedPage(null)
            setDragOverPage(null)
          }}
          className={`flex flex-col items-center gap-1 rounded p-1 transition-colors cursor-grab active:cursor-grabbing ${
            store.currentPage === pageIdx
              ? 'ring-2 ring-blue-500 bg-white'
              : 'hover:bg-slate-300 bg-white/60'
          } ${dragOverPage === pageIdx ? 'ring-2 ring-blue-400 ring-dashed' : ''} ${
            draggedPage === pageIdx ? 'opacity-40' : ''
          }`}
        >
          {thumbs.get(pageIdx) ? (
            <img
              src={thumbs.get(pageIdx)}
              alt={`Page ${visibleIdx + 1}`}
              className="w-full rounded shadow pointer-events-none"
            />
          ) : (
            <div className="w-full h-20 bg-slate-300 rounded animate-pulse" />
          )}
          <span className="text-xs text-slate-500">{visibleIdx + 1}</span>
        </button>
      ))}
    </div>
  )
}
