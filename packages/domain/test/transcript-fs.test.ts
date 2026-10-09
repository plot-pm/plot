import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { transcriptFs } from '../src/adapters/transcript/transcript-fs.js';
import { transcriptDirFor } from '../src/adapters/slice-spend/slice-spend-file.js';
import { idleNow, type DeskReading } from '../src/rules/sample.js';

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
    // A top-level `agent-*` file belongs to no session in this directory, so
    // it alone gives no reading.
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

/** Writes `<session>/subagents/<name>` under the desk's transcript directory, aged by `ageMs`. */
const writeSubagent = (worktree: string, session: string, name: string, ageMs: number): string => {
  const dir = join(transcriptDirFor(worktree, home), session, 'subagents');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '{}\n');
  const at = new Date(Date.now() - ageMs);
  utimesSync(file, at, at);
  return file;
};

/** Ages a file's mtime by `ageMs`. */
const age = (file: string, ageMs: number): void => {
  const at = new Date(Date.now() - ageMs);
  utimesSync(file, at, at);
};

describe('transcriptFs.quietSeconds — a session\'s subagents', () => {
  it('reads a session as active while its subagent writes, though its own transcript is two hours old', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-subdir-live-'));
    const worktree = '/Users/someone/repo/.worktrees/free-live';
    age(writeSession(worktree, 'sess.jsonl'), 7200_000);
    writeSubagent(worktree, 'sess', 'agent-a1.jsonl', 360_000);

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.quiet !== 'seconds') throw new Error('expected seconds');
    expect(result.value.seconds).toBeGreaterThanOrEqual(355);
    expect(result.value.seconds).toBeLessThan(900);
  });

  it('reads a session as quiet when its own transcript and every subagent transcript are old', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-subdir-stale-'));
    const worktree = '/Users/someone/repo/.worktrees/free-stale';
    age(writeSession(worktree, 'sess.jsonl'), 7200_000);
    writeSubagent(worktree, 'sess', 'agent-a1.jsonl', 3600_000);

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.quiet !== 'seconds') throw new Error('expected seconds');
    expect(result.value.seconds).toBeGreaterThanOrEqual(3595);
  });

  it('ignores a file in the subagents directory that is not a transcript', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-subdir-meta-'));
    const worktree = '/Users/someone/repo/.worktrees/free-meta';
    age(writeSession(worktree, 'sess.jsonl'), 7200_000);
    writeSubagent(worktree, 'sess', 'agent-a1.meta.json', 0);

    const result = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.quiet !== 'seconds') throw new Error('expected seconds');
    expect(result.value.seconds).toBeGreaterThanOrEqual(7195);
  });
});

/**
 * The idle verdict for a desk whose agent is alive, has spoken and committed,
 * has no child on a core and an unmoved tree — every condition but silence
 * holds — with its silence read through {@link transcriptFs}.
 */
const idleVerdictFor = async (worktree: string): Promise<ReturnType<typeof idleNow>> => {
  const quiet = await transcriptFs({ transcriptHome: home }).quietSeconds(worktree);
  if (!quiet.ok || quiet.value.quiet !== 'seconds') throw new Error('expected seconds');
  const reading: DeskReading = {
    pid: 'alive',
    spoken: true,
    silenceSeconds: quiet.value.seconds,
    childOnCore: false,
    treeQuietSeconds: 1800,
    commits: 'yes',
  };
  return idleNow(reading, 900);
};

describe('the idle verdict over a session with a subagent', () => {
  it('is not idle while the subagent wrote six minutes ago and the session itself two hours ago', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-idle-live-'));
    const worktree = '/Users/someone/repo/.worktrees/free-idle-live';
    age(writeSession(worktree, 'sess.jsonl'), 7200_000);
    writeSubagent(worktree, 'sess', 'agent-a1.jsonl', 360_000);

    expect(await idleVerdictFor(worktree)).toBe('silent');
  });

  it('is idle when the session and its subagent both stopped writing an hour or more ago', async () => {
    home = mkdtempSync(join(tmpdir(), 'plot-tq-idle-stale-'));
    const worktree = '/Users/someone/repo/.worktrees/free-idle-stale';
    age(writeSession(worktree, 'sess.jsonl'), 7200_000);
    writeSubagent(worktree, 'sess', 'agent-a1.jsonl', 3600_000);

    expect(await idleVerdictFor(worktree)).toBe('idle');
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
