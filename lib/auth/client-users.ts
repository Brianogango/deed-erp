import type { CreateUserInput, PublicUser, UpdateUserInput } from './types'

type UserApiSuccess = {
  user?: PublicUser
  users?: PublicUser[]
  message?: string
}

type UserApiResult = {
  ok: boolean
  status: number
  payload: UserApiSuccess | { message?: string } | null
}

const parseResponse = async (response: Response): Promise<UserApiResult> => {
  const raw = (await response.json().catch(() => null)) as (UserApiSuccess & { error?: string }) | null
  // The API reports failures as { error }. Callers read { message }, so the
  // reason ("last active Director", "Username already exists") was being lost
  // behind a generic "Unable to update user".
  const payload = raw && !raw.message && typeof raw.error === 'string' ? { ...raw, message: raw.error } : raw

  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

export const requestCreateUser = async (input: CreateUserInput) => {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  return parseResponse(response)
}

export const requestUpdateUser = async (id: string, input: UpdateUserInput) => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  return parseResponse(response)
}

export const requestDeleteUser = async (id: string) => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })

  return parseResponse(response)
}

export const requestDeactivateUser = async (id: string) => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'deactivate' }),
  })
  return parseResponse(response)
}

export const requestReactivateUser = async (id: string) => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reactivate' }),
  })
  return parseResponse(response)
}
