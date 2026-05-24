import { useState, useRef, useEffect, useCallback } from 'react'
import { ConnectModal, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit'
import { PTBPreview }       from './PTBPreview'
import { GuardianReport }   from './GuardianReport'
import { ConfirmationGate } from './ConfirmationGate'
import { Sidebar }          from './Sidebar'

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type AppState = 'idle' | 'loading' | 'review' | 'rewriting' | 'rewritten' | 'confirmed'

interface GuardData {
  parsedIntent: any
  quote:        any
  report:       any
  _rawReport:   any
}

interface ChatMessage {
  id:           string
  role:         'user' | 'vektor'
  text?:        string
  actionLabel?: string
  loading?:     boolean
  originalText?: string
  guardData?:   GuardData
  phase?:       'review' | 'rewriting' | 'rewritten' | 'confirmed'
  // Rich payload for non-swap intents
  intentType?:  string
  payload?:     any
}

/* ─── Quick actions by category ─────────────────────────────────────────── */

const QUICK_ACTIONS = [
  'Swap 1 SUI to USDC',
  'Lend 100 USDC on NAVI',
  'DCA 10 USDC into SUI every day for 7 days',
  'Analyze my wallet',
]

const PLACEHOLDER = 'Drop an intent.'

/* ─── Label builder ──────────────────────────────────────────────────────── */

function buildSwapLabel(quote: any, report: any): string {
  const from      = (quote.fromSymbol ?? 'SUI').toUpperCase()
  const to        = (quote.toSymbol   ?? 'USDC').toUpperCase()
  const protocols = (quote.route ?? []).map((s: any) => s.protocol.toUpperCase())
  const score     = report?.score ?? '?'
  const chain     = protocols.length ? [from, ...protocols, to].join(' → ') : `${from} → ${to}`
  return `· SWAP · ${chain} · SCORE ${score}/100`
}

function buildRewriteLabel(quote: any, report: any): string {
  const protocols = (quote.route ?? []).map((s: any) => s.protocol.toUpperCase())
  const score     = report?.score ?? '?'
  const chain     = protocols.length ? protocols.join(' → ') : 'OPTIMIZED'
  return `· REWRITE · ${chain} · SCORE ${score}/100`
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size} animate-spin shrink-0`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

/* ─── Rich intent cards ──────────────────────────────────────────────────── */

function PortfolioCard({ portfolio }: { portfolio: any }) {
  if (!portfolio) return null
  return (
    <div className="rounded-xl border border-white/5 bg-[#111118] p-5 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Total Portfolio Value</p>
          <p className="text-3xl font-bold text-white mt-1">${portfolio.totalUsd?.toFixed(2) ?? '0.00'}</p>
        </div>
        {portfolio.navi?.healthFactor != null && (
          <div className={`px-3 py-1 rounded-full text-xs font-mono ${
            portfolio.navi.healthFactor > 2 ? 'bg-emerald-400/10 text-emerald-400'
            : portfolio.navi.healthFactor > 1.5 ? 'bg-yellow-400/10 text-yellow-400'
            : 'bg-red-400/10 text-red-400'
          }`}>
            HF {portfolio.navi.healthFactor.toFixed(2)}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(portfolio.balances ?? []).slice(0, 6).map((b: any) => (
          <div key={b.symbol} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
            <span className="text-xs text-slate-400 font-medium">{b.symbol}</span>
            <div className="text-right">
              <p className="text-xs text-white">{b.formatted}</p>
              <p className="text-[10px] text-slate-600">${b.usdValue?.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
      {portfolio.navi && (Object.keys(portfolio.navi.supplyBalances ?? {}).length > 0) && (
        <div className="border-t border-white/5 pt-3 space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-2">NAVI</p>
          {Object.entries(portfolio.navi.supplyBalances ?? {}).map(([s, v]) => (
            <div key={s} className="flex justify-between text-xs">
              <span className="text-slate-500">↑ Supplied {s}</span>
              <span className="text-emerald-400">{(v as number).toFixed(4)}</span>
            </div>
          ))}
          {Object.entries(portfolio.navi.borrowBalances ?? {}).map(([s, v]) => (
            <div key={s} className="flex justify-between text-xs">
              <span className="text-slate-500">↓ Borrowed {s}</span>
              <span className="text-red-400">{(v as number).toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NaviCard({ payload, intentType }: { payload: any; intentType: string }) {
  const isLend   = intentType === 'lend'
  const isBorrow = intentType === 'borrow'
  const isRepay  = intentType === 'repay'
  return (
    <div className="rounded-xl border border-white/5 bg-[#111118] p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
          isLend ? 'bg-emerald-500/10 text-emerald-400' : isBorrow ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
        }`}>
          {isLend ? '↑' : isBorrow ? '↓' : '↩'}
        </div>
        <div>
          <p className="text-sm font-semibold text-white capitalize">{intentType} on NAVI</p>
          {payload?.healthFactor != null && (
            <p className={`text-xs ${payload.healthFactor > 2 ? 'text-emerald-400' : payload.healthFactor > 1.5 ? 'text-yellow-400' : 'text-red-400'}`}>
              Health Factor: {payload.healthFactor.toFixed(2)}
            </p>
          )}
        </div>
      </div>
      {isBorrow && !payload?.safeToBorrow && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
          ⚠️ Health factor too low to safely borrow. Repay existing debt first.
        </div>
      )}
      {payload?.poolRates && (
        <div className="text-xs text-slate-500 space-y-1">
          {payload.poolRates.base_supply_rate && (
            <p>Supply APY: <span className="text-emerald-400">{(Number(payload.poolRates.base_supply_rate) * 100).toFixed(2)}%</span></p>
          )}
          {payload.poolRates.base_borrow_rate && (
            <p>Borrow APY: <span className="text-amber-400">{(Number(payload.poolRates.base_borrow_rate) * 100).toFixed(2)}%</span></p>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">
        {payload?.ptbB64
          ? 'Transaction built — confirm below to sign.'
          : 'Connect wallet to build and sign transaction.'}
      </p>
    </div>
  )
}

function ScheduledCard({ payload }: { payload: any }) {
  const s = payload?.scheduled
  if (!s) return null
  const freqMap: Record<string, string> = { daily: 'Every day', weekly: `Every ${s.schedule?.dayOfWeek ?? 'week'}`, monthly: 'Every month', once: 'One time' }
  return (
    <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-purple-400">⏱</span>
        <span className="text-sm font-semibold text-white capitalize">{s.type === 'dca' ? 'DCA' : 'Scheduled Payment'} Created</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div><p className="text-slate-500">Amount</p><p className="text-white">{s.amount} {s.token}{s.targetToken ? ` → ${s.targetToken}` : ''}</p></div>
        <div><p className="text-slate-500">Frequency</p><p className="text-white capitalize">{freqMap[s.schedule?.frequency] ?? s.schedule?.frequency}</p></div>
        <div><p className="text-slate-500">First run</p><p className="text-white">{new Date(s.schedule?.nextRun).toLocaleDateString()}</p></div>
        {s.schedule?.totalRuns > 0 && <div><p className="text-slate-500">Total runs</p><p className="text-white">{s.schedule.totalRuns}</p></div>}
      </div>
      <p className="text-[10px] text-slate-600 font-mono">ID: {s.id}</p>
    </div>
  )
}

function ConditionCard({ payload }: { payload: any }) {
  const c = payload?.condition
  if (!c) return null
  return (
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-yellow-400">⚡</span>
        <span className="text-sm font-semibold text-white">Condition Armed</span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{c.description}</p>
      <div className="flex items-center gap-4 text-xs">
        <div>
          <p className="text-slate-500">Trigger</p>
          <p className="text-white font-mono">{c.trigger.asset} {c.trigger.type === 'price_below' ? '<' : '>'} ${c.trigger.threshold}</p>
        </div>
        {payload.currentPrice != null && (
          <div>
            <p className="text-slate-500">Current</p>
            <p className="text-white font-mono">${payload.currentPrice.toFixed(4)}</p>
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-600">Polling every 30s via Pyth oracle.</p>
    </div>
  )
}

function ExplainCard({ payload }: { payload: any }) {
  const r = payload?.explanation
  if (!r) return null
  return (
    <div className="rounded-xl border border-white/5 bg-[#111118] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Transaction</span>
        <a
          href={`https://suiscan.xyz/mainnet/tx/${r.digest}`}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-purple-400 hover:text-purple-300 font-mono"
        >
          {r.digest.slice(0, 10)}… ↗
        </a>
      </div>
      <p className="text-sm text-slate-200 leading-relaxed">{r.explanation}</p>
      <div className="flex gap-4 text-xs">
        <div><p className="text-slate-500">Status</p><p className={r.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>{r.status}</p></div>
        <div><p className="text-slate-500">Gas</p><p className="text-white">{r.gasUsed?.toFixed(6)} SUI</p></div>
      </div>
    </div>
  )
}

function PaymentCard({ payload }: { payload: any }) {
  const [copied, setCopied] = useState(false)
  const link = payload?.paymentLink ?? ''
  function copy() {
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div className="rounded-xl border border-white/5 bg-[#111118] p-5 space-y-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Payment Request</p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div><p className="text-slate-500">Amount</p><p className="text-white">{payload?.payment?.amount} {payload?.payment?.token}</p></div>
        <div><p className="text-slate-500">Status</p><p className="text-emerald-400 capitalize">{payload?.payment?.status}</p></div>
      </div>
      <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 flex items-center gap-2">
        <p className="flex-1 text-xs text-slate-400 font-mono truncate">{link}</p>
        <button onClick={copy} className="text-[10px] text-purple-400 hover:text-purple-300 shrink-0">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function GeneralCard({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 rounded-xl border border-white/5 bg-[#111118] text-sm text-slate-300 leading-relaxed">
      {message}
    </div>
  )
}

/* ─── Message bubble ──────────────────────────────────────────────────────── */

interface BubbleProps {
  msg:       ChatMessage
  onFix:     () => void
  onConfirm: () => void
}

function MessageBubble({ msg, onFix, onConfirm }: BubbleProps) {
  if (msg.role === 'user') {
    return (
      <div className="msg-in flex justify-end">
        <div className="max-w-[72%] px-4 py-3 rounded-2xl rounded-tr-sm bg-purple-600/15 border border-purple-500/20 text-sm text-white leading-relaxed">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="msg-in flex flex-col gap-2 max-w-full">
      <div className="flex items-center gap-2 pl-0.5 flex-wrap">
        <span className="text-[11px] font-bold text-purple-400 font-mono tracking-widest">⚡ VEKTOR</span>
        {msg.actionLabel && (
          <span className="text-[10px] text-purple-400 uppercase tracking-widest font-mono opacity-80">
            {msg.actionLabel}
          </span>
        )}
      </div>

      {msg.loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 bg-[#111118] text-sm text-slate-400">
          <Spinner />
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
            {msg.actionLabel ?? 'Processing…'}
          </span>
        </div>
      )}

      {!msg.loading && (() => {
        const it = msg.intentType

        // Swap / Guardian flow
        if (msg.guardData && msg.phase !== 'confirmed') return (
          <div className="space-y-4">
            <PTBPreview parsedIntent={msg.guardData.parsedIntent} quote={msg.guardData.quote} originalText={msg.originalText ?? ''} />
            <GuardianReport report={msg.guardData.report} rewriting={msg.phase === 'rewriting'} wasRewritten={msg.phase === 'rewritten'} onFix={onFix} />
            <ConfirmationGate report={msg.guardData.report} quote={msg.guardData.quote} parsedIntent={msg.guardData.parsedIntent} state={msg.phase as AppState} onConfirm={onConfirm} onReset={() => {}} />
          </div>
        )

        if (msg.guardData && msg.phase === 'confirmed') return (
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-6 py-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">✓</span>
              <span className="text-white font-semibold text-sm">Intent confirmed — ready to execute</span>
            </div>
            <p className="text-xs text-slate-600 font-mono">vektor.execute(gate, signer) → submits PTB on-chain</p>
          </div>
        )

        if (it === 'check_balance' || it === 'analyze_wallet') return <PortfolioCard portfolio={msg.payload?.portfolio} />
        if (it === 'lend' || it === 'borrow' || it === 'repay') return (
          <div className="space-y-4">
            <NaviCard payload={msg.payload} intentType={it} />
            {msg.text && <GeneralCard message={msg.text} />}
          </div>
        )
        if (it === 'schedule' || it === 'dca') return <ScheduledCard payload={msg.payload} />
        if (it === 'conditional') return <ConditionCard payload={msg.payload} />
        if (it === 'explain_transaction') return <ExplainCard payload={msg.payload} />
        if (it === 'request_payment') return <PaymentCard payload={msg.payload} />

        // Default text card
        if (msg.text) return <GeneralCard message={msg.text} />
        return null
      })()}
    </div>
  )
}

/* ─── Alert banner ───────────────────────────────────────────────────────── */

interface AlertBannerProps {
  alerts:    any[]
  onDismiss: () => void
}

function AlertBanner({ alerts, onDismiss }: AlertBannerProps) {
  if (alerts.length === 0) return null
  const latest = alerts[alerts.length - 1]
  const color  = latest.severity === 'critical' ? 'border-red-500/40 bg-red-500/5 text-red-300'
               : latest.severity === 'warning'  ? 'border-yellow-500/40 bg-yellow-500/5 text-yellow-300'
               : 'border-purple-500/20 bg-purple-500/5 text-purple-300'
  return (
    <div className={`mx-4 mt-2 px-4 py-3 rounded-xl border flex items-start gap-3 ${color}`}>
      <span className="text-sm shrink-0">{latest.severity === 'critical' ? '🚨' : '⚡'}</span>
      <div className="flex-1">
        <p className="text-xs leading-relaxed">{latest.message}</p>
        {alerts.length > 1 && <p className="text-[10px] opacity-60 mt-1">+{alerts.length - 1} more alerts</p>}
      </div>
      <button onClick={onDismiss} className="text-[10px] opacity-40 hover:opacity-80 shrink-0">✕</button>
    </div>
  )
}

/* ─── Main App ───────────────────────────────────────────────────────────── */

export default function App() {
  const account              = useCurrentAccount()
  const { mutate: disconnect } = useDisconnectWallet()

  const [connectOpen,  setConnectOpen]  = useState(false)
  const [messages,     setMessages]     = useState<ChatMessage[]>([])
  const [input,        setInput]        = useState('')
  const [portfolio,    setPortfolio]    = useState<any>(null)
  const [alerts,       setAlerts]       = useState<any[]>([])

  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // On wallet connect: fetch portfolio + alerts, inject welcome message
  useEffect(() => {
    if (!account) { setPortfolio(null); setAlerts([]); return }

    const wallet = account.address

    // Fetch portfolio
    fetch('/api/portfolio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet }) })
      .then(r => r.json())
      .then(d => { if (d.ok) setPortfolio(d.portfolio) })
      .catch(() => {})

    // Fetch memory + alerts
    fetch(`/api/memory/${wallet}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const mem = d.memory
        if (messages.length === 0) {
          const parts = []
          if (mem.portfolioSnapshot?.totalUsd) parts.push(`Portfolio: $${mem.portfolioSnapshot.totalUsd.toFixed(2)}`)
          if (mem.naviHealthFactor) parts.push(`NAVI health: ${mem.naviHealthFactor.toFixed(2)}`)
          if (mem.stats?.totalIntents > 0) parts.push(`${mem.stats.totalIntents} intents logged`)
          if (parts.length > 0) {
            setMessages([{
              id:          crypto.randomUUID(),
              role:        'vektor',
              actionLabel: '· MEMORY · LOADED',
              text:        `Welcome back. ${parts.join(' · ')}.`,
              intentType:  'general',
            }])
          }
        }
      })
      .catch(() => {})

    // Fetch pending alerts
    fetch(`/api/alerts/${wallet}`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.alerts.length) setAlerts(d.alerts) })
      .catch(() => {})
  }, [account?.address])

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const refreshPortfolio = useCallback(() => {
    if (!account) return
    fetch('/api/portfolio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: account.address }) })
      .then(r => r.json())
      .then(d => { if (d.ok) setPortfolio(d.portfolio) })
      .catch(() => {})
  }, [account])

  /* ── Send message ─────────────────────────────────────────────────── */
  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !account) return

    const userMsgId   = crypto.randomUUID()
    const vektorMsgId = crypto.randomUUID()

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    setMessages(prev => [
      ...prev,
      { id: userMsgId,   role: 'user',   text: trimmed },
      { id: vektorMsgId, role: 'vektor', loading: true, actionLabel: '· PARSING · INTENT' },
    ])

    try {
      const res  = await fetch('/api/intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: trimmed, senderAddress: account.address }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Unknown error')

      const intentType = json.intent_type as string

      // Swap-type intents go through the Guardian flow
      const swapTypes = ['swap', 'compound', 'rebalance', 'risk_qualified', 'buy_memecoin', 'sell_memecoin', 'exit_at_profit', 'exit_at_loss', 'exit']
      if (swapTypes.includes(intentType) && json.quote && json.report) {
        setMessages(prev => prev.map(m =>
          m.id === vektorMsgId
            ? {
                ...m,
                loading:      false,
                actionLabel:  intentType === 'swap' || intentType === 'compound' || intentType === 'rebalance' || intentType === 'risk_qualified'
                              ? buildSwapLabel(json.quote, json.report)
                              : json.actionLabel,
                originalText: trimmed,
                intentType,
                guardData: {
                  parsedIntent: json.parsedIntent,
                  quote:        json.quote,
                  report:       json.report,
                  _rawReport:   json._rawReport,
                },
                phase: 'review' as const,
              }
            : m,
        ))
        return
      }

      // All other intent types — rich card
      setMessages(prev => prev.map(m =>
        m.id === vektorMsgId
          ? {
              ...m,
              loading:     false,
              intentType,
              actionLabel: json.actionLabel,
              text:        json.message,
              payload:     json,
              phase:       undefined,
            }
          : m,
      ))

      // Refresh portfolio after lend/borrow/repay/send
      if (['lend', 'borrow', 'repay', 'send'].includes(intentType)) {
        setTimeout(refreshPortfolio, 3000)
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong'
      setMessages(prev => prev.map(m =>
        m.id === vektorMsgId
          ? { ...m, loading: false, actionLabel: '· ERROR', text: errMsg, intentType: 'error' }
          : m,
      ))
    }
  }

  /* ── Fix (rewrite PTB) ────────────────────────────────────────────── */
  async function handleFix(msgId: string) {
    const msg = messages.find(m => m.id === msgId)
    if (!msg?.guardData) return

    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, phase: 'rewriting' as const } : m))

    try {
      const res  = await fetch('/api/rewrite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rawReport: msg.guardData!._rawReport }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)

      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, phase: 'rewritten' as const, actionLabel: buildRewriteLabel(json.quote, json.report), guardData: { ...m.guardData!, quote: json.quote, report: json.report, _rawReport: json._rawReport } }
          : m,
      ))
    } catch {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, phase: 'review' as const } : m))
    }
  }

  /* ── Confirm ──────────────────────────────────────────────────────── */
  function handleConfirm(msgId: string) {
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, phase: 'confirmed' as const, actionLabel: '· EXECUTE · MAINNET' } : m,
    ))
  }

  const walletLabel = account
    ? `${account.address.slice(0, 6)}…${account.address.slice(-4)}`
    : null

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f] overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="shrink-0 px-6 py-4 border-b border-white/5 flex items-center justify-between bg-[#0a0a0f]/90 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          <span className="font-display text-2xl text-white leading-none">⚡ Vektor</span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-500 font-mono">mainnet</span>
          </div>
        </div>

        {account ? (
          <button
            onClick={() => disconnect()}
            title="Click to disconnect"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-[#111118] text-sm text-slate-300 hover:border-purple-500/40 hover:text-white transition-colors font-mono"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            {walletLabel}
          </button>
        ) : (
          <ConnectModal
            trigger={
              <button className="px-4 py-2 rounded-lg border border-white/10 bg-[#111118] text-sm text-slate-300 hover:border-purple-500/40 hover:text-white transition-colors">
                Connect Wallet
              </button>
            }
            open={connectOpen}
            onOpenChange={setConnectOpen}
          />
        )}
      </header>

      {/* ── Alert banner ────────────────────────────────────────────── */}
      <AlertBanner alerts={alerts} onDismiss={() => setAlerts([])} />

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Chat area ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-5 text-center select-none">
                  <span className="font-display text-6xl text-white">⚡</span>
                  <div className="space-y-2">
                    <p className="text-white font-semibold tracking-tight">Vektor — Financial OS for Sui</p>
                    <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                      {account
                        ? 'Swap, lend, borrow, DCA, set conditions, analyze your wallet — all in plain English.'
                        : 'Connect your wallet to start talking to Vektor.'}
                    </p>
                  </div>
                  {!account && (
                    <ConnectModal
                      trigger={
                        <button className="mt-2 px-6 py-2.5 rounded-xl border border-purple-500/30 bg-purple-600/10 text-purple-300 text-sm font-medium hover:bg-purple-600/20 hover:border-purple-500/50 transition-colors">
                          Connect Wallet
                        </button>
                      }
                      open={connectOpen}
                      onOpenChange={setConnectOpen}
                    />
                  )}
                </div>
              )}

              {messages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onFix={() => handleFix(msg.id)}
                  onConfirm={() => handleConfirm(msg.id)}
                />
              ))}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* ── Input area ─────────────────────────────────────────── */}
          <div className="shrink-0 border-t border-white/5 bg-[#0a0a0f]/90 backdrop-blur-md">
            <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
              <div className="flex gap-2 flex-wrap">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action}
                    onClick={() => sendMessage(action)}
                    disabled={!account}
                    className="text-xs px-3 py-1.5 rounded-full border border-white/8 text-slate-500 hover:border-purple-500/40 hover:text-purple-300 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    {action}
                  </button>
                ))}
              </div>

              <div className="relative">
                {!account && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#0a0a0f]/60 backdrop-blur-sm z-10 pointer-events-none">
                    <span className="text-sm text-slate-500">Connect wallet to start</span>
                  </div>
                )}
                <div className="flex items-end gap-3 bg-[#111118] border border-white/8 rounded-2xl px-4 py-3 focus-within:border-purple-500/25 transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); autoResize(e.target) }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                    disabled={!account}
                    placeholder={PLACEHOLDER}
                    rows={1}
                    className="flex-1 bg-transparent resize-none text-sm text-white placeholder:text-slate-600 focus:outline-none leading-relaxed"
                    style={{ maxHeight: '120px' }}
                  />
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={!account || !input.trim()}
                    className="shrink-0 w-8 h-8 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-20 disabled:cursor-not-allowed transition-all flex items-center justify-center group"
                  >
                    <svg className="w-4 h-4 text-white transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>

              <p className="text-center text-[10px] text-slate-700">
                Routex routing · Guardian v2 · NAVI · Claude NLP · Sui mainnet
              </p>
            </div>
          </div>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <Sidebar
          wallet={account?.address ?? null}
          portfolio={portfolio}
          onRefresh={refreshPortfolio}
        />
      </div>
    </div>
  )
}
