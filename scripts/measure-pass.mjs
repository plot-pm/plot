#!/usr/bin/env node
/**
 * What one agent pass's per-pass shell calls cost today, as a launcher would
 * cost them, and as one long-lived process answering in-process would cost
 * them — at 1, 4 and 8 concurrent agents.
 *
 * `docs/shell-and-domain.md` §1 keeps a script that runs once per agent per
 * pass in shell because a Node start costs 34 ms and a bundle answers in
 * 39 ms (measured 2026-09-07, one start, idle machine). That figure does not
 * measure a pass: it says nothing about N concurrent agents under load, and
 * nothing about CPU, which is what a loaded machine actually runs out of.
 * This is how the real number was taken, kept so a later reader can re-run it
 * and compare rather than re-derive.
 *
 *   node scripts/measure-pass.mjs [runs]
 *
 * It reads and decides. **It performs nothing**: every variant below reads a
 * value or runs a read-only `--self-check` / stub, and writes nothing to the
 * estate, so this is safe to run against a live repository with workers on
 * it. A grep for a mutating command (`git commit`, `git push`, `rm -f`, `>`
 * redirection into a real path) in this file returns none.
 *
 * Three variants, not shell against Node (`the-pass-is-measured`'s own
 * settled decision): the JS worker loop already pays a `bash` start per
 * script call, so `launcher` adds a `node` start behind it and `in-process`
 * removes both.
 *
 *   today       — `bash` + the script, spawned from the JS loop.
 *   launcher    — `bash` + a launcher + `node` + the bundle `launcher` execs.
 *   in-process  — a function call inside one long-lived process, no start.
 *
 * `launcher` converts no script under `skills/plot/scripts/`: it times the
 * bundle start a launcher conversion would ADD on top of today's call, using
 * `plot-worker-loop.mjs --self-check` as the bundle — a real, shipped bundle
 * of the size a converted per-pass script would answer through, run in its
 * read-only self-check mode so it performs nothing.
 */
import { execFile } from 'node:child_process';
import { loadavg, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const scriptsDir = join(repoRoot, 'skills/plot/scripts');
const runs = Number(process.argv[2] ?? 5);
const AGENT_COUNTS = [1, 4, 8];

/**
 * Times one child process with `/usr/bin/time -p`, which prints `real`,
 * `user` and `sys` in seconds on both BSD/macOS and GNU — the one thing
 * this script asks of the host, confirmed present before trusting it. A
 * non-zero exit or an unparseable result reads as an absent reading, never
 * a zero — the carried-over rule this measurement does not relax.
 */
const timedCpu = async (cmd, args, cwd) => {
  try {
    const { stderr } = await run('/usr/bin/time', ['-p', cmd, ...args], { cwd, timeout: 30_000 });
    const text = stderr ?? '';
    const real = Number(/real\s+([\d.]+)/.exec(text)?.[1]);
    const user = Number(/user\s+([\d.]+)/.exec(text)?.[1]);
    const sys = Number(/sys\s+([\d.]+)/.exec(text)?.[1]);
    if (!Number.isFinite(real) || !Number.isFinite(user) || !Number.isFinite(sys)) return { ok: false, why: 'unparseable' };
    return { ok: true, wallMs: real * 1000, cpuMs: (user + sys) * 1000 };
  } catch (err) {
    return { ok: false, why: err?.code !== undefined ? `exit ${err.code}` : String(err?.message ?? err) };
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** One variant's shell-level cost: `['cmd', args, cwd]`, or `null` for the in-process variant (timed separately). */
const VARIANTS = {
  today: {
    label: 'today — bash + script, spawned from the loop',
    exec: () => ['bash', [join(scriptsDir, 'plot-config.sh'), 'get', 'Worker bound', '28800'], repoRoot],
  },
  launcher: {
    label: 'launcher — bash + launcher + node + bundle (bundle start added on top of today)',
    exec: () => [
      'bash',
      ['-c', `node "${join(scriptsDir, 'board', 'plot-worker-loop.mjs')}" --self-check`],
      repoRoot,
    ],
  },
};

/** The in-process variant: a bare function call, no process start at all. */
const inProcessCall = () => {
  const worktree = process.env.PLOT_WORKTREE ?? repoRoot;
  void worktree;
  return 28_800;
};

const timeInProcessBatch = (concurrency) => {
  const start = process.hrtime.bigint();
  const startCpu = process.cpuUsage();
  for (let i = 0; i < concurrency; i += 1) inProcessCall();
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  const cpu = process.cpuUsage(startCpu);
  return { wallMs, cpuMs: (cpu.user + cpu.system) / 1000 };
};

const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : 'n/a');

console.log(`machine: ${cpus().length} cpu(s), load average ${loadavg().map((l) => l.toFixed(2)).join(' ')}`);
console.log(`runs per cell: ${runs}\n`);

const table = [];

for (const concurrency of AGENT_COUNTS) {
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const wallSamples = [];
    const cpuSamples = [];
    let failures = 0;
    for (let r = 0; r < runs; r += 1) {
      const loadBefore = loadavg()[0];
      const outcomes = await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const [cmd, args, cwd] = variant.exec();
          return timedCpu(cmd, args, cwd);
        }),
      );
      const ok = outcomes.filter((o) => o.ok);
      failures += outcomes.length - ok.length;
      if (ok.length === 0) continue;
      wallSamples.push(median(ok.map((o) => o.wallMs)));
      cpuSamples.push(median(ok.map((o) => o.cpuMs)));
      console.log(
        `${name} @ ${concurrency}: run ${r + 1}/${runs} — wall ${fmt(median(ok.map((o) => o.wallMs)))} ms, ` +
          `cpu ${fmt(median(ok.map((o) => o.cpuMs)))} ms, load ${loadBefore.toFixed(2)}, ` +
          `${ok.length}/${outcomes.length} answered`,
      );
    }
    table.push({
      variant: name,
      concurrency,
      wallMs: wallSamples.length > 0 ? median(wallSamples) : null,
      cpuMs: cpuSamples.length > 0 ? median(cpuSamples) : null,
      failures,
    });
  }

  // in-process: no process start, so no /usr/bin/time wrapper — timed directly.
  const wallSamples = [];
  const cpuSamples = [];
  for (let r = 0; r < runs; r += 1) {
    const { wallMs, cpuMs } = timeInProcessBatch(concurrency);
    wallSamples.push(wallMs / concurrency);
    cpuSamples.push(cpuMs / concurrency);
  }
  table.push({
    variant: 'in-process',
    concurrency,
    wallMs: median(wallSamples),
    cpuMs: median(cpuSamples),
    failures: 0,
  });
  console.log(
    `in-process @ ${concurrency}: wall ${fmt(median(wallSamples), 3)} ms, cpu ${fmt(median(cpuSamples), 3)} ms per call`,
  );
}

console.log('\n| variant | agents | wall ms/pass | cpu ms/pass | load avg | failures |');
console.log('|---|---|---|---|---|---|');
for (const row of table) {
  console.log(
    `| ${row.variant} | ${row.concurrency} | ${fmt(row.wallMs, 2)} | ${fmt(row.cpuMs, 2)} | ${loadavg()[0].toFixed(2)} | ${row.failures} |`,
  );
}

const launcherAt8 = table.find((r) => r.variant === 'launcher' && r.concurrency === 8);
const todayAt8 = table.find((r) => r.variant === 'today' && r.concurrency === 8);
if (launcherAt8?.cpuMs != null && todayAt8?.cpuMs != null && todayAt8.cpuMs > 0) {
  const addedPct = ((launcherAt8.cpuMs - todayAt8.cpuMs) / todayAt8.cpuMs) * 100;
  console.log(
    `\nlauncher adds ${fmt(addedPct, 1)} % CPU per pass at 8 agents (today ${fmt(todayAt8.cpuMs)} ms, launcher ${fmt(launcherAt8.cpuMs)} ms)`,
  );
  console.log(`threshold is 5 % — route ${addedPct < 5 ? '1 (launchers)' : '2 (in-process)'} by the settled threshold`);
} else {
  console.log('\ncould not compute the launcher overhead at 8 agents — an absent reading, not a zero; re-run or inspect failures above');
}
