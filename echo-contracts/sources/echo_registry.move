/// Echo Registry — one object per user, stores Walrus blobId references on-chain.
/// The actual EchoUserData lives in the Walrus blob; only the blobId pointer lives here.
module vektor::echo_registry {

    // ── Errors ────────────────────────────────────────────────────────────────
    const ENotOwner:    u64 = 0;
    const EInvalidMode: u64 = 1;

    // ── Object ─────────────────────────────────────────────────────────────────
    public struct EchoRegistry has key, store {
        id:              UID,
        owner:           address,
        data_blob_id:    vector<u8>,    // Walrus blobId for EchoUserData JSON
        mode:            u8,            // 0=basic 1=medium 2=high
        session_auth_id: vector<u8>,    // on-chain SessionAuthorization object ID (hex bytes)
        last_updated:    u64,           // epoch ms
    }

    // ── Create ─────────────────────────────────────────────────────────────────
    #[allow(lint(self_transfer))]
    public fun create_registry(ctx: &mut TxContext) {
        let registry = EchoRegistry {
            id:              object::new(ctx),
            owner:           tx_context::sender(ctx),
            data_blob_id:    vector[],
            mode:            0,
            session_auth_id: vector[],
            last_updated:    0,
        };
        transfer::transfer(registry, tx_context::sender(ctx));
    }

    // ── Mutations ──────────────────────────────────────────────────────────────
    public fun update_blob_id(
        registry: &mut EchoRegistry,
        blob_id:  vector<u8>,
        ctx:      &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        registry.data_blob_id = blob_id;
        registry.last_updated = 0;
    }

    public fun update_mode(
        registry: &mut EchoRegistry,
        mode:     u8,
        ctx:      &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        assert!(mode <= 2, EInvalidMode);
        registry.mode = mode;
    }

    public fun update_session_auth(
        registry:        &mut EchoRegistry,
        session_auth_id: vector<u8>,
        ctx:             &TxContext,
    ) {
        assert!(registry.owner == tx_context::sender(ctx), ENotOwner);
        registry.session_auth_id = session_auth_id;
    }

    public fun update_all(
        registry:        &mut EchoRegistry,
        blob_id:         vector<u8>,
        mode:            u8,
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
    public fun owner(r: &EchoRegistry): address            { r.owner }
    public fun data_blob_id(r: &EchoRegistry): &vector<u8> { &r.data_blob_id }
    public fun mode(r: &EchoRegistry): u8                  { r.mode }
    public fun session_auth_id(r: &EchoRegistry): &vector<u8> { &r.session_auth_id }
    public fun last_updated(r: &EchoRegistry): u64         { r.last_updated }

    // ── Tests ─────────────────────────────────────────────────────────────────
    #[test_only]
    use sui::test_scenario;

    #[test]
    fun test_create_registry() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let registry: EchoRegistry = test_scenario::take_from_sender(&scenario);
            assert!(registry.owner == owner, 0);
            assert!(registry.mode == 0, 1);
            assert!(registry.data_blob_id == vector[], 2);
            assert!(registry.session_auth_id == vector[], 3);
            assert!(registry.last_updated == 0, 4);
            test_scenario::return_to_sender(&scenario, registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_update_blob_id() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut registry: EchoRegistry = test_scenario::take_from_sender(&scenario);
            update_blob_id(&mut registry, b"blobid123", test_scenario::ctx(&mut scenario));
            assert!(registry.data_blob_id == b"blobid123", 0);
            test_scenario::return_to_sender(&scenario, registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ENotOwner)]
    fun test_update_blob_id_not_owner() {
        let owner = @0xCAFE;
        let attacker = @0xBEEF;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, attacker);
        {
            let mut registry: EchoRegistry = test_scenario::take_from_address(&scenario, owner);
            update_blob_id(&mut registry, b"evil", test_scenario::ctx(&mut scenario));
            test_scenario::return_to_address(owner, registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_update_mode_valid() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut registry: EchoRegistry = test_scenario::take_from_sender(&scenario);
            update_mode(&mut registry, 1, test_scenario::ctx(&mut scenario));
            assert!(registry.mode == 1, 0);
            update_mode(&mut registry, 2, test_scenario::ctx(&mut scenario));
            assert!(registry.mode == 2, 1);
            update_mode(&mut registry, 0, test_scenario::ctx(&mut scenario));
            assert!(registry.mode == 0, 2);
            test_scenario::return_to_sender(&scenario, registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidMode)]
    fun test_update_mode_invalid() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut registry: EchoRegistry = test_scenario::take_from_sender(&scenario);
            update_mode(&mut registry, 3, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_update_session_auth() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut registry: EchoRegistry = test_scenario::take_from_sender(&scenario);
            update_session_auth(&mut registry, b"session_hex", test_scenario::ctx(&mut scenario));
            assert!(registry.session_auth_id == b"session_hex", 0);
            test_scenario::return_to_sender(&scenario, registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_update_all() {
        let owner = @0xCAFE;
        let mut scenario = test_scenario::begin(owner);
        {
            create_registry(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, owner);
        {
            let mut registry: EchoRegistry = test_scenario::take_from_sender(&scenario);
            update_all(
                &mut registry,
                b"new_blob",
                2,
                b"session_id",
                test_scenario::ctx(&mut scenario),
            );
            assert!(registry.data_blob_id == b"new_blob", 0);
            assert!(registry.mode == 2, 1);
            assert!(registry.session_auth_id == b"session_id", 2);
            test_scenario::return_to_sender(&scenario, registry);
        };
        test_scenario::end(scenario);
    }
}
