import 'server-only'
import sharp from 'sharp'

/** Upright, at most 2000px on the long side, JPEG: small enough to send and still sharp enough to read. */
export async function prepareScanImage(buffer: Buffer): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
  const out = await sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
  return { base64: out.toString('base64'), mimeType: 'image/jpeg' }
}
