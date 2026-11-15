import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { spawnLogOf, startFleetd } from './fleetd-driver.js';
import { isPs, isWorkerStateSource, probeLogLines, readProbeCalls, writeProbeShims, type ProbeCall } from './probe-shims.js';
import { buildSandbox, type Sandbox } from './sandbox.js';

// The desk-probe inventory: every `ps` and every sourcing of
// `plot-worker-state.sh` that fleetd starts per idle pass on the GitHub
// fixture with three desks, with its full argv and the TypeScript site that
// started its process tree. Logging shims on `PATH` record the calls, so the
// suite needs no `strace` and runs on macOS too. `CENSUS_INVENTORY_OUT=<file>`
// writes the inventory as markdown.

const IDLE_PASSES = 2;

/** The grouping key of one call: the site that started its tree, the direct child, and the call's argv. */
const keyOf = (call: ProbeCall): string =>
  `${call.caller || '(no tracked caller)'}\t${call.child || `parent: ${call.parent}`}\t${call.tool} ${call.argv.join(' ').replace(/ \d+$/, ' <pid>')}`;

/** Calls per pass for each key, sorted by count, as markdown table rows. */
const tableOf = (calls: readonly ProbeCall[], passes: number): string[] => {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(keyOf(call), (counts.get(keyOf(call)) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => {
      const [caller, child, argv] = key.split('\t');
      return `| ${n / passes} | \`${caller}\` | \`${child}\` | \`${(argv ?? '').replace(/\|/g, '\\|').slice(0, 160)}\` |`;
    });
};

let entry: FleetdEntry | undefined;

beforeAll(async () => {
  entry = await buildFleetdEntry();
}, 120_000);

afterAll(() => {
  entry?.remove();
});

describe('the desk-probe inventory: fleetd on github, 3 desks, 5 open PRs', () => {
  let box: Sandbox;
  let idle: ProbeCall[] = [];

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 3, openPrs: 5 });
    const log = join(box.root, 'probe-calls.tsv');
    writeProbeShims(join(box.root, 'bin'), log, ['ps', 'dirname']);
    const traced: Sandbox = { ...box, env: { ...box.env, CENSUS_SPAWN_CALLER: '1' } };
    const fleetd = startFleetd(entry as FleetdEntry, traced, { trace: false, spawnLog: spawnLogOf(box) });
    try {
      await fleetd.pass();
      const from = probeLogLines(log);
      for (let n = 0; n < IDLE_PASSES; n += 1) await fleetd.pass();
      idle = readProbeCalls(log, from);
    } finally {
      await fleetd.stop();
    }
    const ps = idle.filter(isPs);
    const sources = idle.filter(isWorkerStateSource);
    const report = [
      `# Desk-probe inventory (github, 3 desks, 5 open PRs, mean of ${IDLE_PASSES} idle passes)`,
      '',
      `\`ps\` per pass: ${ps.length / IDLE_PASSES}; sourcings of \`plot-worker-state.sh\` per pass: ${sources.length / IDLE_PASSES}.`,
      '',
      '## `ps`',
      '',
      '| per pass | TypeScript caller | direct child | argv |',
      '|---|---|---|---|',
      ...tableOf(ps, IDLE_PASSES),
      '',
      '## Sourcings of `plot-worker-state.sh`',
      '',
      '| per pass | TypeScript caller | direct child | argv |',
      '|---|---|---|---|',
      ...tableOf(sources, IDLE_PASSES),
      '',
    ].join('\n');
    const out = process.env['CENSUS_INVENTORY_OUT'];
    if (out !== undefined && out !== '') writeFileSync(out, report);
    console.log(report);
  }, 900_000);

  afterAll(async () => {
    await box?.remove();
  });

  it('records the calls of the idle passes', () => {
    expect(idle.length).toBeGreaterThan(0);
  });

  it('starts no sourcing of plot-worker-state.sh from the processes adapter', () => {
    const fromAdapter = idle.filter((call) => isWorkerStateSource(call) && call.caller.includes('adapters/processes/'));
    expect(fromAdapter.map(keyOf)).toEqual([]);
  });

  it('starts no sourcing of plot-worker-state.sh from the trees adapter', () => {
    const fromAdapter = idle.filter((call) => isWorkerStateSource(call) && call.caller.includes('adapters/trees/'));
    expect(fromAdapter.map(keyOf)).toEqual([]);
  });

  it('reads the process table at most once per pass from the processes adapter', () => {
    const tables = idle.filter((call) => isPs(call) && call.caller.includes('adapters/processes/'));
    expect(tables.length / IDLE_PASSES).toBeLessThanOrEqual(1);
  });
});
