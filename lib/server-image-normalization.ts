import sharp from 'sharp'

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_DIMENSION = 1600
const DEFAULT_INITIAL_QUALITY = 82
const DEFAULT_MIN_QUALITY = 62
const DEFAULT_TARGET_BYTES = 900 * 1024

type NormalizeOptions = {
  maxInputBytes?: number
  maxDimension?: number
  initialQuality?: number
  minQuality?: number
  targetBytes?: number
}

type NormalizedImage = {
  dataUrl: string
  contentType: 'image/jpeg'
  bytes: number
  originalBytes: number
  width?: number
  height?: number
  originalContentType: string
  quality: number
}

export class ImageNormalizationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ImageNormalizationError'
    this.status = status
  }
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!match) {
    throw new ImageNormalizationError('Photo must be a base64 image data URL', 400)
  }

  const contentType = (match[1] || '').toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw new ImageNormalizationError('Uploaded file must be an image', 415)
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(match[2], 'base64')
  } catch {
    throw new ImageNormalizationError('Photo data is not valid base64', 400)
  }

  if (buffer.length === 0) {
    throw new ImageNormalizationError('Photo is empty', 400)
  }

  return { contentType, buffer }
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}

export async function normalizeUploadedRepairPhoto(
  dataUrl: string,
  options: NormalizeOptions = {}
): Promise<NormalizedImage> {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const initialQuality = options.initialQuality ?? DEFAULT_INITIAL_QUALITY
  const minQuality = options.minQuality ?? DEFAULT_MIN_QUALITY
  const targetBytes = options.targetBytes ?? DEFAULT_TARGET_BYTES

  const { contentType, buffer } = parseDataUrl(dataUrl)
  if (buffer.length > maxInputBytes) {
    throw new ImageNormalizationError(`Photo exceeds ${Math.round(maxInputBytes / 1024 / 1024)} MB upload limit`, 413)
  }

  let image = sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 }).rotate()
  let metadata
  try {
    metadata = await image.metadata()
  } catch {
    throw new ImageNormalizationError('Photo could not be decoded as a supported image', 415)
  }

  if (!metadata.format) {
    throw new ImageNormalizationError('Photo format is not supported', 415)
  }

  const width = metadata.width
  const height = metadata.height
  const resize = width && height && Math.max(width, height) > maxDimension
    ? { width: maxDimension, height: maxDimension, fit: 'inside' as const, withoutEnlargement: true }
    : undefined

  let selected = Buffer.alloc(0)
  let selectedQuality = initialQuality

  for (let quality = initialQuality; quality >= minQuality; quality -= 8) {
    image = sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 }).rotate()
    const candidate = await image
      .resize(resize)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()

    selected = candidate
    selectedQuality = quality

    if (candidate.length <= targetBytes) break
  }

  if (selected.length === 0) {
    throw new ImageNormalizationError('Photo could not be normalized', 415)
  }

  return {
    dataUrl: toDataUrl(selected),
    contentType: 'image/jpeg',
    bytes: selected.length,
    originalBytes: buffer.length,
    width,
    height,
    originalContentType: contentType,
    quality: selectedQuality,
  }
}
