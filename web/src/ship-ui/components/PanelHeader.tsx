import type { ReactNode } from 'react'


export type LcColor = 'orange' | 'peach' | 'gold' | 'lavender' | 'violet' | 'blue' | 'sky' | 'green' | 'red'

// Literal class names so Tailwind can find them.
const CAP: Record<LcColor, string> = {
  orange: 'bg-lc-orange', peach: 'bg-lc-peach', gold: 'bg-lc-gold', lavender: 'bg-lc-lavender',
  violet: 'bg-lc-violet', blue: 'bg-lc-blue', sky: 'bg-lc-sky', green: 'bg-lc-green', red: 'bg-lc-red',
}
const TEXT: Record<LcColor, string> = {
  orange: 'text-lc-orange', peach: 'text-lc-peach', gold: 'text-lc-gold', lavender: 'text-lc-lavender',
  violet: 'text-lc-violet', blue: 'text-lc-blue', sky: 'text-lc-sky', green: 'text-lc-green', red: 'text-lc-red',
}

interface PanelHeaderProps {
  title: string
  subtitle?: ReactNode
  color?: LcColor
  /** Optional control on the right, e.g. a collapse button */
  action?: ReactNode
}

/** Section header: rounded color cap, title block, optional action. */
export function PanelHeader({ title, subtitle, color = 'peach', action }: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-lc-line">
      <div className="flex items-stretch gap-[4px] flex-1 min-w-0">
        <div className={`w-6 flex-shrink-0 rounded-l-full ${CAP[color]}`} />
        <div className="flex-1 min-w-0 px-3 py-1 bg-lc-panel-hi">
          <h2 className={`lc-label text-[clamp(1.125rem,1.6vmin,2rem)] font-bold leading-tight ${TEXT[color]}`}>{title}</h2>
          {subtitle && <div className="text-[clamp(0.75rem,1.1vmin,1.25rem)] text-lc-dim">{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  )
}
