'use client'

/** Phone photos run to several MB; shrink to a readable 1600px JPEG before uploading. */
export async function prepareImage(file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { base64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg', previewUrl: dataUrl }
}

