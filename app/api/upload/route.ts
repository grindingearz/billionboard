import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { uploadToR2 } from '@/lib/r2'
import { env } from '@/lib/env'
import { v4 as uuidv4 } from 'uuid'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 1 * 1024 * 1024 // 1 MB

function checkR2Config(): string | null {
  if (!env.r2AccountId) return 'R2_ACCOUNT_ID is not configured'
  if (!env.r2AccessKeyId) return 'R2_ACCESS_KEY_ID is not configured'
  if (!env.r2SecretAccessKey) return 'R2_SECRET_ACCESS_KEY is not configured'
  if (!env.r2BucketName) return 'R2_BUCKET_NAME is not configured'
  if (!env.r2PublicUrl || !env.r2PublicUrl.startsWith('https://'))
    return 'R2_PUBLIC_URL is not configured correctly'
  return null
}

// AWS SDK v3 puts the service error code in err.name
function r2ErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Upload failed'
  switch (err.name) {
    case 'AccessDenied':
      return 'R2 upload denied — check R2_ACCESS_KEY_ID and bucket permissions'
    case 'NoSuchBucket':
      return 'R2 bucket not found — check R2_BUCKET_NAME'
    case 'InvalidAccessKeyId':
      return 'R2 access key is invalid — check R2_ACCESS_KEY_ID'
    case 'SignatureDoesNotMatch':
      return 'R2 signature mismatch — check R2_SECRET_ACCESS_KEY'
    default:
      return err.message.slice(0, 200) || 'Upload failed'
  }
}

function logError(label: string, err: unknown) {
  const isErr = err instanceof Error
  // bucket name and public URL are safe to log; never log access keys or secrets
  console.error(`[upload] ${label}`, {
    name: isErr ? err.name : typeof err,
    message: isErr ? err.message : String(err),
    r2Bucket: env.r2BucketName ?? '(not set)',
    r2PublicUrl: env.r2PublicUrl ?? '(not set)',
    hasAccountId: !!env.r2AccountId,
    hasAccessKeyId: !!env.r2AccessKeyId,
    hasSecretKey: !!env.r2SecretAccessKey,
    ...(process.env.NODE_ENV !== 'production' && isErr ? { stack: err.stack } : {}),
  })
}

export async function POST(req: NextRequest) {
  // This log fires unconditionally — if it's absent in Vercel logs the failure
  // is happening at the framework layer before our handler runs.
  console.log('[upload] POST handler reached', {
    contentType: req.headers.get('content-type')?.slice(0, 80) ?? '(none)',
    hasCookie: req.headers.has('cookie'),
  })

  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'Please sign in again' },
        { status: 401 }
      )
    }

    // Validate all R2 config upfront — fail fast with a clear message
    const configErr = checkR2Config()
    if (configErr) {
      console.error('[upload] R2 config error:', configErr, {
        r2Bucket: env.r2BucketName ?? '(not set)',
        r2PublicUrl: env.r2PublicUrl ?? '(not set)',
        hasAccountId: !!env.r2AccountId,
        hasAccessKeyId: !!env.r2AccessKeyId,
        hasSecretKey: !!env.r2SecretAccessKey,
      })
      return NextResponse.json({ ok: false, error: configErr }, { status: 503 })
    }

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.startsWith('multipart/form-data')) {
      return NextResponse.json(
        { ok: false, error: 'Expected multipart/form-data' },
        { status: 400 }
      )
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid form data' }, { status: 400 })
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid file type. Only JPG, PNG, and WebP are accepted.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'File too large. Maximum size is 1 MB.' },
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
    } catch (err) {
      logError('sharp processing failed', err)
      return NextResponse.json(
        { ok: false, error: 'Image processing failed. Please try another JPG/PNG/WebP under 1 MB.' },
        { status: 500 }
      )
    }

    const key = `creatives/${uuidv4()}.webp`
    let url: string
    try {
      url = await uploadToR2(key, outputBuffer, 'image/webp')
    } catch (err) {
      logError('R2 upload failed', err)
      return NextResponse.json({ ok: false, error: r2ErrorMessage(err) }, { status: 500 })
    }

    // Sanity-check: the URL must be absolute before we store it
    if (!url.startsWith('https://')) {
      return NextResponse.json(
        { ok: false, error: 'R2_PUBLIC_URL is not configured correctly' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, url })
  } catch (err) {
    logError('unexpected error', err)
    return NextResponse.json(
      { ok: false, error: 'Upload failed. Please try again.' },
      { status: 500 }
    )
  }
}
