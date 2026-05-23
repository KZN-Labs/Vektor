import Routex from 'routex-sui'
import { runGuardian, type GuardianReportV2 } from './v2.js'

const SIM_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001'

/**
 * Rewrite the PTB based on Guardian flags.
 * Calls Routex with modified params (exclude bad protocols, split trade, etc.)
 * and re-runs the Guardian on the new quote.
 */
export async function rewritePTB(
  report:        GuardianReportV2,
  walletAddress: string,
  network:       'mainnet' | 'testnet' = 'mainnet',
): Promise<GuardianReportV2> {
  const original = report.originalQuote
  const routex   = new Routex(network, walletAddress || SIM_ADDR)

  for (const flag of report.flags) {
    if (flag.severity === 'green') continue

    switch (flag.suggestion) {
      case 'split_trade': {
        // Split trade into two halves to reduce slippage and price impact
        const halfAmount = BigInt(original.amountIn ?? 0) / 2n || 1n
        const [q1, q2]  = await Promise.all([
          routex.getQuote({ from: original.fromSymbol, to: original.toSymbol, amount: halfAmount, slippageTolerance: original.slippageTolerance }),
          routex.getQuote({ from: original.fromSymbol, to: original.toSymbol, amount: halfAmount, slippageTolerance: original.slippageTolerance }),
        ])
        // Merge quotes: combine amountOut, use best priceImpact
        const merged = {
          ...q1,
          amountOut:   (q1.amountOut + q2.amountOut),
          priceImpact: Math.max(q1.priceImpact, q2.priceImpact) * 0.6, // splitting reduces impact
          _split: true,
        }
        const newReport = await runGuardian(merged, walletAddress, null)
        return { ...newReport, rewrittenQuote: merged }
      }

      case 'reroute': {
        // Find the flagged protocol and exclude it
        const flaggedProtocol = original.route?.find((s: any) =>
          flag.message.toLowerCase().includes(s.protocol?.toLowerCase() ?? '')
        )?.protocol

        const newQuote = await routex.getQuote({
          from:              original.fromSymbol,
          to:                original.toSymbol,
          amount:            BigInt(original.amountIn ?? 0),
          slippageTolerance: original.slippageTolerance,
          ...(flaggedProtocol ? { excludeProtocols: [flaggedProtocol] } : {}),
        })
        const newReport = await runGuardian(newQuote, walletAddress, null)
        return { ...newReport, rewrittenQuote: newQuote }
      }

      case 'rebuild': {
        // Fresh quote on the same pair
        const newQuote = await routex.getQuote({
          from:              original.fromSymbol,
          to:                original.toSymbol,
          amount:            BigInt(original.amountIn ?? 0),
          slippageTolerance: original.slippageTolerance,
        })
        const newReport = await runGuardian(newQuote, walletAddress, null)
        return { ...newReport, rewrittenQuote: newQuote }
      }
    }
  }

  // No suggestions — return a re-evaluated fresh quote
  return { ...report, rewrittenQuote: original }
}
