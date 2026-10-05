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
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STANDIN = path.join(HERE, 'fixtures/bounded-run-group-standin.mjs');
const LOADER = path.join(HERE, 'fixtures/ts-strip-loader.mjs');

/**
 * Spawns the stand-in with the flags its own `.ts` imports need: type
 * stripping for the real adapter source, and the resolver hook that maps a
 * `.js` specifier to its sibling `.ts` file where no `.js` exists.
 */
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

let wrapper: ChildProcess | undefined;
let outFile = '';

afterEach(async () => {
  if (wrapper?.pid && alive(wrapper.pid)) {
    try {
      process.kill(-wrapper.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  wrapper = undefined;
  if (outFile) fs.rmSync(outFile, { force: true });
});

describe('a group stop reaches boundedRun\'s child and its descendants', () => {
  it('ends the wrapper, the prompt, and the prompt\'s own child, together', async () => {
    outFile = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-group-stop-')) + '/out.log';

    // THE WRAPPER LEADS ITS OWN GROUP — spawned `detached: true` BY THE TEST,
    // which is the one place in this whole chain `detached` belongs: it
    // stands in for `start_worker`'s `set -m`, giving the tree a group of its
    // own so the test's SIGTERM never reaches the test runner itself.
    wrapper = spawnStandin([outFile]);
    const wrapperPid = wrapper.pid!;

    const ready = await new Promise<{ promptPid: number; grandchildPid: number }>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`stand-in did not report ready: ${buf}`)), 10_000);
      wrapper!.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        const m = /READY (\d+) (\d+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve({ promptPid: Number(m[1]), grandchildPid: Number(m[2]) });
        }
      });
      wrapper!.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`stand-in exited (${code}) before reporting ready`));
      });
    });

    expect(alive(wrapperPid)).toBe(true);
    expect(alive(ready.promptPid)).toBe(true);
    expect(alive(ready.grandchildPid)).toBe(true);

    // THE GROUP STOP: `kill -TERM -<pgid>` against the NEGATIVE pid, exactly
    // as `plot-dispatch.sh --stop` sends it.
    process.kill(-wrapperPid, 'SIGTERM');

    const [wrapperGone, promptGone, grandchildGone] = await Promise.all([
      waitForExit(wrapperPid),
      waitForExit(ready.promptPid),
      waitForExit(ready.grandchildPid),
    ]);

    expect(wrapperGone, `wrapper ${wrapperPid} survived the group stop`).toBe(true);
    expect(promptGone, `prompt ${ready.promptPid} survived the group stop — boundedRun must not detach it`).toBe(true);
    expect(grandchildGone, `grandchild ${ready.grandchildPid} survived the group stop`).toBe(true);
  });

  it('ends the prompt and its descendants when the caller process exits normally', async () => {
    outFile = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-group-stop-')) + '/out.log';

    wrapper = spawnStandin([outFile, '--exit-normally']);

    const ready = await new Promise<{ promptPid: number; grandchildPid: number }>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`stand-in did not report ready: ${buf}`)), 10_000);
      wrapper!.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        const m = /READY (\d+) (\d+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve({ promptPid: Number(m[1]), grandchildPid: Number(m[2]) });
        }
      });
    });

    // THE WRAPPER ENDS ITSELF — no signal from the test. `boundedRunProcess`'s
    // own `process.once('exit', ...)` handler is what must reap the prompt
    // tree here, since nothing external ever signals it.
    const exited = await new Promise<number | null>((resolve) => {
      wrapper!.on('exit', (code) => resolve(code));
    });
    expect(exited).toBe(0);

    const [promptGone, grandchildGone] = await Promise.all([
      waitForExit(ready.promptPid),
      waitForExit(ready.grandchildPid),
    ]);
    expect(promptGone, 'the prompt survived the caller\'s normal exit').toBe(true);
    expect(grandchildGone, 'the grandchild survived the caller\'s normal exit').toBe(true);
  });

  it('ends the prompt and its descendants when its own bound fires', async () => {
    outFile = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-group-stop-')) + '/out.log';

    // `--bound-seconds 1` tells the stand-in to pass a one-second bound to
    // `boundedRun` itself, rather than relying on an external signal — the
    // THIRD path this port's own timer covers, beside the group stop and the
    // caller's exit above.
    wrapper = spawnStandin([outFile, '--bound-seconds', '1']);

    const ready = await new Promise<{ promptPid: number; grandchildPid: number }>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`stand-in did not report ready: ${buf}`)), 10_000);
      wrapper!.stdout!.on('data', (c: Buffer) => {
        buf += c.toString();
        const m = /READY (\d+) (\d+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve({ promptPid: Number(m[1]), grandchildPid: Number(m[2]) });
        }
      });
    });

    const [promptGone, grandchildGone] = await Promise.all([
      waitForExit(ready.promptPid),
      waitForExit(ready.grandchildPid),
    ]);
    expect(promptGone, 'the prompt survived its own bound expiring').toBe(true);
    expect(grandchildGone, 'the grandchild survived the bound — the read-descendants-first order missed it').toBe(true);
  });
});
