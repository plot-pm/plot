import { describe, it, expect } from 'vitest';
import { workingAgentRows } from '../../src/app/lib/agent-rows/working-agents.js';
import { AgentEntrySchema, AgentRowSchema, type AgentEntry, type AgentRow } from '../../src/contract/schema.js';

/**
 * WORKING IS THE REGISTRY, NOT THE BRANCH ROWS —
 * `the-working-section-shows-every-worker`, wave 1 (Shown).
 *
 * A worker in a worktree is a fact about the FLEET; its branch's state is a
 * fact about the WORK. The old section derived the first from the second — a
 * worker rendered only where the pulse produced a row for its branch AND
 * `classify` put that row in WORKING — so the section could be empty while 23
 * agents existed. `workingAgentRows` inverts that: it iterates the REGISTRY and
 * joins BACK to a branch row where one exists.
 *
 * This suite settles the SELECTION and the JOIN, which are data. That every
 * entry renders a discoverable DOM row, that a merged branch keeps its own row
 * in DONE, and that only a running worker reads `someone is on it` are claims
 * about a page and live in `test/integration/working-shows-every-agent`.
 */
const agent = (over: Partial<AgentEntry> = {}): AgentEntry =>
  AgentEntrySchema.parse({ session: 's1', branch: 'feature/x', worktree: '/wt/plot-wt-x', ...over });

const row = (over: Partial<AgentRow> = {}): AgentRow =>
  AgentRowSchema.parse({
    repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-24-a-plan.md',
    wave: 'w', state: 'wip', phase: 'Development', group: 'working', ageMinutes: 3,
    note: '', ...over,
  });

/** The branch→row map the caller builds once, over EVERY row of every section. */
const byBranch = (rows: AgentRow[]): Map<string, AgentRow> =>
  new Map(rows.map((r) => [r.branch, r]));

describe('workingAgentRows — one entry per registry agent', () => {
  it('renders one row per registry entry, whatever the branch rows show', () => {
    // Done when #1: 23 entries → 23 rows. The count here is smaller but the
    // rule is the same: the length of the result is the length of the registry,
    // never the length of the branch rows in WORKING.
    const agents = [
      agent({ session: 'a', branch: 'feature/one' }),
      agent({ session: 'b', branch: 'feature/two' }),
      agent({ session: 'c', branch: 'feature/three' }),
    ];
    // Only ONE of the three branches has a row, and it is not even in WORKING.
    const rows = [row({ branch: 'feature/one', group: 'done', state: 'merged' })];
    const actual = workingAgentRows(agents, byBranch(rows));
    expect(actual).toHaveLength(3);
    expect(actual.map((e) => e.agent.session)).toEqual(['a', 'b', 'c']);
  });

  it('joins each entry to its branch row where one exists', () => {
    // Where a branch row exists the worker row carries what the row knows — the
    // join used everywhere else, by `agent.branch === row.branch`.
    const branchRow = row({ branch: 'feature/joined', plan: 'joins-here' });
    const actual = workingAgentRows([agent({ branch: 'feature/joined' })], byBranch([branchRow]));
    expect(actual[0].row).toBe(branchRow);
  });

  it('leaves the row NULL where the registry names a branch no row carries', () => {
    // Done when #2: a worker whose branch has no row anywhere still renders.
    // The six here are `…-recut` scratch branches, `main`, an unlisted branch —
    // the pulse never produced a row, and the worker must render regardless. A
    // null row is *absent is not false*: the caller states only what the
    // registry knows.
    const actual = workingAgentRows([agent({ branch: 'main' })], byBranch([]));
    expect(actual).toHaveLength(1);
    expect(actual[0].row).toBeNull();
  });

  it('joins a merged branch to its DONE row, without moving that row', () => {
    // Done when #3: a worker whose branch merged still renders here, joined to
    // the row that (elsewhere) sits in DONE. `workingAgentRows` returns the
    // join; it never rewrites the row's `group`, so the DONE section keeps it.
    const merged = row({ branch: 'feature/landed', group: 'done', state: 'merged' });
    const actual = workingAgentRows([agent({ branch: 'feature/landed' })], byBranch([merged]));
    expect(actual[0].row).toBe(merged);
    expect(actual[0].row?.group).toBe('done');
  });

  it('joins an entry with no branch at all to a null row', () => {
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
