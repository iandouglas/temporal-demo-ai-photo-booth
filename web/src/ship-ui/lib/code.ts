// The 8-language code viewer's model: SDK metadata, source parsing, and a tiny
// syntax tokenizer. Each demo supplies real source files (imported with Vite's
// `?raw`) marked with step comments:
//   // @step fetch        (or  # @step fetch; several steps: @step fetch load)
//   ...lines for that step...
//   // @end
// Markers are stripped for display. The lines between them light up when the
// demo reports that step running, retrying or done.

/** The 8 Temporal SDKs, in the order every picker shows them. */
export type SdkId = 'java' | 'dotnet' | 'typescript' | 'go' | 'python' | 'rust' | 'ruby' | 'php'

export const SDK_ORDER: SdkId[] = ['java', 'dotnet', 'typescript', 'go', 'python', 'rust', 'ruby', 'php']

export interface Syntax {
  comment: '//' | '#'
  keywords: Set<string>
  /** Python-style """docstrings""" spanning lines */
  tripleQuotes?: boolean
}

export interface SdkInfo {
  label: string
  sdk: string
  /** Public Preview SDK (shows a "preview" badge) */
  preview?: boolean
  syntax: Syntax
}

const kw = (s: string) => new Set(s.split(/\s+/).filter(Boolean))
const C_LIKE = 'if else for while return new public private static final class interface var let const function async await import package using namespace try catch throw'

export const SDK_INFO: Record<SdkId, SdkInfo> = {
  java: { label: 'Java', sdk: 'io.temporal:temporal-sdk', syntax: { comment: '//', keywords: kw(`${C_LIKE} implements extends void int boolean this null true false`) } },
  dotnet: { label: '.NET', sdk: 'Temporalio (C#)', syntax: { comment: '//', keywords: kw(`${C_LIKE} readonly foreach in is int null true false`) } },
  typescript: { label: 'TypeScript', sdk: '@temporalio/workflow', syntax: { comment: '//', keywords: kw(`${C_LIKE} export type from of as`) } },
  go: { label: 'Go', sdk: 'go.temporal.io/sdk', syntax: { comment: '//', keywords: kw('package import func var return if else for range err nil type struct make append len defer go') } },
  python: {
    label: 'Python', sdk: 'temporalio',
    syntax: { comment: '#', tripleQuotes: true, keywords: kw('from import with as class def async await return for in if else try except lambda self None True False') },
  },
  rust: { label: 'Rust', sdk: 'temporalio-sdk', preview: true, syntax: { comment: '//', keywords: kw('use pub fn struct impl let mut for in if else match async await return move Self self crate Ok Err Some None') } },
  ruby: { label: 'Ruby', sdk: 'temporalio (gem)', syntax: { comment: '#', keywords: kw('require require_relative module class def end do if else unless each map begin rescue ensure raise return true false nil self') } },
  php: { label: 'PHP', sdk: 'temporal/sdk', syntax: { comment: '//', keywords: kw('namespace use function fn return class public private new foreach as for if else try catch yield declare implements array null true false') } },
}

export interface CodeLine {
  text: string
  /** Steps this line belongs to (from the enclosing @step markers) */
  steps: string[]
  /** 1-based line number in the displayed file */
  n: number
}

export interface CodeFile {
  name: string
  lines: CodeLine[]
}

/** One language as the viewer shows it. */
export interface CodeLanguage extends SdkInfo {
  id: SdkId
  files: CodeFile[]
  /** This language is the one actually running at the booth */
  runs?: boolean
}

/** A raw, marked-up source file. */
export interface SourceFile {
  name: string
  source: string
}

const MARK = /^\s*(?:\/\/|#)\s*@(step|end)\b\s*([\w ]*)$/

/** Strip step markers and tag each remaining line with the steps it belongs to. */
export function parseSource(name: string, source: string): CodeFile {
  const stack: string[][] = []
  const lines: CodeLine[] = []
  const raw = source.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  for (const text of raw) {
    const m = MARK.exec(text)
    if (m) {
      if (m[1] === 'step') stack.push(m[2].trim().split(/\s+/).filter(Boolean))
      else stack.pop()
      continue
    }
    lines.push({ text, steps: stack.flat(), n: lines.length + 1 })
  }
  // A marker pair that wraps blank lines (gofmt) would leave a double blank; collapse.
  return {
    name,
    lines: lines
      .filter((l, i) => !(l.text.trim() === '' && lines[i - 1]?.text.trim() === ''))
      .map((l, i) => ({ ...l, n: i + 1 })),
  }
}

/**
 * Build the viewer's languages from raw sources, in SDK_ORDER.
 * `runs` names the language the demo's worker really runs.
 */
export function defineCodeLanguages(
  sources: Partial<Record<SdkId, SourceFile[]>>,
  opts: { runs?: SdkId; overrides?: Partial<Record<SdkId, Partial<SdkInfo>>> } = {},
): CodeLanguage[] {
  return SDK_ORDER.filter((id) => sources[id]?.length).map((id) => ({
    ...SDK_INFO[id],
    ...opts.overrides?.[id],
    id,
    runs: opts.runs === id,
    files: sources[id]!.map((f) => parseSource(f.name, f.source)),
  }))
}

// ── tokenizer ───────────────────────────────────────────────────────────
export type TokKind = 'plain' | 'kw' | 'str' | 'num' | 'com' | 'ann' | 'type' | 'fn'
export interface Tok {
  t: string
  k: TokKind
}

const TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(#\[[^\]]*\]|@[A-Za-z_][\w.]*)|(\b\d[\d_.]*[a-z]?\b)|([A-Za-z_$][\w$]*)/g

/** Split one line into colored tokens. Returns [tokens, stillInsideDocstring]. */
export function tokenize(line: string, syn: Syntax, inDoc: boolean): [Tok[], boolean] {
  if (syn.tripleQuotes) {
    const count = line.split('"""').length - 1
    if (inDoc || count > 0) {
      const next = count % 2 === 1 ? !inDoc : inDoc
      return [[{ t: line, k: 'com' }], next]
    }
  }
  const out: Tok[] = []
  // Find where a line comment starts (outside strings).
  let code = line
  let comment = ''
  const cIdx = findComment(line, syn.comment)
  if (cIdx >= 0) {
    code = line.slice(0, cIdx)
    comment = line.slice(cIdx)
  }
  let last = 0
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(code); m; m = TOKEN.exec(code)) {
    if (m.index > last) out.push({ t: code.slice(last, m.index), k: 'plain' })
    const [whole, str, ann, num, word] = m
    let k: TokKind = 'plain'
    if (str) k = 'str'
    else if (ann) k = 'ann'
    else if (num) k = 'num'
    else if (word) {
      if (syn.keywords.has(word)) k = 'kw'
      else if (/^[A-Z]/.test(word)) k = 'type'
      else if (code[m.index + word.length] === '(') k = 'fn'
    }
    out.push({ t: whole, k })
    last = m.index + whole.length
  }
  if (last < code.length) out.push({ t: code.slice(last), k: 'plain' })
  if (comment) out.push({ t: comment, k: 'com' })
  return [out, false]
}

function findComment(line: string, marker: string): number {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      // Rust lifetimes / Ruby symbols aside, a lone quote starts a string.
      quote = c
      continue
    }
    if (line.startsWith(marker, i)) {
      // PHP and Rust attributes (#[...]) are not comments.
      if (marker === '#' && line[i + 1] === '[') continue
      return i
    }
  }
  return -1
}

// ── step status ─────────────────────────────────────────────────────────
/** Statuses the viewer colors. Anything else (e.g. "pending") is ignored. */
export type CodeStepStatus = 'running' | 'retrying' | 'interrupted' | 'failed' | 'completed'

const RANK: Record<string, number> = { retrying: 5, interrupted: 4, running: 3, failed: 2, completed: 1 }

/** The most urgent status among a line's steps. */
export function lineStatus(steps: string[], statuses: Record<string, string | null | undefined>): CodeStepStatus | null {
  let best: CodeStepStatus | null = null
  for (const s of steps) {
    const st = statuses[s]
    if (st && RANK[st] && (!best || RANK[st] > RANK[best])) best = st as CodeStepStatus
  }
  return best
}

/**
 * The step the viewer follows: the most urgent active one (retrying beats
 * running); ties go to the later step in `order`, so an active activity beats
 * an enclosing step. When nothing is active, `doneStep` if it completed.
 */
export function focusStep(
  statuses: Record<string, string | null | undefined>,
  order: string[],
  doneStep?: string,
): string | null {
  let best: string | null = null
  const keys = order.length ? order : Object.keys(statuses)
  for (const s of keys) {
    const st = statuses[s]
    if (!st || !RANK[st] || st === 'completed') continue
    if (!best || RANK[st] >= (RANK[statuses[best] ?? ''] ?? 0)) best = s
  }
  if (!best && doneStep && statuses[doneStep] === 'completed') return doneStep
  return best
}
