#!/usr/bin/env node --experimental-strip-types
// THE STAND-IN PARENT — leads its own process group (the test spawns THIS
// file with `detached: true`, which is the one place `detached` belongs: it
// stands in for `start_worker`'s `set -m`). It calls the REAL
// `boundedRunProcess` adapter on a stand-in prompt, which itself spawns a
// grandchild — then reports every pid and does nothing further, so the test
// decides how this tree ends.
//
// Usage: node bounded-run-group-standin.mjs <outFile> [--exit-normally | --bound-seconds <n>]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = path.join(HERE, 'bounded-run-prompt.mjs');

const [, , outFile, mode, boundArg] = process.argv;
const boundSeconds = mode === '--bound-seconds' ? Number(boundArg) : 0;

const { processesShell } = await import('../../src/adapters/processes/processes-shell.ts');
const { boundedRunProcess } = await import('../../src/adapters/bounded-run/bounded-run-process.ts');

const processes = processesShell({ repoRoot: process.cwd(), scriptDir: '/nonexistent' });
const boundedRun = boundedRunProcess(processes);

// FIRE AND FORGET, matching how the loop calls `boundedRun`: this stand-in
// does not await the run because the test's whole point is ending it before
// it ever finishes. `node --experimental-strip-types` runs the prompt script
// directly.
const runPromise = boundedRun.run(process.execPath, ['--experimental-strip-types', PROMPT], {
  cwd: process.cwd(),
  boundSeconds,
  outFile,
});
void runPromise;

// WAIT FOR THE PROMPT TO REPORT ITS OWN CHILD, by polling the out file —
// `boundedRun` owns the process's stdio, so this reads the same file it
// writes to rather than attaching a second listener to the child.
const fs = await import('node:fs');
const waitForLine = async () => {
  for (;;) {
    let text = '';
    try {
      text = fs.readFileSync(outFile, 'utf8');
    } catch {
      /* not written yet */
    }
    const m = /PROMPT_CHILD (\d+) (\d+)/.exec(text);
    if (m) return { promptPid: Number(m[1]), grandchildPid: Number(m[2]) };
    await new Promise((r) => setTimeout(r, 50));
  }
};

const { promptPid, grandchildPid } = await waitForLine();
process.stdout.write(`READY ${promptPid} ${grandchildPid}\n`);

if (mode === '--exit-normally') {
  // THE CALLER'S EXIT, the second path `boundedRun`'s own `process.once('exit', ...)`
  // handler covers. Nothing signals this process; it simply returns.
  process.exit(0);
}

// Otherwise: wait to be SIGTERMed as a process group by the test.
setInterval(() => {}, 1 << 30);
