import type { Worktree } from '../../entities/worktree.js';
import { answered, type PortResult } from '../../port-result.js';
import type { Trees } from '../../ports/trees.js';
import { asLines, runProcess, runScript } from '../run-script.js';
import type { ShellContext } from '../scripts.js';

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

    markers: (path, prefix) =>
      runScript(
        'bash',
        ['-c', 'ls -1 "$1" 2>/dev/null | grep "^$2" || true', 'bash', path, prefix],
        asLines,
        inRepo,
      ),
  };
};
