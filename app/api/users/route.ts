import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { createAuthUser, findAuthUserByUsername, listPublicUsers, toPublicAuthUser } from '@/lib/auth/users-repository'
import { normalizeCreateUserInput } from '@/lib/auth/validation'
import { ROLE_DEFAULT_MODULES } from '@/lib/auth/types'
import { sendEmail } from '@/lib/integrations/email'

const sanitizeUsername = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9_.-]+/g, '.').replace(/^\.+|\.+$/g, '')

const generateTemporaryPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  let password = 'D3ed!'
  for (let i = 0; i < 9; i += 1) password += alphabet[Math.floor(Math.random() * alphabet.length)]
  return password
}

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
    if (!employee.email) {
      throw Object.assign(new Error('The selected employee must have an email address before account creation'), { status: 400 })
    }

    const existingEmployeeUser = (await listPublicUsers()).find(user => user.employeeId === employee.id || user.email?.toLowerCase() === employee.email!.toLowerCase())
    if (existingEmployeeUser) {
      throw Object.assign(new Error('This active employee already has a system user account'), { status: 409 })
    }

    const username = await resolveAvailableUsername(employee)
    const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || employee.email.split('@')[0]
    const temporaryPassword = generateTemporaryPassword()
    const modules = requested.modules.length > 0 ? requested.modules : ROLE_DEFAULT_MODULES[requested.role]

    const input = {
      ...requested,
      employeeId: employee.id,
      email: employee.email,
      username,
      name,
      modules,
      active: true,
      password: temporaryPassword,
      mustChangePassword: true,
    }

    const passwordHash = await hashPassword(temporaryPassword)
    const user = await createAuthUser(input, passwordHash)

    await sendEmail({
      to: employee.email,
      from: process.env.HR_EMAIL || 'hr@deed.co.ke',
      subject: 'Your Deed ERP account has been created',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="color: #1B2762; margin-top: 0;">Deed ERP Account Created</h2>
          <p>Hi ${name},</p>
          <p>Your Deed ERP system user account has been created from your active HR employee profile.</p>
          <p><strong>Username:</strong> ${username}<br/><strong>Temporary password:</strong> ${temporaryPassword}</p>
          <p>You will be asked to change this temporary password after signing in.</p>
          <p>If you were not expecting this account, please contact HR immediately.</p>
          <p style="margin-top: 28px;">Best regards,<br/><strong>HR Department</strong><br/>Deed Technologies Limited</p>
        </div>
      `,
      text: `Hi ${name},

Your Deed ERP system user account has been created from your active HR employee profile.

Username: ${username}
Temporary password: ${temporaryPassword}

You will be asked to change this temporary password after signing in.

Best regards,
HR Department
Deed Technologies Limited`,
    })

    return NextResponse.json({
      user: toPublicAuthUser(user),
      audit: {
        action: 'create_user',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    }, { status: 201 })
  })
}
