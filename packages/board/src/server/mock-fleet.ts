import { FleetSchema, RowKindSchema } from '../contract/schema.js';
import type { Fleet, AgentRow } from '../contract/schema.js';

/**
 * The environment variable that turns the mock on. An env var rather than a
 * flag because this server parses no arguments at all — `PLOT_BOARD_REPAIR` and
 * `PLOT_BOARD_ALLOW_REMOTE_WRITES` are how it is already configured, and adding
 * the first flag for a development aid would be the wrong place to start.
 */
export const MOCK_ENV = 'PLOT_BOARD_MOCK';

/** On only for an exact `1`. A truthy guess must not reach a real estate. */
export function mockRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MOCK_ENV] === '1';
}

/**
 * A row of each kind, for looking at.
 *
 * **Why this exists as server data rather than a storybook.** The question it
 * answers is *what does the board render for each kind*, and the board renders
 * from a payload — so a fixture that skipped the payload would prove the
 * component works while the board still showed something else. Measured
 * 2026-08-20: every kind rendered correctly in a component harness while the
 * live board showed wave names in the kind slot. The harness was right and
 * useless.
 *
 * So these are `AgentRow`s, validated by the same schema a real pulse is, and
 * they travel the same route through the same grouping into the same sections.
 *
 * **It replaces the whole payload, never merges into one.** A mock beside real
 * rows would be indistinguishable from a real estate behaving oddly, and the
 * first confused reading of it would cost more than the aid saves.
 */
const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

function row(over: Partial<AgentRow> & Pick<AgentRow, 'kind'>): AgentRow {
  return {
    repo: '.', plan: '', planFile: '', wave: '', state: 'open',
    phase: null, group: 'waiting-on-you', ageMinutes: 60, note: '',
    branch: '', branchUrl: '', pr: null, waitingDays: null,
    localDirty: false, localLocked: false, localAhead: 0,
    waitingOn: null, blockedBy: null, verdict: null, worker: 'none',
    stuck: null, repair: null, processes: [],
    ...over,
  } as AgentRow;
}

/** One row per kind, each in the section its kind belongs to. */
export function mockFleet(): Fleet {
  const rows: AgentRow[] = [
    // THREE WAVES ON ONE PLAN, because a one-wave plan hides the two questions
    // that matter: does the grouping read as a set, and does a blocked wave say
    // what it waits on. Their verdicts are the three the scan emits —
    // `eligible`, `blocked`, `complete` — so the mock shows all of them.
    row({
      kind: 'plan', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      phase: 'Design', wave: 'Shaped', waitingDays: 1, ageMinutes: 1440,
      branch: 'feature/the-scan-asks-once',
      branchUrl: 'https://example.invalid/tree/feature/the-scan-asks-once',
      verdict: 'eligible',
      note: 'approved — nobody has taken it',
    }),
    row({
      kind: 'plan', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      phase: 'Design', wave: 'Relocated', waitingDays: 1, ageMinutes: 1440,
      branch: 'feature/the-wave-finds-its-owner',
      branchUrl: 'https://example.invalid/tree/feature/the-wave-finds-its-owner',
      verdict: 'blocked',
      note: 'blocked by Shaped — 1 outstanding',
    }),
    row({
      kind: 'plan', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      phase: 'Design', wave: 'Moved', waitingDays: 1, ageMinutes: 1440,
      branch: 'bug/the-old-column-goes',
      branchUrl: 'https://example.invalid/tree/bug/the-old-column-goes',
      verdict: 'blocked',
      note: 'blocked by Relocated — 1 outstanding',
    }),
    row({
      kind: 'pr', group: 'waiting-on-you',
      branch: 'feature/opus5-longhorizon-hardening',
      branchUrl: 'https://example.invalid/tree/feature/opus5-longhorizon-hardening',
      plan: 'opus5-longhorizon-hardening',
      planFile: 'docs/plans/2026-07-25-opus5-longhorizon-hardening.md',
      ageMinutes: 25 * 1440, note: 'PR #57, conflicts',
      pr: {
        number: 57, url: 'https://example.invalid/pull/57', draft: false,
        state: 'conflicts',
      },
    }),
    row({
      kind: 'branch', group: 'waiting-on-you',
      branch: 'bug/a-branch-with-no-pr',
      branchUrl: 'https://example.invalid/tree/bug/a-branch-with-no-pr',
      plan: 'a-row-is-a-tuple', planFile: 'docs/plans/2026-08-20-a-row-is-a-tuple.md',
      wave: 'Shaped', ageMinutes: 3 * 1440, note: 'pushed, no PR yet',
    }),
    row({
      kind: 'build', group: 'waiting-on-machine',
      branch: 'feature/a-build-is-running',
      branchUrl: 'https://example.invalid/tree/feature/a-build-is-running',
      ageMinutes: 10, note: 'CI is running for PR #283',
      pr: {
        number: 283, url: 'https://example.invalid/pull/283', draft: false,
        state: 'pending',
      },
    }),
    row({
      kind: 'agent', group: 'working',
      branch: 'feature/an-agent-is-working',
      branchUrl: 'https://example.invalid/tree/feature/an-agent-is-working',
      plan: 'every-section-has-one-subject',
      planFile: 'docs/plans/2026-08-20-every-section-has-one-subject.md',
      wave: 'Inverted', ageMinutes: 27, worker: 'running',
      note: 'worker running (pid 12345)',
    }),
    row({
      kind: 'release', group: 'waiting-on-you',
      branch: 'changeset-release/main',
      branchUrl: 'https://example.invalid/tree/changeset-release/main',
      ageMinutes: 12, note: 'PR #240, no checks',
      pr: {
        number: 240, url: 'https://example.invalid/pull/240', draft: false,
        state: 'none',
      },
    }),
  ];

  // The seventh kind is a TICKET, and it is not a row: issues travel beside
  // `rows` in their own list. That asymmetry is exactly what a mock should
  // show — a reader comparing the seven learns that six are rows and one is not.
  const fleet = {
    generatedAt: new Date(now).toISOString(),
    ageSeconds: 0,
    // `ready` is what tells the tab the first scan has landed. A mock is always
    // ready: there is no scan to wait for.
    ready: true,
    scannedCommit: 'mock',
    rows,
    // Counts a real pulse derives from the scan. Stated to match the rows above
    // rather than left at zero — a summary that disagreed with what is rendered
    // is the shape of defect this board keeps finding.
    summary: {
      plans: 4, waves: 6, branches: rows.length,
      claimed: 1, eligible: 1, blocked: 0, deferred: 0,
    },
    stuck: { stuck: 0, artifact: 0, conflict: 1, unpushed: 0, ci: 0 },
    prAgeSeconds: 0,
    issues: [{
      number: 228,
      title: 'Fleet scan asks the host once per branch',
      url: 'https://example.invalid/issues/228',
      ageMinutes: 2 * 1440,
      plan: '', planFile: '', planUrl: '',
    }],
    issueAnswer: 'answered' as const,
    issueError: null,
    // `nullable()` with no default: the schema requires the key, and null is the
    // honest value — a mock had no scan to fail and no host to ask.
    error: null,
    prError: null,
    agents: [{
      session: 'f30b27a3-9c1e-4f2b-bb77-0d5a1e2f3c44',
      branch: 'feature/an-agent-is-working',
      worktree: '/tmp/plot-wt-an-agent-is-working',
      command: 'claude -p "…"',
      startedAt: minutesAgo(27),
      model: 'claude-opus-5',
      contextTokens: 103_619,
      lastActivity: minutesAgo(4),
    }],
  };

  // Validated by the SAME schema a real pulse is. A mock that could not pass it
  // would prove nothing about what the board renders — and every field defaulted
  // here is a field a real pulse may also omit.
  return FleetSchema.parse(fleet);
}

/** Every kind the contract knows, for a test that this mock covers them all. */
export const MOCK_KINDS = RowKindSchema.options;
