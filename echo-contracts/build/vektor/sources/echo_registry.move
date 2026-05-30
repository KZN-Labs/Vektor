/// Echo Registry — one object per user, stores Walrus blobId references on-chain.
/// The actual EchoUserData lives in the Walrus blob; only the blobId pointer lives here.
module vektor::echo_registry {

    // ── Errors ────────────────────────────────────────────────────────────────
    const ENotOwner:      u64 = 0;
    const EInvalidMode:   u64 = 1;

    // ── Object ─────────────────────────────────────────────────────────────────
    public struct EchoRegistry has key, store {
        id: UID,
        owner:           address,
        data_blob_id:    vector<u8>,    // Walrus blobId for EchoUserData JSON
        mode:            u8,            // 0=basic 1=medium 2=high
        session_auth_id: vector<u8>,    // on-chain SessionAuthorization object ID (hex bytes)
        last_updated:    u64,           // epoch ms
    }

    // ── Create ─────────────────────────────────────────────────────────────────
    public entry fun create_registry(ctx: &mut TxContext) {
        let registry = EchoRegistry {
            id:              object::new(ctx),
            owner:           tx_context::sender(ctx),
            data_blob_id:    vector::empty(),
            mode:            0,
            session_auth_id: vector::empty(),
            last_updated:    0,
        };
        transfer::transfer(registry, tx_context::sender(ctx));
    }

    // ── Mutations ──────────────────────────────────────────────────────────────
    public entry fun update_blob_id(
        registry: &mut EchoRegistry,
        blob_id:  vector<u8>,
        ctx:      &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        registry.data_blob_id = blob_id;
        registry.last_updated = 0; // updated externally
    }

    public entry fun update_mode(
        registry: &mut EchoRegistry,
        mode:     u8,
        ctx:      &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        assert!(mode <= 2, EInvalidMode);
        registry.mode = mode;
    }

    public entry fun update_session_auth(
        registry:       &mut EchoRegistry,
        session_auth_id: vector<u8>,
        ctx:             &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        registry.session_auth_id = session_auth_id;
    }

    public entry fun update_all(
        registry:       &mut EchoRegistry,
        blob_id:        vector<u8>,
        mode:           u8,
        session_auth_id: vector<u8>,
        ctx:             &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        assert!(mode <= 2, EInvalidMode);
        registry.data_blob_id    = blob_id;
        registry.mode            = mode;
        registry.session_auth_id = session_auth_id;
        registry.last_updated    = 0;
    }

    // ── Getters ────────────────────────────────────────────────────────────────
    public fun owner(r: &EchoRegistry): address       { r.owner }
    public fun data_blob_id(r: &EchoRegistry): &vector<u8>  { &r.data_blob_id }
    public fun mode(r: &EchoRegistry): u8             { r.mode }
    public fun session_auth_id(r: &EchoRegistry): &vector<u8> { &r.session_auth_id }
    public fun last_updated(r: &EchoRegistry): u64    { r.last_updated }
}
