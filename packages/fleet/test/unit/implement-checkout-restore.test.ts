import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeImplementHolder } from '@plot-pm/domain';
import { boardRunsSettled } from '../../src/shared/board-run.js';
import { IMPLEMENT_COMMAND_KEY, implementLockPath, startImplement } from '../../src/shared/implement-run.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// Reproduction + regression test for the 2026-10-20 incident
// (docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md): an
// `/api/implement` run's agent process is spawned `cwd`'d directly into the
// main checkout with no branch isolation, so an agent that checks out a
// slice branch (whether or not `--brief-only` tells it to) leaves the
// checkout there once it ends — on EVERY exit path, not only success.
//
// Each fragment below runs a REAL `git checkout` to a slice branch, so the
// "it moved the checkout" half of this test is a genuine reproduction, not a
// simulation. What's asserted is that `startImplement` restores the tree to
// the branch it found checked out BEFORE the run, regardless of how the run
// ended.

const SLUG = 'a-plan-the-checkout-restores-for';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

let tmp: string;
let repo: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implement-checkout-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'README.md'), 'estate\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
});

afterEach(async () => {
  await boardRunsSettled();
  rmTree(tmp);
});

const configured =
  (command: string) =>
  (_opts: unknown, key: string, fallback: string): string =>
    key === IMPLEMENT_COMMAND_KEY ? command : fallback;

const opts = () => ({ repoRoot: repo, scriptsDir: path.resolve(__dirname, '../../../../skills/plot/scripts') });

/** The two-half assertion `main-checkout-writers.test.mjs` uses, plus the branch check this slice adds. */
const assertRestored = (label: string): void => {
  const porcelain = git(repo, 'status', '--porcelain');
  expect(porcelain, `${label}: checkout is not clean:\n${porcelain}`).toBe('');
  expect(() => git(repo, 'diff', 'HEAD', '--quiet'), `${label}: HEAD's tree does not match the working tree`).not.toThrow();
  const branch = git(repo, 'branch', '--show-current').trim();
  expect(branch, `${label}: checkout was left on the wrong branch`).toBe('main');
};

describe('startImplement restores the checkout', () => {
  it('restores main after a run that checks out a slice branch and succeeds', async () => {
    // The trailing `; :` consumes the prompt `agentRunCommand` appends as a
    // positional argument, the same way `claude -p` consumes its own prompt
    // without passing it through to a git command it runs internally.
    const fragment = 'git checkout -qb bug/some-slice ; :';
    const exitCodes: number[] = [];
    const started = startImplement(opts(), SLUG, fragment, (code) => exitCodes.push(code), configured(fragment));
    expect(started).toHaveProperty('log');

    await vi.waitFor(() => expect(exitCodes).toHaveLength(1), { timeout: 10_000 });
    expect(exitCodes[0]).toBe(0);
    await boardRunsSettled();

    assertRestored('success path');
  });

  it('restores main after a run that checks out a slice branch and then fails', async () => {
    const fragment = 'git checkout -qb bug/some-other-slice ; false';
    const exitCodes: number[] = [];
    const started = startImplement(opts(), SLUG, fragment, (code) => exitCodes.push(code), configured(fragment));
    expect(started).toHaveProperty('log');

    await vi.waitFor(() => expect(exitCodes).toHaveLength(1), { timeout: 10_000 });
    expect(exitCodes[0]).not.toBe(0);
    await boardRunsSettled();

    assertRestored('failure path');
  });

  it('restores main after a run that checks out a slice branch and is killed mid-flight, as a bound timeout kills it', async () => {
    // `IMPLEMENT_TIMEOUT_MS` is five real minutes and is not an injectable
    // parameter of `startImplement` — waiting it out is not a reasonable
    // unit test. The timeout bound ends a run the SAME way this test does:
    // `boundedRunProcess` kills the child's process tree on its timer
    // (bounded-run-process.ts), landing in the identical `onEnd` callback as
    // every other ending (board-run.ts's `finish`). Killing the agent here
    // mid-checkout exercises that exact callback with a run that never
    // reached its own `git checkout`'s matching completion — an authentic
    // "ended uncleanly while on a slice branch" case, which is what a bound
    // kill produces in production.
    const fragment = 'git checkout -qb bug/killed-slice; sleep 30 ; :';
    const exitCodes: number[] = [];
    const started = startImplement(opts(), SLUG, fragment, (code) => exitCodes.push(code), configured(fragment));
    expect(started).toHaveProperty('log');

    const lockPath = implementLockPath(repo, SLUG);
    await vi.waitFor(
      () => {
        const holder = decodeImplementHolder(fs.readFileSync(lockPath, 'utf8'));
        expect(holder?.agent?.pid).toBeTruthy();
      },
      { timeout: 10_000 },
    );
    const holder = decodeImplementHolder(fs.readFileSync(lockPath, 'utf8'));
    const agentPid = holder?.agent?.pid;
    expect(agentPid).toBeTruthy();

    // Give the agent's shell time to run its checkout before it is killed.
    await vi.waitFor(
      () => {
        const branch = git(repo, 'branch', '--show-current').trim();
        expect(branch).toBe('bug/killed-slice');
      },
      { timeout: 10_000 },
    );

    if (agentPid !== undefined) process.kill(agentPid, 'SIGKILL');

    await vi.waitFor(() => expect(exitCodes).toHaveLength(1), { timeout: 10_000 });
    await boardRunsSettled();

    assertRestored('killed mid-flight (bound-equivalent) path');
  });
});
