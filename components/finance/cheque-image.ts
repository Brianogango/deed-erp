'use client'

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void }

/** Decode without keeping the full-size photo around: phones run out of memory on a dozen 12-MP pictures. */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* e.g. HEIC on some browsers: the <img> path below can still read it */ }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error(`${file.name || 'This file'} is not a picture that can be read`)
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => { img.src = ''; URL.revokeObjectURL(url) } }
}

function draw(d: Decoded, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(d.width, d.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(d.width * scale))
  canvas.height = Math.max(1, Math.round(d.height * scale))
  canvas.getContext('2d')?.drawImage(d.source, 0, 0, canvas.width, canvas.height)
  const out = canvas.toDataURL('image/jpeg', quality)
  canvas.width = 0
  canvas.height = 0
  return out
}

/** Phone photos run to several MB; shrink to a readable 1600px JPEG (plus a small preview) before uploading. */
export async function prepareImage(file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const d = await decode(file)
  try {
    if (!d.width || !d.height) throw new Error(`${file.name || 'This file'} is not a picture that can be read`)
    const full = draw(d, 1600, 0.85)
    const previewUrl = draw(d, 360, 0.7)
    return { base64: full.split(',')[1] ?? '', mimeType: 'image/jpeg', previewUrl }
  } finally {
    d.release()
  }
}
