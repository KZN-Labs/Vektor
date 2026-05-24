import { complete }       from '../ai/client.js'
import type { ParsedIntent } from './types.js'

const SYSTEM = `You are an intent parser for Vektor — a full financial OS for Sui blockchain.
Return ONLY valid JSON. No preamble. No explanation. No markdown.

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

Return exactly this JSON shape:
{
  "intent_type":    string (one of the 22 types above),
  "input_asset":    string or null,
  "input_amount":   number or null,
  "output_goal":    string or null,
  "recipient":      string or null (wallet address if send/payment),
  "tx_digest":      string or null (for explain_transaction),
  "profit_target":  number or null (0.10 = 10%),
  "stop_loss":      number or null (0.15 = 15%),
  "schedule": {
    "frequency":    "daily" | "weekly" | "monthly" | "once",
    "day_of_week":  string or null,
    "date":         string or null,
    "runs":         number or null
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
  "confidence":     number between 0 and 1
}`

export async function parseIntent(userInput: string, walletContext?: string): Promise<ParsedIntent> {
  const text = await complete({
    system:    SYSTEM,
    prompt:    walletContext
                 ? `User wallet context:\n${walletContext}\n\nUser input: ${userInput}`
                 : userInput,
    maxTokens: 1024,
  })
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  return JSON.parse(cleaned) as ParsedIntent
}
