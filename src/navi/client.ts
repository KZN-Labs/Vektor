/**
 * NAVI Protocol integration.
 * Provides health factor, pool rates, and PTB building for deposit/borrow/repay/withdraw.
 * PTBs are returned serialized for the UI to sign via dapp-kit.
 */

import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction }               from '@mysten/sui/transactions'
import {
  NAVISDKClient,
  getAddressPortfolio,
  getHealthFactorCall,
  depositCoin,
  borrowCoin,
  repayDebt,
  withdrawCoin,
  Sui as SuiCoin,
  USDT as USDTCoin,
  wUSDC as USDCCoin,
} from 'navi-sdk'
import type { CoinInfo, PoolConfig } from 'navi-sdk'

const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet'), network: 'mainnet' } as any)

/* ─── Coin registry ─────────────────────────────────────────────────────── */

const COIN_INFO: Record<string, CoinInfo> = {
  SUI:  SuiCoin,
  USDC: USDCCoin,
  USDT: USDTCoin,
}

const COIN_DECIMALS: Record<string, number> = {
  SUI: 1e9, USDC: 1e6, USDT: 1e6,
}

/* ─── Health factor ─────────────────────────────────────────────────────── */

export async function getHealthFactor(wallet: string): Promise<number | null> {
  try {
    const hf = await getHealthFactorCall(wallet, suiClient as any)
    return typeof hf === 'number' ? hf : null
  } catch {
    return null
  }
}

/* ─── Portfolio positions ───────────────────────────────────────────────── */

export interface NaviPosition {
  symbol:        string
  supplyBalance: number
  borrowBalance: number
}

export async function getNaviPositions(wallet: string): Promise<NaviPosition[]> {
  const portfolio = await getAddressPortfolio(wallet, false, suiClient as any)
  const positions: NaviPosition[] = []
  for (const [symbol, data] of portfolio) {
    if (data.supplyBalance > 0 || data.borrowBalance > 0) {
      positions.push({ symbol, supplyBalance: data.supplyBalance, borrowBalance: data.borrowBalance })
    }
  }
  return positions
}

/* ─── Pool info ─────────────────────────────────────────────────────────── */

export async function getPoolRates(symbol: string) {
  try {
    const sdkClient = new NAVISDKClient({ networkType: 'mainnet', numberOfAccounts: 0 })
    const coinInfo  = COIN_INFO[symbol.toUpperCase()]
    if (!coinInfo) return null
    return await sdkClient.getPoolInfo(coinInfo)
  } catch {
    return null
  }
}

/* ─── PTB builders ──────────────────────────────────────────────────────── */

/** Build a deposit (supply) PTB. Returns serialized tx bytes as base64. */
export async function buildDepositPTB(
  wallet:  string,
  symbol:  string,
  amount:  number,
): Promise<string> {
  const coinInfo = COIN_INFO[symbol.toUpperCase()]
  if (!coinInfo) throw new Error(`Unsupported NAVI token: ${symbol}`)

  const decimals  = COIN_DECIMALS[symbol.toUpperCase()] ?? 1e9
  const amountRaw = Math.round(amount * decimals)

  const tx = new Transaction()
  tx.setSender(wallet)

  // Get a coin object to deposit
  const [coinObj] = tx.splitCoins(tx.gas, [amountRaw])
  await depositCoin(tx as any, coinInfo as unknown as PoolConfig, coinObj, amountRaw)

  tx.setGasBudget(20_000_000)
  const bytes = await tx.build({ client: suiClient as any })
  return Buffer.from(bytes).toString('base64')
}

/** Build a borrow PTB. Returns serialized tx bytes as base64. */
export async function buildBorrowPTB(
  wallet:  string,
  symbol:  string,
  amount:  number,
): Promise<string> {
  const coinInfo = COIN_INFO[symbol.toUpperCase()]
  if (!coinInfo) throw new Error(`Unsupported NAVI token: ${symbol}`)

  const decimals  = COIN_DECIMALS[symbol.toUpperCase()] ?? 1e9
  const amountRaw = Math.round(amount * decimals)

  const tx = new Transaction()
  tx.setSender(wallet)

  await borrowCoin(tx as any, coinInfo as unknown as PoolConfig, amountRaw)

  tx.setGasBudget(20_000_000)
  const bytes = await tx.build({ client: suiClient as any })
  return Buffer.from(bytes).toString('base64')
}

/** Build a repay PTB. Returns serialized tx bytes as base64. */
export async function buildRepayPTB(
  wallet:  string,
  symbol:  string,
  amount:  number,
): Promise<string> {
  const coinInfo = COIN_INFO[symbol.toUpperCase()]
  if (!coinInfo) throw new Error(`Unsupported NAVI token: ${symbol}`)

  const decimals  = COIN_DECIMALS[symbol.toUpperCase()] ?? 1e9
  const amountRaw = Math.round(amount * decimals)

  const tx = new Transaction()
  tx.setSender(wallet)

  const [coinObj] = tx.splitCoins(tx.gas, [amountRaw])
  await repayDebt(tx as any, coinInfo as unknown as PoolConfig, coinObj, amountRaw)

  tx.setGasBudget(20_000_000)
  const bytes = await tx.build({ client: suiClient as any })
  return Buffer.from(bytes).toString('base64')
}
