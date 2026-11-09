import 'server-only'
import { promisify } from 'node:util'
import { brotliCompress as brotliCb, constants as zc, gzip as gzipCb } from 'node:zlib'
import { NextResponse } from 'next/server'

const gzip = promisify(gzipCb)
const brotli = promisify(brotliCb)

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
 *
 * Brotli (quality 4) when the browser takes it — every current browser over
 * HTTPS: 25–45% smaller than gzip-1 on the store's lists for ~10 ms more,
 * which matters most on a slow link.
 */
export async function compressedJson(
  request: Request,
  json: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Promise<NextResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  const vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding'
  const accept = request.headers.get('accept-encoding') ?? ''
  const useBrotli = /\bbr\b/i.test(accept)
  const useGzip = !useBrotli && /\bgzip\b/i.test(accept)
  const bytes = Buffer.byteLength(json)
  if ((!useBrotli && !useGzip) || bytes < MIN_BYTES) {
    return new NextResponse(json, { status: init.status ?? 200, headers: { ...headers, Vary: vary } })
  }
  const raw = Buffer.from(json)
  const body = useBrotli
    ? await brotli(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 4, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length } })
    : await gzip(raw, { level: 1 })
  return new NextResponse(new Uint8Array(body), {
    status: init.status ?? 200,
    headers: { ...headers, Vary: vary, 'Content-Encoding': useBrotli ? 'br' : 'gzip', 'Content-Length': String(body.length) },
  })
}
