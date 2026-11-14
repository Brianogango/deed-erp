type LinkedDocumentCta = 'create' | 'view' | 'confirm' | 'none'

export function nextActionLabel(opts: {
  document: string
  cta: LinkedDocumentCta
}): string | null {
  if (opts.cta === 'create') return `Create ${opts.document}`
  if (opts.cta === 'view') return `View ${opts.document}`
  if (opts.cta === 'confirm') return `Confirm ${opts.document}`
  return null
}

