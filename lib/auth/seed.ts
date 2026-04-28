import 'server-only'

import type { AuthUserRecord } from './types'
import { PUBLIC_USERS } from './public-users'
import { hashPassword } from './password'

const PASSWORDS: Record<string, string> = {
  brian: 'Og@835408',
  admin: 'admin123',
  finance1: 'finance123',
  leadtech1: 'leadtech123',
  tech1: 'tech123',
  tech2: 'tech123',
  sales1: 'sales123',
}

export const buildSeedUsers = async () => {
  const seededUsers: AuthUserRecord[] = []

  for (const user of PUBLIC_USERS) {
    const password = PASSWORDS[user.username]

    if (!password) {
      throw new Error(`Missing seed password for '${user.username}'`)
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
