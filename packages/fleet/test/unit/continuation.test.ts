// `composeContinuation` — what it writes for a marker-driven reply versus a
// fresh start that never had a question to answer.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('continueOnDesk clears the main-checkout-writer marker for the spawn', () => {
  const desks: string[] = [];
  afterEach(() => {
    for (const desk of desks.splice(0)) rmSync(desk, { recursive: true, force: true });
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
    for (const desk of desks.splice(0)) rmSync(desk, { recursive: true, force: true });
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
      answer: 'the answer',
      fresh: true,
      readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'sleep 5' : fallback),
    });

    expect(result.kind).toBe('started');
    const pid = Number(readFileSync(join(worktree, '.plot-worker.pid'), 'utf8'));
    workers.push(pid);
    const startedAt = readFileSync(join(worktree, '.plot-worker.pid.startedAt'), 'utf8');
    expect(startedAt).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \d{4}$/);
    // The sidecar names this pid's own start: the one `ps` reports for it now.
    const live = Date.parse(
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(),
    );
    expect(Math.abs(Date.parse(startedAt) - live)).toBeLessThan(1000);
  });
});

describe('continueOnDesk — the question key and the answer record', () => {
  const desks: string[] = [];
  const homes: string[] = [];
  const manifestDirs: string[] = [];

  afterEach(() => {
    for (const desk of desks.splice(0)) rmSync(desk, { recursive: true, force: true });
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
    for (const dir of manifestDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
