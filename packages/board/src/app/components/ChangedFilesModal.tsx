import { useEffect } from 'react';

/**
 * The changed-file list a failing check carries, on demand.
 *
 * **THE PANEL THAT FETCHES NOTHING**, and that is the whole reason it is not a
 * `WorkerLogModal` or a `DispatchLogModal`. Both of those exist because their
 * content is not on the row: a worker's console and a dispatcher's log live in
 * files, so a panel has to go and read one. `changedPaths` is already in the
 * pulse that drew the row — the plan's rule is explicit that the menu shows only
 * what the pulse already carries, and that where a detail is absent the menu
 * links out to the host rather than fetching it. So there is no endpoint here,
 * no `useEffect` that loads, no poll timer, and no loading state to render: the
 * paths arrive as a prop and the panel prints them.
 *
 * That absence is worth stating rather than leaving to be noticed, because the
 * neighbouring two panels make the opposite shape look like the house style. The
 * scan's cost went from 279 s to 20 s across #262 and #264, and a per-click fetch
 * would put a second cost on the same data path for one reader's convenience.
 *
 * **Why a panel at all, when the row could simply print them.** It did print
 * them, until 2026-08-20: six paths wrapped across the row as prose, which every
 * reader scrolled past so the occasional reader who wanted them did not have to
 * click. A path list is unbounded and consulted rarely — the two properties that
 * together mean *reachable*, not *printed*.
 */
export function ChangedFilesModal({
  branch,
  paths,
  onClose,
}: {
  branch: string;
  /**
   * What the branch changes, verbatim from the pulse.
   *
   * Non-empty by construction: `offersChangedFiles` gates the menu item on
   * `length > 0`, so an empty list yields no item and this never mounts onto
   * nothing. The panel does not re-check — a second guard here would be a
   * different answer to the same question, and the two would drift.
   */
  paths: readonly string[];
  onClose: () => void;
}) {
  // ESCAPE CLOSES IT, the same as the two log panels. A reader who opened this
  // from a keyboard has no scrim to click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Files changed on ${branch}`}
        data-changed-files
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-baseline gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Changed files
          </span>
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

        {/* EVIDENCE, NOT A VERDICT — and nothing here concludes from it. The
            contract is explicit that no heuristic maps a failing step to a
            changed path: that table is unmaintained by construction and goes
            silently wrong the first time a workflow is restructured. So the
            paths are listed in the order the host gave them, unsorted and
            unhighlighted, and the reader is the one who joins them to the step
            the row names. */}
        <ul
          data-changed-files-body
          className="min-h-0 flex-1 overflow-auto bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200"
        >
          {paths.map((path) => (
            <li key={path} className="break-all">
              {path}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
