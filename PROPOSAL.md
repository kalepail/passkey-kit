# Smart wallet contract interface

With the release of [Protocol 21](https://stellar.org/blog/developers/announcing-protocol-21) (and specifically the inclusion of the secp256r1 verification  curve) Soroban now has tremendous first class support for passkey powered smart wallets.

Over the past months I've been hard at work designing a solid first stab at a v1 smart wallet contract interface for mainnet use. This is the culmination of that work in proposal form.

All the best work can reviewed in my [passkey-kit](https://github.com/kalepail/passkey-kit) repo. This repo includes the factory and wallet contracts, a demo client interface, a `passkey-kit` SDK tool to make interacting with the contract interface simple and painless and finally a [Mercury Zephyr](https://www.mercurydata.app/products/zephyr-vm) program for indexing contract events in order to make the wallet more usable client side.

This repo also makes use of a new [Launchtube service](https://github.com/kalepail/launchtube) which makes submitting Soroban transactions simple by handling the concerns of both transaction fees and sequence numbers.

The primary interest of this proposal is to detail the contract interface itself but many of the design decisions are informed by complexities and available solutions external to the interface. A well rounded understandings of all that's involved to make passkey powered smart wallets on Stellar actually work is necessary in order to arrive at a truly viable contract interface.

This proposal consists of two contracts, a factory “deployer” contract and the actual smart wallet interface.

# Contract 1: The Factory

Stellar doesn’t allow us to both deploy and initialize a contract atomically and so the ecosystem has adopted the workaround of having a factory contract which handles the deploying and then calling of the newly deployed contract’s initialize function. This deploy and init can happen atomically within Soroban.

The side benefit is we can ensure consistency of all contracts deployed from the same factory address. As long as the contract was deployed from a known factory address users and services have a guarantee of the initial inner form of the smart wallet. As we’ll see smart wallets have an `upgrade` method which will effectively break this guarantee but at the end of the day it’s a contract’s WASM hash we actually care about vs it’s factory address.

## Interface

```rust
// FUNCTIONS

fn init(wasm_hash: bytesn<32>) -> result<tuple<>,error>

fn deploy(id: bytes, pk: bytesn<65>) -> result<address,error>

// ERRORS

#[contracterror]
enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2
}
```

## Code

[https://github.com/kalepail/passkey-kit/blob/main/contracts/smart-wallet-factory/src/lib.rs](https://github.com/kalepail/passkey-kit/blob/main/contracts/smart-wallet-factory/src/lib.rs)

 

```rust
const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const STORAGE_KEY_WASM_HASH: Symbol = symbol_short!("hash");
```

Only thing to note in this block is I’m opting to max extend this contract’s instance during every call with a threshold of 7 days. This will be the same for the wallet interface itself. This will cause the initial calls for any storage write function to be somewhat inflated with the beneficial tradeoff that folks won’t have to worry about their wallets or keys expiring or archiving for `max_ttl` time. In my tests this cost was minimal and the improved UX of not having to worry about restoring archived entries in my opinion was worth it.

We could decide to make these values instance variables which could be updated or even make them configurable on a key by key basis however that would increase complexity and cost in many cases and without further real world data to support that choice I’m suggesting simplicity.

### `init`
```rust
pub fn init(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
    if env.storage().instance().has(&STORAGE_KEY_WASM_HASH) {
        return Err(Error::AlreadyInitialized);
    }

    let max_ttl = env.storage().max_ttl();

    env.storage()
        .instance()
        .set(&STORAGE_KEY_WASM_HASH, &wasm_hash);

    env.storage()
        .instance()
        .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

    Ok(())
}
```

Nothing controversial here I don’t think. We’re storing the smart wallet’s wasm hash in order to load up the factory with the proper template to deploy in the `deploy` function. This is stored on the instance as it should be and then the instance is extended 

### `deploy`
```rust
pub fn deploy(env: Env, salt: BytesN<32>, id: Bytes, pk: BytesN<65>) -> Result<Address, Error> {
    let wasm_hash = env
        .storage()
        .instance()
        .get::<Symbol, BytesN<32>>(&STORAGE_KEY_WASM_HASH)
        .ok_or(Error::NotInitialized)?;

    let address = env
        .deployer()
        .with_current_contract(salt)
        .deploy(wasm_hash);

    let () = env.invoke_contract(
        &address,
        &symbol_short!("add"),
        vec![&env, id.to_val(), pk.to_val(), true.into()],
    );

    let max_ttl = env.storage().max_ttl();

    env.storage()
        .instance()
        .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

    Ok(address)
}
```

Few things to note here:

- Also note we’re calling the `env.invoke_contract` vs pulling in the smart wallet interface. This is a cost savings as we’re only making use of the `add` method. This requires knowing intuitively how to properly construct the invocation but let’s be honest, that’s not hard.
- Last thing is extending the interface again. If you’re gonna use the factory at least pay it forward a little to help keep the factory’s lights on.

# Contract 2: The Smart Wallet

The smart wallet interface while obviously more complex than the factory is still aiming to be as simple as possible and only do what’s absolutely necessary to provide a useful smart wallet interface for general purpose usage.

I’ve intentionally left off as many bells and whistles as possible with the hope of being able to agree and progress with this interface into an audited and approved mainnet interface for general usage. Certainly there will be additional features and functions users and services will want and I hope to see a rich and diverse ecosystem of wallet interfaces arise over time but initially we just need to get something sufficiently useful live providing the basic majority needs of non crypto-native users.

## Interface

```rust
// FUNCTIONS

fn add(id: bytes, pk: bytesn<65>, admin: bool) -> result<tuple<>,error>

fn remove(id: bytes) -> result<tuple<>,error>

fn upgrade(hash: bytesn<32>) -> result<tuple<>,error>

fn __check_auth(signature_payload: bytesn<32>, signature: Signature, auth_contexts: vec<Context>) -> result<tuple<>,error>

// STRUCTS

#[contracttype]
struct Signature {
    authenticator_data: bytes,
    client_data_json: bytes,
    id: bytes,
    signature: bytesn<64>
}

// ERRORS

#[contracterror]
enum Error {
    NotFound = 1,
    NotPermitted = 2,
    ClientDataJsonChallengeIncorrect = 3,
    Secp256r1PublicKeyParse = 4,
    Secp256r1SignatureParse = 5,
    Secp256r1VerifyFailed = 6,
    JsonParseError = 7,
}

```

## Code

[https://github.com/kalepail/passkey-kit/blob/main/contracts/smart-wallet/src/lib.rs](https://github.com/kalepail/passkey-kit/blob/main/contracts/smart-wallet/src/lib.rs)

### `add`
```rust
pub fn add(env: Env, id: Bytes, pk: BytesN<65>, mut admin: bool) -> Result<(), Error> {
    if env.storage().instance().has(&ADMIN_SIGNER_COUNT) {
        env.current_contract_address().require_auth();   
    } else {
        admin = true;
    }

    let max_ttl = env.storage().max_ttl();

    if admin {
        if env.storage().temporary().has(&id) {
            env.storage().temporary().remove(&id);
        }

        Self::update_admin_signer_count(&env, true);

        env.storage().persistent().set(&id, &pk);

        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
    } else {
        if env.storage().persistent().has(&id) {
            Self::update_admin_signer_count(&env, false);

            env.storage().persistent().remove(&id);
        }

        env.storage().temporary().set(&id, &pk);

        env.storage()
            .temporary()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
    }

    env.storage()
        .instance()
        .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

    env.events()
        .publish((EVENT_TAG, symbol_short!("add"), id), (pk, admin));

    Ok(())
}
```

Some notable elements:

- We use the `env.storage().instance().has(&ADMIN_SIGNER_COUNT)` to toggle between a sort of initialization call and the standard `require_auth` flow.
    
    ```rust
    if env.storage().instance().has(&ADMIN_SIGNER_COUNT) {
        env.current_contract_address().require_auth();   
    } else {
        admin = true;
    }
    ```
    
    The only potential downside is `add` includes logic for storing temporary session signers which an initial call doesn't support making that logic verbose. Initially I had a separate `init` function but I think this is a better tradeoff for simplicity and efficiency even if there are some unusable if statements in the case of the initial `add` call made by the factory contract.
    
- `Self::update_admin_signer_count(&env, true);` My proposal includes the concept of session and admin signers. Certain functions, well really all of the smart wallet self functions (`add`, `remove`, `upgrade`) are only callable by admin signers. Given this we need to ensure we never remove all the admin signers which necessarily requires we track the number of admin signers. This function provides that service and will be called anytime we add or remove an admin signer.
- Admin signers are persistent entries, non-admin signers are temporary. It’s also possible for signers to be toggled between admin and non however we must only ever be tracking a single `id` to a single `pk` and so we must add logic for removing any existing signers for a given `id` in the counter storage to the type we’re currently adding to. Make special note of the need to decrement the `ADMIN_SIGNER_COUNT` in case of removing an admin signer to temporary if a persistent entry for that `id` exists.
    
    ```rust
    if admin {
        if env.storage().temporary().has(&id) {
            env.storage().temporary().remove(&id);
        }
    
        Self::update_admin_signer_count(&env, true);
    
        env.storage().persistent().set(&id, &pk);
    
        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
    } else {
        if env.storage().persistent().has(&id) {
            Self::update_admin_signer_count(&env, false);
    
            env.storage().persistent().remove(&id);
        }
    
        env.storage().temporary().set(&id, &pk);
    
        env.storage()
            .temporary()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
    }
    ```
    
### `remove`
```rust
pub fn remove(env: Env, id: Bytes) -> Result<(), Error> {
    env.current_contract_address().require_auth();

    if env.storage().temporary().has(&id) {
        env.storage().temporary().remove(&id);
    } else {
        Self::update_admin_signer_count(&env, false);

        env.storage().persistent().remove(&id);
    }

    let max_ttl = env.storage().max_ttl();

    env.storage()
        .instance()
        .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

    env.events()
        .publish((EVENT_TAG, symbol_short!("remove"), id), ());

    Ok(())
}
```

Remove is similar to `add` just in inverse with some slight simplifications.

- Given the key could be either temporary or persistent we must include logic for checking both and removing if they exist. Again note the need to decrement the `ADMIN_SIGNER_COUNT` in case of a persistent admin `id`.
- Given each `id` can only be either a temporary or persistent entry it's safe to use `else if env.storage().persistent().has(&id)` vs a separate `if ...`. Doing so saves on some read costs if we were to try and just remove both storage type for the same `id` key. Note we do need to use the has check vs just doing an `else` check as a `storage.remove` won't error if the entry doesn't exist which would open us up to the issue of decrementing the admin key count when we didn't actually delete anything.

### `update`
```rust
pub fn update(env: Env, hash: BytesN<32>) -> Result<(), Error> {
    env.current_contract_address().require_auth();

    env.deployer().update_current_contract_wasm(hash);

    let max_ttl = env.storage().max_ttl();

    env.storage()
        .instance()
        .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

    Ok(())
}
```

An essential function for all smart wallets imo. The ability to change the interface the wallet implements. Perhaps controversial given the risk of upgrading to a bugged or malicious wallet interface but that’s an risk inherent to creating a smart wallet in the first place and given that risk I actually think part of mitigating that risk is allowing users to move their interface to alternatives should they choose to. Client interfaces should be very careful in exposing this method to wallet users but I do think it’s an essential method for the health and safety of the smart wallet ecosystem.

- Protected such that only admin signers can perform this method.
- Allows for a wallet user to switch or update their interface should newer or different interfaces be released.

### `__check_auth`
```rust
fn __check_auth(
    env: Env,
    signature_payload: Hash<32>,
    signature: Signature,
    auth_contexts: Vec<Context>,
) -> Result<(), Error> {...}
```

This is the beefy boy and most of it is only interesting to auditors ensuring the actual decoding and cryptography bits work as intended. I’ll detail the parts here which are more specific to the interface itself:

- We need to select which `pk` to use for the provided `id` purporting to have signed for the incoming payload.
    
    ```rust
    let pk = match env.storage().temporary().get(&id) {
      Some(pk) => {
          ...
    
          env.storage()
              .temporary()
              .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
    
          pk
      }
      None => {
          env.storage()
              .persistent()
              .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
    
          env.storage().persistent().get(&id).ok_or(Error::NotFound)?
      }
    };
    ```
    
    We do that first by looking up the temporary entry which will be the far more common case. If we cannot find it there we look for a persistent entry. This will introduce a double look up for a temporary entry but those are cheap so this is fine. Note we also set the `admin` binary toggle for use later in blocking protected self methods.
    
- If the pk is a temporary session signer we need to do an additional check to ensure the authentication request isn’t for a protected action
    
    ```rust
    
    ...
    
    for context in auth_contexts.iter() {
        match context {
            Context::Contract(c) => {
                if c.contract == env.current_contract_address()
                    && (
                        c.fn_name != symbol_short!("remove")
                        || (
                            c.fn_name == symbol_short!("remove") 
                            && Bytes::from_val(&env, &c.args.get(0).unwrap()) != id
                        )
                    )
                {
                    return Err(Error::NotPermitted);
                }
            }
            _ => {}
        };
    }
    
    ...
    ```
    
    This is a relatively straight forward check. If the request is for the smart wallet contract ensure the only function it *might* be able to call is a `remove` of it’s own `id`. Anything else should result in an error.
    

The rest of `__check_auth` is boilerplate authentication checks of the signature data itself and not technically part of this interface. It needs to be audited but that won’t affect the final interface of the wallet.

# Events

The only other item worth mentioning are the events emitted during the `add` and `remove` methods. Events are emitted in order to allow an indexer to keep track of a wallet’s available signers and their current state as `admin` or not.

## Add

```rust
env.events().publish((EVENT_TAG, symbol_short!("add"), id), (pk, admin));
```

- The `EVENT_TAG` is a trigger to help indexers only listen for relevant smart wallet events and while not fool proof should improve filtering out only those events which are relevant.
- The `pk` is emitted in order to allow downstream clients to queue up expired session signers to be re-added without needing to create new passkeys, you can continue to use the existing ones if you can find the `pk` for a matching `id` from a previously emitted event.
    
> [!CAUTION]
> Passkey public keys are only retrievable during a passkey creation flow. They cannot be later retrieved from an authentication flow. Thus passkey public keys are special data which we should be storing inside the blockchain itself. This is normally done during an `add` event but given we’re using temporary storage these keys could be lost and unrecoverable were we not to store them inside events for indexers to keep track of and then for clients to then be able to essentially “rehydrate” at a later date without requiring the user to keep creating new passkeys every time they wanted to sign into a service after their temporary session key had expired.
    

## Remove

```rust
env.events().publish((EVENT_TAG, symbol_short!("remove"), id), ());
```