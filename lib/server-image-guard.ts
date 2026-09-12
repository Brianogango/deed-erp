import sharp, { type Metadata } from 'sharp'

export type ServerImageGuardOptions = {
  allowedTypes?: string[]
  maxBytes?: number
  maxPixels?: number
  maxWidth?: number
  maxHeight?: number
  label?: string
}

export type GuardedImageBuffer = {
  buffer: Buffer
  mimeType: string
  width?: number
  height?: number
  bytes: number
}

export class ServerImageGuardError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ServerImageGuardError'
    this.status = status
  }
}

const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_PIXELS = 24_000_000
const DEFAULT_MAX_WIDTH = 8000
const DEFAULT_MAX_HEIGHT = 8000

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function stripDataUrl(value: string) {
  return value.replace(/^data:[^;]+;base64,/, '')
}

export async function guardImageBase64Upload(
  imageBase64: unknown,
  mimeType: unknown,
  options: ServerImageGuardOptions = {}
): Promise<GuardedImageBuffer> {
  const allowedTypes = options.allowedTypes ?? DEFAULT_ALLOWED_TYPES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT
  const label = options.label ?? 'Image'
  const type = String(mimeType || '').toLowerCase()

  if (!imageBase64 || !type) {
    throw new ServerImageGuardError('imageBase64 and mimeType are required', 400)
  }

  if (!allowedTypes.includes(type)) {
    throw new ServerImageGuardError(`${label} must be JPG, PNG, or WebP`, 415)
  }

  const raw = stripDataUrl(String(imageBase64))
  const estimatedBytes = Math.floor((raw.length * 3) / 4)
  if (estimatedBytes > maxBytes + 4096) {
    throw new ServerImageGuardError(`${label} is too large. Maximum size is ${formatBytes(maxBytes)}.`, 413)
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(raw, 'base64')
  } catch {
    throw new ServerImageGuardError(`${label} data is not valid base64`, 400)
  }

  if (buffer.length === 0) {
    throw new ServerImageGuardError(`${label} is empty or invalid`, 400)
  }

  if (buffer.length > maxBytes) {
    throw new ServerImageGuardError(`${label} is too large. Maximum size is ${formatBytes(maxBytes)}.`, 413)
  }

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer, { failOn: 'none', limitInputPixels: maxPixels }).metadata()
  } catch {
    throw new ServerImageGuardError(`${label} could not be decoded as a supported image`, 415)
  }

  if (!metadata.format) {
    throw new ServerImageGuardError(`${label} format is not supported`, 415)
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!width || !height) {
    throw new ServerImageGuardError(`${label} dimensions could not be read`, 415)
  }

  if (width > maxWidth || height > maxHeight) {
    throw new ServerImageGuardError(`${label} dimensions are too large. Maximum is ${maxWidth}×${maxHeight}px.`, 413)
  }

  if (width * height > maxPixels) {
    throw new ServerImageGuardError(`${label} has too many pixels. Please upload a smaller image.`, 413)
  }

  return { buffer, mimeType: type, width, height, bytes: buffer.length }
}
