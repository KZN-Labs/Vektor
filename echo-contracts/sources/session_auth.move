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
    public entry fun create_and_share(
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
    public entry fun revoke(auth: &mut SessionAuthorization, ctx: &TxContext) {
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
}
