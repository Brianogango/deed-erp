import { NextRequest } from 'next/server'
import { voidHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return voidHandler(req, params.id)
}
