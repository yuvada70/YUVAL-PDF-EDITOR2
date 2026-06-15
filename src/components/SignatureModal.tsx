import { useEffect, useRef } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { X } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'

interface Props {
  onClose: () => void
}

export function SignatureModal({ onClose }: Props) {
  const sigRef = useRef<SignatureCanvas>(null)
  const { setTool, setPendingSignature } = useEditorStore()

  useEffect(() => {
    sigRef.current?.clear()
  }, [])

  const handleSave = () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      alert('Please draw a signature first.')
      return
    }
    const dataUrl = sigRef.current.toDataURL('image/png')
    setPendingSignature(dataUrl)
    setTool('signature')
    onClose()
  }

  const handleClear = () => {
    sigRef.current?.clear()
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

        <div className="border-2 border-slate-300 rounded-xl overflow-hidden bg-slate-50">
          <SignatureCanvas
            ref={sigRef}
            penColor="#1e293b"
            backgroundColor="white"
            canvasProps={{ width: 440, height: 200, className: 'block w-full', style: { background: 'white' } }}
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
