interface ScreenHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
}

/** LCARS-style title bar used at the top of every crew tablet screen. */
export function ScreenHeader({ title, subtitle, onBack }: ScreenHeaderProps) {
  return (
    <div className="flex items-stretch gap-[4px] px-3 pt-3 pb-2">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="lc-btn !min-h-[52px] !px-4 !rounded-l-full !rounded-r-none bg-lc-lavender text-xl"
        >
          &larr;
        </button>
      )}
      <div
        className={`flex-1 flex flex-col justify-center px-4 py-2 bg-lc-orange text-lc-void ${
          onBack ? 'rounded-none' : 'rounded-l-full'
        }`}
      >
        <h1 className="lc-label text-xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-xs font-medium opacity-80">{subtitle}</p>}
      </div>
      <div className="w-[18px] rounded-r-full bg-lc-peach" />
    </div>
  )
}
