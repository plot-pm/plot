import { describe, it, expect } from 'vitest';
import { classify } from '../../src/server/fleet.js';
import type { PrRecord } from '../../src/server/fleet.js';
import { noteWithoutPr } from '../../src/app/lib/agent-rows/host-notes.js';
import type { BranchState, WorkerState } from '../../src/contract/schema.js';

// A GREEN DRAFT SLICE PR WITH NO LIVE AGENT WAITS ON A PERSON TO MARK IT READY.
//
// Measured 2026-10-22 on #2310: a draft, four green checks, its desk finished.
// The board showed no row for it in any section (#2319).

const QUIET = 30;

const draftPr = (over: Partial<PrRecord> = {}): PrRecord => ({
  number: 2310, state: 'OPEN', draft: true, checks: 'green', mergeable: 'mergeable',
  failing_checks: [], url: '', author: '', head: 'bug/x', ...over,
} as PrRecord);

const place = (over: { state?: BranchState; worker: WorkerState; ageMinutes?: number; pr?: PrRecord }) =>
  classify(
    over.state ?? 'wip', 'eligible', over.ageMinutes ?? 5000, QUIET, over.pr ?? draftPr(),
    false, 0, 'approved', over.worker, '', over.worker === 'running' ? '4242' : '', false,
    [], '', false, '', false, '', false, false, [],
  );

describe('a green draft slice PR with no live agent', () => {
  for (const worker of ['finished', 'none'] as const) {
    for (const state of ['wip', 'claimed'] as const) {
      for (const ageMinutes of [5, 5000]) {
        it(`${state}, worker ${worker}, last commit ${ageMinutes} min ago: waits on you to mark it ready`, () => {
          const r = place({ state, worker, ageMinutes });
          expect(r.group).toBe('waiting-on-you');
          expect(r.note).toContain('mark ready');
          expect(r.note).toContain('PR #2310');
        });
      }
    }
  }
});

describe('what the rule leaves alone', () => {
  it('a live agent keeps the draft: no mark-ready row', () => {
    const r = place({ worker: 'running' });
    expect(r.group).toBe('working');
    expect(r.note).not.toContain('mark ready');
  });

  it('an agent waiting on an answer keeps the draft', () => {
    expect(place({ worker: 'waiting' }).note).not.toContain('mark ready');
  });

  it('a ready (non-draft) green PR gets no mark-ready action', () => {
    const r = place({ worker: 'finished', pr: draftPr({ draft: false }) });
    expect(r.note).not.toContain('mark ready');
  });

  it('a draft with pending checks gets no mark-ready action', () => {
    const r = place({ worker: 'finished', pr: draftPr({ checks: 'pending' }) });
    expect(r.note).not.toContain('mark ready');
  });

  it('a draft with failing checks gets no mark-ready action', () => {
    const r = place({ worker: 'finished', pr: draftPr({ checks: 'failing' }) });
    expect(r.note).not.toContain('mark ready');
  });

  it('a crashed agent keeps the sentence that names the crash', () => {
    const r = place({ worker: 'failed' });
    expect(r.note).not.toContain('mark ready');
  });
});

describe('the row keeps the action after the PR cell takes its clause', () => {
  it('prints mark ready once the PR clause is taken off the front', () => {
    const r = place({ worker: 'finished' });
    expect(noteWithoutPr(r.note, { number: 2310, url: '', draft: true, state: 'green' })).toBe('mark ready');
  });
});
