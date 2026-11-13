import { recordCensus, type CensusFixture, type CensusTolerance } from './census-report.js';
import type { ExecRecord } from './strace-execs.js';

/** Who turns a zero row into a required pass: a plan, and its slice where the plan names one. */
export type GreenBy = { plan: string; slice?: string; phase?: string };

/** One row of the plan's scenario table (S1..S7), per-source table (P2..P4, P6), or a launch row (D1). */
export type CensusRow =
  | { id: string; claim: string; unit: string; target: 'zero'; greenBy: GreenBy; green?: true }
  | { id: string; claim: string; unit: string; target: 'measured'; tolerance: CensusTolerance };

/**
 * The rows of `docs/plans/2026-11-08-process-census-gate.md`, in its order,
 * with S7 from `docs/plans/2026-11-09-board-api-starts-nothing.md` after S3,
 * then P5 from `docs/plans/2026-11-09-github-reads-in-process.md`,
 * then P6 from `docs/plans/2026-11-09-liveness-token.md`, which retires P1,
 * then D1 from `docs/plans/2026-11-09-node-worker-wrapper.md`,
 * then P7, P8, P9 and S8 from `docs/plans/2026-11-10-triggers-replace-the-tick.md`,
 * then P11 from `docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md`.
 * A zero row is written as `it.fails` until the plan and slice it names turn
 * it green; that slice sets `green: true` and changes the row to `it`.
 */
export const CENSUS_ROWS = {
  S1: {
    id: 'S1',
    claim: 'an idle board with no SSE client and no fleetd starts nothing',
    unit: 'execve per minute',
    target: 'zero',
    greenBy: { plan: 'no-tab-no-pulse', slice: 'Server pulse' },
    green: true,
  },
  S2: {
    id: 'S2',
    claim: 'an idle board whose one page turned hidden starts nothing',
    unit: 'execve per minute',
    target: 'zero',
    greenBy: { plan: 'no-tab-no-pulse', slice: 'Hidden page' },
    green: true,
  },
  S3: {
    id: 'S3',
    claim: 'an idle board with one visible SSE client and fleetd running starts nothing',
    unit: 'execve per minute',
    target: 'zero',
    greenBy: { plan: 'board-reads-the-channel', slice: 'Census zero' },
    green: true,
  },
  S7: {
    id: 'S7',
    claim: 'an idle board with one visible page that polls GET /api/board every 30 s, and fleetd running, starts nothing',
    unit: 'execve per minute',
    target: 'zero',
    greenBy: { plan: 'board-api-starts-nothing', slice: 'Census zero' },
    green: true,
  },
  S4: {
    id: 'S4',
    claim: 'an idle fleetd pass starts nothing',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'triggers-replace-the-tick', phase: 'Phase 8' },
  },
  S5: {
    id: 'S5',
    claim: 'one desk commit',
    unit: 'execve per change',
    target: 'measured',
    tolerance: { ratio: 0.1, plus: 2 },
  },
  S6: {
    id: 'S6',
    claim: 'one PR whose CI turns green',
    unit: 'execve per change',
    target: 'measured',
    tolerance: { ratio: 0.1, plus: 2 },
  },
  P2: {
    id: 'P2',
    claim: 'an idle fleetd pass over a desk with a live pid file starts no bash -c kill -0',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'monitors-nap-without-sleep', slice: 'Liveness syscall' },
    green: true,
  },
  P3: {
    id: 'P3',
    claim:
      'after its first pass, neither fleetd nor the board starts, as a direct child, git rev-parse --show-toplevel or --git-common-dir, or plot-host.sh backend',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'fixed-answers-once', slice: 'Answers in process' },
    green: true,
  },
  P4: {
    id: 'P4',
    claim: 'after the first pass, no process in the tree starts git rev-parse --show-toplevel or --git-common-dir',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'fixed-answers-once', slice: 'Answers in scripts' },
    green: true,
  },
  P5: {
    id: 'P5',
    claim: 'an idle fleetd pass on GitHub starts no plot-host.sh pr-list or issue-list',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'github-reads-in-process', slice: 'Cutover' },
    green: true,
  },
  P6: {
    id: 'P6',
    claim: 'an idle desk with a live agent starts no monitor process',
    unit: 'monitor execve per launch',
    target: 'zero',
    greenBy: { plan: 'liveness-token', slice: 'Monitor in fleetd' },
    green: true,
  },
  P7: {
    id: 'P7',
    claim: 'an idle fleetd pass starts no git rev-parse --git-dir',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'triggers-replace-the-tick', slice: 'Fleet size' },
    green: true,
  },
  P8: {
    id: 'P8',
    claim: 'an idle fleetd pass starts no git fetch',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'triggers-replace-the-tick', slice: 'Scan on trigger' },
    green: true,
  },
  P9: {
    id: 'P9',
    claim: 'an idle fleetd pass starts no plot-host.sh spend-rate, plot-state-sync.mjs or plot-merger-token.mjs',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'triggers-replace-the-tick', slice: 'Quiet beats' },
    green: true,
  },
  P11: {
    id: 'P11',
    claim: 'an idle fleetd pass with a Jira tracker starts no curl and no plot-host.sh issue-list, ticket-projects or spend-rate --connector jira',
    unit: 'execve per pass',
    target: 'zero',
    greenBy: { plan: 'bitbucket-and-jira-read-in-process', slice: 'Jira cutover' },
    green: true,
  },
  S8: {
    id: 'S8',
    claim: 'a safety-net pass',
    unit: 'execve per pass',
    target: 'measured',
    tolerance: { ratio: 0.1, plus: 2 },
  },
  D1: {
    id: 'D1',
    claim: 'one dispatch',
    unit: 'execve per launch',
    target: 'measured',
    tolerance: 'strict',
  },
} as const satisfies Record<string, CensusRow>;

export type CensusRowId = keyof typeof CENSUS_ROWS;

const greenByText = ({ plan, slice, phase }: GreenBy): string =>
  `${phase === undefined ? '' : `${phase}, `}plan ${plan}${slice === undefined ? '' : `, slice ${slice}`}`;

/**
 * The test title of a row. A zero row's title names the plan and slice that
 * turn it green, so an `it.fails` that starts to pass says which plan to read;
 * a green zero row names the plan and slice that turned it green.
 */
export const rowTitle = (row: CensusRow, fixture?: CensusFixture): string => {
  const size = fixture === undefined ? '' : ` [${fixture.host}, ${fixture.desks} desks, ${fixture.openPrs} open PRs]`;
  if (row.target === 'zero' && row.green === true) {
    return `${row.id}: ${row.claim}${size} (turned green by ${greenByText(row.greenBy)})`;
  }
  return row.target === 'zero'
    ? `${row.id}: ${row.claim}${size} (expected to fail until ${greenByText(row.greenBy)})`
    : `${row.id}: ${row.claim}${size} (measured, held within ${row.tolerance === 'strict' ? 'no growth' : `${row.tolerance.ratio * 100} % + ${row.tolerance.plus}`})`;
};

/** The census's fixture size as one line: desks, open PRs, host. */
export const sizeLine = (fixture: CensusFixture): string =>
  `host=${fixture.host} desks=${fixture.desks} open-prs=${fixture.openPrs}`;

/** The five commands that started most often, as `name ×n`. */
export const topCommands = (execs: readonly ExecRecord[]): string => {
  const counts = new Map<string, number>();
  for (const e of execs) {
    const name = (e.path.split('/').pop() ?? e.path) || (e.argv[0] ?? '?');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, n]) => `${name} x${n}`)
    .join(', ');
};

/**
 * Records one row's count: prints it beside its fixture size and the commands
 * that started most, and hands it to `recordCensus`, which appends it to the
 * report `PLOT_CENSUS_REPORT` names. Every census row calls this before it
 * asserts, so an `it.fails` row still records its count.
 *
 * @returns the printed line.
 */
export const recordCount = (
  row: CensusRow,
  fixture: CensusFixture,
  count: number,
  execs: readonly ExecRecord[],
): string => {
  const tolerance: CensusTolerance = row.target === 'zero' ? 'strict' : row.tolerance;
  const shown = Number.isInteger(count) ? String(count) : count.toFixed(1);
  const line = `process census ${row.id} ${sizeLine(fixture)}: ${shown} ${row.unit}${execs.length === 0 ? '' : ` (top: ${topCommands(execs)})`}`;
  console.log(line);
  recordCensus({ id: row.id, fixture, count, unit: row.unit, tolerance, execs });
  return line;
};
