import { describe, it, expect } from 'vitest'
import { describeDevice, deviceLabel } from '../scripts/lib/user-agent.mjs'

describe('describeDevice', () => {
  it('reads a Windows laptop as the OS, because the browser never says the make', () => {
    const d = describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')
    expect(d).toMatchObject({ os: 'Windows', device: 'Windows PC', browser: 'Chrome 141' })
    expect(d.label).toBe('Windows PC · Chrome 141')
  })

  it('names Edge rather than the Chrome and Safari it also claims', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0').browser).toBe('Edge 141')
  })

  it('gives the phone model on Android, which is the one case hardware is knowable', () => {
    const d = describeDevice('Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36')
    expect(d.device).toBe('SM-A546B')
    expect(d.os).toBe('Android 14')
    expect(d.label).toBe('SM-A546B · Chrome 140')
  })

  it('falls back to a phone or tablet when Android sends no model', () => {
    expect(describeDevice('Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36').device).toBe('Android phone')
    expect(describeDevice('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36').device).toBe('Android tablet')
  })

  it('reads a Mac and an iPhone', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'))
      .toMatchObject({ device: 'Mac', browser: 'Safari 18' })
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1').device).toBe('iPhone')
  })

  it('says so plainly when there is no user agent at all', () => {
    expect(deviceLabel(null)).toBe('Unknown device')
    expect(deviceLabel('')).toBe('Unknown device')
  })
})
