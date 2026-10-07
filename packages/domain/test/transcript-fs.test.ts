import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { transcriptFs } from '../src/adapters/transcript/transcript-fs.js';
import { transcriptDirFor } from '../src/adapters/slice-spend/slice-spend-file.js';

let home: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

const writeSession = (worktree: string, name: string): string => {
  const dir = transcriptDirFor(worktree, home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '{}\n');
  return file;
};

describe('transcriptFs.quietSeconds', () => {
  it('reads a real session directory, by worktree path', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-home-'));
    const worktree = '/Users/someone/repo/.worktrees/feature-x';
    writeSession(worktree, 'sess.jsonl');

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quiet).toBe('seconds');
    if (result.value.quiet !== 'seconds') return;
    expect(result.value.seconds).toBeLessThan(60);
  });

  it('answers unavailable for a directory that exists but holds no session', async () => {
    // The runtime creates the directory when the project is first opened, so
    // an empty one means nothing has written here — not "quiet for a very
    // long time".
    home = mkdtempSync(join(tmpdir(), 'plot-tq-empty-'));
    const worktree = '/Users/someone/repo/.worktrees/feature-empty';
    mkdirSync(transcriptDirFor(worktree, home), { recursive: true });

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ quiet: 'unavailable' });
  });

  it('does not read an `agent-` prefixed transcript as the worker', async () => {
    // A subagent's transcript is a true statement about the wrong process. A
    // worker whose subagent is chatting while the worker itself has stopped
    // must still read as quiet — otherwise the busiest stall on the estate
    // is the one that never reports.
    home = mkdtempSync(join(tmpdir(), 'plot-tq-sub-'));
    const worktree = '/Users/someone/repo/.worktrees/feature-y';
    writeSession(worktree, 'agent-sub.jsonl');

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ quiet: 'unavailable' });
  });

  it('takes the newest session across a desk holding several', async () => {
    // A worktree can hold several sessions — a worker that hopped waves, or
    // an operator who opened one at the same desk. Taking the maximum
    // timestamp is what stops a live session being ended because a stale
    // sibling sits beside it.
    home = mkdtempSync(join(tmpdir(), 'plot-tq-many-'));
    const worktree = '/Users/someone/repo/.worktrees/feature-z';
    const stale = writeSession(worktree, 'old.jsonl');
    const old = new Date(Date.now() - 7200_000);
    utimesSync(stale, old, old);
    writeSession(worktree, 'live.jsonl');

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quiet).toBe('seconds');
    if (result.value.quiet !== 'seconds') return;
    expect(result.value.seconds).toBeLessThan(60);
  });
});

describe('transcriptFs.spoken', () => {
  it('separates no file from no handle', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-spoken-'));
    const worktree = '/Users/someone/repo/.worktrees/feature-spoken';
    const fs = transcriptFs({ transcriptHome: home });

    const noFile = await fs.spoken(worktree, 'worker');
    expect(noFile).toEqual({ ok: true, value: false });

    writeSession(worktree, 'worker.jsonl');
    const withFile = await fs.spoken(worktree, 'worker');
    expect(withFile).toEqual({ ok: true, value: true });

    const noHandle = await fs.spoken(worktree, '');
    expect(noHandle).toEqual({ ok: true, value: false });
  });
});
