/**
 * Seed the memory store for the connected wallet.
 * Run: ./node_modules/.bin/tsx scripts/seed-memory.ts
 */

import { getMemory, saveMemory, addAlert, updatePortfolioSnapshot, incrementIntentCount } from '../src/memory/index.js'
import { addScheduled, addCondition } from '../src/db/store.js'

const WALLET = process.argv[2] ?? '0xb77d6ba31b5b308876917b23a39070536defa518a2909919e05f9e060b49dc66'

console.log(`Seeding memory for wallet: ${WALLET}`)

// 1. Write memory with mock portfolio snapshot
updatePortfolioSnapshot(WALLET, {
  totalUsd: 4821.33,
  balances: [
    { symbol: 'SUI',  formatted: '312.4400', usdValue: 1124.00 },
    { symbol: 'USDC', formatted: '2400.0000', usdValue: 2400.00 },
    { symbol: 'USDT', formatted: '1297.3300', usdValue: 1297.33 },
  ],
  navi: {
    supplyBalances: { USDC: 500.0 },
    borrowBalances: { SUI:  150.0 },
    healthFactor:   2.14,
  },
  recentTxs: [],
})

// 2. Update preferences
const mem = getMemory(WALLET)
mem.preferences.riskTolerance      = 'medium'
mem.preferences.preferredProtocols = ['aftermath', 'cetus']
mem.stats.totalIntents             = 7
mem.stats.totalSwapVolume          = 3800
mem.naviHealthFactor               = 2.14
mem.conversationSummary            = 'User has been DCAs into SUI and lending USDC on NAVI.'
saveMemory(mem)

// 3. Add a sample DCA schedule
addScheduled({
  wallet:      WALLET,
  type:        'dca',
  intent:      { intent_type: 'dca', input_asset: 'USDC', input_amount: 10, output_goal: 'SUI', constraints: { max_slippage: null, risk_tolerance: 'medium', protocol_preference: null, conditional_trigger: null }, inferred_steps: [], user_raw_input: 'DCA 10 USDC into SUI every day for 7 days', confidence: 0.97 },
  amount:      10,
  token:       'USDC',
  targetToken: 'SUI',
  schedule: {
    frequency:     'daily',
    totalRuns:     7,
    completedRuns: 4,
    nextRun:       new Date(Date.now() + 18 * 3600_000).toISOString(),
  },
  active: true,
})

// 4. Add a sample condition
addCondition({
  wallet:      WALLET,
  description: 'Swap my SUI to USDC if SUI drops below $3',
  trigger:     { type: 'price_below', asset: 'SUI', threshold: 3.0 },
  action:      { intent_type: 'conditional', input_asset: 'SUI', input_amount: null, output_goal: 'USDC', constraints: { max_slippage: null, risk_tolerance: 'medium', protocol_preference: null, conditional_trigger: 'SUI < $3' }, inferred_steps: [], user_raw_input: 'Swap my SUI to USDC if SUI drops below $3', confidence: 0.95 },
  autoExecute: false,
})

// 5. Add an alert
addAlert(WALLET, {
  type:     'scheduled',
  message:  'DCA running: 4 of 7 buys complete. Next buy in 18 hours.',
  severity: 'info',
})

console.log('\n✓ Memory seeded. Files written:')
console.log(`  data/memory/${WALLET.toLowerCase()}.json`)
console.log('  data/store.json')
console.log('\nMemory contents:')
const final = getMemory(WALLET)
console.log(JSON.stringify({ totalUsd: final.portfolioSnapshot?.totalUsd, healthFactor: final.naviHealthFactor, intents: final.stats.totalIntents, alerts: final.pendingAlerts.length }, null, 2))
