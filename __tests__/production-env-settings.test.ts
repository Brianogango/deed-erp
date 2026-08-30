import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyEnvUpdates,
  generateSecretValue,
  looksLikePlaceholder,
  parseEnvFile,
  summarizeEnv,
  upsertEnvValues,
} from '@/lib/security/production-env'

const tempFiles: string[] = []

afterEach(() => {
  delete process.env.DEED_ENV_FILE
  for (const file of tempFiles.splice(0)) {
    try { fs.unlinkSync(file) } catch { /* already gone */ }
  }
})

function writeFixture(contents: string) {
  const file = path.join(os.tmpdir(), `deed-env-test-${Date.now()}-${Math.random().toString(16).slice(2)}.env`)
  fs.writeFileSync(file, contents, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  tempFiles.push(file)
  process.env.DEED_ENV_FILE = file
  return file
}

describe('production env catalog', () => {
  it('never includes secret values in summaries', () => {
    const rows = summarizeEnv({
      NEXTAUTH_SECRET: 'super-secret-value-do-not-leak',
      SMTP_HOST: 'mail.deed.co.ke',
      MFA_ENFORCE_PRIVILEGED: 'true',
      CUSTOM_PROVIDER_TOKEN: 'tok_live_should_stay_hidden',
    })
    const dumped = JSON.stringify(rows)
    expect(dumped).not.toContain('super-secret-value-do-not-leak')
    expect(dumped).not.toContain('tok_live_should_stay_hidden')
    expect(rows.find(row => row.key === 'NEXTAUTH_SECRET')?.present).toBe(true)
    expect(rows.find(row => row.key === 'NEXTAUTH_SECRET')?.length).toBe('super-secret-value-do-not-leak'.length)
    expect(rows.find(row => row.key === 'SMTP_HOST')?.value).toBe('mail.deed.co.ke')
    expect(rows.find(row => row.key === 'CUSTOM_PROVIDER_TOKEN')?.category).toBe('Custom')
    expect(rows.find(row => row.key === 'CUSTOM_PROVIDER_TOKEN')?.kind).toBe('secret')
  })

  it('flags placeholder secrets without echoing them', () => {
    const rows = summarizeEnv({ NEXTAUTH_SECRET: 'REPLACE_WITH_openssl_rand_output' })
    const nextAuth = rows.find(row => row.key === 'NEXTAUTH_SECRET')
    expect(nextAuth?.placeholder).toBe(true)
    expect(nextAuth?.value).toBeUndefined()
  })

  it('upserts new keys and keeps surrounding comments', () => {
    const source = '# keep me\nSMTP_HOST=mail.deed.co.ke\n'
    const next = upsertEnvValues(source, { SMTP_HOST: 'smtp.deed.co.ke', CRON_SECRET: 'abc' })
    expect(next).toContain('# keep me')
    expect(next).toMatch(/^SMTP_HOST=smtp\.deed\.co\.ke$/m)
    expect(next).toMatch(/^CRON_SECRET=abc$/m)
    expect(parseEnvFile(next).SMTP_HOST).toBe('smtp.deed.co.ke')
  })

  it('generates secrets that pass the production placeholder gate', () => {
    for (let i = 0; i < 10; i += 1) {
      const value = generateSecretValue()
      expect(value.length).toBeGreaterThanOrEqual(48)
      expect(looksLikePlaceholder(value)).toBe(false)
    }
  })

  it('writes generated privileged secrets to the env file without returning them', () => {
    writeFixture('NEXTAUTH_SECRET=REPLACE_WITH_openssl_rand_output\nAUTH_SECRET=REPLACE_WITH_openssl_rand_output\n')
    const result = applyEnvUpdates({ generate: ['NEXTAUTH_SECRET'] })
    expect(result.changed).toEqual(expect.arrayContaining(['NEXTAUTH_SECRET', 'AUTH_SECRET', 'SECURITY_SECRETS_ROTATED_AT']))
    const saved = parseEnvFile(fs.readFileSync(process.env.DEED_ENV_FILE!, 'utf8'))
    expect(saved.NEXTAUTH_SECRET).toBe(saved.AUTH_SECRET)
    expect(looksLikePlaceholder(saved.NEXTAUTH_SECRET)).toBe(false)
    expect(JSON.stringify(summarizeEnv(result.nextValues))).not.toContain(saved.NEXTAUTH_SECRET)
  })

  it('adds a custom key that was not in the catalog', () => {
    writeFixture('NODE_ENV=production\n')
    const result = applyEnvUpdates({ add: { key: 'ACME_WEBHOOK_TOKEN', value: 'from-settings' } })
    expect(result.changed).toContain('ACME_WEBHOOK_TOKEN')
    const saved = parseEnvFile(fs.readFileSync(process.env.DEED_ENV_FILE!, 'utf8'))
    expect(saved.ACME_WEBHOOK_TOKEN).toBe('from-settings')
    expect(summarizeEnv(saved).find(row => row.key === 'ACME_WEBHOOK_TOKEN')?.value).toBeUndefined()
  })
})
