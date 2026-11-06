import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  boothConfig,
  DECK_IDS,
  mergeEffective,
  NEVER_TIMEOUT_DECKS,
  staffApi,
  StaffApiError,
  useBoothCommands,
  useBoothConfig,
  verifyPin,
  type BoothConfigPayload,
  type BoothSettings,
  type CommandKind,
  type OverridesPatch,
  type SettingsPatch,
} from '../lib/boothConfig'
import { DECK_NAMES, type DeckId } from '../lib/nav'
import { ZIGGY_PNG } from '../lib/ziggy'
import { OnScreenKeyboard, KeyboardField } from './OnScreenKeyboard'
import { RestartConfirm, StationTemporalRow, TemporalTab, targetChanges, withGlobal, type HeartbeatTemporal, type TargetChange } from './BoothTemporal'

/*
 * Booth Control admin panel (staff only), shown full screen by ConfigScreen:
 * on the Launchpad's /config page (where every Ziggy button links) and in the
 * Booth Control console (:5090). A staff PIN (checked by the hub) unlocks it.
 * Changes go to the Booth Control hub, which stores them in the
 * BoothConfigWorkflow and pushes them to every station. Not exported from
 * ship-ui's index: import it from `ship-ui/admin`.
 */

const DECK_STEPS = [0, 15, 30, 45, 60, 90, 120, 180, 300, 600]
/** Decks with an idle timeout to set (the Holodeck never times out, so it has no control). */
const TIMED_DECKS = DECK_IDS.filter((d) => !NEVER_TIMEOUT_DECKS.includes(d))
const HOME_STEPS = [0, 60, 120, 180, 300, 600, 900, 1800]

type Tab = 'station' | 'booth' | 'demos' | 'fleet' | 'temporal' | 'actions' | 'log'
const TABS: { id: Tab; label: string }[] = [
  { id: 'station', label: 'This station' },
  { id: 'booth', label: 'Booth-wide' },
  { id: 'demos', label: 'Demos on/off' },
  { id: 'fleet', label: 'Stations' },
  { id: 'temporal', label: 'Hub & Temporal' },
  { id: 'actions', label: 'Actions' },
  { id: 'log', label: 'Log & leads' },
]

// ── data from the hub (staff endpoints) ─────────────────────────────────────

export interface Heartbeat {
  agent_id: string
  hostname: string
  ip: string
  commit: string
  ai_mode: string
  demos: { id: string; up: boolean }[]
  leads: { demo: string; total: number; unsynced: number }[]
  age_s: number
  temporal?: HeartbeatTemporal
}
export interface FleetStation {
  registration: { hostname: string; ip: string; commit: string; agent_id: string; registered_at: string } | null
  heartbeat: Heartbeat | null
  online: boolean
  duplicates: string[]
}
interface Task {
  id: number
  station: string
  kind: string
  args: { demo?: string; disabled_demos?: string[]; network_mode?: string }
  status: 'pending' | 'done' | 'failed' | 'expired'
  detail: string
  issued_at: string
  finished_at: string | null
  by: string
}
export interface Fleet {
  stations: Record<string, FleetStation>
  tasks: Task[]
}
interface AuditEntry {
  at: string
  by: string
  action: string
  changes: string[]
}
interface CatalogDeck {
  id: DeckId
  name: string
  demos: { id: string; name: string; port: number; online?: boolean }[]
}

function useStaff(token: string, onSignedOut: () => void) {
  const [fleet, setFleet] = useState<Fleet | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [catalog, setCatalog] = useState<CatalogDeck[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signedOut = useRef(onSignedOut)
  useEffect(() => {
    signedOut.current = onSignedOut
  })

  const fail = useCallback((e: unknown) => {
    if (e instanceof StaffApiError && e.status === 401) signedOut.current()
    else setError(e instanceof Error ? e.message : String(e))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [f, a] = await Promise.all([
        staffApi<Fleet>(token, '/api/fleet'),
        staffApi<AuditEntry[]>(token, '/api/audit?limit=10'),
      ])
      setFleet(f)
      setAudit(a)
    } catch (e) {
      if (e instanceof StaffApiError && e.status === 401) signedOut.current()
    }
  }, [token])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, 3000)
    fetch(`${boothConfig.get().hubUrl}/api/catalog`)
      .then((r) => r.json())
      .then((c) => Array.isArray(c) && setCatalog(c))
      .catch(() => {})
    return () => clearInterval(id)
  }, [refresh])

  /** Make a change; the returned public config is applied on this screen right away. */
  const write = useCallback(
    async (path: string, method: string, body?: unknown) => {
      setBusy(true)
      setError(null)
      try {
        const res = await staffApi(token, path, method, body)
        boothConfig.accept(res)
        void refresh()
        return true
      } catch (e) {
        fail(e)
        return false
      } finally {
        setBusy(false)
      }
    },
    [token, fail, refresh],
  )

  return {
    fleet,
    audit,
    catalog,
    error,
    busy,
    clearError: () => setError(null),
    patchGlobal: (patch: SettingsPatch) => write('/api/config/global', 'PATCH', { patch }),
    patchStation: (sid: string, patch: { label?: string; home_deck?: DeckId | null; overrides?: OverridesPatch; clear_overrides?: boolean }) =>
      write(`/api/config/stations/${encodeURIComponent(sid)}`, 'PATCH', patch),
    command: (kind: CommandKind, target: string, demo?: string) => write('/api/commands', 'POST', { kind, target, ...(demo ? { demo } : {}) }),
    reset: () => write('/api/config/reset', 'POST', { confirm: true }),
    forget: (sid: string) => write(`/api/fleet/${encodeURIComponent(sid)}/forget`, 'POST'),
    setHub: (address: string) => write('/api/config/hub', 'POST', { address }),
  }
}
export type Staff = ReturnType<typeof useStaff>

// ── small controls ─────────────────────────────────────────────────────────

export function Dot({ ok, warn }: { ok: boolean | undefined; warn?: boolean }) {
  const cls = ok === undefined ? 'bg-lc-faint' : warn ? 'bg-lc-gold' : ok ? 'bg-lc-green shadow-[0_0_8px_#66dd99]' : 'bg-lc-red'
  return <span className={`inline-block w-[0.7em] h-[0.7em] rounded-full flex-shrink-0 ${cls}`} />
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="lc-card !rounded-2xl p-[0.9em] mb-[0.9em]">
      <div className="flex items-center gap-[0.6em] mb-[0.6em]">
        <span className="w-[0.5em] self-stretch rounded-l-full bg-lc-peach" />
        <h3 className="lc-label font-bold text-lc-peach text-[1.15em] flex-1">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[0.8em] gap-y-[0.3em] py-[0.45em] border-b border-lc-line/60 last:border-0">
      <div className="min-w-[9em] flex-1">
        <div className="lc-label text-lc-text">{label}</div>
        {hint && <div className="text-lc-dim text-[0.8em]">{hint}</div>}
      </div>
      <div className="flex items-center gap-[0.5em] flex-wrap">{children}</div>
    </div>
  )
}

export function Btn({
  children, onClick, color = 'bg-lc-orange', disabled, small, title,
}: {
  children: ReactNode; onClick: () => void; color?: string; disabled?: boolean; small?: boolean; title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`lc-btn ${color} ${small ? '!min-h-[2.4em] !px-[0.9em] text-[0.85em]' : '!min-h-[2.8em] !px-[1.2em]'}`}
    >
      {children}
    </button>
  )
}

/** First tap arms it ("Tap again"), second tap within 4 s does it. */
function ConfirmBtn({ children, onConfirm, color = 'bg-lc-orange', small, disabled }: {
  children: ReactNode; onConfirm: () => void; color?: string; small?: boolean; disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Btn
      small={small}
      disabled={disabled}
      color={armed ? 'bg-lc-red' : color}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? 'Tap again to confirm' : children}
    </Btn>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full overflow-hidden border-2 border-lc-line">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`lc-label font-bold min-h-[2.6em] px-[1em] ${value === o.v ? 'bg-lc-gold text-lc-void' : 'bg-lc-panel-hi text-lc-dim'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function secs(v: number): string {
  if (v === 0) return 'Never'
  if (v < 120) return `${v} s`
  return `${Math.round(v / 60)} min`
}

/** − value + over a fixed list of steps (0 shows "Never"). */
function Stepper({ value, steps, onChange, dim }: { value: number; steps: number[]; onChange: (v: number) => void; dim?: boolean }) {
  const idx = steps.indexOf(value)
  const at = idx >= 0 ? idx : steps.findIndex((s) => s > value)
  const prev = idx >= 0 ? steps[Math.max(0, idx - 1)] : steps[Math.max(0, (at < 0 ? steps.length : at) - 1)]
  const next = idx >= 0 ? steps[Math.min(steps.length - 1, idx + 1)] : steps[at < 0 ? steps.length - 1 : at]
  return (
    <div className="inline-flex items-center gap-[0.4em]">
      <button type="button" className="lc-btn bg-lc-panel-hi !text-lc-text !min-h-[2.6em] !min-w-[2.6em] !px-0" onClick={() => onChange(prev)} aria-label="Less">−</button>
      <span className={`lc-label font-bold text-center min-w-[4.6em] ${dim ? 'text-lc-dim' : value === 0 ? 'text-lc-sky' : 'text-lc-text'}`}>{secs(value)}</span>
      <button type="button" className="lc-btn bg-lc-panel-hi !text-lc-text !min-h-[2.6em] !min-w-[2.6em] !px-0" onClick={() => onChange(next)} aria-label="More">+</button>
    </div>
  )
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`lc-label font-bold rounded-full min-h-[2.4em] min-w-[5em] px-[0.9em] border-2 ${
        on ? 'bg-lc-green/20 border-lc-green text-lc-green' : 'bg-lc-red/15 border-lc-red text-lc-red'
      } disabled:opacity-50`}
    >
      {on ? 'On' : 'Off'}
    </button>
  )
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function stationIds(raw: BoothConfigPayload, fleet: Fleet | null): string[] {
  const ids = new Set([...Object.keys(raw.stations), ...Object.keys(fleet?.stations ?? {})])
  return [...ids].sort((a, b) => (a === 'laptop' ? 1 : b === 'laptop' ? -1 : a.localeCompare(b, undefined, { numeric: true })))
}

// ── PIN pad ────────────────────────────────────────────────────────────────

function PinPad({ onUnlocked, onCancel, cancelLabel }: { onUnlocked: (token: string) => void; onCancel?: () => void; cancelLabel: string }) {
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState<string>('Staff PIN')
  const [checking, setChecking] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const dotsRef = useRef<HTMLDivElement>(null)
  const { hubUrl } = useBoothConfig()

  const shake = () =>
    dotsRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-0.6em)' }, { transform: 'translateX(0.6em)' }, { transform: 'translateX(-0.3em)' }, { transform: 'translateX(0)' }],
      { duration: 360 },
    )

  // No lockout: a wrong PIN just says so and clears (the hub never locks either).
  const submit = async () => {
    if (pin.length < 4 || checking) return
    setChecking(true)
    const r = await verifyPin(pin)
    setChecking(false)
    setPin('')
    if (r.ok) return onUnlocked(r.token)
    shake()
    if (r.reason === 'wrong') setMsg('Wrong PIN')
    else {
      setUnreachable(true)
      setMsg("Can't reach Booth Control")
    }
  }

  const press = (k: string) => {
    setUnreachable(false)
    if (k === '⌫') setPin((p) => p.slice(0, -1))
    else if (k === '⏎') void submit()
    else setPin((p) => (p.length < 8 ? p + k : p))
  }

  return (
    <div className="w-[min(92vw,22em)] flex flex-col items-center gap-[0.8em]">
      <img src={ZIGGY_PNG} alt="Ziggy" width={128} height={128} draggable={false} className="w-[4.5em] h-[4.5em] rounded-full bg-lc-panel ring-[0.15em] ring-lc-blue" />
      <div className="lc-label font-bold text-lc-peach text-[1.3em] text-center">{msg}</div>
      <div ref={dotsRef} className="flex gap-[0.6em] min-h-[1.6em] items-center">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={`w-[1em] h-[1em] rounded-full border-2 border-lc-gold ${i < pin.length ? 'bg-lc-gold' : ''}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-[0.6em] w-full">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '⏎'].map((k) => (
          <button
            key={k}
            type="button"
            disabled={checking}
            onClick={() => press(k)}
            className={`lc-btn !rounded-2xl !min-h-[3.4em] text-[1.4em] ${
              k === '⏎' ? 'bg-lc-green' : k === '⌫' ? 'bg-lc-panel-hi !text-lc-text' : 'bg-lc-lavender'
            }`}
            aria-label={k === '⌫' ? 'Delete' : k === '⏎' ? 'Enter' : k}
          >
            {k}
          </button>
        ))}
      </div>
      {unreachable && (
        <div className="text-center text-lc-dim text-[0.9em]">
          The PIN is checked by the hub at <span className="text-lc-text">{hubUrl}</span>. This screen keeps its last settings.
          <div className="mt-[0.6em]">
            <Btn small color="bg-lc-sky" onClick={() => window.location.reload()}>Reload this screen</Btn>
          </div>
        </div>
      )}
      {onCancel && <Btn color="bg-lc-blue" onClick={onCancel}>{cancelLabel}</Btn>}
    </div>
  )
}

// ── tabs ───────────────────────────────────────────────────────────────────

function StationTab({ staff }: { staff: Staff }) {
  const s = useBoothConfig()
  const c = s.config
  const mine = staff.fleet?.stations[s.station]
  const demos = mine?.heartbeat?.demos ?? []
  return (
    <>
      <Section title="This station">
        <Row label="Station">{s.station} · {c.label}</Row>
        <Row label="Home deck" hint="Where this station starts and returns to after a timeout">{c.home_deck ? DECK_NAMES[c.home_deck] : 'Launchpad home'}</Row>
        <Row label="Layout · text scale" hint="Text scale on booth TVs (stacked) / laptops (tabbed)">{c.layout_override} · {c.text_scale.toFixed(2)} / {c.text_scale_tabbed.toFixed(2)}</Row>
        <Row label="Network mode">{c.network_mode}</Row>
        <StationTemporalRow staff={staff} />
        <Row label="Booth Control hub" hint={s.hubUrl}>
          <Dot ok={s.hubReachable} warn={s.hubReachable && !s.temporalOk} />
          {s.hubReachable ? (s.temporalOk ? 'Connected' : 'Connected · Temporal down (read-only)') : `Unreachable · using ${s.source === 'defaults' ? 'built-in defaults' : 'cached settings'}`}
        </Row>
        <Row label="Config version">{s.raw.version}{s.raw.updated_at ? ` · changed ${ago(s.raw.updated_at)}` : ''}</Row>
      </Section>
      <Section title="This station's machine" right={mine && <span className="flex items-center gap-2 text-lc-dim"><Dot ok={mine.online} />{mine.online ? 'agent online' : 'agent offline'}</span>}>
        {!mine ? (
          <p className="text-lc-dim">No station agent has reported for station {s.station}. It starts with ./start.sh on the station.</p>
        ) : (
          <>
            <Row label="Machine">{mine.heartbeat?.hostname ?? mine.registration?.hostname} · {mine.heartbeat?.ip ?? mine.registration?.ip} · {mine.heartbeat?.commit ?? mine.registration?.commit}</Row>
            <Row label="Demos running">{demos.filter((d) => d.up).length} of {demos.length} · AI {mine.heartbeat?.ai_mode || '?'}</Row>
            {demos.some((d) => !d.up) && <Row label="Not running">{demos.filter((d) => !d.up).map((d) => d.id).join(', ')}</Row>}
          </>
        )}
      </Section>
    </>
  )
}

/** Booth-wide settings edited on the Booth-wide tab that differ (demo on/off lives on its own tab). */
function changedKeys(a: BoothSettings, b: BoothSettings): (keyof BoothSettings)[] {
  const keys: (keyof BoothSettings)[] = ['network_mode', 'text_scale', 'text_scale_tabbed', 'layout_override', 'launchpad_home_idle_s', 'screensaver_variant']
  const out = keys.filter((k) => a[k] !== b[k])
  if (DECK_IDS.some((d) => a.deck_idle_timeout_s[d] !== b.deck_idle_timeout_s[d])) out.push('deck_idle_timeout_s')
  return out
}

const LAYOUTS = [
  { v: 'auto' as const, label: 'Auto' },
  { v: 'stacked' as const, label: 'Stacked' },
  { v: 'tabbed' as const, label: 'Tabbed' },
]

function BoothTab({ staff }: { staff: Staff }) {
  const s = useBoothConfig()
  const [draft, setDraft] = useState<BoothSettings>(() => structuredClone(s.raw.global))
  const base = s.raw.global
  const dirty = changedKeys(draft, base).length > 0

  // Someone else changed the booth while this tab is clean: follow along.
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(s.raw.global))
  }, [s.raw.version]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview on this screen (only for values this station doesn't override).
  useEffect(() => {
    const own = s.raw.stations[s.station]?.overrides ?? {}
    const p: SettingsPatch = {}
    if (own.text_scale === undefined) p.text_scale = draft.text_scale
    if (own.text_scale_tabbed === undefined) p.text_scale_tabbed = draft.text_scale_tabbed
    if (own.layout_override === undefined) p.layout_override = draft.layout_override
    boothConfig.setPreview(p)
  }, [draft.text_scale, draft.text_scale_tabbed, draft.layout_override, s.raw, s.station])
  useEffect(() => () => boothConfig.setPreview(null), [])

  const set = <K extends keyof BoothSettings>(k: K, v: BoothSettings[K]) => setDraft((d) => ({ ...d, [k]: v }))
  // A network flip can move demos to another Temporal server (Auto: Cloud online, the hub offline): confirm first.
  const [restart, setRestart] = useState<TargetChange[] | null>(null)
  const apply = async (confirmed = false) => {
    const patch: Record<string, unknown> = {}
    for (const k of changedKeys(draft, base)) {
      if (k === 'deck_idle_timeout_s') {
        const d: Record<string, number> = {}
        for (const deck of DECK_IDS) if (draft.deck_idle_timeout_s[deck] !== base.deck_idle_timeout_s[deck]) d[deck] = draft.deck_idle_timeout_s[deck]
        patch[k] = d
      } else patch[k] = draft[k]
    }
    if (!Object.keys(patch).length) return
    const moves = confirmed ? [] : targetChanges(s.raw, withGlobal(s.raw, patch as SettingsPatch), staff.fleet)
    if (moves.length) return setRestart(moves)
    await staff.patchGlobal(patch as SettingsPatch)
  }

  return (
    <>
      <Section title="Network">
        <Row label="Mode" hint="Offline: AI demos restart in mock mode, online-only demos are greyed out on the Launchpad, and with Temporal on Auto the demos move from Temporal Cloud to the hub laptop's Temporal (Hub & Temporal tab)">
          <Seg value={draft.network_mode} options={[{ v: 'online', label: 'Online' }, { v: 'offline', label: 'Offline' }]} onChange={(v) => set('network_mode', v)} />
        </Row>
      </Section>
      <Section title="Screen">
        <Row label={`Text scale · booth TVs: ${draft.text_scale.toFixed(2)}`} hint="Stacked (portrait) screens">
          <input type="range" min={0.5} max={1.5} step={0.02} value={draft.text_scale} onChange={(e) => set('text_scale', Number(e.target.value))} className="w-[14em] accent-[#ffcc66] h-[2.4em]" />
        </Row>
        <Row label={`Text scale · laptops: ${draft.text_scale_tabbed.toFixed(2)}`} hint="Tabbed (landscape) screens">
          <input type="range" min={0.5} max={1.5} step={0.02} value={draft.text_scale_tabbed} onChange={(e) => set('text_scale_tabbed', Number(e.target.value))} className="w-[14em] accent-[#ffcc66] h-[2.4em]" />
        </Row>
        <Row label="Layout" hint="Auto picks stacked on tall portrait screens; ?layout= in a URL still wins">
          <Seg value={draft.layout_override} options={LAYOUTS} onChange={(v) => set('layout_override', v)} />
        </Row>
      </Section>
      <Section title="Idle timeouts (deck page back to home; the Holodeck never times out)">
        {TIMED_DECKS.map((deck) => (
          <Row key={deck} label={DECK_NAMES[deck]}>
            <Stepper value={draft.deck_idle_timeout_s[deck]} steps={DECK_STEPS} onChange={(v) => set('deck_idle_timeout_s', { ...draft.deck_idle_timeout_s, [deck]: v })} />
          </Row>
        ))}
      </Section>
      <Section title="Screensaver">
        <Row label="Starts after" hint="No touches on the Launchpad home">
          <Stepper value={draft.launchpad_home_idle_s} steps={HOME_STEPS} onChange={(v) => set('launchpad_home_idle_s', v)} />
        </Row>
        <Row label="Variant">
          <Seg value={draft.screensaver_variant} options={[{ v: 'alternate', label: 'Alternate' }, { v: 'slots', label: 'Slots' }, { v: 'classic', label: 'Classic' }]} onChange={(v) => set('screensaver_variant', v)} />
        </Row>
      </Section>
      <div className="sticky bottom-0 bg-lc-hull/95 py-[0.6em] flex flex-wrap gap-[0.6em] items-center">
        <Btn color="bg-lc-green" disabled={!dirty || staff.busy} onClick={() => void apply()}>Apply to all stations</Btn>
        <Btn color="bg-lc-panel-hi !text-lc-text" disabled={!dirty} onClick={() => setDraft(structuredClone(base))}>Discard</Btn>
        <span className="flex-1" />
        <ConfirmBtn color="bg-lc-rose" onConfirm={() => void staff.reset()}>Reset to defaults</ConfirmBtn>
      </div>
      {restart && (
        <RestartConfirm
          changes={restart}
          onCancel={() => setRestart(null)}
          onConfirm={() => {
            setRestart(null)
            void apply(true)
          }}
        />
      )}
    </>
  )
}

function StationPicker({ ids, value, onChange, fleet, all }: { ids: string[]; value: string; onChange: (v: string) => void; fleet: Fleet | null; all?: boolean }) {
  return (
    <div className="flex flex-wrap gap-[0.5em] mb-[0.8em]">
      {all && (
        <button type="button" onClick={() => onChange('all')} className={`lc-label font-bold rounded-full min-h-[2.6em] px-[1.1em] ${value === 'all' ? 'bg-lc-gold text-lc-void' : 'bg-lc-panel-hi text-lc-dim'}`}>
          All stations
        </button>
      )}
      {ids.map((id) => (
        <button key={id} type="button" onClick={() => onChange(id)} className={`lc-label font-bold rounded-full min-h-[2.6em] px-[1.1em] flex items-center gap-[0.5em] ${value === id ? 'bg-lc-gold text-lc-void' : 'bg-lc-panel-hi text-lc-dim'}`}>
          {fleet && <Dot ok={fleet.stations[id]?.online} warn={!!fleet.stations[id]?.duplicates.length} />}
          {id === 'laptop' ? 'Laptop' : `Station ${id}`}
        </button>
      ))}
    </div>
  )
}

function DemosTab({ staff }: { staff: Staff }) {
  const s = useBoothConfig()
  const [target, setTarget] = useState('all')
  const ids = stationIds(s.raw, staff.fleet)
  if (!staff.catalog.length) return <p className="text-lc-dim">Loading the demo list from the hub…</p>
  const eff = target === 'all' ? null : mergeEffective(s.raw, target)
  const own = target === 'all' ? {} : (s.raw.stations[target]?.overrides?.demo_enabled ?? {})
  return (
    <>
      <p className="text-lc-dim mb-[0.8em]">
        Off = hidden from the Launchpad on that station. When every card a demo process serves is off on a station, its agent stops that process; it starts again when one is back on.
      </p>
      <StationPicker ids={ids} value={target} onChange={setTarget} fleet={staff.fleet} all />
      {staff.catalog.map((deck) => (
        <Section key={deck.id} title={deck.name}>
          {deck.demos.map((d) => {
            const globalOn = s.raw.global.demo_enabled?.[d.id] !== false
            const on = eff ? eff.demo_enabled[d.id] !== false : globalOn
            const overridden = target !== 'all' && own[d.id] !== undefined
            return (
              <Row key={d.id} label={d.name} hint={`${d.id} · port ${d.port}${overridden ? ` · station override (booth-wide: ${globalOn ? 'on' : 'off'})` : ''}`}>
                {overridden && (
                  <Btn small color="bg-lc-panel-hi !text-lc-text" disabled={staff.busy} onClick={() => void staff.patchStation(target, { overrides: { demo_enabled: { [d.id]: null } } })}>
                    Use booth-wide
                  </Btn>
                )}
                <Toggle
                  on={on}
                  disabled={staff.busy}
                  onChange={(v) =>
                    void (target === 'all'
                      ? staff.patchGlobal({ demo_enabled: { [d.id]: v } })
                      : staff.patchStation(target, { overrides: { demo_enabled: { [d.id]: v } } }))
                  }
                />
              </Row>
            )
          })}
        </Section>
      ))}
    </>
  )
}

const TASK_COLOR: Record<Task['status'], string> = {
  pending: 'text-lc-gold',
  done: 'text-lc-green',
  failed: 'text-lc-red',
  expired: 'text-lc-rose',
}

function TaskList({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return <p className="text-lc-dim">No machine tasks yet.</p>
  return (
    <div className="flex flex-col">
      {tasks.slice(0, 12).map((t) => (
        <div key={t.id} className="flex flex-wrap gap-x-[0.7em] py-[0.3em] border-b border-lc-line/60 last:border-0">
          <span className={`lc-label font-bold min-w-[5em] ${TASK_COLOR[t.status]}`}>{t.status}</span>
          <span className="lc-label text-lc-text">
            {t.station === 'laptop' ? 'Laptop' : `St ${t.station}`} · {t.kind.replace('_', ' ')}
            {t.args.demo ? ` ${t.args.demo}` : ''}
            {t.kind === 'apply_config' ? ` (${t.args.network_mode}${t.args.disabled_demos?.length ? `, ${t.args.disabled_demos.length} off` : ''})` : ''}
          </span>
          <span className="text-lc-dim">{ago(t.finished_at ?? t.issued_at)}</span>
          {t.detail && <span className="text-lc-dim text-[0.85em] w-full truncate">{t.detail}</span>}
        </div>
      ))}
    </div>
  )
}

function FleetTab({ staff }: { staff: Staff }) {
  const s = useBoothConfig()
  const ids = stationIds(s.raw, staff.fleet)
  const [sid, setSid] = useState(() => s.station)
  const [editLabel, setEditLabel] = useState<string | null>(null)
  const f = staff.fleet?.stations[sid]
  const entry = s.raw.stations[sid]
  const eff = mergeEffective(s.raw, sid)
  const ownTimeouts = entry?.overrides?.deck_idle_timeout_s ?? {}
  const hb = f?.heartbeat
  const registered = !!f?.registration

  return (
    <>
      <StationPicker ids={ids} value={sid} onChange={setSid} fleet={staff.fleet} />
      {!!f?.duplicates.length && (
        <div className="lc-card !border-lc-red !rounded-2xl p-[0.8em] mb-[0.9em] text-lc-red lc-label font-bold">
          Two machines claim station {sid}: {f.duplicates.join(' and ')}. Give one a different STATION_ID (./start.sh --station N).
        </div>
      )}
      <Section title={`${eff.label} · machine`} right={<span className="flex items-center gap-2 text-lc-dim"><Dot ok={f?.online} />{f?.online ? 'online' : hb ? `last seen ${Math.round(hb.age_s)}s ago` : 'never seen'}</span>}>
        {hb || f?.registration ? (
          <>
            <Row label="Machine">{hb?.hostname ?? f?.registration?.hostname} · {hb?.ip || f?.registration?.ip}</Row>
            <Row label="Code version">{hb?.commit || f?.registration?.commit || '?'}</Row>
            <Row label="AI mode">{hb?.ai_mode || '?'}</Row>
            <Row label="Demos" hint="Restart one: tap twice">
              <div className="flex flex-wrap gap-[0.4em] max-w-[34em]">
                {(hb?.demos ?? []).map((d) => (
                  <ConfirmBtn key={d.id} small color={d.up ? 'bg-lc-panel-hi !text-lc-text' : 'bg-lc-red/70 !text-lc-text'} disabled={!registered || staff.busy} onConfirm={() => void staff.command('restart_demo', sid, d.id)}>
                    <Dot ok={d.up} /> {d.id}
                  </ConfirmBtn>
                ))}
              </div>
            </Row>
            <div className="flex flex-wrap gap-[0.6em] pt-[0.6em]">
              <ConfirmBtn disabled={!registered || staff.busy} color="bg-lc-orange" onConfirm={() => void staff.command('restart_demos', sid)}>Restart all demos</ConfirmBtn>
              <ConfirmBtn disabled={!registered || staff.busy} color="bg-lc-rose" onConfirm={() => void staff.command('restart_ship', sid)}>Restart whole ship</ConfirmBtn>
              <Btn color="bg-lc-sky" disabled={staff.busy} onClick={() => void staff.command('reload', sid)}>Reload its screen</Btn>
              {registered && !f?.online && <ConfirmBtn color="bg-lc-panel-hi !text-lc-text" onConfirm={() => void staff.forget(sid)}>Forget station</ConfirmBtn>}
            </div>
          </>
        ) : (
          <p className="text-lc-dim">No agent has registered as station {sid}. On that Mac mini run ./start.sh --station {sid}.</p>
        )}
      </Section>
      <Section title="Settings for this station">
        <Row label="Label">
          <span className="lc-label text-lc-text">{entry?.label ?? eff.label}</span>
          <Btn small color="bg-lc-lavender" onClick={() => setEditLabel(entry?.label ?? '')}>Edit</Btn>
        </Row>
        <Row label="Home deck" hint="The station starts here, and its idle timeout returns here">
          <div className="flex flex-wrap gap-[0.4em]">
            {([null, ...DECK_IDS] as (DeckId | null)[]).map((d) => (
              <button key={d ?? 'none'} type="button" disabled={staff.busy} onClick={() => void staff.patchStation(sid, { home_deck: d })}
                className={`lc-label font-bold rounded-full min-h-[2.4em] px-[0.9em] ${eff.home_deck === d ? 'bg-lc-gold text-lc-void' : 'bg-lc-panel-hi text-lc-dim'}`}>
                {d ? DECK_NAMES[d] : 'Launchpad'}
              </button>
            ))}
          </div>
        </Row>
        {TIMED_DECKS.map((deck) => {
          const own = ownTimeouts[deck]
          return (
            <Row key={deck} label={`${DECK_NAMES[deck]} timeout`} hint={own === undefined ? 'booth-wide' : 'station override'}>
              {own !== undefined && (
                <Btn small color="bg-lc-panel-hi !text-lc-text" disabled={staff.busy} onClick={() => void staff.patchStation(sid, { overrides: { deck_idle_timeout_s: { [deck]: null } } })}>Use booth-wide</Btn>
              )}
              <Stepper value={eff.deck_idle_timeout_s[deck]} steps={DECK_STEPS} dim={own === undefined} onChange={(v) => void staff.patchStation(sid, { overrides: { deck_idle_timeout_s: { [deck]: v } } })} />
            </Row>
          )
        })}
        <div className="pt-[0.6em]">
          <ConfirmBtn color="bg-lc-panel-hi !text-lc-text" disabled={staff.busy || !Object.keys(entry?.overrides ?? {}).length} onConfirm={() => void staff.patchStation(sid, { clear_overrides: true })}>
            Clear this station's overrides
          </ConfirmBtn>
        </div>
      </Section>
      <Section title="Recent tasks for this station">
        <TaskList tasks={(staff.fleet?.tasks ?? []).filter((t) => t.station === sid)} />
      </Section>
      {editLabel !== null && (
        <div className="fixed inset-0 z-[10] bg-lc-void/90 flex items-center justify-center p-[1em]">
          <div className="lc-card !rounded-2xl p-[1em] w-[min(96vw,60em)] flex flex-col gap-[0.8em]">
            <KeyboardField value={editLabel} placeholder="Station label" />
            <OnScreenKeyboard
              value={editLabel}
              onChange={setEditLabel}
              maxLength={40}
              doneLabel="Save"
              doneDisabled={!editLabel.trim()}
              onCancel={() => setEditLabel(null)}
              onDone={() => {
                void staff.patchStation(sid, { label: editLabel.trim() })
                setEditLabel(null)
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}

function ActionsTab({ staff }: { staff: Staff }) {
  const screen = (kind: CommandKind, label: string, color: string) => (
    <ConfirmBtn color={color} disabled={staff.busy} onConfirm={() => void staff.command(kind, 'all')}>{label}</ConfirmBtn>
  )
  return (
    <>
      <Section title="Every screen">
        <div className="flex flex-wrap gap-[0.6em]">
          {screen('home', 'Return all stations to Launchpad', 'bg-lc-blue')}
          {screen('reload', 'Reload all stations', 'bg-lc-sky')}
          {screen('screensaver', 'Start screensaver on all stations', 'bg-lc-lavender')}
        </div>
        <p className="text-lc-dim mt-[0.6em] text-[0.9em]">Screens act within about 2 seconds. A screen that's off ignores commands older than 2 minutes.</p>
      </Section>
      <Section title="Every machine">
        <div className="flex flex-wrap gap-[0.6em]">
          {screen('restart_demos', 'Restart all demos on all stations', 'bg-lc-orange')}
          {screen('restart_ship', 'Restart the whole ship on all stations', 'bg-lc-rose')}
        </div>
        <p className="text-lc-dim mt-[0.6em] text-[0.9em]">Runs on each station's own queue. A station that's asleep picks it up when it wakes (within 10 minutes, else it expires).</p>
      </Section>
      <Section title="Recent machine tasks">
        <TaskList tasks={staff.fleet?.tasks ?? []} />
      </Section>
    </>
  )
}

function LogTab({ staff }: { staff: Staff }) {
  const ids = Object.keys(staff.fleet?.stations ?? {})
  return (
    <>
      <Section title="Last 10 changes (from the BoothConfigWorkflow)">
        {!staff.audit.length && <p className="text-lc-dim">No changes yet.</p>}
        {staff.audit.map((a, i) => (
          <div key={i} className="py-[0.35em] border-b border-lc-line/60 last:border-0">
            <div className="flex flex-wrap gap-x-[0.7em]">
              <span className="lc-label text-lc-gold">{a.action}</span>
              <span className="text-lc-dim">{a.by} · {ago(a.at)}</span>
            </div>
            <div className="text-lc-text text-[0.9em]">{a.changes.join('; ')}</div>
          </div>
        ))}
      </Section>
      <Section title="Leads stored on each station">
        {!ids.length && <p className="text-lc-dim">No station agents reporting yet.</p>}
        {ids.map((id) => {
          const leads = staff.fleet?.stations[id]?.heartbeat?.leads ?? []
          return (
            <Row key={id} label={id === 'laptop' ? 'Laptop' : `Station ${id}`} hint={leads.length ? undefined : 'none yet'}>
              {leads.map((l) => (
                <span key={l.demo} className="lc-label bg-lc-panel-hi rounded-full px-[0.8em] py-[0.2em]">
                  {l.demo}: {l.total}{l.unsynced ? ` (${l.unsynced} unsynced)` : ''}
                </span>
              ))}
            </Row>
          )
        })}
        <p className="text-lc-dim text-[0.85em] mt-[0.5em]">Counts from each demo's local SQLite (docs/lead-capture.md). Syncing to the central lead store isn't built yet.</p>
      </Section>
    </>
  )
}

// ── the panel ──────────────────────────────────────────────────────────────

export function AdminPanel({
  token, onLock, onSignedOut, onExit, exitLabel = 'Exit',
}: {
  token: string
  /** Forget the PIN session and show the PIN pad again. */
  onLock: () => void
  onSignedOut: () => void
  /** Leave the config page (e.g. to the Launchpad home). No button when absent. */
  onExit?: () => void
  exitLabel?: string
}) {
  const s = useBoothConfig()
  const staff = useStaff(token, onSignedOut)
  const [tab, setTab] = useState<Tab>('station')
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-stretch gap-[4px] flex-shrink-0 min-h-[3.6em]">
        <div className="flex items-center gap-[0.6em] px-[1em] rounded-l-full bg-lc-orange text-lc-void">
          <img src={ZIGGY_PNG} alt="" width={128} height={128} draggable={false} className="w-[2.4em] h-[2.4em] rounded-full bg-lc-panel ring-2 ring-lc-void/70" />
          <span className="lc-label font-bold text-[1.3em] whitespace-nowrap">Booth Control</span>
        </div>
        <div className="flex-1 bg-lc-panel-hi flex items-center gap-[0.6em] px-[1em] min-w-0">
          <Dot ok={s.hubReachable} warn={s.hubReachable && !s.temporalOk} />
          <span className="lc-label text-lc-dim truncate">
            {s.config.label} · {s.hubReachable ? (s.temporalOk ? 'hub connected' : 'hub read-only') : 'hub unreachable'}
          </span>
        </div>
        <button type="button" onClick={onLock} className={`lc-label font-bold px-[1.4em] bg-lc-lavender text-lc-void text-[1.1em] ${onExit ? '' : 'rounded-r-full'}`}>
          Lock
        </button>
        {onExit && (
          <button type="button" onClick={onExit} className="lc-label font-bold px-[1.4em] rounded-r-full bg-lc-blue text-lc-void text-[1.1em]">
            {exitLabel}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-[4px] mt-[0.5em] flex-shrink-0">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`lc-label font-bold min-h-[2.8em] px-[1.1em] ${tab === t.id ? 'bg-lc-gold text-lc-void' : 'bg-lc-panel-hi text-lc-gold'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {staff.error && (
        <div className="mt-[0.5em] lc-card !border-lc-red !rounded-xl px-[1em] py-[0.5em] flex items-center gap-[0.8em] text-lc-red">
          <span className="flex-1">{staff.error}</span>
          <Btn small color="bg-lc-panel-hi !text-lc-text" onClick={staff.clearError}>OK</Btn>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto mt-[0.7em] pr-[0.3em]">
        {tab === 'station' && <StationTab staff={staff} />}
        {tab === 'booth' && <BoothTab staff={staff} />}
        {tab === 'demos' && <DemosTab staff={staff} />}
        {tab === 'fleet' && <FleetTab staff={staff} />}
        {tab === 'temporal' && <TemporalTab staff={staff} />}
        {tab === 'actions' && <ActionsTab staff={staff} />}
        {tab === 'log' && <LogTab staff={staff} />}
      </div>
    </div>
  )
}

/**
 * The staff config screen, a page of its own: the PIN pad, then the panel.
 * The PIN session lives only in this component's state, so Lock, Exit or
 * leaving the page forgets it. Nothing here times out. Broadcast screen
 * commands (home, reload, screensaver) are ignored while it's showing, so
 * staff aren't thrown out of the panel by their own "all stations" command.
 *
 * - The Launchpad's `/config` page: `onExit` goes to the Launchpad home.
 * - The Booth Control console (:5090): no `onExit`, just Lock.
 */
export function ConfigScreen({ onExit, exitLabel = 'Exit' }: { onExit?: () => void; exitLabel?: string }) {
  const [token, setToken] = useState<string | null>(null)
  useEffect(() => {
    boothConfig.refresh()
  }, [])
  useBoothCommands(() => {})

  return (
    <div
      className="fixed inset-0 bg-lc-void flex items-center justify-center text-lc-text overflow-hidden"
      style={{ fontSize: 'clamp(15px, 1.05vmax, 30px)' }}
      data-booth-admin
    >
      {token ? (
        <div className="w-full h-full max-w-[70em] p-[1em]">
          <AdminPanel token={token} onLock={() => setToken(null)} onSignedOut={() => setToken(null)} onExit={onExit} exitLabel={exitLabel} />
        </div>
      ) : (
        <PinPad onUnlocked={setToken} onCancel={onExit} cancelLabel={exitLabel} />
      )}
    </div>
  )
}
