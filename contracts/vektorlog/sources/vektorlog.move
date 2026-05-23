/// VektorLog — on-chain intent execution log.
///
/// Emits an immutable IntentExecuted event for every swap that passes through
/// Vektor. Events are queryable via the Sui RPC (suix_queryEvents) and provide
/// an auditable, tamper-proof execution history without storing state on-chain
/// (events are cheaper than objects and sufficient for audit purposes).
///
/// Deploy:
///   sui client publish --gas-budget 100000000
///
/// After deployment, set VEKTORLOG_PACKAGE_ID to the published package address
/// in your Vektor client configuration.
module vektorlog::vektorlog {
    use sui::clock::{Self, Clock};
    use sui::event;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// Emitted once per swap execution.
    /// Queryable via: suix_queryEvents with MoveEventType filter.
    public struct IntentExecuted has copy, drop {
        /// UUID of the Vektor intent — correlates on-chain log with off-chain record.
        intent_id: vector<u8>,
        /// The wallet address that submitted the intent.
        sender: address,
        /// Protocol(s) used for routing, e.g. "aftermath" or "deepbook+cetus".
        protocol: vector<u8>,
        /// Amount of tokenIn consumed, in base units.
        amount_in: u64,
        /// Amount of tokenOut received, in base units.
        amount_out: u64,
        /// Block timestamp in milliseconds.
        timestamp_ms: u64,
    }

    // ─── Entry functions ──────────────────────────────────────────────────────

    /// Log a completed swap execution.
    ///
    /// Called from within the same PTB as the swap — atomic with the trade.
    /// If the swap fails, the log call also reverts (no phantom log entries).
    ///
    /// Parameters:
    ///   intent_id  — UUID bytes of the Vektor intent
    ///   protocol   — protocol identifier bytes (e.g. "aftermath")
    ///   amount_in  — base units consumed
    ///   amount_out — base units received
    ///   clock      — Sui system clock object (always at address 0x6)
    ///   ctx        — transaction context (provides sender address)
    public fun log_execution(
        intent_id:  vector<u8>,
        protocol:   vector<u8>,
        amount_in:  u64,
        amount_out: u64,
        clock:      &Clock,
        ctx:        &TxContext,
    ) {
        event::emit(IntentExecuted {
            intent_id,
            sender:       tx_context::sender(ctx),
            protocol,
            amount_in,
            amount_out,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }
}
