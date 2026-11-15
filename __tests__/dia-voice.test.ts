import { describe, expect, it } from 'vitest'
import { micErrorMessage, preferredVoice, SPOKEN_REPLY_LIMIT } from '@/lib/jarvis/use-dia-voice'

const voice = (name: string, lang: string) =>
  ({ name, lang, voiceURI: `${name}:${lang}`, default: false, localService: true }) as SpeechSynthesisVoice

describe('microphone errors', () => {
  // A person reading "Microphone error: not-allowed" learns nothing and cannot
  // act on it; the fix is two clicks away once they know which two.
  it('says what to do about a blocked microphone', () => {
    expect(micErrorMessage('not-allowed')).toMatch(/blocked/i)
    expect(micErrorMessage('not-allowed')).toMatch(/allow it/i)
    expect(micErrorMessage('service-not-allowed')).toMatch(/blocked/i)
  })

  it('tells apart no microphone from no connection', () => {
    expect(micErrorMessage('audio-capture')).toMatch(/no microphone/i)
    expect(micErrorMessage('network')).toMatch(/connection/i)
  })

  it('stays quiet when nothing went wrong', () => {
    expect(micErrorMessage('aborted')).toBeNull()
    expect(micErrorMessage('no-speech')).toBeNull()
    expect(micErrorMessage(undefined)).toBeNull()
  })

  it('still says something for a code it has never seen', () => {
    expect(micErrorMessage('some-new-chrome-code')).toBeTruthy()
  })
})

describe('reply voice', () => {
  it('prefers Kenyan English, then British, then any English', () => {
    expect(preferredVoice([voice('A', 'fr-FR'), voice('B', 'en-US'), voice('C', 'en-KE')])?.name).toBe('C')
    expect(preferredVoice([voice('A', 'fr-FR'), voice('B', 'en-US'), voice('C', 'en-GB')])?.name).toBe('C')
    expect(preferredVoice([voice('A', 'fr-FR'), voice('B', 'en-US')])?.name).toBe('B')
  })

  it('reads en_KE the same as en-KE', () => {
    expect(preferredVoice([voice('A', 'en-US'), voice('B', 'en_KE')])?.name).toBe('B')
  })

  it('takes whatever there is rather than going silent', () => {
    expect(preferredVoice([voice('A', 'sw-KE')])?.name).toBe('A')
    expect(preferredVoice([])).toBeNull()
  })

  it('caps how much of a long reply is read aloud', () => {
    expect(SPOKEN_REPLY_LIMIT).toBe(600)
  })
})
