import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StateHome } from '@plot-pm/domain';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import { revertWorldOf } from '../../src/shared/revert-start-world.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const scriptsDir = path.resolve(__dirname, '../../../../skills/plot/scripts');
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmTree(dir);
});

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

const commitFiles = (repo: string, files: readonly string[], subject: string): string => {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), `${subject}\n`);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', subject);
  return git(repo, 'rev-parse', 'HEAD');
};

const repoWith = (): string => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-revert-world-'));
  made.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  commitFiles(repo, ['README.md'], 'root');
  return repo;
};

const worldOf = (repo: string, runs: unknown[]) =>
  revertWorldOf({
    repoRoot: repo,
    stateHome: repo as StateHome,
    scriptsDir,
    build: {
      system: () => 'github-actions',
      runsForSha: async () => ({ ok: true, value: runs }),
    } as unknown as BuildPort,
    slot: (call) => call(),
    release: async () => undefined as never,
    notify: async () => undefined,
    worktreeRoot: '',
    checksWaitMs: 3_600_000,
    mainRepairBoundMs: 3_600_000,
    checks: ['CI/validate'],
    jobForm: true,
  });

describe('revertWorldOf candidate', () => {
  it('reads a cancelled CI/validate job entry as a cancelled run', async () => {
    const repo = repoWith();
    const sha = commitFiles(repo, ['src/a.ts'], 'change code');
    const world = worldOf(repo, [{ workflow: 'CI/validate', status: 'completed', conclusion: 'cancelled' }]);
    const candidate = await world.candidate({ sha, subject: 'change code' });
    expect(candidate?.runs).toBe('cancelled');
  });

  it('reads a cancelled CI run with no job entry as a cancelled run', async () => {
    const repo = repoWith();
    const sha = commitFiles(repo, ['src/a.ts'], 'change code');
    const world = worldOf(repo, [{ workflow: 'CI', status: 'completed', conclusion: 'cancelled' }]);
    const candidate = await world.candidate({ sha, subject: 'change code' });
    expect(candidate?.runs).toBe('cancelled');
  });

  it('marks a commit that changes only plan and brief files as plotDataOnly', async () => {
    const repo = repoWith();
    const sha = commitFiles(repo, ['docs/plans/x.md', '.plot/briefs/b.md'], 'book plans');
    const world = worldOf(repo, [{ workflow: 'CI/validate', status: 'completed', conclusion: 'cancelled' }]);
    const candidate = await world.candidate({ sha, subject: 'book plans' });
    expect(candidate?.plotDataOnly).toBe(true);
  });

  it('does not mark a commit that also changes code as plotDataOnly', async () => {
    const repo = repoWith();
    const sha = commitFiles(repo, ['docs/plans/x.md', '.plot/briefs/b.md', 'packages/domain/src/x.ts'], 'mixed');
    const world = worldOf(repo, [{ workflow: 'CI/validate', status: 'completed', conclusion: 'cancelled' }]);
    const candidate = await world.candidate({ sha, subject: 'mixed' });
    expect(candidate?.plotDataOnly).toBe(false);
  });
});
