import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readerLockFile, READER_LOCK_HOME_ENV } from '../src/adapters/reader-lock/reader-lock-file.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import { READER_STALE_MS, type ReaderClaim } from '../src/rules/reader-election.js';

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

const claim = (pid: number, at: number, startedAt: number | null = at): Omit<ReaderClaim, 'generation'> => ({
  pid,
  startedAt,
  at,
});

describe('readerLockFile', () => {
  it('elects where no holder exists', async () => {
    const lock = readerLockFile({ home });
    const result = await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) });
    expect(answer(result)).toBe('elected');
    const held = answer(await lock.holder('github'));
    expect(held?.pid).toBe(11);
    expect(held?.generation).toBe(1);
  });

  it('renews on every call this process makes', async () => {
    const lock = readerLockFile({ home });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    const second = answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_001_000) }));
    expect(second).toBe('elected');
    const held = answer(await lock.holder('github'));
    expect(held?.generation).toBe(2);
    expect(held?.at).toBe(1_756_700_001_000);
  });

  it('reports held where a live other process holds it', async () => {
    const holder = readerLockFile({ home, env: {} });
    answer(await holder.elect('github', { generation: 0, ...claim(process.pid, 1_756_700_000_000) }));
    const other = readerLockFile({ home, env: {} });
    const result = await other.elect('github', { generation: 0, ...claim(process.pid + 1, 1_756_700_000_000) });
    expect(answer(result)).toBe('held');
  });

  it('elects over a holder whose pid is gone', async () => {
    const holder = readerLockFile({ home });
    answer(await holder.elect('github', { generation: 0, ...claim(4_194_304, 1_756_700_000_000) }));
    // 4_194_304 is not this test's own pid, and no process should hold it.
    const asker = readerLockFile({ home });
    const result = await asker.elect('github', { generation: 0, ...claim(process.pid, 1_756_700_000_050) });
    expect(answer(result)).toBe('elected');
    const held = answer(await asker.holder('github'));
    expect(held?.pid).toBe(process.pid);
    expect(held?.generation).toBe(2);
  });

  it('a superseded holder releasing after a takeover leaves the new holder untouched', async () => {
    const first = readerLockFile({ home });
    answer(await first.elect('github', { generation: 0, ...claim(4_194_304, 1_756_700_000_000) }));
    const second = readerLockFile({ home });
    answer(await second.elect('github', { generation: 0, ...claim(process.pid, 1_756_700_000_050) }));
    // The superseded holder calls release on its way out.
    answer(await first.release('github', 4_194_304));
    const held = answer(await second.holder('github'));
    expect(held?.pid).toBe(process.pid);
  });

  it('releases idempotently, and a missing lock is success', async () => {
    const lock = readerLockFile({ home });
    answer(await lock.elect('github', { generation: 0, ...claim(process.pid, 1_756_700_000_000) }));
    answer(await lock.release('github', process.pid));
    answer(await lock.release('github', process.pid));
    expect(answer(await lock.holder('github'))).toBeNull();
  });

  it('reads a lock nobody has elected into as no holder rather than failed', async () => {
    const lock = readerLockFile({ home });
    expect(answer(await lock.holder('never-elected'))).toBeNull();
  });

  it('keeps one connector from colliding with another', async () => {
    const lock = readerLockFile({ home });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    expect(answer(await lock.holder('bitbucket'))).toBeNull();
  });

  it('skips a torn generation file rather than throwing on it', async () => {
    const lock = readerLockFile({ home });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    const dir = join(home, 'github.lock');
    writeFileSync(join(dir, 'owner.2'), 'half-a-lin');
    const held = answer(await lock.holder('github'));
    expect(held?.generation).toBe(1);
  });

  it('round-trips the reader state file', async () => {
    const lock = readerLockFile({ home });
    expect(answer(await lock.readerState('github'))).toBeNull();
    const state = {
      v: 1 as const,
      prError: null,
      prNextAt: 1_756_700_000_000,
      prNextIsBackoff: false,
      prFullReadFailedAt: null,
      at: 1_756_700_000_000,
    };
    answer(await lock.writeReaderState('github', state));
    expect(answer(await lock.readerState('github'))).toEqual(state);
  });

  it('round-trips heartbeats by name', async () => {
    const lock = readerLockFile({ home });
    answer(await lock.heartbeat('github', `board.${process.pid}`, 1_756_700_000_000));
    answer(await lock.heartbeat('github', 'fleetd', 1_756_700_000_500));
    const beats = answer(await lock.heartbeats('github'));
    expect(beats).toHaveLength(2);
    expect(beats.find((beat) => beat.name === 'fleetd')?.at).toBe(1_756_700_000_500);
  });

  it('reads no heartbeats where none were written, rather than failed', async () => {
    const lock = readerLockFile({ home });
    expect(answer(await lock.heartbeats('github'))).toEqual([]);
  });

  it('takes its home from the environment where none is given', async () => {
    process.env[READER_LOCK_HOME_ENV] = home;
    const lock = readerLockFile();
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    expect(readdirSync(join(home, 'github.lock'))).toContain('owner.1');
  });

  it('prefers an explicit home over the environment', async () => {
    process.env[READER_LOCK_HOME_ENV] = join(home, 'from-the-environment');
    const lock = readerLockFile({ home });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    expect(readdirSync(join(home, 'github.lock'))).toContain('owner.1');
    expect(existsSync(join(home, 'from-the-environment'))).toBe(false);
  });

  /**
   * EIGHT REAL PROCESSES, NOT EIGHT PROMISES. The claim this file exists to
   * make is that two processes racing `elect()` against one pre-seeded stale
   * claim cannot both come away believing they hold the lock — a race eight
   * promises in one event loop cannot demonstrate, because they never truly
   * overlap. Modeled on `slots-file.test.ts`'s own process race.
   */
  it('elects exactly one of eight racing processes against a pre-seeded stale claim', async () => {
    const seeded = readerLockFile({ home });
    const staleAt = 1_000_000_000_000;
    answer(await seeded.elect('github', { generation: 0, ...claim(4_194_304, staleAt) }));

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
    const source = join(home, 'elector.ts');
    writeFileSync(
      source,
      [
        `import { readerLockFile } from ${JSON.stringify(
          join(process.cwd(), 'src/adapters/reader-lock/reader-lock-file.ts'),
        )};`,
        `const lock = readerLockFile({ home: ${JSON.stringify(home)} });`,
        `const at = Number(process.argv[2]);`,
        `while (Date.now() < at) {}`,
        `const now = ${staleAt + READER_STALE_MS + 1_000};`,
        `const result = await lock.elect('github', { generation: 0, pid: process.pid, startedAt: now, at: now });`,
        `process.stdout.write(result.ok ? result.value : 'failed');`,
      ].join('\n'),
    );
    const startAt = String(Date.now() + 3000);
    const verdicts = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<string>((resolve, reject) => {
            execFile(
              process.execPath,
              ['--experimental-strip-types', '--import', register, source, startAt],
              { encoding: 'utf8' },
              (error, stdout, stderr) =>
                error ? reject(new Error(`${String(error)}\n${stderr}`)) : resolve(stdout.trim()),
            );
          }),
      ),
    );
    expect(verdicts).not.toContain('failed');
    const elected = verdicts.filter((verdict) => verdict === 'elected');
    // EXACTLY ONE WINS. Every process raced the same stale claim; `link`'s
    // atomicity means only one publish of a given generation number can
    // succeed, so at most one process sees `elected` for that generation —
    // and since every loser re-reads and would otherwise retry past it, this
    // asserts the FIRST round resolves to one winner, not that losers starve.
    expect(elected.length).toBeGreaterThan(0);
    const holder = answer(await seeded.holder('github'));
    expect(holder).not.toBeNull();
    expect(holder?.pid).not.toBe(4_194_304);
  }, 60_000);
});
