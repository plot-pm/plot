import { describe, expect, it } from 'vitest';
import { cardControls, planCardFacts, type PlanCardFactsReadings } from '@plot-pm/domain';
import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import { presentCard, reasonWords, type CardRows, type Part } from '../../src/app/lib/card-presentation.js';

const reading = (over: Partial<PlanCardFactsReadings> = {}): PlanCardFactsReadings => ({
  slug: 'x',
  title: 'X',
  path: 'docs/plans/2026-11-01-x.md',
  type: 'feature',
  assignee: 'jwloka',
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

const rows = (over: Partial<PlanCardFactsReadings> = {}): CardRows => presentCard(planCardFacts(reading(over)), 'plans');

/** Every word a row shows, collapsed lists by their summary and their items. */
const words = (parts: Part[]): string[] =>
  parts.flatMap((p) => (p.kind === 'piece' ? [p.piece.text] : [p.summary.text, ...p.items.map((i) => i.text)]));
const allWords = (r: CardRows): string[] => [
  r.title.text, ...words(r.identity), ...words(r.lineage), ...words(r.progress), ...words(r.ownership),
  ...[r.next.primary, ...r.next.secondary].flatMap((a) => (a ? [a.label, a.reason ?? ''] : [])),
];

describe('presentCard: every fact today\'s plan card shows still shows', () => {
  it('type, rounds, spike, verification, cost, not-pushed and the PR list', () => {
    const spikeSlices = [{ branches: [{ branch: 'feature/s', spike: true }] }, { branches: [{ branch: 'feature/b', spike: false }] }];
    const design = rows({
      status: 'draft',
      controls: cardControls({ state: 'design', status: 'draft', slices: spikeSlices }),
      rounds: 3,
      notPushed: true,
      prs: { value: [{ number: 12, branch: 'feature/s', checks: 'green', mergeable: 'mergeable' }] },
      cost: { value: { tokens: null, measured: 0, absent: 2, unreadable: 0, fromRuns: 0, slices: 2 } },
    });
    const w = allWords(design);
    expect(w).toContain('feature');
    expect(w).toContain('3 rounds');
    expect(w).toContain('spike not approved yet');
    expect(w).toContain('not pushed');
    expect(w).toContain('#12 checks green');
    expect(w).toContain('cost not measured here');

    const delivered = rows({ status: 'delivered', controls: cardControls({ state: 'delivered', status: 'delivered', started: true }), verification: { state: 'refuted', refuted: 2 } });
    expect(allWords(delivered)).toContain('2 refuted');
  });

  it('a story and a sprint show in the lineage row, unless a filter already names them', () => {
    const over = {
      story: { value: { slug: 's', title: 'The story', status: 'active' as const, archived: false } },
      sprint: { value: { slug: 'sp', title: 'card-alignment', state: 'Active' as const } },
    };
    expect(words(rows(over).lineage)).toEqual(['story The story', 'sprint card-alignment']);
    const filtered = presentCard(planCardFacts(reading(over)), 'plans', { hide: ['stories'] });
    expect(words(filtered.lineage)).toEqual(['sprint card-alignment']);
  });

  it('the title carries the issue key; owner, date and path are on the ownership row', () => {
    const r = rows({ issues: ['1089'] });
    expect(r.title.text).toBe('1089: X');
    expect(words(r.ownership)).toEqual(['@jwloka', 'opened 2026-11-01', 'docs/plans/2026-11-01-x.md']);
  });
});

describe('presentCard: absence is not content', () => {
  it('no plan card shows *not measured here* or *checks not asked* as a chip of its own', () => {
    const r = rows({
      prs: { value: [{ number: 1, branch: 'a', checks: 'unknown', mergeable: 'unknown' }, { number: 2, branch: 'b', checks: 'green', mergeable: 'mergeable' }] },
      cost: { value: { tokens: null, measured: 0, absent: 2, unreadable: 0, fromRuns: 0, slices: 2 } },
    });
    const all = allWords(r);
    expect(all).not.toContain('not measured here');
    expect(all.some((w) => w.includes('checks not asked'))).toBe(false);
    // The unknowns read inside their own facts: the cost row and the PR row.
    expect(all).toContain('cost not measured here');
    expect(all).toContain('2 PRs · 1 checks unknown');
  });

  it('a plan with no story says nothing about a story', () => {
    expect(rows().lineage).toEqual([]);
  });

  it('a story that could not be read reads as unknown, never as none', () => {
    expect(words(rows({ story: { unknown: 'failed' } }).lineage)).toEqual(['stories unknown — unreadable']);
  });
});

describe('presentCard: a throttled host', () => {
  it('reads *checks unknown*, never zero', () => {
    const throttled = rows({ prs: { value: [{ number: 7, branch: 'feature/a', checks: 'unknown', mergeable: 'unknown' }] } });
    const all = allWords(throttled);
    expect(all).toContain('#7 checks unknown');
    expect(all.some((w) => /\b0\b/.test(w) && w.includes('check'))).toBe(false);
  });

  it('counts unknown checks apart from the rest, per PR', () => {
    const prs = [
      ...[1, 2, 3, 4, 5].map((n) => ({ number: n, branch: `b${n}`, checks: 'green' as const, mergeable: 'mergeable' as const })),
      { number: 6, branch: 'b6', checks: 'unknown' as const, mergeable: 'unknown' as const },
    ];
    const part = rows({ prs: { value: prs } }).progress.find((p) => p.kind === 'list');
    expect(part?.kind === 'list' && part.summary.text).toBe('6 PRs · 1 checks unknown');
  });
});

describe('presentCard: lists of two or more collapse and expand', () => {
  it('a PR list is one summary line with every PR behind it', () => {
    const prs = [{ number: 1, branch: 'a', checks: 'failing' as const, mergeable: 'mergeable' as const }, { number: 2, branch: 'b', checks: 'pending' as const, mergeable: 'mergeable' as const }];
    const part = rows({ prs: { value: prs } }).progress.find((p) => p.kind === 'list');
    expect(part).toMatchObject({ kind: 'list', id: 'prs', summary: { text: '2 PRs · 1 failing · 1 running', tone: 'warn' } });
    expect(part?.kind === 'list' && part.items.map((i) => i.text)).toEqual(['#1 checks failing', '#2 checks running']);
  });

  it('nine sprints read *in 9 sprints*', () => {
    const facts: CardFacts = planCardFacts(reading());
    const sprints = Array.from({ length: 9 }, (_, i) => ({ kind: 'sprint' as const, slug: `s${i}`, title: `S${i}`, state: 'Closed' as const }));
    const r = presentCard({ ...facts, lineage: { ...facts.lineage, sprints: { value: sprints } } }, 'plans');
    expect(r.lineage[0]).toMatchObject({ kind: 'list', summary: { text: 'in 9 sprints' } });
  });
});

describe('presentCard: the action row', () => {
  it('a disabled Start work carries its reason in words', () => {
    const cold = rows({ slices: { total: 2, complete: null, eligible: null, waitsOn: [] } });
    expect(cold.next.primary).toEqual({ action: 'start-work', label: 'Start work', enabled: false, reason: 'no fleet scan yet' });
    const blocked = rows({ slices: { total: 2, complete: 0, eligible: 0, waitsOn: [{ branch: 'feature/x', pr: 3105 }] } });
    expect(blocked.next.primary?.reason).toBe('waits on feature/x #3105');
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

  it('a draft offers Approve first, then Interrogate', () => {
    const r = rows({ status: 'draft', controls: cardControls({ state: 'draft', status: 'draft' }) });
    expect(r.next.primary?.label).toBe('Approve');
    expect(r.next.secondary.map((a) => a.label)).toEqual(['Interrogate']);
  });
});

describe('presentCard: emphasis is per board, never position', () => {
  it('plans and swimlanes emphasise next; stories progress; tickets lineage', () => {
    const facts = planCardFacts(reading());
    expect(presentCard(facts, 'plans').emphasis).toBe('next');
    expect(presentCard(facts, 'swimlanes').emphasis).toBe('next');
    expect(presentCard(facts, 'stories').emphasis).toBe('progress');
    expect(presentCard(facts, 'tickets').emphasis).toBe('lineage');
    expect(presentCard(facts, 'tickets').progress).toEqual(presentCard(facts, 'plans').progress);
  });
});

describe('presentCard: a PR with no checks because it conflicts', () => {
  it('says so, and warns, where a plain no-checks PR is quiet', () => {
    const r = rows({ prs: { value: [{ number: 60, branch: 'b', checks: 'none', mergeable: 'conflicting' }] } });
    const p = r.progress.find((x) => x.kind === 'piece' && 'pr-checks' in x.piece.data);
    expect(p?.kind === 'piece' && [p.piece.text, p.piece.tone]).toEqual(['#60 no checks — conflicts', 'warn']);
    const quiet = rows({ prs: { value: [{ number: 58, branch: 'b', checks: 'none', mergeable: 'mergeable' }] } });
    const q = quiet.progress.find((x) => x.kind === 'piece' && 'pr-checks' in x.piece.data);
    expect(q?.kind === 'piece' && [q.piece.text, q.piece.tone]).toEqual(['#58 no checks', 'neutral']);
  });
});

describe('presentCard: an action this board will not run', () => {
  it('reads the board\'s own sentence where its action entry gives one', () => {
    const facts = planCardFacts(reading());
    const off = { ...facts, next: { primary: { action: 'start-work' as const, enabled: false, reason: { kind: 'action-unavailable' as const, action: 'start-work' as const } }, secondary: [] } };
    expect(presentCard(off, 'plans').next.primary?.reason).toBe('unavailable on this board');
    expect(presentCard(off, 'plans', { unavailable: { 'start-work': 'only on localhost' } }).next.primary?.reason)
      .toBe('only on localhost');
  });
});

describe('presentCard: a plan answering two issues', () => {
  it('shows every key: the first in the title, the rest in the lineage row', () => {
    const r = rows({ issues: ['3101', 'PROJ-12'] });
    expect(r.title.text).toBe('3101: X');
    expect(words(r.lineage)).toEqual(['ticket PROJ-12']);
  });

  it('a plan with one issue repeats nothing in the lineage row', () => {
    expect(rows({ issues: ['3101'] }).lineage).toEqual([]);
  });
});
