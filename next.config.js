// @ts-check
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/**
 * Application-level browser security policy.
 *
 * Next.js emits small inline bootstrap scripts/styles in production, so this
 * policy permits inline script/style while still denying foreign script
 * origins, plugins, framing and hostile base/form targets. Remove
 * 'unsafe-inline' only after migrating the app to per-request CSP nonces.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next.js webpack/Fast Refresh evaluates module factories in the browser.
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
  ...(process.env.NODE_ENV === 'production' ? ["upgrade-insecure-requests"] : []),
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
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
    // Visual-regression/manual QA runs serve plain http://localhost; the
    // production CSP (upgrade-insecure-requests, etc.) breaks hydration there.
    if (process.env.VISREG_BYPASS_AUTH === 'true') return []
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/deed-notifications-sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
}

module.exports = withBundleAnalyzer(nextConfig)
