import type { PortResult } from '../port-result.js';
import type { BudgetEntry } from '../entities/budget.js';

/**
 * Reads and appends the budget record — what this COMPUTER has spent, per
 * `(connector, account, bucket)`.
 *
 * WHY A PORT AND NOT A FIELD ON `Host`. A port exists because an entity's truth
 * lives somewhere the domain may not look, and this truth lives in a file
 * outside every checkout. `Host` answers *what will this connector still
 * answer?* — one process asking one connector. This answers *what has this
 * computer already spent?*, across every process on it, including an operator's
 * own `gh` calls and eleven shell scripts that are not the board. Those are two
 * sources: one is foreign and remote, the other is local and shared.
 *
 * THE RECORD IS THE COMPUTER'S, NOT THE MACHINE'S. `Machine` is one per Plot
 * instance, keyed by `repoRoot + scriptsDir`, and several run on one computer.
 * A rate limit is an ACCOUNT fact. Measured 2026-09-01: two GitHub checkouts on
 * this computer share the account `jwloka`, so a per-checkout record would let
 * each read a full 5000 while the other spent it — the over-spend the record
 * exists to prevent, reproduced by storing it in the wrong place. So the
 * adapter resolves a path that does not depend on which checkout is asking.
 *
 * APPEND-ONLY, AND THEREFORE LOCK-FREE. There is no read-modify-write to
 * interleave, so several instances may write at once. That property rests on
 * one measurement and not on a convention: concurrent `O_APPEND` is atomic only
 * below `PIPE_BUF`, which `getconf PIPE_BUF /` reports as **512** on this
 * fleet's macOS machines, so `MAX_LINE_BYTES` is the format's cap and
 * `withinLineCap` is what an appender checks.
 *
 * IT NAMES NO FILE, NO DIRECTORY AND NO FORMAT. Where the record lives is the
 * adapter's business; that it is one per computer is the port's. `location` is
 * the one exception, and it reports rather than decides — it exists so an
 * operator can be told where to look and so a test can prove two checkouts
 * resolve the same place.
 */
export interface BudgetRecord {
  /**
   * Where this computer's record lives.
   *
   * REPORTS, NEVER DECIDES. Two Plot instances on one computer must resolve the
   * same answer here, and the one assertion this slice exists for is exactly
   * that — a test using a single checkout cannot see the bug.
   *
   * @returns an absolute path; `failed` where no home directory can be resolved.
   */
  location(): PortResult<string>;

  /**
   * Appends one line.
   *
   * Refuses a line that would exceed the atomic-append cap rather than writing
   * it: a torn line loses the concurrent writer's line too, so refusing one
   * spend is cheaper than corrupting another's. A refusal is `failed`, because
   * the record could have been asked and the line could not be written.
   *
   * @param entry - what was spent, and what the response said.
   * @returns nothing on success.
   */
  append(entry: BudgetEntry): Promise<PortResult<void>>;

  /**
   * Reads every line the record holds, in file order.
   *
   * A MISSING FILE IS AN EMPTY RECORD, not a failure. `unknown` and *absent*
   * are the same answer, which is what lets a fresh checkout work with no
   * ceremony and keeps a deleted record from being a fault. A file that cannot
   * be read for any other reason is `failed`, and a caller must not read that
   * as an empty window.
   *
   * Returns raw lines rather than entries because a line that cannot be decoded
   * is a fact the window rules count — see `readWindow`'s `unreadable`.
   *
   * @returns the record's lines, oldest first.
   */
  lines(): Promise<PortResult<readonly string[]>>;

  /**
   * Replaces the record with the lines that survived the window.
   *
   * THE ONE WRITE THAT IS NOT AN APPEND, and the only reason it is licensed:
   * the reader has already established which lines are dead, and a separate
   * cleaner would re-read everything to learn the same thing and would need a
   * lock the append-only design exists to avoid.
   *
   * At most once per reset, and a failure costs disk rather than correctness —
   * the window filter is what makes the answer right. So a caller that gets
   * `failed` here carries on rather than refusing to spend.
   *
   * @param keep - the surviving entries, from `survivors`.
   * @returns nothing on success.
   */
  truncate(keep: readonly BudgetEntry[]): Promise<PortResult<void>>;
}
