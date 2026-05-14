import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth/password';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    // We will force the password to be "admin123"
    const passwordHash = await hashPassword('admin123');
    
    // Find the first existing Director account
    const admin = await (prisma.user as any).findFirst({
      where: { role: 'director' }
    });

    if (admin) {
      // Update the existing admin's password and ensure the account is active
      await (prisma.user as any).update({
        where: { id: admin.id },
        data: { 
          passwordHash,
          isActive: true,
          mustResetPw: false
        }
      });
      
      return NextResponse.json({ 
        message: 'Live admin account was successfully reset!',
        username: admin.username,
        newPassword: 'admin123'
      });
    }

    return NextResponse.json({ 
      message: "No Director found. You may need to create one first." 
    }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}