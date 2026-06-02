import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { DrawAnnotation } from '../types'
import { genId } from '../utils/id'

interface Props {
  canvasWidth: number
  canvasHeight: number
}

export function DrawLayer({ canvasWidth, canvasHeight }: Props) {
  const store = useEditorStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const currentPathRef = useRef<{ x: number; y: number }[]>([])
  const currentAnnIdRef = useRef<string | null>(null)

  // Redraw all draw annotations for this page
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const anns = store.annotations.filter(
      (a) => a.type === 'draw' && a.pageIndex === store.currentPage
    ) as DrawAnnotation[]
    for (const ann of anns) {
      ctx.strokeStyle = ann.color
      ctx.lineWidth = ann.lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const path of ann.paths) {
        if (path.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(path[0].x, path[0].y)
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x, path[i].y)
        }
        ctx.stroke()
      }
    }
  }, [store.annotations, store.currentPage])

  useEffect(() => { redraw() }, [redraw])

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    drawingRef.current = true
    const pos = getPos(e.nativeEvent as MouseEvent | TouchEvent, canvas)
    currentPathRef.current = [pos]

    const id = genId()
    currentAnnIdRef.current = id
    const ann: DrawAnnotation = {
      id,
      type: 'draw',
      pageIndex: store.currentPage,
      paths: [[pos]],
      color: store.drawColor,
      lineWidth: store.drawLineWidth,
    }
    store.addAnnotation(ann)
  }, [store])

  const continueDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current || !currentAnnIdRef.current) return
    const canvas = canvasRef.current!
    const pos = getPos(e.nativeEvent as MouseEvent | TouchEvent, canvas)
    currentPathRef.current.push(pos)

    const path = [...currentPathRef.current]
    const existing = store.annotations.find((a) => a.id === currentAnnIdRef.current) as DrawAnnotation | undefined
    if (existing) {
      store.updateAnnotation(currentAnnIdRef.current, {
        paths: [...existing.paths.slice(0, -1), path],
      })
    }
  }, [store])

  const endDraw = useCallback(() => {
    drawingRef.current = false
    currentAnnIdRef.current = null
    currentPathRef.current = []
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      style={{ position: 'absolute', top: 0, left: 0, width: canvasWidth, height: canvasHeight, zIndex: 15, cursor: 'crosshair' }}
      onMouseDown={startDraw}
      onMouseMove={continueDraw}
      onMouseUp={endDraw}
      onMouseLeave={endDraw}
      onTouchStart={startDraw}
      onTouchMove={continueDraw}
      onTouchEnd={endDraw}
    />
  )
}
