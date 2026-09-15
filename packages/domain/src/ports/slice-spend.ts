import type { PortResult } from '../port-result.js';
import type { SliceSpend } from '../entities/slice-spend.js';
import type { TranscriptLine } from '../rules/slice-tokens.js';

/**
 * Reads a desk's transcripts and keeps the per-slice spend record.
 *
 * **WHY A PORT AND NOT A FIELD ON AN EXISTING ONE.** `Machine` answers *what is
 * this computer doing now*; `BudgetRecord` answers *what has this computer
 * spent against a remote account's rate limit*. This answers *what did one
 * finished slice cost in tokens*, from a source neither of them reaches: the
 * runtime's transcript directory under `~/.claude/`, which is outside every
 * checkout and belongs to no repository.
 *
 * **THE RECORD IS THE CHECKOUT'S, NOT THE COMPUTER'S — and that is the opposite
 * of `BudgetRecord`, deliberately.** A rate limit is an ACCOUNT fact shared by
 * every checkout on the computer; a slice's spend is a fact about one
 * repository's branch, and two checkouts of different projects share no
 * branches. So the path is resolved per checkout — from the COMMON git dir, so
 * every dispatch worktree of one repository shares one record.
 *
 * **`--git-common-dir`, NEVER `--show-toplevel`.** In a linked worktree the
 * latter returns the WORKTREE, and `plot-reap.sh` runs
 * `git worktree remove --force` over exactly those. Measured 2026-09-15: 8
 * dispatch desks, 0 holding a `.plot/state/`. A record written to the desk is
 * destroyed by the reap, on the machine that measured it, with every gate
 * green. `plot-install-commit-record.sh:42-43` already solved this and states
 * the reason; this inherits the rule rather than re-deriving it.
 *
 * **APPEND-ONLY, WRITTEN ONCE PER SLICE.** A second run writes a second line
 * rather than mutating the first, which keeps each line a measurement with a
 * timestamp rather than a running total nobody can place in time.
 */
export interface SliceSpendRecord {
  /**
   * Where this checkout's record lives.
   *
   * REPORTS, NEVER DECIDES. It exists so an operator can be told where to look,
   * and so a test can prove a dispatch desk and the main checkout resolve the
   * same file — the one assertion a test run only in the main checkout cannot
   * make.
   *
   * @returns an absolute path; `failed` where no common git dir can be
   *   resolved.
   */
  location(): PortResult<string>;

  /**
   * Every main session of a desk, parsed, in file order within each.
   *
   * **`agent-*` FILES ARE EXCLUDED AND EVERY OTHER SESSION IS INCLUDED.** A
   * subagent's transcript belongs to no one — the half of `spend.ts:42-50` that
   * transfers — while a desk's several main sessions all carry the branch's
   * turns, which is the half that does not. Measured: 40 of 41 desks hold more
   * than one.
   *
   * @param worktree - the desk whose transcripts to read.
   * @returns one array of lines per session; `answered([])` where the directory
   *   holds none, `failed` where it could not be read at all.
   */
  sessions(worktree: string): Promise<PortResult<readonly (readonly TranscriptLine[])[]>>;

  /**
   * Appends one finished slice's record.
   *
   * @param record - what the slice spent.
   * @returns nothing on success.
   */
  append(record: SliceSpend): Promise<PortResult<void>>;

  /**
   * The record's raw lines, in file order.
   *
   * A MISSING FILE IS AN EMPTY RECORD, not a failure: absence is the state of
   * every checkout that has not measured a slice yet. Every other error stays
   * `failed`, so a caller never reads an unreadable file as an empty one.
   *
   * @returns the lines; `failed` where the record exists and could not be read.
   */
  lines(): Promise<PortResult<readonly string[]>>;
}
