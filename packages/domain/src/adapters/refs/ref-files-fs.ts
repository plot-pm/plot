import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { Worktree } from '../../entities/worktree.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { BranchTip, RefScope, RefState, RemoteHeadAnswer } from '../../ports/refs.js';
import {
  branchTipsOf,
  currentBranchOf,
  defaultBranchOf,
  isRefName,
  listBranchesOf,
  looseRefOf,
  packedRefsOf,
  PER_WORKTREE_PREFIXES,
  refsFrom,
  refStateOf,
  repoConfigOf,
  resolveName,
  type RefTable,
  type RefValue,
  type WorktreeFiles,
  worktreesFrom,
} from '../../rules/ref-files.js';

/** The file system calls the reader makes. {@link nodeRefFs} in production. */
export interface RefFs {
  /** A file's text, or undefined where it cannot be read. */
  read: (path: string) => string | undefined;
  /** What a path is, or undefined where it is absent. */
  kind: (path: string) => 'file' | 'dir' | undefined;
  /** A file's identity — inode, size and modification time — or undefined where it is absent. */
  stamp: (path: string) => string | undefined;
  /** A directory's entries, or an empty list where it cannot be read. */
  list: (path: string) => readonly string[];
  /** The physical path, or undefined where it does not resolve. */
  real: (path: string) => string | undefined;
}

/** The {@link RefFs} over `node:fs`. */
export const nodeRefFs: RefFs = {
  read: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  kind: (path) => {
    try {
      return statSync(path).isDirectory() ? 'dir' : 'file';
    } catch {
      return undefined;
    }
  },
  stamp: (path) => {
    try {
      const st = statSync(path, { bigint: true });
      return `${st.ino}:${st.size}:${st.mtimeNs}`;
    } catch {
      return undefined;
    }
  },
  list: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  real: (path) => {
    try {
      return realpathSync(path);
    } catch {
      return undefined;
    }
  },
};

/** Reads refs and worktrees from the files under a checkout's git directories. */
export interface RefFiles {
  /** `Refs.refState`: the scope's refs, sorted by name, tags left out. */
  refState: (scope: RefScope) => PortResult<readonly RefState[]>;
  /** `Refs.defaultBranch`, from `refs/remotes/origin/HEAD`. */
  defaultBranch: () => PortResult<string>;
  /** `Refs.listBranches`. */
  listBranches: (remote: boolean) => PortResult<readonly string[]>;
  /** `Refs.branchTips`. */
  branchTips: (patterns: readonly string[]) => PortResult<readonly BranchTip[]>;
  /** `Refs.resolve` for a plain ref name; `failed` where no ref has the name, as `git rev-parse` fails. */
  resolve: (name: string) => PortResult<string>;
  /** `Refs.currentBranch`, as `git rev-parse --abbrev-ref HEAD` answers. */
  currentBranch: () => PortResult<string>;
  /** `Refs.remoteHead`: whether `refs/remotes/origin/<branch>` exists. */
  remoteHead: (branch: string) => PortResult<RemoteHeadAnswer>;
  /** `Trees.list`: the main checkout first, the linked worktrees after it in no stated order. */
  worktrees: () => PortResult<readonly Worktree[]>;
}

/** The environment variables that move git's directories away from the checkout's `.git`. */
const GIT_DIR_VARS = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];

/** A checkout's own git directory and the directory every worktree shares. */
interface GitDirs {
  gitDir: string;
  commonDir: string;
}

/**
 * Reads refs and worktrees from the files git keeps — loose refs, `packed-refs`,
 * symbolic refs and `worktrees/*` — and starts no process.
 *
 * Every method answers `unaskable` where git must answer instead: a repository
 * whose `extensions.refStorage` is not `files`, a git directory moved by the
 * environment, a name or pattern the rule does not cover, a symbolic chain or
 * dangling ref, and a `packed-refs` file that changes during two reads in a row.
 *
 * @param checkout - the checkout's top-level directory.
 * @param fs - the file system calls; {@link nodeRefFs} by default.
 * @param env - the environment git would read; `process.env` by default.
 * @returns the reader.
 */
export const refFilesFs = (
  checkout: string,
  fs: RefFs = nodeRefFs,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RefFiles => {
  const dirsOf = (): GitDirs | string => {
    if (GIT_DIR_VARS.some((name) => (env[name] ?? '') !== '')) return 'the environment sets a git directory';
    const dotGit = join(checkout, '.git');
    const kind = fs.kind(dotGit);
    if (kind === 'dir') return { gitDir: dotGit, commonDir: dotGit };
    const pointer = kind === 'file' ? /^gitdir:\s*(.+?)\s*$/m.exec(fs.read(dotGit) ?? '')?.[1] : undefined;
    if (pointer === undefined) return 'no readable .git';
    const gitDir = resolve(checkout, pointer);
    const common = fs.read(join(gitDir, 'commondir'))?.trim();
    return { gitDir, commonDir: common === undefined || common === '' ? gitDir : resolve(gitDir, common) };
  };

  /** The checkout's git directories, once the repository is known to keep its refs as files. */
  const filesRepo = (): GitDirs | string => {
    const dirs = dirsOf();
    if (typeof dirs === 'string') return dirs;
    const config = fs.read(join(dirs.commonDir, 'config'));
    if (config === undefined) return 'no readable config';
    const storage = repoConfigOf(config).refStorage;
    return storage === 'files' ? dirs : `extensions.refStorage is ${storage}`;
  };

  const isPerWorktree = (name: string): boolean => PER_WORKTREE_PREFIXES.some((prefix) => name.startsWith(prefix));

  /** Adds every loose ref under `dir/<name>` to `into`; false where a file holds neither an oid nor a ref name. */
  const scan = (dir: string, name: string, into: Map<string, RefValue>, keep: (name: string) => boolean): boolean => {
    for (const entry of fs.list(join(dir, name))) {
      const child = `${name}/${entry}`;
      const kind = fs.kind(join(dir, child));
      if (kind === 'dir') {
        if (!scan(dir, child, into, keep)) return false;
        continue;
      }
      if (!isRefName(child) || !keep(child)) continue;
      const text = fs.read(join(dir, child));
      if (text === undefined) continue;
      const value = looseRefOf(text);
      if (value === undefined) return false;
      into.set(child, value);
    }
    return true;
  };

  /** One read of every ref, or why it cannot be read. */
  const readOnce = (dirs: GitDirs): RefTable | string => {
    const loose = new Map<string, RefValue>();
    if (!scan(dirs.commonDir, 'refs', loose, (name) => !isPerWorktree(name))) return 'a loose ref does not parse';
    if (!scan(dirs.gitDir, 'refs', loose, isPerWorktree)) return 'a loose ref does not parse';
    const head = looseRefOf(fs.read(join(dirs.gitDir, 'HEAD')) ?? '');
    if (head === undefined) return 'HEAD does not parse';
    loose.set('HEAD', head);
    const packed = packedRefsOf(fs.read(join(dirs.commonDir, 'packed-refs')) ?? '');
    if (packed === undefined) return 'packed-refs does not parse';
    return refsFrom({ loose, packed: new Map([...packed].filter(([name]) => !isPerWorktree(name))) });
  };

  /** Every ref, read again once where `packed-refs` changed during the read. */
  const table = (): RefTable | string => {
    const dirs = filesRepo();
    if (typeof dirs === 'string') return dirs;
    const packedPath = join(dirs.commonDir, 'packed-refs');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = fs.stamp(packedPath);
      const refs = readOnce(dirs);
      if (fs.stamp(packedPath) === before) return refs;
    }
    return 'packed-refs changed during two reads';
  };

  /** Answers `read(table)`, or `unaskable` where the table or the reading cannot answer. */
  const fromTable = <T>(read: (refs: RefTable) => T | undefined, uncovered: string): PortResult<T> => {
    const refs = table();
    if (typeof refs === 'string') return unaskable(refs);
    const value = read(refs);
    return value === undefined ? unaskable(uncovered) : answered(value);
  };

  return {
    refState: (scope) => fromTable((refs) => refStateOf(refs, scope), 'a matching ref is a symbolic chain or dangling'),
    defaultBranch: () => fromTable(defaultBranchOf, 'origin/HEAD is absent, detached or dangling'),
    listBranches: (remote) => fromTable((refs) => listBranchesOf(refs, remote), 'a matching ref is a symbolic chain or dangling'),
    branchTips: (patterns) => fromTable((refs) => branchTipsOf(refs, patterns), 'a pattern or a matching ref is not covered'),
    currentBranch: () => fromTable(currentBranchOf, 'HEAD names a branch with no commit'),
    resolve: (name) => {
      const refs = table();
      if (typeof refs === 'string') return unaskable(refs);
      const found = resolveName(name, refs);
      if (found === undefined) return unaskable('not a plain ref name, or a symbolic chain or dangling ref');
      return found === null ? failed<string>() : answered(found);
    },
    remoteHead: (branch) => {
      const refs = table();
      if (typeof refs === 'string') return unaskable(refs);
      const found = resolveName(`refs/remotes/origin/${branch}`, refs);
      if (found === undefined) return unaskable('not a plain ref name');
      return answered<RemoteHeadAnswer>(found === null ? 'absent' : 'present');
    },
    worktrees: () => {
      const dirs = filesRepo();
      if (typeof dirs === 'string') return unaskable(dirs);
      if (repoConfigOf(fs.read(join(dirs.commonDir, 'config')) as string).bare) return unaskable('the repository is bare');
      const common = fs.real(dirs.commonDir);
      if (common === undefined || !common.endsWith('/.git')) return unaskable('the common git directory is not a checkout .git');
      const base = join(dirs.commonDir, 'worktrees');
      const linked = [...fs.list(base)].filter((id) => fs.kind(join(base, id)) === 'dir').sort().map((id): WorktreeFiles => {
        const own = join(base, id);
        const text = fs.read(join(own, 'gitdir'))?.trimEnd();
        let gitdir: string | undefined;
        if (text !== undefined && text !== '') {
          const stripped = text.replace(/\/\.git$/, '');
          gitdir = isAbsolute(text) ? text : `${fs.real(resolve(own, stripped)) ?? resolve(own, stripped)}/.git`;
        }
        return {
          gitdir,
          head: fs.read(join(own, 'HEAD')),
          locked: fs.kind(join(own, 'locked')) !== undefined,
          present: gitdir !== undefined && fs.kind(gitdir) !== undefined,
        };
      });
      const trees = worktreesFrom({
        main: { path: dirname(common), head: fs.read(join(dirs.commonDir, 'HEAD')) },
        linked,
      });
      return trees === undefined ? unaskable('a worktree HEAD does not parse') : answered(trees);
    },
  };
};
