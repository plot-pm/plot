// Four git desks, one per AgentMonitor finding, for the findings tests.
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The four desks, by the finding each holds. */
export const DESK_NAMES = ['blocked', 'dirty', 'review', 'gate'] as const;
export type DeskName = (typeof DESK_NAMES)[number];

/** One built desk. */
export interface BuiltDesk {
  readonly branch: string;
  readonly worktree: string;
}

/** The repository the desks belong to, and the desks. */
export interface AgentDesks {
  readonly repo: string;
  readonly desks: Readonly<Record<DeskName, BuiltDesk>>;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Plot Test',
  GIT_AUTHOR_EMAIL: 'test@plot.invalid',
  GIT_COMMITTER_NAME: 'Plot Test',
  GIT_COMMITTER_EMAIL: 'test@plot.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * Builds a repository with an `origin` and four desks under `root`:
 * `blocked` holds a `PLOT-BLOCKED.md` marker, `dirty` an untracked file,
 * `review` a pushed commit, and `gate` a pushed commit with no changeset.
 *
 * @param given - an empty directory the caller removes; read through its real path, as git lists worktrees.
 * @returns the repository and the desks.
 */
export const buildAgentDesks = (given: string): AgentDesks => {
  const root = realpathSync(given);
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'readme\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '--quiet', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '--quiet', '-u', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  const desk = (name: DeskName): BuiltDesk => {
    const branch = `feature/${name}`;
    const worktree = join(root, `desk-${name}`);
    git(repo, 'worktree', 'add', '--quiet', '-b', branch, worktree, 'main');
    return { branch, worktree };
  };
  const desks = {
    blocked: desk('blocked'),
    dirty: desk('dirty'),
    review: desk('review'),
    gate: desk('gate'),
  };
  writeFileSync(join(desks.blocked.worktree, 'PLOT-BLOCKED.md'), 'which schema?\n');
  writeFileSync(join(desks.dirty.worktree, 'work.txt'), 'work\n');
  for (const name of ['review', 'gate'] as const) {
    const { branch, worktree } = desks[name];
    writeFileSync(join(worktree, 'done.txt'), `${name}\n`);
    git(worktree, 'add', 'done.txt');
    git(worktree, 'commit', '--quiet', '-m', 'work');
    git(worktree, 'push', '--quiet', '-u', 'origin', branch);
  }
  return { repo, desks };
};

/** The PR each desk's branch has on the stub host: only `gate` has one. */
export const HOST_PRS: Readonly<Record<string, 'OPEN' | null>> = {
  'feature/blocked': null,
  'feature/dirty': null,
  'feature/review': null,
  'feature/gate': 'OPEN',
};

/** A finding line with the desk path and the two times masked. */
export const masked = (line: string, worktree: string): string =>
  line
    .split(worktree)
    .join('<desk>')
    .replace(/"(since|measuredAt)":"[^"]*"/g, '"$1":"<time>"');
