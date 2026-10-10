import { answered, type PortResult } from '../../port-result.js';
import type { RemoteTipReading } from '../../rules/checks-verdict.js';
import type { RemoteHeadAnswer, RemoteShaReading } from '../../ports/refs.js';
import { runProcess, type RunOptions, type ScriptRun } from '../run-script.js';
import type { ShellContext } from '../scripts.js';

/** How long the remote read may take before it is read as `unknown`, in milliseconds. */
const REMOTE_TIP_TIMEOUT_MS = 10_000;

/** Runs one command; the test seam, defaulting to {@link runProcess}. */
export type RunCommand = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<ScriptRun>;

/** How long the claim fetch and its `ls-remote` fallback may each take, in milliseconds. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Reads a branch on `origin` over the network: its live tip, and, after a
 * rejected claim push, whether origin holds it.
 *
 * Kept apart from `refs-git.ts` on purpose: the board's `Refs` instance must
 * carry no call over the wire (`no-network.test.ts`), so the loop's wiring
 * composes this operation onto it: `{ ...refsGit(c), ...refsRemoteGit(c) }`.
 *
 * @param context - the repository to ask from.
 * @param run - how a command is run; defaults to the process runner.
 * @returns `remoteTip`: `pushed` where the remote tip equals the given
 *   commit, `other` where a different commit sits there, and `unknown` where
 *   the read failed, timed out, or found no such branch. `fetchRemoteHead`:
 *   `present` where the fetch succeeded, `absent` where `ls-remote` found no
 *   such branch, and `unknown` otherwise. `remoteSha`: the sha at the full ref
 *   `refs/heads/<branch>`, or `unknown`.
 */
export const refsRemoteGit = (
  context: ShellContext,
  run: RunCommand = runProcess,
): {
  remoteTip: (branch: string, pushedSha: string) => Promise<PortResult<RemoteTipReading>>;
  fetchRemoteHead: (branch: string) => Promise<PortResult<RemoteHeadAnswer>>;
  remoteSha: (branch: string) => Promise<PortResult<RemoteShaReading>>;
} => ({
  fetchRemoteHead: async (branch) => {
    const options = { cwd: context.repoRoot, timeoutMs: FETCH_TIMEOUT_MS };
    const fetched = await run('git', ['fetch', '-q', 'origin', branch], options);
    if (fetched.code === 0) return answered<RemoteHeadAnswer>('present');
    const listed = await run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], options);
    if (listed.code !== 0) return answered<RemoteHeadAnswer>('unknown');
    return answered<RemoteHeadAnswer>(listed.stdout.trim() === '' ? 'absent' : 'unknown');
  },

  remoteSha: async (branch) => {
    // THE FULL REF, matched as `remoteTip` does. A failed or timed-out read is
    // `unknown`: a failure to observe is not a new commit.
    const ref = `refs/heads/${branch}`;
    const result = await run('git', ['ls-remote', 'origin', ref], {
      cwd: context.repoRoot,
      timeoutMs: REMOTE_TIP_TIMEOUT_MS,
    });
    if (result.code !== 0) return answered<RemoteShaReading>('unknown');
    const line = result.stdout.split('\n').find((l) => l.split('\t')[1]?.trim() === ref);
    const sha = line?.split('\t')[0]?.trim();
    return answered<RemoteShaReading>(sha ? { sha } : 'unknown');
  },

  remoteTip: async (branch, pushedSha) => {
    // THE FULL REF, asked and matched: a bare `x` pattern also matches
    // `refs/heads/feature/x`, whose tip says nothing about `x`.
    const ref = `refs/heads/${branch}`;
    const result = await run('git', ['ls-remote', 'origin', ref], {
      cwd: context.repoRoot,
      timeoutMs: REMOTE_TIP_TIMEOUT_MS,
    });
    // A failed or timed-out read is `unknown`, never `other`: a failure to
    // observe is not evidence the tip moved.
    if (result.code !== 0) return answered<RemoteTipReading>('unknown');
    const line = result.stdout.split('\n').find((l) => l.split('\t')[1]?.trim() === ref);
    const tip = line?.split('\t')[0]?.trim();
    if (!tip) return answered<RemoteTipReading>('unknown');
    return answered<RemoteTipReading>(tip === pushedSha ? 'pushed' : 'other');
  },
});
