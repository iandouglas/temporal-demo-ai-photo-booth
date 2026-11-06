// Simple, self-drawn marks that evoke each language's logo. Not the official
// artwork (see the ship-ui README, "Language logos"); drawn for a dark screen.

import type { JSX } from 'react'
import type { SdkId } from '../lib/code'

const S = { width: '100%', height: '100%' }

function Java() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <path d="M17 5c3 3-3 5 0 9M22 4c3 3.5-3 6 0 10" fill="none" stroke="#f89820" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9 17h20v8a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8z" fill="#5382a1" />
      <path d="M29 19h2.5a3.5 3.5 0 0 1 0 7H29" fill="none" stroke="#5382a1" strokeWidth="2.4" />
      <ellipse cx="19" cy="36" rx="12" ry="2" fill="#5382a1" opacity="0.8" />
    </svg>
  )
}

function DotNet() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <rect x="2" y="2" width="36" height="36" rx="8" fill="#512bd4" />
      <text x="20" y="25.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="12.5" fill="#fff">.NET</text>
    </svg>
  )
}

function TypeScript() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <rect x="2" y="2" width="36" height="36" rx="5" fill="#3178c6" />
      <text x="35" y="34" textAnchor="end" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="16" fill="#fff">TS</text>
    </svg>
  )
}

function Go() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <g stroke="#00add8" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 16h7M1 20h6M3 24h5" />
      </g>
      <text x="24" y="27" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontStyle="italic" fontWeight="900" fontSize="17" fill="#00add8">GO</text>
    </svg>
  )
}

function Python() {
  const snake = 'M19.5 3c-6.5 0-7 2.8-7 4.5V12h7.5v1.5H9.2C5.8 13.5 3 16 3 20.5s2.4 7 5.6 7h2.9v-4.2c0-3 2.6-5.3 5.5-5.3h7.3c2.5 0 4.3-2 4.3-4.4V7.5C28.6 5 26.4 3 19.5 3z'
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <path d={snake} fill="#3776ab" />
      <path d={snake} fill="#ffd43b" transform="rotate(180 20 20.5)" />
      <circle cx="16" cy="7.4" r="1.4" fill="#fff" />
      <circle cx="24" cy="33.6" r="1.4" fill="#fff" />
    </svg>
  )
}

function Rust() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <circle cx="20" cy="20" r="15.5" fill="none" stroke="#dea584" strokeWidth="4" strokeDasharray="3 2.1" />
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="#dea584" strokeWidth="2" />
      <text x="20" y="26" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="16" fill="#dea584">R</text>
    </svg>
  )
}

function Ruby() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <path d="M11 6h18l8 9-17 20L3 15z" fill="#cc342d" />
      <path d="M3 15h34M11 6l3 9 6 20 6-20 3-9M14 15l6-9 6 9" fill="none" stroke="#ff8a80" strokeWidth="1" opacity="0.8" />
    </svg>
  )
}

function Php() {
  return (
    <svg viewBox="0 0 40 40" style={S} aria-hidden>
      <ellipse cx="20" cy="20" rx="18.5" ry="11" fill="#777bb4" />
      <text x="20" y="24.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontStyle="italic" fontWeight="700" fontSize="13" fill="#fff">php</text>
    </svg>
  )
}

export const SDK_LOGOS: Record<SdkId, () => JSX.Element> = {
  java: Java,
  dotnet: DotNet,
  typescript: TypeScript,
  go: Go,
  python: Python,
  rust: Rust,
  ruby: Ruby,
  php: Php,
}
