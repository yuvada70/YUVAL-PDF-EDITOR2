import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { loadPdfDocument, renderPageToCanvas } from '../utils/pdfRenderer'
import { AnnotationLayer } from './AnnotationLayer'
import { DrawLayer } from './DrawLayer'
import { genId } from '../utils/id'
import { TextAnnotation, SignatureAnnotation, HighlightAnnotation } from '../types'

const RENDER_SCALE = 1.5

export function PdfViewer() {
  const store = useEditorStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [loading, setLoading] = useState(false)

  // Render PDF page to canvas
  useEffect(() => {
    if (!store.pdfFile) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const doc = await loadPdfDocument(store.pdfFile!)
      const rotation = store.pageRotations.get(store.currentPage) ?? 0
      if (cancelled || !canvasRef.current) return
      await renderPageToCanvas(doc, store.currentPage, canvasRef.current, RENDER_SCALE * store.zoom, rotation)
      if (!cancelled && canvasRef.current) {
        setCanvasSize({ width: canvasRef.current.width, height: canvasRef.current.height })
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [store.pdfFile, store.currentPage, store.zoom, store.pageRotations])

  // --- Highlight drag state ---
  const highlightDragRef = useRef<{ startX: number; startY: number; id: string } | null>(null)

  const getRelativePos = useCallback((e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const scaleX = canvasSize.width / rect.width
    const scaleY = canvasSize.height / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }, [canvasSize])

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!store.pdfFile) return
    if (store.tool === 'text') {
      const { x, y } = getRelativePos(e)
      const ann: TextAnnotation = {
        id: genId(),
        type: 'text',
        pageIndex: store.currentPage,
        x, y,
        text: 'Text',
        fontSize: store.textFontSize,
        color: store.textColor,
      }
      store.addAnnotation(ann)
      store.setTool('none')
    } else if (store.tool === 'signature' && store.pendingSignatureDataUrl) {
      const { x, y } = getRelativePos(e)
      const ann: SignatureAnnotation = {
        id: genId(),
        type: 'signature',
        pageIndex: store.currentPage,
        x, y,
        width: 200,
        height: 80,
        dataUrl: store.pendingSignatureDataUrl,
      }
      store.addAnnotation(ann)
      store.setPendingSignature(null)
      store.setTool('none')
    }
  }, [store, getRelativePos])

  const handleHighlightMouseDown = useCallback((e: React.MouseEvent) => {
    if (store.tool !== 'highlight') return
    const { x, y } = getRelativePos(e)
    const id = genId()
    const ann: HighlightAnnotation = {
      id,
      type: 'highlight',
      pageIndex: store.currentPage,
      x, y,
      width: 0,
      height: 0,
      color: '#facc15',
    }
    store.addAnnotation(ann)
    highlightDragRef.current = { startX: x, startY: y, id }
  }, [store, getRelativePos])

  const handleHighlightMouseMove = useCallback((e: React.MouseEvent) => {
    if (!highlightDragRef.current) return
    const { x, y } = getRelativePos(e)
    const { startX, startY, id } = highlightDragRef.current
    store.updateAnnotation(id, {
      x: Math.min(x, startX),
      y: Math.min(y, startY),
      width: Math.abs(x - startX),
      height: Math.abs(y - startY),
    })
  }, [store, getRelativePos])

  const handleHighlightMouseUp = useCallback(() => {
    highlightDragRef.current = null
  }, [])

  const cursorStyle =
    store.tool === 'text' ? 'cursor-text'
    : store.tool === 'highlight' ? 'cursor-crosshair'
    : store.tool === 'signature' && store.pendingSignatureDataUrl ? 'cursor-crosshair'
    : store.tool === 'draw' ? 'cursor-none'
    : 'cursor-default'

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-slate-400 flex justify-center py-6"
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/10 z-20 pointer-events-none">
          <div className="bg-white rounded-lg px-4 py-2 text-sm text-slate-600 shadow">Loading…</div>
        </div>
      )}
      <div
        className={`relative inline-block ${cursorStyle}`}
        onMouseDown={handleHighlightMouseDown}
        onMouseMove={handleHighlightMouseMove}
        onMouseUp={handleHighlightMouseUp}
        onClick={handleCanvasClick}
      >
        <canvas ref={canvasRef} className="pdf-page-canvas" />
        {canvasSize.width > 0 && (
          <>
            <AnnotationLayer
              canvasWidth={canvasSize.width}
              canvasHeight={canvasSize.height}
            />
            {store.tool === 'draw' && (
              <DrawLayer
                canvasWidth={canvasSize.width}
                canvasHeight={canvasSize.height}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
