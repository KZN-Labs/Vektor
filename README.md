# Vektor

Intent engine for Sui. Vektor wraps [Routex](https://www.npmjs.com/package/routex-sui) with structured intent parsing, multi-class risk assessment, CLI confirmation, and optional on-chain execution logging via a Move contract.

## Architecture

```
ParseIntentParams
      │
      ▼
  parseIntent()          ← validates tokens, normalises amounts, assigns ID
      │
      ▼
  PTBCompiler            ← calls Routex for a live quote + pre-built PTB
      │                     [SEAL_V1.5 placeholder — encrypt before quote]
      ▼
  Guardian               ← 7 risk classes evaluated in parallel
      │
      ▼
  ConfirmationGate       ← auto-confirm or interactive CLI prompt
      │
      ▼
  execute()              ← submits PTB, appends VektorLog call atomically
      │
      ▼
  VektorResult           ← digest, intentId, amountOut, log entry
```

## Install

```bash
npm install vektor-sui
```

## Quick start

```typescript
import Vektor from 'vektor-sui'

const vektor = new Vektor({
  network: 'mainnet',
  senderAddress: '0x...',
  autoConfirm: false,           // set true to skip CLI prompt
})

// Step-by-step
const report = await vektor.guard({ action: 'swap', from: 'SUI', to: 'USDC', amount: '10' })
const gate   = await vektor.confirm(report)   // prints risk summary, prompts y/N

if (gate.proceed) {
  const result = await vektor.execute(gate, signer)
  console.log(result.digest)
}

// All-in-one
const result = await vektor.swap(
  { action: 'swap', from: 'SUI', to: 'USDC', amount: '10', slippage: 'low' },
  signer,
)
```

## Intent params

| Field | Type | Description |
|---|---|---|
| `action` | `'swap'` | Operation type |
| `from` | `string` | Input token symbol — `SUI`, `USDC`, `USDT`, `DEEP`, `WETH` |
| `to` | `string` | Output token symbol |
| `amount` | `string \| bigint` | Human amount (`'1.5'`) or raw base units (`1_500_000_000n`) |
| `slippage` | `'low' \| 'medium' \| 'high' \| number` | Tolerance preset or exact fraction. Defaults to `'medium'` (0.5%) |
| `maxPriceImpact` | `number` | Block threshold for price impact. Default `0.05` (5%) |
| `deadlineSeconds` | `number` | Intent TTL in seconds. Default `28` |

## Guardian — risk classes

The Guardian evaluates 7 risk classes and marks each as `block`, `warn`, or `info`. A single `block` prevents execution.

| Class | Trigger |
|---|---|
| `HIGH_PRICE_IMPACT` | Impact exceeds `maxPriceImpact` |
| `LOOSE_SLIPPAGE` | Slippage warn >5%, block >20% |
| `STALE_QUOTE` | Quote TTL < 5 s remaining |
| `THIN_LIQUIDITY` | Impact >1% (pool is shallow) |
| `INSUFFICIENT_GAS` | SUI balance < trade amount + 2× gas |
| `PROTOCOL_CONCENTRATION` | 100% routed through a single non-DeepBook AMM |
| `LARGE_TRADE` | Trade size >$5,000 USD equivalent |

```typescript
const report = await vektor.guard({ action: 'swap', from: 'SUI', to: 'USDC', amount: '1' })

report.blocked        // true if any risk is severity='block'
report.risks          // RiskFlag[]
report.quote          // live RoutexQuote
```

## zkLogin

Vektor ships optional zkLogin auth so users can sign transactions with a Google / Facebook / Twitch account — no private key required.

```typescript
import { ZkLoginAuth } from 'vektor-sui'

const auth = new ZkLoginAuth('mainnet', {
  clientId:    'YOUR_OAUTH_CLIENT_ID',
  redirectUri: 'https://yourapp.com/callback',
  provider:    'google',
})

// 1. Generate OAuth URL and redirect user
const { url } = await auth.generateLoginUrl()

// 2. After redirect, exchange JWT for a ZK session
const session = await auth.handleCallback(jwt, userSalt)

// session.address — use as senderAddress in VektorOptions
// 3. Sign PTBs
const signature = await auth.signTransaction(session, txBytes)
```

## VektorLog Move contract

The `vektorlog` Move contract emits an `IntentExecuted` event atomically within the same PTB as the swap — so the log only appears on-chain if the trade succeeds.

```
contracts/vektorlog/
  sources/vektorlog.move
  Move.toml
```

Deploy:

```bash
cd contracts/vektorlog
sui client publish --gas-budget 100000000
```

Pass the deployed package ID to `Vektor`:

```typescript
const vektor = new Vektor({
  network: 'mainnet',
  senderAddress: '0x...',
  vektorLogPackageId: '0x<PACKAGE_ID>',
})
```

## API

### `new Vektor(options)`

| Option | Type | Description |
|---|---|---|
| `network` | `'mainnet' \| 'testnet'` | Default `'mainnet'` |
| `senderAddress` | `string` | Sui wallet address |
| `autoConfirm` | `boolean` | Skip CLI confirmation prompt. Default `false` |
| `vektorLogPackageId` | `string` | Deployed VektorLog package. Omit to disable logging |

### `vektor.guard(params)` → `GuardianReport`

Parses the intent, fetches a live quote from Routex, and runs all 7 Guardian checks. Does not execute.

### `vektor.confirm(report)` → `GateDecision`

Prints a formatted risk summary. In interactive mode prompts `y/N`. In `autoConfirm` mode approves automatically unless a `block`-severity risk is present.

### `vektor.execute(gate, signer)` → `VektorResult`

Submits the PTB. If VektorLog is configured, appends the log call to the same PTB atomically.

### `vektor.swap(params, signer)` → `VektorResult`

Convenience method that runs guard → confirm → execute in one call.

## Environment variables

| Variable | Description |
|---|---|
| `VEKTORLOG_PACKAGE_ID` | Deployed VektorLog package ID (alternative to constructor option) |

## SEAL integration (v1.5)

The PTB compiler contains a clearly marked placeholder where [Seal SDK](https://github.com/MystenLabs/seal) encryption will slot in to prevent front-running:

```typescript
// SEAL_V1.5 — encrypt intent here using Seal SDK before submission
// to prevent front-running. See block comment above for integration notes.
```

## License

MIT
