import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { Worktree } from '../../entities/worktree.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type { Trees } from '../../ports/trees.js';
import type { TreePresence } from '../../rules/reapable.js';
import { asLines, asText, runProcess, runScript, runScriptSync } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** Thirty-two megabytes: 22 worktrees' porcelain and status in one reply. */
const STATUS_MAX_BUFFER = 32 * 1024 * 1024;

/** The previous slice's bookkeeping, removed before a desk is reused — matches `reset_desk` step 0. */
const DECLARATION_FILE_NAME = '.plot-worker.envelope.json';

/** The build gate's own account, removed with the declaration — matches `reset_desk` step 0. */
const CORRECTION_FILE_NAME = 'PLOT-CORRECTION.md';

/**
 * The generated board bundle paths a worktree's own `packages/board/build.mjs`
 * declares, relative to the repository root.
 *
 * Matches `bundle_paths` (`plot-desk-dirt.sh`) exactly — same file, same
 * pattern, same `sed` capture — so a fifth derivation can never name a
 * different set. Prints nothing on any failure: a desk this cannot read is
 * excused from nothing rather than everything.
 */
const bundlePaths = (worktree: string): readonly string[] => {
  let text: string;
  try {
    text = readFileSync(join(worktree, 'packages/board/build.mjs'), 'utf8');
  } catch {
    return [];
  }
  const found = new Set<string>();
  const pattern = /shipped[A-Za-z]* = path\.join\([^)]*'([^']*)'\)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const relative = raw.replace(/^\.\.\/\.\.\//, '');
    if (relative) found.add(relative);
  }
  return [...found].sort();
};

/**
 * Removes one file, best effort: an absent or unremovable file is left as it
 * is, matching the shell's `rm -f ... 2>/dev/null || true`.
 *
 * @param file - the file to remove, absolute.
 */
const removeQuietly = (file: string): void => {
  try {
    rmSync(file, { force: true });
  } catch {
    /* best effort */
  }
};

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
  let current: {
    path: string;
    branch: string;
    prunable: boolean;
    detached: boolean;
  } | null = null;

  const flush = () => {
    if (current === null) return;
    trees.push({
      path: current.path,
      branch: current.branch,
      isMain: trees.length === 0,
      clean: false,
      agentSession: null,
      prunable: current.prunable,
      detached: current.detached,
    });
    current = null;
  };

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      current = {
        path: line.slice('worktree '.length),
        branch: '',
        prunable: false,
        detached: false,
      };
    } else if (line.startsWith('branch ') && current !== null) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line.startsWith('prunable') && current !== null) {
      current.prunable = true;
      // `detached` IS READ, not inferred from an empty branch. The porcelain
      // emits its own line for it, and the two readings differ on the record
      // this parser could not make sense of: that one leaves `branch` empty
      // too, and a caller told it was detached would act on a tree nobody
      // measured. Git says which, so the parser reports what git said.
    } else if (line === 'detached' && current !== null) {
      current.detached = true;
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

    // ONE LISTING, NO SECOND GIT CALL. `prunable` is already parsed out of the
    // porcelain by `worktreesOf`; this reads the tree git named and reports
    // what git said about it. A `stat` on the path would answer the same
    // question worse — git knows about an entry whose directory went away, and
    // a filesystem check would have to guess the path to look at.
    //
    // An unreadable listing carries its failure rather than reporting `absent`:
    // *git could not be asked* is not *there is no worktree*, and a caller that
    // conflated them would report a stale entry as tidy.
    presence: async (branch) => {
      const all = await list();
      if (!all.ok) return all as PortResult<TreePresence>;
      const tree = all.value.find((each) => each.branch === branch);
      if (tree === undefined) return answered<TreePresence>('absent');
      return answered<TreePresence>(tree.prunable ? 'vanished' : 'present');
    },

    // `git -C <path>` rather than `cwd`, so an unreadable checkout is reported
    // by git's own exit code instead of by `execFile` failing to chdir — the
    // two arrive as different errors and only one of them says which path.
    currentBranch: (path) =>
      runScript('git', ['-C', path, 'branch', '--show-current'], asText, inRepo),

    // `git config` exits 1 for an unset key, which is the `failed` answer.
    userEmail: (path) =>
      runScript('git', ['-C', path, 'config', '--get', 'user.email'], asText, inRepo),

    markers: (path, prefix) =>
      runScript(
        'bash',
        ['-c', 'ls -1 "$1" 2>/dev/null | grep "^$2" || true', 'bash', path, prefix],
        asLines,
        inRepo,
      ),

    // `plot_worker_dirty` is SOURCED and called, never reimplemented here. The
    // three exclusion patterns it applies are stated once in
    // `plot-worker-state.sh`, where `plot-fleet-scan.sh` and the loop's own
    // watcher already read them; a second copy in TypeScript is a second thing
    // to keep in step, and the drift would show up as a watcher that reads its
    // own findings file as the agent working.
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

    addBranch: async (path, branch, start) => {
      const run = await runProcess(
        'git',
        ['worktree', 'add', '-q', '-B', branch, path, start],
        inRepo,
      );
      return run.code === 0 ? answered(undefined) : failed<void>();
    },

    // BEST-EFFORT, MATCHING THE SHELL'S `cleanup()`. Both commands run
    // regardless of the other's result, and the operation always answers —
    // never `failed` — because a caller cleaning up a booking worktree has no
    // next step that depends on whether the removal succeeded.
    removeWithBranch: async (path, branch) => {
      await runProcess('git', ['worktree', 'remove', '--force', path], inRepo);
      await runProcess('git', ['branch', '-D', branch], inRepo);
      return answered(undefined);
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

    resetOnto: async (path, branch, base): Promise<PortResult<void>> => {
      const git = (args: readonly string[]) => runProcess('git', ['-C', path, ...args], inRepo);

      // STEP 0 — the previous slice's own bookkeeping leaves with the slice.
      // Best effort, matching the shell's `rm -f ... 2>/dev/null || true`: both
      // files are untracked (`.plot-worker.` and root-level), so a plain
      // filesystem removal is all `reset_desk` itself performs here.
      for (const name of [DECLARATION_FILE_NAME, CORRECTION_FILE_NAME]) removeQuietly(join(path, name));

      // STEP 0b — the generated bundles are restored from HEAD path by path,
      // never `git clean` or `git reset --hard` over the whole tree.
      for (const bundle of bundlePaths(path)) {
        const exists = await git(['cat-file', '-e', `HEAD:${bundle}`]);
        if (exists.code === 0) {
          await git(['checkout', 'HEAD', '--', bundle]);
        } else {
          removeQuietly(join(path, bundle));
        }
      }

      // STEP 1 — the base, detached.
      const detach = await git(['checkout', '--detach', base]);
      if (detach.code !== 0) return failed<void>();

      // STEP 2 — the slice's branch: created where it does not exist yet,
      // attached where it does. Never `-B`, which would move an existing
      // branch onto the base and discard commits an earlier attempt left on it.
      const create = await git(['checkout', '-b', branch]);
      if (create.code === 0) return answered(undefined);
      const attach = await git(['checkout', branch]);
      if (attach.code === 0) return answered(undefined);

      // BOTH CHECKOUTS FAILED — most often another worktree holds the branch.
      // That is `checkoutYield`'s question, not this operation's: it answers
      // `failed` and goes no further, matching the write's own second line of
      // defence rather than the shell's yield-and-retry fallback.
      return failed<void>();
    },

    commit: async (path, message): Promise<PortResult<void>> => {
      const run = await runProcess('git', ['-C', path, 'commit', '--allow-empty', '-m', message], inRepo);
      return run.code === 0 ? answered(undefined) : failed<void>();
    },

    push: async (path, branch): Promise<PortResult<void>> => {
      const run = await runProcess('git', ['-C', path, 'push', '-u', 'origin', branch], inRepo);
      return run.code === 0 ? answered(undefined) : failed<void>();
    },
  };
};
