/**
 * Condition monitor — polls Pyth price feeds every 30 seconds.
 * When a condition is met, emits an event and updates user alerts.
 */

import { EventEmitter } from 'events'
import { PriceServiceConnection } from '@pythnetwork/price-service-client'
import { getAllConditions, markConditionFired, type Condition } from '../db/store.js'
import { addAlert } from '../memory/index.js'

export const conditionEvents = new EventEmitter()

const PYTH_ENDPOINT = 'https://hermes.pyth.network'

const PYTH_FEED_IDS: Record<string, string> = {
  SUI:  '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  ETH:  '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BTC:  '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
}

let priceCache: Record<string, number> = {}

async function refreshPrices(): Promise<void> {
  try {
    const conn  = new PriceServiceConnection(PYTH_ENDPOINT)
    const ids   = Object.values(PYTH_FEED_IDS)
    const feeds = await conn.getLatestPriceFeeds(ids)

    for (const feed of feeds ?? []) {
      const price = (feed as any).getPriceUnchecked?.()
      if (!price) continue
      const usd = Number(price.price) * 10 ** Number(price.expo)
      const sym = Object.entries(PYTH_FEED_IDS).find(([, id]) =>
        id === (feed as any).id || id === '0x' + (feed as any).id
      )?.[0]
      if (sym) priceCache[sym] = Math.abs(usd)
    }
  } catch { /* silent */ }
}

function checkCondition(cond: Condition, prices: Record<string, number>): boolean {
  const { type, asset, threshold } = cond.trigger
  const price = prices[asset.toUpperCase()]
  if (price === undefined) return false

  if (type === 'price_below') return price < threshold
  if (type === 'price_above') return price > threshold
  // health_factor_below is checked separately
  return false
}

export function getCurrentPrice(symbol: string): number | null {
  return priceCache[symbol.toUpperCase()] ?? null
}

export function startConditionMonitor() {
  console.log('  Conditions  →  polling Pyth every 30s')

  async function tick() {
    await refreshPrices()
    const conditions = getAllConditions()

    for (const cond of conditions) {
      const triggered = checkCondition(cond, priceCache)
      if (!triggered) continue

      markConditionFired(cond.id)

      const price = priceCache[cond.trigger.asset.toUpperCase()]
      addAlert(cond.wallet, {
        type:     'condition',
        message:  `Condition triggered: ${cond.description}. ${cond.trigger.asset} is now $${price?.toFixed(4) ?? '?'}`,
        severity: 'warning',
      })

      conditionEvents.emit('triggered', { condition: cond, currentPrice: price })
    }
  }

  // Run immediately, then every 30 seconds
  tick().catch(() => {})
  setInterval(() => tick().catch(() => {}), 30_000)
}
