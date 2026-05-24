export type IntentType =
  | 'swap'
  | 'compound'
  | 'conditional'
  | 'rebalance'
  | 'risk_qualified'
  | 'exit'
  | 'borrow'
  | 'lend'
  | 'repay'
  | 'schedule'
  | 'dca'
  | 'buy_memecoin'
  | 'sell_memecoin'
  | 'exit_at_profit'
  | 'exit_at_loss'
  | 'send'
  | 'request_payment'
  | 'analyze_wallet'
  | 'explain_transaction'
  | 'check_balance'
  | 'check_positions'
  | 'check_health_factor'

export interface ScheduleSpec {
  frequency:    'daily' | 'weekly' | 'monthly' | 'once'
  day_of_week?: string   // e.g. "friday"
  date?:        string   // ISO date string
  time?:        string   // "HH:MM"
  runs?:        number   // total number of executions
}

export interface ParsedIntent {
  intent_type:    IntentType
  input_asset:    string | null
  input_amount:   number | null
  output_goal:    string | null
  recipient?:     string | null
  tx_digest?:     string | null
  profit_target?: number | null   // e.g. 0.10 = 10% profit
  stop_loss?:     number | null   // e.g. 0.15 = 15% loss
  schedule?:      ScheduleSpec | null
  constraints: {
    max_slippage:        number | null
    risk_tolerance:      'low' | 'medium' | 'high'
    protocol_preference: string | null
    conditional_trigger: string | null
    trigger_price?:      number | null
    trigger_asset?:      string | null
    trigger_direction?:  'above' | 'below' | null
  }
  inferred_steps: string[]
  user_raw_input: string
  confidence:     number
}
