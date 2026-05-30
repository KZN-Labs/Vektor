/**
 * Session key utilities — server-side helpers for Echo session authorization.
 * The session private key is stored on Walrus (keyed under 'echo-session-key').
 * The on-chain SessionAuthorization object is created by the frontend
 * (signed by the user's main wallet), then its objectId is stored in EchoUserData.
 */

import { Ed25519Keypair }   from '@mysten/sui/keypairs/ed25519'
import { Transaction }      from '@mysten/sui/transactions'
import { writeUserData, readUserData } from '../walrus/client.js'

const SESSION_KEY = 'echo-session-key'

/* ─── Mode limits (in MIST: 1 SUI = 1e9 MIST) ─────────────────────────── */
// Using USD-equivalent USDC base units (6 decimals):
// $100 per tx / $500 per day for medium
// $10k per tx / $50k per day for high
export const MODE_LIMITS = {
  medium: { maxPerTx: 100_000_000n,     maxPerDay: 500_000_000n   },    // $100 / $500 in USDC micros
  high:   { maxPerTx: 10_000_000_000n,  maxPerDay: 50_000_000_000n },   // $10k / $50k
} as const

/* ─── Generate a new ephemeral session keypair ─────────────────────────── */
export function generateSessionKeypair(): Ed25519Keypair {
  return new Ed25519Keypair()
}

/* ─── Store the session private key on Walrus ───────────────────────────── */
export async function storeSessionKey(
  wallet:     string,
  secretKey:  Uint8Array,
): Promise<string> {
  // In production: encrypt with user's public key before storing.
  // For now: store as base64 on Walrus — only accessible via the blobId
  // reference on the user's on-chain EchoRegistry object.
  const b64 = Buffer.from(secretKey).toString('base64')
  return writeUserData(wallet, SESSION_KEY, { key: b64 })
}

/* ─── Load the session keypair from Walrus ────────────────────────────── */
export async function loadSessionKeypair(
  wallet: string,
): Promise<Ed25519Keypair | null> {
  try {
    const raw = await readUserData(wallet, SESSION_KEY) as { key: string } | null
    if (!raw?.key) return null
    const bytes = Buffer.from(raw.key, 'base64')
    return Ed25519Keypair.fromSecretKey(bytes)
  } catch {
    return null
  }
}

/* ─── Build the SessionAuthorization PTB (to be signed by the main wallet) */
export async function buildSessionAuthPtb(opts: {
  packageId:    string
  sessionAddr:  string
  maxPerTx:     bigint
  maxPerDay:    bigint
  expiresAt:    number   // epoch ms
  clockId?:     string
}): Promise<string /* base64 PTB */> {
  const { packageId, sessionAddr, maxPerTx, maxPerDay, expiresAt, clockId = '0x6' } = opts

  const tx = new Transaction()
  tx.moveCall({
    target:    `${packageId}::session_auth::create_and_share`,
    arguments: [
      tx.pure.address(sessionAddr),
      tx.pure.u64(maxPerTx),
      tx.pure.u64(maxPerDay),
      tx.pure.vector('u8', []),   // all protocols allowed
      tx.pure.u64(BigInt(expiresAt)),
      tx.object(clockId),
    ],
  })

  const bytes = await tx.build({ client: undefined as any })
  return Buffer.from(bytes).toString('base64')
}

/* ─── Verify a session auth object on-chain ──────────────────────────────── */
export async function verifySessionAuth(
  authObjectId: string,
  suiClient:    any,
): Promise<{ valid: boolean; expiresAt: number; maxPerTx: bigint; maxPerDay: bigint } | null> {
  try {
    const obj = await suiClient.getObject({
      id:      authObjectId,
      options: { showContent: true },
    })
    const fields = (obj?.data?.content as any)?.fields
    if (!fields) return null
    return {
      valid:     !fields.is_revoked && Number(fields.expires_at) > Date.now(),
      expiresAt: Number(fields.expires_at),
      maxPerTx:  BigInt(fields.max_amount_per_tx),
      maxPerDay: BigInt(fields.max_amount_per_day),
    }
  } catch {
    return null
  }
}
