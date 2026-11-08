// `plot-approve.mjs --branch <name>` against a real repository and a bare
// origin, with a fixture host: the plan PR merges into `<name>` only, and the
// approval is read from and booked on `origin/<name>`.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Pr } from '@plot-pm/domain/entities/pr';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { perform, run, type Args, type Context } from '../../src/server/entry/approve.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-11-08-p.md';
const SPRINT = 'sprint/s';
const IDEA = 'idea/batch-p';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const planText = `# P

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:**

## Branches

### Wave one
- \`feature/p\` — the work
`;

const claudeMd = '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n- **Sprint directory:** docs/sprints/\n';

describe('plot-approve --branch books the approval on the named branch', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * A repository whose origin holds `main` and the integration branch
   * `sprint/s`, and a plan PR branch cut from `base` that adds the plan. The
   * checkout stays on `main`, so the plan is not in it.
   */
  const setup = (base: string): { repo: string; origin: string; head: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-approve-branch-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(repo, 'CLAUDE.md'), claudeMd);
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(path.join(repo, 'docs/plans/active/.keep'), '');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');

    git(repo, 'switch', '-q', '-c', SPRINT);
    writeFileSync(path.join(repo, 'sprint.txt'), 'the sprint\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'sprint');
    git(repo, 'push', '-q', 'origin', SPRINT);

    git(repo, 'switch', '-q', '-c', IDEA, base);
    writeFileSync(path.join(repo, PLAN), planText);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'plan p');
    git(repo, 'push', '-q', 'origin', IDEA);
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'switch', '-q', 'main');
    git(repo, 'branch', '-q', '-D', IDEA, SPRINT);
    git(repo, 'fetch', '-q', 'origin');
    return { repo, origin, head };
  };

  const planPr = (head: string, base: string): Pr => ({
    number: 7, repo: '', head: IDEA, base, state: 'OPEN', mergedAt: null, mergeCommit: '',
    draft: false, mergeable: 'mergeable', review: '', checks: 'passing', failingChecks: [],
    url: '', author: '', headSha: head,
  });

  /**
   * Real git adapters over `repo`, a fixture host holding the plan PR, and a
   * `Scripts` whose host calls are recorded: `pr-merge` lands the PR head on
   * `mergeInto` by a fast-forward push, the way a merge would.
   */
  const ctxFor = (repo: string, pr: Pr, mergeInto: string, calls: string[][]): Context => {
    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const real = scriptsShell(context);
    const scripts: Scripts = {
      ...real,
      host: async (args) => {
        calls.push([...args]);
        if (args[0] === 'pr-merge') git(repo, 'push', '-q', 'origin', `${pr.headSha}:refs/heads/${mergeInto}`);
        return { ok: true, value: '' };
      },
      awaited: async (script, args, options) =>
        script === 'plot-plan-state.sh' || script === 'plot-issue-status.sh'
          ? { stdout: '', stderr: '', code: 0 }
          : real.awaited(script, args, options),
    };
    return {
      repoRoot: repo,
      scriptDir: SCRIPT_DIR,
      host: hostFixture({ backend: 'github', prs: [pr], commitStatuses: [] }),
      planStore: planStoreShell(context),
      refs: refsGit(context),
      scripts,
      trees: treesGit(context),
    };
  };

  const approve = async (ctx: Context, args: Partial<Args>): Promise<{ code: number; said: string }> => {
    const out: string[] = [];
    try {
      const code = await perform(ctx, { dryRun: false, spike: false, who: 'jw', slug: 'p', ...args }, (s) => out.push(s), (s) => out.push(s));
      return { code, said: out.join('') };
    } catch (err) {
      return { code: 1, said: `${out.join('')}\nrefused: ${(err as Error).message}` };
    }
  };

  const tipOf = (origin: string, ref: string): string => git(origin, 'rev-parse', ref).trim();
  const merges = (calls: string[][]): string[][] => calls.filter((args) => args[0] === 'pr-merge');

  it('merges the plan PR into the named branch, books the approval there, and leaves main as it was', async () => {
    const { repo, origin, head } = setup(SPRINT);
    const calls: string[][] = [];
    const mainBefore = tipOf(origin, 'main');

    const r = await approve(ctxFor(repo, planPr(head, SPRINT), SPRINT, calls), { branch: SPRINT });
    expect(r.code, r.said).toBe(0);
    expect(r.said).toContain(`read it from PR #7 (${IDEA})`);
    expect(r.said).toMatch(/summary: merged=yes phase=flipped record=written .* push=clean /);

    expect(merges(calls)).toEqual([['pr-merge', '7', '--match-head', head, '--delete-branch']]);
    expect(tipOf(origin, 'main')).toBe(mainBefore);
    const landed = git(origin, 'show', `${SPRINT}:${PLAN}`);
    expect(landed).toContain('- **State:** Approved');
    expect(landed).toMatch(/- \*\*Approved:\*\* \d{4}-\d{2}-\d{2}, jw, plan-PR #7 merged/);
    expect(git(origin, 'log', '-1', '--format=%s', SPRINT).trim()).toBe('plot: approve p');
  }, 60_000);

  it('names the target branch on a dry run, and merges and writes nothing', async () => {
    const { repo, origin, head } = setup(SPRINT);
    const calls: string[][] = [];
    const sprintBefore = tipOf(origin, SPRINT);

    const r = await approve(ctxFor(repo, planPr(head, SPRINT), SPRINT, calls), { branch: SPRINT, dryRun: true });
    expect(r.code, r.said).toBe(0);
    expect(r.said).toContain('step: would merge PR #7\n');
    expect(r.said).toContain(`step: would record the approval on ${SPRINT}\n`);
    expect(merges(calls)).toEqual([]);
    expect(tipOf(origin, SPRINT)).toBe(sprintBefore);
  }, 60_000);

  it('refuses a plan PR whose base is not the named branch, before the merge', async () => {
    const { repo, origin, head } = setup(SPRINT);
    const calls: string[][] = [];
    git(repo, 'push', '-q', 'origin', 'main:refs/heads/sprint/other');
    const before = [tipOf(origin, 'main'), tipOf(origin, SPRINT), tipOf(origin, 'sprint/other')];

    const r = await approve(ctxFor(repo, planPr(head, SPRINT), SPRINT, calls), { branch: 'sprint/other' });
    expect(r.code, r.said).toBe(1);
    expect(r.said).toContain(`PR #7 does not merge into 'sprint/other': its base is '${SPRINT}'`);
    expect(merges(calls)).toEqual([]);
    expect([tipOf(origin, 'main'), tipOf(origin, SPRINT), tipOf(origin, 'sprint/other')]).toEqual(before);
  }, 60_000);

  it('refuses a plan PR based on another branch without --branch, naming --branch <base>, before the merge', async () => {
    const { repo, origin, head } = setup(SPRINT);
    const calls: string[][] = [];
    const before = [tipOf(origin, 'main'), tipOf(origin, SPRINT)];

    const r = await approve(ctxFor(repo, planPr(head, SPRINT), SPRINT, calls), {});
    expect(r.code, r.said).toBe(1);
    expect(r.said).toContain(`PR #7 merges into '${SPRINT}', not the default branch 'main'`);
    expect(r.said).toContain(`plot-approve.mjs --branch ${SPRINT} <slug>`);
    expect(merges(calls)).toEqual([]);
    expect([tipOf(origin, 'main'), tipOf(origin, SPRINT)]).toEqual(before);
  }, 60_000);

  it('refuses a branch origin does not hold, before the merge', async () => {
    const { repo, head } = setup(SPRINT);
    const calls: string[][] = [];

    const r = await approve(ctxFor(repo, planPr(head, SPRINT), SPRINT, calls), { branch: 'sprint/nope' });
    expect(r.code, r.said).toBe(1);
    expect(r.said).toContain("could not fetch branch 'sprint/nope' from origin");
    expect(merges(calls)).toEqual([]);
  }, 60_000);

  it('without --branch, merges a PR based on the default branch and books on it as before', async () => {
    const { repo, origin, head } = setup('main');
    const calls: string[][] = [];
    const sprintBefore = tipOf(origin, SPRINT);

    const r = await approve(ctxFor(repo, planPr(head, 'main'), 'main', calls), {});
    expect(r.code, r.said).toBe(0);
    expect(r.said).not.toContain('would record the approval on');
    expect(merges(calls)).toEqual([['pr-merge', '7', '--match-head', head, '--delete-branch']]);
    expect(git(origin, 'show', `main:${PLAN}`)).toContain('- **State:** Approved');
    expect(tipOf(origin, SPRINT)).toBe(sprintBefore);
  }, 60_000);

  it('refuses --branch with no name, or with a flag for a name', async () => {
    const said: string[] = [];
    expect(await run(['p', '--branch'], '/', SCRIPT_DIR, () => {}, (s) => said.push(s))).toBe(1);
    expect(await run(['--branch', '--dry-run', 'p'], '/', SCRIPT_DIR, () => {}, (s) => said.push(s))).toBe(1);
    expect(said.join('')).toContain('plot-approve: --branch needs a branch name');
    expect(said.join('')).toContain("plot-approve: --branch takes a branch name, not the flag '--dry-run'");
  });
});
