/**
 * Walrus read/write for Cloudflare Worker context.
 * Uses the REST API directly (no Node.js SDK, runs in Workers runtime).
 */

import type { EchoUserData, Env } from './types'

const WALRUS_AGGREGATOR_TESTNET  = 'https://aggregator.walrus-testnet.walrus.space'
const WALRUS_PUBLISHER_TESTNET   = 'https://publisher.walrus-testnet.walrus.space'
const WALRUS_AGGREGATOR_MAINNET  = 'https://aggregator.walrus.space'
const WALRUS_PUBLISHER_MAINNET   = 'https://publisher.walrus.space'

function getAggregator(env: Env): string {
  return env.SUI_NETWORK === 'mainnet' ? WALRUS_AGGREGATOR_MAINNET : WALRUS_AGGREGATOR_TESTNET
}

function getPublisher(env: Env): string {
  return env.SUI_NETWORK === 'mainnet' ? WALRUS_PUBLISHER_MAINNET : WALRUS_PUBLISHER_TESTNET
}

/** Read a blob by ID and decode as JSON */
export async function readBlob(blobId: string, env: Env): Promise<unknown> {
  const url = `${getAggregator(env)}/v1/blobs/${blobId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Walrus read failed: ${res.status} ${res.statusText}`)
  const bytes = await res.arrayBuffer()
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** Write JSON data to Walrus, return blobId. Retries up to 3×. */
export async function writeBlob(data: unknown, env: Env, epochs = 30): Promise<string> {
  const body = new TextEncoder().encode(JSON.stringify(data))
  let lastErr: unknown

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt))
    try {
      const url = `${getPublisher(env)}/v1/blobs?epochs=${epochs}&deletable=true`
      const res = await fetch(url, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`Walrus write failed: ${res.status}`)
      const json = await res.json() as any
      // Response: { newlyCreated: { blobObject: { blobId } } } | { alreadyCertified: { blobId } }
      const blobId = json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId
      if (!blobId) throw new Error('No blobId in Walrus response')
      return blobId
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`Walrus write failed after 3 attempts: ${String(lastErr)}`)
}

/** Fetch EchoUserData from a known blobId */
export async function readEchoData(blobId: string, env: Env): Promise<EchoUserData> {
  return readBlob(blobId, env) as Promise<EchoUserData>
}
