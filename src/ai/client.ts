/**
 * AI client — auto-selects provider based on available env keys.
 * Priority: ANTHROPIC_API_KEY > GEMINI_API_KEY
 */

import Anthropic            from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

type Provider = 'anthropic' | 'gemini'

function activeProvider(): Provider {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.GEMINI_API_KEY)    return 'gemini'
  throw new Error(
    'No AI API key found. Set ANTHROPIC_API_KEY or GEMINI_API_KEY in your .env file.'
  )
}

/**
 * Send a prompt to whichever AI provider is configured.
 * Returns the plain-text response string.
 */
export async function complete(opts: {
  system:    string
  prompt:    string
  maxTokens?: number
}): Promise<string> {
  const provider = activeProvider()

  if (provider === 'anthropic') {
    const client = new Anthropic()
    const res = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: opts.maxTokens ?? 1024,
      system:     opts.system,
      messages:   [{ role: 'user', content: opts.prompt }],
    })
    return res.content[0].type === 'text' ? res.content[0].text : ''
  }

  // Gemini
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const res   = await model.generateContent(`${opts.system}\n\n${opts.prompt}`)
  return res.response.text()
}

export { activeProvider }
