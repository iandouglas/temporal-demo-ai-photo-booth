import { useRetryState, type BackoffPolicy, type RetryEvent, type RetryState } from '../lib/retry'

interface RetryMeterProps {
  events: RetryEvent[]
  step: string
  size?: 'sm' | 'md' | 'lg'
  /** Backoff settings of the activity's RetryPolicy (defaults: 2s, x1.5, max 8s) */
  policy?: BackoffPolicy
}

/**
 * Shows exactly how many attempts Temporal has used and how many remain,
 * plus a countdown to the next one. Renders nothing until a retry happens.
 */
export function RetryMeter({ events, step, size = 'sm', policy }: RetryMeterProps) {
  const state = useRetryState(events, step, policy)
  if (!state) return null
  return <RetryMeterView state={state} size={size} />
}

function headline(s: RetryState): string {
  switch (s.phase) {
    case 'running':
      return `Attempt ${s.attempt} of ${s.maxAttempts} in progress`
    case 'waiting':
      return `Attempt ${s.attempt} of ${s.maxAttempts} failed`
    case 'succeeded':
      return s.attempt === 1
        ? 'Succeeded on the first attempt'
        : `Succeeded on attempt ${s.attempt} of ${s.maxAttempts}`
    case 'exhausted':
      return `All ${s.maxAttempts} attempts failed`
  }
}

function subline(s: RetryState): string {
  switch (s.phase) {
    case 'running':
      return `${s.remaining} ${s.remaining === 1 ? 'retry' : 'retries'} left after this one`
    case 'waiting': {
      const secs = Math.ceil((s.nextAttemptInMs ?? 0) / 1000)
      const left = `${s.remaining} ${s.remaining === 1 ? 'retry' : 'retries'} left`
      return secs > 0 ? `${left} · next attempt in ${secs}s` : `${left} · retrying now`
    }
    case 'succeeded':
      return `${s.failures} failed ${s.failures === 1 ? 'attempt' : 'attempts'} retried automatically`
    case 'exhausted':
      return 'Retry policy exhausted, running compensation'
  }
}

export function RetryMeterView({ state: s, size = 'sm' }: { state: RetryState; size?: 'sm' | 'md' | 'lg' }) {
  const pip = size === 'lg' ? 'h-5 flex-1 max-w-10' : size === 'md' ? 'h-3.5 flex-1' : 'h-2.5 flex-1'
  const head = size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-lg' : 'text-sm'
  const sub = size === 'lg' ? 'text-lg' : size === 'md' ? 'text-sm' : 'text-xs'
  const tone =
    s.phase === 'succeeded' ? 'text-lc-green' : s.phase === 'exhausted' ? 'text-lc-red' : 'text-lc-gold'

  return (
    <div className="w-full" role="status" aria-live="polite">
      <div className={`lc-label font-bold ${head} ${tone} leading-tight`}>{headline(s)}</div>
      <div className={`lc-label ${sub} text-lc-text/80 mt-0.5`}>{subline(s)}</div>

      {/* One pip per attempt: failed, current, succeeded, or still available */}
      <div className={`flex gap-1 mt-2 ${size === 'lg' ? 'justify-center' : ''}`}>
        {Array.from({ length: s.maxAttempts }, (_, i) => {
          const n = i + 1
          let cls = 'bg-lc-line'
          if (n <= s.failures) cls = 'bg-lc-red'
          if (s.phase === 'running' && n === s.attempt) cls = 'bg-lc-sky animate-pulse'
          if (s.phase === 'succeeded' && n === s.attempt) cls = 'bg-lc-green'
          if (s.phase === 'waiting' && n === s.attempt + 1) cls = 'bg-lc-gold/60 animate-pulse'
          return <span key={n} className={`${pip} rounded-full ${cls}`} title={`Attempt ${n}`} />
        })}
      </div>
    </div>
  )
}
