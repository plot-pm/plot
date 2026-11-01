// THE LATE-SIGNAL TEST (#3010) — `boundedRunProcess` must not drop a SIGTERM,
// SIGINT or SIGHUP that reaches its caller in the same event-loop turn as its
// child's own end. The defect: a per-run listener removed in `finish()` could
// be the LAST listener for that signal, which stops Node's signal watcher and
// drops a signal libuv already has queued. The fix keeps one listener per
// signal for the whole process, installed once and never removed, deciding
// from a live-run count and the process's other listeners instead.
//
// EACH ROW SPAWNS THE SAME STAND-IN the group-stop test uses
// (`fixtures/bounded-run-group-standin.mjs`), in its own process group, so a
// row's own SIGTERM to itself never reaches the test runner.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STANDIN = path.join(HERE, 'fixtures/bounded-run-group-standin.mjs');
const LOADER = path.join(HERE, 'fixtures/ts-strip-loader.mjs');

/** Readiness wait (10 s) plus the stand-in's own synchronous zombie poll, which is bounded by the OS reaping its own child — in practice under a second. */
const TEST_TIMEOUT_MS = 20_000;

/** Spawns the stand-in, detached into its own process group (matching the group-stop test). */
const spawnStandin = (args: readonly string[]): ChildProcess =>
  spawn(
    process.execPath,
    ['--experimental-strip-types', '--import', LOADER, STANDIN, ...args],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
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

/** Poll until `pid` is gone, or give up after `ms`. Resolves whether it went. */
const waitForExit = async (pid: number, ms = 5000): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
};

/** Resolves with the prompt's and the grandchild's pids once the stand-in reports them. */
const readyOf = (standin: ChildProcess): Promise<{ promptPid: number; grandchildPid: number }> =>
  new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`stand-in did not report ready: ${buf}`)), 10_000);
    standin.stdout!.on('data', (c: Buffer) => {
      buf += c.toString();
      const m = /READY (\d+) (\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve({ promptPid: Number(m[1]), grandchildPid: Number(m[2]) });
      }
    });
  });

let wrappers: ChildProcess[] = [];
let scratch = '';

/** A fresh scratch directory for one test, and an out file inside it tagged by index. */
const freshOutFile = (tag = 0): string => {
  if (!scratch) scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-late-signal-'));
  return path.join(scratch, `out-${tag}.log`);
};

afterEach(async () => {
  for (const wrapper of wrappers) {
    if (wrapper.pid) {
      try {
        process.kill(-wrapper.pid, 'SIGKILL');
      } catch {
        /* the whole group is gone */
      }
    }
  }
  wrappers = [];
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = '';
});

describe('a signal that reaches boundedRun\'s caller in the same turn as its child\'s end', () => {
  it('still ends the caller: exit 143 inside the bound', async () => {
    const outFile = freshOutFile();
    const wrapper = spawnStandin([outFile, '--late-signal']);
    wrappers.push(wrapper);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      wrapper.once('exit', (code, signal) => resolve({ code, signal })),
    );
    await readyOf(wrapper);

    const result = await exited;
    expect(result, 'the stand-in survived a SIGTERM sent in the same turn as its child\'s end — boundedRun dropped the signal').toEqual({
      code: 143,
      signal: null,
    });
  }, TEST_TIMEOUT_MS);

  it('a second live run keeps the stop: both trees die and the caller exits 143', async () => {
    const outFileA = freshOutFile(0);
    const outFileB = freshOutFile(1);
    const wrapper = spawnStandin([outFileA, '--second-run', outFileB]);
    wrappers.push(wrapper);

    let buf = '';
    const bothReady = new Promise<{
      a: { promptPid: number; grandchildPid: number };
      b: { promptPid: number; grandchildPid: number };
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`stand-in did not report both ready: ${buf}`)), 10_000);
      wrapper.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        const m = /READY (\d+) (\d+) (\d+) (\d+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve({
            a: { promptPid: Number(m[1]), grandchildPid: Number(m[2]) },
            b: { promptPid: Number(m[3]), grandchildPid: Number(m[4]) },
          });
        }
      });
    });

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      wrapper.once('exit', (code, signal) => resolve({ code, signal })),
    );

    const ready = await bothReady;
    process.kill(wrapper.pid!, 'SIGTERM');

    const result = await exited;
    expect(result).toEqual({ code: 143, signal: null });

    const [aPromptGone, aGrandchildGone, bPromptGone, bGrandchildGone] = await Promise.all([
      waitForExit(ready.a.promptPid),
      waitForExit(ready.a.grandchildPid),
      waitForExit(ready.b.promptPid),
      waitForExit(ready.b.grandchildPid),
    ]);
    expect(aPromptGone, 'the first run\'s prompt survived').toBe(true);
    expect(aGrandchildGone, 'the first run\'s grandchild survived').toBe(true);
    expect(bPromptGone, 'the second run\'s prompt survived').toBe(true);
    expect(bGrandchildGone, 'the second run\'s grandchild survived').toBe(true);
  }, TEST_TIMEOUT_MS);

  it('a caller\'s own listener acts alone once its one run has finished', async () => {
    const outFile = freshOutFile();
    const wrapper = spawnStandin([outFile, '--own-listener', '--finish-run']);
    wrappers.push(wrapper);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      wrapper.once('exit', (code, signal) => resolve({ code, signal })),
    );

    // `--finish-run` runs a command that exits on its own (the live-run count
    // drops to zero) while the stand-in process stays alive. Only once it
    // reports RUN_FINISHED is SIGTERM sent — so by then no run is live and
    // only the stand-in's own listener is registered for the signal.
    await new Promise<void>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`stand-in did not report the run as finished: ${buf}`)), 10_000);
      wrapper.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        if (buf.includes('RUN_FINISHED')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    process.kill(wrapper.pid!, 'SIGTERM');

    const result = await exited;
    expect(result, 'the caller\'s own listener did not get to act alone').toEqual({ code: 7, signal: null });
  }, TEST_TIMEOUT_MS);

  it('no listener, no live run: the process still ends on SIGTERM', async () => {
    const outFile = freshOutFile();
    const wrapper = spawnStandin([outFile, '--finish-run']);
    wrappers.push(wrapper);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      wrapper.once('exit', (code, signal) => resolve({ code, signal })),
    );

    // `--finish-run` with no `--own-listener`: once the run finishes, no run
    // is live and the process carries no listener but the adapter's own.
    // That is the arm the port's contract calls "no live run and no other
    // listener": the adapter still exits with the signal's conventional code.
    await new Promise<void>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`stand-in did not report the run as finished: ${buf}`)), 10_000);
      wrapper.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        if (buf.includes('RUN_FINISHED')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    process.kill(wrapper.pid!, 'SIGTERM');

    const result = await exited;
    expect(result, 'a stand-in with no run and no listener of its own survived SIGTERM').toEqual({ code: 143, signal: null });
  }, TEST_TIMEOUT_MS);
});
