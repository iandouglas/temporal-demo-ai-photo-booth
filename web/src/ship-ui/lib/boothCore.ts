import type { DeckId } from './nav'

/**
 * Booth-wide configuration from the Booth Control hub (booth-control/, port 8090).
 *
 * One store per page: it subscribes to the hub over SSE, polls as a fallback,
 * and caches the last config in localStorage, so a station that loses the hub
 * keeps its last settings (and falls back to the built-in defaults below if it
 * never reached the hub at all).
 *
 * - Station id: `?station=` (remembered in localStorage), else "laptop".
 * - Hub URL: `?hub=` (remembered), else port 8090 on the page's own host. When
 *   staff set a new hub address booth-wide, the screen moves to it once it
 *   answers (see `hub_address`).
 *
 * The Python twin of the merge rules is booth-control/backend/src/booth_control/model.py.
 *
 * This file is framework-free (the Holodeck's plain TS pages import it
 * directly); the React hooks are in ./boothConfig.ts.
 */

export const DECK_IDS: DeckId[] = ['transporter', 'bridge', 'engineering', 'arboretum', 'sickbay', 'holodeck']

export type NetworkMode = 'online' | 'offline'
/**
 * Which Temporal server the demos use. auto (default) = Temporal Cloud on a station that is
 * online and whose Cloud check passed, else the hub's Temporal (its own on the hub laptop).
 */
export type TemporalTarget = 'auto' | 'local' | 'hub' | 'cloud'
export type ResolvedTemporalTarget = Exclude<TemporalTarget, 'auto'>
export type LayoutOverride = 'auto' | 'stacked' | 'tabbed'
export type ScreensaverVariantSetting = 'alternate' | 'slots' | 'classic'
/** Screen commands (over SSE) and machine commands (station agents, via Temporal) */
export type CommandKind = 'home' | 'reload' | 'screensaver' | 'restart_demo' | 'restart_demos' | 'restart_ship'

export interface BoothSettings {
  network_mode: NetworkMode
  /** Which Temporal server the demos use (separate from network_mode; see resolveTemporalTarget) */
  temporal_target: TemporalTarget
  /** --ship-type on the tall booth TVs (stacked layout) */
  text_scale: number
  /** --ship-type on laptops / landscape (tabbed layout) */
  text_scale_tabbed: number
  layout_override: LayoutOverride
  /** Seconds of no touches before a deck page returns home; 0 = never */
  deck_idle_timeout_s: Record<DeckId, number>
  /** Seconds of no touches on the Launchpad home before the screensaver; 0 = never */
  launchpad_home_idle_s: number
  screensaver_variant: ScreensaverVariantSetting
  /** Launchpad card id -> false when that card is switched off (missing = on) */
  demo_enabled: Record<string, boolean>
}

type MapKey = 'deck_idle_timeout_s' | 'demo_enabled'
export type SettingsPatch = Partial<Omit<BoothSettings, MapKey>> & {
  deck_idle_timeout_s?: Partial<Record<DeckId, number>>
  demo_enabled?: Record<string, boolean>
}
/** Station overrides: `null` removes an override (inherit the booth-wide value). */
export type OverridesPatch = {
  [K in keyof Omit<BoothSettings, MapKey>]?: BoothSettings[K] | null
} & {
  deck_idle_timeout_s?: Partial<Record<DeckId, number | null>>
  demo_enabled?: Record<string, boolean | null>
}

export interface StationEntry {
  label: string
  home_deck: DeckId | null
  overrides: SettingsPatch
}

export interface BoothCommand {
  id: number
  kind: CommandKind
  target: string
  issued_at: string
  by: string
}

export interface BoothConfigPayload {
  version: number
  updated_at: string | null
  global: BoothSettings
  stations: Record<string, StationEntry>
  commands: BoothCommand[]
  /** How stations reach the hub, set by staff ("" = as each was set up), e.g. "192.168.1.10" */
  hub_address?: string
  hub?: { temporal_ok: boolean; server_time: string }
  /** Where this station's demos run now, from its agent's last heartbeat (when the hub has one) */
  station_temporal?: { target: ResolvedTemporalTarget; namespace: string; ui_url: string } | null
}

export interface EffectiveConfig extends BoothSettings {
  station: string
  label: string
  /** The deck this station starts on and returns to after a timeout (null = the Launchpad home) */
  home_deck: DeckId | null
}

export interface BoothConfigState {
  station: string
  hubUrl: string
  /** This station's settings (booth-wide + its overrides + any live preview) */
  config: EffectiveConfig
  /** The last payload from the hub (or the cache) */
  raw: BoothConfigPayload
  source: 'hub' | 'cache' | 'defaults'
  hubReachable: boolean
  /** Temporal behind the hub is up (settings can be changed) */
  temporalOk: boolean
  lastContact: number | null
  preview: SettingsPatch | null
}

/**
 * Decks that never return home on a timer, on any station, whatever the
 * config says (booth-control model.NEVER_TIMEOUT_DECKS): once a visitor is in
 * the Holodeck, nothing goes back on a timer.
 */
export const NEVER_TIMEOUT_DECKS: readonly DeckId[] = ['holodeck']

export const DEFAULT_SETTINGS: BoothSettings = {
  network_mode: 'online',
  temporal_target: 'auto',
  text_scale: 0.82,
  text_scale_tabbed: 1,
  layout_override: 'auto',
  deck_idle_timeout_s: { transporter: 90, bridge: 90, engineering: 90, arboretum: 90, sickbay: 90, holodeck: 0 },
  launchpad_home_idle_s: 300,
  screensaver_variant: 'alternate',
  demo_enabled: {},
}

/** Same seed as the hub: station 4 is the Holodeck station (it starts on the Holodeck deck). */
export function defaultPayload(): BoothConfigPayload {
  const st = (label: string): StationEntry => ({ label, home_deck: null, overrides: {} })
  return {
    version: 0,
    updated_at: null,
    global: structuredClone(DEFAULT_SETTINGS),
    stations: {
      '1': st('Station 1'),
      '2': st('Station 2'),
      '3': st('Station 3'),
      '4': { label: 'Station 4 - Holodeck', home_deck: 'holodeck', overrides: {} },
      laptop: st('Staff laptop'),
    },
    commands: [],
  }
}

/**
 * Booth-wide settings with one station's overrides on top (deck timeouts merge
 * deck by deck). NEVER_TIMEOUT_DECKS are always 0, as in the hub's model.effective().
 */
export function mergeEffective(p: BoothConfigPayload, station: string, preview?: SettingsPatch | null): EffectiveConfig {
  const g = { ...DEFAULT_SETTINGS, ...p.global }
  const st = p.stations?.[station]
  const o = st?.overrides ?? {}
  const out: EffectiveConfig = {
    ...g,
    ...stripNulls(o),
    deck_idle_timeout_s: { ...DEFAULT_SETTINGS.deck_idle_timeout_s, ...g.deck_idle_timeout_s, ...(o.deck_idle_timeout_s ?? {}) },
    demo_enabled: { ...(g.demo_enabled ?? {}), ...(o.demo_enabled ?? {}) },
    station,
    label: st?.label || (station === 'laptop' ? 'Laptop' : `Station ${station}`),
    home_deck: st?.home_deck ?? null,
  }
  if (preview) {
    Object.assign(out, stripNulls(preview))
    if (preview.deck_idle_timeout_s) out.deck_idle_timeout_s = { ...out.deck_idle_timeout_s, ...preview.deck_idle_timeout_s }
  }
  for (const d of NEVER_TIMEOUT_DECKS) out.deck_idle_timeout_s[d] = 0
  return out
}

/** What a station knows that the hub doesn't: did its Cloud check pass, and is it the hub laptop? */
export interface TargetContext {
  cloudOk?: boolean
  isHub?: boolean
}

/**
 * Where a station's demos run (the hub's model.resolve_temporal_target): local and hub as asked;
 * auto and cloud become Temporal Cloud when online and the station's Cloud check passed,
 * otherwise the fallback: the hub's Temporal on a station, its own on the hub laptop.
 */
export function resolveTemporalTarget(
  target: TemporalTarget | undefined,
  network: NetworkMode,
  ctx: TargetContext = {},
): ResolvedTemporalTarget {
  if (target === 'local' || target === 'hub') return target
  if (network !== 'offline' && ctx.cloudOk) return 'cloud'
  return ctx.isHub ? 'local' : 'hub'
}

/** A station's own namespace on the hub's Temporal server. */
export function stationNamespace(station: string): string {
  return `station-${station.toLowerCase()}`
}

/**
 * The Temporal UI for this station's demos (for links on laptop layouts):
 * the hub's UI in the station's namespace, Temporal Cloud, or this machine's.
 */
export function temporalUiUrl(state: Pick<BoothConfigState, 'config' | 'station' | 'hubUrl'> & { raw?: BoothConfigPayload }): string {
  // Where the demos actually run (the station agent's report), else a guess without its Cloud check.
  const now = state.raw?.station_temporal
  const target = now?.target ?? resolveTemporalTarget(state.config.temporal_target, state.config.network_mode, { isHub: state.station === 'laptop' })
  if (target === 'hub') {
    let host = window.location.hostname
    try {
      host = new URL(state.hubUrl).hostname
    } catch {
      /* keep the page's host */
    }
    return `${window.location.protocol}//${host}:8233/namespaces/${stationNamespace(state.station)}/workflows`
  }
  if (target === 'cloud') return now?.ui_url || 'https://cloud.temporal.io/namespaces'
  return `${window.location.protocol}//${window.location.hostname}:8233`
}

function stripNulls<T extends object>(o: T): Partial<T> {
  const r: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && v !== undefined && k !== 'deck_idle_timeout_s' && k !== 'demo_enabled') r[k] = v
  }
  return r as Partial<T>
}

// ── station and hub from the URL ───────────────────────────────────────────

const STATION_RE = /^[A-Za-z0-9_-]{1,16}$/
const LS = {
  station: 'booth.station',
  hub: 'booth.hub',
  cache: 'booth.config.v1',
  lastCmd: 'booth.lastCommand',
}

function lsGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k)
  } catch {
    return null
  }
}
function lsSet(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v)
  } catch {
    /* private mode / quota: fine, we just don't cache */
  }
}

function cleanHub(v: string | null): string | null {
  if (!v) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

/** This screen's station id: ?station=, else the last one this page saw, else "laptop". */
export function resolveStation(): string {
  const q = new URLSearchParams(window.location.search).get('station')
  if (q && STATION_RE.test(q)) {
    lsSet(LS.station, q)
    return q
  }
  const saved = lsGet(LS.station)
  return saved && STATION_RE.test(saved) ? saved : 'laptop'
}

/** The hub's origin: ?hub=, else the last one this page saw, else :8090 on this host. */
export function resolveHub(): string {
  const q = cleanHub(new URLSearchParams(window.location.search).get('hub'))
  if (q) {
    lsSet(LS.hub, q)
    return q
  }
  return cleanHub(lsGet(LS.hub)) ?? `${window.location.protocol}//${window.location.hostname}:8090`
}

/** Add ?station= and ?hub= to a link so the next page (a demo, the Launchpad) talks to the same hub. */
export function withBoothParams(href: string): string {
  const url = new URL(href, window.location.href)
  const s = store()
  if (!url.searchParams.has('station')) url.searchParams.set('station', s.state.station)
  if (!url.searchParams.has('hub')) url.searchParams.set('hub', s.state.hubUrl)
  return url.toString()
}

// ── the store ──────────────────────────────────────────────────────────────

type Listener = () => void
type CommandListener = (cmd: BoothCommand) => void

const POLL_HEALTHY_MS = 20_000
const POLL_UNREACHABLE_MS = 3_000
const SSE_RETRY_MS = 10_000
/** Ignore commands older than this (a station that was off shouldn't replay them). */
const COMMAND_MAX_AGE_MS = 120_000

class BoothStore {
  state: BoothConfigState
  private listeners = new Set<Listener>()
  private commandListeners = new Set<CommandListener>()
  /** Used only when the page registered no handler of its own (the top bar's default). */
  private fallbackListeners = new Set<CommandListener>()
  private es: EventSource | null = null
  private sseOk = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private sseTimer: ReturnType<typeof setTimeout> | null = null
  private started = false

  constructor() {
    const station = resolveStation()
    const hubUrl = resolveHub()
    let raw = defaultPayload()
    let source: BoothConfigState['source'] = 'defaults'
    const cached = lsGet(LS.cache)
    if (cached) {
      try {
        const c = JSON.parse(cached)
        if (isPayload(c)) {
          raw = c
          source = 'cache'
        }
      } catch {
        /* ignore a corrupt cache */
      }
    }
    this.state = {
      station,
      hubUrl,
      raw,
      source,
      config: mergeEffective(raw, station),
      hubReachable: false,
      temporalOk: false,
      lastContact: null,
      preview: null,
    }
  }

  start() {
    if (this.started) return
    this.started = true
    this.connect()
    this.schedulePoll(0)
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    this.start()
    return () => {
      this.listeners.delete(l)
    }
  }

  getSnapshot = () => this.state

  onCommand(l: CommandListener, fallback = false) {
    const set = fallback ? this.fallbackListeners : this.commandListeners
    set.add(l)
    this.start()
    return () => {
      set.delete(l)
    }
  }

  /** Show settings on this screen only, without saving (e.g. the text-scale slider). */
  setPreview(preview: SettingsPatch | null) {
    this.set({ preview, config: mergeEffective(this.state.raw, this.state.station, preview) })
  }

  /** Apply a payload the admin panel got back from a write, without waiting for the push. */
  accept(p: unknown) {
    if (isPayload(p)) this.apply(p, false)
  }

  /** Fetch the latest config now (e.g. right after the panel opens). */
  refresh() {
    void this.poll()
  }

  private set(patch: Partial<BoothConfigState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  private connect() {
    if (typeof EventSource === 'undefined') return
    if (this.sseTimer) clearTimeout(this.sseTimer)
    const url = `${this.state.hubUrl}/api/config/stream?station=${encodeURIComponent(this.state.station)}`
    const es = new EventSource(url)
    this.es = es
    es.addEventListener('config', (ev) => {
      this.sseOk = true
      try {
        const p = JSON.parse((ev as MessageEvent).data)
        if (isPayload(p)) this.apply(p, true)
      } catch {
        /* ignore */
      }
    })
    es.onerror = () => {
      // Don't let EventSource hammer a dead hub; fall back to polling and retry later.
      this.sseOk = false
      es.close()
      if (this.es === es) this.es = null
      this.schedulePoll(0)
      this.sseTimer = setTimeout(() => this.connect(), SSE_RETRY_MS)
    }
  }

  private schedulePoll(ms: number) {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => void this.poll(), ms)
  }

  private async poll() {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    try {
      const r = await fetch(`${this.state.hubUrl}/api/config?station=${encodeURIComponent(this.state.station)}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(String(r.status))
      const p = await r.json()
      if (isPayload(p)) this.apply(p, true)
    } catch {
      if (!this.sseOk && this.state.hubReachable) this.set({ hubReachable: false, temporalOk: false })
    } finally {
      clearTimeout(t)
      this.schedulePoll(this.sseOk ? POLL_HEALTHY_MS : POLL_UNREACHABLE_MS)
    }
  }

  private apply(p: BoothConfigPayload, fromHub: boolean) {
    const sameVersion =
      p.version === this.state.raw.version &&
      this.state.source === 'hub' &&
      // where this station's demos run (Temporal UI links) can change without a config change
      JSON.stringify(p.station_temporal ?? null) === JSON.stringify(this.state.raw.station_temporal ?? null)
    lsSet(LS.cache, JSON.stringify({ ...p, hub: undefined }))
    const next: Partial<BoothConfigState> = {
      raw: p,
      source: 'hub',
      config: mergeEffective(p, this.state.station, this.state.preview),
    }
    if (fromHub) {
      next.hubReachable = true
      next.temporalOk = !!p.hub?.temporal_ok
      next.lastContact = Date.now()
    }
    if (sameVersion && fromHub && this.state.hubReachable && this.state.temporalOk === next.temporalOk) {
      // Nothing changed; just note the contact without re-rendering everything.
      this.state = { ...this.state, lastContact: next.lastContact ?? this.state.lastContact }
    } else {
      this.set(next)
    }
    this.handleCommands(p)
    this.maybeMoveHub(p)
  }

  private movingHub = false
  /**
   * Staff set a new hub address booth-wide: move this screen to it once it
   * answers. Screens on the hub itself (localhost) stay put.
   */
  private maybeMoveHub(p: BoothConfigPayload) {
    const addr = (p.hub_address ?? '').trim()
    if (!addr || this.movingHub) return
    let cur: URL
    try {
      cur = new URL(this.state.hubUrl)
    } catch {
      return
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(cur.hostname)) return
    const next = cleanHub(`${cur.protocol}//${addr.includes(':') ? addr : `${addr}:8090`}`)
    if (!next || next === this.state.hubUrl) return
    this.movingHub = true
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    fetch(`${next}/api/health`, { cache: 'no-store', signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) return
        lsSet(LS.hub, next)
        this.es?.close()
        this.es = null
        this.set({ hubUrl: next })
        this.connect()
        this.schedulePoll(0)
      })
      .catch(() => {
        /* not reachable from here: keep the current hub */
      })
      .finally(() => {
        clearTimeout(t)
        setTimeout(() => (this.movingHub = false), 30_000)
      })
  }

  private handleCommands(p: BoothConfigPayload) {
    const key = `${LS.lastCmd}:${this.state.hubUrl}`
    const maxId = p.commands.reduce((m, c) => Math.max(m, c.id), 0)
    const savedRaw = lsGet(key)
    if (savedRaw === null) {
      lsSet(key, String(maxId)) // first contact: don't replay history
      return
    }
    const lastSeen = Number(savedRaw) || 0
    if (maxId <= lastSeen) {
      if (maxId < lastSeen) lsSet(key, String(maxId)) // hub state was reset
      return
    }
    lsSet(key, String(maxId)) // save first, so a "reload" command can't loop
    const now = p.hub?.server_time ? Date.parse(p.hub.server_time) : Date.now()
    for (const c of p.commands) {
      if (c.id <= lastSeen) continue
      if (c.target !== 'all' && c.target !== this.state.station) continue
      if (now - Date.parse(c.issued_at) > COMMAND_MAX_AGE_MS) continue
      const ls = this.commandListeners.size ? this.commandListeners : this.fallbackListeners
      ls.forEach((l) => l(c))
    }
  }
}

function isPayload(p: unknown): p is BoothConfigPayload {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return typeof o.version === 'number' && !!o.global && typeof o.global === 'object' && !!o.stations && Array.isArray(o.commands)
}

let singleton: BoothStore | null = null
function store(): BoothStore {
  singleton ??= new BoothStore()
  return singleton
}

/** Framework-free access (e.g. the Holodeck's vanilla TS pages). */
export const boothConfig = {
  get: () => store().state,
  subscribe: (fn: (s: BoothConfigState) => void) => store().subscribe(() => fn(store().state)),
  /** With `fallback`, `fn` runs only if the page registered no handler of its own. */
  onCommand: (fn: (c: BoothCommand) => void, fallback = false) => store().onCommand(fn, fallback),
  setPreview: (p: SettingsPatch | null) => store().setPreview(p),
  accept: (p: unknown) => store().accept(p),
  refresh: () => store().refresh(),
}

/** Is this Launchpad card switched on for this station? */
export function demoEnabled(cfg: EffectiveConfig, cardId: string): boolean {
  return cfg.demo_enabled?.[cardId] !== false
}

/** Idle seconds for a deck on this station (0 = never). */
export function deckTimeout(cfg: EffectiveConfig, deck: DeckId): number {
  return cfg.deck_idle_timeout_s[deck] ?? DEFAULT_SETTINGS.deck_idle_timeout_s[deck]
}

// ── staff API (the admin panel) ────────────────────────────────────────────

export type PinResult =
  | { ok: true; token: string; expiresIn: number }
  | { ok: false; reason: 'wrong' }
  | { ok: false; reason: 'unreachable' }

export async function verifyPin(pin: string): Promise<PinResult> {
  const { hubUrl, station } = store().state
  try {
    const r = await fetch(`${hubUrl}/api/auth/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, station }),
    })
    const body = await r.json().catch(() => ({}))
    if (r.ok && typeof body.token === 'string') return { ok: true, token: body.token, expiresIn: body.expires_in }
    if (r.status === 401) return { ok: false, reason: 'wrong' }
    return { ok: false, reason: 'unreachable' }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

export class StaffApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Call a staff-only hub endpoint with the token from verifyPin. */
export async function staffApi<T = unknown>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const { hubUrl } = store().state
  let r: Response
  try {
    r = await fetch(`${hubUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new StaffApiError(0, 'Hub unreachable')
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new StaffApiError(r.status, typeof data.detail === 'string' ? data.detail : `Error ${r.status}`)
  return data as T
}
