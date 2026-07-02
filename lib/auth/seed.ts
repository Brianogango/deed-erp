import 'server-only'
import { randomBytes } from 'crypto'

import type { AuthUserRecord } from './types'
import { PUBLIC_USERS } from './public-users'
import { hashPassword } from './password'

// Generates a random, unguessable initial password. Never hardcode real
// credentials here — this file is committed to source control and readable
// by anyone with repo access.
const generateTempPassword = (): string => randomBytes(18).toString('base64url')

export const buildSeedUsers = async () => {
  const seededUsers: (AuthUserRecord & { mustChangePassword: true })[] = []
  const credentials: { username: string; password: string }[] = []

  for (const user of PUBLIC_USERS) {
    const password = generateTempPassword()
    credentials.push({ username: user.username, password })

    seededUsers.push({
      ...user,
      passwordHash: await hashPassword(password),
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: true,
    })
  }

  // Surfaced once, to the server console only, so whoever provisioned the
  // deployment can hand out first-login credentials. Never returned over
  // HTTP and never persisted in plaintext.
  console.warn(
    '[auth/seed] Generated temporary passwords for initial users (each must change password at first login):\n' +
      credentials.map(c => `  ${c.username}: ${c.password}`).join('\n')
  )

  return seededUsers
}
