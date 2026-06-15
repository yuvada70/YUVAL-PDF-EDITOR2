import { useCallback, useEffect, useRef, useState } from 'react'
import { X, PenLine, Type, ImageIcon } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'

interface Props {
  onClose: () => void
}

type Tab = 'draw' | 'type' | 'image'

const CANVAS_W = 440
const CANVAS_H = 200
const FONTS = ['Dancing Script', 'Caveat', 'Pacifico', 'Sacramento']

// Load Google Fonts once
if (typeof document !== 'undefined') {
  const id = 'sig-fonts'
  if (!document.getElementById(id)) {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Caveat:wght@600&family=Pacifico&family=Sacramento&display=swap'
    document.head.appendChild(link)
  }
}

export function SignatureModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('draw')
  const { setTool, setPendingSignature } = useEditorStore()

  const save = (dataUrl: string) => {
    setPendingSignature(dataUrl)
    setTool('signature')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[500px] max-w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Add Signature</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-4">
          {([
            { key: 'draw',  icon: <PenLine size={15} />,  label: 'Draw' },
            { key: 'type',  icon: <Type size={15} />,     label: 'Type' },
            { key: 'image', icon: <ImageIcon size={15} />, label: 'Image' },
          ] as { key: Tab; icon: React.ReactNode; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {tab === 'draw'  && <DrawTab  onSave={save} onClose={onClose} />}
        {tab === 'type'  && <TypeTab  onSave={save} onClose={onClose} />}
        {tab === 'image' && <ImageTab onSave={save} onClose={onClose} />}
      </div>
    </div>
  )
}

/* ── Draw tab ── */
function DrawTab({ onSave, onClose }: { onSave: (d: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  const fillWhite = useCallback(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, c.width, c.height)
  }, [])

  useEffect(() => {
    fillWhite()
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.5
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  }, [fillWhite])

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const sx = c.width / r.width, sy = c.height / r.height
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy }
  }

  const onDown  = (e: React.MouseEvent | React.TouchEvent) => { drawing.current = true; last.current = getPos(e) }
  const onMove  = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current || !last.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const pos = getPos(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke()
    last.current = pos
  }
  const onUp = () => { drawing.current = false; last.current = null }

  const isEmpty = () => {
    const c = canvasRef.current!
    return !c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      .some((v, i) => i % 4 !== 3 && v !== 255)
  }

  const handleSave = () => {
    if (isEmpty()) { alert('Please draw a signature first.'); return }
    onSave(canvasRef.current!.toDataURL('image/png'))
  }

  return (
    <>
      <div className="border-2 border-slate-200 rounded-xl overflow-hidden">
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          className="block w-full cursor-crosshair touch-none"
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        />
      </div>
      <p className="text-xs text-slate-400 mt-1 text-center">Draw your signature above</p>
      <Buttons onClear={fillWhite} onClose={onClose} onSave={handleSave} />
    </>
  )
}

/* ── Type tab ── */
function TypeTab({ onSave, onClose }: { onSave: (d: string) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [font, setFont] = useState(FONTS[0])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, c.width, c.height)
    if (!text) return
    ctx.fillStyle = '#1e293b'
    ctx.font = `48px '${font}', cursive`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, c.width / 2, c.height / 2, c.width - 40)
  }, [text, font])

  const handleSave = () => {
    if (!text.trim()) { alert('Please type your name first.'); return }
    onSave(canvasRef.current!.toDataURL('image/png'))
  }

  return (
    <>
      <input
        autoFocus
        type="text"
        placeholder="Type your name…"
        value={text}
        onChange={e => setText(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {/* Font picker */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {FONTS.map(f => (
          <button
            key={f}
            onClick={() => setFont(f)}
            style={{ fontFamily: `'${f}', cursive` }}
            className={`px-3 py-1 rounded-lg border text-lg transition-colors ${
              font === f ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:border-slate-400'
            }`}
          >
            {text || 'Signature'}
          </button>
        ))}
      </div>
      {/* Preview */}
      <div className="border-2 border-slate-200 rounded-xl overflow-hidden">
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="block w-full" />
      </div>
      <p className="text-xs text-slate-400 mt-1 text-center">Choose a style above</p>
      <Buttons onClear={() => setText('')} onClose={onClose} onSave={handleSave} />
    </>
  )
}

/* ── Image tab ── */
function ImageTab({ onSave, onClose }: { onSave: (d: string) => void; onClose: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    if (!preview) { alert('Please upload an image first.'); return }
    onSave(preview)
  }

  return (
    <>
      <div
        className="border-2 border-dashed border-slate-300 rounded-xl h-48 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors mb-3"
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="signature" className="max-h-40 max-w-full object-contain" />
        ) : (
          <>
            <ImageIcon size={32} className="text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">Click to upload image</p>
            <p className="text-xs text-slate-400">PNG, JPG, SVG</p>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <Buttons onClear={() => { setPreview(null); if (inputRef.current) inputRef.current.value = '' }} onClose={onClose} onSave={handleSave} />
    </>
  )
}

/* ── Shared buttons ── */
function Buttons({ onClear, onClose, onSave }: { onClear: () => void; onClose: () => void; onSave: () => void }) {
  return (
    <div className="flex gap-3 mt-4 justify-end">
      <button onClick={onClear} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition">Clear</button>
      <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition">Cancel</button>
      <button onClick={onSave} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium">Save Signature</button>
    </div>
  )
}
