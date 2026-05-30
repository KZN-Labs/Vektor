/**
 * Echo Walrus storage — reads and writes EchoUserData blobs.
 * Reuses the shared WalrusClient from src/walrus/client.ts.
 * The registry in data/walrus-registry.json stores: wallet → { echo → blobId }.
 */

import { writeUserData, readUserData } from '../walrus/client.js'
import { EMPTY_ECHO_DATA, type EchoUserData } from './types.js'

const ECHO_KEY = 'echo'

/* ─── Read ─────────────────────────────────────────────────────────────── */

export async function readEchoData(wallet: string): Promise<EchoUserData> {
  try {
    const raw = await readUserData(wallet, ECHO_KEY)
    if (!raw) return structuredClone(EMPTY_ECHO_DATA)
    return raw as EchoUserData
  } catch {
    return structuredClone(EMPTY_ECHO_DATA)
  }
}

/* ─── Write (3 retries — never lose data silently) ─────────────────────── */

export async function writeEchoData(
  wallet: string,
  data:   EchoUserData,
): Promise<string> {
  data.lastUpdated = Date.now()
  // writeUserData already retries 3× and throws after failure
  return writeUserData(wallet, ECHO_KEY, data)
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/** Append one activity log entry (max 200 kept) */
export async function logActivity(
  wallet:  string,
  entries: { description: string; action: EchoUserData['activityLog'][0]['action']; guardianScore?: number; digest?: string; valueProtected?: number }[],
): Promise<void> {
  const data = await readEchoData(wallet)
  for (const e of entries) {
    data.activityLog.unshift({
      id:             crypto.randomUUID(),
      timestamp:      Date.now(),
      description:    e.description,
      action:         e.action,
      guardianScore:  e.guardianScore,
      digest:         e.digest,
      valueProtected: e.valueProtected,
    })
  }
  // Keep newest 200 entries
  if (data.activityLog.length > 200) {
    data.activityLog = data.activityLog.slice(0, 200)
  }
  await writeEchoData(wallet, data)
}
