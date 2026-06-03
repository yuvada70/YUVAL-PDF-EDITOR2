import { useCallback, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { PdfViewer } from './components/PdfViewer'
import { SignatureModal } from './components/SignatureModal'
import { MergeModal } from './components/MergeModal'
import { SplitModal } from './components/SplitModal'
import { DropZone } from './components/DropZone'
import { useEditorStore } from './store/editorStore'
import { loadPdfDocument } from './utils/pdfRenderer'

export default function App() {
  const { pdfFile, setPdfFile, tool, setTool } = useEditorStore()
  const [showSignatureModal, setShowSignatureModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer()
    const doc = await loadPdfDocument(buffer)
    setPdfFile(buffer, file.name, doc.numPages)
  }, [setPdfFile])

  const handleToolSelect = useCallback((t: typeof tool) => {
    if (t === 'signature') setShowSignatureModal(true)
    else setTool(t)
  }, [setTool])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100">
      <Toolbar
        onToolSelect={handleToolSelect}
        onFileOpen={handleFile}
        onMerge={() => setShowMergeModal(true)}
        onSplit={() => setShowSplitModal(true)}
      />
      {pdfFile ? (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <PdfViewer />
        </div>
      ) : (
        <DropZone onFile={handleFile} />
      )}
      {showSignatureModal && <SignatureModal onClose={() => setShowSignatureModal(false)} />}
      {showMergeModal && <MergeModal onClose={() => setShowMergeModal(false)} />}
      {showSplitModal && <SplitModal onClose={() => setShowSplitModal(false)} />}
    </div>
  )
}
