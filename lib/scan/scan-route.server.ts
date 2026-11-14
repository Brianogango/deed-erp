import 'server-only'
import { NextResponse } from 'next/server'
import { getRequiredSession } from '@/lib/auth/api'
import { guardImageBase64Upload } from '@/lib/server-image-guard'
import { prepareScanImage } from './prepare-image.server'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** The shared shape of a scan route: signed-in user, checked image, one reader, errors as { error }. */
export async function handleImageScan<T>(
  request: Request,
  label: string,
  read: (base64: string, mimeType: string) => Promise<T>,
  check?: (result: T) => string | null,
) {
  try {
    await getRequiredSession()
    const { imageBase64, mimeType } = await request.json()
    const { buffer } = await guardImageBase64Upload(imageBase64, mimeType, {
      allowedTypes: IMAGE_TYPES,
      maxBytes: 8 * 1024 * 1024,
      maxPixels: 24_000_000,
      label,
    })
    const image = await prepareScanImage(buffer)
    const result = await read(image.base64, image.mimeType)
    const problem = check?.(result)
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })
    return NextResponse.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Scan failed'
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
