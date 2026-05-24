/**
 * Private key parsing and diagnostics for settlement wallets.
 *
 * Server-side only — never import in client components or NEXT_PUBLIC_ paths.
 * Never logs or returns private key material.
 *
 * Supported key formats:
 *   1. JSON byte array: [1, 2, ..., 64]
 *   2. Base58 string (Phantom "Show Private Key" export)
 *   3. Base64 string (some CLI tools)
 *
 * Both 64-byte secret keys (full keypair) and 32-byte seeds are handled.
 */

import { Keypair } from '@solana/web3.js'

export interface KeyDiagnostic {
  present: boolean
  parseStatus: 'ok' | 'parse_error' | 'missing'
  derivedPubkey: string | null      // abbreviated: first6…last4
  derivedPubkeyFull: string | null  // full base58 pubkey
  expectedPubkey: string | null     // abbreviated
  matches: boolean | null
  error: string | null
}

// ── Base58 decode (inline — avoids ESM interop issues with bs58 v6) ──────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function decodeBase58(str: string): Uint8Array {
  const result: number[] = []
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
  // Preserve leading zero bytes for leading '1' chars
  let leadingZeros = 0
  for (const char of str) {
    if (char === '1') leadingZeros++
    else break
  }
  return new Uint8Array([...Array<number>(leadingZeros).fill(0), ...result])
}

// ── Key parser ───────────────────────────────────────────────────────────────

function friendlyLengthError(len: number): string {
  return (
    `Private key decoded to ${len} bytes. Expected a Solana secret key (64 bytes). ` +
    `Phantom exports a base58 private key — verify this is the private key for the ` +
    `correct wallet, not a recovery phrase or public address.`
  )
}

export function parseKeypair(raw: string): Keypair {
  const trimmed = raw.trim()

  // 1. JSON byte array: [1, 2, …, 64]
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as number[]
    return Keypair.fromSecretKey(new Uint8Array(arr))
  }

  // 2. Base58 (Phantom export format and Solana CLI)
  // Only attempt if string looks like base58 (no base64-only chars: +, /, =)
  if (!/[+/=]/.test(trimmed)) {
    let b58Bytes: Uint8Array | null = null
    try {
      b58Bytes = decodeBase58(trimmed)
    } catch { /* not valid base58 */ }

    if (b58Bytes !== null) {
      if (b58Bytes.length === 64) return Keypair.fromSecretKey(b58Bytes)
      if (b58Bytes.length === 32) return Keypair.fromSeed(b58Bytes)
      throw new Error(friendlyLengthError(b58Bytes.length))
    }
  }

  // 3. Base64
  const b64Bytes = Buffer.from(trimmed, 'base64')
  if (b64Bytes.length === 64) return Keypair.fromSecretKey(b64Bytes)
  if (b64Bytes.length === 32) return Keypair.fromSeed(b64Bytes)
  throw new Error(friendlyLengthError(b64Bytes.length))
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

/**
 * Parse a private key and compare the derived public key to the expected wallet.
 * Never returns the raw key material.
 */
export function checkKeyDiagnostic(
  raw: string | null,
  expectedPubkey: string | null
): KeyDiagnostic {
  const expectedShort = expectedPubkey ? shorten(expectedPubkey) : null

  if (!raw) {
    return {
      present: false,
      parseStatus: 'missing',
      derivedPubkey: null,
      derivedPubkeyFull: null,
      expectedPubkey: expectedShort,
      matches: null,
      error: null,
    }
  }

  try {
    const kp = parseKeypair(raw)
    const derived = kp.publicKey.toBase58()
    const matches = expectedPubkey !== null ? derived === expectedPubkey : null
    return {
      present: true,
      parseStatus: 'ok',
      derivedPubkey: shorten(derived),
      derivedPubkeyFull: derived,
      expectedPubkey: expectedShort,
      matches,
      error:
        matches === false
          ? `Private key parses but does not match expected wallet (${expectedShort}). Settlement disabled for safety.`
          : null,
    }
  } catch (err) {
    return {
      present: true,
      parseStatus: 'parse_error',
      derivedPubkey: null,
      derivedPubkeyFull: null,
      expectedPubkey: expectedShort,
      matches: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
