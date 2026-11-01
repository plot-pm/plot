// THE GROUP-STOP TEST (#1084) — `boundedRun` must leave its child in the
// CALLER'S process group, so an external `kill -TERM -<pgid>` (what
// `plot-dispatch.sh --stop` sends) reaches the prompt and everything it
// spawned. A `boundedRun` that used `detached: true` would put the prompt in
// its OWN group and this test would fail: that is the whole point of it.
//
// THE STAND-IN LEADS ITS OWN GROUP, matching `start_worker`'s `set -m`: the
// wrapper here is spawned `detached: true` BY THE TEST, which is what makes it
// the group leader every descendant below it inherits. `boundedRunProcess`
// itself spawns the prompt WITHOUT `detached`, so the prompt joins that same
// group — never its own.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STANDIN = path.join(HERE, 'fixtures/bounded-run-group-standin.mjs');
const LOADER = path.join(HERE, 'fixtures/ts-strip-loader.mjs');

/** How long the stand-in may take to report `READY`. */
const READINESS_BOUND_MS = 10_000;

/** How long the wrapper, the prompt and the grandchild may take to end after the stop. A bound that expires fails the test. */
const GROUP_STOP_BOUND_MS = 5_000;

/** A second window, entered only after `GROUP_STOP_BOUND_MS` expired with no `exit` event. It improves the message and never turns a failure into a pass. */
const LATE_EXIT_GRACE_MS = 5_000;

/** Headroom so the test's own message fires before vitest's timeout. */
const TEST_HEADROOM_MS = 5_000;

/** Readiness bound, both stop windows and the headroom: the longest honest run of one case. */
const TEST_TIMEOUT_MS = READINESS_BOUND_MS + GROUP_STOP_BOUND_MS + LATE_EXIT_GRACE_MS + TEST_HEADROOM_MS;

/** How long the bound-fires case waits for the prompt and the grandchild to end after its own 4 s bound. */
const BOUND_FIRES_WAIT_MS = 10_000;

/** What a child's `exit` event reported. */
type ExitReading = { readonly code: number | null; readonly signal: string | null };

/** A child's `exit`, observed from the moment of spawn. */
type TrackedExit = {
  readonly child: ChildProcess;
  readonly promise: Promise<ExitReading>;
  settled: ExitReading | undefined;
  exitedAt: number | undefined;
};

/** Listens for `child`'s `exit` event from now on, so no wait can miss it. */
const trackExit = (child: ChildProcess): TrackedExit => {
  const tracked: TrackedExit = {
    child,
    settled: undefined,
    exitedAt: undefined,
    promise: new Promise<ExitReading>((resolve) => {
      child.once('exit', (code, signal) => {
        tracked.settled = { code, signal };
        tracked.exitedAt = Date.now();
        resolve(tracked.settled);
      });
    }),
  };
  return tracked;
};

/**
 * Spawns the stand-in with the flags its own `.ts` imports need: type
 * stripping for the real adapter source, and the resolver hook that maps a
 * `.js` specifier to its sibling `.ts` file where no `.js` exists.
 *
 * @param args - the stand-in's arguments, starting with its out file.
 * @param env - variables merged over `process.env` for the stand-in.
 */
const spawnStandin = (args: readonly string[], env: Readonly<Record<string, string>> = {}): ChildProcess =>
  spawn(
    process.execPath,
    ['--experimental-strip-types', '--import', LOADER, STANDIN, ...args],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  );

/** Is this pid still a live process? */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Yields one event-loop turn: the check phase runs after the poll phase that delivers a pending SIGCHLD. */
const yieldTurn = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Poll until `pid` is gone, or give up after `ms`. Resolves whether it went.
 * Yields one turn after the deadline before deciding.
 */
const waitForExit = async (pid: number, ms = GROUP_STOP_BOUND_MS): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  await yieldTurn();
  return !alive(pid);
};

/**
 * Waits up to `ms` for a child's `exit` event. Reads the child's recorded exit
 * first, races the event against the bound, and yields one turn after the
 * bound expires so an exit already queued behind a synchronous stall is
 * delivered before the wait decides.
 *
 * @returns the exit, or `undefined` when none arrived inside `ms`.
 */
const waitForWrapperExit = async (tracked: TrackedExit, ms: number): Promise<ExitReading | undefined> => {
  if (tracked.settled) return tracked.settled;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    tracked.promise,
    new Promise<void>((r) => {
      timer = setTimeout(r, ms);
    }),
  ]);
  clearTimeout(timer);
  if (!tracked.settled) await yieldTurn();
  return tracked.settled;
};

/** Everything the verdict reads from one stop. */
type GroupStopReadings = {
  /** What was sent or done to the wrapper, in the message's words: "the group stop". */
  readonly stop: string;
  readonly wrapperPid: number;
  /** The code the wrapper must exit with. */
  readonly expectedCode: number;
  /** The wrapper's `exit` event, or `undefined` when none arrived after the bound and the grace. */
  readonly exit: ExitReading | undefined;
  /** Milliseconds from the stop to the exit, or to the last look when none arrived. */
  readonly elapsedMs: number;
  readonly boundMs: number;
  readonly graceMs: number;
  readonly promptPid: number;
  readonly grandchildPid: number;
  readonly promptAlive: boolean;
  readonly grandchildAlive: boolean;
  /** The wrapper's `ps -o stat=`, read when it never exited. */
  readonly wrapperStat?: string;
  /** The wrapper's child pids, read when it never exited. */
  readonly childPids?: readonly number[];
};

/**
 * Turns the readings of one stop into a verdict. A wrapper that exits late with
 * the expected code reads as a slow stop; one that never exits, or that a
 * signal ended, names `boundedRun` as the defect.
 *
 * @returns `{ ok: true }`, or `{ ok: false, message }` with every reading in the message.
 */
const groupStopVerdict = (r: GroupStopReadings): { ok: true } | { ok: false; message: string } => {
  const readings =
    `readings: exit code=${r.exit?.code ?? 'none'} signal=${r.exit?.signal ?? 'none'} elapsed=${r.elapsedMs} ms ` +
    `(bound ${r.boundMs} ms, grace ${r.graceMs} ms) ` +
    `prompt ${r.promptPid} alive=${r.promptAlive} grandchild ${r.grandchildPid} alive=${r.grandchildAlive}`;
  const fail = (message: string) => ({ ok: false as const, message: `${message} — ${readings}` });
  if (!r.exit) {
    return fail(
      `boundedRun never ended wrapper ${r.wrapperPid} after ${r.stop}: no exit event inside ${r.boundMs} ms plus ${r.graceMs} ms ` +
        `(ps stat=${r.wrapperStat ?? 'unread'}, child pids=${r.childPids?.join(',') ?? 'unread'})`,
    );
  }
  if (r.exit.code === null) {
    return fail(
      `wrapper ${r.wrapperPid} was ended by signal ${r.exit.signal} after ${r.stop}: boundedRun's handler never ran`,
    );
  }
  if (r.exit.code !== r.expectedCode) {
    return fail(`wrapper ${r.wrapperPid} exited ${r.exit.code} after ${r.stop}, expected ${r.expectedCode}`);
  }
  if (r.elapsedMs > r.boundMs) {
    return fail(
      `slow stop: wrapper ${r.wrapperPid} handled ${r.stop} and exited ${r.exit.code} after ${r.elapsedMs} ms, past the ${r.boundMs} ms bound`,
    );
  }
  if (r.promptAlive) {
    return fail(`prompt ${r.promptPid} survived ${r.stop} — boundedRun must not detach it`);
  }
  if (r.grandchildAlive) {
    return fail(`grandchild ${r.grandchildPid} survived ${r.stop}`);
  }
  return { ok: true };
};

let wrapper: ChildProcess | undefined;
let wrapperExit: TrackedExit | undefined;
let recorded: { promptPid: number; grandchildPid: number } | undefined;
let scratch = '';
let outFile = '';

/** A fresh scratch directory for one test, and the out file inside it. */
const freshOutFile = (): string => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-group-stop-'));
  return path.join(scratch, 'out.log');
};

/** Spawns the stand-in and tracks its `exit` from the start. */
const startWrapper = (args: readonly string[], env?: Readonly<Record<string, string>>): TrackedExit => {
  wrapper = spawnStandin(args, env);
  wrapperExit = trackExit(wrapper);
  recorded = undefined;
  return wrapperExit;
};

/**
 * Resolves with the prompt's and the grandchild's pids once the stand-in
 * reports them, and records them for the teardown. Rejects when the stand-in
 * exits first or reports nothing inside `READINESS_BOUND_MS`.
 */
const readyOf = (standin: ChildProcess): Promise<{ promptPid: number; grandchildPid: number }> =>
  new Promise((resolve, reject) => {
    let buf = '';
    const done = () => {
      clearTimeout(timer);
      standin.stdout!.off('data', onData);
      standin.off('exit', onExit);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`stand-in did not report ready: ${buf}`));
    }, READINESS_BOUND_MS);
    const onData = (c: Buffer) => {
      buf += c.toString();
      const m = /READY (\d+) (\d+)/.exec(buf);
      if (m) {
        done();
        recorded = { promptPid: Number(m[1]), grandchildPid: Number(m[2]) };
        resolve(recorded);
      }
    };
    const onExit = (code: number | null) => {
      done();
      reject(new Error(`stand-in exited (${code}) before reporting ready: ${buf}`));
    };
    standin.stdout!.on('data', onData);
    standin.on('exit', onExit);
  });

/** The wrapper's `ps -o stat=`, or `unread`. */
const statOf = (pid: number): string => {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 'gone';
  } catch {
    return 'gone';
  }
};

/** The pids whose parent is `pid`. */
const childrenOf = (pid: number): number[] => {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
};

/**
 * Waits for the wrapper to end after a stop sent at `stoppedAt`, then reads the
 * prompt and the grandchild, and returns the verdict. The first window is
 * `GROUP_STOP_BOUND_MS`; the second, `LATE_EXIT_GRACE_MS`, only improves the message.
 */
const judgeStop = async (
  tracked: TrackedExit,
  ready: { promptPid: number; grandchildPid: number },
  stoppedAt: number,
  stop: string,
  expectedCode: number,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const wrapperPid = tracked.child.pid!;
  const [exitInBound, promptGone, grandchildGone] = await Promise.all([
    waitForWrapperExit(tracked, GROUP_STOP_BOUND_MS),
    waitForExit(ready.promptPid),
    waitForExit(ready.grandchildPid),
  ]);
  const exit = exitInBound ?? (await waitForWrapperExit(tracked, LATE_EXIT_GRACE_MS));
  const never = exit === undefined;
  return groupStopVerdict({
    stop,
    wrapperPid,
    expectedCode,
    exit,
    elapsedMs: (tracked.exitedAt ?? Date.now()) - stoppedAt,
    boundMs: GROUP_STOP_BOUND_MS,
    graceMs: LATE_EXIT_GRACE_MS,
    promptPid: ready.promptPid,
    grandchildPid: ready.grandchildPid,
    promptAlive: !promptGone && alive(ready.promptPid),
    grandchildAlive: !grandchildGone && alive(ready.grandchildPid),
    ...(never ? { wrapperStat: statOf(wrapperPid), childPids: childrenOf(wrapperPid) } : {}),
  });
};

/** Asserts a verdict, with its message carrying every reading. */
const expectVerdict = (v: { ok: true } | { ok: false; message: string }): void => {
  expect(v.ok, v.ok ? '' : v.message).toBe(true);
};

/**
 * Writes a `pgrep` into `<scratch>/bin` that sleeps `seconds` on its FIRST
 * call and then runs the real `pgrep`. Returns the `PATH` with that directory first.
 */
const slowPgrepPath = (seconds: number): string => {
  const bin = path.join(scratch, 'bin');
  fs.mkdirSync(bin);
  const real = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((d) => path.join(d, 'pgrep'))
    .find((p) => fs.existsSync(p));
  if (!real) throw new Error('no pgrep on PATH to wrap');
  const stub = path.join(bin, 'pgrep');
  fs.writeFileSync(
    stub,
    `#!/bin/sh\nif mkdir "${path.join(scratch, 'slept')}" 2>/dev/null; then sleep ${seconds}; fi\nexec "${real}" "$@"\n`,
  );
  fs.chmodSync(stub, 0o755);
  return `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
};

afterEach(async () => {
  // THE GROUP IS KILLED EVEN WHEN THE WRAPPER IS GONE: a prompt or grandchild
  // that outlived it still carries the wrapper's pgid. It is signalled only
  // while it is plausibly alive: the wrapper has not exited, or a recorded pid lives.
  const pids = recorded ? [recorded.promptPid, recorded.grandchildPid] : [];
  if (wrapper?.pid && (!wrapperExit?.settled || pids.some(alive))) {
    try {
      process.kill(-wrapper.pid, 'SIGKILL');
    } catch {
      /* the whole group is gone */
    }
  }
  // A prompt that `boundedRun` detached into its own group is outside that group.
  for (const pid of pids) {
    if (!alive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone between the check and the signal */
    }
  }
  wrapper = undefined;
  wrapperExit = undefined;
  recorded = undefined;
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = '';
});

describe('the group-stop verdict', () => {
  const base: GroupStopReadings = {
    stop: 'the group stop',
    wrapperPid: 100,
    expectedCode: 143,
    exit: { code: 143, signal: null },
    elapsedMs: 300,
    boundMs: GROUP_STOP_BOUND_MS,
    graceMs: LATE_EXIT_GRACE_MS,
    promptPid: 101,
    grandchildPid: 102,
    promptAlive: false,
    grandchildAlive: false,
  };
  const failure = (r: GroupStopReadings): string => {
    const v = groupStopVerdict(r);
    if (v.ok) throw new Error('expected a failing verdict');
    return v.message;
  };

  it('passes a wrapper that exits 143 inside the bound with both descendants gone', () => {
    expect(groupStopVerdict(base)).toEqual({ ok: true });
  });

  it('reads a wrapper that exits 143 past the bound as a slow stop and gives the elapsed milliseconds', () => {
    const message = failure({ ...base, elapsedMs: 6123 });
    expect(message).toContain('slow stop');
    expect(message).toContain('6123 ms');
    expect(message).not.toContain('boundedRun never ended');
  });

  it('names boundedRun when no exit event arrived, with the wrapper\'s state and children', () => {
    const message = failure({ ...base, exit: undefined, elapsedMs: 10_050, wrapperStat: 'S', childPids: [7, 8] });
    expect(message).toContain('boundedRun never ended wrapper 100');
    expect(message).toContain('ps stat=S');
    expect(message).toContain('child pids=7,8');
    expect(message).toContain('prompt 101 alive=false');
  });

  it('says the handler never ran for an exit by SIGTERM with no code', () => {
    const message = failure({ ...base, exit: { code: null, signal: 'SIGTERM' } });
    expect(message).toContain('boundedRun\'s handler never ran');
    expect(message).toContain('signal=SIGTERM');
  });

  it('names a surviving prompt and a surviving grandchild', () => {
    expect(failure({ ...base, promptAlive: true })).toContain('prompt 101 survived the group stop');
    expect(failure({ ...base, grandchildAlive: true })).toContain('grandchild 102 survived the group stop');
  });

  it('refuses an exit code other than the expected one', () => {
    expect(failure({ ...base, exit: { code: 0, signal: null } })).toContain('exited 0');
  });
});

describe('the wrapper wait', () => {
  it('answers "exited" for a child whose exit lands during a synchronous stall past the bound', async () => {
    const child = spawn('sh', ['-c', 'sleep 0.2'], { stdio: 'ignore' });
    const tracked = trackExit(child);
    const waiting = waitForWrapperExit(tracked, 200);
    // The child ends while this thread is blocked; the bound's timer is due
    // before the poll phase that delivers the child's exit.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
    expect(await waiting).toEqual({ code: 0, signal: null });
  });

  it('answers undefined for a child that outlives the bound', async () => {
    const child = spawn('sh', ['-c', 'sleep 5'], { stdio: 'ignore' });
    const tracked = trackExit(child);
    try {
      expect(await waitForWrapperExit(tracked, 100)).toBeUndefined();
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('a group stop reaches boundedRun\'s child and its descendants', () => {
  it('ends the wrapper, the prompt, and the prompt\'s own child, together', async () => {
    outFile = freshOutFile();

    // THE WRAPPER LEADS ITS OWN GROUP — spawned `detached: true` BY THE TEST,
    // which is the one place in this whole chain `detached` belongs: it
    // stands in for `start_worker`'s `set -m`, giving the tree a group of its
    // own so the test's SIGTERM never reaches the test runner itself.
    const tracked = startWrapper([outFile]);
    const wrapperPid = wrapper!.pid!;
    const ready = await readyOf(wrapper!);

    expect(alive(wrapperPid)).toBe(true);
    expect(alive(ready.promptPid)).toBe(true);
    expect(alive(ready.grandchildPid)).toBe(true);

    // THE GROUP STOP: `kill -TERM -<pgid>` against the NEGATIVE pid, exactly
    // as `plot-dispatch.sh --stop` sends it.
    const stoppedAt = Date.now();
    process.kill(-wrapperPid, 'SIGTERM');

    expectVerdict(await judgeStop(tracked, ready, stoppedAt, 'the group stop', 143));
  }, TEST_TIMEOUT_MS);

  it('passes when a slow pgrep delays the wrapper\'s exit inside the bound', async () => {
    outFile = freshOutFile();
    const tracked = startWrapper([outFile], { PATH: slowPgrepPath(1) });
    const ready = await readyOf(wrapper!);

    const stoppedAt = Date.now();
    process.kill(-wrapper!.pid!, 'SIGTERM');

    expectVerdict(await judgeStop(tracked, ready, stoppedAt, 'the group stop', 143));
    expect(tracked.settled).toEqual({ code: 143, signal: null });
    expect(fs.existsSync(path.join(scratch, 'slept'))).toBe(true);
  }, TEST_TIMEOUT_MS);

  it('reads a pgrep slower than the bound as a slow stop with code 143, not a survival', async () => {
    outFile = freshOutFile();
    const seconds = GROUP_STOP_BOUND_MS / 1000 + 1;
    const tracked = startWrapper([outFile], { PATH: slowPgrepPath(seconds) });
    const ready = await readyOf(wrapper!);

    const stoppedAt = Date.now();
    process.kill(-wrapper!.pid!, 'SIGTERM');

    const verdict = await judgeStop(tracked, ready, stoppedAt, 'the group stop', 143);
    expect(verdict.ok).toBe(false);
    const message = verdict.ok ? '' : verdict.message;
    expect(message).toMatch(/^slow stop: wrapper \d+ handled the group stop and exited 143 after \d+ ms/);
    expect(message).not.toContain('boundedRun never ended');
    expect(message).not.toContain('survived');
    expect(tracked.settled).toEqual({ code: 143, signal: null });
  }, TEST_TIMEOUT_MS);

  it('ends the prompt and its descendants when the caller process exits normally', async () => {
    outFile = freshOutFile();

    const tracked = startWrapper([outFile, '--exit-normally']);
    const ready = await readyOf(wrapper!);

    // THE WRAPPER ENDS ITSELF — no signal from the test. `boundedRunProcess`'s
    // own `process.once('exit', ...)` handler is what must reap the prompt
    // tree here, since nothing external ever signals it.
    expectVerdict(await judgeStop(tracked, ready, Date.now(), 'the caller\'s normal exit', 0));
  }, TEST_TIMEOUT_MS);

  it('ends the prompt and its descendants when its own bound fires', async () => {
    outFile = freshOutFile();

    // `--bound-seconds 4` tells the stand-in to pass a bound to `boundedRun`
    // itself, rather than relying on an external signal — the THIRD path this
    // port's own timer covers, beside the group stop and the caller's exit
    // above. FOUR SECONDS, NOT ONE: the bound starts before the prompt's Node
    // has started, and a loaded machine can take over a second for that, so
    // a one-second bound could kill the prompt before it reports its child.
    startWrapper([outFile, '--bound-seconds', '4']);
    const ready = await readyOf(wrapper!);

    const [promptGone, grandchildGone] = await Promise.all([
      waitForExit(ready.promptPid, BOUND_FIRES_WAIT_MS),
      waitForExit(ready.grandchildPid, BOUND_FIRES_WAIT_MS),
    ]);
    expect(promptGone, 'the prompt survived its own bound expiring').toBe(true);
    expect(grandchildGone, 'the grandchild survived the bound — the read-descendants-first order missed it').toBe(true);
  }, TEST_TIMEOUT_MS);

  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) {
    it(`a ${signal} to the caller's pid alone ends the prompt and its child, and the caller exits ${code}`, async () => {
      outFile = freshOutFile();
      const tracked = startWrapper([outFile]);
      const ready = await readyOf(wrapper!);

      // THE PID, NOT THE GROUP: nothing but the caller receives the signal.
      const stoppedAt = Date.now();
      process.kill(wrapper!.pid!, signal);

      expectVerdict(await judgeStop(tracked, ready, stoppedAt, `a ${signal} to its caller`, code));
    }, TEST_TIMEOUT_MS);
  }
});

describe('boundedRunProcess on a command that cannot start', () => {
  it('answers failed for a missing executable', async () => {
    outFile = freshOutFile();
    const { boundedRunProcess } = await import('../src/adapters/bounded-run/bounded-run-process.js');
    const { processesShell } = await import('../src/adapters/processes/processes-shell.js');
    const run = boundedRunProcess(processesShell({ repoRoot: process.cwd(), scriptDir: '/nonexistent' }));
    const result = await run.run(path.join(scratch, 'no-such-command'), [], {
      cwd: scratch,
      boundSeconds: 0,
      outFile,
    });
    expect(result).toEqual({ ok: false, why: 'failed' });
  });
});

describe('boundedRunProcess onStarted', () => {
  it('hands the child\'s pid to onStarted, and a throwing callback leaves the run to finish', async () => {
    outFile = freshOutFile();
    const { boundedRunProcess } = await import('../src/adapters/bounded-run/bounded-run-process.js');
    const { processesShell } = await import('../src/adapters/processes/processes-shell.js');
    const run = boundedRunProcess(processesShell({ repoRoot: process.cwd(), scriptDir: '/nonexistent' }));
    const started: number[] = [];
    const result = await run.run('sh', ['-c', 'echo "$$"'], {
      cwd: scratch,
      boundSeconds: 0,
      outFile,
      onStarted: (pid) => {
        started.push(pid);
        throw new Error('the record could not be written');
      },
    });
    expect(result).toMatchObject({ ok: true, value: { status: 0 } });
    expect(started).toEqual([Number(fs.readFileSync(outFile, 'utf8').trim())]);
  });
});
