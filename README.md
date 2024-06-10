# passkey-kit

To install dependencies:

```bash
pnpm i
```

To build:

```bash
pnpm run build
```

If you fiddle with contracts in `./contracts` you'll need to run the make commands. Just remember to update the `WEBAUTHN_FACTORY` and `WEBAUTHN_WASM` values from the `make deploy` command before running `make init`. Once you run `make init` you'll need to update all the `.env` site files with the new `PUBLIC_factoryContractId`.

Keep in mind the bindings here in `./packages` have been _heavily_ modified. Be careful when rebuilding and updating. Likely you'll only want to update the `src/index.ts` files in each respective package.

## TODO
- [ ] Signer list should be paginated
- [ ] Attach some meaningful metadata to signers so you know which one belongs to which domain