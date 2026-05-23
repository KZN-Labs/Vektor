import { useState } from 'react'
import { IntentInput }     from './IntentInput'
import { PTBPreview }      from './PTBPreview'
import { GuardianReport }  from './GuardianReport'
import { ConfirmationGate } from './ConfirmationGate'

export type AppState = 'idle' | 'loading' | 'review' | 'rewriting' | 'rewritten' | 'confirmed'

export interface GuardData {
  parsedIntent: any
  quote:        any
  report:       any
  _rawReport:   any
}

export default function App() {
  const [state,     setState]     = useState<AppState>('idle')
  const [data,      setData]      = useState<GuardData | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [inputText, setInputText] = useState('')

  async function handleAnalyze(text: string) {
    setInputText(text)
    setState('loading')
    setError(null)

    try {
      const res  = await fetch('/api/guard', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setData(json)
      setState('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      setState('idle')
    }
  }

  async function handleFix() {
    if (!data) return
    setState('rewriting')
    try {
      const res  = await fetch('/api/rewrite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rawReport: data._rawReport }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setData(prev => prev ? { ...prev, quote: json.quote, report: json.report, _rawReport: json._rawReport } : prev)
      setState('rewritten')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rewrite failed')
      setState('review')
    }
  }

  function handleConfirm() { setState('confirmed') }
  function handleReset()   { setState('idle'); setData(null); setError(null) }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[#1e1e2e] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">⚡ Vektor</span>
          <span className="text-xs text-slate-500 border border-slate-700 px-2 py-0.5 rounded">Intent Engine for Sui</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          mainnet
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10 space-y-8">
        <IntentInput
          loading={state === 'loading'}
          onAnalyze={handleAnalyze}
          error={error}
        />

        {(state === 'review' || state === 'rewriting' || state === 'rewritten') && data && (
          <>
            <PTBPreview
              parsedIntent={data.parsedIntent}
              quote={data.quote}
              originalText={inputText}
            />

            <GuardianReport
              report={data.report}
              rewriting={state === 'rewriting'}
              wasRewritten={state === 'rewritten'}
              onFix={handleFix}
            />

            <ConfirmationGate
              report={data.report}
              quote={data.quote}
              parsedIntent={data.parsedIntent}
              state={state}
              onConfirm={handleConfirm}
              onReset={handleReset}
            />
          </>
        )}

        {state === 'confirmed' && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-8 text-center space-y-4">
            <div className="text-4xl">✅</div>
            <p className="text-lg font-semibold text-white">Intent confirmed</p>
            <p className="text-sm text-slate-400">
              To execute on-chain, pass the report to{' '}
              <code className="text-indigo-400 bg-slate-800/60 px-1.5 py-0.5 rounded">vektor.execute(gate, signer)</code>
            </p>
            <button
              onClick={handleReset}
              className="mt-2 text-sm text-slate-500 hover:text-slate-300 underline transition-colors"
            >
              ← New intent
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-[#1e1e2e] px-6 py-3 text-xs text-slate-600 flex justify-between">
        <span>Vektor · Sui Overflow 2026</span>
        <span>Powered by Routex · Guardian · Claude</span>
      </footer>
    </div>
  )
}
