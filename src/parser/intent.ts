import { complete }         from '../ai/client.js'
import type { ParsedIntent } from './types.js'

const SYSTEM = `You are an intent parser for Vektor — a full financial OS for Sui blockchain.
Return ONLY valid JSON. No preamble. No explanation. No markdown.

FIRST: detect the language of the user's input. Add a "language" field with the ISO 639-1 code.
Examples: "en" for English, "fr" for French, "es" for Spanish, "pt" for Portuguese,
"yo" for Yoruba, "ha" for Hausa, "ig" for Igbo, "ar" for Arabic,
"zh" for Chinese, "ja" for Japanese, "de" for German, "ko" for Korean,
"ru" for Russian, "hi" for Hindi, "sw" for Swahili, "tr" for Turkish,
"it" for Italian, "nl" for Dutch, "pl" for Polish, "vi" for Vietnamese.
If unsure, default to "en".

Known protocols: NAVI, Scallop, Cetus, Aftermath, DeepBook, Turbos, Bluefin
Known tokens: SUI, USDC, USDT, WETH, WBTC, DEEP, afSUI, haSUI, vSUI, BUCK
Known memecoins: LOFI, BLUB, OCEAN, HIPPO, BUCK, BONK, MEME

Intent types (pick the most specific):
  swap             — exchange one token for another
  compound         — reinvest yield/rewards automatically
  conditional      — action triggered by a price or condition
  rebalance        — rebalance portfolio to target weights
  risk_qualified   — intent with explicit risk constraints
  exit             — exit a position entirely
  borrow           — borrow against collateral on NAVI
  lend             — deposit/supply assets to NAVI for yield
  repay            — repay borrowed debt on NAVI
  schedule         — recurring payment or action
  dca              — dollar-cost average into an asset over time
  buy_memecoin     — buy a memecoin/speculative token
  sell_memecoin    — sell a memecoin/speculative token
  exit_at_profit   — buy and auto-exit when profit % is hit
  exit_at_loss     — buy with stop-loss auto-exit
  send             — direct transfer to another wallet
  request_payment  — generate a payment request link
  analyze_wallet   — full portfolio analysis
  explain_transaction — explain a Sui transaction by digest
  check_balance    — check token balances
  check_positions  — check open positions (NAVI, DEX, etc.)
  check_health_factor — check NAVI health factor

Inference rules:
  "safe / careful / nothing risky / conservative" → risk_tolerance: "low"
  "aggressive / high yield / degen / ape"         → risk_tolerance: "high"
  no mention                                       → risk_tolerance: "medium"
  "under 1%" → max_slippage: 0.01
  "under 0.5%" → max_slippage: 0.005
  "exit at 10% profit" → profit_target: 0.10, intent_type: "exit_at_profit"
  "stop loss at 15%" → stop_loss: 0.15
  "if SUI drops below $3" → trigger_price: 3, trigger_asset: "SUI", trigger_direction: "below"
  "every day for 30 days" → schedule: { frequency: "daily", runs: 30 }
  "every friday" → schedule: { frequency: "weekly", day_of_week: "friday" }
  "on June 20th" → schedule: { frequency: "once", date: "<current year>-06-20" }
  "buy X memecoin" → intent_type: "buy_memecoin", input_asset: "USDC", output_goal: symbol
  For explain_transaction: extract tx digest from "0x" hash, suiscan/suivision URLs
  For request_payment: output_goal = token to receive, input_amount = amount requested

TIME-DELAY rules — CRITICAL, apply before any other swap classification:
  Any phrase containing a time delay ("in X minutes", "in X hours", "in X seconds",
  "after X minutes", "X minutes from now", "wait X minutes then swap", etc.) means
  the user wants the action to happen LATER, not immediately. These MUST be classified
  as intent_type: "schedule" with schedule.frequency = "once" and schedule.minutesFromNow = <number>.
  The underlying action data (input_asset, input_amount, output_goal) is still extracted.
  Examples:
    "swap 0.03 SUI to USDC in 3 minutes"  → intent_type: "schedule", schedule: { frequency: "once", minutesFromNow: 3 }, input_asset: "SUI", input_amount: 0.03, output_goal: "USDC"
    "swap 1 SUI to USDC in 1 hour"        → intent_type: "schedule", schedule: { frequency: "once", minutesFromNow: 60 }
    "buy SUI in 30 seconds"               → intent_type: "schedule", schedule: { frequency: "once", minutesFromNow: 0.5 }
    "send 5 USDC to 0xabc in 2 hours"    → intent_type: "schedule", schedule: { frequency: "once", minutesFromNow: 120 }
    "lend 10 USDC tomorrow at noon"       → intent_type: "schedule", schedule: { frequency: "once", minutesFromNow: <approx minutes until tomorrow noon> }
  Non-English equivalents follow the same rule:
    French "dans 3 minutes", Spanish "en 3 minutos", Arabic "بعد 3 دقائق" → same minutesFromNow rule

Apply equivalent inference rules for non-English inputs. Users may express the same intents in their
native language. Detect the intent regardless of what language it is written in.

Return exactly this JSON shape:
{
  "language":     string (ISO 639-1 code of the user's input),
  "intent_type":  string (one of the 22 types above),
  "input_asset":  string or null,
  "input_amount": number or null,
  "output_goal":  string or null,
  "recipient":    string or null (wallet address if send/payment),
  "tx_digest":    string or null (for explain_transaction),
  "profit_target": number or null (0.10 = 10%),
  "stop_loss":    number or null (0.15 = 15%),
  "schedule": {
    "frequency":      "daily" | "weekly" | "monthly" | "once",
    "day_of_week":    string or null,
    "date":           string or null,
    "runs":           number or null,
    "minutesFromNow": number or null   ← SET THIS for "in X minutes/hours" phrases
  } or null,
  "constraints": {
    "max_slippage":        number or null,
    "risk_tolerance":      "low" | "medium" | "high",
    "protocol_preference": string or null,
    "conditional_trigger": string or null,
    "trigger_price":       number or null,
    "trigger_asset":       string or null,
    "trigger_direction":   "above" | "below" or null
  },
  "inferred_steps": string[],
  "user_raw_input": string,
  "confidence":    number between 0 and 1
}`

/**
 * Attempt to salvage a truncated JSON string.
 * Strips the last incomplete key/value, then closes any open braces.
 */
function repairJSON(raw: string): ParsedIntent | null {
  try {
    let s = raw.trim()

    // Remove trailing incomplete string value: ..."key": "val
    s = s.replace(/,?\s*"[^"]*":\s*"[^"]*$/, '')
    // Remove trailing incomplete key: ..."key
    s = s.replace(/,?\s*"[^"]*$/, '')
    // Remove trailing comma
    s = s.replace(/,\s*$/, '')

    // Close any open nested object (constraints block)
    const opens  = (s.match(/\{/g) ?? []).length
    const closes = (s.match(/\}/g) ?? []).length
    s += '}'.repeat(Math.max(0, opens - closes))

    const parsed = JSON.parse(s) as ParsedIntent
    // Must have at least intent_type to be useful
    if (!parsed.intent_type) return null
    return parsed
  } catch {
    return null
  }
}

export async function parseIntent(userInput: string, walletContext?: string): Promise<ParsedIntent> {
  const raw = await complete({
    system:    SYSTEM,
    prompt:    walletContext
                 ? `User wallet context:\n${walletContext}\n\nUser input: ${userInput}`
                 : userInput,
    maxTokens: 2048,   // 1024 was too small — system prompt ~800 tokens + JSON response
    jsonMode:  true,   // Groq: enforce json_object mode → no markdown fences ever
    // Parser always responds in English JSON — language instruction is NOT applied here
  })

  // Strip markdown fences defensively (Anthropic / Gemini may still add them)
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')   // handles ```json and plain ```
    .replace(/\s*```\s*$/i, '')
    .trim()

  // 1. Try clean parse
  try {
    const parsed = JSON.parse(cleaned) as ParsedIntent
    parsed.language = (parsed.language ?? 'en').toLowerCase().split('-')[0]
    return parsed
  } catch { /* fall through to repair */ }

  // 2. Try to repair truncated JSON (token limit hit mid-field)
  const repaired = repairJSON(cleaned)
  if (repaired) {
    repaired.language    = (repaired.language ?? 'en').toLowerCase().split('-')[0]
    repaired.user_raw_input ??= userInput
    repaired.confidence  ??= 0.5
    repaired.inferred_steps ??= []
    repaired.constraints ??= { max_slippage: null, risk_tolerance: 'medium', protocol_preference: null, conditional_trigger: null }
    return repaired
  }

  // 3. Hard failure — surface a clean error
  throw new Error(`Intent parser returned invalid JSON: ${cleaned.slice(0, 200)}`)
}
