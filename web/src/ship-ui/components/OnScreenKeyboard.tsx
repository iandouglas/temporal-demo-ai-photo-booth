import { useRef, useState } from 'react'

/** Shortcut keys for email mode. Keep in sync with the Holodeck keyboard. */
export const EMAIL_SUFFIXES = ['.com', '.io', '.ai', '.org']

const NUMBERS = '1234567890'
const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

interface KeyboardFieldProps {
  value: string
  placeholder?: string
  className?: string
}

/**
 * The text display above an on-screen keyboard. When it's empty the caret sits
 * at the left of a dimmed placeholder, so it's clear the placeholder is only a
 * hint and typing starts there. With text, the caret follows the text.
 */
export function KeyboardField({ value, placeholder = '', className = '' }: KeyboardFieldProps) {
  return (
    <div
      role="textbox"
      aria-live="polite"
      className={`min-h-[64px] rounded-xl border-2 border-lc-line bg-lc-void px-5 flex items-center text-2xl text-lc-text break-all ${className}`}
    >
      {value ? (
        <>
          <span>{value}</span>
          <span className="lc-caret" />
        </>
      ) : (
        <>
          <span className="lc-caret !ml-0 mr-1" />
          <span className="text-lc-faint">{placeholder}</span>
        </>
      )}
    </div>
  )
}

interface OnScreenKeyboardProps {
  value: string
  onChange: (v: string) => void
  onDone: () => void
  onCancel?: () => void
  mode?: 'text' | 'email'
  maxLength?: number
  doneLabel?: string
  /** Disable the Done key (e.g. until the email looks valid) */
  doneDisabled?: boolean
}

/**
 * Touch keyboard so visitors never need the OS keyboard.
 * Email mode: no Shift or Space; `.` sits right of `m`; the bottom row is
 * ⌫ @ _ - .com .io .ai .org (same as the Holodeck keyboard).
 */
export function OnScreenKeyboard({
  value,
  onChange,
  onDone,
  onCancel,
  mode = 'text',
  maxLength = 120,
  doneLabel = 'Done',
  doneDisabled = false,
}: OnScreenKeyboardProps) {
  const email = mode === 'email'
  const [shift, setShift] = useState(!email && value.length === 0)
  // Build on the latest text even when taps land faster than React re-renders.
  const latest = useRef(value)
  latest.current = value
  const commit = (next: string) => {
    latest.current = next
    onChange(next)
  }

  const add = (s: string) => {
    let next = shift && !email ? s.toUpperCase() : s
    if (email) next = next.toLowerCase()
    if (latest.current.length + next.length > maxLength) return
    commit(latest.current + next)
    if (shift) setShift(false)
  }
  const back = () => commit(latest.current.slice(0, -1))

  const key =
    'lc-label normal-case min-h-[60px] rounded-xl bg-lc-panel-hi border border-lc-line text-lc-text text-2xl font-bold active:bg-lc-line active:scale-95 transition-transform select-none'
  const fn = `${key} text-lg !text-lc-gold`
  // Email mode: Backspace leads the shortcut row, next to @ (matches the Holodeck keyboard).
  const backKey = (
    <button className={`${key} w-[100px] !text-lc-red`} onClick={back} aria-label="Backspace">
      ⌫
    </button>
  )
  const row = 'flex gap-2 justify-center'

  return (
    <div className="space-y-2 select-none" onPointerDown={(e) => e.preventDefault()}>
      <div className={row}>
        {NUMBERS.split('').map((c) => (
          <button key={c} className={`${key} w-[64px]`} onClick={() => add(c)}>
            {c}
          </button>
        ))}
      </div>
      {LETTERS.map((letters, i) => (
        <div key={letters} className={row}>
          {i === 2 && !email && (
            <button
              className={`${key} w-[100px] text-base ${shift ? '!bg-lc-gold !text-lc-void' : ''}`}
              onClick={() => setShift(!shift)}
            >
              Shift
            </button>
          )}
          {letters.split('').map((c) => (
            <button key={c} className={`${key} w-[64px] !font-sans font-semibold`} onClick={() => add(c)}>
              {shift && !email ? c.toUpperCase() : c}
            </button>
          ))}
          {i === 2 && (
            <>
              <button className={`${key} w-[64px]`} onClick={() => add('.')} aria-label="Period">
                .
              </button>
              {!email && backKey}
            </>
          )}
        </div>
      ))}
      <div className={row}>
        {onCancel && (
          <button className={`${key} w-[120px] text-base !text-lc-dim`} onClick={onCancel}>
            Cancel
          </button>
        )}
        {email ? (
          <>
            {backKey}
            {['@', '_', '-'].map((c) => (
              <button key={c} className={`${key} w-[64px]`} onClick={() => add(c)}>
                {c}
              </button>
            ))}
            {EMAIL_SUFFIXES.map((s) => (
              <button key={s} className={`${fn} w-[88px]`} onClick={() => add(s)}>
                {s}
              </button>
            ))}
          </>
        ) : (
          <>
            <button className={`${key} w-[64px]`} onClick={() => add(',')}>
              ,
            </button>
            <button className={`${key} flex-1 max-w-[440px] text-base`} onClick={() => add(' ')}>
              Space
            </button>
            <button className={`${key} w-[64px]`} onClick={() => add('?')}>
              ?
            </button>
          </>
        )}
        <button
          className={`${key} w-[150px] !bg-lc-green !text-lc-void text-xl disabled:opacity-40`}
          disabled={doneDisabled}
          onClick={onDone}
        >
          {doneLabel}
        </button>
      </div>
    </div>
  )
}
