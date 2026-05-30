/**
 * MicButton — live voice transcription via Web Speech API.
 *
 * Uses SpeechRecognition (Chrome/Edge/Safari) for real-time interim results
 * so text appears in the input as you speak — exactly like Claude voice chat.
 * Falls back to Groq Whisper if the browser doesn't support SpeechRecognition.
 *
 * States:
 *   idle        — mic icon, clickable
 *   recording   — pulsing red, text streaming live into input
 *   processing  — spinner (Whisper fallback only)
 *   error       — red X with tooltip for 4 s
 */

import { useState, useRef, useCallback, useEffect } from 'react'

type MicState = 'idle' | 'recording' | 'processing' | 'error'

interface MicButtonProps {
  onTranscription: (text: string) => void  // final text — triggers auto-submit
  onLiveText?:     (text: string) => void  // interim text — fills input live
  disabled?:       boolean
  languageHint?:   string                  // ISO 639-1, e.g. "yo", "fr"
  wallet?:         string
}

export function MicButton({
  onTranscription,
  onLiveText,
  disabled,
  languageHint,
  wallet,
}: MicButtonProps) {
  const [state,  setState]  = useState<MicState>('idle')
  const [errMsg, setErrMsg] = useState('')

  const recognitionRef = useRef<any>(null)
  const recorderRef    = useRef<MediaRecorder | null>(null)
  const chunksRef      = useRef<Blob[]>([])
  const streamRef      = useRef<MediaStream | null>(null)
  const finalRef       = useRef('')           // accumulated final segments
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    stopRecognition()
    stopStream()
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  /* ─── helpers ─────────────────────────────────────────────────────────── */

  function stopRecognition() {
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    recognitionRef.current = null
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function showError(msg: string) {
    setErrMsg(msg)
    setState('error')
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setState('idle'), 4000)
  }

  /* ─── Web Speech API path (live streaming) ───────────────────────────── */

  function startSpeechRecognition() {
    const SR: any = (window as any).SpeechRecognition
                 || (window as any).webkitSpeechRecognition
    if (!SR) return false   // not supported — caller falls back to Whisper

    const recognition = new SR()
    recognition.continuous      = true
    recognition.interimResults  = true
    recognition.maxAlternatives = 1

    // Map language hint: bare code → BCP-47
    const langMap: Record<string, string> = {
      en: 'en-US', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR',
      de: 'de-DE', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL',
      ru: 'ru-RU', ar: 'ar-SA', zh: 'zh-CN', ja: 'ja-JP',
      ko: 'ko-KR', tr: 'tr-TR', vi: 'vi-VN', hi: 'hi-IN',
      sw: 'sw-KE', yo: 'yo-NG', ha: 'ha', ig: 'ig',
    }
    recognition.lang = languageHint
      ? (langMap[languageHint] ?? languageHint)
      : navigator.language || 'en-US'

    finalRef.current = ''

    recognition.onstart = () => setState('recording')

    recognition.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          finalRef.current += t
        } else {
          interim = t   // only keep the latest interim segment
        }
      }
      // Push live text to the input field
      onLiveText?.(finalRef.current + interim)
    }

    recognition.onerror = (e: any) => {
      if (e.error === 'no-speech') return   // ignore silence
      if (e.error === 'aborted')   return   // we called stop()
      showError(`Speech error: ${e.error}`)
    }

    recognition.onend = () => {
      const text = finalRef.current.trim()
      setState('idle')
      if (text) onTranscription(text)
    }

    recognitionRef.current = recognition
    recognition.start()

    // Auto-stop after 60 s
    timeoutRef.current = setTimeout(() => stopRecognition(), 60_000)
    return true
  }

  /* ─── Whisper fallback path (batch after stop) ───────────────────────── */

  async function startWhisperRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = [
        'audio/webm;codecs=opus', 'audio/webm',
        'audio/ogg;codecs=opus',  'audio/mp4',
      ].find(m => MediaRecorder.isTypeSupported(m)) ?? ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstop = async () => {
        stopStream()
        setState('processing')
        const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        chunksRef.current = []

        if (blob.size < 500) { setState('idle'); return }

        try {
          const form = new FormData()
          form.append('audio', blob, `voice.${ext}`)
          if (languageHint) form.append('language', languageHint)
          if (wallet)       form.append('wallet', wallet)

          const res = await fetch('/api/transcribe', { method: 'POST', body: form })
          const ct  = res.headers.get('content-type') ?? ''
          if (!ct.includes('application/json')) {
            throw new Error(`Server error (${res.status}) — check server logs`)
          }
          const json = await res.json()
          if (!json.ok || !json.text?.trim()) throw new Error(json.error ?? 'Empty transcription')

          setState('idle')
          onTranscription(json.text.trim())
        } catch (err: any) {
          showError(err.message ?? 'Transcription failed')
        }
      }

      recorder.start(200)
      setState('recording')
      timeoutRef.current = setTimeout(() => recorder.stop(), 30_000)
    } catch (err: any) {
      showError(err.name === 'NotAllowedError' ? 'Microphone access denied.' : 'Could not start recording.')
    }
  }

  /* ─── Click handler ───────────────────────────────────────────────────── */

  const handleClick = useCallback(() => {
    if (disabled) return

    if (state === 'recording') {
      // Stop — SpeechRecognition or MediaRecorder
      if (recognitionRef.current) {
        stopRecognition()
      } else {
        recorderRef.current?.stop()
      }
      return
    }

    if (state !== 'idle' && state !== 'error') return

    setState('idle')   // reset error state before starting
    const usedSR = startSpeechRecognition()
    if (!usedSR) startWhisperRecording()
  }, [state, disabled, languageHint, wallet])

  /* ─── Appearance ──────────────────────────────────────────────────────── */

  const isRecording  = state === 'recording'
  const isProcessing = state === 'processing'
  const isError      = state === 'error'

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={disabled && !isRecording}
        className={[
          'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all relative',
          isRecording
            ? 'bg-red-600/30 border border-red-500/60 hover:bg-red-600/50 cursor-pointer'
            : isError
            ? 'bg-red-600/20 border border-red-500/30 cursor-pointer'
            : 'bg-white/5 border border-white/8 hover:border-purple-500/40 hover:bg-purple-600/10 cursor-pointer',
          disabled && !isRecording ? 'opacity-20 cursor-not-allowed' : '',
        ].join(' ')}
        title={
          isRecording  ? 'Tap to stop' :
          isProcessing ? 'Transcribing…' :
          isError      ? errMsg :
          'Voice input'
        }
        aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        {isRecording && (
          <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-ping" />
        )}

        {isProcessing ? (
          <svg className="w-3.5 h-3.5 text-slate-400 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : isRecording ? (
          <svg className="w-3 h-3 text-red-400 relative z-10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        ) : isError ? (
          <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a4 4 0 014 4v6a4 4 0 01-8 0V5a4 4 0 014-4zm0 2a2 2 0 00-2 2v6a2 2 0 004 0V5a2 2 0 00-2-2z"/>
            <path d="M19 10a1 1 0 012 0 9 9 0 01-8 8.94V21h2a1 1 0 010 2H9a1 1 0 010-2h2v-2.06A9 9 0 013 10a1 1 0 012 0 7 7 0 0014 0z"/>
          </svg>
        )}
      </button>

      {isError && errMsg && (
        <div className="absolute bottom-full mb-2 right-0 max-w-[220px] text-[10px] text-red-300 bg-[#1a0808] border border-red-500/30 rounded-lg px-2.5 py-1.5 pointer-events-none leading-snug z-50 shadow-lg">
          {errMsg}
        </div>
      )}
    </div>
  )
}
