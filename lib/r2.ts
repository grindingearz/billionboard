import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '@/lib/env'

function getR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId ?? '',
      secretAccessKey: env.r2SecretAccessKey ?? '',
    },
  })
}

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const publicUrl = env.r2PublicUrl
  if (!publicUrl || !publicUrl.startsWith('https://')) {
    throw new Error('R2_PUBLIC_URL is not configured correctly')
  }

  const client = getR2Client()
  await client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName ?? '',
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )

  // Normalise: strip trailing slash from base, key never has a leading slash
  const base = publicUrl.replace(/\/+$/, '')
  return `${base}/${key}`
}
