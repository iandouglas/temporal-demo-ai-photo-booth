import { useState } from 'react'
import {
  mergeEffective,
  resolveTemporalTarget,
  stationNamespace,
  useBoothConfig,
  type BoothConfigPayload,
  type OverridesPatch,
  type ResolvedTemporalTarget,
  type SettingsPatch,
  type TemporalTarget,
} from '../lib/boothConfig'
import { Btn, Dot, Row, Section, Seg, ago, stationIds, type Fleet, type Staff } from './AdminPanel'
import { KeyboardField, OnScreenKeyboard } from './OnScreenKeyboard'

/*
 * The admin panel's "Hub & Temporal" tab: which Temporal server the demos use
 * (booth-wide and per station), the hub address every station uses, and a
 * connectivity check per station: the hub's Temporal on 7233, Temporal Cloud
 * (its last check), and the station's own local Temporal, which always runs so
 * a switch to offline is instant. Booth Control itself always runs on the hub's Temporal.
 */

/** What a station agent reports about Temporal in its heartbeat (no secrets). */
export interface HeartbeatTemporal {
  target: string
  address: string
  namespace: string
  ui_url: string
  hub_address: string
  hub_api_ok: boolean | null
  hub_temporal_ok: boolean | null
  hub_temporal_ms: number | null
  target_ok: boolean | null
  target_ms: number | null
  cloud_configured: boolean
  /** What staff asked for (auto | local | hub | cloud) */
  requested?: string
  /** This machine is the hub laptop (its fallback is its own Temporal) */
  is_hub?: boolean | null
  /** The station's last Temporal Cloud check (DescribeNamespace with its key); null = never / no settings */
  cloud_ok?: boolean | null
  cloud_detail?: string
  cloud_checked_at?: number
  /** This machine's own Temporal dev server (always running) */
  local_ok?: boolean | null
  local_ms?: number | null
  local_restarts?: number
  local_last_restart?: string
  /** Who restarts it if it dies: ship.sh's foreground loop, or the station agent */
  local_watchdog?: string
  checked_at: number
}

export const TARGET_LABEL: Record<ResolvedTemporalTarget, string> = {
  local: 'Each mini',
  hub: 'Hub laptop',
  cloud: 'Temporal Cloud',
}

const TARGETS: { v: TemporalTarget; label: string }[] = [
  { v: 'auto', label: 'Auto' },
  { v: 'local', label: TARGET_LABEL.local },
  { v: 'hub', label: TARGET_LABEL.hub },
  { v: 'cloud', label: 'Cloud' },
]

function stationName(id: string) {
  return id === 'laptop' ? 'Laptop' : `Station ${id}`
}

/** Where a station's demos would run: Auto/Cloud depend on its own Cloud check (from its heartbeat). */
function resolved(raw: BoothConfigPayload, sid: string, fleet: Fleet | null): ResolvedTemporalTarget {
  const e = mergeEffective(raw, sid)
  const t = fleet?.stations[sid]?.heartbeat?.temporal as HeartbeatTemporal | undefined
  return resolveTemporalTarget(e.temporal_target, e.network_mode, {
    cloudOk: t?.cloud_ok === true,
    isHub: t?.is_hub ?? sid === 'laptop',
  })
}

export interface TargetChange {
  station: string
  from: ResolvedTemporalTarget
  to: ResolvedTemporalTarget
}

/** Registered stations whose demos would move to another Temporal server if `next` replaced `raw`. */
export function targetChanges(raw: BoothConfigPayload, next: BoothConfigPayload, fleet: Fleet | null): TargetChange[] {
  const ids = Object.entries(fleet?.stations ?? {})
    .filter(([, f]) => f.registration)
    .map(([id]) => id)
  return ids
    .map((station) => ({ station, from: resolved(raw, station, fleet), to: resolved(next, station, fleet) }))
    .filter((c) => c.from !== c.to)
}

/** `raw` with a booth-wide patch applied (for targetChanges). */
export function withGlobal(raw: BoothConfigPayload, patch: SettingsPatch): BoothConfigPayload {
  return { ...raw, global: { ...raw.global, ...(patch as Partial<BoothConfigPayload['global']>) } }
}

/** `raw` with one station's overrides patched (null removes an override). */
function withOverride(raw: BoothConfigPayload, sid: string, patch: OverridesPatch): BoothConfigPayload {
  const st = raw.stations[sid] ?? { label: stationName(sid), home_deck: null, overrides: {} }
  const overrides: Record<string, unknown> = { ...st.overrides }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete overrides[k]
    else overrides[k] = v
  }
  return { ...raw, stations: { ...raw.stations, [sid]: { ...st, overrides } } }
}

/** "Demos on N stations will restart and in-flight runs are dropped." */
export function RestartConfirm({ changes, onConfirm, onCancel }: { changes: TargetChange[]; onConfirm: () => void; onCancel: () => void }) {
  const n = changes.length
  return (
    <div className="fixed inset-0 z-[10] bg-lc-void/90 flex items-center justify-center p-[1em]">
      <div className="lc-card !border-lc-gold !rounded-2xl p-[1.2em] w-[min(94vw,34em)] flex flex-col gap-[0.8em]">
        <div className="lc-label font-bold text-lc-gold text-[1.3em]">
          Demos on {n} station{n === 1 ? '' : 's'} will restart and in-flight runs are dropped
        </div>
        <div className="text-lc-text">
          {changes.map((c) => (
            <div key={c.station}>
              {stationName(c.station)}: {TARGET_LABEL[c.from]} → {TARGET_LABEL[c.to]}
            </div>
          ))}
        </div>
        <p className="text-lc-dim text-[0.9em]">
          Workflows still running on the old Temporal server are left behind. The demos come back in about 30 seconds.
        </p>
        <div className="flex flex-wrap gap-[0.6em]">
          <Btn color="bg-lc-red" onClick={onConfirm}>Restart them</Btn>
          <Btn color="bg-lc-panel-hi !text-lc-text" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  )
}

function ms(v: number | null | undefined) {
  return v == null ? '' : ` · ${Math.round(v)} ms`
}

// Loose check before the hub does the real one: an IPv4 address or a host name, optional :port.
const HUB_RE = /^[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9]([a-z0-9-]{0,62}))*(:\d{1,5})?$/i

export function TemporalTab({ staff }: { staff: Staff }) {
  const s = useBoothConfig()
  const raw = s.raw
  const ids = stationIds(raw, staff.fleet)
  const [draft, setDraft] = useState<TemporalTarget>(raw.global.temporal_target ?? 'auto')
  const [confirm, setConfirm] = useState<{ changes: TargetChange[]; run: () => void } | null>(null)
  const [editHub, setEditHub] = useState<string | null>(null)
  const [hubConfirm, setHubConfirm] = useState<string | null>(null)
  const booth = raw.global.temporal_target ?? 'auto'
  const offline = raw.global.network_mode === 'offline'

  /** Run `write` now, or after the restart confirm if any station's demos would move. */
  const guarded = (next: BoothConfigPayload, write: () => void) => {
    const changes = targetChanges(raw, next, staff.fleet)
    if (changes.length) setConfirm({ changes, run: write })
    else write()
  }

  const applyBooth = () =>
    guarded(withGlobal(raw, { temporal_target: draft }), () => void staff.patchGlobal({ temporal_target: draft }))

  const setStation = (sid: string, v: TemporalTarget | null) =>
    guarded(withOverride(raw, sid, { temporal_target: v }), () =>
      void staff.patchStation(sid, { overrides: { temporal_target: v } }),
    )

  let screenHubHost = ''
  try {
    screenHubHost = new URL(s.hubUrl).host.replace(/:8090$/, '')
  } catch {
    /* ignore */
  }
  const screenIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(screenHubHost)

  return (
    <>
      <Section title="Temporal server for the demos">
        <p className="text-lc-dim mb-[0.5em]">
          Separate from Online/Offline. Auto (the default) uses Temporal Cloud on every station whose Cloud check passes (its
          .ship/temporal-cloud.env and a DescribeNamespace with its key), and falls back to the hub laptop's Temporal when offline
          or when the check fails (the laptop itself falls back to its own). Every machine keeps its own Temporal running, so the
          fallback is instant. On the hub, each station gets its own namespace (station-1, station-2, …). Booth Control always
          uses the hub laptop's Temporal. Triage Queue and Beam Aboard always use their own private servers on each mini.
        </p>
        <Row
          label="Booth-wide"
          hint={`Auto: Temporal Cloud where a station's Cloud check passes, else the hub laptop (always the hub while offline${offline ? ', which it is now' : ''}). Cloud: the same, but a failed check shows as a failed task. Each mini: its own server.`}
        >
          <Seg value={draft} options={TARGETS} onChange={setDraft} />
          <Btn color="bg-lc-green" disabled={draft === booth || staff.busy} onClick={applyBooth}>
            Apply to all stations
          </Btn>
        </Row>
      </Section>

      <Section title="Per station">
        {ids.map((sid) => {
          const own = raw.stations[sid]?.overrides?.temporal_target
          const want = resolved(raw, sid, staff.fleet)
          const t = staff.fleet?.stations[sid]?.heartbeat?.temporal
          const registered = !!staff.fleet?.stations[sid]?.registration
          const mismatch = t && t.target !== want
          const cloudFail = t?.cloud_ok === false && t.cloud_detail ? ` · Cloud check failed: ${t.cloud_detail}` : ''
          return (
            <Row
              key={sid}
              label={stationName(sid)}
              hint={
                t
                  ? `Running on ${TARGET_LABEL[t.target as ResolvedTemporalTarget] ?? t.target}${t.namespace ? ` · ${t.namespace}` : ''}${mismatch ? ` · should be ${TARGET_LABEL[want]} (see its tasks)` : ''}${cloudFail}`
                  : registered
                    ? `Wants ${TARGET_LABEL[want]} · no recent heartbeat`
                    : `Wants ${TARGET_LABEL[want]} · not registered`
              }
            >
              {t && <Dot ok={t.target_ok ?? undefined} warn={!!mismatch || !!cloudFail} />}
              <Seg
                value={(own ?? 'inherit') as TemporalTarget | 'inherit'}
                options={[{ v: 'inherit' as const, label: 'Booth-wide' }, ...TARGETS]}
                onChange={(v) => setStation(sid, v === 'inherit' ? null : v)}
              />
            </Row>
          )
        })}
      </Section>

      <Section title="Hub address (how every station reaches this laptop)">
        <Row
          label={raw.hub_address ? raw.hub_address : 'As each station was set up'}
          hint="The laptop's reserved IP (e.g. 192.168.1.10) or its .local name. A station moves only once the new address answers from there."
        >
          {!screenIsLocal && screenHubHost && screenHubHost !== raw.hub_address && (
            <Btn small color="bg-lc-sky" disabled={staff.busy} onClick={() => setHubConfirm(screenHubHost)}>
              Use {screenHubHost}
            </Btn>
          )}
          <Btn small color="bg-lc-lavender" disabled={staff.busy} onClick={() => setEditHub(raw.hub_address ?? '')}>
            Change
          </Btn>
        </Row>
        <p className="text-lc-dim text-[0.85em] mt-[0.4em]">
          A station that can't reach the hub at all can't receive this. On that Mac mini run{' '}
          <span className="text-lc-text">./start.sh --hub &lt;address&gt;</span> once.
        </p>
      </Section>

      <Section title="Connectivity (from each station's last heartbeat, every 10 s)">
        {!ids.length && <p className="text-lc-dim">No stations yet.</p>}
        {ids.map((sid) => {
          const f = staff.fleet?.stations[sid]
          const t = f?.heartbeat?.temporal
          return (
            <Row
              key={sid}
              label={stationName(sid)}
              hint={
                t?.checked_at
                  ? `checked ${ago(new Date(t.checked_at * 1000).toISOString())}` +
                    (t.cloud_ok === false && t.cloud_detail ? ` · Cloud: ${t.cloud_detail}` : '') +
                    (t.local_restarts && t.local_last_restart ? ` · local Temporal last restarted ${t.local_last_restart}` : '') +
                    (t.local_watchdog ? ` · watchdog: ${t.local_watchdog === 'ship' ? 'ship.sh' : 'station agent'}` : '')
                  : 'no heartbeat yet'
              }
            >
              <span className="flex items-center gap-[0.4em] lc-label">
                <Dot ok={f ? f.online : undefined} /> Hub API
              </span>
              <span className="flex items-center gap-[0.4em] lc-label">
                <Dot ok={t?.hub_temporal_ok ?? undefined} /> Hub Temporal :7233{ms(t?.hub_temporal_ms)}
              </span>
              {t && t.target === 'cloud' && (
                <span className="flex items-center gap-[0.4em] lc-label">
                  <Dot ok={t.target_ok ?? undefined} /> {TARGET_LABEL.cloud}
                  {ms(t.target_ms)}
                </span>
              )}
              {t && t.target !== 'cloud' && t.cloud_ok != null && (
                <span className="flex items-center gap-[0.4em] lc-label" title={t.cloud_detail}>
                  <Dot ok={t.cloud_ok} /> Cloud check {t.cloud_ok ? 'ok' : 'failed'}
                </span>
              )}
              {t && t.local_ok != null && (
                <span className="flex items-center gap-[0.4em] lc-label">
                  <Dot ok={t.local_ok} /> Local Temporal{t.local_ok ? ms(t.local_ms) : ' down'}
                  {t.local_restarts ? ` · restarted ${t.local_restarts}×` : ''}
                </span>
              )}
            </Row>
          )
        })}
        <p className="text-lc-dim text-[0.85em] mt-[0.4em]">
          Hub namespaces: {ids.filter((i) => i !== 'laptop').map(stationNamespace).join(', ')} (UI on the hub at :8233).
        </p>
      </Section>

      {confirm && (
        <RestartConfirm
          changes={confirm.changes}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run()
            setConfirm(null)
          }}
        />
      )}

      {editHub !== null && (
        <div className="fixed inset-0 z-[10] bg-lc-void/90 flex items-center justify-center p-[1em]">
          <div className="lc-card !rounded-2xl p-[1em] w-[min(96vw,60em)] flex flex-col gap-[0.8em]">
            <KeyboardField value={editHub} placeholder="192.168.1.10 or my-laptop.local" />
            <OnScreenKeyboard
              value={editHub}
              onChange={(v) => setEditHub(v.toLowerCase())}
              mode="email"
              maxLength={80}
              doneLabel="Next"
              doneDisabled={!!editHub && !HUB_RE.test(editHub.trim())}
              onCancel={() => setEditHub(null)}
              onDone={() => {
                setHubConfirm(editHub.trim())
                setEditHub(null)
              }}
            />
          </div>
        </div>
      )}

      {hubConfirm !== null && (
        <div className="fixed inset-0 z-[10] bg-lc-void/90 flex items-center justify-center p-[1em]">
          <div className="lc-card !border-lc-gold !rounded-2xl p-[1.2em] w-[min(94vw,34em)] flex flex-col gap-[0.8em]">
            <div className="lc-label font-bold text-lc-gold text-[1.3em]">
              {hubConfirm ? `Move every station to ${hubConfirm}?` : 'Clear the booth-wide hub address?'}
            </div>
            <p className="text-lc-text">
              {hubConfirm
                ? 'Each station checks the new address answers (API :8090 and Temporal :7233), saves it and reconnects. Stations that can\'t reach it keep the old one, and the task shows as failed. Demos on the hub\'s Temporal restart; screens follow once the address answers.'
                : 'Stations keep whatever address they have now.'}
            </p>
            <div className="flex flex-wrap gap-[0.6em]">
              <Btn
                color="bg-lc-red"
                disabled={staff.busy}
                onClick={() => {
                  void staff.setHub(hubConfirm)
                  setHubConfirm(null)
                }}
              >
                {hubConfirm ? 'Move them' : 'Clear it'}
              </Btn>
              <Btn color="bg-lc-panel-hi !text-lc-text" onClick={() => setHubConfirm(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** One line for the "This station" tab: which Temporal server this station's demos use. */
export function StationTemporalRow({ staff }: { staff: Staff }) {
  const s = useBoothConfig()
  const t = staff.fleet?.stations[s.station]?.heartbeat?.temporal
  const want = resolveTemporalTarget(s.config.temporal_target, s.config.network_mode, {
    cloudOk: t?.cloud_ok === true,
    isHub: t?.is_hub ?? s.station === 'laptop',
  })
  return (
    <Row
      label="Demos' Temporal"
      hint={
        t
          ? `${t.address} · namespace ${t.namespace}${t.cloud_ok === false && t.cloud_detail ? ` · Cloud check failed: ${t.cloud_detail}` : ''} · local Temporal ${t.local_ok === false ? 'DOWN' : 'up'}`
          : undefined
      }
    >
      {t && <Dot ok={t.target_ok ?? undefined} warn={t.target !== want} />}
      {TARGET_LABEL[(t?.target as ResolvedTemporalTarget) ?? want] ?? t?.target}
      {t && t.target !== want ? ` (switching to ${TARGET_LABEL[want]})` : ''}
    </Row>
  )
}
