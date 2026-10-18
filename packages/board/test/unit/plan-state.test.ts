// `plot-plan-state.mjs`: the flags it takes, the plan it reads, and the exit it
// gives a broken call. A run owing no write resolves no tracker, so nothing
// here reaches `plot-host.sh`.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import type { PlanStateWrite } from '@plot-pm/domain/ports/tracker';
import { EXIT, flagsFrom, issuesFrom, run, writePlanStates } from '../../src/server/entry/plan-state.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

describe('the flags a plan-state write takes', () => {
  it('reads the phase, the link and the version', () => {
    expect(flagsFrom(['--phase', 'released', '--plan-link', 'docs/plans/x.md', '--version', 'v1.2.3'])).toEqual({
      phase: 'released',
      planLink: 'docs/plans/x.md',
      version: 'v1.2.3',
    });
    expect(flagsFrom(['--plan-link', 'https://github.com/o/r/pull/9', '--phase', 'draft'])).toEqual({
      phase: 'draft',
      planLink: 'https://github.com/o/r/pull/9',
    });
  });

  it('refuses a phase outside the four, rather than owing nothing', () => {
    expect(() => flagsFrom(['--phase', 'release', '--plan-link', 'docs/plans/x.md'])).toThrow("unknown --phase 'release'");
  });

  it('refuses a missing phase or link, a flag with no value, and an unknown flag', () => {
    expect(() => flagsFrom(['--plan-link', 'x'])).toThrow('--phase is required');
    expect(() => flagsFrom(['--phase', 'approved'])).toThrow('--plan-link is required');
    expect(() => flagsFrom(['--phase'])).toThrow('--phase needs a value');
    expect(() => flagsFrom(['--link', 'x'])).toThrow("unknown argument '--link'");
  });
});

describe('the issues a plan names', () => {
  it('reads them out of the parser’s JSON as strings', () => {
    expect(issuesFrom('{"phase":"approved","issues":["#7",8]}')).toEqual(['#7', '8']);
  });

  it('refuses JSON with no issues list', () => {
    expect(() => issuesFrom('{"phase":"approved"}')).toThrow('no issues[]');
  });
});

describe('each owed write goes through the tracker port', () => {
  it('prints one line per issue and hands the port the phase and link', async () => {
    const planStates: PlanStateWrite[] = [];
    const { lines, outcomes } = await writePlanStates(
      { phase: 'approved', issues: ['#7'], planLink: 'docs/plans/x.md' },
      trackerFixture({ planStates }),
    );
    expect(planStates).toEqual([{ issue: '#7', phase: 'approved', planLink: 'docs/plans/x.md' }]);
    expect(lines).toEqual(['#7\twritten\tapproved\n']);
    expect(outcomes).toEqual(['written']);
  });

  it('reports a failed write by its fallback reason', async () => {
    const { lines, outcomes } = await writePlanStates(
      { phase: 'approved', issues: ['#7'], planLink: 'docs/plans/x.md' },
      trackerFixture({ planStateWriteFails: true }),
    );
    expect(outcomes).toEqual(['failed']);
    expect(lines[0]).toMatch(/^#7\tfailed\t/);
  });
});

describe('a run of the entry', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const planIn = (body: string): { root: string; file: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-plan-state-')));
    roots.push(root);
    const file = path.join(root, '2026-10-17-p.md');
    writeFileSync(file, body);
    return { root, file };
  };

  it('exits 2 with tracker=failed and the reason on stderr where the plan file is missing', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['/nowhere/p.md', '--phase', 'approved', '--plan-link', 'x'], { repoRoot: '/nowhere', scriptDir: SCRIPT_DIR }, (s) => out.push(s), (s) => err.push(s));
    expect(code).toBe(EXIT.usage);
    expect(out).toEqual(['summary: tracker=failed\n']);
    expect(err[0]).toBe("plot-plan-state: '/nowhere/p.md' is not a plan file\n");
  });

  it('exits 2 on an unknown phase, with the plan readable', async () => {
    const { root, file } = planIn('# P\n\n## Status\n\n- **Phase:** Approved\n- **Issue:** #7\n');
    const out: string[] = [];
    const err: string[] = [];
    const code = await run([file, '--phase', 'release', '--plan-link', 'x'], { repoRoot: root, scriptDir: SCRIPT_DIR }, (s) => out.push(s), (s) => err.push(s));
    expect(code).toBe(EXIT.usage);
    expect(out).toEqual(['summary: tracker=failed\n']);
    expect(err[0]).toBe("plot-plan-state: unknown --phase 'release'\n");
  });

  it('reports none, and asks no tracker, for a plan naming no issue', async () => {
    const { root, file } = planIn('# P\n\n## Status\n\n- **Phase:** Approved\n');
    const out: string[] = [];
    const code = await run([file, '--phase', 'approved', '--plan-link', 'docs/plans/p.md'], { repoRoot: root, scriptDir: SCRIPT_DIR }, (s) => out.push(s), () => {});
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual(['summary: tracker=none\n']);
  });
});
