#!/usr/bin/env node
/**
 * What the PreToolUse gates cost one Bash call: the five `plot-*-gate.sh` hooks
 * run one after another, against the one launcher `plot-gates.sh`.
 *
 * `the-gates-are-launchers` accepts a gate slice only if one launcher costs no
 * more CPU than the shell gates it replaces at the same load. A fixed
 * millisecond number would not hold: the plan's own figures were taken at load
 * average 18.0 on 16 cores. This prints the load beside every figure, so each
 * slice re-runs the same comparison and reports it in its PR.
 *
 *   node scripts/measure-gates.mjs [runs] [command]
 *
 * `command` defaults to `ls -la`: no commit, no gated script, which is the
 * common Bash call. It reads and decides; the hook JSON goes to each script on
 * stdin and nothing is written to the repository. Run it in a clean checkout —
 * a gate that finds a staged transition refuses, and refusing costs more.
 *
 * Variants:
 *
 *   shell     the five `plot-*-gate.sh` scripts, each started with the hook JSON.
 *   launcher  `plot-gates.sh --all`, one start.
 *
 * CPU is the user+system time of the children, read from bash's `times`.
 * Reported figures are medians over `runs` (default 7).
 */
import { spawnSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'skills/plot/scripts');
const runs = Number(process.argv[2] ?? 7);
const command = process.argv[3] ?? 'ls -la';
const payload = JSON.stringify({ tool_input: { command } });

const SHELL_GATES = ['phase', 'state', 'brief-name', 'bundle-commit', 'controller'].map((n) =>
  join(scripts, `plot-${n}-gate.sh`),
);
const LAUNCHER = [join(scripts, 'plot-gates.sh')];

/** `0m0.045s` → milliseconds. */
const ms = (text) => {
  const [, m, s] = /(\d+)m([\d.]+)s/.exec(text) ?? [];
  return (Number(m) * 60 + Number(s)) * 1000;
};

/** One call: wall ms and children's CPU ms for starting each script once. */
const once = (gates) => {
  const body = `${gates.map((g) => `bash "${g}" "$@" <<<"$PAYLOAD" >/dev/null 2>&1`).join('\n')}\ntimes`;
  const start = process.hrtime.bigint();
  const r = spawnSync('bash', ['-c', body], { env: { ...process.env, PAYLOAD: payload }, encoding: 'utf8' });
  const wall = Number(process.hrtime.bigint() - start) / 1e6;
  const [user, sys] = r.stdout.trim().split('\n').slice(-1)[0].split(/\s+/);
  return { wall, cpu: ms(user) + ms(sys) };
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`command: ${command}`);
console.log(`runs: ${runs}   load avg: ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`);
console.log('variant   wall ms   cpu ms');
for (const [name, gates] of [['shell', SHELL_GATES], ['launcher', LAUNCHER]]) {
  const samples = Array.from({ length: runs }, () => once(gates));
  console.log(`${name.padEnd(9)} ${median(samples.map((s) => s.wall)).toFixed(1).padStart(7)}   ${median(samples.map((s) => s.cpu)).toFixed(1).padStart(6)}`);
}
