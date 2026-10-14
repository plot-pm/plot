import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { treesFixture } from '@plot-pm/domain/adapters/trees/trees-fixture';
const answered = <T>(value: T) => ({ ok: true as const, value });
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { jurorPath } from '@plot-pm/domain/rules/panel';
import type { PlanStore, Scripts } from '@plot-pm/domain';
import { record, type Context } from '../../src/server/entry/verify.js';

const PLAN = 'docs/plans/p.md';
const JUDGED = 'b'.repeat(40);
const ON_MAIN = '# P\n\n## Status\n\n- **Delivered:** 2026-10-01\n\n## Changelog\n\n- one\n';
const CHECKLIST = 'docs/releases/vnext-checklist.md';

describe('record keeps the release checklist', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A repository with an `origin` that holds `main`, and a prepared run for `p`. */
  const repository = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'plot-verify-checklist-'));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    const run = path.join(repo, '.plot', 'state', 'verify', 'p');
    mkdirSync(run, { recursive: true });
    const facts = { slug: 'p', plan: PLAN, delivery: 'a'.repeat(40), judged: JUDGED, tools: 'c'.repeat(40), deliveredOn: '2026-10-01', files: [] };
    writeFileSync(path.join(run, 'run.json'), JSON.stringify(facts));
    const juror = path.join(repo, jurorPath('p', 'a', 'verify-'));
    mkdirSync(path.dirname(juror), { recursive: true });
    writeFileSync(juror, 'Claim-1: supported\n');
    return repo;
  };

  /**
   * A `Context` whose `planStore` serves the plan in-memory (matching the
   * working pattern in `verify-record-opens-once.test.ts`) while the
   * checklist path reads and writes a real file under `checklistRoot` — so it
   * genuinely persists across two separate `record()` calls.
   */
  const contextOf = (repo: string, checklistRoot: string, plans: Readonly<Record<string, string>>): Context => ({
    repoRoot: repo,
    scriptDir: repo,
    scriptsRel: '',
    refs: refsFixture({ files: { [`${JUDGED}:${PLAN}`]: ON_MAIN } }),
    host: hostFixture({ backend: 'github' }),
    planStore: {
      readText: async (file: string) => {
        const match = Object.keys(plans).find((plan) => file.endsWith(plan));
        if (match !== undefined) return answered(plans[match]);
        const real = path.join(checklistRoot, CHECKLIST);
        return answered(file.endsWith(CHECKLIST) && existsSync(real) ? readFileSync(real, 'utf8') : null);
      },
      writeText: async (file: string, content: string) => {
        if (file.endsWith(CHECKLIST)) {
          const real = path.join(checklistRoot, CHECKLIST);
          mkdirSync(path.dirname(real), { recursive: true });
          writeFileSync(real, content);
        }
        return answered(undefined);
      },
    } as unknown as PlanStore,
    scripts: {
      config: async (key: string, fallback: string) => answered(key === 'Tracker' ? 'jira' : fallback),
      host: async () => answered(''),
      awaited: async () => ({ stdout: '', stderr: '', code: 0 }),
    } as unknown as Scripts,
    trees: treesFixture({}),
    issueTracker: () => trackerFixture({ scheme: 'jira' }),
  });

  it('writes one checklist item for the verified plan, carrying no RC: line', async () => {
    const repo = repository();
    const checklistRoot = mkdtempSync(path.join(tmpdir(), 'plot-verify-checklist-out-'));
    roots.push(checklistRoot);
    const args = { command: 'record' as const, slug: 'p', at: '', sha: '' };
    const quiet = () => undefined;

    expect(await record(contextOf(repo, checklistRoot, { [PLAN]: ON_MAIN }), args, quiet, quiet)).toBe(0);

    const checklist = readFileSync(path.join(checklistRoot, CHECKLIST), 'utf8');
    expect(checklist).not.toMatch(/^RC:/m);
    expect(checklist).toContain('- [ ] p — one — verified 1/1');
  });

  it('leaves a checklist carrying an RC: line untouched by the next verify run', async () => {
    const repo = repository();
    const checklistRoot = mkdtempSync(path.join(tmpdir(), 'plot-verify-checklist-out-'));
    roots.push(checklistRoot);
    const args = { command: 'record' as const, slug: 'p', at: '', sha: '' };
    const quiet = () => undefined;

    expect(await record(contextOf(repo, checklistRoot, { [PLAN]: ON_MAIN }), args, quiet, quiet)).toBe(0);
    const checklistPath = path.join(checklistRoot, CHECKLIST);
    const withRc = `# Release Checklist — v1.0.0\n\nRC: v1.0.0-rc.1 (2026-10-13)\n\n${readFileSync(checklistPath, 'utf8').replace(/^# Release Checklist\n\n/, '')}`;
    writeFileSync(checklistPath, withRc);

    // A second plan verifies while the RC round is open.
    mkdirSync(path.join(repo, '.plot', 'state', 'verify', 'q'), { recursive: true });
    writeFileSync(
      path.join(repo, '.plot', 'state', 'verify', 'q', 'run.json'),
      JSON.stringify({ slug: 'q', plan: 'docs/plans/q.md', delivery: 'a'.repeat(40), judged: JUDGED, tools: 'c'.repeat(40), deliveredOn: '2026-10-02', files: [] }),
    );
    const juror = path.join(repo, jurorPath('q', 'a', 'verify-'));
    mkdirSync(path.dirname(juror), { recursive: true });
    writeFileSync(juror, 'Claim-1: supported\n');
    const ctx = {
      ...contextOf(repo, checklistRoot, { 'docs/plans/q.md': '# Q\n\n## Status\n\n- **Delivered:** 2026-10-02\n\n## Changelog\n\n- two\n' }),
      refs: refsFixture({ files: { [`${JUDGED}:docs/plans/q.md`]: '# Q\n\n## Status\n\n- **Delivered:** 2026-10-02\n\n## Changelog\n\n- two\n' } }),
    };
    const again = { command: 'record' as const, slug: 'q', at: '', sha: '' };
    expect(await record(ctx, again, quiet, quiet)).toBe(0);

    expect(readFileSync(checklistPath, 'utf8')).toBe(withRc);
  });
});
