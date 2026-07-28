export type EmailProvider = 'sendgrid' | 'ses' | 'smtp'

const configured = (value: string | undefined) => {
  const text = value?.trim() ?? ''
  return Boolean(text && !/^REPLACE_WITH/i.test(text) && !/^your[-_]/i.test(text))
}

export function resolveEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase()
  return provider === 'sendgrid' || provider === 'ses' || provider === 'smtp'
    ? provider
    : 'smtp'
}

export function validateEmailConfig(): {
  ok: boolean
  provider: EmailProvider
  errors: string[]
} {
  const provider = resolveEmailProvider()
  const errors: string[] = []

  if (provider === 'smtp') {
    if (!configured(process.env.SMTP_HOST)) errors.push('SMTP_HOST is not configured')
    if (!configured(process.env.SMTP_USER)) errors.push('SMTP_USER is not configured')
    if (!configured(process.env.SMTP_PASS)) errors.push('SMTP_PASS is not configured')
  } else if (provider === 'sendgrid') {
    if (!configured(process.env.EMAIL_FROM)) errors.push('EMAIL_FROM is not configured')
    if (!configured(process.env.SENDGRID_API_KEY)) errors.push('SENDGRID_API_KEY is not configured')
  } else {
    if (!configured(process.env.EMAIL_FROM)) errors.push('EMAIL_FROM is not configured')
    if (!configured(process.env.AWS_SES_REGION)) errors.push('AWS_SES_REGION is not configured')
    if (!configured(process.env.AWS_SES_ACCESS_KEY_ID)) errors.push('AWS_SES_ACCESS_KEY_ID is not configured')
    if (!configured(process.env.AWS_SES_SECRET_ACCESS_KEY)) errors.push('AWS_SES_SECRET_ACCESS_KEY is not configured')
  }

  return { ok: errors.length === 0, provider, errors }
}
