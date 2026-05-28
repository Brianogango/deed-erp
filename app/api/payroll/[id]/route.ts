import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState()
  const runs: any[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as any[] : []
  const idx = runs.findIndex(r => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  runs[idx] = { ...runs[idx], ...body, id: params.id }
  await saveStoreKeys({ deed_payrollRuns: JSON.stringify(runs) })
  return NextResponse.json({ item: runs[idx] })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}
