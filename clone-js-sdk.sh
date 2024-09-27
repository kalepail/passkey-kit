#!/bin/bash

rm -rf ext/@stellar
mkdir -p ext/@stellar/stellar-sdk
cp -R ext/js-stellar-sdk/lib ext/@stellar/stellar-sdk/
cp -R ext/js-stellar-sdk/dist ext/@stellar/stellar-sdk/
cp -R ext/js-stellar-sdk/types ext/@stellar/stellar-sdk/ 
cp ext/js-stellar-sdk/package.json ext/@stellar/stellar-sdk/