#!/usr/bin/env node --experimental-strip-types
// THE STAND-IN PARENT — leads its own process group (the test spawns THIS
// file with `detached: true`, which is the one place `detached` belongs: it
// stands in for `start_worker`'s `set -m`). It calls the REAL
// `boundedRunProcess` adapter on a stand-in prompt, which itself spawns a
// grandchild — then reports every pid and does nothing further, so the test
// decides how this tree ends.
//
// Usage: node bounded-run-group-standin.mjs <outFile> [flags...]
//   --exit-normally        the STAND-IN itself exits 0 once the prompt has
//                           reported ready — the caller's own end, the
//                           second path `boundedRun`'s `process.once('exit')`
//                           handler covers. The run's child (the prompt)
//                           never finishes on its own in this mode.
//   --bound-seconds <n>    passes a bound to boundedRun itself.
//   --late-signal          after READY, kills its own prompt, waits
//                          (synchronously, by state) for it to zombie, then
//                          signals itself — forcing the child-end and the
//                          signal into one event-loop turn.
//   --own-listener         registers a caller-owned `once('SIGTERM')` before
//                          the run starts, which exits 7 after an `await`.
//   --finish-run           runs a short command instead of the persistent
//                          stand-in prompt, so the RUN finishes (the count
//                          drops to zero) while the STAND-IN process stays
//                          alive — reports RUN_FINISHED once it has, then
//                          waits to be signalled, same as the default mode.
//   --second-run <outFile2> starts a SECOND boundedRun alongside the first,
//                           ends its own child, waits for both READY lines,
//                           then reports both as `READY a b c d`.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = path.join(HERE, 'bounded-run-prompt.mjs');

const [, , outFile, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const boundSeconds = flags.has('--bound-seconds') ? Number(rest[rest.indexOf('--bound-seconds') + 1]) : 0;
const secondOutFile = flags.has('--second-run') ? rest[rest.indexOf('--second-run') + 1] : undefined;

const { processesShell } = await import('../../src/adapters/processes/processes-shell.ts');
const { boundedRunProcess } = await import('../../src/adapters/bounded-run/bounded-run-process.ts');

const processes = processesShell({ repoRoot: process.cwd(), scriptDir: '/nonexistent' });
const boundedRun = boundedRunProcess(processes);

if (flags.has('--own-listener')) {
  // THE CALLER'S OWN LISTENER — registered BEFORE the run starts, so it is
  // already on the signal's listener list when the adapter's process-wide
  // handler checks `process.listenerCount(signal)`. It exits 7 after an
  // `await`, matching the Done-when row: between runs, the caller's listener
  // alone acts.
  process.once('SIGTERM', async () => {
    await new Promise((r) => setTimeout(r, 10));
    process.exit(7);
  });
}

/** Waits for the stand-in prompt's `PROMPT_CHILD <pid> <pid>` line in `file`. */
const waitForLine = async (file) => {
  for (;;) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      /* not written yet */
    }
    const m = /PROMPT_CHILD (\d+) (\d+)/.exec(text);
    if (m) return { promptPid: Number(m[1]), grandchildPid: Number(m[2]) };
    await new Promise((r) => setTimeout(r, 50));
  }
};

if (flags.has('--finish-run')) {
  // A RUN THAT FINISHES ON ITS OWN, while THIS process stays alive — the
  // state Done-when row 3 needs: no live run, but the caller (this process)
  // is still here to have its own listener act. `sh -c 'exit 0'` is not the
  // persistent stand-in prompt; it ends immediately, so the run's own
  // `finish()` runs well before any signal does. SELF-CONTAINED: this mode
  // never falls through to the persistent-prompt run below, which would keep
  // a second run live and defeat the "no live run" state this row needs.
  const result = await boundedRun.run('sh', ['-c', 'exit 0'], {
    cwd: process.cwd(),
    boundSeconds: 0,
    outFile,
  });
  if (!result.ok || result.value.status !== 0) {
    process.stderr.write(`--finish-run: unexpected result ${JSON.stringify(result)}\n`);
    process.exit(1);
  }
  process.stdout.write('RUN_FINISHED\n');
  // Wait to be SIGTERMed by the test, same as the default mode.
  setInterval(() => {}, 1 << 30);
} else {
  // FIRE AND FORGET, matching how the loop calls `boundedRun`: this stand-in
  // does not await the run because the test's whole point is ending it before
  // it ever finishes. `node --experimental-strip-types` runs the prompt script
  // directly.
  void boundedRun.run(process.execPath, ['--experimental-strip-types', PROMPT], {
    cwd: process.cwd(),
    boundSeconds,
    outFile,
  });

  const ready = await waitForLine(outFile);

  let secondReady;
  if (secondOutFile) {
    // A SECOND, INDEPENDENT RUN — proves the live-run COUNT, not a boolean: the
    // first run's `finish()` must not make the process-wide listener treat the
    // process as having no live run while the second is still going.
    void boundedRun.run(process.execPath, ['--experimental-strip-types', PROMPT], {
      cwd: process.cwd(),
      boundSeconds: 0,
      outFile: secondOutFile,
    });
    secondReady = await waitForLine(secondOutFile);
    process.stdout.write(`READY ${ready.promptPid} ${ready.grandchildPid} ${secondReady.promptPid} ${secondReady.grandchildPid}\n`);
  } else {
    process.stdout.write(`READY ${ready.promptPid} ${ready.grandchildPid}\n`);
  }

  if (flags.has('--exit-normally')) {
    // THE CALLER'S EXIT, the second path `boundedRun`'s own `process.once('exit', ...)`
    // handler covers. Nothing signals this process; it simply returns.
    process.exit(0);
  }

  if (flags.has('--late-signal')) {
    // FORCES THE CHILD-FIRST ORDER BY STATE, NEVER BY A SLEEP OR A BUSY LOOP OF
    // A SET LENGTH: this process kills its own prompt, then polls `ps -o stat=`
    // synchronously until the kernel reports the prompt reaped to `Z` (a
    // zombie — its SIGCHLD is now pending for this process), and only then
    // signals itself. Both the child's end and the self-SIGTERM land in this
    // ONE synchronous block, so the dispatch of both reaches the event loop in
    // the same turn — the exact ordering the lost-signal defect needs.
    process.kill(ready.promptPid, 'SIGKILL');
    for (;;) {
      let stat = '';
      try {
        stat = execFileSync('ps', ['-o', 'stat=', '-p', String(ready.promptPid)], { encoding: 'utf8' }).trim();
      } catch {
        // `ps` found no such pid: already reaped past zombie, which can only
        // happen if something else reaped it first. Treat as ready either way.
        break;
      }
      if (stat.startsWith('Z')) break;
    }
    process.kill(process.pid, 'SIGTERM');
  }

  // Otherwise: wait to be SIGTERMed as a process group by the test.
  setInterval(() => {}, 1 << 30);
}
