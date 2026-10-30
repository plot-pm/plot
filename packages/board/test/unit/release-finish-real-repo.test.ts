// The release finish against a real repository: a bare `origin`, a clone, the
// real `treesGit`, `planStoreShell`, `refsGit` and `plot-push-main.sh`. Only
// the host is stubbed. Run with `env -u PLOT_UNATTENDED`: the caller is passed
// in, so the env does not decide it, but the push script reads the env.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { answered } from '@plot-pm/domain';
import type { Host } from '@plot-pm/domain';
import { finishRelease, type FinishContext } from '../../src/server/entry/release-finish.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const noWait = async (): Promise<void> => {};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const plan = (type: string, state: string, released = ''): string =>
  `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** ${type}\n${released === '' ? '' : `- **Released:** ${released}\n`}\n## Notes\n\n- one\n`;

const sprint = (state: string, field = 'State', items = ['alpha', 'beta', 'gamma']): string =>
  [
    '# Sprint: S', '', '> goal', '', '## Status', '', `- **${field}:** ${state}`, '- **Start:** 2026-10-20', '- **End:** 2026-10-30', '',
    '## Sprint Goal', '', 'g', '', '### Must Have', '', ...items.map((slug) => `- [x] [${slug}] item`), '- [ ] ~~[delta]~~ left', '',
    '### Should Have', '', '## Notes', '',
  ].join('\n');

describe('finishRelease against a real remote', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const estate = (opts: { tagged: boolean; sprintField?: string }) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-release-finish-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const hooks = path.join(root, 'hooks');
    mkdirSync(hooks);
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'core.hooksPath', hooks);
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    mkdirSync(path.join(repo, 'docs/plans/delivered'), { recursive: true });
    mkdirSync(path.join(repo, 'docs/sprints/active'), { recursive: true });
    writeFileSync(path.join(repo, 'package.json'), '{"name":"x","version":"1.2.3"}\n');
    for (const [slug, type] of [['alpha', 'feature'], ['beta', 'docs'], ['gamma', 'infra']] as const) {
      writeFileSync(path.join(repo, `docs/plans/2026-10-01-${slug}.md`), plan(type, 'Delivered'));
      symlinkSync(`../2026-10-01-${slug}.md`, path.join(repo, `docs/plans/delivered/${slug}.md`));
    }
    writeFileSync(path.join(repo, 'docs/sprints/2026-W44-s.md'), sprint('Active', opts.sprintField));
    symlinkSync('../2026-W44-s.md', path.join(repo, 'docs/sprints/active/2026-W44-s.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    if (opts.tagged) {
      git(repo, 'tag', 'v1.2.3');
      git(repo, 'push', '-q', 'origin', 'v1.2.3');
    }
    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const host = {
      prState: async () => answered({ number: 9, head: 'changeset-release/main', base: 'main', state: 'MERGED' }),
    } as unknown as Host;
    const ctx: FinishContext = {
      repoRoot: repo,
      refs: refsGit(context),
      host,
      planStore: planStoreShell(context),
      scripts: scriptsShell(context),
      trees: treesGit(context),
      caller: 'person',
      tagWaitMs: 0,
      pollMs: 1,
      sleep: noWait,
      retryWait: noWait,
    };
    return { repo, origin, ctx };
  };

  const run = async (ctx: FinishContext) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await finishRelease(ctx, 9, (s) => out.push(s), (s) => err.push(s));
    return { code, out: out.join(''), err: err.join('') };
  };

  const onMain = (repo: string, file: string): string => git(repo, 'show', `origin/main:${file}`);
  const mainSha = (repo: string): string => git(repo, 'rev-parse', 'origin/main').trim();
  const activeOnMain = (repo: string): string[] =>
    git(repo, 'ls-tree', '--name-only', 'origin/main', 'docs/sprints/active/').split('\n').filter((l) => l !== '');
  const originMain = (origin: string): string => git(path.dirname(origin), '--git-dir', origin, 'rev-parse', 'main').trim();

  /**
   * Lands a release the way the host does, from a second clone: the release
   * branch bumps the version, merges into main, the version is tagged, and the
   * branch is deleted on the remote. The first clone keeps its stale `origin/main`.
   */
  const landRelease = (root: string, origin: string, version: string): void => {
    const other = path.join(root, `other-${version}`);
    git(root, 'clone', '-q', origin, other);
    git(other, 'checkout', '-q', '-b', 'changeset-release/main');
    writeFileSync(path.join(other, 'package.json'), `{"name":"x","version":"${version}"}\n`);
    git(other, 'commit', '-q', '-am', `release ${version}`);
    git(other, 'push', '-q', 'origin', 'changeset-release/main');
    git(other, 'checkout', '-q', 'main');
    git(other, 'merge', '-q', '--ff-only', 'changeset-release/main');
    git(other, 'push', '-q', 'origin', 'main');
    git(other, 'tag', `v${version}`);
    git(other, 'push', '-q', 'origin', `v${version}`);
    git(other, 'push', '-q', 'origin', '--delete', 'changeset-release/main');
  };

  /** Starts a new active sprint naming `slug`, a delivered plan, from a second clone. */
  const startSprint = (root: string, origin: string, week: string, slug: string): void => {
    const other = path.join(root, `sprint-${week}`);
    git(root, 'clone', '-q', origin, other);
    writeFileSync(path.join(other, `docs/plans/2026-10-20-${slug}.md`), plan('feature', 'Delivered'));
    writeFileSync(path.join(other, `docs/sprints/${week}-t.md`), sprint('Active', 'State', [slug]));
    mkdirSync(path.join(other, 'docs/sprints/active'), { recursive: true });
    symlinkSync(`../${week}-t.md`, path.join(other, `docs/sprints/active/${week}-t.md`));
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', `start ${week}`);
    git(other, 'push', '-q', 'origin', 'main');
  };

  it('books every scope plan, docs and infra included, and closes the sprint in one commit and one push', async () => {
    const { repo, ctx } = estate({ tagged: true });
    const before = mainSha(repo);

    const { code, out } = await run(ctx);

    expect(code).toBe(0);
    expect(out).toContain('finished: v1.2.3');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(git(repo, 'rev-list', '--count', `${before}..origin/main`).trim()).toBe('1');
    for (const slug of ['alpha', 'beta', 'gamma']) {
      const text = onMain(repo, `docs/plans/2026-10-01-${slug}.md`);
      expect(text).toContain('- **State:** Released');
      expect(text).toMatch(/- \*\*Released:\*\* \d{4}-\d{2}-\d{2}, v1\.2\.3/);
    }
    const closed = onMain(repo, 'docs/sprints/2026-W44-s.md');
    expect(closed).toContain('- **State:** Closed');
    expect(closed).toMatch(/- \*\*Actual End:\*\* \d{4}-\d{2}-\d{2}/);
    expect(activeOnMain(repo)).toEqual([]);
    expect(git(repo, 'show', '--name-status', '--format=', 'origin/main')).toContain('D\tdocs/sprints/active/2026-W44-s.md');
    expect(git(repo, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('plot: record v1.2.3');
  });

  it('closes a sprint that carries the legacy Phase field and writes State', async () => {
    const { repo, ctx } = estate({ tagged: true, sprintField: 'Phase' });

    expect((await run(ctx)).code).toBe(0);

    git(repo, 'fetch', '-q', 'origin', 'main');
    const closed = onMain(repo, 'docs/sprints/2026-W44-s.md');
    expect(closed).toContain('- **State:** Closed');
    expect(closed).not.toContain('**Phase:**');
    expect(activeOnMain(repo)).toEqual([]);
  });

  it('reads the version from the freshly fetched default branch after the host deleted the release branch', async () => {
    const { repo, origin, ctx } = estate({ tagged: true });
    const root = path.dirname(repo);
    landRelease(root, origin, '1.3.0');
    // The clone's own `origin/main` still carries 1.2.3, whose tag exists.
    expect(JSON.parse(git(repo, 'show', 'origin/main:package.json')).version).toBe('1.2.3');

    const { code, out, err } = await run(ctx);

    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('finished: v1.3.0');
    git(repo, 'fetch', '-q', 'origin', 'main');
    const text = onMain(repo, 'docs/plans/2026-10-01-alpha.md');
    expect(text).toMatch(/- \*\*Released:\*\* \d{4}-\d{2}-\d{2}, v1\.3\.0/);
    expect(text).not.toContain('v1.2.3');
  });

  it('refuses default-branch-unfetched and writes nothing when the default branch cannot be fetched', async () => {
    const { repo, origin, ctx } = estate({ tagged: true });
    const before = originMain(origin);
    git(repo, 'remote', 'set-url', 'origin', path.join(path.dirname(repo), 'no-such-origin.git'));

    const { code, out, err } = await run(ctx);

    expect(code).toBe(1);
    expect(err).toContain('default-branch-unfetched');
    expect(out).toBe('');
    expect(originMain(origin)).toBe(before);
    expect(git(repo, 'branch', '--list', 'plot/release-*').trim()).toBe('');
    expect(readFileSync(path.join(repo, 'docs/plans/2026-10-01-alpha.md'), 'utf8')).toContain('- **State:** Delivered');
  });

  it('refuses sprint-ambiguous and writes nothing when the active index holds two sprints', async () => {
    const { repo, origin, ctx } = estate({ tagged: true });
    startSprint(path.dirname(repo), origin, '2026-W46', 'epsilon');
    const before = originMain(origin);

    const { code, err } = await run(ctx);

    expect(code).toBe(1);
    expect(err).toContain('sprint-ambiguous');
    expect(err).toContain('docs/sprints/active/2026-W44-s.md');
    expect(err).toContain('docs/sprints/active/2026-W46-t.md');
    expect(originMain(origin)).toBe(before);
  });

  it('books the next release against the next sprint once the first close removed its active entry', async () => {
    const { repo, origin, ctx } = estate({ tagged: true });
    const root = path.dirname(repo);
    expect((await run(ctx)).code).toBe(0);
    startSprint(root, origin, '2026-W46', 'epsilon');
    landRelease(root, origin, '1.3.0');

    const { code, out } = await run(ctx);

    expect(code).toBe(0);
    expect(out).toContain('finished: v1.3.0 booked epsilon');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(onMain(repo, 'docs/plans/2026-10-20-epsilon.md')).toMatch(/- \*\*Released:\*\* \d{4}-\d{2}-\d{2}, v1\.3\.0/);
    expect(onMain(repo, 'docs/sprints/2026-W46-t.md')).toContain('- **State:** Closed');
    expect(activeOnMain(repo)).toEqual([]);
  });

  it('reports already-released and writes nothing on a second run', async () => {
    const { repo, ctx } = estate({ tagged: true });
    expect((await run(ctx)).code).toBe(0);
    git(repo, 'fetch', '-q', 'origin', 'main');
    const after = mainSha(repo);

    expect(activeOnMain(repo)).toEqual([]);

    const second = await run(ctx);

    expect(second.code).toBe(0);
    expect(second.out).toContain('already-released');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(mainSha(repo)).toBe(after);
  });

  it('reports tag-absent and writes nothing when the tag never appears', async () => {
    const { repo, ctx } = estate({ tagged: false });
    const before = mainSha(repo);

    const { code, err } = await run(ctx);

    expect(code).toBe(1);
    expect(err).toContain('tag-absent');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(mainSha(repo)).toBe(before);
    expect(readFileSync(path.join(repo, 'docs/plans/2026-10-01-alpha.md'), 'utf8')).toContain('- **State:** Delivered');
  });
});
