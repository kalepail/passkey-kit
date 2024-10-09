# Passkey Kit

> [!WARNING]  
> Code in this repo is demo material only. It has not been audited. Do not use to hold, protect, or secure anything.

Passkey kit is a basic TypeScript SDK for creating and managing Stellar smart wallets. It's intended to be used in tandem with [Launchtube](https://github.com/kalepail/launchtube) for submitting passkey signed transactions onchain however this is not a requirement. This is both a client and a server side library. `PasskeyKit` on the client and `PasskeyServer` on the server.

Demo site: [passkey-kit-demo.pages.dev](https://passkey-kit-demo.pages.dev/)

To get started first install the package:
```
pnpm i passkey-kit
```

On the client:
```ts
const account = new PasskeyKit({
    rpcUrl: env.PUBLIC_rpcUrl,
    networkPassphrase: env.PUBLIC_networkPassphrase,
    factoryContractId: env.PUBLIC_factoryContractId,
});
```

On the server:
```ts
const account = new PasskeyServer({
    rpcUrl: env.PUBLIC_rpcUrl,
    launchtubeUrl: env.PUBLIC_launchtubeUrl,
    launchtubeJwt: env.PRIVATE_launchtubeJwt,
    mercuryUrl: env.PUBLIC_mercuryUrl,
    mercuryJwt: env.PRIVATE_mercuryJwt,
});
```

This is a fully typed library so docs aren't provided, however there's a full example showcasing all the core public methods in the `./demo` directory. I also recommend reviewing the [Super Peach](https://github.com/kalepail/superpeach) repo for an example of how you could implement both the client and server side in a more real-world scenario.

Good luck, have fun, and change the world!

For any questions or to showcase your progress please join the `#passkeys` channel on our [Discord](https://discord.gg/stellardev).

## Deploy the event indexer

In order to utilize the Mercury Zephyr indexing service to track available signers and reverse lookup smart wallet contract addresses from passkey ids you'll need to deploy the Zephyr program from inside the `./zephyr` directory.

```bash
cd ./zephyr
cargo install mercury-cli
# Get a JWT from Mercury https://test.mercurydata.app
export MERCURY_JWT="<YOUR.MERCURY.JWT>"
# Make sure you're on Rust version 1.79.0 or newer
mercury-cli --jwt $MERCURY_JWT --local false --mainnet false deploy
```

## TypeScript gotchas

This is a TypeScript library and the npm package doesn't export a JavaScript version. The `@stellar/stellar-sdk` library is enormous and I really don't wan't folks bundling it up twice. Therefore you'll need to ensure you're transpiling this library into your project and that goes for either a TS project or a JS one. For many of you this will "just work" but for others you'll need to do some fiddling.

For example if you're using NextJS this will mean modifying your `next.config.mjs` file to include the following packages in the `transpilePackages` key:
```mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: [
        'passkey-kit', 
        'passkey-factory-sdk', 
        'passkey-kit-sdk',
        'sac-sdk',
    ]
};

export default nextConfig;
```
If someone smarter than me knows how to include an optional JS build from a TS library please submit a PR. I just don't want to deploy a compiled version of this and wind up having folks doubling up on an already gargantuan dependency.

## Contributing 

Passkey kit consists of three primary directories:
- `./src` - Contains the TypeScript files for the actual TS SDK library.
- `./demo` - Contains a basic demo of the SDK in action.
- `./contracts` - Contains the Rust Soroban smart contracts of the smart wallet implementation.
- `./zephyr` - Contains the [Zephyr](https://www.mercurydata.app/products/zephyr-vm) program for processing smart wallet events.

To install dependencies:

```bash
pnpm i
```

To build:

```bash
pnpm run build
```

To run the demo:

```bash
cd ./demo
pnpm i
pnpm run start
```

> [!IMPORTANT]
> If you fiddle with contracts in `./contracts` you'll need to run the make commands. Just remember to update the `SMART_WALLET_FACTORY` and `SMART_WALLET_WASM` values from the `make deploy` command before running `make init`.

> [!IMPORTANT]
> Keep in mind the bindings here in `./packages` have been _heavily_ modified. Be careful when rebuilding and updating. Likely you'll only want to update the `src/index.ts` files in each respective package vs swapping out entire directories.
