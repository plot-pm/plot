import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readerLockFile, readerLockKey, READER_LOCK_HOME_ENV } from '../src/adapters/index.js';
import { isAnswered, type PortResult } from '../src/port-result.js';

/**
 * The lock ON DISK — the half of this slice `reader-election.test.ts` cannot
 * see. **THE ONE ASSERTION THIS FILE EXISTS FOR** is the regression the plan
 * names: two separate PROCESSES asking to read PRs for the same `(connector,
 * account, repo)` at the same moment must not both become the holder — the
 * same reason `slots-file.test.ts` spawns real children rather than two
 * promises in one process.
 */

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-reader-lock-'));
});

afterEach(() => {
  delete process.env[READER_LOCK_HOME_ENV];
});

describe('readerLockKey', () => {
  it('joins the three parts with a separator none of them can produce', () => {
    expect(readerLockKey('bitbucket', 'jwloka', 'ewz-kus-portal')).toBe(
      'bitbucket--jwloka--ewz-kus-portal',
    );
  });

  it('sanitizes a part that would otherwise escape its own segment', () => {
    const key = readerLockKey('bitbucket', '../../escaped', 'repo');
    expect(key).not.toContain('/');
    expect(key).not.toContain('..');
  });

  it('never produces an empty segment', () => {
    expect(readerLockKey('', '', '')).toBe('unknown--unknown--unknown');
  });

  it('distinguishes two repositories on the same account', () => {
    const first = readerLockKey('bitbucket', 'jwloka', 'ewz-kus-portal');
    const second = readerLockKey('bitbucket', 'jwloka', 'websmith');
    expect(first).not.toBe(second);
  });
});

describe('readerLockFile', () => {
  it('elects the first caller and tells the second to follow', async () => {
    const first = readerLockFile({ home, isAlive: () => true });
    const second = readerLockFile({ home, isAlive: () => true });
    expect(
      answer(await first.elect('k', { pid: 11, startedAt: null, at: Date.now() })),
    ).toBe('elected');
    expect(
      answer(await second.elect('k', { pid: 12, startedAt: null, at: Date.now() })),
    ).toBe('held');
  });

  it('renews rather than refusing the holder that asks again', async () => {
    const reader = readerLockFile({ home });
    expect(answer(await reader.elect('k', { pid: 11, startedAt: null, at: 1 }))).toBe('elected');
    expect(answer(await reader.elect('k', { pid: 11, startedAt: null, at: 2 }))).toBe('elected');
    const held = answer(await reader.holder('k'));
    expect(held?.at).toBe(2);
  });

  it('reads the current holder without electing', async () => {
    const reader = readerLockFile({ home });
    expect(answer(await reader.holder('k'))).toBeNull();
    await reader.elect('k', { pid: 11, startedAt: null, at: 1 });
    const held = answer(await reader.holder('k'));
    expect(held?.pid).toBe(11);
  });

  it('elects a new holder once the old one is gone', async () => {
    const clock = 1_756_700_000_000;
    const dead = readerLockFile({ home, isAlive: () => true, now: () => clock });
    expect(answer(await dead.elect('k', { pid: 4242, startedAt: null, at: clock }))).toBe(
      'elected',
    );
    // The holder's pid is now gone — the next asker reads that directly.
    const next = readerLockFile({ home, isAlive: (pid) => pid !== 4242, now: () => clock });
    expect(answer(await next.elect('k', { pid: 11, startedAt: null, at: clock }))).toBe(
      'elected',
    );
  });

  it('elects a new holder once the old one is stale by age', async () => {
    let clock = 1_756_700_000_000;
    const holder = readerLockFile({ home, isAlive: () => true, now: () => clock });
    expect(answer(await holder.elect('k', { pid: 4242, startedAt: null, at: clock }))).toBe(
      'elected',
    );
    const asker = readerLockFile({ home, isAlive: () => true, now: () => clock });
    expect(answer(await asker.elect('k', { pid: 11, startedAt: null, at: clock }))).toBe('held');
    clock += 10 * 60_000;
    expect(answer(await asker.elect('k', { pid: 11, startedAt: null, at: clock }))).toBe(
      'elected',
    );
  });

  it('keeps a lock whose process table could not be asked', async () => {
    const holder = readerLockFile({ home, isAlive: () => true });
    expect(
      answer(await holder.elect('k', { pid: 4242, startedAt: null, at: Date.now() })),
    ).toBe('elected');
    const asker = readerLockFile({ home, isAlive: () => null });
    expect(
      answer(await asker.elect('k', { pid: 11, startedAt: null, at: Date.now() })),
    ).toBe('held');
  });

  it('releases idempotently, and a missing lock is success', async () => {
    const reader = readerLockFile({ home });
    await reader.elect('k', { pid: 11, startedAt: null, at: 1 });
    answer(await reader.release('k', 11));
    answer(await reader.release('k', 11));
    expect(answer(await reader.holder('k'))).toBeNull();
  });

  it('does not release a lock another process now holds', async () => {
    let clock = 1_756_700_000_000;
    const first = readerLockFile({ home, isAlive: () => true, now: () => clock });
    await first.elect('k', { pid: 11, startedAt: null, at: clock });
    clock += 10 * 60_000;
    const second = readerLockFile({ home, isAlive: (pid) => pid !== 11, now: () => clock });
    expect(answer(await second.elect('k', { pid: 12, startedAt: null, at: clock }))).toBe(
      'elected',
    );
    // The reclaimed holder exits and releases. Its lock belongs to somebody
    // else now, and removing it would leave the key with no holder at all.
    answer(await first.release('k', 11));
    const held = answer(await second.holder('k'));
    expect(held?.pid).toBe(12);
  });

  it('writes no lock outside the state directory for a key with a path in it', async () => {
    const reader = readerLockFile({ home });
    const key = readerLockKey('bitbucket', '../../escaped', 'repo');
    await reader.elect(key, { pid: 11, startedAt: null, at: 1 });
    const [segment, ...rest] = readdirSync(join(home, 'pr-reader'));
    expect(rest).toEqual([]);
    expect(segment).not.toContain('/');
    expect(segment).not.toContain('..');
  });

  it('takes its home from the environment where none is given', async () => {
    process.env[READER_LOCK_HOME_ENV] = home;
    const reader = readerLockFile({});
    await reader.elect('k', { pid: 11, startedAt: null, at: 1 });
    expect(readFileSync(join(home, 'pr-reader', 'k', 'owner'), 'utf8')).toContain('11');
  });

  it('prefers an explicit home over the environment', async () => {
    process.env[READER_LOCK_HOME_ENV] = join(home, 'from-the-environment');
    const reader = readerLockFile({ home });
    await reader.elect('k', { pid: 11, startedAt: null, at: 1 });
    expect(readFileSync(join(home, 'pr-reader', 'k', 'owner'), 'utf8')).toContain('11');
  });

  it('fails where the lock directory cannot be created', async () => {
    writeFileSync(join(home, 'pr-reader'), 'not a directory\n');
    const reader = readerLockFile({ home });
    expect(isAnswered(await reader.elect('k', { pid: 11, startedAt: null, at: 1 }))).toBe(false);
    expect(isAnswered(await reader.holder('k'))).toBe(false);
  });

  /**
   * TWO PROCESSES, NOT TWO PROMISES — the assertion this file exists for, and
   * the specific regression the plan's "Done when" floor names: two concurrent
   * readers asking for the same key must not both become the holder.
   */
  it('never elects two processes for the same key at once', async () => {
    const hook = join(home, 'ts-hook.mjs');
    writeFileSync(
      hook,
      [
        `import { existsSync } from 'node:fs';`,
        `import { fileURLToPath } from 'node:url';`,
        `export const resolve = async (specifier, context, next) => {`,
        `  try { return await next(specifier, context); } catch (error) {`,
        `    if (!specifier.endsWith('.js')) throw error;`,
        `    const asTs = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);`,
        `    if (!existsSync(fileURLToPath(asTs))) throw error;`,
        `    return { url: asTs.href, shortCircuit: true, format: 'module-typescript' };`,
        `  }`,
        `};`,
      ].join('\n'),
    );
    const register = join(home, 'register.mjs');
    writeFileSync(
      register,
      [
        `import { register } from 'node:module';`,
        `import { pathToFileURL } from 'node:url';`,
        `register(pathToFileURL(${JSON.stringify(hook)}).href);`,
      ].join('\n'),
    );
    const source = join(home, 'claimer.ts');
    writeFileSync(
      source,
      [
        `import { readerLockFile } from ${JSON.stringify(join(process.cwd(), 'src/adapters/reader-lock/reader-lock-file.ts'))};`,
        `const lock = readerLockFile({ home: ${JSON.stringify(home)}, isAlive: () => true });`,
        `const at = Number(process.argv[2]);`,
        `const pid = Number(process.argv[3]);`,
        `while (Date.now() < at) {}`,
        `const got = await lock.elect('k', { pid, startedAt: null, at: Date.now() });`,
        `process.stdout.write(String(got.ok ? got.value : 'failed'));`,
      ].join('\n'),
    );
    const startAt = String(Date.now() + 3000);
    const claims = await Promise.all(
      Array.from(
        { length: 6 },
        (_, index) =>
          new Promise<string>((resolve, reject) => {
            execFile(
              process.execPath,
              [
                '--experimental-strip-types',
                '--import',
                register,
                source,
                startAt,
                String(20_000 + index),
              ],
              { encoding: 'utf8' },
              (error, stdout, stderr) =>
                error ? reject(new Error(`${String(error)}\n${stderr}`)) : resolve(stdout.trim()),
            );
          }),
      ),
    );
    expect(claims).not.toContain('failed');
    const elected = claims.filter((claim) => claim === 'elected');
    // Exactly one process may become the holder; the rest must read 'held'.
    expect(elected).toHaveLength(1);
  }, 60_000);
});
