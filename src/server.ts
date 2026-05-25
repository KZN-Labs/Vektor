/**
 * Vektor API server — full financial OS for Sui.
 *
 * Unified /api/intent endpoint handles all 22 intent types.
 * Runs on port 3001. Vite proxies /api/* → http://localhost:3001/api/*
 *
 * Start: tsx src/server.ts
 */

import 'dotenv/config'
import fs               from 'fs'
import path             from 'path'
import express          from 'express'
import cors             from 'cors'
import Routex           from 'routex-sui'
import { complete, activeProvider } from './ai/client.js'

import { parseIntent }          from './parser/intent.js'
import { runGuardian }          from './guardian/v2.js'
import { rewritePTB }           from './guardian/rewriter.js'
import { fetchPortfolio, fetchTransaction } from './portfolio/fetcher.js'
import { getHealthFactor, getNaviPositions, getPoolRates,
         buildDepositPTB, buildBorrowPTB, buildRepayPTB } from './navi/client.js'
import { explainTransaction }   from './explainer/index.js'
import { createPaymentRequest, getPaymentStatus, fulfillPayment } from './payments/index.js'
import {
  addScheduled, getScheduled, cancelScheduled,
  addCondition, getConditions, cancelCondition,
  getPositions, addPosition, cancelCondition as removeCondition,
} from './db/store.js'
import {
  getMemory, saveMemory, buildMemoryContext,
  getUnseenAlerts, markAlertsSeen, updatePortfolioSnapshot,
  addAlert, incrementIntentCount, logIntent,
} from './memory/index.js'
import { startScheduler }        from './scheduler/worker.js'
import { startConditionMonitor, getCurrentPrice, getAllPrices } from './conditions/monitor.js'
import { startAlertMonitor, registerWallet }     from './alerts/monitor.js'

/* ─── VektorRegistry — local JSON counter ────────────────────────────────── */

const REGISTRY_FILE = path.resolve(process.cwd(), 'data/registry.json')

interface Registry { total_transactions: number; total_rewrites: number; last_updated: string }
function loadRegistry(): Registry {
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')) }
  catch { return { total_transactions: 0, total_rewrites: 0, last_updated: new Date().toISOString() } }
}
function saveRegistry(r: Registry): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ ...r, last_updated: new Date().toISOString() }, null, 2))
}
function bumpRegistry(field: 'total_transactions' | 'total_rewrites'): void {
  const r = loadRegistry(); r[field]++; saveRegistry(r)
}

const app    = express()
const PORT   = 3001

// Serialize BigInt values as strings so res.json() never throws
app.set('json replacer', (_key: string, val: unknown) =>
  typeof val === 'bigint' ? val.toString() : val
)

const SIM_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001'

const TOKEN_DECIMALS: Record<string, number> = {
  SUI: 1e9, USDC: 1e6, USDT: 1e6, DEEP: 1e6, WETH: 1e8, WBTC: 1e8, BUCK: 1e9,
}

function toBaseUnits(amount: number, token: string): bigint {
  return BigInt(Math.round(amount * (TOKEN_DECIMALS[token.toUpperCase()] ?? 1e9)))
}

function serializeQuote(quote: any, from: string, to: string) {
  const inDec  = TOKEN_DECIMALS[from.toUpperCase()] ?? 1e9
  const outDec = TOKEN_DECIMALS[to.toUpperCase()]   ?? 1e9
  const amountOut = BigInt(quote.amountOut ?? 0)
  const amountIn  = BigInt(quote.amountIn  ?? 0)
  const gas       = BigInt(quote.gasEstimate ?? 0)
  const protocols = Array.from(new Map((quote.route ?? []).map((s: any) => [s.protocol, true])).keys())
  return {
    amountOut: amountOut.toString(),
    amountOutFormatted: (Number(amountOut) / outDec).toFixed(outDec >= 1e9 ? 4 : 6),
    amountIn:  amountIn.toString(),
    amountInFormatted: (Number(amountIn) / inDec).toFixed(inDec >= 1e9 ? 4 : 6),
    priceImpact: quote.priceImpact ?? 0,
    gasEstimate: gas.toString(),
    gasEstimateFormatted: (Number(gas) / 1e9).toFixed(4),
    validUntil:  quote.validUntil ?? Date.now() + 30_000,
    route: (quote.route ?? []).map((s: any) => ({ protocol: s.protocol })),
    routeLabel: protocols.join(' → '),
    hops: protocols.length,
    fromSymbol: from,
    toSymbol:   to,
    _raw: {
      amountIn: amountIn.toString(), amountOut: amountOut.toString(),
      priceImpact: quote.priceImpact ?? 0, gasEstimate: gas.toString(),
      slippageTolerance: quote.slippageTolerance ?? 0.005,
      validUntil: quote.validUntil,
      fromSymbol: from, toSymbol: to,
    },
  }
}

function serializeReport(r: any) {
  return { score: r.score, level: r.level, flags: r.flags, canProceed: r.canProceed, rewriteAvailable: r.rewriteAvailable }
}

/* ─── Parse next-run date for scheduler ─────────────────────────────────── */

function calcNextRun(spec: any): string {
  const now  = new Date()
  if (!spec) return now.toISOString()
  if (spec.date) return new Date(spec.date).toISOString()
  if (spec.frequency === 'once') return now.toISOString()
  if (spec.frequency === 'daily') {
    const next = new Date(now); next.setDate(now.getDate() + 1); next.setHours(12, 0, 0, 0)
    return next.toISOString()
  }
  if (spec.frequency === 'weekly') {
    const dayMap: Record<string, number> = { sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6 }
    const target = dayMap[spec.day_of_week?.toLowerCase() ?? 'monday'] ?? 1
    const next   = new Date(now)
    const ahead  = (target + 7 - now.getDay()) % 7 || 7
    next.setDate(now.getDate() + ahead); next.setHours(12, 0, 0, 0)
    return next.toISOString()
  }
  return now.toISOString()
}

app.use(cors())
app.use(express.json())

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/intent  — unified intent handler
   Body: { text: string, senderAddress?: string }
   Returns unified response based on intent_type
───────────────────────────────────────────────────────────────────────── */

app.post('/api/intent', async (req, res) => {
  try {
    const { text, senderAddress } = req.body as { text: string; senderAddress?: string }
    const sender = senderAddress || SIM_ADDR
    if (!text?.trim()) { res.status(400).json({ ok: false, error: 'text is required' }); return }

    // Load memory context for the user
    const memCtx  = sender !== SIM_ADDR ? buildMemoryContext(sender) : undefined
    const parsed  = await parseIntent(text, memCtx)
    const intent  = parsed.intent_type

    // Register wallet for monitoring
    if (sender !== SIM_ADDR) {
      registerWallet(sender)
      incrementIntentCount(sender)
      logIntent(sender, { type: intent, summary: text.slice(0, 120), status: 'success' })
      // Bump registry on swap/memecoin types
      const swapTypes = ['swap', 'compound', 'rebalance', 'buy_memecoin', 'sell_memecoin', 'exit_at_profit', 'exit_at_loss']
      if (swapTypes.includes(intent)) bumpRegistry('total_transactions')
    }

    /* ── READ-ONLY intents ────────────────────────────────────────── */

    if (intent === 'check_balance' || intent === 'analyze_wallet') {
      const portfolio = await fetchPortfolio(sender)
      if (sender !== SIM_ADDR) updatePortfolioSnapshot(sender, portfolio)
      const totalStr  = `$${portfolio.totalUsd.toFixed(2)}`
      const assets    = portfolio.balances.slice(0, 5).map(b => `${b.symbol} ${b.formatted}`).join(', ')
      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        portfolio,
        message:     `Portfolio: ${totalStr} total. Holdings: ${assets || 'none detected'}.${portfolio.navi ? ` NAVI health: ${portfolio.navi.healthFactor?.toFixed(2) ?? 'n/a'}` : ''}`,
        actionLabel: `· PORTFOLIO · ${totalStr}`,
      })
      return
    }

    if (intent === 'check_health_factor') {
      const hf = await getHealthFactor(sender)
      const level = hf === null ? 'unknown' : hf > 2 ? 'safe' : hf > 1.5 ? 'moderate' : hf > 1.3 ? 'warning' : 'danger'
      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        healthFactor: hf,
        message:      hf === null
          ? 'No active NAVI borrow positions found, or could not fetch health factor.'
          : `Your NAVI health factor is ${hf.toFixed(2)} (${level}). Liquidation threshold is 1.0.`,
        actionLabel:  `· HEALTH FACTOR · ${hf?.toFixed(2) ?? 'N/A'}`,
      })
      return
    }

    if (intent === 'check_positions') {
      const [naviPos, positions] = await Promise.allSettled([
        getNaviPositions(sender),
        Promise.resolve(getPositions(sender)),
      ])
      const navi  = naviPos.status  === 'fulfilled' ? naviPos.value  : []
      const memes = positions.status === 'fulfilled' ? positions.value : []
      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        naviPositions: navi, memePositions: memes,
        message: [
          navi.length  ? `NAVI: ${navi.map(p => `${p.supplyBalance.toFixed(2)} ${p.symbol} supplied`).join(', ')}` : '',
          memes.length ? `Open positions: ${memes.map(p => p.token).join(', ')}` : '',
          !navi.length && !memes.length ? 'No open positions found.' : '',
        ].filter(Boolean).join(' '),
        actionLabel: `· POSITIONS · ${navi.length + memes.length} OPEN`,
      })
      return
    }

    if (intent === 'explain_transaction') {
      const input  = parsed.tx_digest ?? text
      const result = await explainTransaction(input)
      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        explanation: result,
        message:     result.explanation,
        actionLabel: `· EXPLAIN · TX ${result.digest.slice(0, 8)}…`,
      })
      return
    }

    /* ── Payment request ──────────────────────────────────────────── */

    if (intent === 'request_payment') {
      const token  = (parsed.output_goal ?? 'USDC').toUpperCase()
      const amount = parsed.input_amount ?? 0
      const link   = createPaymentRequest(sender, token, amount, text)
      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        payment:     link.payment,
        paymentLink: link.link,
        message:     `Payment request created: ${amount} ${token}. Share this link: ${link.link}`,
        actionLabel: `· PAYMENT REQUEST · ${amount} ${token}`,
      })
      return
    }

    /* ── Send (direct transfer) ───────────────────────────────────── */

    if (intent === 'send') {
      const token     = (parsed.input_asset ?? 'SUI').toUpperCase()
      const amount    = parsed.input_amount ?? 0
      const recipient = parsed.recipient ?? ''
      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        message:     `Ready to send ${amount} ${token} to ${recipient.slice(0, 8)}…${recipient.slice(-4)}. Confirm to proceed.`,
        actionLabel: `· SEND · ${amount} ${token}`,
        ptbType:     'send',
        ptbParams:   { token, amount, recipient },
      })
      return
    }

    /* ── NAVI: lend / borrow / repay ──────────────────────────────── */

    if (intent === 'lend') {
      const token   = (parsed.input_asset ?? 'USDC').toUpperCase()
      const amount  = parsed.input_amount ?? 0
      const rates   = await getPoolRates(token).catch(() => null)
      const supplyApy = rates ? `${(Number((rates as any).base_supply_rate ?? 0) * 100).toFixed(2)}% APY` : ''

      let ptbB64: string | null = null
      try { ptbB64 = await buildDepositPTB(sender, token, amount) } catch { /* skip if wallet not available */ }

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        poolRates:   rates,
        ptbB64,
        message:     `Lending ${amount} ${token} on NAVI.${supplyApy ? ` Current supply APY: ${supplyApy}.` : ''} Guardian will run before execution.`,
        actionLabel: `· LEND · ${amount} ${token} → NAVI${supplyApy ? ` · ${supplyApy}` : ''}`,
      })
      return
    }

    if (intent === 'borrow') {
      const token   = (parsed.input_asset ?? parsed.output_goal ?? 'USDC').toUpperCase()
      const amount  = parsed.input_amount ?? 0
      const hf      = await getHealthFactor(sender)
      const safeToBorrow = hf === null || hf > 1.5

      let ptbB64: string | null = null
      try { ptbB64 = await buildBorrowPTB(sender, token, amount) } catch { /* skip */ }

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        healthFactor: hf,
        safeToBorrow,
        ptbB64,
        message: safeToBorrow
          ? `Borrowing ${amount} ${token} from NAVI. Current health factor: ${hf?.toFixed(2) ?? 'n/a'}. Guardian will run before execution.`
          : `⚠️ Health factor ${hf?.toFixed(2)} is too low to safely borrow. Repay existing debt first.`,
        actionLabel: `· BORROW · ${amount} ${token} · HEALTH ${hf?.toFixed(2) ?? '?'}`,
      })
      return
    }

    if (intent === 'repay') {
      const token  = (parsed.input_asset ?? parsed.output_goal ?? 'USDC').toUpperCase()
      const amount = parsed.input_amount ?? 0

      let ptbB64: string | null = null
      try { ptbB64 = await buildRepayPTB(sender, token, amount) } catch { /* skip */ }

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        ptbB64,
        message:     `Repaying ${amount} ${token} on NAVI. Guardian will run before execution.`,
        actionLabel: `· REPAY · ${amount} ${token} → NAVI`,
      })
      return
    }

    /* ── Schedule / DCA ───────────────────────────────────────────── */

    if (intent === 'schedule' || intent === 'dca') {
      const token       = (parsed.input_asset ?? 'USDC').toUpperCase()
      const targetToken = (parsed.output_goal ?? 'SUI').toUpperCase()
      const amount      = parsed.input_amount ?? 0
      const spec        = parsed.schedule
      const isDca       = intent === 'dca'
      const nextRun     = calcNextRun(spec)
      const totalRuns   = spec?.runs ?? (isDca ? 30 : 1)

      const record = addScheduled({
        wallet:      sender,
        type:        isDca ? 'dca' : (spec?.frequency === 'once' ? 'one-time' : 'payment'),
        intent:      parsed,
        amount,
        token,
        targetToken: isDca ? targetToken : undefined,
        recipient:   parsed.recipient ?? undefined,
        schedule: {
          frequency:    spec?.frequency ?? 'daily',
          dayOfWeek:    spec?.day_of_week,
          date:         spec?.date,
          totalRuns,
          completedRuns: 0,
          nextRun,
        },
        active: true,
      })

      const freqLabel = spec?.frequency === 'weekly'
        ? `EVERY ${(spec.day_of_week ?? 'WEEK').toUpperCase()}`
        : spec?.frequency === 'once' ? 'ONE-TIME'
        : `EVERY ${(spec?.frequency ?? 'DAY').toUpperCase()}`

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        scheduled:   record,
        message:     isDca
          ? `DCA set up: ${amount} ${token} → ${targetToken} ${freqLabel.toLowerCase()}${totalRuns > 1 ? ` for ${totalRuns} runs` : ''}. First run: ${new Date(nextRun).toLocaleDateString()}.`
          : `Payment scheduled: ${amount} ${token}${parsed.recipient ? ` to ${parsed.recipient.slice(0, 8)}…` : ''} ${freqLabel.toLowerCase()}. Next: ${new Date(nextRun).toLocaleDateString()}.`,
        actionLabel: `· ${isDca ? 'DCA' : 'SCHEDULED'} · ${amount} ${token}${isDca ? ` → ${targetToken}` : ''} · ${freqLabel}`,
      })
      return
    }

    /* ── Conditional execution ────────────────────────────────────── */

    if (intent === 'conditional') {
      const { trigger_price, trigger_asset, trigger_direction } = parsed.constraints
      const assetSym  = (trigger_asset ?? 'SUI').toUpperCase()
      const threshold = trigger_price ?? 0
      const dir       = trigger_direction ?? 'below'
      const currentPx = getCurrentPrice(assetSym)

      const record = addCondition({
        wallet:      sender,
        description: text,
        trigger: {
          type:      dir === 'below' ? 'price_below' : 'price_above',
          asset:     assetSym,
          threshold,
        },
        action:      parsed,
        autoExecute: false,
      })

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        condition:    record,
        currentPrice: currentPx,
        message:      `Condition armed: will trigger when ${assetSym} goes ${dir} $${threshold}. Current price: $${currentPx?.toFixed(4) ?? '?'}. Polling every 30s.`,
        actionLabel:  `· WATCH · ${assetSym} ${dir === 'below' ? '<' : '>'} $${threshold} · ARMED`,
      })
      return
    }

    /* ── Memecoin: buy / sell / exit_at_profit / exit_at_loss ─────── */

    if (intent === 'buy_memecoin' || intent === 'exit_at_profit' || intent === 'exit_at_loss') {
      const fromToken  = (parsed.input_asset ?? 'USDC').toUpperCase()
      const memeToken  = (parsed.output_goal ?? 'LOFI').toUpperCase()
      const amount     = parsed.input_amount ?? 0
      const amountIn   = toBaseUnits(amount, fromToken)

      const routex  = new Routex('mainnet', sender)
      const quote   = await routex.getQuote({
        from:              fromToken,
        to:                memeToken,
        amount:            amountIn,
        slippageTolerance: parsed.constraints.max_slippage ?? 0.02, // higher for memecoins
        senderAddress:     sender,
      }).catch(() => ({ amountOut: 0, amountIn: Number(amountIn), priceImpact: 0.05, route: [], gasEstimate: 0, validUntil: Date.now() + 30000 }))

      const quoteWithSym = { ...quote, fromSymbol: fromToken, toSymbol: memeToken }
      const report       = await runGuardian(quoteWithSym, sender, null)

      // Track position if auto-exit
      if (parsed.profit_target || parsed.stop_loss) {
        addPosition({
          wallet:         sender,
          token:          memeToken,
          entryAmountUsd: amount,
          entryPrice:     0, // fetched at execution
          profitTarget:   parsed.profit_target ?? undefined,
          stopLoss:       parsed.stop_loss ?? undefined,
          autoExit:       true,
        })
      }

      const label = parsed.profit_target
        ? `· BUY ${memeToken} · TARGET +${(parsed.profit_target * 100).toFixed(0)}% · SCORE ${report.score}/100`
        : parsed.stop_loss
        ? `· BUY ${memeToken} · STOP -${(parsed.stop_loss * 100).toFixed(0)}% · SCORE ${report.score}/100`
        : `· MEMECOIN · ${fromToken} → ${memeToken} · SCORE ${report.score}/100`

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        quote:    serializeQuote(quoteWithSym, fromToken, memeToken),
        report:   serializeReport(report),
        _rawReport: report,
        quoteParams: { from: fromToken, to: memeToken, amountIn: toBaseUnits(amount, fromToken).toString(), slippage: parsed.constraints.max_slippage ?? 0.005, sender },
        message:  `Routing ${amount} ${fromToken} into ${memeToken}. Guardian flagged: ${report.flags.filter(f=>f.severity!=='green').map(f=>f.title).join(', ') || 'all clear'}.`,
        actionLabel: label,
      })
      return
    }

    if (intent === 'sell_memecoin' || intent === 'exit') {
      const memeToken = (parsed.input_asset ?? parsed.output_goal ?? 'LOFI').toUpperCase()
      const toToken   = 'USDC'
      const amount    = parsed.input_amount ?? 0

      res.json({
        ok: true, intent_type: intent, parsedIntent: parsed,
        message:     `Exiting ${memeToken} position${amount ? ` for ${amount} ${memeToken}` : ' (full position)'}. Routing to ${toToken} via Routex.`,
        actionLabel: `· EXIT · ${memeToken} → ${toToken}`,
        ptbType:     'exit',
        ptbParams:   { fromToken: memeToken, toToken, amount },
      })
      return
    }

    /* ── SWAP / COMPOUND / REBALANCE / RISK_QUALIFIED (Routex) ───── */

    const fromToken = (parsed.input_asset ?? 'SUI').toUpperCase()
    const toToken   = (parsed.output_goal ?? 'USDC').toUpperCase()

    if (!parsed.input_asset || !parsed.output_goal || !parsed.input_amount) {
      // Conversational fallback — ask Claude to respond naturally
      const mem  = sender !== SIM_ADDR ? buildMemoryContext(sender) : ''
      const msg  = (await complete({
        system:    `You are Vektor, a DeFi financial OS for Sui. Be concise and helpful. ${mem}`,
        prompt:    text,
        maxTokens: 300,
      })).trim() || 'How can I help?'
      res.json({ ok: true, intent_type: 'general', parsedIntent: parsed, message: msg, actionLabel: '· VEKTOR' })
      return
    }

    const amountIn = toBaseUnits(parsed.input_amount, fromToken)
    const routex   = new Routex('mainnet', sender)

    // SEAL_V1.5 — encrypt intent here using Seal SDK before submission
    // Prevents front-running by keeping intent private until execution moment
    // Do not implement now. Reserved for v1.5.

    const quote = await routex.getQuote({
      from:              fromToken,
      to:                toToken,
      amount:            amountIn,
      slippageTolerance: parsed.constraints.max_slippage ?? 0.005,
      senderAddress:     sender,
    })

    const quoteWithSym = { ...quote, fromSymbol: fromToken, toSymbol: toToken }
    const report       = await runGuardian(quoteWithSym, sender, null)

    res.json({
      ok: true, intent_type: intent, parsedIntent: parsed,
      quote:    serializeQuote(quoteWithSym, fromToken, toToken),
      report:   serializeReport(report),
      _rawReport: report,
      // Store params so client can request a fresh PTB at execution time
      quoteParams: {
        from:      fromToken,
        to:        toToken,
        amountIn:  amountIn.toString(),
        slippage:  parsed.constraints.max_slippage ?? 0.005,
        sender,
      },
      actionLabel: (() => {
        const protocols = (quote.route ?? []).map((s: any) => s.protocol.toUpperCase())
        const chain = protocols.length
          ? [fromToken, ...protocols, toToken].join(' → ')
          : `${fromToken} → ${toToken}`
        return `· SWAP · ${chain} · SCORE ${report.score}/100`
      })(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: msg })
  }
})

/* ─── POST /api/guard (backward compat) ───────────────────────────────── */

app.post('/api/guard', async (req, res) => {
  req.body.text = req.body.text ?? req.body.input
  return app._router.handle(
    { ...req, url: '/api/intent', path: '/api/intent' } as any,
    res,
    () => {},
  )
})

/* ─── POST /api/rewrite ───────────────────────────────────────────────── */

app.post('/api/rewrite', async (req, res) => {
  try {
    const { rawReport, senderAddress } = req.body
    const sender = senderAddress || SIM_ADDR
    if (!rawReport) { res.status(400).json({ ok: false, error: 'rawReport is required' }); return }
    const rewritten = await rewritePTB(rawReport, sender, 'mainnet')
    const q    = rewritten.rewrittenQuote ?? rewritten.originalQuote
    const from = q.fromSymbol ?? rawReport.originalQuote?.fromSymbol ?? 'SUI'
    const to   = q.toSymbol   ?? rawReport.originalQuote?.toSymbol   ?? 'USDC'

    // Bump registry
    bumpRegistry('total_rewrites')

    // Build before/after diff for the UI
    const origQ = rawReport.originalQuote ?? {}
    const diff  = {
      before: {
        score:      rawReport.score ?? 0,
        amountOut:  origQ.amountOut  ?? '0',
        priceImpact: origQ.priceImpact ?? 0,
        route:      (origQ.route ?? []).map((s: any) => s.protocol),
      },
      after: {
        score:      rewritten.score ?? 0,
        amountOut:  q.amountOut  ?? '0',
        priceImpact: q.priceImpact ?? 0,
        route:      (q.route ?? []).map((s: any) => s.protocol),
      },
    }

    res.json({
      ok: true,
      quote:      serializeQuote({ ...q, fromSymbol: from, toSymbol: to }, from, to),
      report:     serializeReport(rewritten),
      _rawReport: rewritten,
      diff,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

/* ─── Guardian simulation ─────────────────────────────────────────────── */

app.post('/api/simulate', async (req, res) => {
  try {
    const { txDigest, senderAddress } = req.body
    const sender = senderAddress || SIM_ADDR

    if (txDigest) {
      // Simulate from an on-chain tx
      const tx    = await fetchTransaction(txDigest)
      const bc    = (tx as any).balanceChanges ?? []
      const inB   = bc.find((b: any) => Number(b.amount) < 0)
      const outB  = bc.find((b: any) => Number(b.amount) > 0)
      const fakeQuote = {
        amountIn:    Math.abs(Number(inB?.amount ?? 0)).toString(),
        amountOut:   Math.abs(Number(outB?.amount ?? 0)).toString(),
        priceImpact: 0.001,
        gasEstimate: '5000000',
        route:       [],
        fromSymbol:  'SUI',
        toSymbol:    'USDC',
      }
      const report = await runGuardian(fakeQuote, sender, null)
      res.json({ ok: true, report: serializeReport(report), actionLabel: `· SIMULATE · SCORE ${report.score}/100` })
      return
    }

    res.status(400).json({ ok: false, error: 'txDigest required for simulation' })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

/* ─── Portfolio ───────────────────────────────────────────────────────── */

app.post('/api/portfolio', async (req, res) => {
  try {
    const { wallet } = req.body as { wallet: string }
    if (!wallet) { res.status(400).json({ ok: false, error: 'wallet required' }); return }
    registerWallet(wallet)
    const portfolio = await fetchPortfolio(wallet)
    updatePortfolioSnapshot(wallet, portfolio)

    // Deep analytics from recent tx history
    const successTxs = portfolio.recentTxs.filter(t => t.status === 'success')
    const analytics = {
      txCount:      portfolio.recentTxs.length,
      successCount: successTxs.length,
      failedCount:  portfolio.recentTxs.length - successTxs.length,
      // Gas: each tx costs ~0.003-0.01 SUI on average; we estimate from tx count
      estimatedGasSui:  (successTxs.length * 0.005).toFixed(4),
      // Top balances for quick summary
      topAssets: portfolio.balances.slice(0, 3).map(b => b.symbol),
    }

    res.json({ ok: true, portfolio, analytics })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

/* ─── Scheduler CRUD ─────────────────────────────────────────────────── */

app.get('/api/schedule/:wallet', (req, res) => {
  res.json({ ok: true, scheduled: getScheduled(req.params.wallet) })
})

app.delete('/api/schedule/:id', (req, res) => {
  const ok = cancelScheduled(req.params.id)
  res.json({ ok })
})

/* ─── Conditions CRUD ────────────────────────────────────────────────── */

app.get('/api/conditions/:wallet', (req, res) => {
  res.json({ ok: true, conditions: getConditions(req.params.wallet) })
})

app.delete('/api/conditions/:id', (req, res) => {
  const ok = cancelCondition(req.params.id)
  res.json({ ok })
})

/* ─── Payments ───────────────────────────────────────────────────────── */

app.get('/api/payment/:id', (req, res) => {
  const payment = getPaymentStatus(req.params.id)
  if (!payment) { res.status(404).json({ ok: false, error: 'Payment not found' }); return }
  res.json({ ok: true, payment })
})

// Mark a payment as paid (called after the payer's tx is confirmed)
app.post('/api/payment/:id/pay', (req, res) => {
  const { paidBy } = req.body as { paidBy?: string }
  const payment    = getPaymentStatus(req.params.id)
  if (!payment) { res.status(404).json({ ok: false, error: 'Payment not found' }); return }
  if (payment.status === 'paid') { res.json({ ok: true, payment }); return }
  fulfillPayment(req.params.id, paidBy ?? 'unknown')
  res.json({ ok: true, payment: { ...payment, status: 'paid' } })
})

/* ─── PTB builder — returns serialized tx bytes for wallet signing ─── */

app.post('/api/ptb', async (req, res) => {
  try {
    const { from, to, amountIn, slippage, sender } = req.body
    if (!from || !to || !amountIn || !sender) {
      res.status(400).json({ ok: false, error: 'Missing required fields' }); return
    }
    const routex = new Routex('mainnet', sender)
    const quote  = await routex.getQuote({
      from,
      to,
      amount:            BigInt(amountIn),
      slippageTolerance: slippage ?? 0.005,
      senderAddress:     sender,
    })

    // Feature 5: VektorLog — atomically append on-chain log call when package is deployed
    const logPackageId = process.env.VEKTORLOG_PACKAGE_ID
    if (logPackageId) {
      try {
        const summary = `${from}→${to} ${amountIn}`
        quote.ptb.moveCall({
          target:    `${logPackageId}::log::record`,
          arguments: [quote.ptb.pure.string(summary.slice(0, 64))],
        })
      } catch { /* log append failed — still execute the swap */ }
    }

    const ptbJson = quote.ptb.serialize()
    res.json({ ok: true, ptbJson })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: msg })
  }
})

/* ─── VektorRegistry stats ────────────────────────────────────────────── */

app.get('/api/stats', (_, res) => {
  res.json({ ok: true, registry: loadRegistry() })
})

/* ─── Live prices (from Pyth cache) ──────────────────────────────────── */

app.get('/api/prices', (_, res) => {
  res.json({ ok: true, prices: getAllPrices() })
})

/* ─── Alerts ─────────────────────────────────────────────────────────── */

app.get('/api/alerts/:wallet', (req, res) => {
  const alerts = getUnseenAlerts(req.params.wallet)
  markAlertsSeen(req.params.wallet)
  res.json({ ok: true, alerts })
})

/* ─── Memory ─────────────────────────────────────────────────────────── */

app.get('/api/memory/:wallet', (req, res) => {
  const mem     = getMemory(req.params.wallet)
  const prices  = getAllPrices()
  const sched   = getScheduled(req.params.wallet)

  // Build DCA progress summary
  const dcaItems = sched.filter(s => s.type === 'dca' && s.active)
  const dcaSummary = dcaItems.map(d => ({
    token:    `${d.amount} ${d.token} → ${d.targetToken ?? '?'}`,
    progress: `${d.schedule.completedRuns}/${d.schedule.totalRuns} runs`,
    nextRun:  d.schedule.nextRun,
  }))

  // Build price context
  const priceContext = Object.entries(prices)
    .filter(([, p]) => p > 0)
    .slice(0, 5)
    .reduce((acc, [sym, price]) => ({ ...acc, [sym]: price }), {} as Record<string, number>)

  res.json({
    ok: true,
    memory: mem,
    dcaSummary,
    priceContext,
  })
})

/* ─── Health ─────────────────────────────────────────────────────────── */

app.get('/api/health', (_, res) => {
  res.json({ ok: true, version: '2.0.0', features: ['guardian', 'navi', 'dca', 'conditions', 'memory', 'alerts'] })
})

/* ─── Start ───────────────────────────────────────────────────────────── */

app.listen(PORT, () => {
  console.log(`\n  ⚡ Vektor OS  →  http://localhost:${PORT}`)
  console.log(`  Features    →  Guardian · NAVI · DCA · Conditions · Memory · Alerts`)
  try {
    const p = activeProvider()
    const label = p === 'anthropic' ? 'Claude (claude-sonnet-4)' : p === 'groq' ? 'Groq (llama-3.3-70b)' : 'Gemini (gemini-2.0-flash)'
    console.log(`  AI parser   →  ${label}\n`)
  } catch {
    console.log(`  AI parser   →  ⚠️  No API key set (ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)\n`)
  }

  startScheduler()
  startConditionMonitor()
  startAlertMonitor()
})
