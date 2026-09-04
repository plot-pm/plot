#!/usr/bin/env node
/**
 * What one supervisor tick costs, against this repository's live registry.
 *
 * The plan's open question — *what tick interval?* — asks for the tick's own
 * cost first. This is how that number was taken, kept so a later reader can
 * re-run it and compare rather than re-derive.
 *
 *   node scripts/measure-tick.mjs [runs]
 *
 * It reads and decides. **It performs nothing**: the tick returns a decision
 * naming every write and makes none, so this is safe to run against a live
 * estate with workers on it.
 *
 * The dominant term is the host call — one `prMerged` per agent — so the number
 * moves with how many agents the registry holds and with whether the host is
 * reachable. Both are reported.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const scriptsDir = join(repoRoot, 'skills/plot/scripts');
const runs = Number(process.argv[2] ?? 3);

/** One shell call, returning stdout or '' when it failed. */
const sh = async (cmd, args, cwd = repoRoot) => {
  try {
    const { stdout } = await run(cmd, args, { cwd, timeout: 60_000 });
    return stdout;
  } catch {
    return '';
  }
};

/**
 * Where the registry is, from the `Agent registry` config key.
 *
 * Read rather than assumed: the key exists precisely so several checkouts may
 * share one directory, and this estate does — `.plot/agents` in a worktree is
 * empty while the configured directory holds every manifest.
 */
const registryDir = async () => {
  const answer = await sh('bash', [
    join(scriptsDir, 'plot-config.sh'),
    'get',
    'Agent registry',
    '.plot/agents',
  ]);
  const configured = answer.trim();
  if (configured === '') return join(repoRoot, '.plot/agents');
  return configured.startsWith('/') ? configured : join(repoRoot, configured);
};

/** Reads the registry's manifests, the way the daemon's first step does. */
const registry = async () => {
  const dir = await registryDir();
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      entries.push(JSON.parse(await readFile(join(dir, name), 'utf8')));
    } catch {
      // A manifest that does not parse is not this measurement's subject.
    }
  }
  return entries;
};

/** Every reading one tick takes about one agent, timed by kind. */
const timings = { host: 0, git: 0, disk: 0, machine: 0 };

const timed = async (kind, fn) => {
  const start = performance.now();
  const value = await fn();
  timings[kind] += performance.now() - start;
  return value;
};

const readAgent = async (entry) => {
  const { branch = '', worktree = '' } = entry;
  await timed('host', () =>
    sh('bash', [join(scriptsDir, 'plot-host.sh'), 'pr-list', 'all', '--head', branch]),
  );
  await timed('git', () => sh('git', ['status', '--porcelain'], worktree || repoRoot));
  await timed('git', () =>
    sh('git', ['rev-list', '--count', 'HEAD', '--not', '--remotes'], worktree || repoRoot),
  );
  await timed('disk', async () => {
    for (const name of ['.plot-worker.envelope.json', '.plot-worker.pid']) {
      if (worktree && existsSync(join(worktree, name))) {
        await readFile(join(worktree, name), 'utf8').catch(() => '');
      }
    }
    if (worktree) await readdir(join(worktree, '.changeset')).catch(() => []);
    return null;
  });
};

const machine = () =>
  timed('machine', async () => {
    const start = performance.now();
    await sh('true', []);
    return performance.now() - start;
  });

const entries = await registry();
console.log(`registry: ${entries.length} agent(s) in ${await registryDir()}`);
if (entries.length === 0) {
  console.log('nothing to measure — the tick over an empty registry is one readdir.');
  process.exit(0);
}

const costs = [];
for (let i = 0; i < runs; i += 1) {
  for (const key of Object.keys(timings)) timings[key] = 0;
  const start = performance.now();
  await machine();
  for (const entry of entries) await readAgent(entry);
  const cost = performance.now() - start;
  costs.push(cost);
  console.log(
    `run ${i + 1}: ${cost.toFixed(0)} ms total — ` +
      Object.entries(timings)
        .map(([kind, ms]) => `${kind} ${ms.toFixed(0)} ms`)
        .join(', '),
  );
}

const total = costs.reduce((a, b) => a + b, 0) / costs.length;
console.log(
  `\nmean: ${total.toFixed(0)} ms for ${entries.length} agent(s) ` +
    `= ${(total / entries.length).toFixed(0)} ms per agent`,
);
