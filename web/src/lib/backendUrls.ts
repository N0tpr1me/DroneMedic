// Centralized backend URL resolution used by all realtime hooks.
//
// Dev: the Vite proxy in `vite.config.ts` handles /ws/* and /api/*, so we
// return same-origin URLs (empty VITE_API_URL). Prod (Netlify): VITE_API_URL
// points at the FastAPI backend (e.g. http://144.202.12.168:8000) and we
// convert http(s) → ws(s) for WebSocket paths.

function apiBase(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) || '';
}

/** Resolve a WebSocket URL for a backend path. */
export function backendWsUrl(path: string): string {
  const base = apiBase();
  if (!base) {
    if (typeof window === 'undefined') return path;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${path}`;
  }
  return base.replace(/^http/, 'ws') + path;
}

/** Resolve an HTTP URL for a backend path. */
export function backendHttpUrl(path: string): string {
  const base = apiBase();
  if (!base) return path;
  return base.replace(/\/$/, '') + path;
}
