import { useState } from 'react'

interface Props {
  loading:   boolean
  onAnalyze: (text: string) => void
  error:     string | null
}

const EXAMPLES = [
  'Swap 100 SUI to USDC',
  'Get yield with my SUI, nothing risky',
  'Swap 500 SUI to USDC, only if slippage under 1%',
  'Go 50/50 SUI and USDC',
]

export function IntentInput({ loading, onAnalyze, error }: Props) {
  const [text, setText] = useState('')

  function submit() {
    if (!text.trim() || loading) return
    onAnalyze(text.trim())
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-white">What would you like to do?</h1>
        <p className="text-sm text-slate-500 mt-1">Describe your intent in plain English. Vektor will parse, guard, and build the transaction.</p>
      </div>

      {/* Input card */}
      <div className={`rounded-xl border bg-[#111118] transition-colors ${
        error ? 'border-red-500/40' : 'border-[#1e1e2e] focus-within:border-indigo-500/50'
      }`}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder='e.g. "Swap 500 SUI to USDC" or "Get me into yield, nothing risky"'
          rows={3}
          disabled={loading}
          className="w-full bg-transparent px-5 pt-5 pb-2 text-base text-white placeholder-slate-600 resize-none focus:outline-none"
        />

        <div className="flex items-center justify-between px-4 pb-4">
          <span className="text-xs text-slate-600">{text.length > 0 ? `${text.length} chars` : 'Shift+Enter for new line'}</span>
          <button
            onClick={submit}
            disabled={!text.trim() || loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg btn-proceed text-white text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4"/>
                  <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Analyzing…
              </>
            ) : (
              <>Analyze <span className="opacity-70">→</span></>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 flex gap-3 items-start">
          <span className="text-red-400 mt-0.5 text-sm">⚠</span>
          <div>
            <p className="text-sm font-medium text-red-400">Failed to analyze intent</p>
            <p className="text-xs text-slate-400 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Example chips */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-600 self-center">Try:</span>
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            onClick={() => { setText(ex); }}
            className="text-xs px-3 py-1.5 rounded-full bg-[#111118] border border-[#1e1e2e] text-slate-400 hover:text-white hover:border-indigo-500/40 transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
