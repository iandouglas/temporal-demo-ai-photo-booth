// Shared spaceship touchpad UI. Vendored into each demo by shared/ship-ui/sync.sh;
// edit the copy in shared/ship-ui, not the vendored one.
export { ServiceToggle } from './components/ServiceToggle'
export { ScreenHeader } from './components/ScreenHeader'
export { PanelHeader, type LcColor } from './components/PanelHeader'
export { TopBar, TopBarItem, type TopBarTab } from './components/TopBar'
export { RetryMeter, RetryMeterView } from './components/RetryMeter'
export { ActivityTally, type TallyRow } from './components/ActivityTally'
export { OnScreenKeyboard, KeyboardField, EMAIL_SUFFIXES } from './components/OnScreenKeyboard'
export { ConsentNotice, CONSENT_TEXT, CONSENT_TEXT_VERSION } from './components/ConsentNotice'
export { CodeViewer, LanguageTabs, LanguageDropdown, type CodeViewerProps } from './components/CodeViewer'
export { SDK_LOGOS } from './components/SdkLogos'
export * from './lib/code'
export { formatGC } from './lib/credits'
export * from './lib/retry'
export { useScreenLayout, useTallScreen, useCanOpenNewTabs, STACKED_QUERY, type ScreenLayout } from './lib/layout'
export { ExternalLink } from './components/ExternalLink'
export { backToDeck, launchpadUrl, configUrl, DECK_NAMES, type DeckId } from './lib/nav'
// The Ziggy link to the Launchpad's /config page. The PIN pad and admin panel
// themselves are in './admin' (Launchpad /config and the Booth Control console only).
export { AdminButton } from './components/AdminButton'
export { ZIGGY_PNG } from './lib/ziggy'
export {
  useBoothConfig,
  useBoothCommands,
  useIdleTimeoutMs,
  boothConfig,
  mergeEffective,
  deckTimeout,
  demoEnabled,
  withBoothParams,
  temporalUiUrl,
  resolveTemporalTarget,
  stationNamespace,
  resolveStation,
  resolveHub,
  DEFAULT_SETTINGS,
  DECK_IDS,
  NEVER_TIMEOUT_DECKS,
  type BoothConfigState,
  type BoothConfigPayload,
  type BoothSettings,
  type BoothCommand,
  type EffectiveConfig,
  type NetworkMode,
  type TemporalTarget,
  type ResolvedTemporalTarget,
} from './lib/boothConfig'
