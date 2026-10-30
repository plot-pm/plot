// The release arm's shared-issue sibling read, against a real repository.
//
// Two plans name one issue. Release A runs first, pushes its own commit to
// `origin/main`, then B releases. The MAIN CHECKOUT is fetched once, before
// either release, and never again — the booking worktree each release cuts
// from `origin/main` is the only tree that sees the prior push. A sibling
// read rooted at the main checkout would read B's phase as of before A's
// push ever landed and never close the issue; reading `tmpwt` sees it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Host, PrIndexStore } from '@plot-pm/domain';
import { runRelease, type Args, type Context } from '../../src/server/entry/deliver.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const planText = (title: string, slug: string, state: string, prNumber: number): string =>
  `# ${title}\n\n## Status\n\n- **State:** ${state}\n- **Type:** bug\n- **Issue:** #999\n\n## Slices\n\n### One\n\n- \`bug/${slug}\` — the fix → #${prNumber}\n`;

/**
 * Stands in for the two tracker-write scripts `runRelease` calls after the
 * sibling read, so the test needs no configured `Tracker` or git host.
 * `plot-issue-status.sh`'s own output is never asserted on; `plot-plan-state.sh`'s
 * `issue\twritten\t...` line is what `runRelease` folds into `issues closed=`,
 * so it must name the issue the fixture plans actually share (`999`) and the
 * exact tab-separated shape `trackerReportOf` and `writtenOutcomes` expect.
 */
const trackerStub = (script: string) =>
  script === 'plot-plan-state.sh'
    ? { stdout: '999\twritten\treleased\nsummary: tracker=written\n', stderr: '', code: 0 }
    : { stdout: 'summary: tracker=none\n', stderr: '', code: 0 };

/** A `Host` whose `prState` answers a merged PR at a fixed commit, for every ref. */
const hostMergedAt = (mergeCommit: string): Host =>
  ({
    prState: async () => ({ ok: true, value: { mergeCommit } }),
  }) as unknown as Host;

const releaseArgs = (slug: string, version: string): Args => ({ dryRun: false, who: 'jw', releaseVersion: version, slug });

describe('the release arm reads shared-issue siblings from the booking worktree, not the main checkout', () => {
  const roots: string[] = [];
  // This suite asserts on the arm's tracker/sibling behaviour, not its caller
  // gate — pinned so a `PLOT_UNATTENDED=1` process environment (e.g. an
  // unattended worker running this very suite) cannot flip every case here to
  // an unexpected refusal.
  let previousUnattended: string | undefined;
  beforeEach(() => {
    previousUnattended = process.env.PLOT_UNATTENDED;
    delete process.env.PLOT_UNATTENDED;
  });
  afterEach(() => {
    if (previousUnattended === undefined) delete process.env.PLOT_UNATTENDED;
    else process.env.PLOT_UNATTENDED = previousUnattended;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * One bare `origin`, one `repo` clone that plays the main checkout for
   * every release call, and two plans — A and B — both Delivered and both
   * naming issue #999. `repo` is fetched once, here, and the test never
   * fetches it again: each release's own `tmpwt` is cut straight from
   * `origin/<main>`, so only `tmpwt` ever sees a sibling's push.
   */
  const estate = () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-shared-issue-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(repo, 'docs/plans/2026-10-01-a.md'), planText('A', 'a', 'Delivered', 101));
    writeFileSync(path.join(repo, 'docs/plans/2026-10-01-b.md'), planText('B', 'b', 'Delivered', 102));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');

    // Two distinct "merge commits", each tagged with only its own version —
    // `releaseTag` takes the FIRST tag (by version order) containing the
    // asked commit, so a shared commit would make both releases resolve to
    // `v1.0.0`. `v1.0.1`'s commit descends from `v1.0.0`'s, as a real release
    // sequence would have it, but `v1.0.0` does not contain it.
    const commitA = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'tag', 'v1.0.0', commitA);
    writeFileSync(path.join(repo, 'docs/plans/unrelated.md'), '# unrelated\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'unrelated change before B merges');
    git(repo, 'push', '-q', 'origin', 'main');
    const commitB = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'tag', 'v1.0.1', commitB);

    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const realScripts = scriptsShell(context);
    const scripts = {
      ...realScripts,
      awaited: async (script: string, args: readonly string[], options?: unknown) =>
        script === 'plot-issue-status.sh' || script === 'plot-plan-state.sh'
          ? trackerStub(script)
          : realScripts.awaited(script, args, options as never),
    };
    const ctx = (mergeCommit: string): Context => ({
      repoRoot: repo,
      scriptDir: SCRIPT_DIR,
      refs: refsGit(context),
      host: hostMergedAt(mergeCommit),
      planStore: planStoreShell(context),
      scripts: scripts as Context['scripts'],
      trees: treesGit(context),
      prIndex: {} as unknown as PrIndexStore,
    });
    return { repo, commitA, commitB, ctx };
  };

  const write: (lines: string[]) => (s: string) => void = (lines) => (s) => lines.push(s);

  it('closes the shared issue on the second release while the main checkout never moves', async () => {
    const { repo, commitA, commitB, ctx } = estate();

    const outA: string[] = [];
    const codeA = await runRelease(ctx(commitA), releaseArgs('a', 'v1.0.0'), 'docs/plans/2026-10-01-a.md', write(outA), write(outA));
    expect(codeA, outA.join('')).toBe(0);
    expect(outA.join('')).toMatch(/summary: issues closed=0 left-open=1 \(another-plan-unfinished=1\)/);

    const outB: string[] = [];
    const codeB = await runRelease(ctx(commitB), releaseArgs('b', 'v1.0.1'), 'docs/plans/2026-10-01-b.md', write(outB), write(outB));
    expect(codeB, outB.join('')).toBe(0);
    // B's sibling read must see A's just-landed `Released` state from the
    // booking worktree, which was cut from origin/main AFTER A's push — the
    // main checkout `repo`'s working tree was never re-fetched to show it.
    expect(outB.join('')).toMatch(/summary: issues closed=1 left-open=0/);

    git(repo, 'fetch', '-q', 'origin', 'main');
    const landedA = git(repo, 'show', 'origin/main:docs/plans/2026-10-01-a.md');
    const landedB = git(repo, 'show', 'origin/main:docs/plans/2026-10-01-b.md');
    expect(landedA).toContain('- **State:** Released\n');
    expect(landedB).toContain('- **State:** Released\n');
  }, 60_000);

  it('a single release with no concurrent sibling closes its issue as before', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-shared-issue-solo-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(repo, 'docs/plans/2026-10-01-solo.md'), planText('Solo', 'solo', 'Delivered', 201));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    const headSha = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'tag', 'v2.0.0', headSha);

    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const realScripts = scriptsShell(context);
    const scripts = {
      ...realScripts,
      awaited: async (script: string, args: readonly string[], options?: unknown) =>
        script === 'plot-issue-status.sh' || script === 'plot-plan-state.sh'
          ? trackerStub(script)
          : realScripts.awaited(script, args, options as never),
    };
    const ctx: Context = {
      repoRoot: repo,
      scriptDir: SCRIPT_DIR,
      refs: refsGit(context),
      host: hostMergedAt(headSha),
      planStore: planStoreShell(context),
      scripts: scripts as Context['scripts'],
      trees: treesGit(context),
      prIndex: {} as unknown as PrIndexStore,
    };

    const out: string[] = [];
    const code = await runRelease(ctx, releaseArgs('solo', 'v2.0.0'), 'docs/plans/2026-10-01-solo.md', write(out), write(out));
    expect(code, out.join('')).toBe(0);
    expect(out.join('')).toMatch(/summary: issues closed=1 left-open=0/);
  }, 60_000);

  it('reports an unreadable sibling set and skips the close, rather than reading an empty one', async () => {
    const { repo, commitA, ctx } = estate();
    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const realScripts = scriptsShell(context);

    // A directory the booking worktree's `listDir(planDir)` cannot read: an
    // absolute path outside `tmpwt` (`listDir` resolves an absolute `dir`
    // unchanged — see plan-store-shell.ts), stripped of all permissions, so
    // the sibling read sees a real `EACCES` rather than a stubbed refusal.
    const unreadable = mkdtempSync(path.join(tmpdir(), 'plot-shared-issue-unreadable-'));
    roots.push(unreadable);
    chmodSync(unreadable, 0o000);

    const brokenCtx: Context = {
      ...ctx(commitA),
      scripts: {
        ...realScripts,
        config: async (key: string, fallback: string, options?: unknown) =>
          key === 'Plan directory' ? { ok: true as const, value: unreadable } : realScripts.config(key, fallback, options as never),
        awaited: async (script: string, args: readonly string[], options?: unknown) =>
          script === 'plot-issue-status.sh' || script === 'plot-plan-state.sh'
            ? trackerStub(script)
            : realScripts.awaited(script, args, options as never),
      } as unknown as Context['scripts'],
    };

    const out: string[] = [];
    const code = await runRelease(brokenCtx, releaseArgs('a', 'v1.0.0'), 'docs/plans/2026-10-01-a.md', write(out), write(out));
    const said = out.join('');
    chmodSync(unreadable, 0o700);
    expect(code, said).toBe(0);
    expect(said).toContain('tracker: sibling read unreadable');
    expect(said).toMatch(/summary: issues closed=0 left-open=1 \(unreadable=1\)/);
  }, 60_000);
});
