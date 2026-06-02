import { NextRequest } from 'next/server'
import { verifyHandler } from '../route'
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return verifyHandler(req, params.id)
}
