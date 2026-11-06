import { createContext, useContext, type ReactNode } from 'react'
import { useCanOpenNewTabs } from '../lib/layout'
import { AdminButton } from './AdminButton'

/** True inside a TopBar that ends with the Ziggy admin button (which then takes the rounded cap). */
const AdminCapContext = createContext(false)

export interface TopBarTab {
  id: string
  label: string
}

interface TopBarProps {
  /** Demo name in the orange elbow, e.g. "Ziggy's Space Tacos" */
  title: string
  tabs?: TopBarTab[]
  activeTab?: string
  onTab?: (id: string) => void
  /** Small text in the filler bar, e.g. "Sick Bay · Diagnostics" */
  deckLabel?: string
  /** Right-side items (Temporal UI link, etc.). The last one gets the rounded cap. */
  right?: ReactNode
  /**
   * The back button, always at the far upper left (e.g. `backToDeck('sickbay')`).
   * Navigates in the same tab/frame.
   */
  back?: { label: string; href?: string; onClick?: () => void }
  /**
   * The Ziggy button at the far right: a link to the staff config page
   * (Booth Control, on the Launchpad's /config). On by default on every
   * screen; pass `admin={false}` to hide it.
   */
  admin?: boolean
}

const TAB_STYLES = [
  { on: 'bg-lc-gold text-lc-void', off: 'bg-lc-panel-hi text-lc-gold hover:bg-lc-line' },
  { on: 'bg-lc-lavender text-lc-void', off: 'bg-lc-panel-hi text-lc-lavender hover:bg-lc-line' },
  { on: 'bg-lc-sky text-lc-void', off: 'bg-lc-panel-hi text-lc-sky hover:bg-lc-line' },
  { on: 'bg-lc-peach text-lc-void', off: 'bg-lc-panel-hi text-lc-peach hover:bg-lc-line' },
]

/** The LCARS-style header bar every demo uses across the top of the screen. */
export function TopBar({ title, tabs = [], activeTab, onTab, deckLabel, right, back, admin = true }: TopBarProps) {
  const backCls =
    'lc-label flex items-center px-6 rounded-l-full bg-lc-lavender text-lc-void text-lg font-bold whitespace-nowrap hover:brightness-110'
  return (
    <div className="flex items-stretch gap-[4px] px-3 pt-3 pb-2 min-h-[68px]">
      {back &&
        (back.href ? (
          <a href={back.href} onClick={back.onClick} className={backCls} title="Back">
            {back.label}
          </a>
        ) : (
          <button onClick={back.onClick} className={backCls} title="Back">
            {back.label}
          </button>
        ))}
      <div className={`flex items-center px-6 bg-lc-orange text-lc-void ${back ? '' : 'rounded-l-full'}`}>
        <span className="lc-label text-2xl font-bold whitespace-nowrap">{title}</span>
      </div>
      <div className="w-3 bg-lc-peach" />
      {tabs.map((t, i) => {
        const st = TAB_STYLES[i % TAB_STYLES.length]
        return (
          <button
            key={t.id}
            onClick={() => onTab?.(t.id)}
            className={`lc-label px-6 text-lg font-bold transition-colors ${activeTab === t.id ? st.on : st.off}`}
          >
            {t.label}
          </button>
        )
      })}
      <div className="flex-1 bg-lc-panel-hi flex items-center justify-end px-4">
        {deckLabel && <span className="lc-label text-xs text-lc-faint">{deckLabel}</span>}
      </div>
      <AdminCapContext.Provider value={admin}>
        {right ?? (admin ? null : <div className="w-10 rounded-r-full bg-lc-blue" />)}
      </AdminCapContext.Provider>
      {admin && <AdminButton />}
    </div>
  )
}

/**
 * A right-side top-bar button/link. Put `last` on the final one for the rounded cap.
 * Links open in a new tab (e.g. the Temporal UI) unless `sameTab` is set (e.g. Launchpad).
 * New-tab links render nothing on the booth displays (see useCanOpenNewTabs).
 */
export function TopBarItem({
  children, href, onClick, color = 'violet', last = false, title, sameTab = false,
}: {
  children: ReactNode
  href?: string
  onClick?: () => void
  color?: 'violet' | 'blue' | 'red' | 'green'
  last?: boolean
  title?: string
  sameTab?: boolean
}) {
  const canOpenNewTabs = useCanOpenNewTabs()
  // The admin button, when shown, is always the last item and gets the cap.
  const adminAfter = useContext(AdminCapContext)
  const capped = last && !adminAfter
  // New-tab links (Temporal UI etc.) are hidden on the booth displays.
  if (href && !sameTab && !canOpenNewTabs) return null
  const bg = { violet: 'bg-lc-violet', blue: 'bg-lc-blue', red: 'bg-lc-red', green: 'bg-lc-green' }[color]
  const cls = `lc-label flex items-center px-5 text-lg font-bold text-lc-void hover:brightness-110 ${bg} ${capped ? 'rounded-r-full' : ''}`
  return href ? (
    sameTab ? (
      <a href={href} className={cls} title={title}>{children}</a>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className={cls} title={title}>{children}</a>
    )
  ) : (
    <button onClick={onClick} className={cls} title={title}>{children}</button>
  )
}
