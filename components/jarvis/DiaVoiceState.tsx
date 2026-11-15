'use client'

import type { DiaVoiceState } from '@/lib/jarvis/use-dia-voice'

const LABEL: Record<DiaVoiceState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Working',
  speaking: 'Speaking',
}

/**
 * What DIA is doing, as three bars.
 *
 * Voice has nothing on screen to read: you cannot tell whether it heard you,
 * is working, or is talking, and without that you do not know when to speak.
 * The motion is the signal, the colour and the label carry it where motion is
 * turned off.
 */
export function DiaVoiceState({ state, className = '' }: { state: DiaVoiceState; className?: string }) {
  return (
    <span className={`dia-voice-state ${className}`.trim()} data-state={state} role="status" aria-label={`${LABEL[state]}`}>
      <span className="dia-voice-bars" aria-hidden="true"><span /><span /><span /></span>
      <span className="dia-voice-label">{LABEL[state]}</span>
    </span>
  )
}
