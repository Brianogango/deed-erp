import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { parseBankStatement } from '@/lib/accounting/bank-statement-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/bank-statements/import
 * JSON: { bankAccountId, text, format?: 'auto'|'csv'|'ofx', fileName? }
 * or multipart: file + bankAccountId
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const contentType = request.headers.get('content-type') || ''

    let bankAccountId = ''
    let text = ''
    let format: 'auto' | 'csv' | 'ofx' = 'auto'
    let fileName: string | null = null

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      bankAccountId = String(form.get('bankAccountId') || '')
      format = (String(form.get('format') || 'auto') as 'auto' | 'csv' | 'ofx')
      const file = form.get('file')
      if (file && typeof file === 'object' && 'text' in file) {
        fileName = (file as File).name || null
        text = await (file as File).text()
      }
    } else {
      const body = await request.json().catch(() => ({}))
      bankAccountId = String(body.bankAccountId || '')
      text = String(body.text || '')
      format = (body.format || 'auto') as 'auto' | 'csv' | 'ofx'
      fileName = body.fileName ? String(body.fileName) : null
    }

    if (!bankAccountId) {
      return NextResponse.json({ error: 'bankAccountId is required' }, { status: 400 })
    }
    if (!text.trim()) {
      return NextResponse.json({ error: 'statement text/file is required' }, { status: 400 })
    }

    const parsed = parseBankStatement(text, bankAccountId, format)
    if (parsed.lines.length === 0) {
      return NextResponse.json({ error: 'No statement lines parsed', format: parsed.format }, { status: 400 })
    }

    const fingerprints = parsed.lines.map(l => l.fingerprint)
    const existing = await prisma.bankStatementLine.findMany({
      where: { fingerprint: { in: fingerprints } },
      select: { fingerprint: true },
    })
    const existingSet = new Set(existing.map(e => e.fingerprint))
    const fresh = parsed.lines.filter(l => !existingSet.has(l.fingerprint))

    const imp = await prisma.bankStatementImport.create({
      data: {
        bankAccountId,
        sourceFormat: parsed.format,
        fileName,
        importedById: actor.id,
        lineCount: fresh.length,
        lines: {
          create: fresh.map(l => ({
            bankAccountId,
            lineDate: new Date(`${l.date}T00:00:00Z`),
            amount: l.amount,
            payee: l.payee || null,
            memo: l.memo || null,
            fingerprint: l.fingerprint,
            fitId: l.fitId || null,
            status: 'imported',
          })),
        },
      },
      include: { lines: true },
    })

    return NextResponse.json({
      ok: true,
      format: parsed.format,
      imported: fresh.length,
      skippedDuplicates: parsed.lines.length - fresh.length,
      importId: imp.id,
      lines: imp.lines.map(l => ({
        id: l.id,
        date: l.lineDate.toISOString().slice(0, 10),
        amount: Number(l.amount),
        payee: l.payee,
        memo: l.memo,
        fingerprint: l.fingerprint,
        status: l.status,
      })),
    }, { status: 201 })
  })
}
