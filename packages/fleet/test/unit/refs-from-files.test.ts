import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { refsGit, shellContext, treesGit } from '@plot-pm/domain/adapters';
import { readRefSnapshot } from '@plot-pm/domain/workflows/plan-walk-cache';

import { run } from '../../src/server/entry/registryd-main.js';
import { gitWorktrees } from '../../src/shared/registry.js';
import { createSnapshotHolder } from '../../src/shared/snapshot-fill.js';
import { buildSandbox, type Sandbox } from '../census/sandbox.js';

// The census fixture for GitHub with three desks. A `git` shim first on PATH
// records every git process with its parent pid, so a call this process starts
// is told apart from one a helper script starts.

/** The argv prefixes of the ref and worktree reads the files now answer. */
const REF_READS = [
  'symbolic-ref --quiet --short refs/remotes/origin/HEAD',
  'for-each-ref --format=%(refname) %(objectname) %(HEAD)',
  'for-each-ref --format=%(refname:short)\t%(objectname)',
  'for-each-ref --format=%(refname:strip=',
  'worktree list --porcelain',
  'rev-parse --abbrev-ref HEAD',
  'rev-parse --verify --quiet refs/remotes/origin/',
];

describe('fleetd reads refs and worktrees from files', () => {
  let box: Sandbox;
  let log = '';
  const savedEnv = { ...process.env };

  /** The pipeline `refsGit.defaultBranch` started through `bash -c` before it read the files. */
  const DEFAULT_BRANCH_PIPELINE = 'bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed';

  /** The git argv lines this process started, directly or through the default-branch pipeline. */
  const ownCalls = (): string[] =>
    readFileSync(log, 'utf8')
      .split('\n')
      .map((line) => line.split('\x1f'))
      .filter(([parent, command]) => parent === String(process.pid) || (command ?? '').startsWith(DEFAULT_BRANCH_PIPELINE))
      .map(([, , argv]) => argv ?? '');

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 3, openPrs: 5 });
    const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8', env: box.env }).trim();
    const bin = box.env['PATH']!.split(':')[0]!;
    log = join(box.root, 'git-calls.log');
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\037%s\\037%s\\n' "$PPID" "$(ps -o command= -p "$PPID")" "$*" >> '${log}'\nexec '${real}' "$@"\n`);
    chmodSync(join(bin, 'git'), 0o755);
    Object.assign(process.env, box.env);
  }, 120_000);

  afterAll(async () => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await box.remove();
  }, 60_000);

  beforeEach(() => {
    writeFileSync(log, '');
  });

  it('readRefSnapshot and Trees.list start no process', async () => {
    const context = shellContext(box.repo);
    const snapshot = await readRefSnapshot(refsGit(context));
    const trees = await treesGit(context).list();
    const desks = await gitWorktrees(box.repo);

    expect(snapshot.ok).toBe(true);
    expect(trees.ok && trees.value.filter((tree) => !tree.isMain)).toHaveLength(3);
    expect(desks.filter((desk) => !desk.isMain)).toHaveLength(3);
    expect(readFileSync(log, 'utf8')).toBe('');
  });

  it('a --once pass starts none of the ref and worktree reads itself', async () => {
    const code = await run(
      ['--once'],
      join(box.scriptsDir, 'board'),
      () => undefined,
      undefined,
      () => false,
      () => undefined,
      box.repo,
      { snapshot: createSnapshotHolder(), probeAppKeys: () => undefined },
    );
    expect(code).toBe(0);
    const own = ownCalls();
    // Vacuity guard: the shim saw this process start git at all.
    expect(readFileSync(log, 'utf8')).not.toBe('');
    expect(own.filter((argv) => REF_READS.some((read) => argv.startsWith(read)))).toEqual([]);
  }, 120_000);
});
