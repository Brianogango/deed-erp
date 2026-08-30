import { describe, expect, it } from 'vitest'

import { isAllowedSnsHttpsUrl } from '@/lib/notifications/sns-url'

describe('SNS webhook SSRF guard', () => {
  it('allows only HTTPS AWS SNS service hosts', () => {
    expect(isAllowedSnsHttpsUrl('https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem')).toBe(true)
    expect(isAllowedSnsHttpsUrl('https://sns.eu-west-1.amazonaws.com/')).toBe(true)
    expect(isAllowedSnsHttpsUrl('https://sns.cn-north-1.amazonaws.com.cn/')).toBe(true)
  })

  it('rejects suffix tricks, credentials, custom ports, and private hosts', () => {
    expect(isAllowedSnsHttpsUrl('https://evilamazonaws.com/')).toBe(false)
    expect(isAllowedSnsHttpsUrl('https://sns.amazonaws.com.evil.example/')).toBe(false)
    expect(isAllowedSnsHttpsUrl('https://user:pass@sns.us-east-1.amazonaws.com/')).toBe(false)
    expect(isAllowedSnsHttpsUrl('https://sns.us-east-1.amazonaws.com:8443/')).toBe(false)
    expect(isAllowedSnsHttpsUrl('http://sns.us-east-1.amazonaws.com/')).toBe(false)
    expect(isAllowedSnsHttpsUrl('https://127.0.0.1/')).toBe(false)
    expect(isAllowedSnsHttpsUrl('https://169.254.169.254/latest/meta-data/')).toBe(false)
  })
})
