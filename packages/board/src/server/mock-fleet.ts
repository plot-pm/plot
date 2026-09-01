import { planRecord } from '@plot-pm/domain/adapters';
import type { FleetReading, PlanRecord } from '@plot-pm/domain';

import { FleetSchema, RowKindSchema } from '../contract/schema.js';
import type { Fleet, AgentRow, Card, Column } from '../contract/schema.js';

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
    waitingOn: null, blockedBy: null, verdict: null, startability: null, worker: 'none',
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
    //
    // `kind: 'branch'`, and these carried `kind: 'plan'` until the wave row
    // existed. It read correctly while a not-started row STOOD FOR its plan;
    // once the wave row took that job these became the branches inside a wave's
    // fold and rendered `Kind: Plan` two levels deep. The mock was wrong the
    // whole time and nothing could see it: `rowKind` returns only `release`,
    // `branch` or `pr` — never `plan` — so no real pulse has ever carried a
    // `kind: 'plan'` row. A mock is only worth what its fidelity is.
    // `start-work` — the only row that can be started. Brief present, wave
    // eligible, plan approved. The green row in NOT STARTED.
    row({
      kind: 'branch', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      // `Tracer`, so the SPIKE marking is visible in the mock — the wave whose
      // outcome may be a refined plan rather than merged work.
      phase: 'Design', wave: 'Tracer', waitingDays: 1, ageMinutes: 1440,
      branch: 'feature/the-scan-asks-once',
      branchUrl: 'https://example.invalid/tree/feature/the-scan-asks-once',
      verdict: 'eligible',
      startability: 'start-work',
      brief: 'present',
      note: 'approved — nobody has taken it',
    }),
    row({
      kind: 'branch', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      phase: 'Design', wave: 'Relocated', waitingDays: 1, ageMinutes: 1440,
      branch: 'feature/the-wave-finds-its-owner',
      branchUrl: 'https://example.invalid/tree/feature/the-wave-finds-its-owner',
      verdict: 'blocked', blockedBy: 'Tracer',
      note: 'blocked by Tracer — 1 outstanding',
    }),
    // A MULTI-BRANCH WAVE, because it is the case the estate has exactly one of
    // (`opus5-longhorizon-hardening :: Implementation`, five branches, blocked)
    // and the only one that exercises the wave's own fold. Two branches under
    // one wave name: the wave row states `blocked` once and discloses both,
    // where three separate rows would have said `blocked` three times.
    row({
      kind: 'branch', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      phase: 'Design', wave: 'Moved', waitingDays: 1, ageMinutes: 1440,
      branch: 'bug/the-old-column-goes',
      branchUrl: 'https://example.invalid/tree/bug/the-old-column-goes',
      verdict: 'blocked', blockedBy: 'Relocated',
      note: 'blocked by Relocated — 1 outstanding',
    }),
    row({
      kind: 'branch', group: 'not-started',
      plan: 'fleet-scan-asks-the-host',
      planFile: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
      phase: 'Design', wave: 'Moved', waitingDays: 1, ageMinutes: 1440,
      branch: 'bug/the-badge-goes-too',
      branchUrl: 'https://example.invalid/tree/bug/the-badge-goes-too',
      verdict: 'blocked', blockedBy: 'Relocated',
      note: 'blocked by Relocated — 1 outstanding',
    }),
    // A PR THAT BELONGS TO A WAVE — the ordinary case, and the one whose wave
    // was on the row and unrendered. A branch cut for a plan's wave keeps that
    // membership through review, so the PR's artifacts are plan, wave and
    // branch.
    row({
      kind: 'pr', group: 'waiting-on-you',
      branch: 'feature/a-wave-is-a-kind',
      branchUrl: 'https://example.invalid/tree/feature/a-wave-is-a-kind',
      plan: 'a-wave-is-a-thing-not-a-label',
      planFile: 'docs/plans/2026-08-20-a-wave-is-a-thing-not-a-label.md',
      wave: 'Modelled', state: 'wip',
      ageMinutes: 45, note: 'PR #304, green',
      pr: {
        number: 304, url: 'https://example.invalid/pull/304', draft: false,
        state: 'green',
        states: ['green'],
      },
    }),
    // A SECOND PR IN THE SAME WAVE, so `Modelled` has a SET to name and earns a
    // wave row in WAITING ON YOU. One PR is a PR — there is nothing to group —
    // and two are a wave whose work is landed and waiting to be merged, which is
    // the real shape the estate carries: `opus5-longhorizon-hardening ::
    // Implementation` holds five such branches and reads `blocked`.
    row({
      kind: 'pr', group: 'waiting-on-you',
      branch: 'bug/the-branch-row-stops-labelling-its-wave',
      branchUrl: 'https://example.invalid/tree/bug/the-branch-row-stops-labelling-its-wave',
      plan: 'a-wave-is-a-thing-not-a-label',
      planFile: 'docs/plans/2026-08-20-a-wave-is-a-thing-not-a-label.md',
      wave: 'Modelled', state: 'wip',
      ageMinutes: 70, note: 'PR #307, checks failing',
      pr: {
        number: 307, url: 'https://example.invalid/pull/307', draft: false,
        state: 'failing',
        states: ['failing'],
      },
    }),
    // AND ONE THAT BELONGS TO NONE. `opus5-longhorizon-hardening` reaches the
    // board through the planless-PR loop, which carries `wave: ''` — so its
    // artifact slot holds plan and branch and nothing between them. The pair
    // makes slot 4's zero-or-more visible rather than asserted.
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
        states: ['conflicts'],
      },
    }),
    row({
      kind: 'branch', group: 'waiting-on-you',
      branch: 'bug/a-branch-with-no-pr',
      branchUrl: 'https://example.invalid/tree/bug/a-branch-with-no-pr',
      plan: 'a-row-is-a-tuple', planFile: 'docs/plans/2026-08-20-a-row-is-a-tuple.md',
      wave: 'Shaped', ageMinutes: 3 * 1440, note: 'pushed, no PR yet',
    }),
    // A BUILD RUNNING A WAVE'S BRANCH — the ordinary case, since almost every
    // branch CI runs on was cut for a wave. Its artifacts are the PR it reports
    // to, the wave the work belongs to, and the branch it built.
    row({
      kind: 'build', group: 'waiting-on-machine',
      branch: 'feature/a-build-is-running',
      branchUrl: 'https://example.invalid/tree/feature/a-build-is-running',
      plan: 'a-wave-is-a-thing-not-a-label',
      planFile: 'docs/plans/2026-08-20-a-wave-is-a-thing-not-a-label.md',
      wave: 'Modelled', state: 'wip',
      ageMinutes: 10, note: 'CI is running for PR #283',
      pr: {
        number: 283, url: 'https://example.invalid/pull/283', draft: false,
        state: 'pending',
        states: ['pending'],
      },
    }),
    // AND ONE ON A BRANCH THAT BELONGS TO NO WAVE — the release branch, whose CI
    // runs for a PR no plan names. The pair shows the middle link is optional on
    // a build exactly as it is on a PR.
    row({
      kind: 'build', group: 'waiting-on-machine',
      branch: 'changeset-release/main',
      branchUrl: 'https://example.invalid/tree/changeset-release/main',
      wave: '', state: 'wip',
      ageMinutes: 3, note: 'CI is running for PR #240',
      pr: {
        number: 240, url: 'https://example.invalid/pull/240', draft: false,
        state: 'pending',
        states: ['pending'],
      },
    }),
    // A PLAN WITH WAVES IN QUIET — two branches of one wave that stopped moving.
    // QUIET is *nothing has happened here for a while*, so the wave grouping has
    // to hold there too: without it a reader sees two unrelated stale branches
    // rather than one wave that stalled.
    row({
      kind: 'branch', group: 'quiet',
      branch: 'feature/the-scan-reads-refs-in-one-call',
      branchUrl: 'https://example.invalid/tree/feature/the-scan-reads-refs-in-one-call',
      plan: 'the-scan-spawns-git-once-per-question',
      planFile: 'docs/plans/2026-08-14-the-scan-spawns-git-once-per-question.md',
      wave: 'Batched', state: 'wip',
      ageMinutes: 6 * 1440, note: 'last commit 6d ago',
    }),
    row({
      kind: 'branch', group: 'quiet',
      branch: 'feature/the-scan-walks-history-in-one-call',
      branchUrl: 'https://example.invalid/tree/feature/the-scan-walks-history-in-one-call',
      plan: 'the-scan-spawns-git-once-per-question',
      planFile: 'docs/plans/2026-08-14-the-scan-spawns-git-once-per-question.md',
      wave: 'Batched', state: 'wip',
      ageMinutes: 8 * 1440, note: 'last commit 8d ago',
    }),
    // AND A DELIVERED WAVE IN DONE — `state: 'merged'`, which the row displays as
    // `delivered`. Two branches of one wave, so DONE shows the wave that landed
    // rather than two branches that each did.
    row({
      kind: 'branch', group: 'done',
      branch: 'feature/every-host-consumer-slows-down',
      branchUrl: 'https://example.invalid/tree/feature/every-host-consumer-slows-down',
      plan: 'a-rate-limit-is-not-an-outage',
      planFile: 'docs/plans/2026-08-16-a-rate-limit-is-not-an-outage.md',
      wave: 'Slows', state: 'merged',
      ageMinutes: 2 * 1440, note: 'merged',
      pr: {
        number: 271, url: 'https://example.invalid/pull/271', draft: false,
        state: 'green',
        states: ['green'],
      },
    }),
    row({
      kind: 'branch', group: 'done',
      branch: 'feature/the-wait-comes-from-the-host',
      branchUrl: 'https://example.invalid/tree/feature/the-wait-comes-from-the-host',
      plan: 'a-rate-limit-is-not-an-outage',
      planFile: 'docs/plans/2026-08-16-a-rate-limit-is-not-an-outage.md',
      wave: 'Slows', state: 'merged',
      ageMinutes: 2 * 1440, note: 'merged',
      pr: {
        number: 272, url: 'https://example.invalid/pull/272', draft: false,
        state: 'green',
        states: ['green'],
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
    // A PLAN UNDER REVIEW, on its own `idea/` branch — the one plan row the
    // SERVER emits, and the case `rowKind`'s idea arm exists for. Technically a
    // PR; what the reader decides is whether to APPROVE the plan, which is a
    // different act from reviewing code, so the row says `Plan`.
    //
    // **THE BRANCH NAME DECIDES, NOT THE DRAFT FLAG.** `rowKind` tests
    // `IDEA_BRANCH.test(branch) && hasPr` and never looks at `draft` — a plan
    // PR marked ready for review is still a plan. The two facts are independent,
    // the same separation this board already insists on for the PR badge:
    // *"`draft` and the state are TWO badges, not one… a draft has CI like
    // anything else."* Draft says whether it is offered; the branch says what it
    // IS.
    //
    // The mock carries BOTH, one row each, so the independence is visible rather
    // than asserted: this one is a draft, the next is ready for review, and both
    // read `Plan`.
    //
    // Shaped exactly as `rowsFromPulse` builds it: the slug recovered from the
    // branch name, `wave: ''` (an idea branch belongs to no wave), `state: 'wip'`.
    row({
      kind: 'plan', group: 'waiting-on-you',
      branch: 'idea/a-wave-is-a-thing-not-a-label',
      branchUrl: 'https://example.invalid/tree/idea/a-wave-is-a-thing-not-a-label',
      plan: 'a-wave-is-a-thing-not-a-label',
      planFile: 'docs/plans/2026-08-20-a-wave-is-a-thing-not-a-label.md',
      wave: '', state: 'wip', phase: 'Discovery',
      ageMinutes: 90, note: 'PR #305, draft — waiting on its author',
      pr: {
        number: 305, url: 'https://example.invalid/pull/305', draft: true,
        state: 'none',
        states: ['none'],
      },
    }),
    // THE SAME KIND, READY FOR REVIEW — the half that proves the kind does not
    // come from the draft flag. `draft: false`, checks green, and it still reads
    // `Plan`: the act it wants is approval, which `plot-approve.sh` performs on
    // a plan and no branch.
    row({
      kind: 'plan', group: 'waiting-on-you',
      branch: 'idea/the-row-is-legible',
      branchUrl: 'https://example.invalid/tree/idea/the-row-is-legible',
      plan: 'the-row-is-legible',
      planFile: 'docs/plans/2026-08-20-the-row-is-legible.md',
      wave: '', state: 'wip', phase: 'Discovery',
      ageMinutes: 240, note: 'PR #306, green — ready for approval',
      pr: {
        number: 306, url: 'https://example.invalid/pull/306', draft: false,
        state: 'green',
        states: ['green'],
      },
    }),
    row({
      kind: 'release', group: 'waiting-on-you',
      branch: 'changeset-release/main',
      branchUrl: 'https://example.invalid/tree/changeset-release/main',
      // THE VERSION, as the server reads it from `package.json` on the release
      // branch. `2.7.0` is what this repo's own release branch actually carries
      // — verified against `origin/changeset-release/main` — so the mock shows
      // what the board shows rather than a made-up tag.
      version: '2.7.0',
      ageMinutes: 12, note: 'PR #240, no checks',
      pr: {
        number: 240, url: 'https://example.invalid/pull/240', draft: false,
        state: 'none',
        states: ['none'],
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
      plans: 4, waves: 8, branches: rows.length,
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

/**
 * The CARDS the mock fleet's rows belong to — because half the board's controls
 * are card-shaped, and without these the mock could not show any of them.
 *
 * ## What this fixes
 *
 * `mockFleet` replaces `/api/fleet`. `/api/board` was left reading the real
 * repo, so the mock's invented plan (`fleet-scan-asks-the-host`) had no card,
 * `cardForPlanFile` returned null, and every control gated on a card silently
 * vanished: `Start work`, `Approve`, `Commission design`, and the plan row's
 * whole `⋯` menu. Measured 2026-08-20 — `[data-plan-actions]` count **0** on a
 * mock whose entire purpose is showing what a row renders.
 *
 * That is the same class of defect as the four `kind: 'plan'` rows this file
 * carried: a mock is worth only the fidelity it is checked for, and an ABSENT
 * control looks exactly like a control the code fails to render.
 *
 * Matched to the fleet by plan-file BASENAME, which is how `cardForPlanFile`
 * looks a card up.
 *
 * `phase: 'Development'` with `started: false` is what makes a plan startable —
 * see `PlanCard`'s `isReadyToStart`, which read `phase === 'Design'` until #289.
 */
export function mockCards(): Column[] {
  const card = (over: Partial<Card> & Pick<Card, 'slug' | 'title' | 'path'>): Card => ({
    type: 'feature', phase: 'Development', prs: [], ...over,
  } as Card);
  return [
    {
      phase: 'Development',
      cards: [
        card({
          slug: 'fleet-scan-asks-the-host',
          title: 'The fleet scan asks the host once, not once per branch',
          path: 'docs/plans/2026-08-20-fleet-scan-asks-the-host.md',
          story: 'plot-board',
          // NOT started, which is what `Start work` needs: a plan in
          // Development that nothing has begun.
          started: false,
        }),
        card({
          slug: 'every-section-has-one-subject',
          title: 'Every section has one subject',
          path: 'docs/plans/2026-08-20-every-section-has-one-subject.md',
          story: 'plot-board', started: true,
        }),
        card({
          slug: 'a-row-is-a-tuple',
          title: 'A row is a tuple',
          path: 'docs/plans/2026-08-20-a-row-is-a-tuple.md',
          story: 'plot-board', started: true,
        }),
      ],
    },
    {
      phase: 'Testing',
      cards: [
        card({
          slug: 'opus5-longhorizon-hardening',
          title: 'Opus 5 long-horizon hardening',
          path: 'docs/plans/2026-07-25-opus5-longhorizon-hardening.md',
          started: true,
          prs: [{ number: 57, url: 'https://example.invalid/pull/57' }],
        }),
      ],
    },
  ];
}

/**
 * The mock estate as the `PlanStore` port sees it — one record per plan the
 * mock's cards and rows refer to.
 *
 * DERIVED from `mockCards()` and `mockFleet()` rather than written a third
 * time. This file already records what a second hand-made copy costs: four
 * rows carried `kind: 'plan'` for weeks because the mock and what it stood for
 * had drifted, and nothing could see it. A port-shaped view built from the
 * same data cannot drift from it.
 *
 * @returns one `PlanRecord` per plan in the mock estate.
 */
export function mockPlans(): PlanRecord[] {
  const rows = mockFleet().rows;
  const cards = mockCards().flatMap((column) => column.cards);

  // Every plan the mock mentions, from whichever side mentions it. A card
  // without rows is a plan nothing has started; a row without a card is the
  // planless-PR loop's shape. Both are real, so neither side alone is the list.
  const files = [...new Set([
    ...cards.map((card) => card.path),
    ...rows.map((row) => row.planFile),
  ])].filter((file) => file.length > 0);

  return files.map((file) => {
    const card = cards.find((c) => c.path === file);
    const mine = rows.filter((row) => row.planFile === file);
    const slug = card?.slug ?? mine[0]?.plan ?? '';
    const branches = [...new Set(mine.map((row) => row.branch))].filter((b) => b.length > 0);

    return planRecord({
      file,
      phase: (card?.phase ?? 'Development').toLowerCase(),
      phaseRaw: card?.phase ?? 'Development',
      type: card?.type ?? 'feature',
      title: card?.title ?? slug,
      story: card?.story ?? '',
      branches,
      prs: [...new Set(mine.flatMap((row) => (row.pr ? [row.pr.number] : [])))],
      // One slice per wave name the plan's rows carry, holding that wave's
      // branches — the shape `plot-plan-meta.sh` reports and the fleet reads.
      slices: [...new Set(mine.map((row) => row.wave))]
        .filter((wave) => wave.length > 0)
        .map((wave) => ({
          name: wave,
          branches: mine
            .filter((row) => row.wave === wave && row.branch.length > 0)
            .map((row) => ({
              branch: row.branch,
              deferred: false,
              deferredReason: '',
              claimed: '',
            })),
        })),
    });
  });
}

/**
 * The mock estate as the `Refs` port's pulse sees it.
 *
 * Carries the same summary the mock fleet states, so the two readings of one
 * estate agree by construction. `plans` is empty because the scan's own plan
 * shape is not what `mockPlans()` answers — a caller wanting the plans asks
 * the `PlanStore`, which is the port that holds them.
 *
 * @returns the pulse a mock scan would emit.
 */
export function mockPulse(): FleetReading {
  return {
    main: 'main',
    head: 'mock',
    read_ref: 'origin/main',
    local_head: 'mock',
    plans: [],
    summary: mockFleet().summary,
  };
}
