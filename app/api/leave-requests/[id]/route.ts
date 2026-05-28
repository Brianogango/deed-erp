import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const WRITE_ROLES = ['director', 'admin_officer', 'hr_manager']

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState()
  const requests: any[] = Array.isArray(state['deed_leaveRequests']) ? state['deed_leaveRequests'] as any[] : []
  const idx = requests.findIndex(r => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  requests[idx] = { ...requests[idx], ...body, id: params.id }
  await saveStoreKeys({ deed_leaveRequests: JSON.stringify(requests) })
  return NextResponse.json({ item: requests[idx] })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = await loadAppState()
  const requests: any[] = Array.isArray(state['deed_leaveRequests']) ? state['deed_leaveRequests'] as any[] : []
  const filtered = requests.filter(r => r.id !== params.id)
  await saveStoreKeys({ deed_leaveRequests: JSON.stringify(filtered) })
  return NextResponse.json({ ok: true })
}
