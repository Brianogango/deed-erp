export function isAllowedSnsHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    if (url.port && url.port !== '443') return false
    const host = url.hostname.toLowerCase()
    return host === 'sns.amazonaws.com'
      || /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(host)
  } catch {
    return false
  }
}
