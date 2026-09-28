import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import { readSupervisionReport, NO_SUPERVISION_REPORT } from '../../src/server/supervision-report-reading.js';
import { tupleFromRow, statusWithCause } from '../../src/app/lib/tuple-row.js';
import { FLEET_TICK_STALE_SECONDS } from '@plot-pm/domain';
import type { FleetReading, AgentRow } from '../../src/contract/schema.js';
import type { SupervisionReport } from '@plot-pm/domain/entities/supervision-report';
import type { SupervisionReportStore } from '@plot-pm/domain/ports/supervision-report';

/**
 * A DESK SAYS WHO OWES IT — the cause travels, and only travels.
 *
 * The defect, measured 2026-09-27: the supervisor computes a `SupervisionCause`
 * for every desk each tick and discards it after printing one stdout line.
 * `/api/fleet` was 31,240 bytes over 22 rows with no cause field anywhere, so an
 * operator could not tell a desk the fleet would serve — deferred on
 * `no-headroom`, restarted after `no-progress` — from one that needs a person
 * (`budget-spent`). On that day an operator intervened on two such desks; the
 * fleet had already restarted one and correctly deferred the other.
 *
 * ## ONE PRODUCER, WHICH IS WHAT THESE TESTS ARE FOR
 *
 * Every case here feeds the board a FAKE REPORT and calls `supervise()` nowhere.
 * That is deliberate and it is the assertion a naive implementation passes
 * without: a test that re-ran the supervision on the board side and compared the
 * two answers would pass against the very defect this fixes — a board computing
 * the cause itself, doubling the per-agent host call the tick already makes.
 *
 * So the values asserted below exist in exactly one place in the test: the
 * fixture. If the board ever derives a cause, these tests keep passing only
 * while it derives the same answer, and the `no host call` test below is what
 * closes that gap.
 */

const QUIET = 12 * 60;

/** A pulse with one claimed desk per branch named. */
const pulseWith = (...branches: string[]): FleetReading => ({
  plans: [{
    file: '2026-09-27-a-desk-says-who-owes-it.md',
    phase: 'approved',
    slices: [{
      name: 'Carry',
      verdict: 'eligible',
      branches: branches.map((branch) => ({
        branch, state: 'claimed', deferred: false, claimed: '', worker: 'elsewhere',
      })),
    }],
  }],
  summary: {
    plans: 1, waves: 1, branches: branches.length, claimed: branches.length,
    eligible: 0, blocked: 0, deferred: 0,
  },
} as never);

/** A store that answers with a literal, and reaches nothing. */
const storeOf = (report: SupervisionReport | null): SupervisionReportStore => ({
  location: async () => ({ ok: true, value: '/fake/supervision.json' }) as never,
  read: async () => ({ ok: true, value: report }) as never,
  write: async () => {
    throw new Error('the board must never write the report');
  },
});

const reportOf = (
  at: number,
  rows: readonly { branch: string; cause: string; verdict?: string }[],
): SupervisionReport => ({
  v: 1,
  at,
  rows: rows.map((r) => ({
    branch: r.branch, worktree: `/desks/${r.branch}`,
    verdict: r.verdict ?? 'defer', cause: r.cause,
  })),
});

/** Builds the rows the way `buildFleet` does, with a supervision reading. */
const rowsWith = async (
  pulse: FleetReading,
  report: SupervisionReport | null,
  now = Date.now(),
): Promise<AgentRow[]> => {
  const supervision = await readSupervisionReport(
    { repoRoot: '/nowhere' } as never,
    storeOf(report),
  );
  const ages = new Map(
    pulse.plans.flatMap((p) => p.slices.flatMap((w) => w.branches.map((b) => [b.branch, 1] as const))),
  );
  return rowsFromPulse(
    pulse, ages as never, 'plot', QUIET, new Map() as never, '', null, now,
    null, null, null, null, null, '', null, null, supervision,
  );
};

const rowFor = async (
  branch: string,
  report: SupervisionReport | null,
  now = Date.now(),
): Promise<AgentRow> => {
  const rows = await rowsWith(pulseWith(branch), report, now);
  const row = rows.find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

describe('the cause reaches the row, from the tick and nowhere else', () => {
  it('carries the cause the tick emitted', async () => {
    const row = await rowFor('bug/deferred', reportOf(Date.now(), [
      { branch: 'bug/deferred', cause: 'no-headroom' },
    ]));
    expect(row.supervisionCause).toBe('no-headroom');
  });

  it('carries a different cause for each desk in one report', async () => {
    const now = Date.now();
    const rows = await rowsWith(
      pulseWith('bug/deferred', 'bug/restarting', 'bug/spent'),
      reportOf(now, [
        { branch: 'bug/deferred', cause: 'no-headroom' },
        { branch: 'bug/restarting', cause: 'no-progress' },
        { branch: 'bug/spent', cause: 'budget-spent', verdict: 'needs-a-person' },
      ]),
      now,
    );
    const by = new Map(rows.map((r) => [r.branch, r.supervisionCause]));
    // THE THREE CAUSES THAT LOOKED THE SAME, now three different words on three
    // rows. This is the defect's whole statement, asserted in one test.
    expect(by.get('bug/deferred')).toBe('no-headroom');
    expect(by.get('bug/restarting')).toBe('no-progress');
    expect(by.get('bug/spent')).toBe('budget-spent');
  });

  /**
   * THE ONE-PRODUCER ASSERTION, made mechanically rather than by inspection.
   *
   * The store throws on `write`, so a board that tried to produce a report fails
   * here. And the reading is the ONLY input carrying a cause — `rowsFromPulse`
   * is synchronous and is handed no world, no host and no scripts, so it could
   * not run the supervision even if it wanted to.
   */
  it('produces no cause of its own when the report has none', async () => {
    const row = await rowFor('bug/unjudged', reportOf(Date.now(), []));
    expect(row.supervisionCause).toBeNull();
  });
});

describe('absent is not false', () => {
  it('reads a missing report as null, never as worker-alive', async () => {
    const row = await rowFor('bug/no-report', null);
    // THE FAILURE THIS CATCHES IS "DEFAULT TO FINE". `worker-alive` is a real
    // cause meaning a worker is running; an unread report says nothing about any
    // worker, and rendering it as that one would report a healthy desk nothing
    // measured.
    expect(row.supervisionCause).toBeNull();
    expect(row.supervisionCause).not.toBe('worker-alive');
  });

  it('reads a desk on another machine as null', async () => {
    // `worker: elsewhere` — no worktree on this machine, so this daemon never
    // supervised it and the report does not name it.
    const row = await rowFor('bug/elsewhere', reportOf(Date.now(), [
      { branch: 'bug/somebody-else', cause: 'no-headroom' },
    ]));
    expect(row.supervisionCause).toBeNull();
  });

  it('reads a store that could not answer as null', async () => {
    const failing: SupervisionReportStore = {
      location: async () => ({ ok: false }) as never,
      read: async () => ({ ok: false }) as never,
      write: async () => ({ ok: false }) as never,
    };
    const reading = await readSupervisionReport({ repoRoot: '/nowhere' } as never, failing);
    expect(reading).toEqual(NO_SUPERVISION_REPORT);
  });

  it('reads a throwing store as null rather than taking the refresh down', async () => {
    const throwing: SupervisionReportStore = {
      location: async () => ({ ok: false }) as never,
      read: async () => {
        throw new Error('EACCES');
      },
      write: async () => ({ ok: false }) as never,
    };
    await expect(
      readSupervisionReport({ repoRoot: '/nowhere' } as never, throwing),
    ).resolves.toEqual(NO_SUPERVISION_REPORT);
  });

  /**
   * THE DEFECT A LIVE RUN FOUND AND THE UNIT TESTS HAD ENCODED AWAY.
   *
   * A FREE agent is registered, holds no slice and has a desk cut detached at
   * `origin/<main>` — `plot-dispatch.sh --start` creates exactly those — so the
   * tick judges it with an EMPTY branch. Measured 2026-09-27 against the live
   * estate: a tick over 8 agents wrote 2 such rows, the entity schema declared
   * `branch: z.string().min(1)`, and the whole report became unparseable, so all
   * 8 desks lost their cause.
   *
   * The escalation is what makes it worth a test: strictness at the ROW level
   * became total loss at the FILE level, because the reader's fallback for an
   * unparseable file is to carry nothing. Every fixture above used a real branch
   * name, so the tests agreed with the wrong assumption.
   */
  it('keeps the other desks when a row names no branch', async () => {
    const now = Date.now();
    const row = await rowFor('bug/real', {
      v: 1,
      at: now,
      rows: [
        { branch: '', worktree: '/desks/free', verdict: 'leave', cause: 'worker-alive' },
        { branch: 'bug/real', worktree: '/desks/real', verdict: 'defer', cause: 'no-headroom' },
      ],
    } as never, now);
    expect(row.supervisionCause).toBe('no-headroom');
  });

  it('keys no cause under an empty branch', async () => {
    const now = Date.now();
    const reading = await readSupervisionReport({ repoRoot: '/nowhere' } as never, storeOf({
      v: 1,
      at: now,
      rows: [{ branch: '', worktree: '/desks/free', verdict: 'leave', cause: 'worker-alive' }],
    } as never));
    // The join is by branch, so an empty key can match no row; storing one would
    // put a cause in the map under a name nothing asks for.
    expect(reading.causes.size).toBe(0);
    expect(reading.at).toBe(now);
  });

  it('drops a cause word this Plot does not know', async () => {
    // A newer daemon's tenth cause must read as *not judged* rather than reach
    // the renderer as a word it cannot describe. The report is a file, so the
    // word is TESTED against the nine and never cast.
    const row = await rowFor('bug/future', reportOf(Date.now(), [
      { branch: 'bug/future', cause: 'a-cause-from-next-year' },
    ]));
    expect(row.supervisionCause).toBeNull();
  });
});

describe('a stale report is not current', () => {
  it('drops a cause from a report older than the bound', async () => {
    const now = Date.now();
    const stale = now - (FLEET_TICK_STALE_SECONDS + 60) * 1_000;
    const row = await rowFor(
      'bug/stale',
      reportOf(stale, [{ branch: 'bug/stale', cause: 'no-headroom' }]),
      now,
    );
    // THE PERSISTED-VERDICT FAILURE. A `no-headroom` from hours ago says nothing
    // about whether the machine has headroom now — the whole point of that cause
    // is that the next tick re-asks it.
    expect(row.supervisionCause).toBeNull();
  });

  it('keeps a cause from a report inside the bound', async () => {
    const now = Date.now();
    const row = await rowFor(
      'bug/fresh',
      reportOf(now - 30_000, [{ branch: 'bug/fresh', cause: 'no-headroom' }]),
      now,
    );
    expect(row.supervisionCause).toBe('no-headroom');
  });
});

describe('the row names the cause', () => {
  it('says the reason where the status word was silent', () => {
    // `workerStatus` answers "" for `elsewhere` and `none` — the population with
    // no live worker, which is every desk this defect is about.
    expect(statusWithCause('', 'no-headroom')).toBe('waiting for room');
  });

  it('qualifies an existing status rather than replacing it', () => {
    expect(statusWithCause('stalled', 'budget-spent')).toBe('stalled · out of attempts');
  });

  it('does not repeat a status back at itself', () => {
    expect(statusWithCause('working', 'worker-alive')).toBe('working');
  });

  it('leaves a row with no cause exactly as it was', () => {
    expect(statusWithCause('stalled', null)).toBe('stalled');
  });

  it('shows the cause on the rendered row', async () => {
    const row = await rowFor('bug/shown', reportOf(Date.now(), [
      { branch: 'bug/shown', cause: 'budget-spent', verdict: 'needs-a-person' },
    ]));
    expect(tupleFromRow(row).status).toContain('out of attempts');
  });
});

describe('no section changes', () => {
  /**
   * THE SHAPE-(3) GUARD. The plan names three shapes for the cause — a sixth
   * `quietKind` value, a sibling field, or an input to `isBrokenState` — and only
   * the third moves rows. It is gated on a payload reading showing a row
   * misplaced, and the measured distribution found none: the one WAITING ON YOU
   * row was `changeset-release/main`, a Changesets PR with no desk at all.
   *
   * So this asserts the negative directly: the same desk lands in the same group
   * with and without a cause.
   */
  it('puts a no-headroom desk in the group it had before', async () => {
    const now = Date.now();
    const pulse = pulseWith('bug/placed');
    const without = (await rowsWith(pulse, null, now)).find((r) => r.branch === 'bug/placed');
    const with_ = (await rowsWith(
      pulse,
      reportOf(now, [{ branch: 'bug/placed', cause: 'no-headroom' }]),
      now,
    )).find((r) => r.branch === 'bug/placed');
    expect(with_?.group).toBe(without?.group);
    expect(with_?.supervisionCause).toBe('no-headroom');
    expect(without?.supervisionCause).toBeNull();
  });

  it('does not move a desk that owes a person either', async () => {
    const now = Date.now();
    const pulse = pulseWith('bug/owed');
    const without = (await rowsWith(pulse, null, now)).find((r) => r.branch === 'bug/owed');
    const with_ = (await rowsWith(
      pulse,
      reportOf(now, [{ branch: 'bug/owed', cause: 'budget-spent', verdict: 'needs-a-person' }]),
      now,
    )).find((r) => r.branch === 'bug/owed');
    // The cause says who owes the desk; the SECTION is still `AgentState`'s
    // answer. Routing by cause is a separate, evidenced decision.
    expect(with_?.group).toBe(without?.group);
  });

  it('leaves the state word the row already had', async () => {
    const now = Date.now();
    const pulse = pulseWith('bug/state');
    const without = (await rowsWith(pulse, null, now)).find((r) => r.branch === 'bug/state');
    const with_ = (await rowsWith(
      pulse,
      reportOf(now, [{ branch: 'bug/state', cause: 'no-headroom' }]),
      now,
    )).find((r) => r.branch === 'bug/state');
    expect(with_?.state).toBe(without?.state);
    expect(with_?.worker).toBe(without?.worker);
  });
});

describe('the server emits the field on every row', () => {
  /**
   * THE CLIENT CASTS THE FLEET RATHER THAN PARSING IT, so a Zod default never
   * runs there: a field the server omits is `undefined` in the renderer, not
   * `null`. Every row must carry the key explicitly.
   */
  it('carries the key on rows built from a ref, not only from a plan', async () => {
    const supervision = await readSupervisionReport(
      { repoRoot: '/nowhere' } as never,
      storeOf(null),
    );
    const rows = rowsFromPulse(
      { plans: [], summary: {} } as never, new Map([['bug/loose', 4_320]]) as never,
      'plot', QUIET, new Map() as never, '', null, Date.now(),
      null, null, null, null, null, '', null, new Set(['bug/loose']), supervision,
    );
    for (const row of rows) {
      expect(Object.hasOwn(row, 'supervisionCause'), row.branch).toBe(true);
      expect(row.supervisionCause).toBeNull();
    }
  });
});
