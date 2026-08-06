/** Session lifetime policy (P0-DEED-001). Kept out of route.ts — Next.js
 * only allows HTTP method handlers as route exports. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60
export const SESSION_ABSOLUTE_MAX_SECONDS = 24 * 60 * 60
export const SESSION_REFRESH_THRESHOLD_SECONDS = 2 * 60 * 60
export const SESSION_WARN_BEFORE_SECONDS = 5 * 60
