/**
 * Echo Worker entry point — Cloudflare Worker with cron trigger (every 60s).
 * Also exports the EchoHub Durable Object for WebSocket push.
 */

import { runMonitorLoop } from './monitor'
import type { Env }       from './types'

// Re-export the Durable Object class so Cloudflare can find it
export { EchoHub } from './alerter'

export default {
  // ── Cron trigger — fires every 60 seconds ────────────────────────────
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMonitorLoop(env))
  },

  // ── HTTP handler — WebSocket upgrades + manual triggers ──────────────
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket connection from frontend: GET /ws/:userAddress
    if (url.pathname.startsWith('/ws/')) {
      const userAddress = url.pathname.replace('/ws/', '')
      if (!userAddress) return new Response('Missing user address', { status: 400 })

      const id  = env.ECHO_HUB.idFromName(userAddress)
      const hub = env.ECHO_HUB.get(id)
      return hub.fetch(new Request(request.url.replace('/ws/', '/ws/'), request))
    }

    // Manual trigger for dev/testing: POST /trigger
    if (url.pathname === '/trigger' && request.method === 'POST') {
      await runMonitorLoop(env)
      return Response.json({ ok: true, message: 'Monitor loop triggered' })
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ ok: true, worker: 'echo-worker', version: '1.0.0' })
    }

    return Response.json({ ok: true, worker: 'echo-worker', uptime: Date.now() })
  },
}
