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

// THE TRACKER'S TWO CONNECTORS, and they are two rather than one with a branch:
// each holds its own account, its own token and its own window, and neither
// ever sees the other's. `trackerNone` beside them is not a fixture — it is the
// default configuration, a repository whose plans ARE the tracker.
export { trackerGithub } from './tracker/tracker-github.js';
export { trackerJira } from './tracker/tracker-jira.js';
export { trackerNone } from './tracker/tracker-none.js';
export { trackerFor, trackerShell } from './tracker/tracker-resolve.js';
export { trackerFixture, type TrackerFixture } from './tracker/tracker-fixture.js';

// THE BUILD PIPELINE'S CONNECTORS, and the same rule holds: each owns its own
// account, token and window. `buildNone` beside them is not a fixture — it is a
// repository that declared no CI, and an unaskable CI is a different fact from
// an empty run list.
export { buildActions } from './build/build-actions.js';
export { buildNone } from './build/build-none.js';
export { buildFor, buildShell } from './build/build-resolve.js';
export { buildFixture, type BuildFixture } from './build/build-fixture.js';

export { budgetFile, BUDGET_HOME_ENV, type BudgetFileOptions } from './budget/budget-file.js';
export { budgetFixture, type BudgetFixture } from './budget/budget-fixture.js';

export { slotsFile, SLOTS_HOME_ENV, type SlotsFileOptions } from './slots/slots-file.js';
export { slotsFixture, type SlotsFixture } from './slots/slots-fixture.js';

export { refsGit } from './refs/refs-git.js';
export { refsFixture, type RefsFixture } from './refs/refs-fixture.js';

export {
  agentsFs,
  parseManifest,
  firstMarkerLine,
  QUESTION_MAX,
  type AgentsFsOptions,
} from './agents/agents-fs.js';
export {
  agentsFixture,
  agentManifest,
  agentDesk,
  type AgentsFixture,
} from './agents/agents-fixture.js';

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

// THE PRODUCTION PERFORMER, beside the sandbox one and never replacing it.
// `perform-fs.ts` skips `worker-start`; this reaches the process table, and the
// composition root chooses which world it is in. Exporting both from one barrel
// is the whole substitution the ports exist for.
export { performerShell } from './performer/performer-shell.js';
