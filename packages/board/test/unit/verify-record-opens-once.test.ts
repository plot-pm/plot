import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { treesFixture } from '@plot-pm/domain/adapters/trees/trees-fixture';
const answered = <T>(value: T) => ({ ok: true as const, value });
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { jurorPath } from '@plot-pm/domain/rules/panel';
import type { IssueOpen, PlanStore, Scripts } from '@plot-pm/domain';
import { record, type Context } from '../../src/server/entry/verify.js';

const PLAN = 'docs/plans/p.md';
const JUDGED = 'b'.repeat(40);
const ON_MAIN = '# P\n\n## Status\n\n- **Delivered:** 2026-10-01\n\n## Changelog\n\n- one\n';

describe('record opens one issue across a rejected push', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A repository with an `origin` that holds `main`, and a prepared run for `p`. */
  const repository = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'plot-verify-record-'));
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
    writeFileSync(juror, 'Claim-1: refuted\n');
    return repo;
  };

  it('opens on the first run, keeps the id through the rejected push, and pushes the same id on the re-run', async () => {
    const repo = repository();
    const tmpwt = path.join(deskRoot({ configured: '', repoRoot: repo }), `.plot-verify-p.${process.pid}`);
    const opened: IssueOpen[] = [];
    const resolved: [string, string][] = [];
    const written: string[] = [];
    let pushCode = 1;
    const ctx = (): Context => ({
      repoRoot: repo,
      scriptDir: repo,
      scriptsRel: '',
      refs: refsFixture({ files: { [`${JUDGED}:${PLAN}`]: ON_MAIN } }),
      host: hostFixture({ backend: 'github' }),
      planStore: {
        readText: async (file: string) => answered(file.endsWith(PLAN) ? ON_MAIN : null),
        writeText: async (file: string, content: string) => {
          if (file.endsWith(PLAN)) written.push(content);
          return answered(undefined);
        },
      } as unknown as PlanStore,
      scripts: {
        config: async (key: string, fallback: string) => answered(key === 'Tracker' ? 'jira' : fallback),
        host: async () => answered(''),
        awaited: async () => ({ stdout: '', stderr: '', code: pushCode }),
      } as unknown as Scripts,
      trees: treesFixture({ staged: [tmpwt], pushFailsAt: [tmpwt] }),
      issueTracker: (declared, backend) => {
        resolved.push([declared, backend]);
        return trackerFixture({ scheme: 'jira', opened });
      },
    });
    const args = { command: 'record' as const, slug: 'p', at: '', sha: '' };
    const quiet = () => undefined;

    expect(await record(ctx(), args, quiet, quiet)).toBe(1);
    expect(opened).toHaveLength(1);
    expect(written[0]).toContain('- Claim-1 refuted — one — a refuted — #1\n');
    const stateFile = path.join(repo, '.plot', 'state', 'verify', 'p.json');
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).issues).toEqual({ one: { issue: '1' } });

    pushCode = 0;
    expect(await record(ctx(), args, quiet, quiet)).toBe(0);
    expect(opened).toHaveLength(1);
    expect(written[1]).toContain('- Claim-1 refuted — one — a refuted — #1\n');
    expect(resolved).toEqual([
      ['jira', 'github'],
      ['jira', 'github'],
    ]);
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).issues).toEqual({ one: { issue: '1' } });
  });
});
