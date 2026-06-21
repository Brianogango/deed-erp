import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const PROTECTED_NON_EMPTY_ARRAY_KEYS = new Set<string>(['deed_repairs_v2'])

function parseArrayLength(serializedValue: string): number | null {
  try {
    const parsed = JSON.parse(serializedValue)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
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

  const entries: Record<string, string> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!k.startsWith('deed_')) continue
    entries[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }

  if (Object.keys(entries).length === 0) {
    return NextResponse.json({ error: 'No valid deed_ keys supplied' }, { status: 400 })
  }

  const keysToProtect = Object.keys(entries).filter(key => PROTECTED_NON_EMPTY_ARRAY_KEYS.has(key))
  const skippedKeys: string[] = []
  if (keysToProtect.length > 0) {
    const currentState = await loadAppState(keysToProtect)
    for (const key of keysToProtect) {
      const incomingLength = parseArrayLength(entries[key])
      const currentLength = Array.isArray(currentState[key]) ? currentState[key].length : null
      if (incomingLength === 0 && typeof currentLength === 'number' && currentLength > 0) {
        delete entries[key]
        skippedKeys.push(key)
      }
    }
  }

  if (Object.keys(entries).length === 0) {
    return NextResponse.json({ ok: true, savedKeys: 0, skippedKeys })
  }

  await saveStoreKeys(entries)
  return NextResponse.json({ ok: true, savedKeys: Object.keys(entries).length, skippedKeys })
}
