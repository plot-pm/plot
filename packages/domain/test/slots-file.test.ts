import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsFile, slotsFixture, SLOTS_HOME_ENV } from '../src/adapters/index.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import { CLAIM_STALE_MS, heldSlots, slotVerdict } from '../src/rules/concurrency.js';

/**
 * The cap ON DISK — the half of this slice a pure test cannot see.
 *
 * **THE ONE ASSERTION THIS FILE EXISTS FOR is that two separate PROCESSES
 * asking for the last slot at the same moment do not both get it.** That is the
 * whole shape of 2026-08-27: eight workers, eight processes, each shelling
 * `plot-host.sh` once. Two promises in one process share a thread and prove
 * nothing about it — the same reason `budget-file.test.ts` runs its concurrent
 * appends from separate processes.
 */

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-slots-'));
});

afterEach(() => {
  delete process.env[SLOTS_HOME_ENV];
});

describe('slotsFile', () => {
  it('hands out slots up to the bound and then reports the account busy', async () => {
    // Each caller is a distinct pid, which is what a fleet of workers is.
    const callers = [11, 12, 13].map((pid) => slotsFile({ home, pid, isAlive: () => true }));
    expect(answer(await callers[0].acquire('jwloka', 2))).toBe(0);
    expect(answer(await callers[1].acquire('jwloka', 2))).toBe(1);
    // BUSY, NOT BROKEN. `null` is the account being full; `failed` would be the
    // claims being unreadable, and a caller must not read either as the other.
    expect(answer(await callers[2].acquire('jwloka', 2))).toBeNull();
  });

  it('frees a slot on release', async () => {
    const first = slotsFile({ home, pid: 11, isAlive: () => true });
    const second = slotsFile({ home, pid: 12, isAlive: () => true });
    expect(answer(await first.acquire('jwloka', 1))).toBe(0);
    expect(answer(await second.acquire('jwloka', 1))).toBeNull();
    answer(await first.release('jwloka', 0));
    expect(answer(await second.acquire('jwloka', 1))).toBe(0);
  });

  it('keeps one account from spending another account cap', async () => {
    const caller = slotsFile({ home, pid: 11, isAlive: () => true });
    expect(answer(await caller.acquire('jwloka', 1))).toBe(0);
    // A different account is a different budget and a different cap — the
    // plan's whole name.
    expect(answer(await caller.acquire('someone-else', 1))).toBe(0);
  });

  it('reclaims the slot of a process that is gone', async () => {
    const dead = slotsFile({ home, pid: 4242, isAlive: () => true });
    expect(answer(await dead.acquire('jwloka', 1))).toBe(0);
    // The idle rule ended twelve desks over two days here. A cap that counted
    // their claims forever would read the account as permanently full.
    const live = slotsFile({ home, pid: 11, isAlive: (pid) => pid !== 4242 });
    expect(answer(await live.acquire('jwloka', 1))).toBe(0);
  });

  it('keeps a slot whose process table could not be asked', async () => {
    const holder = slotsFile({ home, pid: 4242, isAlive: () => true });
    expect(answer(await holder.acquire('jwloka', 1))).toBe(0);
    // Nothing silently reads unreachable as permission.
    const asker = slotsFile({ home, pid: 11, isAlive: () => null });
    expect(answer(await asker.acquire('jwloka', 1))).toBeNull();
  });

  it('reclaims a live claim only once it is older than the staleness bound', async () => {
    let clock = 1_756_700_000_000;
    const holder = slotsFile({ home, pid: 4242, isAlive: () => true, now: () => clock });
    expect(answer(await holder.acquire('jwloka', 1))).toBe(0);
    const asker = slotsFile({ home, pid: 11, isAlive: () => true, now: () => clock });
    expect(answer(await asker.acquire('jwloka', 1))).toBeNull();
    clock += CLAIM_STALE_MS;
    expect(answer(await asker.acquire('jwloka', 1))).toBe(0);
  });

  it('does not release a slot another process now holds', async () => {
    const first = slotsFile({ home, pid: 11, isAlive: () => true });
    expect(answer(await first.acquire('jwloka', 1))).toBe(0);
    const second = slotsFile({ home, pid: 12, isAlive: (pid) => pid !== 11 });
    expect(answer(await second.acquire('jwloka', 1))).toBe(0);
    // The reclaimed owner exits and releases. Its slot belongs to somebody else
    // now, and removing it would let the cap be exceeded by one.
    answer(await first.release('jwloka', 0));
    const held = answer(await second.held('jwloka'));
    expect(held).toHaveLength(1);
    expect(held[0].claim.pid).toBe(12);
  });

  it('releases idempotently, and a missing slot is success', async () => {
    const caller = slotsFile({ home, pid: 11, isAlive: () => true });
    expect(answer(await caller.acquire('jwloka', 1))).toBe(0);
    answer(await caller.release('jwloka', 0));
    answer(await caller.release('jwloka', 0));
    expect(answer(await caller.held('jwloka'))).toHaveLength(0);
  });

  it('reads an account nobody has claimed as empty rather than failed', async () => {
    const caller = slotsFile({ home, pid: 11 });
    expect(answer(await caller.held('never-spent'))).toEqual([]);
  });

  it('reports every claim it holds, live or stale', async () => {
    const first = slotsFile({ home, pid: 11, isAlive: () => true });
    const second = slotsFile({ home, pid: 12, isAlive: () => true });
    expect(answer(await first.acquire('jwloka', 3))).toBe(0);
    expect(answer(await second.acquire('jwloka', 3))).toBe(1);
    const held = answer(await second.held('jwloka'));
    expect(held.map((slot) => slot.index)).toEqual([0, 1]);
    expect(held.map((slot) => slot.claim.pid)).toEqual([11, 12]);
  });

  it('skips a torn claim rather than throwing on it', async () => {
    const caller = slotsFile({ home, pid: 11, isAlive: () => true });
    expect(answer(await caller.acquire('jwloka', 2))).toBe(0);
    const dir = join(home, 'slots', 'jwloka');
    writeFileSync(join(dir, '1'), 'half-a-lin');
    // A file nobody can read names no process holding the slot, so it is
    // reclaimable — and reading the directory still answers.
    const held = answer(await caller.held('jwloka'));
    expect(held.map((slot) => slot.index)).toEqual([0]);
  });

  it('ignores a file in the directory that is not a slot', async () => {
    const caller = slotsFile({ home, pid: 11, isAlive: () => true });
    expect(answer(await caller.acquire('jwloka', 1))).toBe(0);
    writeFileSync(join(home, 'slots', 'jwloka', 'README'), 'not a slot\n');
    expect(answer(await caller.held('jwloka')).map((slot) => slot.index)).toEqual([0]);
  });

  it('writes no claim outside the state directory for an account with a path in it', async () => {
    const caller = slotsFile({ home, pid: 11, isAlive: () => true });
    // The account is a string the record does not validate, so it can hold a
    // dot segment. A path built from it unchecked is a traversal.
    expect(answer(await caller.acquire('../../escaped', 1))).toBe(0);
    // The claim lands under `slots/`, in one segment that spells no parent
    // directory. The exact substitution does not matter; staying inside does.
    const [segment, ...rest] = readdirSync(join(home, 'slots'));
    expect(rest).toEqual([]);
    expect(segment).not.toContain('/');
    expect(segment).not.toContain('..');
    expect(readdirSync(join(home, 'slots', segment))).toEqual(['0']);
  });

  it('takes its home from the environment where none is given', async () => {
    process.env[SLOTS_HOME_ENV] = home;
    const caller = slotsFile({ pid: 11, isAlive: () => true });
    expect(answer(await caller.acquire('jwloka', 1))).toBe(0);
    expect(readdirSync(join(home, 'slots', 'jwloka'))).toEqual(['0']);
  });

  it('prefers an explicit home over the environment', async () => {
    // The seam a suite uses so it never touches the operator's own claims —
    // the same one `budgetFile` documents, and the same variable, because two
    // halves of one budget must not resolve to two places.
    process.env[SLOTS_HOME_ENV] = join(home, 'from-the-environment');
    const caller = slotsFile({ home, pid: 11, isAlive: () => true });
    expect(answer(await caller.acquire('jwloka', 1))).toBe(0);
    expect(readdirSync(join(home, 'slots', 'jwloka'))).toEqual(['0']);
    expect(existsSync(join(home, 'from-the-environment'))).toBe(false);
  });

  it('falls back to the home directory where neither is given', async () => {
    // `homedir()` answers on every platform this runs on, so this asserts the
    // fallback resolves rather than that it fails — and it never CLAIMS there,
    // because a suite writing under the operator's home would leave real files.
    const caller = slotsFile({ env: {}, pid: 11 });
    const where = caller.held('never-spent-anywhere');
    expect(isAnswered(await where)).toBe(true);
  });

  it('fails where the claims directory cannot be created', async () => {
    // A file where the directory should be: `mkdir` cannot proceed, and the
    // caller is told nothing is known rather than being told it may spend.
    writeFileSync(join(home, 'slots'), 'not a directory\n');
    const caller = slotsFile({ home, pid: 11 });
    expect(isAnswered(await caller.acquire('jwloka', 1))).toBe(false);
    expect(isAnswered(await caller.held('jwloka'))).toBe(false);
    // Releasing fails too, and that is right: the unlink hit a path that is not
    // a directory, which is a fault rather than the slot already being gone.
    expect(isAnswered(await caller.release('jwloka', 0))).toBe(false);
  });

  it('bounds at one however small the bound it is given', async () => {
    const first = slotsFile({ home, pid: 11, isAlive: () => true });
    const second = slotsFile({ home, pid: 12, isAlive: () => true });
    expect(answer(await first.acquire('jwloka', 0))).toBe(0);
    expect(answer(await second.acquire('jwloka', 0))).toBeNull();
  });

  /**
   * TWO PROCESSES, NOT TWO PROMISES — the assertion this file exists for.
   *
   * Two `acquire` calls in one process cannot interleave in a single
   * JavaScript turn, so they demonstrate nothing about `O_EXCL`. This spawns
   * real ones, which is the shape 2026-08-27 measured.
   */
  it('never hands the same slot to two processes', async () => {
    // THE REAL ADAPTER IN THE CHILD, not a reimplementation of it. Node's type
    // stripping resolves no `.js` specifier back to a `.ts` file, which every
    // module in this package writes, so the child is given a resolve hook that
    // rewrites one to the other where the file exists. Fifteen lines to test
    // the shipped code path rather than a copy of it that could drift.
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
        `import { slotsFile } from ${JSON.stringify(join(process.cwd(), 'src/adapters/slots/slots-file.ts'))};`,
        `const slots = slotsFile({ home: ${JSON.stringify(home)}, isAlive: () => true });`,
        // STARTED TOGETHER. Each child spins to a wall-clock moment the parent
        // chose, so the six `acquire` calls overlap rather than running one
        // after another — a sequential run passes against a read-then-write and
        // proves nothing.
        `const at = Number(process.argv[2]);`,
        `while (Date.now() < at) {}`,
        `const got = await slots.acquire('jwloka', 3);`,
        `process.stdout.write(String(got.ok ? got.value : 'failed'));`,
      ].join('\n'),
    );
    const startAt = String(Date.now() + 3000);
    const claims = await Promise.all(
      Array.from(
        { length: 6 },
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
    expect(claims).not.toContain('failed');
    const taken = claims.filter((claim) => claim !== 'null');
    // Every process that got a slot got a DIFFERENT one, which is the property
    // a read-then-write would break by handing the last slot to both.
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken.length).toBeLessThanOrEqual(3);
    expect(taken.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('slotsFixture', () => {
  it('hands out slots up to the bound and then reports the account busy', async () => {
    const first = slotsFixture({ pid: 11 });
    expect(answer(await first.acquire('jwloka', 2))).toBe(0);
    expect(answer(await first.acquire('jwloka', 2))).toBe(1);
    expect(answer(await first.acquire('jwloka', 2))).toBeNull();
  });

  it('starts from claims a test placed', async () => {
    const slots = slotsFixture({
      pid: 11,
      held: { jwloka: new Map([[0, { pid: 99, startedAt: null, at: 1_756_700_000_000 }]]) },
    });
    expect(answer(await slots.acquire('jwloka', 2))).toBe(1);
    expect(answer(await slots.held('jwloka'))).toHaveLength(2);
  });

  it('reclaims the slot of a process that is gone', async () => {
    const slots = slotsFixture({
      pid: 11,
      isAlive: (pid) => pid !== 99,
      held: { jwloka: new Map([[0, { pid: 99, startedAt: null, at: 1_756_700_000_000 }]]) },
    });
    expect(answer(await slots.acquire('jwloka', 1))).toBe(0);
  });

  it('releases only this process own claim', async () => {
    const slots = slotsFixture({
      pid: 11,
      held: { jwloka: new Map([[0, { pid: 99, startedAt: null, at: 1_756_700_000_000 }]]) },
    });
    answer(await slots.release('jwloka', 0));
    expect(answer(await slots.held('jwloka'))).toHaveLength(1);
  });

  it('releases what it holds', async () => {
    const slots = slotsFixture({ pid: 11 });
    expect(answer(await slots.acquire('jwloka', 1))).toBe(0);
    answer(await slots.release('jwloka', 0));
    expect(answer(await slots.held('jwloka'))).toHaveLength(0);
  });

  it('reports an unreadable account as failed on every operation', async () => {
    const slots = slotsFixture({ unreadable: ['jwloka'] });
    expect(isAnswered(await slots.acquire('jwloka', 1))).toBe(false);
    expect(isAnswered(await slots.release('jwloka', 0))).toBe(false);
    expect(isAnswered(await slots.held('jwloka'))).toBe(false);
  });

  it('bounds at one however small the bound it is given', async () => {
    const slots = slotsFixture({ pid: 11 });
    expect(answer(await slots.acquire('jwloka', -3))).toBe(0);
    expect(answer(await slots.acquire('jwloka', -3))).toBeNull();
  });

  it('feeds the rules that read it', async () => {
    // THE RECORD SHOWS THE BOUND WORKING — the count is a number a caller can
    // read, not silence.
    const slots = slotsFixture({ pid: 11 });
    await slots.acquire('jwloka', 3);
    await slotsFixture({ pid: 12 }).acquire('jwloka', 3);
    const held = answer(await slots.held('jwloka'));
    const live = heldSlots(
      held.map((slot) => ({ claim: slot.claim, alive: true, startedAt: null })),
      1_756_700_000_000,
    );
    expect(live).toBe(1);
    expect(slotVerdict(live, 3)).toBe('go');
  });
});
