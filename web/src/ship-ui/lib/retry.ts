import { useEffect, useState } from 'react'

/** The minimum an event needs for retry tracking. */
export interface RetryEvent {
  step: string
  status: string // 'running' | 'retrying' | 'completed' | 'failed' | ...
  attempt: number
  max_attempts: number
  /** Anything that makes the event unique across runs (e.g. workflow or order id) */
  run_id?: string
  order_id?: string
}

/** A Temporal RetryPolicy's backoff settings, mirrored in the UI for countdowns. */
export interface BackoffPolicy {
  initialIntervalMs: number
  backoffCoefficient: number
  maximumIntervalMs: number
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialIntervalMs: 2000,
  backoffCoefficient: 1.5,
  maximumIntervalMs: 8000,
}

/** How long Temporal waits after failed attempt `n` before trying again. */
export function backoffAfterAttempt(n: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  const { initialIntervalMs, backoffCoefficient, maximumIntervalMs } = policy
  return Math.min(initialIntervalMs * backoffCoefficient ** (n - 1), maximumIntervalMs)
}

export type RetryPhase = 'running' | 'waiting' | 'succeeded' | 'exhausted'

export interface RetryState {
  /** Attempt number of the latest event (1-based) */
  attempt: number
  maxAttempts: number
  /** Attempts that have failed so far */
  failures: number
  /** Attempts still available after the ones already used */
  remaining: number
  phase: RetryPhase
  /** Milliseconds until the next attempt, while waiting */
  nextAttemptInMs: number | null
}

// When each event was first seen by this page, shared by every component so
// countdowns agree no matter which view mounted first.
const firstSeen = new Map<string, number>()

function seenAt(e: RetryEvent): number {
  const key = `${e.run_id ?? e.order_id ?? ''}:${e.step}:${e.attempt}:${e.status}`
  let t = firstSeen.get(key)
  if (t === undefined) {
    t = Date.now()
    firstSeen.set(key, t)
  }
  return t
}

/** Derive retry progress for one step. Returns null until a retry has happened. */
export function getRetryState(
  events: RetryEvent[],
  step: string,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  now = Date.now(),
): RetryState | null {
  const stepEvents = events.filter((e) => e.step === step)
  const last = stepEvents[stepEvents.length - 1]
  if (!last || last.max_attempts <= 1) return null
  const retried = stepEvents.some((e) => e.status === 'retrying' || e.attempt > 1)
  if (!retried) return null

  const max = last.max_attempts
  switch (last.status) {
    case 'running':
      return {
        attempt: last.attempt,
        maxAttempts: max,
        failures: last.attempt - 1,
        remaining: max - last.attempt,
        phase: 'running',
        nextAttemptInMs: null,
      }
    case 'retrying': {
      const remaining = max - last.attempt
      const nextAt = seenAt(last) + backoffAfterAttempt(last.attempt, policy)
      return {
        attempt: last.attempt,
        maxAttempts: max,
        failures: last.attempt,
        remaining,
        phase: remaining > 0 ? 'waiting' : 'exhausted',
        nextAttemptInMs: remaining > 0 ? Math.max(0, nextAt - now) : null,
      }
    }
    case 'completed':
      return {
        attempt: last.attempt,
        maxAttempts: max,
        failures: last.attempt - 1,
        remaining: max - last.attempt,
        phase: 'succeeded',
        nextAttemptInMs: null,
      }
    default:
      return {
        attempt: last.attempt,
        maxAttempts: max,
        failures: last.attempt,
        remaining: 0,
        phase: 'exhausted',
        nextAttemptInMs: null,
      }
  }
}

/** getRetryState, re-evaluated a few times a second so countdowns tick. */
export function useRetryState(
  events: RetryEvent[],
  step: string,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): RetryState | null {
  const [now, setNow] = useState(() => Date.now())
  const state = getRetryState(events, step, policy, now)
  const ticking = state?.phase === 'waiting'

  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [ticking])

  return state
}
