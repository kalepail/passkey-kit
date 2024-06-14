# Passkey Kit

Passkey kit is a basic TypeScript SDK for creating and managing Stellar smart wallets. It's intended to be used in tandem with [Launchtube](https://github.com/kalepail/launchtube) for submitting passkey signed transactions onchain however this is not a requirement. This is both a client and a server side library. `PasskeyKit` on the client and `PasskeyBase` on the server.

Demo site: [passkey-kit-demo.pages.dev](https://passkey-kit-demo.pages.dev/)

To get started first install the package:
```
pnpm i passkey-kit
```

On the client:
```ts
const account = new PasskeyKit({
    rpcUrl: env.RPC_URL,
    networkPassphrase: env.NETWORK_PASSPHRASE
});
```

On the server:
```ts
const account = new PasskeyKit({
    launchtubeUrl: env.LAUNCHTUBE_URL,
    launchtubeJwt: env.LAUNCHTUBE_JWT,
});
```

Note that while I don't recommend it you can use the server-intended `send` method on the client side by passing in the `launchtubeUrl` and `launchtubeJwt` values to the `PasskeyKit` constructor. We do this in the `./demo` site to ease demonstration, development and experimentation, however in a production environment you'll want to keep your secrets safe on the server.

This is a fully typed library so docs aren't provided, however there's a full example showcasing all the core public methods in the `./demo` directory. I also recommend reviewing the [Super Peach](https://github.com/kalepail/superpeach) repo for an example of how you could implement both the client and server side in a more real-world scenario.

Good luck, have fun, and change the world!

For any questions or to showcase your progress please join the `#passkeys` channel on our [Discord](https://discord.gg/stellardev).

## Contributing 

Passkey kit consists of three primary directories:
- `./contracts` - Contains the Rust Soroban smart contracts of the smart wallet implementation.
- `./src` - Contains the TypeScript files for the actual TS SDK library.
- `./demo` - Contains a basic demo of the SDK in action.

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

[!IMPORTANT]
> If you fiddle with contracts in `./contracts` you'll need to run the make commands. Just remember to update the `WEBAUTHN_FACTORY` and `WEBAUTHN_WASM` values from the `make deploy` command before running `make init`.

[!IMPORTANT]
> Keep in mind the bindings here in `./packages` have been _heavily_ modified. Be careful when rebuilding and updating. Likely you'll only want to update the `src/index.ts` files in each respective package vs swapping out entire directories.