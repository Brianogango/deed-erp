import 'server-only'

import type { AuthUserRecord } from './types'
import { PUBLIC_USERS } from './public-users'
import { hashPassword } from './password'

function seedPasswordFor(username: string) {
  const key = `SEED_PASSWORD_${username.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  return process.env[key] ?? process.env.SEED_DEFAULT_PASSWORD
}

export const buildSeedUsers = async () => {
  const seededUsers: AuthUserRecord[] = []

  for (const user of PUBLIC_USERS) {
    const password = seedPasswordFor(user.username)

    if (!password) {
      throw new Error(`Missing seed password for '${user.username}'. Set SEED_PASSWORD_${user.username.toUpperCase()} or SEED_DEFAULT_PASSWORD.`)
    }

    seededUsers.push({
      ...user,
      passwordHash: await hashPassword(password),
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
  }

  return seededUsers
}
