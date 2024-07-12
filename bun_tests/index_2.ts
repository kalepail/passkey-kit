import base64url from 'base64url'

let publicKey = base64url.toBuffer("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEIWhAQyE5H-_9WM__87tYZq3yJPQ0rostof00z3MMSMqG3SuBh2TaTUHQDwd4CHyArPQ4EhKoScPbq0zxm1k_Dw")
let authenticatorData = base64url.toBuffer("SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NBAAAABAAAAAAAAAAAAAAAAAAAAAAAQA8EYfqizPJVk0HtwVdqazrXmAyb7tuHDD7PzBmf6gFOyCngKjd1RCTIQHCpS3SMyeYULBg7Ykx6n1usOd5PlSilAQIDJiABIVggIWhAQyE5H-_9WM__87tYZq3yJPQ0rostof00z3MMSMoiWCCG3SuBh2TaTUHQDwd4CHyArPQ4EhKoScPbq0zxm1k_Dw")
let attestationObject = base64url.toBuffer("o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjESZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NBAAAABAAAAAAAAAAAAAAAAAAAAAAAQA8EYfqizPJVk0HtwVdqazrXmAyb7tuHDD7PzBmf6gFOyCngKjd1RCTIQHCpS3SMyeYULBg7Ykx6n1usOd5PlSilAQIDJiABIVggIWhAQyE5H-_9WM__87tYZq3yJPQ0rostof00z3MMSMoiWCCG3SuBh2TaTUHQDwd4CHyArPQ4EhKoScPbq0zxm1k_Dw")

///

let publicK = publicKey.slice(publicKey.length - 65).toString('hex')

///

const credentialIdLength = (authenticatorData[53] << 8) | authenticatorData[54]
    
let authenticatorD = Buffer.from([
    0x04,
    ...authenticatorData.slice(65 + credentialIdLength, 97 + credentialIdLength),
    ...authenticatorData.slice(100 + credentialIdLength, 132 + credentialIdLength)
]).toString('hex')
   
///

let publicKeykPrefixSlice = Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20])
let startIndex = attestationObject.indexOf(publicKeykPrefixSlice)
    startIndex = startIndex + publicKeykPrefixSlice.length

let attestationO = Buffer.from([
    0x04,
    ...attestationObject.slice(startIndex, 32 + startIndex),
    ...attestationObject.slice(35 + startIndex, 67 + startIndex)
]).toString('hex')

///

console.log(`
    ${publicK}
    ${authenticatorD}
    ${attestationO}
`)