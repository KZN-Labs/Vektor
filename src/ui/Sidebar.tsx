/**
 * Sidebar — collapsible panel with Portfolio, Scheduled, Watching, Positions tabs.
 */

import { useState, useEffect } from 'react'

interface ScheduledItem {
  id:       string
  type:     string
  amount:   number
  token:    string
  targetToken?: string
  schedule: { frequency: string; nextRun: string; completedRuns: number; totalRuns: number }
}

interface ConditionItem {
  id:          string
  description: string
  trigger:     { type: string; asset: string; threshold: number }
}

interface Position {
  id:            string
  token:         string
  entryAmountUsd: number
  profitTarget?: number
  stopLoss?:     number
  openedAt:      string
}

interface Portfolio {
  totalUsd:  number
  balances:  Array<{ symbol: string; formatted: string; usdValue: number }>
  navi?:     { supplyBalances: Record<string, number>; borrowBalances: Record<string, number>; healthFactor: number | null }
}

interface SidebarProps {
  wallet:    string | null
  portfolio: Portfolio | null
  onRefresh: () => void
}

type Tab = 'portfolio' | 'scheduled' | 'watching' | 'positions'

function Empty({ label }: { label: string }) {
  return <p className="text-xs text-slate-600 text-center py-8">{label}</p>
}

export function Sidebar({ wallet, portfolio, onRefresh }: SidebarProps) {
  const [tab,        setTab]        = useState<Tab>('portfolio')
  const [open,       setOpen]       = useState(true)
  const [scheduled,  setScheduled]  = useState<ScheduledItem[]>([])
  const [conditions, setConditions] = useState<ConditionItem[]>([])
  const [positions,  setPositions]  = useState<Position[]>([])

  useEffect(() => {
    if (!wallet) return
    fetch(`/api/schedule/${wallet}`).then(r => r.json()).then(d => setScheduled(d.scheduled ?? [])).catch(() => {})
    fetch(`/api/conditions/${wallet}`).then(r => r.json()).then(d => setConditions(d.conditions ?? [])).catch(() => {})
  }, [wallet, tab])

  async function cancelScheduled(id: string) {
    await fetch(`/api/schedule/${id}`, { method: 'DELETE' })
    setScheduled(prev => prev.filter(s => s.id !== id))
  }

  async function cancelCondition(id: string) {
    await fetch(`/api/conditions/${id}`, { method: 'DELETE' })
    setConditions(prev => prev.filter(c => c.id !== id))
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 bg-[#111118] border border-white/8 text-slate-500 text-xs px-2 py-6 rounded-l-lg hover:border-purple-500/30 hover:text-purple-300 transition-colors z-10"
        title="Open sidebar"
      >
        ‹
      </button>
    )
  }

  return (
    <div className="w-72 shrink-0 border-l border-white/5 bg-[#0d0d12] flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-white/5 shrink-0">
        {(['portfolio', 'scheduled', 'watching', 'positions'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-mono transition-colors ${
              tab === t
                ? 'text-purple-400 border-b border-purple-500'
                : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {t === 'watching' ? 'watch' : t === 'scheduled' ? 'sched' : t === 'positions' ? 'pos' : t.slice(0, 4)}
          </button>
        ))}
        <button
          onClick={() => setOpen(false)}
          className="px-2 text-slate-700 hover:text-slate-400 text-xs"
        >
          ›
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Portfolio tab */}
        {tab === 'portfolio' && (
          <>
            {portfolio ? (
              <>
                <div className="rounded-xl border border-white/5 bg-[#111118] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Total Value</span>
                    <button onClick={onRefresh} className="text-[10px] text-slate-600 hover:text-purple-400 transition-colors">↻</button>
                  </div>
                  <p className="text-2xl font-bold text-white">${portfolio.totalUsd.toFixed(2)}</p>
                </div>

                <div className="space-y-2">
                  {portfolio.balances.slice(0, 6).map(b => (
                    <div key={b.symbol} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#111118] border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-purple-600/20 flex items-center justify-center text-[10px] text-purple-400 font-bold">{b.symbol[0]}</span>
                        <span className="text-sm text-white font-medium">{b.symbol}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-white">{b.formatted}</p>
                        <p className="text-[10px] text-slate-500">${b.usdValue.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                  {portfolio.balances.length === 0 && <Empty label="No token balances detected." />}
                </div>

                {portfolio.navi && (
                  <div className="rounded-xl border border-white/5 bg-[#111118] p-4 space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">NAVI Positions</p>
                    {portfolio.navi.healthFactor !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Health Factor</span>
                        <span className={`text-sm font-bold ${
                          portfolio.navi.healthFactor > 2 ? 'text-emerald-400'
                          : portfolio.navi.healthFactor > 1.5 ? 'text-yellow-400'
                          : 'text-red-400'
                        }`}>{portfolio.navi.healthFactor.toFixed(2)}</span>
                      </div>
                    )}
                    {Object.entries(portfolio.navi.supplyBalances).map(([sym, bal]) => (
                      <div key={sym} className="flex justify-between text-xs">
                        <span className="text-slate-500">↑ {sym} supplied</span>
                        <span className="text-emerald-400">{bal.toFixed(4)}</span>
                      </div>
                    ))}
                    {Object.entries(portfolio.navi.borrowBalances).map(([sym, bal]) => (
                      <div key={sym} className="flex justify-between text-xs">
                        <span className="text-slate-500">↓ {sym} borrowed</span>
                        <span className="text-red-400">{bal.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Empty label={wallet ? 'Loading portfolio…' : 'Connect wallet to view portfolio.'} />
            )}
          </>
        )}

        {/* Scheduled tab */}
        {tab === 'scheduled' && (
          <>
            {scheduled.length === 0 ? (
              <Empty label="No scheduled transactions. Try: DCA 10 USDC into SUI every day for 30 days." />
            ) : scheduled.map(item => (
              <div key={item.id} className="rounded-xl border border-white/5 bg-[#111118] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest">
                    {item.type === 'dca' ? '· DCA' : '· PAYMENT'}
                  </span>
                  <button
                    onClick={() => cancelScheduled(item.id)}
                    className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
                  >
                    cancel
                  </button>
                </div>
                <p className="text-sm text-white">
                  {item.amount} {item.token}{item.targetToken ? ` → ${item.targetToken}` : ''}
                </p>
                <p className="text-xs text-slate-500 capitalize">{item.schedule.frequency}</p>
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>Next: {new Date(item.schedule.nextRun).toLocaleDateString()}</span>
                  {item.schedule.totalRuns > 0 && (
                    <span>{item.schedule.completedRuns}/{item.schedule.totalRuns} runs</span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Watching tab */}
        {tab === 'watching' && (
          <>
            {conditions.length === 0 ? (
              <Empty label='No active conditions. Try: "Swap my SUI to USDC if SUI drops below $3"' />
            ) : conditions.map(c => (
              <div key={c.id} className="rounded-xl border border-white/5 bg-[#111118] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-yellow-400 uppercase tracking-widest">· WATCHING</span>
                  <button
                    onClick={() => cancelCondition(c.id)}
                    className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
                  >
                    cancel
                  </button>
                </div>
                <p className="text-xs text-white leading-relaxed">{c.description}</p>
                <p className="text-[10px] font-mono text-slate-500">
                  {c.trigger.asset} {c.trigger.type === 'price_below' ? '<' : '>'} ${c.trigger.threshold}
                </p>
              </div>
            ))}
          </>
        )}

        {/* Positions tab */}
        {tab === 'positions' && (
          <>
            {positions.length === 0 ? (
              <Empty label='No open positions. Try: "Buy LOFI and exit at 10% profit"' />
            ) : positions.map(p => (
              <div key={p.id} className="rounded-xl border border-white/5 bg-[#111118] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest">· {p.token}</span>
                  <span className="text-[10px] text-slate-600">{new Date(p.openedAt).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-white">${p.entryAmountUsd.toFixed(2)} entry</p>
                {p.profitTarget && (
                  <p className="text-xs text-emerald-400">Target: +{(p.profitTarget * 100).toFixed(0)}%</p>
                )}
                {p.stopLoss && (
                  <p className="text-xs text-red-400">Stop: -{(p.stopLoss * 100).toFixed(0)}%</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
