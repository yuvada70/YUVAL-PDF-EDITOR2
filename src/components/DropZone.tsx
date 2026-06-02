import { useCallback, useState } from 'react'
import { Upload, FileText } from 'lucide-react'

interface Props {
  onFile: (file: File) => void
}

export function DropZone({ onFile }: Props) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') onFile(file)
  }, [onFile])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <label
        className={`flex flex-col items-center justify-center w-full max-w-lg h-72 border-4 border-dashed rounded-2xl cursor-pointer transition-colors ${
          dragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center gap-4 pointer-events-none select-none">
          {dragging ? (
            <FileText className="w-16 h-16 text-blue-500" />
          ) : (
            <Upload className="w-16 h-16 text-slate-400" />
          )}
          <div className="text-center">
            <p className="text-xl font-semibold text-slate-700">
              {dragging ? 'Drop your PDF here' : 'Open a PDF file'}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Drag & drop or click to browse
            </p>
          </div>
        </div>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleInput}
        />
      </label>
    </div>
  )
}
