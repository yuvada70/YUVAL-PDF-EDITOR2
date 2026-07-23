import { useCallback, useEffect, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { PdfViewer } from './components/PdfViewer'
import { SignatureModal } from './components/SignatureModal'
import { DropZone } from './components/DropZone'
import { useEditorStore } from './store/editorStore'
import { loadPdfDocument } from './utils/pdfRenderer'

export default function App() {
  const { pdfFile, setPdfFile, tool, setTool } = useEditorStore()
  const [showSignatureModal, setShowSignatureModal] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const doc = await loadPdfDocument(buffer)
      setPdfFile(buffer, file.name, doc.numPages)
    } catch (err) {
      console.error('Failed to load PDF:', err)
      alert('Failed to load PDF file. Please make sure the file is a valid PDF.')
    }
  }, [setPdfFile])

  const handleToolSelect = useCallback((t: typeof tool) => {
    if (t === 'signature') {
      setShowSignatureModal(true)
    } else {
      setTool(t)
    }
  }, [setTool])

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' && e.key.toLowerCase() !== 'y') return
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      const s = useEditorStore.getState()
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault()
        s.redo()
      } else {
        e.preventDefault()
        s.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100">
      <Toolbar onToolSelect={handleToolSelect} onFileOpen={handleFile} />
      {pdfFile ? (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <PdfViewer />
        </div>
      ) : (
        <DropZone onFile={handleFile} />
      )}
      {showSignatureModal && (
        <SignatureModal onClose={() => setShowSignatureModal(false)} />
      )}
    </div>
  )
}
