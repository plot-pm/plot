// The refused-slice record's writer, ported from the shell loop's
// `record_refused_slice` (#1251). Measured 2026-10-03: one refused slice went
// to free agents 250 times while nothing recorded the refusal.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refusedSlicesFile } from '../src/adapters/refused-slices/refused-slices-file.js';
import { isAnswered, type PortResult } from '../src/port-result.js';

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

const BRANCH = 'bug/the-queue-reads-the-scans-order';

let root = '';
let main = '';
let desk = '';
let record = '';

/** A main checkout with one linked worktree, for a real `--git-common-dir`. */
beforeEach(() => {
  // REALPATH-RESOLVED: macOS reaches `/tmp` through a symlink, and git answers
  // with the resolved path.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-refused-')));
  main = join(root, 'main');
  desk = join(root, 'desk');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  mkdirSync(main);
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 'test@test.invalid');
  git(main, 'config', 'user.name', 'test');
  git(main, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(main, 'a.txt'), 'hi\n');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-qm', 'init');
  git(main, 'branch', 'dummy');
  git(main, 'worktree', 'add', '-q', desk, 'dummy');
  record = join(main, '.git', '.plot', 'state', 'refused-slices.tsv');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The adapter as a desk sees it, with no environment override. */
const fromDesk = () => refusedSlicesFile({ cwd: desk, env: {} });

const lines = (): string[] => readFileSync(record, 'utf8').split('\n').filter((l) => l !== '');

describe('refusedSlicesFile', () => {
  it('writes under the common git dir, not the desk', async () => {
    answer(await fromDesk().record(BRANCH));
    expect(existsSync(record)).toBe(true);
    expect(existsSync(join(desk, '.plot', 'state', 'refused-slices.tsv'))).toBe(false);
    // The main checkout reads the same file the desk wrote.
    expect(answer(await refusedSlicesFile({ cwd: main, env: {} }).has(BRANCH))).toBe(true);
  });

  it('appends the branch once', async () => {
    const store = fromDesk();
    answer(await store.record(BRANCH));
    answer(await store.record(BRANCH));
    expect(lines()).toEqual([BRANCH]);
  });

  it('is a set, not a log, across two branches', async () => {
    const store = fromDesk();
    answer(await store.record('bug/one'));
    answer(await store.record('bug/two'));
    answer(await refusedSlicesFile({ cwd: desk, env: {} }).record('bug/one'));
    expect(lines()).toEqual(['bug/one', 'bug/two']);
  });

  it('keeps a cleared line clear until the branch is refused again', async () => {
    // THE HOLD NEVER ENDS ON A TIMER. A person removes the line, and only the
    // next refusal writes it again.
    const store = fromDesk();
    answer(await store.record(BRANCH));
    writeFileSync(record, '');
    expect(answer(await store.has(BRANCH))).toBe(false);
    answer(await store.record(BRANCH));
    expect(answer(await store.has(BRANCH))).toBe(true);
    expect(lines()).toEqual([BRANCH]);
  });

  it('writes nothing for an empty branch', async () => {
    answer(await fromDesk().record(''));
    expect(existsSync(record)).toBe(false);
  });

  it('reads a missing record as nothing refused', async () => {
    expect(answer(await fromDesk().has(BRANCH))).toBe(false);
  });

  it('records who, why and when beside the branch, and reads them back', async () => {
    const store = refusedSlicesFile({ cwd: desk, env: {}, now: () => new Date('2026-10-18T10:00:00Z') });
    answer(await store.record(BRANCH, { session: 'sess-1', reason: 'the desk\treset\nwas refused' }));
    expect(lines()).toEqual([`${BRANCH}\tsess-1\tthe desk reset was refused\t2026-10-18T10:00:00.000Z`]);
    expect(answer(await store.has(BRANCH))).toBe(true);
    expect(answer(await store.refusal(BRANCH))).toEqual({
      session: 'sess-1',
      reason: 'the desk reset was refused',
      at: '2026-10-18T10:00:00.000Z',
    });
  });

  it('still reads an old one-column file, with empty fields', async () => {
    mkdirSync(join(main, '.git', '.plot', 'state'), { recursive: true });
    writeFileSync(record, `${BRANCH}\nbug/two\n`);
    const store = fromDesk();
    expect(answer(await store.has(BRANCH))).toBe(true);
    expect(answer(await store.refusal(BRANCH))).toEqual({ session: '', reason: '', at: '' });
    expect(answer(await store.refusal('bug/absent'))).toBeNull();
    answer(await store.record(BRANCH, { session: 's', reason: 'r' }));
    expect(lines()).toEqual([BRANCH, 'bug/two']);
  });
});
