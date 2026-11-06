interface ServiceToggleProps {
  /** Name of the ship system, e.g. "Replicator" */
  label: string
  online: boolean
  onChange: (online: boolean) => void
  size?: 'md' | 'lg'
}

/**
 * The standard ONLINE / OFFLINE switch for a ship system. Every demo uses this
 * control to take a service down and bring it back, so it should look and act
 * the same everywhere (see docs/theme-and-interaction.md).
 */
export function ServiceToggle({ label, online, onChange, size = 'md' }: ServiceToggleProps) {
  const lg = size === 'lg'
  const seg = `lc-label font-bold flex-1 flex items-center justify-center transition-all duration-200 ${
    lg ? 'text-2xl px-8' : 'text-base px-5'
  }`

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <span className={`lc-label text-lc-dim ${lg ? 'text-base' : 'text-xs'}`}>{label}</span>
      <div
        role="switch"
        aria-checked={online}
        aria-label={`${label} power`}
        className={`flex rounded-full overflow-hidden border-2 border-lc-line bg-lc-hull ${
          lg ? 'h-20 min-w-[380px]' : 'h-12 min-w-[220px]'
        }`}
      >
        <button
          onClick={() => onChange(true)}
          className={`${seg} ${
            online
              ? 'bg-lc-green text-lc-void shadow-[0_0_24px_#66dd9966]'
              : 'text-lc-faint hover:text-lc-green'
          }`}
        >
          Online
        </button>
        <button
          onClick={() => onChange(false)}
          className={`${seg} ${
            !online
              ? 'bg-lc-red text-lc-void shadow-[0_0_24px_#ff555566]'
              : 'text-lc-faint hover:text-lc-red'
          }`}
        >
          Offline
        </button>
      </div>
    </div>
  )
}
