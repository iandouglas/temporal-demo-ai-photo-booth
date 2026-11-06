import { useEffect, useRef, useSyncExternalStore } from 'react'
import { boothConfig, deckTimeout, type BoothCommand, type BoothConfigState } from './boothCore'
import type { DeckId } from './nav'

/*
 * Booth-wide configuration from the Booth Control hub: the React side. The
 * store, merge rules and staff API are framework-free, in ./boothCore.ts
 * (re-exported here, so `./lib/boothConfig` has everything).
 */
export * from './boothCore'

const subscribe = (l: () => void) => boothConfig.subscribe(l)

/** The booth config for this screen; re-renders when the hub pushes a change. */
export function useBoothConfig(): BoothConfigState {
  return useSyncExternalStore(subscribe, boothConfig.get, boothConfig.get)
}

/**
 * Run `handler` for each broadcast screen command aimed at this station (home,
 * reload, screensaver). With `fallback`, it runs only if the page registered no
 * handler of its own (the top bar's Ziggy button uses this for its default).
 */
export function useBoothCommands(handler: ((c: BoothCommand) => void) | null, opts: { fallback?: boolean } = {}) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  const on = handler !== null
  const fallback = !!opts.fallback
  useEffect(() => {
    if (!on) return
    return boothConfig.onCommand((c) => ref.current?.(c), fallback)
  }, [on, fallback])
}

/**
 * A demo's idle-reset delay in ms: its deck's Booth Control timeout on this
 * station, or 0 for "no timer" (the deck is set to never). Use it as an effect
 * dependency so the timer restarts when staff change the timeout:
 *
 *   const idleMs = useIdleTimeoutMs(back.deck)
 *   useEffect(() => { if (!idleMs) return; ...setTimeout(reset, idleMs)... }, [idleMs])
 */
export function useIdleTimeoutMs(deck: DeckId): number {
  const { config } = useBoothConfig()
  return deckTimeout(config, deck) * 1000
}
