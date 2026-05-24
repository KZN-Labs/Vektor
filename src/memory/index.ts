/**
 * Per-wallet session memory.
 * Keyed to wallet address. Loaded into Claude system prompt on each new session.
 */

import fs             from 'fs'
import path           from 'path'
import { randomUUID } from 'crypto'

const MEMORY_DIR = path.resolve(process.cwd(), 'data/memory')

export interface UserAlert {
  id:        string
  type:      'health_factor' | 'scheduled' | 'condition' | 'position' | 'yield' | 'general'
  message:   string
  severity:  'info' | 'warning' | 'critical'
  seen:      boolean
  createdAt: string
}

export interface UserMemory {
  wallet:              string
  lastSeen:            string
  preferences: {
    riskTolerance:     'low' | 'medium' | 'high'
    preferredProtocols: string[]
    typicalAmounts:    Record<string, number>
  }
  portfolioSnapshot?:     any
  conversationSummary?:   string
  naviHealthFactor?:      number
  pendingAlerts:          UserAlert[]
  stats: {
    totalIntents:    number
    totalSwapVolume: number
    firstSeen:       string
  }
}

function memPath(wallet: string): string {
  fs.mkdirSync(MEMORY_DIR, { recursive: true })
  return path.join(MEMORY_DIR, `${wallet.toLowerCase()}.json`)
}

export function getMemory(wallet: string): UserMemory {
  const p = memPath(wallet)
  if (!fs.existsSync(p)) {
    return {
      wallet,
      lastSeen:    new Date().toISOString(),
      preferences: { riskTolerance: 'medium', preferredProtocols: [], typicalAmounts: {} },
      pendingAlerts: [],
      stats:       { totalIntents: 0, totalSwapVolume: 0, firstSeen: new Date().toISOString() },
    }
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as UserMemory
}

export function saveMemory(mem: UserMemory): void {
  mem.lastSeen = new Date().toISOString()
  fs.mkdirSync(MEMORY_DIR, { recursive: true })
  fs.writeFileSync(memPath(mem.wallet), JSON.stringify(mem, null, 2))
}

export function updatePortfolioSnapshot(wallet: string, snapshot: any): void {
  const mem = getMemory(wallet)
  mem.portfolioSnapshot = snapshot
  saveMemory(mem)
}

export function updateHealthFactor(wallet: string, hf: number): void {
  const mem = getMemory(wallet)
  mem.naviHealthFactor = hf
  saveMemory(mem)
}

export function addAlert(wallet: string, alert: Omit<UserAlert, 'id' | 'seen' | 'createdAt'>): void {
  const mem = getMemory(wallet)
  mem.pendingAlerts.push({
    ...alert,
    id:        randomUUID(),
    seen:      false,
    createdAt: new Date().toISOString(),
  })
  saveMemory(mem)
}

export function markAlertsSeen(wallet: string): void {
  const mem = getMemory(wallet)
  mem.pendingAlerts = mem.pendingAlerts.map(a => ({ ...a, seen: true }))
  saveMemory(mem)
}

export function getUnseenAlerts(wallet: string): UserAlert[] {
  return getMemory(wallet).pendingAlerts.filter(a => !a.seen)
}

export function incrementIntentCount(wallet: string, swapAmountUsd = 0): void {
  const mem = getMemory(wallet)
  mem.stats.totalIntents++
  mem.stats.totalSwapVolume += swapAmountUsd
  saveMemory(mem)
}

/** Build a concise context string for the Claude system prompt. */
export function buildMemoryContext(wallet: string): string {
  const mem = getMemory(wallet)
  const lines: string[] = [`User wallet: ${wallet}`]

  if (mem.portfolioSnapshot?.totalUsd) {
    lines.push(`Portfolio value: $${mem.portfolioSnapshot.totalUsd.toFixed(2)}`)
    if (mem.portfolioSnapshot.balances?.length) {
      const top = mem.portfolioSnapshot.balances.slice(0, 5)
        .map((b: any) => `${b.symbol} ${b.formatted}`)
        .join(', ')
      lines.push(`Holdings: ${top}`)
    }
  }

  if (mem.naviHealthFactor) {
    lines.push(`NAVI health factor: ${mem.naviHealthFactor.toFixed(2)}`)
  }

  if (mem.preferences.riskTolerance !== 'medium') {
    lines.push(`Risk preference: ${mem.preferences.riskTolerance}`)
  }

  if (mem.stats.totalIntents > 0) {
    lines.push(`Total intents executed: ${mem.stats.totalIntents}`)
  }

  if (mem.conversationSummary) {
    lines.push(`Previous context: ${mem.conversationSummary}`)
  }

  return lines.join('\n')
}
