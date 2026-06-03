import { useEffect, useRef, useState, useCallback } from 'react'
import { RotateCcw, RotateCw, Trash2, Copy, GripVertical } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { loadPdfDocument, renderPageToDataUrl } from '../utils/pdfRenderer'

export function Sidebar() {
  const store = useEditorStore()
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const renderingRef = useRef(false)

  const renderThumbs = useCallback(async () => {
    if (!store.pdfFile || renderingRef.current) return
    renderingRef.current = true
    const doc = await loadPdfDocument(store.pdfFile)
    const needed = new Map<string, { origIdx: number; rotation: number }>()
    store.pageOrder.forEach((origIdx, pos) => {
      const rotation = store.pageRotations.get(pos) ?? 0
      const key = `${origIdx}-${rotation}`
      if (!needed.has(key)) needed.set(key, { origIdx, rotation })
    })
    const newThumbs = new Map<string, string>(thumbs)
    for (const [key, { origIdx, rotation }] of needed) {
      if (!newThumbs.has(key)) {
        const url = await renderPageToDataUrl(doc, origIdx, 0.2, rotation)
        newThumbs.set(key, url)
      }
    }
    setThumbs(newThumbs)
    renderingRef.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.pdfFile, store.pageOrder, store.pageRotations])

  useEffect(() => { void renderThumbs() }, [renderThumbs])

  const dragPosRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const handleDragStart = (pos: number) => (e: React.DragEvent) => {
    dragPosRef.current = pos
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (pos: number) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(pos)
  }
  const handleDrop = (pos: number) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    if (dragPosRef.current !== null && dragPosRef.current !== pos) {
      store.reorderPages(dragPosRef.current, pos)
    }
    dragPosRef.current = null
  }

  if (!store.pdfFile) return null

  return (
    <div className="w-44 flex-shrink-0 bg-slate-200 border-r border-slate-300 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-300 border-b border-slate-400 flex-shrink-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Page Organizer</p>
        <p className="text-[10px] text-slate-500 mt-0.5">Drag to reorder · Ctrl+click to select</p>
      </div>

      {/* Selected banner */}
      {store.selectedPages.size > 0 && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-blue-600 text-white text-xs flex-shrink-0">
          <span className="font-semibold">{store.selectedPages.size} selected</span>
          <button onClick={() => store.clearSelection()} className="hover:text-slate-200 text-slate-300 ml-2" title="Clear selection">✕</button>
        </div>
      )}

      {/* Page list */}
      <div className="flex-1 overflow-y-auto py-2 px-1.5 flex flex-col gap-2">
        {store.pageOrder.map((origIdx, pos) => {
          const rotation = store.pageRotations.get(pos) ?? 0
          const thumbKey = `${origIdx}-${rotation}`
          const isActive = store.currentPage === pos
          const isSelected = store.selectedPages.has(pos)
          const isDragTarget = dragOver === pos

          return (
            <div
              key={`${pos}-${origIdx}`}
              draggable
              onDragStart={handleDragStart(pos)}
              onDragOver={handleDragOver(pos)}
              onDrop={handleDrop(pos)}
              onDragEnd={() => { setDragOver(null); dragPosRef.current = null }}
              className={`rounded-lg border-2 transition-all select-none bg-white overflow-hidden ${
                isDragTarget
                  ? 'border-green-400 shadow-lg scale-[1.02]'
                  : isSelected
                  ? 'border-blue-500 shadow-md'
                  : isActive
                  ? 'border-blue-400 shadow-md'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              {/* Drag handle + page number row */}
              <div
                className={`flex items-center gap-1 px-1.5 py-1 cursor-pointer ${
                  isActive ? 'bg-blue-50' : isSelected ? 'bg-blue-50' : 'bg-slate-50'
                }`}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    store.toggleSelectPage(pos, true)
                  } else {
                    store.clearSelection()
                    store.setCurrentPage(pos)
                  }
                }}
              >
                <GripVertical size={12} className="text-slate-400 flex-shrink-0 cursor-grab" />
                <span className={`text-xs font-bold flex-1 ${isActive ? 'text-blue-600' : 'text-slate-600'}`}>
                  Page {pos + 1}
                </span>
                {isSelected && (
                  <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-[9px] font-bold">✓</span>
                  </span>
                )}
              </div>

              {/* Thumbnail */}
              <div
                className="px-1.5 pb-1 cursor-pointer"
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    store.toggleSelectPage(pos, true)
                  } else {
                    store.clearSelection()
                    store.setCurrentPage(pos)
                  }
                }}
              >
                {thumbs.get(thumbKey) ? (
                  <img
                    src={thumbs.get(thumbKey)}
                    alt={`Page ${pos + 1}`}
                    className="w-full rounded shadow-sm pointer-events-none"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-20 bg-slate-200 rounded animate-pulse" />
                )}
              </div>

              {/* Always-visible action buttons */}
              <div className="flex items-center justify-around px-1 py-1 bg-slate-100 border-t border-slate-200 gap-0.5">
                <PageActionBtn
                  title="Rotate Left"
                  onClick={(e) => { e.stopPropagation(); store.rotatePage(pos, 'left') }}
                >
                  <RotateCcw size={13} />
                </PageActionBtn>
                <PageActionBtn
                  title="Rotate Right"
                  onClick={(e) => { e.stopPropagation(); store.rotatePage(pos, 'right') }}
                >
                  <RotateCw size={13} />
                </PageActionBtn>
                <PageActionBtn
                  title="Duplicate Page"
                  onClick={(e) => { e.stopPropagation(); store.duplicatePage(pos) }}
                >
                  <Copy size={13} />
                </PageActionBtn>
                <PageActionBtn
                  title="Delete Page"
                  danger
                  disabled={store.pageOrder.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (store.pageOrder.length > 1) store.deletePage(pos)
                  }}
                >
                  <Trash2 size={13} />
                </PageActionBtn>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-2 py-1.5 border-t border-slate-300 text-center flex-shrink-0 bg-slate-200">
        <span className="text-[11px] text-slate-500 font-medium">
          {store.pageOrder.length} page{store.pageOrder.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

function PageActionBtn({
  children,
  title,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode
  title: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
        disabled
          ? 'opacity-25 cursor-not-allowed text-slate-400'
          : danger
          ? 'text-red-500 hover:bg-red-100 hover:text-red-700'
          : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
