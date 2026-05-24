/**
 * Transaction Explainer — fetch any Sui tx and explain it in plain English via Claude.
 * Works for any transaction, not just Vektor transactions.
 */

import { complete }          from '../ai/client.js'
import { fetchTransaction } from '../portfolio/fetcher.js'

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

export async function explainTransaction(input: string): Promise<ExplainResult> {
  const digest = extractDigest(input)
  if (!digest) throw new Error('Could not extract a valid transaction digest from your input.')

  const tx = await fetchTransaction(digest)

  const status: 'success' | 'failure' =
    (tx.effects as any)?.status?.status === 'success' ? 'success' : 'failure'

  const gasRaw   = (tx.effects as any)?.gasUsed
  const gasUsed  = gasRaw
    ? (Number(gasRaw.computationCost ?? 0) + Number(gasRaw.storageCost ?? 0)) / 1e9
    : 0

  // Build context for Claude
  const context = JSON.stringify({
    digest,
    status,
    gasUsed,
    events:         (tx.events ?? []).slice(0, 10),
    balanceChanges: (tx as any).balanceChanges?.slice(0, 10) ?? [],
    objectChanges:  (tx as any).objectChanges?.slice(0, 6) ?? [],
  }, null, 2)

  const explanation = (await complete({
    system:    `You are a Sui blockchain transaction explainer.
Given raw transaction data, explain in plain English what happened.
Be concise (2-4 sentences). Include: what action occurred, tokens/amounts involved, fees, outcome.
Format: start with an action word. E.g. "Swapped 100 SUI for 91.4 USDC via Cetus. Fee was 0.25%..."
Never mention JSON, object IDs, or technical terms unless necessary.`,
    prompt:    `Explain this Sui transaction:\n\n${context}`,
    maxTokens: 512,
  })).trim() || 'Transaction explanation unavailable.'

  // Build a short summary for the label
  const firstLine = explanation.split('.')[0].trim()
  const summary   = firstLine.length > 50 ? firstLine.slice(0, 47) + '…' : firstLine

  return { digest, explanation, summary, gasUsed, status }
}
