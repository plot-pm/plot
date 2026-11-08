import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { watchFs } from '../src/adapters/watch/watch-fs.js';
import type { WatchEvent } from '../src/ports/watch.js';

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const tmp = (): string => {
  root = mkdtempSync(join(tmpdir(), 'plot-watch-'));
  return root;
};

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
};

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

describe('watchFs', () => {
  it('delivers an event for refs/heads/ on each of two commits', async () => {
    const repo = tmp();
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    const dir = join(repo, '.git', 'refs', 'heads');
    const events: WatchEvent[] = [];
    const handle = watchFs().arm(dir, { recursive: false }, (e) => events.push(e));
    expect(handle.degraded).toBe(false);

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    await until(() => events.length >= 1);
    const afterFirst = events.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(events[0]?.dir).toBe(dir);

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'third');
    await until(() => events.length > afterFirst);
    expect(events.length).toBeGreaterThan(afterFirst);
    handle.close();
  });

  it('reports degraded for a missing directory and throws nothing', () => {
    const repo = tmp();
    const handle = watchFs().arm(join(repo, 'absent'), { recursive: false }, () => {});
    expect(handle.degraded).toBe(true);
    expect(() => handle.close()).not.toThrow();
  });

  it('keeps delivering after a rename event re-arms the watch', async () => {
    const repo = tmp();
    const events: WatchEvent[] = [];
    const handle = watchFs().arm(repo, { recursive: false }, (e) => events.push(e));
    writeFileSync(join(repo, 'a'), '1');
    await until(() => events.some((e) => e.kind === 'rename'));
    expect(events.every((e) => e.dir === repo)).toBe(true);
    const seen = events.length;
    writeFileSync(join(repo, 'b'), '1');
    await until(() => events.length > seen);
    expect(events.length).toBeGreaterThan(seen);
    expect(events.some((e) => e.name === 'b')).toBe(true);
    handle.close();
  });

  it('delivers nothing after close and reports degraded when the directory vanishes', async () => {
    const repo = tmp();
    const dir = join(repo, 'd');
    mkdirSync(dir);
    const events: WatchEvent[] = [];
    const handle = watchFs().arm(dir, { recursive: false }, (e) => events.push(e));
    handle.close();
    writeFileSync(join(dir, 'x'), '1');
    await new Promise((r) => setTimeout(r, 150));
    expect(events).toEqual([]);

    const second = watchFs().arm(dir, { recursive: false }, () => {});
    rmSync(dir, { recursive: true });
    await until(() => second.degraded, 1000);
    second.close();
  });
});
