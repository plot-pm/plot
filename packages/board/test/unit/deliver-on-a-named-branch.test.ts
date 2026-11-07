// `plot-deliver.mjs --branch <name>` against a real repository and a bare
// origin: the delivery is read from and recorded on `origin/<name>`, and the
// default branch is left as it was.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/server/entry/deliver.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-11-07-p.md';
const SPRINT = 'docs/sprints/2026-W45-card-alignment.md';
const BRANCH = 'sprint/card-alignment';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const planText = (state: string): string =>
  `# P\n\n## Status\n\n- **State:** ${state}\n${state === 'Approved' ? '- **Approved:** 2026-11-07 by jw\n' : ''}`;

const sprintText = `# Sprint: Card alignment

## Status

- **State:** Active
- **Start:** 2026-11-02
- **End:** 2026-11-13

## Sprint Goal

Every card follows one grammar.

### Must Have

- [ ] [p] One card grammar

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->
`;

describe('plot-deliver --branch records the delivery on the named branch', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * A repository whose `main` holds the plan as Draft, and whose integration
   * branch on origin holds it as Approved with an active index link and a
   * sprint that names it. The checkout stays on `main`.
   */
  const setup = (): { repo: string; origin: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-deliver-branch-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    mkdirSync(path.join(repo, 'docs/sprints'), { recursive: true });
    writeFileSync(path.join(repo, PLAN), planText('Draft'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');

    git(repo, 'switch', '-q', '-c', BRANCH);
    writeFileSync(path.join(repo, PLAN), planText('Approved'));
    symlinkSync('../2026-11-07-p.md', path.join(repo, 'docs/plans/active/p.md'));
    writeFileSync(path.join(repo, SPRINT), sprintText);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'approve p on the sprint branch');
    git(repo, 'push', '-q', 'origin', BRANCH);
    git(repo, 'switch', '-q', 'main');
    git(repo, 'branch', '-q', '-D', BRANCH);
    return { repo, origin };
  };

  const deliver = async (repo: string, argv: string[]): Promise<{ code: number; said: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s));
    return { code, said: `${out.join('')}\n--- stderr ---\n${err.join('')}` };
  };

  const tipOf = (origin: string, ref: string): string => git(origin, 'rev-parse', ref).trim();
  const worktreesOf = (repo: string): number => git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

  it('reads the Approved plan from origin/<name>, books it there, and leaves main as it was', async () => {
    const { repo, origin } = setup();
    const mainBefore = tipOf(origin, 'main');

    const r = await deliver(repo, ['--who', 'jw', '--branch', BRANCH, 'p']);
    expect(r.code, r.said).toBe(0);
    expect(r.said).toMatch(/summary: phase=flipped record=written index=moved sprint=updated push=clean /);

    expect(tipOf(origin, 'main')).toBe(mainBefore);
    const landed = git(origin, 'show', `${BRANCH}:${PLAN}`);
    expect(landed).toContain('- **State:** Delivered');
    expect(landed).toMatch(/- \*\*Delivered:\*\* \d{4}-\d{2}-\d{2}/);
    expect(git(origin, 'show', `${BRANCH}:${SPRINT}`)).toContain('- [x] [p] One card grammar');
    const tree = git(origin, 'ls-tree', '-r', '--name-only', BRANCH);
    expect(tree).toContain('docs/plans/delivered/p.md');
    expect(tree).not.toContain('docs/plans/active/p.md');
    expect(git(origin, 'show', `main:${PLAN}`)).toContain('- **State:** Draft');
    expect(worktreesOf(repo)).toBe(1);
    expect(git(repo, 'branch', '--list', 'plot/deliver-p').trim()).toBe('');
  }, 60_000);

  it('reports the target branch on a dry run, and writes nothing', async () => {
    const { repo, origin } = setup();
    const branchBefore = tipOf(origin, BRANCH);

    const r = await deliver(repo, ['--dry-run', '--branch', BRANCH, 'p']);
    expect(r.code, r.said).toBe(0);
    expect(r.said).toContain(`step: would record the delivery on ${BRANCH}\n`);
    expect(r.said).toContain('summary: phase=would record=would index=would sprint=would push=would\n');

    expect(tipOf(origin, BRANCH)).toBe(branchBefore);
    expect(worktreesOf(repo)).toBe(1);
    expect(git(repo, 'branch', '--list', 'plot/deliver-p').trim()).toBe('');
  }, 60_000);

  it('refuses a branch origin does not hold, by name, before anything is written', async () => {
    const { repo, origin } = setup();
    const mainBefore = tipOf(origin, 'main');

    const r = await deliver(repo, ['--who', 'jw', '--branch', 'sprint/nope', 'p']);
    expect(r.code, r.said).toBe(1);
    expect(r.said).toContain("plot-deliver: branch 'sprint/nope' does not exist on origin");

    expect(tipOf(origin, 'main')).toBe(mainBefore);
    expect(worktreesOf(repo)).toBe(1);
    const receipts = path.join(repo, '.plot/state/state-receipts');
    expect(existsSync(receipts) ? readdirSync(receipts) : []).toEqual([]);
  }, 60_000);

  it('refuses the Draft copy on main without --branch, so the default path still reads the default branch', async () => {
    const { repo, origin } = setup();
    const branchBefore = tipOf(origin, BRANCH);

    const r = await deliver(repo, ['--who', 'jw', 'p']);
    expect(r.code, r.said).toBe(1);
    expect(r.said).toContain("plot-deliver: plan 'p' is still 'draft'");
    expect(tipOf(origin, BRANCH)).toBe(branchBefore);
  }, 60_000);

  it('refuses --release with --branch by name', async () => {
    const { repo } = setup();
    const r = await deliver(repo, ['--release', '1.0.0', '--branch', BRANCH, 'p']);
    expect(r.code, r.said).toBe(1);
    expect(r.said).toContain('plot-deliver: --branch records a delivery only');
  }, 60_000);

  it('refuses --branch with no name', async () => {
    const { repo } = setup();
    const missing = await deliver(repo, ['p', '--branch']);
    expect(missing.code, missing.said).toBe(1);
    expect(missing.said).toContain('plot-deliver: --branch needs a branch name');
    const flag = await deliver(repo, ['--branch', '--dry-run', 'p']);
    expect(flag.code, flag.said).toBe(1);
    expect(flag.said).toContain("plot-deliver: --branch takes a branch name, not the flag '--dry-run'");
  }, 60_000);
});
