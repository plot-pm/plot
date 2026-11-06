import { describe, expect, it } from 'vitest';
import { cardControls, planCardFacts, type PlanCardFactsReadings } from '@plot-pm/domain';
import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import {
  presentCard, presentDetails, reasonWords, relativeAge, type CardSections, type Part, type Piece,
} from '../../src/app/lib/card-presentation.js';

const NOW = Date.parse('2026-11-06T12:00:00');

const reading = (over: Partial<PlanCardFactsReadings> = {}): PlanCardFactsReadings => ({
  slug: 'x',
  title: 'X',
  path: 'docs/plans/2026-11-01-x.md',
  type: 'feature',
  assignee: 'jwloka',
  state: 'approved',
  issues: [],
  records: { designRaw: '', approvedRaw: '', startedRaw: '', deliveredRaw: '', releasedRaw: '' },
  status: 'approved',
  controls: cardControls({ state: 'approved', status: 'approved', started: false }),
  deliverable: false,
  rounds: null,
  slices: { total: 2, complete: 1, eligible: 1, waitsOn: [] },
  spike: null,
  prs: { value: [] },
  verification: null,
  cost: null,
  story: null,
  sprint: null,
  notPushed: false,
  ...over,
});

const sections = (over: Partial<PlanCardFactsReadings> = {}): CardSections =>
  presentCard(planCardFacts(reading(over)), 'plans', { now: NOW });

const pieceWords = (p: Piece) => p.text;
/** Every word a list of parts shows: pieces, summaries, dots and list items. */
const words = (parts: Part[]): string[] =>
  parts.flatMap((p) => (p.kind === 'list'
    ? [p.summary.text, ...p.dots.map((d) => `${d.count} ${d.word}`), ...p.items.map(pieceWords)]
    : [p.piece.text]));
const allWords = (s: CardSections): string[] => [
  s.header.title, ...s.header.tags.map(pieceWords), ...words(s.context),
  s.status.state.text, ...words(s.status.measures), s.status.assignees.text, s.status.age?.text ?? '',
  ...[s.actions.primary, ...s.actions.secondary].flatMap((a) => (a ? [a.label, a.reason ?? ''] : [])),
];

describe('presentCard: four sections', () => {
  it('the header leads with the plan kind icon, the key, the title and the type tag', () => {
    const s = sections({ issues: ['1089'] });
    expect(s.header.kind).toEqual({ kind: 'plan', label: 'Plan', hue: 'blue' });
    expect(s.header.key).toBe('1089');
    expect(s.header.title).toBe('X');
    expect(s.header.tags.map(pieceWords)).toEqual(['feature']);
  });

  it('the status opens with the state pill, then slices done of total, then assignees and the age', () => {
    const s = sections();
    expect(s.status.state).toMatchObject({ text: 'Approved', dot: 'green' });
    expect(s.accent).toBe('green');
    expect(s.status.measures[0]).toMatchObject({ kind: 'work', done: 1, total: 2, piece: { text: '1/2 slices' } });
    expect(s.status.assignees).toEqual({ text: '@jwloka', tone: 'muted', initials: ['JW'], detail: '@jwloka' });
    expect(s.status.age).toMatchObject({ text: '5 days ago', detail: 'opened 2026-11-01' });
  });

  it('an unread state reads state unknown, never an early state', () => {
    expect(sections({ state: '' }).status.state).toMatchObject({ text: 'state unknown', tone: 'unknown' });
  });

  it('progress reads unknown only when no scan covers the plan', () => {
    const cold = sections({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(cold.status.measures[0]).toMatchObject({ kind: 'work', done: null, piece: { text: '2 slices · progress unknown', tone: 'unknown' } });
  });

  it('two assignees fold to the first plus a count, with every name in the tooltip; none reads unassigned', () => {
    const two = sections({ assignee: 'jwloka, eins78' }).status.assignees;
    expect(two).toEqual({ text: '@jwloka +1', tone: 'muted', initials: ['JW', 'EI'], detail: '@jwloka, @eins78' });
    expect(sections({ assignee: '' }).status.assignees).toEqual({ text: 'unassigned', tone: 'muted', initials: [], detail: null });
  });

  it('an unread assignee list reads assignee unknown', () => {
    const facts = planCardFacts(reading());
    const s = presentCard({ ...facts, ownership: { ...facts.ownership, assignees: { unknown: 'throttled' } } }, 'plans');
    expect(s.status.assignees).toMatchObject({ text: 'assignee unknown', tone: 'unknown' });
  });

  it('shows no age without a clock', () => {
    expect(presentCard(planCardFacts(reading()), 'plans').status.age).toBeNull();
  });
});

describe('presentCard: every fact the plan card shows still shows', () => {
  it('type, rounds, spike, verification, not-pushed and the PR list', () => {
    const spikeSlices = [{ branches: [{ branch: 'feature/s', spike: true }] }, { branches: [{ branch: 'feature/b', spike: false }] }];
    const design = sections({
      status: 'draft',
      state: 'design',
      controls: cardControls({ state: 'design', status: 'draft', slices: spikeSlices }),
      rounds: 3,
      notPushed: true,
      prs: { value: [{ number: 12, branch: 'feature/s', checks: 'green', mergeable: 'mergeable', checksLookup: null }] },
    });
    const w = allWords(design);
    expect(w).toContain('feature');
    expect(w).toContain('3 rounds');
    expect(w).toContain('spike not approved yet');
    expect(w).toContain('not pushed');
    expect(w).toContain('#12 checks green');
    expect(w).toContain('Design');

    const delivered = sections({
      status: 'delivered', state: 'delivered',
      controls: cardControls({ state: 'delivered', status: 'delivered', started: true }),
      verification: { state: 'refuted', refuted: 2 },
    });
    expect(allWords(delivered)).toContain('2 refuted');
  });

  it('a measured cost shows on the card; an unmeasured or unread one goes to the detail view', () => {
    const measured = { tokens: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 }, measured: 2, absent: 0, unreadable: 0, fromRuns: 0, slices: 2 };
    expect(allWords(sections({ cost: { value: measured } }))).toContain('measured on 2 of 2 slices');
    const unmeasured = { tokens: null, measured: 0, absent: 2, unreadable: 0, fromRuns: 0, slices: 2 };
    expect(allWords(sections({ cost: { value: unmeasured } })).join(' ')).not.toContain('measured');
    expect(presentDetails(planCardFacts(reading({ cost: { value: unmeasured } }))).cost?.text).toBe('cost not measured here');
    expect(presentDetails(planCardFacts(reading({ cost: { unknown: 'failed' } }))).cost?.text).toBe('cost unknown — spend record unreadable');
  });

  it('the path leaves the card for the detail view', () => {
    expect(allWords(sections()).join(' ')).not.toContain('docs/plans');
    expect(presentDetails(planCardFacts(reading())).source.text).toBe('docs/plans/2026-11-01-x.md');
  });
});

describe('presentCard: context', () => {
  it('a story and a sprint show as their icon and title, the word left to the icon\'s name', () => {
    const over = {
      story: { value: { slug: 's', title: 'The story', status: 'active' as const, archived: false } },
      sprint: { value: { slug: 'sp', title: 'card-alignment', state: 'Active' as const } },
    };
    const context = sections(over).context;
    expect(words(context)).toEqual(['The story', 'card-alignment']);
    const icons = context.flatMap((p) => (p.kind === 'piece' ? [p.piece.icon] : []));
    expect(icons).toEqual([
      { kind: 'story', label: 'Story', hue: 'violet' },
      { kind: 'sprint', label: 'Sprint', hue: 'teal' },
    ]);
    const filtered = presentCard(planCardFacts(reading(over)), 'plans', { hide: ['stories'] });
    expect(words(filtered.context)).toEqual(['card-alignment']);
  });

  it('a plan with no story says nothing about a story', () => {
    expect(sections().context).toEqual([]);
  });

  it('a story that could not be read reads as unknown, never as none', () => {
    const part = sections({ story: { unknown: 'failed' } }).context[0];
    expect(part).toMatchObject({ kind: 'piece', piece: { text: 'stories unknown', tone: 'unknown' } });
  });

  it('every issue key shows: the first in the header, the rest in the context', () => {
    const s = sections({ issues: ['3101', 'PROJ-12'] });
    expect(s.header.key).toBe('3101');
    expect(words(s.context)).toEqual(['PROJ-12']);
    expect(sections({ issues: ['3101'] }).context).toEqual([]);
  });

  it('nine sprints read *in 9 sprints*', () => {
    const facts: CardFacts = planCardFacts(reading());
    const sprints = Array.from({ length: 9 }, (_, i) => ({ kind: 'sprint' as const, slug: `s${i}`, title: `S${i}`, state: 'Closed' as const }));
    const s = presentCard({ ...facts, lineage: { ...facts.lineage, sprints: { value: sprints } } }, 'plans');
    expect(s.context[0]).toMatchObject({ kind: 'list', summary: { text: 'in 9 sprints' } });
  });
});

describe('presentCard: the PR list', () => {
  const pr = (number: number, checks: 'green' | 'pending' | 'failing' | 'none' | 'unknown', over: Record<string, unknown> = {}) =>
    ({ number, branch: `b${number}`, checks, mergeable: checks === 'unknown' ? 'unknown' as const : 'mergeable' as const, checksLookup: null, ...over });

  it('a throttled host reads *checks unknown*, never zero', () => {
    const w = allWords(sections({ prs: { value: [pr(7, 'unknown')] } }));
    expect(w).toContain('#7 checks unknown');
    expect(w.some((x) => /\b0\b/.test(x) && x.includes('check'))).toBe(false);
  });

  it('two or more collapse to a count with one dot and count per check state', () => {
    const prs = [...[1, 2, 3, 4, 5].map((n) => pr(n, 'green')), pr(6, 'unknown')];
    const part = sections({ prs: { value: prs } }).status.measures.find((p) => p.kind === 'list');
    expect(part).toMatchObject({ kind: 'list', id: 'prs', summary: { text: '6 PRs', detail: '5 green · 1 checks unknown' } });
    expect(part?.kind === 'list' && part.dots).toEqual([
      { hue: 'green', count: 5, word: 'green' },
      { hue: 'slate', count: 1, word: 'checks unknown' },
    ]);
    expect(part?.kind === 'list' && part.items.map(pieceWords)).toContain('#6 checks unknown');
  });

  it('counts a conflicting PR apart and warns, as checksProminence does', () => {
    const part = sections({ prs: { value: [pr(1, 'green'), pr(2, 'none', { mergeable: 'conflicting' })] } }).status.measures.find((p) => p.kind === 'list');
    expect(part).toMatchObject({ summary: { tone: 'warn' } });
    expect(part?.kind === 'list' && part.dots.map((d) => d.word)).toEqual(['green', 'conflicting']);
    expect(part?.kind === 'list' && part.items.map(pieceWords)).toContain('#2 no checks — conflicts');
  });

  it('tells a PR not looked up yet from one whose checks could not be asked', () => {
    const part = sections({ prs: { value: [pr(1, 'unknown', { checksLookup: 'skipped' }), pr(2, 'unknown')] } }).status.measures.find((p) => p.kind === 'list');
    expect(part?.kind === 'list' && part.dots.map((d) => d.word)).toEqual(['checks unknown', 'not looked up yet']);
    expect(part?.kind === 'list' && part.items.map(pieceWords)).toEqual(['#1 checks not looked up yet', '#2 checks unknown']);
  });

  it('a PR with no checks because it conflicts warns, where a plain no-checks PR is quiet', () => {
    const conflicting = sections({ prs: { value: [pr(60, 'none', { mergeable: 'conflicting' })] } }).status.measures.find((p) => p.kind === 'piece');
    expect(conflicting).toMatchObject({ piece: { text: '#60 no checks — conflicts', tone: 'warn' } });
    const quiet = sections({ prs: { value: [pr(58, 'none')] } }).status.measures.find((p) => p.kind === 'piece');
    expect(quiet).toMatchObject({ piece: { text: '#58 no checks', tone: 'neutral' } });
  });
});

describe('presentCard: the action band', () => {
  it('a disabled Start work carries its reason in words', () => {
    const cold = sections({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(cold.actions.primary).toEqual({ action: 'start-work', label: 'Start work', enabled: false, reason: 'no fleet scan yet' });
    const blocked = sections({ slices: { total: 2, complete: 0, eligible: 0, waitsOn: [{ branch: 'feature/x', pr: 3105 }] } });
    expect(blocked.actions.primary?.reason).toBe('waits on feature/x #3105');
  });

  it('every reason kind has words', () => {
    const slice = { kind: 'slice' as const, plan: 'p', branch: 'feature/s', pr: null };
    const story = { kind: 'story' as const, slug: 's', title: 'S', status: 'active' as const, archived: false };
    expect(reasonWords({ kind: 'action-unavailable', action: 'start-work' })).toBe('unavailable on this board');
    expect(reasonWords({ kind: 'nothing-eligible', waitsOn: [] })).toBe('no branch is eligible to start');
    expect(reasonWords({ kind: 'awaits-spike', spike: slice })).toBe('waits on its spike feature/s');
    expect(reasonWords({ kind: 'linked-from-many-stories', stories: [story, story] })).toBe('linked from 2 stories');
    expect(reasonWords({ kind: 'lineage-unknown', relation: 'plans', reach: 'throttled' })).toBe('plans unread — host throttled');
  });

  it('an action the board will not run reads the board\'s own sentence where its entry gives one', () => {
    const facts = planCardFacts(reading());
    const off = { ...facts, next: { primary: { action: 'start-work' as const, enabled: false, reason: { kind: 'action-unavailable' as const, action: 'start-work' as const } }, secondary: [] } };
    expect(presentCard(off, 'plans').actions.primary?.reason).toBe('unavailable on this board');
    expect(presentCard(off, 'plans', { unavailable: { 'start-work': 'only on localhost' } }).actions.primary?.reason).toBe('only on localhost');
  });

  it('a draft offers Approve first, then Interrogate', () => {
    const s = sections({ status: 'draft', state: 'draft', controls: cardControls({ state: 'draft', status: 'draft' }) });
    expect(s.actions.primary?.label).toBe('Approve');
    expect(s.actions.secondary.map((a) => a.label)).toEqual(['Interrogate']);
  });
});

describe('presentCard: emphasis is per board, never position', () => {
  it('plans and swimlanes emphasise actions; stories status; tickets context', () => {
    const facts = planCardFacts(reading());
    expect(presentCard(facts, 'plans').emphasis).toBe('actions');
    expect(presentCard(facts, 'swimlanes').emphasis).toBe('actions');
    expect(presentCard(facts, 'stories').emphasis).toBe('status');
    expect(presentCard(facts, 'tickets').emphasis).toBe('context');
    expect(presentCard(facts, 'tickets').status).toEqual(presentCard(facts, 'plans').status);
  });
});

describe('presentCard: an unpushed plan', () => {
  it('reads not pushed in the neutral tone — a normal moment while writing a plan', () => {
    const tag = sections({ notPushed: true }).header.tags.find((t) => t.data.alert === 'not-pushed');
    expect(tag?.tone).toBe('neutral');
  });
});

describe('relativeAge', () => {
  it('reads today, yesterday, days, months and years', () => {
    expect(relativeAge('2026-11-06', NOW)).toBe('today');
    expect(relativeAge('2026-11-05', NOW)).toBe('yesterday');
    expect(relativeAge('2026-11-04', NOW)).toBe('2 days ago');
    expect(relativeAge('2026-09-01', NOW)).toBe('2 months ago');
    expect(relativeAge('2024-11-01', NOW)).toBe('2 years ago');
    expect(relativeAge('not a date', NOW)).toBe('not a date');
  });
});
