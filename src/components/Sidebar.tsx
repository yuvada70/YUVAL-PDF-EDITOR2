import { useEffect, useRef, useState, useCallback } from 'react'
import { RotateCcw, RotateCw, Trash2, Copy, ChevronDown } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { loadPdfDocument, renderPageToDataUrl } from '../utils/pdfRenderer'

export function Sidebar() {
  const store = useEditorStore()
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  // thumbKey: `${origPageIdx}-${rotation}` to invalidate on rotate
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
    e.dataTransfer.dropEffect = 'move'
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

  const handleDragEnd = () => {
    setDragOver(null)
    dragPosRef.current = null
  }

  if (!store.pdfFile) return null

  const selectedCount = store.selectedPages.size

  return (
    <div className="w-36 flex-shrink-0 bg-slate-200 border-r border-slate-300 flex flex-col overflow-hidden">
      {selectedCount > 0 && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-blue-600 text-white text-xs">
          <span>{selectedCount} selected</span>
          <div className="flex gap-1">
            <button
              onClick={() => store.deleteSelectedPages()}
              className="hover:text-red-300 transition-colors"
              title="Delete selected"
            >
              <Trash2 size={13} />
            </button>
            <button onClick={() => store.clearSelection()} className="hover:text-slate-200" title="Clear selection">
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2 px-1 flex flex-col gap-1">
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
              onDragEnd={handleDragEnd}
              className={`relative group rounded cursor-pointer transition-all select-none
                ${isActive ? 'ring-2 ring-blue-500 bg-white' : 'bg-white/70 hover:bg-white'}
                ${isSelected ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
                ${isDragTarget ? 'ring-2 ring-green-400 scale-105' : ''}
              `}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) {
                  store.toggleSelectPage(pos, true)
                } else {
                  store.clearSelection()
                  store.setCurrentPage(pos)
                }
              }}
            >
              {/* Thumbnail */}
              <div className="p-1">
                {thumbs.get(thumbKey) ? (
                  <img
                    src={thumbs.get(thumbKey)}
                    alt={`Page ${pos + 1}`}
                    className="w-full rounded shadow-sm pointer-events-none"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-20 bg-slate-300 rounded animate-pulse" />
                )}
              </div>

              {/* Page number */}
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs text-slate-500 font-medium">{pos + 1}</span>
                {isSelected && (
                  <span className="w-3.5 h-3.5 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-[8px]">✓</span>
                  </span>
                )}
              </div>

              {/* Hover action bar */}
              <div className="absolute top-0.5 right-0.5 hidden group-hover:flex flex-col gap-0.5 bg-white/95 rounded shadow-md p-0.5 z-10">
                <ActionBtn title="Rotate left" onClick={(e) => { e.stopPropagation(); store.rotatePage(pos, 'left') }}>
                  <RotateCcw size={11} />
                </ActionBtn>
                <ActionBtn title="Rotate right" onClick={(e) => { e.stopPropagation(); store.rotatePage(pos, 'right') }}>
                  <RotateCw size={11} />
                </ActionBtn>
                <ActionBtn title="Duplicate" onClick={(e) => { e.stopPropagation(); store.duplicatePage(pos) }}>
                  <Copy size={11} />
                </ActionBtn>
                <ActionBtn
                  title="Delete"
                  danger
                  onClick={(e) => {
                    e.stopPropagation()
                    if (store.pageOrder.length > 1) store.deletePage(pos)
                  }}
                  disabled={store.pageOrder.length <= 1}
                >
                  <Trash2 size={11} />
                </ActionBtn>
              </div>

              {/* Drag handle indicator */}
              <div className="absolute top-1 left-0.5 hidden group-hover:flex flex-col gap-0.5 opacity-40">
                <ChevronDown size={10} className="text-slate-500 -rotate-90" />
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-2 py-1.5 border-t border-slate-300 text-xs text-slate-500 text-center">
        {store.pageOrder.length} page{store.pageOrder.length !== 1 ? 's' : ''}
        <span className="block text-[10px] text-slate-400">Ctrl+click to multi-select</span>
      </div>
    </div>
  )
}

function ActionBtn({
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
      className={`p-0.5 rounded transition-colors ${
        disabled ? 'opacity-30 cursor-not-allowed text-slate-400'
        : danger ? 'hover:bg-red-100 text-red-500'
        : 'hover:bg-slate-100 text-slate-600'
      }`}
    >
      {children}
    </button>
  )
}
