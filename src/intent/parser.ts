import { v4 as uuidv4 } from 'uuid'
import { resolveToken } from 'routex-sui'
import type { ParseIntentParams, VektorIntent, SlippagePreset } from '../types.js'

const SLIPPAGE_PRESETS: Record<SlippagePreset, number> = {
  low:    0.001,  // 0.1%
  medium: 0.005,  // 0.5%
  high:   0.010,  // 1.0%
}

/**
 * Parses a human-friendly intent description into a canonical VektorIntent.
 *
 * Accepts human-readable amounts ("1.5"), slippage presets ('low' | 'medium' | 'high'),
 * and validates that both tokens are known to the Routex registry.
 */
export function parseIntent(params: ParseIntentParams): VektorIntent {
  const now = Date.now()

  // ── Token resolution ──────────────────────────────────────────────────────
  // resolveToken throws a clear error if the symbol is unknown
  const tokenIn  = resolveToken(params.from)
  const tokenOut = resolveToken(params.to)

  if (tokenIn.symbol === tokenOut.symbol) {
    throw new Error(`Intent error: from and to tokens are the same (${params.from})`)
  }

  // ── Amount → base units ───────────────────────────────────────────────────
  let amountIn: bigint

  if (typeof params.amount === 'bigint') {
    amountIn = params.amount
  } else {
    const human = Number(params.amount)
    if (isNaN(human) || human <= 0) {
      throw new Error(`Intent error: invalid amount "${params.amount}"`)
    }
    amountIn = BigInt(Math.round(human * tokenIn.scalar))
  }

  if (amountIn === 0n) {
    throw new Error('Intent error: amount must be greater than zero')
  }

  // ── Slippage ──────────────────────────────────────────────────────────────
  let slippageTolerance: number

  if (params.slippage === undefined) {
    slippageTolerance = SLIPPAGE_PRESETS.medium  // safe default
  } else if (typeof params.slippage === 'string') {
    slippageTolerance = SLIPPAGE_PRESETS[params.slippage]
  } else {
    slippageTolerance = params.slippage
  }

  if (slippageTolerance < 0 || slippageTolerance > 1) {
    throw new Error(`Intent error: slippage must be between 0 and 1, got ${slippageTolerance}`)
  }

  // ── Price impact threshold ────────────────────────────────────────────────
  const maxPriceImpact = params.maxPriceImpact ?? 0.03  // 3% default

  // ── Deadline ──────────────────────────────────────────────────────────────
  // Default 28 s — leaves a 2 s buffer before the Routex 30 s quote TTL
  const deadlineSec = params.deadlineSeconds ?? 28
  const deadline = now + deadlineSec * 1_000

  return {
    id: uuidv4(),
    action: params.action,
    from: tokenIn.symbol,
    to:   tokenOut.symbol,
    amountIn,
    slippageTolerance,
    maxPriceImpact,
    deadline,
    createdAt: now,
  }
}
