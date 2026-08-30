// @ts-check
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ')

/** Application-level security headers (audit SEC-004 / AGENT-SEC-003). */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deploys build into a staging dir (NEXT_DIST_DIR=.next-staging) and swap it
  // in atomically, so the live server never serves from a half-written .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: [
      '@fortawesome/free-solid-svg-icons',
      '@fortawesome/free-regular-svg-icons',
      '@fortawesome/react-fontawesome',
      'xlsx',
    ],
  },
  images: {
    // Explicit allow-list — never hostname '**' (audit SEC-011).
    remotePatterns: [
      { protocol: 'https', hostname: 'erp.deed.co.ke' },
      { protocol: 'https', hostname: 'deed.co.ke' },
      { protocol: 'https', hostname: 'www.deed.co.ke' },
      { protocol: 'https', hostname: 'deed.africa' },
      { protocol: 'https', hostname: 'www.deed.africa' },
      // Kilimall product imagery used in marketplace views
      { protocol: 'https', hostname: 'img.kilimall.com' },
      { protocol: 'https', hostname: 'image.kilimall.com' },
      { protocol: 'https', hostname: 'static.kilimall.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

module.exports = withBundleAnalyzer(nextConfig)
// Exported for unit tests (CommonJS consumers can require and read .default or the analyzer wrap).
module.exports.SECURITY_HEADERS = SECURITY_HEADERS
module.exports.CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY
