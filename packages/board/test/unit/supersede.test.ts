// `plot-supersede.mjs` against a real repository and a bare origin: the
// supersession is decided by the domain, booked on the default branch, and
// leaves the state receipt `plot-state-gate.sh` reads.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/server/entry/supersede.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const OLD = 'docs/plans/2026-11-01-old.md';
const NEW = 'docs/plans/2026-11-02-new.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const planText = (title: string, state: string, extra = ''): string =>
  `# ${title}\n\n## Status\n\n- **State:** ${state}\n- **Review:** pr\n${state === 'Approved' ? '- **Approved:** 2026-11-01 by jw\n' : ''}${extra}\n## Branches\n\n- \`feature/${title}\` — the work\n`;

describe('plot-supersede marks a plan Superseded by its successor', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A repository whose `main` holds `old` in `oldState` with an active index link, and `new` as Draft. */
  const setup = (oldState = 'Approved', oldExtra = ''): { repo: string; origin: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-supersede-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(path.join(repo, OLD), planText('old', oldState, oldExtra));
    writeFileSync(path.join(repo, NEW), planText('new', 'Draft'));
    symlinkSync('../2026-11-01-old.md', path.join(repo, 'docs/plans/active/old.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    return { repo, origin };
  };

  const supersede = async (
    repo: string,
    argv: string[],
    env: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number; out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s), env);
    return { code, out: out.join(''), err: err.join('') };
  };

  const tipOf = (origin: string): string => git(origin, 'rev-parse', 'main').trim();
  const receipts = (repo: string): string[] => {
    const dir = path.join(repo, '.plot/state/state-receipts');
    return existsSync(dir) ? readdirSync(dir).map((name) => readFileSync(path.join(dir, name), 'utf8')) : [];
  };

  it('flips the state, writes the record, moves the link, leaves the receipt, and pushes', async () => {
    const { repo, origin } = setup();

    const r = await supersede(repo, ['--who', 'jw', '--by', 'new', 'old']);
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    expect(r.out).toMatch(/summary: phase=flipped record=written index=moved push=/);

    const landed = git(origin, 'show', `main:${OLD}`);
    expect(landed).toContain('- **State:** Superseded');
    expect(landed).toMatch(/- \*\*Superseded:\*\* \d{4}-\d{2}-\d{2}, by `new`/);
    const tree = git(origin, 'ls-tree', '-r', '--name-only', 'main');
    expect(tree).toContain('docs/plans/delivered/old.md');
    expect(tree).not.toContain('docs/plans/active/old.md');
    expect(git(origin, 'log', '-1', '--format=%s', 'main').trim()).toBe('plot: supersede old by new');
    expect(receipts(repo)).toEqual([`${OLD}\tSuperseded\n`]);
    expect(git(repo, 'branch', '--list', 'plot/supersede-old').trim()).toBe('');
  }, 60_000);

  it('refuses under PLOT_UNATTENDED=1 before it reads anything', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);

    const r = await supersede(repo, ['--by', 'new', 'old'], { PLOT_UNATTENDED: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('PLOT_UNATTENDED=1');
    expect(tipOf(origin)).toBe(before);
    expect(receipts(repo)).toEqual([]);
  }, 60_000);

  it('refuses a successor that names no plan file as successor-not-found', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);

    const r = await supersede(repo, ['--by', 'nowhere', 'old']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('successor-not-found');
    expect(tipOf(origin)).toBe(before);
    expect(receipts(repo)).toEqual([]);
  }, 60_000);

  it('refuses a plan that names itself as same-plan', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);

    const r = await supersede(repo, ['--by', 'old', 'old']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('same-plan');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('refuses a Delivered plan with the domain refusal and writes nothing', async () => {
    const { repo, origin } = setup('Delivered', '- **Delivered:** 2026-11-03\n');
    const before = tipOf(origin);

    const r = await supersede(repo, ['--by', 'new', 'old']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('landed work cannot be superseded');
    expect(tipOf(origin)).toBe(before);
    expect(receipts(repo)).toEqual([]);
  }, 60_000);

  it('supersedes a Draft plan', async () => {
    const { repo, origin } = setup('Draft');

    const r = await supersede(repo, ['--who', 'jw', '--by', 'new', 'old']);
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    expect(git(origin, 'show', `main:${OLD}`)).toContain('- **State:** Superseded');
  }, 60_000);

  it('exits 0 and writes nothing for a plan already Superseded with a record', async () => {
    const { repo, origin } = setup('Superseded', '- **Superseded:** 2026-11-04, by `new`\n');
    const before = tipOf(origin);

    const r = await supersede(repo, ['--by', 'new', 'old']);
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    expect(r.out).toContain('summary: phase=already record=already');
    expect(tipOf(origin)).toBe(before);
    expect(receipts(repo)).toEqual([]);
  }, 60_000);

  it('refuses without --by', async () => {
    const { repo } = setup();
    const r = await supersede(repo, ['old']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('need a plan slug and its successor');
  }, 60_000);
});
