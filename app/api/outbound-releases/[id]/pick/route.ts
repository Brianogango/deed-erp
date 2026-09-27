import { NextRequest } from 'next/server'
import { pickHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return pickHandler(req, resolvedParams.id)
}
