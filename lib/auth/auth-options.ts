import 'server-only'

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

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
  callbacks: {
    async jwt({ token }) {
      return token
    },
    async session({ session, token }) {
      session.user.id       = token.id       as string
      session.user.username = token.username  as string
      session.user.role     = token.role      as string
      session.user.modules  = token.modules   as string[]
      session.user.active   = token.active    as boolean
      session.user.createdAt = token.createdAt as string
      return session
    },
  },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'deed-erp-demo-secret-2026',
}
