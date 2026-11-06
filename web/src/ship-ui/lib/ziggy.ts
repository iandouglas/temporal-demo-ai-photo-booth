/**
 * Ziggy, the mascot (shared/ship-ui/assets/ziggy/ziggy.png, 128×128 with a
 * transparent background). sync.sh vendors assets/ next to src, so this path
 * resolves in every frontend's src/ship-ui/, and Vite bundles the file.
 * Framework-free: the Holodeck's plain pages use it too.
 */
export const ZIGGY_PNG: string = new URL('../assets/ziggy/ziggy.png', import.meta.url).href
