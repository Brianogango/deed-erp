const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export type ImageGuardOptions = {
  maxBytes?: number
  maxPixels?: number
  maxWidth?: number
  maxHeight?: number
  allowedTypes?: string[]
  label?: string
}

export type ImageGuardResult = {
  width: number
  height: number
  pixels: number
  dataUrl?: string
}

export class ImageGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageGuardError'
  }
}

export function formatImageGuardBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function normaliseType(type: string) {
  return String(type || '').toLowerCase()
}

function allowedTypeLabel(types: string[]) {
  const labels = types.map(type => type.replace('image/', '').toUpperCase().replace('JPEG', 'JPG'))
  return labels.join(', ')
}

function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      URL.revokeObjectURL(url)
      if (!width || !height) {
        reject(new ImageGuardError('Image dimensions could not be read'))
        return
      }
      resolve({ width, height })
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageGuardError('Selected file could not be decoded as an image'))
    }

    img.src = url
  })
}

export async function validateImageUpload(file: File, options: ImageGuardOptions = {}): Promise<ImageGuardResult> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
  const maxPixels = options.maxPixels ?? 24_000_000
  const maxWidth = options.maxWidth ?? 8000
  const maxHeight = options.maxHeight ?? 8000
  const allowedTypes = options.allowedTypes ?? DEFAULT_ALLOWED_TYPES
  const label = options.label ?? 'Image'
  const fileType = normaliseType(file.type)

  if (!file) throw new ImageGuardError(`${label} is required`)

  if (!allowedTypes.includes(fileType)) {
    throw new ImageGuardError(`${label} must be a supported image type: ${allowedTypeLabel(allowedTypes)}`)
  }

  if (file.size <= 0) {
    throw new ImageGuardError(`${label} is empty`)
  }

  if (file.size > maxBytes) {
    throw new ImageGuardError(`${label} is too large. Maximum size is ${formatImageGuardBytes(maxBytes)}.`)
  }

  const { width, height } = await loadImageDimensions(file)
  const pixels = width * height

  if (width > maxWidth || height > maxHeight) {
    throw new ImageGuardError(`${label} dimensions are too large. Maximum is ${maxWidth}×${maxHeight}px.`)
  }

  if (pixels > maxPixels) {
    throw new ImageGuardError(`${label} has too many pixels. Please upload a smaller image.`)
  }

  return { width, height, pixels }
}

export async function readGuardedImageAsDataUrl(file: File, options: ImageGuardOptions = {}): Promise<string> {
  await validateImageUpload(file, options)

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new ImageGuardError('Could not read the selected image'))
    reader.readAsDataURL(file)
  })
}
