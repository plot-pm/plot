import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boardRunsSettled } from '../../src/shared/board-run.js';
import {
  IMPLEMENT_COMMAND_KEY,
  implementLogPath,
  implementRunning,
  implementStatePath,
  startImplement,
} from '../../src/shared/implement-run.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The implement lock is a file: `running <pid>` in the plan-keyed state file,
// read through pid liveness. Every observation is that file or a function of it.

const SLUG = 'a-plan-with-a-lock';

let tmp: string;
let repo: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implement-lock-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
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

describe('implementRunning', () => {
  it('reads a state file naming a dead pid as not running', () => {
    fs.writeFileSync(implementStatePath(repo, SLUG), 'running 999999');
    expect(implementRunning(repo, SLUG)).toBe(false);
  });

  it('reads a state file naming a live pid as running', () => {
    fs.writeFileSync(implementStatePath(repo, SLUG), `running ${process.pid}`);
    expect(implementRunning(repo, SLUG)).toBe(true);
  });

  it('reads a recorded exit code and a missing file as not running', () => {
    expect(implementRunning(repo, SLUG)).toBe(false);
    fs.writeFileSync(implementStatePath(repo, SLUG), '0');
    expect(implementRunning(repo, SLUG)).toBe(false);
  });

  it('reads a lock a separately imported module instance took, and reads it free once the run ends', async () => {
    const first = startImplement(opts(), SLUG, 'sleep 1', undefined, configured('sleep 1'));
    expect(first).toHaveProperty('log');
    vi.resetModules();
    const other = await import('../../src/shared/implement-run.js');
    expect(other.implementRunning).not.toBe(implementRunning);
    expect(other.implementRunning(repo, SLUG)).toBe(true);
    await boardRunsSettled();
    expect(other.implementRunning(repo, SLUG)).toBe(false);
  });
});

describe('startImplement', () => {
  it('refuses the second start of a slug without truncating the first run\'s log', async () => {
    const first = startImplement(opts(), SLUG, 'echo first', undefined, configured('echo first'));
    expect(first).toHaveProperty('log');
    const log = implementLogPath(repo, SLUG);
    fs.writeFileSync(log, 'the first run wrote this\n');
    const second = startImplement(opts(), SLUG, 'echo second', undefined, configured('echo second'));
    expect(second).toMatchObject({ failure: { running: true } });
    expect(fs.readFileSync(log, 'utf8')).toContain('the first run wrote this');
    await boardRunsSettled();
  });

  it('takes the lock over a state file whose pid is dead', async () => {
    fs.writeFileSync(implementStatePath(repo, SLUG), 'running 999999');
    const started = startImplement(opts(), SLUG, 'true', undefined, configured('true'));
    expect(started).toHaveProperty('log');
    await boardRunsSettled();
  });
});
