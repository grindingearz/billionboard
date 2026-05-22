'use client'

import { useState, useRef, useCallback } from 'react'

interface ImageUploadProps {
  value: string
  onChange: (url: string) => void
  onError: (msg: string) => void
}

const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp']
const MAX_BYTES = 1 * 1024 * 1024

export default function ImageUpload({ value, onChange, onError }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(value || null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File) => {
      onError('')

      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_EXTS.includes(ext)) {
        onError('Invalid file type. Only JPG, PNG, and WebP are accepted.')
        return
      }
      if (file.size > MAX_BYTES) {
        onError('File too large. Maximum size is 1 MB.')
        return
      }

      // Local preview before upload
      const localUrl = URL.createObjectURL(file)
      setPreview(localUrl)

      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        type UploadResult = { ok?: boolean; url?: string; error?: string }
        let data: UploadResult | null = null
        let rawText = ''
        try {
          rawText = await res.text()
          data = rawText ? (JSON.parse(rawText) as UploadResult) : null
        } catch {
          // non-JSON body — rawText still has the raw response for display
        }

        if (!res.ok || !data?.ok) {
          const errMsg =
            res.status === 401
              ? 'Please sign in again'
              : data?.error ?? (rawText.slice(0, 200) || 'Upload failed. Please try again.')
          onError(errMsg)
          setPreview(null)
          onChange('')
          return
        }

        // Guard: only accept absolute https:// URLs — never pass a blob or partial URL to the parent
        const uploadedUrl = data.url ?? ''
        if (!uploadedUrl.startsWith('https://')) {
          onError('Upload returned an invalid URL. Check R2_PUBLIC_URL configuration.')
          setPreview(null)
          onChange('')
          return
        }

        onChange(uploadedUrl)
      } catch {
        onError('Upload failed. Please try again.')
        setPreview(null)
        onChange('')
      } finally {
        setUploading(false)
      }
    },
    [onChange, onError]
  )

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    processFile(files[0])
  }

  return (
    <div className="space-y-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        className={`relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
          dragOver
            ? 'border-green-400 bg-green-400/10'
            : 'border-white/20 hover:border-white/40 bg-white/5'
        }`}
      >
        {uploading ? (
          <div className="text-white/50 text-sm">Uploading…</div>
        ) : (
          <>
            <div className="text-white/40 text-2xl mb-1">↑</div>
            <div className="text-white/60 text-sm">Click or drag to upload</div>
            <div className="text-white/30 text-xs mt-1">JPG, PNG, WebP · max 1 MB · resized to 100×100</div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {preview && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Preview"
            className="w-16 h-16 object-cover rounded-lg border border-white/10"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/50 mb-1">Preview (actual size: 100×100 px)</div>
            <div className="text-xs text-white/30 truncate">{value || 'Uploading…'}</div>
          </div>
          <button
            type="button"
            onClick={() => { setPreview(null); onChange(''); if (inputRef.current) inputRef.current.value = '' }}
            className="text-white/30 hover:text-red-400 text-lg leading-none transition-colors"
            title="Remove image"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
