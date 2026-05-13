import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { sendEmail } from '@/lib/integrations/email'

const WRITE_ROLES = ['admin']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const employees = await prisma.employee.findMany({ orderBy: { firstName: 'asc' } })
    return NextResponse.json(employees)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    if (body.startDate) body.startDate = new Date(body.startDate)
    if (body.createdAt) body.createdAt = new Date(body.createdAt)
    const employee = await prisma.employee.create({ data: body })

    // Send welcome email from HR
    if (employee.email) {
      await sendEmail({
        to: employee.email,
        from: process.env.HR_EMAIL || 'hr@deed.co.ke',
        subject: `Welcome to Deed Technologies — ${employee.fullName}`,
        html: `
          <h1>Welcome aboard, ${employee.fullName}!</h1>
          <p>We are excited to have you join our team as <strong>${employee.jobTitle || 'a team member'}</strong>.</p>
          <p>Your employee number is: <strong>${employee.employeeNo}</strong></p>
          <p>If you have any questions regarding your onboarding, please reach out to the HR department at <a href="mailto:hr@deed.co.ke">hr@deed.co.ke</a>.</p>
          <br/>
          <p>Best regards,</p>
          <p><strong>HR Department</strong><br/>Deed Technologies Limited</p>
        `,
        text: `Welcome aboard, ${employee.fullName}!\n\nWe are excited to have you join our team as ${employee.jobTitle || 'a team member'}.\n\nYour employee number is: ${employee.employeeNo}\n\nIf you have any questions regarding your onboarding, please reach out to the HR department at hr@deed.co.ke.\n\nBest regards,\nHR Department\nDeed Technologies Limited`,
      }).catch(err => console.error('Failed to send welcome email:', err))
    }

    return NextResponse.json(employee, { status: 201 })
  })
}
