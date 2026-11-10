import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { processReadingOf, readWorkerReadings, recordTokenRelease, type DeskFilesIo } from '../src/adapters/processes/processes-files.js';
import type { ProcessRow } from '../src/rules/pid-current.js';
import { PASS_FILE, RELEASED_WITH_NO_EXIT, type TokenReading } from '../src/rules/worker-liveness.js';

const made = mkdtempSync(join(tmpdir(), 'plot-processes-token-'));
afterAll(() => rmSync(made, { recursive: true, force: true }));

const STARTED = '2026-11-09T08:00:00Z';
const startedMs = Date.parse(STARTED);
const TOKEN_MS = startedMs + 1_000;
const NOW = startedMs + 3_600_000;
const BOUND_MS = 28_800_000;

let count = 0;
/** A desk with a manifest naming pid 41, and the given files. */
const deskWith = (files: Record<string, string>): { worktree: string; manifestDir: string } => {
  count += 1;
  const worktree = join(made, `desk-${count}`);
  const manifestDir = join(made, `agents-${count}`);
  mkdirSync(worktree, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(worktree, file), text);
  writeFileSync(
    join(manifestDir, 'a.json'),
    JSON.stringify({ worktree, branch: 'feature/x', pid: '41', startedAt: STARTED }, null, 2),
  );
  return { worktree, manifestDir };
};

const row = (pid: number, ppid: number, comm: string): ProcessRow => ({ pid, ppid, startedAt: startedMs, cpuCentis: 0, comm });

/** A process table that counts how often it is read. */
const countedTable = (rows: readonly ProcessRow[]) => {
  const reads = { n: 0 };
  return { reads, table: async () => (reads.n += 1, rows) };
};

const ioOf = (manifestDir: string, token: TokenReading, over: Partial<DeskFilesIo> = {}): DeskFilesIo => ({
  manifestDir,
  signalZero: () => true,
  startedAt: async () => {
    throw new Error('a desk with a token reads no start time');
  },
  dirty: async () => false,
  ahead: async () => '0',
  now: () => NOW,
  graceSeconds: 30,
  agentProcess: 'claude',
  token: () => token,
  workerBoundMs: async () => BOUND_MS,
  ...over,
});

const held: TokenReading = { state: 'held', madeAtMs: TOKEN_MS };
const released: TokenReading = { state: 'released', madeAtMs: TOKEN_MS };

/** Sets a desk file's modification time. */
const touch = (path: string, ms: number): void => utimesSync(path, ms / 1000, ms / 1000);

describe('readWorkerReadings with a liveness token', () => {
  it('reads a held token with an answering pid as running, on the token basis, with no table and no start time', async () => {
    const { worktree, manifestDir } = deskWith({});
    const { reads, table } = countedTable([]);
    const gathered = await readWorkerReadings(worktree, table, ioOf(manifestDir, held));
    expect(gathered.basis).toBe('token');
    expect(gathered.readings.liveness).toBe('live');
    expect(processReadingOf(gathered, false)).toMatchObject({ state: 'running', basis: 'token' });
    expect(reads.n).toBe(0);
  });

  it('reads a held token whose pid does not answer as a stray holder, which starts no restart', async () => {
    const { worktree, manifestDir } = deskWith({});
    const gathered = await readWorkerReadings(worktree, [], ioOf(manifestDir, held, { signalZero: () => false }));
    expect(gathered.readings.liveness).toBe('stray-holder');
    expect(processReadingOf(gathered, false).state).toBe('running');
  });

  it('reads a released token with no exit record as ended, and records the release once', async () => {
    const { worktree, manifestDir } = deskWith({});
    const released_: string[] = [];
    const io = ioOf(manifestDir, released, { recordRelease: (wt, branch, at) => released_.push(`${wt} ${branch} ${at}`) });
    const gathered = await readWorkerReadings(worktree, [], io);
    expect(gathered.readings.liveness).toBe('dead');
    expect(processReadingOf(gathered, false)).toMatchObject({ state: 'ended', exitCode: '' });
    expect(released_).toEqual([`${worktree} feature/x ${TOKEN_MS}`]);
  });

  it('lets an exit record not older than the token win over a held token', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.exit': '0' });
    touch(join(worktree, '.plot-worker.exit'), TOKEN_MS + 5_000);
    const gathered = await readWorkerReadings(worktree, [], ioOf(manifestDir, held));
    expect(gathered.readings).toMatchObject({ liveness: 'dead', exit: '0' });
    expect(processReadingOf(gathered, false)).toMatchObject({ state: 'finished', exitCode: '0' });
  });

  it('ignores an earlier run\'s exit record, older than the token, so it does not end the new run', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.exit': '1' });
    touch(join(worktree, '.plot-worker.exit'), TOKEN_MS - 5_000);
    const live = await readWorkerReadings(worktree, [], ioOf(manifestDir, held));
    expect(live.readings).toMatchObject({ liveness: 'live', exit: null });
    const dead = await readWorkerReadings(worktree, [], ioOf(manifestDir, released));
    expect(processReadingOf(dead, false)).toMatchObject({ state: 'ended', exitCode: '' });
  });

  it('reads a stray holder past Worker bound as ended', async () => {
    const { worktree, manifestDir } = deskWith({});
    const stray = ioOf(manifestDir, held, { now: () => startedMs + BOUND_MS, signalZero: () => false });
    expect(processReadingOf(await readWorkerReadings(worktree, [], stray), false).state).toBe('ended');
  });

  it('reads Worker bound only where a held token needs it', async () => {
    const { worktree, manifestDir } = deskWith({});
    const asked: number[] = [];
    const io = ioOf(manifestDir, released, { workerBoundMs: async () => (asked.push(1), BOUND_MS) });
    await readWorkerReadings(worktree, [], io);
    expect(asked).toEqual([]);
    await readWorkerReadings(worktree, [], { ...io, token: () => held });
    expect(asked).toEqual([]);
    await readWorkerReadings(worktree, [], { ...io, token: () => held, signalZero: () => false });
    expect(asked).toEqual([1]);
    const noBound = { ...io, token: () => held, workerBoundMs: undefined, signalZero: () => false };
    expect((await readWorkerReadings(worktree, [], noBound)).readings.liveness).toBe('stray-holder');
  });

  it('takes the start-time path for a desk with no token', async () => {
    const { worktree, manifestDir } = deskWith({});
    const io = ioOf(manifestDir, { state: 'none', madeAtMs: null }, { startedAt: async () => null });
    const gathered = await readWorkerReadings(worktree, [row(41, 1, 'sh')], io);
    expect(gathered.basis).toBe('start-time');
    expect(gathered.readings.liveness).toBe('live');
    const unset = { ...io, token: undefined };
    expect((await readWorkerReadings(worktree, [row(41, 1, 'sh')], unset)).basis).toBe('start-time');
  });

  it('carries a walk that found the agent while the token and the pass record stay, and walks again on a change of either', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.wrapper.pid': '40', [PASS_FILE]: '1' });
    touch(join(worktree, PASS_FILE), NOW - 60_000);
    const { reads, table } = countedTable([row(41, 1, 'node'), row(42, 41, 'claude')]);
    const io = ioOf(manifestDir, held);

    expect((await readWorkerReadings(worktree, table, io)).readings.liveness).toBe('live');
    expect((await readWorkerReadings(worktree, table, io)).readings.liveness).toBe('live');
    expect(reads.n).toBe(1);

    touch(join(worktree, PASS_FILE), NOW - 30_000);
    await readWorkerReadings(worktree, table, io);
    expect(reads.n).toBe(2);
    await readWorkerReadings(worktree, table, io);
    expect(reads.n).toBe(2);

    const newToken = { ...io, token: () => ({ state: 'held' as const, madeAtMs: TOKEN_MS + 1 }) };
    await readWorkerReadings(worktree, table, newToken);
    expect(reads.n).toBe(3);
  });

  it('walks again on every read while the desk reads orphaned, and after a harness that ended mid-pass', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.wrapper.pid': '40', [PASS_FILE]: '1' });
    touch(join(worktree, PASS_FILE), NOW - 60_000);
    const rows = { value: [row(41, 1, 'node'), row(42, 41, 'claude')] };
    const reads = { n: 0 };
    const table = async () => (reads.n += 1, rows.value);
    const io = ioOf(manifestDir, held);
    expect((await readWorkerReadings(worktree, table, io)).readings.liveness).toBe('live');

    // The harness ends; the loop rewrites its pass record when the prompt returns.
    rows.value = [row(41, 1, 'node')];
    touch(join(worktree, PASS_FILE), NOW - 10_000);
    expect((await readWorkerReadings(worktree, table, io)).readings.liveness).toBe('orphaned');
    expect((await readWorkerReadings(worktree, table, io)).readings.liveness).toBe('orphaned');
    expect(reads.n).toBe(3);
  });

  it('walks again after an unaskable walk', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.wrapper.pid': '40' });
    const empty = countedTable([]);
    const io = ioOf(manifestDir, held);
    expect((await readWorkerReadings(worktree, empty.table, io)).readings.liveness).toBe('live');
    await readWorkerReadings(worktree, empty.table, io);
    expect(empty.reads.n).toBe(2);
  });

  it('reads a held token whose pid answers as running long past Worker bound', async () => {
    const { worktree, manifestDir } = deskWith({});
    const io = ioOf(manifestDir, held, { now: () => startedMs + 3 * BOUND_MS, workerBoundMs: async () => { throw new Error('a live pid reads no bound'); } });
    const gathered = await readWorkerReadings(worktree, [], io);
    expect(gathered.readings.liveness).toBe('live');
    expect(processReadingOf(gathered, false).state).toBe('running');
  });
});

describe('recordTokenRelease', () => {
  it('writes one desk log line and one finding per token, naming the cause', () => {
    const { worktree } = deskWith({});
    expect(recordTokenRelease(worktree, 'feature/x', TOKEN_MS, NOW)).toBe(true);
    expect(recordTokenRelease(worktree, 'feature/x', TOKEN_MS, NOW + 5_000)).toBe(false);
    const lines = readFileSync(join(worktree, '.plot-worker.monitor.agent.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      monitor: 'WorkerMonitor',
      branch: 'feature/x',
      worktree,
      finding: 'gone',
      evidence: `${RELEASED_WITH_NO_EXIT} (token made 2026-11-09T08:00:01Z)`,
    });
    expect(readFileSync(join(worktree, '.plot-worker.log'), 'utf8')).toContain(RELEASED_WITH_NO_EXIT);
    expect(recordTokenRelease(join(worktree, 'gone'), '', TOKEN_MS, NOW)).toBe(false);
  });
});
