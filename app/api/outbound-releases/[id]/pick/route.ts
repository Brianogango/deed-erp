import { NextRequest } from 'next/server'
import { pickHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return pickHandler(req, params.id)
}
