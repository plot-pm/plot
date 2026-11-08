#!/usr/bin/env node
// Starts one board-role agent so that it outlives the board, and records its end.
//
//   plot-detached-run.mjs <log> <boundSeconds> <state>... -- <command> [args...]
//
// The launcher starts a waiter in its own session and exits. The waiter's
// parent is then init/launchd, so `plot-boardctl.sh --stop`, which walks the
// board's descendants by parent chain, does not reach it. `detached: true` on a
// child of the board does not do this: that child keeps the board as its parent.
//
// Before it exits the launcher writes `running <waiterPid> <startedAtMs> detached`
// into every <state> file and prints the waiter's pid on stdout. The waiter
// starts <command> only after the launcher closes its stdin, so the end record
// can never be written before the marker. The command appends to <log>. When it
// ends, the waiter writes its exit code into every <state> file: `124` where the
// bound ended it, `128 + signal number` where a signal ended it. Each write is a
// temporary file in the state file's directory renamed over the state file, so a
// reader never reads half a code.
//
// A <boundSeconds> of 0 sets no bound.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/** Replaces a state file's content in one rename. */
const record = (file, text) => {
  const scratch = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(scratch, text, 'utf8');
    fs.renameSync(scratch, file);
  } catch {
    fs.rmSync(scratch, { force: true });
  }
};

/** The pieces of the command line: `[log, bound, states, command]`. */
const parse = (argv) => {
  const split = argv.indexOf('--');
  const [log, bound, ...states] = argv.slice(0, split);
  return [log, Number(bound), states, argv.slice(split + 1)];
};

const wait = (log, bound, states, command) => {
  const out = fs.openSync(log, 'a');
  // Its own group, so a bound reaches the command's descendants.
  const child = spawn(command[0], command.slice(1), { detached: true, stdio: ['ignore', out, out] });
  let timedOut = false;
  const timer =
    bound > 0
      ? setTimeout(() => {
          timedOut = true;
          const signal = (name) => {
            try {
              process.kill(-child.pid, name);
            } catch {
              /* already gone */
            }
          };
          signal('SIGTERM');
          setTimeout(() => signal('SIGKILL'), 5000).unref();
        }, bound * 1000)
      : null;
  const end = (code) => {
    if (timer) clearTimeout(timer);
    for (const state of states) record(state, String(timedOut ? 124 : code));
    process.exit(0);
  };
  child.on('error', () => end(127));
  child.on('close', (status, signal) => end(status ?? 128 + (constants.signals[signal] ?? 0)));
};

const launch = (log, bound, states, command) => {
  const waiter = spawn(process.execPath, [process.argv[1], '--wait', log, String(bound), ...states, '--', ...command], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  if (waiter.pid === undefined) process.exit(1);
  const marker = `running ${waiter.pid} ${Date.now()} detached`;
  for (const state of states) record(state, marker);
  process.stdout.write(`${waiter.pid}\n`);
  waiter.stdin.end();
  waiter.unref();
};

if (process.argv[2] === '--wait') {
  const [log, bound, states, command] = parse(process.argv.slice(3));
  process.stdin.resume();
  process.stdin.on('end', () => wait(log, bound, states, command));
} else {
  launch(...parse(process.argv.slice(2)));
}
