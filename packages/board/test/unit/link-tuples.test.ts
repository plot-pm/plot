import { describe, it, expect } from 'vitest';
import { linkIconKind, planIndexOf } from '@plot-pm/domain';
import { GLYPH_PATH } from '../../src/app/lib/glyphs.js';
import {
  LINK_ICON_PATH,
  linkTuplesOf,
  segmentOf,
  splitBranch,
  tupleFromSlice,
  type TupleLink,
} from '../../src/app/lib/tuple-row.js';

const noTickets = (): undefined => undefined;

const pr: TupleLink = { what: 'pr', label: '3581', href: 'https://host/pull/3581' };
const branch: TupleLink = { what: 'branch', label: 'bug/a-red-main-holds-through-its-rerun', href: 'https://host/tree/bug/x' };

describe('a PR and its branch are one tuple with two links', () => {
  it('gives two segments in the order pr, branch, each with its own address', () => {
    const tuples = linkTuplesOf([pr, branch], noTickets);
    expect(tuples).toHaveLength(1);
    expect(tuples[0].map((s) => [s.what, s.href])).toEqual([
      ['pr', 'https://host/pull/3581'],
      ['branch', 'https://host/tree/bug/x'],
    ]);
  });

  it('keeps a PR with no URL as a text segment, inventing no address', () => {
    const [[prSegment, branchSegment]] = linkTuplesOf([{ ...pr, href: '' }, branch], noTickets);
    expect(prSegment.what).toBe('pr');
    expect(prSegment.href).toBe('');
    expect(branchSegment.href).toBe('https://host/tree/bug/x');
  });

  it('keeps a branch with no branchUrl as a text segment', () => {
    const t = tupleFromSlice({
      name: 'Merged', branches: [{ branch: 'feature/gone', branchUrl: '' }],
      solePr: { number: 12, url: 'https://host/pull/12' },
      outstanding: null, ageMinutes: null, waitingDays: null,
    });
    const [[prSegment, branchSegment]] = linkTuplesOf(t.links, noTickets);
    expect(prSegment.href).toBe('https://host/pull/12');
    expect(branchSegment).toMatchObject({ what: 'branch', label: 'feature/gone', href: '' });
  });

  it('draws a slice row\'s links as tuples, and the slice\'s branches without a PR as one tuple each', () => {
    const t = tupleFromSlice({
      name: 'Two', branches: [
        { branch: 'feature/a', branchUrl: 'https://host/tree/feature/a' },
        { branch: 'feature/b', branchUrl: 'https://host/tree/feature/b' },
      ],
      outstanding: 2, ageMinutes: null, waitingDays: null,
    });
    expect(t.linksAsTuples).toBe(true);
    expect(linkTuplesOf(t.links, noTickets).map((tuple) => tuple.map((s) => s.label))).toEqual([['feature/a'], ['feature/b']]);
  });
});

describe('a plan with tickets carries one ticket segment per key before the plan', () => {
  const index = planIndexOf({
    cards: [{ slug: 'red-hold', title: '', issues: ['77', '78'], path: 'docs/plans/2026-07-01-red-hold.md' }],
  });
  const t = tupleFromSlice({
    name: 'w', branches: [{ branch: 'feature/x', branchUrl: 'https://host/tree/feature/x' }],
    solePr: { number: 5, url: 'https://host/pull/5' },
    solePlan: { slug: 'red-hold', file: '2026-07-01-red-hold.md' },
    outstanding: null, ageMinutes: null, waitingDays: null,
  }, index);

  it('puts the tickets first, links each one it can resolve, and keeps an unresolved key as text', () => {
    const href = (key: string) => (key === '77' ? 'https://host/issues/77' : undefined);
    const [, planTuple] = linkTuplesOf(t.links, href);
    expect(planTuple.map((s) => [s.what, s.label, s.href])).toEqual([
      ['ticket', '#77', 'https://host/issues/77'],
      ['ticket', '#78', ''],
      ['plan', 'red-hold', '/plan/2026-07-01-red-hold.md'],
    ]);
    expect(planTuple.map((s) => s.icon)).toEqual([true, false, true]);
    expect(planTuple.map((s) => s.ticketKey)).toEqual(['77', '78', undefined]);
  });
});

describe('a number never truncates; a branch folds in the middle', () => {
  const plan: TupleLink = {
    what: 'plan', label: 'p', href: '/plan/p.md', keys: [{ key: 'EKP-120', text: 'EKP-120' }],
  };

  it('keeps a ticket key and a PR number whole at every tail budget', () => {
    for (let width = 0; width <= 80; width += 1) {
      const [[prSegment], [ticket]] = linkTuplesOf([pr, plan], () => 'https://jira/EKP-120', width);
      expect(ticket).toMatchObject({ label: 'EKP-120', head: 'EKP-120', tail: '', fit: 'whole' });
      expect(ticket.label).not.toContain('…');
      expect(prSegment).toMatchObject({ label: '3581', head: '3581', tail: '', fit: 'whole' });
    }
  });

  it('folds a 60-character branch with a non-empty tail', () => {
    const name = `feature/${'x'.repeat(39)}-hardening-ab`;
    expect(name).toHaveLength(60);
    expect(splitBranch(name).tail).not.toBe('');
    const segment = segmentOf({ what: 'branch', label: name, href: '' });
    expect(segment.fit).toBe('middle');
    expect(segment.head + segment.tail).toBe(name);
    expect(segment.tail).toBe(splitBranch(name).tail);
  });
});

describe('every link kind has its glyph', () => {
  const kinds: readonly TupleLink['what'][] = [
    'plan', 'branch', 'pr', 'ticket', 'wave', 'worktree', 'release', 'story', 'sprint',
  ];

  it('has an entry in LINK_ICON_PATH for every kind', () => {
    expect(Object.keys(LINK_ICON_PATH).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(LINK_ICON_PATH[kind]).toMatch(/^M/);
  });

  it('draws release, story and sprint with the GLYPH_PATH entries of the same name', () => {
    expect(LINK_ICON_PATH.release).toBe(GLYPH_PATH.release);
    expect(LINK_ICON_PATH.story).toBe(GLYPH_PATH.story);
    expect(LINK_ICON_PATH.sprint).toBe(GLYPH_PATH.sprint);
  });

  it('names an icon kind for every link kind through linkIconKind', () => {
    for (const kind of kinds) expect(linkIconKind(kind)).not.toBeNull();
    expect(linkIconKind('wave')).toBe('slice');
  });
});
