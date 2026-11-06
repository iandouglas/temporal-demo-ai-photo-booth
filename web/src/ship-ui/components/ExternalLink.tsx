import type { ReactNode } from 'react'
import { useCanOpenNewTabs } from '../lib/layout'

/**
 * A link that opens in a new browser tab (Temporal UI, docs). Renders nothing on
 * the booth displays, where new tabs can't be reached or closed; see
 * useCanOpenNewTabs(). Use this for every Temporal UI / external link.
 */
export function ExternalLink({
  href, children, className, title,
}: { href?: string | null; children: ReactNode; className?: string; title?: string }) {
  const can = useCanOpenNewTabs()
  if (!can || !href) return null
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} title={title}>
      {children}
    </a>
  )
}
