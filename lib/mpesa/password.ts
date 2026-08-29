/** Daraja Lipa na M-Pesa Online password = Base64(Shortcode + Passkey + Timestamp). */
export function darajaTimestamp(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`
}

export function darajaStkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`, 'utf8').toString('base64')
}
