import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Refs } from '@plot-pm/domain';
import { planEstate, planStatusBySlug, refsFor, type BuildBoardOptions } from '../../src/server/board.js';
import { rmTree } from '../helpers.mjs';

// `planEstate` walks `refs.planAuthors` once per parse, so the count of that
// call is the count of parses.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const trackedTempPaths: string[] = [];
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try { rmTree(dir); } catch { /* a sandbox already gone is the wanted state */ }
  }
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const fixture = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-estate-head-'));
  trackedTempPaths.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# Fixture\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Main branch:** main\n',
  );
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '.keep'), '');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
};

const counting = (repoRoot: string): { opts: BuildBoardOptions; parses: () => number } => {
  const real = refsFor({ repoRoot, scriptsDir: SCRIPTS_DIR });
  let parses = 0;
  const refs: Refs = {
    ...real,
    planAuthors: (...args) => {
      parses++;
      return real.planAuthors(...args);
    },
  };
  return { opts: { repoRoot, scriptsDir: SCRIPTS_DIR, refs }, parses: () => parses };
};

describe('planEstate parses once per head', () => {
  it('serves two calls on an unchanged head from one parse', async () => {
    const { opts, parses } = counting(fixture());
    const first = await planEstate(opts, null, true);
    const second = await planEstate(opts, null, true);
    expect(parses()).toBe(1);
    expect(second).toBe(first);
  });

  it('serves planStatusBySlug and planEstate from the same parse', async () => {
    const { opts, parses } = counting(fixture());
    await planStatusBySlug(opts, null, true);
    await planEstate(opts, null, true);
    expect(parses()).toBe(1);
  });

  it('parses again when the default branch moves', async () => {
    const repoRoot = fixture();
    const { opts, parses } = counting(repoRoot);
    await planEstate(opts, null, true);
    git(repoRoot, 'commit', '-q', '--allow-empty', '-m', 'next');
    git(repoRoot, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    await planEstate(opts, null, true);
    expect(parses()).toBe(2);
  });

  it('parses again when a working-tree-only plan changes', async () => {
    const repoRoot = fixture();
    const { opts, parses } = counting(repoRoot);
    const plan = path.join(repoRoot, 'docs', 'plans', '2026-10-24-local.md');
    fs.writeFileSync(plan, '# Local\n\n## Status\n\n- **Phase:** Draft\n');
    await planEstate(opts, null, true);
    fs.writeFileSync(plan, '# Local\n\n## Status\n\n- **Phase:** Draft\n- **Assignee:** Someone\n');
    await planEstate(opts, null, true);
    expect(parses()).toBe(2);
  });

  it('parses again for a different pulse', async () => {
    const { opts, parses } = counting(fixture());
    await planEstate(opts, null, true);
    await planEstate(opts, null, false);
    expect(parses()).toBe(2);
  });
});
