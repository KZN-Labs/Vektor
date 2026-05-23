/**
 * Vektor API server
 *
 * Runs on port 3001. Handles Claude-powered intent parsing, Routex quotes,
 * Guardian v2 risk scoring, and PTB rewriting.
 *
 * The Vite dev server proxies /api/* → http://localhost:3001/api/*
 *
 * Start: tsx src/server.ts
 */

import 'dotenv/config'
import express    from 'express'
import cors       from 'cors'
import Routex     from 'routex-sui'
import { parseIntent }  from './parser/intent.js'
import { runGuardian }  from './guardian/v2.js'
import { rewritePTB }   from './guardian/rewriter.js'

const app  = express()
const PORT = 3001

const SIM_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001'

const TOKEN_DECIMALS: Record<string, number> = {
  SUI:  1e9, USDC: 1e6, USDT: 1e6, DEEP: 1e6, WETH: 1e8,
  WBTC: 1e8, BUCK: 1e9,
}

function toBaseUnits(amount: number, token: string): bigint {
  const dec = TOKEN_DECIMALS[token.toUpperCase()] ?? 1e9
  return BigInt(Math.round(amount * dec))
}

function serializeQuote(quote: any, fromToken: string, toToken: string) {
  const inDec  = TOKEN_DECIMALS[fromToken.toUpperCase()] ?? 1e9
  const outDec = TOKEN_DECIMALS[toToken.toUpperCase()]   ?? 1e9

  const amountOut = BigInt(quote.amountOut ?? 0)
  const amountIn  = BigInt(quote.amountIn  ?? 0)
  const gas       = BigInt(quote.gasEstimate ?? 0)

  const protocols = Array.from(new Map(
    (quote.route ?? []).map((s: any) => [s.protocol, true])
  ).keys())

  return {
    amountOut:            amountOut.toString(),
    amountOutFormatted:   (Number(amountOut) / outDec).toFixed(outDec >= 1e9 ? 4 : 6),
    amountIn:             amountIn.toString(),
    amountInFormatted:    (Number(amountIn)  / inDec).toFixed(inDec  >= 1e9 ? 4 : 6),
    priceImpact:          quote.priceImpact ?? 0,
    gasEstimate:          gas.toString(),
    gasEstimateFormatted: (Number(gas) / 1e9).toFixed(4),
    validUntil:           quote.validUntil ?? Date.now() + 30_000,
    route:                (quote.route ?? []).map((s: any) => ({ protocol: s.protocol })),
    routeLabel:           protocols.join(' → '),
    hops:                 protocols.length,
    fromSymbol:           fromToken,
    toSymbol:             toToken,
    // Keep raw quote for rewriter
    _raw: {
      amountIn:          amountIn.toString(),
      amountOut:         amountOut.toString(),
      priceImpact:       quote.priceImpact ?? 0,
      gasEstimate:       gas.toString(),
      slippageTolerance: quote.slippageTolerance ?? 0.005,
      validUntil:        quote.validUntil,
      route:             quote.route ?? [],
      fromSymbol:        fromToken,
      toSymbol:          toToken,
    },
  }
}

function serializeReport(report: any) {
  return {
    score:            report.score,
    level:            report.level,
    flags:            report.flags,
    canProceed:       report.canProceed,
    rewriteAvailable: report.rewriteAvailable,
  }
}

app.use(cors())
app.use(express.json())

// ─── POST /api/guard ──────────────────────────────────────────────────────────
// Body: { text: string, senderAddress?: string }
// Returns: { ok, parsedIntent, quote, report }

app.post('/api/guard', async (req, res) => {
  try {
    const { text, senderAddress } = req.body as { text: string; senderAddress?: string }
    const sender = senderAddress || SIM_ADDR

    if (!text?.trim()) {
      res.status(400).json({ ok: false, error: 'text is required' })
      return
    }

    // 1. Parse natural language intent via Claude
    const parsed = await parseIntent(text)

    if (!parsed.input_asset || !parsed.output_goal || !parsed.input_amount) {
      res.status(422).json({
        ok: false,
        error: `Could not extract a complete swap intent. Got: ${parsed.intent_type} — try "swap X SUI to USDC".`,
        parsedIntent: parsed,
      })
      return
    }

    const fromToken = parsed.input_asset.toUpperCase()
    const toToken   = parsed.output_goal.toUpperCase()
    const amountIn  = toBaseUnits(parsed.input_amount, fromToken)

    // 2. Get a live quote from Routex
    const routex = new Routex('mainnet', sender)
    const quote  = await routex.getQuote({
      from:              fromToken,
      to:                toToken,
      amount:            amountIn,
      slippageTolerance: parsed.constraints.max_slippage ?? 0.005,
      senderAddress:     sender,
    })

    // 3. Attach symbols to quote for guardian checks
    const quoteWithSymbols = { ...quote, fromSymbol: fromToken, toSymbol: toToken }

    // 4. Run Guardian v2
    const report = await runGuardian(quoteWithSymbols, sender, null)

    res.json({
      ok:          true,
      parsedIntent: parsed,
      quote:       serializeQuote(quoteWithSymbols, fromToken, toToken),
      report:      serializeReport(report),
      _rawReport:  report, // kept for rewriter
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: msg })
  }
})

// ─── POST /api/rewrite ────────────────────────────────────────────────────────
// Body: { rawReport: GuardianReportV2, senderAddress?: string }
// Returns: { ok, quote, report }

app.post('/api/rewrite', async (req, res) => {
  try {
    const { rawReport, senderAddress } = req.body
    const sender = senderAddress || SIM_ADDR

    if (!rawReport) {
      res.status(400).json({ ok: false, error: 'rawReport is required' })
      return
    }

    const rewritten = await rewritePTB(rawReport, sender, 'mainnet')
    const q         = rewritten.rewrittenQuote ?? rewritten.originalQuote
    const from      = q.fromSymbol ?? rawReport.originalQuote?.fromSymbol ?? 'SUI'
    const to        = q.toSymbol   ?? rawReport.originalQuote?.toSymbol   ?? 'USDC'

    res.json({
      ok:         true,
      quote:      serializeQuote({ ...q, fromSymbol: from, toSymbol: to }, from, to),
      report:     serializeReport(rewritten),
      _rawReport: rewritten,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: msg })
  }
})

app.listen(PORT, () => {
  console.log(`\n  Vektor API  →  http://localhost:${PORT}`)
  console.log(`  Guardian    →  7 risk classes`)
  console.log(`  Parser      →  Claude API (claude-sonnet-4)\n`)
})
