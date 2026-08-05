/**
 * Magic-byte file content validation (AGENT-SEC-004 / SEC-008).
 * Declared MIME type must match the file's actual signature so clients
 * cannot spoof type via Content-Type alone.
 */

export type FileValidationResult =
  | { ok: true; detected: string }
  | { ok: false; error: string }

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46]) // %PDF
const JPEG = Buffer.from([0xff, 0xd8, 0xff])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // �PNG
const RIFF = Buffer.from([0x52, 0x49, 0x46, 0x46]) // RIFF
const WEBP = Buffer.from([0x57, 0x45, 0x42, 0x50]) // WEBP at offset 8
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // PK.. (DOCX/XLSX)
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) // Compound File Binary (DOC/XLS)

function startsWith(buf: Buffer, sig: Buffer, offset = 0): boolean {
  if (buf.length < offset + sig.length) return false
  return buf.subarray(offset, offset + sig.length).equals(sig)
}

/** Detect content family from leading bytes. */
export function detectFileKind(buffer: Buffer): string | null {
  if (!buffer || buffer.length === 0) return null
  if (startsWith(buffer, PDF)) return 'pdf'
  if (startsWith(buffer, JPEG)) return 'jpeg'
  if (startsWith(buffer, PNG)) return 'png'
  if (startsWith(buffer, RIFF) && startsWith(buffer, WEBP, 8)) return 'webp'
  if (startsWith(buffer, ZIP)) return 'zip' // OOXML (docx/xlsx) and other zip
  if (startsWith(buffer, OLE)) return 'ole' // legacy msword / msexcel
  if (looksLikeText(buffer)) return 'text'
  return null
}

/** Reject binary payloads declared as text/csv or text/plain. */
function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512))
  if (sample.includes(0x00)) return false
  // Strong binary signatures already handled above; remaining check is
  // "mostly printable / whitespace / common text control chars".
  let weird = 0
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]
    const ok =
      b === 0x09 || b === 0x0a || b === 0x0d ||
      (b >= 0x20 && b <= 0x7e) ||
      b >= 0x80 // allow UTF-8 high bytes
    if (!ok) weird++
  }
  return weird / sample.length < 0.05
}

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
}

/** MIME → expected magic-byte kind(s). */
const MIME_TO_KIND: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip'],
  'application/msword': ['ole'],
  'application/vnd.ms-excel': ['ole'],
  'text/csv': ['text'],
  'text/plain': ['text'],
}

/**
 * Verify that `buffer` content matches `declaredType` via magic bytes.
 * Returns a clear error suitable for a 415 response body.
 */
export function validateFileContent(
  buffer: Buffer,
  declaredType: string,
): FileValidationResult {
  const mime = MIME_ALIASES[String(declaredType || '').toLowerCase().trim()]
    ?? String(declaredType || '').toLowerCase().trim()

  if (!mime || mime === 'application/octet-stream') {
    return { ok: false, error: 'File type is missing or unknown' }
  }

  const expected = MIME_TO_KIND[mime]
  if (!expected) {
    return { ok: false, error: `Unsupported or unverifiable file type: ${mime}` }
  }

  const detected = detectFileKind(buffer)
  if (!detected) {
    return {
      ok: false,
      error: 'File content could not be identified. The file may be corrupt or spoofed.',
    }
  }

  if (!expected.includes(detected)) {
    return {
      ok: false,
      error: `File content does not match declared type (${mime}). Detected: ${detected}.`,
    }
  }

  return { ok: true, detected }
}

/** Log a rejected upload for security monitoring (SEC-008). */
export function logRejectedUpload(context: {
  route: string
  declaredType: string
  fileName?: string
  size?: number
  reason: string
  userId?: string
}) {
  console.warn(
    `[file-validation] rejected upload route=${context.route} type=${context.declaredType}` +
      ` name=${context.fileName ?? ''} size=${context.size ?? 0}` +
      ` user=${context.userId ?? 'unknown'} reason=${context.reason}`,
  )
}
