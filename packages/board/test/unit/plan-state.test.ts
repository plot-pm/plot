// `plot-plan-state.mjs`: the flags it takes, the plan it reads, and the exit it
// gives a broken call. A run owing no write resolves no tracker, so nothing
// here reaches `plot-host.sh`.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
      skipIssues: [],
    });
    expect(flagsFrom(['--plan-link', 'https://github.com/o/r/pull/9', '--phase', 'draft'])).toEqual({
      phase: 'draft',
      planLink: 'https://github.com/o/r/pull/9',
      skipIssues: [],
    });
  });

  it('reads an optional --slice-progress, omitted where not passed', () => {
    expect(flagsFrom(['--phase', 'approved', '--plan-link', 'docs/plans/x.md', '--slice-progress', '1 of 2 slices merged'])).toEqual({
      phase: 'approved',
      planLink: 'docs/plans/x.md',
      sliceProgress: '1 of 2 slices merged',
      skipIssues: [],
    });
    expect(flagsFrom(['--phase', 'approved', '--plan-link', 'docs/plans/x.md'])).toEqual({
      phase: 'approved',
      planLink: 'docs/plans/x.md',
      skipIssues: [],
    });
  });

  it('refuses a phase outside the four, rather than owing nothing', () => {
    expect(() => flagsFrom(['--phase', 'release', '--plan-link', 'docs/plans/x.md'])).toThrow("unknown --phase 'release'");
  });

  it('reads zero or more --skip-issue, defaulting to none', () => {
    expect(flagsFrom(['--phase', 'released', '--plan-link', 'docs/plans/x.md']).skipIssues).toEqual([]);
    expect(
      flagsFrom(['--phase', 'released', '--plan-link', 'docs/plans/x.md', '--skip-issue', '7', '--skip-issue', '8']).skipIssues,
    ).toEqual(['7', '8']);
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

  it('skips a named issue without asking the tracker, and writes every other one', async () => {
    const planStates: PlanStateWrite[] = [];
    const { lines, outcomes } = await writePlanStates(
      { phase: 'released', issues: ['7', '8'], planLink: 'docs/plans/x.md', version: 'v1.0.0' },
      trackerFixture({ planStates }),
      new Set(['7']),
    );
    expect(planStates).toEqual([{ issue: '8', phase: 'released', planLink: 'docs/plans/x.md', version: 'v1.0.0' }]);
    expect(lines).toEqual(['7\tskipped\tanother plan unfinished\n', '8\twritten\treleased\n']);
    expect(outcomes).toEqual(['skipped', 'written']);
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

  it('reports none where every owed issue was skipped — skipped never reaches the summary vocabulary', async () => {
    const { root, file } = planIn('# P\n\n## Status\n\n- **Phase:** Approved\n- **Issue:** #7\n');
    const out: string[] = [];
    const code = await run(
      [file, '--phase', 'approved', '--plan-link', 'docs/plans/p.md', '--skip-issue', '7'],
      { repoRoot: root, scriptDir: SCRIPT_DIR },
      (s) => out.push(s),
      () => {},
    );
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual(['7\tskipped\tanother plan unfinished\n', 'summary: tracker=none\n']);
  });
});

describe('the connector a run resolves', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * Runs the entry over a real repository whose config declares `tracker` (or
   * nothing), through a COPIED script set whose `plot-host.sh` answers
   * `backend` with `github` and records every call. The connector is resolved
   * for real; only the host script is a stub.
   */
  const runWith = async (tracker: string | null): Promise<{ code: number; out: string; hostCalls: string[] }> => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-plan-state-resolve-')));
    roots.push(root);
    const scripts = path.join(root, 'scripts');
    const marker = path.join(root, 'host.calls');
    cpSync(SCRIPT_DIR, scripts, { recursive: true, dereference: true });
    const host = path.join(scripts, 'plot-host.sh');
    writeFileSync(
      host,
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$*" >> '${marker}'`,
        'case "$1" in',
        '  backend) echo github ;;',
        '  issue-label|issue-comment|issue-comment-read) exit 0 ;;',
        '  *) exit 4 ;;',
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(host, 0o755);
    const repo = path.join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      ['## Plot Config', '', '- **Plan directory:** docs/plans/', ...(tracker === null ? [] : [`- **Tracker:** ${tracker}`]), ''].join('\n'),
    );
    const file = path.join(repo, '2026-10-17-p.md');
    writeFileSync(file, '# P\n\n## Status\n\n- **Phase:** Approved\n- **Issue:** #7\n');
    const out: string[] = [];
    const code = await run([file, '--phase', 'approved', '--plan-link', 'docs/plans/2026-10-17-p.md'], { repoRoot: repo, scriptDir: scripts }, (s) => out.push(s), () => {});
    const hostCalls = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n') : [];
    return { code, out: out.join(''), hostCalls };
  };

  it('writes through the git host’s issues where no Tracker is declared', async () => {
    const r = await runWith(null);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toBe('7\twritten\tapproved\nsummary: tracker=written\n');
    expect(r.hostCalls).toContain('backend');
    expect(r.hostCalls).toContain('issue-label 7 plan:approved plan:draft,plan:delivered,plan:released');
    expect(r.hostCalls.some((call) => call.startsWith('issue-comment 7 <!-- plot:plan-link --> '))).toBe(true);
  });

  it('answers no-target, and touches no issue, where the declared Tracker is Jira', async () => {
    const r = await runWith('jira https://tracker.invalid');
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toMatch(/^7\tno-target\t.*\nsummary: tracker=no-target\n$/);
    expect(r.hostCalls.filter((call) => call.startsWith('issue-'))).toEqual([]);
  });
});
