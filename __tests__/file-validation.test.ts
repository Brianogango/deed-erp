import { describe, it, expect } from 'vitest'
import { detectFileKind, validateFileContent } from '@/lib/file-validation'

const pdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 '),
])
const docxZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])
const oleDoc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const csv = Buffer.from('name,qty\nWidget,3\n')
const plain = Buffer.from('hello world\n')

describe('detectFileKind()', () => {
  it('detects PDF / JPEG / PNG / WebP / ZIP / OLE / text', () => {
    expect(detectFileKind(pdf)).toBe('pdf')
    expect(detectFileKind(jpeg)).toBe('jpeg')
    expect(detectFileKind(png)).toBe('png')
    expect(detectFileKind(webp)).toBe('webp')
    expect(detectFileKind(docxZip)).toBe('zip')
    expect(detectFileKind(oleDoc)).toBe('ole')
    expect(detectFileKind(csv)).toBe('text')
  })
})

describe('validateFileContent()', () => {
  it('accepts a valid PDF with application/pdf', () => {
    const result = validateFileContent(pdf, 'application/pdf')
    expect(result).toEqual({ ok: true, detected: 'pdf' })
  })

  it('accepts a valid JPEG with image/jpeg', () => {
    expect(validateFileContent(jpeg, 'image/jpeg')).toEqual({ ok: true, detected: 'jpeg' })
  })

  it('accepts JPEG declared as image/jpg alias', () => {
    expect(validateFileContent(jpeg, 'image/jpg').ok).toBe(true)
  })

  it('accepts PNG / WebP / DOCX / CSV with matching types', () => {
    expect(validateFileContent(png, 'image/png').ok).toBe(true)
    expect(validateFileContent(webp, 'image/webp').ok).toBe(true)
    expect(validateFileContent(
      docxZip,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ).ok).toBe(true)
    expect(validateFileContent(csv, 'text/csv').ok).toBe(true)
    expect(validateFileContent(plain, 'text/plain').ok).toBe(true)
  })

  it('rejects a PNG spoofed as application/pdf', () => {
    const result = validateFileContent(png, 'application/pdf')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/does not match declared type/i)
      expect(result.error).toMatch(/png/i)
    }
  })

  it('rejects a PDF spoofed as image/jpeg', () => {
    const result = validateFileContent(pdf, 'image/jpeg')
    expect(result.ok).toBe(false)
  })

  it('rejects unknown / unverifiable MIME types', () => {
    const result = validateFileContent(pdf, 'application/x-msdownload')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/unsupported|unverifiable/i)
  })

  it('rejects empty / missing declared type', () => {
    expect(validateFileContent(pdf, '').ok).toBe(false)
    expect(validateFileContent(pdf, 'application/octet-stream').ok).toBe(false)
  })

  it('rejects binary garbage with no recognizable signature', () => {
    const junk = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x00, 0xff, 0xfe])
    const result = validateFileContent(junk, 'application/pdf')
    expect(result.ok).toBe(false)
  })
})
