import 'server-only'

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { UserRole, ModuleId } from './types'

const SESSION_COOKIE_NAME = 'deed-session'
const USE_SECURE_COOKIES =
  process.env.NEXTAUTH_URL?.startsWith('https://') ||
  process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ||
  false

// Auth flow is handled by /api/auth/login which uses next-auth/jwt encode() directly.
// This config exists so getServerSession() and getToken() can read back those tokens.
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize() {
        // Handled by /api/auth/login — never called through NextAuth's own flow.
        return null
      },
    }),
  ],
  session: { strategy: 'jwt' },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: USE_SECURE_COOKIES,
      },
    },
  },
  callbacks: {
    async jwt({ token }) {
      return token
    },
    async session({ session, token }) {
      session.user.id        = token.id        as string
      session.user.username  = token.username  as string
      session.user.role      = token.role      as UserRole
      session.user.modules   = Array.isArray(token.modules) ? token.modules as ModuleId[] : []
      session.user.active    = token.active    as boolean
      session.user.createdAt = token.createdAt as string
      session.user.actsAsTechnician = Boolean(token.actsAsTechnician)
      session.user.sessionVersion = Math.max(1, Number(token.sessionVersion ?? 1) || 1)
      return session
    },
  },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
}
