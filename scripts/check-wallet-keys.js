'use strict'

// Load environment from .env.local then .env
require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

const { Keypair } = require('@solana/web3.js')
// bs58 v6 ships CJS at src/cjs/index.cjs; require() resolves to main field
const bs58 = require('bs58').default ?? require('bs58')

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function decodeBase58(str) {
  const result = []
  for (const char of str) {
    let carry = B58_ALPHABET.indexOf(char)
    if (carry < 0) throw new Error(`Invalid base58 character: '${char}'`)
    for (let i = result.length - 1; i >= 0; i--) {
      carry += result[i] * 58
      result[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      result.unshift(carry & 0xff)
      carry >>= 8
    }
  }
  let leadingZeros = 0
  for (const char of str) {
    if (char === '1') leadingZeros++
    else break
  }
  return Buffer.from([...Array(leadingZeros).fill(0), ...result])
}

function parseKeypair(raw) {
  const trimmed = raw.trim()

  // JSON array
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(trimmed)))
  }

  // Base58 (Phantom format) — skip if contains base64-only chars
  if (!/[+/=]/.test(trimmed)) {
    let b58
    try { b58 = decodeBase58(trimmed) } catch (_) { /* not base58 */ }
    if (b58) {
      if (b58.length === 64) return Keypair.fromSecretKey(b58)
      if (b58.length === 32) return Keypair.fromSeed(b58)
      throw new Error(
        `Private key decoded to ${b58.length} bytes. Expected 64 bytes. ` +
        `Phantom exports a base58 private key — check you pasted the private key, not a seed phrase or public address.`
      )
    }
  }

  // Base64
  const b64 = Buffer.from(trimmed, 'base64')
  if (b64.length === 64) return Keypair.fromSecretKey(b64)
  if (b64.length === 32) return Keypair.fromSeed(b64)
  throw new Error(`Private key decoded to ${b64.length} bytes — expected 64 bytes.`)
}

function shorten(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function check(privateKeyEnv, publicKeyEnv) {
  const raw = process.env[privateKeyEnv]?.trim()
  const expected = process.env[publicKeyEnv]?.trim()

  console.log(`\n── ${privateKeyEnv} → ${publicKeyEnv}`)

  if (!expected) {
    console.log(`  ⚠  ${publicKeyEnv} not set — cannot verify match`)
  } else {
    console.log(`  Expected: ${shorten(expected)} (${expected})`)
  }

  if (!raw) {
    console.log(`  ✗  ${privateKeyEnv} not set`)
    return
  }

  const hint = raw.length > 20 ? `${raw.length} chars` : '(short — may be invalid)'
  console.log(`  Key present: ${hint}`)

  try {
    const kp = parseKeypair(raw)
    const derived = kp.publicKey.toBase58()
    console.log(`  Derived:  ${shorten(derived)} (${derived})`)

    if (!expected) return

    if (derived === expected) {
      console.log(`  ✓  Public key matches`)
    } else {
      console.log(`  ✗  MISMATCH`)
      console.log(`     Derived:  ${derived}`)
      console.log(`     Expected: ${expected}`)
      console.log(`  → Verify you pasted the private key for ${publicKeyEnv}, not a different wallet.`)
    }
  } catch (err) {
    console.log(`  ✗  Parse error: ${err.message}`)
  }
}

console.log('BillionBoard wallet key check')
console.log('(Private keys are not printed)\n')

check('TOPUP_WALLET_PRIVATE_KEY', 'TOPUP_WALLET')
check('REVENUE_WALLET_PRIVATE_KEY', 'REVENUE_WALLET')

if (process.env.FEE_CREATOR_WALLET_PRIVATE_KEY?.trim()) {
  check('FEE_CREATOR_WALLET_PRIVATE_KEY', 'FEE_CREATOR_WALLET')
} else {
  console.log('\n── FEE_CREATOR_WALLET_PRIVATE_KEY — not set (optional pre-launch)')
}

console.log('')
