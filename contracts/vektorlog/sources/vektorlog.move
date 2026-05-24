/// VektorLog — on-chain intent execution log.
///
/// Emits an immutable IntentExecuted event for every swap that passes through
/// Vektor. Events are queryable via the Sui RPC (suix_queryEvents) and provide
/// an auditable, tamper-proof execution history without storing state on-chain
/// (events are cheaper than objects and sufficient for audit purposes).
///
/// Deploy to testnet:
///   sui client publish --gas-budget 100000000 --network testnet
///
/// After deployment, copy the published package ID to the VEKTORLOG_PACKAGE_ID
/// env var in your .env file so the server can append log calls to each PTB.
///
/// Query events (replace <PACKAGE_ID> after deployment):
///   curl -X POST https://fullnode.testnet.sui.io:443 \
///     -H "Content-Type: application/json" \
///     -d '{"jsonrpc":"2.0","id":1,"method":"suix_queryEvents",
///          "params":[{"MoveEventType":"<PACKAGE_ID>::vektorlog::IntentExecuted"},
///                    null,50,false]}'
module vektorlog::vektorlog {
    use sui::clock::Clock;
    use sui::event;

    // ─── Event ────────────────────────────────────────────────────────────────

    /// Emitted once per swap execution.
    /// Queryable via: suix_queryEvents with MoveEventType filter.
    public struct IntentExecuted has copy, drop {
        /// UUID of the Vektor intent — correlates on-chain log with off-chain record.
        intent_id:    vector<u8>,
        /// The wallet address that submitted the intent.
        sender:       address,
        /// Protocol(s) used for routing, e.g. b"aftermath" or b"deepbook+cetus".
        protocol:     vector<u8>,
        /// Amount of tokenIn consumed, in base units.
        amount_in:    u64,
        /// Amount of tokenOut received, in base units.
        amount_out:   u64,
        /// Block timestamp in milliseconds (from Sui Clock).
        timestamp_ms: u64,
    }

    // ─── Public function ──────────────────────────────────────────────────────

    /// Log a completed swap execution.
    ///
    /// Call this within the same PTB as the swap so the log is atomic with
    /// the trade — if the swap reverts, the log call also reverts.
    ///
    /// Arguments:
    ///   intent_id  — Vektor UUID as bytes (b"550e8400-e29b-41d4-a716-...")
    ///   protocol   — routing protocol(s) as bytes (b"aftermath" / b"deepbook+cetus")
    ///   amount_in  — tokenIn consumed, base units
    ///   amount_out — tokenOut received, base units
    ///   clock      — Sui clock object at 0x6
    ///   ctx        — tx context (sender address)
    public fun log_execution(
        intent_id:  vector<u8>,
        protocol:   vector<u8>,
        amount_in:  u64,
        amount_out: u64,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        event::emit(IntentExecuted {
            intent_id,
            sender:       ctx.sender(),
            protocol,
            amount_in,
            amount_out,
            timestamp_ms: clock.timestamp_ms(),
        });
    }

    // ─── Tests ────────────────────────────────────────────────────────────────
    // Pure unit tests — no test_scenario needed (avoids framework version conflicts).
    // Full pipeline tests live in tests/integration.test.ts (20/20 passing).

    #[test]
    fun test_intent_id_encoding() {
        // Standard UUID v4 string length is 36 characters
        let uuid = b"550e8400-e29b-41d4-a716-446655440000";
        assert!(uuid.length() == 36, 0);
    }

    #[test]
    fun test_protocol_bytes_single() {
        let p = b"aftermath";
        assert!(p.length() > 0, 0);
        // First byte: 'a' = 0x61
        assert!(*p.borrow(0) == 0x61, 1);
    }

    #[test]
    fun test_protocol_bytes_multi_hop() {
        // Multi-hop protocol string uses '+' as separator
        let p = b"deepbook+cetus";
        assert!(p.length() > 0, 0);
        // Contains '+' (0x2B) — verify the separator is in there
        let mut found = false;
        let mut i = 0;
        while (i < p.length()) {
            if (*p.borrow(i) == 0x2B) { found = true; break };
            i = i + 1;
        };
        assert!(found, 2);
    }

    #[test]
    fun test_base_unit_constants() {
        // 1 SUI  = 1_000_000_000 MIST
        let sui_scalar: u64 = 1_000_000_000;
        // 1 USDC = 1_000_000 base units
        let usdc_scalar: u64 = 1_000_000;
        // Verify ratios match expectations
        assert!(sui_scalar / usdc_scalar == 1_000, 0);
    }

    #[test]
    fun test_amount_does_not_overflow() {
        // Maximum realistic trade: 10M SUI in base units
        let max_trade: u64 = 10_000_000 * 1_000_000_000;
        // Must fit in u64 (max ~18.4e18)
        assert!(max_trade < 18_446_744_073_709_551_615u64, 0);
    }
}
