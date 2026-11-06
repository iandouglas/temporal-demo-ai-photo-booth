import { h } from './dom';
export interface ChromeOptions { showHome?: boolean; back?: 'holodeck' | 'launchpad'; }
export function installChrome(opts: ChromeOptions = {}): void {
  const panel = new URLSearchParams(location.search).get('config') ?? 'http://127.0.0.1:5199/config';
  if (opts.showHome !== false) document.body.append(h('a', { class: 'btn chrome-home', href: panel }, 'Demo menu'));
  document.body.append(h('a', { class: 'btn booth-ziggy', href: panel, title: 'Booth settings (staff)', 'aria-label': 'Booth settings (staff)' }, 'Config'));
}
