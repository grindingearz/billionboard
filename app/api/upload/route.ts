import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { uploadToR2 } from '@/lib/r2'
import { env } from '@/lib/env'
import { v4 as uuidv4 } from 'uuid'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 1 * 1024 * 1024 // 1 MB

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate R2 config before touching the file — fast, clear error for misconfiguration
  const r2PublicUrl = env.r2PublicUrl
  if (!r2PublicUrl || !r2PublicUrl.startsWith('https://')) {
    return NextResponse.json(
      { error: 'R2_PUBLIC_URL is not configured correctly' },
      { status: 503 }
    )
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Invalid file type. Only JPG, PNG, and WebP are accepted.' },
      { status: 400 }
    )
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 1 MB.' },
      { status: 400 }
    )
  }

  const bytes = await file.arrayBuffer()
  const inputBuffer = Buffer.from(bytes)

  let outputBuffer: Buffer
  try {
    const sharp = (await import('sharp')).default
    outputBuffer = await sharp(inputBuffer)
      .resize(100, 100, { fit: 'cover', position: 'center' })
      .webp({ quality: 90 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'Image processing failed' }, { status: 500 })
  }

  const key = `creatives/${uuidv4()}.webp`
  let url: string
  try {
    url = await uploadToR2(key, outputBuffer, 'image/webp')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Sanity-check: the URL must be absolute before we store it
  if (!url.startsWith('https://')) {
    return NextResponse.json(
      { error: 'R2_PUBLIC_URL is not configured correctly' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, url })
}
