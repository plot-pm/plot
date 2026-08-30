import { describe, it, expect } from 'vitest';

import { clockSystem } from '../src/adapters/clock/clock-system.js';
import { hostShell } from '../src/adapters/host/host-shell.js';
import { machineSystem } from '../src/adapters/machine/machine-system.js';
import { planStoreShell } from '../src/adapters/plan-store/plan-store-shell.js';
import { processesShell } from '../src/adapters/processes/processes-shell.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';
import { headroomFor } from '../src/entities/machine.js';
import { isAnswered } from '../src/port-result.js';

/**
 * The slice's own Done-when: the domain can be handed this repository's real
 * state through ports only.
 *
 * These run against the checkout the suite is in — no fixtures, and no host
 * beyond what git already holds locally. A fixture agrees with whatever wrote
 * it; this file is the first evidence that the adapters read the same estate
 * production reads.
 *
 * Nothing here asserts a COMPARISON with production's own reading. That is the
 * Agreeing slice, which runs `plot-plan-meta.sh` and the adapter over all the
 * repository's plans and matches them field for field. What is asserted here is
 * narrower and is the precondition for it: every port answers, and what it
 * answers is the shape the domain declared.
 */

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;
const context = shellContext(REPO_ROOT);

describe('PlanStore reads this repository’s plans', () => {
  it('lists plans and parses one of them', async () => {
    const store = planStoreShell(context);

    const files = await store.listPlans();
    expect(files.ok).toBe(true);
    if (!isAnswered(files)) return;
    expect(files.value.length).toBeGreaterThan(0);

    const plan = await store.readPlan(files.value[0]!);
    expect(plan.ok).toBe(true);
    if (!isAnswered(plan)) return;
    expect(plan.value.file).toBe(files.value[0]);
    expect(typeof plan.value.phase).toBe('string');
  });

  it('reads every plan in one call, and reports each one’s phase', async () => {
    const store = planStoreShell(context);
    const files = await store.listPlans();
    if (!isAnswered(files)) throw new Error('could not list plans');

    const plans = await store.readPlans(files.value);
    expect(plans.ok).toBe(true);
    if (!isAnswered(plans)) return;
    expect(plans.value.length).toBeGreaterThan(0);
    // Every plan is one of the lifecycle phases, or one of the parser's two
    // ABSENCES — and those two are not the same answer. `NONE` is a file that
    // stated no phase, which in `docs/plans/` means a decision log or a worker
    // report rather than a malformed plan; `UNKNOWN` is a plan whose phase
    // nobody recognises. Collapsing them here would hide the second behind the
    // first, which is the failure this whole layer is shaped against.
    const KNOWN = [
      'draft',
      'approved',
      'delivered',
      'released',
      'rejected',
      'superseded',
      'NONE',
      'UNKNOWN',
    ];
    // Asserted as ONE empty-array comparison rather than a loop of `toContain`.
    // `it.each` cannot serve here — the cases only exist after `readPlans`
    // resolves, and it needs them at collection time. What the loop cost was
    // diagnosis: over 170 plans it reported "expected [...8 values] to contain
    // 'weird'" and named neither the plan nor how many were wrong. The offenders
    // carry their file, so a failure prints what to open.
    const unknown = plans.value
      .filter((plan) => !KNOWN.includes(plan.phase))
      .map((plan) => `${plan.file}: ${plan.phase}`);
    expect(unknown).toEqual([]);
    // And the estate really does hold both kinds: a lifecycle phase somewhere,
    // so this is not vacuous.
    expect(
      plans.value.some((plan) => plan.phase === 'delivered' || plan.phase === 'approved'),
    ).toBe(true);
  });

  it('finds this plan and the slice that produced this branch', async () => {
    const store = planStoreShell(context);
    const files = await store.listPlans();
    if (!isAnswered(files)) throw new Error('could not list plans');
    const plans = await store.readPlans(files.value);
    if (!isAnswered(plans)) throw new Error('could not read plans');

    const owning = plans.value.find((plan) =>
      plan.branches.includes('feature/the-ports-have-adapters'),
    );
    expect(owning).toBeDefined();
    // The slice spelling resolves whichever heading the plan used: the parser
    // still emits `waves`, and a reader that took only one spelling would
    // report a plan with branches and no slices.
    expect(owning?.slices.length).toBeGreaterThan(0);
  });

  it('reads a config key, and falls back where there is none', async () => {
    const store = planStoreShell(context);

    const dir = await store.config('Plan directory', 'unset');
    expect(dir).toEqual({ ok: true, value: 'docs/plans/' });

    const absent = await store.config('No Such Key At All', 'the-fallback');
    expect(absent).toEqual({ ok: true, value: 'the-fallback' });
  });
});

describe('Refs reads this repository’s git state', () => {
  it('names the default branch', async () => {
    const refs = refsGit(context);
    const main = await refs.defaultBranch();
    expect(main.ok).toBe(true);
    if (isAnswered(main)) expect(main.value.length).toBeGreaterThan(0);
  });

  it('lists local branches, this one among them', async () => {
    const refs = refsGit(context);
    const branches = await refs.listBranches(false);
    expect(branches.ok).toBe(true);
    if (isAnswered(branches)) {
      expect(branches.value).toContain('feature/the-ports-have-adapters');
    }
  });

  it('resolves a ref to a sha', async () => {
    const refs = refsGit(context);
    const sha = await refs.resolve('HEAD');
    expect(sha.ok).toBe(true);
    if (isAnswered(sha)) expect(sha.value).toMatch(/^[0-9a-f]{40}$/);
  });

  it('fails on a ref that does not exist rather than answering', async () => {
    const refs = refsGit(context);
    const sha = await refs.resolve('refs/heads/no-such-branch-xyz');
    expect(sha.ok).toBe(false);
  });

  it('answers merge status with three values, never a boolean', async () => {
    const refs = refsGit(context);
    const status = await refs.isMergedByAncestry('feature/the-ports-have-adapters');
    expect(status.ok).toBe(true);
    if (isAnswered(status)) {
      expect(['merged', 'not-merged', 'unknown']).toContain(status.value);
    }
  });

  it('reads a file at a ref rather than from the working tree', async () => {
    // A phase read from the working tree is an approval nobody else can see.
    const refs = refsGit(context);
    const content = await refs.showFile('HEAD', 'CLAUDE.md');
    expect(content.ok).toBe(true);
    if (isAnswered(content)) expect(content.value).toContain('Plot Config');
  });
});

describe('Trees reads the worktrees on this machine', () => {
  it('lists them, this one among them', async () => {
    const trees = treesGit(context);
    const all = await trees.list();
    expect(all.ok).toBe(true);
    if (!isAnswered(all)) return;
    expect(all.value.length).toBeGreaterThan(0);
    expect(all.value.filter((tree) => tree.isMain)).toHaveLength(1);
  });

  it('answers null for a branch no worktree holds, rather than failing', async () => {
    // Finding nothing is an answer. A caller that got a failure here would
    // retry a question that is already settled.
    const trees = treesGit(context);
    const found = await trees.forBranch('branch/that-never-existed-xyz');
    expect(found).toEqual({ ok: true, value: null });
  });

  it('reports no markers where a tree carries none', async () => {
    const trees = treesGit(context);
    const markers = await trees.markers(REPO_ROOT, 'PLOT-NO-SUCH-MARKER');
    expect(markers).toEqual({ ok: true, value: [] });
  });
});

describe('Processes reads this machine’s process table', () => {
  it('knows its own pid is alive', async () => {
    const processes = processesShell(context);
    expect(await processes.isAlive(process.pid)).toEqual({ ok: true, value: true });
  });

  it('reports an absent worker as `none` rather than failing', async () => {
    // A desk with no worker is a reading, not a broken question.
    const processes = processesShell(context);
    const reading = await processes.workerState('/tmp/plot-no-such-worktree-xyz', false);
    expect(reading.ok).toBe(true);
    if (isAnswered(reading)) expect(reading.value.state).toBe('none');
  });
});

describe('Clock and Machine answer about now and here', () => {
  it('reads a time that is a time', () => {
    const now = clockSystem().now();
    expect(now.ok).toBe(true);
    if (isAnswered(now)) expect(now.value).toBeGreaterThan(1_700_000_000_000);
  });

  it('measures a spawn cost the domain can read as headroom', async () => {
    const machine = machineSystem(context);
    const reading = await machine.measure(3);
    expect(reading.ok).toBe(true);
    if (!isAnswered(reading)) return;
    expect(reading.value.cores).toBeGreaterThan(0);
    // The adapter measured; the DOMAIN decides. An adapter that returned a
    // verdict would be an adapter deciding.
    expect(['clear', 'tight', 'starved', 'unmeasured']).toContain(
      headroomFor(reading.value.spawnCostMs),
    );
  });

  it('refuses to measure zero samples rather than dividing by them', async () => {
    const machine = machineSystem(context);
    expect(await machine.measure(0)).toEqual({ ok: false, why: 'failed' });
  });

  it('names this machine', async () => {
    const named = await machineSystem(context).hostname();
    expect(named.ok).toBe(true);
    if (isAnswered(named)) expect(named.value.length).toBeGreaterThan(0);
  });
});

describe('Host reads the git host', () => {
  it('names the backend', async () => {
    const answer = await hostShell(context).backend();
    expect(answer.ok).toBe(true);
    if (isAnswered(answer)) expect(['github', 'bitbucket']).toContain(answer.value);
  });

  it('answers the merged question with three values', async () => {
    // The operation this slice added to plot-host.sh. `unknown` is a payload:
    // every caller of this is deciding whether to remove something, so a host
    // that cannot be asked must not answer `not-merged`.
    const answer = await hostShell(context).prMerged('branch/that-never-existed-xyz');
    expect(answer.ok).toBe(true);
    if (isAnswered(answer)) {
      expect(['merged', 'not-merged', 'unknown']).toContain(answer.value);
    }
  });
});

describe('the package exposes the ports and hides the adapters', () => {
  it('exports every port as a type, the Machine port disambiguated', async () => {
    // A type-only assertion: these compile or they do not, and `tsc --noEmit`
    // in CI is what runs it. The entity and the port share the name `Machine`
    // because DESIGN-ports.md names a port for what it is asked ABOUT — so the
    // barrel renames one and each file keeps the name its own spec gives it.
    const index: typeof import('../src/index.js') = await import('../src/index.js');
    type Ports = [
      import('../src/index.js').PlanStore,
      import('../src/index.js').Refs,
      import('../src/index.js').Host,
      import('../src/index.js').Processes,
      import('../src/index.js').Trees,
      import('../src/index.js').Clock,
      import('../src/index.js').MachinePort,
    ];
    const declared: Ports[number] extends never ? never : true = true;
    expect(declared).toBe(true);
    // The entity keeps its own name alongside the port.
    expect(index.headroomFor(1)).toBe('clear');
  });

  it('keeps the adapters off the barrel', async () => {
    // An `export *` from adapters/ would put node:child_process on the import
    // graph of every module that reads an entity, making the purity boundary
    // depend on tree-shaking rather than on the module graph.
    const index = await import('../src/index.js');
    expect(Object.keys(index)).not.toContain('runScript');
    expect(Object.keys(index)).not.toContain('hostShell');
  });
});
