// WebGLProbe — runtime detection of WebGL support + an error boundary so
// a failing Canvas never leaves the panel a black void. Instead we show a
// diagnostic overlay telling the user exactly what's wrong.

import { Component, type ReactNode } from 'react';

export interface WebGLSupport {
  supported: boolean;
  reason: string | null;
  vendor: string;
  renderer: string;
}

export function detectWebGL(): WebGLSupport {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'no window', vendor: '', renderer: '' };
  }
  try {
    const canvas = document.createElement('canvas');
    const attrs: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'default',
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    };
    const gl =
      (canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null) ||
      (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null) ||
      (canvas.getContext(
        'experimental-webgl',
        attrs,
      ) as WebGLRenderingContext | null);
    if (!gl) {
      return {
        supported: false,
        reason: 'getContext returned null — your browser blocked WebGL.',
        vendor: '',
        renderer: '',
      };
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = dbg
      ? String(gl.getParameter((dbg as { UNMASKED_VENDOR_WEBGL: number }).UNMASKED_VENDOR_WEBGL))
      : 'unknown';
    const renderer = dbg
      ? String(gl.getParameter((dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL))
      : 'unknown';
    // Clean up the probe context.
    const loseCtx = gl.getExtension('WEBGL_lose_context');
    loseCtx?.loseContext();
    return { supported: true, reason: null, vendor, renderer };
  } catch (err) {
    return {
      supported: false,
      reason: err instanceof Error ? err.message : String(err),
      vendor: '',
      renderer: '',
    };
  }
}

interface BoundaryProps {
  children: ReactNode;
  fallback: (err: Error) => ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

export class WebGLErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.warn('[SimCockpit] Canvas error boundary caught:', error);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

interface DiagnosticProps {
  support: WebGLSupport;
  errorMessage?: string;
  onRetry?: () => void;
  autoRetrying?: boolean;
}

export function WebGLDiagnostic({
  support,
  errorMessage,
  onRetry,
  autoRetrying,
}: DiagnosticProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-8 text-[12px] text-white/85"
      style={{
        fontFamily: 'Space Grotesk, monospace',
        background:
          'radial-gradient(circle at 50% 40%, #142036 0%, #050810 70%)',
      }}
    >
      <div className="max-w-md rounded-xl border border-red-400/30 bg-black/60 p-5 backdrop-blur-md">
        <div className="mb-2 flex items-center gap-2 text-red-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400" />
          <span className="text-[10px] uppercase tracking-[0.25em]">
            3D canvas unavailable
          </span>
        </div>
        <p className="mb-3 text-white/80">
          Your browser refused to create a WebGL context, so the 3D scene
          can&apos;t start. The rest of the dashboard still works.
        </p>
        <div className="mb-3 rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] text-white/70">
          <div>
            <span className="text-white/40">supported:</span>{' '}
            {support.supported ? 'yes' : 'no'}
          </div>
          {support.reason && (
            <div>
              <span className="text-white/40">reason:</span> {support.reason}
            </div>
          )}
          {errorMessage && (
            <div>
              <span className="text-white/40">renderer error:</span>{' '}
              {errorMessage}
            </div>
          )}
          <div>
            <span className="text-white/40">vendor:</span>{' '}
            {support.vendor || '—'}
          </div>
          <div>
            <span className="text-white/40">renderer:</span>{' '}
            {support.renderer || '—'}
          </div>
          <div>
            <span className="text-white/40">ua:</span>{' '}
            {typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 90) : '—'}
          </div>
        </div>
        <div className="space-y-1 text-white/75">
          {onRetry && (
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-cyan-300/50 bg-cyan-400/15 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-cyan-100 hover:bg-cyan-400/25"
              >
                Retry now
              </button>
              {autoRetrying && (
                <span className="text-[10px] text-white/50">
                  auto-retrying in ~3s…
                </span>
              )}
            </div>
          )}
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">
            Fix in 30 seconds
          </div>
          <ol className="list-decimal space-y-0.5 pl-4 text-[11px]">
            <li>Open a new Chrome tab → go to{' '}
              <code className="rounded bg-white/10 px-1">chrome://settings/system</code>
            </li>
            <li>Enable <em>Use hardware acceleration when available</em></li>
            <li>Click <em>Relaunch</em></li>
            <li>Come back here and reload</li>
          </ol>
          <p className="pt-2 text-[10px] text-white/50">
            Still black? Check <code className="rounded bg-white/10 px-1">chrome://gpu</code>{' '}
            — look for the row <em>WebGL</em> under <em>Graphics Feature
            Status</em>. If it&apos;s red, share that line.
          </p>
        </div>
      </div>
    </div>
  );
}
