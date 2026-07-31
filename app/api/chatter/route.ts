import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

const ALLOWED_MODELS = new Set([
  'sale_order',
  'purchase_order',
  'invoice',
  'repair',
  'opportunity',
])

const ACTIVITY_TYPES = new Set(['call', 'meeting', 'email', 'todo'])
const MESSAGE_TYPES = new Set(['comment', 'note', 'notification'])

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const model = String(searchParams.get('model') || '').trim()
    const recordId = String(searchParams.get('recordId') || '').trim()

    if (!model || !recordId) {
      return NextResponse.json({ error: 'model and recordId are required' }, { status: 400 })
    }
    if (!ALLOWED_MODELS.has(model)) {
      return NextResponse.json({ error: 'Unsupported model' }, { status: 400 })
    }

    const [messages, activities] = await Promise.all([
      prisma.documentMessage.findMany({
        where: { model, recordId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.documentActivity.findMany({
        where: { model, recordId },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    return NextResponse.json({ messages, activities })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

    const model = String(body.model || '').trim()
    const recordId = String(body.recordId || '').trim()
    if (!model || !recordId) {
      return NextResponse.json({ error: 'model and recordId are required' }, { status: 400 })
    }
    if (!ALLOWED_MODELS.has(model)) {
      return NextResponse.json({ error: 'Unsupported model' }, { status: 400 })
    }

    if (body.kind === 'activity' || body.activityType) {
      const activityType = String(body.activityType || '').trim()
      const summary = String(body.summary || '').trim()
      if (!ACTIVITY_TYPES.has(activityType)) {
        return NextResponse.json({ error: 'Invalid activityType' }, { status: 400 })
      }
      if (!summary) {
        return NextResponse.json({ error: 'summary is required' }, { status: 400 })
      }
      const activity = await prisma.documentActivity.create({
        data: {
          model,
          recordId,
          activityType,
          summary,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          userId: body.userId || session.user.id,
          status: String(body.status || 'planned'),
        },
      })
      return NextResponse.json({ activity }, { status: 201 })
    }

    const text = String(body.body ?? body.text ?? '').trim()
    if (!text) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 })
    }
    const messageType = String(body.messageType || 'comment')
    if (!MESSAGE_TYPES.has(messageType)) {
      return NextResponse.json({ error: 'Invalid messageType' }, { status: 400 })
    }

    const message = await prisma.documentMessage.create({
      data: {
        model,
        recordId,
        body: text,
        authorId: session.user.id,
        authorName: body.authorName || session.user.name || session.user.username || 'Staff',
        messageType,
      },
    })

    return NextResponse.json({ message }, { status: 201 })
  })
}
