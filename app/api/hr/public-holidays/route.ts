import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const HR_ROLES = ['director', 'admin_officer']
const toClient = (h: { id: string; holidayDate: Date; name: string }) => ({ id: h.id, date: h.holidayDate.toISOString().slice(0, 10), name: h.name })

/** Holidays HR has added on top of the built-in Kenyan list. Any signed-in user can read them (leave day counts need them). */
export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const rows = await prisma.publicHoliday.findMany({ orderBy: { holidayDate: 'asc' } })
    return NextResponse.json(rows.map(toClient))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(HR_ROLES)
    const body = await request.json().catch(() => ({}))
    const date = String(body.date ?? '').slice(0, 10)
    const name = String(body.name ?? '').trim().slice(0, 120)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
      return NextResponse.json({ error: 'Enter a valid date' }, { status: 400 })
    }
    if (!name) return NextResponse.json({ error: 'Enter the holiday name' }, { status: 400 })
    const row = await prisma.publicHoliday.upsert({
      where: { holidayDate: new Date(`${date}T00:00:00Z`) },
      update: { name },
      create: { holidayDate: new Date(`${date}T00:00:00Z`), name },
    })
    return NextResponse.json(toClient(row), { status: 201 })
  })
}

export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(HR_ROLES)
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid holiday id' }, { status: 400 })
    await prisma.publicHoliday.deleteMany({ where: { id } })
    return NextResponse.json({ ok: true })
  })
}
