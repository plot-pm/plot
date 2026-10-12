import { useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { Card, DispatchInfo } from '../../contract/schema.js';

/**
 * *Needs design* — a person moves a Draft plan to Design.
 *
 * The click posts the slug to `POST /api/needs-design`, which starts the
 * `plot-needs-design.mjs` bundle detached. The bundle writes `State: Design`, the
 * `Design:` record and an empty `## Spec` section. The board reads the result from
 * git on its next refresh, so a 202 settles the button without asserting the move.
 *
 * The interaction is `CommissionDesignButton`'s: the first click arms, the second
 * acts, and a click elsewhere or Escape cancels. The armed label names the
 * consequence.
 */

export interface NeedsDesignButtonProps {
  card: Card;
  /** Whether the server will act, and why not — the same binding Approve uses. */
  availability: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

type State = { kind: 'idle' } | { kind: 'armed' } | { kind: 'running' } | { kind: 'failed'; message: string };

/** What the armed button says. Exported for test. */
export const armedLabel = (card: Card): string => `Needs design — moves ${card.slug} to Design?`;

export const NeedsDesignButton = ({ card, availability, onActing }: NeedsDesignButtonProps) => {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';
  const inFlight = useRef(false);
  const blocked = running || !availability.available;

  const run = async () => {
    setState({ kind: 'running' });
    onActing?.(true);
    try {
      const res = await fetch('/api/needs-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as { error?: string };
      setState(res.ok ? { kind: 'idle' } : { kind: 'failed', message: body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      inFlight.current = false;
      onActing?.(false);
    }
  };

  const onClick = () => {
    if (blocked) return;
    if (state.kind === 'idle' || state.kind === 'failed') {
      setState({ kind: 'armed' });
      return;
    }
    if (armed) {
      if (inFlight.current) return;
      inFlight.current = true;
      void run();
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        data-needs-design={card.slug}
        onClick={onClick}
        onBlur={() => armed && setState({ kind: 'idle' })}
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={availability.available ? `Move ${card.slug} into Design` : availability.reason}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? 'cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600'
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'moving…' : armed ? armedLabel(card) : 'Needs design'}
        {!availability.available && availability.reason && (
          <span className="sr-only"> — unavailable: {availability.reason}</span>
        )}
      </button>
      {state.kind === 'failed' && (
        <span data-needs-design-error={card.slug} className="whitespace-pre-line text-xs text-red-700 dark:text-red-400">
          {state.message}
        </span>
      )}
    </span>
  );
};
