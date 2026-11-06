import { stationId } from './station';

/** Thin JSON client for the Holodeck backend (proxied at /api by Vite). */
export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', 'x-station': stationId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Poll `fn` until `done` returns true (or the returned stop() is called). */
export function poll<T>(fn: () => Promise<T>, onValue: (v: T) => boolean | void, everyMs = 700): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const v = await fn();
      if (onValue(v) === true) { stopped = true; return; }
    } catch (e) {
      console.warn('poll error', e);
    }
    if (!stopped) setTimeout(tick, everyMs);
  };
  tick();
  return () => { stopped = true; };
}
