export interface TallyRow {
  /** Activity name, e.g. "recolor_image" */
  name: string
  count: number
  retries?: number
}

/** Running count of Temporal activities a demo has executed. */
export function ActivityTally({ rows, title = 'Temporal activities' }: { rows: TallyRow[]; title?: string }) {
  const total = rows.reduce((n, r) => n + r.count, 0)
  const retries = rows.reduce((n, r) => n + (r.retries ?? 0), 0)
  return (
    <div className="lc-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="lc-label text-sm font-bold text-lc-gold">{title}</span>
        <span className="lc-label text-3xl font-bold text-lc-text">{total}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between text-sm">
            <span className="font-mono text-lc-text/90">{r.name}</span>
            <span className="lc-label text-lc-dim">
              {r.count}
              {r.retries ? <span className="text-lc-gold"> · {r.retries} retried</span> : null}
            </span>
          </div>
        ))}
      </div>
      {retries > 0 && (
        <p className="lc-label text-xs text-lc-gold mt-3">{retries} retries handled by Temporal</p>
      )}
    </div>
  )
}
