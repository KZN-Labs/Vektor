import { useState, useRef, useEffect } from 'react'
import { ConnectModal, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit'
import { PTBPreview }       from './PTBPreview'
import { GuardianReport }   from './GuardianReport'
import { ConfirmationGate } from './ConfirmationGate'

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type AppState = 'idle' | 'loading' | 'review' | 'rewriting' | 'rewritten' | 'confirmed'

interface GuardData {
  parsedIntent: any
  quote:        any
  report:       any
  _rawReport:   any
}

interface ChatMessage {
  id:            string
  role:          'user' | 'vektor'
  text?:         string
  actionLabel?:  string
  loading?:      boolean
  originalText?: string
  guardData?:    GuardData
  phase?:        'review' | 'rewriting' | 'rewritten' | 'confirmed'
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  'Swap 1 SUI to USDC',
  'Get yield, nothing risky',
  'Swap 10 SUI to USDT',
  'Go 50/50 SUI and USDC',
]

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg
      className={`w-${size} h-${size} animate-spin shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

interface BubbleProps {
  msg:       ChatMessage
  onFix:     () => void
  onConfirm: () => void
}

function MessageBubble({ msg, onFix, onConfirm }: BubbleProps) {
  /* User bubble — right-aligned */
  if (msg.role === 'user') {
    return (
      <div className="msg-in flex justify-end">
        <div className="max-w-[72%] px-4 py-3 rounded-2xl rounded-tr-sm bg-purple-600/15 border border-purple-500/20 text-sm text-white leading-relaxed">
          {msg.text}
        </div>
      </div>
    )
  }

  /* Vektor bubble — left-aligned */
  return (
    <div className="msg-in flex flex-col gap-2 max-w-full">
      {/* Label row */}
      <div className="flex items-center gap-2 pl-0.5">
        <span className="text-[11px] font-bold text-purple-400 font-mono tracking-widest">⚡ VEKTOR</span>
        {msg.actionLabel && (
          <span className="text-[10px] text-slate-600 uppercase tracking-widest font-mono">
            {msg.actionLabel}
          </span>
        )}
      </div>

      {/* Loading state */}
      {msg.loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 bg-[#111118] text-sm text-slate-400">
          <Spinner />
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
            {msg.actionLabel ?? 'Processing…'}
          </span>
        </div>
      )}

      {/* Plain text (errors, etc.) */}
      {!msg.loading && msg.text && !msg.guardData && (
        <div className="px-4 py-3 rounded-xl border border-white/5 bg-[#111118] text-sm text-slate-300 leading-relaxed">
          {msg.text}
        </div>
      )}

      {/* Guard data cards */}
      {msg.guardData && msg.phase !== 'confirmed' && (
        <div className="space-y-4">
          <PTBPreview
            parsedIntent={msg.guardData.parsedIntent}
            quote={msg.guardData.quote}
            originalText={msg.originalText ?? ''}
          />
          <GuardianReport
            report={msg.guardData.report}
            rewriting={msg.phase === 'rewriting'}
            wasRewritten={msg.phase === 'rewritten'}
            onFix={onFix}
          />
          <ConfirmationGate
            report={msg.guardData.report}
            quote={msg.guardData.quote}
            parsedIntent={msg.guardData.parsedIntent}
            state={msg.phase as AppState}
            onConfirm={onConfirm}
            onReset={() => {}}
          />
        </div>
      )}

      {/* Confirmed state */}
      {msg.guardData && msg.phase === 'confirmed' && (
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-6 py-5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-base">✓</span>
            <span className="text-white font-semibold text-sm">Intent confirmed — ready to execute</span>
          </div>
          <p className="text-xs text-slate-600 font-mono">
            vektor.execute(gate, signer) → submits PTB on-chain
          </p>
        </div>
      )}
    </div>
  )
}

/* ─── Main App ───────────────────────────────────────────────────────────── */

export default function App() {
  const account              = useCurrentAccount()
  const { mutate: disconnect } = useDisconnectWallet()

  const [connectOpen, setConnectOpen] = useState(false)
  const [messages,    setMessages]    = useState<ChatMessage[]>([])
  const [input,       setInput]       = useState('')

  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  /* Scroll to bottom on new message */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* Auto-resize textarea */
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  /* ── Send message ─────────────────────────────────────────────────── */
  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !account) return

    const userMsgId   = crypto.randomUUID()
    const vektorMsgId = crypto.randomUUID()

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    setMessages(prev => [
      ...prev,
      { id: userMsgId,   role: 'user',   text: trimmed },
      { id: vektorMsgId, role: 'vektor', loading: true, actionLabel: '· PARSING · INTENT' },
    ])

    try {
      const res  = await fetch('/api/guard', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: trimmed, senderAddress: account.address }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Unknown error')

      const routeLabel    = (json.quote?.routeLabel ?? 'BEST ROUTE').toUpperCase()
      const guardianLevel = json.report?.level ?? 'LOW'

      setMessages(prev => prev.map(m =>
        m.id === vektorMsgId
          ? {
              ...m,
              loading:      false,
              actionLabel:  `· ROUTING · ${routeLabel} · GUARDIAN ${guardianLevel}`,
              originalText: trimmed,
              guardData:    {
                parsedIntent: json.parsedIntent,
                quote:        json.quote,
                report:       json.report,
                _rawReport:   json._rawReport,
              },
              phase: 'review' as const,
            }
          : m,
      ))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong'
      setMessages(prev => prev.map(m =>
        m.id === vektorMsgId
          ? { ...m, loading: false, actionLabel: '· ERROR', text: errMsg }
          : m,
      ))
    }
  }

  /* ── Fix (rewrite PTB) ────────────────────────────────────────────── */
  async function handleFix(msgId: string) {
    const msg = messages.find(m => m.id === msgId)
    if (!msg?.guardData) return

    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, phase: 'rewriting' as const } : m,
    ))

    try {
      const res  = await fetch('/api/rewrite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rawReport: msg.guardData!._rawReport }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)

      const newLevel = json.report?.level ?? 'LOW'

      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? {
              ...m,
              phase:       'rewritten' as const,
              actionLabel: `· REWRITE · PTB OPTIMIZED · GUARDIAN ${newLevel}`,
              guardData:   {
                ...m.guardData!,
                quote:      json.quote,
                report:     json.report,
                _rawReport: json._rawReport,
              },
            }
          : m,
      ))
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, phase: 'review' as const } : m,
      ))
    }
  }

  /* ── Confirm ──────────────────────────────────────────────────────── */
  function handleConfirm(msgId: string) {
    setMessages(prev => prev.map(m =>
      m.id === msgId
        ? { ...m, phase: 'confirmed' as const, actionLabel: '· CONFIRMED · READY TO EXECUTE' }
        : m,
    ))
  }

  /* ── Wallet label ─────────────────────────────────────────────────── */
  const walletLabel = account
    ? `${account.address.slice(0, 6)}…${account.address.slice(-4)}`
    : null

  /* ── Render ───────────────────────────────────────────────────────── */
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

      {/* ── Messages ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

          {/* Welcome state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-5 text-center select-none">
              <span className="font-display text-6xl text-white">⚡</span>
              <div className="space-y-2">
                <p className="text-white font-semibold tracking-tight">Vektor — Intent Engine for Sui</p>
                <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                  {account
                    ? 'Describe a transaction in plain English. Vektor will route, guard, and build the PTB.'
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

      {/* ── Input Area ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/5 bg-[#0a0a0f]/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">

          {/* Quick action pills */}
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

          {/* Input row */}
          <div className="relative">
            {/* Locked overlay */}
            {!account && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#0a0a0f]/60 backdrop-blur-sm z-10 pointer-events-none">
                <span className="text-sm text-slate-500">Connect wallet to start</span>
              </div>
            )}

            <div className="flex items-end gap-3 bg-[#111118] border border-white/8 rounded-2xl px-4 py-3 focus-within:border-purple-500/25 transition-colors">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  autoResize(e.target)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(input)
                  }
                }}
                disabled={!account}
                placeholder="Ask Vektor anything about your money..."
                rows={1}
                className="flex-1 bg-transparent resize-none text-sm text-white placeholder:text-slate-600 focus:outline-none leading-relaxed"
                style={{ maxHeight: '120px' }}
              />

              <button
                onClick={() => sendMessage(input)}
                disabled={!account || !input.trim()}
                className="shrink-0 w-8 h-8 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-20 disabled:cursor-not-allowed transition-all flex items-center justify-center group"
              >
                <svg
                  className="w-4 h-4 text-white transition-transform group-hover:translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <p className="text-center text-[10px] text-slate-700">
            Routex routing · Guardian v2 · Claude NLP · Sui mainnet
          </p>
        </div>
      </div>
    </div>
  )
}
