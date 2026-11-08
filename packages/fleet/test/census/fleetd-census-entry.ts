// The census entry for fleetd: runs fleetd's `run` in the loop mode it ships
// in, with the idle reader, on a clock this entry drives from stdin.
//
// Bundled by `fleetd-entry-build.ts`, which resolves the `census-product:`
// specifiers below into the product checkout (`productRoot()`), so the same
// entry runs against HEAD and against the merge base.
//
// stdin, one command per line:
//   pass   run one completed pass: the tick, and one beat of each of the scan,
//          the PR reader, the issue reader and the issue writes; then start
//          `/usr/bin/true census-mark pass-<n>` and print `census: pass <n> done`
//   stop   end the loop; prints `census: stopped <code>` and exits with it
//
// `CENSUS_CLOCK=system` runs fleetd on the system clock and real sleeps
// instead, for a scenario that needs a fleetd running beside the board; then
// stdin takes only `stop`.
//
// `CENSUS_SPAWN_LOG=<file>` appends one JSON line per process this node
// process starts directly (`spawn`, `execFile`), so a run without `strace`
// still shows which direct children a pass starts. It also appends one line,
// `{"signal0": <pid>}`, per `process.kill(pid, 0)`, the liveness question that
// starts no process.
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
  if (child === undefined) return;
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

const originalSpawn = cp.spawn;
const originalExecFile = cp.execFile;
const originalExecFilePromise = (originalExecFile as unknown as Record<symbol, (...a: unknown[]) => Promise<unknown> & { child?: ChildProcess }>)[
  promisify.custom
];
const spawnTracked = ((file: string, ...rest: unknown[]) => {
  const child = (originalSpawn as (...a: unknown[]) => ChildProcess)(file, ...rest);
  track(child, file, argsOf(rest));
  return child;
}) as typeof cp.spawn;
const execFileTracked = ((file: string, ...rest: unknown[]) => {
  const child = (originalExecFile as (...a: unknown[]) => ChildProcess)(file, ...rest);
  track(child, file, argsOf(rest));
  return child;
}) as unknown as typeof cp.execFile;
if (originalExecFilePromise !== undefined) {
  Object.defineProperty(execFileTracked, promisify.custom, {
    value: (file: string, ...rest: unknown[]) => {
      const pending = originalExecFilePromise(file, ...rest);
      track(pending.child, file, argsOf(rest));
      return pending;
    },
  });
}
cp.spawn = spawnTracked;
cp.execFile = execFileTracked;
syncBuiltinESMExports();

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
const clock = manual ? clockManual(Date.now()) : undefined;

let stopped = false;
let wakeStop: () => void = () => undefined;
const requested = new Promise<void>((resolve) => {
  wakeStop = resolve;
});
const stop = Object.assign(() => stopped, { requested });

let sleeps = 0;
let wakeSleep: (() => void) | null = null;
const sleepWaiters: { at: number; resolve: () => void }[] = [];
const sleep = manual
  ? (): Promise<void> =>
      new Promise<void>((resolve) => {
        sleeps += 1;
        wakeSleep = resolve;
        for (const w of sleepWaiters.splice(0)) {
          if (sleeps >= w.at) w.resolve();
          else sleepWaiters.push(w);
        }
      })
  : undefined;
const sleepsReach = (at: number): Promise<void> =>
  sleeps >= at ? Promise.resolve() : new Promise((resolve) => sleepWaiters.push({ at, resolve }));

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
const pass = async (): Promise<void> => {
  passes += 1;
  if (passes === 1) {
    await sleepsReach(1);
  } else {
    const release = wakeSleep;
    wakeSleep = null;
    release?.();
  }
  const target = passes;
  offsetMs += beatsPerPass * BEAT_MS;
  clock?.advance(beatsPerPass);
  await sleepsReach(target);
  await quiet();
  mark(`pass-${passes}`);
  say(`pass ${passes} done`);
};

const repoRoot = process.env['PLOT_REPO_ROOT'] ?? process.cwd();
const scriptsDir = process.env['PLOT_SCRIPTS_DIR'] ?? join(dirname(process.argv[1] ?? '.'), '..');
const daemon = run(
  process.argv.slice(2),
  join(scriptsDir, 'board'),
  (s: string) => process.stdout.write(s),
  sleep,
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
    if (command === 'stop') {
      stopped = true;
      wakeStop();
      const release = wakeSleep;
      wakeSleep = null;
      release?.();
    }
  });
});
process.on('SIGTERM', () => {
  stopped = true;
  wakeStop();
  wakeSleep?.();
});

const code = await daemon;
lines.close();
say(`stopped ${code}`);
process.exit(code);
