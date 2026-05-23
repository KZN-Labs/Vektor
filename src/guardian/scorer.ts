import type { RiskFlag } from './v2.js'

const SEVERITY_WEIGHTS: Record<string, number> = { green: 0, yellow: 15, red: 35 }

const CLASS_WEIGHTS: Record<number, number> = {
  1: 1.2,  // slippage
  2: 1.0,  // oracle
  3: 1.1,  // ghost pool
  4: 1.0,  // price impact
  5: 0.8,  // concentration
  6: 0.9,  // protocol age
  7: 1.3,  // gas anomaly
}

export function calculateScore(flags: RiskFlag[]): number {
  const deductions = flags.reduce((total, flag) => {
    return total + (SEVERITY_WEIGHTS[flag.severity] ?? 0) * (CLASS_WEIGHTS[flag.class] ?? 1)
  }, 0)
  return Math.max(0, Math.min(100, Math.round(100 - deductions)))
}

export function scoreToLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 80) return 'LOW'
  if (score >= 55) return 'MEDIUM'
  if (score >= 30) return 'HIGH'
  return 'CRITICAL'
}
