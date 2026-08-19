import { useEffect, useRef, useState } from 'react';
import type { AgentPanel } from '../../server/agent-panel.js';
import type { LogMissReason, WorkerLog } from '../../server/worker-log.js';
import { AgentPanelFacts } from './AgentPanelFacts.js';
import { ContinueWithAnAnswer } from './ContinueWithAnAnswer.js';

/**
 * How often an open panel re-fetches, in ms.
 *
 * **The polling lives HERE, in the panel, and never in the pulse.** That
 * placement is the whole wave: a log is fetched while someone is looking at it
 * and not at all otherwise, so the cost is one open panel rather than every
 * agent's output multiplied by every open tab, four times a minute, forever.
 * Closing the panel stops the traffic completely — see the effect below.
 *
 * 3 s rather than the fleet's 4 s because a reader watching a log is watching
 * it deliberately, and this is the one view where latency is the point. It is
 * also cheap in a way the pulse is not: a bounded read of one file, against a
 * scan that shells out across every worktree.
 */
export const LOG_POLL_MS = 3_000;

/** Bytes → a short human size, for the truncation notice. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the panel SAYS for a log it could not read — three answers, three moves.
 *
 * The three-way distinction the server draws is worth nothing if the client
 * renders all of them as an empty box, which is precisely the collapse this
 * wave exists to prevent. Each sentence names what is true and what to do about
 * it, because "no log" without "the worktree is here, look in it" sends the
 * reader nowhere.
 *
 * Exported for test: the assertion that matters is that no two of these are the
 * same string, which a component test cannot make about markup it has to
 * scrape.
 */
export function missWord(reason: LogMissReason): string {
  switch (reason) {
    case 'no-worktree':
      return 'No worktree for this branch on this machine — ask the machine that took it.';
    case 'no-log':
      return 'The worktree is here, but no worker has written a log in it.';
    case 'unreadable':
      return 'The log file is there and would not open — check its permissions.';
  }
}

/**
 * The empty-log sentence, kept apart from the three above ON PURPOSE.
 *
 * A worker that has started and printed nothing yet is a SUCCESSFUL read, and
 * the reader's move is to wait rather than to go looking. Rendering it with the
 * misses would say the log is absent when the fact is that it is empty — the
 * distinction the server went to the trouble of preserving, thrown away at the
 * last step.
 */
export const EMPTY_LOG_WORD = 'The log is empty — the worker has started and written nothing yet.';

export interface WorkerLogModalProps {
  branch: string;
  onClose: () => void;
  /** Injected by tests; the browser's `fetch` in the app. */
  fetcher?: typeof fetch;
  /** Injected by tests so "last activity" does not race the clock. */
  now?: number;
  /**
   * Whether this board can start a continuation, from `/api/board`.
   *
   * PASSED IN rather than fetched here, and it is the one fact this panel
   * cannot derive for itself: every other field comes from `/api/agent-panel`,
   * which describes a BRANCH, while this describes the SERVER's binding. A
   * third fetch for one boolean the page already holds would be a request per
   * open panel for an answer that cannot change while the board is running.
   *
   * Defaults to unavailable, which is the safe direction: a control that is
   * hidden when it would have worked is a smaller failure than one that is
   * offered and 403s.
   */
  canContinue?: { available: boolean; reason: string };
}

/**
 * A worker's console output, fetched when a person asks for it.
 *
 * Deliberately NOT built on `DocModal`, which embeds a server-rendered document
 * in an iframe and owns the fetch. This renders a live JSON payload it re-polls,
 * as text rather than as HTML — and as TEXT is the security property: agent
 * output is arbitrary bytes, frequently including markup it was asked to write,
 * and putting it through a renderer would execute whatever a log happened to
 * contain. React escapes it here by construction.
 *
 * The full path is shown rather than linked. The board has no route that serves
 * a file off disk and must not grow one for this — the path is for copying into
 * a terminal, where a pager handles a 60 MB log far better than a browser can.
 */
export function WorkerLogModal({
  branch,
  onClose,
  fetcher = fetch,
  now,
  canContinue,
}: WorkerLogModalProps) {
  const [log, setLog] = useState<WorkerLog | null>(null);
  const [panel, setPanel] = useState<AgentPanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  // Whether the reader is parked at the bottom. A log that jumps to the end
  // while someone is reading further up is a panel that fights its reader, so
  // the auto-scroll below is conditional on them not having scrolled away.
  const pinned = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetcher(`/api/worker-log?branch=${encodeURIComponent(branch)}`)
        .then(async (res) => {
          // A 404 carries a real answer (`no-worktree`) rather than an HTTP
          // failure, so it is parsed like any other reply. Only a body that is
          // not the contract at all becomes `error`.
          const body = (await res.json()) as WorkerLog | { error: string };
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
    // The whole reason this is on-demand: closing the panel ends the traffic.
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [branch, fetcher]);

  /**
   * The facts about the run, polled on the same cadence as the log.
   *
   * **A SEPARATE request from the log, deliberately.** The two answer different
   * questions from different sources — one reads a file in the worktree, the
   * other reads the pulse, the process table and the transcript — and a failure
   * in either must not blank the other. A worker whose log is unreadable still
   * has a pid and an uptime worth showing, and a transcript that has moved on
   * must not cost the reader their log.
   *
   * Polled rather than fetched once because uptime, context and last activity
   * all move while the panel is open; a snapshot taken at open would be quietly
   * wrong by the time anyone read it. The same close-stops-the-traffic rule
   * applies — see LOG_POLL_MS.
   *
   * A failed panel fetch sets NOTHING. It does not touch `error`, which belongs
   * to the log below: the panel's own answer to *I could not read this* is to
   * show less, and a network blip is one more unreadable source.
   */
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetcher(`/api/agent-panel?branch=${encodeURIComponent(branch)}`)
        .then(async (res) => {
          const body = (await res.json()) as AgentPanel | { error: string };
          if (cancelled || 'error' in body) return;
          setPanel(body);
        })
        .catch(() => {
          // Silence is the contract. See above.
        });
    };
    load();
    const timer = setInterval(load, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [branch, fetcher]);

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
        aria-label={`Agent: ${branch}`}
        data-worker-log
        data-agent-panel
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-baseline gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Agent</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
            {branch}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </header>

        {/* WHAT IS KNOWN ABOUT THE RUN, above the log it produced. Each field
            omits independently when its source could not be read — see
            AgentPanelFacts, where that rule is structural rather than repeated. */}
        <AgentPanelFacts panel={panel} now={now} />

        {/* THE TRUNCATION SAYS SO. A tail presented as a whole log is the same
            defect this board keeps removing — it reads as "the worker printed
            this much" when the fact is "the worker printed far more". The full
            size is named beside it so the reader knows what they are missing,
            and the path below is how they get the rest. */}
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
            // Three reasons, three sentences — never one blank panel.
            <span data-log-miss={log.reason} className="text-slate-500 dark:text-slate-400">
              {missWord(log.reason)}
            </span>
          ) : log.text === '' ? (
            // A successful read of nothing, said as such. See EMPTY_LOG_WORD.
            <span data-log-empty className="text-slate-500 dark:text-slate-400">
              {EMPTY_LOG_WORD}
            </span>
          ) : (
            log.text
          )}
        </pre>

        {/* THE ONE ACTING CONTROL ON THIS PANEL, and it is offered only for a
            worker the SCAN reports as `waiting`.
            
            Keyed on the scan's verdict rather than on a check of this panel's
            own — `plot-worker-state.sh` decides liveness once, and a second
            opinion computed here is exactly the duplication that had six states
            drifting in two places. A branch in any other state has nothing
            waiting on an answer, and the route would refuse it anyway; hiding
            the control is how that refusal is stated before it is clicked.
            
            The panel still ACTS ON NOTHING ELSE. This wave is the only acting
            wave in a deliberately read-only sprint, and the blast radius is
            continuation. */}
        {panel?.ok && panel.worker === 'waiting' && (
          <ContinueWithAnAnswer
            branch={branch}
            available={canContinue?.available ?? false}
            unavailableReason={canContinue?.reason}
            fetcher={fetcher}
          />
        )}

        {/* The path, always — including for the misses that know one. It is the
            answer to "then where should I look", and for `no-log` it is the
            only actionable thing the panel can offer. */}
        {log?.path && (
          <footer className="shrink-0 truncate border-t border-slate-200 px-4 py-2 font-mono text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
            {log.path}
          </footer>
        )}
      </div>
    </div>
  );
}
