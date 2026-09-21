import 'server-only'
import { createHmac, createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type ObjectStoreDriver = 'fs' | 's3'

export type PutObjectInput = {
  bucket: string
  key: string
  body: Buffer | string
  contentType?: string
}

export type StoredObject = {
  driver: ObjectStoreDriver
  bucket: string
  key: string
  contentType: string
  bytes: number
  uri: string
}

export type ObjectStore = {
  driver: ObjectStoreDriver
  put(input: PutObjectInput): Promise<StoredObject>
  get(bucket: string, key: string): Promise<Buffer | null>
  delete(bucket: string, key: string): Promise<void>
  exists(bucket: string, key: string): Promise<boolean>
  list(bucket: string, prefix?: string): Promise<string[]>
}

const KEY_SEGMENT = /[^A-Za-z0-9._-]/g

export function sanitizeObjectKey(key: string): string {
  return key
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.replace(KEY_SEGMENT, '_'))
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .join('/')
}

export function sanitizeBucket(bucket: string): string {
  const value = bucket.replace(KEY_SEGMENT, '_')
  return value || 'files'
}

function asBuffer(body: Buffer | string): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.from(body)
}

function blobRoot() {
  return process.env.BLOB_STORE_DIR || '/var/lib/deed-erp/blobs'
}

function uploadsRoot() {
  return process.env.UPLOADS_DIR
    || process.env.OBJECT_STORE_DIR
    || path.join(process.cwd(), '.uploads')
}

export function localObjectPath(bucket: string, key: string): string {
  const safeBucket = sanitizeBucket(bucket)
  const safeKey = sanitizeObjectKey(key)
  if (safeBucket === 'blobs') {
    const base = safeKey.endsWith('.blob') ? safeKey : `${safeKey}.blob`
    return path.join(blobRoot(), base)
  }
  if (safeBucket === 'uploads') {
    return path.join(uploadsRoot(), safeKey)
  }
  return path.join(uploadsRoot(), safeBucket, safeKey)
}

function createFsStore(): ObjectStore {
  return {
    driver: 'fs',
    async put(input) {
      const file = localObjectPath(input.bucket, input.key)
      const body = asBuffer(input.body)
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(tmp, body)
      await fs.rename(tmp, file)
      return {
        driver: 'fs',
        bucket: sanitizeBucket(input.bucket),
        key: sanitizeObjectKey(input.key),
        contentType: input.contentType || 'application/octet-stream',
        bytes: body.length,
        uri: `file://${file}`,
      }
    },
    async get(bucket, key) {
      try {
        return await fs.readFile(localObjectPath(bucket, key))
      } catch {
        return null
      }
    },
    async delete(bucket, key) {
      try {
        await fs.unlink(localObjectPath(bucket, key))
      } catch {
        // missing is fine
      }
    },
    async exists(bucket, key) {
      try {
        await fs.access(localObjectPath(bucket, key))
        return true
      } catch {
        return false
      }
    },
    async list(bucket, prefix) {
      try {
        const dir = bucket === 'blobs'
          ? blobRoot()
          : bucket === 'uploads'
            ? uploadsRoot()
            : path.join(uploadsRoot(), sanitizeBucket(bucket))
        const entries: string[] = await fs.readdir(dir)
        const keys = entries.map(name =>
          bucket === 'blobs' ? name.replace(/\.blob$/, '') : name,
        ).filter(Boolean)
        return prefix ? keys.filter(k => k.startsWith(prefix)) : keys
      } catch {
        return []
      }
    },
  }
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function hashHex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function isoBasic(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function encodeS3Path(key: string) {
  return sanitizeObjectKey(key).split('/').map(encodeURIComponent).join('/')
}

export function signS3Request(input: {
  method: string
  endpoint: string
  region: string
  bucket: string
  key: string
  accessKeyId: string
  secretAccessKey: string
  body: Buffer
  contentType: string
  now?: Date
  pathStyle?: boolean
  queryParams?: Record<string, string>
}): { url: string; headers: Record<string, string> } {
  const now = input.now ?? new Date()
  const amzDate = isoBasic(now)
  const dateStamp = amzDate.slice(0, 8)
  const endpoint = new URL(input.endpoint)
  const pathStyle = input.pathStyle !== false
  const canonicalUri = pathStyle
    ? `/${encodeURIComponent(input.bucket)}/${encodeS3Path(input.key)}`
    : `/${encodeS3Path(input.key)}`
  const host = pathStyle ? endpoint.host : `${input.bucket}.${endpoint.host}`
  const payloadHash = hashHex(input.body)
  const headers: Record<string, string> = {
    host,
    'content-type': input.contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames.map(name => `${name}:${headers[name]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalQueryString = input.queryParams
    ? Object.keys(input.queryParams).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(input.queryParams![k])}`)
        .join('&')
    : ''
  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join('\n')
  const kDate = hmacHex(`AWS4${input.secretAccessKey}`, dateStamp)
  const kRegion = hmacHex(kDate, input.region)
  const kService = hmacHex(kRegion, 's3')
  const kSigning = hmacHex(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const qs = canonicalQueryString ? `?${canonicalQueryString}` : ''
  const url = `${endpoint.protocol}//${host}${canonicalUri}${qs}`
  return { url, headers }
}

function s3Config() {
  const bucket = String(process.env.OBJECT_STORE_BUCKET || '').trim()
  const accessKeyId = String(process.env.OBJECT_STORE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(process.env.OBJECT_STORE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '').trim()
  const region = String(process.env.OBJECT_STORE_REGION || process.env.AWS_REGION || 'us-east-1').trim()
  const endpoint = String(process.env.OBJECT_STORE_ENDPOINT || `https://s3.${region}.amazonaws.com`).trim()
  const pathStyle = !['0', 'false', 'no'].includes(String(process.env.OBJECT_STORE_FORCE_PATH_STYLE || 'true').toLowerCase())
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 object store requires OBJECT_STORE_BUCKET, OBJECT_STORE_ACCESS_KEY_ID, and OBJECT_STORE_SECRET_ACCESS_KEY')
  }
  return { bucket, accessKeyId, secretAccessKey, region, endpoint, pathStyle }
}

function objectPrefix() {
  const prefix = String(process.env.OBJECT_STORE_PREFIX || 'deed-erp').replace(/^\/+|\/+$/g, '')
  return prefix
}

function s3Key(bucket: string, key: string) {
  return [objectPrefix(), sanitizeBucket(bucket), sanitizeObjectKey(key)].filter(Boolean).join('/')
}

function createS3Store(): ObjectStore {
  const cfg = s3Config()
  async function request(method: string, bucket: string, key: string, body: Buffer, contentType: string) {
    const signed = signS3Request({
      method,
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      key: s3Key(bucket, key),
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      body,
      contentType,
      pathStyle: cfg.pathStyle,
    })
    const res = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : new Uint8Array(body),
    })
    return res
  }

  return {
    driver: 's3',
    async put(input) {
      const body = asBuffer(input.body)
      const contentType = input.contentType || 'application/octet-stream'
      const res = await request('PUT', input.bucket, input.key, body, contentType)
      if (!res.ok) throw new Error(`S3 put failed (${res.status})`)
      const objectKey = s3Key(input.bucket, input.key)
      return {
        driver: 's3',
        bucket: sanitizeBucket(input.bucket),
        key: sanitizeObjectKey(input.key),
        contentType,
        bytes: body.length,
        uri: `s3://${cfg.bucket}/${objectKey}`,
      }
    },
    async get(bucket, key) {
      const res = await request('GET', bucket, key, Buffer.alloc(0), 'application/octet-stream')
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`S3 get failed (${res.status})`)
      return Buffer.from(await res.arrayBuffer())
    },
    async delete(bucket, key) {
      const res = await request('DELETE', bucket, key, Buffer.alloc(0), 'application/octet-stream')
      if (res.status === 404 || res.ok) return
      throw new Error(`S3 delete failed (${res.status})`)
    },
    async exists(bucket, key) {
      const res = await request('HEAD', bucket, key, Buffer.alloc(0), 'application/octet-stream')
      if (res.status === 404) return false
      if (!res.ok) throw new Error(`S3 head failed (${res.status})`)
      return true
    },
    async list(bucket, prefix) {
      const results: string[] = []
      const objPrefix = [objectPrefix(), sanitizeBucket(bucket)].filter(Boolean).join('/')
      const fullPrefix = prefix ? `${objPrefix}/${prefix}` : `${objPrefix}/`
      let continuationToken: string | undefined
      do {
        const params: Record<string, string> = {
          'list-type': '2',
          'max-keys': '1000',
          prefix: fullPrefix,
        }
        if (continuationToken) params['continuation-token'] = continuationToken
        const signed = signS3Request({
          method: 'GET',
          endpoint: cfg.endpoint,
          region: cfg.region,
          bucket: cfg.bucket,
          key: '',
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          body: Buffer.alloc(0),
          contentType: 'application/xml',
          pathStyle: cfg.pathStyle,
          queryParams: params,
        })
        const res = await fetch(signed.url, { method: 'GET', headers: signed.headers })
        if (!res.ok) break
        const xml = await res.text()
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
          const relative = m[1].startsWith(objPrefix + '/') ? m[1].slice(objPrefix.length + 1) : m[1]
          results.push(relative)
        }
        const truncated = xml.includes('<IsTruncated>true</IsTruncated>')
        const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
        continuationToken = truncated && tokenMatch ? tokenMatch[1] : undefined
      } while (continuationToken)
      return results
    },
  }
}

let cached: ObjectStore | null = null

export function objectStoreDriver(): ObjectStoreDriver {
  const driver = String(process.env.OBJECT_STORE_DRIVER || 'fs').trim().toLowerCase()
  return driver === 's3' ? 's3' : 'fs'
}

export function getObjectStore(): ObjectStore {
  if (cached) return cached
  cached = objectStoreDriver() === 's3' ? createS3Store() : createFsStore()
  return cached
}

export function __resetObjectStoreForTests() {
  cached = null
}

export async function putObject(input: PutObjectInput): Promise<StoredObject> {
  return getObjectStore().put(input)
}

export async function getObject(bucket: string, key: string): Promise<Buffer | null> {
  return getObjectStore().get(bucket, key)
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  return getObjectStore().delete(bucket, key)
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  return getObjectStore().exists(bucket, key)
}

export async function listObjects(bucket: string, prefix?: string): Promise<string[]> {
  return getObjectStore().list(bucket, prefix)
}
