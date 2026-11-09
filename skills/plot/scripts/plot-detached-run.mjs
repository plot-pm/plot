#!/usr/bin/env node
// Starts one board-role agent so that it outlives the board, and records its end.
//
//   plot-detached-run.mjs <role> <harness> <log> <boundSeconds> <state>... -- <command> [args...]
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
// ends, the waiter reads the last 200 lines the command appended through
// `board/plot-prompt-exit.mjs` with <harness>'s limit lines, as the `command`
// runner reads them, and writes one code into every <state> file:
//   - `0` for a status-0 exit that the rule reads as `ran`;
//   - `1` for a usage-limit exit (`wait`, `end-limited`) or for background work
//     that the run dropped (`dropped`), whatever the status;
//   - the exit status, or `128 + signal number`, for any other exit;
//   - `124` where the bound ended the command; `127` where it did not start.
// For every code but `0` it first appends one line that names <role> and the
// reason to <log>. Where the bundle cannot be loaded, the waiter writes the exit
// status and appends no line. Each state write is a temporary file in the state
// file's directory renamed over the state file, so a reader never reads half a
// code.
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

/** The pieces of the command line: `[role, harness, log, bound, states, command]`. */
const parse = (argv) => {
  const split = argv.indexOf('--');
  const [role, harness, log, bound, ...states] = argv.slice(0, split);
  return [role, harness, log, Number(bound), states, argv.slice(split + 1)];
};

/** The bytes the command appended to the log since `offset`, as text; `''` where the log cannot be read. */
const appendedSince = (log, offset) => {
  try {
    return fs.readFileSync(log).subarray(offset).toString('utf8');
  } catch {
    return '';
  }
};

/**
 * The code and log line for one exit that the bound did not end, read as
 * `boardRunEnd` reads the `command` runner's end.
 *
 * @returns `[code, line]`; `line` is `''` for none.
 */
const classified = async (role, harness, bound, code, status, ranSeconds, output) => {
  let answer = '';
  try {
    const { run } = await import(path.join(import.meta.dirname, 'board', 'plot-prompt-exit.mjs'));
    const argv = [status, harness, Math.floor(Date.now() / 1000), bound, ranSeconds, 0, 0].map(String);
    run(argv, output, (text) => (answer += text), () => {});
  } catch {
    return [code, ''];
  }
  const [kind, ...fields] = answer.replace(/\n$/, '').split('\t');
  switch (kind) {
    case 'ran':
      return [0, ''];
    case 'wait':
      return [1, `the ${role} run stopped at the account's usage limit, which resets at ${fields[1]}`];
    case 'end-limited':
      return [1, `the ${role} run stopped at the account's usage limit (${fields[2]})`];
    case 'dropped':
      return [1, `the ${role} run ended with its background work dropped: ${fields.join('\t')}`];
    case 'unstarted':
      return [code === 0 ? 1 : code, `the ${role} run did not start: the command exited with status ${code}`];
    default:
      return [code, ''];
  }
};

const wait = (role, harness, log, bound, states, command) => {
  const offset = fs.existsSync(log) ? fs.statSync(log).size : 0;
  const startedAt = Date.now();
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
  let ended = false;
  const end = async (code, status, why) => {
    if (ended) return;
    ended = true;
    if (timer) clearTimeout(timer);
    let [final, line] = [code, why];
    if (timedOut) [final, line] = [124, `the ${role} run was ended at its time bound`];
    else if (why === '') {
      const output = appendedSince(log, offset).split('\n').slice(-200).join('\n');
      const ranSeconds = Math.round((Date.now() - startedAt) / 1000);
      [final, line] = await classified(role, harness, bound, code, status, ranSeconds, output);
    }
    if (line !== '') {
      try {
        fs.appendFileSync(log, `${line}\n`);
      } catch {
        /* the code still records the end */
      }
    }
    for (const state of states) record(state, String(final));
    process.exit(0);
  };
  child.on('error', (err) => void end(127, 127, `the ${role} run did not start: ${err.message}`));
  // A signalled exit reads as status 124 to the rule, as the `command` runner passes it.
  child.on('close', (status, signal) => void end(status ?? 128 + (constants.signals[signal] ?? 0), status ?? 124, ''));
};

const launch = (role, harness, log, bound, states, command) => {
  const waiter = spawn(process.execPath, [process.argv[1], '--wait', role, harness, log, String(bound), ...states, '--', ...command], {
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
  const args = parse(process.argv.slice(3));
  process.stdin.resume();
  process.stdin.on('end', () => wait(...args));
} else {
  launch(...parse(process.argv.slice(2)));
}
