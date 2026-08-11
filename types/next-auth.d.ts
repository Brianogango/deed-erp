import type { DefaultSession } from 'next-auth'
import type { UserRole, ModuleId } from '@/lib/auth/types'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      username: string
      role: UserRole
      modules: ModuleId[]
      active: boolean
      createdAt: string
      actsAsTechnician?: boolean
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    username: string
    role: UserRole
    modules: ModuleId[]
    active: boolean
    createdAt: string
    actsAsTechnician?: boolean
  }
}
