import { h } from './dom';

export type KeyboardMode = 'email' | 'text' | 'initials';

export interface KeyboardOptions {
  mode?: KeyboardMode;
  placeholder?: string;
  maxLength?: number;
  initial?: string;
  submitLabel?: string;
  /** Return an error string to block submit, or null when valid. */
  validate?: (value: string) => string | null;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const KB_PREF = 'holodeck.keyboard';
const EMAIL_SHORTCUTS = ['@', '_', '-', '.com', '.io', '.ai', '.org'];

/**
 * On-screen keyboard + input display. Never relies on the OS keyboard, but
 * also accepts physical key presses so staff laptops work.
 */
export function onScreenKeyboard(opts: KeyboardOptions): { el: HTMLElement; value: () => string; destroy: () => void } {
  const mode = opts.mode ?? 'text';
  const max = opts.maxLength ?? (mode === 'initials' ? 3 : 64);
  let value = opts.initial ?? '';
  let shift = mode === 'initials' || (mode === 'text' && !value);

  const display = h('div', { class: 'field', role: 'textbox', 'aria-live': 'polite' });
  const error = h('p', { class: 'consent', style: 'color: var(--coral); min-height: 1.4em' });
  // Submit sits beside the field (not in the keyboard) so it stays usable when the keyboard is hidden.
  const submit = h('button', { class: 'btn mint osk-submit', onclick: () => trySubmit() }, opts.submitLabel ?? 'Done');

  const render = () => {
    // Empty: caret sits left of the dimmed placeholder, where typing will start.
    display.replaceChildren(...(value
      ? [h('span', {}, value), h('span', { class: 'caret' })]
      : [h('span', { class: 'caret' }), h('span', { class: 'placeholder' }, opts.placeholder ?? '')]));
    display.classList.remove('invalid');
    error.textContent = '';
    keys.forEach(([btn, ch]) => (btn.textContent = shift ? ch.toUpperCase() : ch));
  };

  const type = (s: string) => {
    if (mode === 'initials') s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (mode === 'email') s = s.toLowerCase().replace(/\s/g, '');
    value = (value + s).slice(0, max);
    if (shift && mode === 'text') shift = false;
    opts.onChange?.(value);
    render();
  };
  const back = () => { value = value.slice(0, -1); opts.onChange?.(value); render(); };
  const trySubmit = () => {
    const err = opts.validate?.(value) ?? (mode === 'email' && !isEmail(value) ? 'That email doesn’t look right yet.' : null);
    if (err) { display.classList.add('invalid'); error.textContent = err; return; }
    opts.onSubmit(value);
  };

  const keys: [HTMLButtonElement, string][] = [];
  const rows = ROWS.map((row, i) =>
    h('div', { class: 'osk-row' }, ...[...row].map((ch) => {
      const b = h('button', { class: 'osk-key', onclick: () => type(shift ? ch.toUpperCase() : ch) }, ch);
      keys.push([b, ch]);
      return b;
    }),
    // Period sits right after "m" (not needed for initials).
    i === ROWS.length - 1 && mode !== 'initials' ? h('button', { class: 'osk-key', onclick: () => type('.') }, '.') : null),
  );

  const backKey = () => h('button', { class: 'osk-key fn back', onclick: back, 'aria-label': 'Backspace' }, '⌫');

  // Email mode: backspace leads the shortcut row (top-left, next to @).
  const shortcuts = mode === 'email'
    ? h('div', { class: 'osk-row shortcuts' }, backKey(), ...EMAIL_SHORTCUTS.map((s) => h('button', { class: 'osk-key fn', onclick: () => type(s) }, s)))
    : null;

  const bottom = mode === 'email' ? null : h('div', { class: 'osk-row' },
    mode === 'text' ? h('button', { class: 'osk-key fn wide', onclick: () => { shift = !shift; render(); } }, '⇧ Shift') : null,
    mode === 'text' ? h('button', { class: 'osk-key xwide', onclick: () => type(' ') }, 'space') : null,
    backKey(),
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key === 'Backspace') { back(); e.preventDefault(); }
    else if (e.key === 'Enter') trySubmit();
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) type(e.key);
  };
  window.addEventListener('keydown', onKey);

  // Show/hide toggle for laptops with a physical keyboard; remembered per device.
  const pad = h('div', { class: 'osk' }, shortcuts, ...rows, bottom);
  const toggle = h('button', { class: 'btn ghost osk-toggle', onclick: () => setVisible(pad.hidden !== false) });
  const hint = h('p', { class: 'consent osk-hint' }, 'Type on your keyboard, then press Enter.');
  const setVisible = (show: boolean) => {
    pad.hidden = !show;
    hint.hidden = show;
    toggle.textContent = show ? '⌨ Hide keyboard' : '⌨ Show keyboard';
    try { localStorage.setItem(KB_PREF, show ? 'show' : 'hide'); } catch { /* storage unavailable */ }
  };
  let pref: string | null = null;
  try { pref = localStorage.getItem(KB_PREF); } catch { /* storage unavailable */ }
  setVisible(pref !== 'hide');

  const el = h('div', { class: 'osk-wrap' },
    h('div', { class: 'osk-field-row' }, display, submit),
    h('div', { class: 'osk-meta' }, error, toggle),
    hint, pad);
  render();
  return { el, value: () => value, destroy: () => window.removeEventListener('keydown', onKey) };
}
