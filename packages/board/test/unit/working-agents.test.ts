import { describe, it, expect } from 'vitest';
import { workingAgentRows } from '../../src/app/lib/agent-rows/working-agents.js';
import {
  AgentEntrySchema,
  AgentRowSchema,
  AgentStateSchema,
  type AgentEntry,
  type AgentRow,
} from '../../src/contract/schema.js';

/**
 * WORKING RENDERS THE WORKERS THAT ARE WORKING —
 * `working-lists-the-live-agents`.
 *
 * `the-working-section-shows-every-worker` inverted a branch-derived section so
 * a live worker was never hidden by its branch's row being absent, scratch or
 * merged — but it kept EVERY registry entry, and a registry entry for a session
 * that has ENDED is not a worker. `workingAgentRows` now filters to the LIVE
 * states — `running` and `waiting`, the dispatcher's own `LIVE_STATES` — before
 * it joins, so the section's subject (who is working) matches its contents.
 *
 * This suite settles the SELECTION and the JOIN, which are data. That every
 * live entry renders a discoverable DOM row, and that a running worker reads
 * `running`, are claims about a page and live in
 * `test/integration/working-shows-every-agent`.
 */
const agent = (over: Partial<AgentEntry> = {}): AgentEntry =>
  // Default to a LIVE state: the join and null-row cases below are about a
  // WORKING row, so the fixture must survive the filter to reach them.
  AgentEntrySchema.parse({ session: 's1', branch: 'feature/x', worktree: '/wt/plot-wt-x', state: 'running', ...over });

const row = (over: Partial<AgentRow> = {}): AgentRow =>
  AgentRowSchema.parse({
    repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-24-a-plan.md',
    wave: 'w', state: 'wip', phase: 'Development', group: 'working', ageMinutes: 3,
    note: '', ...over,
  });

/** The branch→row map the caller builds once, over EVERY row of every section. */
const byBranch = (rows: AgentRow[]): Map<string, AgentRow> =>
  new Map(rows.map((r) => [r.branch, r]));

describe('workingAgentRows — the live workers, joined to their branch rows', () => {
  it('renders exactly the running and waiting entries, over the whole enum', () => {
    // Done when #1: a registry holding an entry in EVERY one of the nine states
    // renders the `running` and `waiting` ones and NO other. Asserted over
    // `AgentStateSchema.options` so a new state cannot be added without this
    // test having an opinion about it, and its size is pinned so the enum cannot
    // grow silently underneath the filter. Pinned at NINE since 2026-09-04: the
    // four the registry used to fold into `unknown` are members now, and every
    // one of them is dead — a widened enum whose filter did not widen with it
    // would have rendered four dead states as live workers.
    expect(AgentStateSchema.options).toHaveLength(9);
    const agents = AgentStateSchema.options.map((state, i) =>
      agent({ session: `s${i}`, branch: `feature/${state}`, state }));
    const actual = workingAgentRows(agents, byBranch([]));
    expect(actual.map((e) => e.agent.state)).toEqual(['running', 'waiting']);
  });

  it('drops every dead entry — an ended session is not a worker', () => {
    // The seven non-live states, each on a branch that HAS a WORKING row: the
    // filter is on the entry's state, not on whether a row exists to join. None
    // survives. `failed`, `ended`, `none` and `elsewhere` are here because they
    // became members on 2026-09-04 — before that they arrived as `unknown` and
    // this test could not have named them.
    const dead = ['stalled', 'finished', 'unknown', 'failed', 'ended', 'none', 'elsewhere'] as const;
    const rows = dead.map((state) => row({ branch: `feature/${state}` }));
    const agents = dead.map((state) => agent({ branch: `feature/${state}`, state }));
    expect(workingAgentRows(agents, byBranch(rows))).toHaveLength(0);
  });

  it('renders an unrecognised tenth state — the filter is a denylist, not an allowlist', () => {
    // Design: an OLDER board reading a NEWER registry must SHOW a state it does
    // not recognise, not hide it — a worker nobody can see is the worse failure.
    // The schema would reject `queued`, so the entry is constructed past it; the
    // filter must still let it through because it is not one of the known dead
    // states.
    const rogue = { ...agent(), state: 'queued' } as unknown as AgentEntry;
    const actual = workingAgentRows([rogue], byBranch([]));
    expect(actual).toHaveLength(1);
    expect(actual[0].agent.state).toBe('queued');
  });

  it('joins each live entry to its branch row where one exists', () => {
    // Where a branch row exists the worker row carries what the row knows — the
    // join used everywhere else, by `agent.branch === row.branch`.
    const branchRow = row({ branch: 'feature/joined', plan: 'joins-here' });
    const actual = workingAgentRows([agent({ branch: 'feature/joined' })], byBranch([branchRow]));
    expect(actual[0].row).toBe(branchRow);
  });

  it('leaves the row NULL where the registry names a branch no row carries', () => {
    // A live worker whose branch has no row anywhere still renders. The branch
    // here is `main` — the board is served from it, so the pulse never produced
    // a row. A null row is *absent is not false*: the caller states only what
    // the registry knows.
    const actual = workingAgentRows([agent({ branch: 'main' })], byBranch([]));
    expect(actual).toHaveLength(1);
    expect(actual[0].row).toBeNull();
  });

  it('joins a merged branch to its DONE row, without moving that row', () => {
    // A live worker whose branch merged still renders here, joined to the row
    // that (elsewhere) sits in DONE. `workingAgentRows` returns the join; it
    // never rewrites the row's `group`, so the DONE section keeps it.
    const merged = row({ branch: 'feature/landed', group: 'done', state: 'merged' });
    const actual = workingAgentRows([agent({ branch: 'feature/landed' })], byBranch([merged]));
    expect(actual[0].row).toBe(merged);
    expect(actual[0].row?.group).toBe('done');
  });

  it('joins a live entry with no branch at all to a null row', () => {
    // An agent between branches carries `branch: ''` — empty is a real value.
    // There is nothing to join to, and the empty string must not match a row
    // that also happens to carry `branch: ''` (a release/idea row can). A join
    // on the empty branch would attach an unrelated row's plan and PR to a
    // worker that holds neither — the *absent is not false* failure exactly.
    const emptyBranchRow = row({ branch: '', plan: 'not-this-agents', group: 'done' });
    const actual = workingAgentRows([agent({ branch: '' })], byBranch([emptyBranchRow]));
    expect(actual[0].row).toBeNull();
  });
});
