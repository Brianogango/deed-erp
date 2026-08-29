import { describe, expect, it, vi } from 'vitest'
import { sanitizeDraftPayload, purgeClientBusinessStorage } from '@/hooks/useFormDraft'
import { safeReturnTo } from '@/lib/auth/return-to'

describe('sanitizeDraftPayload', () => {
  it('strips password and token fields', () => {
    const clean = sanitizeDraftPayload({
      name: 'Ada',
      password: 'secret',
      apiKey: 'abc',
      clientLaptopPassword: 'device-pw',
      notes: 'ok',
    })
    expect(clean).toEqual({ name: 'Ada', notes: 'ok' })
    expect(clean).not.toHaveProperty('password')
    expect(clean).not.toHaveProperty('apiKey')
    expect(clean).not.toHaveProperty('clientLaptopPassword')
  })

  it('honors explicit exclude list', () => {
    const clean = sanitizeDraftPayload({ a: 1, b: 2 }, ['b'])
    expect(clean).toEqual({ a: 1 })
  })
})

describe('safeReturnTo', () => {
  it('allows same-origin relative paths', () => {
    expect(safeReturnTo('/purchases')).toBe('/purchases')
    expect(safeReturnTo('/repair?tab=1')).toBe('/repair?tab=1')
  })

  it('rejects open redirects', () => {
    expect(safeReturnTo('https://evil.example')).toBeNull()
    expect(safeReturnTo('//evil.example')).toBeNull()
    expect(safeReturnTo('/login')).toBeNull()
    expect(safeReturnTo(null)).toBeNull()
  })
})

describe('purgeClientBusinessStorage', () => {
  it('removes deed_ and draft_ keys only', () => {
    const store = new Map<string, string>()
    const ls = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
      clear: () => store.clear(),
    }
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('window', { localStorage: ls })
    localStorage.setItem('deed_products', '[]')
    localStorage.setItem('draft_u1_repair', '{}')
    localStorage.setItem('deed_posSessionOpen', 'true')
    localStorage.setItem('deed_posSessionId', '"sess-1"')
    localStorage.setItem('deed_posSessions', '[]')
    localStorage.setItem('deed_posSessionOpeningCash', '5000')
    localStorage.setItem('other_key', 'keep')
    purgeClientBusinessStorage()
    expect(localStorage.getItem('deed_products')).toBeNull()
    expect(localStorage.getItem('draft_u1_repair')).toBeNull()
    expect(localStorage.getItem('other_key')).toBe('keep')
    // POS till session survives logout — it closes only via Close Session.
    expect(localStorage.getItem('deed_posSessionOpen')).toBe('true')
    expect(localStorage.getItem('deed_posSessionId')).toBe('"sess-1"')
    expect(localStorage.getItem('deed_posSessions')).toBe('[]')
    expect(localStorage.getItem('deed_posSessionOpeningCash')).toBe('5000')
    vi.unstubAllGlobals()
  })
})
