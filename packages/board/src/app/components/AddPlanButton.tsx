import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';
import { ActionMessage } from './ui/action-message.js';

/**
 * *Add plan* — a story card's action: starts `/plot-idea` on a brief the server
 * builds from the story's committed file, and the plan it creates names the
 * story in `Story:`. The request carries the slug and nothing else.
 *
 * The interaction is `CreatePlanButton`'s: arm on the first click, act on the
 * second, cancel on a click elsewhere or Escape. The outcome is read back from
 * `GET /api/story-plan/<slug>` only to show the command's own words on a
 * refusal; the plan appearing under the story is the confirmation.
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/** How long the poll waits before it names the log as the answer. */
const GIVE_UP_MS = 300_000;

export interface AddPlanButtonProps {
  /** The story's slug — the POST body, and nothing else. */
  slug: string;
  /** Whether this board will start the idea agent — `Board.idea`. */
  idea: DispatchInfo;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string };

/**
 * What the armed button says: a Draft plan will exist, inside this story.
 *
 * @param slug - the story's slug.
 * @returns the armed label.
 */
export const armedLabel = (slug: string): string => `Add plan — Draft in ${slug}?`;

export const AddPlanButton = ({ slug, idea }: AddPlanButtonProps) => {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';
  // Two clicks on the armed button inside one tick both read `armed`; a ref
  // changes synchronously, so the second sees the first.
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!armed) return;
    const cancel = (e: Event) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setState({ kind: 'idle' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState({ kind: 'idle' });
    };
    document.addEventListener('pointerdown', cancel, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [armed]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/story-plan/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the idea command failed' });
          return;
        }
        if (body.state === 'done') {
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setState({ kind: 'failed', message: 'still running — see the idea log' });
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, slug]);

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetch('/api/story-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE SLUG, AND NOTHING ELSE. The server reads the story from the
        // default branch, so no text this page holds reaches the agent.
        body: JSON.stringify({ slug }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const blocked = running || !idea.available;
  const onClick = () => {
    if (blocked) return;
    if (state.kind === 'idle' || state.kind === 'failed') {
      setState({ kind: 'armed' });
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    void run();
  };

  // The card's action band styles the control by its slot (`index.css`); these
  // classes are what it shows outside a card.
  return (
    <span ref={rootRef} className="inline-flex items-center">
      <button
        type="button"
        data-add-plan={slug}
        onClick={onClick}
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'adding…' : armed ? armedLabel(slug) : 'Add plan'}
        {running && <ActingSpinner />}
      </button>
      {state.kind === 'failed' && (
        <ActionMessage attrs={{ 'data-add-plan-error': slug }} className="whitespace-pre-line text-xs text-red-700 dark:text-red-400">
          {state.message}
        </ActionMessage>
      )}
    </span>
  );
};
