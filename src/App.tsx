import { useCallback, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { PdfViewer } from './components/PdfViewer'
import { SignatureModal } from './components/SignatureModal'
import { DropZone } from './components/DropZone'
import { useEditorStore } from './store/editorStore'
import { loadPdfDocument } from './utils/pdfRenderer'
import { PDFDocument } from 'pdf-lib'

export default function App() {
  const { pdfFile, pdfName, setPdfFile, tool, setTool } = useEditorStore()
  const [showSignatureModal, setShowSignatureModal] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer()
    const doc = await loadPdfDocument(buffer)
    setPdfFile(buffer, file.name, doc.numPages)
  }, [setPdfFile])

  const handleMerge = useCallback(async (file: File) => {
    if (!pdfFile) return
    try {
      const [srcDoc, appendDoc] = await Promise.all([
        PDFDocument.load(pdfFile),
        PDFDocument.load(await file.arrayBuffer()),
      ])
      const indices = Array.from({ length: appendDoc.getPageCount() }, (_, i) => i)
      const copied = await srcDoc.copyPages(appendDoc, indices)
      for (const p of copied) srcDoc.addPage(p)
      const bytes = await srcDoc.save()
      const buf = bytes.buffer as ArrayBuffer
      const doc = await loadPdfDocument(buf)
      setPdfFile(buf, pdfName, doc.numPages)
    } catch (err) {
      console.error(err)
      alert('Merge failed. See console for details.')
    }
  }, [pdfFile, pdfName, setPdfFile])

  const handleToolSelect = useCallback((t: typeof tool) => {
    if (t === 'signature') {
      setShowSignatureModal(true)
    } else {
      setTool(t)
    }
  }, [setTool])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100">
      <Toolbar onToolSelect={handleToolSelect} onFileOpen={handleFile} onMerge={handleMerge} />
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
