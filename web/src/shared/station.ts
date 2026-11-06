/** Station ID comes from the kiosk URL (?station=2), defaulting to "laptop". */
export function stationId(): string {
  const p = new URLSearchParams(location.search).get('station');
  return p && /^[\w-]{1,16}$/.test(p) ? p : 'laptop';
}

const params = () => new URLSearchParams(location.search);

/** Carry the kiosk params (station, Booth Control hub, launchpad, deck) across Holodeck pages. */
function withKioskParams(url: URL): string {
  for (const key of ['station', 'hub', 'launchpad', 'deck']) {
    const v = params().get(key);
    if (v && !url.searchParams.has(key)) url.searchParams.set(key, v);
  }
  return url.toString();
}

/** Launchpad origin: ?launchpad= (set by the Launchpad), else port 5100 on this host. */
function launchpadOrigin(): string {
  return params().get('launchpad') ?? `${location.protocol}//${location.hostname}:5100`;
}

/** The Launchpad's home screen (keeping ?station= and ?hub=). */
export function launchpadUrl(): string {
  const url = new URL('/', launchpadOrigin());
  for (const key of ['station', 'hub']) {
    const v = params().get(key);
    if (v) url.searchParams.set(key, v);
  }
  return url.toString();
}

/**
 * The Holodeck deck, one level up from a demo. Visitors who came from the
 * Launchpad go back to its Holodeck deck (?deck=holodeck); otherwise to this
 * app's own Holodeck menu.
 */
export function holodeckUrl(): string {
  if (params().get('launchpad')) {
    const url = new URL(launchpadUrl());
    // The Launchpad passes the deck it came from (a demo can be listed on two).
    url.searchParams.set('deck', params().get('deck') ?? 'holodeck');
    return url.toString();
  }
  return withKioskParams(new URL('/', location.origin));
}

/** Link to another Holodeck page, keeping station/launchpad params. */
export function holodeckPage(path: string): string {
  return withKioskParams(new URL(path, location.origin));
}
