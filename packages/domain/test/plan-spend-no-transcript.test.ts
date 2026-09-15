import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { sliceSpendFile } from '../src/adapters/slice-spend/slice-spend-file.js';
import { encodeSliceSpend } from '../src/entities/slice-spend.js';
import { answered, failed, type PortResult } from '../src/port-result.js';
import type { SliceSpendRecord } from '../src/ports/slice-spend.js';
import type { TranscriptLine } from '../src/rules/slice-tokens.js';
import { readPlanSpend, readSliceSpend } from '../src/workflows/slice-spend.js';

/**
 * THE GATE THE DELIVERED SLICE CLAIMED AND NEVER WROTE.
 *
 * `workflows/slice-spend.ts` asserts *"a test pins that this path opens no
 * transcript"*. No such test existed: the adapter suite points the transcript
 * home at an empty directory, which proves the read SUCCEEDS without
 * transcripts, not that none is opened. Prose claiming a gate reads exactly
 * like a gate and CI stays green because nothing checks.
 *
 * So this pins it twice, because either half alone is escapable:
 *
 * - STRUCTURALLY, that `sessions()` — the port's only transcript reader — is
 *   never called. A stub that throws turns a call into a failure.
 * - EMPIRICALLY, that no `.jsonl` is opened by any route, spying on the
 *   filesystem itself. That catches a reader reaching the disk directly rather
 *   than through the port, which the structural half cannot see.
 *
 * A per-refresh transcript scan passes every correctness test and reintroduces
 * the cost writing once at `seal_declaration` exists to remove.
 */

/**
 * Every path `node:fs/promises` was asked to open, across the whole file.
 *
 * `vi.hoisted` because `vi.mock`'s factory is hoisted above the imports and
 * cannot close over an ordinary `const`. A spy is not available here at all:
 * an ESM module namespace is frozen by spec, so `vi.spyOn(fsPromises, …)`
 * throws *"Module namespace is not configurable"*. Mocking at resolution is the
 * supported route and reaches the adapter's named imports.
 */
const watch = vi.hoisted(() => ({ opened: [] as string[] }));

vi.mock('node:fs/promises', async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const note =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (path: unknown, ...rest: unknown[]): R => {
      watch.opened.push(String(path));
      return fn(...([path, ...rest] as unknown as A));
    };
  return {
    ...real,
    readFile: note(real.readFile),
    open: note(real.open),
    readdir: note(real.readdir),
    stat: note(real.stat),
  };
});

let root: string;
/**
 * The directory holding the record, passed to the adapter as `home`.
 *
 * The `home` seam rather than a real git repository: this test asks WHAT GETS
 * OPENED, and `--git-common-dir` resolution is pinned by
 * `slice-spend-file.test.ts` against an actual worktree. Forking `git` here
 * would add a subprocess to a filesystem assertion and prove neither thing
 * better.
 */
let home: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-plan-spend-'));
  home = join(root, 'checkout', '.git', '.plot', 'state');
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'slice-spend.jsonl'),
    `${encodeSliceSpend({
      branch: 'feature/a',
      at: '2026-09-15T10:00:00.000Z',
      tokens: {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
      },
      turns: 1,
      models: ['claude-opus-5'],
    })}\n`,
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  watch.opened.length = 0;
});

/**
 * A port whose transcript reader is a trap.
 *
 * `sessions()` is the ONLY operation that opens a transcript, so a read path
 * that calls it fails here rather than merely being slow.
 */
const trapRecord = (lines: readonly string[]): SliceSpendRecord => ({
  location: () => answered('/tmp/nowhere/slice-spend.jsonl'),
  sessions: (): Promise<PortResult<readonly (readonly TranscriptLine[])[]>> => {
    throw new Error('sessions() was called — a read path opened a transcript');
  },
  append: async () => {
    throw new Error('append() was called — a rollup is a read and writes nothing');
  },
  lines: async () => answered(lines),
});

describe('the rollup opens no transcript', () => {
  it('never calls sessions(), the port’s only transcript reader', async () => {
    const record = trapRecord([
      encodeSliceSpend({
        branch: 'feature/a',
        at: '2026-09-15T10:00:00.000Z',
        tokens: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
        turns: 1,
        models: ['m'],
      }),
    ]);

    const actual = await readPlanSpend(record, ['feature/a', 'feature/absent']);

    expect(actual.tokens?.inputTokens).toBe(1);
    expect(actual.measured).toBe(1);
    expect(actual.absent).toBe(1);
  });

  it('never writes — a rollup is a read', async () => {
    // `append()` throws in the trap above, so reaching it fails the test.
    await expect(readPlanSpend(trapRecord([]), ['feature/a'])).resolves.toMatchObject({
      tokens: null,
    });
  });

  it('reports every slice UNREADABLE when the port itself fails', async () => {
    // READ THE EXIT CODE, NOT THE EMPTINESS, through the workflow rather than
    // only through the rule. `lines()` answering `failed` must become
    // `unreadable`, where a missing file answers `answered([])` and becomes
    // `absent` — the two facts this plan exists to keep apart. A test of
    // `planSpend(null, …)` alone proves the rule handles null and not that the
    // workflow can produce one.
    const broken: SliceSpendRecord = {
      ...trapRecord([]),
      lines: async (): Promise<PortResult<readonly string[]>> => failed(),
    };

    const actual = await readPlanSpend(broken, ['feature/a', 'feature/b']);

    expect(actual.tokens).toBeNull();
    expect(actual.unreadable).toBe(2);
    expect(actual.absent).toBe(0);
  });

  it('reads the record ONCE, not once per slice', async () => {
    // One file holds every branch the machine has measured, so N calls to
    // readSliceSpend would re-read the whole file N times.
    let reads = 0;
    const counting: SliceSpendRecord = {
      ...trapRecord([]),
      lines: async () => {
        reads += 1;
        return answered([]);
      },
    };

    await readPlanSpend(counting, ['feature/a', 'feature/b', 'feature/c']);

    expect(reads).toBe(1);
  });

  it('opens NO .jsonl on the filesystem, by any route', async () => {
    // THE HALF THE DELIVERED SLICE WAS MISSING. The structural test above
    // watches the port; this watches the DISK, so it catches a reader that
    // bypasses the port entirely.
    const actual = await readPlanSpend(sliceSpendFile({ home }), ['feature/a']);

    expect(actual.measured).toBe(1);
    // The watcher must actually be watching, or an empty list proves nothing.
    expect(watch.opened).not.toHaveLength(0);
    // THE RECORD IS ITSELF A `.jsonl`, so the assertion names transcripts
    // precisely: nothing under a `projects/` transcript directory is opened,
    // and the only `.jsonl` touched is the record under `.plot/state/`.
    expect(watch.opened.filter((path) => path.includes(join('.claude', 'projects')))).toEqual([]);
    expect(
      watch.opened.filter(
        (path) => path.endsWith('.jsonl') && !path.includes(join('.plot', 'state')),
      ),
    ).toEqual([]);
  });
});

describe('the per-slice read opens no transcript either', () => {
  it('never calls sessions() — the claim the delivered slice made', async () => {
    // Backfilled here rather than left as a docstring. The claim was true of the
    // code and unproven by any test.
    const actual = await readSliceSpend(
      trapRecord([
        encodeSliceSpend({
          branch: 'feature/a',
          at: '2026-09-15T10:00:00.000Z',
          tokens: { inputTokens: 5, outputTokens: 6, cacheCreationTokens: 7, cacheReadTokens: 8 },
          turns: 1,
          models: ['m'],
        }),
      ]),
      'feature/a',
    );

    expect(actual.state).toBe('measured');
    expect(actual.latest?.tokens.outputTokens).toBe(6);
  });
});
