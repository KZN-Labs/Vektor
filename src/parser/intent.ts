import Anthropic from '@anthropic-ai/sdk'
import type { ParsedIntent } from './types.js'

const client = new Anthropic()

export async function parseIntent(userInput: string): Promise<ParsedIntent> {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are an intent parser for a DeFi app on Sui blockchain.
Return ONLY valid JSON. No preamble. No explanation. No markdown.

Known protocols: NAVI, Scallop, Cetus, Aftermath, DeepBook, Turbos, Bluefin
Known tokens: SUI, USDC, USDT, WETH, WBTC, DEEP, afSUI, haSUI, vSUI, BUCK

Intent types: swap, compound, conditional, rebalance, risk_qualified, exit

Risk tolerance rules:
  "safe / careful / nothing risky / conservative" → low
  no mention                                      → medium
  "aggressive / high yield / degen"               → high

Slippage rules:
  "under 1%" → 0.01, "under 0.5%" → 0.005, not mentioned → null

Return exactly this JSON shape:
{
  "intent_type":   string,
  "input_asset":   string or null,
  "input_amount":  number or null,
  "output_goal":   string,
  "constraints": {
    "max_slippage":        number or null,
    "risk_tolerance":      "low" | "medium" | "high",
    "protocol_preference": string or null,
    "conditional_trigger": string or null
  },
  "inferred_steps": string[],
  "user_raw_input": string,
  "confidence":     number between 0 and 1
}`,
    messages: [{ role: 'user', content: userInput }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

  // Strip markdown code fences if Claude added them
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

  return JSON.parse(cleaned) as ParsedIntent
}
