import { Address, xdr } from '@stellar/stellar-sdk'

const cred_xdr = 'AAAAAQAAAAF6gVF2E0+pwV5vWTPtG5VyHJ/X54JHeZUczj7CnvD12yDu4I6e6ZFHAAJ+ZgAAABAAAAABAAAAAQAAABEAAAABAAAAAQAAABAAAAABAAAAAgAAAA8AAAAHRWQyNTUxOQAAAAANAAAAIGsGKxYxF08hS1ap4iEHm23VophJPlpB5uFAHcIbUBDSAAAAEAAAAAEAAAACAAAADwAAAAdFZDI1NTE5AAAAAA0AAABATCGe41Xuovv1w5BXwfdupiYz86Ak2jdg432p8TNRTnHfShfVeiqxIKJr2mTHaCzxxoyNeA2h/4u/vxEOJUycBg=='

const credentials = xdr.SorobanCredentials.fromXDR(cred_xdr, 'base64')

xdr.SorobanCredentialsType.sorobanCredentialsAddress

console.log(
    credentials.switch() ===
    xdr.SorobanCredentialsType.sorobanCredentialsAddress()
);

const authEntryAddress = Address.fromScAddress(
    credentials.address().address(),
).toString();

console.log(authEntryAddress);