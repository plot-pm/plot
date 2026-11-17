import { describe, it, expect } from 'vitest';
import type { LinkTarget } from '@plot-pm/domain';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import { deliveryMapping, rateLimitOf, sliceItemId, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { agentAnchor, itemAnchor } from '../../src/app/lib/agent-rows/delivery-view.js';
import {
  actionPlace, detailLines, linkLabel, resolveLink, type LinkContext,
} from '../../src/app/lib/agent-rows/delivery-link-targets.js';
import { agentRowFactsOf, itemRowFactsOf, switchesOf } from '../../src/app/lib/agent-rows/delivery-row-facts.js';

const row = (over: Record<string, unknown>): AgentRow => ({
  branch: '', plan: '', wave: '', kind: 'branch', phase: 'Development', state: 'wip',
  group: 'working', pr: null, question: null, blockedBy: null,
  assignee: '', author: '', approver: '', ...over,
}) as unknown as AgentRow;

const slice = (name: string): Slice => ({
  plan: 'p', name, branches: [], verdict: 'eligible', section: 'building', complete: false,
  planSliceCount: 1,
}) as unknown as Slice;

const agent = (over: Record<string, unknown>): RegistryAgent => ({
  session: 's', branch: '', state: 'running', pid: '', identity: 'manifest', worktree: '',
  relaunches: 0, startedAt: '', ...over,
}) as unknown as RegistryAgent;

const mapping = (rows: AgentRow[], agents: RegistryAgent[] = []) =>
  deliveryMapping({
    rows, slices: [slice('A')], agents, drafts: [], reader: { hostUser: 'me' }, mode: 'all',
    config: { autoReview: true, correctionBudget: 2 },
  });

const ctx: LinkContext = {
  plan: 'p',
  branchUrlBase: 'https://host/o/r/tree/',
  prUrl: (n) => (n === 7 ? 'https://host/o/r/pull/7' : null),
  planFileOf: (p) => (p === 'p' ? 'docs/plans/p.md' : ''),
  branchOfAgent: (id) => (id === 'a1' ? 'feature/a' : ''),
};

describe('resolveLink', () => {
  it('sends a slice to its row on the page', () => {
    expect(resolveLink({ to: 'slice', id: 'A' } as LinkTarget, ctx))
      .toEqual({ kind: 'anchor', id: itemAnchor(sliceItemId('p', 'A')) });
  });

  it('sends an item and an agent to their anchors', () => {
    expect(resolveLink({ to: 'item', id: 'branch:x' } as LinkTarget, ctx)).toEqual({ kind: 'anchor', id: itemAnchor('branch:x') });
    expect(resolveLink({ to: 'agent', id: 'a1' } as LinkTarget, ctx)).toEqual({ kind: 'anchor', id: agentAnchor('a1') });
  });

  it('sends a PR, a plan PR and a review to the PR URL, and to nothing where no row carries the PR', () => {
    for (const to of ['pr', 'plan-pr', 'review'] as const) {
      expect(resolveLink({ to, pr: 7 } as LinkTarget, ctx)).toEqual({ kind: 'href', href: 'https://host/o/r/pull/7' });
      expect(resolveLink({ to, pr: 8 } as LinkTarget, ctx)).toEqual({ kind: 'none' });
    }
  });

  it('sends a url target to that url and to nothing where it is empty', () => {
    expect(resolveLink({ to: 'url', url: 'https://h/checks' } as LinkTarget, ctx)).toEqual({ kind: 'href', href: 'https://h/checks' });
    expect(resolveLink({ to: 'url', url: '' } as LinkTarget, ctx)).toEqual({ kind: 'none' });
  });

  it('sends a plan to its file and to nothing where the plan has none', () => {
    expect(resolveLink({ to: 'plan', plan: 'p' } as LinkTarget, ctx)).toEqual({ kind: 'plan', planFile: 'docs/plans/p.md' });
    expect(resolveLink({ to: 'plan', plan: 'q' } as LinkTarget, ctx)).toEqual({ kind: 'none' });
  });

  it('sends a branch to the host, encoded, and to nothing where the host is unknown', () => {
    expect(resolveLink({ to: 'branch', branch: 'feature/a b' } as LinkTarget, ctx))
      .toEqual({ kind: 'href', href: 'https://host/o/r/tree/feature%2Fa%20b' });
    expect(resolveLink({ to: 'branch', branch: 'x' } as LinkTarget, { ...ctx, branchUrlBase: '' })).toEqual({ kind: 'none' });
  });

  it('reveals the branch of a log or a question, and an action acts', () => {
    expect(resolveLink({ to: 'log', id: 'a1' } as LinkTarget, ctx)).toEqual({ kind: 'reveal', branch: 'feature/a' });
    expect(resolveLink({ to: 'log', id: 'zz' } as LinkTarget, ctx)).toEqual({ kind: 'none' });
    expect(resolveLink({ to: 'question', id: 'feature/a' } as LinkTarget, ctx)).toEqual({ kind: 'reveal', branch: 'feature/a' });
    expect(resolveLink({ to: 'action', action: 'review', id: 'x' } as LinkTarget, ctx)).toEqual({ kind: 'act', action: 'review', id: 'x' });
  });

  it('renders a CI run and a person as text', () => {
    expect(resolveLink({ to: 'ci-run', run: '1' } as LinkTarget, ctx)).toEqual({ kind: 'none' });
    expect(resolveLink({ to: 'person', who: 'jwloka' } as LinkTarget, ctx)).toEqual({ kind: 'none' });
  });
});

describe('linkLabel and actionPlace', () => {
  it('labels a second link by what it is', () => {
    expect(linkLabel({ to: 'pr', pr: 7 } as LinkTarget)).toBe('#7');
    expect(linkLabel({ to: 'review', pr: 7 } as LinkTarget)).toBe('review');
    expect(linkLabel({ to: 'plan', plan: 'p' } as LinkTarget)).toBe('plan');
  });

  it('places each DO action where its controller is', () => {
    expect(actionPlace('review')).toBe('pr');
    expect(actionPlace('resolve-conflict')).toBe('pr');
    expect(actionPlace('release-approve')).toBe('pr');
    expect(actionPlace('continue')).toBe('branch');
    expect(actionPlace('unblock')).toBe('branch');
    expect(actionPlace('approve')).toBe('plan');
  });
});

describe('detailLines', () => {
  it('holds the pid, the desk, extra branches and process pids, once each', () => {
    const lines = detailLines(
      [row({ branch: 'feature/a', processes: [{ pid: '99253' }] }), row({ branch: 'feature/b', processes: [{ pid: '99253' }] })],
      agent({ pid: '99253', worktree: '/d/x', identity: 'inferred', relaunches: 2 }),
    );
    expect(lines).toEqual([
      'pid 99253', 'not from a manifest (inferred)', 'desk /d/x', '2 relaunches', 'branch feature/b',
    ]);
  });

  it('holds nothing for a one-branch row with no agent', () => {
    expect(detailLines([row({ branch: 'feature/a' })], null)).toEqual([]);
  });
});

describe('itemRowFactsOf and agentRowFactsOf', () => {
  it('reads the names a row links to from the payload and leaves the rest absent', () => {
    const m = mapping([row({ branch: 'feature/a', plan: 'p', wave: 'A', pr: { number: 7, state: 'open', open: true }, ageMinutes: 30 })]);
    const id = Object.keys(m.rowsByItem)[0]!;
    const facts = itemRowFactsOf(m, id);
    expect(facts).toMatchObject({ plan: 'p', slice: 'A', branch: 'feature/a', pr: 7, ageMinutes: 30 });
    expect(facts.question).toBeUndefined();
    expect(facts.planPr).toBeUndefined();
  });

  it('reads an agent\'s branch, commit count and PR readings from the payload row of its branch', () => {
    const entry = agent({ session: 's1', branch: 'feature/a' });
    const m = mapping([row({ branch: 'feature/a', plan: 'p', wave: 'A', localAhead: 4, pr: { number: 7, url: 'https://h/pull/7', state: 'pending', ciChecks: 'pending', plotReview: 'pending', headSha: '2d929a6aaaa' } })], [entry]);
    const id = Object.keys(m.agentsById)[0]!;
    expect(agentRowFactsOf(m, id, 0)).toMatchObject({
      branch: 'feature/a', commits: 4, reviewHead: '2d929a6', pr: { ci: 'running', review: 'pending', url: 'https://h/pull/7' },
    });
  });

  it('reads an unobserved commit count as absent and an unknown agent as nothing but the limit', () => {
    const entry = agent({ session: 's1', branch: 'feature/a' });
    const m = mapping([row({ branch: 'feature/a', plan: 'p', wave: 'A', localAhead: 0 })], [entry]);
    expect(agentRowFactsOf(m, Object.keys(m.agentsById)[0]!, 0).commits).toBeUndefined();
    expect(agentRowFactsOf(m, 'nobody', 0)).toEqual({ rateLimit: 'unknown' });
  });

  it('puts the unnamed-desk sentence on a synthesized agent\'s facts', () => {
    const entry = agent({ session: '', identity: 'synthesized', branch: '', checkout: 'bug/x', worktree: '/wt/x' });
    const m = mapping([], [entry]);
    expect(agentRowFactsOf(m, Object.keys(m.agentsById)[0]!, 0).unnamedDesk).toContain('bug/x');
  });
});

describe('the gates a running loop agent waits on', () => {
  const placed = (rows: AgentRow[], rateLimit?: 'exhausted' | 'free' | 'unknown') => {
    const m = deliveryMapping({
      rows, slices: [slice('A')], agents: [agent({ session: 's1', branch: 'feature/a' })], drafts: [], reader: { hostUser: 'me' }, mode: 'all',
      config: { autoReview: true, correctionBudget: 2 }, ...(rateLimit === undefined ? {} : { rateLimit }),
    });
    return m.readings.agents[0]!.blockedOn;
  };
  const withPr = (pr: Record<string, unknown>) => [row({ branch: 'feature/a', plan: 'p', wave: 'A', pr: { number: 7, state: 'pending', ...pr } })];

  it('names ci while the checks run, and review once they passed and the review is pending', () => {
    expect(placed(withPr({ ciChecks: 'pending' }))).toBe('ci');
    expect(placed(withPr({ ciChecks: 'green', plotReview: 'pending' }))).toBe('review');
  });

  it('names no gate where the CI reading is absent', () => {
    expect(placed(withPr({ ciChecks: undefined, state: 'unknown' }))).toBeNull();
    expect(placed(withPr({ ciChecks: 'green', plotReview: 'success' }))).toBeNull();
  });

  it('names rate-limit for an exhausted window only', () => {
    expect(placed(withPr({ ciChecks: 'green' }), 'exhausted')).toBe('rate-limit');
    expect(placed(withPr({ ciChecks: 'green' }), 'unknown')).toBeNull();
    expect(placed(withPr({ ciChecks: 'green' }), 'free')).toBeNull();
  });
});

describe('rateLimitOf', () => {
  it('reads exhausted, free and unknown', () => {
    expect(rateLimitOf({ buckets: [{ remaining: 0, resetAt: 2000 }] }, 1000)).toBe('exhausted');
    expect(rateLimitOf({ buckets: [{ remaining: 0, resetAt: 500 }] }, 1000)).toBe('free');
    expect(rateLimitOf({ buckets: [{ remaining: 40, resetAt: null }] }, 1000)).toBe('free');
    expect(rateLimitOf({ buckets: [{ remaining: null, resetAt: null }] }, 1000)).toBe('unknown');
    expect(rateLimitOf(null, 1000)).toBe('unknown');
  });
});

describe('switchesOf', () => {
  it('reads every switch from the controls and treats an unstated one as on', () => {
    expect(switchesOf({})).toEqual({ autoDispatch: true, autoReview: true, autoVerify: true, autoDesign: true });
    expect(switchesOf({ fleetControls: { autoDispatch: false, autoVerify: false } }))
      .toEqual({ autoDispatch: false, autoReview: true, autoVerify: false, autoDesign: true });
    expect(switchesOf({ autoReview: false })).toMatchObject({ autoReview: false });
  });
});
