/**
 * MicButton — microphone capture → /api/transcribe → onTranscription(text)
 *
 * States:
 *   idle       — mic icon, clickable
 *   requesting — brief pause while getUserMedia resolves
 *   recording  — pulsing red, click or 30s timeout stops it
 *   processing — spinner while Whisper processes
 *   error      — red flash for 2 s, then resets to idle
 */

import { useState, useRef, useCallback, useEffect } from 'react'

type MicState = 'idle' | 'requesting' | 'recording' | 'processing' | 'error'

interface MicButtonProps {
  onTranscription: (text: string) => void
  disabled?:       boolean
  languageHint?:   string   // ISO 639-1 code — passed to Whisper
  wallet?:         string   // user's wallet address — lets server look up stored language pref
}

export function MicButton({ onTranscription, disabled, languageHint, wallet }: MicButtonProps) {
  const [state, setState]     = useState<MicState>('idle')
  const [errMsg, setErrMsg]   = useState<string>('')
  const recorderRef           = useRef<MediaRecorder | null>(null)
  const chunksRef             = useRef<Blob[]>([])
  const timeoutRef            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamRef             = useRef<MediaStream | null>(null)

  /* ─── Cleanup on unmount ─────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      stopStream()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  /* ─── Stop recording and send ──────────────────────────────────────── */
  const stopAndTranscribe = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()  // triggers ondataavailable → onstop
  }, [])

  /* ─── Start recording ────────────────────────────────────────────────── */
  async function startRecording() {
    if (disabled || state !== 'idle') return
    setState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      // Pick best available mime type
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find(m => MediaRecorder.isTypeSupported(m)) ?? ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stopStream()
        setState('processing')
        const ext   = mimeType.startsWith('audio/ogg') ? 'ogg' : mimeType.startsWith('audio/mp4') ? 'm4a' : 'webm'
        const blob  = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        chunksRef.current = []

        if (blob.size < 500) {
          // Too short — likely silence or immediate release
          setErrMsg('Recording too short — hold longer.')
          setState('error')
          setTimeout(() => setState('idle'), 2500)
          return
        }

        try {
          const form = new FormData()
          form.append('audio', blob, `voice.${ext}`)
          if (languageHint) form.append('language', languageHint)
          if (wallet)       form.append('wallet', wallet)

          const res = await fetch('/api/transcribe', { method: 'POST', body: form })

          // Guard against HTML error pages (multer errors, server crashes, etc.)
          const contentType = res.headers.get('content-type') ?? ''
          if (!contentType.includes('application/json')) {
            throw new Error(`Server error (${res.status}) — check OPENAI_API_KEY in .env`)
          }

          const json = await res.json()
          if (!json.ok || !json.text?.trim()) throw new Error(json.error ?? 'Empty transcription — speak closer to the mic')

          setState('idle')
          onTranscription(json.text.trim())
        } catch (err: any) {
          setErrMsg(err.message ?? 'Transcription failed')
          setState('error')
          setTimeout(() => setState('idle'), 4000)   // 4 s — long enough to read the error
        }
      }

      recorder.start(200)   // collect chunks every 200 ms
      setState('recording')

      // Auto-stop after 30 seconds
      timeoutRef.current = setTimeout(() => stopAndTranscribe(), 30_000)

    } catch (err: any) {
      stopStream()
      setErrMsg(err.name === 'NotAllowedError' ? 'Microphone access denied.' : 'Could not start recording.')
      setState('error')
      setTimeout(() => setState('idle'), 4000)
    }
  }

  function handleClick() {
    if (disabled) return
    if (state === 'idle' || state === 'error') startRecording()
    else if (state === 'recording')            stopAndTranscribe()
  }

  /* ─── Appearance ─────────────────────────────────────────────────────── */

  const isRecording   = state === 'recording'
  const isProcessing  = state === 'processing'
  const isRequesting  = state === 'requesting'
  const isError       = state === 'error'

  const buttonClass = [
    'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all relative',
    isRecording
      ? 'bg-red-600/30 border border-red-500/60 hover:bg-red-600/50'
      : isError
      ? 'bg-red-600/20 border border-red-500/30'
      : 'bg-white/5 border border-white/8 hover:border-purple-500/40 hover:bg-purple-600/10',
    disabled && !isRecording ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer',
  ].join(' ')

  return (
    <div className="relative group">
      <button
        onClick={handleClick}
        className={buttonClass}
        title={
          isRecording  ? 'Tap to stop' :
          isProcessing ? 'Transcribing…' :
          isError      ? errMsg :
          'Voice input'
        }
        aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        {/* Pulsing ring when recording */}
        {isRecording && (
          <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-ping" />
        )}

        {isProcessing || isRequesting ? (
          /* Spinner */
          <svg className="w-3.5 h-3.5 text-slate-400 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : isRecording ? (
          /* Stop square */
          <svg className="w-3 h-3 text-red-400 relative z-10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        ) : isError ? (
          /* Error X */
          <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          /* Mic icon */
          <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a4 4 0 014 4v6a4 4 0 01-8 0V5a4 4 0 014-4zm0 2a2 2 0 00-2 2v6a2 2 0 004 0V5a2 2 0 00-2-2z"/>
            <path d="M19 10a1 1 0 012 0 9 9 0 01-8 8.94V21h2a1 1 0 010 2H9a1 1 0 010-2h2v-2.06A9 9 0 013 10a1 1 0 012 0 7 7 0 0014 0z"/>
          </svg>
        )}
      </button>

      {/* Error tooltip — always visible in error state, hover-visible otherwise */}
      {isError && errMsg && (
        <div className="absolute bottom-full mb-2 right-0 max-w-[200px] text-[10px] text-red-300 bg-[#1a0808] border border-red-500/30 rounded-lg px-2.5 py-1.5 pointer-events-none leading-snug z-50 shadow-lg">
          {errMsg}
        </div>
      )}
    </div>
  )
}
