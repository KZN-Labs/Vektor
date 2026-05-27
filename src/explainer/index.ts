/**
 * Transaction Explainer — fetch any Sui tx and explain it in plain English via Claude.
 * Works for any transaction, not just Vektor transactions.
 */

import { complete }          from '../ai/client.js'
import { fetchTransaction } from '../portfolio/fetcher.js'

/* ── Coin type → readable symbol map (mirrors KNOWN_COINS in fetcher) ──── */
const COIN_TYPE_TO_SYMBOL: Record<string, string> = {
  '0x2::sui::SUI':                                                                                         'SUI',
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC':                     'USDC',
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN':                     'USDC (bridged)',
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN':                     'USDT',
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN':                     'WETH',
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN':                     'WBTC',
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP':                     'DEEP',
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI':                  'haSUI',
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT':                    'vSUI',
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI':                  'afSUI',
}

const COIN_DECIMALS_MAP: Record<string, number> = {
  '0x2::sui::SUI':                                                                                         1e9,
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC':                     1e6,
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN':                     1e6,
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN':                     1e6,
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN':                     1e8,
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN':                     1e8,
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP':                     1e6,
}

/** Resolve a coinType to a readable symbol. Falls back to last segment of the type. */
function resolveSymbol(coinType: string): string {
  if (COIN_TYPE_TO_SYMBOL[coinType]) return COIN_TYPE_TO_SYMBOL[coinType]
  // e.g. "0xabc::mytoken::MYTOKEN" → "MYTOKEN"
  const parts = coinType.split('::')
  return parts[parts.length - 1] ?? coinType.slice(0, 12)
}

/** Format a raw integer amount using known decimals for that coinType. */
function formatAmount(raw: string, coinType: string): string {
  const n = Number(raw)
  if (isNaN(n)) return raw
  const decimals = COIN_DECIMALS_MAP[coinType] ?? 1e9
  return (Math.abs(n) / decimals).toFixed(decimals >= 1e8 ? 6 : 4)
}

/** Convert raw balanceChanges to human-readable form for the AI. */
function humaniseBalanceChanges(changes: any[]): object[] {
  return changes.map(c => ({
    token:  resolveSymbol(c.coinType ?? ''),
    amount: formatAmount(c.amount ?? '0', c.coinType ?? ''),
    flow:   Number(c.amount ?? 0) >= 0 ? 'received' : 'sent',
    owner:  c.owner?.AddressOwner ?? c.owner ?? 'unknown',
  }))
}

export interface ExplainResult {
  digest:      string
  explanation: string
  summary:     string   // one-liner for the action label
  gasUsed:     number   // in SUI
  status:      'success' | 'failure'
}

function extractDigest(input: string): string | null {
  // Match a raw 44-char base58 digest
  const raw = input.match(/[1-9A-HJ-NP-Za-km-z]{40,50}/)
  if (raw) return raw[0]
  // Match from suiscan / suivision URL
  const url = input.match(/\/tx(?:block)?\/([1-9A-HJ-NP-Za-km-z]{40,50})/)
  if (url) return url[1]
  return null
}

export async function explainTransaction(input: string, lang = 'en'): Promise<ExplainResult> {
  const digest = extractDigest(input)
  if (!digest) throw new Error('Could not extract a valid transaction digest from your input.')

  const tx = await fetchTransaction(digest)

  const status: 'success' | 'failure' =
    (tx.effects as any)?.status?.status === 'success' ? 'success' : 'failure'

  const gasRaw   = (tx.effects as any)?.gasUsed
  const gasUsed  = gasRaw
    ? (Number(gasRaw.computationCost ?? 0) + Number(gasRaw.storageCost ?? 0)) / 1e9
    : 0

  // Build context for Claude — humanise token names so AI says "USDC" not "COIN"
  const context = JSON.stringify({
    digest,
    status,
    gasUsed,
    balanceChanges: humaniseBalanceChanges((tx as any).balanceChanges?.slice(0, 10) ?? []),
    events:         (tx.events ?? []).slice(0, 8),
    objectChanges:  (tx as any).objectChanges?.slice(0, 4) ?? [],
  }, null, 2)

  const explanation = (await complete({
    system: `You are a Sui blockchain transaction explainer.
Given raw transaction data, explain what happened in 2-4 sentences.
Include: what action occurred, tokens/amounts involved, fees, outcome.
Format: start with an action word. E.g. "Swapped 100 SUI for 91.4 USDC via Cetus. Fee was 0.25%..."
Keep protocol names (Cetus, Aftermath, NAVI) and token symbols (SUI, USDC) in English even if translating.
Never mention JSON, object IDs, or technical implementation details.`,
    prompt:    `Explain this Sui transaction:\n\n${context}`,
    maxTokens: 512,
    lang,
  })).trim() || 'Transaction explanation unavailable.'

  // Build a short summary for the label
  const firstLine = explanation.split('.')[0].trim()
  const summary   = firstLine.length > 50 ? firstLine.slice(0, 47) + '…' : firstLine

  return { digest, explanation, summary, gasUsed, status }
}
