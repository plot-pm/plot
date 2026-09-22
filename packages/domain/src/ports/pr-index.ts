import type { PortResult } from '../port-result.js';
import type { PrIndex } from '../entities/pr-index.js';

/**
 * Keeps what the git host last said about a repository's pull requests, across
 * processes.
 *
 * **WHY A PORT AND NOT A FIELD ON `Host`.** `Host` is a CONNECTOR — it has an
 * account, a token, a rate limit and a transport choice, and every one of its
 * operations spends a remote budget. This spends none: it reads and writes one
 * local file, and `refs`/`plan-store` are the adapters it sits beside. Folding
 * a filesystem into the connector would make a local read implement the
 * rate-limit contract that only a remote service has.
 *
 * **THE STORE IS THE CHECKOUT'S, NOT THE COMPUTER'S** — the split
 * `SliceSpendRecord` draws and for the same reason. A rate limit is an ACCOUNT
 * fact shared by every checkout; the PRs of a repository are that repository's,
 * and two checkouts of different projects share none. So the path is resolved
 * per checkout, from the COMMON git dir so every dispatch worktree of one
 * repository reads one store.
 *
 * **`--git-common-dir`, NEVER `--show-toplevel`.** In a linked worktree the
 * latter returns the DESK, and `plot-reap.sh` runs `git worktree remove
 * --force` over exactly those. A store written to a desk is destroyed by the
 * reap on the machine that measured it, with every gate green, because a test
 * run in the main checkout cannot see the difference.
 *
 * **ONE FILE PER CONNECTOR.** A checkout with remotes on two hosts holds two
 * accounts answering about two repositories, and one file would let the second
 * refresh delete the first's rows as PRs the host no longer lists.
 *
 * **NOTHING HERE DECIDES.** The port reads and writes; `foldPrIndex` says what
 * a refresh means. A caller that skipped the rule and wrote the host's rows
 * straight through would replace on a partial answer, which is the one move the
 * store may not make.
 */
export interface PrIndexStore {
  /**
   * Where this checkout's store for one connector lives.
   *
   * REPORTS, NEVER DECIDES — the property `SliceSpendRecord.location` has. It
   * exists so an operator can be told where to look, and so a test can prove a
   * dispatch desk and the main checkout resolve the same file: the one
   * assertion a test run only in the main checkout cannot make.
   *
   * @param connector - which connector's store to name.
   * @returns an absolute path; `failed` where no common git dir can be resolved.
   */
  location(connector: string): Promise<PortResult<string>>;

  /**
   * Reads one connector's store.
   *
   * **A MISSING, EMPTY, UNPARSEABLE OR UNRECOGNISED FILE IS `answered(null)`,
   * NOT `failed`.** All four mean the same thing to the caller — there is
   * nothing to start from, so ask the host for everything — and that is the
   * state of every checkout that has not refreshed yet. `failed` is reserved
   * for a store that exists and could not be read at all, which a caller may
   * want to report rather than silently absorb.
   *
   * @param connector - which connector's store to read.
   * @returns the store, `null` where there is none to read, or `failed`.
   */
  read(connector: string): Promise<PortResult<PrIndex | null>>;

  /**
   * Writes one connector's store, replacing whatever was there.
   *
   * **A FAILED WRITE IS A VALUE, NEVER A THROW.** A read-only filesystem or a
   * full disk must cost the board time and not answers: the caller carries on
   * with the map it already has. A port that threw would make the store
   * required, which is the one thing it may not be.
   *
   * @param connector - which connector's store to write.
   * @param index - the store to write, as `foldPrIndex` decided it.
   * @returns nothing on success; `failed` where the write did not land.
   */
  write(connector: string, index: PrIndex): Promise<PortResult<void>>;
}
