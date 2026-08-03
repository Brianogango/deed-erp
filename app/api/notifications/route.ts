import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  const state = await loadAppState()
  let notifications: any[] = Array.isArray(state['deed_notifications']) ? state['deed_notifications'] as any[] : []

  if (userId) {
    notifications = notifications.filter(n => n.userId === userId)
  }

  return NextResponse.json({ notifications })
}
