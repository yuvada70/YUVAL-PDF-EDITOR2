import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { TextAnnotation, SignatureAnnotation, HighlightAnnotation, WhiteoutAnnotation } from '../types'
import { X, GripHorizontal, Pencil } from 'lucide-react'

interface Props {
  canvasWidth: number
  canvasHeight: number
}

export function AnnotationLayer({ canvasWidth, canvasHeight }: Props) {
  const store = useEditorStore()
  const pageAnnotations = store.annotations.filter((a) => a.pageIndex === store.currentPage)

  // Delete / Backspace removes the selected annotation (when not editing text)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const s = useEditorStore.getState()
      if (!s.selectedAnnotationId || s.editingAnnotationId) return
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      e.preventDefault()
      s.removeAnnotation(s.selectedAnnotationId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="annotation-layer"
      style={{ width: canvasWidth, height: canvasHeight }}
    >
      {pageAnnotations.map((ann) => {
        if (ann.type === 'text') {
          return <TextAnn key={ann.id} ann={ann as TextAnnotation} />
        }
        if (ann.type === 'signature') {
          return <SignatureAnn key={ann.id} ann={ann as SignatureAnnotation} />
        }
        if (ann.type === 'highlight') {
          return <HighlightAnn key={ann.id} ann={ann as HighlightAnnotation} />
        }
        if (ann.type === 'whiteout') {
          return <WhiteoutAnn key={ann.id} ann={ann as WhiteoutAnnotation} />
        }
        return null
      })}
    </div>
  )
}

function TextAnn({ ann }: { ann: TextAnnotation }) {
  const store = useEditorStore()
  const editing = store.editingAnnotationId === ann.id
  const selected = store.selectedAnnotationId === ann.id
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    store.selectAnnotation(ann.id)
    if (editing) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: ann.x, origY: ann.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      store.updateAnnotation(ann.id, {
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [ann, store, editing])

  const stopEditing = useCallback(() => {
    // remove empty text boxes so abandoned clicks don't litter the page
    if (ann.text.trim() === '') {
      store.removeAnnotation(ann.id)
    } else {
      store.setEditing(null)
    }
  }, [ann, store])

  return (
    <div
      style={{ position: 'absolute', left: ann.x, top: ann.y, zIndex: 10 }}
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); store.setEditing(ann.id) }}
      className="group"
    >
      <div
        className={`absolute -top-6 left-0 gap-1 bg-white rounded shadow px-1 py-0.5 ${
          selected ? 'flex' : 'hidden group-hover:flex'
        }`}
      >
        <button
          className="text-slate-400 hover:text-blue-600"
          title="ערוך טקסט"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); store.setEditing(ann.id) }}
        >
          <Pencil size={12} />
        </button>
        <GripHorizontal size={12} className="text-slate-400 cursor-grab" />
        <button
          className="text-slate-400 hover:text-red-500"
          title="מחק"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); store.removeAnnotation(ann.id) }}
        >
          <X size={12} />
        </button>
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="border border-blue-400 rounded px-1 bg-white/90 resize outline-none"
          style={{ fontSize: ann.fontSize, color: ann.color, minWidth: 80 }}
          value={ann.text}
          placeholder="הקלד טקסט…"
          onChange={(e) => store.updateAnnotation(ann.id, { text: e.target.value })}
          onFocus={(e) => e.target.select()}
          onBlur={stopEditing}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className={`whitespace-pre cursor-move select-none px-1 rounded ${
            selected ? 'outline outline-1 outline-blue-400' : 'hover:outline hover:outline-blue-400 hover:outline-1'
          }`}
          style={{ fontSize: ann.fontSize, color: ann.color }}
        >
          {ann.text}
        </div>
      )}
    </div>
  )
}

function SignatureAnn({ ann }: { ann: SignatureAnnotation }) {
  const store = useEditorStore()
  const selected = store.selectedAnnotationId === ann.id
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    store.selectAnnotation(ann.id)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: ann.x, origY: ann.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      store.updateAnnotation(ann.id, {
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [ann, store])

  return (
    <div
      style={{ position: 'absolute', left: ann.x, top: ann.y, width: ann.width, height: ann.height, zIndex: 10 }}
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      className="group cursor-move"
    >
      <div
        className={`absolute -top-5 left-0 gap-1 bg-white rounded shadow px-1 py-0.5 z-20 ${
          selected ? 'flex' : 'hidden group-hover:flex'
        }`}
      >
        <button
          className="text-slate-400 hover:text-red-500"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); store.removeAnnotation(ann.id) }}
        >
          <X size={12} />
        </button>
      </div>
      <img
        src={ann.dataUrl}
        alt="Signature"
        className={`w-full h-full object-contain pointer-events-none select-none rounded ${
          selected ? 'outline outline-1 outline-blue-400' : 'hover:outline hover:outline-blue-400 hover:outline-1'
        }`}
        draggable={false}
      />
      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 bg-blue-500 rounded-sm cursor-se-resize opacity-0 group-hover:opacity-100"
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const startY = e.clientY
          const origW = ann.width
          const origH = ann.height
          const onMove = (ev: MouseEvent) => {
            store.updateAnnotation(ann.id, {
              width: Math.max(40, origW + ev.clientX - startX),
              height: Math.max(20, origH + ev.clientY - startY),
            })
          }
          const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
      />
    </div>
  )
}

function HighlightAnn({ ann }: { ann: HighlightAnnotation }) {
  const store = useEditorStore()
  return (
    <div
      style={{
        position: 'absolute',
        left: ann.x,
        top: ann.y,
        width: ann.width,
        height: ann.height,
        backgroundColor: ann.color,
        opacity: 0.4,
        zIndex: 5,
      }}
      className="group cursor-pointer"
      onDoubleClick={(e) => { e.stopPropagation(); store.removeAnnotation(ann.id) }}
      title="Double-click to remove"
    />
  )
}

function WhiteoutAnn({ ann }: { ann: WhiteoutAnnotation }) {
  const store = useEditorStore()
  const selected = store.selectedAnnotationId === ann.id
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    store.selectAnnotation(ann.id)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: ann.x, origY: ann.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      store.updateAnnotation(ann.id, {
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [ann, store])

  return (
    <div
      style={{
        position: 'absolute',
        left: ann.x,
        top: ann.y,
        width: ann.width,
        height: ann.height,
        backgroundColor: ann.color,
        zIndex: 6,
      }}
      className={`group cursor-move ${
        selected ? 'outline outline-1 outline-blue-400' : 'hover:outline hover:outline-dashed hover:outline-1 hover:outline-blue-300'
      }`}
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="כיסוי תוכן קיים — גרור להזזה, לחץ Delete למחיקה"
    >
      <div
        className={`absolute -top-5 left-0 gap-1 bg-white rounded shadow px-1 py-0.5 z-20 ${
          selected ? 'flex' : 'hidden group-hover:flex'
        }`}
      >
        <button
          className="text-slate-400 hover:text-red-500"
          title="מחק כיסוי"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); store.removeAnnotation(ann.id) }}
        >
          <X size={12} />
        </button>
      </div>
      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 bg-blue-500 rounded-sm cursor-se-resize opacity-0 group-hover:opacity-100"
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const startY = e.clientY
          const origW = ann.width
          const origH = ann.height
          const onMove = (ev: MouseEvent) => {
            store.updateAnnotation(ann.id, {
              width: Math.max(8, origW + ev.clientX - startX),
              height: Math.max(8, origH + ev.clientY - startY),
            })
          }
          const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
      />
    </div>
  )
}
