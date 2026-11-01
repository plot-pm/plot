// `composeContinuation` — what it writes for a marker-driven reply versus a
// fresh start that never had a question to answer.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync, type spawn as SpawnFn } from 'node:child_process';
import { describe, expect, it, afterEach } from 'vitest';
import { composeContinuation, continueOnDesk } from '../../src/shared/continuation.js';
import { markerReading } from '../../src/shared/worker-question.js';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { MAIN_CHECKOUT_WRITER_ENV } from '@plot-pm/domain/rules/main-checkout-write';
import { answerRecordFile, ANSWER_RECORD_HOME_ENV } from '@plot-pm/domain/adapters';
import { isAnswered } from '@plot-pm/domain';
import { removeTree } from '../rm-tree.mjs';

/**
 * Removes every recorded directory, then rethrows the first failure.
 *
 * @param dirs directories a test recorded; the caller empties its own list.
 * @param remove the removal to run on each; `removeTree` unless a test injects a failing one.
 * @throws the first error `remove` raised, after every directory had its attempt.
 */
const removeAll = (dirs: readonly string[], remove: (dir: string) => void = removeTree): void => {
  const failures: unknown[] = [];
  for (const dir of dirs) {
    try {
      remove(dir);
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) throw failures[0];
};

/**
 * Waits until a desk holds its WorkerMonitor line, the reporter's last write.
 *
 * @param desk the desk the reporter appends to.
 * @param boundMs how long to wait before failing.
 * @returns the lines the reporter wrote.
 * @throws when no line appears within `boundMs`, naming the desk and the bound.
 */
const monitorLines = async (desk: string, boundMs = 10_000): Promise<string[]> => {
  const file = join(desk, '.plot-worker.monitor.worker.jsonl');
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
      if (lines.length > 0) return lines;
    }
    if (Date.now() >= deadline) throw new Error(`no WorkerMonitor line in ${file} within ${boundMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const base = {
  branch: 'infra/x',
  briefPath: '.plot/briefs/infra-x.md',
  briefText: '# Brief',
  answer: 'use the shell adapter',
  landed: [] as string[],
};

describe('composeContinuation — a marker-driven reply', () => {
  it('names the previous question and tells the worker to clear the marker', () => {
    const prompt = composeContinuation({ ...base, question: 'which adapter?' });
    expect(prompt).toContain('stopped to ask a question');
    expect(prompt).toContain('## The question that stopped the previous run');
    expect(prompt).toContain('which adapter?');
    expect(prompt).toContain('blocked marker that stopped the previous run is still in this tree');
  });
});

describe('composeContinuation — a fresh start with no marker', () => {
  it('describes neither a question nor a marker to clear', () => {
    const prompt = composeContinuation({ ...base, question: '' });
    expect(prompt).not.toContain('stopped to ask a question');
    expect(prompt).not.toContain('blocked marker that stopped the previous run is still in this tree');
    expect(prompt).not.toContain('## The question that stopped the previous run');
  });

  it('still carries the answer and the brief', () => {
    const prompt = composeContinuation({ ...base, question: '' });
    expect(prompt).toContain('## The answer');
    expect(prompt).toContain('use the shell adapter');
    expect(prompt).toContain('# Brief');
  });
});

describe('continueOnDesk refuses an unattended caller before any read', () => {
  it('refuses "unattended" against a worktree that would otherwise fail a later check', async () => {
    const result = await continueOnDesk({
      opts: { repoRoot: '/does/not/exist', scriptsDir: '/s' },
      branch: 'feature/x',
      worktree: '/does/not/exist/either',
      main: '',
      previousPid: '',
      caller: 'unattended',
      answer: 'the answer',
    });

    expect(result).toEqual({
      kind: 'refused',
      status: 409,
      reason: 'unattended',
      detail: 'an unattended caller does not continue feature/x. Continuing answers a question, and this one had no one to ask it.',
    });
  });
});

describe('continueOnDesk accepts a fleetd caller', () => {
  const desks: string[] = [];
  afterEach(() => {
    removeAll(desks.splice(0));
  });

  it('proceeds past the refusal "unattended" would hit', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-fleetd-'));
    desks.push(worktree);
    const repoRoot = mkdtempSync(join(tmpdir(), 'plot-continue-fleetd-repo-'));
    desks.push(repoRoot);
    writeFileSync(
      join(worktree, ENDING_FILENAME),
      JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment: '' }),
      'utf8',
    );

    let spawned = 0;
    const fakeSpawn = (() => {
      spawned += 1;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    }) as typeof SpawnFn;

    const result = await continueOnDesk({
      opts: { repoRoot, scriptsDir: '/s' },
      branch: 'feature/x',
      worktree,
      main: '',
      previousPid: '',
      caller: 'fleetd',
      answer: 'the answer',
      fresh: true,
      readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
      spawn: fakeSpawn,
    });

    expect(result.kind).toBe('started');
    expect(spawned).toBe(1);
    // `continueOnDesk` writes the continue prompt and the log itself; only a spawned process writes these.
    expect(readdirSync(worktree).filter((f) => /^\.plot-worker\.(pid|exit|monitor)/.test(f))).toEqual([]);
  });
});

describe('continueOnDesk clears the main-checkout-writer marker for the spawn', () => {
  const desks: string[] = [];
  afterEach(() => {
    removeAll(desks.splice(0));
  });

  it('spawns with no PLOT_MAIN_CHECKOUT_WRITER=1 even though the parent process carries it', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-env-'));
    desks.push(worktree);
    const repoRoot = mkdtempSync(join(tmpdir(), 'plot-continue-repo-'));
    desks.push(repoRoot);
    writeFileSync(
      join(worktree, ENDING_FILENAME),
      JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment: '' }),
      'utf8',
    );

    const previousWriter = process.env[MAIN_CHECKOUT_WRITER_ENV];
    process.env[MAIN_CHECKOUT_WRITER_ENV] = '1';

    const spawnCalls: { env: Readonly<Record<string, string | undefined>> }[] = [];
    const fakeSpawn = ((_cmd: string, _args: readonly string[], opts: { env: Readonly<Record<string, string | undefined>> }) => {
      spawnCalls.push({ env: opts.env });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    }) as typeof SpawnFn;

    try {
      await continueOnDesk({
        opts: { repoRoot, scriptsDir: '/s' },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        caller: 'person',
        answer: 'the answer',
        fresh: true,
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
    } finally {
      if (previousWriter === undefined) delete process.env[MAIN_CHECKOUT_WRITER_ENV];
      else process.env[MAIN_CHECKOUT_WRITER_ENV] = previousWriter;
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.env[MAIN_CHECKOUT_WRITER_ENV]).not.toBe('1');
  });
});

// A REAL SPAWN, not the fake used above: the sidecar this test proves is
// written only once `.plot-worker.pid` names a pid the OS can answer `ps
// -o lstart` for, which a fake `EventEmitter` never produces.
describe('continueOnDesk records the spawned pid\'s own start time', () => {
  const desks: string[] = [];
  const workers: number[] = [];
  const reporters: string[] = [];
  const isAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  afterEach(async () => {
    for (const pid of workers.splice(0)) {
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
      for (let i = 0; i < 100 && isAlive(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
    }
    // THE LAST WRITER IS THE REPORTER, not the agent whose death was awaited above.
    const reported = reporters.splice(0);
    const all = desks.splice(0);
    try {
      for (const desk of reported) await monitorLines(desk);
    } finally {
      removeAll(all);
    }
  });

  it('writes .plot-worker.pid.startedAt beside .plot-worker.pid, parseable by Date', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-started-'));
    desks.push(worktree);
    const repoRoot = mkdtempSync(join(tmpdir(), 'plot-continue-started-repo-'));
    desks.push(repoRoot);
    writeFileSync(
      join(worktree, ENDING_FILENAME),
      JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment: '' }),
      'utf8',
    );

    const result = await continueOnDesk({
      opts: { repoRoot, scriptsDir: '/s' },
      branch: 'feature/x',
      worktree,
      main: '',
      previousPid: '',
      caller: 'person',
      answer: 'the answer',
      fresh: true,
      readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'sleep 5' : fallback),
    });

    expect(result.kind).toBe('started');
    const pid = Number(readFileSync(join(worktree, '.plot-worker.pid'), 'utf8'));
    workers.push(pid);
    reporters.push(worktree);
    const startedAt = readFileSync(join(worktree, '.plot-worker.pid.startedAt'), 'utf8');
    expect(startedAt).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \d{4}$/);
    // The sidecar names this pid's own start: the one `ps` reports for it now.
    const live = Date.parse(
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(),
    );
    expect(Math.abs(Date.parse(startedAt) - live)).toBeLessThan(1000);
  });

  it('the reporter writes its WorkerMonitor line after continueOnDesk has returned', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-reporter-'));
    desks.push(worktree);
    const repoRoot = mkdtempSync(join(tmpdir(), 'plot-continue-reporter-repo-'));
    desks.push(repoRoot);
    writeFileSync(
      join(worktree, ENDING_FILENAME),
      JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment: '' }),
      'utf8',
    );

    const result = await continueOnDesk({
      opts: { repoRoot, scriptsDir: '/s' },
      branch: 'feature/x',
      worktree,
      main: '',
      previousPid: '',
      caller: 'person',
      answer: 'the answer',
      fresh: true,
      readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'while [ ! -f go ]; do sleep 0.05; done' : fallback),
    });

    expect(result.kind).toBe('started');
    workers.push(Number(readFileSync(join(worktree, '.plot-worker.pid'), 'utf8')));
    reporters.push(worktree);
    // THE NEGATIVE FIRST: the agent still waits for `go`, so the reporter has written nothing.
    expect(existsSync(join(worktree, '.plot-worker.monitor.worker.jsonl'))).toBe(false);

    writeFileSync(join(worktree, 'go'), '');
    const lines = await monitorLines(worktree);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ monitor: 'WorkerMonitor', finding: 'clear' });
  });
});

describe('continueOnDesk — the question key and the answer record', () => {
  const desks: string[] = [];
  const homes: string[] = [];
  const manifestDirs: string[] = [];

  afterEach(() => {
    removeAll([...desks.splice(0), ...homes.splice(0), ...manifestDirs.splice(0)]);
  });

  const fakeSpawn = (() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  }) as typeof SpawnFn;

  const deskWithMarker = async (question: string): Promise<{ worktree: string; askedAt: string; manifestDir: string }> => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-marker-'));
    desks.push(worktree);
    writeFileSync(join(worktree, 'PLOT-BLOCKED.md'), question);
    // READ BACK THROUGH `markerReading` ITSELF, the same function `continueOnDesk`
    // calls — not a separate `statSync` here, whose own `stat` can round to a
    // different millisecond than the one the production code later reads.
    const reading = await markerReading(worktree);
    const askedAt = reading?.askedAt ?? '';
    const manifestDir = mkdtempSync(join(tmpdir(), 'plot-continue-manifests-'));
    manifestDirs.push(manifestDir);
    writeFileSync(join(manifestDir, 'sess.json'), JSON.stringify({ session: 'sess', branch: 'feature/x', worktree, pid: '424242' }));
    return { worktree, askedAt, manifestDir };
  };

  const recordHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'plot-answer-record-home-'));
    homes.push(home);
    return home;
  };

  it('refuses question-moved and leaves the desk byte-identical when the caller names a stale key', async () => {
    const { worktree } = await deskWithMarker('which adapter?');
    const before = readFileSync(join(worktree, 'PLOT-BLOCKED.md'), 'utf8');
    const home = recordHome();
    process.env[ANSWER_RECORD_HOME_ENV] = home;
    try {
      const result = await continueOnDesk({
        opts: { repoRoot: worktree, scriptsDir: '/s' },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        answer: 'the answer',
        expectedAskedAt: '2020-01-01T00:00:00.000Z',
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
      expect(result).toMatchObject({ kind: 'refused', reason: 'question-moved' });
      // BYTE-IDENTICAL: the refusal makes no write to the desk.
      expect(readFileSync(join(worktree, 'PLOT-BLOCKED.md'), 'utf8')).toBe(before);
      // THE RECORD COUNTS ANSWERS, NOT ATTEMPTS — a refused call writes nothing.
      const rows = await answerRecordFile({ home }).rowsFor(worktree, '2020-01-01T00:00:00.000Z');
      expect(isAnswered(rows) && rows.value).toEqual([]);
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('starts normally when the caller names the current key, and writes one answered row', async () => {
    const { worktree, askedAt, manifestDir } = await deskWithMarker('which adapter?');
    const home = recordHome();
    process.env[ANSWER_RECORD_HOME_ENV] = home;
    try {
      const result = await continueOnDesk({
        opts: { repoRoot: worktree, scriptsDir: '/s', manifestDir },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        answer: 'use the shell adapter',
        author: 'jwloka',
        expectedAskedAt: askedAt,
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
      expect(result.kind).toBe('started');
      const rows = await answerRecordFile({ home }).rowsFor(worktree, askedAt);
      expect(isAnswered(rows) && rows.value).toEqual([
        {
          worktree,
          askedAt,
          question: 'which adapter?',
          answer: 'use the shell adapter',
          author: 'jwloka',
          outcome: 'answered',
        },
      ]);
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('a caller naming no key keeps today\'s behaviour — no refusal, no key comparison', async () => {
    const { worktree, askedAt, manifestDir } = await deskWithMarker('which adapter?');
    const home = recordHome();
    process.env[ANSWER_RECORD_HOME_ENV] = home;
    try {
      const result = await continueOnDesk({
        opts: { repoRoot: worktree, scriptsDir: '/s', manifestDir },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        answer: 'the answer',
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
      expect(result.kind).toBe('started');
      const rows = await answerRecordFile({ home }).rowsFor(worktree, askedAt);
      expect(isAnswered(rows) && rows.value).toHaveLength(1);
      expect(isAnswered(rows) && rows.value[0]?.author).toBe('unblocker');
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('two simultaneous callers produce exactly one started run, and the record names the winner', async () => {
    const { worktree, askedAt, manifestDir } = await deskWithMarker('which adapter?');
    const home = recordHome();
    process.env[ANSWER_RECORD_HOME_ENV] = home;
    try {
      const input = {
        opts: { repoRoot: worktree, scriptsDir: '/s', manifestDir },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        readCfg: (_opts: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      };
      const [first, second] = await Promise.all([
        continueOnDesk({ ...input, answer: 'answer one', author: 'alice' }),
        continueOnDesk({ ...input, answer: 'answer two', author: 'bob' }),
      ]);
      const results = [first, second];
      const started = results.filter((r) => r.kind === 'started');
      const refused = results.filter((r) => r.kind === 'refused');
      expect(started).toHaveLength(1);
      expect(refused).toHaveLength(1);
      const rows = await answerRecordFile({ home }).rowsFor(worktree, askedAt);
      expect(isAnswered(rows) && rows.value).toHaveLength(1);
      // The record names the winner's own answer, never a trace of the loser's.
      const row = isAnswered(rows) ? rows.value[0] : undefined;
      expect(['answer one', 'answer two']).toContain(row?.answer);
      expect(['alice', 'bob']).toContain(row?.author);
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });
});

describe('removeAll — a failed removal does not leak its siblings', () => {
  it('removes the second directory and throws the first error', () => {
    const first = mkdtempSync(join(tmpdir(), 'plot-continue-removeall-a-'));
    const second = mkdtempSync(join(tmpdir(), 'plot-continue-removeall-b-'));
    const boom = new Error('first removal failed');
    try {
      expect(() =>
        removeAll([first, second], (dir) => {
          if (dir === first) throw boom;
          removeTree(dir);
        }),
      ).toThrow(boom);
      expect(existsSync(second)).toBe(false);
    } finally {
      removeTree(first);
      removeTree(second);
    }
  });
});
