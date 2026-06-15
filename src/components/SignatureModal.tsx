import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'

interface Props {
  onClose: () => void
}

export function SignatureModal({ onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const { setTool, setPendingSignature } = useEditorStore()

  const fillWhite = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  useEffect(() => {
    fillWhite()
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [fillWhite])

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true
    lastPos.current = getPos(e)
  }, [])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current || !lastPos.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }, [])

  const stopDrawing = useCallback(() => {
    drawing.current = false
    lastPos.current = null
  }, [])

  const handleClear = useCallback(() => {
    fillWhite()
  }, [fillWhite])

  const handleSave = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const isEmpty = !data.some((v, i) => i % 4 !== 3 && v !== 255)
    if (isEmpty) {
      alert('Please draw a signature first.')
      return
    }
    setPendingSignature(canvas.toDataURL('image/png'))
    setTool('signature')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[480px] max-w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Draw Signature</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="border-2 border-slate-300 rounded-xl overflow-hidden">
          <canvas
            ref={canvasRef}
            width={440}
            height={200}
            className="block w-full cursor-crosshair touch-none"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
        <p className="text-xs text-slate-400 mt-1 text-center">
          Draw your signature above. After saving, click on the PDF to place it.
        </p>

        <div className="flex gap-3 mt-5 justify-end">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium"
          >
            Save Signature
          </button>
        </div>
      </div>
    </div>
  )
}
