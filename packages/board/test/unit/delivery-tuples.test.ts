import { describe, it, expect } from 'vitest';
import { planIndexOf, type LinkTarget } from '@plot-pm/domain';
import {
  artifactTuple,
  linkTuplesOf,
  tupleFromAgent,
  tupleFromBuild,
  tupleFromIssue,
  tupleFromPlan,
  tupleFromRow,
  tupleFromSlice,
  type TupleLink,
  type TupleRow,
  type TupleSegment,
} from '../../src/app/lib/tuple-row.js';
import { cellArtifact } from '../../src/app/lib/agent-rows/delivery-link-targets.js';
import { AgentRowSchema, IssueRowSchema, type AgentRow } from '../../src/contract/schema.js';

const noTickets = (): undefined => undefined;

const row = (over: Partial<AgentRow> = {}): AgentRow => AgentRowSchema.parse({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-20-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', planState: 'approved', group: 'waiting-on-you',
  ageMinutes: 30, note: '', ...over,
});

/** The segments of a row's name and links, one tuple each, as `[what, label, href]` triples. */
const drawn = (t: TupleRow, ticketHref: (key: string) => string | undefined = noTickets): [string, string, string][][] =>
  linkTuplesOf([t.name, ...t.links], ticketHref).map((tuple) => tuple.map((s) => [s.what, s.label, s.href]));

const triples = (segments: TupleSegment[]): [string, string, string][] => segments.map((s) => [s.what, s.label, s.href]);

describe('every row kind draws its artifacts as tuples', () => {
  it('slice: its PR and branch are one tuple', () => {
    const t = tupleFromSlice({
      name: 'Shaped', plan: 'a-plan', branches: [{ branch: 'feature/x', branchUrl: 'https://host/tree/feature/x' }],
      solePr: { number: 9, url: 'https://host/pull/9' },
      outstanding: null, ageMinutes: null, waitingDays: null,
    });
    expect(t.kind).toBe('wave');
    expect(linkTuplesOf(t.links, noTickets).map(triples)).toEqual([[['pr', '9', 'https://host/pull/9'], ['branch', 'feature/x', 'https://host/tree/feature/x']]]);
  });

  it('plan: the plan, then its PR and branch as one tuple', () => {
    const t = tupleFromPlan({
      plan: 'a-plan', planFile: '2026-08-20-a-plan.md', phase: 'Design', planState: 'design', waitingDays: 3, issues: [],
      branch: 'idea/a-plan', branchUrl: 'https://host/tree/idea/a-plan',
      pr: { number: 42, url: 'https://host/pr/42', draft: false, state: 'OPEN' },
    });
    const tuples = drawn(t);
    expect(tuples[0].map((s) => s[0])).toEqual(['plan']);
    expect(tuples[0][0][1]).toBe('a-plan');
    expect(tuples[1]).toEqual([['pr', '42', 'https://host/pr/42'], ['branch', 'idea/a-plan', 'https://host/tree/idea/a-plan']]);
  });

  it('pr: the PR number is a whole segment with its address', () => {
    const t = tupleFromRow(row({
      kind: 'pr', pr: { number: 57, url: 'https://host/pr/57', draft: false, state: 'green' },
      branchUrl: 'https://host/tree/feature/x',
    }));
    const segments = linkTuplesOf([t.name, ...t.links], noTickets).flat();
    const pr = segments.find((s) => s.what === 'pr');
    expect(pr).toMatchObject({ label: '57', href: 'https://host/pr/57', fit: 'whole' });
    expect(segments.find((s) => s.what === 'branch')).toMatchObject({ label: 'feature/x', href: 'https://host/tree/feature/x' });
  });

  it('branch: the branch links to its tree, and folds in the middle', () => {
    const t = tupleFromRow(row({ kind: 'branch', branchUrl: 'https://host/tree/feature/x' }));
    const branch = linkTuplesOf([t.name, ...t.links], noTickets).flat().find((s) => s.what === 'branch');
    expect(branch).toMatchObject({ label: 'feature/x', href: 'https://host/tree/feature/x', fit: 'middle' });
  });

  it('release: a release with no URL in the payload is one text segment, and its PR links by number', () => {
    expect(triples(artifactTuple({ what: 'release', label: '2.7.0', href: '' }, noTickets))).toEqual([['release', '2.7.0', '']]);
    const t = tupleFromRow(row({
      kind: 'release', plan: '2.7.0', planFile: '', branch: 'changeset-release/main',
      branchUrl: 'https://host/tree/changeset-release/main',
      pr: { number: 300, url: 'https://host/pr/300', draft: false, state: 'none' },
    }));
    const segments = linkTuplesOf([t.name, ...t.links], noTickets).flat();
    expect(segments.find((s) => s.what === 'pr')).toMatchObject({ label: '2.7.0', href: 'https://host/pr/300' });
  });

  it('story: one story segment with its address', () => {
    expect(triples(artifactTuple({ what: 'story', label: 'the-fleet', href: '/story/the-fleet', internal: true }, noTickets)))
      .toEqual([['story', 'the-fleet', '/story/the-fleet']]);
  });

  it('ticket: the ticket number links to the tracker and never truncates', () => {
    const t = tupleFromIssue(IssueRowSchema.parse({ number: 228, title: 'Scan asks once', url: 'https://host/issues/228', ageMinutes: 5 }));
    const [ticket] = linkTuplesOf([t.name], noTickets)[0];
    expect(ticket).toMatchObject({ what: 'ticket', href: 'https://host/issues/228', fit: 'whole' });
    expect(triples(artifactTuple({ what: 'ticket', label: '228', href: 'https://host/issues/228' }, noTickets)))
      .toEqual([['ticket', '228', 'https://host/issues/228']]);
  });

  it('sprint: one sprint segment with its address', () => {
    expect(triples(artifactTuple({ what: 'sprint', label: 'week-47', href: '/sprint/week-47', internal: true }, noTickets)))
      .toEqual([['sprint', 'week-47', '/sprint/week-47']]);
  });

  it('build: the run, then the PR it ran for', () => {
    const t = tupleFromBuild({
      name: 'CI:1860', url: 'https://host/run/1860', prNumber: 283,
      prUrl: 'https://host/pr/283', status: 'CI is running', ageMinutes: 10,
    });
    const segments = linkTuplesOf([t.name, ...t.links], noTickets).flat();
    expect(segments.map((s) => [s.label, s.href])).toEqual([['CI:1860', 'https://host/run/1860'], ['PR 283', 'https://host/pr/283']]);
  });

  it('agent: the agent, then the branch it works on', () => {
    const t = tupleFromAgent({
      sessionId: 'f30b27a3ab', branch: 'feature/x', branchUrl: 'https://host/tree/feature/x',
      status: 'thinking', sessionSeconds: 60, idleSeconds: 0,
    });
    const segments = linkTuplesOf([t.name, ...t.links], noTickets).flat();
    expect(segments.find((s) => s.what === 'branch')).toMatchObject({ label: 'feature/x', href: 'https://host/tree/feature/x' });
  });
});

describe('a plan carries its ticket keys before it', () => {
  const plan = (issues: string[]): TupleRow => tupleFromPlan({
    plan: 'red-hold', planFile: '2026-07-01-red-hold.md', phase: 'Design', planState: 'design', waitingDays: 1, issues,
  }, planIndexOf({ cards: [{ slug: 'red-hold', title: '', issues, path: 'docs/plans/2026-07-01-red-hold.md' }] }));
  const href = (key: string) => `https://host/issues/${key}`;

  it('draws two tickets as two ticket segments, then the plan', () => {
    const [tuple] = linkTuplesOf([plan(['77', '78']).name], href);
    expect(tuple.map((s) => s.what)).toEqual(['ticket', 'ticket', 'plan']);
    expect(tuple.slice(0, 2).map((s) => s.href)).toEqual(['https://host/issues/77', 'https://host/issues/78']);
  });

  it('draws the plan alone where it has no ticket', () => {
    const [tuple] = linkTuplesOf([plan([]).name], href);
    expect(tuple.map((s) => s.what)).toEqual(['plan']);
  });

  it('keeps a long key whole, with no ellipsis', () => {
    const keyed: TupleLink = { what: 'plan', label: 'p', href: '/plan/p.md', keys: [{ key: 'PLATFORM-12345', text: 'PLATFORM-12345' }] };
    const [ticket] = artifactTuple(keyed, () => 'https://jira/PLATFORM-12345', 0);
    expect(ticket).toMatchObject({ label: 'PLATFORM-12345', head: 'PLATFORM-12345', tail: '', fit: 'whole' });
    expect(ticket.label).not.toContain('…');
  });
});

describe('an empty address gives a text segment', () => {
  it('keeps the kind and the label and invents no address', () => {
    for (const what of ['plan', 'pr', 'branch', 'ticket', 'release'] as const) {
      expect(artifactTuple({ what, label: 'x', href: '' }, noTickets)[0]).toMatchObject({ what, label: 'x', href: '' });
    }
  });
});

describe('cellArtifact', () => {
  it('keeps the address of an href arm', () => {
    const target: LinkTarget = { to: 'pr', pr: 7 };
    expect(cellArtifact(target, { kind: 'href', href: 'https://host/pull/7' }, '#7'))
      .toEqual({ what: 'pr', label: '#7', href: 'https://host/pull/7' });
  });

  it('links an anchor arm to its id', () => {
    const target: LinkTarget = { to: 'agent', id: 'a1' };
    expect(cellArtifact(target, { kind: 'anchor', id: 'agent-a1' }, 'a1')).toEqual({ what: 'agent', label: 'a1', href: '#agent-a1' });
  });

  it('gives a plan arm no address, so its segment is text', () => {
    const target: LinkTarget = { to: 'plan', plan: 'red-hold' };
    expect(cellArtifact(target, { kind: 'plan', planFile: '2026-07-01-red-hold.md' }, 'red-hold'))
      .toEqual({ what: 'plan', label: 'red-hold', href: '' });
  });

  it('draws nothing for an action', () => {
    const target: LinkTarget = { to: 'action', action: 'review', id: 'x' };
    expect(cellArtifact(target, { kind: 'act', action: 'review', id: 'x' }, 'review')).toBeNull();
  });
});
