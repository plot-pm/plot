import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeImplementHolder, encodeImplementHolder, type ProcessProbe } from '@plot-pm/domain';
import { boardRunsSettled } from '../../src/shared/board-run.js';
import {
  IMPLEMENT_COMMAND_KEY,
  IMPLEMENT_LOCK_BOUND_MS,
  implementLockPath,
  implementLogPath,
  implementRunning,
  recordImplementAgent,
  releaseImplementLock,
  startImplement,
  takeImplementLock,
} from '../../src/shared/implement-run.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The implement lock is a file beside the plan's state file, holding one record:
// the holder's pid, start time and group, when it was taken, and the agent the
// run started. Every observation is that file or a function of it.

const SLUG = 'a-plan-with-a-lock';
const NOW = 1_760_000_000_000;

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

/** A process table: each live pid and its start time, and the groups with a member. */
interface Table {
  procs: Map<number, number>;
  groups: Set<number>;
}

/** A probe over `table` that reads itself as `self`, started at `self * 10`. */
const probeOver = (table: Table, self: number, leadsGroup = false): ProcessProbe => ({
  alive: (pid) => table.procs.has(pid),
  groupAlive: (pgid) => table.groups.has(pgid),
  startedAt: (pid) => table.procs.get(pid) ?? null,
  self: () => ({ pid: self, startedAt: self * 10, leadsGroup }),
});

/** A table where pids 1 and 2 are alive, each started at `pid * 10`. */
const twoTakers = (): Table => ({ procs: new Map([[1, 10], [2, 20]]), groups: new Set() });

/** Writes a lock record naming `pid`, started at `startedAt`, taken at `at`. */
const seedLock = (pid: number, startedAt: number, at = NOW, extra: { pgid?: number; agent?: { pid: number; startedAt: number } } = {}): void => {
  fs.writeFileSync(
    implementLockPath(repo, SLUG),
    encodeImplementHolder({ pid, startedAt, pgid: extra.pgid ?? null, at, agent: extra.agent ?? null }),
  );
};

const readLockPid = (): number | null => {
  const holder = decodeImplementHolder(fs.readFileSync(implementLockPath(repo, SLUG), 'utf8'));
  return holder === null ? null : holder.pid;
};

describe('takeImplementLock', () => {
  it('takes a free slug and refuses a second take while the holder lives', () => {
    const table = twoTakers();
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toMatchObject({ pid: 1 });
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 2), now: () => NOW })).toBeNull();
    expect(readLockPid()).toBe(1);
  });

  it('lets exactly one of two takes replace a stale lock when the second runs after the first read it stale', () => {
    const table = twoTakers();
    seedLock(99, 990);
    let second: ReturnType<typeof takeImplementLock> | undefined;
    const first = takeImplementLock(repo, SLUG, {
      probe: probeOver(table, 1),
      now: () => NOW,
      onStep: (step) => {
        if (step === 'stale-read' && second === undefined) {
          second = takeImplementLock(repo, SLUG, { probe: probeOver(table, 2), now: () => NOW });
        }
      },
    });
    expect(second).toMatchObject({ pid: 2 });
    expect(first).toBeNull();
    expect(readLockPid()).toBe(2);
  });

  it('lets exactly one of two takes replace a stale lock when the second runs while the first holds the guard', () => {
    const table = twoTakers();
    seedLock(99, 990);
    let second: ReturnType<typeof takeImplementLock> | undefined;
    const first = takeImplementLock(repo, SLUG, {
      probe: probeOver(table, 1),
      now: () => NOW,
      onStep: (step) => {
        if (step === 'guarded' && second === undefined) {
          second = takeImplementLock(repo, SLUG, { probe: probeOver(table, 2), now: () => NOW });
        }
      },
    });
    expect(second).toBeNull();
    expect(first).toMatchObject({ pid: 1 });
    expect(readLockPid()).toBe(1);
  });

  it('removes a guard a crashed take left behind, and refuses while a fresh one stands', () => {
    const table = twoTakers();
    seedLock(99, 990);
    const guard = `${implementLockPath(repo, SLUG)}.guard`;
    fs.writeFileSync(guard, '');
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toBeNull();
    const old = (Date.now() - 60_000) / 1000;
    fs.utimesSync(guard, old, old);
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toMatchObject({ pid: 1 });
    expect(fs.existsSync(guard)).toBe(false);
  });

  it('replaces a lock whose holder pid now names a process started at another time', () => {
    const table = twoTakers();
    seedLock(2, 20 + 60_000);
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toMatchObject({ pid: 1 });
  });

  it('replaces a lock older than the bound and a file that holds no record', () => {
    const table = twoTakers();
    seedLock(2, 20, NOW - IMPLEMENT_LOCK_BOUND_MS);
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toMatchObject({ pid: 1 });
    fs.writeFileSync(implementLockPath(repo, SLUG), 'running 2');
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toMatchObject({ pid: 1 });
  });

  it('records the group only for a holder that leads one', () => {
    const table = twoTakers();
    expect(takeImplementLock(repo, SLUG, { probe: probeOver(table, 1, true), now: () => NOW })).toMatchObject({ pgid: 1 });
  });
});

describe('implementRunning', () => {
  it('reads a missing lock and a lock whose holder and agent are gone as not running', () => {
    const table = twoTakers();
    expect(implementRunning(repo, SLUG, { probe: probeOver(table, 1) })).toBe(false);
    seedLock(99, 990, NOW, { agent: { pid: 98, startedAt: 980 } });
    expect(implementRunning(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toBe(false);
  });

  it('reads a lock whose holder died while its agent lives as running', () => {
    const table = twoTakers();
    seedLock(99, 990, NOW, { agent: { pid: 2, startedAt: 20 } });
    expect(implementRunning(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toBe(true);
  });

  it('reads a lock whose group-leading holder was killed alone as running while its group has a member', () => {
    const table = twoTakers();
    seedLock(99, 990, NOW, { pgid: 99 });
    expect(implementRunning(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toBe(false);
    table.groups.add(99);
    expect(implementRunning(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW })).toBe(true);
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
    expect(fs.existsSync(implementLockPath(repo, SLUG))).toBe(false);
  });
});

describe('recordImplementAgent and releaseImplementLock', () => {
  it('change only the lock they took', () => {
    const table = twoTakers();
    const mine = takeImplementLock(repo, SLUG, { probe: probeOver(table, 1), now: () => NOW });
    expect(mine).not.toBeNull();
    if (mine === null) return;
    recordImplementAgent(repo, SLUG, mine, { pid: 2, startedAt: 20 });
    expect(decodeImplementHolder(fs.readFileSync(implementLockPath(repo, SLUG), 'utf8'))).toMatchObject({
      pid: 1,
      agent: { pid: 2, startedAt: 20 },
    });
    const other = { ...mine, pid: 2 };
    recordImplementAgent(repo, SLUG, other, { pid: 3, startedAt: 30 });
    releaseImplementLock(repo, SLUG, other);
    expect(readLockPid()).toBe(1);
    releaseImplementLock(repo, SLUG, mine);
    expect(fs.existsSync(implementLockPath(repo, SLUG))).toBe(false);
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

  it('names the started agent in the lock while the run lives', async () => {
    // The fragment is followed by the prompt, which `true` takes and `sleep` would refuse.
    const started = startImplement(opts(), SLUG, 'sleep 1; true', undefined, configured('sleep 1; true'));
    expect(started).toHaveProperty('log');
    const read = () => decodeImplementHolder(fs.readFileSync(implementLockPath(repo, SLUG), 'utf8'));
    await vi.waitFor(() => expect(read()?.agent).not.toBeNull(), { timeout: 5_000 });
    const holder = read();
    expect(holder).toMatchObject({ pid: process.pid });
    expect(holder?.agent?.pid).toBeGreaterThan(0);
    expect(holder?.agent?.pid).not.toBe(process.pid);
    await boardRunsSettled();
  });

  it('takes the lock over one whose holder is dead', async () => {
    seedLock(999999, 1, Date.now());
    const started = startImplement(opts(), SLUG, 'true', undefined, configured('true'));
    expect(started).toHaveProperty('log');
    await boardRunsSettled();
  });
});
