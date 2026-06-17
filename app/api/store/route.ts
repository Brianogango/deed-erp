import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const MERGE_COLLECTION_KEYS = new Set(['deed_repairs_v2', 'deed_contacts'])

function recordKey(record: any) {
  return String(record?.id ?? record?.ref ?? record?.name ?? '')
}

function recordTime(record: any) {
  const raw = record?.updatedAt ?? record?.updated_at ?? record?.createdAt ?? record?.createdDate ?? record?.intakeDate ?? record?.date
  const time = raw ? new Date(String(raw)).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function mergeCollection(existing: unknown, incoming: unknown) {
  if (!Array.isArray(incoming)) return incoming
  if (!Array.isArray(existing)) return incoming

  const byKey = new Map<string, any>()
  const order: string[] = []

  for (const item of existing) {
    const key = recordKey(item)
    if (!key) continue
    byKey.set(key, item)
    order.push(key)
  }

  for (const item of incoming) {
    const key = recordKey(item)
    if (!key) continue
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, item)
      order.unshift(key)
      continue
    }

    const currentTime = recordTime(current)
    const incomingTime = recordTime(item)
    const incomingIsNewer = incomingTime && currentTime ? incomingTime >= currentTime : !currentTime || incomingTime
    if (incomingIsNewer) byKey.set(key, { ...current, ...item })
  }

  return Array.from(new Set(order)).map(key => byKey.get(key)).filter(Boolean)
}

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const state = await loadAppState()
  return NextResponse.json(state)
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected object' }, { status: 400 })
  }

  const state = await loadAppState(Object.keys(body as Record<string, unknown>).filter(k => MERGE_COLLECTION_KEYS.has(k)))
  const entries: Record<string, string> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!k.startsWith('deed_')) continue
    let value: unknown = v
    if (MERGE_COLLECTION_KEYS.has(k)) {
      let parsedIncoming = v
      if (typeof v === 'string') {
        try { parsedIncoming = JSON.parse(v) } catch { parsedIncoming = v }
      }
      value = mergeCollection(state[k], parsedIncoming)
    }
    entries[k] = typeof value === 'string' ? value : JSON.stringify(value)
  }

  if (Object.keys(entries).length === 0) {
    return NextResponse.json({ error: 'No valid deed_ keys supplied' }, { status: 400 })
  }

  await saveStoreKeys(entries)
  return NextResponse.json({ ok: true, savedKeys: Object.keys(entries).length })
}
