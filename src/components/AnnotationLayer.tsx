import { useCallback, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { TextAnnotation, SignatureAnnotation, HighlightAnnotation } from '../types'
import { X, GripHorizontal } from 'lucide-react'

interface Props {
  canvasWidth: number
  canvasHeight: number
}

export function AnnotationLayer({ canvasWidth, canvasHeight }: Props) {
  const store = useEditorStore()
  const pageAnnotations = store.annotations.filter((a) => a.pageIndex === store.currentPage)

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
        return null
      })}
    </div>
  )
}

function TextAnn({ ann }: { ann: TextAnnotation }) {
  const store = useEditorStore()
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [editing, setEditing] = useState(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
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

  return (
    <div
      style={{ position: 'absolute', left: ann.x, top: ann.y, zIndex: 10 }}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
      className="group"
    >
      <div className="absolute -top-5 left-0 hidden group-hover:flex gap-1 bg-white rounded shadow px-1 py-0.5">
        <button
          className="text-slate-400 hover:text-red-500"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); store.removeAnnotation(ann.id) }}
        >
          <X size={12} />
        </button>
        <GripHorizontal size={12} className="text-slate-400 cursor-grab" />
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="border border-blue-400 rounded px-1 bg-white/90 resize"
          style={{ fontSize: ann.fontSize, color: ann.color, minWidth: 80 }}
          value={ann.text}
          onChange={(e) => store.updateAnnotation(ann.id, { text: e.target.value })}
          onBlur={() => setEditing(false)}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="whitespace-pre cursor-move select-none px-1 rounded hover:outline hover:outline-blue-400 hover:outline-1"
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
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
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
      className="group cursor-move"
    >
      <div className="absolute -top-5 left-0 hidden group-hover:flex gap-1 bg-white rounded shadow px-1 py-0.5 z-20">
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
        className="w-full h-full object-contain pointer-events-none select-none hover:outline hover:outline-blue-400 hover:outline-1 rounded"
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
