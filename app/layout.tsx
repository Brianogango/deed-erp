import './globals.css'
import { Analytics } from '@vercel/analytics/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F4F6FA] text-[#111827] antialiased overflow-hidden selection:bg-[#1B2762] selection:text-white">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
