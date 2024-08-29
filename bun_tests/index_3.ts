import { Address } from '@stellar/stellar-sdk'

const contract = Buffer.from([
    40, 76, 4, 220, 239, 185, 174, 223, 218, 252, 223, 244, 153, 121, 154, 92, 108, 72, 251, 184,
    70, 166, 134, 111, 165, 220, 84, 86, 184, 196, 55, 73,
])

console.log(
    Address.contract(contract).toString()
);