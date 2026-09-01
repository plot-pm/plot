import type { Worktree } from '../../entities/worktree.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type { Trees } from '../../ports/trees.js';
import { asLines, asText, runProcess, runScript, runScriptSync } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** Thirty-two megabytes: 22 worktrees' porcelain and status in one reply. */
const STATUS_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Reads `git worktree list --porcelain` into worktrees.
 *
 * Cleanliness is not answered here: the porcelain listing says nothing about
 * uncommitted work, and defaulting it to `true` would report every tree as
 * having nothing on the floor. It defaults to `false` — a tree that was not
 * checked reports unclean, so unlanded work stays visible.
 *
 * @param stdout - the porcelain listing.
 * @returns one worktree per record, the main checkout first as git lists it.
 */
const worktreesOf = (stdout: string): Worktree[] => {
  const trees: Worktree[] = [];
  let current: { path: string; branch: string; prunable: boolean } | null = null;

  const flush = () => {
    if (current === null) return;
    trees.push({
      path: current.path,
      branch: current.branch,
      isMain: trees.length === 0,
      clean: false,
      agentSession: null,
      prunable: current.prunable,
    });
    current = null;
  };

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      current = { path: line.slice('worktree '.length), branch: '', prunable: false };
    } else if (line.startsWith('branch ') && current !== null) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line.startsWith('prunable') && current !== null) {
      current.prunable = true;
    }
  }
  flush();
  return trees;
};

/**
 * Reads the worktrees on this machine through git.
 *
 * @param context - where the repository is.
 * @returns a `Trees` backed by `git worktree` and the filesystem.
 */
export const treesGit = (context: ShellContext): Trees => {
  const inRepo = { cwd: context.repoRoot };
  const workerState = scriptPath(context, 'plot-worker-state.sh');

  const isClean = async (path: string): Promise<PortResult<boolean>> => {
    const run = await runProcess('git', ['-C', path, 'status', '--porcelain'], inRepo);
    return run.code === 0 ? answered(run.stdout.trim().length === 0) : answered(false);
  };

  const list = (): Promise<PortResult<readonly Worktree[]>> =>
    runScript('git', ['worktree', 'list', '--porcelain'], worktreesOf, inRepo);

  return {
    list,
    isClean,

    forBranch: async (branch) => {
      const all = await list();
      if (!all.ok) return all as PortResult<Worktree | null>;
      return answered(all.value.find((tree) => tree.branch === branch) ?? null);
    },

    // `git -C <path>` rather than `cwd`, so an unreadable checkout is reported
    // by git's own exit code instead of by `execFile` failing to chdir — the
    // two arrive as different errors and only one of them says which path.
    currentBranch: (path) =>
      runScript('git', ['-C', path, 'branch', '--show-current'], asText, inRepo),

    markers: (path, prefix) =>
      runScript(
        'bash',
        ['-c', 'ls -1 "$1" 2>/dev/null | grep "^$2" || true', 'bash', path, prefix],
        asLines,
        inRepo,
      ),

    // `plot_worker_dirty` is SOURCED and called, never reimplemented here. The
    // three exclusion patterns it applies are stated once in
    // `plot-worker-state.sh`, where `plot-fleet-scan.sh` and
    // `plot-worker-monitor.sh` already read them; a second copy in TypeScript
    // is a second thing to keep in step, and the drift would show up as a
    // monitor that reads its own findings file as the agent working.
    dirtyPaths: (path) =>
      runScript(
        'bash',
        ['-c', '. "$1" && plot_worker_dirty "$2"', 'bash', workerState, path],
        asLines,
        inRepo,
      ),
    prune: async () => {
      const run = await runProcess('git', ['worktree', 'prune'], inRepo);
      return run.code === 0 ? answered(undefined) : failed<void>();
    },

    add: async (path, start) => {
      const run = await runProcess(
        'git',
        ['worktree', 'add', '--detach', path, start],
        inRepo,
      );
      return run.code === 0 ? answered(undefined) : failed<void>();
    },

    // `git -C <path>`, so an unreadable checkout is reported by git's own exit
    // code rather than by the spawn failing to chdir — the two arrive as
    // different errors and only one of them says which path.
    statusSync: (path) =>
      runScriptSync('git', ['-C', path, 'status', '--porcelain'], (stdout) => stdout, {
        ...inRepo,
        maxBuffer: STATUS_MAX_BUFFER,
      }),

    listSync: () =>
      runScriptSync('git', ['worktree', 'list', '--porcelain'], worktreesOf, {
        ...inRepo,
        maxBuffer: STATUS_MAX_BUFFER,
      }),
  };
};
