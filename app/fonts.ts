import localFont from 'next/font/local'

// Self-hosted (latin subsets committed to the repo) so builds never depend on
// Google Fonts being reachable. Exposed as CSS variables consumed by the
// Tailwind `sans` / `mono` font stacks.
export const inter = localFont({
  src: './fonts/inter-var-latin.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
})

export const dmMono = localFont({
  src: [
    { path: './fonts/dm-mono-400-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/dm-mono-500-latin.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-dm-mono',
  fallback: ['Cascadia Code', 'ui-monospace', 'monospace'],
})
