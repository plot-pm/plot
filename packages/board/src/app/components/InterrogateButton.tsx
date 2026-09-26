import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { Card, DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Interrogate* — sends a Draft plan to `/plot-panel`, beside *Approve*.
 *
 * One click acts; there is no armed state. The panel writes verdict files and a
 * round count and decides nothing, so there is no consequence to confirm.
 *
 * Whether a panel is already running for this plan is read from
 * `GET /api/interrogate/<slug>` on mount and on every board refresh. While it
 * reads `running`, no button renders — only the running status — and the
 * server refuses a second POST for the same reason.
 *
 * Success is not read from the reply: the plan's `Rounds:` moves, and the card's
 * rounds badge shows it on the next refresh.
 */

/** How often to ask, once a click is outstanding. */
const POLL_MS = 1000;

/** A panel runs several agents; past this, the log is the answer. */
const GIVE_UP_MS = 1_800_000;

export interface InterrogateButtonProps {
  card: Card;
  /** Whether the server will act, and why not — the board's `interrogate`. */
  interrogate: DispatchInfo;
  /** Bumps once per board refresh; each bump re-reads the running status. */
  pulse?: number;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

type State = { kind: 'idle' } | { kind: 'running' } | { kind: 'failed'; message: string };

interface StatusBody {
  state?: string;
  message?: string;
  log?: string;
}

const readStatus = async (slug: string): Promise<StatusBody> => {
  const res = await fetch(`/api/interrogate/${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
  });
  return (await res.json()) as StatusBody;
};

export const InterrogateButton = ({ card, interrogate, pulse = 0, onActing }: InterrogateButtonProps) => {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [log, setLog] = useState('');
  const running = state.kind === 'running';

  // Two clicks inside one render both read `idle`; a ref stops the second.
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  useEffect(() => {
    if (!running || !onActing) return;
    onActing(true);
    return () => onActing(false);
  }, [running, onActing]);

  // A panel started elsewhere — another tab, an earlier page load — shows as
  // running here too. Only `running` is adopted; an earlier run's `failed` or
  // `done` does not repaint an idle button.
  useEffect(() => {
    if (running) return;
    let cancelled = false;
    readStatus(card.slug)
      .then((body) => {
        if (cancelled || body.state !== 'running') return;
        setLog(body.log ?? '');
        setState({ kind: 'running' });
      })
      .catch(() => {
        /* no answer is not a running panel; the button stays offered */
      });
    return () => {
      cancelled = true;
    };
    // `running` is deliberately absent: this asks once per refresh.
  }, [card.slug, pulse]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const body = await readStatus(card.slug);
        if (cancelled) return;
        if (body.log) setLog(body.log);
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the interrogate command failed' });
          return;
        }
        if (body.state === 'done' || body.state === 'unknown') {
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setState({ kind: 'failed', message: 'still running — see the interrogate log' });
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, card.slug]);

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetch('/api/interrogate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as { error?: string; detail?: string; log?: string };
      if (!res.ok) {
        setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
        return;
      }
      if (body.log) setLog(body.log);
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (running) {
    // Not offered while a panel runs: the status replaces the button.
    return (
      <span
        data-interrogate-running={card.slug}
        aria-busy
        title={log ? `Panel running — log: ${log}` : 'Panel running'}
        className={`inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 ${ACTING_CLASS}`}
      >
        interrogating…
        <ActingSpinner />
      </span>
    );
  }

  const blocked = !interrogate.available;
  const onClick = () => {
    // `aria-disabled` does not stop a click; this does.
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    void run();
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        data-interrogate={card.slug}
        onClick={onClick}
        aria-disabled={blocked || undefined}
        title={interrogate.available ? `Run /plot-panel on ${card.slug}` : interrogate.reason}
        className={
          blocked
            ? 'cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600'
            : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        Interrogate
        {blocked && interrogate.reason && (
          <span className="sr-only"> — unavailable: {interrogate.reason}</span>
        )}
      </button>
      {state.kind === 'failed' && (
        <span
          data-interrogate-error={card.slug}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
          {log ? ` (log: ${log})` : ''}
        </span>
      )}
    </span>
  );
};
