import { NextRequest } from 'next/server'
import { voidHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return voidHandler(req, resolvedParams.id)
}
