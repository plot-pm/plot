// A real repository for the release scope's tag arm: a bare `origin`, a
// clone, merge commits carrying the host's merge subjects, and the tags
// `v1.0.0` and `v1.1.0`. Shared by the fleet and board real-repo tests.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The slugs `v1.1.0` books, in decision order: the changeset plan, then the tag plans. */
export const V110_BOOKED = ['g', 'a', 'd', 'h', 'k'];

/** One estate: the clone, the bare origin, and the step that tags `v1.2.0` after the late slice. */
export interface TagEstate {
  readonly root: string;
  readonly repo: string;
  readonly origin: string;
  /** Lands the release PR #11 and tags and pushes `v1.2.0` on its merge. */
  readonly shipNext: () => void;
}

const plan = (state: string, slices: string, notes = ''): string =>
  `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n\n## Slices\n\n### One\n\n${slices}\n\n## Notes\n\n- n ${notes}\n`;

const changeset = (slug: string): string =>
  `---\n'plot': patch\n---\n\nA description long enough to publish.\n\n<!--\nplan: docs/plans/2026-11-01-${slug}.md\n-->\n`;

/**
 * Builds the estate under a new temporary directory.
 *
 * Plans: `a` (PR #2 in `v1.1.0`), `b` (#3 in `v1.1.0`, #9 merged after it), `c`
 * (its slice line names no PR; prose names `→ #7`), `d` (#4 merged into
 * `sprint/s`, carried into `v1.1.0` by #5), `e` (#1, before `v1.0.0`), `f`
 * (#6 squash-merged), `g` (named by the release's changeset), `h` (#8, no
 * changeset) and `k` (a `→ commit` slice in `v1.1.0`).
 *
 * @param roots - receives the temporary directory, for the caller to remove.
 * @returns the estate.
 */
export const tagEstate = (roots: string[]): TagEstate => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-tag-estate-')));
  roots.push(root);
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  let clock = Date.parse('2026-11-01T10:00:00Z') / 1000;
  const git = (...args: string[]): string => {
    clock += 60;
    const date = `@${clock} +0000`;
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  };
  const put = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
  };
  const commit = (file: string, text: string, message: string): void => {
    put(file, text);
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  const mergePr = (number: number, branch: string, base = 'main'): void => {
    git('checkout', '-q', '-b', branch, base);
    commit(`work/${branch}.txt`, `${branch}\n`, `work on ${branch}`);
    git('checkout', '-q', base);
    git('merge', '-q', '--no-ff', '-m', `Merge pull request #${number} from acme/${branch}`, branch);
  };
  const planFile = (slug: string): string => `docs/plans/2026-11-01-${slug}.md`;

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  // The finish commits its booking with the repository's own identity, and a
  // CI runner has no global one.
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(root, 'no-hooks'));
  put('package.json', '{"name":"x","version":"1.0.0"}\n');
  put('.changeset/README.md', 'readme\n');
  put('docs/plans/active/.keep', '');
  put('docs/plans/delivered/.keep', '');
  put('docs/sprints/active/.keep', '');
  for (const [slug, slices, notes] of [
    ['a', '- `feature/a` → #2'],
    ['b', '- `feature/b1` → #3\n- `feature/b2` → #9'],
    ['c', '- `feature/c`', 'shipped in → #7'],
    ['d', '- `feature/d` → #4'],
    ['e', '- `feature/e` → #1'],
    ['f', '- `feature/f` → #6'],
    ['g', '- `feature/g` → #12'],
    ['h', '- `feature/h` → #8'],
  ] as const) {
    put(planFile(slug), plan('Delivered', slices, notes ?? ''));
    symlinkSync(`../2026-11-01-${slug}.md`, path.join(repo, `docs/plans/delivered/${slug}.md`));
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', origin);

  mergePr(1, 'feature/e');
  git('tag', 'v1.0.0');
  mergePr(2, 'feature/a');
  mergePr(3, 'feature/b1');
  git('checkout', '-q', '-b', 'sprint/s');
  mergePr(4, 'feature/d', 'sprint/s');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'Merge pull request #5 from acme/sprint/s', 'sprint/s');
  commit('work/f.txt', 'f\n', 'feature f (#6)');
  mergePr(7, 'feature/c');
  mergePr(8, 'feature/h');
  mergePr(12, 'feature/g');
  commit('work/k.txt', 'k\n', 'feature k');
  const k = git('rev-parse', '--short=7', 'HEAD').trim();
  put(planFile('k'), plan('Delivered', `- \`feature/k\` → commit ${k}`));
  symlinkSync('../2026-11-01-k.md', path.join(repo, 'docs/plans/delivered/k.md'));
  git('add', '-A');
  git('commit', '-q', '-m', 'plan k');
  commit('.changeset/g.md', changeset('g'), 'changeset g');
  const release = (number: number, version: string, removed: readonly string[]): void => {
    git('checkout', '-q', '-b', `changeset-release/${version}`);
    if (removed.length > 0) git('rm', '-q', ...removed);
    put('package.json', `{"name":"x","version":"${version}"}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `release ${version}`);
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', `Merge pull request #${number} from acme/changeset-release/main`, `changeset-release/${version}`);
    git('tag', `v${version}`);
  };
  release(10, '1.1.0', ['.changeset/g.md']);
  mergePr(9, 'feature/b2');
  git('push', '-q', 'origin', 'main', 'sprint/s', 'v1.0.0', 'v1.1.0');
  git('remote', 'set-head', 'origin', 'main');
  git('fetch', '-q', 'origin');

  const shipNext = (): void => {
    git('fetch', '-q', 'origin', 'main');
    git('checkout', '-q', 'main');
    git('reset', '-q', '--hard', 'origin/main');
    release(11, '1.2.0', []);
    git('push', '-q', 'origin', 'main', 'v1.2.0');
    git('fetch', '-q', 'origin');
  };
  return { root, repo, origin, shipNext };
};

/** A host that throws on any call: the tag arm asks none. */
export const throwingHost = <T extends object>(): T =>
  new Proxy({} as T, {
    get: (_t, name) => {
      if (name === 'then') return undefined;
      throw new Error(`host call: ${String(name)}`);
    },
  });
