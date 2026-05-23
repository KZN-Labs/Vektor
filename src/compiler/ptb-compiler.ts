import Routex from 'routex-sui'
import type { RoutexQuote } from 'routex-sui'
import type { VektorIntent } from '../types.js'

export interface CompileResult {
  intent: VektorIntent
  quote: RoutexQuote
}

/**
 * PTB Compiler — resolves a VektorIntent into a Routex quote with pre-built PTB.
 *
 * This is the boundary between intent resolution and on-chain execution.
 * The quote returned contains a fully-constructed Programmable Transaction Block
 * ready to be signed and submitted.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  SEAL_V1.5 — encrypt intent here using Seal SDK before submission   │
 * │  to prevent front-running. The parsed intent should be encrypted     │
 * │  with the validator's public key before being passed to Routex's     │
 * │  quote engine. Slot this in between parseIntent() and getQuote().    │
 * │                                                                      │
 * │  Usage (future):                                                     │
 * │    const encryptedIntent = await sealClient.encrypt(intent)          │
 * │    const quote = await routex.getQuote({ ...encryptedIntent, ... })  │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export class PTBCompiler {
  private routex: Routex

  constructor(
    private readonly network: 'mainnet' | 'testnet',
    private readonly senderAddress: string,
  ) {
    this.routex = new Routex(network, senderAddress)
  }

  async compile(intent: VektorIntent): Promise<CompileResult> {
    if (Date.now() > intent.deadline) {
      throw new Error(
        `Intent ${intent.id} has expired. Parse a new intent and try again.`,
      )
    }

    // SEAL_V1.5 — encrypt intent here using Seal SDK before submission
    // to prevent front-running. See block comment above for integration notes.

    const quote = await this.routex.getQuote({
      from:              intent.from,
      to:                intent.to,
      amount:            intent.amountIn,
      slippageTolerance: intent.slippageTolerance,
      senderAddress:     this.senderAddress,
    })

    return { intent, quote }
  }
}
