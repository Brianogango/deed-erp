import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { sendEmail } from '@/lib/integrations/email'
import { createAuthUser, findAuthUserByUsername } from '@/lib/auth/users-repository'
import { hashPassword } from '@/lib/auth/password'
import { ROLE_DEFAULT_MODULES, UserRole } from '@/lib/auth/types'

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

    // If employee is active and has an email, automatically create a system user
    if (employee.isActive && employee.email) {
      try {
        const baseUsername = employee.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '.')
        let username = baseUsername
        let counter = 1
        
        // Ensure username uniqueness
        while (await findAuthUserByUsername(username)) {
          username = `${baseUsername}${counter++}`
        }

        const tempPassword = `${employee.employeeNumber || 'Deed'}@${Math.random().toString(36).slice(-6)}`
        const passwordHash = await hashPassword(tempPassword)
          // Default role based on department or sales_rep
        const role = employee.departmentId === 'finance' ? 'finance' : 
                     employee.departmentId === 'technical' ? 'repair_tech' : 'sales_rep'      
        const user = await createAuthUser({
          username,
          name: `${employee.firstName} ${employee.lastName}`,
          role: role as UserRole,
          modules: ROLE_DEFAULT_MODULES[role as UserRole] || ['dashboard', 'expenses', 'leave', 'my_documents'],
          active: true,
          password: tempPassword,
          mustChangePassword: true
        }, passwordHash)

        // Link user to employee
        await prisma.employee.update({
          where: { id: employee.id },
          data: { userId: user.id }
        })

        // Send welcome email with credentials from HR
        await sendEmail({
          to: employee.email,
          from: process.env.HR_EMAIL || 'hr@deed.co.ke',
          subject: `Welcome to Deed Technologies — Your System Credentials`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h1 style="color: #1B2762;">Welcome aboard, ${employee.firstName} ${employee.lastName}!</h1>
              <p>We are excited to have you join our team as <strong>${employee.jobTitle || 'a team member'}</strong>.</p>
              <p>A system account has been created for you. Please use the following credentials to log in to the ERP:</p>
              
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>URL:</strong> <a href="https://erp.deed.co.ke">https://erp.deed.co.ke</a></p>
                <p style="margin: 5px 0;"><strong>Username:</strong> <code>${username}</code></p>
                <p style="margin: 5px 0;"><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
              </div>

              <p style="color: #e11d48; font-weight: bold;">Note: You will be required to change this password upon your first login.</p>
              
              <p>Your employee number is: <strong>${employee.employeeNumber}</strong></p>strong></p>        <p>If you have any questions regarding your onboarding or system access, please reach out to the HR department at <a href="mailto:hr@deed.co.ke">hr@deed.co.ke</a>.</p>
              
              <br/>
              <p>Best regards,</p>
              <p><strong>HR Department</strong><br/>Deed Technologies Limited</p>
            </div>
          `,
          text: `Welcome aboard, ${employee.firstName} ${employee.lastName}!\n\nYour system account has been created.\n\nURL: https://erp.deed.co.ke\nUsername: ${username}\nTemporary Password: ${tempPassword}\n\nNote: You will be required to change this password upon your first login.\n\nYour employee number is: ${employee.employeeNumber}\n\nIf you have any questions, please reach out to the HR department at hr@deed.co.ke.\n\nBest regards,\nHR Department\nDeed Technologies Limited`,
        })
      } catch (err) {
        console.error('Failed to create system user or send welcome email:', err)
      }
    }

    return NextResponse.json(employee, { status: 201 })
  })
}
