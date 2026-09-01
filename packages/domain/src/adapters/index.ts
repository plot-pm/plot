/**
 * `@plot-pm/domain/adapters` — the implementations that reach the world, and
 * the fixtures that stand in for it.
 *
 * A SECOND entry point rather than more of the first. `src/index.ts` is what a
 * pure consumer imports, and it excludes this directory on purpose: an
 * `export *` from here would put `node:child_process` on the import graph of
 * every module that reads an entity, making the package's purity boundary
 * depend on tree-shaking rather than on the module graph.
 *
 * That reasoning bounds who may import THIS barrel. It is for a composition
 * root — the one place in a program that chooses which world the ports answer
 * from. Everything above the ports takes the adapters it was given and cannot
 * tell which of these it holds, which is the entire substitution the ports
 * exist for.
 */
export { shellContext, scriptPath, type ShellContext } from './scripts.js';

export { scriptsShell } from './scripts/scripts-shell.js';

export { planStoreShell } from './plan-store/plan-store-shell.js';
export {
  planStoreFixture,
  planRecord,
  type PlanStoreFixture,
} from './plan-store/plan-store-fixture.js';

export { hostShell } from './host/host-shell.js';
export { hostFixture, type HostFixture } from './host/host-fixture.js';

export { budgetFile, BUDGET_HOME_ENV, type BudgetFileOptions } from './budget/budget-file.js';
export { budgetFixture, type BudgetFixture } from './budget/budget-fixture.js';

export { refsGit } from './refs/refs-git.js';
export { refsFixture, type RefsFixture } from './refs/refs-fixture.js';

export { treesGit } from './trees/trees-git.js';
export { treesFixture, type TreesFixture } from './trees/trees-fixture.js';

export {
  startChannel,
  type ChannelOptions,
  type RunningChannel,
} from './channel/channel-socket.js';

export {
  subscribe,
  findingsIn,
  type SubscribeOptions,
  type Subscribed,
} from './channel/channel-client.js';

export { clockSystem, clockFixed, clockManual } from './clock/clock-system.js';

export {
  machineSystem,
  DEFAULT_SAMPLE_BUDGET_MS,
  type MachineSystemOptions,
} from './machine/machine-system.js';

export { processesShell, parseEtime } from './processes/processes-shell.js';
