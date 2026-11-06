import { useBoothCommands, useBoothConfig, type BoothCommand } from '../lib/boothConfig'
import { configUrl, launchpadUrl } from '../lib/nav'
import { ZIGGY_PNG } from '../lib/ziggy'

/** What a demo page does with a broadcast command when it doesn't handle it itself. */
function defaultCommand(c: BoothCommand) {
  if (c.kind === 'reload') window.location.reload()
  else if (c.kind === 'home') window.location.href = launchpadUrl()
  else if (c.kind === 'screensaver') window.location.href = launchpadUrl({ screensaver: true })
}

/**
 * The Ziggy button at the far right of the TopBar: a plain link to the staff
 * config page on the Launchpad (`/config`, PIN pad then the admin panel). It's
 * a full page navigation in place, the same way the Launchpad opens a deck and
 * a deck opens a demo (never `window.top`; see docs/demo-build-brief.md). It also carries out broadcast commands (home, reload,
 * screensaver) on pages that don't handle them themselves.
 */
export function AdminButton({ className = '' }: { className?: string }) {
  useBoothCommands(defaultCommand, { fallback: true })
  useBoothConfig() // re-render (fresh href) if staff move the hub
  const label = 'Booth settings (staff)'
  return (
    <a
      href={configUrl()}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center pl-3 pr-5 min-w-[64px] rounded-r-full bg-lc-blue hover:brightness-110 active:scale-[0.97] ${className}`}
    >
      {/* A round porthole: the image is a crop of Ziggy, so a circle hides its square edges. */}
      <img src={ZIGGY_PNG} alt="" width={48} height={48} draggable={false} className="w-[48px] h-[48px] rounded-full bg-lc-panel ring-2 ring-lc-void/70" />
    </a>
  )
}
