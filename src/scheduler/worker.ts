/**
 * Scheduler worker — checks every minute for due scheduled intents.
 * Emits 'due' events when an intent is ready to execute.
 * The server listens and either auto-executes or queues a prompt.
 */

import cron      from 'node-cron'
import { EventEmitter } from 'events'
import { getAllScheduled, markScheduledRun, type ScheduledIntent } from '../db/store.js'
import { addAlert } from '../memory/index.js'

export const schedulerEvents = new EventEmitter()

function nextRunAfter(intent: ScheduledIntent): string {
  const { frequency, dayOfWeek } = intent.schedule
  const now = new Date()

  if (frequency === 'daily') {
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(12, 0, 0, 0)
    return next.toISOString()
  }

  if (frequency === 'weekly') {
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    }
    const targetDay = dayMap[dayOfWeek?.toLowerCase() ?? 'monday'] ?? 1
    const next      = new Date(now)
    const daysAhead = (targetDay + 7 - now.getDay()) % 7 || 7
    next.setDate(next.getDate() + daysAhead)
    next.setHours(12, 0, 0, 0)
    return next.toISOString()
  }

  if (frequency === 'monthly') {
    const next = new Date(now)
    next.setMonth(next.getMonth() + 1)
    next.setDate(1)
    next.setHours(12, 0, 0, 0)
    return next.toISOString()
  }

  // once — no next
  return ''
}

export function startScheduler() {
  console.log('  Scheduler   →  checking every minute')

  cron.schedule('* * * * *', async () => {
    const now       = Date.now()
    const scheduled = getAllScheduled()

    for (const item of scheduled) {
      const nextRun = new Date(item.schedule.nextRun).getTime()
      if (nextRun > now) continue

      // Mark as run
      const next = nextRunAfter(item)
      markScheduledRun(item.id, next)

      // Notify UI via SSE / memory
      addAlert(item.wallet, {
        type:     'scheduled',
        message:  `Scheduled ${item.type === 'dca' ? 'DCA' : 'payment'}: ${item.amount} ${item.token}${item.targetToken ? ` → ${item.targetToken}` : ''}`,
        severity: 'info',
      })

      // Emit for server to handle
      schedulerEvents.emit('due', item)
    }
  })
}
