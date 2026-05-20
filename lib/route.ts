import NextAuth, { AuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import prisma from "@/lib/prisma"
import bcrypt from "bcryptjs"

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null
        
        const user = await prisma.user.findUnique({ 
          where: { username: credentials.username } 
        })
        
        if (!user || !user.isActive) return null

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!isValid) return null

        return {
          id: user.id,
          name: user.username,
          username: user.username,
          role: user.role,
          mustChangePassword: false,
        } as any
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Attach custom user fields to the JWT token on initial sign in
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.username = (user as any).username
        token.mustChangePassword = (user as any).mustChangePassword
      }
      return token
    },
    async session({ session, token }) {
      // Expose the token fields to the client-side session
      if (token) session.user = token as any
      return session
    }
  },
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }