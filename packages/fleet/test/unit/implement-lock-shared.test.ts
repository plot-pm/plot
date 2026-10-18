import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeImplementHolder } from '@plot-pm/domain';
import { askForBrief, askForBriefLogPath } from '../../src/shared/brief-ask.js';
import { boardRunsSettled } from '../../src/shared/board-run.js';
import { implementLockPath, implementLogPath, startImplement, takeImplementLock } from '../../src/shared/implement-run.js';
import { mainCheckout } from '../../src/shared/main-checkout.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// One lock per plan, shared by the implement start, the brief run and every
// checkout of the repository. The desk is made with a real `git worktree add`.

const SLUG = 'a-plan-with-one-lock';

let tmp: string;
let repo: string;
let desk: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implement-lock-shared-')));
  repo = path.join(tmp, 'repo');
  desk = path.join(tmp, 'desk');
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('worktree', 'add', '-q', '-b', 'desk-branch', desk);
});

afterEach(async () => {
  await boardRunsSettled();
  rmTree(tmp);
});

const scriptsDir = path.resolve(__dirname, '../../../../skills/plot/scripts');
const opts = () => ({ repoRoot: repo, scriptsDir });
const configured =
  (key: string, command: string) =>
  (_opts: unknown, asked: string, fallback: string): string =>
    asked === key ? command : fallback;

describe('the lock of a checkout and of its desk', () => {
  it('resolves a desk worktree to the main checkout and leaves the main checkout alone', () => {
    expect(mainCheckout(desk)).toBe(repo);
    expect(mainCheckout(repo)).toBe(repo);
    expect(mainCheckout(path.join(tmp, 'not-a-checkout'))).toBe(path.join(tmp, 'not-a-checkout'));
  });

  it('names one lock file from the desk and from the main checkout', () => {
    expect(implementLockPath(desk, SLUG)).toBe(implementLockPath(repo, SLUG));
  });

  it('refuses a take from the main checkout while a take from the desk holds the slug', () => {
    expect(takeImplementLock(desk, SLUG)).not.toBeNull();
    expect(fs.existsSync(implementLockPath(repo, SLUG))).toBe(true);
    expect(takeImplementLock(repo, SLUG)).toBeNull();
  });
});

describe('a brief run and an implement for one slug', () => {
  it('refuse a brief while an implement holds the lock, and leave the implement log whole', async () => {
    const first = startImplement(opts(), SLUG, 'sleep 1; true', undefined, configured('Implement command', 'sleep 1; true'));
    expect(first).toHaveProperty('log');
    const log = implementLogPath(repo, SLUG);
    fs.writeFileSync(log, 'the implement wrote this\n');
    const asked = askForBrief(opts(), 'true', SLUG, 'write the brief');
    expect(asked).toBeNull();
    expect(fs.existsSync(askForBriefLogPath(repo, SLUG))).toBe(false);
    expect(fs.readFileSync(log, 'utf8')).toBe('the implement wrote this\n');
    await boardRunsSettled();
  });

  it('refuse an implement while a brief holds the lock, and leave the brief log whole', async () => {
    const briefLog = askForBriefLogPath(repo, SLUG);
    const asked = askForBrief(opts(), 'sleep 1; true', SLUG, 'write the brief');
    expect(asked).toBe(briefLog);
    fs.writeFileSync(briefLog, 'the brief wrote this\n');
    const second = startImplement(opts(), SLUG, 'true', undefined, configured('Implement command', 'true'));
    expect(second).toMatchObject({ failure: { running: true, holder: 'brief' } });
    expect('failure' in second && second.failure.detail).toContain(briefLog);
    expect(fs.readFileSync(briefLog, 'utf8')).toBe('the brief wrote this\n');
    await boardRunsSettled();
  });

  it('releases the lock when the brief run ends', async () => {
    expect(askForBrief(opts(), 'true', SLUG, 'write the brief')).not.toBe('');
    // The run's end handler releases the lock; the wait polls for the release.
    await vi.waitFor(() => expect(fs.existsSync(implementLockPath(repo, SLUG))).toBe(false), { timeout: 5_000 });
  });

  it('start a brief over a lock whose holder is dead', async () => {
    fs.mkdirSync(path.dirname(implementLockPath(repo, SLUG)), { recursive: true });
    fs.writeFileSync(
      implementLockPath(repo, SLUG),
      encodeImplementHolder({ pid: 999999, startedAt: 1, pgid: null, at: Date.now(), agent: null, run: 'implement', tree: repo }),
    );
    expect(askForBrief(opts(), 'true', SLUG, 'write the brief')).toBe(askForBriefLogPath(repo, SLUG));
    await boardRunsSettled();
  });
});

describe('the refusal names the run that holds the lock', () => {
  it('names this checkout\'s implement run and its log', async () => {
    expect(startImplement(opts(), SLUG, 'sleep 1; true', undefined, configured('Implement command', 'sleep 1; true'))).toHaveProperty('log');
    const second = startImplement(opts(), SLUG, 'true', undefined, configured('Implement command', 'true'));
    expect(second).toMatchObject({ failure: { running: true, holder: 'implement' } });
    expect('failure' in second && second.failure.detail).toContain(implementLogPath(repo, SLUG));
    await boardRunsSettled();
  });

  it('names an implement run in a desk, and the desk\'s log', async () => {
    const deskOpts = { repoRoot: desk, scriptsDir };
    expect(startImplement(deskOpts, SLUG, 'sleep 1; true', undefined, configured('Implement command', 'sleep 1; true'))).toHaveProperty('log');
    const second = startImplement(opts(), SLUG, 'true', undefined, configured('Implement command', 'true'));
    expect(second).toMatchObject({ failure: { running: true, holder: 'desk' } });
    expect('failure' in second && second.failure.detail).toContain(implementLogPath(desk, SLUG));
    await boardRunsSettled();
  });
});
