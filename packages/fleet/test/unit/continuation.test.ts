// `composeContinuation` — what it writes for a marker-driven reply versus a
// fresh start that never had a question to answer.
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync, spawn, type ChildProcess, type spawn as SpawnFn } from 'node:child_process';
import { describe, expect, it, afterEach } from 'vitest';
import { composeContinuation, continueOnDesk, reporterShell } from '../../src/shared/continuation.js';
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

// ---------------------------------------------------------------------------
// reporterShell — the reporter waits on a held descriptor and starts nothing.
//
// Each test spawns the script alone, with a PATH of logging shims for every
// external the reporter could call. The agent blocks on a FIFO the test holds
// (`read` is a builtin), so the shim log holds only what the script itself
// starts.
// ---------------------------------------------------------------------------

const SCRIPT_DIR = fileURLToPath(new URL('../../../../skills/plot/scripts', import.meta.url));
const SHIMMED = ['sleep', 'cat', 'tr', 'date', 'kill', 'mkfifo', 'rm', 'ps', 'dirname'];
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const realPath = (name: string): string => execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim();

interface Rig {
  root: string;
  wt: string;
  log: string;
  hold: string;
  holdFd: number;
  exitFile: string;
  pidFile: string;
  finding: string;
  fifo: string;
  pgid: number;
  agent: () => number;
  release: () => void;
  start: (cmd: string, extra?: Record<string, string>) => Promise<void>;
  lines: () => string[];
  findings: () => string[];
  waitFor: (ok: () => boolean, ms?: number) => Promise<boolean>;
  dispose: () => void;
}

const reporterRig = (delay?: { name: string; seconds: number }): Rig => {
  const root = mkdtempSync(join(tmpdir(), 'plot-reporter-'));
  const wt = join(root, 'wt');
  const shims = join(root, 'shims');
  mkdirSync(wt);
  mkdirSync(shims);
  const log = join(root, 'shim.log');
  writeFileSync(log, '');
  for (const name of SHIMMED) {
    if (name === 'kill') continue; // a shell builtin, so a shim is never reached
    const real = realPath(name);
    const pause = delay?.name === name ? `${realPath('sleep')} ${delay.seconds}; ` : '';
    writeFileSync(join(shims, name), `#!/bin/sh\necho ${name} >> '${log}'\n${pause}exec ${real} "$@"\n`, { mode: 0o755 });
  }
  const hold = join(root, 'hold.fifo');
  execFileSync('/usr/bin/mkfifo', [hold]);
  const holdFd = openSync(hold, 'r+');
  const rig: Rig = {
    root,
    wt,
    log,
    hold,
    holdFd,
    exitFile: join(wt, '.plot-worker.exit'),
    pidFile: join(wt, '.plot-worker.pid'),
    finding: join(wt, '.plot-worker.monitor.worker.jsonl'),
    fifo: join(wt, '.plot-worker.reporter.fifo'),
    pgid: 0,
    agent: () => Number(readFileSync(rig.pidFile, 'utf8')),
    release: () => {
      try {
        writeSync(holdFd, 'go\n');
      } catch {
        /* closed */
      }
    },
    lines: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    findings: () => (existsSync(rig.finding) ? readFileSync(rig.finding, 'utf8').split('\n').filter(Boolean) : []),
    waitFor: async (ok, ms = 10_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (ok()) return true;
        await sleepMs(20);
      }
      return ok();
    },
    start: async (cmd, extra = {}) => {
      const child: ChildProcess = spawn('sh', ['-c', reporterShell(cmd)], {
        cwd: wt,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PATH: `${shims}:${process.env.PATH ?? ''}`,
          PLOT_BRANCH: 'bug/x',
          PLOT_WORKTREE: wt,
          PLOT_EXIT_FILE: rig.exitFile,
          PLOT_PID_FILE: rig.pidFile,
          PLOT_MANIFEST_FILE: '',
          PLOT_SCRIPT_DIR: SCRIPT_DIR,
          HOLD: hold,
          ...extra,
        },
      });
      rig.pgid = child.pid ?? 0;
      await new Promise((r) => child.once('exit', r)); // waits on its own pid
      await rig.waitFor(() => existsSync(rig.pidFile) && readFileSync(rig.pidFile, 'utf8') !== '');
    },
    dispose: () => {
      rig.release();
      try {
        process.kill(-rig.pgid, 'SIGKILL'); // a blocked reporter must not outlive the test
      } catch {
        /* the group is already gone */
      }
      try {
        closeSync(holdFd);
      } catch {
        /* closed */
      }
      removeTree(root);
    },
  };
  return rig;
};

const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

const aliveByPid = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('reporterShell — the reporter waits on a held descriptor', () => {
  const rigs: Rig[] = [];
  const track = (r: Rig): Rig => (rigs.push(r), r);
  afterEach(() => {
    while (rigs.length > 0) rigs.pop()?.dispose();
  });

  const WAIT = 'read x < "$HOLD"';

  it('starts nothing while the agent runs, and the same tail after a 1 s and a 3 s agent', async () => {
    const tails: string[][] = [];
    for (const seconds of [1, 3]) {
      const rig = track(reporterRig());
      await rig.start(WAIT);
      const baseline = rig.lines().length;
      await sleepMs(seconds * 1000);
      expect(rig.lines().length).toBe(baseline);
      rig.release();
      expect(await rig.waitFor(() => rig.findings().length === 1)).toBe(true);
      await rig.waitFor(() => !groupAlive(rig.pgid));
      tails.push(rig.lines().slice(baseline));
    }
    expect(tails[0]).toEqual(tails[1]);
    expect(tails[0]?.length).toBeGreaterThan(0);
  }, 30_000);

  it('holds no sleep and no absolute path between the open and the tail', () => {
    const script = reporterShell(WAIT);
    const open = script.indexOf('{ exec 3>&-;');
    const tail = script.indexOf('[ -f "$PLOT_EXIT_FILE" ] || printf', open);
    expect(open).toBeGreaterThan(-1);
    expect(tail).toBeGreaterThan(open);
    const between = script.slice(open, tail);
    expect(between).not.toMatch(/sleep/);
    expect(between).not.toMatch(/\s\/[a-z]/);
  });

  it('reports a natural exit once', async () => {
    const rig = track(reporterRig());
    await rig.start(`${WAIT}; exit 0`);
    rig.release();
    expect(await rig.waitFor(() => rig.findings().length === 1)).toBe(true);
    expect(readFileSync(rig.exitFile, 'utf8')).toBe('0');
    expect(rig.findings()[0]).toContain('"finding":"clear"');
  });

  it('reports a failing exit once', async () => {
    const rig = track(reporterRig());
    await rig.start(`${WAIT}; exit 3`);
    rig.release();
    expect(await rig.waitFor(() => rig.findings().length === 1)).toBe(true);
    expect(readFileSync(rig.exitFile, 'utf8')).toBe('3');
    expect(rig.findings()[0]).toContain('"finding":"gone"');
  });

  it('has the exit file written when kill -0 on the recorded pid first fails', async () => {
    const rig = track(reporterRig({ name: 'cat', seconds: 1 }));
    await rig.start(`${WAIT}; exit 3`);
    const pid = rig.agent();
    rig.release();
    expect(await rig.waitFor(() => !aliveByPid(pid))).toBe(true);
    expect(readFileSync(rig.exitFile, 'utf8')).toBe('3');
  });

  it('reports a SIGKILL while the command lives (20 runs)', async () => {
    for (let i = 0; i < 20; i += 1) {
      const rig = track(reporterRig());
      const cmdPid = join(rig.root, 'cmd.pid');
      await rig.start(`sh -c 'echo $$ > "${cmdPid}"; read x < "$HOLD"'`);
      await rig.waitFor(() => existsSync(cmdPid) && readFileSync(cmdPid, 'utf8').trim() !== '');
      const cmd = Number(readFileSync(cmdPid, 'utf8'));
      process.kill(rig.agent(), 'SIGKILL');
      expect(await rig.waitFor(() => rig.findings().length === 1, 5_000)).toBe(true);
      expect(aliveByPid(cmd)).toBe(true);
      expect(readFileSync(rig.exitFile, 'utf8')).toBe('137');
      expect(rig.findings()[0]).toContain('"finding":"gone"');
      rig.release();
      await rig.waitFor(() => !groupAlive(rig.pgid));
      expect(groupAlive(rig.pgid)).toBe(false);
      expect(existsSync(rig.fifo)).toBe(false);
      rigs.pop()?.dispose();
    }
  }, 120_000);

  it('does not let a command\'s descendant delay the finding', async () => {
    const rig = track(reporterRig());
    const gc = join(rig.root, 'gc.pid');
    await rig.start(`sh -c 'sleep 30 & echo $! > "${gc}"'`);
    expect(await rig.waitFor(() => rig.findings().length === 1, 5_000)).toBe(true);
    const grandchild = Number(readFileSync(gc, 'utf8'));
    expect(aliveByPid(grandchild)).toBe(true);
    process.kill(grandchild, 'SIGKILL');
  });

  it('reports an agent that ends before the reporter opens its read end', async () => {
    const rig = track(reporterRig({ name: 'mkfifo', seconds: 0 }));
    await rig.start(':');
    expect(await rig.waitFor(() => rig.findings().length === 1, 5_000)).toBe(true);
    expect(await rig.waitFor(() => !groupAlive(rig.pgid), 5_000)).toBe(true);
    expect(existsSync(rig.fifo)).toBe(false);
  });

  it('survives a group SIGTERM and reports 143 (20 runs)', async () => {
    for (let i = 0; i < 20; i += 1) {
      const rig = track(reporterRig());
      const ready = join(rig.root, 'ready');
      await rig.start(`: > "${ready}"; ${WAIT}`);
      await rig.waitFor(() => existsSync(ready));
      process.kill(-rig.pgid, 'SIGTERM');
      expect(await rig.waitFor(() => rig.findings().length === 1, 5_000)).toBe(true);
      expect(readFileSync(rig.exitFile, 'utf8')).toBe('143');
      expect(rig.findings()[0]).toContain('"finding":"gone"');
      await rig.waitFor(() => !groupAlive(rig.pgid));
      expect(existsSync(rig.fifo)).toBe(false);
      rigs.pop()?.dispose();
    }
  }, 120_000);

  it('falls back to a poll when the FIFO cannot be made', async () => {
    const rig = track(reporterRig());
    mkdirSync(rig.fifo); // a directory at the path: mkfifo refuses
    const runs = join(rig.root, 'runs');
    await rig.start(`echo x >> "${runs}"; sh -c 'echo $$ > "${rig.root}/cmd.pid"; read x < "$HOLD"'`);
    await rig.waitFor(() => existsSync(join(rig.root, 'cmd.pid')));
    expect(readFileSync(runs, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
    process.kill(rig.agent(), 'SIGKILL');
    expect(await rig.waitFor(() => rig.findings().length === 1, 10_000)).toBe(true);
    expect(readFileSync(rig.exitFile, 'utf8')).toBe('137');
    expect(existsSync(rig.fifo)).toBe(true); // the directory is not ours to remove
    rig.release();
  }, 30_000);

  it('still reports when the script dir is missing', async () => {
    const rig = track(reporterRig());
    await rig.start(`${WAIT}; exit 3`, { PLOT_SCRIPT_DIR: '/nonexistent' });
    rig.release();
    expect(await rig.waitFor(() => rig.findings().length === 1)).toBe(true);
    expect(readFileSync(rig.exitFile, 'utf8')).toBe('3');
    await rig.waitFor(() => !groupAlive(rig.pgid));
    expect(existsSync(rig.fifo)).toBe(false);
  });
});
