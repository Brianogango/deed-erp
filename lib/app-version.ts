import 'server-only'
import { readFileSync } from 'fs'
import path from 'path'

let cached: string | null = null

/**
 * The build this server process is running. `.next/BUILD_ID` only changes on
 * deploy, and PM2 restarts the process then — caching it for the process
 * lifetime is correct. 'dev' when there is no build (next dev).
 */
export function getServerBuildId(): string {
  if (cached) return cached
  try {
    cached = readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || 'unknown'
  } catch {
    cached = process.env.NODE_ENV === 'development' ? 'dev' : 'unknown'
  }
  return cached
}
