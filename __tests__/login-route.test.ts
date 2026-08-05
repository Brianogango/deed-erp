import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks must be declared before importing the route ────────────────────────

vi.mock('@/lib/rate-limit', () => ({
  loginRatelimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
}))

vi.mock('@/lib/auth/users-repository', () => ({
  findAuthUserByUsername: vi.fn(),
  toPublicAuthUser: vi.fn((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, modules: [], active: true, createdAt: u.createdAt })),
  recordFailedLogin: vi.fn().mockResolvedValue(undefined),
  clearFailedLogin: vi.fn().mockResolvedValue(undefined),
  updateAuthUser: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue('$2b$12$upgraded'),
}))

vi.mock('@/lib/auth/access', () => ({
  getFirstAllowedModule: vi.fn().mockReturnValue('dashboard'),
}))

vi.mock('next-auth/jwt', () => ({
  encode: vi.fn().mockResolvedValue('mock-jwt-token'),
}))

import { POST } from '@/app/api/auth/login/route'
import { findAuthUserByUsername, recordFailedLogin, clearFailedLogin, updateAuthUser } from '@/lib/auth/users-repository'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { loginRatelimit } from '@/lib/rate-limit'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const fakeUser = {
  id: 'u1',
  name: 'Admin',
  username: 'admin',
  role: 'director',
  passwordHash: '$2b$12$hashedpassword',
  active: true,
  lockedUntil: null,
  createdAt: '2024-01-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long!!'
  vi.mocked(loginRatelimit.limit).mockResolvedValue({ success: true } as any)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  describe('input validation', () => {
    it('returns 400 for malformed JSON body', async () => {
      const req = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 400 when username is missing', async () => {
      const res = await POST(makeRequest({ password: 'secret' }))
      expect(res.status).toBe(400)
    })

    it('returns 400 when password is missing', async () => {
      const res = await POST(makeRequest({ username: 'admin' }))
      expect(res.status).toBe(400)
    })
  })

  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      vi.mocked(loginRatelimit.limit).mockResolvedValue({ success: false } as any)
      const res = await POST(makeRequest({ username: 'admin', password: 'secret' }))
      expect(res.status).toBe(429)
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not found', async () => {
      vi.mocked(findAuthUserByUsername).mockResolvedValue(null)
      const res = await POST(makeRequest({ username: 'unknown', password: 'secret' }))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.message).toBe('Invalid credentials')
    })

    it('returns 401 when user is inactive', async () => {
      vi.mocked(findAuthUserByUsername).mockResolvedValue({ ...fakeUser, active: false } as any)
      const res = await POST(makeRequest({ username: 'admin', password: 'secret' }))
      expect(res.status).toBe(401)
    })

    it('returns 403 when account is locked', async () => {
      const lockedUntil = new Date(Date.now() + 60_000).toISOString()
      vi.mocked(findAuthUserByUsername).mockResolvedValue({ ...fakeUser, lockedUntil } as any)
      const res = await POST(makeRequest({ username: 'admin', password: 'secret' }))
      expect(res.status).toBe(403)
    })

    it('returns 401 and records failed attempt on wrong password', async () => {
      vi.mocked(findAuthUserByUsername).mockResolvedValue(fakeUser as any)
      vi.mocked(verifyPassword).mockResolvedValue({ verified: false, needsRehash: false })
      const res = await POST(makeRequest({ username: 'admin', password: 'wrong' }))
      expect(res.status).toBe(401)
      expect(recordFailedLogin).toHaveBeenCalledWith(fakeUser.id)
    })

    it('returns 200 and sets session cookie on valid credentials', async () => {
      vi.mocked(findAuthUserByUsername).mockResolvedValue(fakeUser as any)
      vi.mocked(verifyPassword).mockResolvedValue({ verified: true, needsRehash: false })
      const res = await POST(makeRequest({ username: 'admin', password: 'correct' }))
      expect(res.status).toBe(200)
      expect(clearFailedLogin).toHaveBeenCalledWith(fakeUser.id)
      const body = await res.json()
      expect(body.message).toBe('Login successful')
      expect(body.user).toBeDefined()
      expect(updateAuthUser).not.toHaveBeenCalled()
    })

    it('upgrades a legacy SHA-256 hash to bcrypt on successful login', async () => {
      vi.mocked(findAuthUserByUsername).mockResolvedValue({
        ...fakeUser,
        passwordHash: 'a'.repeat(64),
      } as any)
      vi.mocked(verifyPassword).mockResolvedValue({ verified: true, needsRehash: true })
      vi.mocked(hashPassword).mockResolvedValue('$2b$12$upgraded-hash')
      const res = await POST(makeRequest({ username: 'admin', password: 'correctpwd' }))
      expect(res.status).toBe(200)
      expect(hashPassword).toHaveBeenCalledWith('correctpwd')
      expect(updateAuthUser).toHaveBeenCalledWith(fakeUser.id, {}, '$2b$12$upgraded-hash')
    })

    it('sets HttpOnly cookie on successful login', async () => {
      vi.mocked(findAuthUserByUsername).mockResolvedValue(fakeUser as any)
      vi.mocked(verifyPassword).mockResolvedValue({ verified: true, needsRehash: false })
      const res = await POST(makeRequest({ username: 'admin', password: 'correct' }))
      const cookie = res.headers.get('set-cookie') ?? ''
      expect(cookie).toContain('deed-session')
      expect(cookie).toContain('HttpOnly')
    })
  })
})
