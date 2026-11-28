import { NextResponse } from 'next/server'
import { getRequiredSession, requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

/** Who heads each department (department id → employee id); there is no column for it. */
const HEADS_KEY = 'deed_departmentHeads'
const readHeads = async (): Promise<Record<string, string>> => {
  const v = (await loadAppState([HEADS_KEY]).catch(() => ({})) as Record<string, unknown>)[HEADS_KEY]
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {}
}

export const dynamic = 'force-dynamic'

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status })

/** The departments employees belong to (the one list HR edits), with how many active people each has. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const [rows, counts, heads] = await Promise.all([
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      prisma.employee.groupBy({ by: ['departmentId'], where: { isActive: true }, _count: { _all: true } }).catch(() => []),
      readHeads(),
    ])
    const count = new Map(counts.map(c => [c.departmentId, c._count._all]))
    return NextResponse.json({
      departments: rows.map(d => ({ id: d.id, name: d.name, description: d.description ?? '', active: d.isActive, people: count.get(d.id) ?? 0, headEmployeeId: heads[d.id] ?? null })),
    })
  })
}

/** Add a department. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageHR')
    const body = await request.json().catch(() => ({})) as { name?: string; description?: string }
    const name = String(body.name ?? '').trim().slice(0, 100)
    if (!name) throw fail('Give the department a name')
    const clash = await prisma.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
    if (clash) {
      if (clash.isActive) throw fail(`"${clash.name}" already exists`, 409)
      const back = await prisma.department.update({ where: { id: clash.id }, data: { isActive: true } })
      return NextResponse.json({ department: back })
    }
    const department = await prisma.department.create({ data: { name, description: String(body.description ?? '').trim() || null, isActive: true } })
    await writeFinancialAudit({ userId: actor.id, action: 'department.created', entityType: 'department', entityId: department.id, newValues: { name } })
    return NextResponse.json({ department })
  })
}

/** Rename, describe, or switch a department off / on. Switching off needs it to have no active employees. */
export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageHR')
    const body = await request.json().catch(() => ({})) as { id?: string; name?: string; description?: string; active?: boolean; headEmployeeId?: string | null }
    const existing = body.id ? await prisma.department.findUnique({ where: { id: body.id } }) : null
    if (!existing) throw fail('Department not found', 404)
    if (body.headEmployeeId !== undefined) {
      const head = body.headEmployeeId ? await prisma.employee.findUnique({ where: { id: String(body.headEmployeeId) }, select: { id: true } }) : null
      if (body.headEmployeeId && !head) throw fail('That person was not found', 404)
      const heads = await readHeads()
      if (head) heads[existing.id] = head.id
      else delete heads[existing.id]
      await saveStoreKeys({ [HEADS_KEY]: JSON.stringify(heads) })
      await writeFinancialAudit({ userId: actor.id, action: 'department.head_set', entityType: 'department', entityId: existing.id, newValues: { headEmployeeId: head?.id ?? null } })
      if (body.name === undefined && body.description === undefined && body.active === undefined) return NextResponse.json({ department: existing })
    }
    const data: { name?: string; description?: string | null; isActive?: boolean } = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 100)
      if (!name) throw fail('Give the department a name')
      const clash = await prisma.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id: existing.id } } })
      if (clash) throw fail(`"${clash.name}" already exists`, 409)
      data.name = name
    }
    if (body.description !== undefined) data.description = String(body.description).trim() || null
    if (body.active === false && existing.isActive) {
      const people = await prisma.employee.count({ where: { departmentId: existing.id, isActive: true } })
      if (people) throw fail(`${people} active employee${people === 1 ? ' is' : 's are'} still in ${existing.name}. Move them first.`, 409)
      data.isActive = false
    }
    if (body.active === true) data.isActive = true
    const department = await prisma.department.update({ where: { id: existing.id }, data })
    await writeFinancialAudit({ userId: actor.id, action: 'department.updated', entityType: 'department', entityId: department.id, oldValues: { name: existing.name, active: existing.isActive }, newValues: data })
    return NextResponse.json({ department })
  })
}
