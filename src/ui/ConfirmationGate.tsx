import { useState } from 'react'
import type { AppState } from './App'

interface Props {
  report:      any
  quote:       any
  parsedIntent: any
  state:       AppState
  onConfirm:   () => void
  onReset:     () => void
}

export function ConfirmationGate({ report, quote, parsedIntent, state, onConfirm, onReset }: Props) {
  const [understood, setUnderstood] = useState(false)

  const isRewriting = state === 'rewriting'
  const blocked     = !report.canProceed

  const levelEmoji = { LOW: '✅', MEDIUM: '⚠️', HIGH: '🔶', CRITICAL: '🚫' }
  const levelColor = {
    LOW:      'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
    MEDIUM:   'text-amber-400   border-amber-500/30   bg-amber-500/5',
    HIGH:     'text-orange-400  border-orange-500/30  bg-orange-500/5',
    CRITICAL: 'text-red-400     border-red-500/30     bg-red-500/5',
  }[report.level] ?? ''

  return (
    <div className={`rounded-xl border p-6 space-y-5 ${
      blocked ? 'border-red-500/20 bg-red-500/5' : 'border-[#1e1e2e] bg-[#111118]'
    }`}>
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Confirmation Gate</h2>

      {/* Summary card */}
      <div className="rounded-lg bg-slate-900/60 border border-[#1e1e2e] px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">
            Swap{' '}
            <span className="text-white font-semibold">{quote.amountInFormatted} {parsedIntent.input_asset}</span>
            {' → '}
            <span className="text-white font-semibold">{quote.amountOutFormatted} {parsedIntent.output_goal?.toUpperCase()}</span>
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${levelColor}`}>
            {levelEmoji[report.level as keyof typeof levelEmoji]} {report.level}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Guardian score: <span className="text-slate-300 font-mono">{report.score}/100</span></span>
          <span>Route: <span className="text-slate-300">{quote.routeLabel}</span></span>
          <span>Gas: <span className="text-slate-300 font-mono">~{quote.gasEstimateFormatted} SUI</span></span>
        </div>
      </div>

      {/* Blocked message */}
      {blocked && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          Guardian has blocked this swap. Click <strong>FIX IT FOR ME</strong> in the report above, or adjust your intent and re-analyze.
        </div>
      )}

      {/* Acknowledgment checkbox for non-blocked */}
      {!blocked && report.flags.some((f: any) => f.severity !== 'green') && (
        <label className="flex items-start gap-3 cursor-pointer group">
          <div
            onClick={() => setUnderstood(u => !u)}
            className={`mt-0.5 w-5 h-5 shrink-0 rounded border flex items-center justify-center transition-colors cursor-pointer ${
              understood ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600 group-hover:border-slate-400'
            }`}
          >
            {understood && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
          </div>
          <span className="text-sm text-slate-400">
            I have reviewed the Guardian report and understand the risks associated with this transaction.
          </span>
        </label>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-medium transition-colors"
        >
          Cancel
        </button>

        <button
          onClick={onConfirm}
          disabled={
            blocked ||
            isRewriting ||
            (report.flags.some((f: any) => f.severity !== 'green') && !understood)
          }
          className="flex-1 py-2.5 rounded-lg btn-proceed text-white text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center justify-center gap-2"
        >
          {isRewriting ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4"/>
                <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              Rewriting…
            </>
          ) : 'I UNDERSTAND — PROCEED →'}
        </button>
      </div>

      {!blocked && !understood && report.flags.some((f: any) => f.severity !== 'green') && (
        <p className="text-xs text-slate-600 text-center">Check the acknowledgment above to enable the proceed button.</p>
      )}
    </div>
  )
}
