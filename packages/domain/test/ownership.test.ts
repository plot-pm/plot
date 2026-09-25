import { describe, it, expect } from 'vitest';
import { ownership, isMine, type OwnedRow, type Reader } from '../src/index.js';

/**
 * Whose a row is, and whether a filter to the reader's work keeps it.
 *
 * The fixture is #967's estate: four contributors, eleven open PRs, two of them
 * the reader's. A one-person estate cannot tell a filter that works from one
 * that hides nothing.
 */

const reader: Reader = { hostUser: 'jwloka', gitEmail: 'jan.wloka@quatico.com' };

const pr = (author?: string): OwnedRow => ({ kind: 'pr', author });

const estate: readonly OwnedRow[] = [
  pr('jwloka'), pr('jwloka'),
  pr('eins78'), pr('eins78'), pr('eins78'), pr('eins78'),
  pr('maemisegger'), pr('maemisegger'), pr('maemisegger'),
  pr('lklingler'), pr('lklingler'),
];

describe('ownership on #967\'s four-contributor estate', () => {
  it('keeps exactly the reader\'s two of eleven open PRs', () => {
    const kept = estate.filter((row) => isMine(row, reader));
    expect(estate).toHaveLength(11);
    expect(kept).toHaveLength(2);
    expect(kept.every((row) => row.kind === 'pr' && row.author === 'jwloka')).toBe(true);
  });

  it('names the other nine as somebody else\'s, not as unknown', () => {
    const answers = estate.map((row) => ownership(row, reader));
    expect(answers.filter((a) => a === 'mine')).toHaveLength(2);
    expect(answers.filter((a) => a === 'theirs')).toHaveLength(9);
    expect(answers.filter((a) => a === 'unknown')).toHaveLength(0);
  });
});

describe('a row with no determinable owner is shown', () => {
  it('shows a PR when the payload carries no identity', () => {
    expect(ownership(pr('eins78'), {})).toBe('unknown');
    expect(isMine(pr('eins78'), {})).toBe(true);
  });

  it('shows a PR when the reader\'s login is empty, as on Bitbucket', () => {
    const bitbucket: Reader = { hostUser: '', gitEmail: 'jan.wloka@quatico.com' };
    expect(ownership(pr('Michael Aemisegger'), bitbucket)).toBe('unknown');
    expect(isMine(pr('Michael Aemisegger'), bitbucket)).toBe(true);
  });

  it('does not read an empty identity against an empty author as a match', () => {
    expect(ownership(pr(''), { hostUser: '' })).toBe('unknown');
    expect(ownership(pr('  '), { hostUser: ' ' })).toBe('unknown');
  });

  it('shows a PR whose author the host did not answer', () => {
    expect(ownership(pr(''), reader)).toBe('unknown');
    expect(ownership(pr(undefined), reader)).toBe('unknown');
    expect(isMine(pr(undefined), reader)).toBe(true);
  });

  it('shows an agent in state elsewhere, whose desk is not on this machine', () => {
    const row: OwnedRow = { kind: 'agent', identity: 'manifest', state: 'elsewhere' };
    expect(ownership(row, reader)).toBe('unknown');
    expect(isMine(row, reader)).toBe(true);
  });

  it('shows a plan card, an issue row and a bare branch row', () => {
    expect(ownership({ kind: 'other' }, reader)).toBe('unknown');
    expect(isMine({ kind: 'other' }, reader)).toBe(true);
  });
});

describe('the agent row reports the machine\'s own record', () => {
  it('is the reader\'s where this machine declared it and its desk is here', () => {
    for (const state of ['running', 'finished', 'stalled', 'waiting', 'failed', 'ended', 'none']) {
      expect(ownership({ kind: 'agent', identity: 'manifest', state }, reader)).toBe('mine');
    }
  });

  it('is the reader\'s whatever the payload says about the host login', () => {
    expect(ownership({ kind: 'agent', identity: 'manifest', state: 'running' }, {})).toBe('mine');
  });

  it('is unknown for a desk no manifest declared', () => {
    expect(ownership({ kind: 'agent', identity: 'synthesized', state: 'running' }, reader)).toBe('unknown');
  });

  it('is unknown where an older server sent no identity or no state', () => {
    expect(ownership({ kind: 'agent', state: 'running' }, reader)).toBe('unknown');
    expect(ownership({ kind: 'agent', identity: 'manifest' }, reader)).toBe('unknown');
    expect(ownership({ kind: 'agent', identity: 'manifest', state: 'unknown' }, reader)).toBe('unknown');
  });
});

describe('one person, compared through Person', () => {
  it('reads case and surrounding whitespace as one person', () => {
    expect(ownership(pr('JWloka '), { hostUser: 'jwloka' })).toBe('mine');
    expect(ownership(pr('jwloka'), { hostUser: ' JWLOKA' })).toBe('mine');
  });

  it('never matches an email identity against a login author', () => {
    expect(ownership(pr('jan.wloka'), { hostUser: '', gitEmail: 'jan.wloka@quatico.com' })).toBe('unknown');
    expect(ownership(pr('jan.wloka'), { hostUser: 'jan.wloka@quatico.com' })).toBe('unknown');
    expect(ownership(pr('jwloka'), { gitEmail: 'jwloka@quatico.com' })).not.toBe('mine');
  });
});
