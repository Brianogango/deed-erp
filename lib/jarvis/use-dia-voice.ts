'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * DIA's voice: the browser's microphone for listening and its speech synthesis
 * for replying.
 *
 * What the panel needs and the browser does not give you:
 *  - one state to render from, because with voice there is nothing on screen to
 *    tell you whether it heard you, is working, or is talking;
 *  - barge-in: reaching for the microphone stops DIA mid-sentence, so you are
 *    never talking over it and it is never hearing itself;
 *  - the words heard so far kept apart from whatever is typed in the box;
 *  - mic failures said in words, not error codes.
 */

export type DiaVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/** Browser error codes, said the way a person would say them. */
export function micErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it for this site in your browser, then try again.'
    case 'audio-capture':
      return 'No microphone was found. Plug one in or check your system sound settings.'
    case 'network':
      return 'Speech recognition needs a connection, and this one dropped.'
    case 'language-not-supported':
      return 'This browser cannot recognise the chosen language.'
    // The user stopped, or simply said nothing: not worth a message.
    case 'aborted':
    case 'no-speech':
    case undefined:
      return null
    default:
      return 'The microphone stopped unexpectedly. Try again, or type your question.'
  }
}

/** English voices first, Kenya ahead of the rest, so the reply sounds local. */
export function preferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const rank = (v: SpeechSynthesisVoice) => {
    const lang = (v.lang || '').toLowerCase().replace('_', '-')
    if (lang === 'en-ke') return 0
    if (lang === 'en-gb') return 1
    if (lang.startsWith('en')) return 2
    return 3
  }
  return [...voices].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export const SPOKEN_REPLY_LIMIT = 600

export function useDiaVoice(opts: {
  /** A finished sentence from the microphone, ready to send. */
  onTranscript: (text: string) => void
  /** The panel is waiting on a reply. */
  thinking: boolean
  lang?: string
}) {
  const { onTranscript, thinking, lang = 'en-KE' } = opts

  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [interim, setInterim] = useState('')
  const [speakReplies, setSpeakReplies] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceURI, setVoiceURI] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speakRepliesRef = useRef(speakReplies)
  const voiceURIRef = useRef(voiceURI)
  const onTranscriptRef = useRef(onTranscript)
  speakRepliesRef.current = speakReplies
  voiceURIRef.current = voiceURI
  onTranscriptRef.current = onTranscript

  useEffect(() => { setSupported(Boolean(recognitionCtor())) }, [])

  // The voice list arrives asynchronously in most browsers, and empty on first ask.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const read = () => {
      const list = window.speechSynthesis.getVoices()
      if (!list.length) return
      setVoices(list)
      setVoiceURI(prev => prev ?? preferredVoice(list)?.voiceURI ?? null)
    }
    read()
    window.speechSynthesis.addEventListener('voiceschanged', read)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', read)
  }, [])

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    try { window.speechSynthesis.cancel() } catch { /* already quiet */ }
    setSpeaking(false)
  }, [])

  const speak = useCallback((text: string) => {
    if (!speakRepliesRef.current || typeof window === 'undefined' || !window.speechSynthesis) return
    const said = text.trim().slice(0, SPOKEN_REPLY_LIMIT)
    if (!said) return
    try {
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(said)
      const chosen = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceURIRef.current)
      if (chosen) { utter.voice = chosen; utter.lang = chosen.lang }
      utter.rate = 1
      utter.onstart = () => setSpeaking(true)
      utter.onend = () => setSpeaking(false)
      utter.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(utter)
    } catch {
      setSpeaking(false)
    }
  }, [])

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    setListening(false)
    setInterim('')
  }, [])

  const startListening = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      setError('This browser cannot listen. Use Chrome or Edge, or type your question.')
      return
    }
    // Barge-in: never listen while DIA is talking, or it hears itself.
    stopSpeaking()

    const recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = lang
    recognition.onresult = event => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript
      const text = transcript.trim()
      setInterim(text)
      const last = event.results[event.results.length - 1]
      if (last?.isFinal && text) {
        setInterim('')
        onTranscriptRef.current(text)
      }
    }
    recognition.onerror = event => {
      setListening(false)
      setInterim('')
      const message = micErrorMessage(event.error)
      if (message) setError(message)
    }
    recognition.onend = () => { setListening(false); setInterim('') }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      setError(null)
    } catch {
      setError('The microphone would not start. Check that nothing else is using it.')
      setListening(false)
    }
  }, [lang, stopSpeaking])

  const toggleMic = useCallback(() => {
    if (listening) stopListening()
    else startListening()
  }, [listening, startListening, stopListening])

  useEffect(() => () => {
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel() } catch { /* ignore */ }
    }
  }, [])

  // One state to render from. Listening wins: the user is talking now.
  const state: DiaVoiceState = useMemo(() => {
    if (listening) return 'listening'
    if (thinking) return 'thinking'
    if (speaking) return 'speaking'
    return 'idle'
  }, [listening, thinking, speaking])

  return {
    supported,
    state,
    listening,
    speaking,
    interim,
    speakReplies,
    setSpeakReplies,
    voices,
    voiceURI,
    setVoiceURI,
    error,
    setError,
    toggleMic,
    stopSpeaking,
    speak,
  }
}
