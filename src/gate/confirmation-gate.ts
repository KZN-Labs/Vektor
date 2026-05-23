import type { GuardianReport, GateDecision, RiskFlag } from '../types.js'
import { RiskSeverity } from '../types.js'

const SEVERITY_ICON: Record<RiskSeverity, string> = {
  info:  'ℹ',
  warn:  '⚠',
  block: '✗',
}

/**
 * Confirmation Gate — presents the Guardian report to the user and decides
 * whether execution should proceed.
 *
 * Library mode (autoConfirm: true):
 *   Returns immediately. Apps handle confirmation UI themselves.
 *
 * CLI mode (autoConfirm: false, default):
 *   Prints a formatted risk summary and waits for stdin "y/n" input.
 *   Useful for scripts and terminal-based testing.
 *
 * The gate always blocks if Guardian flagged a blocking risk — regardless
 * of autoConfirm — because blocking risks indicate the trade would fail
 * on-chain or cause meaningful loss.
 */
export class ConfirmationGate {
  constructor(private readonly autoConfirm = false) {}

  async evaluate(report: GuardianReport): Promise<GateDecision> {
    if (report.blocked) {
      this.printReport(report)
      return { proceed: false, report }
    }

    if (this.autoConfirm) {
      return { proceed: true, report }
    }

    this.printReport(report)
    const yes = await this.prompt()
    return { proceed: yes, report }
  }

  // ─── Formatting ─────────────────────────────────────────────────────────

  printReport(report: GuardianReport): void {
    const { intent, quote, risks, blocked } = report
    const inAmount = Number(intent.amountIn) / 10 ** this.decimalsFor(intent.from)
    const outAmount = Number(quote.amountOut) / quote.to.scalar
    const minOut = Number(quote.minimumAmountOut) / quote.to.scalar

    console.log('\n' + '═'.repeat(54))
    console.log('  Vektor — Intent Summary')
    console.log('═'.repeat(54))
    console.log(`  Swap    : ${inAmount} ${intent.from} → ${outAmount.toFixed(6)} ${intent.to}`)
    console.log(`  Min out : ${minOut.toFixed(6)} ${intent.to}  (${(intent.slippageTolerance * 100).toFixed(1)}% slippage)`)
    console.log(`  Impact  : ${(quote.priceImpact * 100).toFixed(4)}%`)
    console.log(`  Route   : ${quote.routeType} — ${quote.route.map(s => s.protocol).join(' → ')}`)
    console.log(`  Gas est : ~${(Number(quote.gasEstimate) / 1e9).toFixed(4)} SUI`)

    if (risks.length > 0) {
      console.log('\n  Risk Assessment:')
      for (const risk of risks) {
        console.log(`  ${SEVERITY_ICON[risk.severity]}  [${risk.class}] ${risk.message}`)
      }
    } else {
      console.log('\n  ✓  No risks detected.')
    }

    if (blocked) {
      console.log('\n  ✗  Execution blocked by Guardian. Resolve the issues above.')
    }

    console.log('═'.repeat(54))
  }

  // ─── CLI prompt ──────────────────────────────────────────────────────────

  private prompt(): Promise<boolean> {
    return new Promise(resolve => {
      process.stdout.write('\n  Proceed with swap? [y/N]: ')
      process.stdin.once('data', chunk => {
        const answer = chunk.toString().trim().toLowerCase()
        resolve(answer === 'y' || answer === 'yes')
      })
    })
  }

  private decimalsFor(symbol: string): number {
    const map: Record<string, number> = {
      SUI: 9, USDC: 6, USDT: 6, DEEP: 6, WETH: 8,
    }
    return map[symbol.toUpperCase()] ?? 9
  }
}

// Re-export for convenience
export type { RiskSeverity }
