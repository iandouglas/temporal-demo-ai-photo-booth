import { h } from './dom';

/** Shared consent copy (docs/lead-capture.md). Bump the version when wording changes. */
export const CONSENT_TEXT_VERSION = 'v1-draft';
export const CONSENT_TEXT =
  'By providing your email, you grant us permission to send you messages. You can unsubscribe at any time.';

export function consentNote(): HTMLElement {
  return h('p', { class: 'consent' }, CONSENT_TEXT);
}
