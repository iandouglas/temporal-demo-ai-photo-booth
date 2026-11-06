import { boothConfig } from './boothCore'

/** The decks of the ship, as the Launchpad names them in `?deck=`. */
export type DeckId = 'transporter' | 'bridge' | 'engineering' | 'arboretum' | 'sickbay' | 'holodeck'

export const DECK_NAMES: Record<DeckId, string> = {
  transporter: 'Transporter Room',
  bridge: 'Bridge',
  engineering: 'Engineering',
  arboretum: 'Arboretum',
  sickbay: 'Sick Bay',
  holodeck: 'Holodeck',
}

const isDeck = (d: string | null): d is DeckId => !!d && d in DECK_NAMES

/**
 * Where a demo's back button goes: one level up, to its deck on the Launchpad.
 * The Launchpad opens demos with `?launchpad=<its origin>&deck=<deck>` (and
 * `?station=` / `?hub=` when set); `fallbackDeck` is used when the demo was opened
 * directly, and the Launchpad defaults to the local dev port.
 */
export function backToDeck(fallbackDeck: DeckId): { href: string; label: string; deck: DeckId } {
  const q = new URLSearchParams(window.location.search)
  const base = (q.get('launchpad') ?? 'http://localhost:5100').replace(/\/+$/, '')
  const qd = q.get('deck')
  const deck = isDeck(qd) ? qd : fallbackDeck
  const url = new URL(`${base}/`)
  url.searchParams.set('deck', deck)
  for (const k of ['station', 'hub']) {
    const v = q.get(k)
    if (v) url.searchParams.set(k, v)
  }
  return { href: url.toString(), label: `◀ ${DECK_NAMES[deck]}`, deck }
}

/**
 * The Launchpad's home screen (or `?deck=` / `?screensaver=1` on it), keeping
 * `?station=` and `?hub=`. Used by the admin panel's broadcast commands when
 * they arrive on a demo page.
 */
export function launchpadUrl(opts: { deck?: DeckId; screensaver?: boolean } = {}): string {
  const q = new URLSearchParams(window.location.search)
  const base = (q.get('launchpad') ?? `${window.location.protocol}//${window.location.hostname}:5100`).replace(/\/+$/, '')
  const url = new URL(`${base}/`)
  if (opts.deck) url.searchParams.set('deck', opts.deck)
  if (opts.screensaver) url.searchParams.set('screensaver', '1')
  for (const k of ['station', 'hub']) {
    const v = q.get(k)
    if (v) url.searchParams.set(k, v)
  }
  return url.toString()
}

/**
 * The staff config page (Booth Control: PIN pad, then the admin panel) on the
 * Launchpad (`?launchpad=`, else port 5100 on this host), at `/config`, with
 * this screen's station and hub (from the URL, or what the page remembered) so
 * it talks to the same hub. The Ziggy button links here; the page's Exit goes
 * to the Launchpad home.
 */
export function configUrl(): string {
  const q = new URLSearchParams(window.location.search)
  const base = (q.get('launchpad') ?? `${window.location.protocol}//${window.location.hostname}:5100`).replace(/\/+$/, '')
  const url = new URL(`${base}/config`)
  const { station, hubUrl } = boothConfig.get()
  url.searchParams.set('station', q.get('station') ?? station)
  url.searchParams.set('hub', q.get('hub') ?? hubUrl)
  return url.toString()
}
