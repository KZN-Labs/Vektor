import type { LogEntry } from '../types.js'

/**
 * VektorLog client — appends execution records to the VektorLog Move contract.
 *
 * The Move contract emits an IntentExecuted event for every swap that passes
 * through Vektor. This provides an immutable, queryable on-chain audit trail.
 *
 * Contract address (testnet): set via VEKTORLOG_PACKAGE_ID env var or constructor.
 * Deploy from contracts/vektorlog/ using `sui client publish`.
 */
export class VektorLogClient {
  private packageId: string

  constructor(
    private readonly network: 'mainnet' | 'testnet',
    packageId?: string,
  ) {
    this.packageId = packageId ?? process.env.VEKTORLOG_PACKAGE_ID ?? ''
  }

  /**
   * Appends a log call to an existing Transaction.
   * Call this after building the swap PTB — both operations go in one atomic tx.
   *
   * @param tx     The Transaction to append the log call to
   * @param entry  The log data to record on-chain
   */
  appendLog(tx: any, entry: Omit<LogEntry, 'digest' | 'timestamp'>): void {
    if (!this.packageId) {
      // No package deployed yet — skip silently
      return
    }

    // Encode intentId and protocol as bytes
    const intentIdBytes = Array.from(Buffer.from(entry.intentId))
    const protocolBytes = Array.from(Buffer.from(entry.protocol))

    tx.moveCall({
      target: `${this.packageId}::vektorlog::log_execution`,
      arguments: [
        tx.pure.vector('u8', intentIdBytes),
        tx.pure.vector('u8', protocolBytes),
        tx.pure.u64(entry.amountIn),
        tx.pure.u64(entry.amountOut),
        tx.object('0x6'),  // Sui Clock object (always at 0x6)
      ],
    })
  }

  /**
   * Formats a completed execution into a LogEntry.
   */
  buildEntry(
    intentId: string,
    protocol: string,
    amountIn: bigint,
    amountOut: bigint,
    digest: string,
  ): LogEntry {
    return {
      intentId,
      protocol,
      amountIn,
      amountOut,
      digest,
      timestamp: Date.now(),
    }
  }

  isConfigured(): boolean {
    return this.packageId.length > 0
  }
}
