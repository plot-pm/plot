// `composeContinuation` — what it writes for a marker-driven reply versus a
// fresh start that never had a question to answer.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
 * Waits until a desk holds its WorkerMonitor line, one of the wrapper's last writes.
 *
 * @param desk the desk the wrapper appends to.
 * @param boundMs how long to wait before failing.
 * @returns the lines the wrapper wrote.
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

  it('spawns with no PLOT_MAIN_CHECKOUT_WRITER=1 and no PLOT_GIT_COMMON_DIR even though the parent process carries them', async () => {
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
    const previousCommon = process.env['PLOT_GIT_COMMON_DIR'];
    process.env['PLOT_GIT_COMMON_DIR'] = join(repoRoot, '.git');

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
      if (previousCommon === undefined) delete process.env['PLOT_GIT_COMMON_DIR'];
      else process.env['PLOT_GIT_COMMON_DIR'] = previousCommon;
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.env[MAIN_CHECKOUT_WRITER_ENV]).not.toBe('1');
    expect(spawnCalls[0]?.env['PLOT_GIT_COMMON_DIR']).toBe('');
  });
});

// A REAL START through the shipped `plot-worker-start.mjs`, which `pnpm
// build:board` builds: a continue, a restart and a fresh start each run the
// dispatcher's wrapper, `plot-worker-wrapper.mjs`, and read its records.
const STARTER = fileURLToPath(new URL('../../../../skills/plot/scripts/board/plot-worker-start.mjs', import.meta.url));

describe('continueOnDesk starts plot-worker-wrapper.mjs', () => {
  const desks: string[] = [];
  const workers: number[] = [];
  const reported: string[] = [];
  const isAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const ps = (field: string, pid: number): string =>
    execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  const readPid = (desk: string, name: string): number => Number(readFileSync(join(desk, name), 'utf8'));
  afterEach(async () => {
    for (const pid of workers.splice(0)) {
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
      for (let i = 0; i < 100 && isAlive(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
    }
    // THE LAST WRITER IS THE WRAPPER, not the agent whose death was awaited above.
    const all = desks.splice(0);
    try {
      for (const desk of reported.splice(0)) await monitorLines(desk);
    } finally {
      removeAll(all);
    }
  });

  /** A desk whose ending earns a fresh start, and the repository its manifest goes under. */
  const freshDesk = (): { worktree: string; repoRoot: string; manifestDir: string } => {
    const worktree = mkdtempSync(join(tmpdir(), 'plot-continue-wrapper-'));
    desks.push(worktree);
    const repoRoot = mkdtempSync(join(tmpdir(), 'plot-continue-wrapper-repo-'));
    desks.push(repoRoot);
    const manifestDir = mkdtempSync(join(tmpdir(), 'plot-continue-wrapper-manifests-'));
    desks.push(manifestDir);
    writeFileSync(
      join(worktree, ENDING_FILENAME),
      JSON.stringify({ reason: 'holding-work', actor: 'agent', branch: 'feature/x', detail: '', refusedAssignment: '' }),
      'utf8',
    );
    return { worktree, repoRoot, manifestDir };
  };

  const start = (desk: { worktree: string; repoRoot: string; manifestDir: string }, cmd: string, over: Partial<Parameters<typeof continueOnDesk>[0]> = {}) =>
    continueOnDesk({
      opts: { repoRoot: desk.repoRoot, scriptsDir: '/s', workerStart: STARTER, manifestDir: desk.manifestDir } as Parameters<typeof continueOnDesk>[0]['opts'],
      branch: 'feature/x',
      worktree: desk.worktree,
      main: '',
      previousPid: '',
      caller: 'person',
      answer: 'the answer',
      fresh: true,
      readCfg: (_opts, key, fallback) => (key === 'Worker command' ? cmd : fallback),
      ...over,
    });

  const manifestOf = (dir: string): Record<string, unknown> => {
    const [file] = readdirSync(dir).filter((f) => f.endsWith('.json'));
    return JSON.parse(readFileSync(join(dir, file as string), 'utf8')) as Record<string, unknown>;
  };

  it.each([
    ['a fresh start', {}],
    ['a restart', { fresh: false, restart: async () => ({ ok: true as const }) }],
  ])('%s runs the wrapper, which leads the group of itself and its agent', async (_name, over) => {
    const desk = freshDesk();
    const result = await start(desk, 'sleep 30', over);
    expect(result.kind).toBe('started');
    const agent = readPid(desk.worktree, '.plot-worker.pid');
    workers.push(agent);
    reported.push(desk.worktree);
    expect(result.kind === 'started' && result.pid).toBe(String(agent));
    const wrapper = readPid(desk.worktree, '.plot-worker.wrapper.pid');
    expect(ps('command', wrapper)).toMatch(/plot-worker-wrapper\.mjs sleep 30/);
    // `init` adopted the wrapper once the start exited, so no walk from this process reaches it.
    expect(Number(ps('ppid', wrapper))).not.toBe(process.pid);
    expect(Number(ps('pgid', wrapper))).toBe(wrapper);
    expect(Number(ps('pgid', agent))).toBe(wrapper);
    expect(manifestOf(desk.manifestDir)).toMatchObject({ pid: String(agent), wrapperPid: String(wrapper) });
  });

  it('writes .plot-worker.pid.startedAt as the agent\'s own `ps -o lstart=` text', async () => {
    const desk = freshDesk();
    expect((await start(desk, 'sleep 5')).kind).toBe('started');
    const pid = readPid(desk.worktree, '.plot-worker.pid');
    workers.push(pid);
    reported.push(desk.worktree);
    // The text `ps -o lstart=` prints, as the dispatcher's wrapper stores it.
    const startedAt = readFileSync(join(desk.worktree, '.plot-worker.pid.startedAt'), 'utf8').trim();
    expect(startedAt).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/);
    expect(startedAt).toBe(ps('lstart', pid));
  });

  it('the wrapper writes the exit code and its WorkerMonitor line after continueOnDesk has returned', async () => {
    const desk = freshDesk();
    expect((await start(desk, 'while [ ! -f go ]; do sleep 0.05; done')).kind).toBe('started');
    workers.push(readPid(desk.worktree, '.plot-worker.pid'));
    reported.push(desk.worktree);
    // THE NEGATIVE FIRST: the agent still waits for `go`, so the wrapper has written nothing.
    expect(existsSync(join(desk.worktree, '.plot-worker.monitor.worker.jsonl'))).toBe(false);
    writeFileSync(join(desk.worktree, 'go'), '');
    const lines = await monitorLines(desk.worktree);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ monitor: 'WorkerMonitor', finding: 'clear' });
    expect(readFileSync(join(desk.worktree, '.plot-worker.exit'), 'utf8')).toBe('0');
  });

  it('records 137 and a gone line for an agent killed with SIGKILL', async () => {
    const desk = freshDesk();
    expect((await start(desk, 'sleep 30')).kind).toBe('started');
    const agent = readPid(desk.worktree, '.plot-worker.pid');
    process.kill(agent, 'SIGKILL');
    const lines = await monitorLines(desk.worktree);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ finding: 'gone' });
    expect(readFileSync(join(desk.worktree, '.plot-worker.exit'), 'utf8')).toBe('137');
  });

  it('appends the wrapper\'s output to the desk log', async () => {
    const desk = freshDesk();
    writeFileSync(join(desk.worktree, '.plot-worker.log'), 'the previous run\n');
    expect((await start(desk, 'echo the new run')).kind).toBe('started');
    reported.push(desk.worktree);
    await monitorLines(desk.worktree);
    const log = readFileSync(join(desk.worktree, '.plot-worker.log'), 'utf8');
    expect(log.startsWith('the previous run\n')).toBe(true);
    expect(log).toContain('the new run');
  });

  it('answers failed with the start\'s own refusal, and leaves no prompt', async () => {
    const desk = freshDesk();
    const refusing = join(desk.repoRoot, 'refusing-start.mjs');
    writeFileSync(refusing, "process.stderr.write('node on PATH is 24, Plot pins 26\\n'); process.exit(1);\n");
    const result = await start(desk, 'sleep 30', { opts: { repoRoot: desk.repoRoot, scriptsDir: '/s', workerStart: refusing, manifestDir: desk.manifestDir } as Parameters<typeof continueOnDesk>[0]['opts'] });
    expect(result).toEqual({ kind: 'failed', error: 'the worker wrapper did not start (exit 1): node on PATH is 24, Plot pins 26' });
    expect(existsSync(join(desk.worktree, '.plot-worker.pid'))).toBe(false);
    expect(readdirSync(desk.worktree).filter((f) => f === '.plot-worker.continue.md')).toEqual([]);
  });
});

describe('continueOnDesk — the question key and the answer record', () => {
  const desks: string[] = [];
  const homes: string[] = [];
  const manifestDirs: string[] = [];

  afterEach(() => {
    removeAll([...desks.splice(0), ...homes.splice(0), ...manifestDirs.splice(0)]);
  });

  // Writes what the wrapper would: a new agent pid and the stamp naming it.
  const fakeSpawn = ((_cmd: string, _args: readonly string[], o: { cwd: string; env: Record<string, string | undefined> }) => {
    const child = new EventEmitter();
    writeFileSync(join(o.cwd, '.plot-worker.pid'), '424243');
    const manifest = o.env.PLOT_MANIFEST_FILE ?? '';
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), pid: '424243' }));
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  }) as unknown as typeof SpawnFn;

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
      expect(isAnswered(rows) && rows.value[0]?.author).toBe('unknown');
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('a continue with no author writes author=unknown, not unblocker', async () => {
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
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
      expect(result.kind).toBe('started');
      const rows = await answerRecordFile({ home }).rowsFor(worktree, askedAt);
      expect(isAnswered(rows) && rows.value[0]?.author).toBe('unknown');
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('starts but appends nothing for a second continue on an answered key', async () => {
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
      const first = await continueOnDesk({ ...input, answer: 'use the shell adapter', author: 'jwloka' });
      expect(first.kind).toBe('started');
      // THE START IS NOT REFUSED. A marker the first agent never deleted keeps
      // this key answered for as long as the file sits there, so a refusal
      // would leave the desk waiting on a person with no route to continue it.
      const second = await continueOnDesk({ ...input, answer: 'a second answer', author: 'eins78' });
      expect(second.kind).toBe('started');
      expect(second.kind === 'started' && second.warning).toMatch(/already holds an answered row/);
      const rows = await answerRecordFile({ home }).rowsFor(worktree, askedAt);
      expect(isAnswered(rows) && rows.value).toHaveLength(1);
      expect(isAnswered(rows) && rows.value[0]?.author).toBe('jwloka');
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('restarts an answered key whose agent left the marker behind', async () => {
    // THE DEADLOCK THIS GUARD MUST NOT CAUSE. `continueOnDesk` never deletes
    // `PLOT-BLOCKED`; the agent it starts does. An agent that ends first
    // (`turn-limit`, a crash, a kill) leaves the marker, and `askedAt` is that
    // file's mtime, so the key stays answered for as long as the file sits
    // there. fleetd's own recovery start must still run, or the desk shows as
    // waiting on a person who can only continue it by editing the marker.
    const { worktree, askedAt, manifestDir } = await deskWithMarker('which adapter?');
    const home = recordHome();
    process.env[ANSWER_RECORD_HOME_ENV] = home;
    try {
      const appended = await answerRecordFile({ home }).append({
        worktree,
        askedAt,
        question: 'which adapter?',
        answer: 'use the shell adapter',
        author: 'jwloka',
        outcome: 'answered',
      });
      expect(isAnswered(appended)).toBe(true);

      const restarted = await continueOnDesk({
        opts: { repoRoot: worktree, scriptsDir: '/s', manifestDir },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        caller: 'fleetd',
        answer: 'use the shell adapter',
        fresh: true,
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });

      expect(restarted.kind).toBe('started');
      // And the record still holds exactly the one row the answer earned.
      const rows = await answerRecordFile({ home }).rowsFor(worktree, askedAt);
      expect(isAnswered(rows) && rows.value).toHaveLength(1);
    } finally {
      delete process.env[ANSWER_RECORD_HOME_ENV];
    }
  });

  it('a started row with no following answered does not block a retry', async () => {
    const { worktree, askedAt, manifestDir } = await deskWithMarker('which adapter?');
    const home = recordHome();
    process.env[ANSWER_RECORD_HOME_ENV] = home;
    try {
      const appended = await answerRecordFile({ home }).append({
        worktree,
        askedAt,
        question: 'which adapter?',
        answer: 'an earlier, abandoned attempt',
        author: 'jwloka',
        outcome: 'started',
      });
      expect(isAnswered(appended)).toBe(true);
      const result = await continueOnDesk({
        opts: { repoRoot: worktree, scriptsDir: '/s', manifestDir },
        branch: 'feature/x',
        worktree,
        main: '',
        previousPid: '',
        answer: 'use the shell adapter',
        author: 'eins78',
        readCfg: (_opts, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
        spawn: fakeSpawn,
      });
      expect(result.kind).toBe('started');
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
