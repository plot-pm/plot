import { useEffect, useRef, useState } from 'react';
import type { DispatchLog } from '../../server/dispatch.js';
import { LOG_POLL_MS, sizeLabel } from './WorkerLogModal.js';

/**
 * THE DISPATCHER'S OWN WORDS, on demand — the durable home the button's old
 * *no change — see log* message pointed at and then destroyed.
 *
 * A sibling of {@link WorkerLogModal} rather than a mode of it. That panel reads
 * the AGENT's console (`.plot-worker.log`) and layers pid, uptime and a
 * continuation control over it — a branch's worker. This reads the DISPATCHER's
 * log (`plot-dispatch-<slug>.log`), which belongs to a PLAN and has none of
 * that: no process, no continuation, just what the script did. Overloading one
 * component with `slug | branch` would thread that ambiguity through every field
 * — the exact accurate-about-the-wrong-subject failure this estate keeps
 * removing. So it reuses the RENDERING (the escaping `<pre>`, the truncation
 * notice, the size label) and states its own subject.
 *
 * Rendered as TEXT, never HTML — the same security property WorkerLogModal
 * documents: log output is arbitrary bytes, and React escapes them here by
 * construction.
 */

/**
 * The empty-log sentence for a dispatcher log.
 *
 * Distinct from the worker log's: a dispatcher writes its summary line quickly
 * and synchronously, so an empty dispatcher log means the run has only just
 * opened the file — a moment, not a whole run. The reader's move is to wait a
 * beat, not to go looking.
 */
export const DISPATCH_EMPTY_WORD =
  'The dispatcher opened its log and has not written to it yet — give it a moment.';

/**
 * What the panel says for a dispatcher log it could not read.
 *
 * Two answers, not the worker log's three: a dispatcher log's path needs no
 * worktree, so `no-worktree` cannot arise (see `dispatchLog`). `no-log` here
 * means *nobody has dispatched this plan* — which is why the `Status` entry is
 * offered only when a log exists, and so a reader should rarely see this at all.
 */
export function dispatchMissWord(reason: 'no-log' | 'unreadable'): string {
  switch (reason) {
    case 'no-log':
      return 'No dispatcher log — nobody has started work on this plan from this machine.';
    case 'unreadable':
      return 'The dispatcher log is there and would not open — check its permissions.';
  }
}

export interface DispatchLogModalProps {
  slug: string;
  onClose: () => void;
  /** Injected by tests; the browser's `fetch` in the app. */
  fetcher?: typeof fetch;
}

/**
 * The dispatcher log for a plan, fetched when a person opens the `Status` entry.
 *
 * Polls on the same cadence as the worker log and for the same reason: a
 * dispatch is in flight while someone is watching it, and closing the panel ends
 * the traffic — the whole point of on-demand reads over pulse-carried ones.
 */
export function DispatchLogModal({ slug, onClose, fetcher = fetch }: DispatchLogModalProps) {
  const [log, setLog] = useState<DispatchLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  // Whether the reader is parked at the tail — the auto-scroll follows new
  // output only for a reader who has not scrolled away to read further up.
  const pinned = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetcher(`/api/dispatch-log?slug=${encodeURIComponent(slug)}`)
        .then(async (res) => {
          const body = (await res.json()) as DispatchLog | { error: string };
          if (cancelled) return;
          if ('error' in body) {
            setError(body.error);
            return;
          }
          setError(null);
          setLog(body);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    };
    load();
    const timer = setInterval(load, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slug, fetcher]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Follow the tail, but only for a reader who is already at it.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Dispatcher log: ${slug}`}
        data-dispatch-log
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-baseline gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Status</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
            {slug}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </header>

        {/* THE TRUNCATION SAYS SO — a tail presented as the whole log reads as
            "the dispatcher printed this much" when it printed far more. */}
        {log?.ok && log.truncated && (
          <p
            data-log-truncated
            className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            Showing the last {sizeLabel(log.text.length)} of {sizeLabel(log.bytes)} — open the file
            for the rest.
          </p>
        )}

        <pre
          ref={bodyRef}
          onScroll={onScroll}
          data-log-body
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200"
        >
          {error !== null ? (
            <span className="text-rose-600 dark:text-rose-400">{error}</span>
          ) : log === null ? (
            <span className="text-slate-400">Loading…</span>
          ) : !log.ok ? (
            <span data-log-miss={log.reason} className="text-slate-500 dark:text-slate-400">
              {dispatchMissWord(log.reason)}
            </span>
          ) : log.text === '' ? (
            <span data-log-empty className="text-slate-500 dark:text-slate-400">
              {DISPATCH_EMPTY_WORD}
            </span>
          ) : (
            log.text
          )}
        </pre>

        {/* The path, always — including for the misses that know one. It is the
            answer to "then where should I look", and the durable route the
            button's old transient message could not offer. */}
        {log?.path && (
          <footer className="shrink-0 truncate border-t border-slate-200 px-4 py-2 font-mono text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
            {log.path}
          </footer>
        )}
      </div>
    </div>
  );
}
