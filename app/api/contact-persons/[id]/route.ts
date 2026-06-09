import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'

async function broadcastContactPersons() {
  try {
    const all = await prisma.contactPerson.findMany({ include: { client: true }, orderBy: { firstName: 'asc' } })
    void saveStoreKeys({ deed_contactPersons: JSON.stringify(all) })
  } catch {}
}

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep']

function mapContactPersonToDb(body: any) {
  const data: Record<string, any> = {}

  if (body.clientId !== undefined || body.companyId !== undefined) data.clientId = body.clientId ?? body.companyId
  if (body.firstName !== undefined) data.firstName = body.firstName
  if (body.lastName !== undefined) data.lastName = body.lastName
  if (body.email !== undefined) data.email = body.email ?? null
  if (body.phone !== undefined) data.phone = body.phone ?? null
  if (body.position !== undefined || body.jobTitle !== undefined || body.department !== undefined) {
    data.position = body.position ?? body.jobTitle ?? body.department ?? null
  }
  if (body.notes !== undefined) data.notes = body.notes ?? null

  return data
}

function canWrite(role: string) {
  return WRITE_ROLES.includes(role)
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contact = await prisma.contactPerson.findUnique({
      where: { id: params.id },
      include: { client: true },
    })
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(contact)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWrite(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const contact = await prisma.contactPerson.update({
      where: { id: params.id },
      data: mapContactPersonToDb(body),
      include: { client: true },
    })
    void broadcastContactPersons()
    return NextResponse.json(contact)
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWrite(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await prisma.contactPerson.delete({ where: { id: params.id } })
    void broadcastContactPersons()
    return NextResponse.json({ ok: true })
  })
}
