import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../../src/server/entry/sprint-member.js';

/**
 * The `plot-sprint-member` entry against a real temporary git repository, so
 * the staging, the commit scope and the no-partial-write order are observed
 * in git rather than asserted on stubs.
 */

const SCRIPT_DIR = path.resolve(__dirname, '../../../../skills/plot/scripts');

const SPRINT_ACTIVE = `# Sprint: Delivery Loop

## Status

- **State:** Active
- **Start:** 2026-10-29
- **End:** 2026-11-05

## Sprint Goal

A goal.

### Must Have

<!-- add items here -->

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- moved here -->

## Notes

### Scope Changes

<!-- nothing yet -->
`;

const SPRINT_OTHER = SPRINT_ACTIVE.replace('Delivery Loop', 'Other').replace('<!-- add items here -->', '- [ ] [a-plan] A plan');

const PLAN = `# A plan

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** <!-- optional -->

## Changelog

- Did something.
`;

let root = '';
let savedUnattended: string | undefined;
let savedRoot: string | undefined;

const git = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

const PLAN_REL = 'docs/plans/2026-11-01-a-plan.md';
const SPRINT_REL = 'docs/sprints/2026-W44-delivery-loop.md';
const OTHER_REL = 'docs/sprints/2026-W45-other.md';

const invoke = async (...argv: string[]): Promise<{ code: number; out: string; err: string }> => {
  let out = '';
  let err = '';
  const code = await run(argv, root, SCRIPT_DIR, (s) => { out += s; }, (s) => { err += s; });
  return { code, out, err };
};

beforeEach(() => {
  savedUnattended = process.env.PLOT_UNATTENDED;
  savedRoot = process.env.PLOT_REPO_ROOT;
  delete process.env.PLOT_UNATTENDED;
  delete process.env.PLOT_REPO_ROOT;
  root = mkdtempSync(path.join(tmpdir(), 'plot-sprint-member-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(path.join(root, 'docs/plans/active'), { recursive: true });
  mkdirSync(path.join(root, 'docs/sprints'), { recursive: true });
  writeFileSync(path.join(root, PLAN_REL), PLAN);
  writeFileSync(path.join(root, SPRINT_REL), SPRINT_ACTIVE);
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
});

afterEach(() => {
  if (savedUnattended === undefined) delete process.env.PLOT_UNATTENDED;
  else process.env.PLOT_UNATTENDED = savedUnattended;
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

describe('plot-sprint-member entry', () => {
  it('add in an Active sprint writes member, field and log in one commit of exactly two files', async () => {
    const { code, out } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    expect(code).toBe(0);
    expect(out).toContain('commit=done');
    expect(git('show', '--stat', '--format=', 'HEAD').trim().split('\n').filter((l) => l.includes('|'))).toHaveLength(2);
    expect(read(SPRINT_REL)).toContain('[a-plan]');
    expect(read(SPRINT_REL)).toMatch(/Added \[a-plan\] to Must/);
    expect(read(PLAN_REL)).toContain('- **Sprint:** delivery-loop');
  });

  it('a re-run is a no-op: exit 0, no new commit', async () => {
    await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    const head = git('rev-parse', 'HEAD');
    const again = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    expect(again.code).toBe(0);
    expect(again.out).toContain('outcome=noop');
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });

  it('--no-commit stages the two paths and commits nothing', async () => {
    const head = git('rev-parse', 'HEAD');
    const { code, out } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'should', '--no-commit');
    expect(code).toBe(0);
    expect(out).toContain('commit=skipped');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('diff', '--cached', '--name-only').trim().split('\n').sort()).toEqual([PLAN_REL, SPRINT_REL]);
  });

  it('refuses a commit run when other paths are already staged, and writes nothing', async () => {
    writeFileSync(path.join(root, 'other.txt'), 'x');
    git('add', 'other.txt');
    const { code, err } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    expect(code).toBe(1);
    expect(err).toMatch(/^staged-elsewhere\t/);
    expect(read(PLAN_REL)).toBe(PLAN);
    expect(read(SPRINT_REL)).toBe(SPRINT_ACTIVE);
  });

  it('refuses listed-elsewhere naming the other sprint, and writes nothing', async () => {
    writeFileSync(path.join(root, OTHER_REL), SPRINT_OTHER);
    const { code, err } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    expect(code).toBe(1);
    expect(err).toMatch(/^listed-elsewhere\t/);
    expect(err).toContain('other');
    expect(read(PLAN_REL)).toBe(PLAN);
    expect(read(SPRINT_REL)).toBe(SPRINT_ACTIVE);
  });

  it('refuses a plan the checkout does not hold', async () => {
    const { code, err } = await invoke('add', 'delivery-loop', 'no-such-plan', '--tier', 'must');
    expect(code).toBe(1);
    expect(err).toMatch(/^plan-not-found\t/);
  });

  it('refuses a sprint the checkout does not hold', async () => {
    const { code, err } = await invoke('add', 'no-such-sprint', 'a-plan', '--tier', 'must');
    expect(code).toBe(1);
    expect(err).toMatch(/^sprint-not-found\t/);
    expect(read(PLAN_REL)).toBe(PLAN);
  });

  it('refuses remove of a plan the sprint does not list: not-a-member', async () => {
    const { code, err } = await invoke('remove', 'delivery-loop', 'a-plan');
    expect(code).toBe(1);
    expect(err).toMatch(/^not-a-member\t/);
    expect(read(SPRINT_REL)).toBe(SPRINT_ACTIVE);
  });

  it('refuses under PLOT_UNATTENDED=1 and writes nothing', async () => {
    process.env.PLOT_UNATTENDED = '1';
    const { code, err } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    expect(code).toBe(1);
    expect(err).toMatch(/^unattended\t/);
    expect(read(PLAN_REL)).toBe(PLAN);
    expect(read(SPRINT_REL)).toBe(SPRINT_ACTIVE);
  });

  it('restores the plan when the sprint write fails', async () => {
    // Renaming over the sprint file needs write access to its directory.
    chmodSync(path.join(root, 'docs/sprints'), 0o555);
    const { code, err } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must', '--no-commit');
    chmodSync(path.join(root, 'docs/sprints'), 0o755);
    // A root user can write into a 0555 directory; the assertion then has nothing to prove.
    if (code === 0) return;
    expect(err).toMatch(/^write-failed\t/);
    expect(err).toContain('restored');
    expect(read(PLAN_REL)).toBe(PLAN);
    expect(read(SPRINT_REL)).toBe(SPRINT_ACTIVE);
  });

  it('finds a plan by its exact slug, not by a longer slug that ends the same way', async () => {
    writeFileSync(path.join(root, 'docs/plans/2026-11-01-not-a-plan.md'), PLAN.replace('A plan', 'Not'));
    rmSync(path.join(root, PLAN_REL));
    const { code, err } = await invoke('add', 'delivery-loop', 'a-plan', '--tier', 'must');
    expect(code).toBe(1);
    expect(err).toMatch(/^plan-not-found\t/);
  });
});
