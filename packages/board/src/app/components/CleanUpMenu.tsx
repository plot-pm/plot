import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import { bulkDeleteWords, deleteWords, releaseWords, type RowMenuView } from '../lib/agent-rows/delivery-view.js';
import { LooseDeleteButton } from './LooseDeleteButton.js';
import { ReleaseClaimButton } from './ReleaseClaimButton.js';

/** The clean-up menu of one row, as the view-model built it. */
export type CleanUpMenuView = Extract<RowMenuView, { kind: 'clean-up' }>;

/**
 * Closes a popup on Escape and on a click outside its box. The click listener runs on capture, so it
 * hit-tests the target instead of relying on propagation.
 */
const useDismiss = (open: boolean, close: () => void) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: globalThis.MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDown, true);
    };
  }, [open, close]);
  return box;
};

const POPUP_BOX = 'absolute z-10 mt-1 w-max max-w-[min(24rem,80vw)] rounded-md border border-slate-200 bg-white p-1 text-left shadow-lg dark:border-slate-700 dark:bg-slate-900';

/**
 * The `⋯` menu of a clean-up row: Open, Release claim and Delete branch, each present only where the
 * view-model says its controller accepts the row. The menu decides nothing.
 *
 * @param menu - the row's clean-up menu from `rowMenuOf`.
 */
export const CleanUpMenu = ({ menu }: { menu: CleanUpMenuView }) => {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, () => setOpen(false));
  if (menu.open === '' && menu.release === null && !menu.delete) return null;
  const release = menu.release === null ? null : releaseWords(menu.branch, menu.release);
  const remove = menu.delete ? deleteWords(menu.branch) : null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-row-actions
        data-clean-up-menu
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${menu.branch}`}
        title={`Actions for ${menu.branch}`}
        onClick={() => setOpen((v) => !v)}
        className="-my-1 -mr-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-xs leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className={`right-0 ${POPUP_BOX}`}>
          {menu.open !== '' && (
            <div role="menuitem" className="px-2 py-1">
              <a
                href={menu.open}
                target="_blank"
                rel="noreferrer"
                data-open-link
                aria-label={`Open ${menu.branch} on the git host`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Open
              </a>
            </div>
          )}
          {release !== null && (
            <div role="menuitem" className="px-2 py-1">
              <ReleaseClaimButton branch={menu.branch} label={release.label} confirmText={release.confirm} />
            </div>
          )}
          {remove !== null && (
            <div role="menuitem" className="px-2 py-1">
              <LooseDeleteButton branch={menu.branch} label={remove.label} confirmText={remove.confirm} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** One branch's answer from `POST /api/loose-delete`. */
type BulkResult = { branch: string; ok: true; pin: string } | { branch: string; ok: false; reason: string; detail: string };

type BulkState =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running'; done: BulkResult[] }
  | { kind: 'done'; done: BulkResult[] };

/**
 * The group-wide delete of the Clean up group: one confirmation that lists the branches, then one
 * `POST /api/loose-delete` per branch, in order, each refusal reported by its name.
 *
 * @param branches - the branches whose row offers Delete, from `cleanUpBranches`.
 * @param fetcher - injected by tests; the browser's `fetch` in the app.
 */
export const CleanUpBulkDelete = ({ branches, fetcher = fetch }: { branches: readonly string[]; fetcher?: typeof fetch }) => {
  const [state, setState] = useState<BulkState>({ kind: 'idle' });
  const box = useDismiss(state.kind === 'armed', () => setState({ kind: 'idle' }));
  const words = bulkDeleteWords(branches);
  if (words === null && state.kind === 'idle') return null;

  const run = async () => {
    const done: BulkResult[] = [];
    setState({ kind: 'running', done });
    for (const branch of branches) {
      try {
        const res = await fetcher('/api/loose-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch }),
          signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
        });
        const body = (await res.json()) as { ok?: boolean; pin?: string; reason?: string; detail?: string; error?: string };
        done.push(res.ok && body.ok
          ? { branch, ok: true, pin: body.pin ?? '' }
          : { branch, ok: false, reason: body.reason ?? `HTTP ${res.status}`, detail: body.detail ?? body.error ?? '' });
      } catch (e) {
        done.push({ branch, ok: false, reason: 'unreachable', detail: e instanceof Error ? e.message : String(e) });
      }
      setState({ kind: 'running', done: [...done] });
    }
    setState({ kind: 'done', done: [...done] });
  };

  const results = state.kind === 'running' || state.kind === 'done' ? state.done : [];
  return (
    <span ref={box} data-clean-up-bulk className="relative font-normal normal-case tracking-normal">
      {words !== null && state.kind !== 'done' && (
        <button
          type="button"
          data-clean-up-bulk-delete
          disabled={state.kind === 'running'}
          onClick={() => setState((s) => (s.kind === 'idle' ? { kind: 'armed' } : s))}
          className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-40 dark:text-rose-400"
        >
          {state.kind === 'running' ? `deleting ${results.length + 1} of ${branches.length}…` : words.label}
        </button>
      )}
      {state.kind === 'armed' && words !== null && (
        <span role="dialog" aria-label={words.label} data-clean-up-bulk-confirm className={`left-0 top-full ${POPUP_BOX}`}>
          <span className="block px-2 py-1 text-xs">{words.confirm}</span>
          <span className="flex gap-3 px-2 py-1">
            <button type="button" data-clean-up-bulk-confirm-go onClick={() => void run()} className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400">
              Delete
            </button>
            <button type="button" data-clean-up-bulk-cancel onClick={() => setState({ kind: 'idle' })} className="text-xs font-medium hover:underline">
              Cancel
            </button>
          </span>
        </span>
      )}
      {results.length > 0 && (
        <ul data-clean-up-bulk-results className="mt-1 text-xs">
          {results.map((r) => (
            <li key={r.branch} data-clean-up-bulk-result={r.ok ? 'deleted' : r.reason} className={r.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
              <span className="font-mono">{r.branch}</span>
              {r.ok ? ` deleted · pinned at ${r.pin}` : ` refused: ${r.reason}${r.detail === '' ? '' : ` — ${r.detail}`}`}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
};
