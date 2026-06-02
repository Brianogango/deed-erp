import { NextRequest } from 'next/server'
import { releaseHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return releaseHandler(req, params.id)
}
