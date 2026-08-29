import { describe, it, expect } from 'vitest';
import {
  FleetPulseSchema, PlanSliceSchema, SliceVerdictSchema,
} from '../../src/contract/schema.js';
import { classify, waveVerdict } from '../../src/server/fleet.js';
import { tupleFromWave, statusTone } from '../../src/app/lib/tuple-row.js';

// The board's half of `an-eligible-wave-can-be-started`. The scan withholds
// `eligible` from a wave whose plan is not approved and says `unapproved`
// instead; these are the assertions that the payload survives the new word and
// that the row renders it without promoting it to an action.

describe('the fleet payload accepts the unapproved verdict', () => {
  // THE ONE THAT MATTERS MOST. `readBridge` runs `FleetPulseSchema.parse`
  // inside a try/catch that returns null on any failure — so a single
  // unrecognised verdict does not drop one wave, it discards the WHOLE pulse
  // and the board falls back to "waiting for its first scan". Shipping the
  // scan's new word without widening this enum would have blanked the board.
  it('parses a wave the scan reports as unapproved', () => {
    const parsed = PlanSliceSchema.safeParse({
      name: 'Worded', verdict: 'unapproved', branches: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps a whole pulse rather than discarding it for the new word', () => {
    const parsed = FleetPulseSchema.safeParse({
      main: 'main',
      head: 'abc1234',
      plans: [{
        file: '2026-08-27-a-draft.md',
        phase: 'draft',
        slices: [{ name: 'Worded', verdict: 'unapproved', branches: [] }],
      }],
      summary: {
        plans: 1, waves: 1, branches: 0, claimed: 0,
        eligible: 0, blocked: 0, deferred: 0,
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.plans[0].slices[0].verdict)
      .toBe('unapproved');
  });

  // `waveVerdict` is the one gate between the untyped pulse and the row's
  // typed field. It must forward the word rather than null it — a null here
  // would render as nothing, which is the silence the plan set out to end.
  it('forwards unapproved onto the row rather than nulling it', () => {
    expect(waveVerdict('unapproved')).toBe('unapproved');
  });

  it('still refuses a word the scan cannot say', () => {
    expect(waveVerdict('probably-fine')).toBe(null);
  });

  // Done-when 5, on the CONTRACT: the new state has its own word and did not
  // reuse `blocked`, which already means *an earlier wave has not landed*.
  it('is a fourth word, not a reuse of blocked', () => {
    expect(SliceVerdictSchema.options).toContain('unapproved');
    expect(SliceVerdictSchema.options).toContain('blocked');
    expect(SliceVerdictSchema.options).toHaveLength(4);
  });
});

describe('an unapproved wave renders as unstartable', () => {
  const waveFacts = (verdict: 'eligible' | 'unapproved') => ({
    name: 'Worded',
    plan: '2026-08-27-a-draft.md',
    verdict,
    branches: [{ branch: 'bug/from-a-draft', branchUrl: '' }],
    blockedBy: null,
    groupedCount: null,
    groupedWord: '',
    soleStatus: '',
    solePlan: null,
    outstanding: null,
    ageMinutes: null,
    waitingDays: null,
  });

  // The verdict reaches slot 5 verbatim, so the word IS what the reader sees.
  it('prints the verdict in the status slot', () => {
    expect(tupleFromWave(waveFacts('unapproved') as never).status)
      .toBe('unapproved');
  });

  // `statusTone` colours *what a reader acts on* — green for `eligible`. An
  // unapproved wave is precisely what a reader cannot act on, so it must not
  // join that group. It falls through to the neutral tone by construction
  // rather than by a rule that could drift.
  it('does not wear the actionable green tone', () => {
    expect(statusTone('eligible')).not.toBe('');
    expect(statusTone('unapproved')).toBe('');
  });
});

// A DISCOVERY THE PLAN DID NOT ANTICIPATE, pinned rather than left to be
// rediscovered. The scan's gate is an allowlist of `approved`, so a plan in a
// TERMINAL phase gets `unapproved` too — literally true (it is not approved)
// and misleading as an instruction, because the reader's next action for a
// released plan is nothing rather than *approve it*. Measured on this repo
// after the fix: 13 draft waves and 9 delivered/released ones.
//
// It is not a defect, and this is why: `classify` routes a terminal plan's
// rows to DONE with `FINISHED_PLAN_NOTE` BEFORE any verdict arm runs, so the
// word never reaches a reader as an errand. The verdict is data on a row whose
// section and sentence are both decided by the phase one step earlier.
//
// Widening the scan's gate to include the terminal phases would be the wrong
// repair anyway: `eligible` there would re-offer finished work as available,
// which is the defect `RELEASED_PLAN_NOTE` was built to end.
describe('a terminal plan keeps the word off the reader', () => {
  it('routes a released plan to DONE regardless of its wave verdict', async () => {
    const { classify } = await import('../../src/server/fleet.js');
    // Positional, the shape fleet.test.ts uses: state, wave verdict, ..., and
    // the plan phase at index 7 — the argument that decides this row.
    const row = classify(
      'open', 'unapproved', 500, 60, null, false, 0, 'released', 'none', null, 0,
    );
    expect(row.group).toBe('done');
    expect(row.note).not.toContain('approv');
  });

  it('still lets an APPROVED plan reach the verdict arms', () => {
    // The control: same call, one field different. Without it the assertion
    // above would pass against a classify that sent everything to DONE.
    const row = classify(
      'open', 'eligible', 500, 60, null, false, 0, 'approved', 'none', null, 0,
    );
    expect(row.group).toBe('not-started');
  });
});
