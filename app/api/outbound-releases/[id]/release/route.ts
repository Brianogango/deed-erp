import { NextRequest } from 'next/server'
import { releaseHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return releaseHandler(req, resolvedParams.id)
}
