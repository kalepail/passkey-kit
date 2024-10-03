#!/bin/bash

cd ext/js-stellar-sdk/ 
yarn run clean
yarn run build:ts
yarn run build:node
yarn run build:browser
cd ../../

rm -rf ext/@stellar
mkdir -p ext/@stellar/stellar-sdk
cp -R ext/js-stellar-sdk/lib ext/@stellar/stellar-sdk/
cp -R ext/js-stellar-sdk/dist ext/@stellar/stellar-sdk/
cp -R ext/js-stellar-sdk/types ext/@stellar/stellar-sdk/ 
cp ext/js-stellar-sdk/package.json ext/@stellar/stellar-sdk/

cd demo/
rm -rf node_modules pnpm-lock.yaml
pnpm install

cd ../