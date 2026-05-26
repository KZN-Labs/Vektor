/**
 * AI client — auto-selects provider based on available env keys.
 * Priority: ANTHROPIC_API_KEY > GROQ_API_KEY > GEMINI_API_KEY
 *
 * The optional `lang` parameter injects a language instruction so
 * every response comes back in the user's detected language.
 */

import Anthropic              from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq                   from 'groq-sdk'

type Provider = 'anthropic' | 'groq' | 'gemini'

/* ─── Supported language names ────────────────────────────────────────────── */

export const LANG_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  yo: 'Yoruba',
  ha: 'Hausa',
  ig: 'Igbo',
  ar: 'Arabic',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  ru: 'Russian',
  ko: 'Korean',
  hi: 'Hindi',
  sw: 'Swahili',
  tr: 'Turkish',
  pl: 'Polish',
  vi: 'Vietnamese',
  id: 'Indonesian',
  bn: 'Bengali',
  ur: 'Urdu',
  fa: 'Persian (Farsi)',
  th: 'Thai',
}

/** ISO 639-1 codes that Vektor explicitly supports */
export const SUPPORTED_LANGS = new Set(Object.keys(LANG_NAMES))

/**
 * Build the language instruction to prepend to any system prompt.
 * Returns empty string for English so existing behaviour is unchanged.
 */
export function langInstruction(lang?: string): string {
  if (!lang || lang === 'en') return ''
  const name = LANG_NAMES[lang] ?? lang
  // African language hint — models sometimes need encouragement
  const africanHint = ['yo', 'ha', 'ig', 'sw'].includes(lang)
    ? `Use natural, fluent ${name} phrasing. For DeFi technical terms that have no established ${name} translation ` +
      `(e.g. "swap", "liquidity", "slippage", "collateral"), keep them in English — this is standard practice in African DeFi communities. `
    : ''
  return (
    `CRITICAL INSTRUCTION: Respond ENTIRELY in ${name}. ` +
    `Do NOT use English in your response text (only exceptions: ` +
    `protocol names like Cetus, Aftermath, NAVI, DeepBook, Turbos, Bluefin, Scallop; ` +
    `token symbols like SUI, USDC, USDT, WETH, WBTC, DEEP; ` +
    `numeric values, percentages, and wallet addresses). ` +
    africanHint
  )
}

function activeProvider(): Provider {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.GROQ_API_KEY)      return 'groq'
  if (process.env.GEMINI_API_KEY)    return 'gemini'
  throw new Error(
    'No AI API key found. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY in your .env file.'
  )
}

/**
 * Send a prompt to whichever AI provider is configured.
 * Pass `lang` to have the response generated in the user's language.
 * Pass `jsonMode: true` to enable structured JSON output (no markdown fences).
 */
export async function complete(opts: {
  system:     string
  prompt:     string
  maxTokens?: number
  lang?:      string    // ISO 639-1 code — injects language instruction
  jsonMode?:  boolean   // enforce raw JSON output (no fences, no preamble)
}): Promise<string> {
  const provider = activeProvider()

  // Prepend language instruction when not English
  const langPrefix = langInstruction(opts.lang)
  const system     = langPrefix ? `${langPrefix}\n\n${opts.system}` : opts.system

  if (provider === 'anthropic') {
    const client = new Anthropic()
    const res = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: opts.maxTokens ?? 1024,
      system,
      messages:   [{ role: 'user', content: opts.prompt }],
    })
    return res.content[0].type === 'text' ? res.content[0].text : ''
  }

  if (provider === 'groq') {
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const res = await client.chat.completions.create({
      model:            'llama-3.3-70b-versatile',
      max_tokens:       opts.maxTokens ?? 1024,
      // json_object mode makes Groq return raw JSON — no markdown fences ever
      response_format:  opts.jsonMode ? { type: 'json_object' } : { type: 'text' },
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: opts.prompt },
      ],
    })
    return res.choices[0]?.message?.content ?? ''
  }

  // Gemini
  const genAI     = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
  const model     = genAI.getGenerativeModel({ model: modelName })
  const res       = await model.generateContent(`${system}\n\n${opts.prompt}`)
  return res.response.text()
}

export { activeProvider }
