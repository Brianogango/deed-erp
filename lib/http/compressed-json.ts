import 'server-only'
import { promisify } from 'node:util'
import { gzip as gzipCb } from 'node:zlib'
import { NextResponse } from 'next/server'

const gzip = promisify(gzipCb)

/** Below this, compressing costs more than it saves. */
const MIN_BYTES = 8 * 1024

/**
 * A JSON response, gzipped when the browser accepts it.
 *
 * Next.js compresses pages but not route-handler responses, and nginx's
 * default gzip_types leaves JSON alone, so the store's lists (several MB)
 * went over the wire uncompressed. gzip level 1 shrinks them about 9x for
 * ~20 ms of work, done off the main thread. A proxy that compresses too sees
 * Content-Encoding and leaves the body as it is.
 */
export async function compressedJson(
  request: Request,
  json: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Promise<NextResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  const vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding'
  const accepts = /\bgzip\b/i.test(request.headers.get('accept-encoding') ?? '')
  const bytes = Buffer.byteLength(json)
  if (!accepts || bytes < MIN_BYTES) {
    return new NextResponse(json, { status: init.status ?? 200, headers: { ...headers, Vary: vary } })
  }
  const body = await gzip(Buffer.from(json), { level: 1 })
  return new NextResponse(new Uint8Array(body), {
    status: init.status ?? 200,
    headers: { ...headers, Vary: vary, 'Content-Encoding': 'gzip', 'Content-Length': String(body.length) },
  })
}
