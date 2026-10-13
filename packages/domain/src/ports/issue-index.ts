import type { PortResult } from '../port-result.js';
import type { IssueIndex } from '../entities/issue-index.js';

/**
 * Keeps what the tracker last said about a repository's open issues, across
 * processes.
 *
 * **THE SAME SPLIT `PrIndexStore` DRAWS, AND FOR THE SAME REASON.** This
 * spends no remote budget — it reads and writes one local file — so it sits
 * beside `refs`/`plan-store`/`pr-index` rather than folding into a connector.
 * The store is the checkout's: resolved from the COMMON git dir, never from
 * `--show-toplevel`, so a dispatch worktree reaped by `plot-reap.sh` never
 * takes the store down with it.
 *
 * **ONE FILE, NOT ONE PER CONNECTOR.** A repository names exactly one tracker
 * — `Tracker` is one config key — so unlike the PR store, which serves one
 * file per git-host connector a repository could carry, the issue store never
 * needs to key by connector in its path.
 *
 * **NOTHING HERE DECIDES.** The port reads and writes; `issue-refresh.ts` says
 * what a pass means. The one writer is `encodeIssueIndex`'s one caller.
 */
export interface IssueIndexStore {
  /**
   * Where this checkout's issue store lives.
   *
   * @returns an absolute path; `failed` where no common git dir can be resolved.
   */
  location(): Promise<PortResult<string>>;

  /**
   * Reads the store.
   *
   * **A MISSING, EMPTY, UNPARSEABLE OR UNRECOGNISED FILE IS `answered(null)`,
   * NOT `failed`.** All four mean the same thing to a caller — there is
   * nothing to start from — and that is the state of every checkout no pass
   * has written yet. `failed` is reserved for a store that exists and could
   * not be read at all.
   *
   * @returns the store, `null` where there is none to read, or `failed`.
   */
  read(): Promise<PortResult<IssueIndex | null>>;

  /**
   * Writes the store, replacing whatever was there.
   *
   * **A FAILED WRITE IS A VALUE, NEVER A THROW.** A read-only filesystem or a
   * full disk must cost the pass time and not answers.
   *
   * @param index - the store to write.
   * @returns nothing on success; `failed` where the write did not land.
   */
  write(index: IssueIndex): Promise<PortResult<void>>;
}
