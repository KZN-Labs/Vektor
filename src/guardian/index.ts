import type { RoutexQuote } from 'routex-sui'
import type { VektorIntent, GuardianReport, RiskFlag } from '../types.js'
import {
  checkPriceImpact,
  checkSlippage,
  checkStaleness,
  checkThinLiquidity,
  checkGas,
  checkProtocolConcentration,
  checkLargeTrade,
} from './risks.js'

export interface GuardianOptions {
  /** Sui JSON-RPC client for on-chain balance checks. If omitted, gas check is skipped. */
  suiClient?: any
  senderAddress?: string
}

/**
 * Guardian — evaluates a quote against 7 risk classes and returns a report.
 *
 * Risk classes:
 *  1. HIGH_PRICE_IMPACT      — impact exceeds intent threshold
 *  2. LOOSE_SLIPPAGE         — slippage tolerance dangerously wide
 *  3. STALE_QUOTE            — quote TTL nearly expired
 *  4. THIN_LIQUIDITY         — shallow pool depth
 *  5. INSUFFICIENT_GAS       — wallet can't cover gas + trade
 *  6. PROTOCOL_CONCENTRATION — single non-CLOB protocol handles full route
 *  7. LARGE_TRADE            — trade size warrants attention
 */
export class Guardian {
  constructor(private readonly options: GuardianOptions = {}) {}

  async evaluate(intent: VektorIntent, quote: RoutexQuote): Promise<GuardianReport> {
    const flags: (RiskFlag | null)[] = []

    // Synchronous checks
    flags.push(checkPriceImpact(intent, quote))
    flags.push(checkSlippage(intent))
    flags.push(checkStaleness(quote))
    flags.push(checkThinLiquidity(quote))
    flags.push(checkProtocolConcentration(quote))
    flags.push(checkLargeTrade(intent))

    // Async check (requires RPC)
    if (this.options.suiClient && this.options.senderAddress) {
      flags.push(
        await checkGas(intent, quote, this.options.senderAddress, this.options.suiClient),
      )
    }

    const risks = flags.filter((f): f is RiskFlag => f !== null)
    const blocked = risks.some(r => r.severity === 'block')

    return { intent, quote, risks, blocked }
  }
}
