import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Deed ERP',
  description: 'Deed Digital Solutions — Enterprise Resource Planning',
  icons: {
    icon: [
      { url: '/deed-logo.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F4F6FA] text-[#111827] antialiased overflow-hidden selection:bg-[#1B2762] selection:text-white">
        {children}
      </body>
    </html>
  )
}
