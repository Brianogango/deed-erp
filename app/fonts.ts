import localFont from 'next/font/local'

// Self-hosted (latin subsets committed to the repo) so builds never depend on
// Google Fonts being reachable. Exposed as CSS variables consumed by the
// Tailwind font stacks.

// Roboto Flex — brand primary typeface (Deed Technologies brand guidelines)
export const robotoFlex = localFont({
  src: './fonts/roboto-flex-latin.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-roboto-flex',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
})

// Open Sans — brand secondary typeface (body text, UI labels)
export const openSans = localFont({
  src: [
    { path: './fonts/open-sans-400-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/open-sans-600-latin.woff2', weight: '600', style: 'normal' },
    { path: './fonts/open-sans-700-latin.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-open-sans',
  fallback: ['Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
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
