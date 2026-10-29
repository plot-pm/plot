import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { decodeRunLogLine, runLogFile } from '../src/adapters/run-log/run-log-file.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import type { RunLogLine } from '../src/ports/run-log.js';

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

const line = (over: Partial<RunLogLine> = {}): RunLogLine => ({
  plan: '2026-10-29-the-delivery-loop-keeps-a-run',
  branch: 'feature/the-loop-keeps-a-run-log',
  pr: '2910',
  head: 'abc1234',
  step: 'dispatch',
  outcome: 'moved',
  at: '2026-10-29T12:00:00.000Z',
  ...over,
});

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-run-log-'));
});

describe('append and read', () => {
  it('reads back what it appended', async () => {
    const log = runLogFile({ home });
    answer(await log.append(line()));
    expect(answer(await log.read())).toEqual([line()]);
  });

  it('a missing file reads as no lines', async () => {
    const log = runLogFile({ home: join(home, 'never-created') });
    const result = await log.read();
    expect(isAnswered(result)).toBe(true);
    expect(answer(result)).toEqual([]);
  });

  it('keeps the order of two appends', async () => {
    const log = runLogFile({ home });
    answer(await log.append(line({ step: 'dispatch', at: '2026-10-29T12:00:00.000Z' })));
    answer(await log.append(line({ step: 'deliver', at: '2026-10-29T13:00:00.000Z' })));
    const lines = answer(await log.read());
    expect(lines.map((l) => l.step)).toEqual(['dispatch', 'deliver']);
  });

  it('round-trips a tab and a newline in outcome', async () => {
    const log = runLogFile({ home });
    const withEscapes = line({ outcome: 'failed\tbroken "quote\nnext line' });
    answer(await log.append(withEscapes));
    expect(answer(await log.read())).toEqual([withEscapes]);
  });

  it('lets a second instance over the same home read what the first appended', async () => {
    const first = runLogFile({ home });
    const second = runLogFile({ home });
    answer(await first.append(line()));
    expect(answer(await second.read())).toEqual([line()]);
  });
});

describe('decodeRunLogLine', () => {
  it('skips a line that does not split into seven fields', () => {
    expect(decodeRunLogLine('a\tb\tc')).toBeNull();
    expect(decodeRunLogLine('')).toBeNull();
  });

  it('skips a line with an empty required field', () => {
    expect(decodeRunLogLine(['', 'b', 'c', 'd', 'dispatch', 'moved', 'at'].join('\t'))).toBeNull();
    expect(decodeRunLogLine(['plan', 'b', 'c', 'd', 'dispatch', 'moved', ''].join('\t'))).toBeNull();
  });

  it('skips a line whose step is not one of the declared steps', () => {
    expect(decodeRunLogLine(['plan', 'b', 'c', 'd', 'not-a-step', 'moved', 'at'].join('\t'))).toBeNull();
  });

  it('a torn line is skipped, the rest of the file still reads', async () => {
    mkdirSync(home, { recursive: true });
    const good = line();
    writeFileSync(
      join(home, 'run-log.tsv'),
      `${[good.plan, good.branch, good.pr, good.head, good.step, good.outcome, good.at].join('\t')}\nnot\tenough\tfields\n`,
    );
    const log = runLogFile({ home });
    expect(answer(await log.read())).toEqual([good]);
  });
});

describe('the error paths', () => {
  it('reads no lines and refuses the append where the git common dir cannot be found', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'plot-run-log-nogit-'));
    const log = runLogFile({ cwd: outside, env: {} });
    expect(answer(await log.read())).toEqual([]);
    expect((await log.append(line())).ok).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it('answers failed, not empty, where the file exists and cannot be read', async () => {
    mkdirSync(join(home, 'run-log.tsv'), { recursive: true });
    const log = runLogFile({ home });
    expect((await log.read()).ok).toBe(false);
  });

  it('answers failed where the append cannot land', async () => {
    mkdirSync(join(home, 'run-log.tsv'), { recursive: true });
    const log = runLogFile({ home });
    expect((await log.append(line())).ok).toBe(false);
  });

  it('answers failed where the directory cannot be created', async () => {
    const blocker = join(home, 'blocker');
    writeFileSync(blocker, 'x');
    const log = runLogFile({ home: join(blocker, 'state') });
    expect((await log.append(line())).ok).toBe(false);
  });
});

describe('a worktree and the main checkout resolve to one file', () => {
  it('writes to the common git dir, read back from both checkouts', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'plot-run-log-repo-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(join(repo, 'README.md'), 'x');
      git('add', 'README.md');
      git('commit', '-q', '-m', 'init');

      const worktreePath = join(repo, '.worktrees', 'a-branch');
      git('worktree', 'add', '-q', '-b', 'a-branch', worktreePath);

      const fromMain = runLogFile({ cwd: repo, env: {} });
      const fromWorktree = runLogFile({ cwd: worktreePath, env: {} });

      answer(await fromWorktree.append(line()));
      expect(answer(await fromMain.read())).toEqual([line()]);

      git('worktree', 'remove', '--force', worktreePath);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
