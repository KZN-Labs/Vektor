/**
 * Echo executor — signs and executes transactions using the session key.
 * Only called in HIGH mode after rule evaluation confirms execution should proceed.
 */

import { pushExecuted } from './alerter'
import type { EchoUser, Env, EchoRule } from './types'
import type { State }  from './evaluator'
import { readBlob }    from './walrus'

export async function executeWithSessionKey(opts: {
  user:   EchoUser
  ptbB64: string
  env:    Env
  description: string
  estimatedUsd?: number
}): Promise<string /* digest */> {
  const { user, ptbB64, env, description, estimatedUsd } = opts
  const meta = user.echoData.sessionKeyMetadata
  if (!meta) throw new Error('No session key metadata')
  if (meta.expiresAt < Date.now()) throw new Error('Session key expired')

  // Load session private key from Walrus
  // The session key blobId is stored separately from main EchoUserData
  // Key reference stored in local registry on the server — not available in worker.
  // In production, the worker would have its own KV or Durable Object for key storage.
  // For now, throw — executor requires server-side key retrieval which is handled
  // by the Vektor backend's /api/echo/:wallet/execute endpoint.
  throw new Error(
    'Direct worker execution not yet implemented — session key retrieval requires server-side call. ' +
    'Use /api/echo/:wallet/execute endpoint instead.'
  )
}

/** Execute a rule that has been evaluated as true */
export async function executeRule(
  rule:  EchoRule,
  user:  EchoUser,
  state: State,
  env:   Env,
): Promise<void> {
  // For now: log the intended execution and push notification
  // Full PTB building requires the Routex SDK and NAVI PTB builder
  // which are available in the Vektor server, not the worker
  const description = rule.parsed.action ?? rule.raw
  await pushExecuted(user.address, `[Simulated] ${description}`, '', undefined, env).catch(() => {})
}

/** Check if a scheduled intent is due and execute it */
export async function executeScheduledIntent(
  user:   EchoUser,
  intentId: string,
  env:    Env,
): Promise<void> {
  const intent = user.echoData.scheduledIntents.find(s => s.id === intentId)
  if (!intent || !intent.active) return
  // Trigger execution via Vektor backend
  // The worker signals the backend which has full SDK access
  await pushExecuted(user.address, `Scheduled: ${intent.raw}`, '', undefined, env).catch(() => {})
}
