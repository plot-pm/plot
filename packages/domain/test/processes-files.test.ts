import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { ProcessRunner } from '../src/adapters/git-dirs/git-dirs.js';
import { processesFiles, readWorkerReadings, type DeskFilesIo } from '../src/adapters/processes/processes-files.js';
import { parseTable, processesTable, TABLE_ARGS } from '../src/adapters/processes/processes-table.js';
import { answered, failed } from '../src/port-result.js';
import type { ProcessRow } from '../src/rules/pid-current.js';

const made = mkdtempSync(join(tmpdir(), 'plot-processes-files-'));
afterAll(() => rmSync(made, { recursive: true, force: true }));

const START = 'Mon Nov  9 08:42:51 2026';
const startMs = new Date(2026, 10, 9, 8, 42, 51).getTime();
const NOW = startMs + 3_600_000;

let count = 0;
/** A desk directory holding the given files, and a registry directory holding the given manifest. */
const deskWith = (files: Record<string, string>, manifest?: Record<string, string>): { worktree: string; manifestDir: string } => {
  count += 1;
  const worktree = join(made, `desk-${count}`);
  const manifestDir = join(made, `agents-${count}`);
  mkdirSync(worktree, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(worktree, file), text);
  if (manifest !== undefined) writeFileSync(join(manifestDir, 'a.json'), JSON.stringify({ worktree, ...manifest }, null, 2));
  return { worktree, manifestDir };
};

const row = (pid: number, ppid: number, comm: string, startedAt: number | null = startMs): ProcessRow => ({ pid, ppid, startedAt, cpuCentis: 0, comm });

const ioOf = (manifestDir: string, over: Partial<DeskFilesIo> = {}): DeskFilesIo => ({
  manifestDir,
  signalZero: () => true,
  startedAt: async () => null,
  dirty: async () => true,
  ahead: async () => '2',
  now: () => NOW,
  graceSeconds: 30,
  agentProcess: 'claude',
  ...over,
});

describe('parseTable', () => {
  it('reads pid, ppid, start, CPU time and the executable, and skips other lines', () => {
    const rows = parseTable(`  41     1 ${START}      1:02.50 /usr/local/bin/claude code\nheader\n`);
    expect(rows).toEqual([{ pid: 41, ppid: 1, startedAt: startMs, cpuCentis: 6250, comm: '/usr/local/bin/claude code' }]);
  });
});

describe('processesTable', () => {
  it('reads the table with one ps under LC_ALL=C, and answers the exit code of a failed ps', async () => {
    const calls: Array<[string, readonly string[], unknown]> = [];
    const run: ProcessRunner = async (command, args, options) => {
      calls.push([command, args, options?.env]);
      return { code: 1, stdout: '', stderr: '' };
    };
    expect(await processesTable(run).read()).toEqual({ ok: false, code: 1 });
    expect(await processesTable(run).startedAt(41)).toBeNull();
    expect(calls).toEqual([
      ['ps', [...TABLE_ARGS], { LC_ALL: 'C' }],
      ['ps', ['-o', 'lstart=', '-p', '41'], { LC_ALL: 'C' }],
    ]);
  });

  it('reads one pid\'s start', async () => {
    const run: ProcessRunner = async () => ({ code: 0, stdout: `${START}\n`, stderr: '' });
    expect(await processesTable(run).startedAt(41)).toBe(startMs);
  });
});

describe('readWorkerReadings', () => {
  it('reads a missing desk as not here', async () => {
    const gathered = await readWorkerReadings(join(made, 'gone'), [], ioOf(made));
    expect(gathered.readings.worktreeHere).toBe(false);
    expect((await readWorkerReadings('', [], ioOf(made))).readings.worktreeHere).toBe(false);
  });

  it('reads the manifest pid, and its agent process name, logged once per desk', async () => {
    const { worktree, manifestDir } = deskWith(
      { '.plot-worker.wrapper.pid': '41' },
      { pid: '41', startedAt: '2026-11-09T07:00:00Z', pidStartedAt: START, agentProcess: 'codex' },
    );
    const lines: string[] = [];
    const io = ioOf(manifestDir, { log: (line) => lines.push(line) });
    const table = [row(41, 1, 'sh'), row(42, 41, '/bin/codex')];
    const first = await readWorkerReadings(worktree, table, io);
    await readWorkerReadings(worktree, table, io);
    expect(first.readings.liveness).toBe('live');
    expect(first.agentProcess).toBe('codex');
    expect(lines).toEqual([`desk ${worktree}: agent process codex`]);
  });

  it('reads a manifest without agentProcess as claude, and a manifest without startedAt falls back to the pid file', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.pid': ' 43 \n', '.plot-worker.pid.startedAt': `${START}\n` }, { pid: '41' });
    const gathered = await readWorkerReadings(worktree, [row(43, 1, 'sh')], ioOf(manifestDir));
    expect(gathered.agentProcess).toBe('claude');
    expect((await readWorkerReadings(worktree, [], ioOf(manifestDir, { agentProcess: 'sleep' }))).agentProcess).toBe('sleep');
    expect(gathered.pid).toBe('43');
    expect(gathered.readings.startedAtRecorded).toBe(false);
  });

  it('reads a manifest field with no string value as the line sed leaves', async () => {
    const { worktree, manifestDir } = deskWith({}, { startedAt: '2026-11-09T07:00:00Z' });
    writeFileSync(join(manifestDir, 'a.json'), `{\n  "worktree": "${worktree}",\n  "pid": 41,\n  "startedAt": "x"\n}\n`);
    expect((await readWorkerReadings(worktree, [], ioOf(manifestDir))).readings.pidRecorded).toBe(false);
  });

  it('reads no manifest when the registry is unreadable', async () => {
    const { worktree } = deskWith({ '.plot-worker.pid': '41' });
    expect((await readWorkerReadings(worktree, [row(41, 1, 'sh')], ioOf(join(made, 'none')))).pid).toBe('41');
  });

  it('reads a pid the table lacks with one fresh start read, and never stale without one', async () => {
    const { worktree } = deskWith({ '.plot-worker.pid': '41', '.plot-worker.pid.startedAt': START });
    const asked: number[] = [];
    const fresh = await readWorkerReadings(worktree, [], ioOf(made, { startedAt: async (pid) => (asked.push(pid), startMs) }));
    const none = await readWorkerReadings(worktree, [], ioOf(made));
    const reused = await readWorkerReadings(worktree, [], ioOf(made, { startedAt: async () => startMs + 60_000 }));
    expect(asked).toEqual([41]);
    expect([fresh.readings.liveness, none.readings.liveness, reused.readings.liveness]).toEqual(['live', 'live', 'stale']);
  });

  it('reads a pid with an unreadable table start as stale', async () => {
    const { worktree } = deskWith({ '.plot-worker.pid': '41', '.plot-worker.pid.startedAt': START });
    expect((await readWorkerReadings(worktree, [row(41, 1, 'sh', null)], ioOf(made))).readings.liveness).toBe('stale');
  });

  it('reads no desk work for a desk with no pid recorded, unless asked to always read it', async () => {
    const { worktree } = deskWith({});
    let asked = 0;
    const io = ioOf(made, { dirty: async () => (asked++, true), ahead: async () => (asked++, '2') });
    expect((await readWorkerReadings(worktree, [], io)).readings.task).toEqual({ hasPr: false, blocked: false, dirty: false, unpushed: null });
    expect(asked).toBe(0);
    expect((await readWorkerReadings(worktree, [], io, {}, true)).readings.task.dirty).toBe(true);
    expect(asked).toBe(2);
  });

  it('reads an orphaned wrapper and reads its desk work; reads no desk work for a live pid', async () => {
    const { worktree } = deskWith({ '.plot-worker.pid': '41', '.plot-worker.wrapper.pid': '41', 'PLOT-BLOCKED.md': 'q', '.plot-worker.freewait': '41\n' });
    const orphaned = await readWorkerReadings(worktree, [row(41, 1, 'sh')], ioOf(made));
    expect(orphaned.readings.liveness).toBe('orphaned');
    expect(orphaned.readings.task).toEqual({ hasPr: false, blocked: true, dirty: true, unpushed: true });
    expect(orphaned.readings.waitsFree).toBe(true);
    const live = await readWorkerReadings(worktree, [row(41, 1, 'sh'), row(42, 41, 'claude')], ioOf(made));
    expect(live.readings.task).toEqual({ hasPr: false, blocked: true, dirty: false, unpushed: null });
  });

  it('takes the pass\'s own dirt and an all-pushed reading instead of reading them', async () => {
    const { worktree } = deskWith({ '.plot-worker.pid': '41', '.plot-worker.exit': ' 0\n' });
    const gathered = await readWorkerReadings(worktree, [], ioOf(made, { signalZero: () => false }), { dirty: false, allPushed: true });
    expect(gathered.readings.exit).toBe('0');
    expect(gathered.readings.task).toMatchObject({ dirty: false, unpushed: false });
    expect(gathered.ahead).toBe('0');
  });

  it('reads an unanswered upstream count as unanswerable, and a dead pid with no exit file as absent', async () => {
    const { worktree } = deskWith({ '.plot-worker.pid': '0' });
    const gathered = await readWorkerReadings(worktree, [], ioOf(made, { ahead: async () => '' }), {}, true);
    expect(gathered.readings.pidRecorded).toBe(false);
    expect(gathered.readings.exit).toBeNull();
    expect(gathered.readings.task.unpushed).toBeNull();
  });
});

describe('processesFiles', () => {
  const desks = [0, 1, 2].map(() => deskWith({ '.plot-worker.pid': String(process.pid) }).worktree);

  it('reads the process table once for a pass over three desks, and starts no bash', async () => {
    const calls: string[] = [];
    const run: ProcessRunner = async (command, args) => {
      calls.push([command, ...args].join(' '));
      return { code: 0, stdout: `${process.pid} 1 ${START} 0:01.00 node\n`, stderr: '' };
    };
    const files = processesFiles({ repoRoot: made, scriptDir: made }, { run, manifestDir: made, now: () => NOW });
    const states = await Promise.all(desks.map((desk) => files.workerState(desk, false)));
    await files.table();
    expect(states.map((s) => s.ok && s.value.state)).toEqual(['running', 'running', 'running']);
    expect(calls).toEqual([`ps ${TABLE_ARGS.join(' ')}`]);
  });

  it('shares one table reading between instances that share a process runner', async () => {
    const calls: string[] = [];
    const run: ProcessRunner = async (command) => (calls.push(command), { code: 0, stdout: '', stderr: '' });
    const context = { repoRoot: made, scriptDir: made };
    await processesFiles(context, { run, manifestDir: made, now: () => NOW }).table();
    await processesFiles(context, { run, manifestDir: made, now: () => NOW + 1_000 }).table();
    expect(calls).toEqual(['ps']);
  });

  it('reads a fresh table on the next pass', async () => {
    let at = NOW;
    const calls: string[] = [];
    const run: ProcessRunner = async (command) => (calls.push(command), { code: 0, stdout: '', stderr: '' });
    const files = processesFiles({ repoRoot: made, scriptDir: made }, { run, manifestDir: made, now: () => at, tableHoldMs: 4_000 });
    await files.table();
    at += 5_000;
    await files.table();
    expect(calls).toEqual(['ps', 'ps']);
  });

  it('starts no ps for desks whose start-time path needs no table: a live pid with no recorded start and no wrapper', async () => {
    const calls: string[] = [];
    const run: ProcessRunner = async (command) => (calls.push(command), { code: 3, stdout: '', stderr: '' });
    const files = processesFiles({ repoRoot: made, scriptDir: made }, { run, manifestDir: made, now: () => NOW });
    const states = await Promise.all(desks.map((desk) => files.workerState(desk, false)));
    expect(states.map((s) => s.ok && s.value.state)).toEqual(['running', 'running', 'running']);
    expect(calls).toEqual([]);
  });

  it('fails the pass on a failed ps, reads no desk as ended, and logs the exit code once', async () => {
    const lines: string[] = [];
    const run: ProcessRunner = async () => ({ code: 3, stdout: '', stderr: '' });
    const files = processesFiles({ repoRoot: made, scriptDir: made }, { run, manifestDir: made, log: (l) => lines.push(l) });
    const wrapped = [0, 1, 2].map(() => deskWith({ '.plot-worker.pid': String(process.pid), '.plot-worker.wrapper.pid': '1' }).worktree);
    const states = await Promise.all(wrapped.map((desk) => files.workerState(desk, false)));
    expect(states).toEqual([failed(), failed(), failed()]);
    expect(await files.table()).toEqual(failed());
    expect(lines.filter((l) => l.startsWith('process table'))).toEqual(['process table unreadable (ps exit 3)']);
  });

  it('answers none for a missing desk and the code of a failed worker', async () => {
    const { worktree, manifestDir } = deskWith({ '.plot-worker.pid': '41', '.plot-worker.exit': '3' });
    const run: ProcessRunner = async () => ({ code: 0, stdout: '', stderr: '' });
    const files = processesFiles({ repoRoot: made, scriptDir: made }, { run, manifestDir, signalZero: () => false });
    expect(await files.workerState(join(made, 'gone'), false)).toEqual(answered({ state: 'none', pid: '', exitCode: '', activity: '' }));
    expect(await files.workerState(worktree, false)).toEqual(answered({ state: 'failed', pid: '41', exitCode: '3', activity: '', basis: 'start-time' }));
  });
});
