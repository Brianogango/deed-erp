import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth/password';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    // We will force the password to be "admin123"
    const passwordHash = await hashPassword('admin123');
    
    // Find the first existing super admin account
    const admin = await prisma.authUser.findFirst({
      where: { role: 'admin' }
    });

    if (admin) {
      // Update the existing admin's password and ensure the account is active
      await prisma.authUser.update({
        where: { id: admin.id },
        data: { 
          passwordHash, 
          active: true,
          mustChangePassword: false 
        }
      });
      
      return NextResponse.json({ 
        message: 'Live admin account was successfully reset!',
        username: admin.username,
        newPassword: 'admin123'
      });
    }

    return NextResponse.json({ 
      message: "No admin found. You may need to create one first." 
    }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}