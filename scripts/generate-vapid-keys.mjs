import crypto from 'node:crypto'

const ecdh = crypto.createECDH('prime256v1')
ecdh.generateKeys()
const base64url = buffer => buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

console.log('VAPID_PUBLIC_KEY=' + base64url(ecdh.getPublicKey()))
console.log('VAPID_PRIVATE_KEY=' + base64url(ecdh.getPrivateKey()))
console.log('VAPID_SUBJECT=mailto:info@deed.co.ke')
