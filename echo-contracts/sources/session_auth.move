/// Session Authorization — lets users grant a temporary session key
/// bounded spending limits so Echo can execute on their behalf without
/// exposing their main wallet private key.
module vektor::session_auth {
    use sui::clock::{Self, Clock};

    // ── Errors ────────────────────────────────────────────────────────────────
    const ENotOwner:          u64 = 0;
    const EAlreadyExpired:    u64 = 1;
    const EAmountExceedsTx:   u64 = 2;
    const EAmountExceedsDay:  u64 = 3;
    const ESessionRevoked:    u64 = 4;

    // ── Object ─────────────────────────────────────────────────────────────────
    public struct SessionAuthorization has key, store {
        id: UID,
        owner: address,
        session_key: address,       // ephemeral key's Sui address
        max_amount_per_tx:  u64,    // MIST
        max_amount_per_day: u64,    // MIST
        allowed_protocols:  vector<u8>, // bitmask or list encoding
        expires_at:         u64,    // epoch ms
        total_executed:     u64,
        daily_executed:     u64,
        last_reset_day:     u64,    // unix day (ms / 86400000)
        is_revoked:         bool,
    }

    // ── Create ─────────────────────────────────────────────────────────────────
    public fun create_session(
        session_key:       address,
        max_amount_per_tx: u64,
        max_amount_per_day:u64,
        allowed_protocols: vector<u8>,
        expires_at:        u64,
        clock:             &Clock,
        ctx:               &mut TxContext,
    ): SessionAuthorization {
        assert!(expires_at > clock::timestamp_ms(clock), EAlreadyExpired);
        SessionAuthorization {
            id:                object::new(ctx),
            owner:             tx_context::sender(ctx),
            session_key,
            max_amount_per_tx,
            max_amount_per_day,
            allowed_protocols,
            expires_at,
            total_executed:    0,
            daily_executed:    0,
            last_reset_day:    clock::timestamp_ms(clock) / 86_400_000,
            is_revoked:        false,
        }
    }

    /// Convenience: create and immediately share so the session key can use it.
    #[allow(lint(share_owned))]
    public fun create_and_share(
        session_key:        address,
        max_amount_per_tx:  u64,
        max_amount_per_day: u64,
        allowed_protocols:  vector<u8>,
        expires_at:         u64,
        clock:              &Clock,
        ctx:                &mut TxContext,
    ) {
        let auth = create_session(
            session_key, max_amount_per_tx, max_amount_per_day,
            allowed_protocols, expires_at, clock, ctx
        );
        transfer::share_object(auth);
    }

    // ── Revoke ─────────────────────────────────────────────────────────────────
    public fun revoke(auth: &mut SessionAuthorization, ctx: &TxContext) {
        assert!(auth.owner == tx_context::sender(ctx), ENotOwner);
        auth.is_revoked = true;
    }

    // ── Validity check ─────────────────────────────────────────────────────────
    public fun is_valid(auth: &SessionAuthorization, clock: &Clock): bool {
        !auth.is_revoked && clock::timestamp_ms(clock) < auth.expires_at
    }

    // ── Record execution (called from PTB by session key) ──────────────────────
    public fun record_execution(
        auth:   &mut SessionAuthorization,
        amount: u64,
        clock:  &Clock,
    ) {
        assert!(!auth.is_revoked, ESessionRevoked);
        assert!(clock::timestamp_ms(clock) < auth.expires_at, EAlreadyExpired);
        assert!(amount <= auth.max_amount_per_tx, EAmountExceedsTx);

        // Reset daily counter if a new day has started
        let today = clock::timestamp_ms(clock) / 86_400_000;
        if (today > auth.last_reset_day) {
            auth.daily_executed  = 0;
            auth.last_reset_day  = today;
        };

        assert!(auth.daily_executed + amount <= auth.max_amount_per_day, EAmountExceedsDay);
        auth.daily_executed  = auth.daily_executed + amount;
        auth.total_executed  = auth.total_executed  + amount;
    }

    // ── Getters ────────────────────────────────────────────────────────────────
    public fun owner(auth: &SessionAuthorization): address          { auth.owner }
    public fun session_key(auth: &SessionAuthorization): address    { auth.session_key }
    public fun expires_at(auth: &SessionAuthorization): u64         { auth.expires_at }
    public fun max_per_tx(auth: &SessionAuthorization): u64         { auth.max_amount_per_tx }
    public fun max_per_day(auth: &SessionAuthorization): u64        { auth.max_amount_per_day }
    public fun total_executed(auth: &SessionAuthorization): u64     { auth.total_executed }
    public fun daily_executed(auth: &SessionAuthorization): u64     { auth.daily_executed }
    public fun is_revoked(auth: &SessionAuthorization): bool        { auth.is_revoked }

    // ── Tests ─────────────────────────────────────────────────────────────────
    #[test_only]
    use sui::test_scenario;
    #[test_only]
    use std::unit_test::destroy;

    #[test]
    fun test_create_session() {
        let owner = @0xCAFE;
        let session_key = @0xDEAD;
        let mut scenario = test_scenario::begin(owner);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let auth = create_session(
                session_key, 1_000_000, 10_000_000, vector[], 2_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            assert!(auth.owner == owner, 0);
            assert!(auth.session_key == session_key, 1);
            assert!(auth.expires_at == 2_000, 2);
            assert!(!auth.is_revoked, 3);
            assert!(auth.total_executed == 0, 4);
            assert!(auth.daily_executed == 0, 5);
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EAlreadyExpired)]
    fun test_create_session_already_expired() {
        let mut scenario = test_scenario::begin(@0xCAFE);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 3_000); // now > expires_at 2_000
            let auth = create_session(
                @0xDEAD, 1_000_000, 10_000_000, vector[], 2_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_revoke() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let mut auth = create_session(
                @0xDEAD, 1_000_000, 10_000_000, vector[], 100_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            assert!(!auth.is_revoked, 0);
            assert!(is_valid(&auth, &clk), 1);
            revoke(&mut auth, test_scenario::ctx(&mut scenario));
            assert!(auth.is_revoked, 2);
            assert!(!is_valid(&auth, &clk), 3);
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ENotOwner)]
    fun test_revoke_not_owner() {
        let owner = @0xCAFE;
        let attacker = @0xBEEF;
        let mut scenario = test_scenario::begin(owner);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            create_and_share(@0xDEAD, 1_000_000, 10_000_000, vector[], 100_000, &clk,
                test_scenario::ctx(&mut scenario));
            clock::destroy_for_testing(clk);
        };
        test_scenario::next_tx(&mut scenario, attacker);
        {
            let mut auth: SessionAuthorization = test_scenario::take_shared(&scenario);
            revoke(&mut auth, test_scenario::ctx(&mut scenario));
            test_scenario::return_shared(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_is_valid_expires() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let auth = create_session(
                @0xDEAD, 1_000_000, 10_000_000, vector[], 2_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            assert!(is_valid(&auth, &clk), 0);
            clock::set_for_testing(&mut clk, 2_001);
            assert!(!is_valid(&auth, &clk), 1);
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_create_and_share() {
        let owner = @0xCAFE;
        let session_key = @0xDEAD;
        let mut scenario = test_scenario::begin(owner);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            create_and_share(session_key, 1_000_000, 5_000_000, vector[], 2_000, &clk,
                test_scenario::ctx(&mut scenario));
            clock::destroy_for_testing(clk);
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let auth: SessionAuthorization = test_scenario::take_shared(&scenario);
            assert!(auth.owner == owner, 0);
            assert!(auth.session_key == session_key, 1);
            assert!(!auth.is_revoked, 2);
            test_scenario::return_shared(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_record_execution() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let mut auth = create_session(
                @0xDEAD, 1_000, 5_000, vector[], 100_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            record_execution(&mut auth, 500, &clk);
            assert!(auth.daily_executed == 500, 0);
            assert!(auth.total_executed == 500, 1);
            record_execution(&mut auth, 500, &clk);
            assert!(auth.daily_executed == 1_000, 2);
            assert!(auth.total_executed == 1_000, 3);
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EAmountExceedsTx)]
    fun test_record_execution_exceeds_tx() {
        let mut scenario = test_scenario::begin(@0xCAFE);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let mut auth = create_session(
                @0xDEAD, 1_000, 10_000, vector[], 100_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            record_execution(&mut auth, 1_001, &clk); // exceeds max_per_tx of 1_000
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EAmountExceedsDay)]
    fun test_record_execution_exceeds_day() {
        let mut scenario = test_scenario::begin(@0xCAFE);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let mut auth = create_session(
                @0xDEAD, 2_000, 3_000, vector[], 100_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            record_execution(&mut auth, 2_000, &clk); // 2000 of 3000 daily used
            record_execution(&mut auth, 2_000, &clk); // 4000 > 3000 daily limit
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_record_execution_daily_reset() {
        let mut scenario = test_scenario::begin(@0xCAFE);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 86_400_000); // day 1
            let mut auth = create_session(
                @0xDEAD, 2_000, 3_000, vector[], 99_999_999_999, &clk,
                test_scenario::ctx(&mut scenario),
            );
            record_execution(&mut auth, 2_000, &clk);
            assert!(auth.daily_executed == 2_000, 0);
            // advance to day 2 — daily counter must reset
            clock::set_for_testing(&mut clk, 86_400_000 * 2);
            record_execution(&mut auth, 1_500, &clk);
            assert!(auth.daily_executed == 1_500, 1);
            assert!(auth.total_executed == 3_500, 2);
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ESessionRevoked)]
    fun test_record_execution_revoked() {
        let mut scenario = test_scenario::begin(@0xCAFE);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let mut auth = create_session(
                @0xDEAD, 1_000, 5_000, vector[], 100_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            revoke(&mut auth, test_scenario::ctx(&mut scenario));
            record_execution(&mut auth, 100, &clk); // aborts: ESessionRevoked
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EAlreadyExpired)]
    fun test_record_execution_expired() {
        let mut scenario = test_scenario::begin(@0xCAFE);
        {
            let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
            clock::set_for_testing(&mut clk, 1_000);
            let mut auth = create_session(
                @0xDEAD, 1_000, 5_000, vector[], 2_000, &clk,
                test_scenario::ctx(&mut scenario),
            );
            clock::set_for_testing(&mut clk, 3_000); // past expiry
            record_execution(&mut auth, 100, &clk); // aborts: EAlreadyExpired
            clock::destroy_for_testing(clk);
            destroy(auth);
        };
        test_scenario::end(scenario);
    }
}
