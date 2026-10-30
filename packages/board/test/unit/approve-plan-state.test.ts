// `plot-approve.mjs`'s plan-state write against a real repository. The
// booking worktree is cut from `origin/main` and the caller's checkout is never
// fast-forwarded, so the checkout here is one commit BEHIND the plan: the write
// must still receive the approved plan, and the result must report what the
// write came to.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { perform, type Context } from '../../src/server/entry/approve.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const SLUG = 'told';
const PLAN = `docs/plans/2026-10-17-${SLUG}.md`;
const CONFIG = ['## Plot Config', '', '- **Plan directory:** docs/plans/', '- **Active index:** docs/plans/active/', '- **People:** jw = J W', ''].join('\n');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

/**
 * Gives a fixture repository its own identity. The approval commits through the
 * `Trees` adapter, which reads the repository's config and never this file's
 * `-c` flags, and a CI runner has no global `user.email` to fall back on.
 */
const ownIdentity = (repo: string): void => {
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'commit.gpgsign', 'false');
};

const planBody = (review: string, impl: string): string =>
  [
    '# Told', '', '## Status', '',
    '- **Phase:** Draft', '- **Type:** feature', `- **Review:** ${review}`, `- **Impl:** ${impl}`,
    '- **Issue:** #7', '- **Approved:**', '- **Started:**', '- **Delivered:**', '',
    '## Branches', '', '### Wave one', `- \`feature/${SLUG}\` — the work`, '',
  ].join('\n');

/** One call to `plot-plan-state.sh` or `plot-issue-status.sh`: its arguments, and the plan text the file held when it ran. */
interface PlanStateCall {
  script?: string;
  args: readonly string[];
  plan: string;
}

/**
 * The real adapters over `repo`, with `plot-plan-state.sh` answered by `answer`
 * and recorded in `calls` — the tracker is the one thing this test does not reach.
 */
const NO_STATUS = { stdout: 'summary: tracker=none\n', stderr: '', code: 0 };

const ctxOver = (
  repo: string,
  calls: PlanStateCall[],
  answer: { stdout: string; stderr: string; code: number },
  statusAnswer: { stdout: string; stderr: string; code: number } = NO_STATUS,
  statusCalls: PlanStateCall[] = [],
): Context => {
  const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
  const scripts = scriptsShell(context);
  const awaited = scripts.awaited.bind(scripts);
  scripts.awaited = async (script, args, options) => {
    if (script !== 'plot-plan-state.sh' && script !== 'plot-issue-status.sh') return awaited(script, args, options);
    const file = args[0] ?? '';
    if (script === 'plot-issue-status.sh') {
      statusCalls.push({ args: [...args], plan: existsSync(file) ? readFileSync(file, 'utf8') : '' });
      return statusAnswer;
    }
    calls.push({ args: [...args], plan: existsSync(file) ? readFileSync(file, 'utf8') : '' });
    return answer;
  };
  return {
    repoRoot: repo,
    scriptDir: SCRIPT_DIR,
    host: hostShell(context),
    planStore: planStoreShell(context),
    refs: refsGit(context),
    scripts,
    trees: treesGit(context),
  };
};

const WRITTEN = { stdout: '#7\twritten\tapproved\nsummary: tracker=written\n', stderr: '', code: 0 };

describe('an approval reflects the approved plan on its issue', () => {
  const roots: string[] = [];
  let unattended: string | undefined;
  beforeEach(() => {
    unattended = process.env.PLOT_UNATTENDED;
    delete process.env.PLOT_UNATTENDED;
  });
  afterEach(() => {
    if (unattended !== undefined) process.env.PLOT_UNATTENDED = unattended;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A bare origin whose `main` holds the plan, and a clone of `main` from before the plan landed. */
  const behindOrigin = (): string => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-approve-plan-state-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    ownIdentity(repo);
    writeFileSync(path.join(repo, 'CLAUDE.md'), CONFIG);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    git(root, 'clone', '-q', origin, other);
    mkdirSync(path.join(other, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(other, PLAN), planBody('in-session', 'own branches'));
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'plan');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    return repo;
  };

  it('hands the write the plan as pushed, though this checkout never held it, and reports written', async () => {
    const repo = behindOrigin();
    const calls: PlanStateCall[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const code = await perform(ctxOver(repo, calls, WRITTEN), { dryRun: false, spike: false, who: 'jw', slug: SLUG }, (s) => out.push(s), (s) => err.push(s));

    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(0);
    expect(existsSync(path.join(repo, PLAN)), 'the checkout was fast-forwarded, so the test proves nothing').toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(1)).toEqual(['--phase', 'approved', '--plan-link', PLAN]);
    expect(calls[0]?.plan).toContain('- **Phase:** Approved');
    expect(calls[0]?.plan).toContain('- **Issue:** #7');
    expect(said).toContain('  plan-state: #7\twritten\tapproved\n');
    expect(said).toMatch(/summary: merged=skipped-in-session .* push=clean plan-state=written tracker=none\n/);
    expect(existsSync(calls[0]?.args[0] ?? ''), 'the copy of the booked plan outlived the approval').toBe(false);
  }, 60_000);

  it('reports a write that exits 2 as failed, with its reason, and the approval stands', async () => {
    const repo = behindOrigin();
    const calls: PlanStateCall[] = [];
    const out: string[] = [];
    const failing = { stdout: 'summary: tracker=failed\n', stderr: "plot-plan-state: 'x' is not a plan file\n", code: 2 };
    const code = await perform(ctxOver(repo, calls, failing), { dryRun: false, spike: false, who: 'jw', slug: SLUG }, (s) => out.push(s), () => {});

    const said = out.join('');
    expect(code, said).toBe(0);
    expect(said).toContain("  plan-state: plot-plan-state: 'x' is not a plan file\n");
    expect(said).toMatch(/ plan-state=failed tracker=none\n/);
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(git(repo, 'show', `origin/main:${PLAN}`)).toContain('- **Phase:** Approved');
  }, 60_000);

  it('links the plan PR on an `Impl: same branch` approval, whose plan is not on main', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-approve-plan-state-')));
    roots.push(root);
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '-b', 'main', repo);
    ownIdentity(repo);
    writeFileSync(path.join(repo, 'CLAUDE.md'), CONFIG);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'checkout', '-q', '-b', `feature/${SLUG}`);
    mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(repo, PLAN), planBody('pr', 'same branch'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'plan');

    const calls: PlanStateCall[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const ctx = ctxOver(repo, calls, WRITTEN);
    ctx.host = hostFixture({
      prs: [{
        number: 9, repo: '', head: `feature/${SLUG}`, state: 'OPEN', mergedAt: null, mergeCommit: '',
        draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing', failingChecks: [],
        url: 'https://github.com/o/r/pull/9', author: '', headSha: 'a'.repeat(40),
      }],
    });
    const code = await perform(ctx, { dryRun: false, spike: false, who: 'jw', slug: SLUG }, (s) => out.push(s), (s) => err.push(s));

    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([path.join(repo, PLAN), '--phase', 'approved', '--plan-link', 'https://github.com/o/r/pull/9']);
    expect(calls[0]?.plan).toContain('- **Phase:** Approved');
    expect(said).toMatch(/ push=local plan-state=written tracker=none\n/);
  }, 60_000);

  it('writes the approved status through plot-issue-status.sh and reports it', async () => {
    const repo = behindOrigin();
    const statusCalls: PlanStateCall[] = [];
    const out: string[] = [];
    const status = { stdout: '#7\twritten\tOpen\nsummary: tracker=written\n', stderr: '', code: 0 };
    const code = await perform(ctxOver(repo, [], WRITTEN, status, statusCalls), { dryRun: false, spike: false, who: 'jw', slug: SLUG }, (s) => out.push(s), () => {});

    const said = out.join('');
    expect(code, said).toBe(0);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.plan).toContain('- **Phase:** Approved');
    expect(said).toContain('  tracker: #7\twritten\tOpen\n');
    expect(said).toMatch(/ plan-state=written tracker=written\n/);
    expect(existsSync(statusCalls[0]?.args[0] ?? ''), 'the copy of the booked plan outlived the approval').toBe(false);
  }, 60_000);

  it('reports a failing status write and the approval stands', async () => {
    const repo = behindOrigin();
    const out: string[] = [];
    const failing = { stdout: 'summary: tracker=failed\n', stderr: 'plot-issue-status: the bundle failed\n', code: 2 };
    const code = await perform(ctxOver(repo, [], WRITTEN, failing), { dryRun: false, spike: false, who: 'jw', slug: SLUG }, (s) => out.push(s), () => {});

    const said = out.join('');
    expect(code, said).toBe(0);
    expect(said).toContain('  tracker: plot-issue-status: the bundle failed\n');
    expect(said).toMatch(/ plan-state=written tracker=failed\n/);
  }, 60_000);
});
