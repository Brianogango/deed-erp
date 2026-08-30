import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { createAuthUser, deleteAuthUser, findAuthUserByUsername, listPublicUsers, toPublicAuthUser } from '@/lib/auth/users-repository'
import { normalizeCreateUserInput } from '@/lib/auth/validation'
import { ROLE_DEFAULT_MODULES } from '@/lib/auth/types'
import { buildCredentialMessage, sendMultiChannelMessage } from '@/lib/integrations/messaging'
import { generateTemporaryPassword } from '@/lib/auth/temporary-credentials'

const sanitizeUsername = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9_.-]+/g, '.').replace(/^\.+|\.+$/g, '')

const buildUsernameCandidates = (employee: { email: string | null; employeeNumber: string; firstName: string; lastName: string }) => {
  const fullName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim()
  return [
    employee.email?.split('@')[0] ?? '',
    employee.employeeNumber,
    fullName,
  ].map(sanitizeUsername).filter(Boolean)
}

const resolveAvailableUsername = async (employee: { email: string | null; employeeNumber: string; firstName: string; lastName: string }) => {
  const candidates = buildUsernameCandidates(employee)
  for (const candidate of candidates) {
    if (!(await findAuthUserByUsername(candidate))) return candidate
  }

  const base = candidates[0] || sanitizeUsername(employee.employeeNumber) || 'user'
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}${i}`
    if (!(await findAuthUserByUsername(candidate))) return candidate
  }

  throw Object.assign(new Error('Unable to generate a unique username for this employee'), { status: 409 })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('viewUsers')
    const users = await listPublicUsers()
    return NextResponse.json({ users })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw Object.assign(new Error('Invalid request payload'), { status: 400 })
    }

    const requested = normalizeCreateUserInput(body)
    if (!requested.employeeId) {
      throw Object.assign(new Error('Select an active HR employee before creating a system user'), { status: 400 })
    }

    const employee = await prisma.employee.findUnique({ where: { id: requested.employeeId } })
    if (!employee) {
      throw Object.assign(new Error('Employee not found'), { status: 404 })
    }
    if (!employee.isActive) {
      throw Object.assign(new Error('System users can only be created from active HR employees'), { status: 400 })
    }

    const existingEmployeeUser = (await listPublicUsers()).find(user => user.employeeId === employee.id || (employee.email && user.email?.toLowerCase() === employee.email.toLowerCase()))
    if (existingEmployeeUser) {
      throw Object.assign(new Error('This active employee already has a system user account'), { status: 409 })
    }

    const username = await resolveAvailableUsername(employee)
    const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || (employee.email ? employee.email.split('@')[0] : 'User')
    const temporaryPassword = generateTemporaryPassword()
    const modules = requested.modules.length > 0 ? requested.modules : ROLE_DEFAULT_MODULES[requested.role]

    const input = {
      ...requested,
      employeeId: employee.id,
      email: employee.email || `${username}@deed.africa`,
      username,
      name,
      modules,
      active: true,
      password: temporaryPassword,
      mustChangePassword: true,
    }

    const passwordHash = await hashPassword(temporaryPassword)
    const user = await createAuthUser(input, passwordHash)

    const credentialDelivery = await sendMultiChannelMessage({
      purpose: 'credentials',
      recipient: { name, email: user.email },
      channels: ['email'],
      mailbox: 'hr',
      from: process.env.HR_EMAIL || 'hr@deed.co.ke',
      content: buildCredentialMessage({
        name,
        username,
        temporaryPassword,
        mode: 'welcome',
        loginUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke',
      }),
      metadata: { userId: user.id, action: 'create_user' },
    })

    if (!credentialDelivery.success) {
      // Never reveal a credential through the admin API. If secure delivery
      // fails, roll the account creation back so there is no orphaned account
      // with an undisclosed password.
      await deleteAuthUser(user.id)
      throw Object.assign(
        new Error('Credential delivery failed; account creation was rolled back. Fix HR email delivery and retry.'),
        { status: 503 },
      )
    }

    console.log('[users] User created', {
      userId: user.id,
      username,
      credentialDelivered: true,
    })

    return NextResponse.json({
      user: toPublicAuthUser(user),
      credentialDelivery,
      audit: {
        action: 'create_user',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    }, { status: 201 })
  })
}
