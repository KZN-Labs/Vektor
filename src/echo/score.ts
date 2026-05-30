/**
 * Echo Score — 0-100 composite portfolio health metric.
 * Four sub-scores of 25 each: Diversification, Yield Efficiency, Debt Health, Risk Exposure.
 */

import type { EchoScore } from './types.js'

interface Portfolio {
  totalUsd: number
  balances: Array<{ symbol: string; usdValue: number; inYieldPosition?: boolean }>
}

interface NaviPositions {
  healthFactor: number | null
  supplyBalances: Record<string, number>
  borrowBalances: Record<string, number>
}

const STABLECOINS  = new Set(['USDC', 'USDT', 'BUCK', 'USDY', 'USDE'])
const MEMECOINS    = new Set(['LOFI', 'BLUB', 'OCEAN', 'HIPPO', 'BONK', 'MEME', 'NAVX'])

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

export function calculateEchoScore(
  portfolio:     Portfolio,
  naviPositions: NaviPositions | null,
): EchoScore {
  const total     = portfolio.totalUsd
  const balances  = portfolio.balances ?? []

  /* ── Diversification (0-25) ──────────────────────────────────────────── */
  let diversification = 25
  if (total > 0 && balances.length > 0) {
    const largest    = Math.max(...balances.map(b => b.usdValue ?? 0))
    const largestPct = largest / total
    // Full 25 if largest < 50%, 0 if largest ≥ 90%
    diversification = clamp(25 - (largestPct - 0.5) * (25 / 0.4), 0, 25)
  }

  /* ── Yield Efficiency (0-25) ─────────────────────────────────────────── */
  let yieldEfficiency = 25
  const stables   = balances.filter(b => STABLECOINS.has(b.symbol))
  const stableUsd = stables.reduce((s, b) => s + (b.usdValue ?? 0), 0)
  // Also count NAVI supply balances as "in yield"
  const naviSupplyUsd = Object.values(naviPositions?.supplyBalances ?? {}).reduce((s, v) => s + v, 0)
  if (stableUsd + naviSupplyUsd > 1) {
    const inYieldUsd = stables
      .filter(b => b.inYieldPosition)
      .reduce((s, b) => s + (b.usdValue ?? 0), 0) + naviSupplyUsd
    yieldEfficiency = clamp((inYieldUsd / (stableUsd + naviSupplyUsd)) * 25, 0, 25)
  }

  /* ── Debt Health (0-25) ──────────────────────────────────────────────── */
  let debtHealth = 25
  const hf = naviPositions?.healthFactor ?? null
  if (hf !== null) {
    // HF ≥ 3 → 25 pts; HF = 1.3 → 0 pts
    debtHealth = clamp(((hf - 1.3) / (3 - 1.3)) * 25, 0, 25)
  }

  /* ── Risk Exposure (0-25) ────────────────────────────────────────────── */
  let riskExposure = 25
  if (total > 0) {
    const memeUsd   = balances
      .filter(b => MEMECOINS.has(b.symbol))
      .reduce((s, b) => s + (b.usdValue ?? 0), 0)
    const memeShare = memeUsd / total
    // 0% meme → 25 pts; ≥ 50% meme → 0 pts
    riskExposure = clamp(25 - memeShare * 50, 0, 25)
  }

  return {
    total:           Math.round(diversification + yieldEfficiency + debtHealth + riskExposure),
    diversification: Math.round(diversification),
    yieldEfficiency: Math.round(yieldEfficiency),
    debtHealth:      Math.round(debtHealth),
    riskExposure:    Math.round(riskExposure),
    lastCalculated:  Date.now(),
  }
}

/** One-line explanation of what's dragging each sub-score down */
export function scoreInsights(score: EchoScore): Record<keyof Omit<EchoScore, 'total' | 'lastCalculated'>, string | null> {
  return {
    diversification: score.diversification < 20 ? 'One asset dominates your portfolio.' : null,
    yieldEfficiency: score.yieldEfficiency < 20  ? 'Idle stablecoins not earning yield.' : null,
    debtHealth:      score.debtHealth < 20        ? 'NAVI health factor is low — consider repaying debt.' : null,
    riskExposure:    score.riskExposure < 20      ? 'High memecoin exposure.' : null,
  }
}
