/** Version stored with each lead so we know which wording the visitor saw. */
export const CONSENT_TEXT_VERSION = '2026-09-24'

export const CONSENT_TEXT =
  'By providing your email, you grant us permission to send you messages. You can unsubscribe at any time.'

/** Required under every email field (docs/lead-capture.md). */
export function ConsentNotice({ className = '' }: { className?: string }) {
  return <p className={`text-xs text-lc-dim mt-1.5 ${className}`}>{CONSENT_TEXT}</p>
}
