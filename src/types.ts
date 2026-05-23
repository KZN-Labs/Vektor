import type { RoutexQuote } from 'routex-sui'

// ─── Intent ───────────────────────────────────────────────────────────────────

export type SlippagePreset = 'low' | 'medium' | 'high'

export interface ParseIntentParams {
  action: 'swap'
  from: string
  to: string
  /** Human-readable amount, e.g. "1.5" or "100". Vektor converts to base units. */
  amount: string | number | bigint
  /** 'low'=0.1%, 'medium'=0.5%, 'high'=1%, or a raw decimal like 0.005 */
  slippage?: SlippagePreset | number
  /** Maximum price impact before Guardian blocks execution. Decimal. Default 0.03 */
  maxPriceImpact?: number
  /** Quote deadline in seconds from now. Default 28 (leaves buffer before 30 s TTL). */
  deadlineSeconds?: number
}

export interface VektorIntent {
  id: string
  action: 'swap'
  from: string
  to: string
  amountIn: bigint           // base units
  slippageTolerance: number  // decimal
  maxPriceImpact: number     // decimal
  deadline: number           // unix ms
  createdAt: number          // unix ms
}

// ─── Guardian ─────────────────────────────────────────────────────────────────

export enum RiskClass {
  HIGH_PRICE_IMPACT       = 'HIGH_PRICE_IMPACT',
  LOOSE_SLIPPAGE          = 'LOOSE_SLIPPAGE',
  STALE_QUOTE             = 'STALE_QUOTE',
  THIN_LIQUIDITY          = 'THIN_LIQUIDITY',
  INSUFFICIENT_GAS        = 'INSUFFICIENT_GAS',
  PROTOCOL_CONCENTRATION  = 'PROTOCOL_CONCENTRATION',
  LARGE_TRADE             = 'LARGE_TRADE',
}

export type RiskSeverity = 'info' | 'warn' | 'block'

export interface RiskFlag {
  class: RiskClass
  severity: RiskSeverity
  message: string
}

export interface GuardianReport {
  intent: VektorIntent
  quote: RoutexQuote
  risks: RiskFlag[]
  /** True if any risk has severity === 'block' */
  blocked: boolean
}

// ─── Confirmation Gate ────────────────────────────────────────────────────────

export interface GateDecision {
  proceed: boolean
  report: GuardianReport
}

// ─── VektorLog ────────────────────────────────────────────────────────────────

export interface LogEntry {
  intentId: string
  protocol: string
  amountIn: bigint
  amountOut: bigint
  digest: string
  timestamp: number
}

// ─── zkLogin ──────────────────────────────────────────────────────────────────

export interface ZkLoginSession {
  /** Ephemeral keypair used to sign transactions within this session */
  ephemeralKeypair: any
  /** The JWT from the OAuth provider */
  jwt: string
  /** Nonce sent to the OAuth provider, derived from the ephemeral key */
  nonce: string
  /** Derived Sui address for this session */
  address: string
  /** ZK proof returned by the Mysten prover service */
  proof: ZkProof
  /** Max epoch this session is valid until */
  maxEpoch: number
}

export interface ZkProof {
  proofPoints: {
    a: string[]
    b: string[][]
    c: string[]
  }
  issBase64Details: {
    value: string
    indexMod4: number
  }
  headerBase64: string
}

// ─── Execute result ───────────────────────────────────────────────────────────

export interface VektorResult {
  digest: string
  intentId: string
  amountOut: bigint
  logEntry: LogEntry
}
