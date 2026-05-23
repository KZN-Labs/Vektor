export interface ParsedIntent {
  intent_type:    'swap' | 'compound' | 'conditional' | 'rebalance' | 'risk_qualified' | 'exit'
  input_asset:    string | null
  input_amount:   number | null
  output_goal:    string
  constraints: {
    max_slippage:         number | null
    risk_tolerance:       'low' | 'medium' | 'high'
    protocol_preference:  string | null
    conditional_trigger:  string | null
  }
  inferred_steps: string[]
  user_raw_input: string
  confidence:     number
}
