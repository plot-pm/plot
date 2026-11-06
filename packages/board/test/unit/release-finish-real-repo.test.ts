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

const plan = (type: string, state: string, released = '', issue = ''): string =>
  `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** ${type}\n${issue === '' ? '' : `- **Issue:** ${issue}\n`}${released === '' ? '' : `- **Released:** ${released}\n`}\n## Notes\n\n- one\n`;

/**
 * Stands in for the two tracker-write scripts the finish's tracker step
 * calls, so these tests need no configured `Tracker` or git host — the same
 * stand-in `shared-issue-reads-the-post-push-tree.test.ts` uses for `runRelease`.
 */
const trackerStub = (script: string) =>
  script === 'plot-plan-state.sh'
    ? { stdout: '999\twritten\treleased\nsummary: tracker=written\n', stderr: '', code: 0 }
    : { stdout: 'summary: tracker=none\n', stderr: '', code: 0 };

const sprint = (state: string, field = 'State', items = ['alpha', 'beta', 'gamma'], release = ''): string =>
  [
    '# Sprint: S', '', '> goal', '', '## Status', '', `- **${field}:** ${state}`, '- **Start:** 2026-10-20', '- **End:** 2026-10-30',
    ...(release === '' ? [] : [`- **Release:** ${release}`]), '',
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
    const realScripts = scriptsShell(context);
    const trackerCalls: { script: string; args: readonly string[]; fileText: string }[] = [];
    const scripts = {
      ...realScripts,
      awaited: async (script: string, args: readonly string[], options?: unknown) => {
        if (script === 'plot-issue-status.sh' || script === 'plot-plan-state.sh') {
          trackerCalls.push({ script, args, fileText: readFileSync(args[0], 'utf8') });
          return trackerStub(script);
        }
        return realScripts.awaited(script, args, options as never);
      },
    };
    const ctx: FinishContext = {
      repoRoot: repo,
      refs: refsGit(context),
      host,
      planStore: planStoreShell(context),
      scripts: scripts as FinishContext['scripts'],
      trees: treesGit(context),
      scriptDir: SCRIPT_DIR,
      caller: 'person',
      tagWaitMs: 0,
      pollMs: 1,
      sleep: noWait,
      retryWait: noWait,
    };
    return { repo, origin, ctx, trackerCalls };
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
  const startSprint = (root: string, origin: string, week: string, slug: string, release = '1.3.0'): void => {
    const other = path.join(root, `sprint-${week}`);
    git(root, 'clone', '-q', origin, other);
    writeFileSync(path.join(other, `docs/plans/2026-10-20-${slug}.md`), plan('feature', 'Delivered'));
    writeFileSync(path.join(other, `docs/sprints/${week}-t.md`), sprint('Active', 'State', [slug], release));
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

  it('refuses release-scope-mismatch and writes nothing once a later sprint is active for a different release', async () => {
    const { repo, origin, ctx } = estate({ tagged: true });
    const root = path.dirname(repo);
    expect((await run(ctx)).code).toBe(0);
    startSprint(root, origin, '2026-W46', 'epsilon', '2.30.1');
    git(repo, 'fetch', '-q', 'origin', 'main');
    const before = originMain(origin);

    const { code, err } = await run(ctx);

    expect(code).toBe(1);
    expect(err).toContain('release-scope-mismatch');
    expect(err).toContain('docs/sprints/active/2026-W46-t.md');
    expect(originMain(origin)).toBe(before);
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(onMain(repo, 'docs/plans/2026-10-20-epsilon.md')).not.toContain('Released:');
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

  it('reports already-released and writes nothing on a second run, and calls the tracker no further', async () => {
    const { repo, ctx, trackerCalls } = estate({ tagged: true });
    expect((await run(ctx)).code).toBe(0);
    git(repo, 'fetch', '-q', 'origin', 'main');
    const after = mainSha(repo);

    expect(activeOnMain(repo)).toEqual([]);
    trackerCalls.length = 0;

    const second = await run(ctx);

    expect(second.code).toBe(0);
    expect(second.out).toContain('already-released');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(mainSha(repo)).toBe(after);
    expect(trackerCalls).toEqual([]);
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

  it('writes one plot-plan-state.sh call per booked plan, naming its own file, phase, link and version', async () => {
    const { repo, ctx, trackerCalls } = estate({ tagged: true });

    expect((await run(ctx)).code).toBe(0);

    const stateCalls = trackerCalls.filter((c) => c.script === 'plot-plan-state.sh');
    expect(stateCalls).toHaveLength(3);
    for (const [index, slug] of ['alpha', 'beta', 'gamma'].entries()) {
      const call = stateCalls[index];
      expect(call.fileText).toContain('- **State:** Released');
      expect(call.args).toEqual(
        expect.arrayContaining(['--phase', 'released', '--plan-link', `docs/plans/2026-10-01-${slug}.md`, '--version', 'v1.2.3']),
      );
    }
  });

  it('makes no tracker call on a rejected push, and the next accepted push makes one call per plan, not two', async () => {
    const { repo, ctx, trackerCalls } = estate({ tagged: true });
    const realAwaited = ctx.scripts.awaited.bind(ctx.scripts);
    let rejectPush = true;
    ctx.scripts = {
      ...ctx.scripts,
      awaited: async (script, args, options) => {
        if (script === 'plot-push-main.sh' && rejectPush) return { stdout: '', stderr: 'rejected\n', code: 1 };
        return realAwaited(script, args, options as never);
      },
    };
    ctx.retryWait = noWait;

    const rejected = await run(ctx);

    expect(rejected.code).toBe(1);
    expect(rejected.err).toContain('did not reach main');
    expect(trackerCalls).toEqual([]);

    rejectPush = false;
    const accepted = await run(ctx);

    expect(accepted.code).toBe(0);
    expect(trackerCalls.filter((c) => c.script === 'plot-plan-state.sh')).toHaveLength(3);
  });

  // The outside plan's changeset, if any, carries no `plan:` line, so the finish books none of it.
  it('keeps a shared issue open while an outside-the-release sibling still owes it', async () => {
    const { repo, ctx, trackerCalls } = estate({ tagged: true });
    for (const slug of ['alpha', 'beta', 'gamma']) {
      writeFileSync(path.join(repo, `docs/plans/2026-10-01-${slug}.md`), plan('feature', 'Delivered', '', '#999'));
    }
    writeFileSync(path.join(repo, 'docs/plans/2026-09-15-outside.md'), plan('bug', 'Delivered', '', '#999'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add shared-issue plans');
    git(repo, 'push', '-q', 'origin', 'main');

    expect((await run(ctx)).code).toBe(0);

    const statusCalls = trackerCalls.filter((c) => c.script === 'plot-issue-status.sh');
    expect(statusCalls).toHaveLength(3);
    for (const call of statusCalls) expect(call.args).toEqual(expect.arrayContaining(['--skip-issue', '999']));
  });

  it('keeps a shared issue open with no outside sibling, now that the release itself books every plan naming it', async () => {
    const { repo, ctx, trackerCalls } = estate({ tagged: true });
    for (const slug of ['alpha', 'beta', 'gamma']) {
      writeFileSync(path.join(repo, `docs/plans/2026-10-01-${slug}.md`), plan('feature', 'Delivered', '', '#999'));
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'share an issue across the booked plans');
    git(repo, 'push', '-q', 'origin', 'main');

    expect((await run(ctx)).code).toBe(0);

    const statusCalls = trackerCalls.filter((c) => c.script === 'plot-issue-status.sh');
    expect(statusCalls).toHaveLength(3);
    for (const call of statusCalls) expect(call.args).not.toEqual(expect.arrayContaining(['--skip-issue', '999']));
  });

  it('books a shared-issue plan outside the sprint that a shipped changeset names, so it no longer holds the issue open', async () => {
    const { repo, origin, ctx, trackerCalls } = estate({ tagged: true });
    for (const slug of ['alpha', 'beta', 'gamma']) {
      writeFileSync(path.join(repo, `docs/plans/2026-10-01-${slug}.md`), plan('feature', 'Delivered', '', '#999'));
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'share an issue across the booked plans');
    git(repo, 'push', '-q', 'origin', 'main');
    const host = landMerge(path.dirname(repo), origin, [['delta', 'Delivered', '#999']], [['one', '2026-10-02-delta']]);

    const { code, out } = await run({ ...ctx, host });

    expect(code).toBe(0);
    expect(out).toMatch(/booked alpha, beta, gamma, delta/);
    const statusCalls = trackerCalls.filter((c) => c.script === 'plot-issue-status.sh');
    expect(statusCalls).toHaveLength(4);
    for (const call of statusCalls) expect(call.args).not.toEqual(expect.arrayContaining(['--skip-issue', '999']));
  });

  it('continues past one plan\'s tracker failure, prints it, and still writes the next plan', async () => {
    const { repo, ctx, trackerCalls } = estate({ tagged: true });
    writeFileSync(path.join(repo, 'docs/plans/2026-10-01-alpha.md'), plan('feature', 'Delivered', '', '#999'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'give alpha an issue');
    git(repo, 'push', '-q', 'origin', 'main');
    const realAwaited = ctx.scripts.awaited.bind(ctx.scripts);
    let failedOnce = false;
    ctx.scripts = {
      ...ctx.scripts,
      awaited: async (script, args, options) => {
        if (script === 'plot-plan-state.sh' && !failedOnce) {
          failedOnce = true;
          trackerCalls.push({ script, args, fileText: readFileSync(args[0], 'utf8') });
          return { stdout: '', stderr: 'boom\n', code: 1 };
        }
        return realAwaited(script, args, options as never);
      },
    };

    const { code, out } = await run(ctx);

    expect(code).toBe(0);
    expect(out).toContain('plan-state: boom');
    expect(out).toContain('left-open=1 (failed=1)');
    expect(trackerCalls.filter((c) => c.script === 'plot-plan-state.sh')).toHaveLength(3);
  });

  /**
   * Lands a release as a real merge commit that deletes `changesets` — each `[file, plan name]` —
   * and leaves `.changeset/` holding only its README on main. Returns a host naming that merge.
   */
  const landMerge = (
    root: string,
    origin: string,
    plans: readonly (readonly [string, string, string])[],
    changesets: readonly (readonly [string, string])[],
  ): Host => {
    const other = path.join(root, 'other-merge');
    git(root, 'clone', '-q', origin, other);
    for (const [slug, state, issue] of plans) {
      writeFileSync(path.join(other, `docs/plans/2026-10-02-${slug}.md`), plan('feature', state, '', issue));
    }
    mkdirSync(path.join(other, '.changeset'), { recursive: true });
    for (const [file, planName] of changesets) {
      writeFileSync(
        path.join(other, `.changeset/${file}.md`),
        `---\n'plot': patch\n---\n\nA description long enough to publish.\n\n<!--\nplan: docs/plans/${planName}.md\nbumps:\n  skills:\n    plot: patch\n-->\n`,
      );
    }
    writeFileSync(path.join(other, '.changeset/README.md'), '# changesets\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'work');
    git(other, 'push', '-q', 'origin', 'main');
    git(other, 'checkout', '-q', '-b', 'changeset-release/main');
    for (const [file] of changesets) git(other, 'rm', '-q', `.changeset/${file}.md`);
    writeFileSync(path.join(other, 'package.json'), '{"name":"x","version":"1.3.0"}\n');
    git(other, 'commit', '-q', '-am', 'release 1.3.0');
    git(other, 'checkout', '-q', 'main');
    git(other, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #9', 'changeset-release/main');
    git(other, 'push', '-q', 'origin', 'main');
    const merge = git(other, 'rev-parse', 'HEAD').trim();
    git(other, 'tag', 'v1.3.0');
    git(other, 'push', '-q', 'origin', 'v1.3.0');
    expect(git(other, 'ls-tree', '--name-only', 'HEAD', '.changeset/')).toBe('.changeset/README.md\n');
    return {
      prState: async () => answered({ number: 9, head: 'changeset-release/main', base: 'main', state: 'MERGED', mergeCommit: merge }),
    } as unknown as Host;
  };

  it('books a plan outside the sprint that a changeset removed by the release merge names, and names the rest', async () => {
    const { repo, origin, ctx } = estate({ tagged: true });
    const root = path.dirname(repo);
    const host = landMerge(
      root,
      origin,
      [['omega', 'Delivered', ''], ['zeta', 'Delivered', ''], ['appr', 'Approved', '']],
      [['one', '2026-10-02-omega'], ['two', '2026-10-02-appr'], ['three', '2026-10-02-ghost']],
    );

    const { code, out } = await run({ ...ctx, host });

    expect(code).toBe(0);
    expect(out).toMatch(/finished: v1\.3\.0 booked alpha, beta, gamma, omega/);
    expect(out).toContain('not booked: zeta');
    expect(out).toContain('appr (phase approved)');
    expect(out).toContain('ghost (no plan file)');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(onMain(repo, 'docs/plans/2026-10-02-omega.md')).toContain('- **State:** Released');
    expect(onMain(repo, 'docs/plans/2026-10-02-zeta.md')).toContain('- **State:** Delivered');
    expect(onMain(repo, 'docs/plans/2026-10-02-appr.md')).toContain('- **State:** Approved');
  });

  it('books the scope and names shipped-unread where the merge commit cannot be read', async () => {
    const { repo, ctx } = estate({ tagged: true });

    const { code, out } = await run(ctx);

    expect(code).toBe(0);
    expect(out).toContain('shipped-unread');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(onMain(repo, 'docs/plans/2026-10-01-alpha.md')).toContain('- **State:** Released');
  });
});
