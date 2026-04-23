import type { ModuleId, PublicUser } from './types'

interface LoginResponse {
  user: PublicUser
  defaultModule: ModuleId
  message?: string
}

export const requestLogin = async (username: string, password: string) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const payload = (await response.json().catch(() => null)) as LoginResponse | { message?: string } | null

  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

export const requestLogout = async () => {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  const payload = await response.json().catch(() => null)

  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}
