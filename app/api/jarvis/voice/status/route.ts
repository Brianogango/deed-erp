import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { hasModuleAccess } from '@/lib/auth/access'

/**
 * GET /api/jarvis/voice/status
 * Reports which voice paths are available. V1 uses browser STT/TTS;
 * Gemini Live API is Phase 2 and must still route tools through runTool().
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!hasModuleAccess(session.user, 'jarvis')) {
      return NextResponse.json({ error: 'JARVIS is not enabled for your account' }, { status: 403 })
    }

    const geminiKey = Boolean(
      (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim(),
    )

    return NextResponse.json({
      browserSpeechRecognition: true,
      browserSpeechSynthesis: true,
      geminiLiveApi: false,
      geminiConfigured: geminiKey,
      note: 'V1 voice uses the browser microphone (speech-to-text) and optional spoken replies. Gemini Live API streaming will reuse the same RAG + ERP tool layer.',
    })
  })
}
