import { useEffect, useRef, useState } from 'react'
import { useEditorStore, getActivePages } from '../store/editorStore'
import { loadPdfDocument, getPageThumbnail, THUMB_SCALE } from '../utils/pdfRenderer'

// Minimum pointer travel (px) before a press-and-hold turns into a drag,
// so ordinary clicks/taps still navigate to the page.
const DRAG_THRESHOLD = 6

export function Sidebar() {
  const store = useEditorStore()
  const activePages = getActivePages(store)
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map())
  const renderingRef = useRef(false)
  const [draggedPage, setDraggedPage] = useState<number | null>(null)
  const [dragOverPage, setDragOverPage] = useState<number | null>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const suppressClickRef = useRef(false)
  const dragOverRef = useRef<number | null>(null)
  const pointerState = useRef<{
    pageIdx: number
    startX: number
    startY: number
    dragging: boolean
    pointerId: number
  } | null>(null)

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

  // Pointer-based drag reordering (works for mouse, touch and pen, unlike
  // the native HTML5 drag-and-drop API which several browsers/embeds
  // restrict or don't support at all for touch input).
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const ps = pointerState.current
      if (!ps || ps.pointerId !== e.pointerId) return

      if (!ps.dragging) {
        const dx = e.clientX - ps.startX
        const dy = e.clientY - ps.startY
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        ps.dragging = true
        setDraggedPage(ps.pageIdx)
      }

      e.preventDefault()
      let closest: number | null = null
      let closestDist = Infinity
      itemRefs.current.forEach((el, idx) => {
        const rect = el.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        const dist = Math.abs(e.clientY - centerY)
        if (dist < closestDist) {
          closestDist = dist
          closest = idx
        }
      })
      dragOverRef.current = closest
      setDragOverPage(closest)
    }

    // Reads/writes plain refs and fires the store action directly (not from
    // inside a setState updater) — React's StrictMode intentionally
    // double-invokes updater functions in development to catch side effects
    // hidden inside them, which would otherwise reorder the page twice here.
    const finish = (e: PointerEvent) => {
      const ps = pointerState.current
      if (!ps || ps.pointerId !== e.pointerId) return
      if (ps.dragging) {
        // The click that would normally follow this pointerup only fires when
        // mouseup lands back on the same element as mousedown; when the drag
        // ends over a different page, no click fires at all and this flag
        // would otherwise linger and swallow the next, unrelated click.
        suppressClickRef.current = true
        setTimeout(() => { suppressClickRef.current = false }, 0)
        const over = dragOverRef.current
        if (over !== null && over !== ps.pageIdx) {
          store.reorderPages(ps.pageIdx, over)
        }
        dragOverRef.current = null
        setDragOverPage(null)
      }
      pointerState.current = null
      setDraggedPage(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-28 flex-shrink-0 bg-slate-200 border-r border-slate-300 overflow-y-auto flex flex-col gap-2 py-2 px-1">
      {activePages.map((pageIdx, visibleIdx) => (
        <button
          key={pageIdx}
          ref={(el) => {
            if (el) itemRefs.current.set(pageIdx, el)
            else itemRefs.current.delete(pageIdx)
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            store.setCurrentPage(pageIdx)
          }}
          onPointerDown={(e) => {
            if (e.button !== undefined && e.button !== 0) return
            pointerState.current = {
              pageIdx,
              startX: e.clientX,
              startY: e.clientY,
              dragging: false,
              pointerId: e.pointerId,
            }
            e.currentTarget.setPointerCapture?.(e.pointerId)
          }}
          style={{ touchAction: 'none' }}
          className={`flex flex-col items-center gap-1 rounded p-1 transition-colors cursor-grab active:cursor-grabbing select-none ${
            store.currentPage === pageIdx
              ? 'ring-2 ring-blue-500 bg-white'
              : 'hover:bg-slate-300 bg-white/60'
          } ${dragOverPage === pageIdx ? 'ring-2 ring-blue-400' : ''} ${
            draggedPage === pageIdx ? 'opacity-40' : ''
          }`}
        >
          {thumbs.get(pageIdx) ? (
            <img
              src={thumbs.get(pageIdx)}
              alt={`Page ${visibleIdx + 1}`}
              className="w-full rounded shadow pointer-events-none"
              draggable={false}
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
