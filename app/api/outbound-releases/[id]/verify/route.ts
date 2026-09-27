import { NextRequest } from 'next/server'
import { verifyHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return verifyHandler(req, resolvedParams.id)
}
