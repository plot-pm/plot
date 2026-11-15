import { useId, useState } from 'react';
import { successorCandidates, successorEntry } from '@plot-pm/domain/rules/supersede-successor';
import type { Card } from '../../contract/schema.js';

/**
 * *Supersede* — a person marks a plan Superseded by the plan that replaces it.
 *
 * The first click opens a field for the successor's slug, with the board's
 * other plans offered as suggestions. *Supersede* posts
 * `{ slug, by }` to `POST /api/supersede`, which books the move and answers
 * with its summary or its refusal. A refusal shows its text under the field.
 *
 * The card renders this control only where the domain's Supersede action is
 * enabled; a disabled action shows its reason through the card's own
 * disabled-action outline.
 */

export interface SupersedeButtonProps {
  card: Card;
  /** The plan slugs the board holds; the suggestions exclude `card.slug`. */
  planSlugs?: readonly string[];
  /** Reports that a request is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

/**
 * How long the button waits for the route. The route books and pushes before
 * it answers, and the push ladder retries a rejected push, so the bound is
 * wider than `ACTION_TIMEOUT_MS`, which bounds routes that answer at once.
 */
export const SUPERSEDE_TIMEOUT_MS = 120_000;

type State =
  | { kind: 'idle' }
  | { kind: 'asking'; by: string }
  | { kind: 'running'; by: string }
  | { kind: 'done'; summary: string }
  | { kind: 'failed'; by: string; message: string };

export const SupersedeButton = ({ card, planSlugs = [], onActing }: SupersedeButtonProps) => {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const listId = useId();
  const candidates = successorCandidates(card.slug, planSlugs);

  const submit = async (by: string) => {
    setState({ kind: 'running', by });
    onActing?.(true);
    try {
      const res = await fetch('/api/supersede', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug, by }),
        signal: AbortSignal.timeout(SUPERSEDE_TIMEOUT_MS),
      });
      const body = (await res.json()) as { error?: string; summary?: string };
      setState(res.ok
        ? { kind: 'done', summary: body.summary ?? '' }
        : { kind: 'failed', by, message: body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setState({ kind: 'failed', by, message: e instanceof Error ? e.message : String(e) });
    } finally {
      onActing?.(false);
    }
  };

  if (state.kind === 'idle' || state.kind === 'done') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          data-supersede={card.slug}
          onClick={() => setState({ kind: 'asking', by: '' })}
          title={`Mark ${card.slug} Superseded by the plan that replaces it`}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Supersede
        </button>
        {state.kind === 'done' && (
          <span data-supersede-done={card.slug} className="text-xs text-slate-500 dark:text-slate-400">
            superseded — {state.summary}
          </span>
        )}
      </span>
    );
  }

  const by = state.by;
  const running = state.kind === 'running';
  const entry = successorEntry(card.slug, by);
  const ready = entry.ready && !running;
  return (
    <form
      data-supersede-form={card.slug}
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit(entry.by);
      }}
    >
      <label className="text-xs text-slate-600 dark:text-slate-300">
        Superseded by
        <input
          autoFocus
          data-supersede-by={card.slug}
          list={listId}
          value={by}
          disabled={running}
          onChange={(e) => setState({ kind: 'asking', by: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') setState({ kind: 'idle' }); }}
          placeholder="successor slug"
          className="ml-1 w-48 rounded-sm border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
      </label>
      <datalist id={listId}>
        {candidates.map((slug) => <option key={slug} value={slug} />)}
      </datalist>
      <button
        type="submit"
        data-supersede-submit={card.slug}
        aria-disabled={!ready || undefined}
        aria-busy={running}
        title={running ? 'superseding…' : entry.reason ?? `Supersede ${card.slug} by ${entry.by}`}
        className={ready
          ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
          : 'cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600'}
      >
        {running ? 'superseding…' : 'Supersede'}
      </button>
      <button
        type="button"
        disabled={running}
        onClick={() => setState({ kind: 'idle' })}
        className="text-xs text-slate-500 hover:underline dark:text-slate-400"
      >
        Cancel
      </button>
      {state.kind === 'failed' && (
        <span data-supersede-error={card.slug} className="w-full whitespace-pre-line text-xs text-red-700 dark:text-red-400">
          {state.message}
        </span>
      )}
    </form>
  );
};
