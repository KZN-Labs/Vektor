/**
 * Vektor — basic intent example
 *
 * Parses a swap intent, runs Guardian risk checks, prompts for confirmation,
 * then executes if approved. Optionally logs on-chain via VektorLog.
 *
 * Usage (dry run — no execution):
 *   npx tsx examples/basic-intent.ts
 *
 * Usage (full execution):
 *   SUI_PRIVATE_KEY=suiprivkey1... npx tsx examples/basic-intent.ts
 *
 * Usage (with VektorLog):
 *   SUI_PRIVATE_KEY=... VEKTORLOG_PACKAGE_ID=0x... npx tsx examples/basic-intent.ts
 */

import Vektor from '../src/index.js'

const NETWORK     = 'mainnet' as const
const PRIVKEY     = process.env.SUI_PRIVATE_KEY
const LOG_PACKAGE = process.env.VEKTORLOG_PACKAGE_ID

async function main(): Promise<void> {
  let keypair: any = null
  let address: string | undefined

  if (PRIVKEY) {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
    keypair = Ed25519Keypair.fromSecretKey(PRIVKEY)
    address = keypair.getPublicKey().toSuiAddress()
    console.log(`Wallet: ${address}`)
  } else {
    // Use a simulation address for quote-only mode
    address = '0x0000000000000000000000000000000000000000000000000000000000000001'
    console.log('Quote-only mode (no SUI_PRIVATE_KEY set)\n')
  }

  const vektor = new Vektor({
    network:            NETWORK,
    senderAddress:      address,
    autoConfirm:        !keypair,         // auto-confirm in dry-run mode
    vektorLogPackageId: LOG_PACKAGE,
  })

  // ─── Step 1: Guard ──────────────────────────────────────────────────────────
  const report = await vektor.guard({
    action:          'swap',
    from:            'SUI',
    to:              'USDC',
    amount:          '0.15',        // human-readable SUI
    slippage:        'medium',      // 0.5%
    maxPriceImpact:  0.03,          // block if >3% impact
  })

  // ─── Step 2: Confirm ────────────────────────────────────────────────────────
  // Prints full risk report + prompts "y/N" if keypair is set.
  const gate = await vektor.confirm(report)

  if (!gate.proceed) {
    if (report.blocked) {
      console.log('\n  Swap blocked. See risk report above.')
    } else {
      console.log('\n  Swap cancelled.')
    }
    return
  }

  if (!keypair) {
    console.log('\n  Set SUI_PRIVATE_KEY=suiprivkey1... to execute this swap.')
    return
  }

  // ─── Step 3: Execute ────────────────────────────────────────────────────────
  console.log('\n  Executing...')

  const result = await vektor.execute(gate, keypair)

  console.log('\n' + '═'.repeat(54))
  console.log('  Executed')
  console.log('═'.repeat(54))
  console.log(`  Intent  : ${result.intentId}`)
  console.log(`  Digest  : ${result.digest}`)
  console.log(`  View    : https://suiscan.xyz/${NETWORK}/tx/${result.digest}`)
  if (LOG_PACKAGE) {
    console.log(`  Logged  : on-chain via VektorLog`)
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
