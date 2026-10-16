import { describe, it, expect } from 'vitest';
import { withEndedDesks } from '../../src/server/ended-desks.js';
import { brokenAgentRows } from '../../src/app/lib/agent-rows/working-agents.js';
import { AgentEntrySchema, AgentRowSchema, type AgentRow } from '../../src/contract/schema.js';

/**
 * A desk that ended at the bound with its slice merged, a clean tree and
 * nothing unpushed leaves Waiting on you. The deciding is
 * `endedDeskPlacement`'s; this file proves the board feeds it from the desk's
 * ending record and the slice's row, and that a missing reading keeps the
 * entry where it was.
 */
const BOUND = JSON.stringify({ reason: 'bound', actor: 'bound', branch: 'feature/x', detail: '' });

const desk = (over: Record<string, unknown> = {}) =>
  AgentEntrySchema.parse({ session: 's1', branch: 'feature/x', worktree: '/wt/x', state: 'stalled', ...over });

const merged = (over: Record<string, unknown> = {}): AgentRow =>
  AgentRowSchema.parse({
    repo: 'r', branch: 'feature/x', plan: 'p', wave: 'w', state: 'merged', group: 'done',
    ageMinutes: 1, note: '', ...over,
  });

const waiting = (agents: ReturnType<typeof desk>[]) => brokenAgentRows(agents, new Map()).map((r) => r.agent);

describe('an ended desk in Waiting on you', () => {
  it('leaves for a merged slice, a clean tree and a bound ending', () => {
    const [agent] = withEndedDesks([desk()], [merged()], () => BOUND);
    expect(agent.ended?.owesPerson).toBe(false);
    expect(agent.ended?.note).toContain('no slice offered');
    expect(waiting([agent!])).toEqual([]);
  });

  it('stays when the tree is dirty', () => {
    const [agent] = withEndedDesks([desk()], [merged({ localDirty: true })], () => BOUND);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when commits are unpushed', () => {
    const [agent] = withEndedDesks([desk()], [merged({ localAhead: 2 })], () => BOUND);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when the desk holds a PLOT-BLOCKED question', () => {
    const question = { firstLine: 'which?', askedAt: '2026-10-16T00:00:00Z' };
    const [agent] = withEndedDesks([desk()], [merged({ question })], () => BOUND);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when no ending record exists', () => {
    const [agent] = withEndedDesks([desk()], [merged()], () => null);
    expect(agent.ended).toBeUndefined();
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when no row joins the desk', () => {
    const [agent] = withEndedDesks([desk()], [], () => BOUND);
    expect(waiting([agent!])).toHaveLength(1);
  });
});
