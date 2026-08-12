import { promises as fs } from 'fs'
import path from 'path'
import type { PdfLogo } from '@/lib/pdf-logo'

/**
 * Server PDF logo loader (portal / email attachments).
 * Kept separate from `lib/pdf-logo.ts` so Settings / client PDF code never
 * pulls sharp or Node fs into the browser bundle.
 */

function formatFromMime(mime: string): 'PNG' | 'JPEG' {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG'
  return 'PNG'
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) return null
  return { mime: match[1] || 'image/png', base64: match[3] || '' }
}

/**
 * Reads uploaded data URLs or falls back to public/deed-logo.png on disk.
 */
export async function loadLogoForPdfServer(logoUrl?: string | null): Promise<PdfLogo | null> {
  if (logoUrl && logoUrl.startsWith('data:image/')) {
    const parsed = parseDataUrl(logoUrl)
    if (parsed) {
      try {
        const sharp = (await import('sharp')).default
        const buf = Buffer.from(parsed.base64, 'base64')
        const meta = await sharp(buf).metadata()
        const format = formatFromMime(parsed.mime)
        // jsPDF is happiest with PNG/JPEG — re-encode webp/other.
        if (
          !parsed.mime.toLowerCase().includes('png')
          && !parsed.mime.toLowerCase().includes('jpeg')
          && !parsed.mime.toLowerCase().includes('jpg')
        ) {
          const png = await sharp(buf).png().toBuffer()
          return {
            dataUrl: `data:image/png;base64,${png.toString('base64')}`,
            width: meta.width || 1,
            height: meta.height || 1,
            format: 'PNG',
          }
        }
        return {
          dataUrl: logoUrl,
          width: meta.width || 1,
          height: meta.height || 1,
          format,
        }
      } catch {
        /* fall through to packaged logo */
      }
    }
  }

  try {
    const sharp = (await import('sharp')).default
    const filePath = path.join(process.cwd(), 'public', 'deed-logo.png')
    const buf = await fs.readFile(filePath)
    const meta = await sharp(buf).metadata()
    return {
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      width: meta.width || 200,
      height: meta.height || 60,
      format: 'PNG',
    }
  } catch {
    return null
  }
}
