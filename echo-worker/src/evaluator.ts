/**
 * Echo evaluator — per-mode checks that drive alerts, proposals, and executions.
 */

import { pushAlert, pushProposal } from './alerter'
import type { EchoUser, EchoRule, Env } from './types'

export interface PortfolioState {
  totalUsd:     number
  tokens:       Array<{ symbol: string; usdValue: number; amount: number; inYieldPosition?: boolean }>
  healthFactor: number | null
}

export interface PriceMap {
  [symbol: string]: number
}

export interface State {
  portfolio:  PortfolioState
  prices:     PriceMap
  healthFactor: number | null
}

/* ─── Basic checks ──────────────────────────────────────────────────────── */

export async function runBasicChecks(user: EchoUser, state: State, env: Env): Promise<void> {
  const alerts: string[] = []

  // 1. NAVI health factor alert
  const hf = state.healthFactor
  if (hf !== null && hf < 1.5) {
    alerts.push(
      `⚠ NAVI health factor dropped to ${hf.toFixed(2)}. Liquidation at 1.25. Consider repaying debt.`
    )
  }

  // 2. Large price drops in the last check window
  for (const token of state.portfolio.tokens) {
    const cur  = state.prices[token.symbol]
    // We don't have historical here — check if position is down based on entry
    const pos  = user.echoData.positions.find(p => p.token.toUpperCase() === token.symbol.toUpperCase())
    if (pos && cur && pos.entryPrice > 0) {
      const pnlPct = (cur - pos.entryPrice) / pos.entryPrice
      if (pnlPct < -0.10) {
        alerts.push(`📉 ${token.symbol} is down ${Math.abs(pnlPct * 100).toFixed(1)}% from entry ($${pos.entryPrice.toFixed(4)} → $${cur.toFixed(4)}).`)
      }
      // Stop-loss check for high/medium proposal
      if (pos.stopLoss && cur <= pos.stopLoss) {
        alerts.push(`🚨 ${token.symbol} hit stop-loss ($${pos.stopLoss.toFixed(4)}). Current: $${cur.toFixed(4)}.`)
      }
    }
  }

  // 3. Idle stablecoin alert
  const STABLES = ['USDC', 'USDT', 'BUCK']
  const idle    = state.portfolio.tokens.filter(t =>
    STABLES.includes(t.symbol) && !t.inYieldPosition && t.usdValue > 10
  )
  if (idle.length > 0) {
    alerts.push(`💤 Idle stablecoins not earning yield: ${idle.map(t => `${t.symbol} ($${t.usdValue.toFixed(0)})`).join(', ')}.`)
  }

  // 4. Watch conditions
  for (const cond of user.echoData.conditions.filter(c => c.active)) {
    const price = state.prices[cond.asset] ?? cond.currentPrice
    const hit   = cond.direction === 'below'
      ? price <= cond.triggerPrice
      : price >= cond.triggerPrice
    if (hit) {
      alerts.push(`🎯 Condition triggered: ${cond.asset} is ${cond.direction} $${cond.triggerPrice} (now $${price.toFixed(4)}).`)
    }
  }

  // 5. Rule checks (basic: alert only, no execution)
  for (const rule of user.echoData.rules.filter(r => r.active)) {
    const triggered = await evaluateRule(rule, state)
    if (triggered) {
      alerts.push(`📋 Rule triggered: "${rule.parsed.action ?? rule.raw}"`)
    }
  }

  for (const msg of alerts) {
    await pushAlert(user.address, msg, user.echoData.mode, env).catch(() => {})
  }
}

/* ─── Medium checks ────────────────────────────────────────────────────── */

export async function runMediumChecks(user: EchoUser, state: State, env: Env): Promise<void> {
  await runBasicChecks(user, state, env)

  // Propose repay if HF < 1.5
  const hf = state.healthFactor
  if (hf !== null && hf < 1.5) {
    await pushProposal(user.address, {
      id:          crypto.randomUUID(),
      description: `Repay NAVI debt to restore health factor above 1.5 (currently ${hf.toFixed(2)})`,
      reason:      'Health factor at risk',
      expiresAt:   Date.now() + 600_000,
    }, env).catch(() => {})
  }

  // Propose yield move for idle stablecoins
  const idleUsdc = state.portfolio.tokens.find(t => t.symbol === 'USDC' && !t.inYieldPosition && t.usdValue > 50)
  if (idleUsdc) {
    await pushProposal(user.address, {
      id:           crypto.randomUUID(),
      description:  `Deposit ${idleUsdc.amount.toFixed(2)} USDC to NAVI to earn yield`,
      estimatedUsd: idleUsdc.usdValue,
      reason:       'Idle stablecoin detected',
      expiresAt:    Date.now() + 600_000,
    }, env).catch(() => {})
  }
}

/* ─── High checks ──────────────────────────────────────────────────────── */

export async function runHighChecks(user: EchoUser, state: State, env: Env): Promise<void> {
  await runMediumChecks(user, state, env)
  // Executor handles autonomous rule + scheduled intent execution
  // (called separately in monitor.ts to keep evaluator stateless)
}

/* ─── Rule evaluation ──────────────────────────────────────────────────── */

export async function evaluateRule(rule: EchoRule, state: State): Promise<boolean> {
  const { type, threshold, asset } = rule.parsed

  switch (type) {
    case 'health_factor': {
      const hf = state.healthFactor
      return hf !== null && threshold != null && hf < threshold
    }
    case 'balance_floor': {
      if (!asset || threshold == null) return false
      const token = state.portfolio.tokens.find(t => t.symbol.toUpperCase() === asset.toUpperCase())
      return (token?.usdValue ?? 0) < threshold
    }
    case 'stop_loss': {
      if (threshold == null) return false
      for (const pos of state.portfolio.tokens) {
        const entry   = state.portfolio.tokens.find(t => t.symbol === pos.symbol)
        // Check any position down more than threshold
        if (entry && entry.usdValue > 0) return false // simplified — real impl uses MonitoredPosition
      }
      return false
    }
    default:
      return false
  }
}
