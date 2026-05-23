/**
 * Vektor — integration tests
 *
 * Tests run against real Sui mainnet/testnet. No mocks.
 *
 * Usage:
 *   npm test
 */

import { parseIntent }       from '../src/intent/parser.js'
import { Guardian }          from '../src/guardian/index.js'
import { PTBCompiler }       from '../src/compiler/ptb-compiler.js'
import { ConfirmationGate }  from '../src/gate/confirmation-gate.js'
import { VektorLogClient }   from '../src/log/vektorlog-client.js'
import { RiskClass }         from '../src/types.js'
import Vektor                from '../src/index.js'

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`  ✓  ${name}`)
    passed++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  ✗  ${name}`)
    console.log(`       → ${msg}`)
    failed++
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NETWORK  = 'mainnet' as const
const SIM_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001'

// ─── 1. Intent Parser ─────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────')
console.log('  1. Intent Parser')
console.log('──────────────────────────────────────────────────────────')

await test('parseIntent: string amount converts to base units correctly', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '1.5' })
  assert(intent.amountIn === 1_500_000_000n, `Expected 1_500_000_000 got ${intent.amountIn}`)
})

await test('parseIntent: bigint amount passes through unchanged', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: 500_000_000n })
  assert(intent.amountIn === 500_000_000n, `Expected 500_000_000 got ${intent.amountIn}`)
})

await test('parseIntent: slippage preset "low" maps to 0.001', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '1', slippage: 'low' })
  assert(intent.slippageTolerance === 0.001, `Expected 0.001 got ${intent.slippageTolerance}`)
})

await test('parseIntent: slippage preset "high" maps to 0.01', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '1', slippage: 'high' })
  assert(intent.slippageTolerance === 0.01, `Expected 0.01 got ${intent.slippageTolerance}`)
})

await test('parseIntent: throws on unknown token', async () => {
  let threw = false
  try {
    parseIntent({ action: 'swap', from: 'FAKETOKEN', to: 'USDC', amount: '1' })
  } catch {
    threw = true
  }
  assert(threw, 'Expected error for unknown token')
})

await test('parseIntent: throws when from === to', async () => {
  let threw = false
  try {
    parseIntent({ action: 'swap', from: 'SUI', to: 'SUI', amount: '1' })
  } catch {
    threw = true
  }
  assert(threw, 'Expected error for same token')
})

await test('parseIntent: assigns unique ID per call', async () => {
  const a = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '1' })
  const b = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '1' })
  assert(a.id !== b.id, 'Expected unique IDs')
})

// ─── 2. PTB Compiler ─────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────')
console.log('  2. PTB Compiler — live mainnet quote')
console.log('──────────────────────────────────────────────────────────')

const compiler = new PTBCompiler(NETWORK, SIM_ADDR)
let compiledQuote: any = null

await test('compile: returns a quote with a built PTB', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '0.1' })
  const result = await compiler.compile(intent)
  assert(result.quote.amountOut > 0n, 'amountOut must be positive')
  assert(result.quote.ptb !== null, 'PTB must be present')
  compiledQuote = result
  console.log(`       quote: ${Number(result.quote.amountOut) / 1e6} USDC for 0.1 SUI`)
})

await test('compile: throws if intent has expired', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '0.1', deadlineSeconds: -1 })
  let threw = false
  try {
    await compiler.compile(intent)
  } catch {
    threw = true
  }
  assert(threw, 'Expected error for expired intent')
})

// ─── 3. Guardian ─────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────')
console.log('  3. Guardian — risk class evaluation')
console.log('──────────────────────────────────────────────────────────')

const guardian = new Guardian()

// Re-fetch a fresh quote for guardian tests — the compiler quote above may be
// near its 30 s TTL expiry by the time we reach this section.
let freshCompiled: any = null
await test('guardian: no risks for a normal small trade', async () => {
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '0.1' })
  freshCompiled = await compiler.compile(intent)
  const report = await guardian.evaluate(freshCompiled.intent, freshCompiled.quote)
  const blocking = report.risks.filter(r => r.severity === 'block')
  assert(!report.blocked, `Expected no block, got: ${blocking.map((r: any) => r.class).join(', ')}`)
})

await test('guardian: LOOSE_SLIPPAGE blocks at >20%', async () => {
  if (!freshCompiled) { console.log('       (skipped — fresh compile failed)'); return }
  const dangerousIntent = { ...freshCompiled.intent, slippageTolerance: 0.25 }
  const report = await guardian.evaluate(dangerousIntent, freshCompiled.quote)
  const hit = report.risks.find((r: any) => r.class === RiskClass.LOOSE_SLIPPAGE && r.severity === 'block')
  assert(!!hit, 'Expected LOOSE_SLIPPAGE block for 25% slippage')
})

await test('guardian: HIGH_PRICE_IMPACT blocks when impact exceeds threshold', async () => {
  if (!freshCompiled) { console.log('       (skipped — fresh compile failed)'); return }
  // Inject a synthetic high-impact quote to test the risk class logic directly
  const highImpactQuote = { ...freshCompiled.quote, priceImpact: 0.10 }  // 10% impact
  const tightIntent = { ...freshCompiled.intent, maxPriceImpact: 0.03 }  // 3% threshold
  const report = await guardian.evaluate(tightIntent, highImpactQuote)
  const hit = report.risks.find((r: any) => r.class === RiskClass.HIGH_PRICE_IMPACT && r.severity === 'block')
  assert(!!hit, 'Expected HIGH_PRICE_IMPACT block when 10% impact exceeds 3% threshold')
})

await test('guardian: STALE_QUOTE blocks when validUntil is in the past', async () => {
  if (!freshCompiled) { console.log('       (skipped — fresh compile failed)'); return }
  const staleQuote = { ...freshCompiled.quote, validUntil: Date.now() - 1000 }
  const report = await guardian.evaluate(freshCompiled.intent, staleQuote)
  const hit = report.risks.find((r: any) => r.class === RiskClass.STALE_QUOTE && r.severity === 'block')
  assert(!!hit, 'Expected STALE_QUOTE block')
})

await test('guardian: LARGE_TRADE warns for >$5k equivalent SUI trade', async () => {
  if (!freshCompiled) { console.log('       (skipped — fresh compile failed)'); return }
  const bigIntent = { ...freshCompiled.intent, amountIn: 10_000_000_000_000n } // 10,000 SUI
  const report = await guardian.evaluate(bigIntent, freshCompiled.quote)
  const hit = report.risks.find((r: any) => r.class === RiskClass.LARGE_TRADE)
  assert(!!hit, 'Expected LARGE_TRADE warning for 10,000 SUI')
})

// ─── 4. Confirmation Gate ────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────')
console.log('  4. Confirmation Gate')
console.log('──────────────────────────────────────────────────────────')

await test('gate: auto-confirms when autoConfirm=true and no blocking risks', async () => {
  if (!freshCompiled) { console.log('       (skipped — fresh compile failed)'); return }
  const intent = parseIntent({ action: 'swap', from: 'SUI', to: 'USDC', amount: '0.1' })
  const { quote } = await compiler.compile(intent)
  const report = await guardian.evaluate(intent, quote)
  const autoGate = new ConfirmationGate(true)
  const decision = await autoGate.evaluate(report)
  assert(decision.proceed === !report.blocked, 'auto-confirm should proceed when not blocked')
})

await test('gate: rejects when Guardian has a blocking risk', async () => {
  if (!freshCompiled) { console.log('       (skipped — fresh compile failed)'); return }
  const staleQuote = { ...freshCompiled.quote, validUntil: Date.now() - 1000 }
  const blockedReport = await guardian.evaluate(freshCompiled.intent, staleQuote)
  const autoGate = new ConfirmationGate(true)
  const decision = await autoGate.evaluate(blockedReport)
  assert(!decision.proceed, 'Should not proceed when blocked')
})

// ─── 5. VektorLog client ─────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────')
console.log('  5. VektorLog client')
console.log('──────────────────────────────────────────────────────────')

await test('vektorlog: buildEntry produces correct shape', async () => {
  const client = new VektorLogClient('mainnet')
  const entry = client.buildEntry('intent-123', 'aftermath', 1_000_000_000n, 1_100_000n, '0xabc')
  assert(entry.intentId === 'intent-123', 'intentId mismatch')
  assert(entry.amountIn === 1_000_000_000n, 'amountIn mismatch')
  assert(entry.protocol === 'aftermath', 'protocol mismatch')
  assert(entry.digest === '0xabc', 'digest mismatch')
})

await test('vektorlog: isConfigured returns false when no package ID', async () => {
  const client = new VektorLogClient('mainnet')
  assert(!client.isConfigured(), 'Expected isConfigured=false with no packageId')
})

// ─── 6. Vektor.guard — public API ────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────')
console.log('  6. Vektor.guard — full pipeline test')
console.log('──────────────────────────────────────────────────────────')

const vektor = new Vektor({ network: NETWORK, senderAddress: SIM_ADDR, autoConfirm: true })

await test('vektor.guard: returns GuardianReport with quote and risks', async () => {
  const report = await vektor.guard({
    action: 'swap', from: 'SUI', to: 'USDC', amount: '0.1', slippage: 'medium',
  })
  assert(report.quote.amountOut > 0n, 'quote.amountOut must be positive')
  assert(Array.isArray(report.risks), 'risks must be array')
  console.log(`       got ${Number(report.quote.amountOut) / 1e6} USDC, ${report.risks.length} risk flag(s)`)
})

await test('vektor.guard: unknown token throws clearly', async () => {
  let threw = false
  try {
    await vektor.guard({ action: 'swap', from: 'NOTATOKEN', to: 'USDC', amount: '1' })
  } catch {
    threw = true
  }
  assert(threw, 'Expected error for unknown token')
})

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(58))
if (failed === 0) {
  console.log(`  ✓  All ${passed} tests passed`)
} else {
  console.log(`  ${passed} passed  ·  ${failed} failed`)
}
console.log('═'.repeat(58) + '\n')

if (failed > 0) process.exit(1)
