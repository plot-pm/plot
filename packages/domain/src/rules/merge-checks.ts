import type { CheckRun } from '../entities/pr.js';

/** What the named checks read on the head. */
export type MergeChecksVerdict =
  | { readonly read: 'green' }
  | {
      readonly read: 'pending' | 'failing';
      /** The first named check that is not a completed success. */
      readonly name: string;
      /** What that check showed: `no run`, `unfinished`, or the host's status or conclusion word. */
      readonly seen: string;
    };

/** The status words of a check run or status context that has not finished; `''` is one of them. */
const UNFINISHED = ['', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING', 'EXPECTED'];

/**
 * Whether one rollup item is a completed success.
 *
 * @param run - the item.
 * @returns `true` for a check run completed with `SUCCESS` and a status context whose state is `SUCCESS`.
 */
const succeeded = (run: CheckRun): boolean =>
  run.conclusion === '' ? run.status === 'SUCCESS' : run.conclusion === 'SUCCESS' && (run.status === 'COMPLETED' || run.status === '');

/**
 * Whether every named check has a completed success on the head.
 *
 * Reads the names in order and answers for the first that fails: a name with
 * no item in `runs` reads `pending` (`no run`), and a name with any unfinished
 * item reads `pending`. Of the completed items carrying a name, those with the
 * latest `at` decide: one that completed with any conclusion other than
 * `SUCCESS` (`SKIPPED` and `NEUTRAL` included) reads `failing`. Items with no
 * `at` sort before every dated item, so where none is dated every item decides.
 *
 * @param runs - the rollup items on the head; absent where the host reported none.
 * @param names - the check names a merge requires; empty requires none.
 * @returns `green`, or the first named check that is not a completed success and what it showed.
 */
export const mergeChecksVerdict = (runs: readonly CheckRun[] | undefined, names: readonly string[]): MergeChecksVerdict => {
  for (const name of names) {
    const named = (runs ?? []).filter((run) => run.name === name);
    if (named.length === 0) return { read: 'pending', name, seen: 'no run' };
    const open = named.find((run) => run.conclusion === '' && UNFINISHED.includes(run.status));
    if (open !== undefined) return { read: 'pending', name, seen: open.status === '' ? 'unfinished' : open.status };
    const latest = named.reduce((at, run) => ((run.at ?? '') > at ? (run.at ?? '') : at), '');
    const bad = named.filter((run) => (run.at ?? '') === latest).find((run) => !succeeded(run));
    if (bad !== undefined) return { read: 'failing', name, seen: bad.conclusion === '' ? bad.status : bad.conclusion };
  }
  return { read: 'green' };
};
