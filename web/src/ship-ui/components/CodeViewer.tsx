import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PanelHeader, type LcColor } from './PanelHeader'
import { SDK_LOGOS } from './SdkLogos'
import {
  focusStep,
  lineStatus,
  tokenize,
  type CodeFile,
  type CodeLanguage,
  type CodeStepStatus,
  type SdkId,
  type Tok,
  type TokKind,
} from '../lib/code'

const ROW: Record<CodeStepStatus, string> = {
  running: 'bg-lc-sky/15 border-lc-sky',
  retrying: 'bg-lc-gold/20 border-lc-gold shipui-code-pulse',
  interrupted: 'bg-lc-red/15 border-lc-red shipui-code-pulse',
  failed: 'bg-lc-red/15 border-lc-red',
  completed: 'bg-lc-green/[0.06] border-lc-green/50',
}

const TOK_COLOR: Record<Exclude<TokKind, 'plain'>, CSSProperties> = {
  kw: { color: '#cc99ff' },
  str: { color: '#66dd99' },
  num: { color: '#ffbb88' },
  com: { color: '#6f6690', fontStyle: 'italic' },
  ann: { color: '#ffcc66' },
  type: { color: '#66ccff' },
  fn: { color: '#88aaff' },
}

const DEFAULT_STATUS_TEXT: Record<CodeStepStatus, string> = {
  running: 'running',
  retrying: 'retrying',
  interrupted: 'worker lost, Temporal will retry',
  failed: 'failed',
  completed: 'done',
}

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
const PULSE_CSS =
  '@keyframes shipui-code-pulse{0%,100%{opacity:1}50%{opacity:.55}}.shipui-code-pulse{animation:shipui-code-pulse 1.1s ease-in-out infinite}'

export interface CodeViewerProps {
  /** From `defineCodeLanguages(...)` */
  languages: CodeLanguage[]
  lang: SdkId
  onLang: (id: SdkId) => void
  /** Step name -> status ("running", "retrying", "interrupted", "failed", "completed"; others ignored) */
  steps: Record<string, string | null | undefined>
  /** Logo tabs under the header, or a dropdown in the header */
  picker?: 'tabs' | 'dropdown'
  title?: string
  subtitle?: ReactNode
  color?: LcColor
  /** Steps in workflow order; the highlight follows the latest active one */
  stepOrder?: string[]
  /** Step that marks the run finished (focused once nothing else is active) */
  doneStep?: string
  /** Friendly names for the "Now" strip */
  stepLabels?: Record<string, string>
  statusText?: Partial<Record<CodeStepStatus, string>>
  /** Shown in the "Now" strip before anything runs */
  idleText?: string
  /** Hide the "Now" strip and legend */
  hideNow?: boolean
  /** CSS font-size for the code, e.g. "0.8rem" or "clamp(13px, 2cqi, 34px)" (the viewer is a size container) */
  codeSize?: string
  /** Rendered under the code, e.g. a RetryMeter */
  footer?: ReactNode
  className?: string
}

/**
 * The 8-language code viewer: real marked-up source in every Temporal SDK, with
 * the lines for the running step highlighted (sky = running, gold = retrying,
 * red = worker lost / failed, green = done). Switching languages is
 * display-only; the highlight moves to the same step in the new language.
 */
export function CodeViewer({
  languages,
  lang,
  onLang,
  steps,
  picker = 'tabs',
  title = 'The code, in all 8 Temporal SDKs',
  subtitle,
  color = 'blue',
  stepOrder = [],
  doneStep,
  stepLabels = {},
  statusText,
  idleText = 'Start a run to light up the code',
  hideNow = false,
  codeSize = '0.8rem',
  footer,
  className = '',
}: CodeViewerProps) {
  const language = languages.find((l) => l.id === lang) ?? languages[0]
  const focus = focusStep(steps, stepOrder, doneStep)
  const scroller = useRef<HTMLDivElement>(null)
  const words = { ...DEFAULT_STATUS_TEXT, ...statusText }

  // Follow the running step: when it (or the language) changes, bring its first line into view.
  // Re-follow when the panel is resized (orientation change, window resize).
  useEffect(() => {
    const box = scroller.current
    if (!box || !focus) return
    const follow = (behavior: ScrollBehavior) => {
      const el = box.querySelector<HTMLElement>(`[data-steps~="${focus}"]`)
      if (!el) return
      const top = el.offsetTop - box.clientHeight * 0.3
      box.scrollTo({ top: Math.max(0, top), behavior })
    }
    follow('smooth')
    let h = box.clientHeight
    const ro = new ResizeObserver(() => {
      if (box.clientHeight !== h) {
        h = box.clientHeight
        follow('auto')
      }
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [focus, language?.id])

  if (!language) return null
  const focusStatus = (focus ? steps[focus] : null) as CodeStepStatus | null
  const nowColor =
    focusStatus === 'retrying'
      ? 'text-lc-gold'
      : focusStatus === 'interrupted' || focusStatus === 'failed'
        ? 'text-lc-red'
        : focus && focus === doneStep
          ? 'text-lc-green'
          : 'text-lc-sky'

  return (
    <div className={`lc-card @container flex flex-col min-h-0 h-full overflow-hidden ${className}`} data-testid="code-viewer">
      <style>{PULSE_CSS}</style>
      <PanelHeader
        title={title}
        subtitle={subtitle}
        color={color}
        action={picker === 'dropdown' ? <LanguageDropdown languages={languages} lang={language.id} onLang={onLang} /> : undefined}
      />
      {picker === 'tabs' && <LanguageTabs languages={languages} lang={language.id} onLang={onLang} />}
      {!hideNow && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-lc-line min-h-[3rem]">
          <span className="lc-label text-sm text-lc-dim">Now</span>
          {focus && focusStatus ? (
            <span className={`lc-label text-base font-bold ${nowColor}`} data-testid="code-focus">
              {stepLabels[focus] ?? focus} · {words[focusStatus] ?? focusStatus}
            </span>
          ) : (
            <span className="lc-label text-base text-lc-faint">{idleText}</span>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs lc-label text-lc-dim">
            <Legend cls="bg-lc-sky" label="running" />
            <Legend cls="bg-lc-gold" label="retrying" />
            <Legend cls="bg-lc-green/70" label="done" />
          </span>
        </div>
      )}
      <div
        ref={scroller}
        className="flex-1 min-h-0 overflow-auto relative"
        style={{ fontSize: codeSize }}
        data-testid="code-scroll"
        data-lang={language.id}
      >
        {language.files.map((f) => (
          <FileView key={`${language.id}:${f.name}`} file={f} language={language} steps={steps} />
        ))}
      </div>
      {footer}
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${cls}`} />
      {label}
    </span>
  )
}

interface PickerProps {
  languages: CodeLanguage[]
  lang: SdkId
  onLang: (id: SdkId) => void
}

/** A row of logo tabs, one per language. */
export function LanguageTabs({ languages, lang, onLang }: PickerProps) {
  return (
    <div className="flex gap-1.5 px-3 py-2 border-b border-lc-line" role="tablist" aria-label="SDK language">
      {languages.map((l) => {
        const Logo = SDK_LOGOS[l.id]
        const on = l.id === lang
        return (
          <button
            key={l.id}
            role="tab"
            aria-selected={on}
            data-lang={l.id}
            onClick={() => onLang(l.id)}
            className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 rounded-xl border-2 min-h-[4.25rem] py-1.5 transition-colors ${
              on ? 'border-lc-gold bg-lc-gold/15 shadow-[0_0_18px_#ffcc6644]' : 'border-lc-line bg-lc-panel-hi active:bg-lc-line'
            }`}
          >
            <span className="w-8 h-8 block">
              <Logo />
            </span>
            <span className={`lc-label text-xs font-bold leading-none ${on ? 'text-lc-gold' : 'text-lc-dim'}`}>{l.label}</span>
            {l.runs && <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-lc-green" title="Running at the booth" />}
            {l.preview && (
              <span className="absolute top-0.5 right-1 lc-label text-[0.55rem] text-lc-lavender" title="Public Preview SDK">
                preview
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** A touch-sized dropdown: the current language's logo and name; tap to pick another. */
export function LanguageDropdown({ languages, lang, onLang }: PickerProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = languages.find((l) => l.id === lang) ?? languages[0]

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!current) return null
  const Logo = SDK_LOGOS[current.id]
  return (
    <div ref={box} className="relative flex-shrink-0" data-testid="lang-dropdown">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`SDK language: ${current.label}`}
        data-lang={current.id}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-3 min-h-[3.25rem] pl-3 pr-4 rounded-full border-2 transition-colors ${
          open ? 'border-lc-gold bg-lc-gold/15' : 'border-lc-blue/70 bg-lc-panel-hi active:bg-lc-line'
        }`}
      >
        <span className="w-9 h-9 block flex-shrink-0">
          <Logo />
        </span>
        <span className="lc-label text-xl font-bold text-lc-gold whitespace-nowrap">{current.label}</span>
        {current.preview && <span className="lc-label text-xs text-lc-lavender">preview</span>}
        <span className={`lc-label text-sm whitespace-nowrap ${current.runs ? 'text-lc-green' : 'text-lc-dim'}`}>
          {current.runs ? '● running' : 'display only'}
        </span>
        <span className={`text-lc-gold text-lg transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="SDK language"
          className="absolute right-0 top-full mt-2 z-40 w-max min-w-full lc-card border-lc-gold/60 p-2 grid gap-1.5 shadow-[0_12px_40px_#000c,0_0_24px_#ffcc6633]"
        >
          {languages.map((l) => {
            const L = SDK_LOGOS[l.id]
            const on = l.id === current.id
            return (
              <li key={l.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-lang={l.id}
                  onClick={() => {
                    onLang(l.id)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-3 min-h-[3.25rem] px-3 rounded-xl border-2 text-left transition-colors ${
                    on ? 'border-lc-gold bg-lc-gold/15' : 'border-transparent bg-lc-panel-hi active:bg-lc-line'
                  }`}
                >
                  <span className="w-9 h-9 block flex-shrink-0">
                    <L />
                  </span>
                  <span className={`lc-label text-xl font-bold flex-1 ${on ? 'text-lc-gold' : 'text-lc-text'}`}>{l.label}</span>
                  {l.preview && <span className="lc-label text-xs text-lc-lavender">preview</span>}
                  {l.runs && <span className="lc-label text-xs text-lc-green">● running</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function tokenizeFile(file: CodeFile, language: CodeLanguage): Tok[][] {
  const out: Tok[][] = []
  let inDoc = false
  for (const l of file.lines) {
    const [toks, next] = tokenize(l.text, language.syntax, inDoc)
    inDoc = next
    out.push(toks)
  }
  return out
}

function FileView({ file, language, steps }: { file: CodeFile; language: CodeLanguage; steps: Record<string, string | null | undefined> }) {
  const rendered = useMemo(() => tokenizeFile(file, language), [file, language])

  return (
    <div className="pb-2">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 px-4 py-[0.3em] bg-lc-panel border-b border-lc-line text-[0.8em]">
        <span className="text-lc-text" style={{ fontFamily: MONO }}>
          {file.name}
        </span>
        <span className="lc-label text-lc-lavender ml-auto">
          {language.label} · {language.sdk}
          {language.preview ? ' · Public Preview' : ''}
          {language.runs ? ' · running now' : ' · display only'}
        </span>
      </div>
      <div className="leading-[1.55] py-1" style={{ fontFamily: MONO, tabSize: 4 }}>
        {file.lines.map((l, i) => {
          const st = l.steps.length ? lineStatus(l.steps, steps) : null
          return (
            <div
              key={i}
              data-steps={l.steps.join(' ') || undefined}
              data-status={st ?? undefined}
              className={`flex whitespace-pre border-l-[0.3em] pr-4 transition-colors duration-300 ${st ? ROW[st] : 'border-transparent'}`}
            >
              <span className="select-none text-lc-faint w-[3em] shrink-0 text-right pr-[0.9em]">{l.n}</span>
              <span className="text-lc-text/90">
                {rendered[i].map((t, j) =>
                  t.k === 'plain' ? <span key={j}>{t.t}</span> : <span key={j} style={TOK_COLOR[t.k]}>{t.t}</span>,
                )}
                {l.text === '' ? ' ' : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
