import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scriptsConfigCached } from '../src/adapters/scripts/config-cache.js';
import { answered, failed, type PortResult } from '../src/port-result.js';
import type { Scripts } from '../src/ports/scripts.js';

/**
 * scriptsConfigCached holds config/configSync answers per repository, keyed by
 * a stamp over CLAUDE.md and AGENTS.md. Every Done-when row from the brief has
 * its own test: a held read starts nothing more, an edit is seen on the very
 * next read, two repositories never share an answer, and a failed read is
 * never held.
 */

const dirs: string[] = [];

const repoDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-held-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A counting Scripts fake: only config/configSync are real, everything else throws if called. */
const countingScripts = (
  answer: () => PortResult<string>,
): { scripts: Scripts; calls: { count: number } } => {
  const calls = { count: 0 };
  const unused = (): never => {
    throw new Error('not used by this test');
  };
  const scripts: Scripts = {
    planMeta: unused,
    planMetaSync: unused,
    config: async (..._args: unknown[]) => {
      calls.count += 1;
      return answer();
    },
    configSync: (..._args: unknown[]) => {
      calls.count += 1;
      return answer();
    },
    agentSettings: unused,
    host: unused,
    hostSaid: unused,
    start: unused,
    stream: unused,
    sourced: unused,
    pathOf: unused,
  } as unknown as Scripts;
  return { scripts, calls };
};

describe('scriptsConfigCached', () => {
  it('starts nothing on a held read: two reads of one key make one inner call', async () => {
    const dir = repoDir();
    const { scripts, calls } = countingScripts(() => answered('value'));
    const cached = scriptsConfigCached(scripts, dir);

    await cached.config('Key', 'fallback');
    await cached.config('Key', 'fallback');

    expect(calls.count).toBe(1);
  });

  it('sees an mtime touch on the very next read', async () => {
    const dir = repoDir();
    const claude = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(claude, '# a');
    const { scripts, calls } = countingScripts(() => answered('value'));
    const cached = scriptsConfigCached(scripts, dir);

    await cached.config('Key', 'fallback');
    const stat = fs.statSync(claude);
    fs.utimesSync(claude, new Date(stat.atimeMs + 1000), new Date(stat.mtimeMs + 1000));
    await cached.config('Key', 'fallback');

    expect(calls.count).toBe(2);
  });

  it('sees a same-size rewrite within the same mtime tick', async () => {
    const dir = repoDir();
    const claude = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(claude, '# aaaa');
    const { scripts, calls } = countingScripts(() => answered('value'));
    const cached = scriptsConfigCached(scripts, dir);

    await cached.config('Key', 'fallback');
    // Same byte length, pinned mtime, different ino: a new inode is the only
    // ingredient left to distinguish the rewrite from the file it replaced.
    const stat = fs.statSync(claude);
    fs.rmSync(claude);
    fs.writeFileSync(claude, '# bbbb');
    fs.utimesSync(claude, stat.atime, stat.mtime);
    await cached.config('Key', 'fallback');

    expect(calls.count).toBe(2);
  });

  it('sees CLAUDE.md created where only AGENTS.md held the section', async () => {
    const dir = repoDir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# a');
    const { scripts, calls } = countingScripts(() => answered('value'));
    const cached = scriptsConfigCached(scripts, dir);

    await cached.config('Key', 'fallback');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# b');
    await cached.config('Key', 'fallback');

    expect(calls.count).toBe(2);
  });

  it('never shares an answer between two repositories with equal mtimes and sizes', async () => {
    const dirA = repoDir();
    const dirB = repoDir();
    const when = new Date('2026-01-01T00:00:00Z');
    for (const dir of [dirA, dirB]) {
      const claude = path.join(dir, 'CLAUDE.md');
      fs.writeFileSync(claude, '# same');
      fs.utimesSync(claude, when, when);
    }
    const { scripts, calls } = countingScripts(() => answered('value'));
    const cachedA = scriptsConfigCached(scripts, dirA);
    const cachedB = scriptsConfigCached(scripts, dirB);

    await cachedA.config('Key', 'fallback');
    await cachedB.config('Key', 'fallback');

    expect(calls.count).toBe(2);
  });

  it('never holds a failed read: the next read asks again and can succeed', async () => {
    const dir = repoDir();
    let succeed = false;
    const { scripts, calls } = countingScripts(() => (succeed ? answered('real value') : failed()));
    const cached = scriptsConfigCached(scripts, dir);

    const first = await cached.config('Key', 'fallback');
    expect(first).toEqual({ ok: false, why: 'failed' });
    expect(calls.count).toBe(1);

    succeed = true;
    const second = await cached.config('Key', 'fallback');
    expect(second).toEqual({ ok: true, value: 'real value' });
    expect(calls.count).toBe(2);
  });

  it('holds configSync the same way as config', () => {
    const dir = repoDir();
    const { scripts, calls } = countingScripts(() => answered('value'));
    const cached = scriptsConfigCached(scripts, dir);

    cached.configSync('Key', 'fallback');
    cached.configSync('Key', 'fallback');

    expect(calls.count).toBe(1);
  });
});
