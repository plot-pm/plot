import { isAbsolute, join, resolve } from 'node:path';

import {
  defaultBranchFile,
  hostShell,
  prIndexFile,
  refsGit,
  refsRemoteGit,
  repairRecordFile,
  revertGit,
  scriptsShell,
  ticketRecordFile,
  trackerForIssues,
  treesGit,
} from '@plot-pm/domain/adapters';
import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import { startReview } from '@plot-pm/domain/adapters/review-start/review-start-node';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { declaredRuns, foldRuns } from '@plot-pm/domain/rules/default-branch';
import { prNumberOf, type RedMainCandidate } from '@plot-pm/domain/rules/repair';

import { pidAlive } from './fleet-run.js';
import type { RevertWorld } from './revert-start.js';

/** What the production world needs beyond the repository's own adapters. */
export interface RevertWorldOptions {
  repoRoot: string;
  scriptsDir: string;
  /** The CI connector fleetd already built. */
  build: BuildPort;
  /** Runs one host call inside a host slot where the CI system is GitHub Actions. */
  slot: RevertWorld['slot'];
  /** Sends one message to a person; resolves whether or not it was delivered. */
  notify: RevertWorld['notify'];
  /** The configured `Worktree root`, `''` for the default. */
  worktreeRoot: string;
  checksWaitMs: number;
  mainRepairBoundMs: number;
  checks: readonly string[];
}

/**
 * Builds the world {@link repairRevertTick} acts through, from the repository's
 * own adapters.
 *
 * The claim is `refsRemoteGit(...).claimBranch` against the default branch's
 * remote tip; the desk is `<Worktree root>/desk-<branch with / as ->`, cut
 * from `origin/<branch>` after the claim. A candidate's `touchesState` is true
 * where the commit changes any file under the `Plan directory` or the
 * `Sprint directory`.
 *
 * @param options - the paths, the connector and the bounds.
 * @returns the world.
 */
export const revertWorldOf = (options: RevertWorldOptions): RevertWorld => {
  const context = { repoRoot: options.repoRoot, scriptDir: options.scriptsDir };
  const refs = refsGit(context);
  const remote = refsRemoteGit(context);
  const trees = treesGit(context);
  const host = hostShell(context);
  const scripts = scriptsShell(context);
  const root = options.worktreeRoot === '' ? '.worktrees' : options.worktreeRoot;
  const deskPath = (branch: string): string =>
    join(isAbsolute(root) ? root : resolve(options.repoRoot, root), `desk-${branch.replace(/\//g, '-')}`);

  const stateDirs = async (): Promise<string[]> => {
    const asked = await Promise.all([
      scripts.config('Plan directory', 'docs/plans/'),
      scripts.config('Sprint directory', 'docs/sprints/'),
    ]);
    return asked.flatMap((answer) => (answer.ok && answer.value.trim() !== '' ? [answer.value.trim().replace(/\/?$/, '/')] : []));
  };

  const tracker = async (): Promise<Tracker> => {
    const [declared, backend] = await Promise.all([scripts.config('Tracker', ''), host.backend()]);
    return trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context);
  };

  return {
    reading: async () => {
      const read = await defaultBranchFile(options.repoRoot).read();
      return read.ok ? read.value : null;
    },
    repair: repairRecordFile(options.repoRoot),
    refs,
    build: options.build,
    host,
    revert: revertGit(context),
    candidate: async (commit): Promise<RedMainCandidate> => {
      const number = prNumberOf(commit.subject);
      const pr = number === null ? null : await options.slot(() => host.prState(number));
      const found = pr !== null && pr.ok ? pr.value : null;
      const defaultBranch = await refs.defaultBranch();
      const branch = defaultBranch.ok ? defaultBranch.value : 'main';
      const runs = await options.slot(() => options.build.runsForSha(branch, commit.sha));
      const files = await refs.commitFiles(commit.sha);
      const dirs = await stateDirs();
      return {
        ...commit,
        prMerged: found !== null && found.state === 'MERGED',
        hostMergeCommit: found !== null && found.state === 'MERGED' ? found.mergeCommit : '',
        settledRed: runs.ok && foldRuns(declaredRuns(runs.value, options.checks)) === 'red',
        touchesState: !files.ok || files.value.some((file) => dirs.some((dir) => file.startsWith(dir))),
      };
    },
    baseSha: async () => {
      const base = await refs.defaultBranch();
      if (!base.ok) return null;
      const tip = await remote.remoteSha(base.value);
      return tip.ok && tip.value !== 'unknown' ? tip.value.sha : null;
    },
    claim: async (branch, baseSha) => {
      const claimed = await remote.claimBranch(branch, baseSha);
      return claimed.ok ? claimed.value : 'failed';
    },
    deskOf: async (branch) => {
      const listed = await trees.list();
      if (!listed.ok) return null;
      return listed.value.find((tree) => tree.branch === branch)?.path ?? null;
    },
    makeDesk: async (branch) => {
      const fetched = await trees.fetch(options.repoRoot, branch);
      if (!fetched.ok) return null;
      const desk = deskPath(branch);
      const added = await trees.addBranch(desk, branch, `origin/${branch}`);
      return added.ok ? desk : null;
    },
    push: async (desk, branch) => (await trees.push(desk, branch)).ok,
    reviewFailed: async (pr) => {
      const backend = await host.backend();
      if (!backend.ok) return false;
      const store = await prIndexFile({ cwd: options.repoRoot }).read(backend.value);
      if (!store.ok || store.value === null) return false;
      return store.value.rows.some((row) => row.number === pr && row.state === 'OPEN' && row.plotReview === 'failure');
    },
    startReview: async (pr, head) =>
      startReview(pr, head, {
        repoRoot: options.repoRoot,
        script: join(options.scriptsDir, 'board', 'plot-review.mjs'),
        cwd: options.repoRoot,
        logFile: join(options.repoRoot, '.plot', 'state', 'revert-review.log'),
        detached: detachedNode(),
        pidAlive: (pid) => pidAlive(pid),
        limit: 1,
        mode: 'review',
        now: Date.now(),
      }).started,
    tickets: ticketRecordFile(options.repoRoot),
    tracker: {
      issueOpen: async (input) => (await tracker()).issueOpen(input),
      issueComment: async (id, body) => (await tracker()).issueComment(id, body),
    },
    notify: options.notify,
    slot: options.slot,
    now: Date.now,
    checksWaitMs: options.checksWaitMs,
    mainRepairBoundMs: options.mainRepairBoundMs,
    checks: options.checks,
  };
};
