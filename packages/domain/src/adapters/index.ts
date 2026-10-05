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
export { BITBUCKET_PAGE_LENGTHS, listingPagingFor } from './host/listing-paging.js';
export { hostFixture, type HostFixture } from './host/host-fixture.js';

// THE TRACKER'S TWO CONNECTORS, and they are two rather than one with a branch:
// each holds its own account, its own token and its own window, and neither
// ever sees the other's. `trackerNone` beside them is not a fixture — it is the
// default configuration, a repository whose plans ARE the tracker.
export { trackerGithub } from './tracker/tracker-github.js';
export { trackerJira } from './tracker/tracker-jira.js';
export { trackerNone } from './tracker/tracker-none.js';
export { TRACKER_LISTERS, trackerFor, trackerShell } from './tracker/tracker-resolve.js';
export { trackerFixture, type TrackerFixture } from './tracker/tracker-fixture.js';

// THE NOTIFIER'S ONE ADAPTER AND ITS `none`, following the tracker's shape:
// `notifierNone` is not a fixture, it is the default configuration a
// repository with no `Notify command` runs under.
export { notifierCommand, NOTIFY_MESSAGE_ENV } from './notifier/notifier-command.js';
export { notifierNone } from './notifier/notifier-none.js';
export { notifierFixture, type NotifierFixture } from './notifier/notifier-fixture.js';

// THE BUILD PIPELINE'S CONNECTORS, and the same rule holds: each owns its own
// account, token and window. `buildNone` beside them is not a fixture — it is a
// repository that declared no CI, and an unaskable CI is a different fact from
// an empty run list.
export { buildActions } from './build/build-actions.js';
export { buildNone } from './build/build-none.js';
export { buildFor, buildShell } from './build/build-resolve.js';
export { buildFixture, type BuildFixture } from './build/build-fixture.js';

// THE AGENT-RUN CONNECTOR'S FIXTURE. The SDK and `command` adapters arrive
// in slice 2; this slice ships the port and a fixture, with no SDK dependency.
export {
  agentRunFixture,
  type AgentRunFixture,
  type AgentRunAnswer,
} from './agent-run/agent-run-fixture.js';

export { budgetFile, BUDGET_HOME_ENV, type BudgetFileOptions } from './budget/budget-file.js';

export {
  sliceSpendFile,
  transcriptDirFor,
  SLICE_SPEND_HOME_ENV,
  TRANSCRIPT_HOME_ENV,
  type SliceSpendFileOptions,
} from './slice-spend/slice-spend-file.js';
export { budgetFixture, type BudgetFixture } from './budget/budget-fixture.js';

export {
  freshAgentRecordFile,
  decodeFreshAgentRow,
  FRESH_AGENT_RECORD_HOME_ENV,
  type FreshAgentRecordFileOptions,
} from './fresh-agent-record/fresh-agent-record-file.js';

export { slotsFile, SLOTS_HOME_ENV, type SlotsFileOptions } from './slots/slots-file.js';

// THE PR STORE'S FILE ADAPTER. One file per connector under the COMMON git
// dir's `.plot/state/index/`, so every dispatch worktree of one repository
// reads the store the reaper cannot delete.
export {
  prIndexFile,
  connectorFile,
  PR_INDEX_HOME_ENV,
  type PrIndexFileOptions,
} from './pr-index/pr-index-file.js';

// THE SUPERVISION REPORT'S FILE ADAPTER. One file under the COMMON git dir's
// `.plot/state/`, written by the daemon each tick and read by the board on
// refresh — the one channel between two processes that shared none.
export {
  supervisionReportFile,
  SUPERVISION_REPORT_HOME_ENV,
  type SupervisionReportFileOptions,
} from './supervision-report/supervision-report-file.js';
export { slotsFixture, type SlotsFixture } from './slots/slots-fixture.js';

// THE TEMP SWEEP. `plot-reap.sh --sweep-temp --yes`, with the time of the last
// run kept as a marker file's modification time under `.plot/state/`.
export { tempSweepShell, TEMP_SWEEP_MARKER } from './temp-sweep/temp-sweep-shell.js';

export { refsGit } from './refs/refs-git.js';
export { refsRemoteGit, type RunCommand } from './refs/refs-remote-git.js';
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

export { deskMonitorsShell } from './desk-monitors/desk-monitors-shell.js';

export { boundedRunProcess } from './bounded-run/bounded-run-process.js';
export { boundedRunFixture, type BoundedRunFixture } from './bounded-run/bounded-run-fixture.js';

export { deskFs } from './desk/desk-fs.js';
export { deskFixture, deskFixtureCalls, type DeskFixture, type DeskFixtureCalls } from './desk/desk-fixture.js';
