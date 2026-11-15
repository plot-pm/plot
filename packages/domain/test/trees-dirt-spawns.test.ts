import * as childProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { treesGit } from '../src/adapters/trees/trees-git.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
    spawnSync: vi.fn(actual.spawnSync),
    execFile: vi.fn(actual.execFile),
    execFileSync: vi.fn(actual.execFileSync),
  };
});

/**
 * What `dirtyPaths`, `quietSeconds` and `markers` start, counted by command,
 * against a real repository: one `git` for the dirt, two for the quiet reading,
 * none for the markers, and never a `bash`.
 */
const scriptDir = path.join(fileURLToPath(new URL('../../..', import.meta.url)), 'skills', 'plot', 'scripts');
const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

let root = '';
let desk = '';

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-dirt-')));
  desk = path.join(root, 'desk');
  fs.mkdirSync(desk);
  git(desk, ['init', '--quiet', '--initial-branch=main']);
  git(desk, ['config', 'user.email', 'test@example.com']);
  git(desk, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(desk, 'packages', 'board'), { recursive: true });
  fs.writeFileSync(
    path.join(desk, 'packages', 'board', 'build.mjs'),
    "const shippedOwn = path.join(here, '../../out/own-bundle.mjs');\n",
  );
  fs.mkdirSync(path.join(desk, 'out'));
  fs.writeFileSync(path.join(desk, 'out', 'own-bundle.mjs'), 'one\n');
  fs.writeFileSync(path.join(desk, 'a.ts'), 'one\n');
  git(desk, ['add', '-A']);
  git(desk, ['commit', '--quiet', '-m', 'first']);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** The commands started through every `child_process` entry since the last clear. */
const started = (): string[] =>
  [childProcess.spawn, childProcess.spawnSync, childProcess.execFile, childProcess.execFileSync].flatMap((fn) =>
    vi.mocked(fn).mock.calls.map((call) => String(call[0])),
  );

const trees = () => treesGit({ repoRoot: desk, scriptDir });

describe('the desk dirt reads start no bash', () => {
  it('dirtyPaths starts one git and excuses the bundle the desk own build.mjs names', async () => {
    fs.writeFileSync(path.join(desk, 'out', 'own-bundle.mjs'), 'two\n');
    fs.writeFileSync(path.join(desk, 'a.ts'), 'two\n');
    fs.writeFileSync(path.join(desk, '.plot-worker.log'), 'log\n');
    vi.clearAllMocks();
    const answer = await trees().dirtyPaths(desk);
    expect(answer).toEqual({ ok: true, value: ['a.ts'] });
    expect(started()).toEqual(['git']);
    git(desk, ['checkout', '--', '.']);
    fs.rmSync(path.join(desk, '.plot-worker.log'));
  });

  it('dirtyPaths answers nothing and starts nothing for a path that is not a directory', async () => {
    expect(await trees().dirtyPaths(path.join(root, 'nothing-here'))).toEqual({ ok: true, value: [] });
    expect(started()).toEqual([]);
  });

  it('quietSeconds starts two git', async () => {
    fs.writeFileSync(path.join(desk, 'a.ts'), 'three\n');
    vi.clearAllMocks();
    const answer = await trees().quietSeconds(desk);
    expect(answer.ok && answer.value !== null && answer.value <= 5).toBe(true);
    expect(started()).toEqual(['git', 'git']);
    git(desk, ['checkout', '--', '.']);
  });

  it('quietSeconds applies no bundle exclusion', async () => {
    const old = new Date(Date.now() - 3_600_000);
    git(desk, ['commit', '--quiet', '--allow-empty', '-m', 'old', `--date=${old.toISOString()}`]);
    execFileSync('git', ['commit', '--quiet', '--amend', '--no-edit', '--allow-empty'], {
      cwd: desk,
      env: { ...process.env, GIT_COMMITTER_DATE: old.toISOString() },
    });
    fs.writeFileSync(path.join(desk, 'out', 'own-bundle.mjs'), 'fresh\n');
    const answer = await trees().quietSeconds(desk);
    expect(answer.ok && answer.value !== null && answer.value <= 5).toBe(true);
    git(desk, ['checkout', '--', '.']);
  });

  it('markers starts nothing and lists root entries by prefix, as ls -1 does', async () => {
    fs.writeFileSync(path.join(desk, 'PLOT-BLOCKED-b.md'), 'q\n');
    fs.writeFileSync(path.join(desk, 'PLOT-BLOCKED-a.md'), 'q\n');
    fs.writeFileSync(path.join(desk, '.PLOT-BLOCKED-hidden'), 'q\n');
    vi.clearAllMocks();
    expect(await trees().markers(desk, 'PLOT-BLOCKED')).toEqual({
      ok: true,
      value: ['PLOT-BLOCKED-a.md', 'PLOT-BLOCKED-b.md'],
    });
    expect(await trees().markers(path.join(root, 'nothing-here'), 'PLOT-BLOCKED')).toEqual({ ok: true, value: [] });
    expect(started()).toEqual([]);
    for (const name of ['PLOT-BLOCKED-a.md', 'PLOT-BLOCKED-b.md', '.PLOT-BLOCKED-hidden']) fs.rmSync(path.join(desk, name));
  });
});
