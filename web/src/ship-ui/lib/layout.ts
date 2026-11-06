import { useEffect, useState } from 'react'
import { useBoothConfig } from './boothConfig'

/**
 * Which screen are we on? Every demo except the Holodeck uses this to pick
 * between two layouts:
 *
 * - 'stacked': the booth's tall portrait displays (75" TVs rotated 90°, demo in
 *   an iframe; reference 1440x2560). The viewport's long side is its height and
 *   there's room to stack the demo's main sections top/bottom.
 * - 'tabbed': laptops and other landscape or short windows. Show one section at
 *   a time behind top-bar tabs, with a slim banner keeping key controls
 *   (outage switch, pending approval) reachable from every tab.
 *
 * Decided from the viewport (the iframe's, at the booth): height must be the
 * long side by a clear margin (height/width >= 1.3) and tall enough to stack
 * (>= 1100 CSS px). Never the user agent. Staff can force either layout
 * booth-wide from the admin panel (Booth Control `layout_override`), or on one
 * screen with ?layout=stacked or ?layout=tabbed (the URL wins).
 */
export type ScreenLayout = 'stacked' | 'tabbed'

export const STACKED_QUERY = '(max-aspect-ratio: 10/13) and (min-height: 1100px)'

function forced(): ScreenLayout | null {
  const v = new URLSearchParams(window.location.search).get('layout')
  return v === 'stacked' || v === 'tabbed' ? v : null
}

/** Staff override for the booth text size, e.g. ?textscale=0.75 (0.5–1.5). */
function textScaleOverride(): number | null {
  const v = Number(new URLSearchParams(window.location.search).get('textscale'))
  return v >= 0.5 && v <= 1.5 ? v : null
}

export function useScreenLayout(): ScreenLayout {
  const { config } = useBoothConfig()
  const booth = config.layout_override === 'stacked' || config.layout_override === 'tabbed' ? config.layout_override : null
  const force = forced() ?? booth
  const [stacked, setStacked] = useState(() => window.matchMedia(STACKED_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(STACKED_QUERY)
    const on = () => setStacked(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const layout = force ?? (stacked ? 'stacked' : 'tabbed')

  // Expose the layout to CSS (html[data-layout]) and set --ship-type, the shared
  // text-size multiplier (see theme.css): ?textscale= wins, then the booth config
  // (text_scale on stacked screens, text_scale_tabbed elsewhere).
  const scale = textScaleOverride() ?? (layout === 'stacked' ? config.text_scale : config.text_scale_tabbed)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.layout = layout
    if (scale >= 0.5 && scale <= 1.5) root.style.setProperty('--ship-type', String(scale))
    else root.style.removeProperty('--ship-type')
  }, [layout, scale])

  return layout
}

/** Convenience: true on the tall booth displays. */
export function useTallScreen(): boolean {
  return useScreenLayout() === 'stacked'
}

/**
 * Can this screen open a new browser tab (e.g. the Temporal UI)?
 * Not on the booth displays: the demo runs in an iframe inside a framed TV with
 * no way to switch or close tabs, so a new tab would strand the visitor.
 * Laptops (tabbed layout) can. Force with ?newtabs=0|1.
 */
export function useCanOpenNewTabs(): boolean {
  const layout = useScreenLayout()
  const v = new URLSearchParams(window.location.search).get('newtabs')
  if (v === '0') return false
  if (v === '1') return true
  return layout === 'tabbed'
}
