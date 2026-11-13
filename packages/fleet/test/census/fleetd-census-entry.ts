// The census entry for fleetd: runs fleetd's `run` in the loop mode it ships
// in, with the idle reader, on a clock this entry drives from stdin.
//
// Bundled by `fleetd-entry-build.ts`, which resolves the `census-product:`
// specifiers below into the product checkout (`productRoot()`), so the same
// entry runs against HEAD and against the merge base.
//
// stdin, one command per line:
//   pass   run one completed pass: move the manual clock by 120 s, so every beat of
//          the scan, the PR reader, the issue reader and the issue writes comes
//          due, and end when no direct child has run for `QUIET_MS`; then start
//          `/usr/bin/true census-mark pass-<n>` and print `census: pass <n> done`
//   safety-net
//          run one completed pass that moves the clock by at least the
//          safety-net interval, so the full read it holds is a safety-net
//          read; it prints `census: pass <n> done` as `pass` does. The tick runs
//          in a pass only when a trigger or a deadline started it
//   stop   end the loop; prints `census: stopped <code>` and exits with it
//
// `CENSUS_CLOCK=system` runs fleetd on the system clock and real sleeps
// instead, for a scenario that needs a fleetd running beside the board; then
// stdin takes only `stop`.
//
// `CENSUS_SPAWN_LOG=<file>` appends one JSON line per process this node
// process starts directly (`spawn`, `execFile`, `spawnSync`, `execFileSync`), so a run without `strace`
// still shows which direct children a pass starts. It also appends one line,
// `{"signal0": <pid>}`, per `process.kill(pid, 0)`, the liveness question that
// starts no process.
//
// `CENSUS_SPAWN_CALLER=1` adds `CENSUS_CALLER` to every tracked child's
// environment: the first product frames of the stack that started it, so a
// shim on `PATH` can name the TypeScript site behind a grandchild.
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';

/** The image a mark starts; the census filters it out by its first argument. */
export const MARK_IMAGE = '/usr/bin/true';
export const MARK_ARG = 'census-mark';

/** How long no direct child may run before a pass counts as settled, in ms. */
const QUIET_MS = 300;

const say = (line: string): void => {
  process.stdout.write(`census: ${line}\n`);
};

// ---------------------------------------------------------------------------
// Direct children, counted before the product module loads.
// ---------------------------------------------------------------------------
const cp = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
const spawnLog = process.env['CENSUS_SPAWN_LOG'] ?? '';
let inFlight = 0;
let lastSettled = Date.now();

const track = (child: ChildProcess | undefined, file: string, args: readonly unknown[]): void => {
  if (spawnLog !== '') {
    appendFileSync(spawnLog, `${JSON.stringify({ at: Math.round(performance.now()), file, args: args.filter((a) => typeof a === 'string') })}\n`);
  }
  // THE OBJECT READER LIVES AS LONG AS FLEETD: it is logged and never counts
  // as in flight, or no pass would settle.
  if (child === undefined || (file === 'git' && args.includes('--batch-command'))) return;
  inFlight += 1;
  let done = false;
  const startedAt = performance.now();
  const settle = (): void => {
    if (done) return;
    done = true;
    if (spawnLog !== '') {
      appendFileSync(spawnLog, `${JSON.stringify({ at: Math.round(performance.now()), ms: Math.round(performance.now() - startedAt), ended: file, args: args.filter((a) => typeof a === 'string').slice(0, 3) })}\n`);
    }
    inFlight -= 1;
    lastSettled = Date.now();
  };
  child.once('close', settle);
  child.once('error', settle);
};

const argsOf = (rest: unknown[]): unknown[] => (Array.isArray(rest[0]) ? (rest[0] as unknown[]) : []);

const callerOn = process.env['CENSUS_SPAWN_CALLER'] === '1';

/**
 * The first four product frames of the current stack, as `path:line`, joined
 * by ` < `; the process runners in `run-script.ts` and `git-dirs.ts` are
 * skipped, since every adapter starts its children through them.
 */
const callerFrames = (): string =>
  (new Error().stack ?? '')
    .split('\n')
    .map((line) => /\(?((?:\/|file:\/\/)[^()]*?\/packages\/[^()]*?):(\d+):\d+\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null && !/\/census\/|adapters\/run-script\.ts|adapters\/git-dirs\/git-dirs\.ts/.test(m[1]!))
    .slice(0, 4)
    .map((m) => `${m[1]!.replace(/^.*?\/packages\//, '')}:${m[2]}`)
    .join(' < ');

/**
 * Returns `rest` with `CENSUS_CALLER` and `CENSUS_CHILD` (the direct child's
 * file and first two arguments) added to the options object's `env`,
 * inserting an options object where the call passed none.
 */
const withCaller = (file: string, rest: unknown[]): unknown[] => {
  if (!callerOn) return rest;
  const out = [...rest];
  const at = Array.isArray(out[0]) ? 1 : 0;
  const given = out[at];
  const options = given !== null && typeof given === 'object' ? { ...(given as Record<string, unknown>) } : {};
  options['env'] = { ...((options['env'] as NodeJS.ProcessEnv | undefined) ?? process.env), CENSUS_CALLER: callerFrames(),
    CENSUS_CHILD: [file, ...argsOf(rest).filter((a): a is string => typeof a === 'string').slice(0, 2)].join(' ').replace(/[\t\n]/g, ' ').slice(0, 200),
  };
  if (given !== null && typeof given === 'object') out[at] = options;
  else out.splice(at, 0, options);
  return out;
};

const originalSpawn = cp.spawn;
const originalExecFile = cp.execFile;
const originalExecFilePromise = (originalExecFile as unknown as Record<symbol, (...a: unknown[]) => Promise<unknown> & { child?: ChildProcess }>)[
  promisify.custom
];
const spawnTracked = ((file: string, ...given: unknown[]) => {
  const rest = withCaller(file, given);
  const child = (originalSpawn as (...a: unknown[]) => ChildProcess)(file, ...rest);
  track(child, file, argsOf(rest));
  return child;
}) as typeof cp.spawn;
const execFileTracked = ((file: string, ...given: unknown[]) => {
  const rest = withCaller(file, given);
  const child = (originalExecFile as (...a: unknown[]) => ChildProcess)(file, ...rest);
  track(child, file, argsOf(rest));
  return child;
}) as unknown as typeof cp.execFile;
if (originalExecFilePromise !== undefined) {
  Object.defineProperty(execFileTracked, promisify.custom, {
    value: (file: string, ...given: unknown[]) => {
      const rest = withCaller(file, given);
      const pending = originalExecFilePromise(file, ...rest);
      track(pending.child, file, argsOf(rest));
      return pending;
    },
  });
}
// A SYNCHRONOUS START IS LOGGED AND NEVER IN FLIGHT: it has ended when the call returns.
const syncTracked = <F>(original: F): F =>
  ((file: string, ...given: unknown[]) => {
    const rest = withCaller(file, given);
    if (spawnLog !== '' && file !== MARK_IMAGE) {
      appendFileSync(spawnLog, `${JSON.stringify({ at: Math.round(performance.now()), file, args: argsOf(rest).filter((a) => typeof a === 'string'), sync: true })}\n`);
    }
    return (original as (...a: unknown[]) => unknown)(file, ...rest);
  }) as F;
const spawnSyncTracked = syncTracked(cp.spawnSync);
const execFileSyncTracked = syncTracked(cp.execFileSync);
cp.spawn = spawnTracked;
cp.execFile = execFileTracked;
cp.spawnSync = spawnSyncTracked;
cp.execFileSync = execFileSyncTracked;
syncBuiltinESMExports();

// AN IN-PROCESS REQUEST IS IN FLIGHT TOO: the GitHub client reads over
// `http.request` (the stub API is plain HTTP), and a pass that settled while
// one was open would count its follow-up children in the next pass.
const httpModule = createRequire(import.meta.url)('node:http') as typeof import('node:http');
const originalHttpRequest = httpModule.request;
httpModule.request = ((...given: unknown[]) => {
  const req = (originalHttpRequest as (...a: unknown[]) => import('node:http').ClientRequest)(...given);
  inFlight += 1;
  let done = false;
  req.once('close', () => {
    if (done) return;
    done = true;
    inFlight -= 1;
    lastSettled = Date.now();
  });
  return req;
}) as typeof httpModule.request;

const originalKill = process.kill.bind(process);
process.kill = ((pid: number, signal?: string | number) => {
  if (spawnLog !== '' && signal === 0) {
    appendFileSync(spawnLog, `${JSON.stringify({ at: Math.round(performance.now()), signal0: pid })}\n`);
  }
  return originalKill(pid, signal);
}) as typeof process.kill;

// ---------------------------------------------------------------------------
// Virtual time. The loops' cadence gates read `Date.now()`, not the injected
// clock, so a pass also moves the wall clock the loops see by the time its
// beats stand for. Without it every pass after the first finds its PR and
// issue reads not yet due.
// ---------------------------------------------------------------------------
const manual = (process.env['CENSUS_CLOCK'] ?? 'manual') !== 'system';
const RealDate = Date;
let offsetMs = 0;
if (manual) {
  class CensusDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offsetMs);
      else super(...(args as [number]));
    }
    static override now(): number {
      return RealDate.now() + offsetMs;
    }
  }
  globalThis.Date = CensusDate as DateConstructor;
}

// ---------------------------------------------------------------------------
// The product, loaded after the patches.
// ---------------------------------------------------------------------------
const { run } = await import('census-product:fleetd');
const { clockManual } = await import('census-product:clock');
const { fleetDivisors } = await import('census-product:fleet-clock');

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** Beats in one completed pass: the least common multiple of every loop's divisor. */
const beatsPerPass = fleetDivisors().reduce((acc, { everyNthBeat }) => (acc * everyNthBeat) / gcd(acc, everyNthBeat), 1);

/** The fleet clock's beat, in ms: `clockManual` moves its own time by this per beat. */
const BEAT_MS = 5_000;
/**
 * The safety-net interval, in ms: the product's `SAFETY_NET_MS`, written here
 * because a merge-base product may not export it.
 */
const SAFETY_NET_MS = 600_000;
/** Beats in one safety-net pass: whole passes that span at least the safety-net interval. */
const safetyNetBeats = Math.ceil(SAFETY_NET_MS / (beatsPerPass * BEAT_MS)) * beatsPerPass;
const clock = manual ? clockManual(Date.now()) : undefined;

let markStarted: () => void = () => undefined;
const started = new Promise<void>((resolve) => {
  markStarted = resolve;
});
let stopped = false;
let wakeStop: () => void = () => undefined;
const requested = new Promise<void>((resolve) => {
  wakeStop = resolve;
});
const stop = Object.assign(() => stopped, { requested });

const quiet = async (): Promise<void> => {
  for (;;) {
    await new Promise((r) => setTimeout(r, 50));
    if (inFlight === 0 && Date.now() - lastSettled >= QUIET_MS) return;
  }
};

const mark = (label: string): void => {
  cp.spawnSync(MARK_IMAGE, [MARK_ARG, label], { stdio: 'ignore' });
};

let passes = 0;
const pass = async (beats: number = beatsPerPass): Promise<void> => {
  passes += 1;
  // THE FIRST PASS WAITS FOR THE START: the loop logs `supervising` once the watch set is armed
  // and the clock runs, and the first tick and the start scan then settle on quiet.
  if (passes === 1) {
    await started;
    await quiet();
  }
  // BOTH READINGS MOVE TOGETHER: `advance` moves the manual clock's wall and
  // monotonic readings by the same beats, so `clockDrift` reads no jump across a
  // pass. `offsetMs` shifts only the patched `Date`, which fleetd's wake check
  // never reads: it reads the injected clock through the port.
  offsetMs += beats * BEAT_MS;
  // A manual clock fires every beat of one `advance` before a scan can settle, so a
  // scan that starts on a trigger decides once per advance. A pass longer than a
  // census pass stops one beat short, settles, and fires the last beat, where the
  // safety net is due.
  if (beats > beatsPerPass) {
    clock?.advance(beats - 1);
    await quiet();
    clock?.advance(1);
  } else clock?.advance(beats);
  await quiet();
  mark(`pass-${passes}`);
  say(`pass ${passes} done`);
};

const repoRoot = process.env['PLOT_REPO_ROOT'] ?? process.cwd();
const scriptsDir = process.env['PLOT_SCRIPTS_DIR'] ?? join(dirname(process.argv[1] ?? '.'), '..');
const daemon = run(
  process.argv.slice(2),
  join(scriptsDir, 'board'),
  (s: string) => {
    if (s.includes('plot-fleetd: supervising')) markStarted();
    process.stdout.write(s);
  },
  undefined,
  stop,
  (s: string) => process.stderr.write(s),
  repoRoot,
  clock ? { clock } : {},
);

let queue = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const command = line.trim();
  queue = queue.then(async () => {
    if (command === 'pass' && manual && !stopped) await pass();
    if (command === 'safety-net' && manual && !stopped) await pass(safetyNetBeats);
    if (command === 'stop') {
      stopped = true;
      wakeStop();
    }
  });
});
process.on('SIGTERM', () => {
  stopped = true;
  wakeStop();
});

const code = await daemon;
lines.close();
say(`stopped ${code}`);
process.exit(code);
