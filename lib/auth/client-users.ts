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
  const payload = (await response.json().catch(() => null)) as UserApiSuccess | { message?: string } | null

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
