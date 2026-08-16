import { describe, it, expect } from 'vitest';
import { PlanMetaSchema, CardSchema, summariseWaves } from '../../src/contract/schema';

describe('PlanMetaSchema — waves', () => {
  const base = { file: 'docs/plans/x.md', format: 'canonical', phase: 'approved' };

  it('accepts the waves array emitted by plot-plan-meta.sh', () => {
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [
        { name: 'Tracer', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
        {
          name: 'Implementation',
          branches: [{ branch: 'feature/b', deferred: true, claimed: '2026-08-14T10:22Z, s-3' }],
        },
      ],
    });
    expect(parsed.waves).toHaveLength(2);
    expect(parsed.waves[0].name).toBe('Tracer');
    expect(parsed.waves[1].branches[0].deferred).toBe(true);
    expect(parsed.waves[1].branches[0].claimed).toBe('2026-08-14T10:22Z, s-3');
  });

  it('defaults waves to empty so pre-wave helper output still validates', () => {
    // The board must keep working against an older plot-plan-meta.sh that
    // emits no waves field at all.
    const parsed = PlanMetaSchema.parse({ ...base, branches: ['feature/a'] });
    expect(parsed.waves).toEqual([]);
  });

  it('keeps the flat branches list as the whole set, independent of waves', () => {
    // waves[] groups; branches[] remains the complete, sorted set that existing
    // consumers read. One must never be derived from the other at this layer.
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [{ name: '', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(parsed.branches).toEqual(['feature/a', 'feature/b']);
  });
});

describe('summariseWaves — what a board card shows', () => {
  const wave = (name: string, branches: Array<[string, boolean, string]>) => ({
    name,
    branches: branches.map(([branch, deferred, claimed]) => ({ branch, deferred, claimed })),
  });

  it('counts waves and the outstanding work in them', () => {
    // A card needs a glanceable triple, not the whole nested structure:
    // "wave 2 of 4, N branches, M claimed".
    const s = summariseWaves([
      wave('Tracer', [['feature/a', false, '']]),
      wave('Implementation', [['feature/b', false, 'ts, s-1'], ['feature/c', false, '']]),
      wave('Wave 3', [['feature/d', false, '']]),
    ]);
    expect(s).toEqual({ waves: 3, branches: 4, claimed: 1, deferred: 0 });
  });

  it('excludes deferred branches from the branch count', () => {
    // Deferred branches are not outstanding work — showing them as such would
    // make a finished plan look unfinished on the board.
    const s = summariseWaves([
      wave('Implementation', [['feature/a', false, ''], ['feature/gone', true, '']]),
    ]);
    expect(s).toEqual({ waves: 1, branches: 1, claimed: 0, deferred: 1 });
  });

  it('returns zeroes for a pre-wave plan', () => {
    expect(summariseWaves([])).toEqual({ waves: 0, branches: 0, claimed: 0, deferred: 0 });
  });

  it('is carried on the card as an optional field', () => {
    // Optional: pre-wave plans and older helper output must still produce a
    // valid card.
    const card = CardSchema.parse({
      slug: 'x', title: 'X', type: 'feature', phase: 'Development', path: 'docs/plans/x.md',
      waveSummary: { waves: 2, branches: 3, claimed: 1, deferred: 0 },
    });
    expect(card.waveSummary?.claimed).toBe(1);
    const bare = CardSchema.parse({
      slug: 'y', title: 'Y', type: 'docs', phase: 'Design', path: 'docs/plans/y.md',
    });
    expect(bare.waveSummary).toBeUndefined();
  });
});

describe('CardSchema — pull requests', () => {
  const base = { slug: 'x', title: 'X', type: 'feature', path: 'docs/plans/x.md' };

  it('carries each PR as a number plus the host-supplied url', () => {
    const card = CardSchema.parse({
      ...base, phase: 'Endgame',
      prs: [{ number: 113, url: 'https://example.test/pr/113' }],
    });
    expect(card.prs).toEqual([{ number: 113, url: 'https://example.test/pr/113' }]);
  });

  it('accepts a PR with no url — the board renders no link rather than guessing', () => {
    // The host adapter is the only thing that knows a PR's address. Where it
    // reports none (older CLI, PR data not fetched yet), the number stands
    // alone. A URL composed here would be wrong on GitHub Enterprise and on
    // every self-hosted Bitbucket.
    const card = CardSchema.parse({ ...base, phase: 'Development', prs: [{ number: 9 }] });
    expect(card.prs[0]).toEqual({ number: 9, url: '' });
  });

  it('defaults to no PRs, so a plan that names none is not a degraded card', () => {
    const card = CardSchema.parse({ ...base, phase: 'Design' });
    expect(card.prs).toEqual([]);
  });
});
