import { describe, it, expect } from 'vitest';
import { withHandOver } from '../../src/server/fleet.js';
import { AgentRowSchema, AgentEntrySchema } from '../../src/contract/schema.js';
import type { AgentRow, AgentEntry } from '../../src/contract/schema.js';

// A SLICE THE REGISTRY HAS HANDED TO A LIVE AGENT READS AS TAKEN.
//
// Measured 2026-10-01 on `localhost:7777`: WORKING listed agent `334b3492` on
// `bug/the-rule-names-a-usage-limit` from its manifest, while the same slice's
// row read `eligible · approved — nobody has taken it · 0m` in NOT STARTED,
// with that agent's own activity dot beside it. `bug/a-closed-sprint-stops-
// filtering` and `bug/the-merge-subject-is-one-rule` read the same way.
//
// The window is long: a free agent reads its manifest once every 60 s
// (`plot-worker-loop.sh`), and until it does no worktree holds the branch, so
// the scan answers `elsewhere` and `classifyGroup` reads `open` or `claimed`.
//
// THIS SUITE PROVES THE SERVER RULE. The browser test beside it proves only
// that the note renders, and cannot catch a bug in here.

// FIXTURES FROM THE SCHEMAS, not from `../catalogue/`: importing the catalogue
// marks a file as a browser test, and this one drives no page.
const BRANCH = 'bug/the-rule-names-a-usage-limit';
const HANDED = 'handed over — not taken up yet';

const row = (over: Partial<AgentRow> = {}): AgentRow => AgentRowSchema.parse({
  repo: 'plot', kind: 'branch', branch: BRANCH, plan: 'a-plan',
  planFile: '2026-10-01-a-plan.md', wave: 'Wave', state: 'open', phase: 'Development',
  group: 'not-started', ageMinutes: 0, note: 'eligible — nobody has taken it',
  pr: null, branchUrl: '', verdict: 'eligible', startability: 'start-work',
  worker: 'elsewhere', ...over,
});

const agent = (over: Partial<AgentEntry> = {}): AgentEntry => AgentEntrySchema.parse({
  session: '334b3492', branch: BRANCH, worktree: '', command: '',
  startedAt: '', pid: '4242', previousPid: '', relaunches: 0, state: 'running', ...over,
});

/** The one row `withHandOver` answered, for a case that passes exactly one. */
const only = (r: AgentRow, agents: AgentEntry[]): AgentRow => {
  const out = withHandOver([r], agents);
  expect(out).toHaveLength(1);
  return out[0];
};

describe('a slice handed to one live agent reads WORKING, with the hand-over note', () => {
  it('moves a not-started row whose branch a running agent names', () => {
    const r = only(row(), [agent()]);
    expect(r.group).toBe('working');
    expect(r.note).toBe(HANDED);
    expect(r.startability).toBe('someone-is-on-it');
  });

  it('moves the orphaned claim past the quiet window', () => {
    // 45 minutes against a 30-minute window — `classifyGroup` has already read
    // this as an orphaned claim in WAITING ON YOU. A `not-started`-only rule
    // leaves this case contradicting WORKING, which is why the plan names it.
    const r = only(row({
      state: 'claimed', group: 'waiting-on-you', pr: null, ageMinutes: 45,
      note: 'claimed, no work committed — claimed 45 min ago · claimed elsewhere',
    }), [agent()]);
    expect(r.group).toBe('working');
    expect(r.note).toBe(HANDED);
    expect(r.startability).toBe('someone-is-on-it');
  });

  it('moves a row whose agent is waiting, not running', () => {
    // `waiting` is live: `LIVE_STATES` holds both, and `workingAgentRows` puts
    // both in WORKING. A rule testing `running` alone leaves this row behind
    // the section its own agent appears in.
    const r = only(row(), [agent({ state: 'waiting' })]);
    expect(r.group).toBe('working');
    expect(r.note).toBe(HANDED);
    expect(r.startability).toBe('someone-is-on-it');
  });

  it('keeps every other field of the row it moves', () => {
    const before = row({ plan: 'a-handed-slice-reads-as-taken', wave: 'The row', ageMinutes: 7 });
    const after = only(before, [agent()]);
    expect(after.branch).toBe(BRANCH);
    expect(after.plan).toBe('a-handed-slice-reads-as-taken');
    expect(after.wave).toBe('The row');
    expect(after.ageMinutes).toBe(7);
    expect(after.state).toBe('open');
    expect(after.verdict).toBe('eligible');
  });
});

describe('a slice handed to two live agents at once is a fault for a person', () => {
  it('sends the row to WAITING ON YOU naming the count', () => {
    const r = only(row(), [agent(), agent({ session: '4b603822', state: 'waiting' })]);
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toBe('handed to 2 agents at once');
    expect(r.startability).toBe('someone-is-on-it');
  });

  it('counts only the live agents on the branch', () => {
    // A third agent that failed is not a third hand-out.
    const r = only(row(), [
      agent(),
      agent({ session: '4b603822' }),
      agent({ session: 'deadbeef', state: 'failed' }),
    ]);
    expect(r.note).toBe('handed to 2 agents at once');
  });
});

describe('absence is not falsehood — #1090 holds wherever the registry says nothing', () => {
  it('leaves a not-started row no agent names', () => {
    const before = row();
    expect(only(before, [agent({ branch: 'bug/a-closed-sprint-stops-filtering' })])).toEqual(before);
  });

  it('leaves a not-started row when the registry is empty', () => {
    const before = row();
    expect(only(before, [])).toEqual(before);
  });

  it('leaves the orphaned claim no agent names', () => {
    const before = row({
      state: 'claimed', group: 'waiting-on-you', pr: null, ageMinutes: 45,
      note: 'claimed, no work committed — claimed 45 min ago · claimed elsewhere',
    });
    expect(only(before, [])).toEqual(before);
  });

  // AN AGENT THAT DIED ON AN EMPTY CLAIM stops matching, and the row returns to
  // the classifier's answer — NOT STARTED inside the window, WAITING ON YOU
  // after it. `brokenAgentRows` shows the agent itself in WAITING ON YOU.
  for (const state of ['failed', 'finished', 'stalled', 'ended'] as const) {
    it(`leaves a not-started row whose agent is ${state}`, () => {
      const before = row();
      expect(only(before, [agent({ state })])).toEqual(before);
    });
  }

  it('leaves a row with no branch, however many free agents there are', () => {
    const before = row({ branch: '' });
    expect(only(before, [agent({ branch: '' }), agent({ session: 'f00dbeef', branch: '' })]))
      .toEqual(before);
  });

  it('leaves a not-started row whose slice a live UNNAMED desk has checked out', () => {
    // #1101's other half: a synthesized entry's `branch` is `''` (the desk's
    // checkout moved to `checkout`), so a live undeclared desk no longer
    // matches any branch here and the slice stays `not-started` rather than
    // reading `someone-is-on-it` for an agent the registry cannot name. This
    // is intended, not a gap: `checkout` is display-only and no decision —
    // including this one — reads it.
    const before = row();
    const synthesized = agent({
      session: '', identity: 'synthesized', branch: '', checkout: BRANCH, state: 'running',
    });
    expect(only(before, [synthesized])).toEqual(before);
  });
});

describe('the rule moves nothing it was not asked to move', () => {
  it('leaves a Draft plan\'s row, so #1161 keeps naming the approval owed', () => {
    // Dispatch refuses a Draft slice, so a live agent on one is a fault in its
    // own right and the row must keep saying a person owes an approval.
    const before = row({ verdict: 'unapproved', note: 'plan not approved yet — still in review' });
    expect(only(before, [agent()])).toEqual(before);
  });

  // THE WORKER GUARD IS TESTED IN A CANDIDATE GROUP, and that is the whole
  // assertion. A `worker: 'running'` row that also sits in `working` is rejected
  // by the GROUP test one line above, so deleting the worker guard left such a
  // case passing — measured by mutation while this suite was written. The row
  // below is `not-started`, so only the worker guard can keep it.
  it('leaves a not-started row the scan already sees a running worker on', () => {
    const before = row({ worker: 'running', note: 'worker running (pid 4242)' });
    expect(only(before, [agent()])).toEqual(before);
  });

  it('leaves the orphaned claim once the scan sees its worker', () => {
    // The scan has seen more than the registry has: once a worker is visible on
    // the branch, `classifyGroup`'s answer is the better one and this rule must
    // not overwrite the note it composed.
    const before = row({
      state: 'claimed', group: 'waiting-on-you', pr: null, ageMinutes: 45,
      worker: 'waiting', note: 'the worker asked a question',
    });
    expect(only(before, [agent({ state: 'waiting' })])).toEqual(before);
  });

  it('leaves a claimed WAITING ON YOU row that carries a PR', () => {
    const before = row({
      state: 'claimed', group: 'waiting-on-you', ageMinutes: 45,
      pr: { number: 1150, url: 'https://example.invalid/1150', draft: false, state: 'green' },
    });
    expect(only(before, [agent()])).toEqual(before);
  });

  for (const group of ['done', 'quiet', 'waiting-on-machine', 'working'] as const) {
    it(`leaves a ${group} row`, () => {
      const before = row({ group });
      expect(only(before, [agent()])).toEqual(before);
    });
  }

  it('leaves an unplaced row, which belongs to no section at all', () => {
    const before = row({ group: null });
    expect(only(before, [agent()])).toEqual(before);
  });
});

describe('withHandOver is total and replaces rather than mutates', () => {
  it('answers every row it is handed, in order', () => {
    const a = row({ branch: BRANCH });
    const b = row({ branch: 'bug/a-closed-sprint-stops-filtering' });
    const out = withHandOver([a, b], [agent()]);
    expect(out).toHaveLength(2);
    expect(out[0].group).toBe('working');
    expect(out[1].group).toBe('not-started');
  });

  it('returns [] for no rows', () => {
    expect(withHandOver([], [agent()])).toEqual([]);
  });

  it('does not edit the row it was handed', () => {
    // `deriveSlices` reads the same pulse below the call site, and must not see
    // a group this rule decided.
    const before = row();
    withHandOver([before], [agent()]);
    expect(before.group).toBe('not-started');
    expect(before.note).toBe('eligible — nobody has taken it');
    expect(before.startability).toBe('start-work');
  });
});
